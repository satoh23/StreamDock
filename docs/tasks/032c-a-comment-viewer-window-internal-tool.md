# 032c-a コメビュ別ウィンドウ枠組み ＋ 内蔵デフォルトツール ＋ 032b 撤去

> 状態: **未着手（実装サブタスク）**。本ファイルは [032c（親設計・方針転換の正）](032c-comment-viewer-voicevox-design.md)
> の「## 実装タスクへの分割」032c-a 節と「### 032b の撤去範囲」節を distill したもの。**スコープ・残す/消す
> の線引きは 032c を正とする**。
>
> **必読前提**: [032c（親設計）](032c-comment-viewer-voicevox-design.md) と `docs/security.md` を読むこと。
> 032c は 032b（棒読みちゃん×VOICEVOX 連携）を目的について supersede し、棒読み / SAPI 経路を撤去する
> （**その撤去を実施するのが本タスク**）。CLAUDE.md どおり「実装して」と言われるまでコードは変更せず、
> まず変更計画と対象ファイルを提示すること。

## 目的

内蔵コメントビューアを **別ウィンドウ（label `comment-viewer`）として開く枠組み**と、それを **内蔵デフォルト
ツール（`ToolKind::Internal`）としてツール管理／プリセットに組み込める**状態を用意する。あわせて、方針転換で
不要になった **032b の棒読みちゃん / SAPI 依存部分を撤去**し、docs を整理する。

本タスクは **frontend / Rust のウィンドウ配管＋内蔵ツール seed＋032b 撤去**に限定し、**ネットワーク通信を
一切含まない**（Twitch/YouTube 取得・Node sidecar・VOICEVOX 合成 API・Web Audio・OAuth はすべて
**032c-b / -c / -d**）。**mac 開発機で完結して E2E 検証できる**範囲。コメントは**モック `CommentViewDto`**
のみを描画する。実装全体像は [032c](032c-comment-viewer-voicevox-design.md) を正とする。

## 現在の前提（調査結果）

- ウィンドウは `main` 1 枚のみ。`apps/desktop/src-tauri/tauri.conf.json` の `app.windows` は label 省略＝
  既定 `main`。`apps/desktop/src-tauri/capabilities/default.json` は `"windows": ["main"]`。
- `apps/desktop/src-tauri/src/lib.rs`：`use tauri::Manager` 既存、`get_webview_window("main")` は setup 内
  1 箇所、`host_os` は同ファイル内の inline `#[tauri::command]`（新コマンドの雛形になる）。`invoke_handler`
  は 1 リストに集約。
- `apps/desktop/src-tauri/src/tools/model.rs`：`ToolKind { Executable, Url }`（`serde(rename_all="lowercase")`・
  TS export）。`as_str` と `from_str_lenient`（未知値は `_ => Executable` へ丸め＝前方互換）。DB 文字列
  マッピングは `apps/desktop/src-tauri/src/tools/repository.rs`。
- launch dispatch は **2 箇所**（`process/service.rs::launch_one` と `process/commands.rs::launch_tool`）で
  「`Url → open_url` ／ それ以外 → `spawn`」。`spawn` は先頭で `validate_executable`（`path.exists()` を含む）
  を呼ぶ。
- ツールの seed / migration 基盤は無い。`tools/repository::init` が `CREATE TABLE IF NOT EXISTS` ＋
  `util::ensure_column` の冪等スキーマを毎起動実行。partial unique index は `kind='executable'` のみ対象
  （`internal` 行は `executable_path` 空で衝突しない）。
- frontend にウィンドウラベル分岐は未存在。`getCurrentWindow()` は `components/Header.tsx` のタイトルバー
  操作のみ。`main.tsx` → `App.tsx` を無条件描画。
- `bouyomi-voicevox` は Rust `rakuraku::service::registry()` と TS `INTEGRATION_REGISTRY` の**唯一の
  integration**。`Cargo.toml`（windows target）の `ureq` と `windows` crate の `Win32_System_Registry`
  feature は **`bouyomi_voicevox.rs` のみが利用**＝同ファイル削除後は未使用になる。

## このタスクでやること

### (1) コメビュ別ウィンドウ枠組み

- `lib.rs` に `open_comment_viewer_window`（`WebviewWindowBuilder`／label `comment-viewer`／**単一
  インスタンスガード**＝`get_webview_window("comment-viewer")` が既存なら `set_focus`、無ければ生成）を追加し
  `invoke_handler` に登録。
- `capabilities/comment-viewer.json` を新設（`"windows": ["comment-viewer"]` ＋ **最小権限**。`core:default`
  と、カスタムタイトルバーを再利用する場合の window 操作程度に限定）。**`default.json` / `main` の capability は
  不変**。
- `App.tsx` で `getCurrentWindow().label` によりラベル分岐描画（`MainWindowApp` / `CommentViewerApp`・
  同一 Vite バンドル）。既存の `App` 本体は `MainWindowApp` 側になる。

### (2) 内蔵デフォルトツール（`ToolKind::Internal`）

- `model.rs` に `Internal` を新設：`as_str` に `ToolKind::Internal => "internal"`、`from_str_lenient` に
  `"internal" => ToolKind::Internal` を追加。**`_ => Executable` フォールバックは維持**（古い DB / 省略時の
  後方互換）。TS binding を再生成。
- 固定 id `builtin-comment-viewer` で `tools::repository::init` にて**冪等 seed**（`INSERT ... ON CONFLICT(id)
  DO NOTHING` 相当。`kind='internal'`・`executable_path` 空・`url` NULL）。
- launch dispatch を **両経路**（`service.rs::launch_one` / `commands.rs::launch_tool`）で `Internal` 分岐を
  `spawn` catch-all の**前**に追加：`Internal → open_comment_viewer_window`／**`validate_executable` は
  skip**／PID registry には登録しない（`url` と同様）。
- UI semantics：**削除不可・コア項目（name/kind/id）編集不可・「内蔵」バッジ表示**。preset_items から参照可
  ＝プリセット組込対象。

### (3) モックコメント描画

- `CommentViewerApp` で **frontend 専用モック `CommentViewDto`** を最小描画（append ＋ **id 重複排除** ＋
  **上限クランプ**）。実データ取得（Twitch/YouTube・sidecar・WS）は **032c-b / -d**。Rust 側の
  `CommentViewDto` binding・イベント配線は本タスクでは作らない。

### (4) 032b 撤去（設計どおり・下記「## 032b 撤去スコープ」を実施）

### (5) docs 整理

- `docs/security.md` / `docs/product.md` の 032b 用記述を撤去に合わせ整理（削除 or「032c で supersede」注記）。
  **外部通信の新規解禁追記はしない**（それは 032c-b の security-review 付き作業）。

## 032b 撤去スコープ（032c を正とする）

### 削除

- **Rust**：`apps/desktop/src-tauri/src/rakuraku/integrations/bouyomi_voicevox.rs` 全体／
  `integrations/mod.rs` の `pub mod bouyomi_voicevox;`／`service.rs` の `use ...BouyomiVoicevox` と
  `registry()` エントリ（→ 空 `vec![]`）／`commands.rs` の `rakuraku_configure_integration` /
  `rakuraku_verify_integration` と `lib.rs` の登録行／configure・verify に紐づく bouyomi 固有 model 型・
  trait メソッド（bindings drift を最小化して整理）。
- **frontend**：`features/rakuraku/integrationRegistry.ts` の `bouyomi-voicevox` エントリ（→ `[]`）／
  `screens/rakuraku-tools/RakurakuToolsScreen.tsx` の `ExecutionView` 棒読み実行経路／
  `features/rakuraku/rakurakuApi.ts` の configure / verify ラッパ。

### 条件付き削除

- `Cargo.toml` の `ureq`（＋解説コメント）と `windows` crate の `Win32_System_Registry` feature。
  **いずれも `bouyomi_voicevox.rs` が唯一の利用者**であり、同ファイル削除後は未使用になる。設計の条件
  「他に用途が残らないか要確認」に従い、**削除前に grep で他用途ゼロを最終確認**してから外す。

### 残す（撤去対象外）

- `rakuraku` vertical slice（`Integration` trait 骨格・`find` / `resolve_tool_for_component`・
  `rakuraku_scan_integration` / `rakuraku_launch_component` / `rakuraku_open_official_page` コマンドと登録）。
- `process::service::spawn` ＋ PID registry・`open_url` / `open_official_page`・`validate_executable_path`。
- らくらくツール設定 **画面シェル（032a）**＝一覧 / 詳細 / 同意（`ListView` / `DetailView` / `ConsentView`）。
- これらは **VOICEVOX 起動誘導・らくらく一覧・内蔵コメビュ露出に再利用**する。撤去は棒読み / SAPI 依存部分に
  限定する。

## このタスクでやらないこと

- Twitch / YouTube コメント取得・Node sidecar（externalBin）・VOICEVOX 合成 API・TTS キュー・Web Audio・
  OAuth（すべて **032c-b / -c / -d**）。
- `main` window の capability 変更（不変に保つ）。
- `rakuraku` slice／spawn ＋ PID registry／`open_url`／らくらく画面シェル（032a）の撤去（**残す**）。
- `docs/security.md` への外部通信「解禁」追記（それは 032c-b）。本タスクは 032b 記述の撤去 / supersede
  整理のみ。
- osareview のリッチ機能移植・TTS 高度化・話者選択 UI。

## セキュリティ制約（docs/security.md 準拠）

- 新規の外部通信・OS 操作・ファイル書換は追加しない（§1 / §2 / §4 / §5）。ウィンドウ生成は Tauri
  capabilities（`comment-viewer` は最小権限・`main` 不変）に閉じる。
- `internal` ツールはパス検証を skip するが **shell / spawn を伴わず、別ウィンドウを開くのみ**（§2 / §3）。
- **032b 撤去に伴い `docs/security.md` / `docs/product.md` 本文を触るため security-review 必須**。ただし
  撤去 / supersede 整理のみで、**外部通信の解禁追記は含めない**。

## 完了条件

- 別ウィンドウが開き mock コメントが描画される（append ＋ 重複排除 ＋ 上限クランプ）。
- 内蔵コメビュが `ToolKind::Internal` の既定ツールとして冪等 seed され、プリセット組込可・`internal` は
  パス検証 skip で起動でき、削除不可 / コア編集不可になっている。
- 032b の棒読み / SAPI 依存（`bouyomi_voicevox.rs`・configure / verify コマンド・`integrationRegistry`
  エントリ・`ExecutionView` 実行経路・`ureq` / `Win32_System_Registry`）が撤去され、共有部（spawn ＋ PID
  registry・`open_url` / `open_official_page`・`rakuraku` slice・らくらく画面シェル）は温存されている。
- `docs/security.md` / `docs/product.md` の 032b 記述が整理（削除 or supersede 注記）され、**security-review
  を通過**している。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が pass。Rust↔TS bindings drift ゼロ
  （`pnpm gen:bindings`）。既存機能（ツール起動 / 停止・プリセット CRUD・らくらく画面シェル）に退行がない。
- `docs/progress.md` が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm gen:bindings && git diff --stat        # bindings drift ゼロ確認
pnpm --filter ./apps/desktop tauri dev      # 別窓＋mock 描画／内蔵ツールのプリセット組込＋internal 起動／既存機能の退行を目視確認
```

## 段階分割（実装は「実装して」後・2 コミット）

1. **コミット1: 032b 撤去 ＋ docs 整理**（新規追加と混ぜず退行を切り分ける）。docs 差分に security-review を
   適用。`cargo check` / typecheck / lint / `gen:bindings` drift 確認。空 registry でらくらく画面が
   クラッシュしないことを確認。
2. **コミット2: 別窓枠組み ＋ 内蔵ツール ＋ モック描画**。`open_comment_viewer_window` ＋
   `capabilities/comment-viewer.json` ／ `ToolKind::Internal` ＋ 冪等 seed ＋ launch dispatch 分岐 ／
   `App.tsx` ラベル分岐 ＋ `CommentViewerApp` モック描画 ＋ ツール管理の internal ガード。binding 再生成を
   同梱。`pnpm tauri dev` で E2E 確認。
