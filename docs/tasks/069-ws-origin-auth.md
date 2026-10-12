# 069 コメントビューア sidecar の loopback WS に Origin 検証を入れる

> 対象: [security-threats.md T-1](security-threats.md#t-1-loopback-ws-が未認証originが未検証sidecar-制御フレーム) の修正。
> 再現テストは [`apps/comment-sidecar/scripts/test-ws-unauth-origin.mjs`](../../apps/comment-sidecar/scripts/test-ws-unauth-origin.mjs)。

## 目的

`apps/comment-sidecar/vendor/gateway/src/adapters/ws/websocket-comment.output-port.ts` の `bind()` が立てる loopback WS（`ws://127.0.0.1:<port>`）は、接続時に Origin を一切検証していない。悪意あるWebページ（A1）が `ws://127.0.0.1:<port>` へ接続すると、チケット不要の制御フレーム（`obs-list-sources` / `obs-fire-source` / `obs-enable` / `obs-hide` / `obs-disable` / `start-login`）が無条件に `controlHandler` へ届く。

Origin allow-list（StreamDockのwebview由来のみ許可）を接続受理の前段に入れ、A1経路を塞ぐ。

## 現状の確認（実コード）

- `bind()`（91-92行目）: `new WebSocketServer({ host, port })` — Origin検証なし
- チケット検証があるのは `start-session` / `stop-session` / `chat-send` / `theme-import.fetch` のみ（`apps/comment-sidecar/src/index.ts` の `parseControlFrame`）。`obs-*` 系と `start-login` にはチケットが無い
- 正規クライアントはStreamDockのwebview（comment-viewer / comment-overlay / pinned-overlay / stage-overlay / effect-overlay の各窓、すべて `commentStream.ts` 経由で同じsidecarに接続）のみ。Rust側からこのWSへ接続することはない（Rustはポート番号を読み取り専用コマンドで渡すだけ）
- Originの想定値:
  - 本番（macOS/Linux）: `tauri://localhost`（Tauri 2の既定プロトコル）
  - 本番（Windows / WebView2）: `http://tauri.localhost`
  - 開発時: `http://localhost:1420`（`tauri.conf.json` の `devUrl`）
  - ⚠ これはTauri 2の一般的な既定であり、**このプロジェクトでの実接続確認はまだしていない**。実装後に `pnpm tauri dev` で実機確認し、ズレがあれば allow-list を修正する

## 修正方針

`WebSocketServer` のコンストラクタに `verifyClient` を渡し、ハンドシェイク時の `Origin` ヘッダを allow-list と照合する。一致しなければ接続を拒否する（`ws` パッケージの標準機能・新規依存ゼロ）。

```ts
const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:1420",
]);

const server = new WebSocketServer({
  host,
  port,
  verifyClient: (info) => ALLOWED_ORIGINS.has(info.origin),
});
```

## 対象ファイル

- `apps/comment-sidecar/vendor/gateway/src/adapters/ws/websocket-comment.output-port.ts`(`bind()` に `verifyClient` を追加)
- `apps/comment-sidecar/scripts/test-ws-unauth-origin.mjs`(偽Origin接続が**拒否される**こと・`bind()` に `verifyClient` が**ある**ことを固定する向きへ反転)
- `docs/security-threats.md`(T-1の状態を更新)
- `docs/progress.md`(実施記録)

## スコープ外（意図的に含めない）

- **A2（同一PC上の悪意あるプロセス）への対策**: Originヘッダは任意のプロセスが自由に送れるため、Origin検証だけではA2は塞げない。T-1が提案する「二層目」のnonce/セッション認証は別タスクとする
- `obs-*` / `start-login` へのチケット導入(transport層のOrigin検証と、アプリ層のチケット認証は別の防御層。今回はtransport層のみ)
- 他の脅威(T-2以降、未記載)

## 検証方法

1. ✅ `pnpm --filter @stream-dock/comment-sidecar test`(`test-ws-unauth-origin.mjs` が「拒否される」向きでPASS)
2. ✅ `pnpm tauri dev` で実際にコメントビューアを開き、`lsof -i :<port>` でsidecarへのTCP接続が`ESTABLISHED`になることを実機確認(壊れていないこと)
3. ✅ `pnpm typecheck` / `pnpm lint` / `pnpm --filter @stream-dock/comment-sidecar typecheck`
4. ✅ security-reviewスキルでレビュー(判定: 軽微な懸念あり。本番Origin未検証の点を除き問題なし)

## 残課題

- A2対策(nonce/セッション認証)は別タスク
- ⚠⚠ **本番ビルド(署名済み.app / .exe)でのOrigin実測は未実施。** `pnpm tauri dev`で確認できたのは
  `http://localhost:1420`(devUrl)経路のみで、本番で使われる`tauri://localhost` / `http://tauri.localhost`は
  一般的なTauri 2の既定値からの推測に留まる。もし想定と違えば、コメントビューアの接続が**エラー表示なく**
  「待機中」のまま固まる(サイレント故障)。**次回リリースのpublish前に実機確認すること**
  (`docs/release.md`のリリース手順4にチェック項目を追記済み)。
