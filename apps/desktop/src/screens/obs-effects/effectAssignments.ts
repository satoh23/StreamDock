import { EFFECT_ASSIGNMENTS_KEY } from "../../features/comment-viewer/overlaySettings";
import { MONETARY_EVENT_TYPES } from "../comment-viewer/viewerFormat";
import type { EffectKind } from "./effectTrigger";

/**
 * 061d-2: **イベント種別 → どのエフェクトで出すか**の割り当て（localStorage の読み書きと解決）。
 *
 * ⚠⚠ **ここは「割り当て」だけを持つ層で、発火の判定も描画も持たない。**
 * `decideEffects`（061b）へは [`resolveEffectKind`] を **resolver として渡す**だけで、
 * `effectTrigger.ts` は本モジュールを import しない（＝発火層は純関数のまま・①）。
 *
 * ⚠ 置き場所が `features/` ではなく `screens/obs-effects/` なのは `effectTrigger.ts` と同じ理由
 * （唯一の消費者＝この画面とエフェクト窓に同居させ、`features/` → `screens/` の層の逆転を作らない）。
 *
 * ## 壊れ方の方針（⑪）
 *
 * ⚠⚠ **`{"kind":"none"}` 以外はすべて「組み込み」へ倒れる。** 全「なし」へ倒すと
 * **061d のリリースで既存ユーザーの組み込みエフェクトが黙って止まる**（アップデートしたら
 * 配信画面から投げ銭エフェクトが消える、という最悪の壊れ方になる）。
 * ＝ **「出さない」に倒れてよいのは、ユーザーが自分で「エフェクトを出さない」を選んだときだけ。**
 * ⚠ これは `effectMedia.ts` の「メディアが弾かれたら組み込みへ」と**同じ向き**で、
 * 「壊れたときに何が出るか」の答えを 2 種類作らないためでもある。
 *
 * ## §9
 *
 * ⚠ 保存するのは **イベント種別（`MONETARY_EVENT_TYPES` の 6 値）とテンプレート id（uuid v4）だけ**。
 * 第三者の個人データ（本文・表示名・金額）は 1 バイトも入らない＝ 既存の非機密トグル値と同種。
 * ⚠ **テンプレート名も `console.*` にも例外の詳細にも出さない**（§9。`eslint.config.js` の
 * `no-console` が `src/screens/obs-effects/**` に効いている）。
 */

/**
 * 割り当て 1 行の値。
 *
 * ⚠⚠ **`EffectKind`（061b/061d-2）に `"none"` を足した形にしてある**——「出さない」は
 * **発火するかどうか**の判断であって「どう描くか」ではないので、`EffectKind` 側へ入れると
 * `EffectRequest` に「描けない kind」が生まれてしまう（描画分岐が必ず不能ケースを持つ）。
 * ここで受け取り、[`resolveEffectKind`] が `null` へ翻訳して発火層へ渡す。
 *
 * ⚠ **063（ガチャ）は `{ kind: "gacha"; … }` を足す**。そのとき下の [`parseAssignment`] に
 * 1 分岐足せば、**旧ビルドは「未知の kind → 組み込み」へ安全側に倒れる**（＝前方互換）。
 * この前方互換があるので、保存形に `version` フィールドは持たせていない
 * （版番号にすると「版が違う＝全部捨てる」というより粗い壊れ方を新しく作ることになる）。
 */
export type EffectAssignment = { kind: "none" } | EffectKind;

/**
 * 未保存・不正・例外のときに使う既定。⚠⚠ **「組み込み」であって「なし」ではない**（⑪）。
 */
export const DEFAULT_EFFECT_ASSIGNMENT: EffectAssignment = {
  kind: "builtin-monetary",
};

/** イベント種別 → 割り当て。⚠ キーは必ず `MONETARY_EVENT_TYPES` の 6 値（未知キーは載せない）。 */
export type EffectAssignments = Record<string, EffectAssignment>;

/**
 * テンプレート id として受け入れる形（**uuid の「形」＝ 36 文字・hex とハイフンの完全一致**）。
 *
 * ⚠ **061d-2 レビュー S-3: 「uuid v4 完全一致」ではない**——version / variant のニブルは見ていない。
 * それは Rust の `is_template_id`（`effect_template/service.rs`）も同じで、**2 層の強さが揃っている**
 * ことのほうが重要（片方だけ厳しくすると、Rust が受け入れる id を TS が黙って組み込みへ倒す）。
 * ここの目的はパス安全（`../` / 絶対パス / 区切り文字を通さない）で、形の一致で十分である。
 *
 * ⚠ **`overlaySettings.ts` の `OVERLAY_THEME_ID_RE` と同型・同じ理由**（060d の先例）——
 * id を採番するのは Rust の `effect_template::service` の `Uuid::new_v4()` だけなので、
 * 細工された localStorage 値がそもそもコマンドまで届かない（届いても Rust が弾くだけなので
 * 多層防御の 1 枚目という位置づけ）。
 * ⚠ **再修正トリガー＝ Rust の id 採番方式を変えるとき**（変えると割り当てが黙って組み込みへ落ちる）。
 */
const EFFECT_TEMPLATE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 割り当て 1 行を検証する。**受け入れられない値はすべて `DEFAULT_EFFECT_ASSIGNMENT`（＝組み込み）**。
 *
 * ⚠ ここで見ているのは**形だけ**で、「その id のテンプレートが実在するか」は見ない
 * （実在の判定に要る一覧は IPC の向こう側で、この純関数からは引けない）。
 * 実在しない id は**描く側**（エフェクト窓＝一覧に無ければ組み込みへ／main 窓＝警告を出す）が扱う。
 */
const parseAssignment = (raw: unknown): EffectAssignment => {
  if (typeof raw !== "object" || raw === null) return DEFAULT_EFFECT_ASSIGNMENT;
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === "none") return { kind: "none" };
  if (kind === "template") {
    const templateId = (raw as { templateId?: unknown }).templateId;
    // ⚠ 形が違えば「組み込み」へ（「なし」へ倒さない＝⑪）。
    if (typeof templateId !== "string" || !EFFECT_TEMPLATE_ID_RE.test(templateId)) {
      return DEFAULT_EFFECT_ASSIGNMENT;
    }
    return { kind: "template", templateId };
  }
  // "builtin-monetary" と、未知の kind（063 の "gacha" を古いビルドが読んだ場合を含む）。
  return DEFAULT_EFFECT_ASSIGNMENT;
};

/** 全種別を既定（組み込み）で埋めた表。⚠ **行は最初から全部ある**（「条件を追加」を作らない・(2)）。 */
const defaultAssignments = (): EffectAssignments => {
  const out: EffectAssignments = {};
  for (const eventType of MONETARY_EVENT_TYPES) {
    out[eventType] = DEFAULT_EFFECT_ASSIGNMENT;
  }
  return out;
};

/**
 * 保存済みの割り当てを読む。**未保存・不正 JSON・例外・ルートが非オブジェクトはすべて全種別「組み込み」**。
 *
 * ⚠ **戻り値は必ず `MONETARY_EVENT_TYPES` の 6 キーちょうど**（未知のイベント種別キーは無視し、
 * 欠けているキーは既定で埋める）。呼び出し側が「キーがあるか」を毎回気にしなくてよくなる。
 * ⚠ `MONETARY_EVENT_TYPES` に 7 種別目が増えたら、この関数の戻り値も UI の行も自動で増える
 * （`EffectAssignmentCard.test.tsx` が両者の一致を固定している）。
 */
export function loadEffectAssignments(): EffectAssignments {
  const out = defaultAssignments();
  try {
    const raw = localStorage.getItem(EFFECT_ASSIGNMENTS_KEY);
    if (raw === null) return out;
    const parsed: unknown = JSON.parse(raw);
    // ⚠ 配列も `typeof === "object"` なので明示的に弾く（配列を渡されて添字が拾われるのを防ぐ）。
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return out;
    }
    for (const eventType of MONETARY_EVENT_TYPES) {
      // ⚠ `Object.hasOwn` は使わない（tsconfig の lib が es2022 未満・`EffectTemplateView` と同じ制約）。
      //   既知キーだけを引くので、`__proto__` 等の未知キーは構造的に読まれない。
      const value = (parsed as Record<string, unknown>)[eventType];
      if (value === undefined) continue;
      out[eventType] = parseAssignment(value);
    }
    return out;
  } catch {
    // JSON.parse の失敗も localStorage の例外（プライベートモード等）も同じ扱い＝全部「組み込み」。
    return defaultAssignments();
  }
}

/**
 * 割り当てを保存する（ローカルのみ・外部送信しない）。
 *
 * ⚠ **書くのは既知のイベント種別だけ**（渡された表に未知キーがあっても落とす＝
 * localStorage に知らないキーを増やさない）。
 * ⚠ **全部が既定（組み込み）ならキーごと削除する**——「未保存＝既定」と「既定を明示的に選んだ」を
 * 同じ状態に潰す（`saveOverlayTheme(null)` と同じ判断で、分岐を増やさないため）。
 *
 * ⚠ **061d-2 レビュー S-4（受容・修正不要）: 書き込み時に `templateId` の形は検査しない。**
 * 値の出所が「Rust の `list_effect_templates` が返した id」だけで、かつ
 * **読み込み時に必ず [`parseAssignment`] が弾く**ので、不正な値が IPC まで届く経路が無いため
 * （検証を 2 か所に分けると「片方だけ緩む」を作る側になる）。
 * **再修正トリガー＝ id を外部から受け取る書き込み経路が増えたとき**（例: 設定のインポート）。
 */
export function saveEffectAssignments(assignments: EffectAssignments): void {
  try {
    const body: Record<string, EffectAssignment> = {};
    let hasNonDefault = false;
    for (const eventType of MONETARY_EVENT_TYPES) {
      const value = assignments[eventType] ?? DEFAULT_EFFECT_ASSIGNMENT;
      body[eventType] = value;
      if (value.kind !== DEFAULT_EFFECT_ASSIGNMENT.kind) hasNonDefault = true;
    }
    if (!hasNonDefault) {
      localStorage.removeItem(EFFECT_ASSIGNMENTS_KEY);
      return;
    }
    localStorage.setItem(EFFECT_ASSIGNMENTS_KEY, JSON.stringify(body));
  } catch {
    // 書けない環境では**割り当てが保存されないだけ**（表示は既定＝組み込みで続く）。
  }
}

/**
 * ⚠⚠ **復帰導線＝すべての割り当てを解除（組み込みに戻す）。**
 *
 * 060d の「既定のデザインに戻す」と同じ位置づけで、**壊れたテンプレート（巨大・真っ黒・画面全体を
 * 覆う）を割り当てて配信画面が読めなくなったときの唯一の脱出路**である。
 * ⚠ **テンプレート自体は削除しない**（消したいなら一覧から明示的に消す）。
 * ⚠ **これはテストで固定する**（no-op にする変異でレッドになること）。
 */
export function clearAllEffectAssignments(): EffectAssignments {
  saveEffectAssignments(defaultAssignments());
  return defaultAssignments();
}

/**
 * 指定テンプレートを指している割り当てを**組み込みへ戻す**（テンプレート削除時に呼ぶ）。
 *
 * ⚠ 「なし」ではなく「組み込み」へ戻す（⑪）。削除の副作用でエフェクトが**黙って止まる**のを避ける。
 * ⚠ **削除操作のときだけ保存値を書き換える。** 「一覧に無い id」を見つけただけでは書き換えない
 * ——`list_effect_templates` が一時的に失敗した場合や、061c の「読めない行は黙って落とす」に
 * 当たっただけの場合に、**ユーザーの設定が黙って消える**ため（そちらは UI の警告で扱う）。
 */
export function clearEffectAssignmentsForTemplate(
  templateId: string,
): EffectAssignments {
  const current = loadEffectAssignments();
  const next: EffectAssignments = {};
  for (const eventType of MONETARY_EVENT_TYPES) {
    const value = current[eventType] ?? DEFAULT_EFFECT_ASSIGNMENT;
    next[eventType] =
      value.kind === "template" && value.templateId === templateId
        ? DEFAULT_EFFECT_ASSIGNMENT
        : value;
  }
  saveEffectAssignments(next);
  return next;
}

/** 割り当てに出てくるテンプレート id（重複なし）。⚠ **先読みの対象はこれだけ**（一覧全部ではない）。 */
export function assignedTemplateIds(
  assignments: EffectAssignments,
): string[] {
  const ids = new Set<string>();
  for (const eventType of MONETARY_EVENT_TYPES) {
    const value = assignments[eventType];
    if (value !== undefined && value.kind === "template") ids.add(value.templateId);
  }
  return [...ids];
}

/**
 * 061d-2: **`decideEffects` に渡す resolver の実体**（`EffectKindResolver`）。
 *
 * ⚠⚠ **発火のたびに localStorage を読み直す**（state にミラーしない・`storage` にも依存しない）。
 * この設定の持ち主は main 窓なので、エフェクト窓の state に写すと
 * 「main 窓で変えたのに古い値で判断する」形が作れてしまう
 * （`loadEffectMonetaryEnabled` を発火のたびに読む 061b の規律と同じ）。
 * ⚠ 読むのは localStorage 1 本で **同期**——`storage` の窓跨ぎ伝播（ベストエフォート）に
 * 依存しないので、**設定は必ず届く**。
 *
 * ⚠ **`null` は「エフェクトを出さない」**。`decideEffects` はこれを見て
 * **バースト枠も gift 畳み込みも消費せずに** skip する（穴 γ）。
 * ⚠ 未知のイベント種別（`decideEffects` は課金種別しか渡さないので通常来ない）は
 * **組み込み**へ倒す（「知らないから出さない」にしない＝⑪と同じ向き）。
 */
export function resolveEffectKind(eventType: string): EffectKind | null {
  const assignment =
    loadEffectAssignments()[eventType] ?? DEFAULT_EFFECT_ASSIGNMENT;
  return assignment.kind === "none" ? null : assignment;
}
