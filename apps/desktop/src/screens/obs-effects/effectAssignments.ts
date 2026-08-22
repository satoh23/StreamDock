import { EFFECT_ASSIGNMENTS_KEY } from "../../features/comment-viewer/overlaySettings";
import {
  isMonetaryEvent,
  MONETARY_EVENT_TYPES,
} from "../comment-viewer/viewerFormat";
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
 * ⚠ 保存するのは **イベント種別（`MONETARY_EVENT_TYPES` の 6 値）・テンプレート id（uuid v4）・
 * ユーザー自身が打ったキーワード**だけ。第三者の個人データ（本文・表示名・金額）は 1 バイトも入らない。
 * ⚠⚠ **061j でこの層に第三者のコメント本文が流れ込むようになった**（[`resolveEffectMatch`] の引数）。
 * 担保は**型**である＝ [`EffectMatchInput`] は `{ eventType, text }` だけを受け、
 * [`EffectMatch`] は**本文を載せない**（＝ `EffectRequest` は 8 キーのまま無改変）。
 * ⚠ **本文を localStorage にも DOM にもログにも出さない**
 * （`eslint.config.js` の `no-console` が `src/screens/obs-effects/**` に効いている）。
 * ⚠ **キーワードはユーザー自身の UI 設定値**なので localStorage に保存してよい
 * （`docs/security.md`「レビュー必須条件」の保存ポリシー項が明示的に除外している）。
 * ⚠ **ただしエフェクト窓の DOM にも `EffectRequest` にも出さない**——出す理由が無く、出すと
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
   * ⚠⚠ 本タスクの芯は「**入力の手数の少なさ**」なので、必須にしない。空のときは
   * **OBS のソース名を表示に使う**（表示のフォールバックは [`GachaPrizeTable`] が 1 か所で持つ）。
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
  /** 鳴らす OBS のソース名。⚠ 検証は [`isEffectObsSourceName`]（`EffectObsSource` と同じ規則）。 */
  sourceName: string;
}

/**
 * 063a: **ガチャの割り当て**（＝この条件が当たったら、景品から 1 つ抽選して鳴らす）。
 *
 * ⚠⚠ **063s の「再開時にどこから始めるか」が推した最小形そのものである**——
 * 064b の割り当て（条件 1 件 → OBS ソース **1 本**）を「条件 1 件 → ソース **N 本＋重み**」へ
 * 広げただけで、**新しいテーブルもコマンドも増えない**（Rust 差分ゼロ）。
 * ⚠ 063a 本文が書いていた `gachas` / `gacha_prizes` の 2 テーブル ＋ コマンド 9 本は**採らなかった**
 * （判断の全文は docs/progress.md の 063a 節・穴 F が正）。
 *
 * ⚠⚠⚠ **063a では、この割り当ては発火しない。** [`createObsSourceMatcher`] の `select` が
 * `null` を返す＝**当たり判定の前に落ちる**ので、バースト枠もクールダウンも消費しない
 * （061d-2 穴 γ 以来 4 回踏んだ罠を踏まないための形）。**抽選の本発火は 063b。**
 * ⚠ 「割り当てたのに何も出ない」が黙って起きないよう、**画面に注記を出している**
 * （[`GachaPrizeTable`] の `gachaNote`）。⚠ **注記を先に消さないこと**（063b で挙動が入ってから消す）。
 *
 * ⚠ **景品 0 件でも `{ kind:"gacha", prizes: [] }` のまま保持する**（`{kind:"none"}` へ潰さない）。
 * 潰すと「ガチャを選んだのに次に開いたら『出さない』に戻っている」＝**黙って設定が消える**。
 * 0 件は UI が「景品がありません」と出して観測可能にする。
 */
export interface EffectGacha {
  kind: "gacha";
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
 * 061j: 条件 1 件の**いつ出すか**。
 *
 * ⚠ **061k がここへ足した「出力先（全画面 / コーナー）」は 064d で軸ごと削除した。**
 * 出力先は「**StreamDock のどちらの窓に描くか**」という意味だったので、
 * **窓に描くのをやめた**（＝ OBS 側のソースを鳴らす）時点で意味を失った。
 * ⚠ **条件の種類ごとに複製することになる形はここへ入れない**という 061j の規律は生きている。
 */
export type EffectConditionWhen =
  | { type: "event"; eventType: string }
  | { type: "keyword"; text: string; match: EffectKeywordMatch };

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
    // ⚠⚠ 063a: **景品 0 件でも gacha のまま返す**（`{kind:"none"}` へ潰さない・[`EffectGacha`] の注記が正）。
    return { kind: "gacha", prizes: parseGachaPrizes((raw as { prizes?: unknown }).prizes) };
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
 */
const parseGachaPrize = (raw: unknown): GachaPrize | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as { name?: unknown; weight?: unknown; sourceName?: unknown };
  const { name, weight, sourceName } = item;
  if (typeof name !== "string") return null;
  if (hasControlChar(name)) return null;
  if ([...name].length > GACHA_PRIZE_NAME_MAX_LENGTH) return null;
  // ⚠⚠ **0 / 負 / 小数 / NaN / 上限超はすべて落とす**（0 除算と「絶対に出ない景品」を構造的に排除する）。
  if (typeof weight !== "number" || !Number.isSafeInteger(weight)) return null;
  if (weight < 1 || weight > GACHA_WEIGHT_MAX) return null;
  // ⚠ ソース名の規則は `EffectObsSource` と**同じ 1 つ**（規則を 2 通りに書かない）。
  if (!isEffectObsSourceName(sourceName)) return null;
  // ⚠ 保存するのは trim 済みの値（064 レビュー S-10 と同じ理由＝一覧との照合が完全一致であるため）。
  return { name: name.trim(), weight, sourceName: sourceName.trim() };
};

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
 * 061j（判断 7）: **同じ条件が続けて発火しない**ための最小間隔。
 *
 * 根拠: エフェクトの表示時間は `manifest.durationMs`（500〜15000ms）。同じキーワードに毎回反応すると
 * 重なり続ける。「同じ単語には 10 秒に 1 回まで」なら、視聴者が連呼しても画面が埋まらず、
 * 反応が返っている感覚は残る。
 * ⚠ **イベント条件には効かせない**（`cooldownMs: 0`）——課金は 1 件ずつが重要で、
 * スパチャ 2 連投の 2 件目を落としたくない。連投対策は既存の gift 畳み込み（043a の N+1）と
 * バースト上限が既に担っている。
 * ⚠ **設定項目にしない**（「たぬえさ3 より簡単に」＝設定を増やさない・061d の (2) と同じ規律）。
 * **再修正トリガー＝実機で「反応が鈍い／うるさい」と言われたとき。**
 * ⚠⚠ **`BURST_MAX` とは別軸である**（`effectTrigger.ts` の [`CONDITION_COOLDOWN_MAX_MS`] の注記が正）。
 */
export const KEYWORD_COOLDOWN_MS = 10_000;

const EVENT_ID_PREFIX = "event:";
const KEYWORD_ID_PREFIX = "kw:";

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
 *   - **前半＝イベント条件ちょうど 6 件**。`MONETARY_EVENT_TYPES` の**挿入順**（＝`EFFECT_EVENT_ROWS` と
 *     同じ並び）で、重複は**先勝ち**で潰し、欠けは `{ kind: "none" }` で埋め、**未知の eventType は捨てる**
 *   - **後半＝キーワード条件**（保存順・[`parseKeywordCondition`] を通ったものだけ・最大
 *     [`KEYWORD_CONDITION_MAX`] 件）
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
        if (typeof eventType !== "string" || !MONETARY_EVENT_TYPES.has(eventType)) continue;
        // ⚠ **先勝ち**（2 件目以降は無視する）。
        if (events.has(eventType)) continue;
        events.set(eventType, parseAssignment((item as { effect?: unknown }).effect));
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
    for (const eventType of MONETARY_EVENT_TYPES) {
      const value = (raw as Record<string, unknown>)[eventType];
      if (value === undefined) continue;
      events.set(eventType, parseAssignment(value));
    }
  }

  // ⚠ **並びの持ち主は `MONETARY_EVENT_TYPES` の挿入順**（`EFFECT_EVENT_ROWS` と同じ）。
  //   ⚠ 7 種別目が増えたら、保存値に無くてもここで自動的に 7 行目が生える。
  const out: MatchableCondition[] = [];
  for (const eventType of MONETARY_EVENT_TYPES) {
    out.push(
      eventCondition(eventType, events.get(eventType) ?? DEFAULT_EFFECT_ASSIGNMENT),
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
 * ⚠ **戻り値は必ず「イベント条件 6 件 ＋ キーワード条件」**（[`parseConditions`] の不変条件）。
 * 呼び出し側が「行があるか」を毎回気にしなくてよくなる。
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
    if (!hasKeyword && !hasNonDefaultEvent) {
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
 * 064b: **OBS 側のソースを鳴らすレーンの matcher**（`decideEffects` に渡す）。
 *
 * ## ⚠⚠ このレーンを回すのはコメビュ窓である
 *
 * sidecar と WS で繋がっているのは**コメビュ窓だけ**なので、OBS を鳴らせるのもあの窓だけ
 * （064a の `ObsSourceCard` が localStorage 経由で代行させているのと同じ構造上の非対称）。
 * ⇒ **エフェクト窓は OBS レーンを 1 度も見ない**（上の [`createEffectMatcher`] が弾く）。
 *
 * ## ⚠ 064d: レーンは 1 本だけになった
 *
 * 064b の時点では「エフェクト窓に描くレーン」と共存していたので、
 * **相手のレーンの条件を当たり判定の前に落とす**ことが最重要の不変条件だった。
 * 064d で取り込み機能ごと消えたので、**いま条件が持つ発火先は OBS ソースだけ**である。
 * ⚠ **それでも `select` で絞る形は残してある**——063（ガチャ）が 2 本目のレーンとして入る予定で、
 * そのとき「当たり判定の前に落とす」を**作り直さずに済む**（061d-2 穴 γ 以来 4 回踏んだ罠）。
 *
 * ## ⚠⚠ レーンごとに `EffectTriggerState` を分けること（呼び出し側の責務）
 *
 * 061k が 2 窓で作った構えと同じ＝**バースト枠とクールダウンはレーンごとに独立**である。
 * 共有すると「OBS のソースが 3 回鳴っただけで、直後の投げ銭がエフェクト窓で捨てられる」が起きる
 * （061d-2 穴 γ ／ 061j 穴 η ／ 061k と同型で **4 例目**）。
 *
 * ## §9
 *
 * ⚠⚠ **OBS へ渡るのは `sourceName` だけ**＝**ユーザー自身が OBS で付けた名前**である。
 * コメント本文は照合に使って**その場で捨てる**（`EffectMatchInput` が本文を受けるが、
 * `EffectMatch` は本文を載せられない＝型で担保）。
 */
export function createObsSourceMatcher(): EffectMatcher<EffectObsSource> {
  return createConditionMatcher((condition) =>
    condition.effect.kind === "obs-source" ? condition.effect : null,
  );
}

/**
 * 064b: **条件の走査そのもの**（レーンの違いは `select` の 1 関数だけに閉じる）。
 *
 * ⚠⚠ **[`createEffectMatcher`] と [`createObsSourceMatcher`] が 1 実装を共有するために切り出した。**
 * 走査を 2 通り書くと、課金ゲート・走査順・「最初の 1 件だけ」・クールダウンの規則が
 * **片方だけ緩む**（061d-2 レビュー S-4 以来の規律）。
 *
 * ⚠⚠ **`select` は「自分のレーン宛てか」と「何を発火させるか」を同時に答える。**
 * `null` を返した条件は**当たった扱いにしない**＝
 *   1. 判断 11 の「『出さない』条件はキーワードを塞がない」がそのまま維持される
 *   2. ⚠⚠ **もう一方のレーンの条件が、このレーンのバースト枠とクールダウンを食わない**
 *      （＝当たり判定の**前**に落ちる。上の [`createObsSourceMatcher`] の JSDoc が正）
 * ⚠ **「出ない」だけを見るテストでは 2 の変異は殺せない**（`recentFires` / `lastConditionAt` /
 * `lastGiftAt` のサイズを直接数えること）。
 */
function createConditionMatcher<T extends object>(
  select: (condition: EffectCondition) => T | null,
): EffectMatcher<T> {
  return (input: EffectMatchInput): EffectMatch<T> | null => {
    const conditions = readConditions();
    // ⚠ 生の `eventType`（罠 1）。
    const monetary = isMonetaryEvent(input.eventType);
    // ⚠⚠ **コメント 1 件につき 1 回だけ**（判断 6）。
    // ⚠ `text` は必須 `string` だが**空文字はありうる**（サブスク／ギフト等は本文を持たない）。
    //   `undefined` チェックは要らない。⚠ 空キーワードを構造的に排除している
    //   （[`parseKeywordCondition`]）ので、`"".includes(k)` も `"" === k` も **false**＝安全側である。
    //   ⚠ **この論証があるので、ここに 3 枚目の空チェックは置かない**（同じ規則を 3 通りに書かない）。
    const text = normalizeForMatch(input.text);

    for (const { condition, normalized } of conditions) {
      // ⚠⚠ **061k（判断 5）/ 064b: 自分のレーン宛てでない条件は、当たり判定の前に落とす。**
      //   ⚠ ここを `decideEffects` の後ろ（＝`EffectRequest` を捨てる形）へ動かすと、
      //   **もう一方のレーンの条件がこのレーンのバースト枠とクールダウンを消費する**（上記 JSDoc）。
      //   ⚠ 「出ない」だけを見るテストでは**この変異は殺せない**（state のサイズを数えること）。
      const effect = select(condition);
      if (effect === null) continue;
      if (condition.when.type === "event") {
        // ⚠⚠ 課金ゲート（判断 5）。⚠ ここを `decideEffects` の先頭へ戻すとキーワードが永久に当たらない。
        if (!monetary) continue;
        if (condition.when.eventType !== input.eventType) continue;
        // ⚠ イベント条件にクールダウンは効かせない（スパチャ 2 連投の 2 件目を落とさない）。
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
