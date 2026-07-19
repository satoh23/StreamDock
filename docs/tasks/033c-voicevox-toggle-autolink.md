# 033c VOICEVOX 読み上げトグル＋クレジット条件表示＋自動起動/自動連携

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [033](033-comment-viewer-ux-revamp.md) を正とする。
>
> **必読前提**: 親 [033](033-comment-viewer-ux-revamp.md)、[`docs/security.md`](../security.md)（特に §1「例外
> （032c-c）」＝VOICEVOX ローカル合成のループバック `127.0.0.1:50021`）、先行 [033b](033b-settings-view-connection.md)
> （本タスクは設定ビューの存在を前提にトグルを置く）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と
> 対象ファイルを提示する**。

## 目的

VOICEVOX 読み上げを **ON/OFF できるトグル**にし（全員がずんだもんで読ませたい訳ではない）、**ON のときだけ
読み上げ・ON のときだけクレジット表記**を出す。加えて、**VOICEVOX 自動連携トグル**（ON でコメビュ立ち上げ時に
VOICEVOX を自動起動）を設定へ追加する。読み上げ ON かつ ENGINE 未起動時も自動起動する。VOICEVOX の起動は
**既存の `launch_voicevox_engine` 経路をそのまま再利用**し、新規 OS 操作・依存は増やさない。

## 現在の前提（調査結果）

- 読み上げは**常時 ON**で挿入される: 新規コメントは `enqueueForSpeech`
  （[`CommentViewerApp.tsx:189-194`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L189-L194)）
  が単一注入点で、`onComments`（205-210）から呼ばれる。実体は
  [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の直列 TTS キュー（話者は 033d 対象）。
- ENGINE 稼働は `GET /version` を 5 秒ポーリング（`279-291`、`checkEngineRunning`）。未起動時に**起動バナー**
  （`489-506`）を表示し、`handleLaunch`（309-328）が `launchVoicevoxEngine()`
  （[`voicevoxApi.ts`](../../apps/desktop/src/features/comment-viewer/voicevoxApi.ts) → Rust `launch_voicevox_engine`）を呼ぶ。
  多重 spawn 抑止に `launchRequested`（148）＋猶予 `LAUNCH_GRACE_MS`（301-305）。
- Rust `launch_voicevox_engine`（[`lib.rs:89-121`](../../apps/desktop/src-tauri/src/lib.rs#L89-L121)）は**登録済みツールを
  exe 名一致で解決して管理付き spawn**（未登録なら `launched=false` で登録誘導）。絶対パス直起動しない。
- クレジット表記 `CREDIT_NOTICE`（41-42）を常時表示（`529-532`）。
- 非機密 UI 値の永続化は localStorage 方式（[`channelStorage.ts`](../../apps/desktop/src/features/comment-viewer/channelStorage.ts)・
  テーマも同方式）。

## このタスクでやること

### (1) VOICEVOX 読み上げ ON/OFF トグル

- 設定ビュー（033b）に読み上げトグルを追加。**既定 OFF**。localStorage 永続化（`channelStorage.ts` に倣った
  小さな `ttsPrefs` ストレージを新設、または既存 storage を拡張）。
- `enqueueForSpeech`（189-194）を**トグル ON のときだけ enqueue** するようゲート（OFF 時は何もしない）。既存の
  id 冪等・resume の扱いは踏襲。
- ラベルは最初から **「VOICEVOX読み上げ」**（033d の改名を先取りして手戻りを避ける・親 033 方針）。

### (2) 読み上げ ON かつ ENGINE 未起動 → 自動起動

- トグルを ON にした時（または ON 状態で ENGINE 未起動を検知した時）、既存 `launchVoicevoxEngine()` を発火して
  自動起動する。`launchRequested`＋`LAUNCH_GRACE_MS` の多重 spawn ガードを再利用。未登録（`launched=false`）は
  既存の登録誘導文言を表示（誘導のみ・絶対パス直起動しない）。
- 既存の起動バナー（489-506）はトグル/自動起動導線と整合するよう整理（重複導線にしない）。

### (3) クレジット表記をトグル ON 時のみ・トグル直下に表示

- `CREDIT_NOTICE` の表示（529-532）を、**読み上げトグルが ON のときだけ・トグルの直下**に出す（設定ビュー内）。
  OFF 時は非表示。文言・URL は据え置き（静的テキスト・外部通信なし）。

### (4) VOICEVOX 自動連携トグル

- 設定ビューに**別トグル「VOICEVOX自動連携」**を追加（localStorage 永続化）。ON なら `CommentViewerApp` マウント時に
  `launchVoicevoxEngine()` を 1 回発火（`launchRequested` ガード共用）。
- (2)（読み上げ ON 契機）と (4)（窓オープン契機）は**独立トリガとして併存**してよい（両方 launch を呼んでも
  多重 spawn ガードで安全）。tasks 実装時に「両方 ON のときに二重発火しない」ことを確認。

## このタスクでやらないこと

- 話者選択・`GET /speakers`・「ずんだもん→VOICEVOX」文言の全面統一（**033d**）。本タスクは新規追加ラベルのみ
  「VOICEVOX読み上げ」にする。
- TTS キューの合成ロジック・話者 ID の変更（`ttsQueue.ts` の話者は 033d）。
- Rust `launch_voicevox_engine` の中身変更（呼び出しの契機を増やすだけ・引数/経路は不変）。
- 設定ビュー自体の新設（**033b**）・接続 UI・ツール管理・OBS。

## セキュリティ制約（docs/security.md 準拠・重点 §1 例外(032c-c) / §6 / §10）

- VOICEVOX 通信はループバック `127.0.0.1:50021`（合成＋ローカル再生）に限定（§1 例外 032c-c）。**本タスクは
  読み上げの ON/OFF ゲートと起動契機の追加のみ**で、宛先・許可メソッド（`/version`・`/audio_query`・`/synthesis`）を
  変えない（`/speakers` 追加は 033d）。
- ENGINE 起動は**既存 `launch_voicevox_engine`（登録済みツールを exe 名一致で管理付き spawn・PID registry 登録）**の
  再利用のみ。**絶対パス直起動・shell 経由・新規 spawn 面を作らない**（§4/§6）。frontend は raw パス/ポートを渡さない。
- 新規 Tauri command / capability / 依存を追加しない（§3/§10）。永続化はローカル localStorage の非機密値のみ（§5）。
- **既存の起動処理を新しく呼ぶだけでプロセス起動処理自体は変更しない**ため security-review は不要（親 033 の表に準拠）。
  ただし自動起動の契機が増えるため、tasks 実装時に多重 spawn ガードの健全性を確認する。

## 完了条件

- 読み上げトグル（既定 OFF）で ON/OFF でき、ON のときだけコメントが読み上げられる。
- 読み上げトグル ON かつ ENGINE 未起動で VOICEVOX が自動起動する（未登録は登録誘導）。多重 spawn しない。
- クレジット表記が読み上げトグル ON のときだけ・トグル直下に表示される。
- VOICEVOX 自動連携トグル ON で、コメビュ立ち上げ時に VOICEVOX が自動起動する。読み上げ ON との二重発火がない。
- 新規追加ラベルが「VOICEVOX読み上げ」になっている（全面改名は 033d）。
- 新しいライブラリ / Tauri command / capability を追加していない。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # トグル OFF で無音／ON で読み上げ＋クレジット表示／自動起動／自動連携／二重発火なしを目視
# ※ VOICEVOX 実起動・実読み上げの確認はローカルに VOICEVOX ENGINE 登録が必要
```
