# 042b 接続 UI をコメビュ本体へ・プラットフォーム別 展開カード化

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [042](042-stream-link-ux.md) を正とする。
>
> **必読前提**: 親 [042](042-stream-link-ux.md)、先行 [042a](042a-connect-wording-to-renkei.md)（文言は「連携」前提）、
> 反転元 [033b](033b-settings-view-connection.md)（接続 UI を設定ビューへ移設した経緯・`StatusIndicator` の設計）、
> [`docs/security.md`](../security.md)（特に §1 /「## コメントビューア（配信サービス連携）方針」＝**main 窓 no-internet・通信は sidecar/viewer に封じ込め**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**UI 再構成で誤って複数 WS を張らない/main へ通信を漏らさないの確認のため security-review を軽く通す**。

## 目的

配信接続の状態と操作を、コメビュ**本体**の**プラットフォーム別カード**に集約する（要望③）。YouTube と Twitch を**別々の枠付きカード**で表示し、
折りたたみ時は接続状態（円アイコン色＋テキスト）を、クリックで下に展開して **連携・配信接続・切断**を行えるようにする。033b が接続操作を設定ビューへ
移した設計を、本体カードへ**部分反転**する（安全設計＝窓内 WS 1 本・main no-internet は不変で踏襲）。

## 現在の前提（調査結果・実コード）

- コメビュ本体の状態表示は [`StatusIndicator.tsx`](../../apps/desktop/src/screens/comment-viewer/StatusIndicator.tsx)（Twitch / YouTube の 2 行・円＋テキスト）。
  状態導出 `deriveConnectionStatus`（56-61 行）・ラベル `STATUS_LABEL`（28-33 行）・dot 色クラス `STATUS_DOT_CLASS`（36-41 行）は**そのまま再利用**する。本体描画は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) のツールバー（688-720 行）で `<StatusIndicator … />`（689-692 行）を出している。
- 接続操作は現在**設定ビュー**の「接続」カード（[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 146-256 行）に集約:
  - **連携（OAuth リンク）** = Twitch 159 行 `handleTwitchConnect`／YouTube 222 行 `handleYouTubeConnect`。
  - **配信接続（取得開始）** = 「コメント取得開始」 Twitch 174 行 `handleStartSession`／YouTube 232 行 `handleYouTubeStartSession`。Twitch はチャンネル名入力あり。
  - **切断（停止）** = 「停止」 Twitch 182 行 `handleStopSession`／YouTube 240 行 `handleYouTubeStopSession`。
  - device code 提示（202 行付近）・状態テキスト（188-195 / 242-251 行）。
- ハンドラ本体は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) 456-485 行、制御フレームは [`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts) `startLogin`/`startSession`/`stopSession`（173-181 行）。state（`linked`/`youtubeLinked`/`sessionState`/`youtubeSessionState`/`deviceCode`/`channel` 等）はすべて `CommentViewerApp` ローカル。
- スタイルは CSS Modules＋役割トークン。カード意匠 [`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css) の `.card`/`.cardHead`/`.cardBody`（353-386 行）・`.connGrid`（389-395 行）、状態 dot 色（88-124 行）を再利用/拡張する。色は [`theme.css`](../../apps/desktop/src/styles/theme.css)。

## このタスクでやること

### (1) 本体にプラットフォーム別 展開カード（Twitch / YouTube）

- コメビュ本体（`view === "comment"`）に、Twitch カードと YouTube カードを**それぞれ枠付きカード**で置く（`StatusIndicator` の 2 行を 2 枚のカードへ置換）。
- **折りたたみ時**（カード頭）: 現行の**円アイコン色＋サービス名＋状態テキスト**（`deriveConnectionStatus`/`STATUS_LABEL`/`STATUS_DOT_CLASS` を再利用）。クリック（＋Enter/Space・`aria-expanded`）で展開/折りたたみ。
- **展開時**（カード本体）: そのサービスの **連携（`startLogin`）／配信接続＝取得開始（`startSession`）／切断＝停止（`stopSession`）** ボタン。Twitch はチャンネル名入力、device code 提示も同カード内に置く。連携済み/取得中で出し分け（既存の出し分け条件を踏襲）。
- 展開状態は `CommentViewerApp` のローカル state（例 `expanded: { twitch: boolean; youtube: boolean }`）。既存ハンドラ（456-485 行）と制御フレーム（173-181 行）を**そのまま**呼ぶ（新規追加しない）。

### (2) 設定ビューの「接続」カードを撤去（本体へ移設）

- [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の「接続」カード（146-256 行）を撤去し、操作を本体カードへ集約する（読み上げ VOICEVOX / OBS オーバーレイの節は残す）。歯車ボタン自体は残す（VOICEVOX/オーバーレイ設定のため）。
- state / ハンドラは `CommentViewerApp` に残したまま、本体カードへ props で渡す（**WS 接続は 1 箇所のまま**）。必要なら本体カード用の presentational コンポーネント（例 `ConnectionCard`）を `screens/comment-viewer/` に切り出す。

## このタスクでやらないこと

- 接続フロー（OAuth / Device Code / gRPC）・sidecar 側ロジック・制御フレームの仕様変更。
- 新規 WS・宛先・capability・依存の追加。設定を main 窓へ引き出すこと（方針違反）。
- 文言「接続」→「連携」の是正（**042a** 済み前提）。VOICEVOX / オーバーレイ設定節の変更。

## セキュリティ制約（docs/security.md 準拠・重点 §1 /「コメントビューア方針②」）

- **メイン窓 no-internet を維持**。接続 UI・sidecar WS はコメビュ窓に閉じたまま（本体へ移設しても main へは出さない）。
- **WS 接続は窓内 1 本のまま**（`connectCommentStream` の `useEffect` をカード化で二重化しない）。宛先 `ws://127.0.0.1:<port>` 不変。
- 新規 Tauri command / capability / 依存を追加しない（§3/§10）。`csp: null` 不変。取得コメント本文はログ/DB に出さない（既存踏襲）。
- **UI 再構成のため security-review を軽く通す**（①複数 WS を張っていないか ②main へ通信を漏らしていないか ③新規 command/capability を足していないか）。

## 完了条件

- コメビュ本体に Twitch / YouTube の**別々の枠付きカード**があり、折りたたみ時は状態（円色＋テキスト）、展開時に連携/配信接続/切断が完結する。
- 設定ビューから「接続」カードが無くなり、既存の連携・取得・停止・device code・状態表示が退行なく動く（**WS は窓内 1 本のまま・main 窓 no-internet 維持**）。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。
- **security-review（軽）を通過**している。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 本体で Twitch/YouTube カードの折りたたみ状態表示→クリック展開→連携/取得開始/停止／設定ビューに接続カードが無い／退行なしを目視
# no-internet 確認（既存方針）: lsof -i で外部 ESTABLISHED が sidecar PID 下のみで main 本体 PID に出ないこと
```

## 実装後に必要なレビュー

- security-review（軽）: 接続 UI を本体へ移しても **①複数 WS 接続を張っていない ②通信を main 窓へ漏らしていない ③新規 command/capability/依存を足していない** ことを確認する。
