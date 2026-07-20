# 036b sidecar アバター取得基盤＋YouTube 対応（送り側）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [036](036-overlay-user-avatar.md) を正とする。
>
> **必読前提**: 親 [036](036-overlay-user-avatar.md)、受け側配管 [036a](036a-avatar-wire-and-overlay-render.md)（**036a 後に着手**）、
> YouTube 取得の元 [032c-d](032c-d-youtube-comments.md)、[`docs/security.md`](../security.md)（§1 外部通信・fail-closed
> ホストガード／「## コメントビューア（配信サービス連携）方針」）。CLAUDE.md どおり **「実装して」まで変更せず、まず
> 変更計画と対象ファイルを提示する**。**外部通信が増える → security-review 必須**。

## 目的

sidecar 側に**アバター画像の共通取得基盤**（URL→取得→縮小→data URI→上限付きキャッシュ）を新設し、まず**追加 API 呼び出しの
要らない YouTube** で end-to-end を通す。YouTube はコメントストリームの `authorDetails` にプロフィール画像 URL が載るため、
それを取り込んで基盤で data URI 化し、[036a](036a-avatar-wire-and-overlay-render.md) の `avatar`（wire=data URI）に載せて overlay に表示する。

## 現在の前提（調査結果）

- YouTube のコメントは gRPC `streamList` を回して取得（[`comment.repository.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/repository/comment.repository.ts)）、
  `mapYouTubeLiveChatMessagesToComments`（[`comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/mapper/comment.mapper.ts) 55-58 行）で
  `author.id = channel_id` / `author.name = display_name` を作る。
- proto: [`stream-list-proto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/client/stream-list-proto.ts) の
  レスポンス `LiveChatMessageAuthorDetails`（70-73 行付近）は現状 `channel_id` / `display_name` のみを受けている。**リクエスト側には
  `optional uint32 profile_image_size = 3;` が既にある**（同 proto 23 行付近）。生 DTO `YouTubeLiveChatAuthorDetailsDto`
  （[`raw.dto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/dto/raw.dto.ts) 70-73 行付近）も 2 フィールドのみ。
  → **proto レスポンスと DTO に `profile_image_url` 相当を足せば取得可能**な状態。
- sidecar の外部通信は **env ピン留め＋fail-closed ホストガード**で allow-list 外を throw（[`docs/security.md`](../security.md) §1・
  「## コメントビューア（配信サービス連携）方針」）。画像 CDN は現状 allow-list に**無い**。
- ワイヤ契約 `avatar`（任意）と overlay 描画は 036a で追加済み前提。

## このタスクでやること

### 共通アバター取得基盤（036c でも再利用）

- 新規ユーティリティ（sidecar 内・配信境界に近い層）: `resolveAvatarDataUri(url): Promise<string | undefined>`。
  - `fetch`（**fail-closed ホストガード経由**）で画像取得 → **小サイズ（〜44–48px 相当）へ縮小** → `data:image/...;base64,...` 化。
  - **投稿者 ID 単位の上限付きキャッシュ**（同一投稿者は再 fetch しない）・**取得タイムアウト**・**画像バイト上限**・
    **キャッシュ件数上限（LRU 等）**。失敗/超過/タイムアウトは `undefined`（→ overlay がグレー丸へフォールバック）。
  - 呼び出し口は **[`comment-to-view.converter.ts`](../../apps/comment-sidecar/vendor/comment-delivery/src/adapters/presenters/converters/comment-to-view.converter.ts)**（配信境界）に集約し、
    `User.avatar`（URL）→ `UserSummaryDto.avatar`（data URI）へ変換する（036a で素通しにした箇所を実処理に）。converter/配信経路の
    async 化が必要なら最小限で行う。
  - **画像縮小に軽量ライブラリが要る場合はここで理由を添えて提案**（新規依存は原則増やさない・§10。Node 標準や既存依存で
    可能なら優先）。

### YouTube のアイコン URL 取り込み

- proto レスポンス `LiveChatMessageAuthorDetails` と生 DTO `YouTubeLiveChatAuthorDetailsDto` に `profile_image_url` 相当を追加
  （リクエストの `profile_image_size` は既存・必要なら適切なサイズを指定）。
- mapper（[`comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/youtube/mapper/comment.mapper.ts)）で
  `User.avatar = profileImageUrl`（URL）を設定。data URI 化は上記 converter 基盤が担う。

### security.md 追記（YouTube 分）

- 「## コメントビューア（配信サービス連携）方針」に**アバター画像の取得**を明文化し、fail-closed ホストガードの allow-list へ
  **YouTube アイコン CDN**（`*.ggpht.com` / `*.googleusercontent.com` 等・**実レスポンスで確定**）を追加する。取得は sidecar 内で
  完結し data URI で渡す（webview/CSP/capabilities は不変）旨・キャッシュ上限・非保存を併記。

## このタスクでやらないこと

- **Twitch のアイコン**（036c＝Helix `users` で URL 解決・036b 基盤を再利用）。
- webview から CDN への直接読み込み・CSP img-src 追加（sidecar→data URI 方式のまま）。
- 「同一投稿者は初回のみ送信」等の WS ペイロード最適化（将来枠・MVP は per-comment 許容）。
- 新規配信プラットフォーム追加・gRPC/OAuth 認証基盤の変更（既存の取得経路に URL フィールドを足すのみ）。

## セキュリティ制約（docs/security.md 準拠）

- **新規 egress（画像 CDN 取得）を伴う方針変更 → security-review 必須**。**追加宛先は fail-closed ホストガードの allow-list に
  明示追加**し、それ以外は throw（§1）。env ピン留め・gRPC チャネルガード等の既存ロジックは変更しない。
- 画像取得・data URI 化・キャッシュは**すべて sidecar 内**。webview / main 窓 / Rust の no-internet 維持・`csp: null` 不変・
  capabilities 不変。
- data URI・アイコン URL を Rust の DB/ログに保存しない（§9）。キャッシュはメモリ内・上限付き・非永続。
- 新規依存を増やさない（縮小ライブラリが必要なら §10 に沿って理由・代替検討を明記して提案）。

## 完了条件

- YouTube 実配信で、overlay の投稿者アイコン枠に**実アイコン（data URI）が表示**される。取得失敗/タイムアウト時はグレー丸へ
  フォールバックし表示が壊れない。
- 同一投稿者で画像を**重複 fetch しない**（キャッシュ効果をログ等で確認）。取得タイムアウト・画像バイト上限・キャッシュ件数上限が効く。
- 追加宛先が fail-closed ホストガードの allow-list に入り、**allow-list 外ホストは throw**する。`docs/security.md` の該当節が更新済み。
- webview/CSP/capabilities 不変・新規依存なし（or 提案し承認済み）。data URI/URL を DB/ログに出さない。
- `pnpm --filter ./apps/comment-sidecar typecheck` / `lint`・`pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) 更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/comment-sidecar typecheck
pnpm --filter ./apps/comment-sidecar lint
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # YouTube 実配信につなぎ、overlay に実アイコン表示／失敗時グレー丸／同一投稿者の
                                         #   重複 fetch 抑制（sidecar ログ）を目視（実配信・実 OAuth が必要）
```

## 実装後に必要なレビュー

- security-review（**必須**）: 追加宛先が allow-list に**明示追加**され allow-list 外は throw すること、画像取得が sidecar 内に
  閉じ webview/CSP/capabilities/Rust no-internet が不変であること、キャッシュ上限・タイムアウト・バイト上限・失敗時挙動、
  data URI/URL を DB/ログに出さないこと、新規依存の有無と妥当性を確認する。
