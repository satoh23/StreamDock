# 042a 「接続」→「連携」文言統一（OAuth リンク操作）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [042](042-stream-link-ux.md) を正とする。
>
> **必読前提**: 親 [042](042-stream-link-ux.md)、対象 [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、
> 状態表示 [`StatusIndicator.tsx`](../../apps/desktop/src/screens/comment-viewer/StatusIndicator.tsx)、[`docs/security.md`](../security.md)。
> 文言統一の先行例は [030](030-register-wording-unification.md)。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

サイトへのログイン（OAuth リンク）操作の文言が「接続」になっているのを、実態に合わせて **「連携」** に直す（要望②）。
「サイトとの接続」＝アカウント**連携**であり、配信への**接続（取得）**とは別概念なので、リンク操作だけを対象にする。

## 現在の前提（調査結果・実コード）

- OAuth リンクボタンの文言が「接続」になっているのは [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の以下:
  - カード見出し **147 行** `<div className={styles.cardHead}>接続</div>`。
  - Twitch **159 行** `{linked ? "接続済み" : "接続"}`（`handleTwitchConnect` → `startLogin()` を呼ぶボタン）。
  - YouTube **222 行** `{youtubeLinked ? "接続済み" : "接続"}`（`handleYouTubeConnect` → `startLogin("youtube")`）。
- 一方、以下は**連携ではない別概念**なので対象外:
  - 「コメント取得開始」（174 / 232 行）＝配信への接続（取得開始）。「停止」（182 / 240 行）。
  - [`StatusIndicator.tsx`](../../apps/desktop/src/screens/comment-viewer/StatusIndicator.tsx) の `STATUS_LABEL`（28-33 行）「待機中/接続中/接続済み/失敗」＝**取得セッション状態**（session.state）。同ファイルの docstring（3-13・44-52 行）に「ここでの『接続』＝配信を検知してコメント取得している状況」と明記済み。
  - `SettingsView.tsx` の `SESSION_STATE_LABEL`（29 行付近）の「接続中」も取得セッション状態。
  - device code 文言（202 行付近）は既に「…連携を許可してください」。

## このタスクでやること

- OAuth リンク操作の文言のみ「接続」→「連携」に変更する:
  - `SettingsView.tsx` 147 行 見出し「接続」→「連携」。
  - 159 行 Twitch ボタン `{linked ? "連携済み" : "連携"}`。
  - 222 行 YouTube ボタン `{youtubeLinked ? "連携済み" : "連携"}`。
- リンク操作に付随する近傍の説明文があれば「連携」で表現を揃える（意味が「取得/配信接続」のものには手を付けない）。

## このタスクでやらないこと

- 「コメント取得開始（＝配信接続）」「停止」の文言変更。
- `StatusIndicator` / `SESSION_STATE_LABEL` の「接続中/接続済み」＝**取得セッション状態**の文言変更（連携とは別概念。ここを変えると意味が壊れる）。
- カード再設計・操作場所の移設（**042b** の領分）。
- sidecar / 接続フロー / 制御フレームの変更。

## セキュリティ制約（docs/security.md 準拠）

- **frontend 表示文言の変更のみ**。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- ログ出力・保存の変更なし。

## 完了条件

- OAuth リンクの見出し・ボタンが「連携／連携済み」になり、取得（配信接続）・停止・取得セッション状態表示は従来どおり（意味が壊れていない）。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 設定ビューの接続カードで「連携／連携済み」表記／取得開始・停止・状態表示は従来どおりを目視
```

## 実装後に必要なレビュー

- 軽レビュー（表示文言のみ）。外部通信宛先・API・capability・依存が不変であること、取得セッション状態表示（別概念）を誤って書き換えていないことを確認する。
