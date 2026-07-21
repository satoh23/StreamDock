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

#### 追加 Secrets（099a・値はユーザーが各コンソールから取得。リポジトリには置かない）

- **コメントビューア焼き込み**（sidecar ビルド時に必須。未設定だと build-sea が fail-fast）:
  - `TWITCH_CLIENT_ID` … Twitch Developer Console のアプリ Client ID（public・非機密）
  - `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` … Google Cloud の「Desktop app」OAuth クライアント
- **Windows 署名（SSL.com eSigner・クラウド署名）**:
  - `ES_USERNAME` / `ES_PASSWORD` … SSL.com アカウントのログイン情報
  - `CREDENTIAL_ID` … eSigner の署名資格情報（証明書）ID（SSL.com ダッシュボード、または `get_credential_ids` で取得）
  - `ES_TOTP_SECRET` … 自動署名用の TOTP シークレット（eSigner の自動化設定で取得）

### リリース手順

```sh
# バージョンを更新（apps/desktop/package.json / src-tauri/Cargo.toml / tauri.conf.json）してから
git tag v0.1.0
git push --tags
```

タグ push で Actions が走り、完了すると **`StreamDock-releases` の Releases に下書き**が作られる。
内容を確認して publish する。動作確認だけなら GitHub の Actions 画面から `release` ワークフローを
**手動実行（workflow_dispatch）**してもビルドできる（下書き名は `CI build <番号>`）。

### 署名について

- **Windows**: CI に SSL.com の署名 Secrets（`ES_USERNAME` 他）が**設定されていれば**、tauri ビルド後に
  NSIS `.exe` / WiX `.msi` を **SSL.com の個人検証(IV)証明書 + eSigner クラウド署名**で署名する
  （プロパティ →「デジタル署名」に発行者表示）。**Secrets 未設定なら署名ステップは自動スキップし、未署名で配布**される
  ＝証明書取得前でも comment-viewer 入り MVP を配布でき、Secrets を入れた瞬間からコード変更なしで署名に切り替わる。
  - 未署名の間は初回に SmartScreen「不明な発行元」警告（「詳細情報 → 実行」で回避）。
  - 署名後も IV/OV は**評判蓄積型**のため配布直後は警告が残り、ダウンロード実績が貯まると発行者名表示へ切り替わる
    （即時解消は EV のみ・法人登録が要る）。
  - 補足: 当初は Azure Trusted Signing を予定したが、**日本在住の個人開発者は公開信頼証明書の対象外**
    （米国・カナダの個人／米国・カナダ・EU・英国の組織のみ）と判明したため、個人でも取得できる SSL.com IV に変更した。
  - 認証情報はすべて GitHub Secrets のみ（`ES_USERNAME` / `ES_PASSWORD` / `CREDENTIAL_ID` / `ES_TOTP_SECRET`）。
    リポジトリ・生成物・ログには含めない。
- **macOS = 未署名**（親 099 の決定どおり当面）。初回は Gatekeeper 警告が出るため、右クリック →「開く」で回避する。

### ローカルで手動ビルドする場合

```sh
pnpm tauri build            # 実行した OS 向けのインストーラを生成
```
