/**
 * 032c-c: コメントビューアの TTS キュー（FIFO 直列・Web Audio 再生）。
 *
 * 取得コメントを VOICEVOX でローカル合成し、音が重ならないよう**直列**に読み上げる。
 * - FIFO 直列 ＋ 再生中フラグ（`onended` で次へ）。**キューは 2 本**（課金の優先キュー → 通常キュー）で、
 *   取り出し順が変わるだけ＝同時に 2 件鳴ることはない（049 フォローアップ・`isPriority` で注入）。
 * - バックログ上限超過は**古い未読から破棄**（最新優先）。**破棄されるのは通常キューだけ**で、
 *   課金イベントは埋もれない（読み上げは到着に構造的に追いつかないため、単一 FIFO では課金が捨てられていた）。
 * - 最小整形（URL 除去・絵文字除去）。**著者名は読まない**（本文のみ）。
 *   - 049 の限定的な例外: 課金イベント（membership/gift/subscription/jewels）だけは「〇〇さんが〜」と
 *     **投稿者名を含む**文を読む。これらは `text` が空で（要約文言は 043b 以降**表示側**が組み立てる）
 *     **完全に無音**だったためで、配信者が最も聞き逃したくない種別を音で分かるようにするのが目的。
 *     文言の組立は `getSpeechText`（screens 側の `composeSpeechText`）に注入され、**本モジュールは種別を
 *     一切見ない**（features → screens の層の逆転を避けるための注入）。通常チャット・スパチャは従来どおり本文のみで、
 *     方針そのものは変えていない。
 * - id 冪等（単一注入点 = `mergeComments` の新規追加分から呼ばれる）。
 * - **1 件が永久に詰まらない**（050）。直列なので 1 件が返らないと以後すべてが無音になるため、合成には
 *   タイムアウト（`SYNTH_TIMEOUT_MS`）、再生には AudioContext 停止の検知（`PLAYBACK_STALL_CHECK_MS`）を置き、
 *   どちらもその 1 件だけを諦めて次へ進む（`playing` が必ず false に戻る）。
 *
 * `enqueue` の整形パイプラインは **① 入力決定 → ② sanitize → ③ 読み替え(041a) → ④ 切り詰め(048) → ⑤ 空判定 → push**
 * の 5 段で、**分岐を増やさない単一チョークポイント**として維持する（049 は ① を `getSpeechText` へ差し替え済み）。
 *
 * AudioContext は本キューが 1 つだけ所有し、`dispose` で閉じる。合成 HTTP と再生プリミティブは
 * `voicevox.ts` に閉じ、通信はループバック 50021 のみ（docs/security.md §1 の例外を参照）。
 */

import type { CommentViewDto } from "./types";
import { applyReadingDictionary, type ReadingRule } from "./readingDictionary";
import { playWav, synthesize, ZUNDAMON_NORMAL_SPEAKER_ID } from "./voicevox";

/**
 * 通常キューのバックログ上限。超過分は古い未読から破棄する（最新優先）。
 *
 * **049 フォローアップ（2026-07-31）で 20 → 6 に下げた**。読み上げは到着に構造的に追いつかない
 * （60 文字＝10〜13 秒に対し dev-mock は 0.9〜1.8 秒に 1 件＝**1 件読む間に 6〜15 件届く**）ため、
 * キューは定常的に満杯になる。20 件だと**満杯の消化に 3〜4 分**かかり、読み上げが画面から数分遅れて
 * 「今は流れていないコメントを延々読む」状態になる（実機で「同じコメントが何度も読まれる」と報告された）。
 * 6 件なら遅延の上限が **1 分程度**に収まり、常に「今」に近いコメントを読む。
 *
 * **課金イベントはこの上限の対象外**（下記 `priorityQueue`）。捨てるのは通常チャットだけ。
 * 再修正トリガー＝実配信の流量で「もう少し拾ってほしい」となったら増やす。**安易に増やさない**
 * （増やすほど「今」から離れる）。050 で可視化（`onSkipped`）を入れたら実測値で再評価すること。
 */
const MAX_BACKLOG = 6;

/**
 * 優先キュー（課金イベント）の上限。**通常運用では到達しない**防御的な値で、
 * ENGINE 停止中に課金だけが延々積まれてメモリが伸び続けるのを防ぐためだけに置く。
 * 到達した場合も通常キューと同じく古い未読から捨てる（最新優先）。
 */
const MAX_PRIORITY_BACKLOG = 50;

/**
 * 050: 1 件あたりの合成（`synthesize`）の制限時間。超えたらその 1 件を諦めて次へ進む。
 *
 * **塞いでいるのは「ENGINE が生きているのに応答を返さない」ケース**（スリープ復帰後・モデルロードの
 * スタック等）。従来は `synthesize` が永久 pending になり `playing` が true 固定＝**読み上げが止まったまま
 * 二度と復帰しない**（しかも `GET /version` も無反応なら `engineRunning` が更新されず起動誘導バナーすら
 * 出ないため、ユーザーにはアプリ再起動以外の復帰手段が無い）。ENGINE の停止・クラッシュは接続拒否で
 * 即エラーになり既存の catch → バナー → 自動起動が働くので、こちらは元から詰まらない。
 *
 * 値の根拠: 1 件の読み上げ所要（048 の既定 60 文字＝10〜13 秒）と同オーダーに置き、「最悪でも 1 件分
 * 余計に待つだけ」という上限にする。ENGINE 起動直後の初回合成（モデルロード）を誤って切らない余裕も要る。
 * **タイムアウトは 2 回の fetch（`/audio_query` → `/synthesis`）とその body 読みの合計に掛かる**
 * （守りたい不変条件が「1 件が 10 秒以上詰まらない」なので、合計予算として持つ）。
 *
 * ⚠ **合成 1 件の所要を実測して決めた値ではない（未実測の暫定値）**（050 レビュー Q-2）。上の根拠が
 * 比べているのは**再生**時間（10〜13 秒）であって**合成**時間ではないので、余裕があるのは結果論。
 * それでも安全側に倒してあるのは**リスクが非対称**だから——長すぎても最悪 1 件分待つだけだが、
 * **短すぎると正常な読み上げが恒常的に飛び、通知が無いのでユーザーは気付けない**。
 * 再調整トリガー: (a) 実機で合成 1 件の所要を測ったら、その**実測値**を基準に引き直す。
 * (b) **ENGINE 起動直後の 1 件目が読まれない**ならモデルロードが 10 秒を超えている＝伸ばす
 * （「起動して最初のコメントだけ読まれない」という形で出るので、原因に辿り着きにくい症状）。
 * (c) 正常運用で読み上げが飛ぶ（＝合成が間に合っていない）なら伸ばす。
 */
const SYNTH_TIMEOUT_MS = 10_000;

/**
 * 050: 再生中に AudioContext が止まっていないかを見に行く間隔。
 *
 * 再生（`playWav`）にも従来は打ち切りが無く、**再生中**に AudioContext が suspended になると
 * `src.onended` が発火せず `playing` が true 固定になった（`pump` 冒頭のガードは**再生前**しか見ないので
 * 素通りする）。ここで**時間では切らない**（まだ鳴っている音を打ち切ってしまう）。`ctx.state` が
 * running でなくなったこと＝**音が出ていない**ことを条件に打ち切るので、音が重なることはない。
 *
 * **`statechange` イベントを使わずポーリングにしているのは意図的**。そもそも塞ごうとしている相手が
 * 「発火するはずの `onended` が発火しない」ケースである以上、命綱をイベントの発火に預けない。
 * 1 件の再生中だけ動く 1 Hz のタイマー 1 本なので費用は無視できる。
 *
 * 既知の割り切り（いずれも意図的・050 レビュー Q-5/Q-6）:
 * - **塞げるのは suspended 由来だけ**。`ctx.state` が running のまま `onended` が来ない事象や、
 *   `decodeAudioData` が返らない事象は**依然ハングする**（どちらも既知の原因が無いので追いかけていない）。
 *   ⚠ そのとき `playWav` が解決しないので**下の `clearInterval` にも到達せず、この 1 Hz タイマーが
 *   `dispose` 後も回り続ける**（`ctx.close()` は `decodeAudioData` を解決させないため）。実害は
 *   1 Hz のタイマー 1 本ぶんなので放置しているが、「解除漏れは無い」と読まないこと。
 *   再検討条件＝実機で「running のまま無音が続く」を観測したら、そこで初めて原因を追う。
 * - **猶予（連続判定）は入れていない**。1 tick でも running でなければ即打ち切る。出力デバイス切替等で
 *   一瞬 suspended → 自動 resume するケースではまだ聞ける音を落とすが、実害はその 1 件だけ。
 *   再検討条件＝実機で単発の打ち切りが耳に付くなら 2 tick 連続で判定する。
 */
const PLAYBACK_STALL_CHECK_MS = 1000;

/** URL を除去する（`https?://…` の連続非空白）。 */
const URL_RE = /https?:\/\/\S+/g;
/** 絵文字を除去する（Unicode Extended_Pictographic）。 */
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/**
 * 読み上げ用にコメント本文を最小整形する（URL 除去・絵文字除去・空白畳み込み）。
 * 著者名は対象外（本文のみを読む）。
 */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(URL_RE, "")
    .replace(EMOJI_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 048: 上限超過で打ち切ったときに末尾へ足す文字列。
 *
 * 読点を付けるのは、OpenJTalk が読点をアクセント句の区切りに使うため。無いと本文末尾の語と融合して
 * 誤アクセントになりやすく、「一拍おいて以下略」と聞こえる方が打ち切りだと分かりやすい。
 * この文字列は**読み替え辞書（041a）の適用後**に足すので辞書ルールに書き換えられない（意図的）。
 * 代替候補（実機で読みが崩れたら差し替える）: "、以下省略"（辞書語として安定・いかしょうりゃく）／
 * "、いかりゃく"（読みは強制できるがアクセントは OpenJTalk 任せのまま）。
 * ⚠ **差し替えはここ 1 行では終わらない**: `ttsQueue.test.ts` がこの文字列をリテラルで期待している 4 箇所
 * （境界 2 件・290 文字 1 件・サロゲート 1 件）も同時に直すこと。テスト側から定数を import すると
 * 「実装と同じものを実装と比べる」恒真式になって打ち切り表記の仕様を固定できなくなるため、意図的にリテラルのままにしてある。
 */
const SPEECH_ELLIPSIS = "、以下略";

/**
 * 048: 読み上げテキストを `max` 文字で打ち切り、超過分を `SPEECH_ELLIPSIS` に置き換える（**表示は切らない**）。
 *
 * 目的は「長文 1 件の読み上げ中に届いた後続コメントが `MAX_BACKLOG` 超過で無言破棄される」ことの解消
 * （290 文字＝約 48〜64 秒の間に 27〜38 件届き 7〜18 件が捨てられる）。純関数なので単体テストできる
 * （`createTtsQueue` は AudioContext を作るため、切り詰めを `enqueue` に直書きするとテスト不能になる）。
 *
 * **数える単位はコードポイント**（`[...text]`）。`slice` は UTF-16 コードユニット単位でサロゲートペアを割り、
 * 孤立サロゲート「�」を作る。`sanitizeForSpeech` が消すのは絵文字（Extended_Pictographic）だけなので
 * **𠮷 のような非絵文字のサロゲートペアは残る**。`viewerFormat.ts` の `authorInitial` が `charAt(0)` を避けて
 * `[...s]` を使っているのと同じ理由・同じ手段。
 *
 * 既知の割り切り（いずれも意図的・仕様として残す）:
 * - **書記素クラスタでは数えない**（`Intl.Segmenter` を使わない）。絵文字は sanitize 済みなので ZWJ 連結・肌色修飾は
 *   ほぼ残らず、割れて困るのは結合濁点（U+3099）等だけ。結合文字は基底文字の**後ろ**にあるので、切断点で落ちるのは
 *   常に濁点側＝**濁点を失った基底文字**が残る（`が` が `か` と読まれる）。宙に浮いた濁点にはならない。
 *   誤読するのは打ち切り位置の 1 文字だけで直後に「、以下略」が続くため、孤立サロゲートのような壊れ方（表示・読みが
 *   「�」に化ける）とは影響の桁が違う。再検討条件＝実機でこの 1 文字の誤読が耳に付いたら Segmenter を検討する。
 * - **接尾辞は `max` に含めない**（実際に読まれるのは最大 `max + SPEECH_ELLIPSIS.length` 文字）。よって
 *   `max + 1` 文字のコメントは切り詰めた方が僅かに長くなる。避けるにはヒステリシスが要るが複雑さに見合わない。
 * - `max` が非有限・**1 未満**なら**切り詰めない**（防御）。`0 < max < 1` を通すと `slice` の truncate で本文が
 *   0 文字になり「、以下略」だけを読む無意味な出力になるため、`<= 0` ではなく `< 1` で弾く。
 *   `max` は 1 以上の数値が前提（小数は `slice` が truncate する）で、既定値・範囲クランプのポリシーは持たず
 *   `ttsPrefs.ts` が持つ（本関数の呼び出し元は常にクランプ済みの整数を渡す）。
 */
export function capForSpeech(text: string, max: number): string {
  if (!Number.isFinite(max) || max < 1) return text;
  // 高速パス: コードポイント数 ≤ コードユニット数なので、`text.length` が上限以下なら配列化せず確定で素通し。
  if (text.length <= max) return text;
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max).join("") + SPEECH_ELLIPSIS;
}

export interface TtsQueue {
  /** コメントを読み上げキューに積む（id 冪等・整形後に空ならスキップ）。 */
  enqueue: (comment: CommentViewDto) => void;
  /** AudioContext を resume する（ユーザー操作契機で呼ぶ・WKWebView の autoplay 対策）。 */
  resume: () => Promise<void>;
  /** 破棄（キューを空にし AudioContext を閉じる）。 */
  dispose: () => void;
}

/** 033d: TTS キュー生成時のオプション。 */
export interface TtsQueueOptions {
  /**
   * 合成に使う話者（VOICEVOX style id）を返す getter。合成の直前に呼び、**その時点の選択値**を読む。
   * キューはマウント時に 1 回だけ生成されるため、静的値ではなく getter で受け取ることで、話者変更のたびに
   * キューを作り直さずに済む（グローバル直参照も避ける）。省略・戻り値なしのときは既定 3（ずんだもんノーマル）。
   */
  getSpeakerId?: () => number;
  /**
   * 041a: 合成へ渡す前に適用する読み替えルールを返す getter。`enqueue` のたびに呼び**その時点の辞書**を読む
   * （`getSpeakerId` と同じ getter 注入で、辞書更新のたびにキューを作り直さずに済む＝041b のライブマージを見据える）。
   * 省略・戻り値なしのときは空辞書＝素通し（現行動作）。
   */
  getReadingDictionary?: () => ReadingRule[];
  /**
   * 048: 1 件あたりの読み上げ最大文字数（コードポイント数）を返す getter。`enqueue` のたびに呼び**その時点の設定値**を
   * 読む（`getSpeakerId` / `getReadingDictionary` と同じ注入方式＝設定変更でキューを作り直さずに済む）。
   *
   * **省略・戻り値が非有限/1 未満のときは切り詰めない**（既存 getter と同じ「未注入なら現行動作」の作法）。
   * 既定値と範囲クランプは `ttsPrefs.ts` が単独で持つ（キュー → 設定永続化の依存を張らないため、
   * ここに既定値を二重定義しない）。アプリ本体は常にこの getter を注入するので、製品としては省略は常時有効。
   *
   * ⚠ **この optional ＋ `?? Infinity` は、注入が消えた退行を型でもテストでも検出できない**（`getMaxLength` を
   * 渡さなくても typecheck は通り、テストも 1 件も落ちず、上限だけが黙って消える）。それでも required にしないのは、
   * required にすると `ttsQueue` 側に既定値を持たせるか全テスト呼び出しに値を書かせるかになり、
   * 「既定値の定義元は `ttsPrefs.ts` の 1 箇所」という不変条件のほうが壊れるため。
   * 再修正トリガー＝049/050 で `synthesize`/`playWav` をモックしてキュー本体のテストを足すとき、
   * **`getMaxLength` を注入した `enqueue` が実際に切り詰めること**を 1 ケース必ず固定して、この穴を塞ぐこと。
   *   - 049 で `ttsQueue.test.ts` に `synthesize`/`playWav` のモックとキュー本体のテストを入れ、この 1 ケースを固定済み。
   *   - **ただしそれで塞がるのは「注入したら効くこと」まで**（049 レビュー Q-2）。上の ⚠ が指す
   *     「**本体側の注入行が消えた退行**」はキュー単体テストでは原理的に見えないため、
   *     `CommentViewerApp.toolbar.test.tsx` の「049 レビュー TTS キューの getter 配線」で
   *     `createTtsQueue` の実引数を固定して塞いだ（getter を増やすときはそちらにも 1 行足すこと）。
   */
  getMaxLength?: () => number;
  /**
   * 049: **読み上げ用テキスト**をコメントから組み立てる getter。`enqueue` の ①（入力決定）でのみ使い、
   * 以降の ②〜⑤（sanitize → 読み替え → 切り詰め → 空判定）は入力の出どころに関わらず同一の処理を通る。
   *
   * **省略時は `comment.text`＝現行動作**（既存 getter 3 つと同じ「未注入なら従来どおり」の作法）。
   *
   * この関数を注入で受け取るのは、課金イベントの文言が表示側（`screens/comment-viewer/viewerFormat.ts` の
   * `composeEventMessage`）に既にあり、**文言を二重管理しない**ために再利用する必要があるため。
   * ここから直接 import すると features → screens の層の逆転になるので、組立は screens 側
   * （`composeSpeechText`）に置いて注入する（049 決定事項 4）。**本モジュールは種別を一切見ない。**
   *
   * 注入されるのは純関数（state に依存しない）なので、他の getter と違い呼び出し側での ref 同期は不要。
   *
   * ⚠ `getMaxLength` と**同型の穴**（optional ＋ 未注入フォールバックなので、本体側の注入行が消えても
   * typecheck もキュー単体テストも気付かず、課金イベントが再び無音に戻る）。049 レビュー Q-2 の対応として
   * `CommentViewerApp.toolbar.test.tsx` の配線テストで実引数を固定してある（詳細は `getMaxLength` の ⚠）。
   */
  getSpeechText?: (comment: CommentViewDto) => string;
  /**
   * 049 フォローアップ: このコメントを**優先キュー**（＝バックログ超過で破棄せず、通常キューより先に読む）
   * へ載せるかを返す述語。本体は課金イベント（`isMonetaryEvent`）を true にする。
   *
   * **なぜ必要か**: 読み上げは到着に構造的に追いつかない（`MAX_BACKLOG` の JSDoc 参照）ため、
   * 単一 FIFO では**課金イベントが通常チャットの洪水に埋もれて破棄される**。配信者が最も聞き逃したくない
   * 種別を守れないのは本末転倒なので、キューを 2 本に分けて「課金は捨てない・先に読む」を構造で担保する。
   * 直列再生（音が重ならない）という中核設計は不変で、**取り出し順が変わるだけ**。
   *
   * **省略時は全件が通常キュー＝従来と完全に同じ**（既存 getter と同じ「未注入なら現行動作」の作法）。
   * `getSpeechText` と同じく**本モジュールは種別を一切見ない**（判定は screens 側から注入する）。
   */
  isPriority?: (comment: CommentViewDto) => boolean;
}

/**
 * FIFO 直列の TTS キューを生成する。
 * 再生中は `pump` を起動せず、`onended`（= `playWav` の解決）で次の 1 件へ進む。
 */
export function createTtsQueue(options: TtsQueueOptions = {}): TtsQueue {
  const getSpeakerId = options.getSpeakerId;
  const getReadingDictionary = options.getReadingDictionary;
  const getMaxLength = options.getMaxLength;
  const getSpeechText = options.getSpeechText;
  const isPriority = options.isPriority;
  const queue: string[] = [];
  // 049 フォローアップ: 課金イベント用の優先キュー。**通常キューより先に消費し、破棄しない**。
  const priorityQueue: string[] = [];
  const seenIds = new Set<string>();
  let playing = false;
  let disposed = false;
  const ctx = new AudioContext();

  async function pump(): Promise<void> {
    if (playing || disposed) return;
    // 049 フォローアップ: **課金（優先キュー）を先に空にしてから**通常チャットへ進む。
    // 直列再生そのものは不変で、取り出し順だけが変わる（同時に 2 件鳴ることはない）。
    const text = priorityQueue.shift() ?? queue.shift();
    if (text === undefined) return;
    playing = true;
    try {
      // 032c-b: 実データ配線でコメントはユーザー操作を伴わず届く。AudioContext が suspended のまま
      // playWav に入ると src.start() の onended が発火せず Promise が解決されない＝playing が true 固定で
      // キュー全体が無音ハングする。再生前に resume を試み、それでも running でなければこの 1 件はスキップ
      // する（永久ハングを塞ぐ）。通常フローでは「コメント取得開始」ボタン（ユーザー操作）で先に resume
      // 済みのため、このスキップは初回操作前の例外ケースの保険。
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch {
          /* resume 不可（gesture 未取得など）はスキップ側で処理する */
        }
      }
      if (ctx.state !== "running") {
        console.debug("TTS: AudioContext が running でないため、この 1 件の読み上げをスキップしました");
        return;
      }
      // 050: **`dispose` 中断とタイムアウト中断は別目的**なので、signal を混ぜない。
      // - dispose では従来どおり中断しない: 宛先は loopback 50021 のみで 1 件の合成は軽量、dispose 後は
      //   `disposed` ガードで再生を抑止するため実害が無い（残るのは高々 1 件の完了済み合成の破棄）。
      //   再検討条件: アンマウント連打時の無駄合成が目立つようになったら、queue 側に別の AbortController を
      //   持たせて dispose で abort する（下の 2 つとは別の signal にすること）。
      //   ⚠ ただし**再生は dispose で間接的に打ち切られる**ようになった（050 レビュー Q-4）＝
      //     `ctx.close()` で state が running でなくなり、下の watchdog が abort する。従来は `onended` が
      //     来ず `playWav` が pending のまま残っていたので、これは意図した改善（Promise と source が回収される）。
      // - 下で作る signal は 2 つとも**この 1 件を諦めるため**だけのもので、スコープも pump 1 回分に閉じる。
      // 033d: 選択話者（style id）で合成する。未選択/getter 未指定は既定 3（ずんだもんノーマル）を維持。
      const speaker = getSpeakerId?.() ?? ZUNDAMON_NORMAL_SPEAKER_ID;
      // 050(A): 合成が返らないまま張り付くのを塞ぐ。abort は AbortError として下の catch に落ち、
      // 通常の合成失敗と同じ扱い（この 1 件を捨てて次へ）になる＝分岐を増やさない。
      const synthController = new AbortController();
      const synthTimer = setTimeout(
        () => synthController.abort(),
        SYNTH_TIMEOUT_MS,
      );
      let wav: ArrayBuffer;
      try {
        wav = await synthesize(text, speaker, synthController.signal);
      } finally {
        // 解除は**ここ**（外側の finally ではない）。合成が終わった時点でこのタイマーの役目は終わりで、
        // 再生中（最長で数十秒）まで残すと 1 件ごとに宙ぶらりんのタイマーを抱えることになる。
        // 加えて、将来タイムアウトを通常の合成失敗と区別したくなったとき、再生中の発火が誤検知になる
        // 余地を最初から作らない（現状は区別していないので実害は無く、これは予防的な作法）。
        clearTimeout(synthTimer);
      }
      if (disposed) return;
      // 050(B): 再生中に AudioContext が止まったら諦める（suspended＝音は出ていないので打ち切っても
      // 音が重ならない）。打ち切った次の 1 件は `pump` 冒頭の既存ガード（resume を試す／ダメなら
      // その 1 件をスキップ）に入る＝**そちらの挙動は変えていない**。
      const playController = new AbortController();
      const stallTimer = setInterval(() => {
        if (ctx.state === "running") return;
        // `dispose`（`ctx.close()`）でもここに来るが、それは**正常な後始末であってストールではない**
        // ので事象名と食い違うログを出さない（§9: デバッグに必要な情報だけを書く。050 レビュー S-2）。
        // abort 自体は dispose でも必要（打ち切らないと `playWav` が pending のまま残る）。
        if (!disposed) {
          console.debug(
            "TTS: 再生中に AudioContext が停止したため、この 1 件を打ち切りました",
          );
        }
        playController.abort();
      }, PLAYBACK_STALL_CHECK_MS);
      try {
        await playWav(ctx, wav, playController.signal);
      } finally {
        clearInterval(stallTimer);
      }
    } catch (e) {
      // 合成/再生に失敗しても直列を止めず次へ継続する（ENGINE 停止などは誘導 UI 側で扱う）。
      console.error("VOICEVOX 読み上げに失敗しました", e);
    } finally {
      playing = false;
      if (!disposed) void pump();
    }
  }

  return {
    enqueue(comment) {
      if (disposed) return;
      if (seenIds.has(comment.id)) return; // 単一注入点の冪等化（二重 enqueue を無害化）。
      seenIds.add(comment.id);
      // 049: ①（入力決定）だけを差し替える。課金イベントは `text` が空で無音だったため、表示に出ている
      // 文言（`composeSpeechText`）を読み上げ入力にする。未注入なら `comment.text`＝従来と完全に同じ。
      // ②〜⑤ は入力の出どころを問わず同一（種別による分岐をここに増やさない）。
      const sanitized = sanitizeForSpeech(getSpeechText?.(comment) ?? comment.text);
      // 041a: 読み替え辞書を sanitize の後段で適用する（URL/絵文字除去 → 空白畳み込み → 読み替え → trim の順）。
      // 辞書未注入・空辞書のときは applyReadingDictionary が素通しするため、従来と完全に同じ挙動になる。
      // 末尾 .trim() は防御的（sanitize が既に trim 済み・内蔵 reading も前後空白なしのため実質 no-op だが、
      // 将来 reading に前後空白を持つルールが混ざっても空判定を正しくするため残す）。
      const replaced = applyReadingDictionary(
        sanitized,
        getReadingDictionary?.() ?? [],
      ).trim();
      // 048: 読み替え適用の**直後・空判定の前**で読み上げテキストだけを打ち切る（表示は全文のまま）。
      // ここが唯一のチョークポイントで、`enqueue` の 5 段（① 入力決定 → ② sanitize → ③ 読み替え → ④ 切り詰め →
      // ⑤ 空判定 → push）はこの並びを保つこと。**この位置に置く理由は挙動ではなく契約**である:
      // 切り詰めは空文字を生まないので空判定の前後で結果は同じだが、049（`getSpeechText` で ① を差し替える）は
      // 「② 以降は一切変えない」ことを前提にしており、分岐がここ以外に増えると単一チョークポイントが崩れる。
      const text = capForSpeech(replaced, getMaxLength?.() ?? Infinity);
      if (!text) return; // 整形・読み替え適用後に空（URL/絵文字のみ 等）なら読み上げない。
      // 049 フォローアップ: 課金イベントは**専用の優先キュー**へ積む。通常チャットの洪水で
      // 破棄されないようにするため（判定は注入＝本モジュールは種別を見ない）。
      if (isPriority?.(comment)) {
        priorityQueue.push(text);
        // 通常運用では到達しない防御的な上限（ENGINE 停止中の無限蓄積だけを防ぐ）。
        if (priorityQueue.length > MAX_PRIORITY_BACKLOG) {
          const dropped = priorityQueue.length - MAX_PRIORITY_BACKLOG;
          priorityQueue.splice(0, dropped);
          console.debug(`TTS 優先キュー上限超過: 古い未読 ${dropped} 件を破棄`);
        }
      } else {
        queue.push(text);
        if (queue.length > MAX_BACKLOG) {
          const dropped = queue.length - MAX_BACKLOG;
          queue.splice(0, dropped); // 古い未読から破棄（最新優先）。
          console.debug(`TTS backlog 上限超過: 古い未読 ${dropped} 件を破棄`);
        }
      }
      void pump();
    },
    async resume() {
      if (disposed) return;
      await ctx.resume();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      priorityQueue.length = 0;
      void ctx.close();
    },
  };
}
