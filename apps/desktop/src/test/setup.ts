import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// globals:false のため RTL の自動 cleanup が効かない。各テスト後に明示的に DOM を掃除する。
afterEach(() => {
  cleanup();
});

// jsdom は <dialog> の showModal/show/close を実装していないため、テスト用に最小ポリフィルを入れる
// （open 属性の反映と close イベント発火のみ）。実ブラウザ/WebView での showModal・focus trap・backdrop・
// Esc の実挙動は jsdom では再現しきれないため E2E（手動）で確認する。ここでは「open が反映されるか」を検証できる。
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.show) {
    HTMLDialogElement.prototype.show = function show() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
}
