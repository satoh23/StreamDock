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
