import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectCommentStream } from "../../features/comment-viewer/commentStream";
import {
  STREAM_EVENT_ROUND_KEY,
  loadEffectOverlayGuidePending,
  saveEffectOverlayGuidePending,
} from "../../features/comment-viewer/overlaySettings";
import { findStreamEvent } from "../../features/obs-effects/streamEventRegistry";
import {
  formatStreamEventClock,
  isSameStreamEventRound,
  loadStreamEventRound,
  parseStreamEventRound,
  streamEventRemainingMs,
  type StreamEventProgress,
  type StreamEventRound,
} from "../../features/obs-effects/streamEventRound";
import { STAGE_OVERLAY_WINDOW_TITLE } from "./effectAssignments";
import { createSeenEffectIds, takeFreshComments } from "./effectTrigger";
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
 * - **出し直せる**——次に配信イベントを開始すればもう一度出る。
 *
 * ⚠⚠ **061a レビュー（Q-1）で「時間」だけでは足りないと判明した。** 当初の論証は「窓が開くのは
 * ユーザーの明示操作のときだけ ＝ 配信開始時にはとっくに消えている」だったが、
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
 * 061l: **開催中のイベントの残り時間を進める間隔**（ミリ秒）。
 *
 * ⚠ この窓は**秒まで**出す（配信画面のカウントダウンは秒が動いていないと止まって見える）。
 * ⚠ **判断 10 の「秒を出さない」は main 窓の前提ステータスの話**で、この窓には及ばない。
 * ⚠⚠ **開催していない間はタイマーを張らない**（061a 以来「配信中にタイマーを残さない」＝判断 11）。
 */
const STREAM_EVENT_TICK_MS = 1000;

/**
 * 061l（判断 8）: **配信イベントの描画**。⚠⚠ **受け取るのは `{ count, remainingMs }` と、
 * 同梱レジストリのタイトルだけ**である。
 *
 * ⚠⚠ **第三者の本文・表示名・アバター・金額を渡さない。** 061b が `EffectRequest` に
 * `text` / `avatar` を持たせなかったのと**同じ手**で、`StreamEventProgress` の 2 キーに絞ることで
 * **渡せるものを構造的に存在させない**（§9 の線を「気をつける」ではなく型で引く）。
 * ⚠ `title` の出所は `streamEventRegistry.ts` の**静的な同梱データ**だけ（コメント由来の文字列ではない）。
 * ⚠ **`console.*` にも出さない**（`eslint.config.js` の `no-console` が `src/screens/obs-effects/**` に効いている）。
 *
 * ⚠ **玉入れ大会（次タスク）はここを置き換える**——器として通っているのは
 * 「コメント受信 → 開催中か判定 → 数を増やす → この関数へ渡す」という経路までである。
 */
function StreamEventView({
  title,
  progress,
}: {
  title: string;
  progress: StreamEventProgress;
}) {
  return (
    <div className={styles.eventCard}>
      <p className={styles.eventTitle}>{title}</p>
      <p className={styles.eventCount}>
        <span className={styles.eventCountValue}>{progress.count}</span>
        <span className={styles.eventCountUnit}>コメント</span>
      </p>
      <p className={styles.eventRemaining}>
        残り {formatStreamEventClock(progress.remainingMs)}
      </p>
    </div>
  );
}

/**
 * 061a / **064d**: 配信画面用の背景透過オーバーレイ（別ウィンドウ label `stage-overlay`）の描画本体。
 *
 * ## ⚠⚠ 064d でこの窓は「配信イベント専用」になった
 *
 * 061b〜061r の間、この窓は **取り込んだテンプレートを描く**のが主な仕事だった。
 * 064 で「エフェクトは **OBS 側のソース**を鳴らす」方式へ転換したので、
 * **テンプレートの描画経路（発火層の呼び出し・メディアキャッシュ・音・テスト表示）はすべて消えた**。
 * ⇒ 残っているのは **061l の配信イベント**（StreamDock が自分で描くもの）だけである。
 *
 * ⚠⚠ **コーナー窓（`effect-overlay`）は 064d で廃止した。** あちらはテンプレート専用で、
 * 配信イベントは 061l の時点から**ステージ窓にしか出さない**と決めていたため、
 * テンプレートが消えると**描くものが 1 つも無い窓**になる。
 * ＝ `output` prop も `EffectOutput`（小さく／大きく）の軸も**まるごと消えた**。
 *
 * ⚠ **窓が開く契機は「配信イベントを開始したとき」1 つだけ**になった（`ObsEffectsScreen` の
 * `handleStartRound`）。⚠⚠ **064d 以前は「stage 出力の条件が 1 件以上あるとき」**で、
 * その旗（`STAGE_OVERLAY_ENABLED_KEY`）の書き手は削除した `useEffectTemplates` だった。
 * ⇒ **旗の意味を「いま配信イベントでステージ窓を使っているか」へ移した**（064d の判断・下記）。
 *
 * ## sidecar への接続（061b から不変）
 *
 * `comment-overlay` 窓（`OverlayApp`）と**まったく同じ構え**で、`connectCommentStream` を
 * **1 本だけ**張り、`onComments` だけを使う（制御フレームは 1 つも送らない＝
 * **送信フレームゼロ・新規宛先ゼロ・新規プロトコルゼロ**）。
 *
 * ⚠⚠ **この窓には第三者のコメント本文が流れ込む。** 守るのは次の 3 つで、
 * **064d でむしろ強くなった**——描く材料が `{count, remainingMs}` と同梱タイトルだけになったので、
 * **本文・表示名・金額を渡せる場所が型として 1 つも無い**:
 *   - **描かない**（`StreamEventProgress` の 2 キーしか描画関数へ渡らない）
 *   - **`localStorage` に保存しない**（この窓は開催キーを**読むだけ**・1 バイトも書かない）
 *   - **ログに出さない**（`console.*` へ 1 バイトも出さない・§9。`eslint.config.js` の `no-console` が
 *     `src/screens/obs-effects/**` に効いている）
 *
 * ⚠ **sidecar のライフサイクル**（Rust 側・`lib.rs` の `SIDECAR_CONSUMER_LABELS` が正）:
 *   - **この窓は sidecar を起動しない。** 起動契機は `open_comment_viewer_window` の 1 箇所のまま。
 *   - **この窓が生きている間 sidecar は落ちない。**
 *     ⚠⚠ **帰結（061b レビュー S-1）＝この窓が開いている間は Twitch/YouTube への取得＝外部通信も続く**。
 *     ⚠⚠⚠ **064 レビュー S-4（訂正）: ユーザーへの明示は `MainScreen` のツール管理の停止
 *     フィードバック 1 か所が担う**（`isStageOverlayOpen()` を実際に見て文言を分岐する）。
 *     旧文が名指ししていた `ObsEffectsScreen` の前提案内は **064f で削除済み**である。
 *     docs/security.md §1「取得の停止条件」（064f で「導線は 1 か所」へ改訂済み）。
 *
 * 背景透過: `OverlayApp` / `PinnedOverlayApp` と同じく、この窓の document にだけ `data-overlay="1"` 属性を
 * 立て、`OverlayApp.module.css` の属性ガード付き `:global` ルールで透明化する（unmount で属性を外す）。
 * 透過窓の生成（transparent / decorations(false) / always_on_bottom / focused(false) / 既定サイズ）は
 * Rust の `open_stage_overlay_window` が担い、frontend からは窓を生成しない。
 *
 * ⚠⚠ **安定クラス `sd-overlay` は付けない。** 060d のカスタム CSS テーマの注入先は `comment-overlay` のみで、
 * 窓の区別をこのクラスの有無で表している（`PinnedOverlayApp` にも付いていない）。
 * 静的ガード `check-css-guards.mjs` の (10-d) がこの窓についても否定検査している。
 */
export function EffectOverlayApp() {
  // ⚠ 061a レビュー（Q-1）: 初期値は**ワンショット旗の有無**で決める（旧実装は無条件 true だった）。
  // ⚠⚠ **064d で旗を立てる場所が変わった**——旧: `EffectTemplateCard` の「配信画面でテスト表示」／
  //   新: `ObsEffectsScreen` の**配信イベントの開始**（＝064d 以降で唯一の明示操作の窓オープン）。
  //   - 明示操作（イベント開始）で開いた窓 → 出る
  //   - `App.tsx` の起動時復元で開いた窓 → **出ない**（＝配信直前にアプリを起動しても配信画面を汚さない）
  // ⚠ **読むのは初期化子・倒すのは下の effect** と分けてある。初期化子で消すと StrictMode の
  // 二重レンダーで 2 回目が旗を見失い、dev だけガイドが出なくなる（実装時に踏みうる罠）。
  const [guideVisible, setGuideVisible] = useState(loadEffectOverlayGuidePending);

  /**
   * 061l（判断 5）: **開催中の配信イベント**（`null`＝開催していない）。
   *
   * ⚠⚠ **マウント時に localStorage から読む**のが取りこぼさないことの担保である
   * （061i 判断 4 の「ワンショット旗」と違い、開催状態は**永続状態**なので読み直せば必ず復元できる）。
   * `storage` は「**開催中にすでにこの窓が開いている**」ときに即座に反映するためだけの経路で、
   * 届かなくても**次のマウントで回復する**。
   * ⚠⚠ **この窓は開催キーを 1 バイトも書かない・消さない**（書き手は main 窓だけ・判断 5）。
   */
  const [round, setRound] = useState<StreamEventRound | null>(() =>
    loadStreamEventRound(Date.now()),
  );
  /** 061l: 残り時間を計算するための「いま」。⚠ 下の tick が進める（`Date.now()` を描画中に呼ばない）。 */
  const [eventNowMs, setEventNowMs] = useState(() => Date.now());
  /**
   * 061l（判断 4）: **開催中に届いたコメントの件数**。⚠⚠ **数だけ**（§9）。
   *
   * ⚠⚠ **永続しない**（穴 δ の結論）。⇒ **開催中にこの窓を閉じて開き直すと 0 に戻る**／
   * **開始より後にこの窓を開くとその時点から数える**。受容した理由:
   *   - 壊れ方が「件数が 0 から数え直しになる」だけで、**開催そのものは永続なので復活する**
   *     （＝黙って壊れない。窓が消えること自体が親 046 の規律では異常事態）。
   *   - localStorage に持つと**コメントが届くたびに全窓へ `storage` を撒く**ことになり、
   *     `EFFECT_OVERLAY_GUIDE_PENDING_KEY` の JSDoc が「数秒ごとの localStorage 書込が
   *     全窓へ `storage` を撒くので割に合わない」として**既に却下した形**と同じになる。
   * ⚠ **再修正トリガー＝次タスク（玉入れ大会）で「失うと配信が成立しない状態（スコア）」を持つとき。**
   *   そのとき書込頻度の間引き（秒 1 回など）まで含めて設計し直すこと。
   */
  const [eventCount, setEventCount] = useState(0);
  /**
   * 061l: `onComments`（マウント時 1 回だけ張るハンドラ）から読むための開催状態のミラー。
   *
   * ⚠⚠ **state を直接読むと閉包が古くなる**（ハンドラは張り直さない＝WS を切らないため）。
   * ⚠⚠ **「開催中か」の判定元を state 1 つに保つ**のが要点——ここで localStorage を読み直す形にすると、
   *   **画面に出ていないのに数えている**（あるいはその逆）という食い違いが作れてしまう。
   *   ⇒ 届かなかったときの壊れ方は「**出ないし数えない**」に揃い、次のマウントで両方回復する。
   */
  const roundRef = useRef<StreamEventRound | null>(round);

  /**
   * ⚠ 一度数えた id の集合は **ref**（再レンダーで作り直さない・WS の張り直しでも失われない）。
   *
   * ⚠⚠ **064d 以降、この集合の用途は「件数の重複を防ぐこと」だけ**になった
   * （エフェクトの二重発火を防ぐ用途は、コメビュ窓の OBS レーンへ移った）。
   * 実体は `effectTrigger.ts` の [`takeFreshComments`] が持つ（064b で移設・2 通りに書かない）。
   */
  const seenIdsRef = useRef<Set<string>>(createSeenEffectIds());

  // この窓の document にだけ背景透明化の目印を立てる（main / comment-viewer 窓には波及しない）。
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-overlay", "1");
    return () => {
      root.removeAttribute("data-overlay");
    };
  }, []);

  // ⚠ ガイドのワンショット旗は**マウント時に必ず倒す**（読んだら消す＝残骸を残さない）。
  //   ⚠⚠ 正しさを担保しているのは**倒すこと**のほうで、この effect が 1 回だけ走ることではない
  //   （`saveEffectOverlayGuidePending(false)` は冪等）。
  useEffect(() => {
    saveEffectOverlayGuidePending(false);
  }, []);

  // ⚠⚠ 061b: sidecar の loopback WS へ**読み取り専用**で接続する（`OverlayApp` と同じ構え・上のクラス JSDoc）。
  //
  // ⚠ **マウント時 1 回だけ張る**（deps 空）＝「窓内 WS 1 本」の原則。`connectCommentStream` 自身が
  //   ポート未確定・切断時の再接続（`RETRY_INTERVAL_MS`）を持つので、ここで張り直す必要は無い。
  // ⚠ sidecar 未起動なら接続待ちのまま**何も起きない**（0 件）。エラー表示も再試行の可視化も出さない
  //   ——この窓は透過・最背面・非フォーカスで、配信画面に何かを出したら OBS にそのまま映るため。
  //
  // ⚠⚠ **受け取った DTO はこの関数の中で使い切る。** 使うのは **`fresh.length`（件数）だけ**で、
  //   本文もアバターも表示名も state / localStorage / ログ / DB のどこにも渡らない（§9）。
  //   ここを `setState(incoming)` の類に変えた瞬間に、その担保が崩れる。
  useEffect(() => {
    const handle = connectCommentStream({
      onComments: (incoming) => {
        // 既知 id を除く＝[043e] の combo 再送（同一 id の更新）がここで落ちる。
        // ⚠⚠ **064b で `effectTrigger.ts` の [`takeFreshComments`] へ移した**——
        //   コメビュ窓（OBS ソースのレーン）も同じ規則を要るようになったため。
        //   ⚠ **ここに書き戻さないこと**（2 通りに書くと片方だけ緩む）。
        const fresh = takeFreshComments(seenIdsRef.current, incoming);
        if (fresh.length === 0) return;

        // ⚠⚠ **061l（判断 4・8）: 配信イベントの件数はここで数える。**
        //
        //   ⚠⚠ **`incoming` ではなく `fresh` を数える。** 043e（YouTube Jewels の combo 更新）は
        //     **同一 id を金額違いで再送**するので、`incoming` で数えると
        //     **視聴者 1 人の 1 コメントが 2 件に化ける**（`seenIds` はまさにそれを落とすために在る）。
        //     ⚠ 代償＝`takeFreshComments` の上限を溢れた id が再送されると 1 回余計に数えるが、
        //     それは**同キーの JSDoc が既に受容している再発火とまったく同じ穴**である。
        //   ⚠ **開催中かどうかは `roundRef`（＝画面に出しているのと同じ state）で判定する**——
        //     ここで localStorage を読み直すと「画面に出ていないのに数えている」が作れる。
        //   ⚠ `endsAt` をここでも見るので、tick が来る前でも**期限を過ぎた瞬間から数えない**。
        const activeRound = roundRef.current;
        if (activeRound !== null && Date.now() < activeRound.endsAt) {
          setEventCount((prev) => prev + fresh.length);
        }
      },
    });
    return () => {
      handle.disconnect();
    };
    // ⚠ **マウント時 1 回だけ**張る。
    // ⚠⚠ **ここに不安定な値を足さないこと**——張り直すと WS が切れて、その間のコメントを落とす。
  }, []);

  // --- 061l: 配信イベント（判断 5・7・8・11） -------------------------------------------------

  /**
   * 開催状態を差し替える。⚠ **本当に変わったときだけ** state を進める（`isSameStreamEventRound`）。
   * ⚠⚠ これが無いと、`storage` が届くたびに**同じ内容の新しいオブジェクト**で再描画が走り、
   *   下のミラー effect（件数を 0 に戻す）が**開催中に件数を消す**。
   */
  const applyRound = useCallback((next: StreamEventRound | null) => {
    setRound((prev) => (isSameStreamEventRound(prev, next) ? prev : next));
  }, []);

  /**
   * 開催が変わったら、①ハンドラ用のミラーを更新し ②**件数を 0 に戻し** ③時計を合わせる。
   *
   * ⚠⚠ **②が「増やす側」に対する「戻す側」である**（判断 11 の対称）。これが無いと
   *   **2 回目の開催が前回の件数から始まる**（変異 ⑭-c）。
   */
  useEffect(() => {
    roundRef.current = round;
    setEventCount(0);
    setEventNowMs(Date.now());
  }, [round]);

  /**
   * 開催状態の即時反映（main 窓 → この窓の一方通行）。
   *
   * ⚠ `storage` は**他窓での書換**でのみ発火する。⚠ `clear()`（`e.key === null`）では反応しない。
   * ⚠ 「終了」は `removeItem`＝`e.newValue === null` で届き、`parseStreamEventRound` が `null` を返す。
   * ⚠⚠ **張ったら必ず外す**（判断 11・教訓 E-1）。
   * ⚠ 064d: `isStage` のガードは**窓が 1 つになったので不要**（コーナー窓が存在しない）。
   */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STREAM_EVENT_ROUND_KEY) return;
      applyRound(parseStreamEventRound(e.newValue, Date.now()));
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [applyRound]);

  /**
   * 開催中だけ回る tick。**残り時間を進め、期限が来たら表示をやめる。**
   *
   * ⚠⚠ **この窓は localStorage を触らない**（`removeItem` しない・判断 5）——
   *   掃除は main 窓の best-effort で、**正しさは `parseStreamEventRound` が持っている**。
   * ⚠ ここで表示を消すので、**main 窓が閉じていても「終了時刻を過ぎたら表示が消える」は成立する**
   *   （実機確認 5）。⚠⚠ **窓は閉じない**（親 046 の規律）。
   * ⚠ 開催していない間は張らない／⚠ アンマウントで必ず止める（判断 11）。
   */
  useEffect(() => {
    if (round === null) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now >= round.endsAt) {
        setRound(null);
        return;
      }
      setEventNowMs(now);
    }, STREAM_EVENT_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [round]);

  /**
   * いま描くイベント（`null` ＝ 何も描かない）。
   * ⚠ 未知 id は描かない（`parseStreamEventRound` が既に落としているので通常は到達しない）。
   */
  const eventView = useMemo(() => {
    if (round === null) return null;
    const event = findStreamEvent(round.eventId);
    if (event === null) return null;
    const progress: StreamEventProgress = {
      count: eventCount,
      remainingMs: streamEventRemainingMs(round, eventNowMs),
    };
    return { title: event.title, progress };
  }, [round, eventCount, eventNowMs]);

  // ⚠ イベントが出たらセットアップ用ガイドを畳む——ガイドは「まだ何も出ていない窓の位置」を
  //   示すためのもので、実物が出た時点で役目が終わる（破線枠とカードを同居させない）。
  //   ⚠ `SETUP_GUIDE_VISIBLE_MS` による自動消灯は fail-safe としてそのまま残す。
  useEffect(() => {
    if (eventView !== null) setGuideVisible(false);
  }, [eventView]);

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
      {/* ⚠ `.eventLayer` の `position: absolute; inset: 0` は
          **`scripts/check-css-guards.mjs` の (10-r) が固定している**（jsdom はレイアウトを解決しないので、
          CSS だけを壊す変更を止められるのはあちらだけ）。
          ⚠⚠ 064d: **層は 1 枚になった**（テンプレート層を廃止したので、061l 判断 7 の
          「イベント層が DOM 順で前＝下」という前後関係そのものが消えた）。 */}
      {eventView !== null && (
        <div className={styles.eventLayer}>
          <StreamEventView title={eventView.title} progress={eventView.progress} />
        </div>
      )}
      {guideVisible && (
        // ⚠ 破線の枠は「ここがキャプチャ範囲」を示すためのもので、意匠ではない。
        <div className={styles.guide}>
          {/* ⚠⚠ **窓名は定数から引く**（直書きすると Rust の実タイトルとずれる）。
              ⚠ ユーザーは OBS のウィンドウ一覧を**この文字列で探す**ので、ずれると窓が見つからない。
              しかも**ガイド本文は OBS のキャプチャに数十秒そのまま映る**ので、
              誤りが配信を見ている視聴者にも読める（061i の実機確認で実際に踏んだ）。
              Rust の `frontend_window_title_table_matches_overlay_titles` がバイト一致を固定している。 */}
          <p className={styles.guideTitle}>{STAGE_OVERLAY_WINDOW_TITLE}</p>
          <p className={styles.guideBody}>
            この枠に配信イベントが表示されます。
            <br />
            OBS で「ソースを追加 → ウィンドウキャプチャ」を選び、
            <br />
            ウィンドウの一覧から「{STAGE_OVERLAY_WINDOW_TITLE}」を指定してください。
          </p>
          {/* ⚠⚠ **この文だけは OBS のキャプチャに数十秒そのまま映る**ので、
              画面内の案内文より嘘の害が大きい（配信を見ている視聴者にも読める）。
              ⚠ 064d: 起点は「配信イベントを開始したとき」1 つだけになった。
              ⚠ 起点を変えるときは**必ずこの 1 文も直すこと**——`ObsEffectsScreen` の案内文・
              `EFFECT_OVERLAY_GUIDE_PENDING_KEY` の JSDoc とあわせて **3 か所**ある。 */}
          <p className={styles.guideBody}>
            このガイドは、配信イベントを開始した直後だけ出て、自動的に消えます。
          </p>
        </div>
      )}
    </div>
  );
}
