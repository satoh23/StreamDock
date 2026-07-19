# 034d OBSオーバーレイ表示 ON/OFF を設定ビューへ移設＋開閉状態インジケータ

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [034](034-comment-viewer-obs-ux-round2.md) を正とする。
>
> **必読前提**: 親 [034](034-comment-viewer-obs-ux-round2.md)、第1弾 [033b](033b-settings-view-connection.md)（設定ビュー）・
> [033f](033f-obs-transparent-overlay.md)（オーバーレイ窓・no-orphan kill をコメビュ窓に集約）、[`docs/security.md`](../security.md)
> （特に「## Tauri Permissions / Capabilities 方針」）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と
> 対象ファイルを提示する**。**Rust command を 1 つ追加する（読み取り専用）ため security-review を軽く通す**。

## 目的

OBS オーバーレイの開閉操作を**コメビュ本体ツールバーから設定ビューへ移設**し、**現在オーバーレイが開いているか閉じているかが
一目で分かる 1 つのトグル**（active 配色＋`aria-pressed`）に置き換える。**要望1（状態が分からない）・要望4（設定画面へ移設）**を満たす。

## 現在の前提（調査結果）

- 開閉ボタンは本体ツールバー [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)
  470-489行に**2 つ**（「OBS オーバーレイ」を開く `handleOpenOverlay`（416-418行）／「閉じる」`handleCloseOverlay`
  （422-424行））。どちらも `className={styles.btnGhost}` のみで、**開閉状態を表す配色/`aria-pressed` が無い**。
- **開閉状態を保持する state が無い**のが「グレーのまま分からない」の根因。`streamConnected` 等はあるがオーバーレイ開閉の追跡は無い。
- 窓生成/破棄は Rust: `open_comment_overlay_window`（[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) 91-123行）／
  `close_comment_overlay_window`（130-138行）。**窓の存在確認コマンド（`is_comment_overlay_open` 相当）は未提供**。
  コメビュ窓には `is_comment_viewer_open` 相当の作法があり手本にできる（同 `lib.rs`）。
- フロントのラッパは [`windowApi.ts`](../../apps/desktop/src/features/comment-viewer/windowApi.ts)
  `openCommentOverlayWindow()`（38-40行）/ `closeCommentOverlayWindow()`（47-49行）。
- 設定ビューは [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)（接続・VOICEVOX 設定）。
  オーバーレイ設定の節は無い。
- capability は per-window `comment-overlay.json`（`core:default` 最小権限）。

## このタスクでやること

### (1) 開閉状態を知る（読み取り専用 Rust command）

- [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) に**読み取り専用コマンド `is_comment_overlay_open`** を追加
  （`app.get_webview_window("comment-overlay").is_some()` を返すだけ・`is_comment_viewer_open` を手本）。`invoke_handler` に登録。
- [`windowApi.ts`](../../apps/desktop/src/features/comment-viewer/windowApi.ts) に `isCommentOverlayOpen()` ラッパを追加。

### (2) オーバーレイの開閉操作を設定ビューへ移設＋状態トグル

- 本体ツールバーの 2 ボタン（470-489行）を撤去し、**設定ビューにオーバーレイ節を新設**して**1 つのトグル**に統合
  （ON=開く/OFF=閉じる）。トグルは**現在の開閉状態を配色と `aria-pressed` で明示**（例: 開＝アクティブ配色/閉＝グレー）。
- `CommentViewerApp` に開閉状態 state（例 `overlayOpen: boolean`）を持たせ、①初期化時 `isCommentOverlayOpen()` で同期、
  ②開閉操作後に更新、③**オーバーレイ窓の close イベントを購読**して外部（窓の×ボタン等）で閉じられた場合も state を戻す。
- オーバーレイ節は 034e が**サイト名トグル等のデザイン設定を隣に足す**土台になる（親 034 の依存）。

## このタスクでやらないこと

- **オーバーレイのデザイン刷新・サイト名トグル（034e）**。本タスクは開閉操作の移設と状態表示に限定。
- **no-orphan kill 契機の変更**（オーバーレイ close で sidecar を落とさない現行を維持・033f）。sidecar 起動/停止契機は
  コメビュ窓イベントに集約したまま。
- 新規 capability の追加・`comment-overlay.json` の権限拡張（追加するのは読み取り専用の 1 コマンドのみ）。
- コメビュ本体の追従（034a）・オーバーレイ追従/サイドバー（034b）・VOICEVOX 試聴（034c）。

## セキュリティ制約（docs/security.md 準拠・重点 Capabilities 方針）

- 追加する `is_comment_overlay_open` は**読み取り専用**（窓の存在を bool で返すのみ・OS 操作/プロセス操作/外部通信を伴わない）。
  **宛先・capability・依存を増やさない**。`main`/`comment-viewer`/`comment-overlay` の capability は不変・`csp: null` 不変。
- オーバーレイは表示専用のまま（本タスクは開閉トグルの置き換えで、オーバーレイ側の通信面は変えない・§1 /「方針②」）。
- **Rust command を 1 つ追加するため security-review を軽く通す**（読み取り専用・capability 不変・窓ライフサイクル/no-orphan
  kill を壊していないことの確認）。

## 完了条件

- 本体ツールバーからオーバーレイ開閉ボタンが無くなり、設定ビューのオーバーレイ節にトグルが 1 つある。
- トグルが現在の開閉状態を配色＋`aria-pressed` で示し、開く/閉じるで状態が更新される。
- 窓の×ボタン等で外部から閉じても、close イベント購読で state（トグル表示）が正しく戻る。
- オーバーレイの close で sidecar が落ちない（no-orphan kill 契機を壊していない）。
- 追加した Tauri command は読み取り専用の 1 つのみで、capability/依存を増やしていない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が通る。
- **security-review を通過**している。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter ./apps/desktop tauri dev   # 設定のトグルで開閉／状態が配色で分かる／×で閉じても state 復帰／close で sidecar が落ちないを目視
```

## 実装後に必要なレビュー

- security-review: 追加コマンド `is_comment_overlay_open` が**読み取り専用**で `main`/`comment-viewer`/`comment-overlay`
  の capability を広げていないこと、オーバーレイが表示専用のままで新規通信面・依存が無いこと、**no-orphan kill 契機
  （オーバーレイ close で sidecar を落とさない）を壊していない**ことを確認。
