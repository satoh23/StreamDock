import type { CommentViewDto } from "../../features/comment-viewer/types";
// ⚠⚠⚠ **063b 段 1-b: viewerFormat から取るものが 6 本 → `viewerIdOf` 1 本になった。**
//   本ファイル冒頭の「置き場所」節が「注入すべき関数が 6 本あり、注入は過剰」を根拠に
//   `screens/obs-effects/` を選んでいるが、⚠ **その根拠は弱くなった**（下記の申し送り）。
import { viewerIdOf } from "../comment-viewer/viewerFormat";

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
 * 発火 1 件を出すのに必要な**最小限**の情報。
 *
 * ⚠⚠ **`CommentViewDto` をそのまま持ち回らない。** 本文（`text`）もアバター（`author.avatar`）も
 * **入れない**（§9・「必要ないものは持ち回らない」＝043a が `system_message` を持ち回らないと決めた先例と同型）。
 * ⚠ **「便利だから」で `text` を足さないこと**（`effectTrigger.test.ts` がキー集合そのものを固定している）。
 *
 * ## ⚠⚠ 064d: `EffectRequest`（= [`EffectRequestBase`] & `EffectKind`）を削除した
 *
 * `EffectKind` は **`{ kind: "template"; templateId }` 1 本だけ**の union で、
 * 「エフェクト窓が取り込んだテンプレートを描く」ための型だった。064 で取り込み機能ごと消えたので、
 * **その型が指す対象が 1 つも存在しなくなった**。
 * ⇒ 総称の既定を [`EffectObsSource`] へ移し、`EffectRequest` という別名は落とした。
 *
 * ⚠⚠ **申し送り（064d では直さない）**: レーンが 1 本になったので、
 * ①総称化（064b）は**インスタンスが 1 つだけ**になり ②[`EffectRequestBase`] の
 * `name` / `amountText` / `message` / `eventLabel` / `tone` は **OBS レーンでは 1 つも読まれない**。
 * §9 の「必要ないものは持ち回らない」に照らせば落とすべきだが、**064d は削除に集中する**と決めた
 * （削除と設計変更を 1 コミットに混ぜない）。⚠ **再修正トリガー＝063（ガチャ）に着手するとき**。
 *
 * ⚠⚠⚠ **063b 段 1-a: そのトリガーを引いたが、返済はこの段では行わない。**
 * 063 は**2 本目のレーンを足さなかった**（`EffectObsSource | EffectGacha` の **1 本**に決めた・
 * `createEffectFireMatcher` の JSDoc が正）ので、**総称化は残る**——union の 2 種が流れるためである。
 * ⚠ 未使用フィールドの返済は **063b 段 1-b** が行う（⚠ **実際に読まれていないのは 5 つではなく 6 つで、
 * `id` も含む**——プロダクションが読むのは `sourceName` だけである）。
 * **発火の接続（振る舞いが変わる差分）と、型の削除（振る舞いが変わらない差分）を 1 コミットに混ぜない。**
 */

/**
 * 064b: **エフェクト窓が描くのではない発火先**（＝ OBS 側のソースを鳴らす）。
 *
 * ⚠⚠ **064b の時点では、エフェクト窓が描く `EffectKind` と混ぜないことが要点だった**
 * （混ぜると `EffectRequest` に「描けない kind」が生まれ、描画分岐が必ず不能ケースを持つ）。
 * ⇒ **`decideEffects` をペイロードで総称化**し、レーンごとに別の型を流す形にした（下記）。
 * ⚠ **064d で `EffectKind` 側が消えた**ので、いま流れているのはこの型 1 つだけである。
 *
 * ⚠ 載せるのは**ソース名だけ**。何秒出すかは **OBS が持っている**（メディアの長さ）ので、
 * ここにも保存形にも秒数を置かない（sidecar の `resolveObsFireDurationMs` が正）。
 */
export type EffectObsSource = { kind: "obs-source"; sourceName: string };


/**
 * 061j: 条件の照合に渡す**最小限**の入力。
 *
 * ⚠⚠ **`CommentViewDto` をそのまま渡さない**（§9・「必要ないものは持ち回らない」＝ 061b が
 * [`EffectRequestBase`] に `text` / `avatar` を持たせなかったのと**同じ規律**。043a が `system_message` を
 * 持ち回らないと決めた先例と同型）。渡すのは判定に要る 2 つだけ。
 * ⚠ 064 レビュー Q-6: 以降の文中に出てくる `EffectRequest` / `EffectKind` は
 * **064d で削除した型の名前**である（当時の判断の記録。上の 064d 節が正）。
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
 *
 * ⚠ **064b で `effect` の型が総称化された**（既定は 064d 以降 [`EffectObsSource`]）。
 * 理由の全文は [`decideEffects`] の JSDoc が正。
 */
export interface EffectMatch<T extends object = EffectObsSource> {
  effect: T;
  conditionId: string;
  /** `0` ＝ クールダウン無効。⚠ 実際の値の根拠は `effectAssignments.ts` の `KEYWORD_COOLDOWN_MS` が正。 */
  cooldownMs: number;
}

/**
 * 061d-2 / **061j**: コメント → **どの条件でどのエフェクトを出すか**（`null` ＝ **1 件も出さない**）。
 *
 * ⚠⚠ **これが「条件」を発火層へ持ち込む唯一の口である**（①）。本モジュールは
 * localStorage も `effectAssignments.ts` も import しない＝**純関数のまま**で、
 * 実体（`effectAssignments.ts` の `createEffectFireMatcher()` が返す関数）は呼び出し側が渡す。
 * ⚠ **064b〜064d の JSDoc が書いていた `createEffectMatcher` は 064d で削除済み**である
 * （名前だけが参照として残っていたのを 063b で掃除した）。
 * ⚠ **061k で実体が「出力先で束縛された matcher」になったが、この型も `decideEffects` も無改変**
 * ——**発火層は「どの窓に出すか」を知らない**（＝`EffectRequest` に `output` が載らない）。
 * 絞り込みを発火層へ持ち込むと、**もう一方の窓の条件がバースト枠を食う**（あちらの JSDoc が正）。
 * ⚠⚠ **061j で課金判定（`isMonetaryEvent`）もこの向こう側へ移った**——キーワード条件は
 * **通常チャットで発火するのが目的**なので、発火層でゲートすると永久に当たらないため。
 * ＝ 本モジュールから `isMonetaryEvent` の import が消えたが、**層の向きは変わっていない**
 * （`effectAssignments.ts` は元から `viewerFormat` を import している）。
 */
export type EffectMatcher<T extends object = EffectObsSource> = (
  input: EffectMatchInput,
) => EffectMatch<T> | null;

/**
 * ## ⚠⚠⚠ 063b 段 1-b: `EffectRequestBase` を**フィールドごと全廃した**（＝ この型はもう無い）
 *
 * 064b で export し、064d が「**§9 に照らせば落とすべきだが、削除と設計変更を 1 コミットに混ぜない**」と
 * 申し送っていたフィールドを落とした。
 * ⚠⚠ **064d / 親 063 / task-board はいずれも「未使用は 5 つ」と書いていたが、実際は 6 つだった**
 * （`id` / `name` / `amountText` / `message` / `eventLabel` / `tone`）——**`id` も
 * プロダクションから 1 か所も読まれていない**（`takeFreshComments` の `seenIds` は
 * `CommentViewDto.id` を直接見るのでこの値を経由せず、React の key も 064d でエフェクト窓ごと消えた）。
 * ⇒ **プロダクションが読むのは matcher が返したペイロードだけ**なので、
 * [`decideEffects`] の戻り値は **`T[]`** になり、`toEffectRequest` も消えた。
 *
 * ⚠⚠⚠ **これは §9 の担保を 1 段強くする変更である。**
 * 061j までの担保は「**本文を書ける場所が型として無い**」だったが、いまは
 * **コメント由来の値が 1 つも載らない**——戻り値は
 * **ユーザー自身が作った設定（OBS のソース名／ガチャの id）だけ**で構成される。
 * ⚠ `effectTrigger.test.ts` の「キー集合」ケースがこれを直接固定している。
 *
 * ⚠⚠ **戻すときは [`decideEffects`] の中の 1 か所で組み立てること**（旧 `toEffectRequest` の位置）。
 * **再修正トリガー**＝ 066 段 2（当選結果をチャットへ書く）を実施するとき。
 * ⚠ そのとき要るのは**おそらく `name` だけ**だが、
 * ⚠⚠⚠ **第三者の表示名が「端末内で持ち回る」から「チャットへ公開する」へ変わる**ので、
 * **§9 の判断をやり直すこと**（軽レビューでは済まない）。
 *
 * ⚠ **`id` の 061b レビュー②の記録**（「DOM へ描く変異が生存・修正不要」）は
 * **フィールドごと消えたので争点も消えた**。⚠ 復活させるなら、あの判断も一緒に読み直すこと。
 *
 * ## ⚠⚠ 申し送り（063b では**やらない**）: この層の置き場所の根拠が弱くなった
 *
 * 本ファイル冒頭の「置き場所」節は **`features/` → `screens/` の層の逆転を避けつつ、
 * 課金判定・文言・配色を `viewerFormat` から取る**ために `screens/obs-effects/` を選び、
 * ⚠ **「注入すべき関数が 6 本あり、注入は過剰」**を getter 注入（049 の `ttsQueue` の先例）を
 * 却下する根拠にしていた。⚠⚠⚠ **本段でその 6 本が `viewerIdOf` 1 本になった**ので、
 * **注入は過剰ではなくなった**（1 本なら安い）。
 * ⇒ ⚠ **それでも本段では動かさない**——置き場所の変更は**発火とも §9 とも無関係な純粋な構造変更**で、
 * 混ぜると「未使用フィールドを落とした」という差分が読めなくなる。
 * **再修正トリガー**＝冒頭の既存 2 つに加えて、**この 3 つ目**（注入コストが 1 本まで下がった）。
 */

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
 * 一度でも発火判定に通したコメント id を覚えておく上限。
 *
 * ⚠⚠ **064b で `EffectOverlayApp` からここへ移した**（判断の本文は当時のまま）。理由は
 * **消費者が 2 つになった**こと——エフェクト窓（テンプレート）とコメビュ窓（OBS ソース）が
 * 同じ「既に見た id は発火させない」規則を要る。⚠ **2 通りに書くと片方だけ緩む。**
 *
 * 値の根拠: [043e] の combo 更新は数秒以内に届くため 500 件の窓では取りこぼさない。
 * **再修正トリガー**＝この上限を大幅に下げるなら、再発火が現実に起きるので設計ごと見直すこと。
 *
 * ⚠ **061b レビュー②Q-4（テストで固定していない・意図的）**: 「古い順に捨てる」は `Set` の挿入順に
 * 依存しているが、追い出し方向を反転させる変異はテストで殺せていない（501 件を流したうえで
 * 「窓の外へ出た id だけが再発火する」を観測する必要があり、バースト上限と時間窓を跨ぐので
 * テストが実装の内部順序へ強く結合する）。**修正不要と判断した理由**＝反転しても実害は
 * 「上限 500 を超えた運用でのみ、稀に 1 回余計に光る」だけで、§9 にも §6 にも触れないため。
 * **再修正トリガー**＝上限を大幅に下げる／この集合を再発火以外の判断（例: 集計・永続）に使い始めたとき。
 */
const SEEN_EFFECT_IDS_MAX = 500;

/**
 * 064b: 発火判定に通した id の集合を作る。⚠ **窓ごと（レーンごと）に 1 つ**。
 *
 * ⚠ **ref に持つこと**（state にしない）——`connectCommentStream` の張り直しを跨いで持続する必要がある。
 */
export function createSeenEffectIds(): Set<string> {
  return new Set();
}

/**
 * 064b: **まだ発火判定に通していないコメントだけを取り出す**（`seen` は破壊的に更新する）。
 *
 * ⚠⚠ **[043e] YouTube Jewels の combo 更新を落とすのがここである。** あちらは
 * 「別メッセージが N 件届く」のではなく「**同じ 1 件が N 回更新される**」ので、
 * 素通しすると **1 回の課金で N 回発火する**。⚠ `decideEffects` 側の `updated` 無視と**二重に守る**形。
 *
 * ⚠⚠ **接続直後に過去分で一斉発火しないこと**の担保でもある:
 *   ①sidecar は**接続時にコメントのバックログを送らない**（`index.ts` の `setConnectionHandler` が送るのは
 *     `link.state` の 2 本だけ）。②仮に届いても、この集合に載っている id は発火しない。
 *   ⚠ **再修正トリガー＝sidecar にバックログ送信が入ったら**、id 集合では足りない
 *     （初見の id が一斉に来る）ので、明示的な抑制（接続直後の猶予など）を設計し直すこと。
 */
export function takeFreshComments(
  seen: Set<string>,
  incoming: CommentViewDto[],
): CommentViewDto[] {
  const fresh = incoming.filter((c) => !seen.has(c.id));
  if (fresh.length === 0) return fresh;
  for (const c of fresh) seen.add(c.id);
  // 上限を超えたぶんは**古い順に**捨てる（Set は挿入順を保つ）。
  if (seen.size > SEEN_EFFECT_IDS_MAX) {
    for (const id of seen) {
      if (seen.size <= SEEN_EFFECT_IDS_MAX) break;
      seen.delete(id);
    }
  }
  return fresh;
}

/**
 * ⚠⚠⚠ **063b 段 1-b: `toEffectRequest` を削除した**（旧「`CommentViewDto` → `EffectRequest`」）。
 *
 * ⚠⚠ **061j はここを「本文を落とす関門」と呼んでいた**——入ってくる `c` は本文を持つが、
 * 出ていく値には `text` を書ける場所が型として無い、という担保だった。
 * ⚠⚠⚠ **いまは関門そのものが不要になった**——[`decideEffects`] は
 * **matcher が返したペイロードをそのまま `push` する**だけで、`c` から値を 1 つも取り出さない。
 * （唯一 `c` を読むのは `viewerIdOf` による gift の畳み込み判定だが、⚠ **その結果は戻り値に載らず
 * [`EffectTriggerState`] に留まる**——あちらは元から「メモリのみ・永続化しない」である。）
 * ⇒ **「本文を足せない」から「そもそもコメントから何も持ち出さない」へ変わった**（上の 段 1-b 節が正）。
 * ⚠ **ここに変換関数を書き戻さないこと**（戻すなら [`decideEffects`] の中の 1 か所に置く）。
 */

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
 * ## ⚠⚠ 064b: ペイロードで総称化した（**振る舞いは 1 バイトも変えていない**）
 *
 * 064b の時点で発火先が 2 つになった——**エフェクト窓が描く**（当時の `EffectKind`）と
 * **OBS 側のソースを鳴らす**（[`EffectObsSource`]）である。⚠ 後者は
 * **コメビュ窓が発火する**（sidecar の WS ハンドルを持つのがあの窓だけだから）ので、
 * **この関数の呼び出し元が 2 か所になった**。
 *
 * ⚠⚠ **却下した案＝「OBS レーン用に発火判定をもう 1 本書く」。** 本関数が塞いでいる多重発火は
 * 下記の 4 経路で、**そのすべてが OBS レーンでも同じように必要**である
 * （特に [043a] のコミュニティギフト N+1——別実装にすると **OBS のソースが 1 回の贈与で 4 回鳴る**）。
 * ⚠ 同じ規則を 2 通りに書かないのは 061d-2 レビュー S-4 以来の規律。
 *
 * ⚠⚠ **却下した案 2 ＝「`EffectKind` に `obs-source` を足して union を広げる」。**
 * `EffectRequest` に**エフェクト窓が描けない kind** が生まれ、描画分岐が必ず不能ケースを持つ
 * （[`EffectObsSource`] の JSDoc が正）。⇒ **型引数で分ける**——各レーンの matcher は
 * 自分のペイロードしか返さないので、**もう一方のレーンの値が型として流れ込めない**。
 *
 * ⚠⚠⚠ **064 レビュー Q-6（訂正）: `EffectKind` / `EffectRequest` は 064d で削除済み**である
 * （上の 2 つの却下理由は**当時の判断の記録**として残してある。いま在る型ではない）。
 * ⚠ **帰結＝総称のインスタンスは `EffectObsSource` 1 つだけになった。**
 * **いま畳まないのは 063（ガチャ）が 2 本目のレーンを足す前提があるため**で、
 * 畳んで戻すのは往復になる。⚠ **再修正トリガー＝063 が 2 本目を足さないと決まったとき。**
 *
 * ## ⚠⚠⚠ 063b: **2 本目のレーンは足さなかった**（総称は残る）
 *
 * ガチャの出力先も **OBS のソース**なので（064d でエフェクト窓が廃止された結果）、2 本にすると
 * ①**1 コメントが 2 回発火しうる**（レーンごとに「最初の 1 件」を取るため）
 * ②**出力先が 1 つなのにバースト枠が 2 倍になる**——の 2 つが起きる。
 * ⇒ **レーンは 1 本**にし、`select` が 2 kind を通す形にした（`createEffectFireMatcher` の JSDoc が正）。
 * ⚠⚠ **総称は残す**——インスタンスは `EffectObsSource | EffectGacha` の **union 1 つ**だが、
 * 「matcher が返した値がそのまま流れる（本モジュールは中身を 1 つも知らない）」という
 * 型引数の役割は生きている。⚠ **ここに `gachaId` や `prizes` を直接書かないこと**
 * （書いた瞬間、発火層が `effectAssignments.ts` を知ることになり純関数でなくなる）。
 * ⚠ **抽選はこの関数の中でやらない**——理由の全文は `effectFire.ts` の JSDoc が正
 * （要点＝はずれを表現する語彙がここに無い／解決を足すと import が循環する）。
 *
 * ⚠ **レーンを増やすなら [`EffectTriggerState`] を別に持つこと**（呼び出し側の責務）。バースト枠と
 * クールダウンがレーン間で混ざらない＝ 061k が 2 窓で作った構え。
 * ⚠⚠ **063b でレーンが 1 本に確定したので、いま state のインスタンスは 1 つだけである。**
 *
 * 塞いでいる多重発火は **4 経路**（061j でクールダウンが 4 つ目として増えた）:
 * 1. **[043e] Jewels の combo 再送** … `updated` から出さない（下記）。
 * 2. **[043a] Twitch コミュニティギフトの N+1** … 同一投稿者の `gift` を `GIFT_FOLD_WINDOW_MS` 内で 1 件へ。
 * 3. **バースト** … `BURST_WINDOW_MS` に `BURST_MAX` 件まで。超過分は**捨てる**（キューに溜めない）。
 * 4. **061j: 条件ごとのクールダウン** … 同じ条件は `match.cooldownMs` 内で 1 件まで
 *    （＝視聴者が同じ単語を連呼しても画面が埋まらない）。
 */
export function decideEffects<T extends object = EffectObsSource>(
  added: CommentViewDto[],
  updated: CommentViewDto[],
  state: EffectTriggerState,
  now: number,
  matchEffect: EffectMatcher<T>,
): T[] {
  // ⚠⚠ **`updated` は意図的に 1 件も読まない。** [043e] の Jewels は「別メッセージが N 件届く」のではなく
  // 「**同じ 1 件が N 回更新される**」（公式 proto に "For giftEvents, the same ID may be reused to update
  // the combo count" と明記）ので、combo 更新で毎回エフェクトを出すと**1 回の課金で N 回光る**。
  // ⚠ それでも引数に残しているのは、呼び出し側が `mergeComments` の 3 バケットを**そのまま渡せる形**に
  // しておくため。⚠⚠ **063b の抽選は「この層」ではなく `effectFire.ts` に乗った**
  // （本関数が返した＝発火が確定した後に引く。理由はあちらの JSDoc が正）。
  // ⚠ ここを `added.concat(updated)` にする変異は
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

  // ⚠⚠ 063b 段 1-b: **matcher が返した値をそのまま入れる配列**である
  //   （旧 `(EffectRequestBase & T)[]`。⚠ コメント由来の値は 1 つも載らない・上の 段 1-b 節が正）。
  const requests: T[] = [];
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

    // ⚠⚠⚠ 063b 段 1-b: **`match.effect` をそのまま載せる**（旧 `toEffectRequest(c, match.effect)`）。
    //   ⚠ **`c` から値を足さないこと**——ここが「コメント由来の値が 1 つも載らない」の唯一の実装点である（§9）。
    requests.push(match.effect);
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
