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
