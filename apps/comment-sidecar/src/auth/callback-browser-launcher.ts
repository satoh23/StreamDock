// 032c-d コミット1: YouTube 認可 URL を「ブラウザで開く」役割を、sidecar 内でブラウザ shell-out せず
// Rust へ委譲するための BrowserLauncher 実装。`open` パッケージは同梱しない（§4・§10）。
//
// AuthorizationCodeLoopbackLoginStrategy は同意フロー開始時に browserLauncher.open(url) を呼ぶ。ここでは
// URL を stdout の専用行（COMMENT_SIDECAR_OPEN_URL=）へ委譲するコールバックを呼ぶだけにし、実際に開くのは
// Rust（tauri-plugin-opener・host=accounts.google.com を検証）に任せる。URL 全体はログに出さない（§9）。
// URL に載るのは code_challenge（S256・非機密）で、code_verifier は載らない（sidecar のメモリのみ）。
import type { BrowserLauncher } from "../../vendor/auth/src/usecases/interfaces/browser-launcher.interface.js";

export class CallbackBrowserLauncher implements BrowserLauncher {
  constructor(private readonly onOpenAuthUrl: (url: string) => void) {}

  async open(url: URL): Promise<void> {
    // 実際のブラウザ起動は Rust opener（host 検証）に委譲する。
    this.onOpenAuthUrl(url.toString());
  }
}
