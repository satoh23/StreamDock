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
    files: ["src/screens/obs-effects/**/*.{ts,tsx}"],
    rules: { "no-console": "error" },
  },
);
