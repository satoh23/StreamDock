import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  commentAmount,
  composeEventMessage,
  displayEventType,
  eventLabel,
  monetaryTone,
  viewerIdOf,
  type MonetaryTone,
} from "../comment-viewer/viewerFormat";

/**
 * 061b: **エフェクトの発火層**——「何で発火し、何回出すか」を決める 1 か所（純関数）。
 *
 * ⚠⚠ **置き場所が `features/` ではなく `screens/obs-effects/` なのは意図的**（061b タスクファイルは
 * `features/comment-viewer/effectTrigger.ts` を指定していたが、そこへ置くと**リポジトリで初めての
 * `features/` → `screens/` import**（層の逆転）になる。本モジュールは課金判定・文言・配色をすべて
 * `screens/comment-viewer/viewerFormat.ts` から取るためで、049 が `ttsQueue` で同じ逆転を
 * 「getter 注入」で回避した先例がある。⚠ ただし今回注入すべき関数が 6 本あり、注入は過剰。
 * **依存の向きを守れて、かつ唯一の消費者（エフェクト窓）と同居する**この場所を選んだ。
 * ⚠ 063（ガチャ）もエフェクト窓に乗るので、同じディレクトリから素直に import できる。
 * **再修正トリガー**＝次のどちらか（061b レビュー②Q-6 でトリガーを 1 つ足した）:
 *   - `viewerFormat` が `features/` へ移るなら、本モジュールも一緒に移してよい。
 *   - ⚠⚠ **エフェクト窓以外に `decideEffects` の消費者が現れたとき**（例: 049 の読み上げや 059b の通知音が
 *     同じ発火判定を使いたくなったとき）。そのまま参照すると `features/` → `screens/obs-effects/` という
 *     **いまより悪い層の逆転**が生まれるので、そのタイミングで `viewerFormat` ごと `features/` へ移すこと。
 *
 * ⚠⚠ **タスクファイルの「バッチ内で畳む／1 バッチ最大 N 件」は実データで一度も発動しない**（穴 H）。
 * sidecar は `comments.append` を **1 件ずつ** broadcast し（`index.ts` の `outputComments`）、
 * `commentStream.ts` も `handlers.onComments([comment])` と**常に長さ 1 の配列**で渡す
 * （`mergeComments.ts` の注記「sidecar は comments.append を 1 件ずつ送るため実運用では起きない」も同じ事実）。
 * ＝ Twitch のコミュニティギフト N+1 は **N+1 個の別バッチ**として届くので、
 * 「バッチ内で同一投稿者の gift を畳む」では **1 件も減らない**。
 * → **畳み込みもバースト上限も「時間窓を持つ状態」で行う**。状態と `now` は**引数で受け取る**ので、
 * 本モジュールは純関数のまま（テストで時計を偽装せず、`now` を渡すだけで決定的に検証できる）。
 */

/**
 * エフェクト 1 件の表示時間（ミリ秒）。フェードを含む。
 *
 * 値の根拠: 「誰がいくら」を OBS 上で読み切るのに要る時間（実測想定 2〜3 秒）＋余裕。
 * ⚠ **短すぎると読めず、長すぎると次の投げ銭が詰まる**（詰まっても溜めない設計なので「捨てられる」）。
 * **再修正トリガー**＝実機で「読む前に消える」なら 7 秒程度まで伸ばす。
 */
export const EFFECT_DISPLAY_MS = 5_000;

/**
 * 同時に画面へ出すエフェクトの最大数。
 *
 * 値の根拠: エフェクト窓は **960×360**（`open_effect_overlay_window` の `inner_size`）。
 * 1 件あたり約 100px のカードを縦に 3 枚＋間隔で収まる実測想定。
 * ⚠ 4 枚目以降は**捨てる**（キューに溜めない）。溜めると数分後にエフェクトが出続ける。
 */
export const EFFECT_MAX_CONCURRENT = 3;

/**
 * バースト上限の時間窓（ミリ秒）と件数。
 *
 * ⚠⚠ **061d-2 で JSDoc を実態へ書き換えた（②）。** 061b はここを「表示時間・同時表示数から
 * 導出しているので、時間窓の件数と画面の件数が**必ず一致**し、同時表示数が上限を超えることが
 * 構造的に起きない」と説明していたが、**その導出は 061d-2 で偽になった**——テンプレートの
 * 表示時間は `manifest.durationMs`（500〜15000ms）で**1 件ずつ違う**ので、
 * 「5 秒の窓に 3 件」と「画面に何件残っているか」はもう対応しない
 * （例: 15 秒のテンプレートが出ている間に、窓が 2 回転して 6 件が発火しうる）。
 *
 * ⚠⚠ **画面上の同時表示数を担保しているのは `EffectOverlayApp` の `showEffect` にある
 * `.slice(-EFFECT_MAX_CONCURRENT)` **だけ**である。** ここの値はもう「画面の上限」ではなく、
 * 「**短時間に届いた課金を何件まで拾うか**」という発火側の間引きだけを意味する。
 * ⚠⚠ **061h で最後の対応関係も消えた**——組み込みエフェクトを廃止したので、
 * 表示時間は**常に `manifest.durationMs`**（500〜15000ms）であり、
 * `EFFECT_DISPLAY_MS` が実際の表示時間になる経路はもう 1 本も無い。
 * ＝ ここで `EFFECT_DISPLAY_MS` / `EFFECT_MAX_CONCURRENT` から導いているのは
 * **「5 秒に 3 件」という間引きの強さの由来を書き残しているだけ**である
 * （値としては妥当だが、画面の件数とは対応しない）。
 * ⚠ **`EFFECT_MAX_CONCURRENT` は触らない**（061c 申し送り 6・②の結論）。
 */
const BURST_WINDOW_MS = EFFECT_DISPLAY_MS;
const BURST_MAX = EFFECT_MAX_CONCURRENT;

/**
 * 同一投稿者の `gift` を 1 件に畳む時間窓（ミリ秒）。
 *
 * ⚠⚠ **これは近似である。** [043a] の Twitch コミュニティギフトは N 件の贈与で
 * `community_sub_gift(total=N)` と個別 `sub_gift`×N の**両方**が届き、gift 行が **N+1 個**生成されるが、
 * **wire 上でこの 2 種は区別できない**（どちらも `eventType === "gift"`）。そこで
 * 「**同一投稿者の gift は時間窓内で 1 件**」という近似で畳む。
 * ⚠ **副作用＝同一人物の「本物の 2 件目のギフト」も窓内なら畳まれる**（＝エフェクトが 1 回減る）。
 * 逆に窓を短くすると N+1 が漏れる。N+1 は連続して届くので、5 秒は「漏らさない」側に寄せた値。
 * **再修正トリガー**＝上流（sidecar）で `community_gift_id` による dedup が入ったら**この畳み込みごと不要**になる。
 */
const GIFT_FOLD_WINDOW_MS = 5_000;

/**
 * 061j（判断 7）: [`EffectTriggerState.lastConditionAt`] を掃除する上限。
 *
 * ⚠⚠ **これは「クールダウンの長さ」ではない。** 実際のクールダウンは matcher が返す
 * [`EffectMatch.cooldownMs`] が正で、**条件ごとに違いうる**（イベント条件は `0`）。
 * ＝ `Map<string, number>` には「その条件の窓」が残っていないので、
 * **状態を増やし続けないための上限**としてここに 1 つだけ置く。
 * ⚠⚠ **matcher が返しうる `cooldownMs` は必ずこの値以下でなければならない**——
 * 超えると掃除が先に走って**クールダウンが黙って無効化される**。
 * その整合は `effectTrigger.test.ts` の定数整合ケース（`KEYWORD_COOLDOWN_MS <= この値`）が固定している。
 *
 * ⚠ **`BURST_MAX` とは別軸である。** バーストは「**窓全体で** 5 秒に 3 件」、クールダウンは
 * 「**その条件が** 10 秒に 1 件」。片方だけでは次を止められない:
 *   - クールダウンだけ … 別々のキーワード 3 つが同時に来て 3 件同時に出る
 *   - バーストだけ … 同じキーワードが 6 秒おきに来続けて出続ける
 */
export const CONDITION_COOLDOWN_MAX_MS = 60_000;

/**
 * エフェクト 1 件を出すのに必要な**最小限**の情報。
 *
 * ⚠⚠ **`CommentViewDto` をそのまま持ち回らない。** 本文（`text`）もアバター（`author.avatar`）も
 * **入れない**（§9・「必要ないものは持ち回らない」＝043a が `system_message` を持ち回らないと決めた先例と同型）。
 * - **本文を出さない理由**: 要望は「誰がいくら」であり本文は不要。出すと**配信画面に第三者の自由入力が
 *   そのまま大写しになる**（荒らし耐性が下がる）。**再修正トリガー＝「メッセージも出したい」と言われたとき**
 *   ——そのときは本フィールドを足す前に、伏せ字・長さ制限・NG ワードの扱いを先に決めること。
 * - **アバターを出さない理由**: [046a] と同じ判断（base64 data URI を持ち回らない）。
 *
 * ⚠ `EffectRequest.test.ts` 相当のテストが**キー集合そのもの**を固定している。
 * 「便利だから」で `text` を足すと落ちる。
 *
 * ⚠⚠ **061d-2 で「共通部分（[`EffectRequestBase`]）＋ 判別子（[`EffectKind`]）」の合成になった。**
 * 交差型にしてあるのは、**`kind` を見ずに `templateId` を読むコードが書けない**ようにするため
 * （`kind === "template"` で絞って初めて `templateId` が生える）。
 * ⚠⚠ **061h で [`EffectKind`] が 1 本になったので、キー集合は常に 8 個**である
 * （`{id,name,amountText,message,eventLabel,tone,kind,templateId}`）。061b/061d-2 が
 * 「組み込み経路は 7 個のまま」と書いていた対比は**もう存在しない**。
 * ⚠ `tone` は 061h の時点で**描画側の読み手が居ない**（組み込みカードの配色に使っていた）。
 * それでも残しているのは ①`EffectRequestBase` を削らないという 061h の指定 ②061k の
 * ステージ窓・063 のガチャが同じ配色表に乗る余地、の 2 点による。
 * **再修正トリガー＝ 061k / 063 が終わっても読み手が現れなかったとき**（そのとき落とす）。
 */
export type EffectRequest = EffectRequestBase & EffectKind;

/**
 * 061d-2: **どのエフェクトで出すか**（`EffectRequest` の判別子部分）。
 *
 * ⚠⚠ **`EffectRequest` に `eventType` を足さない**（①）。「どのイベントか」は割り当てを引くための
 * 一時的な鍵にすぎず、描画にも表示にも要らない——足すと `EffectRequest` が
 * 「出すのに要る最小限」ではなくなり、061b が型で作った §9 の担保（持ち回るものを増やさない）が緩む。
 * 割り当ての解決は**この union を返す resolver** が担い、結果だけがここに載る。
 *
 * ⚠⚠ **061h で `{ kind: "builtin-monetary" }` を削り、variant は 1 本になった。**
 * 組み込み意匠（061b の「〇〇さんが ¥1,000」）は**完全に廃止**である——エフェクトは
 * 各々が使いたいものを取り込んで割り当てる、という運用に対して、
 * 「未設定・不正・壊れたメディアがすべて組み込みへ倒れる」形が真逆だったため
 * （判断の全文は docs/progress.md の 061h 節）。
 * ⚠ **union のまま残してある**（`{ kind: "template"; … }` を裸で書かない）のは、
 * 063（ガチャ）が `{ kind: "gacha"; … }` を **2 本目**として足すため。
 * そのとき `EffectOverlayApp` の描画分岐と `effectAssignments.ts` の検証表に 1 行ずつ足すことになる。
 */
export type EffectKind = { kind: "template"; templateId: string };

/**
 * 061j: 条件の照合に渡す**最小限**の入力。
 *
 * ⚠⚠ **`CommentViewDto` をそのまま渡さない**（§9・「必要ないものは持ち回らない」＝ 061b が
 * [`EffectRequest`] に `text` / `avatar` を持たせなかったのと**同じ規律**。043a が `system_message` を
 * 持ち回らないと決めた先例と同型）。渡すのは判定に要る 2 つだけ。
 * ⚠ `eventType` は**生の値**（`displayEventType` を通したものではない）。
 * 「ビッツは superchat に含まれる」という `MONETARY_EVENT_TYPES` の前提が条件表とずれない
 * （061b の穴②と同じ罠）。⚠⚠ **`displayEventType` を呼ぶのに必要な `monetary` を渡していない**ので、
 * 照合側は**この罠を踏みたくても踏めない**（型で塞いである）。
 * ⚠ `text` は**必須の `string`**（`CommentViewDto.text` が optional ではない）。ただし
 * **空文字はありうる**（サブスク／ギフト等は本文を持たない）ので、照合側はそれを前提に書くこと。
 */
export interface EffectMatchInput {
  eventType: string;
  text: string;
}

/**
 * 061j: 当たった条件 1 件。
 *
 * ⚠⚠ **本文を載せない。** これが「第三者の本文が発火層より先へ 1 バイトも進まない」ことの担保で、
 * `EffectRequest` が **8 キーのまま無改変**であることと対になっている（§9）。
 * ⚠ `conditionId` は**ユーザー自身が作った条件の識別子**なので §9 の対象外だが、
 * **`EffectRequest` には載せない**——クールダウンの判定は [`decideEffects`] の中で完結するので
 * 載せる理由が無く、載せると「出すのに要る最小限」という 061b の規律が緩む。
 * ⚠ `cooldownMs` を戻り値に載せることで、[`decideEffects`] の分岐は 1 つで済む
 * （＝**発火層は「イベント条件かキーワード条件か」を知らない**・061b の「発火層は割り当てを知らない」の維持）。
 */
export interface EffectMatch {
  effect: EffectKind;
  conditionId: string;
  /** `0` ＝ クールダウン無効。⚠ 実際の値の根拠は `effectAssignments.ts` の `KEYWORD_COOLDOWN_MS` が正。 */
  cooldownMs: number;
}

/**
 * 061d-2 / **061j**: コメント → **どの条件でどのエフェクトを出すか**（`null` ＝ **1 件も出さない**）。
 *
 * ⚠⚠ **これが「条件」を発火層へ持ち込む唯一の口である**（①）。本モジュールは
 * localStorage も `effectAssignments.ts` も import しない＝**純関数のまま**で、
 * 実体（`createEffectMatcher(output)` が返す関数）は呼び出し側が渡す。
 * ⚠ **061k で実体が「出力先で束縛された matcher」になったが、この型も `decideEffects` も無改変**
 * ——**発火層は「どの窓に出すか」を知らない**（＝`EffectRequest` に `output` が載らない）。
 * 絞り込みを発火層へ持ち込むと、**もう一方の窓の条件がバースト枠を食う**（あちらの JSDoc が正）。
 * ⚠⚠ **061j で課金判定（`isMonetaryEvent`）もこの向こう側へ移った**——キーワード条件は
 * **通常チャットで発火するのが目的**なので、発火層でゲートすると永久に当たらないため。
 * ＝ 本モジュールから `isMonetaryEvent` の import が消えたが、**層の向きは変わっていない**
 * （`effectAssignments.ts` は元から `viewerFormat` を import している）。
 */
export type EffectMatcher = (input: EffectMatchInput) => EffectMatch | null;

interface EffectRequestBase {
  /**
   * 元コメントの id。**重複発火の抑止と React の key** に使う（不透明な識別子で、本文は含まない）。
   *
   * ⚠ **061b レビュー②（DOM へ描く変異が生存・修正不要）**: この値を画面へ描いてもテストは緑のままだが、
   * 直さないのは ①プラットフォームが振る不透明な識別子で、本文・表示名・金額のような第三者の
   * 個人データではない（§9 の対象外）②描いても意匠が汚れるだけで実害が無い、の 2 点による。
   * **再修正トリガー**＝id に投稿者を特定できる情報（チャンネル ID 等）が含まれる provider が増えたとき。
   * そのときは §9 の対象になるので、`EffectRequest` から外して `seenIds` 側だけで扱うこと。
   */
  id: string;
  /** 投稿者の表示名。 */
  name: string;
  /** 金額の verbatim 表示（`commentAmount` の戻り値。無ければ null）。⚠ 通貨換算も合計もしない（043c と同じ）。 */
  amountText: string | null;
  /** 金額を持たない種別（サブスク/メンシプ/ギフト）の日本語文（`composeEventMessage`）。無ければ null。 */
  message: string | null;
  /** 種別ラベル（「スーパーチャット」等）。未知種別は空文字へ無害に劣化する。 */
  eventLabel: string;
  /** 配色キー。⚠ **043c/047b と同じ `monetaryTone`** なので、コメント欄のカードと**同じ額が同じ色**になる。 */
  tone: MonetaryTone;
}

/**
 * 発火層が持ち越す状態（**時間窓の判定に要る最小限**）。
 *
 * ⚠ 保持するのは **`viewerId`（`provider:userId`）と時刻だけ**で、**表示名も本文も持たない**（§9）。
 * ⚠ どちらも `decideEffects` の先頭で**時間窓の外を捨てる**ので、長時間の配信でも増え続けない。
 */
export interface EffectTriggerState {
  /** 直近に gift エフェクトを出した投稿者 → その時刻(ms)。 */
  lastGiftAt: Map<string, number>;
  /** 直近に発火した時刻(ms)。バースト上限の判定に使う。 */
  recentFires: number[];
  /**
   * 061j（判断 7）: 直近に**その条件で**発火した時刻(ms)。
   *
   * ⚠ 既存 2 つと同じく [`decideEffects`] の先頭で時間窓の外を捨てる。
   * ⚠ **記録は実際に出したときだけ**（`recentFires` / `lastGiftAt` と同じ規律。バーストで捨てた分まで
   * 記録すると「1 度も出ない」が起きる）。
   */
  lastConditionAt: Map<string, number>;
}

export function createEffectTriggerState(): EffectTriggerState {
  return { lastGiftAt: new Map(), recentFires: [], lastConditionAt: new Map() };
}

/**
 * `CommentViewDto` → `EffectRequest`。⚠ **判定・文言・配色はすべて既存の共有関数**（2 実装に分けない）。
 *
 * ⚠⚠ **061j: ここが「本文を落とす関門」である。** 入ってくる `c` は本文を持つが、
 * 出ていく `EffectRequest` は **8 キー（id / name / amountText / message / eventLabel / tone /
 * kind / templateId）だけ**で、`text` を書ける場所が型として無い。
 * ⚠ **「便利だから」で `text` を足さないこと**（`effectTrigger.test.ts` がキー集合そのものを固定している）。
 */
function toEffectRequest(c: CommentViewDto, kind: EffectKind): EffectRequest {
  return {
    id: c.id,
    name: c.author.name,
    // 043c と同じ verbatim 表示（整形済み文字列を優先し、無ければ数値＋通貨）。
    amountText: commentAmount({
      monetaryAmount: c.monetaryAmount,
      amount: c.monetary?.amount,
      currency: c.monetary?.currency,
    }),
    // 金額を持たない種別だけ文になる（superchat/bits/donation/jewels は null が返る）。
    message: composeEventMessage(c),
    eventLabel: eventLabel(displayEventType(c)),
    tone: monetaryTone(c),
    // ⚠ 061d-2: 割り当ての解決結果をそのまま載せる（061h 以降は `kind` ＋ `templateId` の
    //   2 フィールド）。判定は resolver の責務で、ここでは分岐しない。
    ...kind,
  };
}

/**
 * このバッチから出すエフェクトを決める。**`state` は破壊的に更新する**（発火した分だけ記録する）。
 *
 * @param added   `mergeComments` の `added` 相当（＝**まだ出していない**コメント）
 * @param updated `mergeComments` の `updated` 相当。⚠ **ここからは 1 件も出さない**
 * @param state   時間窓の状態（`createEffectTriggerState` で作る）
 * @param now     現在時刻(ms)。⚠ **引数で受ける**ので本関数は決定的（テストで時計を偽装しなくてよい）
 * @param matchEffect 061d-2 / **061j**: コメント → **どの条件でどのエフェクトを出すか**（`null` ＝ 出さない）。
 *   ⚠⚠ **061h で既定値を外し、必須にした。** 061d-2 はここを
 *   `resolveKind: EffectKindResolver = () => BUILTIN_KIND` と既定つきにして
 *   「061b までの 21 ケースが 1 文字も書き換わらない＝発火判定に手が入っていないことを
 *   `git diff` で示せる」という担保を作っていたが、**それは 061d-2 のレビューのための足場**であり、
 *   役目は終わっている。⚠⚠ **既定を外したことで「条件を引かずにエフェクトが出る」経路が
 *   型として消えた**——本関数は「何を出すか」を**自分では 1 つも知らない**ので、
 *   呼び出し側が matcher を渡さない限り 1 件も発火しない。これが 061h の目的そのものである。
 *   ⚠ **ここに既定値を書き戻さないこと**（書き戻した瞬間に、条件を無視して出る経路が復活する）。
 *
 * 塞いでいる多重発火は **4 経路**（061j でクールダウンが 4 つ目として増えた）:
 * 1. **[043e] Jewels の combo 再送** … `updated` から出さない（下記）。
 * 2. **[043a] Twitch コミュニティギフトの N+1** … 同一投稿者の `gift` を `GIFT_FOLD_WINDOW_MS` 内で 1 件へ。
 * 3. **バースト** … `BURST_WINDOW_MS` に `BURST_MAX` 件まで。超過分は**捨てる**（キューに溜めない）。
 * 4. **061j: 条件ごとのクールダウン** … 同じ条件は `match.cooldownMs` 内で 1 件まで
 *    （＝視聴者が同じ単語を連呼しても画面が埋まらない）。
 */
export function decideEffects(
  added: CommentViewDto[],
  updated: CommentViewDto[],
  state: EffectTriggerState,
  now: number,
  matchEffect: EffectMatcher,
): EffectRequest[] {
  // ⚠⚠ **`updated` は意図的に 1 件も読まない。** [043e] の Jewels は「別メッセージが N 件届く」のではなく
  // 「**同じ 1 件が N 回更新される**」（公式 proto に "For giftEvents, the same ID may be reused to update
  // the combo count" と明記）ので、combo 更新で毎回エフェクトを出すと**1 回の課金で N 回光る**。
  // ⚠ それでも引数に残しているのは、呼び出し側が `mergeComments` の 3 バケットを**そのまま渡せる形**に
  // しておくため（063b の抽選もこの層に乗る）。⚠ ここを `added.concat(updated)` にする変異は
  // `effectTrigger.test.ts` の「combo 更新では出ない」がレッドにする。
  void updated;

  // 時間窓の外を捨てる（これがあるので状態は増え続けない）。
  for (const [viewerId, at] of state.lastGiftAt) {
    if (now - at >= GIFT_FOLD_WINDOW_MS) state.lastGiftAt.delete(viewerId);
  }
  state.recentFires = state.recentFires.filter(
    (at) => now - at < BURST_WINDOW_MS,
  );
  // 061j（判断 7）: 条件ごとのクールダウンも同じ場所で掃除する。
  // ⚠ 窓は `CONDITION_COOLDOWN_MAX_MS`（＝**状態を増やし続けないための上限**であって
  //   クールダウンの長さではない。あちらの JSDoc が正）。
  for (const [conditionId, at] of state.lastConditionAt) {
    if (now - at >= CONDITION_COOLDOWN_MAX_MS) {
      state.lastConditionAt.delete(conditionId);
    }
  }

  const requests: EffectRequest[] = [];
  for (const c of added) {
    // ⚠⚠ **061j: 課金判定（`isMonetaryEvent`）は matcher の中へ移した**（判断 5）。
    //   ここに `if (!isMonetaryEvent(c.eventType)) continue;` を書き戻すと、
    //   **キーワード条件が永久に当たらない**（通常チャットが 1 件もここを通らなくなる）。
    //   ⚠ 移した先でも `displayEventType` を通していないこと（ビッツが superchat で届く罠）は
    //   `EffectMatchInput` が `monetary` を持たないことで**型として**担保されている。
    //
    // ⚠⚠ **061d-2（穴 γ）: 条件の解決は「バースト検査より前」に置く。**
    //   ⚠ **061j での正確な言い方**（061d-2 の説明を実装に合わせて訂正した）: この位置は
    //   **振る舞いとしてはバースト検査・gift 畳み込みのどちらとも交換可能**である
    //   ——後続の 2 つは `recentFires.length` と `lastGiftAt.has` を**読むだけ**で、
    //   書き込む（`push` / `set`）のは**実際に出したときだけ**だから。
    //   ⇒ **守っている不変条件は「順序」ではなく「出さないと決まったものは state に一切触らない」**
    //   ほうである（`effectTrigger.test.ts` が state の 3 つのサイズを直接数えて固定している）。
    //   ⚠⚠ **061j でこの不変条件の重みが桁で上がった**——061h までは非課金コメントが先頭の
    //   ゲートで落ちていたが、いまは**全コメントがこのループを通る**。ここで `recentFires` を
    //   1 件でも積むと、**キーワードに当たらない通常チャットが投げ銭を捨てる**（常時発生する）。
    // ⚠ 手前に置く理由は 061d-2 のまま＝ `viewerIdOf` の計算を無駄にしないことと、
    //   「出さないと決まったものは以降の状態に一切触らない」が**読んで分かる**こと。
    const match = matchEffect({ eventType: c.eventType, text: c.text });
    if (match === null) continue;

    // 061j（判断 7）: **同じ条件が続けて発火しない**ようにする。
    // ⚠ 位置は「`match === null` の直後・**gift 畳み込みより前**」＝
    //   「出さないと決まったものは状態に触らない」の一部。
    // ⚠ `cooldownMs === 0`（イベント条件）は素通しする＝スパチャ 2 連投の 2 件目を落とさない。
    if (match.cooldownMs > 0) {
      const last = state.lastConditionAt.get(match.conditionId);
      if (last !== undefined && now - last < match.cooldownMs) continue;
    }

    // [043a] コミュニティギフトの N+1 を畳む（同一投稿者の gift は時間窓内で 1 件）。
    // ⚠ 判定キーは `viewerIdOf`（`provider:userId`）＝**表示名ではなく安定 ID**（改名や同名で崩れない）。
    // ⚠ **061b レビュー②（受容・修正不要）**: `author.id` が空だと键が `"twitch:"` になり、
    //   窓内の匿名 gift が全部 1 件へ畳まれる。直さないのは ①`viewerIdOf` はリポジトリ全体で
    //   視聴者を指す唯一の键で、ここだけ別規則にすると 043a/046a と食い違う ②実害は
    //   「エフェクトが数回減る」だけ（多く出る方向には壊れない）、の 2 点による。
    //   **再修正トリガー**＝`author.id` が空で届く provider が実運用で確認されたら、
    //   空 ID のときは畳まない（＝各件を出す）へ倒すこと。
    const viewerId = c.eventType === "gift" ? viewerIdOf(c) : null;
    if (viewerId !== null && state.lastGiftAt.has(viewerId)) continue;

    // バースト上限。⚠ **超過分はここで捨てる**（配列に積んで後で出す＝キューにしない）。
    // 溜めると「大量の課金が来た数分後にエフェクトが出続ける」という、配信中に止められない状態になる。
    // ⚠ **捨てた件数はログに出さない**（§9。出すと第三者の課金の量が端末ログに残る）。
    if (state.recentFires.length >= BURST_MAX) continue;

    requests.push(toEffectRequest(c, match.effect));
    state.recentFires.push(now);
    // ⚠ **実際に出したときだけ**記録する。バーストで捨てた分まで記録すると、
    // 「1 件目が捨てられ、2 件目も畳まれて **1 回も出ない**」が起きる（出ないほうが害が大きい）。
    if (viewerId !== null) state.lastGiftAt.set(viewerId, now);
    // ⚠⚠ **061j: クールダウンも「実際に出したときだけ」記録する。** 捨てたときにも記録すると、
    //   バーストで 1 件目が捨てられた条件が**そのあとクールダウンぶん沈黙する**＝
    //   「当たっているのに 1 回も出ない」が起きる（`lastGiftAt` と同じ罠の 2 例目）。
    //   ⚠ **「何も出ない」だけを見るテストでは殺せない変異**なので、
    //   `effectTrigger.test.ts` は**発火回数を数えて**固定している（061h の変異⑤の教訓）。
    if (match.cooldownMs > 0) state.lastConditionAt.set(match.conditionId, now);
  }
  return requests;
}
