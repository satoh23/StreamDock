import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 038b: フロントエンドの単体/コンポーネントテスト設定（vitest + Testing Library + jsdom）。
// 実行は `pnpm --filter ./apps/desktop test`。DOM/React を回すためのテスト専用設定で、アプリ本体の
// ビルド設定（vite.config.ts）とは分離する。テストは外部通信・OS 操作を一切行わない（invoke は全てモック）。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    /**
     * 063b: **1 件あたりのタイムアウト**（⚠ vitest の既定は 5000ms で、それでは足りなかった）。
     *
     * ⚠⚠⚠ **これはフレークの修正である。** 既定 5000ms のままだと、外部負荷が掛かった状態で
     * **フルスイートが不定期に 1〜2 件落ちていた**（`Error: Test timed out in 5000ms.`）。
     * ⚠ **落ちるのは常にスイート最遅の 2 件**——`GachaPrizeTable.test.tsx` の
     * 「景品は上限まで」と `OverlayThemeCard.test.tsx` の「テーマ件数が上限なら」で、
     * どちらも `userEvent` で**上限まで要素を足し続ける**ため jsdom 上で本質的に重い。
     *
     * 実測（2026-08-23）:
     * | 実行条件 | 景品は上限まで | テーマ件数が上限なら |
     * |---|---|---|
     * | 単独・無負荷 | 712ms | 549ms |
     * | フルスイート内・無負荷（11 コアで並列競合） | 2266ms | 2457ms |
     * | フルスイート内・外部負荷あり（`lint` 直後 等） | **5068〜5655ms** | **5430〜6577ms** |
     *
     * ⚠⚠ **063b が持ち込んだものではない**——`git worktree` で **063b 以前の HEAD** を作って
     * 実行したところ、**同じ 2 件が同じ理由で落ちた**（＝元から在ったフレーク）。
     *
     * 値の根拠＝ **負荷下の実測最大 6577ms の 2 倍強**。⚠ 大きくしすぎると
     * **本物のハングが「遅いテスト」に見えて気づけなくなる**ので、青天井にはしない。
     *
     * ⚠ **却下した案＝該当 2 件にだけ第 3 引数でタイムアウトを渡す。** ①同じ規則が 2 か所に散る
     * ②**次に重いテストが増えたらまた同じことが起きる**——原因は個別のテストではなく**既定値の側**にある。
     * **再修正トリガー**＝実測が 15 秒に近づいたら、値を上げる前に**その重いテストを分割すること**。
     */
    testTimeout: 15_000,
  },
});
