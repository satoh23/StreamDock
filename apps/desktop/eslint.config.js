import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // 061b レビュー②S-2: エフェクト窓の系統だけ `console.*` を禁止する（§9・第三者の本文/表示名/金額/id を
    // 端末ログへ 1 バイトも残さない）。テストの console spy は「実際に流したコメントの経路」しか見られず、
    // **課金判定で弾いた側でログを出す変異が全テスト緑のまま生存**していた（実測）。
    // ⚠ ここだけに限定するのは、他の画面には既存の意図的な `console` が有り得るため（全体禁止は別スコープ）。
    // ⚠ 再修正トリガー＝エフェクト窓でどうしてもログを出したくなったら、まず「第三者データを含まない」
    //   ことを型か関数の境界で担保してから、この override を緩めること。
    //
    // ⚠⚠ **061d-1 レビュー S-3: `src/features/obs-effects/**` を対象へ足した。**
    // 061d の invoke ラッパ（`effectTemplateApi.ts`）はテンプレート名・フォルダのパス・例外の生文言を
    // 扱う層なのに、当初 `src/screens/**` 限定だったため **lint の外**にあり、
    // 「ここに console を書かないこと」というコメントだけが規約を支えていた。061b レビュー②S-2 は
    // まさに「コメントで守っていたつもりの console が変異で生存した」という指摘だったので、同じ形を残さない。
    //
    // ⚠ **061i レビュー S-6（現状は修正不要・記録のみ）: `src/components/**` はこのスコープの外**である。
    // 061i が新設した `components/Tabs.tsx` は**この画面群から使われる**が、`components/` には
    // 画面を跨ぐ汎用部品（`ToggleSwitch` / `Select` / `ConfirmDialog` …）が同居しており、
    // ここへ足すと**エフェクトと無関係な部品まで巻き込む**。⚠ そもそも `Tabs` は
    // **第三者データを 1 バイトも受け取らない**（受けるのは `{id,label}` と `activeId` だけ）ので、
    // §9 の観点で守るべきものが無い。
    // ⚠ **再修正トリガー＝`components/` に「第三者データを受け取る部品」を出すとき**
    //   （＝エフェクト本体や視聴者情報を描く部品を共通化したとき）。そのときは
    //   このスコープを広げるか、その部品だけを名指しで足すこと。
    files: [
      "src/screens/obs-effects/**/*.{ts,tsx}",
      "src/features/obs-effects/**/*.{ts,tsx}",
    ],
    rules: { "no-console": "error" },
  },
);
