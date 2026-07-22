# 040a sidecar Twitch chatters 取得（スコープ追加＋ポーリング）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [040](040-lurker-list.md) を正とする。**親のスパイク（実現性確認）が済んでから着手する。**
>
> **必読前提**: 親 [040](040-lurker-list.md)、Twitch スコープ [`twitch-config.ts`](../../apps/comment-sidecar/src/twitch-config.ts)（29 行）、
> sidecar オーケストレーション [`apps/comment-sidecar/src/index.ts`](../../apps/comment-sidecar/src/index.ts)（`Map<Provider, AbortController>`・035a）、
> Twitch Helix クライアント [`helix.client.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/client/helix.client.ts)（`users` 解決の前例＝036c）、
> [`docs/security.md`](../security.md)（fail-closed ホストガード・スコープ/allow-list・§1/§3）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

Twitch の **`Get Chatters`（チャット接続中ユーザー）を sidecar で定期取得**し、loopback 経由で viewer へ配信する。ROM の突合・表示は 040b。

## 現在の前提（調査結果）

- Twitch スコープは `TWITCH_SCOPES=["user:read:chat"]` のみ（[`twitch-config.ts`](../../apps/comment-sidecar/src/twitch-config.ts) 29 行）。`Get Chatters` には **`moderator:read:chatters`** が必要。
- sidecar は provider 別に取得セッションを持つ（`runTwitchPipeline`・`sessionAborts: Map<Provider, AbortController>`／[`index.ts`](../../apps/comment-sidecar/src/index.ts)・035a）。コメントは WS broadcast で viewer/overlay に届く。
- `broadcaster_id` はチャンネル名から Helix `users` で解決可能（036c で `users` 使用済み）。`moderator_id` は認証ユーザー ID。宛先 `api.twitch.tv` は allow-list 済み。
- 認証ユーザーが対象チャンネルの broadcaster/moderator でないと 401/403 になる（親 040 の制約）。

## このタスクでやること

### スコープ追加

- `TWITCH_SCOPES` に `moderator:read:chatters` を追加（[`twitch-config.ts`](../../apps/comment-sidecar/src/twitch-config.ts)）。再ログインで新スコープのトークンを取得する導線を確認（既存 Device Code フロー）。スコープは必要最小に留める。

### Get Chatters ポーリング

- Twitch セッション開始時（`runTwitchPipeline`）に、**別系統の定期ポーリング**を起動: `broadcaster_id`（channel 名から Helix `users` で解決）＋`moderator_id`（認証ユーザー）で
  `GET /helix/chat/chatters` を親スパイクで決めた間隔（例 30〜60s）で呼ぶ。ページング（cursor）で全件収集、レート/上限に配慮。取得はセッションの `AbortController` に紐付け停止と連動。
- 権限不足（broadcaster/moderator でない）・YouTube セッション時は**エラーにせずスキップ**し、理由を state で viewer に伝える（040b が UI で明示）。

### 配信（loopback）

- chatters（ログイン名/表示名の一覧＋取得時刻）を新しい WS フレーム（例 `chatters.snapshot`）で viewer へ配信する。コメントの broadcast 経路（`WebSocketCommentOutputPort`）に倣い、
  **overlay 窓には送らない**（ROM 一覧はコメビュ専用）。フレーム型は既存の wire 定義流儀（[`apps/comment-sidecar/src/wire.ts`](../../apps/comment-sidecar/src/wire.ts) 付近）に追加。

## このタスクでやらないこと

- ROM の突合（chatters − コメント済み）・一覧 UI（040b）。YouTube 対応（不可）。永続化（必要なら 038 の範囲）。
- overlay への表示。他人チャンネルでの強行取得。

## セキュリティ制約（docs/security.md 準拠）

- **新規外部通信（chatters）は sidecar 内・fail-closed ホストガード経由**（§1）。宛先 `api.twitch.tv` は既存 allow-list（新規宛先は増やさない）。
- **新規スコープ `moderator:read:chatters` の追加は方針変更**。security.md「## コメントビューア方針」に chatters 取得とスコープを追記。**security-review 必須**。スコープは最小（§3）。
- chatters（ログイン名）は端末外に出さない・Rust の DB/ログへ保存しない（§9）。トークンは既存キーチェーン運用踏襲・secret/verifier を載せない。
- 新規 npm を増やさない方針（必要なら理由を添えて提案）。sidecar stderr にトークン/機密を出さない。

## 完了条件

- `moderator:read:chatters` を含むトークンで、自チャンネルに対し `Get Chatters` が通り、chatters スナップショットが定期的に viewer へ配信される。
- 権限不足/YouTube 時はエラーにならずスキップ理由が viewer に伝わる。取得はセッション停止と連動して止まる。
- 新規宛先を追加していない（`api.twitch.tv` のみ）。security.md にスコープ/取得が明文化されている。
- `pnpm --filter ./apps/comment-sidecar typecheck` / `lint`（sidecar）、`pnpm --filter ./apps/desktop typecheck`（wire 型追加時）が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/comment-sidecar typecheck
pnpm --filter ./apps/comment-sidecar lint
pnpm --filter ./apps/desktop typecheck   # wire 型（chatters フレーム）追加時
pnpm --filter ./apps/desktop tauri dev   # 自チャンネルに Twitch 接続→chatters スナップショットが定期配信されること、
                                         #   他人チャンネル/YouTube ではスキップ理由が出ることを確認（要 実 Twitch 配信）
```

## 実装後に必要なレビュー

- **security-review（必須）**: 新規スコープが `moderator:read:chatters` のみ最小追加であること、chatters 取得が sidecar 内 fail-closed で
  既存 allow-list 宛先に限ること、chatters を端末外/DB/ログに出さないこと、トークン運用が既存キーチェーン踏襲であることを確認する。security.md 追記の妥当性も確認。
