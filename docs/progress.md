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
- その他スキャフォールド生成物一式 (index.html / vite.config.ts / tsconfig\*.json / src/ / src-tauri/)

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

## 2026-07-09 (メイン画面バグ修正 ＋ 全プラットフォーム前面化)

### 今回完了したこと

ユーザー報告のメイン画面バグ7件を調査・修正した（macOS で確認、Windows でも発生しうるもの）。加えて、
当初 MVP で許容としていた「開く」の Windows/Linux 二重起動の縮退を、別対応で根絶した（launchId ベースの
既存ウィンドウ前面化へ設計変更）。

- **バグ1: 「開く」が動作しない → 全プラットフォームで既存ウィンドウを前面化（新規起動しない）**
  - 当初は死にボタン（`onClick` 未配線）。まず `focus_tool(toolId)` を新設したが、Windows/Linux は
    `spawn` フォールバックで**二重起動**する縮退があった。これを是正し、**`focus_process(launchId)`**
    に設計変更。frontend は launchId のみ渡し、Rust が registry から実 PID / Tool を解決して前面化する
    （`stop_process` と同じ設計。**新規インスタンスは絶対に起動しない**）。
    - Windows: 保持 PID とその**子プロセスツリー**（`CreateToolhelp32Snapshot` で親子関係を辿る）から
      トップレベルウィンドウ（可視・オーナー無し・タイトル有り）を `EnumWindows` で特定し、最小化なら
      `SW_RESTORE`、`SetForegroundWindow` のフォアグラウンド制限は `AttachThreadInput` 系の回避で前面化。
    - macOS `.app`: `/usr/bin/open <bundle>`（LaunchServices が既存を前面化・新規起動しない）。
    - Linux / 非バンドル: アクティブ化は非対応（no-op）。ただし二重起動はしない（`spawn` フォールバック廃止）。
- **バグ2: 画面遷移でステータスが「待機中」に戻る（単体起動）** → `launch_tool` に `preset_item_id` 引数を
  追加し、単体起動プロセスも registry に presetItemId を記録。再マウント時の `reconcile(true)` が既存の
  `byPresetItemId` 経路で「起動済み」を復元する（一括起動と同じ復元経路）。preset_id は None のまま
  （一括停止のスコープは不変）。wire 不変・bindings 差分ゼロ。
- **バグ3: インフォメーションの位置** → `launchFeedback` バナーを「起動順」見出しの**上**へ移動（従来は
  起動順とアプリ一覧の間に割り込んで連続カードの seam を割っていた）。margin を調整。
- **バグ4: ツール0件でも「＋ プリセットを追加」が押せる** → `disabled={!hasTools}` ＋ `.ghost:disabled`
  スタイル ＋ ヒント文を追加。
- **バグ5: 空状態が上寄せ** → `.emptyState` を `min-height: 320px` → `min-height: 100%`（box-sizing:
  border-box）にし、`.main` の高さいっぱいで上下左右中央寄せ。
- **バグ6/7: 空状態の文言・遷移ボタン欠如** → `presetName === null` の空状態を `hasAnyTools` で分岐。
  ツール0件は「まだツールがありません」＋「＋ ツールを登録」（add-tool へ遷移）、ツールあり・プリセット
  0件は「まだプリセットがありません」＋「＋ プリセットを追加」（add-preset へ遷移）。App から
  `onNavigate` / `hasAnyTools` を配布。

### 追加ライブラリ（理由）

- `windows`（0.58・**Windows 限定ターゲット依存** `[target.'cfg(windows)'.dependencies]`）: 既存ウィンドウの
  前面化（`EnumWindows` / `SetForegroundWindow` / `ShowWindow` / `CreateToolhelp32Snapshot` 等）に必要。
  features は `Win32_Foundation` / `Win32_UI_WindowsAndMessaging` / `Win32_System_Threading` /
  `Win32_System_Diagnostics_ToolHelp` に限定。macOS/Linux ビルドには載せない（sysinfo の macOS 限定と同じ扱い）。
  用途は「自分が起動した PID のウィンドウ前面化」に限定・外部通信なし。

### 変更した主要ファイル

- Rust（`apps/desktop/src-tauri/`）:
  - `src/process/service.rs` — 検証を `validate_executable()` に抽出（spawn/focus 共通）・`focus(pid, tool)`
    新設（macOS `open` / Windows `windows::focus_by_pid` / Linux no-op）・`#[cfg(windows)] mod windows`
    （プロセスツリー探索＋ウィンドウ前面化）
  - `src/process/commands.rs` — `focus_process(launch_id)` 追加（registry から PID/Tool 解決）・`launch_tool` に
    `preset_item_id` 引数追加し register へ
  - `src/lib.rs` — handler に `focus_process` 登録
  - `Cargo.toml` — `windows` を Windows 限定で追加（`Cargo.lock` 更新）
- Frontend（`apps/desktop/src/`）:
  - `features/tools/toolApi.ts` — `focusProcess(launchId)` 追加・`launchTool(id, presetItemId?)` 拡張
  - `screens/main/ToolRow.tsx` — 「開く」に `onOpen` 配線
  - `screens/main/MainScreen.tsx` — `handleOpen(launchId)`・単体起動で presetItemId 送信・バナー移動・
    空状態分岐＋遷移ボタン・props（`onNavigate` / `hasAnyTools`）追加
  - `screens/main/MainScreen.module.css` — バナー margin・`.emptyState` 100%・`.emptyAction` ボタン
  - `components/Sidebar.tsx` / `Sidebar.module.css` — プリセット追加ボタン非活性化＋ヒント＋`.ghost:disabled`
  - `App.tsx` — MainScreen へ `onNavigate` / `hasAnyTools` を配布
- bindings（ts-rs）・DB スキーマ・capabilities: 変更なし（focus は `()` 返却・launch の wire 不変）

### まだ未完了のこと

- **security-review 未実施**（プロセス操作の追加＝`focus_process` と Windows ウィンドウ前面化、
  `windows` クレート・起動 command の引数追加が対象。`docs/security.md` レビュー必須条件に該当）。
- **実機 E2E 未実施**（GUI 表示が必要）。特に **Windows 実機での「起動→背面化→開くで既存を前面化・二重起動
  しない」** の確認が最重要。macOS の前面化・バグ2〜7 も未確認。手順はチャットで提示済み。
- **Windows / Linux ビルドの未検証**：当環境（darwin）では `#[cfg(windows)] mod windows` と `windows`
  クレートがコンパイルされないため、Windows コードは静的検査で通っていない（下記「既知のエラー」参照）。
- git commit は未実施（指示があってから）。

### 次にやるべきタスク

1. `docs/security.md` 準拠の **security-review**（`focus_process` / Windows 前面化 / `windows` クレート /
   registry の PID 利用範囲＝stream-dock 起動プロセスに限定されているか）。
2. **Windows 実機ビルド＆E2E**（`cargo check`/`clippy` を Windows で通す・二重起動しないことの確認）。
3. macOS 実機 E2E（バグ1〜7）。
4. 問題なければ commit。

### 既知のエラー

- なし（macOS 上の静的検査はすべてクリーン）。
- **注意（未検証領域）**: `#[cfg(windows)] mod windows` と `windows` クレートは darwin ではコンパイル対象外の
  ため、`cargo check`/`clippy` では検証されていない。Windows ビルドで初めて型・API 使用が検査される。

### 実行した確認コマンド（すべて macOS 上・成功）

- `cargo check` → 成功（warning 0）
- `cargo clippy` → 成功（warning 0）
- `cargo test --lib export_bindings` → **24 tests ok**・**bindings 差分ゼロ**（wire 不変の証跡）
- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0 / warning なし）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）→ 成功（63 modules）
- ※ `pnpm tauri dev` の GUI 実機 E2E は表示環境が必要なため未実施

### 次回セッションで最初に読むべきファイル

1. `docs/progress.md`（この節）
2. `CLAUDE.md`（開発ルール・検証コマンド）/ `docs/security.md`（前面化＝プロセス操作のレビュー基準）
3. `apps/desktop/src-tauri/src/process/service.rs`（`focus` / `#[cfg(windows)] mod windows`）
4. `apps/desktop/src-tauri/src/process/commands.rs`（`focus_process` / `launch_tool` の presetItemId）
5. `apps/desktop/src/screens/main/MainScreen.tsx`（`handleOpen` / reconcile / 空状態分岐）・
   `apps/desktop/src/features/tools/toolApi.ts`（`focusProcess` / `launchTool`）

## 2026-07-09 (014 Bulk Stop for Individual Launches)

### 今回完了したこと

プリセットのメイン画面で**個別起動**したツールを「一括停止」で止められない不具合を解消した。

- **根本原因**: `process/commands.rs` の `launch_tool` が単体起動時に
  `service::register(..., None, preset_item_id, ...)` として **`preset_id = None` で登録**していた。
  一方 `stop_preset_processes` は registry を `mp.preset_id.as_deref() == Some(preset_id)` で絞り込むため、
  `preset_id = None` の個別起動プロセスは一括停止の対象に一切入らなかった。メイン画面の個別起動は
  `preset_item_id`（= preset_items.id）を渡しており所属プリセットは特定可能なのに、その情報が
  `preset_id` へ反映されていないだけだった。

- **変更内容（`launch_tool` 一箇所に閉じる）**: Tool 取得と**同じ DB ロックスコープ内**で、
  `preset_item_id` が `Some` のとき `preset_items::repository::get` により所属 `preset_id` を解決し、
  `service::register(..., resolved_preset_id, preset_item_id, ...)` で registry に確定保存するようにした。
  - 該当 preset_item が無い / DB エラーのときは `.ok().flatten()` で `preset_id = None` に**フォールバックし、
    起動自体は失敗させない**（`preset_item_id` を無条件に信用せず、存在確認したうえで解決）。
  - `preset_item_id` の無い個別起動（サイドバー等・プリセット文脈なし）は従来どおり `preset_id = None` で
    一括停止の対象外。
  - `launch_tool` の doc コメント（旧「preset_id は None のまま」）を実態に合わせて更新した。

- **変更が `launch_tool` に閉じている**: `stop_preset_processes` のフィルタロジック・`service::register`
  （既に `preset_id: Option<String>` を受け取る）・registry・013 の macOS `.app` 起動/停止経路はいずれも無改修。
  `git diff --name-only` は `commands.rs` 1ファイルのみ（+26 / -7）。停止側の DB 往復は増やしていない。

### セキュリティ確認（security-review 実施済み）

`docs/security.md`（§6 プロセス停止 / §8 入力検証）に基づき security-review を実施。**問題なし**。

- 停止対象は依然 registry 登録の stream-dock 起動プロセスのみ。スコープの拡大は「プリセット文脈で個別起動した
  registry 内プロセス」に限られ、外部プロセス・手動起動プロセスの取り込みは増えていない（§6）。
- frontend から渡るのは `toolId` / `presetItemId` のみで、`preset_id` は Rust 側で DB から導出。任意 PID /
  path / 任意 preset_id を停止に渡せる経路は生まれていない。偽装 `preset_item_id` は `repository::get` の
  実在確認で弾かれ `None` フォールバックとなる（§8）。
- shell 非経由（`taskkill`/`kill`/`pkill` 追加なし）。008/009/013 の停止経路は不変。Tauri capabilities・
  外部通信・CSP・依存関係は変更なし。DB ロックは spawn/kill 中に保持しない従来設計を維持。

### 実行した確認コマンド（すべて macOS 上・成功）

- `cargo check` → 成功（warning 0）
- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）→ 成功（63 modules）

### 未完了事項

- **実機 E2E 未実施**（ユーザー環境）: プリセット画面で複数個別起動 →「一括停止」で実停止 /
  008 由来の停止が退行しない / サイドバー個別起動は一括停止の対象外 / 所属 preset_item を解決できない
  ケース（削除済み等）でも起動は失敗しない。
- git commit は未実施（指示があってから）。

---

## 2026-07-10 (015 Design Tokens & Color Unification)

### 完了したこと

- 配色を **役割ベースのデザイントークン（CSS 変数）** に集約し、「配色がダサい・見にくい」「ボタン等の色が不統一」を解消。ダーク単色のまま洗練し、色のハードコードをトークンへ寄せた（ライト/ダーク切替・OS 検知・設定は 016 の範囲、015 はその土台）。
- **パレット**: CastDock A案 Clean Dock の `.dark` 値を唯一のパレットとして採用。`.dark`/`prefers-color-scheme` を使う箇所は現状ゼロのため、`.dark` の hex を **`:root` の seed 変数**（`--color-*`）として配置（トグル機構は 016 で追加）。
- **9 個の `*.module.css` の生 hex/rgba（計 192 箇所）を全廃**し、すべて `var(--...)` 参照に置換（grep で 0 件確認）。

### 採用したトークン体系（`apps/desktop/src/styles/theme.css`）

- seed（パレット）: `--color-background #090D18` / `--color-surface #111827` / `--color-surface-elevated #1B2435` / `--color-border #2D3748` / `--color-text #F9FAFB` / `--color-text-muted #9CA3AF` / `--color-text-inverse #090D18` / `--color-primary #2F6BFF` / `--color-secondary #22D3EE` / `--color-accent #A78BFA` / `--color-info #60A5FA` / `--color-success #4ADE80` / `--color-warning #FBBF24` / `--color-error #F87171`
- 役割トークン（既存 `--bg`/`--text`/`--muted`/`--line`/`--accent`/`--accent-2`/`--ok`/`--warn`/`--danger`/`--radius` は温存し値を seed 参照へ更新）:
  - 表面: `--surface` / `--surface-2` / `--surface-hover` / `--surface-subtle` / `--control-bg` / `--control-bg-hover`
  - 境界: `--line` / `--border-soft`
  - 文字: `--text` / `--muted` / `--text-faint` / `--text-inverse` / `--muted-soft` / `--muted-border`
  - アクセント: `--accent`(secondary cyan) / `--accent-2`(purple) / `--accent-soft` / `--accent-soft-border` / `--accent-text`
  - primary（**新規** CTA/選択/フォーカス）: `--primary` / `--primary-soft` / `--primary-soft-border` / `--primary-text`
  - ステータス: `--ok`/`--warn`/`--danger`/`--info` と各 `*-soft` / `*-border`（+ `--warn-border-strong` / `--danger-border-strong` / `--danger-focus` / `--*-text`）
  - ボタン/elevation: `--btn-primary-bg`(secondary↔accent グラデ) / `--btn-primary-fg` / `--shadow-drop` / `--btn-ghost-bg` / `--btn-ghost-border` / `--elev-gradient` / `--elev-border` / `--shadow-1` / `--shadow-inset` / `--overlay-scrollbar` / `--spinner-track`

### パレットのマッピング（役割 → seed）

- 背景=background / カード・パネル=surface / toolbar・panelHead・footer・emptyState=surface-elevated / 標準境界=border / 文字=text・text-muted。
- **primary #2F6BFF は CTA/選択/フォーカスに限定**（広面積禁止）: 選択中プリセット・アクティブ step・選択済みツール・編集トグル ON・空状態 CTA・チェックボックス accent-color を primary 系へ統一。
- secondary #22D3EE（`--accent`）と accent #A78BFA（`--accent-2`）は装飾アクセント（IconTile・parallel バッジ・dropzone・appIcon・previewName・newRow 等）に限定。
- info/success/warning/error → info/ok/warn/danger バッジ・バナー・入力エラー。

### 派生色（color-mix・新基準色は追加せず）

- hover 面 / 弱い境界 / 半透明 white オーバーレイ（input・ghost・chip・elevation グラデ）
- placeholder（muted 72%）/ accent 上の淡色文字 / danger・info・warn の淡色文字
- 各ステータスの弱背景・弱境界 / accent 弱背景・弱境界 / 影・inset ハイライト・scrollbar
- 装飾用ラジアルグロー（startBtn / appIcon / dropzone / toolOption.selected / newRow）は `color-mix(in srgb, var(--accent|--primary) N%, transparent)` で表現

### 設計判断（ユーザー確認済み）

1. プライマリボタンのグラデ両端 → **secondary↔accent（#22D3EE↔#A78BFA）**（現 cyan→purple の雰囲気を継承）
2. 選択・CTA の色 → **primary 青 #2F6BFF に寄せる**（cyan は装飾アクセント限定）
3. パネル/サイドバー等の表面 → **ソリッドに集約**（半透明レイヤー廃止、sidebar/main は `--bg`）

### 置換範囲（生 hex/rgba → var）

- `MainScreen`(51) / `primitives`(31) / `AddPreset`(31) / `Sidebar`(22) / `AddTool`(18) / `Diagnostics`(17) / `formLayout`(12) / `PreviewCard`(9) / `Window`(1) = 192 箇所すべて。

### 検証結果

- `grep -riE '#[0-9a-f]{3,8}\b|rgba?\(' --include=*.module.css` → **0 件**（module.css は完全にトークン参照のみ）
- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）→ 成功（63 modules、CSS 26.11 kB）
- **実機表示（`tauri dev`）は未実施**: 全画面（メイン/ツール追加/プリセット追加/診断/サイドバー/プレビュー）の視覚破綻なしはユーザー環境で確認をお願いしたい。

### やっていないこと（スコープ外）

- ライト/ダーク切替・OS 検知・設定画面（016）/ レイアウト・props/API・文言・アイコン方式の変更 / 新ライブラリ・外部リソース追加なし（§CSP 準拠）。

## 2026-07-10 (016 Light/Dark Theme + Settings)

### 完了したこと

- **ライト値セット**と**テーマ切替（システム / ライト / ダーク）**を追加。既定は OS 設定に追従し、**設定画面**で明示選択・永続化できるようにした（ユーザー要望 4）。015 のトークン体系を土台にライト seed とスイッチ機構を載せただけで、配色トークン自体の再設計はしていない。
- サイドバーに「⚙ 設定」ナビを追加（diagnostics パターン踏襲）。設定画面でテーマ 3 択が**即時反映**、localStorage で**再起動後も保持**、「システム」時は CSS の `prefers-color-scheme` が **OS 変更へライブ追従**。

### テーマ切替の実装方式（frontend のみ / 外部通信なし）

- **CSS（`src/styles/theme.css`）**: seed の `--color-*` をテーマごとに差し替えると、役割トークンは color-mix 派生なのでほぼ全て自動追従する（015 の設計を利用）。
  - 既存 `:root`（015=ダーク）は**丸ごと温存**し「既定」兼「OS ダーク時のシステム追従」を兼ねる（media-dark は :root と重複するため置かない）。
  - `:root[data-theme="dark"]`（明示ダーク・値は 015 と同一）/ `:root[data-theme="light"]`（明示ライト）/ `@media (prefers-color-scheme: light) { :root:not([data-theme]) }`（システム時 OS ライト）を追加。
  - 切替の勝ち負け: システム→ダークは `data-theme="dark"` で base(dark) 適用＆media-light を `:not([data-theme])` で無効化。システム→ライトは `[data-theme="light"]`(0,2,0) が `:root`(0,1,0) に勝つ。両方向でトグルが勝つことを確認。
- **状態/永続化**: `ThemePreference = "system" | "light" | "dark"`（既定 `system`）。localStorage キー **`stream-dock.theme`（1 個）**、不正値・例外は `system` にフォールバック（`features/theme/theme.ts`）。
- **反映**: `document.documentElement` に `system`→`removeAttribute("data-theme")` / `light|dark`→`setAttribute`。`useTheme()` フックが保存＋DOM反映を担い、App.tsx から SettingsScreen へ props で渡す。
- **FOUC 防止**: `main.tsx` で React render 前に `applyThemePreference(loadThemePreference())` を同期適用。
- **matchMedia 監視は不採用**: 「システム」時は data-theme 未設定で CSS の media が OS 変更へ自動追従するため、JS 側の監視は不要（任意項目）。

### ライト値マッピング（seed = CastDock A案 パレット `:root`）

| 役割 seed                        | ライト                                        | ダーク(015=パレット.dark)                     |
| -------------------------------- | --------------------------------------------- | --------------------------------------------- |
| primary                          | `#0036CB`                                     | `#2F6BFF`                                     |
| secondary                        | `#00A3B5`                                     | `#22D3EE`                                     |
| accent                           | `#7C3AED`                                     | `#A78BFA`                                     |
| background                       | `#F7F8FA`                                     | `#090D18`                                     |
| surface                          | `#FFFFFF`                                     | `#111827`                                     |
| surface-elevated                 | `#EEF2F7`                                     | `#1B2435`                                     |
| text                             | `#111827`                                     | `#F9FAFB`                                     |
| text-muted                       | `#6B7280`                                     | `#9CA3AF`                                     |
| text-inverse                     | `#FFFFFF`                                     | `#090D18`                                     |
| border                           | `#D7DEE8`                                     | `#2D3748`                                     |
| info / success / warning / error | `#2563EB` / `#16A34A` / `#F59E0B` / `#DC2626` | `#60A5FA` / `#4ADE80` / `#FBBF24` / `#F87171` |

- **015 のダーク seed はパレット `.dark` と完全一致**（齟齬なし・勝手な変更なし）。

### ライトで個別上書きした「ダーク前提の派生」（新色は足さない）

1. `-text` 系（015 は `mix(色, #fff)` で暗い面用の明るい文字を作る）を、ライトでは **mix 先を `var(--color-text)`(=#111827)** に再導出: `--accent-text` / `--primary-text` / `--warn-text` / `--danger-text` / `--info-text`（白地の淡いソフト背景に暗い文字が載るように）。
2. `--btn-primary-fg`（base=`var(--text)`）は、ライトの CTA グラデ（teal→purple）で暗い文字が判読不能になるため **`var(--color-text-inverse)`(=#FFFFFF)** に上書き。

- いずれも**パレット既存色のみ**を使用。新たな基準色の追加は無し。

### 派生色の判断（ユーザー確認済み）

- `--elev-gradient`（一括停止ボタン背景 & カード面。`mix(text 10%→5%, transparent)`）: ライトでは「白地に薄いグレーのティント」に自動追従しコントラストは保たれる → **そのまま自動追従で採用**（ライト個別上書きなし・新色ゼロ・最小変更）。
- 影（`--shadow-1` = 黒 12%）は白地でも標準的に成立するため**維持**。
- 相談が必要な不足色は**無し**（すべてパレット既存色＋派生で表現可能）。

### 作成・変更ファイル

- 変更: `styles/theme.css`（テーマブロック追加・既存 :root 温存）/ `types.ts`（`Screen` に `"settings"`）/ `main.tsx`（初期適用）/ `App.tsx`（`useTheme` 配線・設定画面描画）/ `components/Sidebar.tsx`（設定ナビ・`activeNav` 型拡張）/ `components/Sidebar.module.css`（隣接 ghost ナビの間隔）。
- 新規: `features/theme/theme.ts` / `features/theme/useTheme.ts` / `screens/settings/SettingsScreen.tsx` / `screens/settings/SettingsScreen.module.css`（トークン参照のみ）。

### 検証結果

- `grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\(' --include=*.module.css`（`var(--` 除外）→ **0 件**（新規 CSS も含めトークン参照のみ）。
- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `pnpm --filter ./apps/desktop build`（tsc && vite build）→ 成功（67 modules、CSS 29.11 kB）
- **実機表示（`tauri dev`）は未実施**: 初回 OS 追従 / 設定で 3 択即時反映 / 再起動後保持 / システム時 OS 変更追従 / ライト・ダーク双方で全画面（メイン/ツール追加/プリセット追加/診断/設定/サイドバー/プレビュー）が破綻しない、をユーザー環境で確認をお願いしたい。

### やっていないこと（スコープ外）

- 019「PC起動時の動作」「起動間隔を設定」プレースホルダは未実装（温存）/ 015 トークンの再設計 / テーマの外部同期・クラウド保存 / 設定画面のテーマ以外の項目 / アニメ付きトランジション / 新ライブラリ・外部リソース追加なし（§CSP・ローカル保存のみ）。

## 2026-07-11 (017 Tool Path Input Lock)

### 完了したこと

- ツール追加/編集画面（`screens/add-tool/AddToolScreen.tsx`）の**実行ファイルパス欄を編集不可（readOnly）**にし、パスの値設定を既存の `open()` ピッカー（「アプリを選択」）経由のみに限定した（ユーザー要望 7）。任意パスの手打ちを排除し、docs/security.md §2 / §7 の「frontend から任意パスを自由入力させない」方針と整合させた。
- Rust 側の検証（`tools/service.rs::validate` / `process/service.rs::validate_executable`）は**変更なし**。frontend の非活性化だけに依存せず、保存時・起動時の検証を引き続き最終防衛線とする。

### 値更新経路をピッカーのみに限定

- 変更前は `setExecutablePath` の呼び出しが 3 経路: (1) `useEffect` の DB 由来初期化、(2) `selectFile()` の `open()` 成功時、(3) パス `<input>` の `onChange` 手打ち。
- (3) の `onChange` を除去して手打ち経路を排除。残るのは (1) DB 由来の復元と (2) ピッカーのみ。`handleSave` は `executablePath` を読むだけ、`guessNameFromPath` は name 側にしか書かないため、他に手打ち経路はない。

### readOnly / disabled の選択と理由 → **readOnly を採用**

- パスは「設定済みの有効な値」でユーザーが目視確認・**コピー**したい情報 → readOnly なら選択・コピーが残る。
- `disabled` のグレーアウトは「無効/使用不可」に見え、値が入っているのに壊れて見える恐れ。readOnly の方が「値は設定済み・ここでは打てないだけ」の意図に合う。
- 値は React state 由来（ネイティブ form 送信ではない）なので送信可否の差は無関係。可読性・コピー性・意味の一致で readOnly が優る。
- 実装は input に `readOnly` 付与＋`onChange` 除去（readOnly があれば制御 input の警告は出ない）。

### ヘルプ文言の変更

1. パネル見出し説明: `〜選びます。パスは直接入力もできます。` → `〜選びます。パスは「アプリを選択」からのみ設定できます。`
2. パス欄 fieldHelp: `「アプリを選択」で自動入力されます。直接入力・編集も可能です。` → `「アプリを選択」からのみ設定できます。直接入力・編集はできません。`

### 据え置き（変更なし）

- 未選択時のドロップゾーン導線（「アプリを選択」ボタン・`.exe/.app/その他` チップ）を維持。
- 選択済み `selectedApp` カード（アイコン文字＋名前＋パス表示）は据え置き。アイコン方式は 018 スコープのため本タスクでは変更しない。
- パス以外のフォーム項目（表示名・説明・アイコンラベル・プリセット系 select）と名前自動推測（`guessNameFromPath`）は既存挙動のまま。

### 作成・変更ファイル

- 変更: `apps/desktop/src/screens/add-tool/AddToolScreen.tsx`（パス input を readOnly 化＋onChange 除去、ヘルプ文言 2 箇所更新）。
- 変更: `docs/progress.md`（本記録）。
- CSS 変更なし / 新規ライブラリ・外部リソース追加なし / Rust 側変更なし / OS・ファイル・プロセス操作の追加なし（既存 `open()` の利用範囲を変えない）。

### 検証結果

- `git diff --stat` → `AddToolScreen.tsx` のみ（3 insertions / 3 deletions）＋ `docs/progress.md`。変更範囲が想定内。
- `grep -rn setExecutablePath apps/desktop/src` → 値更新は L56（DB 復元）と L74（ピッカー）のみ。手打ち経路なしを確認。
- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- **実機表示（`tauri dev`）は未実施**: パス欄が直接編集できない / ピッカーからのみ設定 / 新規作成・編集・保存・更新・名前自動推測が従来どおり / 文言更新 / 未選択導線と選択済みカード維持、をユーザー環境で確認をお願いしたい。

## 2026-07-11 (018 Tool Icon Auto-Extraction)

### 完了したこと

- ツール追加/編集画面で、ユーザーがピッカー（017 で確定）で選んだ実行ファイルの**実アイコンを選択時に一度だけ自動抽出**し、`data:` URI（base64 PNG, ≤128px）で表示・DB 保存する仕組みを追加した（ユーザー要望 6）。抽出できない形式は従来の 1 文字ラベル（`toIconLetter`）にフォールバックする。
- 抽出は Rust の**限定的な読み取り専用コマンド** `extract_app_icon(path) -> AppResult<Option<String>>`（`tools/commands.rs`、ロジックは新規 `tools/icon.rs`）に閉じ込め、frontend からは選択済みパスのみを渡す。非対応・失敗・パス検証 NG はすべて `Ok(None)`。

### プラットフォーム別抽出方式

- **macOS `.app`**: `Contents/Info.plist` を `plist` でパース → `CFBundleIconFile`（拡張子無しなら `.icns` 補完）→ `Contents/Resources/<name>.icns` を `icns` でデコード → 最大サイズ画像を `image` で ≤128px にリサイズ（縮小のみ・Lanczos3）→ PNG エンコード → `base64` 化。`CFBundleIconFile` 無し / `.icns` 不在 / Assets.car（`CFBundleIconName`）方式は `Ok(None)`（既知の限界・文字フォールバック）。
- **Windows `.exe`**: 今回は **`Ok(None)` スタブ**（決定事項）。この開発環境が macOS で `#[cfg(windows)]` を `cargo check` でコンパイル検証できないため、未検証コードを混ぜない。将来、Windows 実機/CI が使える別タスクで `windows` クレートの feature 追加（`Win32_UI_Shell` / `Win32_Graphics_Gdi`）＋埋め込みアイコン抽出を実装する（TODO）。
- **Linux / 非バンドル / スクリプト**: `Ok(None)`。

### 追加依存とその理由（docs/security.md §10）

- すべて **macOS ターゲット限定**（`[target.'cfg(target_os = "macos")'.dependencies]`。既存 `sysinfo` の mac 限定パターンに倣う）。用途はアイコン抽出のみ・外部通信なし・pure-Rust。
  - `plist`（Info.plist の XML/バイナリ両対応パース）
  - `icns`（`.icns` デコード・最大サイズ取得）
  - `image`（PNG エンコード + ≤128px リサイズ。`default-features = false, features = ["png"]` で最小化）
  - `base64`（PNG → data URI 用 base64 文字列）
- `plist` / `base64` は **tauri の既存推移依存**で新規増分クレートは無く、直接依存追加は `image` / `icns`（＋そのサブ依存）のみ。
- 代替 `systemicons`（単一クレートで mac/win 両対応）は Linux で GTK を引き込み・監査性が下がるため「target 別・pure-Rust・監査可能」方針に反すると判断し不採用。macOS の objc2/AppKit `NSWorkspace.iconForFile`（Assets.car も取得可）は Objective-C ランタイム依存＋NSImage→TIFF 変換が増えるため不採用（`.icns` を持たないアプリは文字フォールバックになるトレードオフを許容）。

### スキーマ変更 / `ensure_column` 設計

- `tools` に nullable `icon_png TEXT` を追加。マイグレーション基盤が無いため、冪等ヘルパ **`util.rs::ensure_column(conn, table, column, decl)`** を新設: `SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2`（table/column をバインド）で存在確認し、未存在時のみ `ALTER TABLE {table} ADD COLUMN {column} {decl}` を実行。`tools::repository::init` の `CREATE TABLE IF NOT EXISTS` 直後に `ensure_column(conn, "tools", "icon_png", "TEXT")` を呼ぶ。既存 DB でも起動時に落ちない。019 でも共用する。
- ADD COLUMN は識別子をバインドできないため `format!` 生成だが、`table`/`column`/`decl` は**呼び出し側のコンパイル時定数のみ**（ユーザー入力を渡さない・doc に明記）。
- モデル: `Tool` に `icon_png: Option<String>`（`#[ts(optional)]`）、`CreateToolInput` / `UpdateToolInput` に `#[serde(default)] #[ts(optional)] icon_png`。repository（`TOOL_COLUMNS` / `row_to_tool` / `insert` / `update`）と service（`create` / `update`）は**正規化せずそのまま通す**。ts-rs 再生成で `iconPng?` を frontend 型に反映。

### 出力サイズ制限 / data URI 方針

- 出力は ≤128px（`width.max(height) > 128` のときのみ縮小）にしてから PNG 化 → DB 肥大化を防止。
- 表示は `data:image/png;base64,...`（`display.ts::iconDataUri`）。**PNG のファイル出力 / asset protocol / `convertFileSrc` は使わない**（`fs`・asset-protocol scope を足さない）。CSP は `csp: null` のまま変更なし・外部通信ゼロ。
- frontend 配線: `AddToolScreen.selectFile()` で選択直後に `extractAppIcon` を invoke し state 保持（失敗はフローを止めず null）。保存ペイロードに `iconPng` を含める。表示は `IconTile` に任意 `imageSrc` を追加し「PNG あれば画像・無ければ文字」に統一（一覧 `ToolRow` / メインのツールピッカー / `PreviewCard` / サイドバー / プリセット追加）。

### セキュリティレビュー結果（security-review 実施済み・必須）

- 判定: **軽微な懸念あり → 1 点ハードニングを適用済み**。
- 適用した修正: `resolve_icns` で `Info.plist` を信頼せず、`CFBundleIconFile` に `/`・`\`・`..` を含む値は拒否（`Ok(None)`）。バンドル外 `.icns` の読み取り（パストラバーサル）を防ぐ（§7/§8）。正当な値は Resources 直下のベース名のため副作用なし。
- 確認済み: `extract_app_icon` は読み取り専用（`File::open`／`plist::from_file` のみ・write/delete/network なし）で任意パスの自由読取ではない（read 前にパス検証・`.app` バンドルのみ抽出）。出力 ≤128px。エラーは `Ok(None)` に丸めフルパスをログ/UI に出さない（§9）。`csp:null`／capabilities 不変（asset-protocol・`fs` 強権限を追加していない）。外部通信ゼロ。追加依存は mac gate・最小で理由を明記（§3/§4/§10）。

### 作成・変更ファイル

- 新規（Rust）: `apps/desktop/src-tauri/src/tools/icon.rs`。
- 変更（Rust）: `Cargo.toml`（mac gate 依存追加）/ `src/lib.rs`（コマンド登録）/ `tools/{commands,mod,model,repository,service}.rs`（`extract_app_icon` 配線・`icon_png` 永続化・`init` で `ensure_column`）/ `util.rs`（`ensure_column` 新設）。
- 再生成（ts-rs）: `features/tools/bindings/{Tool,CreateToolInput,UpdateToolInput}.ts`。
- 変更（frontend）: `features/tools/{toolApi,display}.ts` / `types.ts` / `screens/add-tool/AddToolScreen.tsx`(+css) / `components/{primitives,PreviewCard,Sidebar}.tsx`(+css) / `screens/main/{MainScreen,ToolRow}.tsx` / `screens/add-preset/AddPresetScreen.tsx`。

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `cd apps/desktop/src-tauri && cargo check` → 成功（ハードニング適用後も success）
- `pnpm --filter ./apps/desktop gen:bindings` → 24 tests ok（`iconPng?` を再生成）
- **実機表示（`tauri dev`）は未実施**: `.app` 選択で実アイコンがプレビュー表示 / 抽出不可形式は文字にフォールバック（クラッシュしない）/ 保存後に一覧・サイドバー・プレビューでアイコン表示 / 既存 DB でも起動後に落ちない（`ensure_column` 冪等）/ 再起動後も保持、をユーザー環境（macOS）で確認をお願いしたい。

### やっていないこと（スコープ外）

- Windows(.exe) の実アイコン抽出（今回 `Ok(None)` スタブ・別タスク）/ アイコンの手動アップロード・差し替え / リモート取得 / PNG のファイル出力＋asset protocol 参照 / 一覧表示時の都度再抽出 / `.lnk` 実体解決・`.bat` 対応 / テーマ連動・加工 / 017 のパス入力ロック・`validate` / `validate_executable` の変更。

## 2026-07-11 (018 バグ修正: Assets.car のみのアプリで実アイコンが出ない)

### 事象と原因

- macOS で `Calendar.app` を登録しても実アイコンが反映されず、文字ラベルにフォールバックしていた。
- 原因は macOS 抽出が `Info.plist` → `CFBundleIconFile` → `Contents/Resources/<name>.icns` の**レガシー経路のみ**だったこと。`Calendar.app` は `CFBundleIconFile` を持たず（`CFBundleIconName = AppIcon` のみ）、`.icns` も存在せず、アイコンは `Assets.car`（コンパイル済みアセットカタログ）内にのみある。`resolve_icns` が即 `None` を返し `Ok(None)` → 文字表示になっていた。Apple システムアプリに多い失敗クラス（Chrome/VSCode/Notes/Safari/Terminal 等は `.icns` を持つため既存経路で成功）。フロント〜DB の配線は元々正しく、欠陥は抽出のみ。

### 修正内容（保守的ハイブリッド）

- 既存の pure-Rust `plist`+`icns` 経路を**主経路として維持**し、`.icns` 解決が `None` のときだけ AppKit の `NSWorkspace.iconForFile:`（Finder が表示する実アイコン。`.icns` / `Assets.car` の双方を透過的に扱う）にフォールバックする（`tools/icon.rs::macos::nsworkspace_icon_png`）。取得した NSImage → TIFF → `NSBitmapImageRep` → PNG バイト列にし、既存の ≤128px リサイズ＋base64 経路（新設共通ヘルパ `encode_png_base64`）を再利用する。
- 主経路の挙動は不変（`.icns` を持つアプリは従来どおり）。`.app` ゲートも維持し、非バンドルは引き続き `Ok(None)`。読み取り専用・外部通信なし。

### 追加依存とその理由（docs/security.md §10）

- macOS 限定で `objc2-app-kit` / `objc2-foundation` を追加（`[target.'cfg(target_os = "macos")'.dependencies]`）。用途はアイコン取得のみ。
- **いずれも Tauri が既定 feature 付きで依存ツリーに導入済み**（Cargo.lock に解決済み。`objc2` 0.6 / `objc2-app-kit` 0.3 / `objc2-foundation` 0.3）。feature は cargo により union されるため、直接依存追加による**新規ビルド面・監査面の増分は実質ゼロ**。
- これは 018 初版で NSWorkspace を不採用とした判断（progress 上記 018 節）の**フォールバック限定での見直し**。`.icns` を持たないアプリ（Calendar 等）が文字フォールバックになる制約を解消するため、主経路の pure-Rust 方式は残したまま最終手段として採用した。

### 変更ファイル

- `apps/desktop/src-tauri/Cargo.toml`（mac gate 依存 `objc2-app-kit` / `objc2-foundation` 追加）
- `apps/desktop/src-tauri/src/tools/icon.rs`（`macos::extract` にフォールバック分岐追加・`nsworkspace_icon_png` 新設・`encode_png_base64` 共通化）

### セキュリティ（実装後 security-review 必須）

- 読み取り専用（アイコン取得のみ・write/delete/network なし）。パスは既存 `validate_icon_path` を通過したユーザー選択パスのみ。出力 ≤128px 維持。CSP(`csp:null`) / capabilities 不変。`representationUsingType:properties:` のみ `unsafe`（generics 整合が呼び出し側責任のため）で、他の AppKit 呼び出しは安全メソッド。

### 検証

- `cargo check` / `pnpm typecheck` / `pnpm lint`、および `tauri dev` で Calendar 実アイコン表示・`.icns` アプリ（Chrome）の非退行・抽出不可時の文字フォールバックを確認する。

## 2026-07-11 (019 Preset Auto-Launch on Boot)

### 完了したこと

- プリセット追加/編集画面（`AddPresetScreen.tsx` Step1）に **per-preset トグル「PC起動時にプリセット自動起動」** を追加した（ユーザー要望 5）。有効化したプリセットは、PC 起動 → stream-dock 自動起動（`--autostart`）→ そのプリセットのツール一括起動が無人で走る。
- ユーザー向けのグローバル ON/OFF UI は作らず、**「`auto_launch_on_boot` フラグ付きプリセットが 1 つ以上 ⇔ ログイン項目 ON」という不変条件を reconcile で導出**する方式にした。

### autostart プラグイン導入理由（docs/security.md §5 / §10）

- ログイン項目は永続的な OS 連携（§10 レビュー対象）。手書きの LaunchAgent plist / レジストリ書込は §5 違反のため、公式 `tauri-plugin-autostart = "2"`（macOS は `MacosLauncher::LaunchAgent`）を導入した。OS がログイン時に起動する際に `--autostart` を渡す設定（`Some(vec!["--autostart"])`）にし、起動時フックで手動起動と区別する。
- 追加された推移依存: `auto-launch` / `dirs` / `dirs-sys` / `redox_users` / `winreg`（プラグインの依存。いずれもローカルのログイン項目登録用で外部通信なし）。

### reconcile の不変条件と置き場（command 層）

- `presets/commands.rs` に private `reconcile_autostart(app: &AppHandle, conn: &Connection)` を新設。`repository::count_auto_launch_on_boot` が 1 以上なら `enable()`、0 なら `disable()`。`is_enabled()` でガードし冗長な OS 書込を避ける。OS 書込失敗は best-effort（UI をブロックせず `app_logs` に Warn 記録）。
- 呼び出しタイミング: `create_preset` / `update_preset` / `delete_preset` の service 成功後（各 command に `app: AppHandle` 引数を追加）、および起動時（setup）。前回セッションで全フラグ解除された場合も起動時 reconcile で是正される。
- OS 連携は `AppHandle` を持てる command 層のみで行い、`&Connection` しか持たない service 層では触らない。reconcile は Rust 側 `ManagerExt`（IPC 非経由）で行う。

### 起動時フック（既存一括起動の再利用）— lib.rs setup

- DB/registry を manage したあと `std::env::args()` に `--autostart` が含まれるときのみ、`lib.rs::boot_launch_presets` を **別スレッド**で実行（ウィンドウ生成をブロックしない）。`AppHandle` を clone し、スレッド内で `handle.state::<DbState>()` / `state::<ProcessRegistry>()` を取得。
- 起動は既存 `process::service::{resolve_preset_targets, launch_preset_targets}` を再利用（`launch_preset` command と同処理・新規 spawn 経路なし）。DB ロックは targets 解決時のみ取得し spawn 前に解放。開始/完了を `app_logs`（`LogCategory::BulkLaunch`, operation `autostart_launch_preset`）に記録（launch_preset と同じ成功/一部失敗/全失敗の分岐）。
- 手動起動（`--autostart` 無し）では自動起動を発火させない。
- ウィンドウ: `tauri.conf.json` は**未変更**（デフォルト visible:true）。setup で `show()` のみ行い、手動起動・自動起動とも**通常表示**（最小化しない・ユーザー確認済み。自動起動時も、立ち上がったツールを管理しやすいため）。ダイアログ等でブロックしない。トレイは作らない（スコープ外）。

### スキーマ変更（`ensure_column` 再利用）

- `presets` に `auto_launch_on_boot INTEGER NOT NULL DEFAULT 0` を、018 新設の冪等ヘルパ `util::ensure_column(conn, "presets", "auto_launch_on_boot", "INTEGER NOT NULL DEFAULT 0")` で `presets::repository::init` の `CREATE TABLE IF NOT EXISTS` 直後に追加（既存 DB でも落ちない）。table/column/decl はコンパイル時定数のみ。
- bool 保存は既存 `preset_items.enabled` の慣用を踏襲（`as i64` 書込 / `i64 != 0` 読取）。`PRESET_COLUMNS` / `row_to_preset` / `insert` / `update` に配線。reconcile・起動時用に `count_auto_launch_on_boot` / `list_auto_launch_on_boot` を追加。
- モデル: `Preset` に `auto_launch_on_boot: bool`、`CreatePresetInput` / `UpdatePresetInput` に `#[serde(default)] #[ts(optional)] auto_launch_on_boot: Option<bool>`。service の `create`（既定 false）/ `update`（未指定は既存値維持）で通す。ts-rs 再生成で `autoLaunchOnBoot` を frontend 型に反映。

### capabilities / 設定

- `capabilities/default.json` に autostart の **3 permission のみ** 追加（`autostart:allow-enable` / `allow-disable` / `allow-is-enabled`）。広い scope は足さない。
- `Cargo.toml` に `tauri-plugin-autostart = "2"`、`lib.rs` builder に `.plugin(tauri_plugin_autostart::init(...))`。`tauri.conf.json` は**未変更**（window 制御は setup の `show()` のみ。CSP `csp:null` 不変・外部通信ゼロ）。

### frontend 配線

- `AddPresetScreen.tsx`: `autoLaunchOnBoot` state を追加、`editingPreset?.autoLaunchOnBoot ?? false` で初期化、Step1 の説明フィールド直後にトグル（素の `<input type="checkbox">` + `AddPresetScreen.module.css` に `.bootToggle`）を配置。`createPreset` / `updatePreset` の payload に `autoLaunchOnBoot` を含める。016 設定画面とは独立。

### 既知の限界

- **アンインストール時にログイン項目（macOS `~/Library/LaunchAgents/<identifier>.plist` 等）が OS 側に残留し得る**。アンインストーラでのクリーンアップは MVP スコープ外（docs/security.md に明記）。ユーザーの手動削除でも解除可能。
- `tauri-plugin-single-instance`（二重起動対策）は未導入（別途検討）。起動順の高度制御・自動停止・OS 再起動をまたいだプロセス復元はスコープ外。
- **Windows(レジストリ Run キー)/Linux(.desktop) の autostart 登録経路は macOS 開発環境ではコンパイルのみで実挙動未検証**（動作対象は macOS/LaunchAgent のみ）。自動一括起動が再利用する `launch_preset_targets` も 013 由来のプラットフォーム差（macOS `/usr/bin/open` 縮退）を継承する。

### セキュリティレビュー結果（security-review 実施済み・必須）

- 判定: **問題なし（修正必須なし）**。外部通信ゼロ / 新規 spawn 面・shell・汎用 command なし / frontend から渡るのは `autoLaunchOnBoot`(bool) のみ（`app: AppHandle` は Tauri 自動注入）/ 起動時起動は既存 `validate_executable`・保存済み path 経由のみ / `--autostart` ゲートで手動起動時は非発火 / 全フラグ解除で `disable()` 保証（`is_enabled()` ガード）/ ログは固定文言＋preset_id(uuid) のみ / capabilities は autostart 3 permission 限定 / CSP 不変。
- 後回し（実害なし）: reconcile を DB ロック保持中に OS 呼び出しする点（ユーザー操作頻度低・将来ロック外へ出す余地）。capabilities 3 permission は Rust 側 `ManagerExt` 使用のため JS からは未使用だが最小構成で攻撃面を広げない。

### 検証結果

- `cargo check` → 成功（`tauri-plugin-autostart` 取得後も success）
- `pnpm --filter ./apps/desktop gen:bindings` → 24 tests ok（`autoLaunchOnBoot` 再生成）
- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `git diff --stat` → 変更範囲は 019 想定内（Cargo.lock/Cargo.toml/capabilities/lib.rs/presets 各ファイル/tauri.conf.json/presets bindings 3 件/AddPresetScreen.tsx(+css)/docs）。
- **実機表示（`tauri dev`）は未実施**: トグル保存・再表示 / 有効化でログイン項目登録・全解除で解除 / `--autostart` 付き起動でフラグ付きプリセットが通常表示＋自動一括起動しウィンドウ生成をブロックしない / 手動起動では非発火 / 既存 DB でも落ちない、をユーザー環境（macOS）で確認をお願いしたい。

### やっていないこと（スコープ外）

- グローバルな「起動時にアプリを起動」ON/OFF UI / `tauri-plugin-single-instance` / 起動順の高度制御・待機秒数 / 自動停止・スケジューリング / OS 再起動をまたいだプロセス復元 / MainScreen「起動間隔を設定」プレースホルダ / トレイ / 018・017 の既存パス検証（`validate_executable`）の変更。

## 2026-07-11 (020 App Header (Docker-like))

Docker Desktop 風の共通ヘッダーを全画面に常設。従来、設定/診断への遷移はサイドバー下部の ghost ボタンのみで、サイドバーは `screen === "main"` のときしか出ないため他画面で導線が消えていた。ヘッダーへ一本化し、全画面に常時表示する。**frontend のみの変更**（OS/ファイル/プロセス操作は追加せず、外部リソースも読み込まない）。

### ヘッダー構成（新設 `components/Header.tsx` ＋ `Header.module.css`）

- props: `activeNav?: Extract<Screen, "diagnostics" | "settings">` / `onNavigate: (s: Screen) => void`。
- 左（brand）: 同梱アプリアイコン `public/icon.png` を `<img src="/icon.png" alt="" />` で表示＋「StreamDock」ワードマーク。**アイコン調達 = 同梱アセットのみ**（外部フォント/CSS/CDN/リモート画像なし・docs/security.md §CSP 準拠）。
- 右（nav）: 現行絵文字 🩺（診断 / ログ）・⚙（設定）を流用したアイコンボタン。`title` / `aria-label` 付与、`activeNav` に応じ `.active`（`--primary-soft` 系）表示。
- ヘッダーは**アプリ名バーに徹する**（各画面の見出しは各 screen の `layout.pageTitle` が持つため二重見出しにしない）。
- CSS は role トークン（`var(--...)`）のみ。生 hex/rgba なし（背景 `--surface` / 区切り `--line` / ボタン `--btn-ghost-*` / active `--primary-soft*`）。

### Window 再構成方式（外側 flex ラップ）

- `Window` に `header?: ReactNode` prop を追加。`{ header?, sidebar?, children }`。
- `.shell`（`flex-direction: column; height:100%`）直下にヘッダー行 ＋ `.body` を置く縦構成。`.body` は従来の 2 カラム grid（`300px 1fr` / `flex:1; min-height:0; overflow:hidden`）で `sidebar | main` を保持。`.fullWidth` 修飾子は `.body` へ移設。
- ヘッダーは sidebar 有無に関わらず常時表示。既存 `.window` の grid ルールはそのまま `.body` へ移しただけで、本体レイアウトの挙動は不変。

### サイドバーからの移設（`Sidebar.tsx` / `Sidebar.module.css`）

- `Sidebar.tsx` の診断/設定 ghost ボタン section（🩺 / ⚙）を削除しヘッダーへ一本化。
- 未使用になった型/スタイルを整理: `activeNav` prop の型を `Extract<Screen, "add-preset" | "add-tool" | "diagnostics" | "settings">` → **`Extract<Screen, "add-preset" | "add-tool">`** へ narrow。`Sidebar.module.css` の隣接 ghost 専用ルール `.ghost + .ghost { margin-top: 8px }`（＋コメント）を削除（`.ghost` / `.ghost.active` / `.ghost:disabled` は add-preset / add-tool ghost が継続使用のため残置）。

### App 配線（`App.tsx`）

- `Header` を import。`activeNav = screen === "diagnostics" || screen === "settings" ? screen : undefined` を導出し、`<Window header={<Header activeNav={activeNav} onNavigate={handleNavigate} />} ...>` で渡す。`handleNavigate` は既存流用（diagnostics/settings/add-* を既に捌ける）。

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `*.module.css` の生 hex/rgba なし（Header/Window とも全て `var(--...)`）を確認。
- 変更範囲: `App.tsx` / `components/{Header.tsx,Header.module.css(新規),Window.tsx,Window.module.css,Sidebar.tsx,Sidebar.module.css}` / `docs/progress.md`。`types.ts` は変更なし。
- **実機表示（`tauri dev`）は未実施**: 全画面（main / add-tool / add-preset / diagnostics / settings）でヘッダー常時表示 / 左にアイコン＋StreamDock・右に診断/設定 / ヘッダーから遷移でき現在画面が active / サイドバー下部 ghost が消えヘッダーへ一本化 / 二重見出しなし / sidebar 有(main)・無(他)ともレイアウト非破綻 / ライト・ダーク双方非破綻、をユーザー環境（macOS）で確認をお願いしたい。

### やっていないこと（スコープ外）

- ネイティブ枠のカスタム化（カスタムタイトルバー・ドラッグ領域・信号機ボタン移動）/ ヘッダー遷移先の新規機能画面そのものの追加（土台のみ）/ プリセット・ツール管理の導線変更（サイドバーの ＋追加・一覧は据え置き）/ 配色・ボタンのモダン化（021）/ フォーム文言・項目の変更（022）/ 新規ライブラリ・外部リソースの追加。

### 020-b 追従修正（ヘッダー配色 primary ＋ アプリアイコン blend・ユーザー要望）

- **アイコンのリンク切れ修正**: 当初の `<img src="/icon.png">` は `apps/desktop/public/` に `icon.png` が無く表示されていなかった（アプリアイコンPNGは `src-tauri/icons/` にある）。`src-tauri/icons/128x128.png` を `public/icon.png` へコピー配置し、`src="/icon.png"` を有効化（同梱アセットの複製・外部通信なし・CSP 準拠）。`Header.tsx` は変更なし。
- **ヘッダー配色を primary に**（`Header.module.css` のみ・生 hex なし）: `.header` 背景 `--surface` → `--primary`、`border-bottom` 撤去（色差で境界十分）。`.wordmark` 文字色 `--text` → `--btn-primary-fg`（primary 上で両テーマ白系＝可読）。`.logo` は角丸フレーム（`border-radius`）を撤去しアイコン地をヘッダーに溶け込ませ、白マークだけ見せる（サイズ 26→30px）。`.navBtn.active` は primary 上で埋もれる `--primary-soft` を `--surface` チップに変更して可視化。
- **テーマ差の既知挙動**: ダークはヘッダー `--primary`(#2f6bff) とアイコン地がほぼ一致し白マークのみ浮く（狙いどおり）。ライトは `--primary`(#0036cb) がより濃く、アイコン地は固定の明るい青のため白マーク周りに薄い青のバッジ状の縁が残る（破綻なし。テーマ別アイコン差し替えはスコープ外）。
- 検証: `typecheck` / `lint` 成功、`Header.module.css` に生 hex/rgba なしを確認。実機表示（`tauri dev`）はユーザー環境で確認依頼。

## 2026-07-11 (021 Custom Native Title Bar (Docker Desktop 風))

020 のアプリ内ヘッダーを **OS ネイティブのウィンドウ枠に統合**し、タイトルバー領域に primary ヘッダーを出す（ユーザー要望）。020 で「ネイティブ枠のカスタム化」はスコープ外としていたため、その非目標を反転させる新規タスク。採用方式は **OS 別ネイティブ**（ユーザー確認済み）。macOS / Windows 両対応。

### ウィンドウ枠方式（OS 別）

- **macOS**: `tauri.conf.json` の window に `titleBarStyle: "Overlay"` / `hiddenTitle: true` / `trafficLightPosition: {x:16, y:28}` を追加。ネイティブ信号機（赤黄緑）を残しつつ Web コンテンツをタイトルバー領域まで延伸。65px の背高ヘッダー内で信号機を縦中央寄りに配置。自作ボタンは出さない。
- **Windows**: static config の `decorations` 衝突を避けるため、`lib.rs` setup の既存 `get_webview_window("main")` ブロック内で `#[cfg(target_os = "windows")]` 時のみ `window.set_decorations(false)` を実行してフレームレス化。右端に自作 min/max/close を描画。
- 両 OS ともヘッダー領域を `data-tauri-drag-region` でドラッグ移動可能に。

### プラットフォーム判定

- `lib.rs` に自前コマンド `host_os()`（`std::env::consts::OS` を返すのみ・入力なし・固定文字列）を追加し `invoke_handler` に登録。自前コマンドは ACL 不要。
- frontend は `features/platform/useHostOs.ts`（新規 hook）で起動時に一度取得し、`App.tsx` → `Header` へ `hostOs` を渡す。取得失敗時は null（余白なし・制御ボタン非表示にフォールバック）。

### Header のタイトルバー化（`Header.tsx` / `Header.module.css`）

- `.header`（と非対話な `.brand`）に `data-tauri-drag-region` を付与。nav/制御ボタンは対話要素なので自動的に非ドラッグ。
- macOS の信号機回避: ルートに `data-os={hostOs}` を出し、`.header[data-os="macos"] { padding-left: 78px }` で brand の左余白を確保。
- Windows 制御ボタン: `hostOs === "windows"` のときのみ nav 右端に min/max/close を描画。`@tauri-apps/api/window` の `getCurrentWindow().minimize()/toggleMaximize()/close()` を呼ぶ。アイコンはインライン SVG（─ / □ / ✕）。close の hover は `--danger`。すべて `var(--...)` トークン（生 hex/rgba なし）。
- ヘッダー本体（primary 背景・ロゴ・ワードマーク・🩺/⚙）は 020/020-b のまま流用。二重見出しにしない方針も維持。

### capabilities（`capabilities/default.json`）※セキュリティレビュー対象

- `core:window` の変更系 permission を UI 制御に限定して追加: `allow-start-dragging` / `allow-minimize` / `allow-toggle-maximize` / `allow-close`。shell/fs/process/network は不追加。CSP（`csp: null`）不変・新規 npm/crate/plugin なし。

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `cargo check`（src-tauri）→ 成功（`host_os` / `#[cfg(windows)] set_decorations` 込み）
- `Header.module.css` に生 hex/rgba なしを確認。
- `docs/security.md` に 021 セクションを追記（core:window capabilities / frameless / host_os / Windows 未検証）。
- **実機表示（`tauri dev`）は未実施**: macOS で上部にネイティブ信号機＋primary ヘッダー / ヘッダードラッグで移動 / タイトル文字の二重表示なし / 全画面で破綻なし、をユーザー環境で確認依頼。Windows は当環境（macOS）ではコンパイルのみ・実挙動未検証。

### やっていないこと（スコープ外）

- 配色刷新（021 本来）/ フォーム文言変更（022）/ macOS の自作信号機ボタン化（ネイティブ維持のため不要）/ Linux 専用対応 / 新規ライブラリ・外部リソース・新 plugin・CSP 変更。

## 2026-07-11 セッション引き継ぎ（handoff）

### 今回完了したこと

- **020 App Header**: 全画面常設の共通ヘッダー新設（Window を外側 flex ラップで再構成、Sidebar 下部の診断/設定 ghost をヘッダーへ一本化）。typecheck/lint 通過。
- **020-b ヘッダー配色 primary ＋ アイコン blend**: `.header` 背景を `--primary` に、アプリアイコンの broken link を修正（`src-tauri/icons/128x128.png` → `public/icon.png` にコピー）。ダークは白マークが溶け込む／ライトは薄いバッジ縁が残る既知挙動。
- **021 カスタムネイティブタイトルバー（Docker Desktop 風）**: macOS=`titleBarStyle:"Overlay"`＋`hiddenTitle`＋`trafficLightPosition`（ネイティブ信号機維持）、Windows=`lib.rs` で `#[cfg(windows)] set_decorations(false)`＋自作 min/max/close。両 OS ドラッグ移動（`data-tauri-drag-region`）。OS 判定は自前コマンド `host_os`＋`useHostOs` フック。
- **セキュリティレビュー実施**: 判定「軽微な懸念あり・修正必須なし」。指摘の未使用 capability `core:window:allow-is-maximized` を**削除済み**（残りは start-dragging/minimize/toggle-maximize/close）。
- typecheck / lint / cargo check すべて成功。

### 変更した主要ファイル

- frontend: `src/components/Header.tsx`（新規）, `Header.module.css`（新規）, `Window.tsx`/`Window.module.css`, `Sidebar.tsx`/`Sidebar.module.css`, `App.tsx`, `features/platform/useHostOs.ts`（新規）
- Rust/config: `src-tauri/src/lib.rs`（`host_os` コマンド・Windows `set_decorations(false)`）, `src-tauri/tauri.conf.json`（Overlay/hiddenTitle/trafficLightPosition）, `src-tauri/capabilities/default.json`（core:window 4 permission）
- assets: `public/icon.png`（新規コピー）, `public/fonts/`（Gloock self-host, ユーザー追加）
- docs: `docs/security.md`（021 セクション）, `docs/progress.md`

### まだ未完了のこと（重要・次の主題）

- **macOS 信号機ボタンの上下中央寄せが未解決**。`trafficLightPosition.y` を 24→26→28 と調整したが、ユーザーは「まだ中央でない、もっと下が正しいはず」と指摘。ユーザーの問い＝「結局は具体的な数値を指定するしかないのか？」。
  - 判明事項: キー名 `trafficLightPosition` は正しい（`tauri-utils-2.9.3/src/config.rs:2061-2065`）。前提「titleBarStyle:Overlay かつ decorations:true」も満たす（macOS の decorations は既定 true）。`y` はウィンドウ上端からの**固定 px オフセット**。ヘッダー高は現状 65px（`Header.module.css:7`）。
  - 未確定: 実測でどの y が中央になるか。ボタン実寸/オフセット基準（上端 or 中心）が想定とズレている可能性。`y` を増やすほど下がるので、次は **y を 30〜34 あたりまで上げて実機で追い込む**のが素直。
  - 代替案（数値ハードコードを避けたい場合）: Tauri v2 に安定版の runtime 位置設定 API は無いが、既存依存 `objc2-app-kit` で標準ボタン（`NSWindow.standardWindowButton`）を setup 後に手動 reposition する手がある（追加依存なし）。ただし複雑化するため、まずは config の y 追い込みを推奨。

### 次にやるべきタスク

1. macOS で `pnpm tauri dev` を**完全再起動**して信号機位置を実測し、中央になる `y` を確定（次は y=30〜34 を試す）。config 変更は **HMR では反映されない**ため必ず Tauri プロセス再起動が必要。
2. 実機確認（macOS）: ヘッダー常時表示 / ドラッグ移動 / 二重見出しなし / ライト・ダーク破綻なし / 全画面。
3. （別環境があれば）Windows のフレームレス＋自作 min/max/close 実挙動確認。

### 既知のエラー

- `pnpm tauri dev` で **`Error: Port 1420 is already in use`**。原因は前回の孤児 Vite プロセスがポート1420を占有（`vite.config.ts` は `strictPort:true` のため別ポートに逃げず即エラー）。**コードのバグではない**。対処: `lsof -ti tcp:1420 | xargs kill 2>/dev/null` してから `pnpm tauri dev`。

### 実行した確認コマンド

- `pnpm --filter ./apps/desktop typecheck` → 成功
- `pnpm --filter ./apps/desktop lint` → 成功
- `cargo check`（src-tauri）→ 成功
- `grep`（`*.module.css` に生 hex/rgba なしを確認）

### 次回セッションで最初に読むべきファイル

- 本 handoff（docs/progress.md 末尾）
- `apps/desktop/src-tauri/tauri.conf.json`（trafficLightPosition, 現 y=28）
- `apps/desktop/src/components/Header.module.css`（ヘッダー高 65px, `data-os="macos"` の余白）
- `apps/desktop/src/components/Header.tsx`（drag region / Windows 制御ボタン）
- `docs/security.md` の「021 カスタムタイトルバー」セクション
- 参考: `~/.cargo/registry/src/*/tauri-utils-2.9.3/src/config.rs:2061`（traffic_light_position 定義）

## 2026-07-11 021 UI Design Modernization（グラデ廃止・隆起排除・枠線間引き）

配色刷新タスク（docs/tasks/021）。ユーザー要望 2・3 に対応。トークン差し替え中心・015/016 の役割トークン／ライト・ダーク両対応を維持。生 hex/rgba は増やしていない（全 `var(--...)` 経由）。

### グラデーション廃止

- `theme.css` `--btn-primary-bg`: cyan→purple の `linear-gradient(135deg,...)` を **`var(--primary)` 単色**へ（CTA フラット化）。
- `primitives .primary`: `box-shadow: var(--shadow-drop)`（グロー落ち影）を除去、hover を `filter: brightness(1.06)` に変更。
- `MainScreen .startBtn`: accent の `radial-gradient`＋`--elev-gradient` を撤廃 → `background: var(--accent-soft)`、hover は新トークン `--accent-soft-hover`。グリフ色は `--text` 維持（両テーマで可読）。
- `Sidebar .preset.active`: 2 色 `linear-gradient`（primary-soft→accent-2）を **`var(--primary-soft)` 単色**へ。選択枠（primary 48% border）は状態区別のため残置。
- **例外（ユーザー追加要望）**: 一括起動ボタンのみグラデを許容。`--btn-launch-bg`（cyan→purple、旧 `--btn-primary-bg` と同値）を復活させ、`primitives .primary.launch`（複合セレクタで `.primary` の単色を上書き）で適用。`Button` に opt-in プロップ `launch` を追加し、`MainScreen` で `launch={!anyLaunched}`（＝一括起動状態のときだけ）指定。一括停止（`.stopAll`）・他画面の primary CTA（Diagnostics/AddTool/AddPreset）は単色のまま。落ち影（glow）は復活させずグラデのみ。
- 装飾 radial ティント（AddTool `.appIcon` / `PreviewCard` / AddPreset パネル背景）は雰囲気付けとして**残す**（ユーザー確認済み。ボタン系グラデのみ撤廃方針）。

### 隆起（emboss）排除 → フラットアイコンボタン

- `MainScreen .runtimeAction` / `.move` / `.delete`、`primitives .primary.stopAll`、`AddPreset .moveBtn`（範囲拡張）から `--elev-gradient`＋`--elev-border`(border)＋`--shadow-inset`／`--shadow-1` を撤去 → 既定 `--control-bg` 面・hover `--control-bg-hover` のフラット化。
- `.startBtn`=accent 淡ティント、`.stopBtn`／`.delete`=danger 文字色＋hover `--danger-soft`。

### 枠線の間引き（モダン化）

- **撤廃した常時 border**: `primitives .secondary` / `.chip`、`Sidebar .ghost` / `.toolActionBtn`、`MainScreen .editToggle` / `.addToolBtn` / `.modeToggle`、`AddPreset .modeToggle`、`Header .navBtn`（範囲拡張）。面色＋新規 hover（`--control-bg-hover` / danger は `--danger-soft`）で表現。active 状態（editToggle.editing / ghost.active）は border を落とし `--primary-soft` 背景＋`--primary-text` で区別。
- **残した border（視認性・状態区別のため意図的）**: `formLayout .field input/select`、パネル外枠（`.panel` の `--line`）、`StatusBadge`（starting/stopped 等）、OrderBadge、iconTile、list-item 系（sidebarTool / pickerRow）。

### トークン変更（theme.css）

- 追加: `--accent-soft-hover: color-mix(in srgb, var(--accent) 16%, transparent)`（`--accent` からの派生。新基準色なし）。
- 変更: `--btn-primary-bg` → `var(--primary)`。
- 削除（フラット化で未使用化）: `--elev-gradient` / `--shadow-drop` / `--shadow-inset` / `--shadow-1` / `--btn-primary-shadow` / `--btn-ghost-border`。
- 残置: `--elev-border`（AddTool `.appIcon` の装飾枠でのみ継続使用）、`--btn-ghost-bg`（中立フラット面）。

### 変更ファイル（6）

`styles/theme.css`, `components/primitives.module.css`, `screens/main/MainScreen.module.css`, `components/Sidebar.module.css`, `screens/add-preset/AddPresetScreen.module.css`, `components/Header.module.css`。**触っていない**: AddToolScreen / PreviewCard（装飾 radial 維持）, formLayout（入力枠維持）。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `grep`（`*.module.css` に生 hex/rgba なし）→ 該当なし。削除トークンの残参照なし。`--elev-border` は appIcon のみ。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）。
  - ライト/ダーク要注意点: ①中立フラットアイコンボタン（`--control-bg`＝text6%透過・border無し）がライト白面上で薄くなりすぎないか。薄い場合は `--surface-2`（ライトで実線面）へ切替。②`.startBtn` の accent 淡ティントの start/stop 色差。③ghost ボタンの border 撤廃後の輪郭（toolbar/footer は `--surface-2` 面上で差が付く想定）。
  - 全画面（メイン／ツール追加／プリセット追加／診断／設定／サイドバー／ヘッダー）で破綻がないか。

## 2026-07-11 022 Tool/Preset Form Polish（フォーム細部調整）

ツール/プリセットのフォーム細部を整えるタスク（docs/tasks/022）。ユーザー要望 4・5・6・7 に対応。frontend のみ。Rust モデル/DB・パス検証・自動起動ロジック（019）・アイコン自動抽出（018）は変更なし。新ライブラリ追加なし。

### (4) アイコンラベル入力欄の削除

- `AddToolScreen.tsx`: state `iconLabel`／初期化（`setIconLabel(editingTool?.iconLabel)`）／保存 payload の `iconLabel`／「アイコンラベル」フィールド（input＋ヘルプ）を削除。プレビューは `toIconLetter({ iconLabel, name })` → `toIconLetter({ name })` に変更（表示名先頭文字ベースへ）。
- `display.ts` `toIconLetter`: 引数型を `Pick<ToolRecord, "iconLabel" | "name">` → `{ iconLabel?: string; name: string }` に緩め、`tool.iconLabel?.trim()` に変更。フォールバック（iconLabel 優先→無ければ name 先頭文字）は温存。未使用化した `ToolRecord` import を削除。
- **toIconLetter 波及: ゼロ**。他5呼び出し（MainScreen×2 / Sidebar / AddPresetScreen×3）はすべて実 `Tool` レコード（`iconLabel: string` 保持）を渡すため、引数任意化後もそのまま通る。DB 残置の `icon_label` を持つ既存ツールも従来通り表示。
- **Rust/DB は非変更**。`Tool.iconLabel: string`・`CreateToolInput`/`UpdateToolInput` の `iconLabel?`（任意）は ts-rs 自動生成のまま。payload から省略しても型OK・DB は既存 default 挙動に委ねる → bindings 再生成不要。

### (5) 実行ファイルパス欄の灰色化＋文言短縮（AddToolScreen.tsx / formLayout.module.css）

- `formLayout.module.css` に `.field input.readonlyInput { color: var(--muted); }` を追加（生 hex/rgba なし・`var(--muted)` 経由）。パス input（`readOnly` 維持）に `className={layout.readonlyInput}` を付与し、非活性と分かる灰色文字に。
- フィールドヘルプを「『アプリを選択』からのみ設定できます。直接入力・編集はできません。」→ **「直接入力・編集はできません。」** のみに短縮。
- パネル見出し `<p>` を「起動したいアプリの実行ファイルを選びます。パスは『アプリを選択』からのみ設定できます。」→ **「起動したいアプリの実行ファイルを選びます。」**（フィールドヘルプとの重複を解消）。

### (6) チェックボックス余白（AddPresetScreen.module.css）

- `.bootToggle` の `gap: 10px` → **`gap: 12px`**（checkbox とラベルテキストの間隔を拡大）。

### (7) 自動起動の説明文言変更（AddPresetScreen.tsx）

- 「オンにすると、PC 起動時に stream-dock が自動起動し、このプリセットのツールを一括起動します。」→ **「PC起動時にこのプリセットに登録されたツールが自動起動されます。」**

### 変更ファイル（5・全て編集、新規なし）

`features/tools/display.ts`, `screens/add-tool/AddToolScreen.tsx`, `screens/formLayout.module.css`, `screens/add-preset/AddPresetScreen.module.css`, `screens/add-preset/AddPresetScreen.tsx`。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `grep`（触れた `*.module.css` に生 hex/rgba なし）→ 該当なし（灰色化は `var(--muted)` 経由）。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: アイコンラベル欄が消え、アイコンが自動抽出 PNG（無ければ表示名先頭文字）で従来通り表示／新規作成・編集・保存・プレビューが破綻しない／パス欄が灰色文字で非活性と分かりヘルプが「直接入力・編集はできません。」のみ／自動起動チェックボックスとテキストに適度な余白／説明文が新文言／ライト・ダーク両テーマで破綻なし。

## 2026-07-11 023 Browser URL Tool Support（URL ツール登録＋起動基盤）

実行ファイルだけでなく「ブラウザで開く URL（サイト）」もツール登録・起動できるようにするタスク（docs/tasks/023・ユーザー要望 8）。本タスクは**登録＋起動の基盤まで**（URL を既定ブラウザで開く）。「起動後にブラウザ上ツールの設定を自動反映」は**Out of scope（将来別タスクで設計）**。新ライブラリ追加なし（導入済み `tauri-plugin-opener` を初めて使用）。

### (1) モデル / スキーマ拡張（kind / url）

- `tools/model.rs`: `ToolKind` enum 新設（`Serialize/Deserialize/TS`・`#[serde(rename_all="lowercase")]`・`#[derive(Default)] #[default] Executable` → TS union `"executable" | "url"`）。`Tool` に `kind: ToolKind` と `url: Option<String>`、`CreateToolInput` / `UpdateToolInput` に `#[serde(default)] kind` と `#[serde(default)] #[ts(optional)] url` を追加。`executable_path` は `#[serde(default)]` 化（url 種別は空文字）。
- `tools/repository.rs`: `TOOL_COLUMNS` に `kind, url` 追加。`row_to_tool` は `kind` を String で読み `ToolKind::from_str_lenient`（未知値→`Executable`・前方互換）。`insert`/`update` に `kind.as_str()`/`url` を通す。`find_by_url`（`kind='url'` 限定）を追加。
- **スキーマ移行（`init`・冪等）**: `CREATE TABLE` からインライン index を撤去 → `ensure_column(kind, "TEXT NOT NULL DEFAULT 'executable'")` → `ensure_column(url, "TEXT")` → `DROP INDEX IF EXISTS idx_tools_executable_path;` → `CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_executable_path_executable ON tools(executable_path) WHERE kind='executable';`。既存 DB も落ちない（`kind` は既存行が既定 'executable' で埋まる）。新規/既存/再起動いずれも最終状態は「部分ユニーク index のみ」で一致。
- ts-rs 再生成（`pnpm gen:bindings`）: `Tool.ts` / `CreateToolInput.ts` / `UpdateToolInput.ts` 更新 ＋ `ToolKind.ts` 新規。`features/tools/types.ts` に `ToolKind` re-export。

### UNIQUE 制約の見直し方式

- url 種別は `executable_path` が空文字になり、旧・全行 `UNIQUE(executable_path)` では空文字同士が衝突するため、**`kind='executable'` の部分ユニークインデックス**へ移行（executable の重複防止は維持）。url 種別の重複は service 層 `find_by_url` で拒否（重複防止の意図を維持）。

### (2) フォーム（AddToolScreen.tsx / .module.css）

- 種別トグル（アプリ / URL）を追加（`kind` state・segmented `.kindToggle`/`.kindOption`/`.kindActive` を CSS 追加）。URL 種別はファイル選択の代わりに **URL 入力欄（編集可）** を出し、保存前に `isValidHttpUrl`（http/https のみ）を検証（不正は保存させずインラインエラー）。アイコンは文字ラベルにフォールバック（url 種別は自動抽出しない）。保存 payload に `kind`/`url` を含め、url 種別は `executablePath: ""`。

### (3) 起動経路（Rust）／(4) 状態・停止の採用方針

- **採用方針＝ MVP「開くのみ」**: url 種別は **registry（PID 管理）に登録しない**（`Handle` enum に URL バリアントを足さない・`registry.rs`/`snapshot`/`stop_one` は無変更）。UI は url 行に「開く」ボタンだけを出し、status バッジ・停止ボタン・スピナーを出さない（`ToolRow.tsx` で **kind 分岐を state 分岐より前**に配置）。`MainScreen.tsx` に `handleOpenUrl`（`launchTool(toolId)` を呼び URL を開くだけ・行 state を変えない）を追加、`onOpen` を kind で出し分け、`isActiveRow` で url 種別を「起動済み」カウント・一括停止トグルから除外。
- **url 起動経路とスキーム検証**: `process/service.rs::open_url(app, tool)` を新設。`validate_http_url(tool.url)` で **http/https 限定**に再検証してから `app.opener().open_url(url, None)`（既定ブラウザ委譲・shell 非経由・新規 spawn 面なし）。`launch_tool` command に `app: AppHandle` を追加し `tool.kind == Url` を分岐（registry 非登録・`launch_id:"" / process_id:0` を返す・ログは「{name} を開きました」でツール名のみ）。一括起動は `launch_preset_targets`/`launch_one` に `app` を渡し、url 種別は `open_url` で `success=true, launch_id=None`（registry 非登録・一括停止対象外）。`lib.rs::boot_launch_presets` は手持ちの handle を渡すだけ。
- **URL 検証ヘルパ**: `util.rs::validate_http_url(raw)` を新設（trim → 非空 → 制御文字拒否 → `http://`/`https://` プレフィックス限定・大小無視）。**保存時（tools/service）と起動時（process/service）の両方**で使う多層防御。`javascript:` / `file:` / `data:` / 独自スキームは拒否。

### (5) opener capabilities scope

- URL は Rust `OpenerExt`（**IPC 非経由・ACL 非対象**）で開くため frontend は opener コマンドを一切呼ばない。`capabilities/default.json` から **`opener:default` を削除**（`allow-open-url`/`allow-reveal-item-in-dir`/`allow-default-urls` の JS 露出を排除）。広い許可の追加なし（むしろ縮小）。Rust 側 open は capabilities に依存しないため削除しても URL 起動は壊れない（019 autostart の ManagerExt IPC 非経由と同型）。

### Out of scope（将来検討）

「起動後にブラウザ上ツールの設定を自動反映」（拡張連携・プロファイル注入・自動操作）／埋め込み WebView ／url ツールの停止・タブ制御・複数ブラウザ選択・ブラウザ指定起動／一括起動での url 高度順序制御／新規ライブラリ追加。

### 変更ファイル（Rust 8・生成物 4・Frontend 5）

Rust: `tools/model.rs`, `tools/repository.rs`, `tools/service.rs`, `util.rs`, `process/service.rs`, `process/commands.rs`, `lib.rs`, `capabilities/default.json`。生成物: `bindings/{Tool,CreateToolInput,UpdateToolInput}.ts` 更新 ＋ `bindings/ToolKind.ts` 新規。Frontend: `features/tools/types.ts`, `types.ts`, `screens/add-tool/AddToolScreen.tsx`(+`.module.css`), `screens/main/MainScreen.tsx`, `screens/main/ToolRow.tsx`。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `cd apps/desktop/src-tauri && cargo check` → 成功
- `pnpm gen:bindings`（ts-rs 25 tests pass）→ bindings 差分は kind/url/ToolKind のみ
- **security-review 実施済み（本タスク必須）→ 判定「問題なし」**: frontend から任意 URL/コマンドを渡せない（toolId のみ・URL は Rust 側 `validate_http_url` で http/https 検証）／`javascript:`・`file:`・`data:` 等の危険スキームを拒否／opener capabilities は最小（`opener:default` 削除・広い許可の追加なし）／新規 spawn 面・shell・外部通信を増やしていない（OS 既定ブラウザに委譲）／`ensure_column`＋`DROP/CREATE IF (NOT) EXISTS` が冪等で既存 DB を壊さない。軽微観察: URL 内の半角空白は未拒否だが opener へ配列引数で単一文字列渡し（shell 非経由）のため注入面なし・据え置き。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: 種別トグルでアプリ/URL を選べ URL は http/https を保存・再表示（不正スキームを弾く）／url 起動で既定ブラウザが開く（frontend は toolId のみ・`opener:default` 削除後も Rust 側 open が動作）／既存 executable ツールが従来どおり／url 行に stop/status が出ない／既存 DB で起動後に落ちない／一括起動に url を含めても破綻しない。

## 2026-07-12 024 Tool → Preset Registration（ツール追加と同時にプリセット登録）

ツール追加画面の「登録先プリセット」「追加位置」を表示専用スタブ（`mockData` ハードコード配列）から**本実装**へ。ツール新規登録と同時に、選んだプリセットへそのツールを登録できるようにした。frontend のみ・既存 command 再利用（新規 command / capabilities / ライブラリなし）。

### (1) 登録先プリセットの実データ化

- `AddToolScreen` を props ベースに変更（`presets: PresetRecord[]` / `presetItems: PresetItemRecord[]` を追加）。App が既に保持する `usePresets()` / `usePresetItems()` の結果を props で配布する既存方針に合わせ、画面内で `usePresets()` を二重に呼ばない。
- 登録先 select の option は `presets.map(p => <option value={p.id}>{p.name}</option>)` ＋ **末尾に固定センチネル `<option value="">プリセットには追加しない</option>`**。state `targetPreset` の既定値は `""`（＝追加しない）。
- **プリセット 0 件時**は select を `disabled` にし value は `""` のまま固定（「追加しない」相当）。ヘルプ文言は 0 件時「先にプリセットを作成してください。」／それ以外「選んだプリセットにこのツールを登録します。」（「今後のバージョンで対応予定」を撤去）。

### (2) 追加位置の条件表示

- `isRealPreset = targetPreset !== ""` が true のとき（実プリセット選択時）だけ「追加位置」ブロックを表示。非活性・「追加しない」（`""`）時は自動的に非表示。
- 選択肢を **`tail`（末尾に追加）/ `head`（先頭に追加）/ `parallel`（並行（順番なし））** の 3 択に簡素化（value 固定の `InsertMode` union）。mockData の 4 択（「選択して追加」含む）は撤去。state `insertMode` 既定 `"tail"`。

### (3) 保存時のプリセット登録（`handleSave`・新規時のみ）

- 新規分岐で `createTool(input)` の戻り値 `created` を受ける（従来は破棄）。編集分岐（`updateTool`）・URL バリデーション・payload 構成は無変更。
- **`!isEdit && isRealPreset` のときのみ** プリセット登録:
  - `launchMode = insertMode === "parallel" ? "parallel" : "ordered"`。
  - `addToolToPreset({ presetId: targetPreset, toolId: created.id, launchMode })`（末尾自動採番）→ 戻り値 `item`（新 PresetItem）。
  - **`head` のみ** 続けて `reorderPresetItems(targetPreset, [item.id, ...existingIds])`。`existingIds` は props の `presetItems` を `presetId` で絞り `orderIndex` 昇順に並べた既存 item id。Rust `reorder`（`preset_items/service.rs:105`）が「対象プリセットの全 item id・件数一致」を要求するため、新規＋既存の全 id を渡す。`list_preset_items` は呼ばず、許可 command（`create_tool`/`add_tool_to_preset`/`reorder_preset_items`）のみ利用。
  - **API 呼び出し順**: `create_tool` → `add_tool_to_preset` →（head 時のみ）`reorder_preset_items`。
- **失敗時**: `try/catch` は従来どおり `handleSave` 全体を包む。`createTool` 成功後に `addToolToPreset`/`reorderPresetItems` が失敗しても `toErrorMessage` でエラー表示するのみで**ツール作成のリトライはしない**（ツールは作成済み・二重作成を回避）。成功時は既存どおり `onSaved?.()` → `onNavigate("main")`。
- App の `onSaved` を `reloadTools()` ＋ `reloadPresetItems()` に変更（プリセット登録がメイン画面のツール構成へ即反映されるよう。編集・「追加しない」時も items 再読込するが安価・副作用なし）。

### (4) スタブ整理

- `data/mockData.ts`（`targetPresetOptions` / `insertModeOptions` のみ残っていた）を**削除**。他参照なし（`AddToolScreen` からのみ import）。import 文も除去。
- 「表示のみに使う（保存には関与しない）」コメントを実装済み内容に更新。

### やらないこと（維持）

編集時のプリセット登録 UI（`!isEdit` でのみ表示）／Rust command・モデル・DB スキーマ変更／挿入位置の任意指定・launch group・待機秒・複数プリセット同時登録／新規ライブラリ・command・capabilities。

### 変更ファイル（Frontend 3）

- `screens/add-tool/AddToolScreen.tsx`（props 追加・state 実データ化・条件表示・保存フロー）
- `App.tsx`（`presets`/`presetItems` を props で渡す・`onSaved` で items も再読込）
- `data/mockData.ts`（削除）

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `git diff --stat` → 上記 3 ファイルのみ（App.tsx / mockData.ts 削除 / AddToolScreen.tsx）
- **セキュリティ確認（docs/security.md 準拠）**: frontend のみ。新規 Tauri command / capabilities を追加せず既存 `create_tool`/`add_tool_to_preset`/`reorder_preset_items` のみ利用（`AddToolScreen` に直接 `invoke` なし）。frontend から渡すのは `presetId`/`toolId`/`launchMode` のみ（任意 path/command を渡さない）。外部通信・外部リソースを増やさない。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: 登録先が実データから選べ選んだプリセットに登録される／プリセット 0 件で登録先セレクトが非活性・「追加しない」固定／追加位置が「追加しない」・非活性時は非表示、実プリセット選択時のみ表示／「末尾＝addToolToPreset・先頭＝続けて reorderPresetItems・並行＝launchMode parallel」が実挙動と一致／プリセット登録失敗時にエラー表示されツールの二重作成が起きない／「追加しない」選択時はツールのみ作成／編集時は登録先/追加位置が出ない／ライト・ダーク両テーマで破綻しない。

## 2026-07-12 025 Form/UI Polish Round 2（フォーム/UI 細部整理・frontend のみ）

022 に続くフォーム/UI の細部整理。表示されない未使用フォームの削除、プレビュー枠のフラット化、ツール編集時の種別トグル非表示、メイン画面編集中フッタの不要要素削除。frontend のみ・Rust / DB / bindings 変更なし・新規ライブラリ / 外部リソースなし。

### (1) プリセット説明欄の削除（`AddPresetScreen.tsx`）

- UI のどこにも表示されない write-only な「説明」欄を削除。Step1 の「説明」フィールド JSX（label〜fieldHelp「サイドバーや一覧の補足として使えます。」）を撤去。
- 関連 state `description` / `setDescription`・初期化 `setDescription(editingPreset?.description ?? "")`・保存 payload の `description`（`saveCreate` の `createPreset` / `saveEdit` の `updatePreset`）を整理し、両 API へ `description` を送らない。
- **整理範囲**: state 定義 1 / 初期化 1 / payload 2 / JSX フィールド 1。`toLaunchItem` の `tool.description`（tool 側）は無関係で無変更。
- **残置方針**: `CreatePresetInput` / `UpdatePresetInput` は `description?` が任意のため省略で typecheck が通る。Rust の Preset モデル / DB の `description` カラム・`PresetRecord.description` 型は残置（022 の `icon_label` と同方針・破壊的変更は範囲外で既存 default 挙動に委ねる）。

### (2) プレビュー枠のフラット化（`PreviewCard.module.css` `.newRow`）

- ハイライト行 `.newRow` の accent `border`（`color-mix(... --accent 30% ...)`）と radial-gradient ＋ `--accent-soft` 背景を撤廃。「枠/影」に見えパネル（`.panel` 上辺 `--line`）と干渉していた状態を解消。
- フラットな単色面 `background: var(--surface-2)` に置換（border なし・グラデなし）。`margin`/`padding`/`border-radius` は維持。021 のフラット方針に整合。生の hex/rgba は残さず全て `var(--...)` 経由。

### (3) ツール編集時の種別トグル非表示（`AddToolScreen.tsx`）

- アプリ/URL 種別トグル（`role="tablist"` の `.kindToggle` ブロック）を `{!isEdit && ( ... )}` で囲み、編集時は非表示に。編集時は種別切替 UI が無く `setKind` が呼ばれないため `editingTool.kind`（70/83 行で初期化）のまま固定。
- **編集時 kind 分岐**: パネル見出し（`isUrlKind ? "URL を入力" : "アプリを選択"`）・selectedApp・フォーム分岐（URL 入力 / 実行ファイルパス readOnly）は全て既存の `isUrlKind` 由来で自動的に対象種別が出る。executable 編集は実行ファイル系のみ、url 編集は URL 入力のみ編集可（種別切替不可）。分岐ロジック / state / 見出しは無変更。

### (4) メイン画面編集中フッタの削除（`MainScreen.tsx` / `MainScreen.module.css`）

- `MainScreen.tsx` の `{editMode && ( <div className={styles.footerActions}> ... </div> )}` ブロック全体（未配線プレースホルダ Button「起動間隔を設定」「PC起動時の動作」）を削除。`Button` import は他所で使用継続のため残置。
- `MainScreen.module.css` の `.footerActions`（囲み枠 `border`/`border-radius`/`background`）と未使用になる `.footerButtons` を削除。編集モードは items 一覧で自然終了しレイアウト非破綻。

### やらないこと（維持）

Rust モデル / DB スキーマ変更（description カラム削除しない）／024 のプリセット登録本実装・021 の配色/ボタンモダン化追加／「起動間隔」「PC起動時の動作」機能の実装（削除のみ・将来別タスク）／プレビュー以外のスタイル刷新／新ライブラリ・外部リソース追加。

### 変更ファイル（Frontend 5）

- `screens/add-preset/AddPresetScreen.tsx`（description 削除）
- `components/PreviewCard.module.css`（`.newRow` フラット化）
- `screens/add-tool/AddToolScreen.tsx`（種別トグル `!isEdit` ガード）
- `screens/main/MainScreen.tsx`（編集中フッタ削除）
- `screens/main/MainScreen.module.css`（`.footerActions` / `.footerButtons` 削除）

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `git diff --name-only` → 上記 5 ファイル ＋ `docs/progress.md` のみ
- 生の hex/rgba 残置なし（touched CSS 2 ファイルを grep 済み・全て `var(--...)`）／削除に伴う未使用 state / import / スタイルなし（`Button` は MainScreen で継続使用を確認）
- **セキュリティ確認（docs/security.md 準拠）**: frontend のみ。OS 操作 / ファイル操作 / プロセス操作を追加せず（§2/§4）、外部リソース・外部通信・telemetry を増やさない（§1/§CSP）。パス設定・ファイル選択の既存仕様は無変更。新規 command / capabilities / ライブラリなし。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: プリセット追加/編集画面から「説明」欄が消え作成・編集・保存が破綻しない（Rust の description カラム残置）／ツール追加後プレビューのハイライト枠がフラットになりパネル上辺の線が正常表示／ツール編集画面でアプリ/URL トグルが表示されず対象種別の項目のみ編集可（executable・url 両方で確認・種別切替不可）／メイン画面編集中の「起動間隔を設定」「PC起動時の動作」と囲み枠線が消えレイアウト非破綻／ライト・ダーク両テーマで破綻しない。

## 2026-07-12 026 Header Polish & Navigation Foundation（ヘッダーの見た目/導線整備・frontend のみ）

020 で新設した共通ヘッダーを見た目と導線の両面で整える。右アイコンのフラット白化・メイン戻り導線・機能大別の導線土台。frontend のみ・Rust / DB / bindings 変更なし・新規ライブラリ / 外部リソースなし・`Screen` union 無変更（実機能画面は作らない）。

### (1) 右アイコンのフラット白化（`Header.tsx` / `Header.module.css`）

- 診断🩺 / 設定⚙ の**絵文字を単色インライン SVG（`currentColor`）へ置換**（絵文字は CSS `color` で白くできないため）。診断＝パルス/活動ライン、設定＝歯車。`viewBox 0 0 24 24`・`width/height 22px`・塗り無し・`stroke: currentColor`。既存 Windows 制御ボタンと同方式で外部リソースなし（§CSP 準拠）。`title`/`aria-label` は現行文言維持。
- `.navBtn` から `background: var(--btn-ghost-bg)`（うっすら枠の正体）・`border-radius`・`.navBtn:hover` の背景変化・`.navBtn.active` の surface チップを**撤去**。`background: transparent; border: 0` でフラット化。色は `var(--btn-primary-fg)`（白系トークン）維持。
- active/非active/hover は **`opacity` の濃淡のみ**で表現（非active 0.72 / active・hover 1.0）。枠・チップ・背景変化なし。アイコンは 16px→22px（SVG）で拡大、ボタンのタップ領域 36px は維持。

### (2) メイン画面リンク（`Header.tsx` / `Header.module.css` / `App.tsx`）

- 左ロゴ（img + ワードマーク）を `<div data-tauri-drag-region>` から **`<button onClick={() => onNavigate("main")} aria-label="メイン画面へ">` 化**し、ロゴ自身の `data-tauri-drag-region` を除去。`.brand` に button リセット（`background: transparent; border: 0; padding: 0; cursor: pointer`）＋既存 flex/gap 維持。
- **ドラッグ両立方式**: header 要素自体の `data-tauri-drag-region` は残置。ロゴ〜ナビ間の余白でウィンドウドラッグが従来どおり効き、ロゴ領域のみクリック→メイン遷移。ドラッグ領域とクリック領域を要素単位で切り分け。
- **activeNav 拡張**: 型を `Extract<Screen, "diagnostics" | "settings">` → `"main" | "diagnostics" | "settings"` に拡張。`App.tsx` の導出を `screen === "main"` でも `activeNav = screen` とし、メイン時のセクション導線 active 表示に整合（`types.ts` は無変更）。

### (3) 機能大別への導線土台（`Header.tsx` / `Header.module.css`）

- **右詰め・診断/設定の左側**にセクション導線 `.sections` を新設。データ駆動の `SECTIONS` 配列（`{ id, label, screen?, enabled }`）で描画。当面「ツール管理」のみ `enabled: true`（→ `onNavigate("main")`・`activeNav==="main"` で active）、他（OBS 連携 / おすすめツール / 読み上げ連携）は `disabled` の placeholder（`title="近日対応"`）。
- **構造の土台まで**: `Screen` は増やさず placeholder は無効ボタンのみ。将来の「大項目→プルダウン」は配列を入れ子に拡張していく想定（ドロップダウン UI は今回作らない）。
- `.sectionBtn` は背景/枠無しのテキストリンク（`font-size 14px`・`opacity` 濃淡: 非active 0.72 / active 1.0 / disabled 0.4）。`.sections` は診断/設定との間に `border-right: 1px solid var(--border-soft)` の区切り＋余白。

### やらないこと（維持）

新規機能画面（OBS/おすすめ/読み上げ）の実装・実機能を伴う `Screen` 追加（`types.ts` 無変更）／大項目のプルダウン UI（構造の土台のみ）／ネイティブ枠・カスタムタイトルバー・信号機・Windows コントロールの挙動変更／サイドバー・プリセット/ツール管理の導線変更／配色トークンの大規模変更／新ライブラリ・外部リソース追加。

### 変更ファイル（Frontend 3）

- `components/Header.tsx`（ロゴ button 化・SECTIONS 導線・診断/設定 SVG 化・activeNav 型拡張）
- `components/Header.module.css`（`.navBtn` フラット化・`.brand` リセット・`.sections`/`.sectionBtn` 新設）
- `App.tsx`（activeNav 導出に `main` を追加）

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `git diff --stat` → 上記 3 ファイルのみ（＋ `docs/progress.md`）
- 生の hex/rgba 残置なし（`Header.module.css` を grep 済み・全て `var(--...)`。濃淡は `opacity` プロパティで表現し raw color を持ち込まない）／外部リソース読み込みなし（`img src="/icon.png"` は従来どおり同梱アセット、外部 URL / CDN / フォント無し）
- **セキュリティ確認（docs/security.md 準拠）**: frontend のみ。OS 操作 / ファイル操作 / プロセス操作を追加せず（§2/§4）、アイコンは同梱アセット or インライン SVG のみ（§CSP）、外部通信・telemetry を増やさない（§1）。新規 command / capabilities / ライブラリなし。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: 右アイコンが背景無しの白アイコンになり hover/active のエフェクトとうっすら枠が消え以前より大きい／ロゴクリックでメイン画面へ戻れウィンドウドラッグも従来どおり効く／診断・設定の左に右詰めセクション導線が出る（ツール管理のみ有効・他は無効表示）／全画面でヘッダー常時表示・sidebar 有/無ともレイアウト非破綻／ライト・ダーク両テーマで破綻しない。

## 2026-07-12 026 追加 診断/設定画面の「メインに戻る」ボタン削除（導線をヘッダーへ一本化・frontend のみ）

026 でヘッダーにメイン戻り導線（ロゴ＝ホームボタン）を追加したため、診断/設定画面の「メインに戻る」ボタンが重複・不要になり削除。各画面で `onNavigate` はこのボタンでのみ使用していたため、未使用化する prop / import / App.tsx の受け渡しまでクリーン削除。Rust / DB / bindings / `types.ts` 変更なし・新規ライブラリ / 外部リソースなし。

### 変更内容

- `screens/diagnostics/DiagnosticsScreen.tsx`: `layout.actions` 内の「メインに戻る」`Button` を削除（**「再読込」は残置**、`layout.actions` div は維持）。未使用化した `onNavigate` prop（分割代入＋型）と `import type { Screen }` を削除。
- `screens/settings/SettingsScreen.tsx`: 「メインに戻る」`Button` が `layout.actions` の唯一の要素のため **`layout.actions` div ごと削除**（`layout.top` は title のみ）。未使用化した `onNavigate` prop・`import type { Screen }`・`import { Button }`（この画面では他に `Button` プリミティブ未使用）を削除。`preference` / `onChangePreference` は維持。
- `App.tsx`: `<DiagnosticsScreen onNavigate={setScreen} />` / `<SettingsScreen onNavigate={setScreen} … />` から `onNavigate` を除去。`setScreen` は AddTool/AddPreset・`handleNavigate` で継続使用のため残置。

### やらないこと（維持）

AddTool / AddPreset 等その他画面の「戻る」ボタン（対象外）／ヘッダー・その他導線・スタイル・Rust / DB / `types.ts` の変更／新ライブラリ・外部リソース追加。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0・未使用 prop/import なし）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `git diff --name-only` → `App.tsx` / `DiagnosticsScreen.tsx` / `SettingsScreen.tsx`（＋ `docs/progress.md`。Header 系は 026 本体の未コミット差分）
- **セキュリティ確認（docs/security.md 準拠）**: frontend のみ・削除のみ。OS / ファイル / プロセス操作を追加せず（§2/§4）、外部通信・外部リソース・telemetry を増やさない（§1/§CSP）。新規 command / capabilities / ライブラリなし。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: 診断画面で「メインに戻る」が消え「再読込」は残る／設定画面で「メインに戻る」が消えタイトルのみのヘッダー行になりレイアウト非破綻／どちらもヘッダーのロゴからメインへ戻れる／ライト・ダーク両テーマで破綻しない。

## 2026-07-12 026 追加 未実装ヘッダーリンクを2本化し「準備中」ダミーページへ遷移（frontend のみ）

ヘッダーの機能大別セクション導線の未実装リンクを「らくらくツール導入」「OBSエフェクト」の2つに整理し、無効表示（クリック不可）をやめて**クリックで「準備中（To be continued）」ダミーページへ遷移**するようにした。実機能はまだ無いが今後追加される旨を遷移先で伝える。frontend のみ・Rust / DB / bindings 変更なし・新規ライブラリ / 外部リソースなし。

### 変更内容

- `types.ts`: `Screen` union に `"rakuraku-tools" | "obs-effects"` を追加（ダミーページ遷移のため。前タスクまでの「Screen を増やさない」方針は本要望で更新）。
- **【新規】`components/headerSections.ts`**: ヘッダー導線の単一ソース `HEADER_SECTIONS`（`{ id, label, screen, implemented, comingSoonDescription? }`）。Header（リンク描画）と App（準備中ページ描画）が同配列を参照し label 重複を回避。ツール管理=implemented / らくらくツール導入・OBSエフェクト=未実装。
- `components/Header.tsx`: ローカル `SECTIONS`（enabled/disabled 判別 union）を撤去し `HEADER_SECTIONS` を使用。セクションは**全項目を均一な navigable リンクとして描画**（`disabled` 分岐撤去。見た目はツール管理と同一）。`activeNav` 型を `main / rakuraku-tools / obs-effects / diagnostics / settings` に拡張。
- `components/Header.module.css`: `.sectionBtn:disabled` を削除、`.sectionBtn:hover:not(:disabled)` を `.sectionBtn:hover` に戻す（無効項目が無くなったため）。生 hex/rgba なし。
- **【新規】`screens/coming-soon/ComingSoonScreen.tsx` + `.module.css`**: 再利用可能な「準備中」ページ。props `{ title, description? }`。`formLayout` の見出し＋中央寄せカードに 🚧・「準備中 / To be continued」・説明・「今後のアップデートで追加予定です。」を表示。トークン（`--surface`/`--line`/`--muted`/`--text-faint` 等）のみ・絵文字のみ・外部リソースなし。
- `App.tsx`: `HEADER_SECTIONS` から `comingSoonSection = HEADER_SECTIONS.find(s => !s.implemented && s.screen === screen)` を導出し、該当時に `<ComingSoonScreen title description />` を描画（新画面は sidebar 無し＝full-width）。`activeNav` 導出を新セクション込みに拡張。

### やらないこと（維持）

らくらくツール導入 / OBSエフェクトの実機能実装（ダミーページのみ）／ヘッダーの見た目・診断/設定・ロゴ導線・その他画面の変更／Rust / DB / capabilities の変更／新ライブラリ・外部リソース追加。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0・`Screen` 追加を各分岐が網羅・未使用なし）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `git diff --name-only` → `types.ts` / `components/headerSections.ts`（新規）/ `components/Header.tsx` / `components/Header.module.css` / `screens/coming-soon/ComingSoonScreen.tsx`（新規）/ `screens/coming-soon/ComingSoonScreen.module.css`（新規）/ `App.tsx`（＋ `docs/progress.md`）
- 生の hex/rgba 残置なし（`ComingSoonScreen.module.css` / `Header.module.css` を grep 済み・全て `var(--...)`）／外部リソース読み込みなし（絵文字のみ・`http`/`url(`/`@import` 無し）
- **セキュリティ確認（docs/security.md 準拠）**: frontend のみ。OS / ファイル / プロセス操作を追加せず（§2/§4）、アイコン/装飾は絵文字のみで外部リソース・外部通信・telemetry を増やさない（§1/§CSP）。新規 command / capabilities / ライブラリなし。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: ヘッダーの未実装リンクが「らくらくツール導入」「OBSエフェクト」の2つ（＋ツール管理）になっている／それぞれクリックで「準備中」ダミーページへ遷移し未実装だが今後追加される旨が分かる・該当リンクが active 表示／ロゴ・ツール管理でメインへ戻れる／全画面でヘッダー常時表示・sidebar 有無ともレイアウト非破綻／ライト・ダーク両テーマで破綻しない。

## 2026-07-12 027 First-Run Tutorial (Onboarding)（初回起動ガイドツアー・frontend のみ）

初見ユーザーに「ツール登録 → 配信プリセット作成 → 一括起動」のコア導線を体験で伝えるため、初回起動時のみ薄暗いオーバーレイ＋スポットライトで 16 ステップのガイドツアーを表示。実ツール1件＋実プリセット1件を作らせながら一括起動まで到達させる。frontend のみで完結し、Rust / SQLite / Tauri command / capabilities / CSP・依存は不変。既存挙動は不変で、**唯一の例外＝チュートリアル中のキャンセルボタン無効化のみ**。永続化は `theme.ts` と同方式（localStorage 直接 read/write・例外握りつぶし）。

### 変更内容

**【新規】features/tutorial 構成**
- `features/tutorial/tutorialStorage.ts`: キー `stream-dock.tutorial.completed`。`isTutorialCompleted()` / `markTutorialCompleted()` を try/catch 握りつぶし（`theme.ts` 踏襲）。
- `features/tutorial/tutorialSteps.ts`: 16 ステップ静的定義 `TUTORIAL_STEPS`。各 = `{ id, mode, targetId?, title?, body, advanceOn, lockCancel? }`。`mode` = `dialog` / `spotlight-info`（穴あきで対象を明るく・クリック不可・次へ）/ `spotlight-action`（対象クリック可・ボタン非表示・操作/状態で進む）。`advanceOn` 判別 union = `next` / `target-click{clickId?}` / `screen` / `tools-increased` / `presets-increased`。
- `features/tutorial/useTutorial.ts`: Context 定義＋`useTutorial()` フック。値 `{ active, currentStep, stepIndex, advance, skip, isCancelLockedByTutorial }`。Provider 未設置でも既定値で安全。
- `features/tutorial/TutorialProvider.tsx`: 薄い Provider。props = 監視用 `screen` / `toolsCount` / `presetsCount`。初回判定 = `VITE_SHOW_TUTORIAL==="true"`（env 強制）or `!isTutorialCompleted()`。**開始時に `markTutorialCompleted()`＝中断（閉じる/リロード）も完了扱い**（env 強制時のみフラグを書かず毎回表示）。**状態条件 advance は 1 本の useEffect に集約**し、App から渡る `screen` 一致 / `tools`・`presets` 件数増（ステップ開始時 `baselineRef` 比較）を監視して `advance()`。各画面のハンドラは非改変（非破壊）。

**【新規】オーバーレイ描画（クリック制御方式）**
- `components/tutorial/TutorialOverlay.tsx`: `#root` へ `createPortal`。対象は `querySelector('[data-tutorial-id]')` を `getBoundingClientRect` で計測。**穴あきディム＝上下左右 4 枚パネル方式**（各 `pointer-events:auto` でディム＋外側クリック遮断、穴は空けて対象がネイティブにクリックを受ける＝`spotlight-action`）。**`spotlight-info` は穴に透明ブロッカーを重ねてクリック不可**。`dialog`・対象未検出は全面ディム＋中央カードへフォールバック（「次へ」で進行が止まらない）。再計測は `resize`/`scroll`(capture)＋`ResizeObserver`＋step 変化を **`requestAnimationFrame`** でコアレス（穴がリサイズ・スクロールで対象へ追従）。`target-click` は document capture の click リスナで `closest(clickId)` 一致時 `advance()`（ネイティブ onClick は通常どおり実行＝実操作を兼ねる）。吹き出し（copy＋`next` 時のみ「次へ」）、クリック可ステップに 👆 インジケータ、常時右下に「チュートリアルをスキップ」。
- `components/tutorial/TutorialOverlay.module.css`: ディム・吹き出し・リング・インジケータ・z-index（既存 z-index 規約が無いため新規定義: 9000 系）。**色は全て `var(--tutorial-*)` / 役割トークン経由・生 hex/rgba なし**。

**【新規】env / 型**
- `apps/desktop/.env.local.example`: `VITE_SHOW_TUTORIAL=true`（`.gitignore` の `*.local` で `.env.local` 自体は無視）。
- `vite-env.d.ts`: `interface ImportMetaEnv { readonly VITE_SHOW_TUTORIAL?: string }` を追記。

**【変更】トークン追加（theme.css）**
- `styles/theme.css`: tutorial 専用トークンを `:root` に追加のみ（`--tutorial-dim`＝両テーマ暗いスクリム定数 / `--tutorial-bubble-bg`=`--surface-2` / `--tutorial-bubble-border`=`--elev-border` / `--tutorial-ring` / `--tutorial-ring-soft` / `--tutorial-shadow`）。役割トークン参照は late-bound でテーマ追従。module.css を var 経由に保つための追加。

**【変更】data-tutorial-id の付与（加算的・挙動不変）**
- `components/Header.tsx`: `header-sections`（セクション群 div）/ `header-section-${s.id}`（各セクションボタン＝`header-section-tools` / `-rakuraku` / `-obs`）。
- `components/Sidebar.tsx`: `sidebar-add-tool` / `sidebar-add-preset`。
- `screens/add-tool/AddToolScreen.tsx`: `add-tool-kind-toggle` / `add-tool-panel`。**キャンセル Button に `disabled={isCancelLockedByTutorial()}`**（唯一の挙動変更）。
- `screens/add-preset/AddPresetScreen.tsx`: `add-preset-panel` / `add-preset-next` / `add-preset-launch-list` / `add-preset-submit`。**Step1 キャンセル Button に `disabled={isCancelLockedByTutorial()}`**（唯一の挙動変更）。
- `screens/main/MainScreen.tsx`: `main-launch-all`（右上の一括起動/停止 Button）。

**【変更】App 配線**
- `App.tsx`: ツリーを `TutorialProvider`（props: `screen` / `tools.length` / `presets.length`）でラップし、`Window` と同階層に `TutorialOverlay` を描画。既存 state・ハンドラ・画面 props は不変（Provider ラップに伴う内側 JSX の再インデントのみ）。

### 16 ステップ対応表（# → mode → targetId → advanceOn）

| # | mode | targetId | advanceOn | lockCancel |
|---|---|---|---|---|
| 1 | dialog | — | next | |
| 2 | dialog | — | next | |
| 3 | spotlight-info | header-sections | next | |
| 4 | spotlight-action | header-section-tools | target-click | |
| 5 | spotlight-action | sidebar-add-tool | screen=add-tool | |
| 6 | spotlight-info | add-tool-kind-toggle | next | |
| 7 | spotlight-action | add-tool-panel | tools-increased | ✔ |
| 8 | spotlight-action | sidebar-add-preset | screen=add-preset | |
| 9 | spotlight-info | add-preset-panel | next | |
| 10 | spotlight-action | add-preset-panel | target-click(add-preset-next) | ✔ |
| 11 | spotlight-info | add-preset-launch-list | next | |
| 12 | spotlight-action | add-preset-submit | presets-increased | |
| 13 | dialog | — | next | |
| 14 | spotlight-action | main-launch-all | target-click（実起動を兼ねる） | |
| 15 | dialog | — | next | |
| 16 | dialog | — | next（末尾で完了・非表示） | |

- 仕様の numbered 1〜16 に 1:1 対応。解釈 2 点: item 3（ヘッダー各セクション「順に説明」）はセクション群 1 ステップに集約し copy で 3 セクションを順に説明（診断/設定への任意言及は割愛）。item 8（成功 dialog → プリセット追加 spotlight-action）は全面 dialog だとサイドバーを押せないため成功メッセージを spotlight-action の吹き出しに内包して 1 ステップ化。
- キャンセル無効化は 2 箇所のみ（AddTool キャンセル / AddPreset Step1 キャンセル）。フォーム操作可ステップ（7/10）の穴はフォーム全体を露出するため、穴に入るキャンセルを `disabled` で塞ぐのが目的。AddPreset Step2 は穴を「保存して作成」に絞り 戻る はディムで遮断。

### やらないこと（維持）

Rust / SQLite / Tauri command / capabilities / CSP / 依存の変更。ステップ途中保存・再開ロジック（中断＝完了扱い）。設定画面の「もう一度見る」リセット。キャンセル無効化以外の既存挙動変更・大規模リファクタ。未実装ヘッダーセクション（らくらく/OBS）の実画面実装。新規 npm/crate/plugin・外部リソースの追加。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `git diff --name-only` → `App.tsx` / `components/Header.tsx` / `components/Sidebar.tsx` / `screens/add-tool/AddToolScreen.tsx` / `screens/add-preset/AddPresetScreen.tsx` / `screens/main/MainScreen.tsx` / `styles/theme.css` / `vite-env.d.ts`（＋新規 `features/tutorial/` 4 ファイル・`components/tutorial/` 2 ファイル・`.env.local.example`）。**`src-tauri/` に変更なし**。
- `TutorialOverlay.module.css` に生 hex/rgba なし（grep 済み・全て `var(--...)`）／新規ファイルに `http`・`url(`・`@import` の外部参照なし／新規依存（`package.json`/`Cargo.toml`/`pnpm-lock`）なし／capabilities・`tauri.conf.json`(CSP) 不変。
- **セキュリティ確認（docs/security.md 準拠）**: frontend のみ。OS / ファイル / プロセス操作を追加せず（§2/§4）、インジケータは絵文字のみで外部リソース・外部通信・telemetry を増やさない（§1/§CSP）、localStorage はローカルのみ（テーマ設定と同方針）。新規 command / capabilities / ライブラリなし（§10）。Rust / CSP 不変。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: `.env.local` に `VITE_SHOW_TUTORIAL=true` を置いて `pnpm --filter ./apps/desktop tauri dev`。16 ステップを踏破でき実ツール1件＋実プリセット1件が作られ一括起動まで到達／スポットライトの穴がリサイズ・スクロールで対象に追従／ステップ 7・10 でキャンセルボタンが無効／右下「チュートリアルをスキップ」で即終了し以降再表示されない／完了フラグ済み（env 強制なし）では何も表示されない／ヘッダー巡回で未実装セクションへ遷移せず補足が出る／ライト・ダーク両テーマで破綻しない。

## 2026-07-12 027 追加 チュートリアルオーバーレイの表示・操作不具合修正（frontend のみ）

初回チュートリアルの実機確認で判明した 2 件を修正。いずれも `components/tutorial/TutorialOverlay.tsx`（＋`.module.css`）に閉じ、16 ステップ定義・advance・data-tutorial-id・キャンセル無効化・Provider・Rust / CSP / 依存は不変。

### 不具合と原因

1. **吹き出し／矢印が画面外にはみ出す**（ステップ7 `add-tool-panel` / 10 `add-preset-panel`）: 穴＝縦長フォームパネルなのに配置が「上/下」2択で、縦の余白不足時に吹き出しを `top: innerH-60`・インジケータを画面外へ置いていた。
2. **スポットライトがヘッダーに被るとヘッダーのリンクが押せてしまう**: `Window.module.css` の `.main { overflow:auto }` で本文が 65px ヘッダー配下へスクロールし、縦長パネルをスクロールすると対象 `rect.top` が負→穴上端が 0 に張り付き、穴（クリック透過領域）がヘッダー帯を覆って上ディムパネルが消え、ヘッダーのリンクがネイティブに押せて別画面へ遷移していた。副次: ヘッダー対象の spotlight-action（ステップ4）が PAD=6 で隣接リンク（間隔4px）に被って押せていた。

### 修正内容（`TutorialOverlay.tsx` / `.module.css`）

- **A（不具合2主対策）**: ヘッダー下端を `document.querySelector("header")` の rect で計測し state 化（既存 `scheduleMeasure` に同梱）。**ヘッダー以外を対象とするステップ**（`targetId` が `"header-"` 始まりでない）では穴上端を `top = max(0, rawTop-pad, headerBottom)` にクランプ。上ディムパネルが常にヘッダーを覆い `pointer-events:auto` で遮断する。クランプ後 `holeW/holeH<=0`（対象が完全にヘッダー裏へ）は中央カードフォールバックへ倒す。
- **B（不具合2副次）**: PAD を対象で出し分け（`pad = isHeaderTarget ? 0 : 6`）。ヘッダー対象（3/4）は穴を対象ぴったりにして隣接リンク漏れを解消（視認性は既存リングのグローで担保）。
- **C（不具合1）**: 配置を空きスペースに応じ **下→上→右→左** で選ぶ `computePlacement()` に置換（縦が入らない縦長パネルは自動で横＝プレビュー列側へ）。インジケータは向きを配置に追従（下👆/上👇/右👈/左👉）、横配置は `.indicatorSide`（横バウンス）。横吹き出しは `.bubbleSide`（`max-width:300px`）で幅を抑え対象に被りにくく。吹き出し・インジケータは常に viewport 内へ clamp。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- 変更は `components/tutorial/TutorialOverlay.tsx` / `TutorialOverlay.module.css`（＋本 `docs/progress.md`）のみ。**`src-tauri/` 変更なし**。`.module.css` に生 hex/rgba なし（`var(--...)` のみ）・外部参照なし・新規依存なし。
- **セキュリティ確認（docs/security.md 準拠）**: frontend のみ。OS / ファイル / プロセス操作を追加せず（§2/§4）、インジケータは絵文字のみで外部リソース・外部通信・telemetry を増やさない（§1/§CSP）。新規 command / capabilities / ライブラリなし（§10）。Rust / CSP 不変。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: `.env.local` に `VITE_SHOW_TUTORIAL=true` を置いて起動。ステップ7/10 で吹き出し・矢印が穴の横に出て画面外へはみ出さない（縦に狭めても横へ回り込む）／どのステップでも（縦長パネルをスクロールしても）ヘッダーが常に暗転しリンクを押せず誤遷移しない／ステップ4でハイライトが「ツール管理」に密着し隣の「らくらくツール導入」を押せずクリックで正常に次へ進む／既存挙動（16ステップ踏破・キャンセル無効・スキップ・穴の追従・ライト/ダーク）に回帰なし。

## 2026-07-12 027 追加 チュートリアル横配置時の指インジケータ被り修正（frontend のみ）

横配置（右/左）の吹き出しで指インジケータ（👈/👉）が吹き出しに重なり文字が読みにくかった。原因は `TutorialOverlay.tsx` の `computePlacement()` 横配置分岐で、穴〜吹き出しの間隔 `GAP=16` がインジケータの見た目幅（絵文字 `font-size:30px` ≒30px）より狭く、`right+2`/`left-32` 起点の指が吹き出し端へ食い込んでいた。

### 修正内容（`components/tutorial/TutorialOverlay.tsx` の `computePlacement()` のみ）

- 定数追加: `SIDE_GAP=46`（横配置の穴〜吹き出し間隔＝指が収まる幅）・`IND=30`（指の見た目幅）。
- 横配置を選ぶ閾値を `BW_SIDE + SIDE_GAP`（=346）に変更（ツール/プリセット画面の右空き ≒400px で満たす）。
- 右/左とも吹き出しを `SIDE_GAP` 分離し、インジケータを**穴と吹き出しの隙間の中央**へ配置（`right + (gapW-IND)/2` 等）→ 吹き出しへ被らない。
- 隙間がインジケータに満たない場合（狭い側へのフォールバック等）は戻り値 `showIndicator=false` として**指を描画しない**（可読性優先）。JSX を `{isAction && showIndicator && ...}` に変更。上下配置は常に表示。併せて上下配置のインジケータと吹き出しの間隔も軽微に拡大。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）／`lint` → 成功（exit 0）
- 変更は `components/tutorial/TutorialOverlay.tsx`（＋本 `docs/progress.md`）のみ。`.module.css` 変更なし・`src-tauri/` 変更なし・新規依存/外部リソースなし・Rust / CSP 不変（§1/§2/§4/§CSP/§10）。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: ステップ7/10 で吹き出しが穴の横に出て指が吹き出しに被らず文字が読める／横に狭めても画面内に収まり上下配置（他ステップ）に回帰なし。

## 2026-07-12 027 追加 プリセットStep1「次へ」のバリデーション失敗時にチュートリアルだけ進む問題の修正（frontend のみ）

チュートリアルのステップ10（プリセット Step1）が `advanceOn: target-click(add-preset-next)` で「次へ」クリック自体で進んでいたため、名前未入力・ツール未選択でも `AddPresetScreen.goNext()` がエラー表示で Step1 に留まる一方、チュートリアルだけ Step2 の説明（ステップ11）へ進み、画面と説明が食い違っていた（実装当初の既知の弱点）。

### 修正内容（`tutorialSteps.ts` ＋ `TutorialOverlay.tsx` のみ・非破壊）

- `AdvanceOn` に汎用プリミティブ `{ kind: "target-appears"; appearId }`（指定 data-tutorial-id 要素が DOM に現れたら進む）を追加。
- ステップ10 `preset-step1` の `advanceOn` を `target-appears("add-preset-launch-list")` に変更。`add-preset-launch-list`（起動リスト）は `AddPresetScreen` の内部 Step2 でのみレンダーされるため、**バリデーション通過して Step2 に入った時だけ**進む。`mode: spotlight-action` / `targetId: add-preset-panel` / `lockCancel` は維持し、native の「次へ」クリックは従来どおり `goNext()` を実行。
- `TutorialOverlay.tsx` に `target-appears` 用 useEffect を追加（要素の初回チェック＋`MutationObserver(document.body, childList/subtree)` で出現監視 → `advance()`、cleanup で disconnect）。既存の target-click 監視（ステップ4/14）は不変。`AddPresetScreen` のハンドラ・バリデーション・data 属性は非改変。

### 確認

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）／`lint` → 成功（exit 0）
- 変更は `features/tutorial/tutorialSteps.ts` / `components/tutorial/TutorialOverlay.tsx`（＋本 `docs/progress.md`）のみ。`src-tauri/` 変更なし・新規依存/外部リソースなし・Rust / CSP 不変（§1/§2/§4/§CSP/§10）。
- **実機表示（`tauri dev`）は未実施**（ユーザー環境で確認依頼）: プリセット Step1 で名前/ツール未設定のまま「次へ」→ エラーが出て Step1 に留まり、チュートリアルも Step1 の説明のまま進まない／入力・選択して「次へ」→ Step2 に入りチュートリアルが「起動設定」へ進む／部分入力でも Step2 到達まで進まない／以降（保存して作成→一括起動→完了）まで通し他ステップに回帰なし。

## 2026-07-12 027 レビュー対応 advance 多重呼び出しによるステップ飛ばしの冪等化（frontend のみ）

027 の差分全体（本実装＋4修正）にセキュリティ／品質レビューを実施。セキュリティは問題なし（`src-tauri/`・capabilities・CSP・依存すべて不変、外部通信/リソースなし、危険 DOM API なし、localStorage はテーマ同方針、セレクタは静的定数のみ）。品質は「中1・低2」を検出し、中1 のみ修正。

### 今回完了したこと

- **中の修正**: `advance()` がステップ遷移コミット前に複数回呼ばれるとステップを飛ばし得る問題（target-click のダブルクリック＝ステップ14 で「一括起動できました」を飛ばす／target-appears の MutationObserver 多重発火／screen 条件 effect 再発火）を冪等化。`TutorialProvider` に `stepIndexRef`（コミット済み index ミラー）＋`advancedFromRef`（直近 advance 済み index）を追加し、`advance()` は `advancedFromRef.current === from` なら no-op。判定・更新は `setStepIndex` の **updater 外**で行い StrictMode の updater 二重実行を回避。state 条件は既存 `baselineRef` に加え本ガードで一律冪等化。
- **低1（未修正・意図をコメント化）**: `add-preset-next` の `data-tutorial-id` はバグD修正で target-appears へ切替後どのステップも参照しないが、害のない安定目印として残置する旨を `AddPresetScreen.tsx` にコメント記載。
- **低2（対応不要）**: 対象未検出時の中央カード縮退は既存コメント（`TutorialOverlay.tsx` の「進行が止まらないよう」）で意図が既述のため追加なし。

### 変更した主要ファイル

- `apps/desktop/src/features/tutorial/TutorialProvider.tsx`（冪等ガード追加。挙動は正常時不変・安全側の防御のみ）
- `apps/desktop/src/screens/add-preset/AddPresetScreen.tsx`（`add-preset-next` 残置理由コメントのみ・挙動不変）

### まだ未完了のこと / 次にやるべきタスク

- **実機表示（`tauri dev`）が 027 全体で未実施**。`.env.local` に `VITE_SHOW_TUTORIAL=true` を置いて 16 ステップ通し確認が最優先。特に本回の冪等化: **ステップ14「一括起動」を素早く2回押しても「一括起動できました」（ステップ15）を飛ばさない**こと、および全ステップで飛ばし・回帰がないこと。
- ライト／ダーク両テーマの視認性確認（レビュー指摘の軽微メモ: ライト時のグロー `--tutorial-ring-soft`＝secondary 28% が淡い。主線リング 72% が輪郭を担保するため実害は小だが、実機で縁が弱ければ 38–40% へ調整余地）。
- 実機 OK 後、027 差分（新規 `features/tutorial/`・`components/tutorial/`＋既存への加算的変更）をコミット。

### 既知のエラー

- なし（typecheck / lint ともクリーン、コンパイルエラー・ランタイム既知不具合なし）。未実施なのは実機目視確認のみ。

### 実行した確認コマンド

- `pnpm --filter ./apps/desktop typecheck` → 成功（exit 0）
- `pnpm --filter ./apps/desktop lint` → 成功（exit 0）
- `git status --porcelain` ／ `git diff --name-only` ／ `src-tauri`・`Cargo`・`tauri.conf`・`capabilities`・`package.json`・`pnpm-lock` の変更なしを grep 確認（すべて空＝不変）
- `grep` で tutorial 配下に `http`/`url(`/`@import`/`fetch`/`WebSocket`・`innerHTML`/`dangerouslySetInnerHTML`/`eval`・`.module.css` の生 hex/rgba がないことを確認（いずれもなし）

### 次回セッションで最初に読むべきファイル

- 本 `docs/progress.md` 末尾の 027 各節（本実装＋4修正＋本レビュー対応）
- `docs/tasks/027-first-run-tutorial.md`（仕様・完了条件・セキュリティ制約）
- `apps/desktop/src/features/tutorial/TutorialProvider.tsx`（冪等ガードの実装）
- `apps/desktop/src/components/tutorial/TutorialOverlay.tsx`（幾何・target-click/target-appears の advance 経路）
- `apps/desktop/src/features/tutorial/tutorialSteps.ts`（16 ステップ定義・advanceOn union）

## 2026-07-12 028 Windows App Icon Auto-Extraction（Windows(.exe) 実アイコン抽出の本実装・Rust のみ）

### 完了したこと（本タスクの完了条件＝macOS 上で達成）

- 018 で `Ok(None)` スタブだった **Windows(.exe) の実アイコン抽出**を本実装した。ユーザーがピッカーで選んだ
  `.exe` のシェル表示アイコンを取得し、018 と同じ出力仕様（`data:` 無し base64 PNG・≤128px・失敗は `Ok(None)`）で返す。
  frontend / DB スキーマ / `extract_app_icon` の I/F・出力仕様は **018 のまま流用（変更なし）**。実質は Rust の
  Windows 抽出ロジック追加 + Cargo.toml の依存再配置/feature 追加のみ。
- ⚠️ **Windows コードは未検証のまま main に入る**（下記「未検証範囲」）。実コンパイル・実機 E2E は 098 が初。

### (1) Cargo.toml（依存再配置と feature 追加・docs/security.md §10）

- `image`（`default-features=false, features=["png"]`）と `base64` を `[target.'cfg(target_os = "macos")'.dependencies]`
  から **共通 `[dependencies]` へ移動**。理由: 共有化した `encode_png_base64`（icon.rs 直下・macOS/Windows で
  コンパイル）が両クレートを参照するため。機能スペックは維持・**新規クレート追加ではない**（ターゲット再配置）。
  `plist` / `icns` / `objc2-*` は macOS 限定のまま据え置き。
- `[target.'cfg(windows)'.dependencies] windows`（0.58）に feature を4つ追加（理由コメントを Cargo.toml に明記）:
  - `Win32_UI_Shell`（`SHCreateItemFromParsingName` / `IShellItemImageFactory` / `SHGetFileInfoW`）
  - `Win32_Graphics_Gdi`（`GetObjectW` / `GetDIBits` / `HBITMAP` / `BITMAP` / `DeleteObject` / DC 系 / `GetIconInfo`）
  - `Win32_System_Com`（`CoInitializeEx` / `CoUninitialize`）
  - `Win32_Storage_FileSystem`（`SHGetFileInfoW` の第2引数 `FILE_FLAGS_AND_ATTRIBUTES` 由来。**task doc の当初
    一覧には無かったが、windows 0.58 実ソースの `#[cfg(all(Win32_Storage_FileSystem, Win32_UI_WindowsAndMessaging))]`
    gate 上フォールバック採用に必須**と机上確認できたため追加。ユーザー承認済み）。
- `Cargo.lock` は**変更なし**（feature 選択は Cargo.toml に記録され、解決済みクレートの版・依存グラフは不変。
  image/base64 のターゲット間移動も同一クレート・同一版のため lock に差分は出ない）。

### (2) icon.rs 共通化リファクタ（macOS 挙動不変）

- `MAX_ICON_PX` と `encode_png_base64(DynamicImage) -> Option<String>` を `mod macos` 内から **`icon.rs` 直下へ
  引き上げ**、`#[cfg(any(target_os = "macos", windows))]` で gate（Linux では未使用のため dead_code 警告回避）。
  `use base64::Engine;` は当該 fn 内へ移動。macOS 側は呼び出しを `super::encode_png_base64(...)` に変更しただけで
  **ロジック・出力は完全不変**。
- `extract_app_icon` の分岐を3分割: `#[cfg(target_os="macos")]`→`macos::extract` /
  `#[cfg(windows)]`→`windows::extract` / `#[cfg(all(not(macos),not(windows)))]`→`Ok(None)`（Linux 従来どおり）。
- `validate_icon_path` は変更なし（`.app` 例外は `cfg!(target_os="macos")` gate 済み。Windows では `.exe` 通過・
  ディレクトリ/`.lnk`/`.bat` 拒否）。

### (3) 新設 `#[cfg(windows)] mod windows`（抽出設計・リソース解放）

- **主経路 `extract_via_shell_image`**: `CoInitializeEx(None, COINIT_APARTMENTTHREADED)` →
  `SHCreateItemFromParsingName::<_,_,IShellItemImageFactory>(PCWSTR, None IBindCtx)` →
  `GetImage(SIZE{128,128}, SIIGBF_ICONONLY|SIIGBF_BIGGERSIZEOK)` → `HBITMAP` → `hbitmap_to_rgba` →
  `image::RgbaImage::from_raw` → 共有 `super::encode_png_base64`。
- **フォールバック `extract_via_file_info`**: `SHGetFileInfoW(SHGFI_ICON|SHGFI_LARGEICON)` → `HICON` →
  `GetIconInfo` → カラー `HBITMAP` → 同 `hbitmap_to_rgba`。`.ico` 直接指定や主経路不可環境の保険。
- **共通 DIB 変換 `hbitmap_to_rgba`**: `GetObjectW`(BITMAP) で幅/高さ → `GetDC(NULL)` の画面 DC →
  `BITMAPINFOHEADER`（`biHeight` 負＝top-down・32bpp・`biCompression=0(BI_RGB)`）で `GetDIBits` →
  32bpp BGRA を取得 → **B↔R スワップで RGBA 化**（premultiplied alpha は表示用途で許容）。
- すべて失敗で `None`（→ `extract_app_icon` が `Ok(None)` → 文字フォールバック）。
- **リソース解放方式＝RAII ガード**（ユーザー承認済み）: `ComGuard`（`CoUninitialize`・自分が初期化した
  S_OK/S_FALSE 時のみ true・`RPC_E_CHANGED_MODE` では uninit しない）/ `OwnedHBitmap`（`DeleteObject`）/
  `OwnedHIcon`（`DestroyIcon`）/ `ScreenDc`（`ReleaseDC`）の Drop で全 early-return・`?` 経路を網羅。
  **Rust の逆順 Drop により COM インターフェース Release が `CoUninitialize` より先**に走る宣言順にしてある
  （`_com` を関数先頭で宣言）。`GetIconInfo` の `hbmColor`/`hbmMask` は両方 `DeleteObject`。`unsafe` は各 FFI
  呼び出し単位の最小スコープに限定。

### 机上整合（windows 0.58 実ソースで確認済み）

- `~/.cargo/registry/cache/.../windows-0.58.0.crate` を展開し、使用 API の実シグネチャ・feature gate・struct の
  `Default` 実装・`HBITMAP: CanInto<HGDIOBJ>` を照合済み。macOS では `cargo check` 対象外のため**机上整合のみ**。

### セキュリティレビュー結果（security-review 実施済み・必須）

- 判定: **問題なし**（018 のセキュリティ姿勢を Windows へ逸脱なく拡張）。修正必須項目なし。
- 確認済み: 読み取り専用（`GetImage`/`SHGetFileInfoW`/GDI はアイコン取得のみ・write/delete/network なし・§1/§5）/
  新規 command・capabilities を増やさず 018 の `extract_app_icon` を流用（追加は `windows` feature のみで Tauri ACL
  権限ではない・§3/§10）/ 抽出対象は `validate_icon_path` 通過パスのみ（§7/§8。macOS の CFBundleIconFile のような
  二次パス解決＝トラバーサル面は Windows 経路に無い）/ 出力 ≤128px・エラーは `Ok(None)` に丸めフルパス/OS エラー
  非露出・ログ追加なし（§9）/ COM 解放順序が逆順 Drop で正しい・ハンドル/COM を全経路で解放/ `csp:null` 不変・
  `data:` inline のみ・外部通信ゼロ。

### 検証結果（本タスク＝macOS 上）

- `cd apps/desktop/src-tauri && cargo check` → **成功**（共通化リファクタ・依存再配置で mac 経路は非退行。
  ※ `#[cfg(windows)] mod windows` は macOS では**コンパイルされない**）。
- `pnpm --filter ./apps/desktop typecheck` → 成功 / `pnpm --filter ./apps/desktop lint` → 成功（frontend 変更なし・再確認）。
- 実機 macOS（`.app` 実アイコン抽出の非退行）はユーザー環境での確認をお願いしたい（コード上 mac 経路は
  呼び出しパス変更と依存再配置のみで出力不変）。

### 未検証範囲（本タスクの完了条件に含めない・098 Windows Build へ持ち越し）

- `#[cfg(windows)] mod windows` は **macOS では `cargo check` 未走・実機未確認**。型・API 名・unsafe FFI は
  windows 0.58 実ソースとの**机上整合のみ**。既存 `process/service.rs::mod windows`（前面化）と同じ
  「macOS で書いて Windows ビルドで初検証」扱い。098 でコンパイルエラー/不具合が出たら **098 側で最小修正**する前提。
- 098 で確認: Windows ARM64(VM) の `cargo check` / `cargo clippy`（`mod windows` 初コンパイル）/ `.exe`
  （メモ帳/OBS/Chrome 等）登録時に実アイコンがプレビュー・一覧・サイドバー・プリセット追加に表示される /
  アイコン無し `.exe` は文字フォールバックしクラッシュしない / 再起動後もアイコン保持 / ハンドル・COM リークが無いこと。

### やらないこと（維持）

- frontend / DB スキーマ / `extract_app_icon` の I/F・出力仕様の変更（018 の配線をそのまま流用）/ macOS 抽出
  ロジックの挙動変更（`encode_png_base64` の移動のみ）/ Linux のアイコン抽出（`Ok(None)`）/ `.lnk` 実体解決・
  `.bat` 対応・手動アップロード・差し替え・加工 / 一覧表示時の都度再抽出 / 高解像度化の追加依存
  （`SHGetImageList`/`SHIL_JUMBO` 等・まず 128px で十分か 098 実機で判断）/ 新規クレート追加（`windows` feature 追加のみ）。

### 変更ファイル

- `apps/desktop/src-tauri/Cargo.toml`（image/base64 を共通へ・windows feature 4つ追加＋理由コメント）
- `apps/desktop/src-tauri/src/tools/icon.rs`（共通化リファクタ＋`#[cfg(windows)] mod windows` 新設）
- `docs/progress.md`（本節）/ `docs/security.md`（028 の未検証注記を追記）

## 2026-07-12 098 Windows Build（Windows 11 ARM64 実機で初コンパイル・初 E2E・インストーラ生成）

macOS でしか動かしていなかった MVP を、UTM(QEMU) の **Windows 11 ARM64** VM 上で初めてビルド・起動・E2E した。
一度も Windows でコンパイルされていなかった `#[cfg(windows)]` コード（前面化・028 アイコン抽出・windows 0.58）を
`aarch64-pc-windows-msvc` で初コンパイルし、コア導線と要注意フローを実機確認、ARM64 インストーラ（.exe/.msi）まで生成した。

### 環境（(A)・手作業）

- VM: UTM(QEMU) / Windows 11 ARM64。ツールチェイン（すべて ARM64）: rustup ＋ `aarch64-pc-windows-msvc`（ネイティブ）、
  VS Build Tools ARM64（**MSVC v143 ARM64/ARM64EC ビルドツール**＋Windows SDK）、Node 24（20+ 要件を満たす）＋pnpm 10.33、Git for Windows。
- **詰まった点＝ブロッカーと解消**: `cargo check` で `error: linker link.exe not found`。原因は VS Build Tools に **ARM64 用 VC ツールが未導入**
  （`vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64` が空）。**「MSVC v143 - VS 2022 C++ ARM64/ARM64EC ビルドツール」を
  追加インストール**して解消。以後リンク成功。

### (B) 静的検査＝初コンパイル（全クリーン・コード修正ゼロ）

- `cargo check` → **成功**。`#[cfg(windows)] mod windows` ×2（`process/service.rs` 前面化 / `tools/icon.rs` 028 抽出）と
  windows 0.58 の全 feature/型/API が**初コンパイルでエラーなし**。事前に懸念した GDI/COM の型（`DeleteObject`/`GetObjectW` の
  `HGDIOBJ` 変換等）は windows 0.58 で問題なし。→ **028 の未検証 Windows コードは修正不要で通過**。
- `cargo clippy` → 警告なし。`pnpm typecheck` / `pnpm lint`（root）→ ともにエラーなし。

### (C) 実機起動・E2E（`pnpm tauri dev`）

- 見た目: フレームレス表示（`set_decorations(false)`）・自作 min/max/close・ドラッグ移動・タイトル二重表示/リサイズ破綻なし → OK。
- コア導線: `.exe` 登録（絶対パス検証）/ URL ツール（既定ブラウザ・023）/ プリセット作成→**一括起動→一括停止** / 個別起動・停止・
  ランタイムステータス → 全 OK。
- 要注意フロー（重点・progress.md 既知 TODO の解消）:
  - **「開く」で既存インスタンス前面化・二重起動しない**（`focus_by_pid`/`SetForegroundWindow`）→ **確認 OK**（未実施だった E2E を解消）。
  - **autostart**: OS スタートアップ（レジストリ Run キー）の登録・解除・`--autostart` 起動 → 確認 OK。
  - **028 アイコン抽出の実機初検証**: `.exe` の実アイコンがプレビュー/一覧/サイドバー/プリセットに表示・抽出不可は文字フォールバック・
    繰り返し登録で不安定化なし（**ハンドル/COM リーク兆候なし**）→ 確認 OK。

### 直した箇所（最小修正の内容と理由）

- **`apps/desktop/src-tauri/icons/icon.ico` の再生成のみ**（Windows 専用ファイル。macOS の `icon.icns` は未変更＝macOS 挙動不変）。
  - 理由: Windows のタスクバー等でアプリアイコンが他アプリより小さく見えた。原因は元アイコンが **macOS 慣習の余白（青い角丸が
    キャンバスの ~81%・四隅 ~9.4% 透明）** を持ち、端まで絵を敷く Windows で相対的に小さく見えるため。
  - 対応: ユーザー提供の**端まで敷いた高解像度素材（1254px）**から、角丸半径 ~176px の**透過マスク**（四隅を透明化・白い角を出さない）を
    当て、16/24/32/48/64/128/256px を**元画像から直接縮小レンダリング**して `.ico` を再生成（拡大由来のボケなし）。`tauri.conf.json` は変更せず。
  - Rust / frontend のコード変更は **一切なし**（(B) で修正ゼロ）。

### (C-4) インストーラ生成

- `pnpm tauri build` で **ARM64 の `.exe`(NSIS) と `.msi`(WiX) の両方を生成**（縮退なし。WiX が ARM64 で不可なら `.exe` のみに
  縮退する方針だったが、今回は両方生成できた）。インストール → 起動 → 新アイコン表示まで確認。
- 署名なしのため SmartScreen 警告は想定内（署名・公証は 099）。

### security-review 結果（前面化 / 028 unsafe FFI・実施済み＝必須）

- 判定: **問題なし**（修正必須なし）。progress.md 既知 TODO だった「前面化 / focus_process / windows クレートの security-review 未実施」を**解消**。
- 確認済み（docs/security.md 準拠）: `focus_process` は frontend から **launchId のみ**受け取り raw PID/HWND を受けない・前面化対象は
  **registry 保持の自分が起動した PID とその子孫**に限定・**プロセス名では探さない**（§6）/ registry に無い launchId は新規起動せず二重起動を根絶 /
  ウィンドウは `GetWindowTextLengthW` の**長さだけ**判定しタイトル文字列を読まない・エラー固定文言・ログ露出なし（§9）/ shell 非経由・
  外部通信/ファイル操作なし（§1/§4/§5）/ 028 は RAII ガードで全 early-return・`?` 経路のハンドル/COM 解放・COM Release→`CoUninitialize` の
  drop 順が正しい・`CloseHandle(snapshot)` 実施（リーク兆候なしの E2E と整合）/ 新規 crate なし（windows feature 追加のみ・§10）/ `csp:null` 不変。
- **既知の限界（記録のみ・修正不要）**: `collect_process_tree` は PID 再利用時に無関係な PID を子孫集合に含めうる（深さ 8/件数 1024 で保護）。
  ただし操作は**前面化のみ（kill しない）**で実害は「無関係なウィンドウが前面に出る」程度・低頻度。停止経路のような exe/start_time 照合の
  追加は前面化の低リスクに対し過剰なため据え置き。

### 完了条件の達成状況

- cargo check / clippy 通過 ✓ / typecheck・lint 通過 ✓ / dev でフレームレス＋min/max/close ✓ / ツール登録→プリセット作成→一括起動→一括停止 ✓ /
  「開く」で前面化・二重起動しない ✓ / autostart 登録・解除・`--autostart` ✓ / 028 アイコン抽出の実機表示・フォールバック・リーク無し ✓ /
  ARM64 `.exe`(NSIS) ＋ `.msi`(WiX) インストーラ生成・インストール・起動 ✓ / 前面化 security-review 実施＝問題なし ✓。

### 残課題

- コード署名 / 公証（署名なし SmartScreen 警告の解消）は **099** で対応。
- x86_64(x64) Windows 検証は本タスク対象外（ARM64 限定）。
- macOS 側の `.app` 実アイコン抽出の非退行（028 由来）は macOS 実機での確認継続（本タスクでは Windows のみ検証）。

### やらないこと（維持）

- macOS 挙動変更・共通ロジックの大規模リファクタ / Linux ビルド / CI 自動 Windows ビルド / 新機能追加（ビルド・起動に不可欠な最小修正のみ＝
  今回は icon.ico の再生成のみ）/ 新規 npm・crate・plugin 追加。

### 変更ファイル

- `apps/desktop/src-tauri/icons/icon.ico`（Windows アプリアイコン再生成のみ。macOS の `icon.icns` は不変）
- `docs/progress.md`（本節）/ `docs/security.md`（§098 の実検証・security-review 済み注記を追記）

## 2026-07-12 099 User Test Package フェーズ1（配布 CI・GitHub Actions で Mac/Win(x64) 自動ビルド）

ユーザー配布の基盤を作る。ビルド自動化の方式（Docker/VM 可否）と署名の要否という2つの問いに答え、
**GitHub Actions（クラウド CI）**で macOS と Windows(x64) のインストーラを自動生成し **GitHub Releases** へ
配布する仕組みを入れた。**アプリ本体のコード変更なし**（配布設定・ドキュメントのみ）。

### 背景の結論（2つの問いへの回答）

- **Docker で Windows ビルド不可**: Windows コンテナは Windows ホストが要り Apple Silicon Mac で動かない
  （Mac の Docker は Linux のみ）。Tauri もクロスコンパイル不可。
- **VM も不要にできる**: 配布ターゲットを **Windows x64**（一般ユーザーのほぼ全員・ARM64 でも x64 エミュで動作）
  にすれば windows-latest（x64）クラウドランナーでビルドでき、VM/Docker 不要。098 の ARM64 VM は配布に使わない。
- **署名は必要**（未署名は SmartScreen/Gatekeeper 警告）。ユーザー方針＝**Windows のみ署名**（証明書取得後に追加）。

### 決定事項

- ビルド自動化 = GitHub Actions / Windows = **x64 のみ**（`x86_64-pc-windows-msvc`）/ macOS = **universal(.dmg)・未署名** /
  署名 = **Windows のみ**（フェーズ2）/ 配布 = **GitHub Releases**（登録不要 DL）。窓の杜/Vector は別途手動申請。

### フェーズ1（本セッションで実装＝未署名・費用ゼロ）

- **配布方式の決定（ソース非公開のまま配布）**: このリポジトリ（`stream-dock`）は **private のまま**、
  成果物だけを **別の public リポジトリ `satoh23/StreamDock-releases`** の Releases に置く。理由: GitHub Releases で
  「アカウント登録なしに誰でも DL」できるのは public リポジトリのみだが、ソースまで公開したくない（パクられ懸念）ため、
  バイナリ専用の public リポジトリに分離する。private の Actions から別リポジトリへ書くため `GITHUB_TOKEN` は使えず、
  Secrets `RELEASE_REPO_TOKEN`（public 側 Contents: R/W な Fine-grained PAT）を使う。
- `.github/workflows/release.yml`（新規）: 2 ジョブ構成。
  - `build`（macos-latest / windows-latest マトリクス）: tauri-action で**ビルドのみ**（tagName 未指定＝Release は作らない）→
    生成物（dmg/nsis/msi）を `actions/upload-artifact` で保存。macOS は `--target universal-apple-darwin`（rust targets 2つ）、
    Windows は既定 x64。pnpm(action-setup)＋Node20＋Rust(stable)＋rust-cache＋`pnpm install --frozen-lockfile`。
  - `release`（ubuntu・`needs: build`）: 全成果物を `download-artifact` で集約 → `softprops/action-gh-release@v2` で
    **public `StreamDock-releases` に Release 下書き**作成・添付（`repository` + `token: RELEASE_REPO_TOKEN`）。
  - 2 ジョブに分けたのは、両 OS が同じ Release を同時作成する競合を避け、公開先を1回の集約で作るため。
  - `permissions: contents: read`（公開先へは PAT を使うため本リポジトリ側は読み取りのみ）。
- `README.md`: リリース手順（前提＝public リポジトリ＋`RELEASE_REPO_TOKEN`／タグの打ち方・手動実行・生成物・未署名時の警告回避・
  ローカル `pnpm tauri build`）を追記。
- `docs/tasks/099-user-test-package.md`（新規スペック）。

### フェーズ2（未実装・証明書取得後）

- Windows 署名: `tauri.conf.json` に `bundle.windows.signCommand` ＋ workflow に署名ステップ・GitHub Secrets を追加。
  証明書はユーザー取得（Azure Trusted Signing 最安・要身元確認 / OV+Key Vault / OV・EV）。発行に数日〜数週間。

### セキュリティ（docs/security.md 準拠）

- アプリの OS/プロセス/ファイル操作の設計は不変（配布のみ・§2/§4/§5）。新規 crate/npm/plugin 追加なし
  （tauri-action は CI 上の Action・§10）。外部通信/telemetry/CSP 不変（§1/§CSP）。署名鍵は GitHub Secrets のみ（フェーズ2）。

### 検証（実装後にユーザーが実施）

- テストタグ `v0.0.1-test` を push（or Actions 画面から `release` を手動実行）→ Actions 緑 → Releases 下書きに
  macOS `.dmg` と Windows x64 `.exe`/`.msi` が並ぶ → Windows `.exe` を DL・インストール・起動（実機 or ARM64 VM の x64 エミュ）。

### 残課題

- フェーズ2（Windows 署名・証明書取得後）/ macOS 署名・notarize（別途）/ 自動アップデータ / 窓の杜・Vector 手動申請 /
  x64 実機での最終確認（現状 x64 実機が無く、ARM64 VM の x64 エミュ or ユーザーテストで代替）。

### 変更ファイル

- `.github/workflows/release.yml`（新規）/ `docs/tasks/099-user-test-package.md`（新規）/ `README.md`（リリース手順追記）/ `docs/progress.md`（本節）
