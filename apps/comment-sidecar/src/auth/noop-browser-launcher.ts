// 032c-b(stream-dock): Device Code の verification_uri は「ブラウザ shell-out」ではなく
// viewer にテキスト提示する方針（親設計の open 廃止）。よってブラウザ起動は行わない no-op 実装。
// `open` パッケージを sidecar に同梱しないための差し替え。
import type { BrowserLauncher } from "../../vendor/auth/src/usecases/interfaces/browser-launcher.interface.js";

export class NoopBrowserLauncher implements BrowserLauncher {
  async open(_url: URL): Promise<void> {
    // 何もしない。案内表示（user_code / verification_uri）は viewer 側で行う。
  }
}
