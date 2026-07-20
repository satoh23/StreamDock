# 036a アバター ワイヤ契約拡張＋オーバーレイ描画（受け側）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [036](036-overlay-user-avatar.md) を正とする。
>
> **必読前提**: 親 [036](036-overlay-user-avatar.md)、オーバーレイ意匠 [034e](034e-overlay-design-refresh.md)（アイコン枠を先行確保）、
> ワイヤ契約の元 [032c-b](032c-b-node-sidecar-twitch-comments.md)（`CommentViewDto` の ts-rs 正）、[`docs/security.md`](../security.md)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**036b/036c より先行可**
> （送り側未実装でも `avatar` 空でグレー丸のまま＝無害）。

## 目的

投稿者アイコン（data URI）を**受け取って描画するための配管と表示**を先に通す。ワイヤ契約（Rust ts-rs → bindings →
sidecar DTO/ドメイン/converter）に任意フィールド `avatar` を追加し、オーバーレイの既存アイコン枠に data URI を差す。
この時点では送り側（036b/036c）が未実装なので `avatar` は常に空で、**見た目は現状（グレー丸）から変わらない**のが正常。

## 現在の前提（調査結果）

- 投稿者は全レイヤーで `{id, name}` のみ。Rust ワイヤ契約 `CommentAuthor`（[`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) 33-41 行・
  `#[serde(rename_all = "camelCase")]`・`#[ts(export ...)]`）が**唯一の正**で、bindings（`src/features/comment-viewer/bindings/CommentAuthor.ts`）を生成する。
  既存の任意フィールド例は `CommentViewDto.monetary_amount`（`#[ts(optional)] Option<String>`・[`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) 61-63 行）。
- sidecar 側の同形: ドメイン `User`（[`user.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/entities/user/user.ts) `{id,name}`）・
  配信 DTO `UserSummaryDto`（[`user-summary.dto.ts`](../../apps/comment-sidecar/vendor/shared/src/user/user-summary.dto.ts) `{id,name}`）・
  変換 [`comment-to-view.converter.ts`](../../apps/comment-sidecar/vendor/comment-delivery/src/adapters/presenters/converters/comment-to-view.converter.ts)（`author` を `{id,name}` コピー）。
- オーバーレイ描画は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderOverlayItem`（106-108 行）で
  `<div className={overlayStyles.icon} aria-hidden="true" />` の**空グレー丸**。CSS は差し込み前提で準備済み
  （[`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css) 84-92 行・`--icon-size:44px`・`background-size: cover`）。
- 画像なしフォールバックの参考: 既存 [`display.ts`](../../apps/desktop/src/features/tools/display.ts) の `toIconLetter`（頭文字生成・ツール用の別系統だが手本になる）。

## このタスクでやること

### ワイヤ契約に `avatar?`（任意）を全層追加

- [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) の `CommentAuthor` に `#[ts(optional)] pub avatar: Option<String>`
  を追加（`monetary_amount` と同型）。**data URI を入れる想定**（親 036 の層別意味づけに従う）。bindings（`CommentAuthor.ts`）を再生成。
- sidecar 側を同形にする（この時点では**常に空を通すだけ**）:
  - ドメイン `User`（[`user.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/entities/user/user.ts)）に `avatar?: string`（＝**取得元 URL** の器・036b/c が埋める）。
  - `UserSummaryDto`（[`user-summary.dto.ts`](../../apps/comment-sidecar/vendor/shared/src/user/user-summary.dto.ts)）に `avatar?: string`（＝**data URI** の器）。
  - [`comment-to-view.converter.ts`](../../apps/comment-sidecar/vendor/comment-delivery/src/adapters/presenters/converters/comment-to-view.converter.ts) は現状は `avatar` をそのまま素通し（`undefined` のまま）。URL→data URI 変換の実処理は 036b で本ファイルに追加する。

### オーバーレイ描画（data URI があれば画像・無ければ従来）

- [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderOverlayItem` を、`c.author.avatar` が
  あれば icon 枠に `<img src={c.author.avatar} alt="" />`（または `style={{ backgroundImage: url(...) }}`）で表示、無ければ既存の
  グレー丸（フォールバックに名前イニシャルを使う場合は `toIconLetter` 相当を icon 枠内に描画）。CSS の `--icon-size` /
  `border-radius` / `background-size: cover` はそのまま効く（[`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css) 84-92 行）。

## このタスクでやらないこと

- **実際の画像取得・URL 解決・data URI 変換**（036b＝共通基盤＋YouTube／036c＝Twitch）。本タスクは空パススルーで配管のみ。
- コメビュ本体（`variant="default"` / `renderDefaultItem`）へのアイコン追加（アイコンは overlay 意匠のみ）。
- 画像縮小・キャッシュ・タイムアウト等（sidecar 側の 036b）。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示追加＋ワイヤ契約のフィールド追加のみ**。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。
  `csp: null` 不変。`<img>` が踏むのは data URI のみで**外部 URL を踏まない**（036b/036c が data URI を用意するまでは常に空）。
- 取得コメント（data URI を含む）は Rust の DB/ログに出さない（§9・既存踏襲）。

## 完了条件

- `CommentAuthor.avatar`（任意）が Rust ワイヤ契約・bindings・sidecar の `User`/`UserSummaryDto`/converter に一貫して存在する。
- `avatar` に data URI が入れば overlay のアイコン枠に画像が出る／空なら従来どおりグレー丸（またはイニシャル）で表示が壊れない。
- 新規宛先/API/capability/依存を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint`・`cargo check`（bindings 再生成後）が通る。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # CommentAuthor 変更→bindings 再生成の整合
pnpm --filter ./apps/desktop tauri dev                          # overlay を開き、avatar 空で従来どおり（グレー丸）で
                                                                #   壊れないこと／ダミー data URI 注入で画像が枠に出ることを目視
```

## 実装後に必要なレビュー

- security-review（軽）: **frontend 表示とワイヤ契約フィールド追加のみで外部通信宛先・API・capability・依存が不変**であること、
  `<img>` が data URI 以外を踏まないこと、コメント本文/画像を DB/ログに出していないことを確認する。
