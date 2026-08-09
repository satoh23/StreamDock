import { useCallback, useEffect, useRef, useState } from "react";
import { connectCommentStream } from "../../features/comment-viewer/commentStream";
import {
  EFFECT_TEST_FIRE_KEY,
  loadEffectMonetaryEnabled,
  loadEffectOverlayGuidePending,
  saveEffectOverlayGuidePending,
} from "../../features/comment-viewer/overlaySettings";
import { OVERLAY_TONE_CLASS } from "../comment-viewer/monetaryTone";
import {
  createEffectTriggerState,
  decideEffects,
  EFFECT_DISPLAY_MS,
  EFFECT_MAX_CONCURRENT,
  type EffectRequest,
} from "./effectTrigger";
// ⚠ **意匠のためではなく、透過の :global ルールをこの窓にも効かせるために import する。**
// 背景透過（`html[data-overlay="1"]` の `background: transparent` と `overflow: hidden`）は
// `OverlayApp.module.css` にしか定義されておらず、その 1 枚が**バンドルに含まれていること**が前提になる。
// 現状は `App.tsx` が `OverlayApp` を静的 import しているので必ず含まれるが、それは暗黙の依存で、
// 将来 `OverlayApp` を lazy 化すると**この窓だけ背景が不透明になる**（原因が非常に追いにくい）。
// 明示的に依存を書いておくことで、その事故を構造で防ぐ（`PinnedOverlayApp` も同じ 1 枚に依存している）。
import "../comment-viewer/OverlayApp.module.css";
import styles from "./EffectOverlayApp.module.css";

/**
 * 061a: セットアップ用ガイドを出しておく時間（ミリ秒）。**この窓が開いてからの経過**で測る。
 *
 * ⚠⚠ **「配信中に出ない」を満たすための仕掛けはこれ 1 つ**（061a のタスクファイルが「実装時に決めて
 * コメントに残す」と指定した論点）。他に検討したのは 2 案で、どちらも採らなかった:
 *
 * - **「`obs-effects` 画面を開いている間だけ出す」**: main 窓とこの窓は**別 webview** なので、
 *   「開いている」を伝えるには localStorage のフラグ＋`storage` が要る。⚠ **main 窓が異常終了すると
 *   フラグが立ったまま残る＝fail-open**（配信中にガイドが出続ける）。ハートビートで fail-safe にはできるが、
 *   数秒ごとの localStorage 書込が**全窓へ `storage` を撒く**ので割に合わない。
 * - **「設定トグルで消せる」**: 既定 ON だと配信中に出うる／既定 OFF だとセットアップができない。
 *
 * 採った案（時間で自動的に消す）が満たすもの:
 * - **fail-safe**——時間で必ず消えるので、**消し忘れが構造的に起きない**。
 * - **出し直せる**——表示 OFF → ON で窓が作り直されるのでもう一度出る（`ObsEffectsScreen` に明記済み）。
 *
 * ⚠⚠ **061a レビュー（Q-1）で「時間」だけでは足りないと判明した。** 当初の論証は「窓が開くのは
 * ユーザーが表示トグルを ON にした明示操作のときだけ ＝ 配信開始時にはとっくに消えている」だったが、
 * **同じ 061a が `MainWindowApp` のマウント（＝アプリ起動）で窓を開き直す経路を新設したため、この前提は偽**。
 * 本アプリは `boot_launch_presets` を持つ配信準備時のランチャなので、「設定 ON のまま配信直前に起動」で
 * ガイドが 30 秒間 OBS のキャプチャに映ってしまう。
 * → **時間による自動消灯に加えて、`EFFECT_OVERLAY_GUIDE_PENDING_KEY`（ワンショット旗）で
 * 「明示操作で開いたときだけ出す」を担保する**（下の `useState` 初期化子）。旗の設計は同キーの JSDoc が正。
 *
 * 値の根拠: OBS で「ソースを追加 → ウィンドウキャプチャ → 一覧から選ぶ → 位置合わせ」まで一巡する実測想定。
 * **再修正トリガー**＝実機で「合わせ終わる前に消える」なら伸ばす（60 秒程度まで）。
 */
const SETUP_GUIDE_VISIBLE_MS = 30_000;

/**
 * 061b: 既知コメント id の保持上限。**同一 id で二度発火しない**ための集合。
 *
 * ⚠⚠ **これが [043e]（Jewels の combo 再送＝同じ id が何度も届く）への構造的な答え**である。
 * `mergeComments` の `updated` バケットに頼らず「**一度見た id は二度と発火対象にしない**」ので、
 * 再接続（`scheduleReconnect`）を跨いでも二重に出ない（この集合はコンポーネントの ref で、
 * WS の生存とは独立に持続する）。
 *
 * 値の根拠: 047f の `MONETARY_HARD_MAX` と同じ「**通常到達しない防御値**」。
 * ⚠ 溢れたら**古い順に捨てる**ので、捨てた id が後から再送されると再発火しうるが、
 * combo 更新は数秒以内に届くため 500 件の窓では起きない。
 * **再修正トリガー**＝この上限を大幅に下げるなら、再発火が現実に起きるので設計ごと見直すこと。
 *
 * ⚠ **061b レビュー②Q-4（テストで固定していない・意図的）**: 「古い順に捨てる」は `Set` の挿入順に
 * 依存しているが、追い出し方向を反転させる変異はテストで殺せていない（501 件を流したうえで
 * 「窓の外へ出た id だけが再発火する」を観測する必要があり、バースト上限と時間窓を跨ぐので
 * テストが実装の内部順序へ強く結合する）。**修正不要と判断した理由**＝反転しても実害は
 * 「上限 500 を超えた運用でのみ、稀に 1 回余計に光る」だけで、§9 にも §6 にも触れないため。
 * **再修正トリガー**＝上限を大幅に下げる／`seenIds` を再発火以外の判断（例: 集計・永続）に使い始めたとき。
 */
const SEEN_EFFECT_IDS_MAX = 500;

/**
 * 061b: **テスト発火で出す固定ダミー**（`ObsEffectsScreen` の「テスト表示」ボタン用）。
 *
 * ⚠⚠ **中身をここに置くのが要点。** main 窓が localStorage へ書くのは**nonce だけ**で、
 * エフェクトの内容は 1 バイトも載らない（＝**第三者のデータが localStorage を経由しない**・§9）。
 * ⚠ `tone` は `t3`（¥1,000〜の黄）＝実際のスパチャで最も見る帯に合わせてある。
 */
const TEST_FIRE_REQUEST: EffectRequest = {
  id: "__test-fire__",
  name: "テスト",
  amountText: "¥1,000",
  message: null,
  eventLabel: "スーパーチャット",
  tone: "t3",
  kind: "builtin-monetary",
};

/**
 * 061a: エフェクト専用の背景透過オーバーレイ（別ウィンドウ label `effect-overlay`）の描画本体。
 *
 * **061b-1（経路）時点ではまだ何も表示しない**（エフェクトの描画は 061b-2）。ここにあるのは
 * ①透過窓としての体裁 ②OBS のセットアップ時に窓の位置が分かるガイド ③**sidecar への読み取り専用接続**、の 3 つ。
 *
 * ⚠⚠ **061b で 061a の決定を反転した——この窓は sidecar の loopback WS へ直接つなぐ。**
 * 061a は「エフェクト窓は WS へ一切接続しない（コメビュ窓が localStorage へ書いた `EffectRequest` を
 * `storage` 購読で受ける）」と決めていたが、**その localStorage 経路ごと廃止された**。
 * いまは `comment-overlay` 窓（`OverlayApp`）と**まったく同じ構え**で、`connectCommentStream` を
 * **1 本だけ**張り、`onComments` だけを使う（`startLogin` / `startSession` / `stopSession` / `enableObs` 等の
 * 制御フレームは 1 つも送らない＝**送信フレームゼロ・新規宛先ゼロ・新規プロトコルゼロ**）。
 *
 * ⚠⚠ **反転の代償＝この窓には第三者のコメント本文が流れ込む。** 061a の「そもそも繋がない」という
 * 担保は失われたので、代わりに次を守る（⚠ **どれをテストが固定できているかは項目ごとに違う**。
 * 061b レビュー S-2 で「全部テストが固定」と書いていたのが**過大な主張**だったので実態に直した）:
 *   - **描かない**（本文・アバターを DOM に出さない。要望は「誰がいくら」なので本文は要らないし、
 *     出すと配信画面に第三者の自由入力がそのまま大写しになる＝荒らし耐性が下がる）
 *     → ✅ `EffectOverlayApp.test.tsx` が固定（描く変異でレッド）
 *   - **`localStorage` に保存しない**（046a と同じ規律） → ✅ テストが固定
 *   - **ログに出さない**（`console.*` へ 1 バイトも出さない・§9）
 *     → ✅ テストが固定（061b レビュー S-2 で追加。それ以前は `console.log` を足す変異が**生存**していた）。
 *     ⚠ **061b レビュー②S-2**: 当初のケースは課金コメント 1 件しか流しておらず、
 *     **課金判定で弾いた側（＝通常チャット＝本文が流れる量としては圧倒的多数）のログ変異が生存**していた。
 *     いまは非課金コメントも流すケースに加えて、**eslint の `no-console`**（`eslint.config.js` で
 *     `src/screens/obs-effects/**` に限定）を二重に効かせている。
 *   - **`useState` に受信 DTO を置かない**（＝`OverlayApp` と違って `mergeComments` を使わない。
 *     あちらは表示のために本文込み最大 200 件を state に持つ）
 *     → ⚠ **テストでは固定できていない**（描かずに state へ入れるだけの変異は外から観測できない）。
 *     061b-2 で state を持つときは、**`EffectRequest` に `text` / `avatar` を持たせない**という
 *     型の側で構造的に守ること（親 061 の決定）。
 *   - **`recordComments` 等の DB 経路へ流さない**（046a と同じ規律。import もしない）
 *     → ⚠ テストではなく「import していない」ことが担保（`grep` で確認できる）
 *
 * ⚠ **sidecar のライフサイクル**（Rust 側・`lib.rs` の `SIDECAR_CONSUMER_LABELS` が正）:
 *   - **この窓は sidecar を起動しない。** 起動契機は `open_comment_viewer_window` の 1 箇所のまま。
 *     ＝ sidecar が居ない間は `connectCommentStream` が接続待ちで**毎秒 `get_comment_stream_port` を
 *     invoke し続ける**（**エラー表示も再試行の可視化も出さない**）。
 *     ⚠ 061b レビュー S-4: これを「`OverlayApp` と同じ性質」とだけ書くのは**不正確**。あちらの窓は
 *     コメビュ窓からしか開けず起動時復元も無いので実際には sidecar が動いている間しか存在しないが、
 *     **この窓は永続設定でアプリ起動時に自動復元される**ので、「sidecar 未起動のまま回り続ける」が
 *     既定状態になる。受容根拠と再修正トリガーは `lib.rs` の `open_effect_overlay_window` の注記が正。
 *   - **この窓が生きている間 sidecar は落ちない。** ＝ **コメント取得を開始したあとコメビュ窓を閉じても
 *     エフェクトが出続ける**（これが 061b の仕様変更の目的そのもの）。どの窓も無くなれば必ず落ちる。
 *     ⚠⚠ **帰結（061b レビュー S-1）＝この窓が開いている間は Twitch/YouTube への取得＝外部通信も続く**
 *     （sidecar の取得セッションは `stop-session` かプロセス終了でしか止まらない）。
 *     ユーザーへの明示は `ObsEffectsScreen` の前提案内が担う。docs/security.md §1「取得の停止条件」。
 *   - ⚠ ただし **`start-session`（＝実際のコメント取得の開始）の導線はコメビュ窓にしかない**ので、
 *     「コメビュ窓を一度も開かずにエフェクトを出す」には到達しない（別タスク）。
 *
 * 背景透過: `OverlayApp` / `PinnedOverlayApp` と同じく、この窓の document にだけ `data-overlay="1"` 属性を
 * 立て、`OverlayApp.module.css` の属性ガード付き `:global` ルールで透明化する（unmount で属性を外す）。
 * 透過窓の生成（transparent / decorations(false) / always_on_bottom / focused(false) / 既定サイズ）は
 * Rust の `open_effect_overlay_window` が担い、frontend からは窓を生成しない。
 *
 * ⚠⚠ **安定クラス `sd-overlay` は付けない。** 060d のカスタム CSS テーマの注入先は `comment-overlay` のみで、
 * 窓の区別をこのクラスの有無で表している（`PinnedOverlayApp` にも付いていない）。
 * 静的ガード `check-css-guards.mjs` の (10-d) がこの窓についても否定検査している。
 *
 * ⚠ **061b-2 がここへ足すもの / 足さないもの**:
 *   足す＝発火層（`effectTrigger.ts` の `decideEffects`）・`EffectRequest` の描画・表示時間・フェード・
 *   既知 id 集合（同一 id の再送で二度出さない＝043e の combo 更新対策）・テスト発火の受け口。
 *   足さない＝コメント本文・アバター（上記）／**マウント時に過去のエフェクトを再生すること**
 *   （エフェクトは「その瞬間に出ないと意味がない」ので、届かなかったら諦める＝046b との明確な差。
 *   何も永続しないので**再生する対象がそもそも存在しない**＝ 061a レビュー S-1 の懸念は構造的に消えている）。
 */
export function EffectOverlayApp() {
  // ⚠ 061a レビュー（Q-1）: 初期値は**ワンショット旗の有無**で決める（旧実装は無条件 true だった）。
  // 旗を立てるのは `ObsEffectsScreen` の表示トグル ON だけなので、
  //   - 明示操作で開いた窓 → 出る（「表示 OFF → ON で出し直せる」も維持される）
  //   - `App.tsx` の起動時復元で開いた窓 → **出ない**（＝配信直前にアプリを起動しても配信画面を汚さない）
  // ⚠ **読むのは初期化子・倒すのは下の effect** と分けてある。初期化子で消すと StrictMode の
  // 二重レンダーで 2 回目が旗を見失い、dev だけガイドが出なくなる（実装時に踏みうる罠）。
  const [guideVisible, setGuideVisible] = useState(loadEffectOverlayGuidePending);

  /**
   * いま画面に出ているエフェクト。⚠ **`EffectRequest` だけ**（受信 DTO は 1 件も持たない）。
   *
   * ⚠ `key` は**表示 1 回ごとの通し番号**で、コメントの id ではない。テスト発火は固定 id を使うので、
   * id を React の key にすると連打で要素を取り違える（同じ key が同時に 2 つ並ぶ）。
   */
  const [effects, setEffects] = useState<
    { key: number; request: EffectRequest }[]
  >([]);

  // ⚠ 発火済み id と時間窓の状態は **ref**（再レンダーで作り直さない・WS の張り直しでも失われない）。
  const seenIdsRef = useRef<Set<string>>(new Set());
  const triggerStateRef = useRef(createEffectTriggerState());
  /** 表示 1 回ごとの通し番号（React の key 用）。 */
  const nextKeyRef = useRef(0);
  /** 表示中エフェクトの撤去タイマー。⚠ アンマウントで必ず全部止める（配信中にタイマーを残さない）。 */
  const expireTimersRef = useRef<Set<number>>(new Set());

  /**
   * 061b: エフェクトを 1 件出す。表示は `EFFECT_DISPLAY_MS` で自動的に消える。
   *
   * ⚠ **キューに溜めない**（`EFFECT_MAX_CONCURRENT` を超える分は末尾を捨てる）。`decideEffects` の
   * バースト上限と**同じ値から導出**しているので通常ここには到達しないが、テスト発火は発火層を通らない
   * （＝上限の外から入る）ので、最後の砦としてここでも切る。
   * ⚠ **エフェクトが 1 件でも出たらセットアップ用ガイドを畳む**——ガイドは「まだ何も出ていない窓の位置」を
   * 示すためのもので、実物が出た時点で役目が終わる。960×360 に破線枠と説明とカードが同居すると
   * どちらも読めない（`SETUP_GUIDE_VISIBLE_MS` による自動消灯は fail-safe としてそのまま残す）。
   */
  const showEffect = useCallback((request: EffectRequest) => {
    const key = nextKeyRef.current++;
    setGuideVisible(false);
    setEffects((prev) => [...prev, { key, request }].slice(-EFFECT_MAX_CONCURRENT));
    const timer = window.setTimeout(() => {
      expireTimersRef.current.delete(timer);
      // ⚠ **通し番号で消す**（id で消すとテスト発火の固定 id が連打で衝突し、まとめて消える）。
      setEffects((prev) => prev.filter((e) => e.key !== key));
    }, EFFECT_DISPLAY_MS);
    expireTimersRef.current.add(timer);
  }, []);

  // ⚠ 旗は**一度読んだら倒す**（次に開く窓では出ない）。同じ値の上書きなので StrictMode の
  // 二重実行でも冪等で、cleanup は要らない（旗を立て直すのは main 窓の明示操作だけ）。
  useEffect(() => {
    saveEffectOverlayGuidePending(false);
  }, []);

  // ⚠ アンマウントで撤去タイマーを全部止める（StrictMode の二重実行でも残らない）。
  useEffect(() => {
    const timers = expireTimersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, []);

  // この窓の document にだけ背景透明化の目印を立てる（main / comment-viewer 窓には波及しない）。
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-overlay", "1");
    return () => {
      root.removeAttribute("data-overlay");
    };
  }, []);

  // ⚠⚠ 061b: sidecar の loopback WS へ**読み取り専用**で接続する（`OverlayApp` と同じ構え・上のクラス JSDoc）。
  //
  // ⚠ **マウント時 1 回だけ張る**（deps 空）＝「窓内 WS 1 本」の原則。`connectCommentStream` 自身が
  //   ポート未確定・切断時の再接続（`RETRY_INTERVAL_MS`）を持つので、ここで張り直す必要は無い。
  // ⚠ sidecar 未起動なら接続待ちのまま**何も起きない**（0 件）。エラー表示も再試行の可視化も出さない
  //   ——この窓は透過・最背面・非フォーカスで、配信画面に何かを出したら OBS にそのまま映るため。
  //
  // ⚠⚠ **受け取った DTO はこの関数の中で使い切る。** `EffectRequest`（名前・金額・種別・配色キーだけ）へ
  //   落として捨てる＝**本文もアバターも state / localStorage / ログ / DB のどこにも渡らない**（§9）。
  //   ここを `setState(incoming)` の類に変えた瞬間に、その担保が崩れる。
  //
  // ⚠ **設定は発火のたびに読み直す**（state にミラーしない・`storage` にも依存しない）。この設定の持ち主は
  //   main 窓（`ObsEffectsScreen`）なので、state に写すと「main 窓で変えたのに古い値で判断する」形が作れる。
  //
  // ⚠⚠ **接続直後に過去分で一斉発火しない**ことの担保:
  //   ①sidecar は**接続時にコメントのバックログを送らない**（`index.ts` の `setConnectionHandler` が送るのは
  //     `link.state` の 2 本だけで、`comments.append` は取得パイプラインの `outputComments` からしか出ない）。
  //   ②仮に届いても `seenIdsRef` に載っている id は発火しない。この集合はコンポーネントの ref なので、
  //     `scheduleReconnect` によるソケットの張り直しを**跨いで持続する**（再接続で二重に出ない）。
  //   ⚠ **再修正トリガー＝sidecar にバックログ送信が入ったら**、id 集合では足りない
  //     （初見の id が一斉に来る）ので、明示的な抑制（接続直後の猶予など）を設計し直すこと。
  useEffect(() => {
    const handle = connectCommentStream({
      onComments: (incoming) => {
        if (!loadEffectMonetaryEnabled()) return;

        const seen = seenIdsRef.current;
        // 既知 id を除く＝[043e] の combo 再送（同一 id の更新）がここで落ちる。
        const fresh = incoming.filter((c) => !seen.has(c.id));
        if (fresh.length === 0) return;
        for (const c of fresh) seen.add(c.id);
        // 上限を超えたぶんは**古い順に**捨てる（Set は挿入順を保つ）。
        if (seen.size > SEEN_EFFECT_IDS_MAX) {
          for (const id of seen) {
            if (seen.size <= SEEN_EFFECT_IDS_MAX) break;
            seen.delete(id);
          }
        }

        // ⚠ `updated` に `[]` を渡すのは「この窓は combo 更新を一切扱わない」の明示。
        //   `decideEffects` 側にも `updated` から出さない規則があり、**二重に守っている**。
        const requests = decideEffects(
          fresh,
          [],
          triggerStateRef.current,
          Date.now(),
        );
        for (const request of requests) showEffect(request);
      },
    });
    return () => {
      handle.disconnect();
    };
    // ⚠ **マウント時 1 回だけ**張る（`showEffect` は `useCallback([])` で安定なので張り直らない）。
  }, [showEffect]);

  // 061b: **テスト発火**（main 窓の「テスト表示」ボタン → localStorage の nonce → `storage` イベント）。
  //
  // ⚠⚠ **localStorage から読むのは「変わった」という事実だけで、中身は使わない。** 出すのは
  //   このファイルの固定ダミー（`TEST_FIRE_REQUEST`）＝ **第三者のデータが localStorage を経由しない**（§9）。
  // ⚠ `storage` イベントは**他窓での書換**でのみ発火する（自窓の書換では飛ばない）＝ main 窓 → この窓の一方通行。
  // ⚠ `clear()` 時は `e.key === null` で来るが、**そのときは発火しない**（設定を消す操作でエフェクトが出るのは筋が悪い）。
  // ⚠ **「投げ銭でエフェクトを出す」設定に関係なく動く**——OBS の位置合わせという明示操作のための機能で、
  //   これを設定でゲートすると「トグルを ON にしないとセットアップできない」になる（画面の文言で明示済み）。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== EFFECT_TEST_FIRE_KEY) return;
      if (e.newValue === null) return;
      showEffect(TEST_FIRE_REQUEST);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [showEffect]);

  // セットアップ用ガイドを一定時間で畳む（上の SETUP_GUIDE_VISIBLE_MS の JSDoc が判断の根拠）。
  // ⚠ cleanup で必ず取り消す（StrictMode の二重実行でもタイマーが残らない）。
  useEffect(() => {
    const timer = window.setTimeout(
      () => setGuideVisible(false),
      SETUP_GUIDE_VISIBLE_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className={styles.root}>
      {effects.length > 0 && (
        // ⚠ 新しいものが**下**に積まれる（会話の流れと同じ向き）。⚠ 件数の上限は `showEffect` が保証する。
        <div className={styles.effectStack}>
          {effects.map(({ key, request: effect }) => (
            // ⚠ key は表示 1 回ごとの通し番号（コメントの id ではない・上の state の注記が理由）。
            <div
              key={key}
              className={`${styles.effectCard} ${OVERLAY_TONE_CLASS[effect.tone]}`}
            >
              {/* 種別ラベル（「スーパーチャット」等）。未知種別は空文字なので何も出ない。 */}
              {effect.eventLabel !== "" && (
                <span className={styles.effectLabel}>{effect.eventLabel}</span>
              )}
              {effect.amountText !== null ? (
                // 金額を持つ種別＝「〇〇さんが ¥1,000」。⚠ **名前を伸ばしても金額を見切れさせない**
                // （043c 追修正と同じ要件）ので、縮むのは名前側だけ（CSS の min-width:0 / flex:none）。
                <p className={styles.effectLine}>
                  <span className={styles.effectName}>{effect.name}</span>
                  <span className={styles.effectParticle}>さんが</span>
                  <span className={styles.effectAmount}>{effect.amountText}</span>
                </p>
              ) : (
                // 金額を持たない種別（サブスク/メンシプ/ギフト）＝`composeEventMessage` の文をそのまま。
                // ⚠ 文言を**この場で組み立てない**（本体一覧・読み上げと 2 実装に分裂させない）。
                <p className={styles.effectLine}>
                  <span className={styles.effectMessage}>
                    {effect.message ?? `${effect.name}さん`}
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {guideVisible && (
        // ⚠ 破線の枠は「ここがキャプチャ範囲」を示すためのもので、061b のエフェクトの意匠ではない。
        <div className={styles.guide}>
          <p className={styles.guideTitle}>StreamDock エフェクト</p>
          <p className={styles.guideBody}>
            この枠にエフェクトが表示されます。
            <br />
            OBS で「ソースを追加 → ウィンドウキャプチャ」を選び、
            <br />
            ウィンドウの一覧から「StreamDock エフェクト」を指定してください。
          </p>
          {/* ⚠ 061a レビュー（Q-1）: 旧文言「配信中には表示されません」は、起動時の窓復元経路があるため
              約束できない断言だった。ガイドが出る条件（＝明示操作の直後だけ）をそのまま書く。 */}
          <p className={styles.guideBody}>
            このガイドは、表示を ON にした直後だけ出て自動的に消えます。
          </p>
        </div>
      )}
    </div>
  );
}
