import { useCallback, useEffect, useRef, useState } from "react";
import { connectCommentStream } from "../../features/comment-viewer/commentStream";
import {
  EFFECT_ASSIGNMENTS_KEY,
  EFFECT_TEST_FIRE_KEY,
  loadEffectMonetaryEnabled,
  loadEffectOverlayGuidePending,
  saveEffectOverlayGuidePending,
} from "../../features/comment-viewer/overlaySettings";
import {
  listEffectTemplates,
  type EffectTemplateRecord,
} from "../../features/obs-effects/effectTemplateApi";
import { OVERLAY_TONE_CLASS } from "../comment-viewer/monetaryTone";
import {
  assignedTemplateIds,
  loadEffectAssignments,
  resolveEffectKind,
} from "./effectAssignments";
import type { SafeEffectMedia } from "./effectMedia";
import { createEffectMediaCache } from "./effectMediaCache";
import { EffectTemplateView } from "./EffectTemplateView";
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
 *
 * ⚠ **061d-2 で `kind` を外して「ベース」にした**（⑧）。どのエフェクトで出すかは
 * 発火のたびに割り当てから解決する（下のテスト発火の effect）。
 * ⚠ **中身（名前・金額・種別ラベル・tone）は 1 文字も変えていない。**
 */
const TEST_FIRE_REQUEST_BASE = {
  id: "__test-fire__",
  name: "テスト",
  amountText: "¥1,000",
  message: null,
  eventLabel: "スーパーチャット",
  tone: "t3",
} as const;

/**
 * 061d-2: いま画面に出ているテンプレート 1 件ぶんの描画材料。
 *
 * ⚠ **`record` と `media` を「出した瞬間の値」として抱える**（表示中にキャッシュから追い出されても
 * 描き続けられる）。⚠ **`media` は `SafeEffectMedia`**＝ `safeEffectMedia` を通していない値は
 * 型としてここへ入れられない（`EffectTemplateView` が受け取れないので構造的に不可能）。
 */
interface ShownTemplate {
  record: EffectTemplateRecord;
  media: SafeEffectMedia;
}

/** 画面に出ている 1 件。⚠ `template === null` ＝ **組み込み意匠で出ている**（フォールバック後も含む）。 */
interface ShownEffect {
  key: number;
  request: EffectRequest;
  template: ShownTemplate | null;
}

/**
 * 061d-2（②）: **エフェクト 1 件ぶんの表示時間**。テンプレートは `manifest.durationMs` を使う。
 *
 * ⚠ **Rust 側の範囲（500〜15000ms）をここに複製しない**——サイズや範囲の方針の持ち主は
 * `effect_template/manifest.rs` で、TS 側へ数字を写すと必ず片方が古くなる
 * （`effectMedia.ts` が長さ上限を持たないのと同じ理由）。ここで見るのは
 * **`setTimeout` を壊さないこと**だけ＝ `NaN` を渡すと**即座に発火して一瞬で消える**ので、
 * 有限の正数でなければ組み込みと同じ既定へ落とす。
 *
 * ⚠ **061d-2 レビュー Q-5: 上限側も同じ症状を持つ。** `setTimeout` の遅延は 32bit に丸められるので、
 * `2^31-1` を超える値は**オーバーフローして即座に発火する**（＝`NaN` と見分けがつかない壊れ方）。
 * ⚠ これは **Rust の範囲（500〜15000）の複製ではなく `setTimeout` の仕様に対する防御**なので、
 * 「範囲の持ち主は Rust」という規律には抵触しない（ここは相変わらず範囲を知らない）。
 */
/** `setTimeout` が 32bit に丸めずに扱える最大の遅延（これを超えると即時発火する）。 */
const MAX_TIMEOUT_MS = 2_147_483_647;
const effectDurationMs = (record: EffectTemplateRecord | undefined): number => {
  const declared = record?.durationMs;
  return typeof declared === "number" &&
    Number.isFinite(declared) &&
    declared > 0 &&
    declared <= MAX_TIMEOUT_MS
    ? declared
    : EFFECT_DISPLAY_MS;
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
 *
 * ## ⚠⚠ 061d-2 でこの窓が「第三者由来のバイト列を実際に踏む」窓になった
 *
 * `docs/security.md` の Capabilities 方針 061a 節が名指ししていた失効条件が、ここで発火する
 * （061c は「経路ができた」まで、061d-1 は「main 窓のプレビューが先に踏んだ」まで）。
 * **いま受容根拠になっているのは次の 3 つが構造的に閉じていることだけ**である:
 *   1. **`image/svg+xml` / `text/html` を許可しない**（`effectMedia.ts` の MIME 完全一致許可リスト。
 *      Rust の `AssetKind::mime()` との一致は `scripts/check-effect-template-contract.mjs` が固定）
 *   2. **`dangerouslySetInnerHTML` / `innerHTML` を使わない**（差し込み文面はテキストノード。
 *      リポジトリ全体での不在は `scripts/check-css-guards.mjs` (10-i) が固定）
 *   3. **`blob:` / `<iframe>` / 外部 URL を作らない**（`src` に入るのは Rust が組み立てた完全な data URI だけ）
 * ⚠ **この 3 つのどれかを緩めるなら、その前に security.md 061a 節を読み直すこと。**
 *
 * **061d-2 で足したもの**:
 *   - **割り当ての解決**＝`decideEffects` へ `resolveEffectKind` を resolver として渡す（発火判定は無改変）
 *   - **先読み**＝レコード一覧（軽い）とメディア（重い）を、マウント時と `storage` で温める。
 *     ⚠ **発火の瞬間に `get_effect_template_media` を呼ばない**（061c 申し送り 6・実機確認⑧）
 *   - **2 層の描画**＝テンプレートは絶対配置層、組み込みは従来の縦積み（⑥）
 *   - **per-effect の撤去タイマー**（②）と **`<audio>` 1 本**（穴 ε）
 *   - **テスト発火の割り当て反映**（⑧。⚠ 「出さない」でも組み込みで必ず出す）
 *
 * ⚠ **足さないもの**: エラー表示・再試行の可視化（この窓に何かを出せば OBS にそのまま映る）／
 *   `console.*`（§9・eslint の `no-console`）／テンプレートの取り込み・削除（main 窓の役目）。
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
  const [effects, setEffects] = useState<ShownEffect[]>([]);

  /**
   * 061d-2（穴 ε）: いま鳴らしている音。⚠⚠ **窓全体で 1 本だけ**。
   *
   * ⚠⚠ **「最後に出たテンプレートの音だけ鳴らす」を DOM の構造で担保している**——
   * `<audio>` 要素が 1 つしか存在せず、`key`（表示 1 回ごとの通し番号）が変わると
   * React が要素ごと作り直すので、**前の音は構造的に止まる**（061d-1 の「音を鳴らさないときは
   * `<audio>` を DOM に置かない」＝ミュート解除の変異を作れなくする、と同じ手）。
   * 却下した 2 案:
   *   - **3 件ぶん鳴らす** … `EFFECT_MAX_CONCURRENT` が 3 なので最大 3 本が重なる。音量を下げる手段が
   *     無い（⑦で専用スライダーを作らないと決めている）ので、**うるさい方向にしか倒れない**。
   *   - **最初の 1 本だけ**（後続を無視） … 画面で一番新しいエフェクトと音がずれる。
   * ⚠ **通し番号で消す**（撤去タイマーが「その番号がまだ現役なら」だけ null にする）。
   *   ここを「いま出ているうちで最も新しい音つき」を再計算する形にすると、
   *   **新しいエフェクトが消えた瞬間に古いエフェクトの音が生き返って鳴り直す**。
   * ⚠ **059b の通知音（Rust・実デバイス指定・配信に載せない）とは畳まない**——出力系統が別で、
   *   配信に載るのはこちらだけ。畳むには窓を跨ぐ相互排他（新しい IPC か localStorage 経路）が要る。
   */
  const [sound, setSound] = useState<{ key: number; src: string } | null>(null);

  // ⚠ 発火済み id と時間窓の状態は **ref**（再レンダーで作り直さない・WS の張り直しでも失われない）。
  const seenIdsRef = useRef<Set<string>>(new Set());
  const triggerStateRef = useRef(createEffectTriggerState());
  /** 表示 1 回ごとの通し番号（React の key 用）。 */
  const nextKeyRef = useRef(0);
  /** 表示中エフェクトの撤去タイマー。⚠ アンマウントで必ず全部止める（配信中にタイマーを残さない）。 */
  const expireTimersRef = useRef<Set<number>>(new Set());

  /**
   * 061d-2: 取り込み済みテンプレートの**レコード**（`layout` / `text` / `durationMs`）。
   *
   * ⚠ **メディアを含まないので軽い**（`list_effect_templates` の DTO にはファイル名もバイト列も無い）。
   * ⚠ **id → レコードは不変**なので、ここに載った値は古くならない（根拠と再修正トリガーは
   * `effectMediaCache.ts` の module doc が正）。
   */
  const recordsRef = useRef<Map<string, EffectTemplateRecord>>(new Map());
  /** メディア（重い）の先読みキャッシュ。⚠ 20MiB ＋ LRU（`effectMediaCache.ts`）。 */
  const cacheRef = useRef(createEffectMediaCache());
  /**
   * 発火時ミスの後始末を**1 id につき 1 回だけ**にするための記録。
   * ⚠ これが無いと、削除済みテンプレートを指す割り当てが残っているだけで
   * **投げ銭のたびに `list_effect_templates` が走る**。温め直し（`storage`）で捨てる。
   */
  const missHandledRef = useRef<Set<string>>(new Set());

  /**
   * 061b: エフェクトを 1 件出す。表示時間は **1 件ごと**（②）＝ テンプレートは `durationMs`、
   * 組み込みは `EFFECT_DISPLAY_MS`。
   *
   * ⚠⚠ **キューに溜めない**（`EFFECT_MAX_CONCURRENT` を超える分は末尾を捨てる）。
   * ⚠⚠ **061d-2 以降、画面上の同時表示数を担保しているのはこの `.slice` だけである**——
   * 061b は「バースト窓と表示時間が同じ値だから構造的に超えない」と説明していたが、
   * テンプレートの表示時間が 500〜15000ms で 1 件ずつ違うようになったので、その導出は成り立たない
   * （`effectTrigger.ts` の `BURST_WINDOW_MS` の JSDoc も実態へ書き換えてある）。**ここを外さないこと。**
   * ⚠ **エフェクトが 1 件でも出たらセットアップ用ガイドを畳む**——ガイドは「まだ何も出ていない窓の位置」を
   * 示すためのもので、実物が出た時点で役目が終わる。960×360 に破線枠と説明とカードが同居すると
   * どちらも読めない（`SETUP_GUIDE_VISIBLE_MS` による自動消灯は fail-safe としてそのまま残す）。
   */
  const showEffect = useCallback(
    (request: EffectRequest, template: ShownTemplate | null) => {
      const key = nextKeyRef.current++;
      setGuideVisible(false);
      setEffects((prev) =>
        [...prev, { key, request, template }].slice(-EFFECT_MAX_CONCURRENT),
      );
      // ⚠ 音源を持つテンプレートのときだけ差し替える（＝組み込みは前の音を止めない）。
      // ⚠ **061d-2 レビュー Q-10（受容・修正不要）**: `.slice` で画面から押し出された 1 件の音は、
      //   **そのエフェクト自身の撤去タイマーが来るまで鳴り続ける**（次に鳴るのは「音つきの新しい
      //   テンプレート」が出たときだけなので、組み込みが 3 件続くと映像だけ先に消える）。
      //   直さない理由＝ ①音と映像を独立させる方針（`handleMediaError` が音を止めないのと同じ向き）
      //   ②押し出しは「短時間に大量に届いた」ときだけで、その状況では音を途中で切るほうが
      //   ぶつ切りに聞こえる。**再修正トリガー＝実機確認 11 で「消えたエフェクトの音が残って気持ち悪い」
      //   となったとき**（そのときは `.slice` で落ちた key の音も止める）。
      const src = template?.media.sound;
      if (src !== undefined) setSound({ key, src });
      const timer = window.setTimeout(() => {
        expireTimersRef.current.delete(timer);
        // ⚠ **通し番号で消す**（id で消すとテスト発火の固定 id が連打で衝突し、まとめて消える）。
        setEffects((prev) => prev.filter((e) => e.key !== key));
        setSound((prev) => (prev?.key === key ? null : prev));
      }, effectDurationMs(template?.record));
      expireTimersRef.current.add(timer);
    },
    [],
  );

  /**
   * 061d-2: **レコード一覧だけ**を取り直す（メディアは触らない＝軽い）。
   *
   * ⚠ **失敗しても何も表示しない**（この窓に出したものは OBS にそのまま映る）。
   * 壊れ方は「その間はテンプレートではなく組み込みで出る」に留まる。
   */
  const refreshRecords = useCallback(async () => {
    try {
      const records = await listEffectTemplates();
      recordsRef.current = new Map(records.map((r) => [r.id, r]));
    } catch {
      // ⚠ 詳細（名前・パス・エラー文言）は握りつぶす（§9・`no-console`）。
    }
  }, []);

  /**
   * 061d-2（④）: **先読み**。マウント時と、割り当てが変わったとき（`storage`）に呼ぶ。
   *
   * ⚠⚠ **温めるのは「割り当てに出てくる id」だけ**（最大 6 件・通常 1〜2 件）。一覧の全テンプレートを
   * 読むと、20MiB の予算を配信に出す予定のないもので使い切る。
   * ⚠ **`storage` はキャッシュを温めるだけ**（061b と同じ位置づけ）。窓跨ぎ伝播はベストエフォートだが、
   * 届かなくても壊れ方は「そのテンプレートの初回だけ組み込みで出る」に留まる
   * ——**割り当てそのものは発火時に localStorage を直接読む**ので必ず届く。
   */
  const warmTemplates = useCallback(async () => {
    const cache = cacheRef.current;
    // ⚠ 割り当てが変わった＝ユーザーが触ったので、前回の失敗は忘れて再挑戦してよい。
    cache.clearFailures();
    missHandledRef.current.clear();
    await refreshRecords();
    const wanted = assignedTemplateIds(loadEffectAssignments()).filter((id) =>
      recordsRef.current.has(id),
    );
    // 割り当てから外れたテンプレートは LRU 任せにせず即座に捨てる。
    // ⚠ **061d-2 レビュー Q-11（受容・修正不要）**: `wanted` は「一覧に載っている id」で絞るので、
    //   061c の「読めない行は黙って落とす」に当たると**温め済みのキャッシュも捨てる**
    //   ——保存値は書き換えないのに、キャッシュは捨てるという非対称になっている。
    //   直さない理由＝ 壊れ方が「次の 1 回だけ組み込みで出る」に留まり（`handleCacheMiss` が
    //   1 回だけ取り直す）、逆に「一覧に無い id を温め続ける」ほうが 20MiB の予算を
    //   読めないテンプレートで抱え込む。**再修正トリガー＝一覧が間欠的に行を落とす事象が実機で出たとき。**
    cache.retain(wanted);
    for (const id of wanted) void cache.prime(id);
  }, [refreshRecords]);

  /**
   * 061d-2（穴 β の案 (c)）: キャッシュミスの後始末。**その回の表示には間に合わせない。**
   *
   * ⚠ 1 id につき 1 回だけ走る（削除済み id を指す割り当てが残っていても、投げ銭のたびに IPC が
   * 走らない）。⚠ レコードが無いときだけ一覧も取り直す（`storage` が届かなかった場合の保険）。
   */
  const handleCacheMiss = useCallback(
    (templateId: string) => {
      if (missHandledRef.current.has(templateId)) return;
      missHandledRef.current.add(templateId);
      void (async () => {
        if (!recordsRef.current.has(templateId)) await refreshRecords();
        await cacheRef.current.prime(templateId);
      })();
    },
    [refreshRecords],
  );

  /**
   * 061d-2: `EffectRequest` を 1 件出す。**割り当ての解決結果（`kind`）に従って層を選ぶ。**
   *
   * ⚠⚠ **テンプレートの材料が揃っていなければ組み込みで出し切る**（穴 β の案 (c)）。
   * 「無反応」にはしない——配信中に何も出ないより、素の表示でも出るほうがよい
   * （`effectMedia.ts` が引いた線と同じ）。
   */
  const fire = useCallback(
    (request: EffectRequest) => {
      if (request.kind === "template") {
        const record = recordsRef.current.get(request.templateId);
        const media = cacheRef.current.get(request.templateId);
        if (record !== undefined && media !== undefined) {
          showEffect(request, { record, media });
          return;
        }
        handleCacheMiss(request.templateId);
      }
      showEffect(request, null);
    },
    [showEffect, handleCacheMiss],
  );

  /**
   * 061d-2: メディアのデコードに失敗した 1 件を**組み込み意匠へ落とす**。
   *
   * ⚠ ガードを通った data URI でもデコードは失敗しうる（マジックバイトは通るが途中で切れた
   * WebM / APNG 等）。⚠ **main 窓のプレビューとは目的が違う**——あちらは「壊れている事実を見せる」、
   * こちらは「配信中に無反応にしない」。
   * ⚠ 音は止めない（音源は別ストリームで、`effectMedia.ts` が「音が鳴らないことは配信を壊さない／
   * エフェクトが出ないことは壊す」と線を引いている。逆向きも同じ理由で独立させる）。
   */
  const handleMediaError = useCallback((key: number, templateId: string) => {
    cacheRef.current.markFailed(templateId);
    setEffects((prev) =>
      prev.map((e) => (e.key === key ? { ...e, template: null } : e)),
    );
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
        // ⚠⚠ 061d-2: 第 5 引数が**割り当ての resolver**（①）。`resolveEffectKind` は
        //   **呼ばれるたびに localStorage を読み直す**ので、main 窓で割り当てを変えた直後の
        //   1 件目から効く（`storage` の窓跨ぎ伝播に依存しない）。
        const requests = decideEffects(
          fresh,
          [],
          triggerStateRef.current,
          Date.now(),
          resolveEffectKind,
        );
        for (const request of requests) fire(request);
      },
    });
    return () => {
      handle.disconnect();
    };
    // ⚠ **マウント時 1 回だけ**張る（`fire` は安定な `useCallback` の連鎖なので張り直らない）。
  }, [fire]);

  // 061d-2（④）: **先読み**。マウント時に 1 回だけ温める。
  // ⚠ StrictMode の二重実行でも `prime` が in-flight を畳むので IPC は 1 本で済む。
  useEffect(() => {
    void warmTemplates();
  }, [warmTemplates]);

  // 061d-2（④）: 割り当てが変わったら**キャッシュを温め直す**（main 窓 → この窓の一方通行）。
  //
  // ⚠⚠ **これは「速くするため」だけの経路である。** 届かなくても割り当て自体は発火時に
  //   localStorage から直接読むので必ず効く（壊れ方は「そのテンプレートの初回だけ組み込みで出る」）。
  // ⚠ `storage` イベントは**他窓での書換**でのみ発火する。
  // ⚠ **061d-2 レビュー Q-4: `clear()`（`e.key === null`）では温め直さない**（下のキー一致で落ちる）。
  //   ここは「速くするため」だけの経路なので、温め直しを取りこぼしても壊れ方は
  //   「そのテンプレートの初回だけ組み込みで出る」に留まる（割り当て自体は発火時に読み直す）。
  //   ＝ **`clear()` を特別扱いする価値が無い**（分岐を増やすほうが読みにくい）。
  //   ⚠ 残るのは「使われないキャッシュが次の温め直しまで載ったまま」だけで、上限は LRU が守る。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== EFFECT_ASSIGNMENTS_KEY) return;
      void warmTemplates();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [warmTemplates]);

  // 061b: **テスト発火**（main 窓の「テスト表示」ボタン → localStorage の nonce → `storage` イベント）。
  //
  // ⚠⚠ **localStorage から読むのは「変わった」という事実だけで、中身は使わない。** 出すのは
  //   このファイルの固定ダミー（`TEST_FIRE_REQUEST`）＝ **第三者のデータが localStorage を経由しない**（§9）。
  // ⚠ `storage` イベントは**他窓での書換**でのみ発火する（自窓の書換では飛ばない）＝ main 窓 → この窓の一方通行。
  // ⚠ `clear()` 時は `e.key === null` で来るが、**そのときは発火しない**（設定を消す操作でエフェクトが出るのは筋が悪い）。
  // ⚠ **「投げ銭でエフェクトを出す」設定に関係なく動く**——OBS の位置合わせという明示操作のための機能で、
  //   これを設定でゲートすると「トグルを ON にしないとセットアップできない」になる（画面の文言で明示済み）。
  //
  // ⚠⚠ **061d-2（⑧・穴 η）: テスト発火は割り当てを反映する。** スーパーチャットに割り当てた
  //   テンプレートで位置合わせできないと、テストボタンの意味が半分になるため。
  //   ⚠⚠ **ただし「エフェクトを出さない」設定でも組み込みで必ず出す**——このボタンの目的は
  //   OBS の位置合わせであって、設定の確認ではない。「出さない」にしている種別があるせいで
  //   **窓の位置が一生わからない**という状態を作らない。
  //   ⚠⚠ **この特例（`?? { kind: "builtin-monetary" }`）はここの 1 行だけに閉じている。**
  //   `effectAssignments.ts` にも `decideEffects` にも置かない（置くと本番の発火経路へ漏れ、
  //   「出さない」にしたのに出る、という設定の裏切りになる）。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== EFFECT_TEST_FIRE_KEY) return;
      if (e.newValue === null) return;
      // ⚠ **本番と同じ resolver**を `"superchat"` として引く（2 実装に分けない）。
      const kind = resolveEffectKind("superchat") ?? { kind: "builtin-monetary" };
      fire({ ...TEST_FIRE_REQUEST_BASE, ...kind });
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [fire]);

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

  // ⚠ **1 本の配列を層ごとに振り分ける**（`showEffect` の `.slice` が総数を切っているので、
  //   組み込みとテンプレートを合わせて `EFFECT_MAX_CONCURRENT` 件を超えない）。
  const builtinEffects = effects.filter((e) => e.template === null);
  const hasTemplate = effects.some((e) => e.template !== null);

  return (
    <div className={styles.root}>
      {hasTemplate && (
        // ⚠⚠ **061d-2（穴 δ / Q-6）: テンプレートは専用の絶対配置層に置く。**
        //   `EffectTemplateView` の器は `position: absolute; inset: 0` なので、
        //   **`.effectStack`（padding / gap を持つ縦積みの箱）の中へ入れるとその箱を無視して飛び出す。**
        //   `.templateLayer` は `position: absolute; inset: 0`（＝それ自身が子の包含ブロック）で、
        //   さらに `.root` に `position: relative` を明示してあるので、窓ではなく**この器**に解決される。
        //   ⚠ **ここを `.effectStack` の中へ移す変異は、`EffectOverlayApp.test.tsx` の
        //   「テンプレートは縦積みの外にある」がレッドにする。**
        //   ⚠ ⑥ のとおり**テンプレート同士の重なりは受容する**（再修正トリガー＝実機で読めないなら
        //   「テンプレートは同時 1 件まで」へ倒す）。
        <div className={styles.templateLayer}>
          {effects.map((e) =>
            e.template === null ? null : (
              <EffectTemplateView
                key={e.key}
                layout={e.template.record.layout}
                text={e.template.record.text}
                // ⚠⚠ **`SafeEffectMedia` しか渡せない**（`safeEffectMedia` を通していない値は
                //   型として書けない）。この構造を崩さないこと。
                media={e.template.media}
                // ⚠ `EffectRequest` が `EffectTemplateVars` を構造的に満たす（061d-1 の型テストが固定）。
                //   ⚠ 本文もアバターも持っていないので、**渡せるものが構造的に存在しない**（§9）。
                vars={e.request}
                onMediaError={() => {
                  if (e.request.kind === "template") {
                    handleMediaError(e.key, e.request.templateId);
                  }
                }}
              />
            ),
          )}
        </div>
      )}
      {builtinEffects.length > 0 && (
        // ⚠ 新しいものが**下**に積まれる（会話の流れと同じ向き）。⚠ 件数の上限は `showEffect` が保証する。
        <div className={styles.effectStack}>
          {builtinEffects.map(({ key, request: effect }) => (
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
      {/* ⚠⚠ 061d-2（穴 ε）: **音は窓全体で 1 本だけ**（上の `sound` state の JSDoc が判断の根拠）。
          ⚠ **要素の有無で「鳴らす／鳴らさない」を表す**（`muted` で消さない＝ 061d-1 の規律を踏襲）。
          ⚠ 出力は **OS 既定＝OBS で「デスクトップ音声」を取り込んでいれば配信に載る**（これが目的）。
          ⚠ **`onError` は付けない**（061d-1 レビュー P-3 と同じ判断）——音源のデコード失敗は
          「鳴らないだけ」で、①メディアは出ているので画面は無言にならない
          ②`effectMedia.ts` が「音が鳴らないことは配信を壊さない」と線を引いている。
          **再修正トリガー＝実機で「音ありのはずが鳴らない」報告が出たとき**（そのとき原因が
          デコード失敗か autoplay policy かを分ける必要が生じるので、その時点で足す）。
          ⚠⚠ **実機確認⑪**: この窓は `focused(false)` なので、autoplay policy が音付き再生を拒否して
          **そもそも鳴らない**可能性を疑っていた。⚠ **2026-08-12 の調査で、policy は 5 窓とも既に
          無効化済みだと分かった**——Windows / WebView2 は `lib.rs` の `SHARED_BROWSER_ARGS` が
          `--autoplay-policy=no-user-gesture-required` を渡し、**macOS / WKWebView は wry 0.55.1 の
          `autoplay`（既定 `true`）が `setMediaTypesRequiringUserActionForPlayback(None)` を呼んでいる**
          （`tauri-runtime-wry` はこの値に触っていない）。⚠ **ここを疑い直さないこと。**
          ⚠⚠ **061f（2026-08-13）で残りの宿題も片付いた**——許可 3 種のうち実機確認できていたのは
          `wav` だけだったが、**`mp3` は鳴り、`ogg` は macOS の WebKit がコンテナごとデコードできない**
          ことが分かった（Safari で `error`／Chromium では同じファイルが鳴る＝ファイル不備ではない）。
          ⇒ **`audio/ogg` は取り込み時点で断る側へ落とした**（`effectMedia.ts` と Rust の `AssetKind`）。
          ＝ **いまこの `<audio>` に届く音源は `wav` / `mp3` だけ**で、どちらも macOS で鳴る。
          ⇒ それでも鳴らない報告が出たら、疑うのは **出力デバイス／data URI の長さ**である。
          jsdom は再生を実装しないので**テストでは検出できない**。fail する向きとしては安全。 */}
      {sound !== null && (
        <audio
          key={sound.key}
          src={sound.src}
          autoPlay
          data-testid="effect-sound"
        />
      )}
    </div>
  );
}
