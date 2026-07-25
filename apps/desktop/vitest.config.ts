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
  },
});
