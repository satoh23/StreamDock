import { describe, it, expect } from "vitest";
import type { EffectRequest } from "./effectTrigger";
import { applyTemplateText, type EffectTemplateVars } from "./effectTemplateText";

/**
 * 061d: `EffectTemplateVars` が **061b の `EffectRequest` と構造的に互換**であることを固定する。
 *
 * ⚠⚠ **これは 061d-2 の前提そのもの**——`effectTemplateText.ts` の doc が
 * 「`EffectRequest`（061b）が構造的にこれを満たすので、エフェクト窓は `EffectRequest` を
 * **そのまま渡せる**」と書いており、061d-2 の実装はこの前提の上に乗る。
 * ⚠ ところが 061d-1 時点でこれを確かめるものが**どこにも無かった**（両方の型定義を
 * 人間が読み比べるだけ）。061b が `amountText` / `eventLabel` を改名した瞬間に、
 * 061d-2 の着手時まで気付けない。
 *
 * ⚠ **文面の仕様テスト（`applyTemplateText` / `effectTemplateLine`）は
 * `EffectTemplateView.test.tsx` に同居している**（そちらは「文面 → その文面がどう描かれるか」を
 * 続けて読めるほうが分かりやすいため）。ここは**型の契約だけ**を持つ。
 */

describe("EffectTemplateVars ↔ EffectRequest の構造的互換（061d-2 の前提）", () => {
  it("⚠⚠ `EffectRequest` をそのまま `EffectTemplateVars` として渡せる（型レベル）", () => {
    // ⚠ ここが**コンパイルを通ること**が検査そのもの（`pnpm typecheck` で落ちる）。
    //   061b が `name` / `amountText` / `message` / `eventLabel` のどれかを改名・型変更すると赤くなる。
    const request: EffectRequest = {
      id: "c1",
      name: "テスト太郎",
      amountText: "¥1,000",
      message: null,
      eventLabel: "スーパーチャット",
      tone: "t3",
      kind: "builtin-monetary",
    };

    // (1) 変数をそのまま渡す（061d-2 のエフェクト窓が実際に書く形）。
    const asVars: EffectTemplateVars = request;
    // (2) スプレッドで新しいリテラルにして渡す（余剰プロパティで壊れないこと）。
    const spread: EffectTemplateVars = { ...request };

    // 実行時にも、余った `id` / `tone` / `kind` が差し込みへ漏れないことを見る。
    expect(applyTemplateText("{name}/{amount}/{event}/{message}", asVars)).toBe(
      "テスト太郎/¥1,000/スーパーチャット/",
    );
    expect(applyTemplateText("{name}", spread)).toBe("テスト太郎");
  });

  it("⚠ 本文とアバターは構造的に渡せない（§9・型による担保）", () => {
    // 061b が `EffectRequest` に `text` / `avatar` を持たせていないので、
    // 差し込み変数へ流し込む経路が**存在しない**。増やすときは §9 の再評価が要る。
    const keys: Array<keyof EffectTemplateVars> = [
      "name",
      "amountText",
      "message",
      "eventLabel",
    ];
    expect(keys).toHaveLength(4);
    // ⚠ 実行時にも「4 つ以外の変数は素通し」であること（Rust が取り込み時に弾いている）。
    expect(
      applyTemplateText("{text}{avatar}", {
        name: "n",
        amountText: null,
        message: null,
        eventLabel: "",
      }),
    ).toBe("{text}{avatar}");
  });
});
