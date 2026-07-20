# 036c sidecar アバター取得 Twitch 対応（Helix users）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [036](036-overlay-user-avatar.md) を正とする。
>
> **必読前提**: 親 [036](036-overlay-user-avatar.md)、共通基盤 [036b](036b-sidecar-avatar-fetch-youtube.md)（**036b 後に着手・基盤を再利用**）、
> Twitch 取得の元 [032c-b](032c-b-node-sidecar-twitch-comments.md)、[`docs/security.md`](../security.md)（§1 外部通信・fail-closed
> ホストガード／「## コメントビューア（配信サービス連携）方針」）。CLAUDE.md どおり **「実装して」まで変更せず、まず
> 変更計画と対象ファイルを提示する**。**外部通信が増える → security-review 必須**。

## 目的

Twitch のアイコンを overlay に表示する。Twitch の chat イベントには**アバターが載らない**ため、投稿者 ID から
Helix `users` API でプロフィール画像 URL を解決し、[036b](036b-sidecar-avatar-fetch-youtube.md) の共通基盤（fetch→縮小→data URI→
上限付きキャッシュ）を再利用して `avatar`（wire=data URI）に載せる。

## 現在の前提（調査結果）

- Twitch は EventSub WS でチャットを受信し、`mapTwitchChatEventsToComments`（[`comment.mapper.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.ts) 45-48・58-61 行）で
  `author.id = chatter_user_id` / `author.name = chatter_user_name` を作る。**chat イベントにアバター URL は無い**
  （生 DTO `TwitchChatMessageEventDto`・[`raw.dto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/dto/raw.dto.ts)）。
- Helix クライアントは既存（[`helix.client.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/client/helix.client.ts)・
  自ユーザー/配信解決に使用）。**Helix `users` は `profile_image_url` を返す**（ID を最大 100 件までバッチ照会可）。生 DTO `TwitchUserDto`
  （[`raw.dto.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/dto/raw.dto.ts)）は現状 `id / login / display_name` のみ。
- Helix の宛先 `api.twitch.tv` は 032c-b で**既に allow-list 済み**。画像 CDN `*.jtvnw.net` は allow-list に**無い**。
- 共通基盤 `resolveAvatarDataUri` と converter への集約、`avatar` ワイヤ契約は 036a/036b で用意済み前提。

## このタスクでやること

### Twitch アイコン URL の解決（Helix users）

- [`helix.client.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/client/helix.client.ts) に `users`
  照会を追加し、生 DTO `TwitchUserDto` に `profile_image_url` を足す。投稿者 ID を**まとめてバッチ照会**（重複排除・最大 100 件/回・
  レート配慮）。解決結果（id→URL）は基盤のキャッシュと整合させ、**同一投稿者は再照会しない**。
- Twitch の `User.avatar = profile_image_url`（URL）を設定する（mapper もしくは配信境界の解決ステップ）。data URI 化は 036b の
  基盤（converter 集約）が担う。

### 共通基盤の再利用（036b）

- URL→data URI 変換・縮小・上限付きキャッシュ・タイムアウト・失敗時 `undefined` は **036b の `resolveAvatarDataUri` を再利用**
  （Twitch 用に新実装しない）。失敗時は overlay がグレー丸へフォールバック。

### security.md 追記（Twitch 分）

- 「## コメントビューア（配信サービス連携）方針」に **Twitch アイコン CDN `*.jtvnw.net`** を fail-closed ホストガードの allow-list へ
  追加（Helix `api.twitch.tv` は既存）。Helix `users` 照会の追加（既存宛先内）とアバター取得の egress を明文化。

## このタスクでやらないこと

- **共通取得基盤の新規実装**（036b で実装済みを再利用するのみ）・YouTube 側の変更（036b）。
- webview から CDN への直接読み込み・CSP img-src 追加（sidecar→data URI 方式のまま）。
- Twitch 認証（Device Code）基盤や EventSub 購読の変更（アイコンは Helix `users` の追加照会のみ）。
- WS ペイロード最適化（「初回のみ送信」等・将来枠）。

## セキュリティ制約（docs/security.md 準拠）

- **新規 egress（画像 CDN 取得）を伴う方針変更 → security-review 必須**。**`*.jtvnw.net` を fail-closed ホストガードの allow-list に
  明示追加**し、それ以外は throw（§1）。Helix `api.twitch.tv` は既存 allow-list 内で `users` 照会を追加するのみ。env ピン留め・
  ホスト/gRPC ガードの既存ロジックは変更しない。
- 画像取得・data URI 化・キャッシュ・Helix 照会は**すべて sidecar 内**。webview / main 窓 / Rust の no-internet 維持・`csp: null` 不変・
  capabilities 不変。
- data URI・アイコン URL・Helix 応答を Rust の DB/ログに保存しない（§9）。OAuth トークンは既存どおり非ログ。キャッシュはメモリ内・
  上限付き・非永続。

## 完了条件

- Twitch 実配信で、overlay の投稿者アイコン枠に**実アイコン（data URI）が表示**される。取得失敗/タイムアウト時はグレー丸へ
  フォールバックし表示が壊れない。
- Helix `users` を**バッチ・重複排除**で照会し、同一投稿者を再照会/再 fetch しない（キャッシュ効果をログで確認）。
- `*.jtvnw.net` が allow-list に入り **allow-list 外ホストは throw**。`docs/security.md` の該当節が更新済み。
- webview/CSP/capabilities 不変・Rust no-internet 不変・新規依存なし。data URI/URL/トークンを DB/ログに出さない。
- `pnpm --filter ./apps/comment-sidecar typecheck` / `lint`・`pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) 更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/comment-sidecar typecheck
pnpm --filter ./apps/comment-sidecar lint
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # Twitch 実配信につなぎ、overlay に実アイコン表示／失敗時グレー丸／Helix users の
                                         #   バッチ照会・重複抑制（sidecar ログ）を目視（実配信・実 OAuth が必要）
```

## 実装後に必要なレビュー

- security-review（**必須**）: `*.jtvnw.net` が allow-list に明示追加され allow-list 外は throw すること、Helix `users` 照会が既存
  宛先内・バッチ/重複排除で過剰呼び出しにならないこと、画像取得が sidecar 内に閉じ webview/CSP/capabilities/Rust no-internet が
  不変であること、キャッシュ上限・失敗時挙動、data URI/URL/トークンを DB/ログに出さないことを確認する。
