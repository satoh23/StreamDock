# stream-dock

配信者がPC上の複数ツールをプリセット単位で起動・停止するためのデスクトップアプリ。

## 技術構成

- Frontend: React + TypeScript (Vite)
- Desktop: Tauri 2
- Backend: Rust

## 必要要件

- Node.js 20 以上
- pnpm 10 以上
- Rust ツールチェイン (rustc / cargo)

## ディレクトリ構成

pnpm workspace のモノレポ構成。

- `apps/desktop/` … デスクトップアプリ全体
  - `apps/desktop/src/` … React + TypeScript フロントエンド
  - `apps/desktop/src-tauri/` … Rust / Tauri バックエンド
- root … workspace 管理用（`pnpm-workspace.yaml` / 管理用 `package.json`）

各コマンドは root から実行する（`--filter` で `apps/desktop` に委譲）。

## セットアップ

```sh
pnpm install
```

## 開発起動

```sh
pnpm tauri dev
```

初回は Rust 側のビルドに数分かかります。ビルド後にアプリのウィンドウが表示されます。

## 検証コマンド

```sh
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
cd apps/desktop/src-tauri && cargo check
```

## リリース / 配布（099）

ビルドは **GitHub Actions**（`.github/workflows/release.yml`）で自動化している。VM も Docker も不要で、
macOS と Windows(x64) のインストーラをクラウドで生成する。

- 生成物: macOS `.dmg`（universal・Intel/Apple Silicon 両対応）/ Windows x64 `.exe`(NSIS) + `.msi`(WiX)。
- Windows は **x64 のみ**（一般ユーザーのほぼ全員。ARM64 Windows でも x64 エミュで動作）。
- **このリポジトリ（ソース）は private のまま**。成果物だけを **別の public リポジトリ
  `satoh23/StreamDock-releases`** の Releases 下書きに添付する（ユーザーはそちらから登録不要で DL）。

### 前提（配布リポジトリと Secrets）

- public リポジトリ `satoh23/StreamDock-releases` を作成済み（README 等で最低1コミットが必要）。
- private リポジトリの Secrets に **`RELEASE_REPO_TOKEN`**（`StreamDock-releases` への Contents: Read/Write な
  Fine-grained PAT）を登録済み。`GITHUB_TOKEN` は別リポジトリへ書けないため PAT を使う。

### リリース手順

```sh
# バージョンを更新（apps/desktop/package.json / src-tauri/Cargo.toml / tauri.conf.json）してから
git tag v0.1.0
git push --tags
```

タグ push で Actions が走り、完了すると **`StreamDock-releases` の Releases に下書き**が作られる。
内容を確認して publish する。動作確認だけなら GitHub の Actions 画面から `release` ワークフローを
**手動実行（workflow_dispatch）**してもビルドできる（下書き名は `CI build <番号>`）。

### 署名について（現状）

- 現時点のインストーラは **未署名**。Windows は初回起動時に SmartScreen 警告が出る
  （「詳細情報」→「実行」で回避）。macOS は Gatekeeper 警告が出る（右クリック →「開く」で回避）。
- Windows のコード署名（SmartScreen 警告の解消）は証明書取得後に CI へ統合する（099 フェーズ2）。

### ローカルで手動ビルドする場合

```sh
pnpm tauri build            # 実行した OS 向けのインストーラを生成
```
