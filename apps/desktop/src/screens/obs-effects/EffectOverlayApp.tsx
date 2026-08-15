import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectCommentStream } from "../../features/comment-viewer/commentStream";
import {
  EFFECT_ASSIGNMENTS_KEY,
  EFFECT_TEST_FIRE_KEY,
  STREAM_EVENT_ROUND_KEY,
  loadEffectOverlayGuidePending,
  saveEffectOverlayGuidePending,
  takeEffectTestFirePending,
  takeStageTestFirePending,
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
import {
  listEffectTemplates,
  type EffectTemplateRecord,
} from "../../features/obs-effects/effectTemplateApi";
import {
  assignedTemplateIds,
  createEffectMatcher,
  EFFECT_OUTPUT_WINDOW_TITLE,
  isEffectTemplateId,
  loadEffectConditions,
  type EffectOutput,
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
 * 061b: **テスト表示で出す固定ダミー**（main 窓のテンプレート行の「配信画面でテスト表示」用）。
 *
 * ⚠⚠ **中身をここに置くのが要点。** main 窓が localStorage へ書くのは
 * **nonce と テンプレート id だけ**で、エフェクトの内容（名前・金額・種別ラベル）は 1 バイトも載らない
 * （＝**第三者のデータが localStorage を経由しない**・§9。061h の判断は
 * `EFFECT_TEST_FIRE_KEY` の JSDoc が正）。
 * ⚠ `tone` は `t3`（¥1,000〜の黄）＝実際のスパチャで最も見る帯に合わせてある。
 *
 * ⚠ **061d-2 で `kind` を外して「ベース」にした**（⑧）。
 * ⚠⚠ **061h で「どれを出すか」の決め方が変わった**——061d-2 は
 * `resolveEffectKind("superchat") ?? { kind: "builtin-monetary" }` と**割り当てから解決**していたが、
 * いまは **wire で受け取った `templateId` をそのまま使う**（＝押した行のテンプレートが出る）。
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

/**
 * 画面に出ている 1 件。
 *
 * ⚠⚠ **061h で `template` が非 null になった。** 061d-2 は `ShownTemplate | null` で、
 * `null` ＝「組み込み意匠で出ている（フォールバック後も含む）」を表していたが、
 * 組み込みを廃止したので**テンプレートを伴わない表示中エフェクトは存在しない**。
 * ＝ **`showEffect(request, null)`（＝材料が無くても出し切る）を型として書けなくした**のが要点で、
 * これは「割り当てを引かずにエフェクトが出る経路を型で消す」という 061h の目的の一部である。
 * ⚠ **ここを `| null` に戻さないこと**（戻した瞬間に「何も描かない要素が枠を 1 つ食う」形が作れる）。
 */
interface ShownEffect {
  key: number;
  request: EffectRequest;
  template: ShownTemplate;
}

/**
 * 061d-2（②）: **エフェクト 1 件ぶんの表示時間**。テンプレートは `manifest.durationMs` を使う。
 *
 * ⚠ **Rust 側の範囲（500〜15000ms）をここに複製しない**——サイズや範囲の方針の持ち主は
 * `effect_template/manifest.rs` で、TS 側へ数字を写すと必ず片方が古くなる
 * （`effectMedia.ts` が長さ上限を持たないのと同じ理由）。ここで見るのは
 * **`setTimeout` を壊さないこと**だけ＝ `NaN` を渡すと**即座に発火して一瞬で消える**ので、
 * 有限の正数でなければ `EFFECT_DISPLAY_MS` へ落とす
 * （⚠ 061h で組み込みが消えたので、この既定は**壊れた `durationMs` の受け皿専用**になった）。
 *
 * ⚠ **061d-2 レビュー Q-5: 上限側も同じ症状を持つ。** `setTimeout` の遅延は 32bit に丸められるので、
 * `2^31-1` を超える値は**オーバーフローして即座に発火する**（＝`NaN` と見分けがつかない壊れ方）。
 * ⚠ これは **Rust の範囲（500〜15000）の複製ではなく `setTimeout` の仕様に対する防御**なので、
 * 「範囲の持ち主は Rust」という規律には抵触しない（ここは相変わらず範囲を知らない）。
 */
/** `setTimeout` が 32bit に丸めずに扱える最大の遅延（これを超えると即時発火する）。 */
const MAX_TIMEOUT_MS = 2_147_483_647;
const effectDurationMs = (record: EffectTemplateRecord): number => {
  const declared = record.durationMs;
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
 *   - **割り当ての解決**＝`decideEffects` へ resolver を渡す（発火判定は無改変）。
 *     ⚠ **061j でこれは `resolveEffectMatch`（条件の matcher）になり、課金判定も向こう側へ移った**
 *   - **先読み**＝レコード一覧（軽い）とメディア（重い）を、マウント時と `storage` で温める。
 *     ⚠ **発火の瞬間に `get_effect_template_media` を呼ばない**（061c 申し送り 6・実機確認⑧）
 *   - **2 層の描画**＝テンプレートは絶対配置層、組み込みは従来の縦積み（⑥）
 *   - **per-effect の撤去タイマー**（②）と **`<audio>` 1 本**（穴 ε）
 *   - **テスト発火の割り当て反映**（⑧）
 *
 * ## ⚠⚠ 061h でこの窓から「組み込み意匠」が消えた
 *
 * この窓が描くのは**取り込んだテンプレートだけ**になった。反転した 3 つの判断:
 *   1. **`onComments` 先頭の `if (!loadEffectMonetaryEnabled()) return;` を削除**——
 *      発火するかどうかの関門を **resolver 1 つに一本化**する（⚠ 061j 以降の名前は
 *      `resolveEffectMatch`。二重の関門を残さない。
 *      061b は「表示・投げ銭・割り当て」で ON/OFF の軸が 3 つに割れており、
 *      どれか 1 つ忘れると**黙って何も出ない**のが実機で破綻していた最大の原因だった）。
 *   2. **`fire()` のフォールバック除去**（穴 β 案 (c) の反転）——材料が揃わなければ
 *      **その 1 件は出さない**（温め直しだけ走らせる）。⚠ 出ないことは main 窓の警告で見える。
 *   3. **`handleMediaError` は組み込みへ落とさず、その 1 件を撤去する**。
 *      ⚠ **音は止めない**（061d-2 の「音と映像は独立」を据え置く。撤去タイマーが来れば自然に止まる）。
 * さらに **テスト表示が「押した行のテンプレートを出す」**へ変わり、
 * `?? { kind: "builtin-monetary" }` という特例（穴 η）は**特例ごと消えた**。
 *
 * ⚠ **足さないもの**: エラー表示・再試行の可視化（この窓に何かを出せば OBS にそのまま映る）／
 *   `console.*`（§9・eslint の `no-console`）／テンプレートの取り込み・削除（main 窓の役目）。
 *
 * ## ⚠⚠ 061l でこの窓に「配信イベント」の層が増えた（ステージ窓のときだけ）
 *
 * - **層は 2 枚**になった。⚠ **イベント層が DOM 順で前＝下**、エフェクト層が後＝上（判断 7）。
 * - **開催状態は localStorage の 1 キー**を**マウント時に読む ＋ `storage` で更新**（判断 5）。
 *   ⚠⚠ **この窓は書かない・消さない**（書き手は main 窓だけ）。
 * - **件数は `onComments` の中で `fresh.length` を足すだけ**で、
 *   ⚠⚠ **`decideEffects` を 1 度も通さない**（通すとイベントがエフェクトのバースト枠と
 *   クールダウンを食う＝061j 追加穴 η と同型で 4 例目になる）。
 * - ⚠⚠ **イベントの描画へ渡すのは `{ count, remainingMs }` と同梱レジストリのタイトルだけ**
 *   （`StreamEventProgress`＝§9 の線を型で引く。061b が `EffectRequest` でやったのと同じ手）。
 * - ⚠ **コーナー窓では何もしない**（読まない・張らない・描かない）。
 */
/**
 * 061k: この窓が担当する**出力先**（判断 9）。
 *
 * ⚠⚠ **省略可にしない。** 既定値を持たせると、渡し忘れが
 * 「黙って片方の窓にだけ出る／両方が同じ条件を拾う」へ倒れる（061i / 061h の規律＝
 * `useEffectTemplates` の `openEffectOverlay` や `EffectTemplateCard` の `effectWindowOpen` と同じ理由）。
 * ⚠ 束縛するのは `App.tsx` のルーティング 1 か所だけ（窓ラベル → `output`）。
 */
export interface EffectOverlayAppProps {
  output: EffectOutput;
}

export function EffectOverlayApp({ output }: EffectOverlayAppProps) {
  /**
   * 061k: **この窓の出力先で束縛した matcher**（判断 5）。
   * ⚠ `useMemo` は「毎レンダーで `connectCommentStream` を張り直さない」ためだけのもので、
   * **返す関数は呼ばれるたびに localStorage を読む**（＝読み直しの規律は 061j から不変）。
   */
  const matchEffect = useMemo(() => createEffectMatcher(output), [output]);
  /**
   * 061k: **この窓の保留旗を読む関数**（判断 8）。
   * ⚠⚠ **相手の旗を触らない**ことが要件なので、窓ごとに 1 本だけ束縛する。
   */
  const takePending = useMemo(
    () =>
      output === "stage" ? takeStageTestFirePending : takeEffectTestFirePending,
    [output],
  );
  /**
   * 061k（判断 2・9）: **セットアップ用ガイドに出す窓名**。
   * ⚠⚠ **窓名を直書きしないこと**——ユーザーは OBS のウィンドウ一覧を**この文字列で探す**ので、
   * ずれると窓が見つからない。しかも**ガイド本文は OBS のキャプチャに数十秒そのまま映る**ので、
   * 誤りが配信を見ている視聴者にも読める（061i の実機確認で実際に踏んだ）。
   * ⇒ 出所は `effectAssignments.ts` の `EFFECT_OUTPUT_WINDOW_TITLE` 1 か所で、
   * Rust の `frontend_window_title_table_matches_overlay_titles` が実タイトルとのバイト一致を固定している。
   */
  const windowTitle = EFFECT_OUTPUT_WINDOW_TITLE[output];
  /**
   * 061l（判断 7）: **配信イベントを描くのはステージ窓だけ**。
   *
   * ⚠⚠ コーナー窓では**開催状態を読みもしないし、リスナーもタイマーも張らない**
   * （＝「描かないが数えてはいる」という中途半端な状態を作らない）。
   * 061k がステージ窓を「全画面演出用」として分けた軸そのものである。
   */
  const isStage = output === "stage";
  // ⚠ 061a レビュー（Q-1）: 初期値は**ワンショット旗の有無**で決める（旧実装は無条件 true だった）。
  // 旗を立てるのは**明示操作 1 つだけ**（⚠ 061i で起点が「表示トグル ON」から
  // 「テスト表示で停止中の窓を開いたとき」＝`EffectTemplateCard` へ移った・判断 3）なので、
  //   - 明示操作で開いた窓 → 出る（「もう一度出したい」は窓を閉じてテスト表示を押せばよい）
  //   - ⚠ **条件を編集して自動で開いた窓 → 出ない**（061i で増えた経路。編集のたびに映るのを避ける）
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

  /**
   * 061l（判断 5）: **開催中の配信イベント**（`null`＝開催していない）。
   *
   * ⚠⚠ **マウント時に localStorage から読む**のが取りこぼさないことの担保である
   * （061i 判断 4 の「ワンショット旗」と違い、開催状態は**永続状態**なので読み直せば必ず復元できる）。
   * `storage` は「**開催中にすでにこの窓が開いている**」ときに即座に反映するためだけの経路で、
   * 届かなくても**次のマウントで回復する**（061d-2 の「`storage` は速くするためだけ」と同じ位置づけ）。
   * ⚠⚠ **この窓は開催キーを 1 バイトも書かない・消さない**（書き手は main 窓だけ・判断 5）。
   */
  const [round, setRound] = useState<StreamEventRound | null>(() =>
    isStage ? loadStreamEventRound(Date.now()) : null,
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
   * 061b: エフェクトを 1 件出す。表示時間は **1 件ごと**（②）＝ `durationMs`
   * （壊れた値のときだけ `EFFECT_DISPLAY_MS` へ落とす）。
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
    (request: EffectRequest, template: ShownTemplate) => {
      const key = nextKeyRef.current++;
      setGuideVisible(false);
      setEffects((prev) =>
        [...prev, { key, request, template }].slice(-EFFECT_MAX_CONCURRENT),
      );
      // ⚠ 音源を持つテンプレートのときだけ差し替える（＝音の無いテンプレートは前の音を止めない）。
      // ⚠ **061d-2 レビュー Q-10（受容・修正不要）**: `.slice` で画面から押し出された 1 件の音は、
      //   **そのエフェクト自身の撤去タイマーが来るまで鳴り続ける**（次に鳴るのは「音つきの新しい
      //   テンプレート」が出たときだけなので、音の無いテンプレートが 3 件続くと映像だけ先に消える）。
      //   直さない理由＝ ①音と映像を独立させる方針（`handleMediaError` が音を止めないのと同じ向き）
      //   ②押し出しは「短時間に大量に届いた」ときだけで、その状況では音を途中で切るほうが
      //   ぶつ切りに聞こえる。**再修正トリガー＝実機確認 11 で「消えたエフェクトの音が残って気持ち悪い」
      //   となったとき**（そのときは `.slice` で落ちた key の音も止める）。
      const src = template.media.sound;
      if (src !== undefined) setSound({ key, src });
      const timer = window.setTimeout(() => {
        expireTimersRef.current.delete(timer);
        // ⚠ **通し番号で消す**（id で消すとテスト表示の固定 id が連打で衝突し、まとめて消える）。
        setEffects((prev) => prev.filter((e) => e.key !== key));
        setSound((prev) => (prev?.key === key ? null : prev));
      }, effectDurationMs(template.record));
      expireTimersRef.current.add(timer);
    },
    [],
  );

  /**
   * 061d-2: **レコード一覧だけ**を取り直す（メディアは触らない＝軽い）。
   *
   * ⚠ **失敗しても何も表示しない**（この窓に出したものは OBS にそのまま映る）。
   * ⚠ 061h 以降、壊れ方は「**その間はエフェクトが出ない**」である
   * （061d-2 の「テンプレートではなく組み込みで出る」ではない）。
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
   * ⚠⚠ **温めるのは「条件に出てくる id」だけ**（⚠ **061j で上限が 6 件 → 26 件**＝イベント条件 6 ＋
   * キーワード条件 20。通常は 1〜2 件）。一覧の全テンプレートを
   * 読むと、20MiB の予算を配信に出す予定のないもので使い切る。
   * ⚠ **上限を守っているのは `effectMediaCache` の 20MiB ＋ LRU** なので、件数が増えても形は変えていない。
   * ⚠ **`storage` はキャッシュを温めるだけ**（061b と同じ位置づけ）。窓跨ぎ伝播はベストエフォートだが、
   * 届かなくても壊れ方は「そのテンプレートの**初回だけ出ない**」に留まる（061h で反転。
   * 061d-2 は「初回だけ組み込みで出る」だった）——**割り当てそのものは発火時に
   * localStorage を直接読む**ので必ず届く。
   */
  const warmTemplates = useCallback(async () => {
    const cache = cacheRef.current;
    // ⚠ 割り当てが変わった＝ユーザーが触ったので、前回の失敗は忘れて再挑戦してよい。
    cache.clearFailures();
    missHandledRef.current.clear();
    await refreshRecords();
    // ⚠⚠ **061k（判断 9）: 温めるのは「この窓の出力先の条件」が指す id だけ。**
    //   ⚠ ここから `output` を落とすと、**2 窓それぞれが全 26 件を抱える**＝
    //   20MiB の先読み予算を**もう一方の窓のぶん**で使い切る（＝自分の窓のテンプレートが
    //   LRU で押し出されて「初回だけ出ない」が増える）。
    const wanted = assignedTemplateIds(loadEffectConditions(), output).filter((id) =>
      recordsRef.current.has(id),
    );
    // 条件から外れたテンプレートは LRU 任せにせず即座に捨てる。
    // ⚠ **061d-2 レビュー Q-11（受容・修正不要）**: `wanted` は「一覧に載っている id」で絞るので、
    //   061c の「読めない行は黙って落とす」に当たると**温め済みのキャッシュも捨てる**
    //   ——保存値は書き換えないのに、キャッシュは捨てるという非対称になっている。
    //   直さない理由＝ 壊れ方が「次の 1 回だけ出ない」に留まり（`handleCacheMiss` が
    //   1 回だけ取り直す）、逆に「一覧に無い id を温め続ける」ほうが 20MiB の予算を
    //   読めないテンプレートで抱え込む。**再修正トリガー＝一覧が間欠的に行を落とす事象が実機で出たとき。**
    cache.retain(wanted);
    for (const id of wanted) void cache.prime(id);
  }, [refreshRecords, output]);

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
   * 061d-2: `EffectRequest` を 1 件出す。**材料（レコード＋メディア）が揃っているときだけ出す。**
   *
   * ⚠⚠ **061h: 穴 β の案 (c)（＝材料が無ければ組み込みで出し切る）を反転した。**
   * 061d-2 は「配信中に何も出ないより、素の表示でも出るほうがよい」として
   * `showEffect(request, null)` で必ず出していた（`effectMedia.ts` が引いた線と同じ向き）。
   * ⚠ **いまは「その 1 件は出さない」**。理由は 2 つ:
   *   1. 組み込み意匠そのものを廃止したので、**出すとしたら何を出すのかが存在しない**。
   *   2. 運用が「使いたいものを取り込んで割り当てる」に固まった以上、
   *      **頼んでいない演出が出るほうが、出ないことより害が大きい**。
   *
   * ⚠⚠ **反転の理由は上の 2 点であって「出ないことが観測できるから」ではない**
   * （061h レビューでの是正・2026-08-14）。main 窓の `EffectAssignmentCard` は
   * 「割り当てていたエフェクトが見つかりません。いまは何も表示されません。」を出す（(5)）が、
   * ⚠⚠ **あの警告の条件は `notInList`＝「main 窓の一覧にその id が無い」だけ**なので、
   * **無音になる 5 経路のうち 1 つしかカバーしていない**:
   *   - (a) 割り当て先が削除済み／一覧に無い … ✅ 警告が出る
   *   - (b) 一覧には在るが `safeEffectMedia` に弾かれる … ❌ 警告なし・`failed` に載る
   *   - (c) `get_effect_template_media` が一時的に失敗 … ❌ 警告なし・`failed` に載る
   *   - (d) 描画時のデコード失敗（[`handleMediaError`]） … ❌ 警告なし・`markFailed`
   *   - (e) 先読み前の初回発火 … ❌ 警告なし。⚠ ただし**2 件目から出る**（自己回復する）
   * ⚠⚠ **(b)(c)(d) は依然として「出ない」ことが main 窓の警告に出ない**——061d-2 は同じ失敗が
   * 「組み込みが出る」に倒れており、少なくとも配信画面上で異常が見えていた。
   * **その可視化は 061h で失われ、警告としての代替は (a) にしか用意していない**（受容。判断の全文は
   * docs/progress.md の 061h 節「⚠ 固定できていないもの」）。
   *
   * ⚠⚠ **061i（判断 5）で「安い方だけ」手当てした**（061h レビュー Q-1 への回答）:
   *   1. **[`fireTest`] の入口で `failed` / `missHandledRef` を解除する**＝ (b)(c)(d) が
   *      `warmTemplates`（割り当ての変更か窓のマウント）まで**固着しなくなった**
   *      ——壊れたテンプレートを取り込み直して**テスト表示を押せば、その場で復活する**。
   *   2. **テスト表示が窓を開けるようになった**（窓が停止中でも押せる）＝
   *      **「壊れていればその場で出ないと分かる」**という観測手段そのものになった。
   *      main 窓の `EffectAssignmentCard` は「割り当てる前にテスト表示で確かめられる」と常時案内する。
   * ⚠ **採らなかったのは 2 つ**（061i の性格＝画面構成の作り直しから外れ、CLAUDE.md の
   * 「1 回の作業で複数機能をまとめない」に触れるため）: **main 窓で割り当て済みテンプレートの
   * メディアを自動検証して警告に載せる案**（割り当て済み全件の data URI を自動で取りに行く＝
   * **新規 IPC とメモリ負荷**）と、**この窓 → main 窓へ「壊れた」を返す逆向きの wire**
   * （061a/061e が慎重に避けてきた線）。
   * ⇒ ⚠ **残る穴＝「割り当て済みのテンプレートが**あとから**壊れた場合、テスト表示を押すまで気づけない」**。
   * **再修正トリガー＝実機で「割り当てたのに出ない」が実際に起きたとき**（そのとき上の 2 案を検討する）。
   * ⚠ **`handleCacheMiss` は残す**（＝次回に備えて温める）。ここを一緒に消すと
   * 「一度冷えたら二度と出ない」になる。
   * ⚠ **ここで `await` しない**（＝発火の瞬間に IPC を呼ばない・061c 申し送り 6／実機確認⑧）。
   */
  const fire = useCallback(
    (request: EffectRequest) => {
      const record = recordsRef.current.get(request.templateId);
      const media = cacheRef.current.get(request.templateId);
      if (record === undefined || media === undefined) {
        handleCacheMiss(request.templateId);
        return;
      }
      showEffect(request, { record, media });
    },
    [showEffect, handleCacheMiss],
  );

  /**
   * 061d-2 / 061h: メディアのデコードに失敗した 1 件を**画面から撤去する**。
   *
   * ⚠ ガードを通った data URI でもデコードは失敗しうる（マジックバイトは通るが途中で切れた
   * WebM / APNG 等）。
   * ⚠⚠ **061h で落とし先が変わった**——061d-2 は `{ ...e, template: null }` で組み込み意匠へ
   * 落としていた（「配信中に無反応にしない」）が、その受け皿が無くなったので**その 1 件を消す**。
   * ⚠ **main 窓のプレビューとは目的が違う**（あちらは「壊れている事実を見せる」ためにエラー文言を出す。
   * この窓に何かを出せば OBS にそのまま映るので、ここでは黙って消す）。
   * ⚠ **音は止めない**（061d-2 の判断を据え置く。音源は別ストリームで、`effectMedia.ts` が
   * 「音が鳴らないことは配信を壊さない／エフェクトが出ないことは壊す」と線を引いており、
   * 逆向きも同じ理由で独立させる。⚠ `showEffect` が仕掛けた撤去タイマーは残っているので、
   * 表示時間が来れば音は自然に止まる＝鳴りっぱなしにはならない）。
   */
  const handleMediaError = useCallback((key: number, templateId: string) => {
    cacheRef.current.markFailed(templateId);
    setEffects((prev) => prev.filter((e) => e.key !== key));
  }, []);

  /**
   * 061h: **テスト表示**（main 窓のテンプレート行のボタン → localStorage → `storage`）。
   *
   * ⚠⚠ **`fire()` と分けてあるのが要点。** 本番の発火経路は
   * 「発火の瞬間に `get_effect_template_media` を呼ばない」（061c 申し送り 6・実機確認⑧の
   * カクつき対策）を守るため**冷えていたら諦める**が、こちらは**明示操作 1 回**なので
   * **待ってでも出す**。⚠ そうしないと「取り込んだばかりのテンプレートは、
   * 1 回目のテスト表示では何も出ず 2 回目から出る」になる——`warmTemplates` が温めるのは
   * **割り当てに出てくる id だけ**（20MiB の予算をそこへ使う設計）で、
   * **位置合わせは割り当てより前にやりたい**のが普通だから。
   * ⚠ 温まっていれば**同期で出す**（`storage` ハンドラから同期で呼ばれる形を保つ）。
   * ⚠ 失敗（レコードが無い／メディアが読めない）は**黙って何も出さない**（§9・`no-console`）。
   *
   * ## ⚠⚠ 061i（判断 5）: **入口で「失敗の固着」を解除する**
   *
   * `fire()` の JSDoc が列挙している無音の 5 経路のうち **(b)(c)(d) は `failed` / `missHandledRef` に
   * 載ったまま `warmTemplates`（＝割り当ての変更か窓のマウント）まで固着する**。
   * ＝ **壊れたテンプレートを取り込み直しても、アプリを再起動するまで復活しない**。
   * ⚠ ここで 2 行解除するだけで「**一度失敗したものを明示操作で再試行できる**」になる
   * （ユーザーが自力で試せる唯一の復帰手段。061h レビュー Q-1 への回答の片方）。
   * ⚠⚠ **解除は `storage` 経由・保留旗経由の両方に効かせる必要がある**ので、
   * **両方が必ず通るこの関数の入口**に置いてある（呼び出し側 2 か所に書かない）。
   * ⚠ **061h の「全 id を消す `clearFailures()`」から「その id だけ」へ狭めた**——
   * あちらの JSDoc が「再修正トリガー＝ id 単位の解除が要る場面が出たとき（`markFailed` の対称形として
   * `effectMediaCache.ts` に足し、ここだけ寄せる）」と書いており、061i がその場面である。
   * 押していない id の失敗まで巻き添えで消す理由は、解除がここへ来た時点で無くなった。
   */
  const fireTest = useCallback(
    (templateId: string) => {
      // ⚠ **発火の前**に解除する（`prime` は失敗記録が残っていると再挑戦しないので、順序が逆だと効かない）。
      cacheRef.current.clearFailed(templateId);
      // ⚠ `handleCacheMiss` の「1 id につき 1 回だけ」も解除する（＝本番の発火経路も温め直せる）。
      missHandledRef.current.delete(templateId);
      const request: EffectRequest = {
        ...TEST_FIRE_REQUEST_BASE,
        kind: "template",
        templateId,
      };
      const record = recordsRef.current.get(templateId);
      const media = cacheRef.current.get(templateId);
      if (record !== undefined && media !== undefined) {
        showEffect(request, { record, media });
        return;
      }
      void (async () => {
        // ⚠ **`refreshRecords` は in-flight を畳んでいない**（`prime` は id 単位で畳む）＝
        //   連打すると押した回数だけ `list_effect_templates` が走る。
        //   ⚠ **意図して畳んでいない**: ①明示操作なので上限がユーザーの指の速さで、本番経路が
        //   `missHandledRef` で絞っている「投げ銭のたびに走る」問題とは性質が違う
        //   ②戻り値は毎回**完全な一覧**なので、どちらが後勝ちしても `recordsRef` の中身は同じ
        //   （競合しても壊れない）③重いのはメディア側で、そちらは `prime` が畳む。
        //   **再修正トリガー＝一覧の取得が重くなったとき**（＝ DTO にメディアやサムネイルが載ったとき）。
        if (!recordsRef.current.has(templateId)) await refreshRecords();
        const found = recordsRef.current.get(templateId);
        if (found === undefined) return;
        // ⚠ 失敗記録の解除は**この関数の入口**で済ませてある（061i・上の JSDoc）。
        //   ⚠ **ここへ戻さないこと**——`storage` 経由でキャッシュに載っている（＝この非同期経路へ
        //   来ない）ケースで `missHandledRef` が解除されず、本番経路が固着したままになる。
        await cacheRef.current.prime(templateId);
        const primed = cacheRef.current.get(templateId);
        if (primed === undefined) return;
        // ⚠ アンマウント後にここへ来ると、`showEffect` が仕掛ける撤去タイマーは
        //   下のクリーンアップ（`expireTimersRef` の全消し）を**もう通らない**。
        //   ⚠ **実アプリでは無害**（この窓は閉じると webview ごと破棄される）ので `mountedRef` を
        //   足していない。**再修正トリガー＝テスト間でタイマーが漏れる事象が出たとき**。
        showEffect(request, { record: found, media: primed });
      })();
    },
    [refreshRecords, showEffect],
  );

  // ⚠ 旗は**一度読んだら倒す**（次に開く窓では出ない）。同じ値の上書きなので StrictMode の
  // 二重実行でも冪等で、cleanup は要らない（旗を立て直すのは main 窓の明示操作だけ）。
  //
  // ⚠⚠ **061i（判断 4）: 保留中のテスト表示もここで受け取る**（＝**旗を読む処理を 2 か所に散らさない**）。
  //   main 窓は「窓が停止中のときのテスト表示」を `storage` ではなく**旗**で渡してくる——
  //   `open_effect_overlay_window` の解決は**窓生成の完了**であって、
  //   **この窓の React が `storage` リスナーを登録し終えたこと**ではないので、
  //   `storage` で渡すと**登録前に飛んだ分が消えて「押しても何も出ない」**が確率的に起きる。
  //   ⚠ **読んだら消える**（`takeEffectTestFirePending`）ので、窓を開き直しても再発火しない。
  //   ⚠⚠ **値は使う前に形を検証する**（`isEffectTemplateId`）——localStorage は**他窓から書ける**ので
  //   ここは多層防御の 1 枚目である。⚠ **検証の実効は「その値を持って IPC を起こさない」こと**で、
  //   「何も出ない」だけでは観測できない（061h の変異⑤が最初に生存した理由そのもの）。
  //   ⚠ 検証は `effectAssignments.ts` の `isEffectTemplateId` を借りる＝**正規表現の持ち主を増やさない**。
  //
  // ⚠⚠ **ガイドとの関係（判断 3 と `showEffect` の規律が同時に効く）**: main 窓は停止中のテスト表示で
  //   **ガイド旗と保留旗の両方**を立てるので、この窓は「ガイドを出しつつ 1 件出す」状態で始まる。
  //   ⚠ `showEffect` が**エフェクトが出た瞬間にガイドを畳む**ので、実際の見え方は
  //   「ガイド → （材料が揃い次第）エフェクト」になる。**これが意図した順序である**——
  //   ①材料が冷えていれば `fireTest` が IPC を待つ間ガイドが窓の位置を示す
  //   ②**テンプレートが壊れていて何も出ないときはガイドが残る**（＝窓は在るのに何も出ない、が見える）
  //   ③出たあとは実物のほうが位置合わせの材料として優れている（破線枠と同居させない）。
  //
  // ⚠⚠ **061k（判断 8）: 保留旗は窓ごとに 2 本あり、各窓は「自分の旗」だけを take する。**
  //   テスト表示は**2 つの窓の両方へ出す**（位置合わせの対象が 2 ソースあるため）ので、
  //   main 窓は停止中の窓ぶんだけ旗を立てる。⚠⚠ **相手の旗を消さないこと**——消すと
  //   「先にマウントした窓が両方の旗を食い、もう片方が無反応」になり、判断 8 が半分だけ効く。
  useEffect(() => {
    saveEffectOverlayGuidePending(false);
    // ⚠ **自分の出力先の旗だけ**（`takePending` は下の `useMemo` で束縛済み）。
    const pending = takePending();
    if (pending !== null && isEffectTemplateId(pending)) fireTest(pending);
    // ⚠ `fireTest` は安定な `useCallback` の連鎖（`refreshRecords` / `showEffect` とも deps 空）なので、
    //   この effect はマウント時 1 回だけ走る。
    // ⚠⚠ **061i レビュー Q-6: ただし「1 回だけ」に正しさを預けていない。** 仮に将来
    //   `fireTest` の依存が不安定になってこの effect が再実行されても、**旗は既に消えている**ので
    //   二重発火しない（`saveEffectOverlayGuidePending(false)` も冪等）＝
    //   **正しさを担保しているのは `take*`（読んだら消す）のほうで、安定性は性能の話**である。
    //   ⚠ だから `take*` を `load*` へ変えると、この effect の安全性ごと崩れる。
  }, [fireTest, takePending]);

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
        // ⚠⚠ **061h: ここにあった `if (!loadEffectMonetaryEnabled()) return;` を削除した。**
        //   発火するかどうかの関門は **`resolveEffectMatch` が `null` を返すこと**に一本化してある
        //   （二重の関門を残さない＝「トグルは ON なのに割り当てが無くて出ない」「割り当てはあるのに
        //   トグルが OFF で出ない」という**黙って何も起きない状態**を 2 通り作らない）。
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

        // ⚠⚠ **061l（判断 4・8）: 配信イベントの件数はここで数える。**
        //
        //   ⚠⚠ **`incoming` ではなく `fresh` を数える。** 043e（YouTube Jewels の combo 更新）は
        //     **同一 id を金額違いで再送**するので、`incoming` で数えると
        //     **視聴者 1 人の 1 コメントが 2 件に化ける**（`seenIds` はまさにそれを落とすために在る）。
        //     ⚠ 代償＝`SEEN_EFFECT_IDS_MAX` を溢れた id が再送されると 1 回余計に数えるが、
        //     それは**同キーの JSDoc が既に受容している再発火とまったく同じ穴**である（新しい受容を増やさない）。
        //   ⚠⚠ **`decideEffects` を通さない。** 通すと**イベントがエフェクトのバースト枠と
        //     クールダウン（`recentFires` / `lastConditionAt` / `lastGiftAt`）を食う**
        //     ——061j 追加穴 η・061d-2 穴 γ・061k と同型で **4 例目**になる。
        //     ⇒ ここは **`fresh.length` を足すだけ**で、発火層の state に 1 バイトも触れない。
        //   ⚠ **開催中かどうかは `roundRef`（＝画面に出しているのと同じ state）で判定する**——
        //     ここで localStorage を読み直すと「画面に出ていないのに数えている」が作れる。
        //   ⚠ `endsAt` をここでも見るので、tick が来る前でも**期限を過ぎた瞬間から数えない**。
        const activeRound = roundRef.current;
        if (activeRound !== null && Date.now() < activeRound.endsAt) {
          setEventCount((prev) => prev + fresh.length);
        }

        // ⚠ `updated` に `[]` を渡すのは「この窓は combo 更新を一切扱わない」の明示。
        //   `decideEffects` 側にも `updated` から出さない規則があり、**二重に守っている**。
        // ⚠⚠ 061d-2 / 061j: 第 5 引数が**条件の matcher**（①）。`createEffectMatcher` が返す関数は
        //   **呼ばれるたびに localStorage を読み直す**ので、main 窓で条件を変えた直後の
        //   1 件目から効く（`storage` の窓跨ぎ伝播に依存しない）。
        // ⚠⚠ **061j でここは「全コメント」で呼ばれるようになった**（061h までは課金コメントだけ）
        //   ——課金判定が matcher の中へ移ったため（判断 5）。性能の見積もりと
        //   **カクついたときの寄せ先**は `createEffectMatcher` の JSDoc が正。
        // ⚠⚠ **061k（判断 5）: matcher は「この窓の出力先」で束縛されている**（`matchEffect`）。
        //   ⚠ **絞り込みを matcher の中でやることが要点**——`EffectRequest` に `output` を載せて
        //   ここで捨てる形にすると、**捨てる前に `decideEffects` がバースト枠とクールダウンを
        //   消費してしまう**（＝もう一方の窓の条件がこの窓の枠を食う）。理由の全文は
        //   `createEffectMatcher` の JSDoc が正。
        const requests = decideEffects(
          fresh,
          [],
          triggerStateRef.current,
          Date.now(),
          matchEffect,
        );
        for (const request of requests) fire(request);
      },
    });
    return () => {
      handle.disconnect();
    };
    // ⚠ **マウント時 1 回だけ**張る（`fire` は安定な `useCallback` の連鎖なので張り直らない）。
    // ⚠ 061k: `matchEffect` も `useMemo(…, [output])` で安定（`output` は窓ごとに固定＝一生変わらない）。
    //   ⚠ **ここに不安定な値を足さないこと**——張り直すと WS が切れて再接続し、その間のコメントを落とす。
  }, [fire, matchEffect]);

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

  // 061b/061h: **テスト表示**（main 窓のテンプレート行のボタン → localStorage → `storage` イベント）。
  //
  // ⚠⚠ **localStorage から読むのは nonce と「どのテンプレートか」だけ。** エフェクトの中身
  //   （名前・金額・種別ラベル）はこのファイルの固定ダミー（`TEST_FIRE_REQUEST_BASE`）から作る
  //   ＝ **第三者のデータが localStorage を経由しない**（§9。判断の全文は `EFFECT_TEST_FIRE_KEY` の JSDoc）。
  // ⚠ `storage` イベントは**他窓での書換**でのみ発火する（自窓の書換では飛ばない）＝ main 窓 → この窓の一方通行。
  // ⚠ `clear()` 時は `e.key === null` で来るが、**そのときは発火しない**（設定を消す操作でエフェクトが出るのは筋が悪い）。
  //
  // ⚠⚠ **061h: 受け取った id は使う前に形を検証する。** localStorage は**他窓から書ける**ので、
  //   ここは多層防御の 1 枚目である（実際には Rust の `is_template_id` も同じ形を要求する）。
  //   検証は `effectAssignments.ts` の [`isEffectTemplateId`] を借りる＝ **正規表現を 2 か所に書かない**
  //   （061d-2 レビュー S-4 の「検証を 2 か所に分けると片方だけ緩む」と同じ理由）。
  // ⚠⚠ **061h: 割り当ては引かない。** 061d-2 は `resolveEffectKind("superchat")` を引き、
  //   「出さない」設定のときは組み込みで必ず出す、という**特例（穴 η）**を持っていたが、
  //   テスト表示が**テンプレート行ごと**になったので「どれを出すか」は wire に載っている。
  //   ＝ 特例ごと不要になった（「出さない」にしている種別があっても、押した行のものが出る）。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== EFFECT_TEST_FIRE_KEY) return;
      if (e.newValue === null) return;
      // ⚠ 値は `<nonce>:<templateId>`。nonce にも uuid にも `:` は現れないので、
      //   最初の `:` の後ろがそのまま id になる。
      // ⚠ **区切りが無い値は受け付けない**（061b の旧形式＝nonce だけの値もここで落ちる）。
      //   ⚠ 「`:` が無ければ全体を id とみなす」にしないこと——**素の uuid 1 個を書けば発火する**
      //   という、wire の形を満たさない入口を増やすことになる。
      const sep = e.newValue.indexOf(":");
      if (sep === -1) return;
      const templateId = e.newValue.slice(sep + 1);
      if (!isEffectTemplateId(templateId)) return;
      fireTest(templateId);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [fireTest]);

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
   * 開催状態の即時反映（main 窓 → この窓の一方通行）。⚠ **ステージ窓だけが張る**（判断 7）。
   *
   * ⚠ `storage` は**他窓での書換**でのみ発火する。⚠ `clear()`（`e.key === null`）では反応しない
   *   （既存の 2 つの `storage` ハンドラと同じ扱い）。
   * ⚠ 「終了」は `removeItem`＝`e.newValue === null` で届き、`parseStreamEventRound` が `null` を返す。
   * ⚠⚠ **張ったら必ず外す**（判断 11・教訓 E-1）。
   */
  useEffect(() => {
    if (!isStage) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STREAM_EVENT_ROUND_KEY) return;
      applyRound(parseStreamEventRound(e.newValue, Date.now()));
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [isStage, applyRound]);

  /**
   * 開催中だけ回る tick。**残り時間を進め、期限が来たら表示をやめる。**
   *
   * ⚠⚠ **この窓は localStorage を触らない**（`removeItem` しない・判断 5）——
   *   掃除は main 窓の best-effort で、**正しさは `parseStreamEventRound` が持っている**。
   * ⚠ ここで表示を消すので、**main 窓が閉じていても「終了時刻を過ぎたら表示が消える」は成立する**
   *   （実機確認 5）。⚠⚠ **窓は閉じない**（親 046 の規律）。
   * ⚠ 開催していない間は張らない／⚠ アンマウントで必ず止める（判断 11）。
   *
   * ⚠⚠ **`isStage` をガードに含めるのは「対称のため」である**（061l レビュー Q-5）。
   *   コーナー窓では `round` が `null` のままなので**今は `round === null` だけでも同じ結果**だが、
   *   それは「`setRound` の呼び出し元が上の `storage` リスナーとこの tick しかない」という
   *   **不変条件に寄りかかった安全**である。上の `storage` は `!isStage` で弾いているのに
   *   こちらだけ弾いていないと、**将来 `setRound` の経路が 1 本増えた時点でコーナー窓でも tick が回る**。
   *   ⇒ 2 つの effect の条件を揃えておく（教訓 E-1 の「張る側と取り消す側を数える」と同じ発想）。
   */
  useEffect(() => {
    if (!isStage || round === null) return;
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
  }, [isStage, round]);

  /**
   * いま描くイベント（`null` ＝ 何も描かない）。
   * ⚠ 未知 id は描かない（`parseStreamEventRound` が既に落としているので通常は到達しない）。
   */
  const eventView = useMemo(() => {
    if (!isStage || round === null) return null;
    const event = findStreamEvent(round.eventId);
    if (event === null) return null;
    const progress: StreamEventProgress = {
      count: eventCount,
      remainingMs: streamEventRemainingMs(round, eventNowMs),
    };
    return { title: event.title, progress };
  }, [isStage, round, eventCount, eventNowMs]);

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
      {/* ⚠⚠ 061l（判断 7）: **イベント層はエフェクト層より DOM 順で前＝下に描かれる。**
          エフェクトは**一瞬出て消える**もので、常時出ているイベントに隠れると意味が無いため。
          ⚠⚠ **この順序を入れ替えないこと**（変異⑪）。`EffectOverlayApp.test.tsx` が
          `compareDocumentPosition` で DOM 順を固定しているが、**実際の重なりの見え方は
          jsdom では確かめられない**（`z-index` を使わず塗り順に任せているため）。
          ⚠ `.eventLayer` の `position: absolute; inset: 0` は
          **`scripts/check-css-guards.mjs` の (10-r) が固定している**（`.templateLayer` と同じ理由＝
          jsdom はレイアウトを解決しないので、CSS だけを壊す変更を止められるのはあちらだけ）。 */}
      {eventView !== null && (
        <div className={styles.eventLayer}>
          <StreamEventView title={eventView.title} progress={eventView.progress} />
        </div>
      )}
      {effects.length > 0 && (
        // ⚠⚠ **061d-2（穴 δ / Q-6）: テンプレートは専用の絶対配置層に置く。**
        //   `EffectTemplateView` の器は `position: absolute; inset: 0` なので、
        //   **padding / gap を持つ箱の中へ入れるとその箱を無視して飛び出す。**
        //   `.templateLayer` は `position: absolute; inset: 0`（＝それ自身が子の包含ブロック）で、
        //   さらに `.root` に `position: relative` を明示してあるので、窓ではなく**この器**に解決される。
        //   ⚠ **この 2 ルールは `scripts/check-css-guards.mjs` の (10-r) が固定している**
        //   （jsdom はレイアウトを解決しないので、CSS だけを壊す変更を止められるのはあちらだけ）。
        //   ⚠⚠ **061h で層は 1 枚になった**（組み込みの縦積み `.effectStack` を廃止）。
        //   ＝ 061d-2 の「2 層の前後関係（z-index）」という論点そのものが消えている。
        //   ⚠ ⑥ のとおり**テンプレート同士の重なりは受容する**（再修正トリガー＝実機で読めないなら
        //   「テンプレートは同時 1 件まで」へ倒す）。
        <div className={styles.templateLayer}>
          {effects.map((e) => (
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
              onMediaError={() => handleMediaError(e.key, e.request.templateId)}
            />
          ))}
        </div>
      )}
      {guideVisible && (
        // ⚠ 破線の枠は「ここがキャプチャ範囲」を示すためのもので、061b のエフェクトの意匠ではない。
        <div className={styles.guide}>
          {/* ⚠⚠ 061k: **窓名は表から引く**（直書きすると 2 窓のどちらかが必ず嘘になる）。 */}
          <p className={styles.guideTitle}>{windowTitle}</p>
          <p className={styles.guideBody}>
            この枠にエフェクトが表示されます。
            <br />
            OBS で「ソースを追加 → ウィンドウキャプチャ」を選び、
            <br />
            ウィンドウの一覧から「{windowTitle}」を指定してください。
          </p>
          {/* ⚠ 061a レビュー（Q-1）: 旧文言「配信中には表示されません」は、起動時の窓復元経路があるため
              約束できない断言だった。ガイドが出る条件（＝明示操作の直後だけ）をそのまま書く。
              ⚠⚠ **061i レビュー（実機確認で発見）: 「表示を ON にした直後」は 061i で嘘になった。**
              あのトグルは廃止済みで、いまの起点は「**ウィンドウが停止中のときにテスト表示を押したとき**」
              （判断 3）。⚠ **この文だけは OBS のキャプチャに数十秒そのまま映る**ので、
              画面内の案内文より嘘の害が大きい（配信を見ている視聴者にも読める）。
              ⚠ 起点を変えるときは**必ずこの 1 文も直すこと**——`ObsEffectsScreen` の案内文・
              `EFFECT_OVERLAY_GUIDE_PENDING_KEY` の JSDoc とあわせて **3 か所**ある。 */}
          <p className={styles.guideBody}>
            このガイドは、停止中のウィンドウを「配信画面でテスト表示」で開いた直後だけ出て、自動的に消えます。
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
