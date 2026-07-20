# 036 OBSオーバーレイ 実ユーザーアイコン表示（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 036a〜036c の**分割・線引き・実装順の正**。
>
> **必読前提**: OBS 透過オーバーレイの土台 [033f](033f-obs-transparent-overlay.md)（新規透過窓）・
> オーバーレイ意匠 [034e](034e-overlay-design-refresh.md)（本文＋名前のみ・アイコン枠を先行確保）、同時取得 [035](035-simultaneous-youtube-twitch-comments.md)、
> [`docs/security.md`](../security.md)（特に「## コメントビューア（配信サービス連携）方針」＝配信サービス連携の
> allow-list・fail-closed ホストガード・端末外非送信の正）。CLAUDE.md どおり **「実装して」まで
> コードは変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

OBS 透過オーバーレイ（label `comment-overlay` / [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)）の
コメント行にある**投稿者アイコン枠**へ、**実際のユーザーアイコン（プロフィール画像）を反映**する。現状は 44px の
グレー丸プレースホルダーのみ（[`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の
`renderOverlayItem`・034e で枠/サイズ/位置は確保済み）で、投稿者データが全レイヤーで `{id, name}` だけのためアイコンを
出せていない。YouTube/Twitch の視聴者アイコンを取得してオーバーレイに表示し、配信画面の視認性・親しみやすさを上げる。

## 確定した方針

- **データ経路（sidecar 取得 → data URI）**: 画像は **Node sidecar が取得し、data URI 化してから**既存の loopback WS
  `comments.append` でコメントに載せて送る。**webview は現状どおり外部通信ゼロ**（`<img src>` が踏むのは data URI のみ）・
  **`tauri.conf.json` の `security.csp: null` 不変**・overlay/main 窓の capabilities 不変。新規の外部通信（画像 CDN 取得・
  Twitch のアイコン URL 解決）は**すべて sidecar 側**に閉じる。
- **フィールドの追加と各層の意味**（同名 `avatar: string?` を層ごとに使い分ける・**ts-rs のワイヤ契約が正**）:
  - ドメイン `User`（[`user.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/entities/user/user.ts)）の
    `avatar` = **取得元の画像 URL**（純ドメイン値）。YouTube はコメントストリームから無償で入る／Twitch は Helix で解決。
  - sidecar 配信 DTO `UserSummaryDto`（[`user-summary.dto.ts`](../../apps/comment-sidecar/vendor/shared/src/user/user-summary.dto.ts)）と
    Rust ワイヤ契約 `CommentAuthor`（[`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)）の `avatar`
    = **data URI**（webview がそのまま `<img>` に使える形）。URL→data URI 変換は **配信境界（converter）1 箇所**に集約する
    （[`comment-to-view.converter.ts`](../../apps/comment-sidecar/vendor/comment-delivery/src/adapters/presenters/converters/comment-to-view.converter.ts)）。
    egress を 1 箇所に閉じることで security-review の見通しを良くする。
  - すべて省略可（`Option<String>` / `#[ts(optional)]`・既存 `monetary_amount` に倣う）。空なら描画側はフォールバック。
- **共通取得基盤（sidecar・036b で新設 → 036c で再利用）**: `URL → 画像取得 → 小サイズ（〜44–48px 相当）へ縮小 → data URI 化`
  のユーティリティ。**投稿者 ID 単位の上限付きキャッシュ**（アバターは滅多に変わらない・同一投稿者の再 fetch を避ける）、
  **取得タイムアウト・画像バイト上限・キャッシュ件数上限**を設ける。取得は sidecar の**fail-closed ホストガード**（§1）を
  通し、allow-list 外ホストは throw。
- **失敗時フォールバック**: 取得失敗/タイムアウト/サイズ超過/未取得は `avatar` を空にし、overlay は既存グレー丸
  （または名前イニシャル）にフォールバック。**アイコンが出ないだけで表示は継続**（コメント本文は必ず出す）。
- **プライバシー**: アバターは第三者の顔画像。**一時表示のみ**。data URI を含むコメントは **Rust の DB/ログに保存しない**
  （§9・[`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) 冒頭の既存方針を維持）。sidecar のキャッシュは
  メモリ内・上限付き・永続化しない。
- **既知のトレードオフ**: data URI をコメント単位で送ると WS ペイロードが増える。小サイズ縮小＋ID 単位キャッシュで緩和。
  将来「同一投稿者は初回のみ送信」等の最適化余地あり（MVP では per-comment 許容）。
- **1 タスク 1 機能で分割**（CLAUDE.md）。036a〜c ＋ 本親 036。

## サブタスク分割

| ID | 内容 | 外部通信（新規） | security-review |
|----|------|-----------------|-----------------|
| [036a](036a-avatar-wire-and-overlay-render.md) | ワイヤ契約に `avatar?` を全層追加（`model.rs`→bindings／`UserSummaryDto`／`User`／converter・空パススルー）＋overlay 描画（data URI があれば `<img>`、無ければグレー丸/イニシャル） | なし | 軽（表示/配管のみ） |
| [036b](036b-sidecar-avatar-fetch-youtube.md) | sidecar 共通取得基盤（fetch→縮小→data URI→上限付きキャッシュ）＋YouTube アイコン URL 取り込み（proto/DTO 拡張）＋画像 CDN 宛先を allow-list 追加 | あり（画像 CDN） | **必須**（新規 egress） |
| [036c](036c-sidecar-avatar-fetch-twitch.md) | Twitch アイコン URL を Helix `users` で解決（chat イベントに無い）＋036b 基盤で data URI 化＋画像 CDN 宛先を allow-list 追加 | あり（Helix既存＋画像 CDN） | **必須**（新規 egress） |

## 依存関係と推奨実装順

```
036a → 036b → 036c
```

- **036a が土台**（受け側の配管＋描画。送り側未実装でも `avatar` 空でグレー丸のまま＝無害に先行導入できる）。
- **036b** で共通取得基盤を新設し、まず**追加 API 呼び出しの要らない YouTube**（アイコン URL がコメントストリームに載る）で
  end-to-end を通す。**036c** は Twitch 固有の URL 解決（Helix `users`）を足し、036b の基盤を再利用する。

## 横断セキュリティ方針（docs/security.md 準拠）

- **新規の外部通信は sidecar 内に閉じ、fail-closed ホストガードの allow-list に画像 CDN を明示追加する**（§1）。
  追加宛先: YouTube アイコン CDN（`*.ggpht.com` / `*.googleusercontent.com` 等・**実装時に実レスポンスで確定**／036b）・
  Twitch アイコン CDN（`*.jtvnw.net`／036c）。Twitch の URL 解決に使う Helix（`api.twitch.tv`）は 032c-b で既に allow-list 済み。
- **「## コメントビューア（配信サービス連携）方針」を更新**（アバター画像の取得を明文化・追加宛先を追記）。**方針変更のため
  036b/036c は security-review 必須**。文言更新は 036b（YouTube 分）で着手し、036c（Twitch 分）で追補する。
- **webview / main 窓 / Rust の no-internet 維持・CSP 不変・capabilities 不変**（画像取得は sidecar 内で完結し data URI で渡す
  ため、webview から CDN へ直接通信しない）。env ピン留め・gRPC チャネルガード等の既存ロジックは変更しない。
- 取得した data URI は端末外に出さない・Rust の DB/ログに保存しない（§9）。新規 npm/crate/plugin は増やさない方針
  （画像縮小に軽量ライブラリが必要な場合は 036b で理由を添えて提案する）。

## 完了条件

- 036a〜036c のタスクファイルが本親の分割・依存どおりに存在し、各々が既存フォーマット（[035c](035c-tts-source-filter.md) 等）に沿う。
- [`docs/task-board.md`](../task-board.md) に 036 系が追記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。
- 各サブタスク完了時に [`docs/progress.md`](../progress.md) を更新する（各ファイルの完了条件に含む）。

## このタスク（親）でやらないこと

- コード実装（036a〜c それぞれで行う）。
- **webview から CDN への直接画像読み込み・CSP img-src 追加**（sidecar→data URI 方式で回避する）。
- コメビュ本体（`variant="default"`）へのアイコン追加（アイコン枠は overlay 意匠のみ・034e）。
- 新しい配信プラットフォームの追加（YouTube/Twitch の 2 者に限定）。
- 投稿者アイコンのクリック/リンク等のインタラクション（表示のみ）。
