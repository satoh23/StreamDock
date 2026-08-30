import {
  EFFECT_ASSIGNMENTS_KEY,
  GACHA_LIBRARY_KEY,
} from "../../features/comment-viewer/overlaySettings";
import type { CommentEventType } from "../../features/comment-viewer/bindings/CommentEventType";
import { EFFECT_CONDITION_EVENT_TYPES } from "../comment-viewer/viewerFormat";
import type {
  EffectMatch,
  EffectMatcher,
  EffectMatchInput,
  EffectObsSource,
} from "./effectTrigger";

/**
 * 061d-2 / **061j**: **どんなコメントで、どのエフェクトを出すか**（localStorage の読み書きと解決）。
 *
 * ⚠⚠ **ここは「条件」だけを持つ層で、発火の判定も描画も持たない。**
 * `decideEffects`（061b）へは [`resolveEffectMatch`] を **matcher として渡す**だけで、
 * `effectTrigger.ts` は本モジュールを import しない（＝発火層は純関数のまま・①）。
 *
 * ⚠ 置き場所が `features/` ではなく `screens/obs-effects/` なのは `effectTrigger.ts` と同じ理由
 * （唯一の消費者＝この画面とエフェクト窓に同居させ、`features/` → `screens/` の層の逆転を作らない）。
 *
 * ## ⚠⚠ 061j: 保存形が `Record<eventType, Assignment>` から**条件の配列**になった
 *
 * イベント種別 6 つでは「〇〇という単語を含むコメント」を**表現する型が無かった**（061h〜061l の
 * UX 再設計が挙げた破綻の 1 つ）。⚠ **却下したのは `{ events: Record<…>, keywords: […] }` の 2 本立て**——
 * 既存のロジックとテストがほぼ無改変で済むぶん今回は安いが、**061k で「条件ごとに出力先
 * （全画面 / コーナー）を選ぶ」を足すとき、同じフィールドを 2 か所へ書く**ことになるため。
 *
 * ⚠⚠ **ファイル名と localStorage のキーは変えていない**（`effectAssignments.ts` /
 * [`EFFECT_ASSIGNMENTS_KEY`]）。理由は 2 つで、**どちらも意図的な非対称**である:
 *   1. **`git log --follow` を切らない**（061d-1 の先例）。中身の作り直しでファイルを改名すると、
 *      「なぜこの形になったか」を辿る唯一の手段が失われる。
 *   2. ⚠⚠ **キーを変えると旧キーが残骸として残り、どちらが正か分からなくなる**。同じキーなら
 *      **旧ビルドへ戻したときも `Array.isArray` の検査で弾かれて「全部出さない」＝安全側**へ倒れる
 *      （061h が作った「未知は安全側」と同じ向き）。
 *
 * ⚠ **語彙の線**（3 通りに散らさないための約束）:
 *   - **条件（condition）＝ いつ出すか** … [`EffectCondition`] / [`loadEffectConditions`] /
 *     [`effectConditionCount`] / [`resolveEffectMatch`]
 *   - **割り当て（assignment）＝ 何を出すか** … [`EffectAssignment`] / [`DEFAULT_EFFECT_ASSIGNMENT`]
 *   `EffectCondition.effect: EffectAssignment` がその線をそのまま表している。
 *
 * ## ⚠⚠ 壊れ方の方針（061h で 061d-2 の ⑪ を反転した）
 *
 * ⚠⚠ **読み取れなかった値はすべて「出さない」へ倒れる。** 「出す」側へ倒れてよい経路は
 * **ユーザーが自分でテンプレートを選んだとき 1 本だけ**である。
 *
 * ⚠ **061d-2 は逆を選んでいた**（`{"kind":"none"}` 以外はすべて「組み込み」へ倒す）。当時の理由は
 * 「全『なし』へ倒すと **061d のリリースで既存ユーザーの組み込みエフェクトが黙って止まる**」で、
 * これは**当時の判断としては正しかった**——組み込み意匠が既定の表示手段だったので、
 * 「アップデートしたら配信画面から投げ銭エフェクトが消えた」が最悪の壊れ方だった。
 *
 * ⚠⚠ **その前提が消えたので反転した**（061h）。運用方針が
 * 「エフェクトは各々が使いたいものを取り込んで割り当てる・組み込みは不要・既定は非表示」に固まり、
 * 組み込み意匠そのものを廃止したため、**倒れる先が構造的に存在しない**。実害の向きも逆転している:
 *   - 条件を設定していない状態で投げ銭が来ると、**頼んでいない演出が配信画面に出る**
 *   - 割り当てたテンプレートが壊れていても**組み込みが出て「動いている」ように見える**（気づけない）
 *   - 「出さない」を選ばない限り必ず何か出るので、**一時的に止める手段が実質無い**
 * ＝ いまは「**黙って出る**」が最悪の壊れ方で、「出ない」は
 * **main 窓の警告（`EffectAssignmentCard` の `missing`）で観測できる**側の壊れ方である。
 * ⚠ これは `effectMedia.ts` / `EffectOverlayApp` の `fire()` と**同じ向き**で、
 * 「壊れたときに何が出るか」の答えを 2 種類作らないためでもある。
 * ⚠ **旧方針へ戻さないこと**（判断の全文は docs/progress.md の 061h 節）。
 *
 * ## §9
 *
 * ⚠ 保存するのは **イベント種別（`EFFECT_CONDITION_EVENT_TYPES` の値）・テンプレート id（uuid v4）・
 * ユーザー自身が打ったキーワード**と、⚠⚠ **063e 段 3-b で増えた「ユーザーが打ったカスタム報酬名」**
 * （`when.rewardTitle`・`cp:` の行）だけ。第三者の個人データ（本文・表示名・金額）は 1 バイトも入らない。
 * ⚠ **報酬名が第三者データでない根拠**＝ `reward.title` を書けるのは**配信者本人**と
 * **配信者自身が `channel:manage:redemptions` を許可したアプリ**だけで、視聴者・モデレーターは書けない
 * （購読はブロードキャスター本人のトークンでしか通らないので、届くのも必ず自チャンネルの報酬名である）。
 * ⇒ OBS のソース名・キーワードと同じ「**ユーザー自身の設定値**」の側である。
 * ⚠⚠ **061j でこの層に第三者のコメント本文が流れ込むようになった**（[`resolveEffectMatch`] の引数）。
 * 担保は**型**である＝ [`EffectMatchInput`] は `{ eventType, text, rewardTitle }` だけを受け
 * （⚠ 063e 段 3 で `rewardTitle` が増えた。上記のとおり第三者のデータではない）、
 * [`EffectMatch`] は **`{ effect, conditionId, cooldownMs }` の 3 キーだけ**で本文も報酬名も載せない
 * （⚠ 064d 以前はここに「`EffectRequest` は 8 キーのまま無改変」と書いていたが、
 * **その型は 064d で全廃済み**なので、いまの担保は [`EffectMatch`] の 3 キーである）。
 * ⚠ **本文を localStorage にも DOM にもログにも出さない**
 * （`eslint.config.js` の `no-console` が `src/screens/obs-effects/**` に効いている）。
 * ⚠ **キーワードはユーザー自身の UI 設定値**なので localStorage に保存してよい
 * （`docs/security.md`「レビュー必須条件」の保存ポリシー項が明示的に除外している）。
 * ⚠ **ただしエフェクト窓の DOM にも [`EffectMatch`] にも出さない**——出す理由が無く、出すと
 * 「条件に書いた単語が配信画面に出る」という予期しない露出になる。
 */

/**
 * 割り当て 1 行の値＝**何を出すか**。
 *
 * ⚠⚠ **`{ kind: "none" }` を発火層の型（`EffectObsSource` 等）と混ぜない。** 「出さない」は
 * **発火するかどうか**の判断であって「何を鳴らすか」ではないので、発火層側の union へ入れると
 * **鳴らせない kind** が生まれてしまう（発火分岐が必ず不能ケースを持つ）。
 * ここで受け取り、matcher が `null` へ翻訳して発火層へ渡す。
 *
 * ⚠⚠ **064d で `{ kind: "template"; templateId }`（取り込んだテンプレート）を削除した。**
 * 064 でエフェクトは **OBS 側のソースを鳴らす**方式になり、取り込み機能ごと消えたため。
 * ⚠ **旧ビルドが保存した `{"kind":"template"}` は「未知の kind → 出さない」へ安全側に倒れる**
 * ——061h から積み上げてきた前方互換が、そのまま**後方互換**としても効いている
 * （移行コードを 1 行も書かずに済んだのはこの形のおかげ）。
 *
 * ⚠⚠ **063a で `{ kind: "gacha"; prizes }` を足した**（[`EffectGacha`]）。予告どおり
 * 下の [`parseAssignment`] に 1 分岐足しただけで、**旧ビルドは「未知の kind → 出さない」へ
 * 安全側に倒れる**（＝前方互換）。この前方互換があるので、保存形に `version` フィールドは
 * 持たせていない（版番号にすると「版が違う＝全部捨てる」というより粗い壊れ方を新しく作ることになる）。
 * ⚠ **061h の移行もこの仕組みがそのまま担う**——既に保存されている
 * `{"kind":"builtin-monetary"}` は**未知の kind として「出さない」へ倒れる**。
 *
 * ⚠⚠⚠ **063a: 「gacha を古いビルドが読むと『出さない』へ倒れる」ことは、
 * もうこのビルドのテストでは表現できない**（このビルドでは gacha は既知の kind だから）。
 * ⇒ `effectAssignments.test.ts` のガードは **gacha 以外の未知 kind** で書いてある。
 * ⚠ **「前方互換が消えた」と誤読しないこと**——仕組み（未知 kind → 既定）はそのまま生きており、
 * 次に足す kind に対して同じように働く。**ガードのテストを消さないこと。**
 */
export type EffectAssignment = { kind: "none" } | EffectObsSource | EffectGacha;

/**
 * 063a: **ガチャの景品 1 件**（＝表の 1 行）。
 *
 * ⚠⚠ **列は 4 つだけ**（[063s](../../../../docs/tasks/063s-tanuesa-gacha-spike.md) の (7) が正）:
 * 景品名 / 重み / 確率（自動計算・**保存しない**）/ OBS のソース名。
 * ⚠ たぬえさ3 が景品ごとに持っているクールタイム・利用可能ユーザー・禁止ユーザー・コンボ値は
 * **足さない**（あちらの複雑さの側であり、クールダウンは条件ごとに [`KEYWORD_COOLDOWN_MS`] が既に持つ）。
 *
 * ⚠⚠ **確率をフィールドに持たないことが設計の要点である。** 保存すると重みと確率がずれ、
 * 「画面の％と実際の当たり方が違う」という**画面から理由が読めない**壊れ方になる。
 * 確率は常に `weight / 合計` から導出する（[`gachaDraw.ts`](./gachaDraw.ts) が唯一の持ち主）。
 */
export interface GachaPrize {
  /**
   * 景品名。⚠ **空文字を許す**（＝任意）。
   *
   * ⚠⚠ 本タスクの芯は「**入力の手数の少なさ**」なので、必須にしない。空のときの表示は
   * [`gachaPrizeLabel`] が 1 か所で決める（⚠⚠ **063c 段 2-a で `GachaPrizeTable` から移した**——
   * 当たった景品の名前が**配信画面にも出る**ようになったので、規則の持ち主が画面の中では足りない）。
   * ⚠ それでも列を残すのは、OBS のソース名が `hazure_01.mp4` のような機械的な名前になりがちで、
   * **「大当たり」と呼べないと確率表が読めなくなる**ため（063s (7) の列がそのまま生きている）。
   */
  name: string;
  /**
   * 重み。⚠ **1 以上 [`GACHA_WEIGHT_MAX`] 以下の整数**（[`parseGachaPrize`] が保証する）。
   *
   * ⚠⚠ **0 を許さない**——合計 0 で **0 除算**になり、かつ「絶対に出ない景品」が
   * 表の中に黙って居座る。出したくない景品は**行ごと消す**のが唯一の作法である。
   */
  weight: number;
  /**
   * ⚠⚠⚠ **063c 段 2-a: `sourceName: string` を [`GachaPrizeOutput`] へ置き換えた。**
   * 「当たったら何が起きるか」は **OBS のソースを鳴らす**か **組み込みの演出を出す**かの 2 択になった。
   */
  output: GachaPrizeOutput;
}

/**
 * ⚠⚠⚠ **063c 段 2-a: 景品 1 件が当たったときの出力先。**
 *
 * ## なぜ union にしたか（061h の最悪形を両方向で塞ぐ）
 *
 * 063 の出発点は「**鳴らすものが無い状態から始まる**」＝ OBS に素材を 1 つも登録していない人は
 * ガチャを作れても**何も起きない**、という 063s の痛点である。⇒ **組み込みの演出**を用意した。
 * ⚠⚠ ただし [061h](../../../../docs/tasks/061h-builtin-effect-removal.md) が組み込み演出を全廃した
 * 理由は生きているので、**両方向を同時に塞ぐ**こと（063c (3) の完了条件）:
 *
 * 1. **上書きを設定したのに組み込みが出る**を作らない … `{kind:"obs-source"}` を選んだ景品で
 *    組み込みへフォールバックしない（ここが union であることが構造的な担保）。
 * 2. ⚠ **上書き先の OBS ソースが消えているとき、黙って組み込みへ倒れない** …
 *    061h が消した「壊れているのに組み込みが出て、動いているように見える」がそのまま復活する。
 *    ⇒ **画面に「そのソースは OBS に見つかりません」を出す**（[`isObsSourceMissingFromList`] ＋
 *    [`GachaPrizeTable`] の警告。064c が既に持っている語彙）。
 *
 * ## ⚠⚠ 形は [`EffectAssignment`] と同じにしてある
 *
 * `obs-source` の枝は **[`EffectObsSource`] そのもの**（別の形を作らない）。
 * ⇒ [`isObsSourceMissingFromList`] も [`gachaPrizeSelectValue`] も**そのまま使える**＝語彙が増えない。
 * ⚠ 「ガチャ全体で 1 つのトグル」案は却下した（「A は組み込み、B は自分のソース」の混在ができない）。
 *
 * ## ⚠⚠⚠ `builtin` は 064a の実在照合（壁）を通らない
 *
 * OBS のソース名は sidecar の `GetInputList` 突き合わせを必ず通るが、
 * **`builtin` は wire に 1 バイトも載らない**（ステージ窓が自分で描く）ので、その壁を**通過しない**。
 * ⚠ これは**バイパスではなく、そもそも壁の向こうへ行かない**ということである
 * （`docs/security.md` §1 の 063c 追補の `{kind:"builtin"}` の項が正）。
 * ⚠⚠ **再評価トリガー＝組み込み演出が OBS へ何かを送るようになったとき**（＝そのときは壁の対象になる）。
 */
export type GachaPrizeOutput = { kind: "builtin" } | EffectObsSource;

/**
 * 063a → **063c 段 2-a でここへ移した**: 景品の**表示名**（＝画面にも配信画面にも出る名前）。
 *
 * ⚠⚠ **規則の持ち主はこの 1 関数だけである。** 元は [`GachaPrizeTable`] の中のローカル関数
 * （`prize.name.length > 0 ? prize.name : prize.sourceName`）だったが、
 * ⚠⚠⚠ **063c 段 2-a で当選景品の名前が「配信画面」にも出るようになった**ので、
 * 画面の中に置いたままだと**設定画面と配信画面で違う名前が出る**——
 * しかも `{kind:"builtin"}` には代わりに使えるソース名が無いので、
 * **片方だけが「無名の景品をどう呼ぶか」を決める**ことになる。
 *
 * ⚠ フォールバックの順は **景品名 → OBS のソース名 → [`GACHA_UNNAMED_PRIZE_LABEL`]**。
 * ⚠⚠ **空文字を返さないこと**——返すと配信画面の景品名の器が**空のまま出る**
 * （⚠ 063c 段 5-b で「が当たりました」を消したので、いまは**読める文字が 1 つも無い**状態になる）。
 *
 * ⚠ §9: 戻り値は**ユーザー自身が入力した文字列**だけである（景品名／自分が OBS で付けたソース名）。
 * **第三者の表示名もコメント本文も、この関数の入力に載る経路が型として無い。**
 */
export function gachaPrizeLabel(prize: GachaPrize): string {
  if (prize.name.length > 0) return prize.name;
  if (prize.output.kind === "obs-source") return prize.output.sourceName;
  return GACHA_UNNAMED_PRIZE_LABEL;
}

/**
 * 063c 段 2-a: 名前も OBS のソース名も無い景品（＝組み込み演出で名前を空にした行）の表示名。
 *
 * ⚠ 「はずれ」ではない——**当たってはいる**ので、何も出なかったときの表記
 * （`gachaDraw.ts` の `GACHA_MISS_LABEL`）と**別の文字列にしてある**。
 * 混ぜると配信画面で「当たったのに『何も出ない』と出る」。
 * ⚠⚠ **063h 訂正: 在り処が変わった**——旧文は `GachaPrizeTable` の `MISS_LABEL` を指していたが、
 * **063i が配信サマリーでも同じ言葉を使う**ので `gachaDraw.ts` へ移した（定義は 1 か所）。
 * ⚠⚠⚠ **`gacha_draws.prize_label` にこの「当たり」が入ることがある**（名前が空の当たり）。
 * ⚠ **`NULL` と混同しないこと**——`NULL` は「何も当たらなかった」であって「名前が無い」ではない。
 */
export const GACHA_UNNAMED_PRIZE_LABEL = "当たり";

/**
 * 063a → **063d で作り直した**: **ガチャの割り当て**（＝この条件が当たったら 1 回引く）。
 *
 * ⚠⚠⚠ **063d: 景品をここに直付けするのをやめ、[`GachaDefinition`] を id で指す形にした。**
 * 063a は `{ kind:"gacha"; prizes }` だったが、そうすると
 * **同じガチャをスパチャとビッツに設定するには景品表を 2 回入力する**ことになり、
 * ⚠ **編集も 2 箇所**で、**片方を忘れると確率が静かにずれる**（画面のどこにも出ない）。
 * 条件は最大 26 本（イベント 6 ＋ [`KEYWORD_CONDITION_MAX`]）あるので、増えるほど破綻する。
 * ⇒ **ガチャ本体は [`GACHA_LIBRARY_KEY`] の一覧が持ち、割り当ては `gachaId` を指すだけ**にした。
 * ⚠ これは 063a が明示的に先送りした点である（「再修正トリガー＝ガチャを複数保存して使い回したくなったとき」）。
 *
 * ⚠⚠ **形は 064b の `EffectObsSource` とまったく同じ**（`<select>` の値は `gacha:<id>`）。
 * 指す先が消えているときの扱いも 064b と揃える＝**警告を出して「出さない」へ倒す**
 * （黙って別のガチャへ化けさせない）。
 *
 * ⚠⚠⚠ **063b で発火するようになった**（063a / 063d では [`createEffectFireMatcher`] の `select` が
 * `null` を返し、**当たり判定の前に落ちて**いた）。⚠ いまは `select` がこの kind も通し、
 * **発火が確定してから** `effectFire.ts` の [`decideFireResults`] が 1 回だけ引く。
 * ⚠⚠ **ここ（`select`）で引かないことが要点である**——`select` は当たり判定の**前**に呼ばれるので、
 * 引くと「当たっていない条件でも引く」「はずれが次の条件へ落ちる」の 2 つが同時に起きる（穴 A）。
 * ⚠ 「割り当てたのに何も出ない」と読める注記（[`GachaPrizeTable`] の先頭の note）は **063b で外した。**
 *
 * ⚠ **景品 0 件のガチャを指していても `{ kind:"gacha" }` のまま保持する**（`{kind:"none"}` へ潰さない）。
 * 潰すと「ガチャを選んだのに次に開いたら『出さない』に戻っている」＝**黙って設定が消える**。
 */
export interface EffectGacha {
  kind: "gacha";
  /**
   * 指している [`GachaDefinition.id`]。⚠ **一覧に無い id でも保持する**
   * （消えたガチャを指したまま警告を出すのが 064b と同じ規律で、黙って別のガチャへ化けさせないため）。
   */
  gachaId: string;
}

/**
 * 063d: **名前付きのガチャ 1 件**（＝複数の条件から使い回せる本体）。
 *
 * ⚠⚠ **「テンプレート」と呼ばないこと。** [064d](../../../../docs/tasks/064d-remove-template-import.md) が
 * `effect_templates` / `template_id` / `EffectAssignment` の `template` variant を**全削除済み**で、
 * docs 上「テンプレート」は**消した取り込み機能**を指す。同じ語を使うと、
 * ⚠ 旧 063a 本文が `template_id` 前提で壊れていたのと**同じ種類の混乱**を作る。
 * ⇒ 画面の文言も「ガチャを選ぶ」「ガチャを作る」で統一する。
 *
 * ⚠ **保存先は [`GACHA_LIBRARY_KEY`]**（条件のキーとは別・063d 穴 S）。
 */
export interface GachaDefinition {
  /**
   * id。⚠ **`"g:" + n`**（n ＝ **保存済みの最大 n + 1**。⚠⚠ **削除しても詰めない**）。
   *
   * ⚠ 採番規則を `kw:n`（[`EffectCondition`] の「id の決め方」）と**同じにしてある**理由は 2 つ:
   *   1. `crypto.randomUUID()` は**判断 3 で既に却下済み**（jsdom / vitest での有無がバージョン依存＝
   *      テストが環境で割れる／id が毎回変わるとアサーションが書けない）
   *   2. ⚠⚠⚠ **id を再利用すると、削除したガチャを指していた条件が、
   *      新しく作った別のガチャを黙って指す**——`kw:n` を詰めないのとまったく同じ危険である
   */
  id: string;
  /** 表示名。⚠ **空を許さない**（[`GACHA_NAME_MAX_LENGTH`] 以内）——`<select>` の選択肢に出るため。 */
  name: string;
  /** 景品。⚠ 型も検証も 063a のまま無改変（[`parseGachaPrize`]）。 */
  prizes: readonly GachaPrize[];
}

/**
 * 未保存・不正・例外のときに使う既定。
 *
 * ⚠⚠ **061h で `{ kind: "builtin-monetary" }` から反転した。** 「出さない」が既定である＝
 * **条件を引かずにエフェクトが出る経路が 1 本も無い**ことが、この 1 行に乗っている
 * （理由は上の「壊れ方の方針」節が正）。
 */
export const DEFAULT_EFFECT_ASSIGNMENT: EffectAssignment = { kind: "none" };

/**
 * 061j: キーワードの当て方。
 *
 * ⚠⚠ **正規表現もワイルドカードも作らない。** 041b が「ユーザー入力は `kind:"text"` 固定＝
 * **任意正規表現を書かせない**」と決めた先例と同じ規律（`readingDictionary.ts` の `ReadingRule` の
 * JSDoc が正）。⚠ 使うのは `String.prototype.includes` と `===` **だけ**である。
 */
export type EffectKeywordMatch = "contains" | "exact";

/**
 * 064d: **配信イベントを出すウィンドウの実タイトル**（＝OBS に作られるソース名）。
 *
 * ⚠⚠ **これは窓名の「3 つ目の写し」であり、機能要件である。** 1 つ目は Rust の `.title(...)`、
 * 2 つ目は sidecar の `OBS_OVERLAYS.stage.windowTitle`、そして 3 つ目が
 * **frontend がユーザーへ案内する文字列**（ステージ窓のガイド本文と `ObsEffectsScreen` / `StreamEventTab`
 * の案内文）である。⚠ ユーザーは **OBS のウィンドウ一覧をこの文字列で探す**ので、
 * ずれると窓が見つからない＝機能が壊れる。
 * ⚠⚠ しかも**ガイド本文は OBS のキャプチャに数十秒そのまま映る**（＝配信を見ている視聴者にも読める）。
 * 061i の実機確認で「ガイド本文だけが古い」を実際に踏んでいる。
 *
 * ⇒ **窓名を直書きせず必ずここから引くこと。** Rust の
 * `overlay_window_contract::frontend_window_title_table_matches_overlay_titles` が
 * この値と `OVERLAY_TITLES` の**バイト一致**を固定している。
 *
 * ⚠ **064d 以前は `EFFECT_OUTPUT_WINDOW_TITLE`（2 エントリの表）だった。**
 * コーナー窓（テンプレート専用）を廃止して**窓が 1 つになった**ので、表ではなく定数 1 本にしてある。
 */
export const STAGE_OVERLAY_WINDOW_TITLE = "StreamDock ステージ演出";

/**
 * ⚠⚠⚠ **063c 段 2-a: ステージ窓の「ラベル」**（＝ Tauri の窓 label。上のタイトルとは別物）。
 *
 * ⚠⚠ **frontend が窓 label を文字列で持つのはこれが初めてである。** 用途はただ 1 つ、
 * [`emitGachaStageResult`] が `emitTo(<この値>, …)` で**当選結果をステージ窓だけへ届ける**こと。
 *
 * ⚠⚠⚠ **typo が「落ちない方向」に壊れる**——`emitTo` は宛先が存在しなくても
 * **例外を投げずに何も起きない**ので、間違えると「**演出が永久に出ないが、OBS は正常に鳴る**」
 * という、画面からもログからも理由が読めない壊れ方になる。
 * ⇒ Rust の `overlay_window_contract::frontend_stage_overlay_label_matches_window_builder` が
 * **この値と `WebviewWindowBuilder::new(&app, "…")` のバイト一致**を固定している
 * （`SIDECAR_CONSUMER_LABELS` の typo を同じ理由で潰している
 * `consumer_labels_are_windows_that_actually_exist` と同型の守り方）。
 *
 * ⚠ **タイトル（上）と混同しないこと**——ユーザーが OBS で探すのはタイトル、
 * アプリが窓を名指しするのがラベルで、**変えてよい条件がまったく違う**
 * （タイトルは日本語で変えうる／ラベルは Rust の窓生成と一致していなければならない）。
 */
export const STAGE_OVERLAY_WINDOW_LABEL = "stage-overlay";

/**
 * 061j: 条件 1 件の**いつ出すか**。
 *
 * ⚠ **061k がここへ足した「出力先（全画面 / コーナー）」は 064d で軸ごと削除した。**
 * 出力先は「**StreamDock のどちらの窓に描くか**」という意味だったので、
 * **窓に描くのをやめた**（＝ OBS 側のソースを鳴らす）時点で意味を失った。
 * ⚠ **条件の種類ごとに複製することになる形はここへ入れない**という 061j の規律は生きている。
 */
export type EffectConditionWhen =
  | { type: "event"; eventType: string }
  | { type: "keyword"; text: string; match: EffectKeywordMatch }
  /**
   * ⚠⚠⚠ 063e 段 3-b: **チャンネルポイントの報酬 1 件ごとの条件**（＝「この報酬ならこのガチャ」）。
   *
   * ## ⚠⚠ 段 3 の「イベント条件 ＋ 報酬名フィルタ」を作り直したものである
   *
   * 段 3 は `when: {type:"event"; eventType:"channelpoint"; rewardTitle?}` という形で、
   * **1 行に絞り込みを 1 つ**持たせていた。依頼者の要望が
   * 「**このチャネポ交換ならこれ、このチャネポ交換ならこのガチャ**」＝**報酬ごとに別の出力**へ
   * 変わったので、⚠ **段 3 の JSDoc が書き残していた再修正トリガーがそのまま引かれた。**
   *
   * ⚠⚠⚠ **予告どおり「先に id の採番を作り直す」ことから始めている。**
   * イベント条件の id は `"event:" + eventType` で**採番不要・安定**だが、
   * ⚠ **id はクールダウンのキー（`lastConditionAt`）でもある**ので、
   * `channelpoint` の行が 2 本になった瞬間に **2 本目が 1 本目のクールダウンを引き継ぐ**。
   * ⇒ 報酬ごとの行は **`"cp:" + n`**（[`KEYWORD_CONDITION_MAX`] 側と同じ採番規則）で持つ。
   * ⚠ **フィルタを増やして凌がないこと**（段 3 の注記がそう書いていた）。
   *
   * ## ⚠⚠ `rewardTitle` は**必須・非空**である（段 3 の `?:` から変わった）
   *
   * 段 3 は「未指定＝すべての報酬」を同じフィールドで表していたが、
   * ⚠⚠⚠ **段 3-c で「すべての報酬」という概念そのものを廃止した**——
   * 依頼者＝「**そもそもチャンネルポイント交換しただけで表示したいエフェクトなんか無い**」。
   * ⇒ 条件表から「チャンネルポイント」の行を消し、**紐づけた報酬でしか何も起きない**。
   * ⚠ ここに `undefined` を入れる意味が無く、⚠⚠ **空を許すと全引き換えに一致する**
   * （[`parseKeywordCondition`] の空キーワードとまったく同じ最大の失敗モード）。
   *
   * ⚠ 照合は**完全一致**（`normalizeForMatch` 後）。**部分一致にしないこと**——
   * 「ガチャ」が「レアガチャ」にも当たり、分けたはずのものが混ざる。
   */
  | { type: "channelpoint"; rewardTitle: string };

/**
 * 061j: 条件 1 件。
 *
 * ⚠⚠ **これは「保存形そのもの」である。** 計算結果（照合用に正規化した文字列など）を
 * ここへ載せないこと——載せると `JSON.stringify` に混ざり、UI にも余計なフィールドが見える。
 * 照合用の値は非 export の [`MatchableCondition`] が持つ。
 *
 * ⚠ **id の決め方**（判断 3）:
 *   - イベント条件 … `"event:" + eventType`（採番不要・安定・6 個固定）
 *   - キーワード条件 … `"kw:" + n`（n ＝ **保存済みの最大 n + 1**。⚠ **削除しても詰めない**）
 *
 * ⚠ **却下した 3 案**:
 *   - `crypto.randomUUID()` … jsdom / vitest 環境での有無がバージョン依存で**テストが環境で割れる**。
 *     さらに id が毎回変わると**アサーションが書けない**（クールダウンのテストは id を名指しする）。
 *   - **条件の内容から導出**（`kw:<正規化済み>:<match>`） … ⚠⚠ React の key に使うと、
 *     キーワードを 1 文字打つたびに key が変わって `<input>` が作り直され、**フォーカスが飛ぶ**。
 *   - **配列の index** … 削除・並べ替えで壊れる。⚠ **id はクールダウンのキーでもある**ので、
 *     1 件消すと**別の条件が消えた条件のクールダウンを引き継ぐ**。
 */
export interface EffectCondition {
  id: string;
  /** いつ出すか。 */
  when: EffectConditionWhen;
  /** 何を出すか。 */
  effect: EffectAssignment;
}

export type EffectConditions = readonly EffectCondition[];

/**
 * ⚠ **内部専用**（export しない）。保存にも UI にも出さない。
 *
 * ⚠⚠ **空判定と照合が「同じ 1 回の正規化」を共有するための器である。**
 * 別々に正規化すると 1 コメントあたり最大 40 回（20 件 × 2）走る。
 */
interface MatchableCondition {
  readonly condition: EffectCondition;
  /**
   * キーワード条件のときだけ非 null。⚠ **非空であることは [`parseConditions`] が保証する**
   * （空だと全コメントに一致する＝本タスク最大の失敗モード）。
   */
  readonly normalized: string | null;
  /**
   * ⚠⚠⚠ 063e 段 3-b: **報酬ごとの条件のときだけ非 null**（正規化済みの報酬名）。
   *
   * ⚠ 上の [`normalized`] と**兼用しない**——片方はキーワード条件の本文照合、こちらは
   * 報酬名の照合で、**当たる相手が違う**（`input.text` と `input.rewardTitle`）。
   * 1 つの箱に 2 つの意味を入れると、後から片方だけ直したときに**もう片方が黙って壊れる**。
   * ⚠⚠ **非空であることは [`parseChannelPointCondition`] が保証する**（空は行ごと落とす）。
   * ⚠⚠⚠ **段 3 との違い**＝あちらはイベント条件に載る「絞り込み」で `null` が
   * 「すべての報酬」を意味していた。段 3-b では `null` は単に
   * **「報酬ごとの条件ではない」**（イベント条件／キーワード条件）を意味する。
   */
  readonly rewardNormalized: string | null;
}

/**
 * 064b: **OBS のソース名として保存してよい形か**（型・空・200 文字・制御文字）。
 *
 * ⚠⚠ **これは「壁」ではない。壁は sidecar 側の 2 枚**（形式検査
 * `isAllowedObsSourceName` ＋ **`GetInputList` との実在照合**）で、そちらが唯一の持ち主である。
 * ここが在るのは**多層防御の 1 枚目**で、細工された localStorage 値が
 * **そもそも wire に載らない**ようにするためのもの
 * （⚠ 064 レビュー Q-6: かつて同じ位置づけだった `isEffectTemplateId` は 064d で削除済み）。
 *
 * ⚠⚠ **sidecar の `isAllowedObsSourceName` と規則を揃えてある**（trim して空でない・200 文字以下・
 * 制御文字なし）。⚠ **片方だけ厳しくしないこと**——TS 側だけ厳しいと
 * 「OBS には在るのに条件が黙って『出さない』へ落ちる」、sidecar 側だけ厳しいと
 * 「保存できるのに鳴らない」という、どちらも**画面から理由が読めない**壊れ方になる
 * （064d で削除した `EFFECT_TEMPLATE_ID_RE` が Rust の `is_template_id` と強さを揃えていたのと同じ理由）。
 * ⚠ **再修正トリガー＝ sidecar 側の規則を変えるとき**（必ず両方直す）。
 *
 * ⚠ 長さは **UTF-16 コード単位**で数える（`KEYWORD_MAX_LENGTH` のコードポイント数とは**別の規則**）。
 * これも sidecar 側に合わせたもので、ここでの目的は文字数の厳密さではなく**入力の暴走を止める衛生上限**である。
 */
export const isEffectObsSourceName = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > OBS_SOURCE_NAME_MAX_LENGTH) {
    return false;
  }
  return !hasControlChar(trimmed);
};

/** OBS のソース名の長さ上限。⚠ **sidecar の `isAllowedObsSourceName` と同じ値**（上の注記が正）。 */
const OBS_SOURCE_NAME_MAX_LENGTH = 200;

/**
 * 割り当て 1 行を検証する。**受け入れられない値はすべて `DEFAULT_EFFECT_ASSIGNMENT`（＝出さない）**。
 *
 * ⚠ ここで見ているのは**形だけ**で、「その id のテンプレートが実在するか」は見ない
 * （実在の判定に要る一覧は IPC の向こう側で、この純関数からは引けない）。
 * 実在しない id は**描く側**（エフェクト窓＝一覧に無ければ出さない／main 窓＝警告を出す）が扱う。
 */
const parseAssignment = (raw: unknown): EffectAssignment => {
  if (typeof raw !== "object" || raw === null) return DEFAULT_EFFECT_ASSIGNMENT;
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === "none") return { kind: "none" };
  if (kind === "obs-source") {
    const sourceName = (raw as { sourceName?: unknown }).sourceName;
    // ⚠ 形が違えば「出さない」へ（`isEffectObsSourceName` の注記が正）。
    if (!isEffectObsSourceName(sourceName)) return DEFAULT_EFFECT_ASSIGNMENT;
    // ⚠⚠⚠ 064 レビュー S-10（修正）: **保存するのは trim 済みの値**である。
    //   旧実装は `trim()` して**判定**しながら**生のまま保存**していたので、
    //   細工された `" foo "` が入ると **matcher は発火するのに `<select>` は「出さない」に見える**
    //   （`isObsSourceMissingFromList` は一覧の `name` と**完全一致**で照合し、
    //   一覧側は sidecar が `trim()` 済みの名前を返すため）。
    //   ⚠ sidecar も受領時に `trim()` するので、**これで両側の値が 1 つに揃う**。
    return { kind: "obs-source", sourceName: sourceName.trim() };
  }
  if (kind === "gacha") {
    // ⚠⚠ 063d: **指す先が一覧に無くても gacha のまま返す**（`{kind:"none"}` へ潰さない・
    //   [`EffectGacha`] の注記が正）。一覧に無いことの警告は UI が出す（064b と同じ規律）。
    const gachaId = (raw as { gachaId?: unknown }).gachaId;
    if (typeof gachaId === "string") {
      const trimmed = gachaId.trim();
      if (trimmed.length > 0 && trimmed.length <= GACHA_ID_MAX_LENGTH) {
        return { kind: "gacha", gachaId: trimmed };
      }
    }
    // ⚠⚠⚠ **063a 形式（`{kind:"gacha", prizes:[…]}`）はここへ落ちる＝「出さない」になる。**
    //   ⚠ **これは移行が済んでいれば起きない**——[`migrateLegacyGachas`] が
    //   **`parseAssignment` を通す前の生の JSON**に対して働き、`prizes` を一覧へ移してから
    //   `gachaId` に書き換える。⚠⚠ **移行より先に保存すると景品が消える**ので、
    //   **保存を起こす画面より前に [`runGachaMigration`] を必ず 1 回走らせること**
    //   （`ObsEffectsScreen` が担当・そちらの注記が正）。
    return DEFAULT_EFFECT_ASSIGNMENT;
  }
  // ⚠ 旧ビルドが書いた "builtin-monetary"（061h で廃止）と、未知の kind。どちらも「出さない」へ倒す。
  //   ⚠⚠ 063a で "gacha" は**既知**になったので、この行が受けるのは
  //   「061h の残骸」と「まだ存在しない将来の kind」である（前方互換の仕組みは変わっていない）。
  return DEFAULT_EFFECT_ASSIGNMENT;
};

// --- 063a: ガチャの制限（穴 F / 穴 D の決定） -------------------------------------------------

/**
 * 063a: 1 つのガチャに入れられる景品の数の上限。
 *
 * 根拠＝ [`KEYWORD_CONDITION_MAX`] と同じ「**1 画面で読める上限**」であり、
 * ⚠ 表が条件行の下に開く形（[`GachaPrizeTable`]）なので、これ以上増えると画面が縦に破綻する。
 * ⚠ 063a 本文の例は 50 だったが、**上限は後から上げるほうが安全**（下げると既存の設定が落ちる）
 * ため、読める範囲の 20 から始める。**再修正トリガー＝「景品が足りない」と言われたとき。**
 */
export const GACHA_PRIZE_MAX = 20;

/**
 * 063a: 重みの上限。
 *
 * ⚠⚠ **根拠は表示の分解能である**——確率は小数第 1 位まで出す（穴 D の決定）ので、
 * 表現できる最小の差は **0.1% ＝ 1/1000**。重みが 1000 を超えても**画面の％には現れない**ので、
 * 大きな数を許す意味が無い（063a 本文の例は 1,000,000 だったが、根拠が書かれていなかった）。
 * ⚠ **下限は 1**（0 を許さない＝ [`GachaPrize.weight`] の注記が正）。
 */
export const GACHA_WEIGHT_MAX = 1000;

/**
 * 063a: 景品名の長さ上限（**コードポイント数**）。
 *
 * 根拠＝ [`KEYWORD_MAX_LENGTH`]（32）と同じ「名前であって文章ではない」規律。
 * ⚠ 表の 1 列に収める必要があるぶんキーワードより短くしてある。
 */
export const GACHA_PRIZE_NAME_MAX_LENGTH = 24;

/**
 * 063a: 景品 1 件を検証する。**受け入れられなければ `null`（＝その行だけ落とす）**。
 *
 * ⚠⚠ **落とす（丸めない）のが要点**——[`parseKeywordCondition`] と同じ規律である。
 * 重みを 0 → 1 や 5000 → 1000 へ丸めて受け入れると、**保存した値と実際に使われる確率が違う**
 * 状態を作る（そして画面からは読めない）。⚠ UI 側は確定時に詰めるので、ここまで来るのは
 * **手で localStorage を編集した場合だけ**である。
 *
 * ⚠ **`name` だけは空文字を許す**（[`GachaPrize.name`] の注記が正）。
 *
 * ## ⚠⚠⚠ 063c 段 2-a: 保存形が広がったが、**検証はこの 1 か所のまま**である
 *
 * `sourceName: string` → [`GachaPrizeOutput`]（`builtin` / `obs-source` の union）。
 * ⚠⚠ **本タスクで 2 通り目の検証を新設していない**（063c (3) の制約・§8）——
 * 出力先の検証は [`parseGachaPrizeOutput`] に閉じ、**ソース名の規則は [`isEffectObsSourceName`] のまま**
 * （`EffectObsSource` と同じ 1 つ）である。
 */
const parseGachaPrize = (raw: unknown): GachaPrize | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as {
    name?: unknown;
    weight?: unknown;
    output?: unknown;
    sourceName?: unknown;
  };
  const { name, weight } = item;
  if (typeof name !== "string") return null;
  if (hasControlChar(name)) return null;
  if ([...name].length > GACHA_PRIZE_NAME_MAX_LENGTH) return null;
  // ⚠⚠ **0 / 負 / 小数 / NaN / 上限超はすべて落とす**（0 除算と「絶対に出ない景品」を構造的に排除する）。
  if (typeof weight !== "number" || !Number.isSafeInteger(weight)) return null;
  if (weight < 1 || weight > GACHA_WEIGHT_MAX) return null;
  const output = parseGachaPrizeOutput(item.output, item.sourceName);
  if (output === null) return null;
  return { name: name.trim(), weight, output };
};

/**
 * 063c 段 2-a: 景品の**出力先**を検証する。⚠ 受け入れられなければ `null`（＝**その行だけ落ちる**）。
 *
 * ## ⚠⚠ 後方互換（063d 以前に保存された景品を読む）
 *
 * 063d までの景品は `{name, weight, sourceName}` で、`output` を持たない。
 * ⇒ **`output` が無い（＝オブジェクトでない）ときだけ `sourceName` を見て `{kind:"obs-source"}` にする。**
 * ⚠⚠ **移行スクリプトを書かないこと**——[`migrateLegacyGachas`] のような**書き換える移行**は
 * 「移行より先に保存すると消える」という 063d 穴 W の危険を新しく作る。
 * ここは**読むたびに翻訳する**（`parseAssignment` の未知 kind と同じく、読み込み層で吸収する）ので、
 * ⚠ **旧データを書き換えないまま新しいビルドで正しく動く。**
 *
 * ## ⚠⚠⚠ 前方互換（新しい保存値を古いビルドが読む）＝ **`builtin` の行は落ちる**
 *
 * 古いビルドの `parseGachaPrize` は `sourceName` を必須にしているので、
 * **`{kind:"builtin"}` の景品は `null`＝その行だけ落ちる**（他の行と、ガチャ本体は残る）。
 * ⚠ **受容する**。063d 穴 P（旧ビルドで開いて保存すると `gachaId` が消える）と同型で、
 * ⚠⚠ **`{kind:"obs-source"}` の景品＝いま保存されている全データは、古いビルドでも素通りする**
 * （`sourceName` を読む枝がそのまま生きているため）ので、**壊れるのは新機能を使った行だけ**である。
 * ⚠ 逆に「古いビルドのために `sourceName` も併記する」案は却下した——
 * **同じ事実の書き手が 2 つになり、片方だけ更新される日が必ず来る**（064 レビュー S-10 と同じ罠）。
 *
 * ⚠ **未知の kind は `null`（＝落とす）。** ⚠⚠ **`{kind:"builtin"}` へ倒さないこと**——
 * 倒すと「将来の出力先が、古いビルドでは黙って組み込み演出になる」＝
 * 061h が消した「壊れているのに動いているように見える」そのものになる。
 */
const parseGachaPrizeOutput = (
  raw: unknown,
  legacySourceName: unknown,
): GachaPrizeOutput | null => {
  if (typeof raw === "object" && raw !== null) {
    const kind = (raw as { kind?: unknown }).kind;
    if (kind === "builtin") return { kind: "builtin" };
    if (kind === "obs-source") {
      const sourceName = (raw as { sourceName?: unknown }).sourceName;
      // ⚠ ソース名の規則は `EffectObsSource` と**同じ 1 つ**（規則を 2 通りに書かない）。
      if (!isEffectObsSourceName(sourceName)) return null;
      // ⚠ 保存するのは trim 済みの値（064 レビュー S-10 と同じ理由＝一覧との照合が完全一致であるため）。
      return { kind: "obs-source", sourceName: sourceName.trim() };
    }
    return null;
  }
  // ⚠ 063d 以前の形（`sourceName` 直付け）。上の JSDoc「後方互換」が正。
  if (!isEffectObsSourceName(legacySourceName)) return null;
  return { kind: "obs-source", sourceName: legacySourceName.trim() };
};

/**
 * 063d: 1 つの窓に置けるガチャの数の上限。
 *
 * 根拠＝共通の下部に**一覧として並ぶ**ので「**1 画面で読める**」（[`GACHA_PRIZE_MAX`] と同じ規律）。
 * ⚠ **上限は後から上げるほうが安全**（下げると既存の設定が落ちる）。
 * ⚠ **再修正トリガー＝「ガチャが足りない」と言われたとき。**
 */
export const GACHA_DEFINITION_MAX = 10;

/**
 * 063d: ガチャ名の長さ上限（**コードポイント数**）。
 *
 * 根拠＝ `<select>` の選択肢と一覧の行の**両方に収まること**。
 * ⚠ [`GACHA_PRIZE_NAME_MAX_LENGTH`] と同値だが**別定数にしてある**——収まる場所が違うので、
 * 片方だけ変えたくなる日が来る（同じ定数を共有すると、そのとき必ず両方動く）。
 */
export const GACHA_NAME_MAX_LENGTH = 24;

/**
 * 063d: `gachaId` として受け付ける長さの上限。
 * ⚠ 実物は `"g:" + n` なので数文字だが、**手で localStorage を編集された場合**に
 * 長大な文字列を握らないための上限である（`CHAT_TICKET_MAX_CHARS` と同じ位置づけ）。
 */
export const GACHA_ID_MAX_LENGTH = 64;

/** 063d: id の接頭辞。⚠ `kw:` と同じ作法（[`GachaDefinition.id`] の注記が正）。 */
const GACHA_ID_PREFIX = "g:";

/**
 * 063d: **次に使うガチャの id**。⚠ **見えている最大 n + 1**（削除しても詰めない）。
 *
 * ⚠⚠ **詰めないことが「削除したガチャを指していた条件が、別のガチャを黙って指す」ことを防ぐ。**
 * `nextKeywordId` とまったく同じ規律である（あちらはクールダウンの取り違えを防いでいる）。
 *
 * ⚠⚠⚠ **`nextKeywordId` の「例外」をここには持ち込めない。**
 * 061j は「**全部消したときは `kw:1` に戻る**」を受容していた——その時点で
 * **引き継ぐ相手（条件）が存在しない**からである。⚠ ガチャは違う:
 * **消してもそれを指していた条件は `gachaId` を持ったまま残る**（064b と同じく参照を保つため）。
 * ⇒ 一覧が空になった瞬間に `g:1` へ戻すと、**次に作ったガチャを古い参照が黙って指す**。
 * ⚠⚠ **これは実際にテストで踏んだ**（`GachaLibraryCard.test.tsx` の「作り直しても化けない」）。
 *
 * @param usedIds ⚠⚠⚠ **一覧に無くても「まだ誰かが指している」id**（＝条件が持つ `gachaId` と、
 *   **画面がこのセッションで発行した id**）。
 *   ⚠⚠ **レビュー Q-2（修正）: 既定値 `= []` を外して必須引数にした。**
 *   旧実装は省略できたので「渡し忘れると黙って穴が開く」形で、⚠ **実際に
 *   [`migrateLegacyGachas`] が渡し忘れていた**（レビュー Q-1・移行時に古い参照と衝突しうる）。
 *   ⇒ **型で強制する**＝呼び出し側は「見るべき id が無い」ときも明示的に `[]` を書く。
 *   ⚠ **既定値を戻さないこと。**
 */
export function nextGachaId(
  gachas: readonly GachaDefinition[],
  usedIds: readonly string[],
): string {
  let max = 0;
  const seen = [...gachas.map((g) => g.id), ...usedIds];
  for (const id of seen) {
    const n = gachaIdNumber(id);
    if (n !== null && n > max) max = n;
  }
  return `${GACHA_ID_PREFIX}${max + 1}`;
}

/**
 * 063d: ガチャの id か（`g:<非負整数>`）。⚠ **[`keywordIdNumber`] とまったく同じ形**である。
 *
 * ⚠⚠ **レビュー Q-2（修正）: 旧実装は `Number(id.slice(2))` だった**ので、
 * `g:0x10`（→16）・`g:1e3`（→1000）・`g: 5`（→5）を通し、`kw:` 側（`/^\d+$/`）より緩かった。
 * 採番の規則を 2 通りに書かないため、**同じ述語の形へ揃えてある**。
 * ⚠ 緩いままだと、手で編集された id が採番の最大値を不当に押し上げうる。
 */
const gachaIdNumber = (id: unknown): number | null => {
  if (typeof id !== "string" || !id.startsWith(GACHA_ID_PREFIX)) return null;
  const rest = id.slice(GACHA_ID_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isSafeInteger(n) ? n : null;
};

/**
 * 063d: **いま条件が指しているガチャ id**（一覧に無いものも含む）。
 * ⚠ [`nextGachaId`] に渡して**消した id を再利用しない**ために使う。
 */
export function referencedGachaIds(): string[] {
  return loadEffectConditions()
    .map((c) => (c.effect.kind === "gacha" ? c.effect.gachaId : null))
    .filter((id): id is string => id !== null);
}

/**
 * 063d（レビュー Q-1・修正）: **生の保存値が指しているガチャ id**。
 *
 * ⚠⚠⚠ **[`referencedGachaIds`] と分けてある理由＝あちらは `loadEffectConditions()` を通す**ので、
 * **移行前の生 JSON には使えない**（`parseAssignment` が 063a 形式を「出さない」へ落とすのと同じ層）。
 * ⚠ [`migrateLegacyGachas`] は**純関数**（localStorage を読まない）なので、
 * 渡された `rawConditions` から自分で集める必要がある。
 *
 * ⚠⚠ **これが無いと穴 W が移行経路で再発する**——一覧から消えたガチャを指す条件（`gachaId`）と、
 * 同じ保存値の中の 063a 形式が同居しているとき、移行が採番した id が**古い参照と衝突**し、
 * **その条件が移行で作られた別のガチャを黙って指す**。
 */
const rawReferencedGachaIds = (rawConditions: readonly unknown[]): string[] => {
  const out: string[] = [];
  for (const item of rawConditions) {
    if (typeof item !== "object" || item === null) continue;
    const effect = (item as { effect?: unknown }).effect;
    if (typeof effect !== "object" || effect === null) continue;
    const gachaId = (effect as { gachaId?: unknown }).gachaId;
    if (typeof gachaId === "string") out.push(gachaId);
  }
  return out;
};

/**
 * 063d: **ガチャ名の確定時に通す整形**（制御文字を落とし、長さを詰める）。
 * ⚠ [`sanitizeGachaPrizeName`] と同じ規律だが、**上限が違う**ので別関数にしてある。
 */
export function sanitizeGachaName(raw: string): string {
  const stripped = stripControlChars(raw);
  const points = [...stripped];
  return points.length <= GACHA_NAME_MAX_LENGTH
    ? stripped
    : points.slice(0, GACHA_NAME_MAX_LENGTH).join("");
}

/**
 * 063a: 景品の配列を検証する。⚠ **上限を超えた分は落とす**（[`GACHA_PRIZE_MAX`]）。
 *
 * ⚠ 配列でなければ **0 件**（＝「景品がありません」として画面に出る）。
 */
const parseGachaPrizes = (raw: unknown): GachaPrize[] => {
  if (!Array.isArray(raw)) return [];
  const out: GachaPrize[] = [];
  for (const item of raw) {
    if (out.length >= GACHA_PRIZE_MAX) break;
    const prize = parseGachaPrize(item);
    if (prize === null) continue;
    out.push(prize);
  }
  return out;
};

// --- 061j: キーワードの制限（判断 9） ---------------------------------------------------------

/**
 * キーワードの長さ上限（**正規化前の生テキストのコードポイント数**）。
 *
 * 根拠＝「キーワード」であって文章ではない。⚠ localStorage を無制限に太らせない。
 * ⚠ **コードポイントで数える**（`String.length` ＝ UTF-16 コード単位では、絵文字 1 文字が 2 と数えられる）。
 * 048 の `capForSpeech` が同じ理由でコードポイント単位にしている。
 */
export const KEYWORD_MAX_LENGTH = 32;

/**
 * キーワード条件の件数上限。
 *
 * 根拠＝ 6 行のイベント条件と並べて 1 画面で読める上限であり、
 * ⚠⚠ **「全コメント × 条件数」の走査コストの上限**でもある（下の [`resolveEffectMatch`] の注記）。
 */
export const KEYWORD_CONDITION_MAX = 20;

/**
 * ⚠⚠⚠ 063e 段 3-b: **報酬ごとの条件の件数上限。**
 *
 * 根拠＝ [`KEYWORD_CONDITION_MAX`] と同じ 2 つ（「**1 画面で読める**」＋
 * 「**全コメント × 条件数**の走査コストの上限」）。⚠ **Twitch のカスタム報酬の数の上限ではない**
 * ——ここで絞るのは「**エフェクトを紐づける報酬**」の数だけである。
 * ⚠⚠⚠ **段 3-c で「紐づけなかった報酬」の受け皿が無くなった。** 段 3-b までは条件表の
 * 「チャンネルポイント」行（総称）が受けていたが、あの行は廃止したので、
 * **上限に収まらなかった報酬では文字どおり何も起きない**（しかも黙って起きない）。
 * ⇒ ⚠ **上限は後から上げるほうが安全**（下げると既存の設定が落ちる）。
 * **再修正トリガー＝「紐づけが足りない」と言われたとき。**
 */
export const CHANNEL_POINT_CONDITION_MAX = 20;

/**
 * ⚠⚠⚠ 063e 段 3: **対象の報酬名の上限**（文字数）。
 *
 * ⚠ 根拠＝ **Twitch のカスタム報酬タイトルの上限が 45 文字**であること
 * （公式 Helix `CreateCustomRewards` の `title`: "The maximum length is 45 characters."）。
 * ⇒ **Twitch が作れない長さは受け取らない**＝ここを超える値は
 * **正規の引き換えでは絶対に届かない**ので、落として安全である。
 * ⚠ キーワードの 32（[`KEYWORD_MAX_LENGTH`]）と揃えなかったのは、
 * **揃えると実在する報酬名が入力できなくなる**ため（33〜45 文字の報酬は作れてしまう）。
 */
export const REWARD_TITLE_MAX_LENGTH = 45;

/**
 * 061j（判断 7）: **同じ条件が続けて発火しない**ための最小間隔。
 *
 * 根拠: エフェクトの表示時間は `manifest.durationMs`（500〜15000ms）。同じキーワードに毎回反応すると
 * 重なり続ける。「同じ単語には 10 秒に 1 回まで」なら、視聴者が連呼しても画面が埋まらず、
 * 反応が返っている感覚は残る。
 * ⚠ **イベント条件には効かせない**（`cooldownMs: 0`）——課金は 1 件ずつが重要で、
 * スパチャ 2 連投の 2 件目を落としたくない。連投対策は既存の gift 畳み込み（043a の N+1）と
 * バースト上限が既に担っている。
 * ⚠ **設定項目にしない**（「たぬえさ3 より簡単に」＝設定を増やさない・061d の (2) と同じ規律）。
 * ⚠⚠ **`BURST_MAX` とは別軸である**（`effectTrigger.ts` の [`CONDITION_COOLDOWN_MAX_MS`] の注記が正）。
 *
 * ## ⚠⚠⚠ 2026-08-30: 再修正トリガーが**実際に引かれ、評価のうえ「変えない」と決めた**
 *
 * 旧トリガーは「**実機で『反応が鈍い／うるさい』と言われたとき**」。
 * ⚠ 依頼者の実機報告＝「**連続でガチャお願いしても 1 回しか抽選されてないっぽい**」で**引かれた**
 * （063 のガチャがキーワード条件に乗ったので、「反応が鈍い」が「**抽選されない**」の意味になった）。
 *
 * **検討した変更**: このクールダウンのキーを「**条件ごと**」から「**条件 × 視聴者ごと**」へ変える
 * （＝同じ人の連投は 10 秒に 1 回のまま、**別の人はすぐ引ける**）。
 *
 * ⚠⚠⚠ **結論: 変えない**（依頼者の判断・2026-08-30）。**根拠はコストの非対称性**である:
 *
 * - ⚠⚠ **キーワード条件は、お金もポイントも交換しない。** コメントは何回でも打てるので、
 *   ⇒ **このクールダウンが、キーワード発火にとって唯一のコストである。**
 *   視聴者ごとに分けると、**そのコストが実質ゼロになる**（人数を増やせば回避できる）。
 * - **上限の実測**: 条件ごと＝ **1 分に 6 回**。視聴者ごとにすると [`BURST_MAX`]（5 秒に 3 件）に
 *   張り付くので **1 分に 36 回**＝ ⚠⚠⚠ **6 倍**で、しかも**アカウント数で維持できる**
 *   ——つまり**荒らしの経路そのもの**になる。
 * - ⚠ **チャンネルポイント条件が `cooldownMs: 0` なのと非対称なのは意図的**である。
 *   あちらは**引き換えコスト（ポイント）が上限として効く**ので、時間で縛る必要が無い。
 *   ⇒ **「対価があるか」でクールダウンの要否が決まる**、というのがこの 2 つを貫く規則である。
 *
 * ⚠⚠ **受容した代償（正直に書いておく）**: **同じ 10 秒の中は、別の視聴者が打っても発火しない。**
 * ガチャでは「**自分のときだけ抽選されない**」に見える。
 * ⚠ **画面にはこの 10 秒を書かないと決めた**（依頼者の判断・2026-08-30）。
 *
 * ## ⚠⚠⚠ 再修正トリガー（**上記の評価を受けて書き直した**）
 *
 * ⚠ **「反応が鈍い」だけでは、もう引かないこと**——**それで 1 度引いて「変えない」と決めた**からである
 * （同じ検討を最初からやり直すことになる）。**引くべきなのは次のどちらか**:
 *
 * 1. **キーワード条件に「対価」が付いたとき**（サブスク限定・フォロワー限定など）——
 *    ⚠ 上記の根拠（唯一のコスト）が崩れるので、視聴者ごとへ分ける判断が変わりうる。
 * 2. ⚠⚠ **視聴者ごとに分けても発火の総量が増えない仕組みを入れたとき**
 *    （例: 条件ごとの「1 分あたり N 回」を別に持つ）。**そのときだけ 6 倍の問題が消える。**
 */
export const KEYWORD_COOLDOWN_MS = 10_000;

const EVENT_ID_PREFIX = "event:";
const KEYWORD_ID_PREFIX = "kw:";
/** ⚠ 063e 段 3-b: 報酬ごとの条件の id の接頭辞（採番規則は `kw:` と同じ）。 */
const CHANNEL_POINT_ID_PREFIX = "cp:";

/**
 * ⚠⚠ 063e 段 3-b: 報酬ごとの条件が当たる**唯一のイベント種別**。
 *
 * ⚠⚠⚠ **ここが drift すると、報酬ごとの行が 1 本も当たらなくなる**——
 * しかも症状は「**設定できるのに何も起きない**」で、画面にもログにも理由が出ない
 * （061a Q-1 が最も嫌う壊れ方）。
 *
 * ## ⚠⚠ 段 3-c: 網を**テストから型へ**移した
 *
 * 段 3-b までは `effectAssignments.test.ts` が
 * `EFFECT_CONDITION_EVENT_TYPES.has("channelpoint")` で綴りを固定していたが、
 * ⚠ 段 3-c で **`channelpoint` をあの集合から外した**（総称の行を廃止した）ので、
 * その網はそのままでは使えなくなった。
 * ⇒ **ts-rs が Rust から生成する [`CommentEventType`] で受ける。**
 * ⚠⚠ **これはテストより強い**——綴りを間違えた瞬間に `tsc` が落ちる（実行するまでもない）。
 * ⚠ 型注釈を外さないこと（外すと `string` に広がって網が消える）。
 */
const CHANNEL_POINT_EVENT_TYPE: CommentEventType = "channelpoint";

/**
 * 制御文字か（`U+0000〜U+001F` と `U+007F`）。⚠ 表示と保存値の両方が壊れるのを防ぐ（判断 9）。
 *
 * ⚠ **正規表現にしていない**——制御文字を含む文字クラスは、ソースに**リテラルの制御文字**を
 * 埋め込むか `no-control-regex` の抑制コメントを要求するかのどちらかになる
 * （前者は `grep` がファイルをバイナリ扱いする・diff もエディタも壊れる）。
 * コードポイントの比較なら**どちらも要らず、意図がそのまま読める**。
 */
const isControlCodePoint = (cp: number): boolean => cp < 0x20 || cp === 0x7f;

/** 制御文字を 1 文字でも含むか。⚠ **コードポイント単位**で見る（サロゲートペアを割らない）。 */
const hasControlChar = (s: string): boolean => {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isControlCodePoint(cp)) return true;
  }
  return false;
};

/** 制御文字を落とす。⚠ 落とすのは**入力欄の確定時だけ**（保存層は含む値を条件ごと落とす）。 */
const stripControlChars = (s: string): string =>
  [...s]
    .filter((ch) => {
      const cp = ch.codePointAt(0);
      return cp === undefined || !isControlCodePoint(cp);
    })
    .join("");

/**
 * 061j（判断 6）: **照合用の正規化**。⚠⚠ **持ち主はこの 1 か所だけ**（UI 側でも保存側でも別の正規化を書かない）。
 *
 * - **NFKC** … 全角英数 → 半角、半角カナ → 全角カナ。⚠ 配信のコメントは全角/半角が混ざるので、
 *   これが無いと「ＯＢＳ」で登録した条件が「OBS」に当たらない（逆も同じ）。
 * - **`toLowerCase` は NFKC の後**（順序を逆にすると一部の文字で結果が変わる）。
 * - **`trim` は両側に掛ける** … `exact` で「 草 」が「草」に一致しないと使い物にならないため。
 *   ⚠ `contains` では無害なので、**片方だけ別規則にしない**（規則を 2 通りに分けない）。
 *
 * ⚠⚠ **「空白のみ」の判定は必ずこの関数の結果に対して行うこと**（[`isUsableKeyword`]）。
 * 理由は「**照合に使う値そのものが非空であること**」を担保するため——空のまま通ると
 * `"".includes(…)` が**全コメントに一致する**（本タスク最大の失敗モード）。
 *
 * ⚠⚠ **061j 実装時の訂正（起票時の想定は誤りだった）**: 当初は
 * 「全角スペース `U+3000` は素の `trim()` では消えないので、NFKC の**後**で判定しないと取りこぼす」
 * と書いていたが、**これは事実ではない**——JS の `trim()` は Unicode の `Space_Separator` を
 * すべて落とすので、`U+3000` も `U+00A0` も `U+FEFF` も**生の `trim()` で消える**
 * （ミューテーション⑮-b で実測。⚠ **等価変異＝テストでは殺せない**）。
 * ⇒ **いまも NFKC の後で判定しているのは「取りこぼすから」ではなく、
 * 判定する値と照合に使う値を 1 つに保つため**である（この関数の規則を将来変えても、
 * 空判定が自動的に追従する）。⚠ **前者の理由を書き戻さないこと。**
 */
const normalizeForMatch = (s: string): string =>
  s.normalize("NFKC").toLowerCase().trim();

/**
 * 061j: **入力欄の確定時に通す整形**（制御文字を落とし、長さを詰める）。
 *
 * ⚠ 保存層（[`parseConditions`]）は**上限を超えた条件を落とす**が、UI 側は**詰めて入力欄へ書き戻す**
 * （048 の数値入力と同じ規律＝「999 と打ったら 200 に落ちた」が見える）。
 * ⚠ **両者は矛盾しない**——UI が通した値は必ず上限以内なので、保存層で落ちるのは
 * **手で localStorage を編集した場合だけ**である。
 */
export function sanitizeKeywordInput(raw: string): string {
  const stripped = stripControlChars(raw);
  const points = [...stripped];
  return points.length <= KEYWORD_MAX_LENGTH
    ? stripped
    : points.slice(0, KEYWORD_MAX_LENGTH).join("");
}

/**
 * 063a: **景品名の確定時に通す整形**（制御文字を落とし、長さを詰める）。
 *
 * ⚠ [`sanitizeKeywordInput`] と同じ規律（保存層は落とし、UI は詰めて書き戻す）だが、
 * **上限が違う**ので別関数にしてある（[`GACHA_PRIZE_NAME_MAX_LENGTH`]）。
 * ⚠ **UI 側で `slice` を書かないこと**——上限の持ち主をこの層に閉じるためにここに置いている。
 */
/**
 * ⚠⚠⚠ 063e 段 3 / 段 3-b: **報酬名の入力欄の確定時に通す整形**。
 *
 * ⚠ [`sanitizeKeywordInput`] と**同じ規律**（制御文字を落とし、上限で詰める）。
 * 上限だけが違う（報酬名は Twitch 側の上限に合わせて [`REWARD_TITLE_MAX_LENGTH`]）。
 * ⚠⚠ **`trim()` しないこと**——入力途中の末尾スペースを奪うと打ちにくくなる。
 * 前後の空白は照合側（`normalizeForMatch`）が落とすので、**保存値に残っても当たり方は変わらない**。
 */
export function sanitizeRewardTitleInput(raw: string): string {
  const stripped = stripControlChars(raw);
  const chars = [...stripped];
  return chars.length > REWARD_TITLE_MAX_LENGTH
    ? chars.slice(0, REWARD_TITLE_MAX_LENGTH).join("")
    : stripped;
}

export function sanitizeGachaPrizeName(raw: string): string {
  const stripped = stripControlChars(raw);
  const points = [...stripped];
  return points.length <= GACHA_PRIZE_NAME_MAX_LENGTH
    ? stripped
    : points.slice(0, GACHA_PRIZE_NAME_MAX_LENGTH).join("");
}

/**
 * 061j: そのキーワードは**条件として成立するか**（＝照合用に正規化して空にならないか）。
 *
 * ⚠⚠ **UI が「確定してよいか」を判断するための述語で、正規化の持ち主を増やさないために export する。**
 * ⚠ UI 側で `text.trim() === ""` と書いても**いまは同じ結果になる**（`trim()` は `U+3000` も落とす。
 * [`normalizeForMatch`] の訂正メモが正）。それでもこの述語を通すのは、
 * **空判定の規則を 2 か所に書かない**ため——`normalizeForMatch` を将来変えたとき、
 * UI 側の判定だけが古い規則のまま取り残されるのを構造的に防ぐ。
 * ⚠ **保存層の検査（[`parseKeywordCondition`]）は外さない**——UI を通らない経路
 * （手で localStorage を編集する）が残るため。
 */
export function isUsableKeyword(text: string): boolean {
  return normalizeForMatch(text) !== "";
}

/**
 * 063e 段 3-b: その報酬名は**条件として成立するか**（＝照合用に正規化して空にならないか）。
 *
 * ⚠⚠ **[`isUsableKeyword`] と実装が同じであることに意味がある**——どちらも
 * 「**照合に使う値そのものが非空であること**」を問うており、そこが空だと
 * **全コメント／全引き換えに一致する**（同じ最大の失敗モード）。
 * ⚠ **述語を 1 本にまとめないのは、当たる相手が違うからである**
 * （`input.text` と `input.rewardTitle`）——将来どちらかの正規化だけを変えたときに、
 * まとめてあると**もう片方が黙って追従してしまう**。
 * ⚠ 保存層の検査（[`parseChannelPointCondition`]）は外さない
 * （UI を通らない経路＝手で localStorage を編集する、が残るため）。
 */
export function isUsableRewardTitle(text: string): boolean {
  return normalizeForMatch(text) !== "";
}

/**
 * 063e 段 3-b: **2 つの報酬名は「同じ行」として当たるか**（＝照合と同じ規則で比べる）。
 *
 * ⚠⚠ **UI が「重複した行」を見つけるためだけの述語である。** 走査は
 * **最初に当たった 1 件**しか返さないので、同じ報酬名の行が 2 本あると
 * ⚠⚠⚠ **2 本目は永久に発火しない**——しかも画面には普通の行として並ぶ
 * （061a Q-1 が最も嫌う「黙って動かない」状態）。⇒ **画面に警告を出して観測できる形にする。**
 *
 * ⚠ **保存層で落とさない理由**＝落とすと**行が黙って消える**（打った文字列ごと失われる）。
 * 「消える」より「並んでいるが効かないと書いてある」ほうが直せる。
 *
 * ⚠⚠ **UI 側で `trim()` や `toLowerCase()` を自前で書かないこと**——
 * 比べ方が照合とずれると、**警告が出ないのに発火しない行**（またはその逆）が生まれる。
 * ⇒ 正規化の持ち主（[`normalizeForMatch`]）に必ず聞く。
 */
export function isSameRewardTitle(a: string, b: string): boolean {
  return normalizeForMatch(a) === normalizeForMatch(b);
}

/**
 * 063e 段 3-b: 報酬ごとの条件の id かどうか（`cp:<非負整数>`）。
 * ⚠ **[`keywordIdNumber`] とまったく同じ形**である（採番の規則を 2 通りに書かない）。
 */
const channelPointIdNumber = (id: unknown): number | null => {
  if (typeof id !== "string" || !id.startsWith(CHANNEL_POINT_ID_PREFIX)) {
    return null;
  }
  const rest = id.slice(CHANNEL_POINT_ID_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isSafeInteger(n) ? n : null;
};

/** キーワード条件の id かどうか（`kw:<非負整数>`）。 */
const keywordIdNumber = (id: unknown): number | null => {
  if (typeof id !== "string" || !id.startsWith(KEYWORD_ID_PREFIX)) return null;
  const rest = id.slice(KEYWORD_ID_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  return Number.isSafeInteger(n) ? n : null;
};

/**
 * 061j（判断 9）: キーワード条件 1 件を検証して照合用の形にする。**受け入れられなければ `null`**。
 *
 * ⚠⚠ **落とす（丸めない）のが要点。** 32 文字を超える値を切り詰めて受け入れると、
 * 「保存した文字列と当たる文字列が違う」状態を作る（UI 側は確定時に詰めるので通常は到達しない）。
 */
const parseKeywordCondition = (raw: unknown): MatchableCondition | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as { id?: unknown; when?: unknown; effect?: unknown };
  // ⚠ id は**クールダウンのキー**でもあるので形を要求する（採番の「最大 n + 1」もこの形に依存する）。
  //   ⚠ 形が違えば落とす＝ 061h の「未知の形は安全側（出さない）へ倒す」と同じ向き。
  if (keywordIdNumber(item.id) === null) return null;
  const when = item.when;
  if (typeof when !== "object" || when === null) return null;
  const { text, match } = when as { text?: unknown; match?: unknown };
  if (typeof text !== "string") return null;
  // ⚠ 未知の match は**落とす**（`contains` へ倒すと「exact のつもりが部分一致で出る」＝出る側へ倒れる）。
  if (match !== "contains" && match !== "exact") return null;
  if (hasControlChar(text)) return null;
  if ([...text].length > KEYWORD_MAX_LENGTH) return null;
  const normalized = normalizeForMatch(text);
  // ⚠⚠ **本タスク最大の失敗モードを塞ぐ 1 行。** `"".includes(…)` は全コメントに一致する。
  //   ⚠ 判定するのは**照合に使う値そのもの**（`normalized`）＝ 規則を 2 通りに書かない。
  //   ⚠ 「生の `trim()` では全角スペースを取りこぼす」は**誤り**だった（`normalizeForMatch` の訂正メモが正）。
  if (normalized === "") return null;
  const effect = parseAssignment(item.effect);
  return {
    condition: {
      id: item.id as string,
      when: { type: "keyword", text, match },
      effect,
    },
    normalized,
    // ⚠ キーワード条件は報酬で絞らない（報酬名を持つのはイベント条件の channelpoint 行だけ）。
    rewardNormalized: null,
  };
};

/**
 * ⚠⚠⚠ 063e 段 3-b: **報酬ごとの条件 1 件**を検証して照合用の形にする。**受け入れられなければ `null`**。
 *
 * ⚠⚠ **落とす（丸めない）のが要点**——[`parseKeywordCondition`] とまったく同じ規律である。
 * 上限超えを切り詰めて受け入れると「**保存した文字列と当たる文字列が違う**」状態を作る
 * （UI 側は確定時に [`sanitizeRewardTitleInput`] で詰めるので、通常はここまで来ない）。
 *
 * ⚠⚠⚠ **`rewardNormalized === "" ` を落とす 1 行が、この条件の最大の失敗モードを塞ぐ。**
 * 空を通すと正規化後の比較が `"" === ""` で成立し、⚠ **すべての引き換えに一致する**
 * ——報酬ごとに分けたつもりが**全部が 1 本目の行で鳴る**（キーワードの空文字と同型）。
 *
 * ⚠ **段 3 の [`parseRewardTitle`] を置き換えたものである。** あちらは空を
 * 「すべての報酬」へ倒していたが、⚠⚠⚠ **段 3-c 以降「すべての報酬」を受ける行は存在しない**
 * （条件表の「チャンネルポイント」行を廃止したため）。
 * ⇒ 空を通しても救われる設定は 1 つも無く、**全引き換えが 1 本目の行で鳴るだけ**である。
 * だからここでは**落とす**のが正しい（＝空の行は保存されず、UI の未確定行として残る＝打ち直せる）。
 */
const parseChannelPointCondition = (
  raw: unknown,
): MatchableCondition | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as { id?: unknown; when?: unknown; effect?: unknown };
  // ⚠ id は**クールダウンのキー**でもあるので形を要求する（採番の「最大 n + 1」もこの形に依存する）。
  //   ⚠ 形が違えば落とす＝ 061h の「未知の形は安全側（出さない）へ倒す」と同じ向き。
  if (channelPointIdNumber(item.id) === null) return null;
  const when = item.when;
  if (typeof when !== "object" || when === null) return null;
  const rewardTitle = (when as { rewardTitle?: unknown }).rewardTitle;
  if (typeof rewardTitle !== "string") return null;
  if (hasControlChar(rewardTitle)) return null;
  if ([...rewardTitle].length > REWARD_TITLE_MAX_LENGTH) return null;
  const rewardNormalized = normalizeForMatch(rewardTitle);
  if (rewardNormalized === "") return null;
  return {
    condition: {
      id: item.id as string,
      when: { type: "channelpoint", rewardTitle },
      effect: parseAssignment(item.effect),
    },
    // ⚠ 本文の照合には使わない（`normalized` を持つのはキーワード条件だけ）。
    normalized: null,
    rewardNormalized,
  };
};

/** イベント条件 1 件（`effect` は検証済み）。 */
const eventCondition = (
  eventType: string,
  effect: EffectAssignment,
): MatchableCondition => ({
  condition: {
    id: `${EVENT_ID_PREFIX}${eventType}`,
    when: { type: "event", eventType },
    effect,
  },
  normalized: null,
  // ⚠ 063e 段 3-b: イベント条件は報酬で絞らない（絞るのは `cp:` の行だけ）。
  rewardNormalized: null,
});

/**
 * 061j（判断 2）: **保存値 → 条件の配列**。⚠⚠ **検証・正規化・作り直しを行う唯一の関数**である。
 *
 * ⚠⚠ **配列にすると「スーパーチャットに 2 つのエフェクト」が表現可能になってしまう**
 * （Record では構造的に不可能だった）。壊れ方は 2 つあり、どちらも黙って起きる:
 *   1. **1 回の投げ銭で 2 件出る**＝バースト枠を 2 消費し、`EFFECT_MAX_CONCURRENT` の意味が変わる
 *   2. **UI（6 行の `<select>`）では表現できない**＝「保存値にあるのに画面に出ない条件」が生まれる
 *      （061a 以来の「黙って何かが起きる／起きない状態を作らない」に真っ向から反する）
 * ⇒ **必ず次を満たす配列を返す**:
 *   - **前半＝イベント条件が [`EFFECT_CONDITION_EVENT_TYPES`] の件数ちょうど**
 *     （⚠ 063e 段 2 で 6 → 7 になり、⚠⚠ **段 3-c で 6 へ戻った**——`channelpoint` を外したため）。
 *     その**挿入順**（＝`EFFECT_EVENT_ROWS` と同じ並び）で、重複は**先勝ち**で潰し、
 *     欠けは `{ kind: "none" }` で埋め、**未知の eventType は捨てる**
 *     ⚠⚠ **この関数が「どの eventType を許すか」の唯一の持ち主である**（063e 段 2）。
 *     ⚠ 同じ許可集合を照合側（[`createConditionMatcher`]）にも書かないこと——
 *     **2 枚目が drift したのが 063e 段 2 で見つかったバグそのもの**である（あちらの JSDoc が正）。
 *   - **後半＝キーワード条件**（保存順・[`parseKeywordCondition`] を通ったものだけ・最大
 *     [`KEYWORD_CONDITION_MAX`] 件）
 *
 * ## ⚠⚠⚠ 063e 段 3-b: **報酬ごとの条件を先頭へ置く**（走査順）
 *
 * 戻り値の並びは **`[報酬ごと(cp:) → イベント(event:) → キーワード(kw:)]`** である。
 * ⚠⚠ **この並びは表示順であると同時に「照合の優先順位」である**——
 * [`createConditionMatcher`] は**最初に当たった 1 件**しか返さないため。
 *
 * ⚠⚠⚠ **段 3-c で「なぜ先頭か」の理由が変わった。書き換えを忘れないこと。**
 *   - **段 3-b の理由**（⚠ **もう成立しない**）… 条件表の「チャンネルポイント」行（総称）が
 *     どの報酬にも当たるので、イベント条件が先だと報酬ごとの行が永久に発火しなかった。
 *     ⇒ ⚠ **段 3-c でその総称の行を廃止した**ので、この理由は消えている。
 *   - **いまの理由＝キーワード条件より前に置くため。** チャンネルポイントの引き換えは
 *     `user_input`（視聴者が打ったテキスト）を本文として持つので、⚠⚠ **たまたま
 *     キーワード条件に一致しうる**。そのとき鳴るべきは**報酬の紐づけのほう**である
 *     （報酬名で名指しした設定が、汎用のキーワードに負けてはいけない）。
 *
 * ⚠ **イベント条件とキーワード条件の相対順（event → keyword）は 1 ミリも変えていない**
 * ——判断 11（「出さない」条件はキーワードを塞がない）はそのまま生きている。
 * ⚠⚠ いま `cp:` と `event:` の前後は**どちらでも結果が変わらない**
 * （イベント条件に `channelpoint` が無くなったので当たる相手が重ならない）が、
 * ⚠⚠⚠ **先頭のままにしておくこと**——「具体的な条件を総称より先に置く」という規律が、
 * 将来また総称の行を足したときに**そのまま効く**形だからである。
 *
 * ⚠ **先勝ちにする理由**: 保存関数が正規化済みを書くので重複は通常発生しない。発生するのは
 * **手で localStorage を編集した場合か、将来のバージョンが書いた場合**だけで、そのとき「後勝ち」だと
 * **画面の並び（最初の行を描く）と実際に使われる値が食い違う**。先勝ちなら画面と一致する。
 *
 * ## ⚠⚠ 旧形式（Record）の変換（判断 8）
 *
 * ⚠ 061h は移行コードを書かなかったが、**あれは「未知 kind → 出さない」という前方互換が形として
 * 成立していた**から。今回は**ルートの形が Object → Array** なので、その仕組みが効かない
 * （`Array.isArray` の検査に引っかかって **061i でせっかく設定した条件が全部消える**）。
 * ⇒ 入口で「**ルートが配列でない Object なら旧形式**」として変換する。
 * ⚠ 変換は**1 本道**（同じ規則を 2 通りに書くことにはならない＝ 061h が移行コードを書かなかった
 * 理由に抵触しない）。⚠ **読むだけでは書き戻さない**（読み込みが副作用を持たない）。
 */
const parseConditions = (raw: unknown): MatchableCondition[] => {
  // ⚠ 先勝ち＋未知捨て＋欠け補完を 1 つの Map で表す。
  // ⚠ 064d: 値は `EffectAssignment` 1 つに戻った（061k の出力先の軸ごと消えたため）。
  const events = new Map<string, EffectAssignment>();
  // ⚠ 063e 段 3-b: 報酬ごとの条件（保存順そのまま・[`parseChannelPointCondition`] を通ったものだけ）。
  //   ⚠⚠ **旧形式（Record）の分岐からは 1 件も入らない**——あの形式は 061i 以前のもので、
  //   チャンネルポイント自体が存在しなかった（＝構造的に持ちえない）。
  const channelPoints: MatchableCondition[] = [];
  const keywords: MatchableCondition[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const when = (item as { when?: unknown }).when;
      if (typeof when !== "object" || when === null) continue;
      const type = (when as { type?: unknown }).type;
      if (type === "event") {
        const eventType = (when as { eventType?: unknown }).eventType;
        // ⚠ 未知の eventType は捨てる（UI に行が無い＝表現できない条件を残さない）。
        // ⚠⚠ 063e 段 2: **ここが許可集合の唯一の門である**（照合側にゲートは無い）。
        if (
          typeof eventType !== "string" ||
          !EFFECT_CONDITION_EVENT_TYPES.has(eventType)
        )
          continue;
        // ⚠ **先勝ち**（2 件目以降は無視する）。
        if (events.has(eventType)) continue;
        // ⚠⚠ 063e 段 3-b: **`when.rewardTitle` はもう読まない。** 段 3 がここに載せていた
        //   絞り込みは `cp:` の行へ移した（[`EffectConditionWhen`] の注記が正）。
        //   ⚠ 段 3 で保存された値は**未知のキーとして読み捨てられる**＝
        //   落ちるのでも壊れるのでもなく、**「すべての報酬」に戻る**（安全側でも危険側でもない・
        //   段 3 は未リリースなので移行コードは書かない）。
        events.set(eventType, parseAssignment((item as { effect?: unknown }).effect));
        continue;
      }
      if (type === "channelpoint") {
        // ⚠ 上限を超えた分は落とす（走査コストの上限＝[`CHANNEL_POINT_CONDITION_MAX`]）。
        if (channelPoints.length >= CHANNEL_POINT_CONDITION_MAX) continue;
        const parsed = parseChannelPointCondition(item);
        if (parsed === null) continue;
        // ⚠ id の重複は先勝ちで落とす（クールダウンのキーが衝突しないことの担保）。
        //   ⚠⚠ **報酬名の重複は落とさない**——落とすと**行が黙って消える**。
        //   同じ報酬名が 2 行あるときに 2 行目が発火しないことは、
        //   `EffectAssignmentCard` が**画面に警告として出す**（＝観測できる形にする）。
        if (channelPoints.some((c) => c.condition.id === parsed.condition.id))
          continue;
        channelPoints.push(parsed);
        continue;
      }
      if (type !== "keyword") continue;
      // ⚠ 21 件目以降は落とす（走査コストの上限＝判断 9）。
      if (keywords.length >= KEYWORD_CONDITION_MAX) continue;
      const parsed = parseKeywordCondition(item);
      if (parsed === null) continue;
      // ⚠ id の重複も先勝ちで落とす（クールダウンのキーが衝突しないことの担保）。
      if (keywords.some((k) => k.condition.id === parsed.condition.id)) continue;
      keywords.push(parsed);
    }
  } else if (typeof raw === "object" && raw !== null) {
    // ⚠ 旧形式（`Record<eventType, EffectAssignment>`）。⚠ 既知キーだけを引くので、
    //   `__proto__` 等の未知キーは構造的に読まれない（061d-2 からの規律）。
    // ⚠⚠ 063e 段 2: ここを `MONETARY_EVENT_TYPES` のままにする変異は**殺せない**（＝等価変異）。
    //   旧形式を書いたのは 061i 以前のバージョンで、当時 `channelpoint` は存在しない
    //   ⇒ **旧形式の Record は構造的に `channelpoint` キーを持ちえない**。
    //   ⚠ それでも広い集合で回すのは、**同じ規則を 2 通りに書かない**ため
    //   （無いキーは `undefined` で `continue` するだけ＝害はない）。
    for (const eventType of EFFECT_CONDITION_EVENT_TYPES) {
      const value = (raw as Record<string, unknown>)[eventType];
      if (value === undefined) continue;
      events.set(eventType, parseAssignment(value));
    }
  }

  // ⚠ **並びの持ち主は `EFFECT_CONDITION_EVENT_TYPES` の挿入順**（`EFFECT_EVENT_ROWS` と同じ）。
  //   ⚠ 種別が増えたら、保存値に無くてもここで自動的に行が生える
  //   （063e 段 2 の `channelpoint` が**まさにこれで移行コード無しに乗った**）。
  // ⚠⚠⚠ 063e 段 3-b: **報酬ごとの条件が先頭**（上の JSDoc「走査順の変更」が正）。
  //   ⚠ ここの順序を入れ替えないこと——入れ替えた瞬間、報酬ごとの行が 1 本も発火しなくなる。
  const out: MatchableCondition[] = [...channelPoints];
  for (const eventType of EFFECT_CONDITION_EVENT_TYPES) {
    out.push(
      eventCondition(
        eventType,
        events.get(eventType) ?? DEFAULT_EFFECT_ASSIGNMENT,
      ),
    );
  }
  out.push(...keywords);
  return out;
};

/** localStorage を 1 回読んで条件の配列にする。⚠ 例外も不正 JSON も「既定（全部出さない）」へ倒す。 */
const readConditions = (): MatchableCondition[] => {
  try {
    const raw = localStorage.getItem(EFFECT_ASSIGNMENTS_KEY);
    if (raw === null) return parseConditions(null);
    return parseConditions(JSON.parse(raw) as unknown);
  } catch {
    // JSON.parse の失敗も localStorage の例外（プライベートモード等）も同じ扱い＝全部「出さない」。
    return parseConditions(null);
  }
};

/**
 * 保存済みの条件を読む。**未保存・不正 JSON・例外・ルートが非オブジェクトはすべて全種別「出さない」**。
 *
 * ⚠ **戻り値は必ず「[報酬ごと（`cp:`）→ イベント条件 6 件 → キーワード条件]」**
 * （[`parseConditions`] の不変条件。⚠ 063e 段 3-b で先頭に `cp:` が付いた）。
 * 呼び出し側が「イベント条件の行があるか」を毎回気にしなくてよくなる
 * （⚠ `cp:` と `kw:` は 0 件でありうる——生やす側の集合が無いのはこの 2 つだけである）。
 * ⚠ **読むだけでは書き戻さない**（旧形式のまま置いておき、次に保存したとき新形式になる・判断 8）。
 */
export function loadEffectConditions(): EffectConditions {
  return readConditions().map((m) => m.condition);
}

/**
 * 条件を保存する（ローカルのみ・外部送信しない）。
 *
 * ⚠⚠ **検証は [`parseConditions`] を通す**——保存時と読み込み時で**同じ 1 つの規則**を使う
 * （061d-2 レビュー S-4 の「検証を 2 か所に分けると片方だけ緩む」を構造的に避ける）。
 * ＝ 空キーワード・32 文字超・21 件目・制御文字は**ここでも落ちる**（判断 9 の「保存時と読み込み時の両方」）。
 * ⚠ 書き出すのは `parseConditions` が組み立て直した `{id, when, effect}` だけなので、
 * **余計なフィールドは構造的に載らない**。
 *
 * ⚠⚠ **キーごと削除するのは「イベント条件が全部『出さない』**かつ**キーワード条件が 0 件」のときだけ。**
 * キーワード行が 1 件でも在れば、`effect` が `none` でも**ユーザーが打った文字列**なので消さない。
 * （イベント側だけなら「未保存＝既定」と「既定を明示的に選んだ」を同じ状態に潰す＝
 * `saveOverlayTheme(null)` と同じ判断で、分岐を増やさないため。）
 *
 * ⚠⚠ **064d でこの削除条件はさらに単純になった。** 061k が足した `output`（出力先）の軸ごと
 * 消えたので、「条件が持つのは `when` と `effect` だけ」＝
 * **「全部 `none` かつキーワード 0 件」なら保存すべき情報が 1 バイトも無い**が字義どおり成立する。
 * ⚠ 061k は「出力先だけ変えた状態が黙って消える」を避けるために `parseOutput` の丸めと
 * 対で成立させていたが、**その対そのものが不要になった**（丸めごと削除済み）。
 *
 * ⚠ **書き込み時も `parseAssignment` を通す**ので、ソース名の形式検査は保存経路にも効く
 * （061j で保存経路を読み込みと同じ関数へ寄せた結果がそのまま残っている）。
 */
export function saveEffectConditions(conditions: EffectConditions): void {
  try {
    const normalized = parseConditions(conditions).map((m) => m.condition);
    const hasKeyword = normalized.some((c) => c.when.type === "keyword");
    const hasNonDefaultEvent = normalized.some(
      (c) =>
        c.when.type === "event" &&
        c.effect.kind !== DEFAULT_EFFECT_ASSIGNMENT.kind,
    );
    /**
     * ## ⚠⚠⚠ 063e 段 3-b: **報酬ごとの行が 1 本でもあれば「空ではない」**
     *
     * ⚠⚠ **これが無いと実バグになる**（段 3 の実装中に実際に踏んだ・段 3-b でも同型）:
     * ユーザーが**エフェクトを選ぶ前に**報酬名を打って行を作ると、
     * その時点では `effect` が `{kind:"none"}` なので**上の 2 つがどちらも false** になり、
     * ⚠⚠⚠ **キーごと消えて行が黙って消える**（061a Q-1 が最も嫌う壊れ方）。
     * ⚠ 順番は「報酬名 → エフェクト」でも「エフェクト → 報酬名」でも自然なので、
     * **前者を選んだ人だけが壊れる**のはなおさら気づけない。
     *
     * ⚠ これは [`hasKeyword`] とまったく同じ理由である（**ユーザーが打った文字列**を持つ行は、
     * `effect` が既定でも消さない）。⇒ **述語を 2 つに分けず 1 つで書く。**
     */
    const hasChannelPoint = normalized.some(
      (c) => c.when.type === "channelpoint",
    );
    if (!hasKeyword && !hasNonDefaultEvent && !hasChannelPoint) {
      localStorage.removeItem(EFFECT_ASSIGNMENTS_KEY);
      return;
    }
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(normalized));
  } catch {
    // 書けない環境では**条件が保存されないだけ**（表示は既定＝「出さない」で続く）。
  }
}

/**
 * 061j（判断 3）: 次に使うキーワード条件の id。⚠ **保存済みの最大 n + 1**（削除しても詰めない）。
 *
 * ⚠ **消した id を再利用しないこと**が「クールダウンの取り違えが起きない」ことの担保である。
 * ⚠ **例外は「全部消したとき」**——残っている最大値が無いので `kw:1` に戻る。受容する理由は、
 * その時点で保存値はキーごと消えている（＝引き継ぐ相手の条件が存在しない）ことと、
 * 実害が「追加した直後の 1 回だけ出ない」に留まること（クールダウンは窓のメモリ内に最大
 * `CONDITION_COOLDOWN_MAX_MS` しか残らない）。
 */
const nextKeywordId = (conditions: EffectConditions): string => {
  let max = 0;
  for (const c of conditions) {
    const n = keywordIdNumber(c.id);
    if (n !== null && n > max) max = n;
  }
  return `${KEYWORD_ID_PREFIX}${max + 1}`;
};

/**
 * 条件 1 件の**エフェクト**（何を出すか）を変える。イベント条件・キーワード条件のどちらにも使う。
 *
 * ⚠ 存在しない id を渡しても**何も起きない**（保存関数が 6 行を作り直すので構造的に無害）。
 */
export function setConditionEffect(
  id: string,
  effect: EffectAssignment,
): EffectConditions {
  const next = loadEffectConditions().map((c) =>
    c.id === id ? { ...c, effect } : c,
  );
  saveEffectConditions(next);
  return loadEffectConditions();
}

/**
 * 063e 段 3-b（判断 3 と同じ規律）: 次に使う**報酬ごとの条件**の id。
 * ⚠ **保存済みの最大 n + 1**（削除しても詰めない）。
 *
 * ⚠⚠ **[`nextKeywordId`] とまったく同じ理由で詰めない**——`id` は
 * **クールダウンのキー**でもあるので、消した id を再利用すると
 * **新しく作った行が、消した行のクールダウンを引き継ぐ**。
 * ⚠ 報酬ごとの条件は `cooldownMs: 0` なので**今日は実害が無い**が、
 * ⚠⚠⚠ **採番の規則を条件の種類ごとに変えないこと**——「こちらは詰めてよい」を作ると、
 * 将来クールダウンを効かせたくなった日に**気づかないまま壊れる**。
 */
const nextChannelPointId = (conditions: EffectConditions): string => {
  let max = 0;
  for (const c of conditions) {
    const n = channelPointIdNumber(c.id);
    if (n !== null && n > max) max = n;
  }
  return `${CHANNEL_POINT_ID_PREFIX}${max + 1}`;
};

/**
 * ⚠⚠⚠ 063e 段 3-b: **報酬ごとの条件を 1 件足す**（＝「この報酬ならこれ」の紐づけ）。
 * ⚠ **id の採番はここだけ**（[`addKeywordCondition`] と同じ規律）。
 *
 * ⚠⚠ **空の報酬名では呼ばれない**——UI 側が [`isUsableRewardTitle`] で確定を止めるので
 * 到達しないが、仮に呼ばれても [`saveEffectConditions`] が
 * [`parseChannelPointCondition`] を通して落とす（＝検査は素通りできない）。
 * ⚠ **上限（[`CHANNEL_POINT_CONDITION_MAX`]）を超えた分も保存層で落ちる。**
 */
export function addChannelPointCondition(
  rewardTitle: string,
  effect: EffectAssignment,
): EffectConditions {
  const current = loadEffectConditions();
  const next: EffectCondition[] = [
    ...current,
    {
      id: nextChannelPointId(current),
      when: { type: "channelpoint", rewardTitle },
      effect,
    },
  ];
  saveEffectConditions(next);
  return loadEffectConditions();
}

/**
 * 063e 段 3-b: 報酬ごとの条件の**報酬名**を変える。
 * ⚠ イベント条件・キーワード条件には効かない（`when.type` で弾く）。
 *
 * ⚠⚠ 検証は [`saveEffectConditions`] → [`parseChannelPointCondition`] が行うので、
 * ここでは書くだけである（**規則の持ち主を 2 つにしない**）。
 * ⚠⚠⚠ **空を渡すとその行ごと保存値から落ちる**——UI 側は
 * [`isUsableRewardTitle`] で止めて**直前の確定値へ戻す**こと
 * （`commitKeyword` と同じ規律。止めないと**打ち間違いで行が消える**）。
 */
export function updateChannelPointCondition(
  id: string,
  rewardTitle: string,
): EffectConditions {
  const next = loadEffectConditions().map((c) =>
    c.id === id && c.when.type === "channelpoint"
      ? { ...c, when: { type: "channelpoint" as const, rewardTitle } }
      : c,
  );
  saveEffectConditions(next);
  return loadEffectConditions();
}

/**
 * キーワード条件を 1 件足す。⚠ **id の採番はここだけ**（判断 3）。
 *
 * ⚠⚠ **空のキーワードでは呼ばれない**——UI 側が「確定時に空なら直前値へ戻す」ので到達しないが、
 * 仮に呼ばれても [`saveEffectConditions`] が落とす（＝判断 9 の 2 枚の検査は素通りできない）。
 */
export function addKeywordCondition(
  when: { text: string; match: EffectKeywordMatch },
  effect: EffectAssignment,
): EffectConditions {
  const current = loadEffectConditions();
  const next: EffectCondition[] = [
    ...current,
    {
      id: nextKeywordId(current),
      when: { type: "keyword", ...when },
      effect,
    },
  ];
  saveEffectConditions(next);
  return loadEffectConditions();
}

/** キーワード条件の**キーワードと当て方**を変える。⚠ イベント条件には効かない（`when` の型が違う）。 */
export function updateKeywordCondition(
  id: string,
  when: { text: string; match: EffectKeywordMatch },
): EffectConditions {
  const next = loadEffectConditions().map((c) =>
    c.id === id && c.when.type === "keyword"
      ? { ...c, when: { type: "keyword" as const, ...when } }
      : c,
  );
  saveEffectConditions(next);
  return loadEffectConditions();
}

/**
 * 条件を 1 件消す。
 *
 * ⚠ **イベント条件の id を渡しても消えない**——[`parseConditions`] が 6 行を必ず作り直すので、
 * 「イベント条件が 5 行になる」状態は**構造的に作れない**（呼び出し側でガードを書かなくてよい）。
 */
export function removeCondition(id: string): EffectConditions {
  const next = loadEffectConditions().filter((c) => c.id !== id);
  saveEffectConditions(next);
  return loadEffectConditions();
}

// --- 063d: 名前付きのガチャの一覧（`GACHA_LIBRARY_KEY`） ---------------------------------------

/**
 * 063d: ガチャ 1 件を検証する。**受け入れられなければ `null`（＝その 1 件だけ落とす）**。
 *
 * ⚠⚠ **落とす（丸めない）のが要点**——[`parseGachaPrize`] とまったく同じ規律である。
 * ⚠ **`name` は空を許さない**（景品名とはここが違う）——`<select>` の選択肢に出るので、
 * 空だと**選べないガチャ**が一覧に並ぶ。
 * ⚠ 景品の検証は [`parseGachaPrizes`] をそのまま通す（規則を 2 通りに書かない）。
 *
 * ## ⚠ security-review S-2: **`id` の「形」は検証していない**（意図的）
 *
 * `keywordIdNumber` が `kw:<数字>` を要求するのに対し、ここは**非空・[`GACHA_ID_MAX_LENGTH`] 以下**
 * しか見ない（制御文字も落とさない）。⚠ **修正不要と判断した理由は 3 つ**:
 *   1. **`id` は OS にも wire にも渡らない**（OBS へ渡るのは `sourceName` だけで、そちらは
 *      `isEffectObsSourceName` ＋ sidecar の 2 枚の壁を必ず通る）。DOM へは React が
 *      エスケープして載せるので、値の中身で壊れる経路が無い。
 *   2. **厳しくすると手で編集された保存値を「落とす」方向に働く**——`g:` 以外の id を持つ
 *      ガチャが**景品ごと消える**ので、いまの緩さのほうが安全側である。
 *   3. **採番は既に守られている**——[`nextGachaId`] は `g:<数字>` だけを見る（`gachaIdNumber`）ので、
 *      規約外の id は**最大値を押し上げられない**＝ 穴 W の側から見た危険は無い。
 * ⚠ **再修正トリガー＝ `id` を localStorage 以外（ファイル名・URL・IPC の引数）へ渡すようになったとき。**
 * そのときは `gachaIdNumber` と同じ形の検査をここへ足すこと。
 */
const parseGachaDefinition = (raw: unknown): GachaDefinition | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as { id?: unknown; name?: unknown; prizes?: unknown };
  if (typeof item.id !== "string") return null;
  const id = item.id.trim();
  if (id.length === 0 || id.length > GACHA_ID_MAX_LENGTH) return null;
  if (typeof item.name !== "string") return null;
  if (hasControlChar(item.name)) return null;
  const name = item.name.trim();
  if (name.length === 0 || [...name].length > GACHA_NAME_MAX_LENGTH) return null;
  return { id, name, prizes: parseGachaPrizes(item.prizes) };
};

/**
 * 063d: ガチャの配列を検証する。⚠ **上限を超えた分と、id が重複した分は落とす**。
 *
 * ⚠⚠ **id の重複を落とす理由**＝重複すると「どちらのガチャを指しているか」が決まらず、
 * 条件が**黙って別のガチャを指す**（064b が「黙って別のソースへ化けない」としたのと同じ危険）。
 * ⚠ **先勝ち**（`parseConditions` のイベント条件と同じ作法）。
 */
const parseGachaDefinitions = (raw: unknown): GachaDefinition[] => {
  if (!Array.isArray(raw)) return [];
  const out: GachaDefinition[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= GACHA_DEFINITION_MAX) break;
    const gacha = parseGachaDefinition(item);
    if (gacha === null || seen.has(gacha.id)) continue;
    seen.add(gacha.id);
    out.push(gacha);
  }
  return out;
};

/**
 * 063d: 保存済みのガチャの一覧を読む。**未保存・不正 JSON・例外はすべて 0 件**へ倒す。
 *
 * ⚠ **読むだけでは書き戻さない**（`loadEffectConditions` と同じ規律）。
 */
export function loadGachaLibrary(): GachaDefinition[] {
  try {
    const raw = localStorage.getItem(GACHA_LIBRARY_KEY);
    if (raw === null) return [];
    return parseGachaDefinitions(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * 063d: ガチャの一覧を保存する（ローカルのみ・外部送信しない）。
 *
 * ⚠⚠ **検証は [`parseGachaDefinitions`] を通す**——保存時と読み込み時で**同じ 1 つの規則**を使う
 * （063a / 061d-2 レビュー S-4 と同じ理由＝検証を 2 か所に分けると片方だけ緩む）。
 * ⚠ **0 件になったらキーごと削除する**（`saveEffectConditions` と同じ作法＝
 * 「未保存」と「明示的に空」を同じ状態に潰す）。
 */
export function saveGachaLibrary(gachas: readonly GachaDefinition[]): GachaDefinition[] {
  try {
    const normalized = parseGachaDefinitions(gachas);
    if (normalized.length === 0) localStorage.removeItem(GACHA_LIBRARY_KEY);
    else localStorage.setItem(GACHA_LIBRARY_KEY, JSON.stringify(normalized));
  } catch {
    // 書けない環境ではガチャが保存されないだけ（表示は続く）。
  }
  return loadGachaLibrary();
}

/**
 * 063d: **063a 形式（`{kind:"gacha", prizes:[…]}`）を一覧へ移す純関数**。⚠⚠⚠ **本タスク最大の危険箇所**。
 *
 * ⚠⚠ **受け取るのは `parseAssignment` を通す前の「生の JSON」である。**
 * [`parseAssignment`] は 063a 形式を**「出さない」へ落とす**ので、
 * パース済みの条件を渡すと**景品が既に失われている**。⚠ **引数を `EffectConditions` に変えないこと。**
 *
 * ⚠ **前方互換の既存ガード（未知の `kind` → 出さない）は今回だけ効かない**——
 * あれは `kind` が変わるときの話で、今回は**既知の `kind` の中身が変わる**からである。
 * ⇒ 061h / 064d のように「移行コードを書かずに済む」形にはならない。
 *
 * ⚠⚠⚠ **同じ景品構成でもまとめない**（063d 穴 Q）——「別々に設定した 2 つ」なのか
 * 「同じつもりの 2 つ」なのかは**保存値からは判別できない**。勝手にまとめると
 * **片方を編集したらもう片方も変わる**という、ユーザーが頼んでいない共有を作る。
 * ⇒ **1 つずつ移す。まとめるのはユーザーの操作に任せる**（画面で選び直せば済む）。
 *
 * ⚠ 上限（[`GACHA_DEFINITION_MAX`]）に達したら**それ以上は移さない**。移せなかった分は
 * `parseAssignment` が「出さない」へ落とす（＝景品は失われる）。⚠ 受容する理由＝
 * 063a はまだ発火せず、**10 件を超える inline ガチャが存在しうる期間がごく短い**ため。
 *
 * @returns 移すものが 1 つも無ければ `null`（＝**呼び出し側は何も書かない**）。
 */
export function migrateLegacyGachas(
  rawConditions: unknown,
  library: readonly GachaDefinition[],
): { conditions: unknown[]; library: GachaDefinition[]; migrated: number } | null {
  if (!Array.isArray(rawConditions)) return null;
  const nextLibrary: GachaDefinition[] = [...library];
  const conditions: unknown[] = [];
  let migrated = 0;
  // ⚠⚠⚠ レビュー Q-1（修正）: **移行が採番する前に、生の保存値が既に指している id を集める。**
  //   旧実装は `nextGachaId(nextLibrary)` を **`usedIds` なしで**呼んでいたので、
  //   「一覧から消えたガチャを指す条件」と「063a 形式の条件」が同居していると、
  //   **前者の参照が、移行で作られた後者のガチャを黙って指す**（＝穴 W の移行版）。
  //   ⚠ **この配列を渡すのをやめないこと。**
  const usedIds = rawReferencedGachaIds(rawConditions);

  for (const item of rawConditions) {
    if (typeof item !== "object" || item === null) {
      conditions.push(item);
      continue;
    }
    const effect = (item as { effect?: unknown }).effect;
    if (typeof effect !== "object" || effect === null) {
      conditions.push(item);
      continue;
    }
    const e = effect as { kind?: unknown; prizes?: unknown; gachaId?: unknown };
    // ⚠ 「`kind` が gacha」かつ「`prizes` が配列」かつ「`gachaId` を持たない」＝ 063a 形式。
    //   ⚠⚠ `gachaId` があるものには触らない（**移行は 1 回きり＝この関数は冪等である**）。
    if (
      e.kind !== "gacha" ||
      !Array.isArray(e.prizes) ||
      typeof e.gachaId === "string"
    ) {
      conditions.push(item);
      continue;
    }
    if (nextLibrary.length >= GACHA_DEFINITION_MAX) {
      // ⚠ 上限に達した。移さずそのまま置く（`parseAssignment` が「出さない」へ落とす）。
      conditions.push(item);
      continue;
    }
    const id = nextGachaId(nextLibrary, usedIds);
    migrated += 1;
    nextLibrary.push({
      id,
      // ⚠ 名前は連番。⚠⚠ **景品の中身から名前を作らない**（作ると穴 Q の「まとめる」に近づく）。
      name: sanitizeGachaName(`移行したガチャ ${migrated}`),
      prizes: parseGachaPrizes(e.prizes),
    });
    conditions.push({ ...(item as object), effect: { kind: "gacha", gachaId: id } });
  }

  if (migrated === 0) return null;
  return { conditions, library: nextLibrary, migrated };
}

/**
 * 063d: 移行を**1 回だけ**実行して、ガチャの一覧を返す（⚠ **冪等**）。
 *
 * ⚠⚠⚠ **保存を起こす画面より前に必ず 1 回呼ぶこと。**
 * [`parseAssignment`] は 063a 形式を「出さない」へ落とすので、
 * **移行より先に `saveEffectConditions` が走ると景品が消える**。
 * ⚠ いまの唯一の呼び出し元は `ObsEffectsScreen`（`useState` の初期化＝子より先に走る）である。
 *
 * ⚠ 2 回目以降は [`migrateLegacyGachas`] が `null` を返すので**何も書かない**
 * （React StrictMode の二重呼び出しでも安全）。
 *
 * ## ⚠⚠ security-review S-1: **この関数は「読むだけでは書き戻さない」規律の唯一の例外である**
 *
 * 移行が 1 件でも起きると、下で `saveEffectConditions` が**保存値全体を書き戻す**ので、
 * [`parseConditions`] が落とす値（**未知 kind の将来の割り当て・21 件目以降のキーワード条件・
 * 壊れた条件行**）が、**画面を開いただけで恒久的に消える**。
 * ＝ 前方互換の性質が「読み取り時は保持」から「**移行が 1 度走ったら破棄**」へ変わっている。
 *
 * ⚠ **受容する理由**＝落ちる値はもともと `parseAssignment` が「出さない」へ倒していた
 * **inert なもの**で、消えても挙動は 1 ミリも変わらない。⚠⚠ **それでも明記するのは、
 * ここが「ユーザー操作なしに保存値を破壊的に書き換える唯一の経路」だから**である。
 * ⚠ **再修正トリガー＝保存形に「読めないが保持したい」値（サーバ由来の設定など）が入るとき。**
 * そのときは移行対象の条件だけを差し替え、他の要素は生のまま通すこと。
 */
export function runGachaMigration(): GachaDefinition[] {
  const library = loadGachaLibrary();
  let rawConditions: unknown;
  try {
    const raw = localStorage.getItem(EFFECT_ASSIGNMENTS_KEY);
    if (raw === null) return library;
    rawConditions = JSON.parse(raw) as unknown;
  } catch {
    return library;
  }
  const result = migrateLegacyGachas(rawConditions, library);
  if (result === null) return library;
  // ⚠ 先に一覧を保存する——順序が逆だと、条件だけ `gachaId` になって
  //   **指す先が無い**状態で落ちたときに景品が復元できない。
  const savedLibrary = saveGachaLibrary(result.library);
  // ⚠⚠ 条件は **`parseConditions` を通してから**保存する（生の JSON を直接書かない＝
  //   保存時と読み込み時で同じ規則を使うという `saveEffectConditions` の担保を外さない）。
  saveEffectConditions(parseConditions(result.conditions).map((m) => m.condition));
  return savedLibrary;
}

/**
 * ⚠⚠ **レビュー Q-6 で `isGachaMissingFromLibrary` を削除した（063d の実装直後）。**
 *
 * 「その `gachaId` が一覧に無いか」を答える述語を**この層にも置いていた**が、
 * まったく同じ実装が `effectSelectValue.ts` の [`isGachaMissingFromList`] にもあり、
 * ⚠⚠ **画面が使っていたのは後者だけ**で、こちらは**テストからしか呼ばれていなかった**
 * （＝規則が 2 通りあり、しかも固定されていたのは使われていない方）。
 * ⇒ **表示の受け皿を決める述語なので、持ち主は `effectSelectValue.ts` 1 か所**に寄せた
 * （[`isObsSourceMissingFromList`] の隣＝ OBS ソースと同じ場所に並ぶ）。
 * ⚠ **ここへ書き戻さないこと**（061d-2 レビュー S-4 の「検証を 2 か所に分けると片方だけ緩む」）。
 */

/**
 * ⚠⚠ **061p で `clearAllEffectConditions`（すべての条件を「表示しない」に戻す）を削除した。**
 *
 * 061h〜061l ではこれを「壊れたテンプレートで配信画面が読めなくなったときの唯一の脱出路」として
 * **テストで固定していた**。⚠ 061p の指示は「そのボタンは要らない」（画面の情報量を減らす）で、
 * **ボタンが無ければ純関数だけ残しても死蔵**になるため関数ごと落としている。
 * ⚠⚠ **061p 以降の脱出路は「条件を 1 行ずつ『エフェクトを出さない』に戻す」だけ**である
 * （同じ 061p で「ウィンドウを閉じる」も削除したので、もう一方の脱出路も無い）。
 * ⚠ **再修正トリガー＝実機で「配信画面が埋まって戻せない」が起きたとき。** そのときは
 * この関数と 1 ボタンを復活させること（[`removeCondition`] の隣に置くのが元の形）。
 */

/**
 * 064b → **063b で 2 kind を通すよう広げた**: **発火する条件を引く matcher**（`decideEffects` に渡す）。
 *
 * ## ⚠⚠ このレーンを回すのはコメビュ窓である
 *
 * sidecar と WS で繋がっているのは**コメビュ窓だけ**なので、OBS を鳴らせるのもあの窓だけ
 * （064a の `ObsSourceCard` が localStorage 経由で代行させているのと同じ構造上の非対称）。
 *
 * ## ⚠⚠⚠ 063b: レーンは 1 本のままで、`select` が 2 つの kind を通す
 *
 * 064b〜064d の JSDoc は**「063（ガチャ）が 2 本目のレーンとして入る予定」**と書いていたが、
 * ⚠⚠ **それは「ガチャが別の窓に描く」と思われていた頃の見込みである**。
 * 064d でエフェクト窓が廃止され、**ガチャの出力先も OBS のソース**になった
 * ＝ **出力先が同じ**なので、2 本にすると次の 2 つが壊れる:
 *   1. ⚠⚠ **1 コメントが 2 回発火しうる**（レーンごとに「最初の 1 件」を取るため）
 *   2. ⚠ **バースト枠が 2 倍になる**（出力先は 1 つなので、画面上の同時表示が [`EFFECT_MAX_CONCURRENT`] を超える）
 * ⇒ **レーンは 1 本**（`T = EffectObsSource | EffectGacha`）。**バースト枠とクールダウンは共有されるのが正しい。**
 * ⚠ **`EffectTriggerState` をもう 1 組作らないこと**（061d-2 穴 γ ／ 061j 穴 η ／ 061k と同型の罠を、
 * そもそも作らない形＝レーンが 1 本なら state も 1 本しか要らない）。
 *
 * ## ⚠⚠⚠ `select` を `!== "none"` で書く理由（**allow-list にしないこと**）
 *
 * ⚠⚠ **063b の実装中に、当初の判断（allow-list にする）が誤りだと分かった。** 当初の根拠は
 * 「matcher 自身が**未知 kind に対する 2 枚目の網**になる」だったが、⚠⚠⚠ **それは成立しない**——
 * [`readConditions`] は必ず [`parseConditions`] → [`parseAssignment`] を通すので、
 * **未知の kind はここへ届く前に `{kind:"none"}` へ潰れている**（＝ allow-list は runtime では到達不能）。
 * ⚠ **ミューテーションで実測した**: `select` を allow-list から `!== "none"` へ緩める変異は
 * **1 件もレッドにならない**（＝ 2 つは runtime で等価）。
 *
 * ⇒ **runtime で等価なら、コンパイル時に強い方を採る。** 差が出るのは
 * **[`EffectAssignment`] に 4 本目の variant が入ったとき**である（実測）:
 *   - **`!== "none"`** … 絞り込みの結果が戻り値の型と合わなくなり **`tsc` が落ちる**
 *     ＝ **「この kind を鳴らすのか」を必ず判断させる**
 *   - **allow-list** … ⚠ **落ちない**。新しい kind は**黙って鳴らないだけ**になり、
 *     「割り当てたのに何も起きない」を画面のどこにも出さずに作る（061a Q-1 が最も嫌う形）
 * ⚠⚠ **「コンパイルを落として判断を強制する」は、このリポジトリでは事故ではなく設計された網である**
 * （062a の `EVENT_TYPE_MAP` の `Record` 型強制／063e 穴 H の `Record<CommentEventType, …>` 2 箇所と同型）。
 * ⚠ **安全側（鳴らさない）へ倒れることは失われない**——それは [`parseAssignment`] が
 * **1 枚目の網として既に担保している**（`effectFire.test.ts` の「未知の `kind` では何も鳴らない」が固定）。
 * ⚠ さらに `effectFire.ts` の `never` 網が**2 枚目のコンパイル時ゲート**になる。
 *
 * ⚠ `select` が `null` を返した条件は**当たった扱いにしない**＝バースト枠もクールダウンも消費しない
 * （下記 [`createConditionMatcher`] が正）。
 *
 * ## ⚠⚠⚠ 063b: ここで**抽選しないこと**（穴 A）
 *
 * ガチャを「引いて `EffectObsSource` へ解決してから返す」形にしてはいけない。
 * [`createConditionMatcher`] を読むと **`select` は `condition.when` の照合より前に呼ばれる**ので:
 *   1. **当たっていない条件でも引く**（走査した条件の数だけ乱数が回る）
 *   2. ⚠⚠⚠ **はずれが `null` になり「レーン違い」と区別できず、次の条件へ落ちる**
 *      ＝ **ガチャを外したら、下に並んだ別の条件が代わりに発火する**
 * ⚠ 2 は「出ない」を見るテストでは殺せない（**出てはいる**）。
 * ⇒ **抽選は発火が確定してから**（`effectFire.ts` の `decideFireResults` が正）。
 *
 * ## §9
 *
 * ⚠⚠ **OBS へ渡るのは `sourceName` だけ**＝**ユーザー自身が OBS で付けた名前**である。
 * コメント本文は照合に使って**その場で捨てる**（`EffectMatchInput` が本文を受けるが、
 * `EffectMatch` は本文を載せられない＝型で担保）。
 * ⚠ ガチャでも同じ——載るのは `gachaId`（**ユーザー自身が作ったガチャの識別子**）だけである。
 */
export function createEffectFireMatcher(): EffectMatcher<
  EffectObsSource | EffectGacha
> {
  // ⚠⚠ **キャストを書かないこと。** キャスト無しで通ることが、
  //   「4 本目の variant が入ったらここで `tsc` が落ちる」の担保そのものである。
  return createConditionMatcher((condition) =>
    condition.effect.kind !== "none" ? condition.effect : null,
  );
}

/**
 * 064b: **条件の走査そのもの**（通す kind の違いは `select` の 1 関数だけに閉じる）。
 *
 * ⚠⚠ **064b の時点では [`createEffectFireMatcher`] と、エフェクト窓側の matcher が
 * 1 実装を共有するために切り出した**（⚠ **後者は 064d で削除済み**——名前だけが
 * 長らく JSDoc に残っていたのを 063b で掃除した）。⚠ **切り出しの理由はいまも生きている**:
 * 走査を 2 通り書くと、課金ゲート・走査順・「最初の 1 件だけ」・クールダウンの規則が
 * **片方だけ緩む**（061d-2 レビュー S-4 以来の規律）。
 *
 * ⚠⚠ **`select` は「発火に使う kind か」と「何を発火させるか」を同時に答える。**
 * `null` を返した条件は**当たった扱いにしない**＝
 *   1. 判断 11 の「『出さない』条件はキーワードを塞がない」がそのまま維持される
 *   2. ⚠⚠ **通さない kind の条件が、バースト枠とクールダウンを食わない**
 *      （＝当たり判定の**前**に落ちる。上の [`createEffectFireMatcher`] の JSDoc が正）
 * ⚠ **「出ない」だけを見るテストでは 2 の変異は殺せない**（`recentFires` / `lastConditionAt` /
 * `lastGiftAt` のサイズを直接数えること）。
 *
 * ⚠⚠⚠ **`select` の呼び出しがループの先頭にあること（＝ `condition.when` の照合より前）が、
 * 「ここで抽選してはいけない」の理由そのものである**（上の穴 A）。⚠ **この順序を入れ替えないこと**
 * ——入れ替えると 2 の不変条件（枠を食わない）が壊れる。
 */
function createConditionMatcher<T extends object>(
  select: (condition: EffectCondition) => T | null,
): EffectMatcher<T> {
  return (input: EffectMatchInput): EffectMatch<T> | null => {
    const conditions = readConditions();
    // ⚠⚠ **コメント 1 件につき 1 回だけ**（判断 6）。
    // ⚠ `text` は必須 `string` だが**空文字はありうる**（サブスク／ギフト等は本文を持たない）。
    //   `undefined` チェックは要らない。⚠ 空キーワードを構造的に排除している
    //   （[`parseKeywordCondition`]）ので、`"".includes(k)` も `"" === k` も **false**＝安全側である。
    //   ⚠ **この論証があるので、ここに 3 枚目の空チェックは置かない**（同じ規則を 3 通りに書かない）。
    const text = normalizeForMatch(input.text);
    // ⚠⚠⚠ 063e 段 3 / 段 3-b: 報酬名も**同じ正規化**を通す（`normalizeForMatch` は保存側と共有）。
    //   ⚠ `undefined`（報酬名を持たない／取れなかったイベント）は `null` にする。
    //   ⚠⚠ 報酬ごとの条件の `rewardNormalized` は**必ず非空の文字列**なので、
    //   `null` とは決して一致しない＝**報酬名の無い引き換えに紐づけが当たることはない。**
    const rewardTitle =
      input.rewardTitle === undefined
        ? null
        : normalizeForMatch(input.rewardTitle);

    for (const { condition, normalized, rewardNormalized } of conditions) {
      // ⚠⚠ **061k（判断 5）/ 064b: 発火に使わない kind の条件は、当たり判定の前に落とす。**
      //   ⚠ ここを `decideEffects` の後ろ（＝戻り値を捨てる形）へ動かすと、
      //   **「出さない」条件がバースト枠とクールダウンを消費する**（上記 JSDoc）。
      //   ⚠ 「出ない」だけを見るテストでは**この変異は殺せない**（state のサイズを数えること）。
      // ⚠⚠⚠ 063b: **この行より後ろで抽選しないこと**（`select` の中も同じ・穴 A）。
      const effect = select(condition);
      if (effect === null) continue;
      if (condition.when.type === "event") {
        /**
         * ## ⚠⚠⚠ 063e 段 2: ここにあった**課金ゲート**（`if (!isMonetaryEvent(input.eventType)) continue;`）を削除した
         *
         * ⚠ **消して安全である論証**（＝これが無いと消せない）:
         *   [`parseConditions`] は event 条件の `eventType` が
         *   [`EFFECT_CONDITION_EVENT_TYPES`] の要素でなければ**捨てる**し、
         *   行を生やすのも同じ集合からである。
         *   ⇒ 条件配列の event 条件の `eventType` は**必ずその集合の要素**。
         *   ⇒ 直下の `condition.when.eventType === input.eventType` が成り立つなら、
         *     `input.eventType` も**必ずその集合の要素**である。
         *   ⇒ 集合を見るゲートは**常に true**＝1 つも仕事をしていない。
         *
         * ⚠⚠ **段 1 まで気付かなかったのは、許可集合と課金集合が同じ 1 つだったからである。**
         *   063e 段 2 で許可集合に**非課金の `channelpoint`** が入った瞬間、この行は
         *   「常に true」から「**チャネポだけを落とす**」へ意味が変わり、症状は
         *   **「条件表に行は出るのに、選んでも何も起きない」**——061a Q-1 が最も嫌う形になる。
         *
         * ⚠⚠⚠ **「新しい集合で書き換える」を採らなかった理由**＝ それは**許可集合の 2 枚目**であり、
         *   **2 枚目が drift したのが今回のバグそのもの**だからである。
         *   ⚠ このファイルは同じ規律を既に書いている（[`parseKeywordCondition`] が空キーワードを
         *   構造的に排除しているので「3 枚目の空チェックは置かない」）。それに揃えた。
         *
         * ⚠ **副産物**: このファイルから `isMonetaryEvent` の import が消えた
         *   ＝ **条件表の層は「お金」を 1 つも知らない**。チャンネルポイントは
         *   「対価だが金ではない」ので、意味論としてもこちらが正しい。
         *
         * ⚠⚠ **戻したくなったら**: 戻すのではなく [`parseConditions`] の許可集合を疑うこと
         *   （ここへ来る条件が集合外なら、壊れているのは門の側である）。
         *   ⚠ `effectAssignments.test.ts` の「chat / raid では event 条件が 1 件も当たらない」が
         *   この論証を固定している（**ゲートが無くても当たらない**ことの直接の担保）。
         */
        if (condition.when.eventType !== input.eventType) continue;
        /**
         * ## ⚠⚠⚠ 063e 段 3-b: **ここにあった報酬名の照合を `channelpoint` 条件へ移した**
         *
         * 段 3 は `if (rewardNormalized !== null && rewardNormalized !== rewardTitle) continue;`
         * をこの位置に持っていた（＝イベント条件 1 行に絞り込みが 1 つ載る形）。
         * ⚠ 段 3-b で**報酬ごとに行を分けた**ので、この行は 1 つも仕事をしなくなった
         * （イベント条件の `rewardNormalized` は [`eventCondition`] が必ず `null` にする）。
         * ⇒ **消した。** ⚠⚠ 残すと「**許可集合の 2 枚目**」と同じ種類の死んだ分岐になり、
         * 次に触る人が「イベント条件にも報酬名が載りうる」と誤読する。
         *
         * ## ⚠⚠⚠ 段 3-c: **チャンネルポイントはもうこの分岐へ来ない**
         *
         * 依頼者＝「**そもそもチャンネルポイント交換しただけで表示したいエフェクトなんか無い**」
         * ⇒ [`EFFECT_CONDITION_EVENT_TYPES`] から `channelpoint` を外した
         * （＝条件表から「チャンネルポイント」の行が消えた・総称の受け皿は**無い**）。
         * ⚠ 購読の `condition` は `broadcaster_user_id` だけで**報酬で絞っていない**ので
         * **全カスタム報酬の引き換えが届く**が、⚠⚠ **紐づけた報酬（`cp:`）以外は何も鳴らない。**
         */
        // ⚠ イベント条件にクールダウンは効かせない（スパチャ 2 連投の 2 件目を落とさない）。
        return { effect, conditionId: condition.id, cooldownMs: 0 };
      }
      /**
       * ## ⚠⚠⚠ 063e 段 3-b: **報酬ごとの条件**（＝「この報酬ならこれ」）
       *
       * ⚠ **イベント種別の検査を省かないこと**——`cp:` の行は
       * **チャンネルポイントの引き換えにしか当たってはいけない**。
       * ⚠⚠ 省くと、報酬名を持たない他のイベント（スパチャ等）で `rewardTitle` が `null` になり
       * **当たらないので一見動く**が、⚠⚠⚠ **将来 `rewardTitle` を持つ別のイベントが増えた日に
       * 黙って発火する**（＝そのとき誰も気づけない形の暴発になる）。
       *
       * ⚠ **クールダウンは 0**（イベント条件と同じ）。理由はキーワード条件と逆で、
       * ⚠⚠ **視聴者はチャンネルポイントという対価を払っている**——連呼対策の 10 秒
       * （[`KEYWORD_COOLDOWN_MS`]）を効かせると、**払ったのに何も起きない**が起きる。
       * 連投時の保護は [`BURST_MAX`]（`effectTrigger.ts`）が既に担っている。
       */
      if (condition.when.type === "channelpoint") {
        if (input.eventType !== CHANNEL_POINT_EVENT_TYPE) continue;
        // ⚠ `channelpoint` なら `rewardNormalized` は必ず非 null（`parseConditions` の不変条件）。
        //   型の都合で 1 行置く（キーワード条件の `normalized` と同じ形）。
        if (rewardNormalized === null) continue;
        // ⚠⚠ **完全一致**（部分一致にしないこと——「ガチャ」が「レアガチャ」にも当たる）。
        if (rewardNormalized !== rewardTitle) continue;
        return { effect, conditionId: condition.id, cooldownMs: 0 };
      }
      // ⚠ keyword なら `normalized` は必ず非 null（`parseConditions` の不変条件）。型の都合で 1 行置く。
      if (normalized === null) continue;
      const hit =
        condition.when.match === "exact"
          ? text === normalized
          : text.includes(normalized);
      if (!hit) continue;
      return {
        effect,
        conditionId: condition.id,
        cooldownMs: KEYWORD_COOLDOWN_MS,
      };
    }
    return null;
  };
}
