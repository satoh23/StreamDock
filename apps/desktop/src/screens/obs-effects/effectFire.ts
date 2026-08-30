import type { CommentViewDto } from "../../features/comment-viewer/types";
import {
  gachaPrizeLabel,
  type EffectGacha,
  type GachaDefinition,
  type GachaPrizeOutput,
} from "./effectAssignments";
import {
  decideEffects,
  type EffectMatcher,
  type EffectObsSource,
  type EffectTriggerState,
} from "./effectTrigger";
import { drawGachaPrizeIndex, isGachaRarePrize } from "./gachaDraw";
// 063h: 記録レーンの視聴者 id。⚠ **既にある共有ヘルパを使う**（`${source}:${author.id}` を書き直さない
//   ——書き直すと視聴者詳細へ飛べない id が静かに生まれる）。
import { viewerIdOf } from "../comment-viewer/viewerFormat";

/**
 * 063b: **「決めた発火」を「実際に出すもの」へ翻訳する 1 か所**（純関数）。
 * ⚠ 063c 段 2-a で戻り値が `string[]`（ソース名）から [`EffectFireResult`]`[]` へ広がった。
 *
 * ## ⚠⚠⚠ なぜこのモジュールが要るのか（抽選の位置がここでしか固定できない）
 *
 * 本タスク最大の設計判断は **「どこで引くか」** で、答えは
 * **「発火が確定してから引く」**（＝畳み込み・バースト上限・クールダウンを全部通した後）である。
 * ⚠⚠ **却下した案は 2 つ**:
 *
 * 1. ⚠⚠⚠ **`select` の中で引く**（＝ガチャを [`EffectObsSource`] へ解決してから返す）… **穴 A**。
 *    `createConditionMatcher` の `select` は **`condition.when` の照合より前**に呼ばれるので、
 *    ①**当たっていない条件でも引く** ②**はずれ（`null`）が「通さない kind」と区別できず次の条件へ落ちる**
 *    ＝ **ガチャを外したら、下に並んだ別の条件が代わりに発火する**。
 *    ⚠ ②は「出ない」を見るテストでは殺せない（**出てはいる**）ので、
 *    `effectFire.test.ts` は **`random` の呼び出し回数**と**鳴ったソース名**の両方で固定している。
 * 2. **[`decideEffects`] の中で引く**（出すと決まった直後に解決）… ⚠ 却下。実現形が 2 つしかなく両方だめ:
 *    ①`effectAssignments.ts` を import する ⇒ **あちらが `effectTrigger.ts` を import しているので循環**
 *    （かつ「発火層は純関数のまま」という現行の層の向きが壊れる）
 *    ②`resolve` コールバックを注入する ⇒ 注入点が 2 本になって契約が「決める」から「決めて解決する」へ変わり、
 *    さらに ⚠⚠ **はずれを表現する語彙が無い**（要素を落とすと「出した件数」と実際が食い違い、
 *    [`EffectObsSource`] へ潰すと「引いたが鳴らすものが無い」を返す形が無い）。
 *
 * ⇒ **合成をこの 1 本に閉じた。** ⚠⚠ **呼び出し側（`CommentViewerApp`）で組み立てないこと**——
 * そうすると 7 つの変異を殺すテストが 2000 行の React コンポーネントの中でしか書けず、
 * テスト側が**本番と違う組み方で組み直す**ことになる（`effectAssignments.test.ts` の
 * 「⚠ **スタブ matcher で代用しないこと**——実測」と同じ罠）。
 *
 * ## ⚠⚠ 「発火＝1 回引いた」と定義する（はずれでも枠を消費する）
 *
 * [`decideEffects`] は**返した時点で** `recentFires` / `lastConditionAt` / `lastGiftAt` に記録済みなので、
 * **はずれ（`-1`）でもバースト枠とクールダウンは消費される**。⚠⚠ **これが既定であり、意図でもある**:
 * 消費しないと**合計 30% のガチャは 7 割の確率で「無料でもう 1 回」**になり、クールダウンが実質無効化する。
 * ⇒ **はずれは「引いた結果、鳴らす音が無かった」だけ**である。
 * ⚠ 消費しない形にするには `recentFires.pop()` 相当の巻き戻しが要り、
 * **「出したときだけ記録する」**（061b / 061j が 2 度踏んで作った不変条件）を壊す。⚠ **やらないこと。**
 *
 * ## ⚠ 同一視聴者の連投を絞っていない理由（回しすぎ防止として足りている）
 *
 * `state.lastGiftAt` は **`gift` 種別だけ**を畳むので、「同一視聴者の連投」を直接絞る仕組みは無い。
 * ⚠ **意図的に足していない**（＝ [`EffectTriggerState`] に視聴者 id の Map を増やしていない）:
 *   - **課金トリガー**（`cooldownMs: 0`）… バースト上限が**窓全体で 5 秒に 3 件**を既に縛る。
 *     ⚠ **お金を払った人の演出を落とす方向へ倒さない**（061j が `cooldownMs: 0` と決めた理由と同じ）。
 *   - **キーワード条件**（`KEYWORD_COOLDOWN_MS = 10_000`）… 条件ごとのクールダウンは**投稿者を問わない**ので、
 *     **同一視聴者の連投は既に 10 秒に 1 回まで**に縛られている。
 * ⚠⚠ **決定的な点**: 視聴者ごとの Map を足して変わるのは「**別の視聴者のキーワードが通りやすくなる**」ことだけで、
 * これは**発火回数が増える方向**＝ 回しすぎ防止の逆である（公平性の機能であって荒らし耐性の機能ではない）。
 * ⚠ **再修正トリガー＝実機で「1 人に占有される」が起きたとき。** そのときは §9 のとおり
 * **メモリ上のみ・永続化しない・表示名も本文も持たない**（`viewerIdOf` ＝ `provider:userId` だけ）で足すこと。
 *
 * ⚠⚠⚠ **2026-08-30: 逆向きの動機で同じ検討が起きたが、足さないと決めた。**
 * 実機報告は「1 人に占有される」ではなく「**別の人が引けない**」
 * （＝ クールダウンが**条件ごと**なので、10 秒の間は誰が打っても発火しない）だった。
 * ⚠⚠ **視聴者ごとの Map へ変えると発火の上限が 1 分に 6 回 → 36 回（6 倍）になり、
 * しかもアカウント数で維持できる**ので、**荒らしの経路になる**。
 * ⇒ **判断と根拠の全文は `effectAssignments.ts` の [`KEYWORD_COOLDOWN_MS`] の JSDoc が正**
 * （⚠ ここに書き写さないこと＝ 2 か所に置くと片方だけ古くなる）。
 *
 * ## ⚠ 回しすぎ防止の定数を 063b で変えていない理由（レビュー Q-7）
 *
 * 4 経路のロジックも定数も **1 バイトも変えていない**が、⚠ **意味は変わった**
 * （「演出が出すぎる」→「**ガチャが回りすぎる**」）ので、そのうえで妥当と判断した根拠を残す:
 *
 * - **バースト上限（5 秒に 3 件）** … ⚠ ガチャに対しては**緩いほうへ倒れて見える**
 *   （演出なら「3 つ同時に光る」で頭打ちだが、ガチャは**当選機会が 3 回**になる）。
 *   ⚠⚠ **それを打ち消しているのが上の「はずれでも枠を消費する」**である——
 *   合計 30% のガチャでも 3 回で枠を使い切るので「無料でもう 1 回」にはならない。
 *   ⇒ **2 つ揃って妥当**であり、片方だけ変えないこと。
 * - **gift の 5 秒畳み込み** … コミュニティギフト N+1 を 1 回に畳む＝「1 課金 1 抽選」。
 *   ガチャでも意味は同じなので**変更不要**。
 * - **条件ごとのクールダウン（10 秒）** … 投稿者を問わないので連投も縛られる（上記の節が正）。
 *
 * ⚠⚠⚠ **再検討トリガー＝ 063f（当選結果をチャットへ書く）に着手するとき。**
 * あちらの sidecar 側スロットル（最短 3 秒）と **5 秒に 3 件が正面衝突する**
 * （3 件目が落ちる）。⚠ **063b の側では今いじらない**——衝突の形が決まるのはあちらだから。
 *
 * ## §9
 *
 * ⚠⚠ **戻り値に載るのは「ユーザー自身が入力した文字列」だけ**＝
 * OBS で自分が付けたソース名と、自分が付けた景品名である（[`EffectFireResult`] の注記が正）。
 * **第三者のコメント本文も表示名も 1 バイトも通らない**（型として載せる場所が無い）。
 * ⚠⚠ **抽選履歴・当選者・視聴者 id を 1 つも保存しない**（この関数は localStorage を**書かない**）。
 * ⚠⚠⚠ **063c 段 2-a 訂正: 「景品名はここには現れない」は成立しなくなった**——
 * 当選景品の名前を**配信画面に出す**のが 063c の目的なので、戻り値が景品名を運ぶ。
 * ⚠ **運んでよい理由＝景品名はユーザー自身の入力だから**であり、この 1 点が §9 の線である。
 */

/** 063b: 発火として流れる値（⚠ **レーンは 1 本**・理由は `createEffectFireMatcher` の JSDoc が正）。 */
export type EffectFire = EffectObsSource | EffectGacha;

/**
 * ⚠⚠⚠ **063c 段 2-a: 発火 1 件の結果**（旧: `string`＝ OBS のソース名だけ）。
 *
 * ## なぜ広げたのか
 *
 * 旧 `decideFireSourceNames` の戻り値は **`string[]`（鳴らす OBS のソース名）**で、
 * ⚠ **景品名を運べなかった**。063c は**景品名そのもの**を配信画面に出すので、
 * 発火層の戻り値を広げるほかない（063c レビュー Q-12 追記 1）。
 * ⚠⚠ **同じ拡張を [063f](../../../../docs/tasks/063f-gacha-chat-output.md)（当選結果をチャットへ書く）も
 * 必要としている**ので、**先に着手する 063c が形を決め、063f はこれに乗る**
 * （2 通りに広げると、片方だけが知らないフィールドを持つ・片方だけ §9 の判断が抜ける）。
 *
 * ## ⚠⚠ [`EffectRequestBase`] を復活させていない
 *
 * 063b 段 1-b は「**コメント由来の値が 1 つも載らない**」ところまで返済した。
 * ⚠⚠⚠ **その返済を無かったことにしないため、足したのは 2 フィールドだけ**である——
 * `name` / `amountText` / `message` / `eventLabel` / `tone` / `id` を**1 つも戻していない**。
 * ⚠ **ここに「誰が引いたか」を足さないこと**（§9・抽選履歴と当選者を持たないという 063c の制約）。
 *
 * ⚠⚠⚠ **2026-08-30（063h）訂正: 上の 1 行は「発火レーンについては」不変だが、
 * 「抽選履歴と当選者を持たない」という前提のほうは反転した。**
 * [`GachaDrawOutcome`] という**記録専用の 2 本目のレーン**ができ、そちらは視聴者 id を持つ
 * （`docs/security.md` §9 追補〔063h〕が正）。
 * ⚠⚠ **この型（発火レーン）には引き続き足さない**——**演出とチャットに要らない値を
 * 配信面へ運ぶ器を作らない**、というのがこの JSDoc の本来の意図だからである。
 * ⇒ **記録に要る値は [`decideFireResults`] の戻り値の `draws` 側にだけ載せること。**
 */
export interface EffectFireResult {
  /**
   * 出力先。⚠ **ガチャ以外の発火（条件に OBS ソースを直指定）は必ず `{kind:"obs-source"}`**。
   * ⚠⚠ `{kind:"builtin"}` はガチャの景品にしか現れない（条件の直指定に組み込みの選択肢は無い）。
   */
  output: GachaPrizeOutput;
  /**
   * ⚠⚠ **ガチャ由来のときだけ非 `null`**（＝ [`GachaFireDetail`]）。
   * ⚠ 条件に OBS ソースを直指定した発火は **`null`**＝「ガチャではない」の意味であり、
   * **「名前が無い」ではない**（無名の景品は [`GACHA_UNNAMED_PRIZE_LABEL`] になる）。
   * ⇒ **受け手はこの `null` でガチャ演出を出すかどうかを決める。**
   *
   * ⚠⚠⚠ **063c 段 3: 3 つを 1 つのオブジェクトへまとめた**（旧: `prizeLabel: string | null` 1 本）。
   * まとめない形（`prizeLabel` / `viewerName` / `rare` を横に並べる）は
   * **「ガチャではないのに `rare: true`」という状態が型で作れてしまう**。
   * ⇒ **3 つは同時に意味を持ち、同時に意味を失う**ので、`null` になる単位を 1 つにした。
   */
  gacha: GachaFireDetail | null;
}

/**
 * ⚠⚠⚠ **063c 段 3: ガチャ由来の発火 1 件について、演出が要る値。**
 *
 * ⚠⚠ **ここへフィールドを足すときは必ず `docs/security.md` §9 を読むこと**——
 * このオブジェクトは**そのままステージ窓（＝ OBS のキャプチャに映る面）へ運ばれる**。
 */
export interface GachaFireDetail {
  /**
   * 当選景品の表示名。⚠ **決めるのは [`gachaPrizeLabel`] 1 か所**（ここで組み立て直さない）。
   * ⚠ **ユーザー自身の入力**である（景品名／自分が OBS で付けたソース名）。
   */
  prizeLabel: string;
  /**
   * ⚠⚠⚠ **引いた視聴者の表示名**（`null` ＝ 空・取得できなかった）。
   *
   * ⚠⚠⚠ **これは第三者の個人データである**（`docs/security.md` §9 の追補が正）。
   * 061b 段 1-b は「発火の戻り値にコメント由来の値を 1 つも載せない」まで返済したが、
   * ⚠ **063c 段 3 で「表示名 1 本だけ」を戻した**——依頼者の要望
   * 「**どのユーザーのガチャなのかが分かるようにしたい**」に、
   * 名前以外で答える方法が無いため。
   * ⚠⚠ **戻したのは表示名だけである**——**コメント本文・視聴者 id・金額・アバターは
   * 型として載せる場所を作っていない**（この 1 フィールドが§9 の線そのもの）。
   * ⚠ 長さは [`GACHA_VIEWER_NAME_MAX`] で切る（[`stageViewerName`] が唯一の入口）。
   */
  viewerName: string | null;
  /**
   * ⚠⚠ **その景品の確率が [`GACHA_RARE_MAX_PERCENT`] 未満か**（演出の「レア！」を出すかどうか）。
   * ⚠ 判定の持ち主は [`isGachaRarePrize`] 1 か所で、**閾値をここにも演出側にも書かない**。
   */
  rare: boolean;
}

/**
 * ⚠⚠⚠ **063c 段 3: 演出へ運ぶ表示名の最大文字数**（超えたぶんは切って `…` を付ける）。
 *
 * ⚠⚠ **これは検証ではない**（§8 の「2 通り目の検証を作らない」に抵触しない）——
 * **制御文字の拒否と trim は Rust 側の取り込みが既に済ませている**（`docs/security.md` ⑪）。
 * ここがやるのは **①配信画面のレイアウトを守る ②§9 の露出を短くする**の 2 つだけである。
 * ⚠ 20 文字は「主要サービスの表示名がだいたい収まる長さ」であって、**規格ではない**。
 */
export const GACHA_VIEWER_NAME_MAX = 20;

/**
 * ⚠⚠⚠ **063h: 抽選 1 回の記録**（＝ **2 本目のレーン**・`docs/security.md` §9 追補〔063h〕が正）。
 *
 * ## ⚠⚠ なぜ [`EffectFireResult`] と別の型なのか（**却下した案が 3 つある**）
 *
 * 1. ⚠⚠⚠ **却下: `EffectFireResult` に「何も出ない」の variant を足す。**
 *    下流（`emitGachaStageResult` と `sendGachaChat`）が**明示的に無視することでしか安全にならない**。
 *    ⚠ 1 か所忘れると、**何も当たっていないのに演出が出てチャットに投稿される**
 *    ——**視聴者に見えて、あとから消せない**（§1 の 066 節）。
 *    ⇒ **「発火ではないもの」を発火の配列に混ぜない。**
 * 2. ⚠⚠ **却下: 記録のために `CommentViewerApp` でもう一度抽選する。**
 *    **確率が二重に引かれる**（当たった景品と記録が食い違う）。
 * 3. ⚠ **却下: `decideEffects`（`effectAssignments.ts`）の戻り値を広げる。**
 *    あそこは **061b 段 1-b が「戻り値にコメント由来の値を 1 つも載せない」を実装している
 *    唯一の場所**で、広げると §9 の線が発火層まで後退する。
 *
 * ## ⚠⚠⚠ この型の値は配信面へ 1 バイトも出ない
 *
 * `emitGachaStageResult`（演出）にも `sendGachaChat`（チャット）にも渡らない。
 * ⚠ **それが「切っていない表示名を載せてよい」ことの根拠である**（§9 追補〔063h〕の
 * 「線をレーンごとに引き直す」節が正）。⚠⚠ **ここから配信面へ値を渡す経路を作らないこと。**
 */
export interface GachaDrawOutcome {
  /** 引き金になったコメント id（⚠ **記録 id の材料であって、保存する列ではない**＝穴 A）。 */
  commentId: string;
  /**
   * ⚠ **そのコメントの中で何回目のガチャ抽選か**（0 始まり・穴 A）。
   *
   * ⚠⚠ **数えるのはガチャの発火だけである**——条件に OBS ソースを直指定した発火を含めると、
   * 「同じコメントで OBS 直指定とガチャが両方当たったときだけ番号がずれ」、
   * **条件を 1 本消すと記録 id が変わる**（＝二重記録の抑止が壊れる）。
   * ⚠ バッチ内の通し番号にもしないこと（同じコメントが別のバッチで来ると値が変わる）。
   *
   * ## ⚠⚠ 063h レビュー Q-1: これは **`gachaId` 横断の通し番号**である（**`gachaId` ごとではない**）
   *
   * ⚠ **上の「条件を 1 本消すと記録 id が変わる」を防げているのは OBS 直指定の発火に対してだけ**で、
   * **ガチャ条件どうしでは防げていない**——将来 1 コメントから A / B / A の順に発火するようになると
   * 3 件目は `A:2` になり、**B の条件を消すと `A:1` へ変わる**。
   * ⚠⚠ **現状は `nth` がつねに 0 なので実害はゼロである**（`decideEffects` は 1 コメントにつき
   * 最大 1 件しか返さない＝`effectFire.test.ts` の「nth は 0」が固定している）。
   * ⇒ **いまは通し番号のままでよい**（`Map<gachaId, number>` を持つのは、動かない値のための構造を
   * 1 つ増やすだけになる）。
   * ⚠ **再修正トリガー＝`decideEffects` が 1 コメントから複数件返す形になったとき。**
   *   そのときは **`gachaId` ごとのカウンタへ変える**こと（この段落が目的の記述である）。
   */
  nth: number;
  /** `provider:providerUserId`（⚠⚠ **記録レーンだけが持つ**・`viewerIdOf` が作る）。 */
  viewerId: string;
  /**
   * ⚠⚠⚠ **切っていない表示名**（[`stageViewerName`] の 20 文字 ＋ `…` は通さない・穴 D）。
   *
   * ⚠ 20 文字で切るのは**配信面へ出すための整形**であって検証ではない。DB に持ち込むと
   * 「**サマリーの名前だけ末尾が `…`**」になり、配信者が誰か分からなくなる。
   * ⚠ 空文字を許す（provider によっては取れない）。上限（§8）は Rust 側が別に持つ。
   */
  viewerName: string;
  gachaId: string;
  /** 抽選した時点のガチャ名（⚠ ユーザー自身の入力）。 */
  gachaName: string;
  /**
   * ⚠⚠ **`null` ＝ 何も出なかった**（＝ 1 回の抽選として記録する）。
   *
   * ⚠⚠⚠ **当たりのときは [`gachaPrizeLabel`] が決めた値をそのまま入れる**——
   * `prize.name` を直接読まないこと。**名前が空の当たり**は `GACHA_UNNAMED_PRIZE_LABEL`
   * （＝「当たり」）になるが、直読みすると `null` になり、
   * **配信サマリーに「何も出ない」と出る＝当たったのに外れたことになる。**
   */
  prizeLabel: string | null;
  rare: boolean;
  /**
   * ⚠⚠ **抽選した瞬間の時刻**（RFC3339）。
   *
   * ⚠⚠⚠ **Rust の保存時刻で代用しない**——セッション id が未確定のあいだ記録はバッファに貯まるので、
   * 保存時刻だと「**流した時刻**」になり、**配信サマリーの並びが実際の抽選順と食い違う**
   * （`docs/security.md` §9 追補〔063h〕の §8 の項が正）。
   * ⚠ 検証（RFC3339 としてパースできること）は Rust 側の `util::require_rfc3339`。
   *
   * ## ⚠⚠ 063h レビュー Q-2: **同じバッチの抽選はこの値が全件同値になる**
   *
   * 呼び出し側は `new Date().toISOString()` を**バッチにつき 1 回**作って全件へ配る
   * （＝本関数を決定的に保つため・[`decideFireResults`] の `@param drawnAt` が正）。
   * ⇒ ⚠ **「並びが実際の抽選順と食い違わない」が守れているのはバッチ単位までである。**
   * バッチ内（＝複数人が同時に引いたとき）の同点崩しは Rust の索引の `id DESC`＝
   * **記録 id の辞書順**になり、**抽選順とは無関係**（逆順にもなりうる）。
   * ⚠⚠ **これは受容している**——同一バッチは実時間で同時であり、順序に意味が無い。
   * ⚠ **再修正トリガー＝配信サマリー（063i）で「同時刻の数件の並びが毎回変わる／逆に見える」が
   *   問題として挙がったとき。** そのときは `drawnAt` をずらすのではなく、
   *   **記録側に挿入順の列を足す**こと（時刻を偽ると「抽選した時刻」の意味が壊れる）。
   */
  drawnAt: string;
}

/**
 * [`decideFireResults`] の戻り値（⚠⚠ **2 本のレーン**）。
 *
 * ⚠⚠⚠ **`fires` は 063h の前とまったく同じ中身である**（当たりだけ・[`GachaFireDetail`] も無改変）。
 * ⇒ **063c（演出）と 063f（チャット投稿）のコードは 1 バイトも変わっていない。**
 */
export interface FireDecision {
  /** 演出・チャット・OBS へ流すもの（⚠ **当たりだけ**・はずれはここに現れない）。 */
  fires: EffectFireResult[];
  /**
   * ⚠ **記録するもの**（**抽選が起きた回数ぶん**並ぶ＝何も出なかった抽選も 1 件）。
   * ⚠⚠ **条件に OBS ソースを直指定した発火はここに現れない**（ガチャではないので抽選が無い）。
   */
  draws: GachaDrawOutcome[];
}

/**
 * ガチャ 1 件を引いて、[`EffectFireResult`] を返す（⚠ **はずれ・見つからない・景品 0 件はすべて `null`**）。
 *
 * ⚠⚠ **抽選は [`drawGachaPrizeIndex`] をそのまま使う**（063a）。置き換えると
 * 「テスト抽選で見た確率」と「本番の確率」が別実装になり、
 * **063 唯一の差別化点＝％が信用できること**が壊れる（あちらの JSDoc が正）。
 * ⚠⚠⚠ **`-1`（はずれ）を「最後の景品」へ倒さないこと**——倒すと「合計 30% なのに必ず何か当たる」になる。
 *
 * ⚠⚠ **一覧に無い `gachaId` は `null`**（＝何も鳴らさない）。**黙って別のガチャへ化けさせない**
 * ——先頭へフォールバックさせると「削除したガチャの条件が、新しく作った別のガチャを鳴らす」が起きる
 * （064b の「指す先が消えていたら出さない」と同じ規律で、`EffectGacha` の id を詰めない理由と対）。
 *
 * ⚠ **検証を新設しない**（§8）——景品の形式検査は `parseGachaPrize` / `parseGachaDefinition` が
 * `loadGachaLibrary` の中で既に済ませている。ここで 2 通り目を書くと**片方だけ緩む**。
 * ⚠ ソース名の実在照合は sidecar 側（064a の `GetInputList` 突き合わせ）が壁なので、
 * **景品の `sourceName` も OBS ソース直指定とまったく同じ経路**を通る。
 * ⚠⚠⚠ **063c 段 2-a: `{kind:"builtin"}` の景品はその経路へ入らない**——
 * wire に 1 バイトも載らず、ステージ窓が自分で描く（[`GachaPrizeOutput`] の注記が正）。
 */
function drawGachaResult(
  fire: EffectGacha,
  gachas: readonly GachaDefinition[],
  random: () => number,
  viewerName: string | null,
  // ⚠⚠⚠ 063h: **記録レーンを作るための入力**（発火レーンには 1 つも載せない）。
  record: { comment: CommentViewDto; nth: number; drawnAt: string },
): { fire: EffectFireResult | null; draw: GachaDrawOutcome | null } {
  const gacha = gachas.find((g) => g.id === fire.gachaId);
  // ⚠⚠ 一覧に無いガチャは**抽選そのものが起きていない**ので、記録もしない
  //   （「引いたが何も出なかった」ではなく「引けなかった」＝別物）。
  if (gacha === undefined) return { fire: null, draw: null };
  const index = drawGachaPrizeIndex(gacha.prizes, random);
  // ⚠⚠ `-1` ＝ **何も当たらなかった**（合計が 100% 未満なら正常に起きる）／景品 0 件も同じ `-1`。
  const prize = index < 0 ? null : gacha.prizes[index];
  // ⚠⚠ 063c 段 2-a: **表示名の規則をここに書かないこと**（[`gachaPrizeLabel`] が唯一の持ち主）。
  //   ⚠ 書くと「設定画面の表の名前」と「配信画面に出る名前」が別実装になる。
  // ⚠⚠ 063c 段 3: **レアかどうかも同じ規律**（閾値は [`isGachaRarePrize`] だけが知っている）。
  // ⚠⚠⚠ 063h: **記録レーンも同じ 2 つの関数を通す**——`prize.name` を直読みすると、
  //   **名前が空の当たり**が `null` になって配信サマリーに「何も出ない」と出る（＝当たったのに外れる）。
  // ⚠ 1 つのオブジェクトに畳んであるのは、**当たりの 3 つが同時に意味を持つ**からである
  //   （`GachaFireDetail` の 3 つを 1 つの `null` にまとめた 063c 段 3 と同じ理由）。
  const won =
    prize === null
      ? null
      : {
          label: gachaPrizeLabel(prize),
          rare: isGachaRarePrize(prize.weight),
          output: prize.output,
        };
  const draw: GachaDrawOutcome = {
    commentId: record.comment.id,
    nth: record.nth,
    viewerId: viewerIdOf(record.comment),
    // ⚠⚠ **切っていない生値**（`stageViewerName` を通さない＝穴 D・§9 追補〔063h〕）。
    viewerName: record.comment.author.name,
    gachaId: gacha.id,
    gachaName: gacha.name,
    prizeLabel: won?.label ?? null,
    rare: won?.rare ?? false,
    drawnAt: record.drawnAt,
  };
  // ⚠⚠⚠ **何も当たらなかった抽選は `fire` が `null`** ＝ 演出もチャットも OBS も動かない。
  //   ⚠ **記録だけが残る**（本タスクの中心）。
  if (won === null) return { fire: null, draw };
  return {
    fire: {
      output: won.output,
      // ⚠ 発火レーンは**上で決めた値を使い回す**（2 通り目の計算をしない）。
      gacha: { prizeLabel: won.label, viewerName, rare: won.rare },
    },
    draw,
  };
}

/**
 * ⚠⚠⚠ **063c 段 3: 演出へ運ぶ表示名を作る唯一の入口**（`null` ＝ 出さない）。
 *
 * ⚠⚠ **ここが `docs/security.md` §9 追補の実装点である。**
 * **`c` から読むのは `author.name` の 1 本だけ**——本文・視聴者 id・金額・アバターは読まない
 * （読まないことを**この関数の短さで見えるように**してある）。
 *
 * ⚠ **切るときはコードポイント単位**（`[...name]`）で数える。`slice` で切ると
 * **絵文字や結合文字を途中で割って壊れた文字が配信画面に出る**（表示名に絵文字は普通に入る）。
 * ⚠⚠ **検証は書かない**（§8）——制御文字の拒否と trim は Rust 側の取り込みが済ませている。
 */
function stageViewerName(c: CommentViewDto): string | null {
  const chars = [...c.author.name];
  if (chars.length === 0) return null;
  if (chars.length <= GACHA_VIEWER_NAME_MAX) return c.author.name;
  return `${chars.slice(0, GACHA_VIEWER_NAME_MAX).join("")}…`;
}

/**
 * このバッチの**発火の結果**を決める。⚠ **`state` は [`decideEffects`] が破壊的に更新する。**
 *
 * ⚠⚠ **063c 段 2-a で `decideFireSourceNames` から改名した**（戻り値が `string[]` から
 * [`EffectFireResult`]`[]` になり、「ソース名を決める」という名前が嘘になったため）。
 *
 * @param added   まだ発火判定に通していないコメント（`takeFreshComments` を通したもの）
 * @param updated ⚠ **1 件も読まない**（[043e] の Jewels combo 再送。[`decideEffects`] が捨てる）
 * @param state   時間窓の状態。⚠ **レーンは 1 本なので 1 インスタンスだけ**
 * @param now     現在時刻(ms)。⚠ **引数で受ける**ので本関数は決定的
 * @param matchEffect `createEffectFireMatcher()` の戻り値
 * @param loadGachas ガチャの一覧を読む（⚠ **ガチャの発火が 1 件でもあるときだけ 1 回呼ぶ**）。
 *   ⚠⚠ **鳴らす直前に読み直すのが意図である**——matcher が呼ばれるたびに条件を読み直しているのと同じ規律で、
 *   **main 窓でガチャを編集した直後の 1 件目から効く**。⚠ バッチの先頭で 1 回に固定しないこと。
 * @param random 乱数。⚠⚠ **演出用であって暗号用途ではない**（呼び出し側は `Math.random` を渡す）。
 *   ⚠ 「不正防止に `crypto.getRandomValues` では」への答え＝ **当選結果は端末内で完結し、
 *   視聴者側は結果を検証も予測もできない**（配信画面に出るだけ）ので、予測困難性に守る対象が無い。
 *   ⚠ **引数で受けるのはテストで確率を固定するため**（直接 `Math.random` を呼ぶと規則を固定できない）。
 * @param drawnAt ⚠⚠⚠ **063h: 記録に載せる抽選時刻**（RFC3339）。**引数で受ける**ので本関数は決定的である
 *   （`now` を数値で受けているのと同じ理由）。⚠ 呼び出し側は `new Date().toISOString()` を渡す。
 *   ⚠⚠ **Rust の保存時刻で代用しない**——セッション未確定のあいだ記録はバッファに貯まるので、
 *   保存時刻だと「流した時刻」になり、**配信サマリーの並びが実際の抽選順と食い違う**。
 *   ⚠ 同じバッチの抽選は**同じ値**になる（＝並びの同点崩しは記録 id 側が持つ・Rust の索引の注記が正）。
 *   ⚠⚠ **063h レビュー Q-2: その同点崩し（記録 id の辞書順）は「抽選順」ではない。**
 *   ⇒ 上の「並びが食い違わない」が守れているのは**バッチ単位まで**である
 *   （受容の理由と再修正トリガーは [`GachaDrawOutcome.drawnAt`] の注記が正）。
 * @returns ⚠⚠⚠ **063h: 2 本のレーン**（[`FireDecision`]）。`fires` は**中身も順序も 063h の前と同じ**で、
 *   `draws` が**抽選が起きた回数ぶん**（何も出なかったものを含む）並ぶ。
 */
export function decideFireResults(
  added: CommentViewDto[],
  updated: CommentViewDto[],
  state: EffectTriggerState,
  now: number,
  matchEffect: EffectMatcher<EffectFire>,
  loadGachas: () => readonly GachaDefinition[],
  random: () => number,
  drawnAt: string,
): FireDecision {
  // ⚠ 一覧はバッチ内で 1 回だけ読む（同じバッチの中でガチャが書き換わることはない）。
  //   ⚠⚠ ガチャの発火が 1 件も無いバッチでは **`loadGachas` を 1 度も呼ばない**（`null` のまま）。
  let gachas: readonly GachaDefinition[] | null = null;
  const results: EffectFireResult[] = [];
  // ⚠⚠⚠ 063h: **記録レーン**（`results` とは別の配列＝混ぜない・[`GachaDrawOutcome`] の注記が正）。
  const draws: GachaDrawOutcome[] = [];
  // ⚠⚠⚠ **063c 段 3: [`decideEffects`] を「コメント 1 件ずつ」呼ぶ。**
  //
  //   ⚠ **バッチごと渡した場合と結果は完全に同じである**——あちらの本体は `added` を回すループで、
  //   ループの外にあるのは**時間窓の掃除だけ**（`now` が同じなら何度走らせても同じ＝冪等）。
  //   ⚠⚠ 既存テストの `comments.flatMap((c) => decideEffects([c], ...))` が同じ前提に立っている。
  //
  //   **なぜそうするのか＝「どのコメントがこの発火を起こしたか」を知るため**である（§9 追補・表示名）。
  //   ⚠⚠⚠ **却下した案: `decideEffects` の戻り値を `{ effect, viewerName }` へ広げる。**
  //   あれは **061b 段 1-b が「戻り値にコメント由来の値を 1 つも載せない」を実装している唯一の場所**で、
  //   広げると **§9 の線が発火層まで後退する**（＝ OBS レーン・イベントレーンも名前を運べる形になる）。
  //   ⇒ **線は 063c が持つこの関数に留めた**（あちらは 1 バイトも変えていない）。
  //
  //   ⚠⚠⚠ **`decideEffects` に「バッチ全体を見る規則」を足すなら、先にここを直すこと**
  //   （例: 1 バッチあたりの上限）。足した瞬間、1 件ずつ渡す本関数だけがその規則をすり抜ける。
  //
  //   ## ⚠ 計算量（063c 段 5 レビュー ②・受容）
  //
  //   1 件ずつ呼ぶと、あちらの**時間窓の掃除がコメントの数だけ走る**。⚠ それでも問題にならない:
  //     - `recentFires` … **要素数は最大 3**（`BURST_MAX` 未満のときしか push されない）。
  //     - `lastGiftAt` … 5 秒窓に居る gift 投稿者だけ。
  //     - `lastConditionAt` … 条件の件数（ユーザーが作った数）。
  //   ⇒ 増えるのは **O(コメント数 × (gift 投稿者数 ＋ 条件数))** で、
  //   ⚠⚠ **`matchEffect` が元から O(コメント数 × 条件数)** なので**オーダーは変わっていない**。
  //   ⚠ バーストで悪化しない理由が構造的（`recentFires` が 3 で頭打ち）である点が効いている。
  //   ⚠⚠ **再修正トリガー＝あちらの掃除が「窓の中の件数」に比例しなくなったとき**
  //   （例: `lastConditionAt` を条件ごとの履歴配列にする）。そのときは掃除だけを
  //   ループの外へ出す形（`decideEffects` を分割する）を先に検討すること。
  for (const comment of added) {
    // ⚠⚠ **多重発火の抑制 4 経路はすべてこの 1 行の向こう側にある**
    //   （①`updated` を読まない ②同一投稿者の gift の畳み込み ③バースト上限 ④条件ごとのクールダウン）。
    //   ⚠ **ガチャのために作り直さないこと**（061d-2 レビュー S-4 の「同じ規則を 2 通りに書かない」）。
    const fires = decideEffects<EffectFire>(
      [comment],
      updated,
      state,
      now,
      matchEffect,
    );
    if (fires.length === 0) continue;
    // ⚠ 表示名を取り出すのは**発火が確定した後**（＝出さないコメントの名前は 1 文字も触らない）。
    const viewerName = stageViewerName(comment);
    // ⚠⚠⚠ 063h 穴 A: **このコメントの中で何回目のガチャ抽選か。**
    //   ⚠ **ガチャの発火だけを数える**（`fires` の index を使わない）——OBS ソース直指定の発火を
    //   含めると、同じコメントで両方当たったときだけ番号がずれ、**条件を 1 本消すと記録 id が変わる**。
    //   ⚠ `for` の外（バッチ全体）で数えないこと（同じコメントが別のバッチで来ると値が変わる）。
    let nth = 0;
    for (const fire of fires) {
      switch (fire.kind) {
        case "obs-source":
          // ⚠⚠ 063c 段 2-a: **条件への直指定は `gacha: null`**＝「ガチャではない」の明示。
          //   ⚠ ここに景品名や表示名を作らないこと
          //   （ガチャを経由していないので当たった景品が存在せず、演出も出ない）。
          results.push({ output: fire, gacha: null });
          break;
        case "gacha": {
          // ⚠⚠ **抽選はここ**＝ 畳み込み・バースト上限・クールダウンを**すべて通った後**である。
          //   ⚠ ここより前（`select` の中／`decideEffects` の中／ループの外）へ動かさないこと。
          if (gachas === null) gachas = loadGachas();
          const { fire: result, draw } = drawGachaResult(
            fire,
            gachas,
            random,
            viewerName,
            { comment, nth, drawnAt },
          );
          // ⚠⚠⚠ 063h: **抽選が起きたぶんだけ番号を進める**（当たったかどうかは見ない）。
          //   ⚠ 一覧に無いガチャは抽選そのものが起きていないので `draw` が `null` ＝ 進めない。
          if (draw !== null) {
            draws.push(draw);
            nth += 1;
          }
          // ⚠ 何も出ない・一覧に無い・景品 0 件は**何も鳴らさない**（枠は既に消費済み＝上記「発火＝1 回引いた」）。
          //   ⚠⚠⚠ **063h でもここは変えていない**——`results` に入るのは当たりだけである
          //   （何も出なかった抽選が演出やチャットへ流れると、視聴者に見えて消せない）。
          if (result !== null) results.push(result);
          break;
        }
        default: {
          // ⚠⚠ **前方互換の 3 枚目**（1 枚目＝`parseAssignment` の未知 kind → `none`、
          //   2 枚目＝`createEffectFireMatcher` の `!== "none"`）。⚠ **`never` なので kind が増えると
          //   コンパイルが落ちる**＝「知らない発火先が黙って捨てられる／黙って鳴る」の両方を型で塞ぐ。
          // ⚠⚠⚠ **レビュー Q-6（訂正）: これは「同時に落ちる 2 枚目」ではなく「順に落ちる 2 段目」である。**
          //   `EffectFire` は `EffectAssignment` から**導出していない手書きの union** なので、
          //   `EffectAssignment` に 4 本目を足しても**ここは落ちない**。実測で落ちるのは
          //   `createEffectFireMatcher` の 1 か所だけ（`TS2322`）。
          //   ⚠ そこを直す → 戻り型を広げる → `decideFireSourceNames` の引数と合わなくなる →
          //   `EffectFire` を広げる → **そこで初めてこの `never` が落ちる**、という連鎖になる。
          //   ⚠⚠ **結論は変わらない**（どのみち判断を強制される）が、
          //   **「4 本目を足した瞬間に 2 か所落ちる」とは読まないこと。**
          const unreachable: never = fire;
          void unreachable;
        }
      }
    }
  }
  return { fires: results, draws };
}
