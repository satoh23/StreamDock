# 033e ツール管理でコメビュを再生/停止・起動済み表示（他ツールと統一）

> 状態: **未着手（実装サブタスク・033a〜d と独立／並行可）**。分割・線引きは親 [033](033-comment-viewer-ux-revamp.md) を正とする。
>
> **必読前提**: 親 [033](033-comment-viewer-ux-revamp.md)、[`docs/security.md`](../security.md)（特に §6 プロセス停止・
> 「## Tauri Permissions / Capabilities 方針」）、[032c-a](032c-a-comment-viewer-window-internal-tool.md)（`ToolKind::Internal`
> の設計・「別窓を開くだけで PID 管理外」の根拠）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と
> 対象ファイルを提示する**。**窓/プロセスのライフサイクルに触れるため security-review 必須**。

## 目的

ツール管理画面（`MainScreen`）で、内蔵コメントビューアを**他ツールと同じ表示**にする。現状の「開く」ボタン 1 個
（状態非依存）を、**未起動＝再生（起動）ボタン / 起動中＝停止ボタン＋「起動済み」表示**に変える。コメビュ窓は PID
プロセスではなく Tauri ウィンドウなので、**窓の開閉状態から起動済みを導出**する（PID registry には載せない）。

## 現在の前提（調査結果）

- コメビュは `ToolKind::Internal` の内蔵ツール（固定 id `builtin-comment-viewer`・
  [`repository.rs:39-49`](../../apps/desktop/src-tauri/src/tools/repository.rs#L39-L49) で冪等 seed）。
- 起動 dispatch: [`process/commands.rs:126-159`](../../apps/desktop/src-tauri/src/process/commands.rs#L126-L159) で
  `Internal` を検知し `crate::open_comment_viewer_window(app)` を呼ぶ（`launch_id=""`・`process_id=0`＝**PID 管理外**）。
  `service.rs::launch_one` にも同等分岐（`service.rs:826` 付近）。
- 窓生成/前面化/単一インスタンスガードと、**窓を閉じたら sidecar 停止**する窓イベントは
  [`lib.rs:38-73`](../../apps/desktop/src-tauri/src/lib.rs#L38-L73)（特に `CloseRequested|Destroyed → comment_sidecar::shutdown`・64-71）。
  窓の存在は `app.get_webview_window("comment-viewer")` で判定できる（`.is_some()`）。
- UI: [`ToolRow.tsx:118-127`](../../apps/desktop/src/screens/main/ToolRow.tsx#L118-L127) の `internal` 分岐は state に
  依らず「開く」ボタン（`OpenIcon`）のみ。status 列は「内蔵」バッジ（`72-73`）。`executable` は
  `running|launched → 開く＋停止`、`starting|stopping → Spinner`、それ以外 → 起動（`128-158`）。
- `MainScreen`: 状態は `useState<RuntimeItem[]>`（`MainScreen.tsx:119`）。`reconcile()`（161-203）が
  `listRuntimeProcesses()`（Rust registry スナップショット）と突合して約 4 秒ポーリング（207-212）。
  `isActiveRow`（231-232 付近）が `kind !== "url" && kind !== "internal"` で**internal を起動済みカウント/一括対象から除外**。
  `onOpen` は `internal`/`url` を `handleOpenUrl(toolId)` に振り分け（700-705）、`handleOpenUrl`（298-308）が `launchTool(toolId)`。
- ツール状態型 `ToolState`（[`types.ts:11-18`](../../apps/desktop/src/types.ts#L11-L18)）: `running|starting|launched|stopping|waiting|stopped|error`。

## このタスクでやること

### (1) Rust: 窓の開閉を扱うコマンド追加（最小権限）

- **停止**: `close_comment_viewer_window`（`get_webview_window("comment-viewer")` があれば `.close()`）。`.close()` は
  既存の `CloseRequested|Destroyed` イベント経由で **sidecar shutdown も連動**する（`lib.rs:64-71`）。冪等（無ければ no-op）。
- **状態取得**: コメビュ窓が開いているかを返す読み取り専用手段。単純には `is_comment_viewer_open`
  （`= get_webview_window("comment-viewer").is_some()`）を新設。あるいは既存 `listRuntimeProcesses` の結果に
  `internal` の窓状態を合成する方式でもよい（実装時に、reconcile の呼び出し回数を増やさない形を選ぶ）。
- 両コマンドを `invoke_handler` に登録。**PID kill は行わない**（自アプリの窓 close のみ）。

### (2) frontend: ToolRow の internal 分岐を state 依存へ

- [`ToolRow.tsx:118-127`](../../apps/desktop/src/screens/main/ToolRow.tsx#L118-L127) を、`executable` の
  `running|launched` 分岐（128-144）に倣って **窓オープン中＝停止ボタン（＋前面化の「開く」）／閉＝再生（起動）ボタン**へ。
- status 列: 起動中は他ツールと同じ「起動済み」相当の表示にする（「内蔵」バッジは残すか置換するかを実装時に統一。
  他ツールと**見た目を揃える**のが目的）。

### (3) frontend: MainScreen が internal の窓状態を反映

- `reconcile()`（161-203）で、(1) の窓状態取得を用いて `internal` 行の `state` を導出（開＝`launched`/`running` 相当、
  閉＝`stopped`）。`launchedCount`（571-573）・`isActiveRow`（231-232）から **internal を除外している条件を見直し**、
  コメビュを起動済みカウント等に含める（一括起動/一括停止の対象にするかは実装時に判断＝安全側なら個別のみ）。
- 停止ボタンの `onStop` を internal 用に `close_comment_viewer_window` へ配線（既存 `handleStop` は PID 停止用のため、
  internal 用の close 経路を用意）。起動は既存 `handleOpenUrl→launchTool`（＝`open_comment_viewer_window`）を再利用。

## このタスクでやらないこと

- internal を **PID registry で管理**する変更（窓開閉から導出する・PID kill しない）。
- コメビュ以外の internal ツール追加・`ToolKind` の拡張。
- 一括起動/一括停止（008/014）の仕様変更（internal を一括対象に**含めるかは最小限**にとどめ、まず個別の再生/停止を優先）。
- コメビュ本体 UI（033a〜d）・OBS（033f）。

## セキュリティ制約（docs/security.md 準拠・重点 §6 / §3 / Capabilities 方針）

- 追加コマンドは **自アプリのウィンドウ open/close/存在確認のみ**で、**PID を kill しない・プロセス名で kill しない**
  （§6 は「stream-dock が起動した PID の停止」に限定するが、コメビュは PID プロセスでなくウィンドウ＝§6 の PID kill は
  そもそも発生しない）。close に伴う sidecar 停止は既存の窓イベント経路（032c-b で導入済み）を踏襲。
- コマンドは**単一目的の最小権限**（`close_comment_viewer_window` / `is_comment_viewer_open`）。汎用強権
  （任意ラベルの窓操作）にしない（§3）。`open_comment_viewer_window` の既存挙動は変更しない。
- 新規 capability を広げない（自窓 close は Rust `WebviewWindow::close` で IPC ACL 追加不要。実装時に要確認）。
  `csp: null` 不変・新規依存なし・新規外部通信なし（§1/§10）。
- **窓/プロセスのライフサイクルに触れるため security-review 必須**（親 033 の表に準拠）。

## 完了条件

- ツール管理でコメビュが、未起動＝再生ボタン／起動中＝停止ボタン＋「起動済み」表示になり、他ツールと表示が揃う。
- 再生でコメビュ窓が開き、停止で窓が閉じ（sidecar も連動停止）、窓状態が reconcile で正しく反映される。
- 窓を直接閉じた場合もツール管理側の表示が「未起動」に戻る（reconcile ポーリングで追従）。
- PID registry を使わず窓開閉から導出しており、他ツールの起動/停止・一括起動/停止に退行がない。
- 新規コマンドは最小権限で、PID kill を行わない。新規 capability/依存/外部通信を増やしていない。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が通る。Rust↔TS bindings drift ゼロ
  （`pnpm gen:bindings`・新規型を足す場合）。
- **security-review を通過**している。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm gen:bindings && git diff --stat        # bindings drift ゼロ確認（新規型を足した場合）
pnpm --filter ./apps/desktop tauri dev      # 再生→窓オープン＋起動済み表示／停止→窓クローズ＋sidecar停止／直接クローズの追従／他ツール退行なしを目視
```

## 実装後に必要なレビュー

- security-review: 追加コマンドが**自窓の open/close/存在確認に限定**され、PID kill・プロセス名 kill・任意ラベル窓操作を
  含まないこと、close に伴う sidecar 停止が既存経路（032c-b）どおりであること、capability を広げていないことを確認。
