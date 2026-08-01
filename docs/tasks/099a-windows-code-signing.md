# 099a Windows コード署名（Azure Trusted Signing）を CI に統合

> 状態: **未着手（実装サブタスク）**。位置づけ・線引きは親 [099](099-user-test-package.md)（配布パッケージ・
> フェーズ2＝Windows 署名）を正とする。
>
> **必読前提**: 親 [099](099-user-test-package.md)（フェーズ1＝未署名 CI ビルド／フェーズ2＝本タスク）、
> [`docs/security.md`](../security.md)（特に §10 依存/配布ポリシー）。CLAUDE.md どおり **「実装して」まで変更せず、
> まず変更計画と対象ファイルを提示する**。**署名鍵/シークレットは GitHub 暗号化 Secrets のみに置く（リポジトリに混ぜない）**。
>
> **前提作業（ユーザー側・数日〜数週間）**: 本タスクの実装前に **Azure Trusted Signing のアカウント作成＋本人確認＋
> 証明書プロファイル発行**が完了していること（個人は 3 年以上の実在証明を求められる場合あり）。また **フェーズ1 の CI
> （[`.github/workflows/release.yml`](../../.github/workflows/release.yml)）がタグ push で未署名ビルドを生成できている**こと。
>
> ⚠ **【055a からの申し送り・着手時に必ず対処すること】eSigner の置換署名は updater の minisign 署名を壊す。**
> 現行 CI は `sslcom/esigner-codesign` を **tauri のビルド後**に走らせ、`.exe` / `.msi` を `override: true` で
> **置換署名**する。一方、[055a](055a-updater-release-pipeline.md) で有効化した `createUpdaterArtifacts` の `.sig`
> （minisign）は **tauri がバンドルした時点のバイト列**に対して作られるため、**置換署名でバイト列が変わり `.sig` と
> 一致しなくなり、Windows の自己更新が必ず署名検証で落ちる**。現在は `secrets.ES_USERNAME` 未設定でステップごと
> スキップされるため顕在化していないが、**本タスクで Secrets を入れた瞬間に発火する**。
> 対処方針（055a で決定・実施は本タスク）: **`bundle.windows.signCommand` へ寄せ、tauri のバンドル過程内で署名させてから
> updater 署名を作らせる**（後段の `override` 置換をやめる）。検証は [099b](099b-updater-e2e.md) の E2E-6。
>
> **055a で CI ガードを実装済み**（申し送りだけでは止まらないため）。`release.yml` の build ジョブ Windows レグにある
> ステップ **`Guard - post-build signing breaks updater signature (099a)`**
> （[`.github/scripts/check-updater-signing-compat.mjs`](../../.github/scripts/check-updater-signing-compat.mjs)）が、
> **`ES_USERNAME` を登録した瞬間**に CI を fail させる。設定ファイルとワークフローを読むだけなので
> **`Check version sync` の直後＝重いビルドの前**に置いてある（数十秒で落ちる）。
> ＝本タスクは **(1) の `signCommand` 設定を先に済ませないとビルドが通らない**。
>
> ⚠ **ガードは両側を見る**（055a のレビュー Q-5 で追加）:
> 1. `createUpdaterArtifacts` が真 かつ `bundle.windows.signCommand` **未設定** → fail（移行前）
> 2. `createUpdaterArtifacts` が真 かつ `release.yml` に `sslcom/esigner-codesign` を `override: true` で使う
>    ステップが**残っている** → fail（移行が中途半端）
>
> **＝ `signCommand` を設定しただけでは通らない。** ビルド後の置換署名ステップ
> （`Locate Windows installers` / `Sign NSIS installer (.exe)` / `Sign WiX installer (.msi)` の 3 つ）を
> **必ずセットで削除する**こと。片方だけだと元の地雷とまったく同じ壊れ方（`.sig` とバイト列の不一致）になる。
> 移行手順はそのスクリプトのエラーメッセージにも書いてある。

## 目的

Windows インストーラ（NSIS `.exe` / WiX `.msi`）を **Azure Trusted Signing** でコード署名し、DL/インストール時の
**SmartScreen「不明な発行元」警告を解消**する。macOS は当面未署名のまま（親 099 の決定どおり）。証明書取得後、
**署名を GitHub Actions の CI に統合**する（VM/Docker 不使用・鍵はリポジトリに置かない）。

## 現在の前提（調査結果）

- [`apps/desktop/src-tauri/tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json) の `bundle` は
  `targets: "all"`・`externalBin`・`icon` のみで、**`bundle.windows` オブジェクトが存在しない**
  （`certificateThumbprint`/`digestAlgorithm`/`timestampUrl`/`signCommand` いずれも未設定）。Windows は Tauri 既定で
  **NSIS `.exe` と WiX `.msi` の両方**を生成する（両方に署名が要る）。`app.security.csp` は `null`。
- CI は [`.github/workflows/release.yml`](../../.github/workflows/release.yml) の 1 本のみ。`build` ジョブが
  `macos-latest`/`windows-latest` マトリクスで `tauri-apps/tauri-action@v0`（`projectPath: apps/desktop`）を実行して
  未署名インストーラを artifact 化し、`release` ジョブが public リポジトリ `satoh23/StreamDock-releases` に下書き
  Release を作る（Secrets `RELEASE_REPO_TOKEN` 使用）。**署名ステップは無い**。
- 既存の署名設定は **どこにも無い**（Windows/macOS とも）。Cargo.toml/package.json に署名関連の依存も無い。
- 「鍵はリポジトリに置かず GitHub Secrets のみ」という運用パターンは `RELEASE_REPO_TOKEN` で既に確立済み（踏襲する）。

## このタスクでやること

### (1) tauri.conf.json に `bundle.windows` の署名設定を追加

- [`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json) の `bundle` に **`windows` オブジェクト**を新設し、
  **Azure Trusted Signing 用の外部 `signCommand`**（例: `trusted-signing-cli` もしくは `azuresigntool` を呼ぶコマンドで、
  署名対象パスをプレースホルダで受ける形）＋ **`timestampUrl`**（Azure Trusted Signing のタイムスタンプ URL）＋
  **`digestAlgorithm: "sha256"`** を設定する。
- **NSIS `.exe` と WiX `.msi` の両方が署名される**ことを担保する（`targets: "all"` のため両生成物が対象）。
- 署名に必要なパラメータ（エンドポイント/アカウント/プロファイル/認証）は **CI の環境変数（Secrets 由来）**から渡し、
  設定ファイルに秘匿値をハードコードしない。

### (2) release.yml の windows-latest レグに署名を配線

- `build` ジョブの **`windows-latest` レグにのみ**、①Azure 認証（`azure/login` もしくは client-secret を env で渡す）、
  ②署名ツールの導入（例: `dotnet tool install --global trusted-signing-cli` 等）のステップを追加する。
- `tauri-apps/tauri-action@v0` のビルド時に **(1) の `signCommand` が呼ばれる**よう env/PATH を通す。macOS レグは不変。
- 署名に必要な値はすべて **GitHub Secrets** から env に注入する（下記）。ログに鍵/トークンを出さない。

### (3) GitHub Secrets（鍵はリポジトリに置かない）

- 追加する Secrets（名称例）: `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`（または OIDC federated
  credentials）、`AZURE_TS_ENDPOINT` / `AZURE_TS_ACCOUNT` / `AZURE_TS_PROFILE`（証明書プロファイル名）。
- 設定手順（値はユーザーが Azure から取得）を README/本タスクに明記する。**鍵/証明書ファイルはコミットしない**。

### (4) README の署名記述を更新

- [`README.md`](../../README.md) の「署名について（現状）」を、**Windows は Azure Trusted Signing で署名済み**（フェーズ2 完了）
  へ更新する。未署名回避手順（「詳細情報 → 実行」）の案内は macOS 側の記述に整理する。

## このタスクでやらないこと

- **macOS の署名・notarize**（親 099 の決定どおり別途）。
- **自動アップデータ（updater）**・その署名鍵（別タスク）。
- **ARM64 Windows** 配布（対象外）・Linux 配布。
- **アプリ本体のコード変更**（配布/署名設定のみ・OS/プロセス/ファイル操作の設計は不変）。
- **証明書の取得代行**（Azure Trusted Signing のアカウント作成・本人確認・プロファイル発行はユーザー作業）。
- 窓の杜/Vector 等への申請（手動・別途）。

## セキュリティ制約（docs/security.md 準拠・重点 §10 配布ポリシー）

- **アプリの OS/プロセス/ファイル操作の設計は変更しない**（配布・署名設定のみ／§2・§4・§5 不変）。
- **新規 npm/crate/plugin をアプリ依存に増やさない**（署名ツールは CI 上の Action/CLI に閉じ、アプリの import グラフ・
  `Cargo.toml`/`package.json` の実行時依存に入れない・§10）。
- **外部通信/telemetry をアプリに追加しない**・`csp: null`/外部リソース方針は不変（§1・CSP）。
- **署名鍵・Azure 認証情報は GitHub 暗号化 Secrets のみ**。生成物・リポジトリ・ログに鍵/トークンを混ぜない。

## 完了条件

- [`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json) に `bundle.windows`（`signCommand`＋`timestampUrl`＋
  `digestAlgorithm`）があり、CI の Windows ビルドで **`.exe`(NSIS) と `.msi`(WiX) の両方が署名**される。
- 署名済み `.exe` の Windows「プロパティ → デジタル署名」に**発行者が表示**され、**`signtool verify /pa` が通る**。
- 署名済みインストーラの DL/実行で **SmartScreen の「不明な発行元」警告が解消**している（レピュテーション蓄積前でも
  発行者名が表示される）。
- 署名鍵/Azure 認証情報は **GitHub Secrets のみ**に存在し、リポジトリ・生成物・ログに含まれない。
- アプリ本体のコード・依存・`csp: null` は不変。**security-review を通過**している。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
# 設定ファイルの妥当性（アプリ本体は無変更のため typecheck/cargo は退行確認）
pnpm --filter ./apps/desktop typecheck
cd apps/desktop/src-tauri && cargo check
# CI 検証: テストタグ push（or workflow_dispatch）→ Actions 緑 → Windows 生成物が署名される
#   git tag v0.0.2-sign-test && git push --tags
# Windows 実機で署名確認:
#   signtool verify /pa /v StreamDock_x64-setup.exe
#   （プロパティ → デジタル署名 に発行者が出る／SmartScreen で発行者名が表示される）
```

## 実装後に必要なレビュー

- security-review（軽）: **配布/署名設定のみでアプリ挙動が不変**であること、**新規のアプリ実行時依存・外部通信・
  capability・CSP 変更が無い**こと、**Azure 認証情報/署名鍵が Secrets のみ**でリポジトリ・生成物・CI ログに漏れて
  いないこと（署名ステップの出力に鍵/トークンを出さない）を確認する。
