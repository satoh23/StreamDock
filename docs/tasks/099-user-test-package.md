# 099 User Test Package（配布パッケージ: Mac/Win 両ビルド自動化 + Windows 署名）

## 目的

098 で Windows 実機ビルド・E2E が完了した。次は **ユーザーに配布**できる状態にする。ビルドを
GitHub Actions（クラウド CI）で自動化し、**VM も Docker も使わず** macOS と Windows(x64) の
インストーラを生成して **GitHub Releases** で配布する。Windows は SmartScreen 警告を消すため
**コード署名**する（macOS は当面未署名）。

## 背景の結論（ユーザーの2つの問いへの回答）

- **Docker で Windows をビルドできない**: Windows アプリのビルドには Windows ホストが要り、
  Windows コンテナは Apple Silicon Mac では動かない（Mac の Docker は Linux コンテナのみ）。Tauri も
  クロスコンパイル不可（各 OS のネイティブ toolchain 必須）。
- **VM も不要にできる**: 配布ターゲットを **Windows x64**（一般ユーザーのほぼ全員・ARM64 でも x64
  エミュで動作）にすれば、GitHub Actions の **windows-latest（x64）クラウドランナー**でビルドできる。
  098 の ARM64 VM は配布には使わない（ARM64 は本タスク対象外）。
- **署名は必要**: 未署名は Windows で SmartScreen 警告・macOS で Gatekeeper ブロックが出る。
  ユーザーは基本 Windows のため **Windows のみ署名**する。

## 決定事項

- ビルド自動化 = **GitHub Actions**（`.github/workflows/release.yml`）。VM/Docker 不使用。
- Windows ターゲット = **x64 のみ**（`x86_64-pc-windows-msvc`）。ARM64 は対象外。
- macOS = **universal(.dmg)**（Intel/Apple Silicon 両対応）・**未署名**。
- 署名 = **Windows のみ**（証明書取得後にフェーズ2で追加）。
- 配布 = **GitHub Releases**（ユーザーはアカウント登録不要で DL 可）。窓の杜/Vector 等は別途手動申請。

## 進め方（2フェーズ）

### フェーズ1 — CI で未署名ビルド → Releases（費用ゼロ・すぐ配布可能）

- `.github/workflows/release.yml`: `tauri-apps/tauri-action` のマトリクス（macos-latest / windows-latest）。
  `v*` タグ push（＋ `workflow_dispatch` 手動）で両 OS のインストーラを生成し Release 下書きに添付。
- 成果: `git tag v0.1.0 && git push --tags` で Mac/Win(x64) インストーラが Releases に出る。
- この段階は未署名（Windows は「詳細情報 → 実行」で回避・案内を docs に記載）。

### フェーズ2 — Windows 署名を CI に統合（証明書取得後）

- 証明書はユーザーが取得（費用・本人確認あり）: **Azure Trusted Signing**（最安・要身元確認）/
  **OV 証明書 + Azure Key Vault** / **OV/EV 証明書（ハードトークン）** のいずれか。発行に数日〜数週間。
- `tauri.conf.json` に `bundle.windows.signCommand`（＋ `timestampUrl` 等）、workflow に署名ステップと
  **GitHub Secrets**（鍵はリポジトリに置かない）を追加。

## セキュリティ制約（docs/security.md 準拠）

- アプリの OS/プロセス/ファイル操作の設計は変更しない（配布設定のみ・§2/§4/§5 不変）。
- 新規 npm/crate/plugin を増やさない（`tauri-action` は CI 上の Action でアプリ依存に入らない・§10）。
- 外部通信/telemetry をアプリに追加しない・CSP/外部リソース不変（§1/§CSP）。
- 署名鍵は **GitHub 暗号化 Secrets のみ**。生成物・リポジトリに鍵を混ぜない。

## やらないこと

- Docker/Windows コンテナでのビルド（不可）/ ARM64 Windows 配布（対象外）/ Linux 配布 /
  macOS 署名・notarize（別途）/ 自動アップデータ（updater 署名鍵は別タスク）/
  窓の杜・Vector への自動申請（手動）/ アプリ本体のコード変更（配布設定のみ）。

## 完了条件

- **フェーズ1**: `.github/workflows/release.yml` があり、タグ push（or 手動実行）で Actions が成功し、
  Releases 下書きに macOS `.dmg` と Windows x64 `.exe`(NSIS)/`.msi`(WiX) が添付される。
  Windows x64 `.exe` をインストール → 起動できる（実機 or ARM64 VM の x64 エミュで確認）。
- **フェーズ2**（証明書取得後）: 署名済み `.exe` の「デジタル署名」に発行者が表示され、
  `signtool verify /pa` が通り、SmartScreen の「不明な発行元」表示が解消する。

## 検証

- フェーズ1: テストタグ `v0.0.1-test` を push（or `workflow_dispatch`）→ Actions 緑 →
  Releases 下書きに両 OS の生成物が並ぶ → Windows `.exe` を DL・インストール・起動。
- フェーズ2: 上記「デジタル署名」「signtool verify」「SmartScreen」を確認。
