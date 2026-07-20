# 035a sidecar の取得セッション排他を provider 別化（同時取得を有効化）

> 状態: **未着手（実装サブタスク・035 系の先頭/コア）**。分割・線引きは親 [035](035-simultaneous-youtube-twitch-comments.md) を正とする。
>
> **必読前提**: 親 [035](035-simultaneous-youtube-twitch-comments.md)、sidecar 土台 [032c-b](032c-b-node-sidecar-twitch-comments.md)
> （Twitch/host-guard/WS）・[032c-d](032c-d-youtube-comments.md)（YouTube/gRPC・「同時には走らせない」設計）、
> [`docs/security.md`](../security.md)（「## コメントビューア（配信サービス連携）方針」）。CLAUDE.md どおり
> **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**現状の明文方針「同時取得しない」を反転する
> 変更のため security-review を必須で通す**。

## 目的

sidecar の**単一セッション排他**（片方の取得開始が他方を abort）を **provider 別**に分離し、**Twitch と YouTube を
同時取得**できるようにする。取得コメントは既存の `comments.append`（`source: 'twitch' | 'youtube'`）で流れ、下流の
マージ/表示（[`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts)・
[`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)）は変更なしで両者が 1 リストに並ぶ。

## 現在の前提（調査結果）

- [`apps/comment-sidecar/src/index.ts`](../../apps/comment-sidecar/src/index.ts) が排他の唯一点:
  - `let sessionAbort: AbortController | null`（237行）と `let activeSessionPlatform: Provider | null`（240行）が
    **プロセス全体で 1 つ**。コメントに「各サービス個別選択＝同時取得しない・1 つだけ」と明記（238-240行）。
  - `startSession(channel)`（283-312行・Twitch）と `startYouTubeSession()`（318-346行・YouTube）は**先頭で
    `if (sessionAbort) sessionAbort.abort();`** を実行し、`sessionAbort`/`activeSessionPlatform` を自分に差し替える
    → **一方の開始が他方を停止**する。`finally` は `if (sessionAbort === abort)` で自分がアクティブな時だけ null 化。
  - `stop-session` ハンドラ（365-373行）は **`activeSessionPlatform === frame.service` の時だけ** abort（片方しか
    アクティブになれない前提）。
  - `shutdown`（397-401行）は `sessionAbort?.abort()` で 1 つだけ止める。
- 取得パイプライン `runTwitchPipeline`/`runYouTubePipeline`（`comment-fetcher/` 経由）は**独立した `outputPort`＋
  `controls.signal`** を受け取り、直列化していない。DI は起動時に両グラフを解決済み（`createTwitchPipeline()` /
  `createYouTubePipeline({})`・166・170行）。トークンは provider 別に keychain 復元済み（両ログインは既に併存可能）。
- [`docs/security.md`](../security.md) の「コメントビューア方針」に **「Twitch と YouTube は併存し各サービス個別選択
  （同時取得・マージ表示はしない）」** と明文化（本タスクで反転する箇所）。

## このタスクでやること

### (1) セッション管理を provider 別（`Map<Provider, AbortController>`）へ

- `sessionAbort`（単一）と `activeSessionPlatform` を廃し、**provider 別のコントローラ**（例
  `const sessionAborts = new Map<Provider, AbortController>()`）へ置換する。
- `startSession`/`startYouTubeSession` は **自 provider の既存セッションのみ** abort・差し替える（他 provider は温存）:
  - 例: `sessionAborts.get(provider)?.abort();` → `const abort = new AbortController(); sessionAborts.set(provider, abort);`
  - `finally` は **自分が現在の entry の時だけ**該当 provider を `delete`（`if (sessionAborts.get(provider) === abort) sessionAborts.delete(provider)`）。
  - `runTwitchPipeline`/`runYouTubePipeline` へ渡す `signal` は自 provider の `abort.signal`（現行どおり）。

### (2) stop-session を provider 別停止に

- `stop-session` ハンドラを **該当 provider の controller のみ** abort・`delete` に変更する（他 provider は継続）。
  `activeSessionPlatform` 依存の分岐を除去し、`sessionAborts.get(frame.service)?.abort()` に。停止後は該当 provider の
  `session.state = idle` を送る（現行の viewer 反映を維持）。

### (3) shutdown で全 provider を停止

- `shutdown`（no-orphan/シグナル/stdin close）で **`sessionAborts` の全 controller を abort** する（片方だけ止め残さない）。

### (4) security.md の方針文言を更新

- [`docs/security.md`](../security.md) の「## コメントビューア（配信サービス連携）方針」の
  **「同時取得・マージ表示はしない」→「同時取得・マージ表示する（provider 別セッションで並行取得）」** に更新し、
  **並行 egress・リソース消費増**の留意点（既存 allow-list 宛先への並行接続・CPU/メモリ/ソケットが 2 セッション分）を
  追記する。**YouTube クォータは Twitch 併走の影響を受けない**（消費源は YouTube Data API のみ・枯渇時 graceful stop は
  032c-d 既実装）ため、クォータ保護 UI は 035 系では扱わない。
  032c 系の親設計ドキュメントの該当記述（「同時取得しない」旨）も整合する形で追随更新の要否を確認する。

## このタスクでやらないこと

- **新規の外部通信宛先の追加**・host-guard/gRPC チャネルガード・env ピン留めの**ロジック変更**（本タスクはセッション
  管理のみ／宛先・二層 fail-closed は不変）。
- **フロントエンドの変更**（両接続 UI/インジケータ/バッジは 035b、TTS ソース別読み上げフィルタは 035c）。
- **mergeComments/上限 200 件・WS ブロードキャスト・Rust command の変更**（下流は変更なしで両 source が並ぶ）。
- ログイン/トークン永続化の変更（両 provider の keychain 併存は既に成立）。

## セキュリティ制約（docs/security.md 準拠・重点 コメントビューア方針）

- **新規宛先を増やさない**。既存 allow-list 宛先（Twitch: `id.twitch.tv`/`api.twitch.tv`/`eventsub.wss.twitch.tv`/
  `*.wss.twitch.tv`、YouTube: `oauth2.googleapis.com`/`www.googleapis.com`／同意画面は Rust opener）への**並行接続**の
  みで、**二層 fail-closed（env ピン留め＋ホスト/gRPC ガード）は不変**。ユーザー明示接続時のみ取得を開始する現行を維持。
- **main 窓と Rust の no-internet 維持**・loopback WS・token/device_code 非ログ・取得本文を端末外に出さない、は不変。
- **方針反転（同時取得を許可）を伴うため security-review 必須**。security.md の該当節を本タスクで更新する。

## 完了条件

- Twitch と YouTube を**両方 start でき、両セッションが並行稼働**する（片方の開始が他方を止めない）。
- `comments.append` が **両 `source` で届き**、viewer/overlay に両者が 1 リストで並ぶ（下流無改修で成立）。
- `stop-session` は**該当 provider のみ停止**し、他方は継続する。プロセス終了時は両 provider が確実に停止する。
- **新規宛先・capability・依存の追加が無い**。host-guard/gRPC ガード/env ピン留めのロジックは不変。`csp: null` 不変。
- [`docs/security.md`](../security.md) の「同時取得・マージ表示はしない」が「する」へ更新され、並行 egress/リソース留意点が追記されている。
- `pnpm --filter ./apps/desktop typecheck` / `lint`、sidecar ビルドが通る。**security-review を通過**している。
  [`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop build:sidecar      # sidecar（@stream-dock/comment-sidecar）の再ビルド
pnpm --filter ./apps/desktop tauri dev          # Twitch 接続 → YouTube も接続 → 両者のコメントが 1 リストに並ぶ／
                                                #   片方 stop で他方は継続／終了で両方停止、を目視（実配信が必要）
```

## 実装後に必要なレビュー

- security-review（必須）: **同時取得の解禁が「既存 allow-list 宛先への並行接続」に限定**され、**新規宛先・host-guard/
  gRPC ガードのロジック変更・env ピン留めの緩和・capability 追加が無い**こと、**main/Rust の no-internet と loopback WS
  境界が不変**であること、token/device_code を非ログのまま保っていること、**security.md の方針文言が実装と一致
  （同時取得する）** し並行 egress/リソースの留意が明記されていることを確認する。
