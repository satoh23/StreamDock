import { EFFECT_ASSIGNMENTS_KEY } from "../../features/comment-viewer/overlaySettings";
import {
  isMonetaryEvent,
  MONETARY_EVENT_TYPES,
} from "../comment-viewer/viewerFormat";
import type {
  EffectKind,
  EffectMatch,
  EffectMatcher,
  EffectMatchInput,
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
 * ⚠⚠ **`EffectKind`（061b/061d-2）に `"none"` を足した形にしてある**——「出さない」は
 * **発火するかどうか**の判断であって「どう描くか」ではないので、`EffectKind` 側へ入れると
 * `EffectRequest` に「描けない kind」が生まれてしまう（描画分岐が必ず不能ケースを持つ）。
 * ここで受け取り、[`resolveEffectMatch`] が `null` へ翻訳して発火層へ渡す。
 *
 * ⚠ **063（ガチャ）は `{ kind: "gacha"; … }` を足す**。そのとき下の [`parseAssignment`] に
 * 1 分岐足せば、**旧ビルドは「未知の kind → 出さない」へ安全側に倒れる**（＝前方互換）。
 * この前方互換があるので、保存形に `version` フィールドは持たせていない
 * （版番号にすると「版が違う＝全部捨てる」というより粗い壊れ方を新しく作ることになる）。
 * ⚠ **061h の移行もこの仕組みがそのまま担う**——既に保存されている
 * `{"kind":"builtin-monetary"}` は**未知の kind として「出さない」へ倒れる**。
 */
export type EffectAssignment = { kind: "none" } | EffectKind;

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
 * 061k: 条件 1 件の**どこへ出すか**（＝どちらの出力窓に出すか）。
 *
 * ⚠⚠ **061j の語彙の線に 3 本目を足したもの**——**条件＝いつ出すか**（[`EffectConditionWhen`]）／
 * **割り当て＝何を出すか**（[`EffectAssignment`]）／**出力先＝どこへ出すか**（ここ）。
 * ⚠ `when` にも `effect` にも入れない: `when` に入れると
 * `{type:"keyword"; text; match; output}` のように**条件の種類ごとに複製**することになり、
 * `effect` に入れると `{kind:"none"}` に出力先が無い＝**描けない kind と同型の不能ケース**が生まれる。
 *
 * ⚠ **既定は `"corner"`**（[`DEFAULT_EFFECT_OUTPUT`]）＝ **061j までの唯一の窓**なので、
 * 既存ユーザーの見え方が 1 ミリも変わらない。
 */
export type EffectOutput = "corner" | "stage";

/** 061k: 出力先の全値（保存形の検証と、窓ごとの繰り返しに使う）。⚠ 並び順に意味は無い。 */
export const EFFECT_OUTPUTS: readonly EffectOutput[] = ["corner", "stage"];

/**
 * 061k: 保存値に `output` が無い／未知の値だったときの倒し先。
 *
 * ⚠⚠ **061j の「未知は安全側へ倒す」と形は同じだが、意味が違う。** あちらの安全側は
 * **「出さない」**（`{kind:"none"}`）だったが、ここでの安全側は**「既存の挙動」**である
 * ——`"corner"` は 061j までの唯一の窓なので、旧保存値がそのまま同じ見え方で動く。
 * ⚠ **混同して `"stage"` を既定にすると、既存ユーザーの投げ銭演出が全部全画面に出る。**
 */
export const DEFAULT_EFFECT_OUTPUT: EffectOutput = "corner";

/**
 * 061k: 出力先 → **その窓の実タイトル**（＝OBS に作られるソース名）。
 *
 * ⚠⚠ **これは窓名の「3 つ目の写し」であり、機能要件である。** 1 つ目は Rust の `.title(...)`、
 * 2 つ目は sidecar の `OBS_OVERLAYS[kind].windowTitle`、そして 3 つ目が
 * **frontend がユーザーへ案内する文字列**（エフェクト窓のセットアップ用ガイド本文と
 * `ObsEffectsScreen` の案内文）である。⚠ ユーザーは **OBS のウィンドウ一覧をこの文字列で探す**ので、
 * ずれると窓が見つからない＝機能が壊れる。
 * ⚠⚠ しかも**ガイド本文は OBS のキャプチャに数十秒そのまま映る**（＝配信を見ている視聴者にも読める）。
 * 061i の実機確認で「ガイド本文だけが古い」を実際に踏んでいる。
 *
 * ⇒ **窓名を直書きせず必ずこの表から引くこと。** Rust の
 * `overlay_window_contract::frontend_window_title_table_matches_overlay_titles` が
 * この表の値と `OVERLAY_TITLES` の**バイト一致**、および**エントリ数 2** を固定している。
 * ⚠ **候補一致は sidecar 側で `includes`** なので、値どうしが互いに部分文字列になってはいけない
 * （＝ `"StreamDock エフェクト（全画面）"` は不可。同テストと sidecar の総当たりが固定）。
 */
export const EFFECT_OUTPUT_WINDOW_TITLE: Readonly<Record<EffectOutput, string>> = {
  corner: "StreamDock エフェクト",
  stage: "StreamDock ステージ演出",
};

/**
 * 061k: 出力先 → **画面での呼び方**（判断 2）。
 *
 * ⚠⚠ **窓タイトル（[`EFFECT_OUTPUT_WINDOW_TITLE`]）とは別物。** 既存窓は 960×360 で名前も
 * 「StreamDock エフェクト」＝「コーナー」とは書いていないが、**改名は禁止**（既存ユーザーの
 * OBS ソースが `ensureOverlaySource` の M2 経路で静かに壊れるため）。
 * ⇒ **UI 上の呼び方だけを変え、OBS のソース名は実際の窓名をそのまま案内する**という非対称にしてある。
 * ⚠ **案内文では必ず両方を出すこと**（「コーナー（小さめ）」だけ書くと OBS で探せない）。
 */
export const EFFECT_OUTPUT_LABEL: Readonly<Record<EffectOutput, string>> = {
  corner: "コーナー（小さめ）",
  stage: "全画面（ステージ）",
};

/**
 * 061j: 条件 1 件の**いつ出すか**。
 *
 * ⚠ **061k の「出力先（全画面 / コーナー）」はここに入っていない。** 061j はこの JSDoc に
 * 「先回りで足さないこと」という予約席を書いていたが、**あれは置き場所の指定ではなかった**——
 * 実際の置き場所は [`EffectCondition.output`]（＝**第 3 のフィールド**）である。理由は
 * [`EffectOutput`] の JSDoc が正（`when` に入れると条件の種類ごとに複製することになる）。
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
  /**
   * 061k: **どこへ出すか**（第 3 の軸）。⚠ 保存値に無ければ [`DEFAULT_EFFECT_OUTPUT`]。
   *
   * ⚠⚠ **`effect.kind === "none"` の条件では必ず既定へ丸められる**（[`parseConditions`]）。
   * 「何も出さない条件の出力先」に意味は無く、丸めておくと
   * [`saveEffectConditions`] の「キーごと削除」条件が**1 文字も変えずに正しいまま**になる
   * （＝ユーザーが変えた出力先が黙って消える経路が構造的に生まれない）。
   */
  output: EffectOutput;
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
 * テンプレート id として受け入れる形（**uuid の「形」＝ 36 文字・hex とハイフンの完全一致**）。
 *
 * ⚠ **061d-2 レビュー S-3: 「uuid v4 完全一致」ではない**——version / variant のニブルは見ていない。
 * それは Rust の `is_template_id`（`effect_template/service.rs`）も同じで、**2 層の強さが揃っている**
 * ことのほうが重要（片方だけ厳しくすると、Rust が受け入れる id を TS が黙って「出さない」へ倒す）。
 * ここの目的はパス安全（`../` / 絶対パス / 区切り文字を通さない）で、形の一致で十分である。
 *
 * ⚠ **`overlaySettings.ts` の `OVERLAY_THEME_ID_RE` と同型・同じ理由**（060d の先例）——
 * id を採番するのは Rust の `effect_template::service` の `Uuid::new_v4()` だけなので、
 * 細工された localStorage 値がそもそもコマンドまで届かない（届いても Rust が弾くだけなので
 * 多層防御の 1 枚目という位置づけ）。
 * ⚠ **再修正トリガー＝ Rust の id 採番方式を変えるとき**（変えると条件が黙って「出さない」へ落ちる）。
 */
const EFFECT_TEMPLATE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 061h: テンプレート id として受け入れてよい形か。
 *
 * ⚠⚠ **正規表現の持ち主を 1 か所に保つための export である。** 061h で
 * **エフェクト窓のテスト表示が localStorage 経由で id を受け取る**ようになった
 * （`EFFECT_TEST_FIRE_KEY` の値が `<nonce>:<templateId>`）ので、あちらでも同じ検証が要る。
 * ⚠ 2 か所に同じ正規表現を書くと**片方だけ緩む**（061d-2 レビュー S-4 が「検証を 2 か所に
 * 分けない」と書いたのと同じ理由）ので、述語として共有する。
 */
export const isEffectTemplateId = (value: unknown): value is string =>
  typeof value === "string" && EFFECT_TEMPLATE_ID_RE.test(value);

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
  if (kind === "template") {
    const templateId = (raw as { templateId?: unknown }).templateId;
    // ⚠ 形が違えば「出さない」へ（061h で反転。旧実装は「組み込み」へ倒していた）。
    if (!isEffectTemplateId(templateId)) return DEFAULT_EFFECT_ASSIGNMENT;
    return { kind: "template", templateId };
  }
  // ⚠ 旧ビルドが書いた "builtin-monetary"（061h で廃止）と、未知の kind
  //   （063 の "gacha" を古いビルドが読んだ場合を含む）。どちらも「出さない」へ倒す。
  return DEFAULT_EFFECT_ASSIGNMENT;
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
 * 061k: 保存値の `output` を [`EffectOutput`] へ落とす。**未指定・未知・非文字列はすべて既定へ**。
 *
 * ⚠⚠ **`effect` を一緒に見て「出さない条件」は既定へ丸める。** 判断 4-b の 2 案のうち
 * 「保存時に丸める」を採ったのがここ 1 行で、これにより [`saveEffectConditions`] の
 * 「キーごと削除」条件が**無改変のまま正しくなる**——「イベント条件が全部 `none` だが 1 件だけ
 * `output` を変えた」という状態が**保存形に存在しなくなる**ため。
 * ⚠ 却下した案（削除条件に「すべての `output` が既定」を足す）は、`{kind:"none"} × output:"stage"` という
 * **意味の無い状態を保存形に増やす**ので採らない。
 *
 * ⚠ **既定は `"corner"`＝「既存の挙動」**であって「出さない」ではない（[`DEFAULT_EFFECT_OUTPUT`]）。
 */
const parseOutput = (raw: unknown, effect: EffectAssignment): EffectOutput => {
  // ⚠ 「何も出さない条件の出力先」は意味が無いので、必ず既定へ丸める（上記）。
  if (effect.kind === "none") return DEFAULT_EFFECT_OUTPUT;
  // ⚠ 照合は**値の配列に対する `includes`**（`raw in TABLE` 形にすると `"__proto__"` 等が
  //   プロトタイプ経由で真になる。sidecar の `parseOverlayKind` が同じ理由で同じ形を採っている）。
  return typeof raw === "string" &&
    (EFFECT_OUTPUTS as readonly string[]).includes(raw)
    ? (raw as EffectOutput)
    : DEFAULT_EFFECT_OUTPUT;
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
      // ⚠ 061k: 未知・未指定は既定へ／`none` は既定へ丸める（[`parseOutput`]）。
      output: parseOutput((raw as { output?: unknown }).output, effect),
    },
    normalized,
  };
};

/** イベント条件 1 件（`effect` は検証済み）。 */
const eventCondition = (
  eventType: string,
  effect: EffectAssignment,
  output: EffectOutput,
): MatchableCondition => ({
  condition: {
    id: `${EVENT_ID_PREFIX}${eventType}`,
    when: { type: "event", eventType },
    effect,
    output,
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
  // ⚠ 061k: 値が `EffectAssignment` から `{effect, output}` の対になった（**出力先も先勝ちで運ぶ**）。
  //   ⚠ 「effect は 1 件目・output は 2 件目」のような取り違えが起きない形にするため、対で入れる。
  const events = new Map<string, { effect: EffectAssignment; output: EffectOutput }>();
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
        const effect = parseAssignment((item as { effect?: unknown }).effect);
        events.set(eventType, {
          effect,
          output: parseOutput((item as { output?: unknown }).output, effect),
        });
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
      // ⚠ 061k: 旧形式（061i まで）に出力先という概念は無いので、**必ず既定＝コーナー**へ。
      //   ＝ 061j までのユーザーの見え方が 1 ミリも変わらない（判断 4-b の目的そのもの）。
      events.set(eventType, {
        effect: parseAssignment(value),
        output: DEFAULT_EFFECT_OUTPUT,
      });
    }
  }

  // ⚠ **並びの持ち主は `MONETARY_EVENT_TYPES` の挿入順**（`EFFECT_EVENT_ROWS` と同じ）。
  //   ⚠ 7 種別目が増えたら、保存値に無くてもここで自動的に 7 行目が生える。
  const out: MatchableCondition[] = [];
  for (const eventType of MONETARY_EVENT_TYPES) {
    const saved = events.get(eventType);
    out.push(
      eventCondition(
        eventType,
        saved?.effect ?? DEFAULT_EFFECT_ASSIGNMENT,
        // ⚠ 061k: 欠けている行は既定の出力先。⚠ 既定の `effect` は `none` なので、
        //   `parseOutput` の丸めと結果は一致する（＝2 通りの既定を作っていない）。
        saved?.output ?? DEFAULT_EFFECT_OUTPUT,
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
 * ⚠⚠ **061k: この削除条件は 1 文字も変えていない。** 061k は条件に `output`（出力先）を足したので、
 * 素直に読むと「イベント条件の出力先だけ変えた」状態が**「全部 `none`」の条件を満たしたまま消える**
 * ＝ **ユーザーが変えた出力先が黙って消える**。⇒ **[`parseOutput`] が「`effect.kind === "none"` の
 * 条件の `output` を既定へ丸める**ことで、**その状態を保存形から構造的に消した**（判断 4-b の推奨案）。
 * ⚠ **ここに `output` を見る条件を足さないこと**——足すと「何も出さないのに保存値が残る」状態が復活する。
 * ⚠ 逆に丸めを外すと、この関数は**無改変のまま静かに壊れる**（丸めと削除条件は対で成立している）。
 *
 * ⚠ **061d-2 レビュー S-4（受容・修正不要）: 書き込み時に `templateId` の形は検査しない**……のではなく、
 * **`parseAssignment` を通すので検査される**（061j で保存経路も同じ関数に寄せたため強くなった）。
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
      // ⚠ 061k: **追加時の出力先は必ず既定**（＝コーナー）。出力先を選ぶのは追加した「あと」で、
      //   UI もそう作ってある（行を追加してから `<select>` で変える）。
      output: DEFAULT_EFFECT_OUTPUT,
    },
  ];
  saveEffectConditions(next);
  return loadEffectConditions();
}

/**
 * 061k: 条件 1 件の**出力先**（どこへ出すか）を変える。イベント条件・キーワード条件のどちらにも使う。
 *
 * ⚠⚠ **061j 申し送りの「条件を書き換える経路は全部 `commitConditions` を通す」の 7 本目**である。
 * hook（`useEffectTemplates`）側で必ず包むこと——通さないと**派生値 2 キーが追従しない**
 * ＝「stage 条件を作ったのに stage 窓が開かない」が黙って起きる。
 *
 * ⚠ 存在しない id を渡しても**何も起きない**（保存関数が 6 行を作り直すので構造的に無害）。
 * ⚠ `effect.kind === "none"` の条件に対して呼んでも、[`parseOutput`] が保存時に既定へ丸めるので
 * **値は変わらない**（＝ UI 側でその行の `<select>` を disabled にしてあるのと対）。
 */
export function setConditionOutput(
  id: string,
  output: EffectOutput,
): EffectConditions {
  const next = loadEffectConditions().map((c) =>
    c.id === id ? { ...c, output } : c,
  );
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
 * ⚠⚠ **復帰導線＝すべての条件を「表示しない」に戻す。**
 *
 * 060d の「既定のデザインに戻す」と同じ位置づけで、**壊れたテンプレート（巨大・真っ黒・画面全体を
 * 覆う）を割り当てて配信画面が読めなくなったときの唯一の脱出路**である。
 * ⚠⚠ **キーワード条件そのものは消さない**——これは**復帰導線**であってリセットではない
 * （テンプレートを削除しないのと同じ判断。**ユーザーが打った文字列を勝手に捨てない**）。
 * ⚠ **これはテストで固定する**（no-op にする変異でも、キーワードごと消す変異でもレッドになること）。
 */
export function clearAllEffectConditions(): EffectConditions {
  const next = loadEffectConditions().map((c) => ({
    ...c,
    effect: DEFAULT_EFFECT_ASSIGNMENT,
  }));
  saveEffectConditions(next);
  return loadEffectConditions();
}

/**
 * 指定テンプレートを指している条件を**「表示しない」へ戻す**（テンプレート削除時に呼ぶ）。
 *
 * ⚠⚠ **061h で戻し先を反転した。** 061d-2 は「削除の副作用でエフェクトが**黙って止まる**のを避ける」
 * ために組み込みへ戻していたが、組み込みを廃止した以上ほかに倒しようがなく、かつ
 * 「消したテンプレートの代わりに**頼んでいない演出**が出る」ほうが今の運用では害が大きい。
 * ⚠ **061j: キーワード条件も対象**（あちらが指している場合も同じく戻す）。
 * ⚠ **削除操作のときだけ保存値を書き換える。** 「一覧に無い id」を見つけただけでは書き換えない
 * ——`list_effect_templates` が一時的に失敗した場合や、061c の「読めない行は黙って落とす」に
 * 当たっただけの場合に、**ユーザーの設定が黙って消える**ため（そちらは UI の警告で扱う）。
 */
export function clearEffectConditionsForTemplate(
  templateId: string,
): EffectConditions {
  const next = loadEffectConditions().map((c) =>
    c.effect.kind === "template" && c.effect.templateId === templateId
      ? { ...c, effect: DEFAULT_EFFECT_ASSIGNMENT }
      : c,
  );
  saveEffectConditions(next);
  return loadEffectConditions();
}

/**
 * 061i: **「エフェクトを表示する条件」の数**＝エフェクトを出す設定になっている条件の数。
 *
 * ⚠⚠ **`assignedTemplateIds().length` とは違う**（あちらは**重複を潰した id の数**＝先読みの対象）。
 * ここが数えるのは**行の数**なので、6 種別すべてに同じテンプレートを割り当てたら 6 である
 * （前提ステータスの「表示する条件」に出す値が「1 件」だと嘘になる）。
 *
 * ⚠ **061i の派生値（`EFFECT_OVERLAY_ENABLED_KEY`）と画面表示の両方がこの 1 か所を見る**——
 * 「条件があるか」の定義を 2 通りに書かないため（判断 2 の「2 つの真実」を増やさない）。
 * ⚠⚠ **061j で保存形が配列になったが、数える規則は 1 文字も変えていない**
 * （＝`kind === "template"` の行を数える）。061i が「そのとき直すのはこの関数だけで済む」ように
 * 呼び出し側へ数え方を持たせなかった意図がそのまま効いた。
 * ⚠ **キーワードを打っただけでは数に入らない**（エフェクトを選んで初めて 1 件になる）＝
 * イベント行と同じ規則であり、「窓がいつ開くか」の説明が 1 本で済む。
 *
 * ⚠⚠ **061k: `output` を省略すると合計**（既存の呼び出しが 1 文字も変わらない）。
 * 渡すと**その出力先の条件だけ**を数える＝ **窓を開くかの判定は必ず出力先ごとに行う**
 * （`effectConditionCount(conditions, "stage") > 0` でステージ窓を開く）。
 * ⚠ **省略時を「corner」にしないこと**——前提ステータスの「表示する条件」は**合計**を出すので、
 * 既定を片方の窓にすると画面の数字が黙って半分になる。
 */
export function effectConditionCount(
  conditions: EffectConditions,
  output?: EffectOutput,
): number {
  let count = 0;
  for (const c of conditions) {
    if (c.effect.kind !== "template") continue;
    if (output !== undefined && c.output !== output) continue;
    count += 1;
  }
  return count;
}

/**
 * 061i: **条件が 1 件以上あるか**（＝その出力窓を出すべきか＝`*_OVERLAY_ENABLED_KEY` の値）。
 *
 * ⚠ **「一覧に無い id を指している条件」も 1 件として数える。** 保存値は
 * `list_effect_templates` の成否で書き換えない（上の `clearEffectConditionsForTemplate` の注記）ので、
 * 一覧が一時的に読めないだけでフラグが false へ倒れると **OBS のソースが黙って消える**。
 * 「割り当てたのに出ない」は `EffectAssignmentCard` の警告のほうで観測する。
 *
 * ⚠ 061k: `output` は [`effectConditionCount`] にそのまま渡る（省略＝合計）。
 */
export function hasEffectConditions(
  conditions: EffectConditions,
  output?: EffectOutput,
): boolean {
  return effectConditionCount(conditions, output) > 0;
}

/**
 * 条件に出てくるテンプレート id（重複なし）。⚠ **先読みの対象はこれだけ**（一覧全部ではない）。
 *
 * ⚠ **061j で上限が 6 件から 26 件（イベント 6 ＋ キーワード 20）へ増えた**が、
 * メモリの上限を守っているのは `effectMediaCache` の 20MiB ＋ LRU なので、形は変えていない。
 *
 * ⚠⚠ **061k: `output` を渡すと、その出力先の条件が指す id だけを返す。**
 * エフェクト窓は**自分の出力先ぶんだけ**を温めること——省略すると
 * **20MiB の先読み予算をもう一方の窓のぶんで使う**（2 窓それぞれが全 26 件を抱える）。
 * ⚠ 省略時が合計なのは [`effectConditionCount`] と同じ規則（既存の呼び出しを壊さないため）。
 */
export function assignedTemplateIds(
  conditions: EffectConditions,
  output?: EffectOutput,
): string[] {
  const ids = new Set<string>();
  for (const c of conditions) {
    if (c.effect.kind !== "template") continue;
    if (output !== undefined && c.output !== output) continue;
    ids.add(c.effect.templateId);
  }
  return [...ids];
}

/**
 * 061d-2 / 061j / **061k**: **`decideEffects` に渡す matcher を、出力先ごとに作る factory**。
 *
 * ## ⚠⚠ 061k: なぜ「窓側で捨てる」ではなく matcher で絞るのか（判断 5・最重要）
 *
 * 2 つの出力窓は**それぞれ独立に全コメントを受けて `decideEffects` を回す**（`EffectOverlayApp` が
 * 窓ごとに `connectCommentStream` を 1 本張り、`EffectTriggerState` も窓ごとに持つ）。
 * 素直に思いつく「`EffectRequest` に `output` を載せ、窓側で自分宛てでなければ捨てる」は **誤りである**:
 *
 * ⚠⚠ **`decideEffects` は発火時に `recentFires.push` / `lastConditionAt.set` / `lastGiftAt.set` を書く。**
 * 捨てるのは**その後**なので、**コーナー窓のバースト枠がステージ用エフェクトに食われる**
 * ——「別の窓へ出す条件が 3 件続いただけで、直後の投げ銭が捨てられる」が起きる。
 * ⚠ これは **061j 追加穴 η が守った不変条件「出さないと決まったものは state に一切触らない」の裏返し**で、
 * さらに遡れば 061d-2 の穴 γ と同型である。⚠⚠ **同じ罠を 3 回目で踏まないこと。**
 * ⇒ **自分の `output` 以外の条件は、当たり判定の前にスキップする**（下のループの 1 行）。
 * ⚠ **「出ない」だけを見るテストではこの区別がつかない**（どちらの実装でも出ない）。
 * 検証は **`recentFires` / `lastConditionAt` / `lastGiftAt` のサイズを直接数える**こと。
 *
 * ⚠ **`EffectMatch` も `EffectRequest` も無改変**（後者は 8 キーのまま）＝ §9 の担保はそのまま。
 * ⚠ 条件の `output` は 1 つなので、**2 窓で二重に発火することはない**。
 * ⚠ 帰結: **バースト枠もクールダウンも窓ごとに独立**（061k の制約 6）。
 *
 * ## ⚠⚠ factory にしたが「読み直しの規律」は変えていない
 *
 * 061j はこの形（`createEffectMatcher()`）を JSDoc に**寄せ先として**残していたが、理由は
 * 「localStorage の読み回数を減らす最適化」で、**061j 自身が「いま 1 バイトも節約しないので作らない」と
 * 却下している**。⚠ **061k が factory にしたのは出力先を束縛するためだけ**で、
 * **返す関数は呼ばれるたびに [`readConditions`] する**（＝ main 窓で条件を変えた直後の 1 件目から効く）。
 * ⚠⚠ **「ついでに最適化」をしないこと**——測っていない最適化を、別の理由の変更に紛れ込ませない。
 * ⚠ 再修正トリガーは 061j のまま＝**実機で高頻度のコメントによりカクついたとき**、
 * かつ **sidecar がコメントをまとめて送るようになったとき**（いまは 1 件ずつなので効果ゼロ）。
 *
 * ---
 *
 * ⚠⚠ **発火のたびに localStorage を読み直す**（state にミラーしない・`storage` にも依存しない）。
 * この設定の持ち主は main 窓なので、エフェクト窓の state に写すと
 * 「main 窓で変えたのに古い値で判断する」形が作れてしまう（061b が `loadEffectMonetaryEnabled` を
 * 発火のたびに読んでいたのと同じ規律。⚠ あの関数は 061h で削除したので、
 * **この規律を体現しているのは本関数だけ**になった）。
 * ⚠ 読むのは localStorage 1 本で **同期**——`storage` の窓跨ぎ伝播（ベストエフォート）に
 * 依存しないので、**設定は必ず届く**。
 *
 * ## ⚠⚠ 課金ゲートはここにある（判断 5）
 *
 * 061h までは `decideEffects` の先頭に `if (!isMonetaryEvent(c.eventType)) continue;` があった。
 * **キーワード条件は通常チャットで発火するのが目的**なので、そのままだと**キーワードが永久に当たらない**。
 * ⇒ ゲートを**イベント条件の判定の中**へ移した。⚠ **罠が 3 つある**:
 *   1. ⚠⚠ **`isMonetaryEvent(input.eventType)` であって `displayEventType` を通さない。**
 *      `displayEventType` は superchat＋`currency:"BITS"` を `"bits"` へ振り替えるが、`"bits"` は
 *      `MONETARY_EVENT_TYPES` に**無い**（あの Set は「ビッツは superchat に含まれる」前提）。
 *      通すと**ビッツでエフェクトが出なくなる**（061b が踏み、059b も踏んだ罠）。
 *      ⇒ そもそも本関数は `CommentViewDto` を受け取らないので `displayEventType` を**呼べない**
 *      （型で罠を塞いである）。
 *   2. **穴 γ の順序を崩さない**（`decideEffects` 側の責務。あちらの注記が正）。
 *   3. `effectTrigger.ts` から `isMonetaryEvent` の import が消えるが、**本モジュールは既に
 *      `viewerFormat` を import している**＝ **層の向きは変わらない**。
 *
 * ## ⚠⚠ 走査順と「最初の 1 件だけ」（判断 11）
 *
 * 1 つのコメントが複数条件にヒットしうる（「草」と「w」の両方を含む・スパチャの本文にキーワードが入る）。
 * 全部出すと **1 コメントで N 件**＝バースト枠を一瞬で食い尽くす。
 * ⇒ **走査順で最初に当たった 1 件だけ**（＝戻り値が `EffectMatch | null` である形がそのまま答え）。
 * 走査順は **イベント条件（6 行・固定順）→ キーワード条件（保存順）**。帰結:
 *   - ⚠ **課金コメントにキーワードも当たる場合はイベント条件が勝つ**（投げ銭のほうが重要度が高く、
 *     ユーザーが**明示的に種別へ割り当てた**ものだから）。
 *   - ⚠⚠ **キーワードは種別を問わず当たる**（スパチャ本文の「草」でも当たる）。
 *     ⚠ 却下した案＝「課金コメントはキーワード判定の対象外」——「キーワードを設定したのに、
 *     たまたまスパチャで書かれると出ない」という**説明しづらい穴**を作るため。
 *   - ⚠⚠ **`effect.kind === "none"` の条件はスキップする**（＝「当たった」扱いにしない）。
 *     そうしないと「スーパーチャットを『出さない』にしている」だけでキーワードが塞がれる。
 *     ⚠ これは `effectConditionCount` が `kind === "template"` だけ数えているのと**同じ規則**である。
 *
 * ## ⚠⚠ 性能（判断 6・実測してから最適化する）
 *
 * 061j で本関数は**全コメントで呼ばれる**ようになった（061h までは課金コメントのときだけ）。
 *   - **本文の正規化はコメント 1 件につき 1 回**（下の `text`）。⚠ 条件ごとに正規化すると
 *     290 字級の長文 × 20 件＝ **5,800 字**になる。ここが判断 6 の警告の本体である。
 *   - **キーワード側の正規化は [`parseConditions`] が 1 件 1 回**行い、**空判定と照合が同じ結果を共有**する。
 *     ⚠ 残差は `KEYWORD_MAX_LENGTH × KEYWORD_CONDITION_MAX` ＝ **640 字/コメント**が上限で、
 *     判断 9 の「32 文字・20 件」がそのまま走査コストの上限になっている。
 *   - ⚠⚠ **「発火のたびに読み直す」規律は変えない**（キャッシュすると「main 窓で変えたのに
 *     古い値で判断する」形が復活する）。⚠ **窓を跨ぐキャッシュにはしない。**
 * ⚠ **再修正トリガー＝実機で高頻度のコメントによりカクついたとき。** そのときは
 * **`decideEffects` の 1 呼び出しにつき 1 回だけ読む**形（＝ factory が**作られた時点で 1 回だけ**読み、
 * 返す関数はその写しを見る）へ寄せること。⚠ **061k の factory 化はこれではない**（上記）。
 * ⚠ **いま寄せない理由**＝ sidecar は `comments.append` を **1 件ずつ**送るので `added` は常に長さ 1 で、
 * 「1 バッチ 1 回」と「1 コメント 1 回」が**現状まったく同じ**だから（＝測っていない最適化になる）。
 * ⇒ **寄せるのは sidecar がまとめて送るようになったとき**でもある。
 *
 * ## §9
 *
 * ⚠⚠ **戻り値に本文を載せない。** `EffectRequest` は **8 キーのまま無改変**
 * ＝ **第三者の本文が発火層より先へ 1 バイトも進まない**ことが型で担保される。
 * ⚠ `conditionId` は**ユーザー自身が作った条件の識別子**で第三者データではない（§9 の対象外）。
 * ⚠ **それでも `EffectRequest` には載せない**——クールダウンの判定は `decideEffects` の中で完結するので
 * 載せる理由が無く、載せると「出すのに要る最小限」という 061b の規律が緩む。
 */
export function createEffectMatcher(output: EffectOutput): EffectMatcher {
  return (input: EffectMatchInput): EffectMatch | null => {
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
      // ⚠⚠ **061k（判断 5）: 自分の窓宛てでない条件は、当たり判定の前に落とす。**
      //   ⚠ ここを `decideEffects` の後ろ（＝`EffectRequest` を捨てる形）へ動かすと、
      //   **もう一方の窓の条件がこの窓のバースト枠とクールダウンを消費する**（上記 JSDoc）。
      //   ⚠ 「出ない」だけを見るテストでは**この変異は殺せない**（state のサイズを数えること）。
      if (condition.output !== output) continue;
      // ⚠⚠ 判断 11: 「出さない」条件は**当たった扱いにしない**（キーワードを塞がない）。
      if (condition.effect.kind === "none") continue;
      if (condition.when.type === "event") {
        // ⚠⚠ 課金ゲート（判断 5）。⚠ ここを `decideEffects` の先頭へ戻すとキーワードが永久に当たらない。
        if (!monetary) continue;
        if (condition.when.eventType !== input.eventType) continue;
        // ⚠ イベント条件にクールダウンは効かせない（スパチャ 2 連投の 2 件目を落とさない）。
        return { effect: condition.effect, conditionId: condition.id, cooldownMs: 0 };
      }
      // ⚠ keyword なら `normalized` は必ず非 null（`parseConditions` の不変条件）。型の都合で 1 行置く。
      if (normalized === null) continue;
      const hit =
        condition.when.match === "exact"
          ? text === normalized
          : text.includes(normalized);
      if (!hit) continue;
      return {
        effect: condition.effect,
        conditionId: condition.id,
        cooldownMs: KEYWORD_COOLDOWN_MS,
      };
    }
    return null;
  };
}
