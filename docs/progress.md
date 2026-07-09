# Progress

## 2026-07-05

### 完了

- Cursor課金
- Claude Max課金
- CursorとClaude連携
- プロダクト開発用ディレクトリ作成
- git初期化
- GitHub連携

### 次にやること

- AI用ルールファイル作成
- docs作成
- Tauri + React + TypeScript の雛形作成
- 最初のタスク作成

## 2026-07-05 (001 Project Setup)

### 完了したこと

- Tauri 2 + React + TypeScript (Vite) の雛形を pnpm で作成
- アプリ名を stream-dock に統一 (package.json / tauri.conf.json / Cargo.toml)
- ESLint (flat config) を導入し `pnpm lint` / `pnpm typecheck` スクリプトを追加
- README に必要要件・起動方法・検証コマンドを記載

### 変更した主要ファイル

- `package.json` — name=stream-dock、scripts に typecheck/lint 追加、ESLint 系 devDependencies 追加
- `eslint.config.js` — 新規。flat config (typescript-eslint + react-hooks + react-refresh)
- `src-tauri/tauri.conf.json` — productName / window title = stream-dock、identifier = com.tetsuya.stream-dock
- `src-tauri/Cargo.toml` — package name = stream-dock
- `README.md` — 要件・起動方法・検証コマンドを記載
- `docs/progress.md` — 本記録
- その他スキャフォールド生成物一式 (index.html / vite.config.ts / tsconfig*.json / src/ / src-tauri/)

### 現在のディレクトリ構成 (root 直下にフラット展開)

```
stream-dock/
├── package.json            # フロントエンド (root に存在)
├── pnpm-lock.yaml
├── eslint.config.js
├── index.html
├── vite.config.ts
├── tsconfig.json / tsconfig.node.json
├── public/                 # vite.svg / tauri.svg
├── src/                    # React (App.tsx / main.tsx / assets)
├── src-tauri/              # Rust / Tauri (Cargo.toml / src / capabilities / icons / gen)
├── README.md
├── CLAUDE.md
└── docs/                   # product / architecture / decisions / progress / task-board / tasks
```

### 検証結果

- `pnpm install` 成功
- `pnpm typecheck` 成功 (exit 0)
- `pnpm lint` 成功 (exit 0)
- `cargo check` 成功 (stream-dock v0.1.0 コンパイル完了)
- `pnpm tauri dev` 起動確認 (初期画面表示、確認後にプロセス停止)

### 未完了事項 (今回スコープ外)

- SQLite導入 / ツール登録 / プリセット / プロセス起動 / UI作り込み
- git commit は未実施 (生成物一式は未追跡のまま)
- 現状は root 直下にアプリ一式が展開されており、モノレポ構成になっていない

### 次にやるべきこと

- **【次回タスク】root 直下に作成された Tauri/Vite アプリ一式を `apps/desktop` 配下へ移動し、pnpm workspace 構成に直す**
  - `pnpm-workspace.yaml` を追加し `apps/*` を対象にする
  - root には workspace 管理用の package.json を置き、アプリ本体は `apps/desktop/` に集約
  - 移動対象: package.json / vite.config.ts / tsconfig / index.html / src / src-tauri / public / eslint.config.js 等
  - 移動後に `pnpm install` / `pnpm tauri dev` / typecheck / lint が通ることを再確認
- 上記モノレポ化が済んでから、ツール登録・プリセット・SQLite 等の機能実装タスクへ進む

## 2026-07-05 (モノレポ化: apps/desktop への集約)

### 完了したこと

- root 直下にフラット展開されていた Tauri/Vite アプリ一式を `apps/desktop/` 配下へ `git mv` で移動（履歴保持）
- root を pnpm workspace の管理用に切り替え
- 移動後に Tauri/Vite が root から起動できる状態を維持

### 移動したファイル (root → apps/desktop/)

- `package.json` / `vite.config.ts` / `tsconfig.json` / `tsconfig.node.json` / `index.html` / `eslint.config.js`
- `src/` / `src-tauri/` / `public/`
- いずれも設定は相対パスのみで成立するため **内容変更なし**（アプリ名 `stream-dock` も維持）

### 新規作成 / 変更したファイル

- `pnpm-workspace.yaml` — 新規。`packages: ["apps/*"]`
- `package.json` (root) — 新規。workspace 管理用（name=stream-dock-workspace / private）。各スクリプトは `pnpm --filter ./apps/desktop <script>` へ委譲
- `README.md` — ディレクトリ構成の追記、`cargo check` のパスを `apps/desktop/src-tauri` に修正
- `docs/progress.md` — 本記録

### 現在のディレクトリ構成 (モノレポ)

```
stream-dock/
├── package.json            # workspace 管理用
├── pnpm-workspace.yaml     # apps/* を対象
├── pnpm-lock.yaml
├── apps/
│   └── desktop/            # デスクトップアプリ全体
│       ├── package.json    # アプリ (name=stream-dock)
│       ├── vite.config.ts / tsconfig*.json / index.html / eslint.config.js
│       ├── src/            # React (App.tsx / main.tsx / assets)
│       ├── src-tauri/      # Rust / Tauri
│       └── public/
├── README.md
├── CLAUDE.md
└── docs/
```
※ `backend/` ディレクトリは MVP では作らない方針。

### 検証結果

- `pnpm install` 成功（workspace projects: 2 を検出しリンク）
- `pnpm typecheck` 成功 (exit 0)
- `pnpm lint` 成功 (exit 0)
- `cargo check` 成功（旧パスの stale キャッシュを `cargo clean` してから成功。stream-dock v0.1.0 コンパイル完了）
- `pnpm build` 成功（`apps/desktop/dist` を生成。tauri の `frontendDist: "../dist"` と整合）
- `pnpm tauri dev` 起動確認（root から実行。Rust ビルド完了 → `Running target/debug/stream-dock` を確認）

### 補足 (実装メモ)

- `git mv src-tauri` でディレクトリごと移動した際、未追跡の `target/`（旧絶対パスを含む Rust ビルド生成物）も一緒に移動し、初回 `cargo check` が旧パス参照で失敗した。`cargo clean` で解消。
- pnpm workspace 化に伴い root `node_modules` を削除して再 `pnpm install`（シンボリックリンク構成で貼り直し）。

### 次にやるべきこと

- モノレポ化が完了したため、ツール登録・プリセット・SQLite 等の機能実装タスクへ進む

## 2026-07-05 (003 App Shell)

### 完了したこと

- `docs/prototypes/` の3つのHTMLプロトタイプ（v15 / add-tool v10 / add-preset two-step）の見た目・画面構成を、`apps/desktop/src` 配下に **React + TypeScript** で移植（UIのみ）
- 3画面をローカル state で切り替え（`App` の `screen: 'main' | 'add-tool' | 'add-preset'`）
  - **メイン画面**: サイドバー / プリセット一覧 / 起動順リスト / 状態バッジ（起動済み・起動中・待機中・エラー）/ 編集モード / 一括起動
  - **ツール追加画面**: ドロップゾーン → 選択済みアプリ表示 / 表示名入力 / 登録先プリセット・追加位置 select / 追加後プレビュー
  - **プリセット追加画面**: 2ステップUI（Step1 ツール選択 / Step2 起動順・並行設定）+ 選択中/作成後プレビュー
- 仮の起動状態変更を React state で再現（個別 起動→起動中→(650ms)→起動済み / 停止、一括起動は番号順に逐次起動し全起動で「一括停止」へ反転、進捗テキスト `N / 10 起動済み`）
- 編集モードで ↑↓ 並べ替え・× 削除・保存/追加ボタン切替を再現
- add-preset の `syncLaunchItems`（選択と起動リストの突合・mode/順序保持）と `orderedIndexFor`（並行を番号に数えない連番）を純関数として実装

### 変更・作成した主要ファイル（`apps/desktop/src/`）

- 変更: `App.tsx`（Tauri雛形→画面ナビの親）/ `main.tsx`（`styles/theme.css` を import）/ `App.css` 削除
- 新規（共通）: `styles/theme.css`（デザイントークン + body背景）/ `types.ts` / `data/mockData.ts`
- 新規（コンポーネント）: `components/` = `Window` / `Sidebar` / `PreviewCard` / `primitives`（IconTile・OrderBadge・Chip・StatusBadge・Button・Spinner）+ 各 `*.module.css`
- 新規（画面）: `screens/main/`（MainScreen・ToolRow）/ `screens/add-tool/`（AddToolScreen）/ `screens/add-preset/`（AddPresetScreen）/ 共有 `screens/formLayout.module.css`
- CSSは **CSS Modules**、`:root` トークンのみグローバル。ウィンドウは 1280px固定・中央寄せ（プロトタイプ準拠）

### 検証結果

- `pnpm typecheck` 成功（exit 0）
- `pnpm lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build` 成功（46 modules、CSS Modules 解決 OK）
- `vite preview` で HTTP 200 応答を確認
- ※ GUI 表示（`pnpm tauri dev`）は表示環境が必要なため未実施。静的チェック + build + 配信確認までで検証。実機表示はユーザー確認をお願いしたい

### やっていないこと（今回スコープ外・据え置き）

- SQLite / Tauri command(invoke) / プロセス起動・停止 / 保存処理・永続化 / `src-tauri` 変更 / 実ファイル選択 / shadcn本格移行
- 「保存」「保存して追加」「保存して作成」等のボタンは画面遷移のみのダミー（実処理なし）

### 次にやるべきこと

- 004 以降で Tauri command / SQLite を導入し、ツール登録・プリセットCRUD・プロセス起動をこのUIシェルに接続する

---

## 引き継ぎ (2026-07-05 セッション終了時)

### 今回完了したこと

- **003 App Shell 完了**。3つのHTMLプロトタイプを React + TypeScript に移植（UIのみ）。メイン / ツール追加 / プリセット追加 の3画面をローカル state で切替。編集モード・仮の起動状態変更・一括起動・2ステップUI・プレビュー更新まで再現（詳細は上の「003 App Shell」節）。

### 変更した主要ファイル

- 変更: `apps/desktop/src/App.tsx`（画面ナビの親）/ `main.tsx`（`styles/theme.css` import）/ `App.css` 削除
- 新規: `apps/desktop/src/` 配下に `styles/theme.css`・`types.ts`・`data/mockData.ts`・`components/`（Window/Sidebar/PreviewCard/primitives）・`screens/`（main/add-tool/add-preset + formLayout.module.css）
- 変更: `docs/progress.md`（本記録）
- ※ **すべて未コミット**（git status: D App.css / M App.tsx,main.tsx,progress.md / ?? components,data,screens,styles,types.ts）。ブランチは `main`。コミットは指示があってから行う運用。

### まだ未完了のこと

- 全画面の「保存」「保存して追加」「保存して作成」ボタンは**画面遷移のみのダミー**（実処理なし）
- データは全て `data/mockData.ts` の仮データ。永続化なし（画面を離れると state リセット）
- `apps/desktop/src/assets/react.svg` は未使用のまま残置（無害）
- GUI実表示（`pnpm tauri dev`）はこの環境で未確認 → **次回セッション冒頭で一度起動して見た目を確認推奨**

### 次にやるべきタスク

- **004 Tool Registry**（ツール登録）。**注意: `docs/tasks/004-tool-registry.md` はまだ存在しない** → タスク定義ファイルの作成から始める。参照: `docs/architecture.md` の `ToolRegistryService` / Repository / SQLite 層、`docs/product.md`「ツールを登録できる」。
- 実装方針: OS操作・DB・プロセス系は Rust(`src-tauri`)側に寄せる（CLAUDE.md）。UIは既存の `AddToolScreen` / `Sidebar` のツール一覧を Tauri command に接続していく形。

### 既知のエラー

- なし（typecheck / lint / build いずれもクリーン、warning 0）

### 実行した確認コマンド

- `pnpm typecheck` → 成功
- `pnpm lint` → 成功（warning なし）
- `pnpm --filter ./apps/desktop build` → 成功（46 modules）
- `vite preview` + `curl` → HTTP 200
- ※ `cargo check` / `pnpm tauri dev` は今回 src-tauri 未変更のため未実施

### 次回セッションで最初に読むべきファイル

1. `docs/progress.md`（この引き継ぎ節）
2. `CLAUDE.md`（開発ルール／検証コマンド）
3. `docs/architecture.md`・`docs/product.md`（004 の設計根拠）
4. `apps/desktop/src/App.tsx` → `components/Sidebar.tsx` → `screens/add-tool/AddToolScreen.tsx`（UIシェルの接続点）
5. `apps/desktop/src/data/mockData.ts`・`types.ts`（今後DBに置き換える仮データ／型）

## 2026-07-05 (004 Tool Registry)

### 完了したこと

- 配信で使うPCツールを**登録・一覧・編集・削除・ローカル永続化**できるようにした（プロセス起動・停止・プリセット紐付けはスコープ外）
- 保存方式は **SQLite（rusqlite, bundled）** を採用。Rust 側に command / service / repository の3層を新設し、ロジックを service/repository に寄せた
- Tauri command 5本を実装: `create_tool` / `list_tools` / `get_tool` / `update_tool` / `delete_tool`（command は薄いラッパ、`Mutex<Connection>` を State 共有）
- 入力バリデーション（service）: 各文字列 trim / ツール名必須 / 実行ファイルパス必須 / **パス実在チェック（存在しなければ保存不可）** / `executablePath` 重複禁止（update は自分自身を除外）
- ネイティブ**ファイル選択ダイアログ**を導入（`tauri-plugin-dialog`）し、実行ファイルの実パスを取得
- React 側に `features/tools/`（API wrapper・型・ロード hook）を新設し、**各コンポーネントは invoke を直接呼ばず toolApi 経由**に統一
- 仮データ（`toolCatalog` ベースのサイドバー等）を撤去し、サイドバー／メイン画面のツール一覧を**登録済みデータ**表示に切替。サイドバーの各ツールに hover の[編集]/[削除]を追加（削除は確認ダイアログ→`delete_tool`、編集は AddToolScreen を編集モードで開き `update_tool`）

### 追加ライブラリ（理由）

- Rust: `rusqlite`(bundled=SQLite埋め込み・システム依存なし) / `uuid`(v4, id生成) / `chrono`(createdAt/updatedAt を RFC3339) / `tauri-plugin-dialog`(ファイル選択) / `ts-rs`(Rust の型定義から TS 型を自動生成し、Rust/React 間の型二重定義を防ぐ。`#[derive(TS)]` + `#[ts(export)]` で `src/features/tools/bindings/` へ出力)
- Frontend: `@tauri-apps/plugin-dialog`(上記ダイアログの JS API)

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: 新規 `src/error.rs`・`src/tools/{mod,model,repository,service,commands}.rs` / 変更 `src/lib.rs`(mod追加・dialog plugin・`.setup()`で app_data_dir に SQLite open→`repository::init`→`app.manage`・handler登録) / `Cargo.toml`(4クレート追加) / `capabilities/default.json`(`dialog:default` 追加)
- Frontend（`apps/desktop/src/`）: 新規 `features/tools/{types,toolApi,useTools,display}.ts` / 変更 `App.tsx`(useTools でロード・編集/削除ハンドラ配布・showToolList) `components/Sidebar.tsx`(+CSS, 実データ+編集/削除ボタン) `screens/add-tool/AddToolScreen.tsx`(+CSS, 実フォーム+ダイアログ+保存/更新+エラー表示+編集モード) `screens/main/MainScreen.tsx`(実データ由来のランタイム変換) `data/mockData.ts`(`initialTools`/`sampleSelectedApp` 撤去、`toolCatalog` 等はプリセット画面が利用中のため据え置き)

### 永続 Tool model / DB スキーマ

- API/JSON は camelCase: `id, name, executablePath, description, iconLabel, createdAt, updatedAt`
- `tools` テーブル（snake_case カラム、`executable_path` に UNIQUE index）。保存先 `~/Library/Application Support/com.tetsuya.stream-dock/stream-dock.db`

### 型 bindings と今後のメモ

- **型共有**: IPC 型は Rust を単一ソースとし、`ts-rs` で TS を自動生成する（手書きしない）。Rust の `model.rs` / `error.rs` を変更したら `pnpm --filter ./apps/desktop check:bindings` を実行し、再生成後に bindings 差分が出ない（整合している）ことを確認する。差分が出たら生成物をコミットする。
- **マイグレーション**: 現状スキーマ管理は `CREATE TABLE IF NOT EXISTS` のみ。単一テーブルの MVP では十分だが、テーブルが増える段で軽量な `rusqlite_migration` の導入を検討する（今回は未導入）。

### 検証結果

- `pnpm typecheck` 成功（exit 0）
- `pnpm lint` 成功（exit 0 / warning なし）
- `pnpm build`（tsc && vite build）成功（52 modules）
- `cargo check` 成功（rusqlite bundled 含めコンパイル完了）
- `pnpm tauri dev` 起動確認 → `.setup()` の DB 初期化がパニックせず起動。実機で**ファイル選択→ツール登録**を実行し、`stream-dock.db` の `tools` に UUID + RFC3339 付きで1件永続化されることを確認（パス実在チェック込みの E2E 成立）

### やっていないこと（今回スコープ外・据え置き）

- 実プロセス起動/停止・一括起動・起動状態監視・プリセット紐付け・起動順管理・`.lnk`/`.bat` 対応・アイコン自動抽出
- AddToolScreen の「登録先プリセット」「追加位置」select は 004 スコープ外のため**見た目維持の非機能表示**（保存に関与しない）
- メイン画面の起動状態表示は従来どおり**疑似シミュレーション**（実起動は未実装）
- git commit は未実施（指示があってから）

## 2026-07-06 (005 Preset CRUD)

### 完了したこと

- 配信プリセット（`id / name / description / createdAt / updatedAt`）を**作成・一覧・詳細取得・編集・削除・ローカル永続化**できるようにした（ツール紐付け・起動順・並行・プロセス起動はスコープ外＝006以降）
- 004 Tool Registry の実装パターンをそのまま踏襲。Rust 側に `presets/` モジュール（command / service / repository の3層）を新設し、ロジックを service/repository に寄せた
- Tauri command 5本を実装: `create_preset` / `list_presets` / `get_preset` / `update_preset` / `delete_preset`（command は薄いラッパ。DB は 004 と同じ `Mutex<Connection>` State を共有＝`tools::commands::DbState` を流用し、同一 `stream-dock.db` に `presets` テーブルを追加）
- 入力バリデーション（service）: name/description を trim / プリセット名必須 / 制御文字禁止 / **同名重複禁止**（update は自分自身を除外）。frontend だけでなく Rust 側でも検証
- React 側に `features/presets/`（`presetApi` / `usePresets` / `types`）を新設し、**各コンポーネントは invoke を直接呼ばず presetApi 経由**に統一。エラー整形は Tool と共通の `toErrorMessage` を再利用
- サイドバーのプリセット一覧を仮データ（`mockData.presets`）から**登録済みデータ**表示に切替（**名前のみ**表示・hover で編集✎/削除×）。メイン画面の見出しを選択中プリセット名と連動。プリセット0件時はサイドバー／メイン画面に**空状態**を表示
- プリセット削除時、選択中を消した場合は残りの先頭（無ければ未選択＝空状態）へ自動で切り替え
- 型は 004 同様 ts-rs で Rust から自動生成（`src/features/presets/bindings/`）。`AppError` に `DuplicateName` を追加（同名重複用）

### AddPresetScreen の変更（ユーザー確認済み）

- 旧2ステップUI（Step1 ツール選択 / Step2 起動順・並行）は **006 Preset Item Management のスコープ**のため、005 では**プリセット名＋説明のみの単一フォーム**に簡素化（AddToolScreen と同じ create/edit 兼用パターン）
- 旧実装は git 履歴（本コミット直前の HEAD）に完全保存。`screens/add-preset/AddPresetScreen.module.css` と `mockData` の `toolCatalog` / `defaultSelectedToolIds`、`types.ts` の `LaunchItem` / `ToolCatalogItem` も **006 での復元用に残置**

### 追加ライブラリ

- なし（004 で導入済みの rusqlite / uuid / chrono / ts-rs を再利用。新規依存なし）

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: 新規 `src/presets/{mod,model,repository,service,commands}.rs` / 変更 `src/lib.rs`（`mod presets` 追加・`.setup()` で `presets::repository::init` 呼び出し・handler に5コマンド登録）・`src/error.rs`（`DuplicateName` 追加）
- Frontend（`apps/desktop/src/`）: 新規 `features/presets/{types,presetApi,usePresets}.ts` ＋ 生成物 `features/presets/bindings/` / 変更 `App.tsx`（usePresets 接続・選択/編集/削除ハンドラ・選択整合ロジック）・`components/Sidebar.tsx`（+CSS、実プリセット表示＋編集/削除）・`screens/add-preset/AddPresetScreen.tsx`（単一フォームに書き換え）・`screens/main/MainScreen.tsx`（+CSS、`presetName: string | null` 空状態）・`data/mockData.ts`（`presets` 撤去）・`screens/formLayout.module.css`（共有 `.error` 追加）
- 設定: `package.json`（`check:bindings` の diff 対象に `src/features/presets/bindings` 追加）

### 永続 Preset model / DB スキーマ

- API/JSON は camelCase: `id, name, description, createdAt, updatedAt`
- `presets` テーブル（snake_case カラム、`name` に UNIQUE index）。保存先は 004 と同じ `~/Library/Application Support/com.tetsuya.stream-dock/stream-dock.db`（`tools` と同一DB・別テーブル）

### 検証結果

- `cargo check` 成功
- `pnpm gen:bindings`（`cargo test export_bindings`）成功（preset 3型 + AppError を再生成、計7 tests ok）
- `pnpm typecheck` 成功（exit 0）
- `pnpm lint` 成功（exit 0 / warning なし）
- `pnpm build`（tsc && vite build）成功（53 modules）
- ※ `pnpm tauri dev` の GUI 実機 E2E（作成→再起動で永続→編集→削除で再選択→同名エラー→空状態）は**表示環境が必要なため未実施**。次回セッション冒頭またはユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠）

- 外部通信の追加なし／frontend から直接 file・shell 操作なし
- 保存は Rust/Tauri 側に集約、入力は Rust 側でも検証（必須・trim・制御文字・同名重複）
- `run_command` / `execute_shell` / `write_file` / `delete_path` 等の汎用危険コマンドを追加していない
- Tauri capabilities に権限追加なし（`capabilities/default.json` 変更なし）
- 004 の `tools` テーブルを壊さず、別テーブル `presets` を追加するのみ

### やっていないこと（今回スコープ外・据え置き）

- プリセットへのツール紐付け・起動順管理・並行起動設定（→ 006）
- 実プロセス起動/停止・一括起動・起動状態監視（→ 007 以降）
- git commit は未実施（指示があってから）

## 2026-07-06 (006 Preset Item Ordering)

### 完了したこと

- Preset と Tool を紐づける中間エンティティ **PresetItem** を導入し、プリセットへのツール**追加・除外・並び替え・ordered/parallel 切替**を SQLite に永続化できるようにした（実プロセス起動・一括起動・停止・監視は 007 以降のスコープで未実装）
- 004/005 の実装パターン（command 薄ラッパ → service 検証 → repository SQL → model ts-rs）をそのまま踏襲し、Rust に `preset_items/` モジュール（5ファイル）を新設
- Tauri command 6本を実装: `add_tool_to_preset` / `list_preset_items` / `list_all_preset_items` / `remove_tool_from_preset` / `update_preset_item` / `reorder_preset_items`（DB は 004/005 と同じ `Mutex<Connection>` State を共有＝`tools::commands::DbState` を流用し、同一 `stream-dock.db` に `preset_items` テーブルを追加）
  - 期待候補の `set_preset_item_launch_mode` は独立 command にせず `update_preset_item`（launchMode + enabled）に統合（冗長回避）。サイドバーのツール数集計用に `list_all_preset_items` を追加
- 入力バリデーション（service）: presetId/toolId 必須・trim・**実在チェック**（`presets`/`tools` を参照）／同一プリセット内の**ツール重複禁止**（新エラー `DuplicateToolInPreset` + DB の UNIQUE INDEX の二重防御）／launchMode は Rust の `enum LaunchMode { Ordered, Parallel }` によりデシリアライズ時点で不正値を拒否／orderIndex は末尾自動採番（u32 = 非負）。frontend だけでなく Rust 側でも検証
- 外部キー整合: setup で `PRAGMA foreign_keys = ON` を有効化し、`preset_items` の `preset_id`/`tool_id` に `ON DELETE CASCADE` を付与。プリセット/ツール削除時に構成行がカスケード除去され孤児行を防ぐ（presets/tools 側に FK は無く 004/005 の削除挙動は不変）
- **PresetItem 削除と Tool 削除の責務を分離**: `remove_tool_from_preset` は preset_items 行のみ削除し、Tool 本体（tools テーブル）は残す
- React 側に PresetItem 用の feature 層を追加: `presetItemApi`（invoke 薄ラッパ）/ `usePresetItems`（全構成を単一ソースでロード）/ `types.ts` に `PresetItem`/`LaunchMode`/入力型の re-export ＋ 表示用 `PresetItemWithTool` と join ヘルパ `withTools` ＋ サイドバー用 `PresetItemMeta`。**各コンポーネントは invoke を直接呼ばず API wrapper 経由**
- UI 接続:
  - **メイン画面**: 選択中プリセットの構成を表示（order_index 昇順・parallel は連番から除外し「並行」バッジ）。編集モードで **↑↓並べ替え・×除外・ordered/parallel 切替・「＋ツールを追加」（インラインのツール選択リスト）** を、いずれも**操作ごとに即時保存**（対応 command → 構成を再取得）。編集モードの旧「保存」ボタンは即時保存のため撤去し「編集を終える」に集約。ツール0件プリセット用の空状態を追加
  - **プリセット追加画面**: 005 で単一フォーム化していた画面を、**2ステップUI（Step1 ツール選択＋名前/説明 / Step2 起動順・並行設定）に復元**し実データ接続。新規は createPreset → 選択順に addToolToPreset。編集は既存構成を初期値に反映し、保存時に差分（追加/削除/モード変更）＋並び順の再割当を command で反映（旧 `syncLaunchItems` / `orderedIndexFor` を流用）
  - **サイドバー**: プリセット行に `Nツール`（並行を含む場合は `Nツール・一部並行`）のメタ表示を追加
- アプリ再起動後もプリセット内ツール構成が SQLite に残る

### 追加ライブラリ

- なし（004 で導入済みの rusqlite / uuid / chrono / ts-rs を再利用。新規依存なし）

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: 新規 `src/preset_items/{mod,model,repository,service,commands}.rs` / 変更 `src/lib.rs`（`mod preset_items` 追加・`PRAGMA foreign_keys = ON`・`preset_items::repository::init` 呼び出し・handler に6コマンド登録）・`src/error.rs`（`DuplicateToolInPreset` 追加）
- Frontend（`apps/desktop/src/`）: 新規 `features/presets/{presetItemApi,usePresetItems}.ts` ＋ 生成物 `features/presets/bindings/{LaunchMode,PresetItem,AddPresetItemInput,UpdatePresetItemInput}.ts`（+ `tools/bindings/AppError.ts` 再生成）/ 変更 `features/presets/types.ts`・`App.tsx`（usePresetItems 接続・派生値・操作ハンドラ配布）・`screens/main/MainScreen.tsx`（+CSS）・`screens/main/ToolRow.tsx`・`screens/add-preset/AddPresetScreen.tsx`（2ステップUI復元）・`components/Sidebar.tsx`（+CSS、ツール数メタ）・`data/mockData.ts`（`toolCatalog`/`defaultSelectedToolIds` 撤去）

### 永続 PresetItem model / DB スキーマ

- API/JSON は camelCase: `id, presetId, toolId, launchMode("ordered"|"parallel"), orderIndex(number), enabled(boolean), createdAt, updatedAt`
- `preset_items` テーブル（snake_case カラム、`(preset_id, tool_id)` に UNIQUE INDEX、`preset_id`/`tool_id` に FK + ON DELETE CASCADE）。保存先は 004/005 と同じ `~/Library/Application Support/com.tetsuya.stream-dock/stream-dock.db`

### 検証結果

- `cargo check` 成功
- `pnpm gen:bindings`（`cargo test export_bindings`）成功（11 tests ok。LaunchMode/PresetItem/入力2型 + AppError を再生成）
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（57 modules）
- ※ `check:bindings` は生成物が未コミットのため diff で exit 1（＝生成は最新・コミット前という想定どおり）。コミット時に bindings 差分を含める
- ※ `pnpm tauri dev` の GUI 実機 E2E（作成→再起動で永続→編集→即時保存→重複エラー→空状態→004/005 非破壊）は表示環境が必要なため未実施。次回セッション冒頭またはユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠）

- 外部通信の追加なし／frontend から直接 file・shell 操作なし（全保存は Rust command 経由）
- `run_command` / `execute_shell` / `write_file` / `delete_path` 等の汎用危険コマンドを追加していない
- 入力は Rust 側でも検証（必須・trim・実在チェック・重複禁止・launchMode は enum で型担保・orderIndex は非負）
- Tauri capabilities に権限追加なし（`capabilities/default.json` 変更なし。自作 command は `core:default` でカバー）
- **要レビュー項目**: `PRAGMA foreign_keys = ON` + カスケードを追加（孤児 preset_items 防止が目的。presets/tools に FK は無く既存削除挙動は不変）
- Tool 削除と PresetItem 削除の責務を分離（004/005 のデータを壊さず別テーブル追加のみ）

### やっていないこと（今回スコープ外・据え置き）

- 実プロセス起動/停止・一括起動・起動状態監視（→ 007 以降。メイン画面の起動状態は従来どおり疑似シミュレーション）
- `.lnk` 実体パス解決・`.bat` 対応・アイコン自動抽出
- git commit は未実施（指示があってから）

## 2026-07-06 (空プリセット防止)

### 完了したこと

- 「ツールが1つも入っていないプリセット」が生まれる3経路をすべて塞いだ（方針: 空プリセットは存在させない）
  1. **メイン画面 編集モードで最後の1件を × 削除** → 「プリセットからツールがすべて削除されるとプリセットも削除されます。よろしいですか？」の確認ダイアログを出し、OK でプリセットごと削除する
  2. **プリセット追加画面（新規）** → ツール未選択では作成不可
  3. **プリセット編集画面** → 既存プリセットのツールを全部外した状態では保存不可（ユーザー確認済みで「ブロック」方針）
- フロントエンドのみで対応。Rust command / DB schema / bindings / ライブラリ追加は無し（既存 `delete_preset` command を再利用）

### 変更した主要ファイル（`apps/desktop/src/`）

- `App.tsx` — `handleRemovePresetItem` を書き換え。`presetItems` から所属プリセットと残件数を逆引きし、最後の1件なら `window.confirm` → `deletePreset(presetId)`（`preset_items` は DB の `ON DELETE CASCADE` で自動除去）。削除後の再選択は既存 `handleDeletePreset` と同型（`remaining[0]?.id ?? null`）
- `screens/add-preset/AddPresetScreen.tsx` — `goNext` に「ツール未選択なら進めない」ゲート（`selectedTools.length === 0`）を追加（新規・編集とも Step2 へは `goNext` を通るため、これで両方の空保存を防止）。`handleSave` にも `launchItems.length === 0` ガードを二重化。Step2 の「ツールなしでもプリセットは保存できます」表示を中立文言に修正。表示は既存 `.error` を再利用

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（57 modules）
- ※ `pnpm tauri dev` の GUI 実機 E2E（2件→1件目削除でダイアログ無し／最後の1件削除でダイアログ→OK でプリセット消滅＋選択切替／新規・編集ともツール未選択で「次へ」がエラーでブロック）は表示環境が必要なため未実施。ユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠）

- 外部通信の追加なし／frontend から直接 file・shell 操作なし（削除は既存 `delete_preset` command 経由）
- `run_command` / `execute_shell` / `write_file` / `delete_path` 等の危険コマンド追加なし／Tauri capabilities 変更なし
- 新規コマンド・テーブル追加なし。004/005/006 のデータ・既存機能は不変
- 「ツール1件以上」の Rust 側検証は今回スコープ外（`create_preset` と `add_tool_to_preset` が独立コマンドで原子的強制には新規トランザクション型 command が必要なため。MVP方針でフロントのゲートで担保）

### やっていないこと（今回スコープ外・据え置き）

- Rust 側での「ツール1件以上」不変条件の強制
- 実プロセス起動/停止・一括起動・起動状態監視（→ 007 以降）
- git commit は未実施（指示があってから）

## 2026-07-06 (削除確認ダイアログ不具合の修正)

### 背景・根本原因

- 上記「空プリセット防止」で実装した最後の1件削除の確認ダイアログが、実機で一切表示されないとユーザー報告。
- 原因: 削除確認3か所すべてが `window.confirm(...)`（ブラウザ同期ダイアログ）を使用。Tauri v2 の macOS webview（WKWebView / wry）は `window.confirm` / `window.alert` をネイティブダイアログに接続していないため、**ダイアログが表示されず false を返す** → `if (!window.confirm(...)) return;` が常に早期 return。確認が出ないだけでなく削除自体も進まない（サイドバーのツール削除・プリセット削除・最後の1件削除の3か所とも同じ問題）。

### 完了したこと

- 削除確認3か所を `window.confirm` から `@tauri-apps/plugin-dialog` の非同期 `ask()`（ネイティブダイアログ）に差し替え。`kind: "warning"` ＋ タイトル付き。
  - `handleDeleteTool`（サイドバーのツール削除）
  - `handleDeletePreset`（サイドバーのプリセット削除）
  - `handleRemovePresetItem`（メイン画面で最後の1件削除→プリセット削除）
- capability に `dialog:allow-ask` を追加（`ask()` に必要な最小権限。`dialog:default` の広い権限は使わない）。dialog プラグインは 004 で導入・登録済み・JS パッケージ導入済みのため、**Rust コード変更・新規ライブラリ追加は無し**（権限追加と呼び出し差し替えのみ）。
- 削除ロジック（最後の1件判定・削除後の再選択など）は変更せず、確認手段のみ差し替え。

### 変更した主要ファイル

- `apps/desktop/src-tauri/capabilities/default.json` — `dialog:allow-ask` を追加
- `apps/desktop/src/App.tsx` — `import { ask } from "@tauri-apps/plugin-dialog"` 追加、`window.confirm` → `await ask(...)` に3か所差し替え

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（57 modules）
- `cargo check` 成功
- ※ `pnpm tauri dev` の実機確認（3か所でダイアログが実際に表示され、OK で実行・キャンセルで中止されること）は表示環境が必要なため未実施。ユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠・security-review 実施済み＝問題なし）

- capability 変更あり（`dialog:allow-ask`）→ security.md「レビュー必須条件: Tauri capabilities」に該当するため security-review を実施。最小権限のみ追加で問題なしと判定
- `ask` は OS ネイティブダイアログで外部通信なし。返り値は boolean のみでユーザー自由入力を OS 操作に渡さない。message はハードコード文字列
- 危険コマンド追加なし／削除は既存 Rust command 経由を維持／004/005/006 のデータ・既存機能は不変

### やっていないこと（今回スコープ外・据え置き）

- 確認範囲を「毎回の削除」へ広げること（ユーザー回答＝最後の1つのみ、で確定）
- git commit は未実施（指示があってから）

## 2026-07-07 (007 Process Launch)

### 完了したこと

- 登録済み Tool を stream-dock から**単体で実プロセス起動**できるようにした（一括起動・停止・状態監視・`.lnk`/`.bat` 対応・起動状態管理の本格化は 007 スコープ外）
- OS プロセス操作が初めて入るため `docs/security.md` を最優先。**shell 非経由**で保存済み `executablePath` を直接起動し、frontend からは `toolId` のみを渡す設計にした
- 起動ロジックは **Rust 新規 `src/process/` モジュール**（`architecture.md` の ProcessService に対応）に置いた。DB テーブルを持たないため `repository.rs` は作らず、`mod`/`model`/`service`/`commands` の3+1構成
- Tauri command 1本を実装: `launch_tool`（薄いラッパ。引数は既存 `get_tool`/`delete_tool` に合わせ `id`）。DB は 004〜006 と同じ `Mutex<Connection>` State（`tools::commands::DbState`）を再利用
- **DB ロックは Tool 取得だけで解放し、プロセス spawn 中は保持しない**（`command` 内で Tool を取得→ロック解放→`process::service::launch(&tool)`）
- Rust 側の起動時検証（`process::service::launch`）: `executablePath` が 空でない / 絶対パス / 実在 / 非ディレクトリ / `.lnk`・`.bat` でない、を確認してから `std::process::Command::new(path).spawn()`。`toolId` 空チェックと Tool 存在チェック（既存 `tools::service::get` で NotFound）は command 側
- PID の扱い（009 Process Stop 準備）: 起動成功時に `LaunchToolResult { toolId, processId, startedAt }` を返す（**PID を返すだけ**。起動記録の永続ストアは 007 では作らない）
- エラーは frontend で表示可能な安全な形に限定。`spawn()` 失敗の生 OS エラー文字列は露出させず、`AppError::LaunchFailed("プロセスの起動に失敗しました")` の固定メッセージに丸める（環境情報を漏らさない）
- React 側: `features/tools/toolApi.ts` に `launchTool(id)` を追加（**各コンポーネントは invoke を直接呼ばず API wrapper 経由**）。メイン画面の擬似 `handleStart`（`setTimeout` シミュレーション）を実起動に差し替え。起動中は行のボタンが Spinner に置換され自動的に disabled、成功で `running` ＋成功メッセージ、失敗で `error` ＋ `toErrorMessage(e)` をインライン表示（トースト機構が無いため既存 `.error` イディオムに倣い成功/失敗の2クラスを CSS に追加）。失敗後の行は `error` 状態から再び起動ボタンが出るためリトライ可能

### 追加ライブラリ

- なし（`std::process::Command`（std）のみ。既存 rusqlite / uuid / chrono / ts-rs を再利用。新規依存・新規 Tauri plugin なし）

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: 新規 `src/process/{mod,model,service,commands}.rs` / 変更 `src/lib.rs`（`mod process;` ＋ handler に `launch_tool` 登録）・`src/error.rs`（`LaunchFailed` variant ＋ Display 追加）
- Frontend（`apps/desktop/src/`）: 生成物 `features/tools/bindings/LaunchToolResult.ts`（＋ `AppError.ts` 再生成）/ 変更 `features/tools/types.ts`（`LaunchToolResult` re-export）・`features/tools/toolApi.ts`（`launchTool` 追加）・`screens/main/MainScreen.tsx`（実起動 ＋ フィードバック）・`screens/main/MainScreen.module.css`（`.launchSuccess`/`.launchError` 追加）

### 起動結果 model / 型

- API/JSON は camelCase: `LaunchToolResult { toolId: string, processId: number, startedAt: string }`（ts-rs で Rust から自動生成）。DB スキーマ変更なし

### 検証結果

- `cargo check` 成功
- `pnpm gen:bindings`（`cargo test export_bindings`）成功（12 tests ok。`LaunchToolResult` 新規 ＋ `AppError` 再生成）
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（57 modules）
- ※ `pnpm tauri dev` の GUI 実機 E2E（実在する実行ファイルを登録→プリセット追加→行の起動ボタンで実アプリ起動＋成功メッセージ／存在しない・ディレクトリ・.bat で失敗メッセージ／起動中 Spinner 無効化／004〜006 非破壊）は表示環境が必要なため未実施。次回セッション冒頭またはユーザー環境での確認を推奨
- ※ `check:bindings` は生成物が未コミットのため diff で exit 1（＝生成は最新・コミット前という想定どおり）。コミット時に bindings 差分を含める

### セキュリティ確認（docs/security.md 準拠 / 実装後に security-review 実施予定）

- shell 非経由（`std::process::Command` 直接・`cmd /C` / `sh -c` なし・文字列連結でコマンド生成なし）
- frontend からは `toolId` のみ。任意パス・任意コマンドを渡せない。Tool の取得と `executablePath` 検証は Rust 側で実施
- `run_command` / `execute_shell` / `write_file` / `delete_path` / `launch_path` / `launch_command` 等の汎用危険 command を追加していない
- Tauri capabilities / permissions 変更なし（自作 command は `core:default` でカバー。shell/opener/fs プラグイン権限を追加していない）
- エラーメッセージに環境変数・機密情報を含めない（`LaunchFailed` は固定文言）
- 004/005/006 のデータ・既存機能を壊さず、command 1本と Rust モジュール1つを追加するのみ

### やっていないこと（今回スコープ外・据え置き）

- プリセット内ツールの一括起動（`launchAll` は擬似のまま）・ordered/parallel に従った起動制御
- プロセス停止（メイン画面の running 行「停止」ボタンは UI 状態リセットのみで実 kill しない → 009 で実装）・起動状態監視
- 起動記録の永続ストア（PID を返すのみ。009 Process Stop で追加検討）
- `.lnk` 実体パス解決・`.bat` 対応・アイコン自動抽出
- Sidebar のツール一覧・ピッカーへの起動ボタン追加
- git commit は未実施（指示があってから）

## 2026-07-07 (007 E2E 修正: macOS `.app` 起動 & 一括ボタン誤ローディング)

### 背景

macOS 上で 007 の E2E 検証中に 2 件の不具合が判明した。

1. **単体起動ボタンを押してもアプリが起動しない。** 当初は Tauri/Rust の権限不足を疑ったが誤り（自作 command `launch_tool` は capabilities/ACL の権限を要求せず、既存 command と同様に到達可能）。真因は macOS 固有: ツール登録のファイル選択（`open({ directory: false })`）で macOS アプリを選ぶと `.app` バンドル＝**ディレクトリ**のパス（例 `/Applications/OBS.app`）が保存され、`process::service::launch` が `path.is_dir()` で `Validation("指定されたパスはディレクトリです")` を返して起動に到達しなかった。仮に通しても `std::process::Command::new("/…/OBS.app").spawn()` はバンドルを exec できない。007 が Windows 前提（`.exe`/`.lnk`/`.bat`）で設計され、macOS の `.app` 起動が未対応だった。
2. **単体起動時に右上の「一括起動」ボタンまでローディング（Spinner + disabled）になる。** 一括ボタンが `launching || anyStarting` を条件にしており、単体起動 `handleStart` が対象行を `"starting"` にすると `anyStarting` が true になって巻き込まれていた。

### 完了したこと

- **macOS `.app` 起動対応（`open` 経由）**: `process::service::launch` に `#[cfg(target_os = "macos")]` 分岐を追加。拡張子 `app` のディレクトリを「起動可能」と判定し、固定の絶対パス `/usr/bin/open` にバンドルパスを**配列引数**（shell 非経由・文字列連結なし＝security.md 準拠）で渡して LaunchServices 起動する。`.app` 以外のディレクトリは従来どおり拒否。`.lnk`/`.bat` 拒否は通常ファイル経路のみに適用。Windows/Linux の直接 spawn 経路は cfg で不変。
  - **PID の注意（009 申し送り）**: `open` 経由のため返る `processId` は実アプリではなく即座に終了する `open` ヘルパの PID。007 要件「起動成功時に PID を取得できる」は満たすが、009 Process Stop では macOS で実アプリ PID を別途取得する方式が必要。`service.rs`／`model.rs` の既存 TODO に明記した。
- **一括ボタン誤ローディング修正**: `MainScreen.tsx` の一括起動ボタンの `disabled` / Spinner 条件を `launching || anyStarting` から **`launching` のみ**（disabled は `launching || isEmpty`）に変更し、未使用化した `anyStarting` を削除。単体起動のローディングは対象行の `ToolRow`（`state === "starting"` の Spinner）のみが担当する挙動に是正。

### 変更したファイル

- Rust: `apps/desktop/src-tauri/src/process/service.rs`（`.app` 判定 ＋ `open` 経由起動 ＋ TODO 追記）・`src/process/model.rs`（PID TODO に macOS 注記追記）
- Frontend: `apps/desktop/src/screens/main/MainScreen.tsx`（`anyStarting` 削除・一括ボタン条件修正）

### 触っていないもの

- `error.rs`／型（bindings）変更なし → ts-rs 再生成不要。`capabilities/default.json` 変更なし。新規 crate・plugin・command・DB スキーマ追加なし。004/005/006 のデータ・機能は不変。

### 検証結果

- `cargo check` 成功
- `pnpm typecheck` 成功（exit 0）
- `pnpm lint` 成功（exit 0 / warning なし）
- ※ `pnpm tauri dev` の macOS 実機 E2E（`.app` 登録→単体起動で実アプリ起動／単体起動中に一括ボタンが非ローディングのまま／一括起動で一括ボタンのみ Spinner／存在しないパス・非 .app ディレクトリ・.bat のエラー）はユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠 / process 起動処理変更のため security-review 推奨）

- shell 非経由（`/usr/bin/open` は固定絶対パス、バンドルパスは配列引数で渡し文字列連結なし）
- frontend からは `toolId` のみ。任意パス・任意コマンドは起動できない（Tool 取得・検証は Rust 側）
- 汎用危険 command 追加なし／capabilities 変更なし／外部通信追加なし

## 2026-07-07 (007 不具合修正: 単体起動後もUIが「起動中」のまま終わらない)

### 背景

macOS の実機 E2E で、`/Applications` 配下の LINE（`.app` バンドル）を登録して単体起動すると、
**実アプリは起動するのに、メイン画面の行が「起動中」（Spinner）のまま永久にローディングが終わらない**症状を確認。
直前の `.app` 起動対応で Rust 側の起動が成功するようになった結果、今度は「起動成功後のフロント状態遷移」の別バグが表面化した。

### 根本原因（Rust 側ではなくフロント側）

Rust の `launch_tool` → `process::service::launch` は正常に spawn して `LaunchToolResult` を返しており、
`launchTool()` の Promise は解決している。問題は解決後のフロント状態更新が握りつぶされていた点。

`MainScreen.tsx` の `mountedRef` が典型的な **React 18 StrictMode アンチパターン**になっていた。
cleanup で `mountedRef.current = false` にするが、effect 本体で `true` に戻していなかったため、
`pnpm tauri dev`（dev モード＝`<React.StrictMode>` 有効）の effect 二重実行（mount→unmount→remount）で
`mountedRef.current` が**恒常的に false** に固定される。その結果 `handleStart` の
`await launchTool()` 解決後に `if (!mountedRef.current) return;` で早期 return し、状態が `"starting"` から動かなくなっていた。
成功側（running）も失敗側（error）も同じ早期 return で握りつぶされ、一括起動 `launchAll` の途中判定も同様に影響を受けていた。
※ dev モード限定（本番ビルドでは StrictMode は effect を二重実行しないため再現しない）だが、検証は `pnpm tauri dev` で行うため実質必ず踏む。

### 完了したこと

- `MainScreen.tsx` の mount 用 `useEffect` 本体先頭に `mountedRef.current = true;` を追加し、StrictMode 再マウント後も mounted 判定が true に復帰するようにした（フロント1ファイル・1行の追加）。
- これにより単体起動成功後に `running`＋成功メッセージへ、失敗時は `error`＋エラーメッセージへ正しく到達し、一括起動の途中判定も正常化する。

### 触っていないもの

- Rust 側（`process/` モジュール・`service.rs` の `.app` 起動ロジック・`launch_tool` command）は正常なため変更なし。
- 型/bindings・`capabilities`・DB スキーマ・依存追加なし。
- `.app` 経由起動で返る PID が `open` ヘルパの PID である件は 009 の申し送り事項で本不具合とは無関係のため対象外。

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- ※ `pnpm tauri dev` の macOS 実機 E2E（`.app` 単体起動で行が「起動中」→「起動済み」へ遷移し成功メッセージ表示／存在しないパス・非 .app ディレクトリ・.bat でエラー表示＋再起動ボタン復帰／一括起動でも各行が起動済みまで進む）はユーザー環境での確認を推奨

## 2026-07-07 (007 UX調整: 単体起動ステータスを「起動済み」→「起動中(継続)」に変更)

### 背景

単体起動で spawn 成功と同時に行が「起動済み」になるが、実アプリはまだ初期ローディング中で「起動成功(完了)」の断定が実態とズレて直感に反する、というユーザー指摘。

### 技術的前提（不可能な理由）

「アプリの初期ローディングが完全に終わったタイミング」の正確な検知は実質不可能。
- 「準備完了」はアプリ内部状態で、OS に汎用シグナルが無い。
- プロセス生存確認はローディング中もずっと true なので早期化を解消しない（かつ macOS `.app` は `/usr/bin/open` 経由で実 PID を持たない＝追跡は 009 相当の追加実装が必要）。
- macOS の `isFinishedLaunching` 等は AppKit 起動完了時点で早期発火し、ローディング完了とは一致しない（＋新規ネイティブ依存が必要）。

### 完了したこと（フロントのみ・小規模）

- 完了断定の「起動済み」への自動遷移をやめ、単体起動は spawn 成功後「起動中」を**到達点（resting 状態）**として表示する方針に変更（ユーザー確定）。
- 新しい表示状態 `"launched"`（バッジ文言「起動中」）を追加。単体起動の遷移を `waiting → starting(Spinner=起動要求送信中) → launched(起動中の継続表示・開く/停止ボタン表示)` に変更。失敗は従来どおり `error`。
- `starting` と `launched` はバッジ文言が同じ「起動中」で、Spinner → resting の遷移中もバッジ表示が途切れず自然につながる。完了断定の `running`（起動済み）へは単体起動では遷移しない（009 の実監視用に温存）。

### 変更したファイル（`apps/desktop/src/`）

- `types.ts`（`ToolState` に `"launched"` 追加）
- `components/primitives.tsx`（`STATUS_LABELS` に `launched: "起動中"`）
- `components/primitives.module.css`（`.status.starting` セレクタを `.launched` にも適用＝同じ見た目を流用・新規色なし）
- `screens/main/ToolRow.tsx`（「開く／停止」の表示条件を `running` に加え `launched` でも出す。`starting` の Spinner 分岐は不変）
- `screens/main/MainScreen.tsx`（`handleStart` 成功時を `running` → `launched`。成功メッセージ「◯◯ を起動しました」は維持）

### 触っていないもの（スコープ限定）

- 進捗テキスト `N / M 起動済み`（完了断定しない方針なので起動した行を「起動済み」に数えないのは整合的＝変更なし）
- 一括起動 `launchAll` / `一括停止`（007 では疑似シミュレーションのまま。`running` 遷移・`allRunning` ロジックも不変）
- 「停止」ボタンの挙動（007 どおり UI 状態リセットのみ。実 kill は 009）
- Rust 側 / 型 bindings / capabilities / 依存（`ToolState` はフロント専用 UI 型のため bindings 再生成不要）

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- ※ `pnpm tauri dev` の macOS 実機 E2E（起動ボタン→一瞬 Spinner→実アプリ起動でバッジ「起動中」のまま留まり「開く／停止」表示＋成功メッセージ／「停止」で待機中へ戻りリトライ可／存在しないパス・非 .app・.bat でエラー）はユーザー環境での確認を推奨

### 申し送り（009）

- 実プロセス監視（macOS は実アプリ PID 解決を含む）を入れたら `launched`（起動中）→ プロセス稼働確認で `running`（「稼働確認済み」に再定義）へ遷移させる余地を残す。ただしそれでも「初期ローディング完了」の厳密検知ではない点は変わらない。

## 2026-07-07 (008 Bulk Launch)

### 完了したこと

- 選択中 Preset に紐づく **enabled な PresetItem をまとめて実プロセス起動**できるようにした（停止・状態監視・起動完了検知・`.lnk`/`.bat` 対応は 008 スコープ外＝009 以降）
- 007 の単体起動サービス **`process::service::launch(&Tool)` をそのまま再利用**（`&Tool` のみを取り DB 非依存）。008 では PresetItem の取得・並び替え・起動順制御・結果集約を上に載せた
- Tauri command 1本 `launch_preset(db, preset_id)` を追加（薄いラッパ）。**frontend からは presetId のみ**を渡し、Preset / PresetItem / Tool の取得と executablePath 検証はすべて Rust 側で実施。DB は 004〜007 と同じ `Mutex<Connection>` State（`tools::commands::DbState`）を再利用
- **DB ロックは起動対象の解決だけで解放し、spawn 中は保持しない**（007 の `launch_tool` と同方針）。command 内で `resolve_preset_targets` → ロック解放 → `launch_preset_targets`（DB 非依存）で spawn
- **起動順（MVP）**: enabled な ordered を orderIndex 昇順で先に → enabled な parallel を後にまとめて起動。`std::process::Command::spawn()` は子の終了を待たない非ブロッキング呼び出しのため、順に spawn しても起動アプリ群は同時並行に走る（**スレッド・新規依存なし**）
- **開始前 abort（一括起動自体を始めない）**: presetId 空 / Preset 不在（`NotFound`）/ enabled な PresetItem が0件（`Validation`）。それ以外は best-effort で、1件の失敗では全体を止めず成功・失敗を集約
- **結果モデル**を追加（ts-rs 生成）: `BulkLaunchPresetResult { presetId, startedAt, finishedAt, totalCount, successCount, failureCount, results }` ＋ `BulkLaunchToolResult { presetItemId, toolId, toolName, launchMode, orderIndex, success, processId?, startedAt?, errorMessage? }`。起動成功ごとに `processId` を含む
- **エラー文言の安全化**: bulk 結果の `errorMessage` は `safe_launch_message` でフロント表示に安全な短文へ丸める。特に `AppError::PathNotFound` はメッセージにフルパスを含むため、パスを出さない固定文言（「指定された実行ファイルが見つかりません」）に置換（環境情報・パスを露出しない）
- React 側: `features/presets/presetLaunchApi.ts`（`launchPreset(presetId)` 薄ラッパ）を追加し、**コンポーネントは invoke を直接呼ばず API wrapper 経由**。メイン画面の疑似 `launchAll`（`setTimeout` シミュレーション）を実起動へ差し替え。起動中は一括起動ボタンが Spinner＋disabled、`res.results` を `presetItemId`（= 行 id）で各行に反映（成功→`launched`、失敗→`error`）。成功／一部失敗（warning）／全失敗（error）でフィードバック文言を出し分け、失敗ツール名を表示。enabled な item が0件・未選択のときは一括起動ボタンを disabled

### 追加ライブラリ

- なし（`std::process::Command`（std）のみ。既存 rusqlite / uuid / chrono / ts-rs を再利用。新規 crate・plugin・npm package なし）

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: 変更 `src/process/model.rs`（`BulkLaunchPresetResult` / `BulkLaunchToolResult` 追加）・`src/process/service.rs`（`resolve_preset_targets` / `launch_preset_targets` / `launch_one` / `safe_launch_message` 追加、007 の `launch` は不変）・`src/process/commands.rs`（`launch_preset` command 追加）・`src/lib.rs`（handler に `launch_preset` 登録）
- Frontend（`apps/desktop/src/`）: 生成物 `features/presets/bindings/BulkLaunchPresetResult.ts` / `BulkLaunchToolResult.ts` / 新規 `features/presets/presetLaunchApi.ts` / 変更 `features/presets/types.ts`（bulk 結果型を re-export）・`screens/main/MainScreen.tsx`（実一括起動・`hasEnabled` による disabled・warning フィードバック・不要になった `sleep` 撤去）・`screens/main/MainScreen.module.css`（`.launchWarning` 追加）

### 検証結果

- `cargo test export_bindings` 成功（14 tests ok。`BulkLaunchPresetResult` / `BulkLaunchToolResult` を新規生成、`LaunchMode` を同ディレクトリ import で参照）
- `cargo check` 成功
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（58 modules）
- ※ `check:bindings` は生成物が未コミットのため diff で exit 1（＝生成は最新・コミット前という想定どおり）。コミット時に bindings 差分を含める
- ※ `pnpm tauri dev` の実機 E2E（複数ツールのプリセットで一括起動→ ordered 順→ parallel 起動／成功・一部失敗（warning＋失敗ツール名）・全失敗（error）／起動中ボタン disabled＋Spinner／enabled 0件・未選択で起動不可／004〜007 非破壊）は表示環境が必要なためユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠 / process 起動処理変更のため security-review 推奨）

- shell 非経由（007 の `launch` を再利用＝`std::process::Command` 直接・`cmd /C` / `sh -c` なし・文字列連結でコマンド生成なし）
- frontend からは presetId のみ。任意パス・任意コマンド・起動引数・working directory を渡せない。Preset / PresetItem / Tool 取得と executablePath 検証は Rust 側
- `run_command` / `execute_shell` / `launch_path` / `bulk_launch_paths` 等の汎用危険 command を追加していない（限定的な `launch_preset` のみ）
- Tauri capabilities / permissions 変更なし（自作 command は `core:default` でカバー）
- `errorMessage` に環境変数・フルパス・スタックトレースを出さない（`safe_launch_message` で丸め）
- 004〜007 のデータ・既存機能を壊さず、command 1本とモデル2つ・フロント wrapper 1つを追加するのみ

### やっていないこと（今回スコープ外・据え置き）

- プロセス停止（一括停止ボタンは bulk 起動では `launched` 止まりで `allRunning` にならず「一括起動」のまま。実 kill は 009）・起動状態監視・死活監視・自動リトライ
- 起動完了検知・アプリ初期ローディング完了検知・ツールごとの起動待機秒数・launch group
- 起動記録の永続ストア（processId を結果に含めるのみ。009 で PID 管理を検討。macOS `.app` の PID は `open` ヘルパのものである件は 007 からの申し送りどおり）
- `.lnk` 実体パス解決・`.bat` 対応・アイコン自動抽出
- git commit は未実施（指示があってから）

## 2026-07-07 (009 Process Stop)

### 完了したこと

- stream-dock 経由で起動したプロセスだけを**安全に停止**できるようにした（raw PID ではなく Rust 側 registry が保持する `std::process::Child` ハンドル経由で停止）。frontend からは `launchId` / `presetId` のみを渡し、任意 PID・path・command・shell 経由の停止はしない（docs/security.md §6 準拠）
- Rust に **runtime process registry** を新設（`process/registry.rs`）。`ManagedProcess { launch_id, tool_id, tool_name, preset_id, preset_item_id, process_id, started_at, child }` を `Mutex<HashMap<launchId, ManagedProcess>>`（`ProcessRegistry`）で current session 限定に保持。`app.manage` で State 共有。`launchId` は Rust 側で `uuid::Uuid::new_v4()` 採番（既存依存を再利用・新規 crate なし）
- 007 の `process::service::launch`（Child を drop していた）を **`spawn(&Tool) -> AppResult<Child>`** に置き換え、Child を drop せず返す形にした（**検証・macOS `.app` の `/usr/bin/open` 起動経路は 007/008 から変更しない**＝起動処理は不変）。`launch_tool` command で spawn 成功後に registry 登録し、`LaunchToolResult` に `launchId` を含める
- 008 の `launch_preset_targets` / `launch_one` に `registry` を配線し、spawn 成功ごとに `ManagedProcess`（`preset_id`/`preset_item_id` 付き）を登録。`BulkLaunchToolResult` に `launchId`（成功時のみ Some）を追加
- Tauri command 2本を追加（既存 `launch_tool`/`launch_preset` 命名に合わせて確定）:
  - `stop_process(registry, launchId)`: registry から `remove` → `service::stop_one` で停止 → 停止失敗時のみ registry へ戻して再試行可能に。registry に無い launchId は `not-found` を返し何も停止しない
  - `stop_preset_processes(db, registry, presetId)`: presetId 空チェック → Preset 実在チェック（`presets::service::get`）→ registry を `preset_id` 一致で絞り込み → 各 `stop_one` → 集計（stopped / already-exited / failed 件数）。対象0件でも totalCount=0 の正常結果を返す
- **停止ロジック**（`service::stop_one`）: `child.try_wait()` で既終了なら `already-exited`、動作中なら `child.kill()` → `child.wait()` でゾンビ回収して `stopped`、失敗は `failed`。エラー文言は環境情報を出さない固定文言に丸める
- 結果モデル（ts-rs 生成）: `StopProcessResult { launchId, toolId, toolName, processId, status, stoppedAt?, errorMessage? }` ＋ enum `StopStatus`（kebab-case: `stopped` / `already-exited` / `not-found` / `failed`）＋ `StopPresetProcessesResult { presetId, stoppedAt, totalCount, successCount, alreadyExitedCount, failureCount, results }`
- React 側: API wrapper `stopProcess(launchId)`（`features/tools/toolApi.ts`）/ `stopPresetProcesses(presetId)`（`features/presets/presetLaunchApi.ts`）を追加し、**コンポーネントは invoke を直接呼ばず wrapper 経由**。`RuntimeItem` に `launchId` を追加し、単体/一括起動の成功結果から行に保持。`ToolState` に `"stopping"`（バッジ「停止中」）を追加
- UI 接続: 行の「停止」ボタンを実 `stopProcess` に配線（停止中は行が Spinner＋disabled）。停止成功=「◯◯ を停止しました」／既終了=「既に終了していました」／失敗=エラー文言＋起動中へ戻し再試行可。一括ボタンは起動中の行があるとき「一括停止」に切り替わり `stopPresetProcesses` を呼ぶ（進行中は Spinner＋disabled）。件数フィードバックを成功/一部失敗/対象なしで出し分け

### macOS `.app` の既知の縮退 & 013 への切り出し

- macOS の `.app` は 007/008 が `/usr/bin/open` 経由で起動するため、registry が掴む `Child` は即終了する `open` ヘルパで、**停止すると「既に終了済み」になり実アプリは止まらない**。009 では起動処理を変更しない方針（スコープを狭めて品質を上げる）とし、macOS `.app` の実停止対応は新タスク **013 macOS App Bundle Stop**（`docs/tasks/013-macos-app-stop.md`）に切り出した。Windows(`.exe`)/Linux の直接 spawn 経路では `Child` が実プロセスなので正しく停止できる（本命ターゲットは Windows）
- タスクボード: 013 に macOS App Bundle Stop を差し込み、既存を繰り下げ（Windows Build→014、User Test Package→015）

### 既知の制約（MVP・据え置き）

- メイン画面の `useEffect` は items 変更時に runtime を待機中へ再構築するため、起動後に Preset 構成を編集すると UI 側の `launchId` は失われ単体停止ボタンは消える。ただし Rust registry はプロセスを保持し続けるので、**Preset 単位停止（Rust 側で presetId 検索）では引き続き停止できる**

### 追加ライブラリ

- なし（`std::process::Child`（std）と既存 uuid / chrono / rusqlite / ts-rs を再利用。新規 crate・plugin・npm package なし）

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: 新規 `src/process/registry.rs` / 変更 `src/process/{mod,model,service,commands}.rs`・`src/lib.rs`（registry を `app.manage`・`mod registry`・stop command 2本を handler 登録）。`error.rs`・`capabilities/default.json` は**変更なし**
- Frontend（`apps/desktop/src/`）: 生成物 `features/tools/bindings/{StopProcessResult,StopStatus,LaunchToolResult}.ts`・`features/presets/bindings/{StopPresetProcessesResult,BulkLaunchToolResult}.ts` / 変更 `features/tools/{toolApi,types}.ts`・`features/presets/{presetLaunchApi,types}.ts`・`types.ts`・`components/primitives.{tsx,module.css}`・`screens/main/{MainScreen.tsx,ToolRow.tsx}`
- Docs: 新規 `docs/tasks/013-macos-app-stop.md` / 変更 `docs/task-board.md`（013 差し込み・009 を Done へ）・`docs/progress.md`（本記録）

### 検証結果

- `cargo check` 成功
- `pnpm --filter ./apps/desktop gen:bindings`（`cargo test export_bindings`）成功（17 tests ok。`StopProcessResult` / `StopStatus` / `StopPresetProcessesResult` 新規、`LaunchToolResult` / `BulkLaunchToolResult` 再生成）
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（58 modules）
- ※ `pnpm tauri dev` の実機 E2E（`.exe`/`.app` を起動→単体停止・Preset 単位停止／既終了→「既に終了済み」／registry 外 launchId・presetId の非停止／手動起動アプリを止めない／macOS `.app` は既知縮退どおり実アプリが止まらない／004〜008 非破壊）は表示環境が必要なためユーザー環境での確認を推奨
- ※ `check:bindings` は生成物が未コミットのため diff で exit 1（＝生成は最新・コミット前という想定どおり）。コミット時に bindings 差分を含める

### セキュリティ確認（docs/security.md 準拠 / process 停止処理追加のため security-review 推奨）

- 停止は `std::process::Child::kill()` のみ（`taskkill` / `kill` / `pkill` / `cmd /C` / `sh -c` / `powershell` なし・shell 非経由）
- frontend からは `launchId` / `presetId` のみ。任意 PID・path・command を渡せない。registry 未登録は停止しない。frontend から渡された launchId / presetId は Rust 側で検証（空チェック・registry/Preset 実在）
- `kill_pid` / `stop_pid` / `run_command` / `execute_shell` 等の汎用危険 command を追加していない（限定的な `stop_process` / `stop_preset_processes` のみ）
- Tauri capabilities / permissions 変更なし（自作 command は `core:default` でカバー）
- 停止結果の `errorMessage` は環境情報・パスを含まない固定文言に丸め
- プロセスツリー停止・graceful shutdown・常時死活監視（010 相当）は実装していない
- 004〜008 のデータ・既存機能を壊さず、command 2本・Rust モジュール1つ・フロント wrapper 2つを追加するのみ

### やっていないこと（今回スコープ外・据え置き）

- macOS `.app` の実プロセス停止（→ 013 macOS App Bundle Stop）
- 起動状態の常時監視・死活監視ループ・waiting/starting/running/stopping/stopped/error の本格的な状態管理（→ 010 Runtime Status）
- プロセスツリー全体の停止・graceful shutdown・アプリごとの安全な終了手順
- アプリ再起動後のプロセス復元（current session 限定。PID 再利用の危険があるため過去セッションは停止対象外）
- git commit は未実施（指示があってから）

## 2026-07-07 (010 Runtime Status)

### 完了したこと

- runtime process registry の**実状態を UI に反映**できるようにした。009 まで完全に楽観的（optimistic）だったメイン画面の状態バッジ／ボタン制御を、Rust 側 registry の `std::process::Child::try_wait()` 結果と突き合わせて更新する。対象は**現在のアプリ起動セッション中に stream-dock が registry に登録したプロセスのみ**（frontend から raw PID / path / command を渡さない・shell 不使用）
- Rust に **状態取得 command 2本**を追加（既存 `launch_*` / `stop_*` の命名規則に合わせて確定）:
  - `list_runtime_processes(registry)`: registry の全 managed process を `try_wait()` で確認し `Vec<RuntimeProcess>` を返す
  - `list_preset_runtime_processes(registry, presetId)`: presetId 空チェック後、`preset_id` 一致の managed process だけを同様に返す（単体起動 007 は `preset_id=None` のため含まれない）
- **状態判定は `try_wait()` のみ**（`service::snapshot`）: `Ok(None)`→`Running` / `Ok(Some(_))`→`Stopped`（`endedAt` 付与）/ `Err(_)`→`Error`（安全な短文の `errorMessage` 付与）。終了・エラーを検知した launchId は registry から除去して `Child` を drop（009 の「停止したら registry から消す」方針に合わせ、その応答で一度 `stopped` を返し以降は不在扱い）。`try_wait()` は非ブロッキングのため lock 保持のまま走査（kill/wait のようなブロッキング操作はしない）
- 状態モデル（ts-rs 生成）: enum `RuntimeProcessStatus`（lowercase: `running` / `stopped` / `error`＝Rust が try_wait で判定できる3状態のみ）＋ `RuntimeProcess { launchId, toolId, toolName, presetId?, presetItemId?, processId, status, startedAt, updatedAt, endedAt?, errorMessage? }`。009 で `#[allow(dead_code)]` にしていた `ManagedProcess.started_at` / `preset_item_id` を本タスクで使用（annotation を除去）
- React 側: API wrapper `features/presets/runtimeApi.ts`（`listRuntimeProcesses()` / `listPresetRuntimeProcesses(presetId)`）を追加し、**コンポーネントは invoke を直接呼ばず wrapper 経由**。`ToolState` に `"stopped"`（バッジ「停止済み」）を追加
- UI 反映（`MainScreen`）: `reconcile()` を新設し、**launchId を主キー**に registry 状態を各行へ写像（`running`→「起動済み」へ昇格し launchId 保持 / registry から消えた行→「停止済み」+ launchId 破棄）。構成再描画・プリセット切替で launchId を失った行も、一括起動由来なら **presetItemId で running プロセスに再関連付け**して復元。`starting` / `stopping` の操作送信中行は上書きしない。`mountedRef` / `presetIdRef` で stale 反映を破棄
- 再取得タイミング（ユーザー選択＝軽い polling＋明示再取得）: **マウント時 / 構成・プリセット切替時 / 単体起動成功後 / 一括起動成功後 / 単体停止後 / Preset 単位停止後**に明示再取得。加えてメイン画面表示中は**約4秒間隔の軽い polling**（`reconcile` は launchId 保持行が無ければ IPC しないため起動プロセスが無い間は no-op・外部通信なし・registry のプロセスのみ対象）。これにより stream-dock 外でプロセスが終了しても数秒以内に「停止済み」へ自動遷移
- ボタン制御: `ToolRow` は既存分岐（running/launched→開く＋停止、starting/stopping→Spinner、その他＝waiting/stopped/error→起動）で 010 の要件（waiting/stopped/error は再起動可・running は停止可・起動中/停止中は disabled）を満たすため**変更なし**。`StatusBadge` は state をそのまま描画するので `stopped` 追加だけで表示。進捗カウント「N / M 起動済み」と一括停止トグルは `launched`／`running` の両方を「起動中扱い」に合算

### macOS `.app` の既知の縮退（013 で対応予定・009 からの継続）

- macOS の `.app` は 007/008 が `/usr/bin/open` 経由で起動するため、registry が掴む `Child` は即終了する `open` ヘルパ。010 の `try_wait()` でも即 `stopped` と判定されるため、**起動直後に「停止済み」表示になる**（実アプリは起動しているが監視できない既知縮退）。Windows(`.exe`)/Linux の直接 spawn 経路では `Child` が実プロセスなので `running` を正しく継続表示する（本命ターゲットは Windows）。macOS の実対応は 013 macOS App Bundle Stop

### 追加ライブラリ

- なし（`std::process::Child::try_wait()`（std）と既存 chrono / ts-rs を再利用。新規 crate・plugin・npm package・状態管理ライブラリなし）

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: 変更 `src/process/model.rs`（`RuntimeProcessStatus` / `RuntimeProcess` 追加）・`src/process/service.rs`（`snapshot` 追加。009 の `spawn`/`stop_one` は不変）・`src/process/commands.rs`（`list_runtime_processes` / `list_preset_runtime_processes` 追加）・`src/process/registry.rs`（`started_at` / `preset_item_id` の `#[allow(dead_code)]` 除去。構造体自体は不変）・`src/lib.rs`（handler に command 2本登録）。`error.rs`・`capabilities/default.json` は**変更なし**
- Frontend（`apps/desktop/src/`）: 生成物 `features/presets/bindings/{RuntimeProcess,RuntimeProcessStatus}.ts` / 新規 `features/presets/runtimeApi.ts` / 変更 `features/presets/types.ts`（runtime 型を re-export）・`types.ts`（`ToolState` に `"stopped"`）・`components/primitives.{tsx,module.css}`（`stopped: "停止済み"` ラベルと `.status.stopped` スタイル）・`screens/main/MainScreen.tsx`（`reconcile` / polling / 停止後 `stopped` 表示 / launched・running 合算）。`screens/main/ToolRow.tsx` は変更なし
- Docs: 変更 `docs/progress.md`（本記録）

### 追加した型（API/JSON は camelCase、status enum は lowercase）

- `RuntimeProcessStatus` = `"running" | "stopped" | "error"`（UI の6状態のうち Rust が try_wait で判定できる3状態のみ。`waiting` / `starting` / `stopping` は UI 専用の操作中一時状態）
- `RuntimeProcess { launchId, toolId, toolName, presetId?, presetItemId?, processId, status, startedAt, updatedAt, endedAt?, errorMessage? }`

### 検証結果

- `cargo check` 成功
- `pnpm --filter ./apps/desktop gen:bindings`（`cargo test export_bindings`）成功（19 tests ok。`RuntimeProcess` / `RuntimeProcessStatus` 新規生成）
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（59 modules）
- ※ `check:bindings` は生成物が未コミットのため diff で exit 1（＝生成は最新・コミット前という想定どおり）。コミット時に bindings 差分を含める
- ※ `pnpm tauri dev` の実機 E2E（単体起動→「起動中」→約数秒で「起動済み」＋停止ボタン／単体停止→「停止済み」→再起動可／一括起動→成功 running・失敗 error／一括停止→対象 stopped・失敗は起動中へ／起動アプリを OS 側で閉じる→約4秒以内に「停止済み」／プリセット切替・編集で 004〜009 非破壊／macOS `.app` は既知縮退で即 stopped・`.exe`/Linux は running 継続）は表示環境が必要なためユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠 / process 状態確認処理追加のため security-review 推奨）

- 状態確認は `std::process::Child::try_wait()` のみ（`tasklist` / `ps` / `pgrep` / `cmd /C` / `sh -c` / `powershell` なし・shell 非経由）
- frontend からは何も（`list_runtime_processes`）または `presetId` のみ（`list_preset_runtime_processes`）。任意 PID・path・command で状態確認できない。registry 未登録のプロセスは状態確認対象にしない。ユーザーが手動起動したプロセスは監視しない
- `check_process` / `watch_process` / `list_os_processes` / `get_process_by_pid` / `kill_process` 等の汎用危険 command を追加していない（限定的な `list_runtime_processes` / `list_preset_runtime_processes` のみ）
- Tauri capabilities / permissions 変更なし（自作 command は `core:default` でカバー）
- `errorMessage` は環境変数・フルパス・スタックトレースを含まない固定文言に丸め。ログに機密情報を出さない
- polling は UI 表示中のみ・約4秒間隔（1秒未満の高頻度なし）・IPC のみで外部通信なし・registry のプロセスに限定
- 004〜009 のデータ・既存機能を壊さず、command 2本・モデル2つ・フロント wrapper 1つを追加するのみ（`ToolRow` の分岐や 009 の停止ロジックは不変）

### やっていないこと（今回スコープ外・据え置き）

- アプリ再起動後のプロセス復元・PID だけを使った任意プロセス監視・ユーザー入力 PID の監視・プロセスツリー全体の監視
- 起動完了／ウィンドウ表示完了の厳密検知・CPU / メモリ使用量取得・詳細なログ画面・永続的な起動履歴 DB
- macOS `.app` の実プロセス監視（→ 013 macOS App Bundle Stop）
- 単体起動（007）由来プロセスのプリセット切替を跨いだ復元（preset に紐づかないため。一括起動由来は presetItemId で復元可。単体は同一マウント中のみ launchId で追跡）
- git commit は未実施（指示があってから）

## 2026-07-08 (011 Error Handling / Logs)

### 完了したこと

- ユーザーテストで問題を再現・聞き取り・修正しやすくするため、**統一エラー形式**・**structured log（SQLite `app_logs`）**・**診断 / ログ画面**を追加した（外部送信・telemetry・analytics・crash report・cloud sync は追加していない）
- **エラー型の全面再設計（ユーザー選択）**: `AppError` を enum `{ kind, message }` から **struct `{ code, message, details?, operation?, occurredAt }`** に変更。`ErrorCode` enum（`VALIDATION_ERROR` 等、SCREAMING_SNAKE_CASE）を新設し `AppError.code` と `AppLogEntry.errorCode` で共有。旧変種名に対応するコンストラクタ（`AppError::validation` / `not_found` / `path_not_found` / `duplicate_path` / `duplicate_name` / `duplicate_tool_in_preset` / `launch_failed` / `unsupported_file_type` / `storage` / `internal`）＋ `with_details` / `with_operation` ビルダを用意し、services/commands の全呼び出し（~33 箇所）を機械的に置換
  - frontend で `AppError.kind` に分岐する箇所は無く（`toErrorMessage` は `.message` のみ参照）、wire 変更後も既存のエラー表示は message で動作（コメントのみ更新）
- **機密情報の安全化**（011 の重要目的）:
  - `process::service::spawn` / `tools::service::validate` の `PathNotFound`・`DuplicatePath` が message に**フルパスを連結していた**のを、安全な固定文言に変更し `details` は**ファイル名のみ**（`Path::file_name`）に限定
  - `.lnk` / `.bat` 拒否を `Validation` から `unsupported_file_type`（`UNSUPPORTED_FILE_TYPE` / 「このファイル形式は現在未対応です。」）へ
  - `From<rusqlite::Error>` は生の rusqlite 文字列（DB パスを含みうる）を**frontend にも log にも載せず**、固定文言＋`StorageFailed` に丸め
- **structured log（SQLite `app_logs`）**: 新規 `src/app_logs/{mod,model,repository,service,commands}.rs`（004 の4層パターン踏襲、DbState は `tools::commands::DbState` を再利用、同一 `stream-dock.db` に `app_logs` テーブル追加）。`AppLogEntry { id, level, category, operation, message, errorCode?, toolId?, toolName?, presetId?, presetName?, presetItemId?, launchId?, processId?, occurredAt }`。level=info/warn/error、category=tool/preset/preset-item/process-launch/bulk-launch/process-stop/runtime-status/storage/ui。enum ⇔ DB 文字列は serde_json 経由で naming を単一ソース化
- **ログ取得 command 3本**（限定的な内部ログ取得のみ・危険な汎用 command なし）:
  - `list_app_logs(db, limit?)`: 直近ログを返す。**limit は Rust 側で clamp（既定 50・最大 200）**。任意 SQL / 検索条件は受け取らない
  - `get_diagnostic_summary(db, registry)`: `DiagnosticSummary { generatedAt, appVersion(env!("CARGO_PKG_VERSION")), recentErrors, recentWarnings, runtimeProcesses }`。full path / 環境変数を含めない
  - `clear_app_logs(db)`: ユーザーテストの履歴リセット用
- **既存操作へのログ記録**（spawn/kill 中は DB ロック非保持を守るため、command 層で結果確定後に短時間ロックして記録。ログ失敗は握りつぶす）:
  - `launch_tool` 成功/失敗、`launch_preset` 開始/全成功/一部失敗(`BULK_LAUNCH_PARTIAL_FAILED`)/全失敗(`BULK_LAUNCH_FAILED`)、`stop_process`/`stop_preset_processes`（stopped/already-exited(`PROCESS_ALREADY_EXITED`)/failed(`STOP_FAILED`)）、runtime status の Error 検知(`RUNTIME_STATUS_FAILED`)
  - CRUD（tools/presets/preset_items の create/update/delete/add/remove/reorder）は `log_command_err` を1行追加し、保存処理失敗・validation error を記録
- React 側: 新規 `features/logs/{types,logsApi,useLogs}.ts` ＋ 生成 `features/logs/bindings/`。**コンポーネントは invoke を直接呼ばず API wrapper 経由**（`listAppLogs` / `getDiagnosticSummary` / `clearAppLogs`）
- UI: 新規 `screens/diagnostics/DiagnosticsScreen.tsx`（Screen union に `"diagnostics"` 追加、サイドバー下部の「🩺 診断 / ログ」から開く）。**直近エラー / 簡易ログビュー（発生時刻・level・category・operation・message・関連 Tool/Preset 名・error code を表示）/ 診断サマリー（readonly textarea ＋「コピー」ボタン）**。stack trace / full path / raw Rust error は表示しない。コピーは `navigator.clipboard`（失敗時は textarea select フォールバック）で **capabilities / plugin 追加なし**

### `.gitignore` の修正（要確認）

- ルート `.gitignore` の `logs`（Node のログ出力無視）が **`apps/desktop/src/features/logs/` のソースまで無視**していたため、`!apps/desktop/src/features/logs/` の除外規則を追加した（この feature を版管理・コミット対象にするため）。Rust 側の ts-rs `export_to` パス（`features/logs/bindings/`）はそのまま

### 追加ライブラリ

- なし（既存の rusqlite / uuid / chrono / serde / serde_json / ts-rs を再利用。新規 crate・plugin・npm package なし）

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: 新規 `src/app_logs/{mod,model,repository,service,commands}.rs` / 変更 `src/error.rs`（AppError struct 化・ErrorCode 追加）・`src/lib.rs`（`mod app_logs`・init・handler 3本）・`src/process/{commands,service}.rs`（ログ記録・パス安全化・safe_launch_message 簡素化）・`src/tools/{commands,service}.rs`・`src/presets/{commands,service}.rs`・`src/preset_items/{commands,service}.rs`（コンストラクタ置換・log_command_err）
- Frontend（`apps/desktop/src/`）: 新規 `features/logs/{types,logsApi,useLogs}.ts` ＋ 生成 `features/logs/bindings/*`・`screens/diagnostics/DiagnosticsScreen.{tsx,module.css}` / 変更 `types.ts`・`App.tsx`・`components/Sidebar.tsx`・`features/tools/useTools.ts`（コメント）・生成 `features/tools/bindings/{AppError,ErrorCode}.ts`
- 設定 / docs: `apps/desktop/package.json`（check:bindings に logs/bindings 追加）・`.gitignore`（上記）・`docs/progress.md`（本記録）

### 検証結果

- `cargo check` 成功（warning 0）
- `pnpm gen:bindings`（`cargo test export_bindings`）成功（24 tests ok。ErrorCode / AppLogEntry / DiagnosticSummary / LogLevel / LogCategory を新規生成、AppError を再生成）
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（63 modules）
- ※ `check:bindings` は生成物が未コミットのため diff で exit 1（＝生成は最新・コミット前という想定どおり）。コミット時に bindings 差分を含める
- ※ `pnpm tauri dev` の実機 E2E（存在しないパス/.bat/.lnk 起動で安全な message＋ログに `LAUNCH_FAILED`/`UNSUPPORTED_FILE_TYPE`／一括の一部・全失敗ログ／停止失敗・already-exited／validation error・保存失敗ログ／診断画面の直近エラー・ログビュー・サマリーコピー／フルパス非表示／004〜010 非破壊）は表示環境が必要なためユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠 / 実装後に security-review 推奨）

- ログ保存先は Rust 固定（`stream-dock.db` の `app_logs`）。frontend から任意 path / SQL / 検索条件を渡せない。`list_app_logs` の limit は Rust 側 clamp
- message / details / log に環境変数・stack trace 全文・secret・不要なフルパス・OS ユーザー名を出さない。`path_not_found` はファイル名のみ、DB エラーは固定文言、raw rusqlite 文字列は非永続
- 診断サマリーに full path を出さない（runtimeProcesses は既存のサニタイズ済みフィールドのみ）
- 外部通信 / telemetry / analytics / crash report / cloud sync を追加していない。危険な汎用 command（read_file / write_file / execute_sql 等）を追加していない（限定的な `list_app_logs` / `get_diagnostic_summary` / `clear_app_logs` のみ）
- Tauri capabilities / permissions 変更なし（コピーは webview clipboard、plugin 不要）。004〜010 のデータ・既存機能・DB スキーマは非破壊（別テーブル `app_logs` 追加のみ）

### やっていないこと（今回スコープ外・据え置き）

- 外部送信ログ / telemetry / analytics / crash report / cloud sync / Sentry 連携 / 遠隔ログ収集
- 詳細なログ検索・高度なフィルタリング・永続的な監査ログ基盤・ログローテーション本格実装・OS イベントログ連携
- ログの任意 export（011 では必須にしない）
- git commit は未実施（指示があってから）

## 2026-07-08 (011 フォローアップ: security-review 指摘対応)

### 背景

011 実装後の security-review で以下を検出し、堅牢化（防御的）方針で対応した。

- **Med**: CRUD エラーの `AppError.message`（`duplicate_name` はユーザー入力のプリセット名を埋め込む）が `log_command_err` 経由で `app_logs` に永続化され、Error レベルのため**診断サマリー（開発者へ共有する copy テキスト）にプリセット名が流出**していた。docs/security.md §9「ログに任意ユーザー入力を残さない／共有用サマリーに出さない」に該当。

### 完了したこと

- **Med 修正（CRUD ログの code 由来文言化）**:
  - `error.rs` に `ErrorCode::log_message(&self) -> &'static str` を追加。全 15 code ごとの**ユーザー入力・フルパス・環境情報を含まない静的文言**を返す。ログ／共有サマリー用で、frontend 向けの詳細 `AppError.message` とは役割を分離
  - `app_logs::service::log_command_err` を、`e.message` ではなく **`e.code.log_message()`** を記録するよう変更（`.error_code(e.code)` は維持）。これで CRUD 失敗ログが raw message（＝ユーザー入力）を一切永続化しない構造に
  - `presets::service` の `duplicate_name` message は**変更せず**（frontend には名前入りの詳細文言を返して UX 維持。漏洩はログ側で断ち切る方針）。UUID を含む `not_found` 系メッセージも据え置き（機密でなく、id はデバッグに有用）
- **Low 修正（安全な手当て）**:
  - `DiagnosticsScreen.tsx`: 「コピーしました」表示を戻す `setTimeout` の id を `useRef` に保持し、アンマウント時 `useEffect` cleanup で `clearTimeout`。連打時は張り替え前に前回タイマーをクリア（多重タイマー防止）
  - `app_logs::commands::get_diagnostic_summary` の doc に、`snapshot` の reap 副作用（終了検知プロセスを registry から除去）と db→registry のロック順序（唯一の同時保持箇所）を明記（挙動は不変）

### 変更した主要ファイル

- Rust: `src/error.rs`（`ErrorCode::log_message` 追加）・`src/app_logs/service.rs`（`log_command_err` 変更）・`src/app_logs/commands.rs`（doc 追記）
- Frontend: `src/screens/diagnostics/DiagnosticsScreen.tsx`（timer 後始末）
- docs: `docs/progress.md`（本記録）

### 検証結果

- `cargo check` 成功（warning 0）
- `pnpm --filter ./apps/desktop check:bindings` … `ErrorCode` / `AppError` の wire は不変のため**bindings 差分ゼロ**（impl メソッド追加のみ）
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- ※ 実機 E2E（既存名プリセットで作成/編集 → frontend は名前入りエラー表示／診断サマリーには `DUPLICATE_NAME` 固定文言のみでプリセット名が出ない／コピー後の画面遷移で警告なし／004〜010 非破壊）は表示環境が必要なためユーザー環境での確認を推奨

### やっていないこと（据え置き・別タスク）

- `AppError.operation` 未設定フィールドの削除／配線（wire に出ているが常に None。害はないため据え置き）
- ログ並び順の tie-break 改善（同一 `occurred_at` は id DESC のため表示順が稀に前後する。機能影響なし）
- process 経路の Info ログ（tool.name 入り）の文言変更（Info はサマリー非対象・structured field は設計どおり）
- git commit は未実施（指示があってから）

## 2026-07-08 (012 Rust Common Helper Refactor)

### 完了したこと

- 004〜011 で各モジュール（tools / presets / preset_items / process / app_logs）に散在していた**同一イディオムの重複コード**を、薄い共通ヘルパ1モジュール `src-tauri/src/util.rs` に抽出し、呼び出し側を機械的に差し替えた。**挙動・検証ルール・メッセージ文言・チェック順序・DB スキーマ・bindings 出力を一切変えない純リファクタ**（下位プリミティブのみ抽出。検証フロー自体は各モジュールに残置）
- 着手前に実コードを `grep` で再スキャンし、012 仕様（007 時点の行番号）とのズレ（011 で AppError が struct 化・path 系メッセージが安全化・now 呼び出しが app_logs/process に増加）を反映した

### 新設した共通ヘルパ（`src-tauri/src/util.rs`・すべて薄く保持）

- `now_rfc3339() -> String` … `chrono::Utc::now().to_rfc3339()` の単一定義
- `normalize_optional(&Option<String>) -> String` … 任意フィールドの trim 正規化（None は空文字）
- `require_non_empty(&str, message) -> AppResult<()>` … trim 後に空なら Validation エラー
- `reject_control_chars(&str, message) -> AppResult<()>` … 制御文字を含めば Validation エラー
- `with_filename_detail(AppError, &Path) -> AppError` … `path_not_found`/`duplicate_path` 共通の「file_name のみを details に付与（フルパス非露出）」定型を集約。付与元の AppError は呼び出し側が渡すため各サイト固有の安全文言は不変

### 差し替え内容（再スキャン済みの正確な位置）

- `now_rfc3339()`: `chrono::Utc::now().to_rfc3339()` の**全17箇所**を置換（`error.rs`・tools/presets/preset_items/process の各 service・`process/commands.rs`・`app_logs/service.rs`）。011 で増えた新規箇所と定義元の `error.rs` も含め single-source 化
- `normalize_optional`: `tools/service.rs`（description/icon_label）・`presets/service.rs`（description）の3箇所
- `reject_control_chars`: `tools/service.rs`（name/executable_path）・`presets/service.rs`（name/description）の4箇所
- `require_non_empty`: service 層の clean な6箇所（tools name/executable_path・presets name・preset_items presetId/toolId・process path_str）
- `with_filename_detail`: `tools/service.rs`（path_not_found / duplicate_path）・`process/service.rs`（path_not_found）の3箇所

### 明示的に触っていないもの（挙動差分・スコープ膨張回避）

- `process/commands.rs` の必須チェック（toolId/presetId/launchId 空チェック）… ログ記録（`log(...)`）が絡む複合処理のため、`require_non_empty` 単純置換だとログ副作用が失われる。挙動不変を守り据え置き
- `process/service.rs` の `enabled.is_empty()`（Vec 空判定・文言別）、`process/commands.rs` の `result.tool_id.is_empty()`（分岐）… 意味が別のため対象外
- 検証ルール・文言・順序の変更／起動時と登録時のパス検証の統合／新機能・新 command・DB スキーマ・bindings 変更／新規ライブラリ・capabilities 追加／React 側変更／trait 化などの過剰抽象化

### 追加ライブラリ

- なし（`chrono`（既存）のみ利用。新規 crate・plugin・npm package なし）

### 変更・作成した主要ファイル

- 新規: `apps/desktop/src-tauri/src/util.rs`（5ヘルパ）
- 変更（Rust）: `src/lib.rs`（`mod util;` 追加）・`src/error.rs`・`src/tools/service.rs`・`src/presets/service.rs`・`src/preset_items/service.rs`・`src/process/service.rs`・`src/process/commands.rs`・`src/app_logs/service.rs`
- 変更（docs）: `docs/progress.md`（本記録）
- React / bindings / capabilities / Cargo.toml / DB スキーマは変更なし

### 検証結果（挙動不変の証跡）

- `cargo check` 成功（warning 0）
- `pnpm --filter ./apps/desktop gen:bindings` 成功（24 tests ok）→ **bindings 生成物に差分ゼロ**（型・wire・挙動が不変であることの証跡）
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功
- `git diff --stat`: Rust 8ファイル変更 + `util.rs` 新規（45 insertions / 67 deletions）で計画どおりの範囲に収まる
- 挙動差分ゼロの確認: 差し替え前後で各エラー message / details / チェック順序が同一（ヘルパは同一ロジックの機械的抽出。`grep` で `to_rfc3339` / `any(char::is_control)` / `as_deref().unwrap_or` の残存が `util.rs` の定義のみになったことを確認）
- ※ `pnpm tauri dev` の 004〜007 主要動線（Tool CRUD / Preset CRUD / PresetItem 並び替え・ordered/parallel / Tool 単体起動）の実機非破壊確認は表示環境が必要なためユーザー環境で実施

### セキュリティ確認（docs/security.md 準拠・検証強度を下げない）

- 純内部リファクタ。外部通信・危険 command・capabilities・依存追加なし
- 空・制御文字・実在・絶対パス・拡張子拒否の検証はすべて現状の文言・順序のまま維持（ヘルパは同一ロジックの抽出）
- `path_not_found` / `duplicate_path` の details は引き続きファイル名のみ（フルパス非露出）。`safe_launch_message` / `LaunchFailed` 固定文言・ログ方針は不変

### やっていないこと（今回スコープ外・据え置き）

- `process/commands.rs` の必須チェック共通化（ログ副作用があるため据え置き）
- git commit は未実施（指示があってから）

## 2026-07-08 (013 macOS App Bundle Stop)

### 完了したこと

- macOS の `.app` を stream-dock から**実際に停止**できるようにし、あわせて **010 Runtime Status の macOS 誤表示**（起動直後に「停止済み」）も解消した。009/010 は変更せず、起動処理（`spawn`）1点の修正で両方の縮退を根本解消
- **根本原因**（007/008 からの申し送り）: macOS `.app` を `/usr/bin/open` 経由で起動していたため、009 registry が掴む `std::process::Child` が即終了する `open` ヘルパになり、`stop_one` の `try_wait()` が常に `already-exited`（実アプリが止まらない）、`snapshot` の `try_wait()` が即 `Stopped`（起動直後に「停止済み」誤表示）になっていた
- **採用アプローチ = (a) バンドル内実体バイナリの直接 spawn**（ユーザー確定）。macOS `.app` を `/usr/bin/open` ではなく `Contents/MacOS/<CFBundleExecutable>`（実体バイナリ）を `std::process::Command` で直接 spawn するよう `process::service::spawn` の `is_app_bundle` 分岐を変更。掴む `Child` が実アプリになるため、**registry / `stop_one`（kill）/ `snapshot`（try_wait）は無改修**で 009 の停止・010 の状態監視がそのまま効く（Child ベース機構を再利用）
- **(b) を採らなかった理由**: registry・停止・状態がすべて `ManagedProcess.child: Child` 前提のため、open 後に実 PID を照合する (b) は raw PID kill 用の別経路・新規依存・PID 再利用対策が必要で変更面が大きく広がる。(a) は変更が `spawn()` の macOS 分岐1箇所に閉じる
- **CFBundleExecutable の解決**: 新規ヘルパ `resolve_bundle_executable(bundle: &Path) -> AppResult<PathBuf>` を追加。`Contents/Info.plist` を `plist` crate で読み `CFBundleExecutable` を取得 → `Contents/MacOS/<exec>` を組み立て。ディレクトリ走査ヒューリスティックではなく Info.plist を正とすることで、バンドル名 ≠ 実体名のアプリ（例: Visual Studio Code.app → `Electron`）も正確に解決
- **起動時検証（Layer B）は不変**: 空でない / 絶対パス / 実在 / ディレクトリ拒否（`.app` のみ例外）/ `.lnk`・`.bat` 拒否は 007/008 のまま維持（検証強度を下げない）。Windows(`.exe`)/Linux の直接 spawn 経路（`else` 側）は不変

### 追加ライブラリ（理由）

- `plist`（1.x, 実際に解決されたのは 1.10.0）: macOS `.app` の `Contents/Info.plist` から `CFBundleExecutable`（実体バイナリ名）を解決するために追加。XML/バイナリ両 plist に対応した**読み取り専用パーサ**で、network/fs/shell/updater 系の強権限を要求しない。用途は Info.plist の当該キー読み取りに限定（CLAUDE.md「新ライブラリは理由明記」/ security.md §10「依存を増やしすぎない」に沿って最小用途で導入）
- 実体は macOS 分岐からのみ利用。呼び出し側（`if is_app_bundle` ブロック）は全プラットフォームでコンパイルされるため dead_code 警告は出ない（`cargo check` warning 0）

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: `Cargo.toml`（`plist` 追加）・`src/process/service.rs`（`spawn` の macOS 分岐を実体バイナリ直接 spawn に変更・`resolve_bundle_executable` 新規・`PathBuf` import 追加・009 既知縮退の doc を 013 解消済みに更新）
- 触っていない: `process/{registry,commands,model}.rs`（`ManagedProcess.child: Child` / `process_id` は既存のまま流用）・型 bindings（wire 不変）・`capabilities/default.json`・DB スキーマ・React 側・Windows/Linux 経路

### path traversal 防御（security）

- `CFBundleExecutable` は悪意ある `.app` なら任意値を持ちうるため、`resolve_bundle_executable` で **空 / `/` を含む / `..` を含む値を拒否**し、`Contents/MacOS/` 直下の**実在する通常ファイル**（`is_file()`）に限定。バンドル外・親ディレクトリへの脱出を防ぐ
- 解決失敗・plist 破損・実体不在はいずれもフルパスや plist 内容を露出させず固定文言 `launch_failed`（「プロセスの起動に失敗しました」）に丸め（`spawn` の他エラー・`with_filename_detail` のサニタイズ方針と整合）

### 検証結果

- `cargo check` 成功（warning 0。`plist` 1.10.0 のコンパイル込み）
- `cargo test export_bindings` 成功（24 tests ok）→ **bindings 生成物に差分ゼロ**（型・wire・挙動が不変であることの証跡。`gen:bindings` のコミット不要）
- `pnpm --filter ./apps/desktop typecheck` 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）成功（63 modules）
- ※ `pnpm tauri dev` の macOS 実機 E2E（`.app` を起動 → 単体停止 / Preset 単位停止で実アプリが終了する ／ 起動後に Runtime Status が「起動済み(running)」を継続表示し実アプリ終了時に「停止済み」へ遷移する ／ Electron 系など bundle 名 ≠ exec 名の `.app` でも起動・停止できる ／ 存在しないパス・非 .app ディレクトリ・.bat は従来どおりエラー ／ Windows・Linux 経路〈004〜010〉が非破壊）は表示環境が必要なためユーザー環境での確認を推奨

### セキュリティ確認（docs/security.md 準拠 / 起動処理変更のため security-review 必須）

- shell 非経由: `/usr/bin/open` を廃し `Command::new(<exec>)` の直接 spawn。`sh -c` / `open` のシェル展開なし・文字列連結でコマンド生成なし・path は配列（`Command::new`）で明示、追加引数なし
- frontend からは toolId / presetId のみ。任意 path / command を渡せない。exec の解決元は登録済み `executablePath`（Layer A/B 検証済み）配下の Info.plist に限定
- path traversal 防御（上記）でバンドル外実行を防止。情報漏洩なし（固定文言に丸め）
- 停止・状態は不変（`stop_one` の `kill` / `snapshot` の `try_wait` は無改修で registry 内プロセス限定）。raw PID kill・プロセスツリー停止・常時死活監視は追加していない
- Tauri capabilities / permissions 変更なし・外部通信追加なし・危険な汎用 command 追加なし・DB スキーマ不変

### やっていないこと / 既知の残課題（今回スコープ外・据え置き）

- **LaunchServices 非経由による挙動差**: 単一インスタンス制御・アクティベーション・既起動アプリの再アクティブ化が効かず、直接 spawn は常に新インスタンスを起動しうる（streaming ツール用途では許容範囲と判断。バンドル内 exec を起動するため `NSBundle.mainBundle` 等のバンドル文脈自体は正しく解決される）
- graceful shutdown・プロセスツリー全体停止・常時死活監視ループ・OS/アプリ再起動後のプロセス復元
- git commit は未実施（指示があってから）

## 2026-07-08 (013 修正 v2: 直接spawn退行の是正 / open起動＋実PID方式へ)

### 背景（v1 の退行）

013 v1（直接 spawn 方式）の macOS 実機 E2E で、`/System/Applications/Calendar.app` を起動すると
**「Calendar が予期しない理由で終了しました」というクラッシュ**が発生した。クラッシュレポートの要点:
`Exception Type: EXC_CRASH (SIGKILL (Code Signature Invalid))` / `_dyld_start` / `dyld_path_missing` /
`main_executable_path_missing` / `dyld_process_snapshot_get_shared_cache failed` / `Parent Process: stream-dock`。

### 根本原因（approach (a) 自体の限界・実装バグではない）

`.app` の実体 Mach-O バイナリ（`Contents/MacOS/<CFBundleExecutable>`）を `std::process::Command` で
**直接 exec すると LaunchServices を通らず**、macOS の **launch constraints（起動制約, macOS 13+）と
コード署名の起動コンテキスト検証**に違反する。Apple システムアプリ（`/System/Applications/` 配下）は
「launchd/LaunchServices からのみ起動可」の制約を持つため、親プロセスが stream-dock だとカーネルが
即 SIGKILL する。→ **`.app` の汎用起動には `/usr/bin/open`（LaunchServices）が必須**で、直接 spawn は不採用。

### 完了したこと（open 起動へ差し戻し ＋ 実 PID 方式で 009/010 を達成）

- **起動を `/usr/bin/open` に戻す**（007/008 と同じ・全アプリで安定。system/サードパーティ両方が起動可）。
  固定絶対パス・バンドルパスは配列引数（shell 非経由・文字列連結なし）。
- **実アプリ PID を同定して registry に載せる（approach b・ユーザー確定）**: `open` 実行の前後で
  「exe の親が `<bundle>/Contents/MacOS` の実行中プロセス」の PID 集合を差分（before/after）し、
  **新規に現れた PID を優先採用**（最大 ~2 秒ポーリング）。新規が出ない再アクティブ化時は既存一致 PID を採用。
  同定時の exe 絶対パスを **PID 再利用ガード**用に保持する。
- **停止（009）**: macOS `.app` は保持 PID が生存かつ exe 一致なら `sysinfo` で kill（SIGKILL）。exe 不一致・
  不在なら「既終了」扱いで**絶対に kill しない**（PID 再利用による他プロセス停止を防止）。shell 非経由。
- **状態（010）**: macOS `.app` は保持 PID の生存＋exe 一致で `Running` / それ以外 `Stopped`。これにより
  「起動直後に停止済み」と「停止しても止まらない」の両縮退が解消。
- **registry ハンドルの一般化**: `ManagedProcess.child: Child` → `child: Option<Child>` ＋ `exe_path: Option<PathBuf>`。
  Windows/Linux/非バンドルは従来どおり `child = Some(...)`（`try_wait`/`kill`/`wait` は挙動不変）。macOS `.app` は
  `child = None` ＋ PID/exe で管理。enum ではなく Option にして非 macOS の未構築 variant による dead_code を回避。
- **spawn の戻りを一般化**: `spawn(&Tool) -> AppResult<Spawned { process_id, child, exe_path }>`。
  `register` も `Spawned` を受け取る形に変更（`launch_tool` / `launch_one` の呼び出しを更新）。起動時検証
  （空/絶対パス/実在/ディレクトリ拒否〈.app 例外〉/`.lnk`・`.bat` 拒否）は 007/008 から不変。
- v1 で入れた**直接 spawn 分岐・`resolve_bundle_executable`・`plist` 依存は撤去**。

### 依存の変更（理由）

- **撤去**: `plist`（v1 で追加）。open 起動＋PID 同定では Info.plist を読む必要がないため。
- **追加**: `sysinfo`（0.39, **macOS 限定ターゲット依存** `[target.'cfg(target_os = "macos")'.dependencies]`）。
  用途は「自分が `open` で起動した実アプリの PID 解決・生存確認・kill」に限定。Windows/Linux ビルドには
  載せない（014 Windows Build に影響しない）。全使用箇所を `#[cfg(target_os = "macos")] mod macos` に閉じる。

### 変更・作成した主要ファイル

- Rust（`apps/desktop/src-tauri/`）: `Cargo.toml`（plist 撤去・sysinfo を macOS 限定で追加）・
  `src/process/service.rs`（`Spawned` / open 起動＋PID 同定 `macos::launch_app_bundle` / `stop_by_pid` /
  `is_running` / `stop_one` と `snapshot` を Option<Child>＋PID 両対応化 / register シグネチャ変更 /
  v1 の直接 spawn・resolve_bundle_executable を撤去）・`src/process/registry.rs`（`ManagedProcess` の
  `child: Option<Child>` 化・`exe_path` 追加）・`src/process/commands.rs`（`launch_tool` を Spawned 前提に更新）
- 触っていない: `process/model.rs` と型 bindings（`process_id: u32` を維持＝**wire 不変**）・
  `capabilities/default.json`・DB スキーマ・React 側・Windows/Linux 経路（`child = Some`）

### 検証結果

- `cargo check` 成功（sysinfo 0.39.5 込みで warning 0）
- `cargo test export_bindings` 成功（24 tests）→ **bindings 差分ゼロ**（wire 不変・`gen:bindings` コミット不要）
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `build`（tsc && vite build）すべて成功
- ※ 非 macOS ビルドは当環境（darwin）で実行不可。sysinfo と全使用箇所が `#[cfg(target_os = "macos")]` に
  漏れなく閉じている（`mod macos` 内のみ）ことをコードレビューで担保
- ※ 実機 E2E（macOS・ユーザー環境）で以下を確認予定: **Calendar.app がクラッシュせず起動**（v1 退行解消）/
  `.app` 起動→単体・Preset 単位停止で実アプリ終了 / 起動後 Runtime Status が running 継続→終了で stopped /
  第三者アプリ（OBS/Discord 等）/ 既起動アプリの起動→停止（§6 限界の実挙動）/ 存在しないパス・非 .app・.bat の
  エラー / Windows・Linux 経路（004〜010）非破壊

### セキュリティ確認（docs/security.md 準拠 / 起動・停止処理変更のため security-review 必須）

- **shell 非経由**: 起動は `/usr/bin/open`（固定絶対パス・配列引数）。停止は `sysinfo` のプロセス kill
  （システムコール）で `taskkill`/`kill(1)`/`pkill`/`sh -c`/`osascript` を使わない
- **kill 対象の限定**: stream-dock が `open` した before/after 差分で同定した PID のみ registry に載せ、
  停止・状態確認の直前に **exe パス一致を再検証（PID 再利用ガード）**。プロセス名だけの kill はしない（§6）
- **process 列挙（sysinfo）**: 全プロセス列挙は「自分が起動したアプリの PID 解決」に限定した読み取り専用・
  ローカルのみ。取得情報はログ/画面に出さない・外部送信なし（§9）
- **情報漏洩**: 解決失敗・open 失敗・タイムアウト・停止失敗はすべて固定文言（`launch_failed`/「プロセスの
  停止に失敗しました」）に丸め、フルパス・OS エラーを frontend・app_logs に出さない
- frontend からは toolId/presetId のみ（任意 PID/path/command を渡せない）・capabilities/外部通信の追加なし・
  Windows/Linux 非破壊（sysinfo は macOS 限定＋cfg・`child = Some` 経路は不変）

### 既知の限界 / 残課題（今回スコープ外・据え置き）

- **§6 の緊張**: 既起動アプリの再アクティブ化時（新規 PID が出ない場合）に既存一致 PID を採用しうるため、
  ユーザーが手動起動したインスタンスを管理対象に取り込む可能性がある。security-review で妥当性を確認する
- PID 解決ポーリングによる**起動レイテンシ**（1アプリ最大 ~2 秒・一括起動は逐次で加算）。必要なら後続で最適化
- graceful shutdown（SIGTERM 猶予）・プロセスツリー全体停止・常時死活監視ループ・再起動後の復元
- git commit は未実施（指示があってから）

## 2026-07-09 (013 修正 v3: 品質レビュー指摘の是正 / Handle enum 化・遅延解決)

### 背景

013 v2 の品質レビュー（`/code-review high`）で致命1件＋改善6件を検出。ユーザー承認のもと全7件を是正した。
最重要は **Finding 1**（起動の遅い `.app` が「起動失敗」扱いになり、実際には起動したアプリが registry 未登録＝
停止不能なオーファンになる）。ユーザー選択で **深い正攻法**（registry ハンドルを `Handle` enum 化し、`open` 成功後は
PID 未同定でも登録して遅延解決）を採用した。wire（`process_id: u32`）は不変・bindings 差分ゼロを維持。

### 中核リファクタ: `Handle` enum（`registry.rs`）

- `ManagedProcess` の `process_id: u32` / `child: Option<Child>` / `exe_path: Option<PathBuf>` を単一の
  `handle: Handle` に統合。不正な組み合わせを表現不能にした:
  - `Handle::Child(Child)`（Windows/Linux/非バンドル・全プラットフォーム）
  - `#[cfg(macos)] Handle::MacResolved { pid, exe_path, start_time }`（同定済み）
  - `#[cfg(macos)] Handle::MacUnresolved { exe_dir, deadline }`（open 成功・PID 未同定＝遅延解決待ち）
- macOS 専用 variant を cfg 分岐にしたことで **非 macOS はフィールド自体が存在せず dead_code 警告ゼロ**、
  v2 にあった `stop_managed_by_pid` / `runtime_status_by_pid` の cfg フォールバック関数対と
  `spawn_app_bundle` の `unreachable!` スタブが**不要になり削除**。
- wire は `Handle::wire_pid() -> u32`（未同定は `0`＝`commands.rs` の NotFound と同じ前例）と
  `resolved_pid() -> Option<u32>`（ログ / `BulkLaunchToolResult.process_id` 用）で境界のみ導出。
- `spawn(&Tool) -> AppResult<Handle>`（v2 の `Spawned` 構造体は撤去）。`register` も `Handle` を受け取る。

### 各 Finding の是正

- **Finding 1（致命・オーファン根治）**: `launch_app_bundle` は `open` 失敗のみ `Err`。同定タイムアウト時は
  `Err` にせず `Launch::Unresolved { exe_dir, deadline }` を返し `Handle::MacUnresolved` で登録。以降の
  `snapshot` / `stop` で `exe_dir` から遅延解決する。`deadline`（`RESOLVE_GRACE = 10s`）前は楽観的に
  `Running` 表示、経過後も現れなければ `Stopped`＋reap（偽失敗を恒久ゴーストにしない）。
- **Finding 2（PID 再利用ガード強化）**: 同定時の `start_time` を保持し、`stop_by_pid` / `is_running` の
  再利用ガードを `exe 一致 && start_time 一致` に強化（同一 exe の別インスタンスへの PID 再割当を弾く）。
- **Finding 3（stop の refresh→kill レース）**: `stop_by_pid` は `kill()==false` 時にもう一度リフレッシュし、
  PID が消えていれば `None`（= already-exited）を返す。自然終了直前の停止で「停止失敗」を誤報告し
  dead エントリを registry へ再挿入する退行を解消。
- **Finding 4（一括起動レイテンシ）**: 同期ポーリング窓を `2.0s`（20×100ms）→ `~0.5s`（5×100ms）に短縮
  （タイムアウトが非致命になったため）。速いパス（before 集合で新規 PID 優先）は同期窓に残す。
  一括起動は `launch_one` 逐次のため N×窓 の線形依存は残る（スレッド化は 008 方針に反するため今回はしない）。
- **Finding 5（効率）**: ポーリングで `System` を1つ生成して使い回し（毎周回の `System::new()`＋全列挙を回避）。
  snapshot の遅延解決も **ロック外で `refresh_all()` を1回だけ**呼ぶ3フェーズ構成（重い全列挙を registry
  ロック下で回さない）。複数未同定エントリが同一 PID を取り合わないようパス横断で重複排除。
- **Finding 6（効率）**: ポーリング最終回の無駄な `sleep(100ms)` を除去。
- **Finding 7（文書化のみ・下記「既知の限界」）**: コード変更なし。

### snapshot の3フェーズ構成（ロック保持時間を増やさない）

1. **Phase A（ロック内・軽量）**: `Child::try_wait()` / `MacResolved` の単一 PID 確認を実施。`MacUnresolved` は
   `(launch_id, exe_dir, deadline)` を収集するのみ。解決済み PID は `claimed` に控える。
2. **Phase B（ロック外）**: 未同定エントリを `resolve_pending` で **1 回の全列挙**でまとめて解決。
3. **Phase C（ロック再取得）**: 解決結果を反映（`MacResolved` へ遷移／楽観 Running／deadline 超過は Stopped）し、
   終了検知分を reap。Phase A/B の間に消えたエントリは skip。

### 変更・作成した主要ファイル

- `src/process/registry.rs`: `Handle` enum・`ManagedProcess` の `handle` 化・`wire_pid`/`resolved_pid`・`RESOLVE_GRACE`
- `src/process/service.rs`: `spawn -> Handle`・`macos::Launch`/`Resolution`・`launch_app_bundle`（Unresolved 返却・
  System 使い回し・窓短縮・末尾 sleep 除去）・`stop_by_pid`（start_time ガード＋kill レース）・`is_running`/`stop_unresolved`/
  `resolve_pending`・`stop_one`（Handle match）・`snapshot`（3フェーズ）・`build_runtime` ヘルパ
- `src/process/commands.rs`: `launch_tool`（未同定時は pid ログを省く）
- 触っていない: `process/model.rs`・型 bindings（**wire 不変**）・`Cargo.toml`（sysinfo 0.39 のまま）・
  `capabilities`・DB・React 側・Windows/Linux 経路（`Handle::Child` 一択で挙動不変）

### 検証結果

- `cargo check` / `cargo clippy` 成功（**warning 0**）
- `cargo test export_bindings` 成功（**24 tests** ok）→ **bindings 差分ゼロ**（wire 不変）
- `pnpm typecheck` / `pnpm lint` 成功
- 事前検証: sysinfo 0.39.5 の単一 PID リフレッシュでも `start_time` が取得される（`pbi_start_tvsec` 由来で
  `ProcessRefreshKind` に非依存）ことをクレートソースで確認済み（Finding 2 ガードの前提）
- ※ 非 macOS ビルドは当環境（darwin）で実行不可。macOS 専用コードが `#[cfg(target_os = "macos")]` に
  漏れなく閉じ、非 macOS では `Handle` が `Child` 一択で dead_code が出ないことをコードレビューで担保
- ※ 実機 E2E（macOS・ユーザー環境）で確認予定: 起動の遅い/大型 `.app` を起動 → 「起動失敗」にならず少し後に
  Running で現れ停止できる（オーファンなし）／ 同一 exe の別インスタンスへ PID 再利用されても他人のアプリを
  kill しない ／ 自然終了しかけの停止で「停止失敗」誤報告が出ない ／ 起動済み `.app` 複数のプリセット一括起動の体感改善

### 既知の限界 / 残課題（今回スコープ外・据え置き）

- **Finding 7（複数バイナリ `.app`）**: `same_macos_dir` は `Info.plist` の `CFBundleExecutable` ではなく
  「exe の親が `<bundle>/Contents/MacOS`」の全プロセスに一致する。`Contents/MacOS` 直下に**複数のフラット
  バイナリ**を持つ `.app`（ランチャスタブ＋本体等）では、本体以外の PID を同定・停止しうる（低頻度・アプリ依存）。
  Info.plist を読むと撤去済みの `plist` クレート再導入が必要なため、**既知の限界として据え置く**。
  ネストした `.app`（Electron/Chromium 系）は自分の内側 `Contents/MacOS` が exe 親のため非該当。
- **§6 の緊張（v2 から継続）**: 既起動アプリの再アクティブ化（新規 PID が出ない）や遅延解決時に、ユーザーが
  手動起動したインスタンスを管理対象に取り込む可能性。security-review で妥当性を確認する。
- **一括起動レイテンシ**: 窓短縮で軽減したが `launch_one` 逐次のため線形依存は残る（スレッド化は 008 方針外）。
- graceful shutdown（SIGTERM 猶予）・プロセスツリー全体停止・常時死活監視ループ・再起動後の復元
- git commit は未実施（指示があってから）

## 2026-07-09 (013 レビュー指摘 #1 の是正: MacUnresolved 停止の deadline 尊重)

### 直した問題

品質レビューで、`Handle::MacUnresolved`（`open` 成功だが実プロセスがまだプロセステーブルに現れていない
＝コールドスタート中）に対する停止が、`deadline` を見ずに一律「既終了（already-exited）」と判定して registry
から**エントリを破棄**していた。結果、実プロセス未出現の窓で停止すると、その後に起動したアプリが stream-dock
の管理外で動き続け、以降 停止も 010 状態表示も効かなくなる（`snapshot` 側は `deadline` を尊重して
StillPending 据え置きにしているのに、停止側だけ非対称だった）。

### 変更（`src/process/service.rs` のみ）

- `macos::stop_unresolved` の戻り値を `Option<bool>` → **`UnresolvedStop { Killed(pid) / SendFailed / Gone / NotAppeared }`**
  へ変更。「一致プロセスが列挙に無い（まだ現れていない）＝ `NotAppeared`」を、`stop_by_pid` の `None`
  （同定直後に消えた/再利用＝ `Gone`）と区別できるようにした。
- `stop_one` の `MacUnresolved` 分岐で `deadline` を尊重:
  - `Killed` → `stopped`（同定した実 PID を停止結果へ反映＝レビュー指摘 #6 も是正。従来は pid 0 表示）
  - `SendFailed` → `failed`（ハンドルを戻して再試行可能に）
  - `Gone` → `already-exited`
  - `NotAppeared` → `deadline` 前なら `failed` ＋ **ハンドルを registry へ戻し**、アプリ出現後の再 stop で kill
    できるようにする（snapshot の StillPending と対称）。`deadline` 超過は「起動しなかった」扱いで `already-exited`。
- `StopStatus` / `StopProcessResult` / bindings / 起動処理 / Windows・Linux 経路（`Handle::Child`）は**不変**。

### 検証結果

- `cargo check` **warning 0** / `cargo test export_bindings` **24 tests ok**・**bindings 差分ゼロ**
- `pnpm typecheck` / `pnpm lint` 成功
- 停止判定ロジックの変更のため security-review を再実施予定（013 方針）
- 実機 E2E（macOS）で確認予定: 起動の遅い `.app` を起動 → 実プロセス出現前に停止 →「起動処理中…」の
  `failed` でエントリが残り、出現後の再停止で `stopped` になること（オーファンが残らないこと）
