# 033b 設定ビュー新設＋接続UI移設＋接続状態インジケータ

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [033](033-comment-viewer-ux-revamp.md) を正とする。
>
> **必読前提**: 親 [033](033-comment-viewer-ux-revamp.md)、[`docs/security.md`](../security.md)（特に §1 /
> 「## コメントビューア（配信サービス連携）方針」＝**main 窓は no-internet 維持・通信は sidecar と viewer webview に
> 封じ込め**）、先行タスク [033a](033a-comment-viewer-declutter.md)（本タスクは 033a 完了を前提にレイアウトを組む）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

YouTube/Twitch の接続操作を、コメビュ窓内の**「設定ビュー」（歯車ボタンで切替）へ移設**して本体をすっきりさせる。
本体（コメントビュー）には接続ボタンを置かず、**「円アイコン色＋テキスト」で接続状態を一目で分かる**ようにする。
sidecar への通信面は**コメビュ窓に閉じたまま**（新しい WS・宛先・capability を増やさない）で、UI の置き換えに徹する。

## 現在の前提（調査結果）

- コメビュ窓は同一 Vite バンドルをラベル分岐（[`App.tsx:352-358`](../../apps/desktop/src/App.tsx#L352-L358) で
  `getCurrentWindow().label === "comment-viewer"` → `CommentViewerApp`）。ネイティブタイトルバー運用で、メイン画面の
  カスタム `Header` は再利用しない（[`CommentViewerApp.tsx:20-21`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L20-L21) コメント）。
- 接続 UI は本体に露出:
  - Twitch パネル [`CommentViewerApp.tsx:386-441`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L386-L441)
    （接続ボタン・チャンネル入力・取得開始/停止・Device Code 提示・状態テキスト）。
  - YouTube パネル `447-487`（接続・取得開始/停止・状態テキスト）。
- 接続状態の state（すべて `CommentViewerApp` ローカル）:
  - `streamConnected`（152・sidecar WS 接続済み）、`linked`/`youtubeLinked`（158/161・ログイン済み）、
    `sessionState`/`youtubeSessionState`（154/162・`idle|connecting|connected|failed`）、
    `sessionReason`/`youtubeSessionReason`（155/163）、`deviceCode`（153）、`channel`（167・localStorage 復元）。
  - 日本語ラベル `SESSION_STATE_LABEL`（86-91）: `idle=待機 / connecting=接続中 / connected=取得中 / failed=失敗`。
- 制御フレーム: [`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts) の
  `startLogin(service?)` / `startSession(service, channel?)` / `stopSession(service)`（173-181）。WS 接続は
  `connectCommentStream(...)`（`get_comment_stream_port` でポート取得 → `ws://127.0.0.1:<port>`）。
- 状態更新は `connectCommentStream` のコールバック（`onComments`/`onDeviceCode`/`onSessionState`/
  `onConnectionChange`/`onLinkState`・203-240）で反映。ローカル state のみ（zustand/context なし）。

## このタスクでやること

### (1) コメビュ窓のビュー切替（comment / settings）

- `CommentViewerApp` に表示モード state（例 `view: "comment" | "settings"`）を追加。本体に**小さな歯車ボタン**を
  置き、`settings` へ切替。`settings` ビューには「戻る」導線を用意する。ネイティブタイトルバーのため、切替は本体内の
  小さなツールバー領域で行う（メイン画面 `Header` は使わない）。

### (2) 接続 UI を設定ビューへ移設

- Twitch パネル（386-441）・YouTube パネル（447-487）の接続/取得操作を **設定ビューへ移す**。既存 state と
  制御フレーム（`startLogin`/`startSession`/`stopSession`）・ハンドラ（`handleTwitchConnect`/`handleStartSession`/
  `handleStopSession`/`handleYouTubeConnect`/`handleYouTubeStartSession`/`handleYouTubeStopSession`・243-272）を
  **そのまま再利用**（新規 WS・宛先・sidecar を作らない）。チャンネル名入力・Device Code 提示も設定ビューへ。
- 接続状態を **「未接続／接続中／接続済み／取得中／失敗」** に整理して各サービス毎に明示（`streamConnected` が false の
  間は「接続準備中」を優先表示する既存の配慮 419-430 を踏襲）。

### (3) 本体に接続状態インジケータ（円アイコン＋テキスト）

- コメントビュー本体に、接続ボタンの代わりに **StatusIndicator（色付き円＋テキスト）** を置く。**色対応案**:
  未接続=グレー / 接続中=黄 / 接続済み=青 / 取得中=緑 / 失敗=赤。判定は `streamConnected` と、アクティブな platform の
  `linked`/`sessionState`（Twitch）・`youtubeLinked`/`youtubeSessionState`（YouTube）から導出する。Twitch/YouTube は
  併存・個別選択（同時取得しない）ため、サービス別に 1 行ずつ、または「取得中のサービス」を優先表示する（tasks 実装時に確定）。

### (4) コンポーネント分割（保守性）

- 535 行の肥大化対策として `SettingsView` / `StatusIndicator` / `CommentList` を切り出す（配置は
  `apps/desktop/src/screens/comment-viewer/` 配下 or `features/comment-viewer/` を実装時に決定）。state は
  `CommentViewerApp` に残し、props で受け渡す（**WS 接続は 1 箇所のまま**＝窓内で複数接続を張らない）。033c/033d/033f が
  この分割を再利用する。

## このタスクでやらないこと

- **新しい通信面・sidecar/WS・宛先・capability の追加**（同一 sidecar・同一 WS のまま。§1 /「方針②」を厳守）。
- VOICEVOX 読み上げトグル・クレジット条件表示（**033c**）、話者選択・改名（**033d**）。
- ツール管理の再生/停止（**033e**）、OBS オーバーレイ（**033f**）。
- 接続フロー（OAuth/Device Code/gRPC 等）や sidecar 側ロジックの変更（Node sidecar は触らない）。

## セキュリティ制約（docs/security.md 準拠・重点 §1 /「コメントビューア方針②」）

- **メイン窓の no-internet を維持**。接続 UI・sidecar WS はコメビュ窓に閉じたまま。設定を**メイン窓へ引き出さない**
  （引き出すと sidecar/WS を main へ引き込む＝方針違反）。
- **WS 接続は窓内で 1 本のまま**（`connectCommentStream` の `useEffect` を分割で二重化しない）。宛先は
  `ws://127.0.0.1:<port>` のループバック不変・allow-list 宛先の Twitch/YouTube 通信は sidecar に封じ込め済み。
- 新規 Tauri command / capability / 依存を追加しない（§3/§10）。`csp: null` 不変。取得コメント本文はログ/DB に出さない（既存踏襲）。
- **UI 再構成だが「誤って複数窓へ WS を張らない／main へ通信を漏らさない」ことの確認のため security-review を軽く通す**。

## 完了条件

- 歯車ボタンで設定ビューへ切替でき、Twitch/YouTube の接続・取得開始/停止・Device Code 提示が設定ビューで完結する。
- 本体には接続ボタンが無く、円アイコン色＋テキストで接続状態（未接続/接続中/接続済み/取得中/失敗）が一目で分かる。
- 既存の接続・取得・読み上げが退行なく動く（WS は窓内 1 本のまま・メイン窓 no-internet 維持）。
- `SettingsView` / `StatusIndicator` / `CommentList` に分割され、`CommentViewerApp` の見通しが改善している。
- 新しいライブラリ / Tauri command / capability を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。
- **security-review を通過**している。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 歯車で設定ビュー切替／接続・取得が設定側で完結／本体の状態インジケータ／退行なしを目視
# no-internet 確認（既存方針）: lsof -i で外部 ESTABLISHED が sidecar PID 下のみで main 本体 PID に出ないこと
```

## 実装後に必要なレビュー

- security-review（[`.claude` の security-review スキル](../security.md) 準拠）: 本タスクは capability・宛先・依存を
  変更しない想定だが、接続 UX の作り替えで **①複数 WS 接続を張っていないか ②設定をメイン窓へ漏らしていないか
  ③新規 command/capability を足していないか** を確認する。
