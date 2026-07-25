# 042 配信連携 UX 刷新（親設計）

> 状態: **未着手（親設計・線引きの正）**。実装は子タスク [042a](042a-connect-wording-to-renkei.md) → [042b](042b-connection-cards-on-comment-view.md) の順。
>
> **必読前提**: 先行 [033b](033b-settings-view-connection.md)（接続 UI を設定ビューへ移設＋`StatusIndicator` 新設・本親はその一部を反転する）、
> [`docs/security.md`](../security.md)（特に §1 /「## コメントビューア（配信サービス連携）方針」＝**main 窓は no-internet 維持・通信は sidecar と viewer webview に封じ込め**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**1 作業 1 機能**（子タスクを混ぜない）。

## 目的

配信サービス（YouTube / Twitch）との連携 UX を、配信者が迷わず操作できる形に刷新する。要望は 2 点:

1. **文言の是正**: サイトへのログイン（OAuth リンク）操作の文言が「接続」になっているが、実態は**アカウント連携**なので「連携」に直す（要望②）。
2. **操作場所と意匠**: 接続操作を**設定ビューではなくコメビュ本体へ移し**、YouTube / Twitch の接続状態を**枠で囲まれたカード**として表示。カードをクリックすると
   下に展開し、**連携・配信接続・切断**を行える（YouTube と Twitch で別々のカード）（要望③）。

これにより「今どのサイトとどう繋がっているか」を本体で一目把握し、ワンアクションで連携/取得開始/停止できるようにする。

## 現在の前提（調査結果・実コード）

- コメビュ窓は同一 Vite バンドルをラベル分岐（`App.tsx` の `getCurrentWindow().label === "comment-viewer"` → `CommentViewerApp`）。
- 接続 UI は**設定ビュー**に集約: [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の「接続」カード（146-256 行）。
  - OAuth リンクボタンの**文言が「接続」**: カード見出し 147 行、Twitch 159 行 `{linked ? "接続済み" : "接続"}`、YouTube 222 行 `{youtubeLinked ? "接続済み" : "接続"}`。
  - 実際の配信取得＝「コメント取得開始」（Twitch 174 行 / YouTube 232 行）、停止＝「停止」（182 / 240 行）。状態テキスト（188-195 / 242-251 行）、device code 提示（202 行付近・既に「連携」表記）。
- コメビュ本体には接続ボタンが無く、[`StatusIndicator`](../../apps/desktop/src/screens/comment-viewer/StatusIndicator.tsx)（円アイコン色＋テキストの 2 行）だけがある。
  - `StatusIndicator` の「接続中/接続済み」は **sidecar の取得セッション状態（session.state）** を表し（`deriveConnectionStatus` 56-61 行・`STATUS_LABEL` 28-33 行）、**OAuth リンク（連携）とは別概念**。
- 接続/取得/停止は Tauri command **ではなく** loopback WS 制御フレーム: [`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts) の
  `startLogin(service?)` / `startSession(service, channel?)` / `stopSession(service)`（173-181 行）。ハンドラは [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)
  456-485 行（`handleTwitchConnect`/`handleStartSession`/`handleStopSession`/`handleYouTubeConnect`/`handleYouTubeStartSession`/`handleYouTubeStopSession`）。state はすべて `CommentViewerApp` ローカル。
- スタイルは CSS Modules＋役割トークン。[`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css) の `.card`/`.cardHead`/`.cardBody`（353-386 行）、`.connGrid`（389-395 行）、`.statusIndicator`/`.statusRow`/`.statusDot`（88-124 行）。色は [`theme.css`](../../apps/desktop/src/styles/theme.css) のトークン。

## 子タスクと線引き

| 子 | 内容 | レビュー |
|---|---|---|
| [042a](042a-connect-wording-to-renkei.md) | OAuth リンク操作の文言のみ「接続」→「連携」。取得セッションの状態表示（接続中/接続済み）は変えない | 軽 |
| [042b](042b-connection-cards-on-comment-view.md) | 本体の `StatusIndicator` を Twitch/YouTube 別カード化。展開で連携/配信接続/切断。設定ビューの「接続」カードを本体へ移設し撤去 | 軽 security-review |

- **033b の部分反転**: 033b は「接続操作は設定ビューへ集約し、本体は状態表示のみ」だった。本親（042b）は**接続操作を本体カードへ戻す**。ただし **WS 接続は窓内 1 本のまま／メイン窓 no-internet 維持**という 033b の安全設計は不変で踏襲する。
- 042a は 042b の前提（先に正しい文言へ直し、042b がその文言のままカードへ移設する）。

## このタスク（親）でやらないこと

- 実装（各子タスクで行う）。接続フロー（OAuth / Device Code / gRPC）や sidecar 側ロジックの変更。VOICEVOX / オーバーレイ設定節の変更。
- 新規 WS・宛先・capability・依存の追加。

## セキュリティ制約（docs/security.md 準拠）

- **メイン窓の no-internet を維持**。接続 UI・sidecar WS はコメビュ窓に閉じたまま（設定/操作を main 窓へ引き出さない）。
- **WS 接続は窓内 1 本のまま**（`connectCommentStream` を分割で二重化しない）。宛先 `ws://127.0.0.1:<port>` 不変・allow-list 宛先の通信は sidecar 封じ込め済み。
- 新規 Tauri command / capability / 依存を追加しない（§3/§10）。`csp: null` 不変。

## 完了条件（親）

- 042a / 042b が完了し、要望②（連携文言）・③（本体カード化＋展開操作）が満たされる。
- メイン窓 no-internet・窓内 WS 1 本・capability/依存不変・`csp: null` 不変が全子タスクで守られている。

## 実装後に必要なレビュー

- 各子タスク記載のとおり（042a＝軽 / 042b＝軽 security-review）。
