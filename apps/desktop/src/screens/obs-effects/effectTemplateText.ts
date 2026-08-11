import type { EffectText } from "../../features/obs-effects/bindings/EffectText";

/**
 * 061d: テンプレートの差し込み文面（`manifest.text`）を**文字列として**組み立てる純関数。
 *
 * ⚠⚠ **DOM を作らない。** ここが返すのは文字列だけで、テキストノードにするのは
 * `EffectTemplateView`（React のテキスト描画）の役目である——`dangerouslySetInnerHTML` /
 * `innerHTML` を使わない不変条件を、**この層に DOM を持ち込まないこと**で構造的に守る
 * （`viewerFormat.ts` / `overlayFit.ts` と同じ「React/CSS/DOM 非依存の純ロジック」の切り分け）。
 *
 * ⚠ `EffectTemplateView.tsx` から分けてあるのは react-refresh の制約
 * （コンポーネント以外を export しない）に加えて、**時計も DOM も要らないテストで固定できる**ため。
 *
 * ⚠ **テストは `EffectTemplateView.test.tsx` に同居させてある**（`effectTemplateText.test.ts` は作っていない）。
 * 061d-1 時点では純関数 8 ケース＋描画 9 ケースでまだ 1 ファイルとして読めるうえ、
 * 「文面 → その文面がどう描かれるか」を続けて読めるほうが仕様として分かりやすいため。
 * **再修正トリガー＝061d-2 で `{event}` 系のケースが増えて純関数側が 15 ケースを超えたら
 * `effectTemplateText.test.ts` へ分ける。** ⚠ そのときは**分割と同じコミットで**行うこと
 * （後から分けると `git log --follow` が切れて経緯を辿れなくなる）。
 */

/**
 * 差し込み変数の値。⚠ **`EffectRequest`（061b）が構造的にこれを満たす**ので、エフェクト窓は
 * `EffectRequest` をそのまま渡せる（この module は `effectTrigger.ts` に依存しない＝
 * main 窓のプレビューからも同じものを使える）。
 *
 * ⚠ **本文（`text`）とアバターは無い**（§9）。061b が `EffectRequest` に持たせていないので、
 * ここへ渡せるものが構造的に存在しない。
 */
// ⚠⚠ `EffectRequest`（061b）がこの型を構造的に満たすことは **`effectTemplateText.test.ts` が
// 型レベルで固定**している（061d-2 でエフェクト窓が `EffectRequest` をそのまま渡せる前提）。
// フィールド名を変えるとあちらが**コンパイルエラー**になる。
export interface EffectTemplateVars {
  /** 投稿者の表示名。⚠ **第三者の自由入力**。必ずテキストノードとして描くこと。 */
  name: string;
  /** 金額の verbatim 表示。無ければ null（＝`templateWithoutAmount` を使う合図）。 */
  amountText: string | null;
  /** 金額を持たない種別の日本語文（`composeEventMessage`）。無ければ null。 */
  message: string | null;
  /** 種別ラベル（「スーパーチャット」等）。未知種別は空文字。 */
  eventLabel: string;
}

/**
 * 差し込める変数（**この 4 つだけ**）。⚠ Rust の `manifest::ALLOWED_TEMPLATE_VARS` と**対になっている**。
 * 片方だけ増やすと「取り込めるのに置換されない」（あるいはその逆）になるので、必ず両方を見ること。
 * ⚠ **変数を増やすときは §9 の観点で再評価すること**（docs/security.md §8 の 061c 節）。
 *
 * ⚠ **既知の 4 つの完全一致だけを拾う**。Rust 側が未知の `{…}` を含む manifest を取り込み時に
 * 拒否しているので通常ここには来ないが、来ても**素通し**（そのまま文字として残る）になる
 * ——`{` を見て手前から解釈するような処理をここに書かない（書くと Rust と 2 実装になる）。
 */
const TEMPLATE_VAR_PATTERN = /\{(name|amount|event|message)\}/g;

/**
 * `{name}` / `{amount}` / `{event}` / `{message}` を差し替える。
 *
 * ⚠⚠ **置換は「関数の replacer」で行う**（置換先を文字列で渡さない）。文字列を渡すと
 * `$&` / `$1` / `$'` が**置換パターンとして解釈される**ので、投稿者名に `$&` を含む視聴者が
 * 意図しない文字列を配信画面へ出せてしまう。関数の戻り値はそのまま挿入されるので、この経路が構造的に無い。
 */
export function applyTemplateText(
  template: string,
  vars: EffectTemplateVars,
): string {
  return template.replace(TEMPLATE_VAR_PATTERN, (_match, key: string) => {
    if (key === "name") return vars.name;
    if (key === "amount") return vars.amountText ?? "";
    if (key === "event") return vars.eventLabel;
    return vars.message ?? "";
  });
}

/**
 * 実際に描く 1 行を作る。**描かないときは `null`**。
 *
 * - `amountText` が**あれば** `template`、**無ければ** `templateWithoutAmount`（既定 `"{message}"`）。
 * - ⚠⚠ **置換の結果が空（空白のみを含む）になったら描かない**（061c からの申し送り 3）。
 *   `amountText` と `message` は**同時に null になりうる**（例: donation で金額情報が欠けた場合）ので、
 *   既定の `"{message}"` がそのまま空文字へ落ちる。空の要素を置くと、意匠によっては
 *   影や余白だけが配信画面に出る。
 */
export function effectTemplateLine(
  text: EffectText,
  vars: EffectTemplateVars,
): string | null {
  const template =
    vars.amountText !== null ? text.template : text.templateWithoutAmount;
  const line = applyTemplateText(
    typeof template === "string" ? template : "",
    vars,
  );
  return line.trim() === "" ? null : line;
}
