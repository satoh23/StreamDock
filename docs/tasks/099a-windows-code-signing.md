# 099a Windows コード署名（SSL.com IV ＋ eSigner）を CI に統合

> 状態: ✅ **実装完了（2026-08-31）／⚠ CI の空回しと実機確認は未実施**。位置づけ・線引きは
> 親 [099](099-user-test-package.md)（配布パッケージ・フェーズ2＝Windows 署名）を正とする。
>
> ⚠⚠ **移行は済んでいる**——ビルド後の置換署名（`Locate Windows installers` / `Sign NSIS installer (.exe)`）を
> **2 つとも削除**し、`bundle.windows.signCommand` → `apps/desktop/scripts/sign-windows.ps1` → **jsign** →
> SSL.com eSigner へ寄せた。**ガードはローカルで通ることを確認済み**。
> ⚠⚠⚠ **残っているのは「依頼者による Secrets 登録 → 空回し → 実機確認」**（下の「残作業」節）。
> 実装の記録・判断理由は [`docs/progress.md`](../progress.md) の **2026-08-31 (099a …)** 節が正。
>
> ✅ **2026-08-31: 証明書を取得した**（依頼者）。⇒ **前提作業は完了。着手できる。**
>
> ⚠⚠⚠ **2026-08-31: 本ファイルを全面改訂した。** 旧本文は**タイトルも本文も Azure Trusted Signing 前提**
> だったが、⚠ **2026-07-21 に方式が SSL.com へ変更されている**（`docs/progress.md` の
> 「【方針変更 2026-07-21】(II) の署名方式を Azure Trusted Signing → SSL.com IV + eSigner に変更」が正）。
> **理由＝ Azure Trusted Signing の公開信頼証明書は「日本在住の個人開発者」が対象外**
> （米国・カナダの個人／米国・カナダ・EU・英国の組織のみ）。
> ⚠ `release.yml` と `README.md` は**変更後の SSL.com に更新済み**で、**本タスクファイルだけが取り残されていた**。
>
> ⚠⚠⚠ **本タスクは「Secrets を登録する作業」ではない。CI ガードを通す移行作業である。**
> **`ES_USERNAME` を登録した瞬間に CI は意図的に fail する**（下記「着手前に必ず読むこと」）。
>
> **必読前提**: 親 [099](099-user-test-package.md)（フェーズ1＝未署名 CI ビルド／フェーズ2＝本タスク）、
> ⚠⚠ **[055a](055a-updater-release-pipeline.md)（`createUpdaterArtifacts` と minisign 署名の正・**本タスクの地雷の出所**）**、
> [055](055-app-self-update.md)（自己更新の全体）、[099b](099b-updater-e2e.md)（⚠ **本タスクの検証は E2E-6**）、
> [`docs/security.md`](../security.md)（特に **§10 依存/配布ポリシー**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **署名資格情報は GitHub 暗号化 Secrets のみに置く（リポジトリに混ぜない）**。
>
> ⚠ **行番号は書かない**（特定はシンボル名・ステップ名で行うこと）。

## ⚠⚠⚠ 着手前に必ず読むこと —— **Secrets を入れるだけでは動かない**

> ✅ **2026-08-31 に移行済み**。以下は**なぜこの形になっているか**の記録として残す
> （＝ここに書いてある壊れ方は、いまのワークフローには存在しない）。
> ⚠ **ガードは残す**——構成が崩れたら再び発火させるため。

### 地雷（055a からの申し送り）

`sslcom/esigner-codesign` は tauri の**ビルド後**に `.exe` を `override: true` で**置換署名**する。
一方、[055a](055a-updater-release-pipeline.md) で有効化した `createUpdaterArtifacts` の `.sig`（minisign）は
**tauri がバンドルした時点のバイト列**に対して作られる。
⇒ ⚠⚠⚠ **置換でバイト列が変わり `.sig` と一致しなくなり、Windows の自己更新が必ず署名検証で落ちる。**

⚠⚠ **壊れ方が最悪である**——**「CI は緑・インストーラも普通に起動する・自己更新だけが落ちる」**ので、
**実機 E2E（[099b](099b-updater-e2e.md)）まで発覚しない**。

### CI ガード（055a で実装済み・**両側を見る**）

`release.yml` の build ジョブ Windows レグにある
**`Guard - post-build signing breaks updater signature (099a)`**
（[`.github/scripts/check-updater-signing-compat.mjs`](../../.github/scripts/check-updater-signing-compat.mjs)）が、
**`ES_USERNAME` が登録された瞬間**に CI を fail させる。
⚠ 設定ファイルとワークフローを読むだけなので **`Check version sync` の直後＝重いビルドの前**に置いてある。

| # | 条件 | 結果 |
|---|---|---|
| 1 | `createUpdaterArtifacts` が真 **かつ** `bundle.windows.signCommand` が**未設定** | ❌ fail（移行前） |
| 2 | `createUpdaterArtifacts` が真 **かつ** `release.yml` に `sslcom/esigner-codesign` を `override: true` で使うステップが**残存** | ❌ fail（移行が中途半端） |

⇒ ⚠⚠⚠ **`signCommand` を設定しただけでは通らない。** ビルド後の置換署名ステップ
（**`Locate Windows installers`** と **`Sign NSIS installer (.exe)`** の 2 つ）を**必ずセットで削除する**こと。
⚠ **片方だけだと元の地雷とまったく同じ壊れ方になる**（055a レビュー Q-5 で②を追加した理由）。

⚠ 移行手順はそのスクリプトのエラーメッセージにも書いてある（**説明を二重に持たない**方針）。

## 目的

Windows インストーラ（NSIS `.exe`）を **SSL.com の個人検証(IV)証明書 ＋ eSigner クラウド署名**でコード署名し、
DL/インストール時の **SmartScreen「不明な発行元」警告を解消**する。
⚠⚠ **同時に、updater の minisign 署名を壊さない形へ移行する**（＝本タスクの実体はこちら）。
macOS は当面未署名のまま（親 099 の決定どおり）。

## 現在の前提（⚠ **2026-08-31 に実コードで確認済み**）

### 既に在るもの

- **CI は [`.github/workflows/release.yml`](../../.github/workflows/release.yml) の 1 本のみ。**
  `build` ジョブが `macos-latest` / `windows-latest` マトリクスで `tauri-apps/tauri-action@v0` を実行し、
  `release` ジョブが public リポジトリ `satoh23/StreamDock-releases` に下書き Release を作る。
- ⚠ **署名の配線は 2026-07-21 からあったが、ビルド後の置換署名という壊れる形だった**
  （`Locate Windows installers` と `Sign NSIS installer (.exe)`）。
  ✅ **2026-08-31 に 2 つとも削除済み**。⇒ いまの配線は
  `bundle.windows.signCommand` → `apps/desktop/scripts/sign-windows.ps1` → jsign → eSigner。
  - `HAS_WINDOWS_SIGNING: ${{ secrets.ES_USERNAME != '' }}` は**残っている**が、
    直接ゲートするのは **①ガード ②jsign の導入** の 2 ステップだけ。
    「署名するかどうか」は `Build installers` が渡す `STREAMDOCK_WINDOWS_SIGNING` でラッパーに伝える。
- **`Guard - post-build signing breaks updater signature (099a)` は既にある**（上記）。
- **`Verify updater artifacts`** が `.exe.sig` / `.app.tar.gz.sig` の欠落で fail する（fail-closed）。
- **Secrets の名前は確定済み**（README に記載済み）:
  `ES_USERNAME` / `ES_PASSWORD` / `CREDENTIAL_ID` / `ES_TOTP_SECRET`
- **README の「署名について」は SSL.com へ更新済み**（⚠ **Azure から変えた経緯も書いてある**）。

### ⚠⚠ いまの設定値

- ✅ **`bundle.windows.signCommand` を新設済み**（2026-08-31）＝**ガードの条件 1 は解消**。
  ⚠ **文字列記法で書くこと**（ガードは `typeof … === "string"` で見るため。改訂の記録 #10）。
  ⚠ `timestampUrl` / `digestAlgorithm` / `tsp` / `certificateThumbprint` は**置かない**（#11）。
- **`bundle.targets` は `["app", "dmg", "nsis"]`**（⚠ `"all"` ではない）。
  ⇒ ⚠ **Windows の成果物は NSIS `.exe` の 1 本だけ**で、**WiX `.msi` は作らない**
  （updater の `windows-x86_64` は NSIS しか指さず、`.msi` を配ると更新のたびにインストール形式が入れ替わるため）。
  ⇒ ⚠⚠ **ただし「署名対象も `.exe` だけ」ではない**——`signCommand` は sidecar・本体 exe・NSIS プラグイン DLL・
  アンインストーラにも呼ばれる（**1 ビルド約 9 回**。改訂の記録 #9）。**配布物が `.exe` 1 本**という話とは別。
- **`app.security.csp` は `null`**（不変）。
- **署名関連の依存は Cargo.toml / package.json のどちらにも無い**（⚠ **入れないこと**・§10）。

### ⚠ 実測で確定している事実（055a の空回しより）

- **Windows の実ファイル名は `StreamDock_<version>_x64-setup.exe`。**
- ⚠⚠ **「署名はバンドルの後」であることが実挙動で確認済み** ＝ **ガードの前提は正しい**。
- **fail-closed が効く**（`.sig` が作れない → build ジョブが落ちる → 不完全な成果物は public 側に出ない）。
- **ログに鍵の中身は 1 バイトも出ていない**（§9）。

## ⚠⚠⚠ このタスク最大の未知 —— **eSigner を `signCommand` から呼べるか**

> ✅ **決着（2026-08-31）＝呼べる。採用は (c) jsign**（下の (1) の表が結論。ここは検討の記録として残す）。
> ⚠ 共通確認 1・2 は **tauri-cli 2.11.4 のソースで確定**させた（`bundle_project()` の中で installer を署名 →
> その後に `sign_updaters()` が `.sig` を作る）。⚠⚠ **空回しのログでの再確認はまだ**（「残作業」節）。

⚠ **ここが決まらないと移行できない。** 実装計画より先に**方式を決めて裏取りすること**。

`bundle.windows.signCommand` は **tauri のバンドル過程内**で呼ばれるので、
**そこで署名すれば `.sig` は署名済みバイト列に対して作られる**（＝地雷が消える）。
問題は「eSigner のクラウド署名を、そのコマンドとして呼べる形にできるか」である。

### 候補（⚠ **両方とも実測が要る。どちらも「できる」と決めつけないこと**）

| 案 | 形 | ⚠ 確認すること |
|---|---|---|
| **(a) CodeSignTool CLI を直接呼ぶ** | `signCommand` に SSL.com の `CodeSignTool` を書き、`%1` で対象パスを受ける | ⚠ **資格情報を `signCommand` の文字列に書かないこと**（`tauri.conf.json` はコミットされる）。⇒ **env で渡せるか**が採否を決める。⚠ Java ランタイムが要るか。⚠ `override` 相当で**その場に上書き**できるか（別ファイルに出ると tauri が拾わない） |
| **(b) eSigner CKA（Cloud Key Adapter）** | 仮想証明書を Windows 証明書ストアへ入れ、`signCommand` は**素の `signtool`**（または Tauri の `certificateThumbprint`）にする | ⚠ CI（`windows-latest`）に**非対話でインストールできるか**。⚠ TOTP による自動化が通るか。⚠ thumbprint を Secrets で渡す形になるか |

⚠⚠ **どちらでも共通で確認すること**:

1. ⚠⚠⚠ **`signCommand` が NSIS `.exe` に対して実際に呼ばれるか**（⚠ **`app` / `dmg` には呼ばれない**）。
2. ⚠⚠⚠ **署名 → `.sig` 生成の順序**（⚠ **これが逆なら移行の意味が無い**）。
   ⇒ **空回しのログで確定させること。** ⚠ **「たぶんそうなるはず」で進めないこと。**
3. ⚠ **eSigner のマルウェアスキャン待ち**でビルドがタイムアウトしないか（クラウド署名は数十秒〜かかる）。
4. ⚠ **リトライの扱い**（クラウド署名は失敗しうる。⚠ **失敗したら fail-closed で落とすこと**——
   「署名なしで成果物が出る」を作らない）。

⚠ **どちらも成立しないと分かったら、そこで止めて報告すること。**
⚠⚠ **「ビルド後の置換署名のまま Secrets を入れる」は絶対に採らない**——
それは **Windows の自己更新を確実に壊す**（ガードが止めているものそのもの）。

## このタスクでやること

### (1) ⚠⚠ 方式を決める（上記「最大の未知」） ✅ **決着（2026-08-31）＝ (c) jsign を採用**

⚠ 候補は 3 つあった。**どれも同じ IV 証明書・同じ eSigner サービスを使う**（違うのは
「eSigner に話しかけるクライアント」だけで、出来上がる署名の信頼性は同じ）。

| 案 | 採否 | 理由（要点） |
|---|---|---|
| (a) CodeSignTool 直呼び | ⚠⚠⚠ **却下** | ①**fail-closed が壊れる**（tauri は終了コードだけを見るのに、SSL.com 公式 Action 自身が CodeSignTool の終了コードを信用せず stdout を文字列検査している）②**ファイル本体をアップロードする**——署名対象に **110MB の sidecar**（焼き込んだ Client Secret を含む）が入る ③9 回分のアップロード＋スキャンで時間が読めない |
| (b) eSigner CKA | **次善（採らず）** | 公式・windows-latest の非対話サンプルがあり実績は最も堅い。ただしインストーラ＋vc_redist ×2＋KSP 登録＋config＋load と手数が多く、**資格情報を含む `master.key` をディスクに書く**。`CREDENTIAL_ID` も使わなくなる |
| **(c) jsign 7.5** | ✅ **採用** | ①終了コードが正常＝ **fail-closed が本当に効く** ②**ハッシュのみ送信** ③**`--storepass env:` / `--keypass env:` を公式サポート**＝秘密がコマンド行に出ない ④JAR 1 個・**タグ固定＋SHA-256 照合**でサードパーティ Action がゼロになる ⑤Secrets 4 本が 1:1 で入る |

⚠ (c) の弱点は「SSL.com 公式ではない」こと。**ラッパー方式なので乗り換えは安い**——
`tauri.conf.json` は据え置きのまま、`sign-windows.ps1` の中身と導入ステップだけ差し替えれば (b) へ倒せる。

### (2) `tauri.conf.json` に `bundle.windows` を新設

- **`signCommand`**（(1) で決めた形）を設定する。
  ⚠⚠⚠ **資格情報をハードコードしないこと**（`ES_PASSWORD` / `CREDENTIAL_ID` / `ES_TOTP_SECRET` を
  設定ファイルに書かない）。**env（Secrets 由来）から渡す。**
- ⚠ `timestampUrl` / `digestAlgorithm` を置くかは **(1) の方式しだい**で決めること
  （⚠ **署名ツール側がタイムスタンプを付けるなら二重に持たない**）。
  ⚠⚠ **`certificateThumbprint` を設定すると Tauri 内蔵署名が動く**ので、(a) では**置かないこと**。
- ⚠ **`bundle.windows` は `app.windows`（窓設定）とは別物**（混同しないこと）。

### (3) ⚠⚠⚠ release.yml からビルド後の置換署名を**削除**する

- **`Locate Windows installers`** と **`Sign NSIS installer (.exe)`** の **2 ステップを削除**。
  ⚠ **セットで消すこと**（ガードの条件 2）。
- ⚠ **`HAS_WINDOWS_SIGNING` の使い道が変わる**——(1) の方式で必要なステップ
  （CodeSignTool / CKA の導入）に付け替えるのか、そもそも不要になるのかを決めること。
- ⚠⚠ **コメントに `uses: sslcom/esigner-codesign` と `override: true` の両方を残さないこと**——
  ガードは文字列検査なので**誤検知する**（スクリプト冒頭が明記している）。
- ⚠ **macOS レグは 1 バイトも触らない。**

### (4) 署名ツールの導入ステップ（Windows レグのみ）

- ⚠⚠ **アプリの実行時依存に入れないこと**（§10）——**CI 上のインストールに閉じる**。
  ⚠ `Cargo.toml` / `package.json` に**差分を出さない**。
- ⚠ **供給網対策**: サードパーティ Action を使うなら **`@develop` ではなくコミット SHA / リリースタグへ固定**する
  （⚠ 現行の `sslcom/esigner-codesign@develop` は**まさにこれを満たしていない**。
  削除するので解消するが、**代わりに入れるものが同じ問題を持ち込まないこと**）。

### (5) README の更新

- 「署名について」を **移行後の形**（ビルド過程内で署名する）に更新する。
  ⚠ **「ビルド後に署名する」という現在の記述が嘘になる**ので直すこと。
- ⚠ **Secrets の一覧と手順**（値は載せない）。⚠ **Azure から変えた経緯の記述は残す**（判断の記録）。
- ⚠ **IV/OV は評判蓄積型**なので「**署名後も配布直後は警告が残りうる**」という既存の記述は**残すこと**
  （即時解消は EV のみ）。

## このタスクでやらないこと

- **macOS の署名・notarize**（親 099 の決定どおり別途）。
- ⚠⚠ **updater の仕組み・minisign 鍵そのもの**（[055a](055a-updater-release-pipeline.md)）。
  ⚠ **本タスクは「壊さない」だけ**で、あちらの設計は 1 ミリも変えない。
- ⚠⚠⚠ **実機での自己更新 E2E**（⇒ [099b](099b-updater-e2e.md) の **E2E-6**）。
  ⚠ **本タスクは「署名が付いて CI が緑」まで**。
- **ARM64 Windows** 配布・Linux 配布。
- **アプリ本体のコード変更**（⚠ **配布/署名設定のみ**）。
- **証明書の取得代行**（✅ 完了済み）。
- 窓の杜 / Vector 等への申請。
- ⚠ **`.msi`(WiX) の復活**（`bundle.targets` から外した決定は不変）。

## セキュリティ制約（docs/security.md 準拠・重点 §10）

- **アプリの OS/プロセス/ファイル操作の設計は変更しない**（§2・§4・§5 不変）。
- ⚠⚠ **新規 npm/crate/plugin をアプリ依存に増やさない**（§10）——署名ツールは **CI 上のインストールに閉じる**。
- **外部通信 / telemetry をアプリに追加しない**・`csp: null` 不変（§1）。
- ⚠⚠⚠ **署名資格情報は GitHub 暗号化 Secrets のみ。**
  生成物・リポジトリ・**CI ログ**に混ぜない（⚠ **`signCommand` の文字列に書かない**——
  あれはコミットされるうえ、**ビルドログにコマンド行が出る**）。
- ⚠ **Windows レグにのみ env を渡す**（macOS へ資格情報を渡さない・2026-07-21 の判断と同じ）。
- ⚠ **fail-closed を守る**——署名に失敗したら**ビルドを落とす**（未署名の成果物を public 側に出さない）。

## 完了条件

1. ⚠⚠⚠ **`Guard - post-build signing breaks updater signature (099a)` が通る**
   （＝ `bundle.windows.signCommand` が在り、**ビルド後の置換署名ステップが 2 つとも消えている**）。
2. `tauri.conf.json` に `bundle.windows` があり、CI の Windows ビルドで **NSIS `.exe` が署名**される。
3. ⚠⚠⚠ **`.exe.sig`（minisign）が署名済みバイト列に対して作られている**
   （⚠ **`Verify updater artifacts` が緑**・⚠ **順序を空回しのログで確認したこと**）。
4. 署名済み `.exe` の Windows「プロパティ → デジタル署名」に**発行者が表示**され、
   **`signtool verify /pa` が通る**。
5. ⚠ 署名資格情報が **GitHub Secrets のみ**に存在し、リポジトリ・生成物・**CI ログ**に含まれない。
6. **アプリ本体のコード・実行時依存・`csp: null` は不変**
   （`Cargo.toml` / `package.json` / `pnpm-lock.yaml` / `Cargo.lock` に差分ゼロ）。
7. **README の「署名について」が移行後の形と一致**している。
8. `docs/progress.md` と [`docs/task-board.md`](../task-board.md) が更新されている。
9. ⚠ **`security-review` を通過**している。

## 確認コマンド

```bash
git diff --stat
# ⚠ アプリ本体は無変更のはず（退行確認）
pnpm --filter ./apps/desktop typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

# ⚠⚠ 設定ファイルの妥当性
node -e "JSON.parse(require('fs').readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8')); console.log('tauri.conf.json OK')"
node -e "require('js-yaml')" 2>/dev/null || echo "(YAML は CI 側の検証に任せる)"

# ⚠⚠⚠ ガードをローカルで先に通す（CI で落ちる前に確認できる）
node .github/scripts/check-updater-signing-compat.mjs

# ⚠⚠ 置換署名ステップが消えていること（ヒットゼロが期待）
grep -n "esigner-codesign\|Locate Windows installers\|Sign NSIS installer" .github/workflows/release.yml
# ⚠ 資格情報がハードコードされていないこと（ヒットゼロが期待）
grep -rn "ES_PASSWORD\|CREDENTIAL_ID\|ES_TOTP_SECRET" apps/desktop/src-tauri/tauri.conf.json
# ⚠⚠ アプリの実行時依存が増えていないこと（差分ゼロが期待）
git diff --stat -- apps/desktop/package.json pnpm-lock.yaml apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
# ⚠ アプリ本体に差分が無いこと（差分ゼロが期待）
git status --short -- apps/desktop/src apps/comment-sidecar/src apps/desktop/src-tauri/src

# CI 検証（⚠ 依頼者が実施）:
#   ① Secrets を 4 本登録（ES_USERNAME / ES_PASSWORD / CREDENTIAL_ID / ES_TOTP_SECRET）
#   ② workflow_dispatch で空回し → Actions 緑
#   ③ ⚠⚠ ログで「署名 → .sig 生成」の順序を確認する
#   ④ Windows 実機: signtool verify /pa /v StreamDock_<version>_x64-setup.exe
```

## 実装後に必要なレビュー

- ⚠⚠ **`security-review`**（軽）。見どころ:
  - **配布 / 署名設定のみでアプリ挙動が不変**であること
  - **新規のアプリ実行時依存・外部通信・capability・CSP 変更が無い**こと（§10）
  - ⚠⚠⚠ **署名資格情報が Secrets のみ**で、**`tauri.conf.json` にも CI ログにも出ていない**こと
  - ⚠ **サードパーティ Action / ツールがバージョン固定されている**こと（供給網）
  - ⚠ **fail-closed**（署名に失敗したら未署名で出荷しない）

## ⚠ 改訂の記録（2026-08-31・旧本文の誤り）

| # | 旧本文 | 実際 |
|---|---|---|
| 1 | タイトル・目的・(1)〜(4) が **Azure Trusted Signing** 前提 | ⚠⚠⚠ **2026-07-21 に SSL.com IV ＋ eSigner へ変更済み**（**日本在住の個人は Azure の対象外**）。`release.yml` / README は更新済みで**本ファイルだけ古かった** |
| 2 | Secrets は `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TS_*` | ⚠ **`ES_USERNAME` / `ES_PASSWORD` / `CREDENTIAL_ID` / `ES_TOTP_SECRET`**（README に記載済み） |
| 3 | 「前提作業（ユーザー側・数日〜数週間）」＝ Azure のアカウント作成・本人確認 | ✅ **2026-08-31 に SSL.com IV の取得が完了**（⇒ **着手できる**） |
| 4 | 「現在の前提」＝「**署名ステップは無い**」 | ⚠⚠ **ある**（`Locate Windows installers` / `Sign NSIS installer (.exe)`）。⚠ **`ES_USERNAME` 未設定でスキップされているだけ**で、**本タスクはそれを削除する側**である |
| 5 | (2)「release.yml の windows レグに**署名を配線**」 | ⚠⚠⚠ **配線は済んでいる。本タスクの実体は「壊れる形から壊れない形への移行」**である（＝**足すのではなく、消して寄せる**） |
| 6 | 「Azure Trusted Signing 用の外部 `signCommand`（`trusted-signing-cli` / `azuresigntool`）」 | ⚠ **eSigner で `signCommand` を成立させられるか自体が未知**（本ファイルの「最大の未知」節を新設）。⚠ **候補は 2 つあり、どちらも実測が要る** |
| 7 | 完了条件に**ガードの通過が無い** | ⚠⚠⚠ **最優先の完了条件として追加**（⚠ **これが通らないとビルドが 1 回も走らない**） |
| 8 | 完了条件に **`.sig` の整合が無い** | ⚠⚠⚠ **本タスクの存在理由そのもの**なので追加（⚠ **署名 → `.sig` の順序をログで確認すること**） |

## ⚠⚠ 残作業（**依頼者が実施**・2026-08-31 時点）

実装は済んでいるが、**CI と実機はまだ 1 度も走っていない**。順序に意味があるので下のとおり進める。

| # | 誰 | 何を | ⚠ 注意 |
|---|---|---|---|
| 1 | 依頼者 | ⚠ **Secrets を登録しないまま** `workflow_dispatch` で空回し① | **未署名で緑**になることの回帰確認（README の「Secrets 未設定なら未署名で配布」が生きているか）。この回はガードも署名も走らない |
| 2 | 依頼者 | **Secrets を 4 本登録**（`ES_USERNAME` / `ES_PASSWORD` / `CREDENTIAL_ID` / `ES_TOTP_SECRET`） | ⚠⚠ **必ず移行後**。移行前に入れるとガードで全 CI が止まる（＝それが 055a の設計） |
| 3 | 依頼者 | `workflow_dispatch` で空回し② | ⚠⚠⚠ **タグは push しない**（実タグは public 側に配布物を出す） |
| 4 | 依頼者 | Windows 実機で `signtool verify /pa /v StreamDock_<version>_x64-setup.exe` ＋ プロパティ → デジタル署名 | ⚠ **SmartScreen は完了条件に置かない**（IV は評判蓄積型なので配布直後は警告が残りうる） |

**空回し②のログで確認する 4 点**

1. `Guard - post-build signing breaks updater signature (099a)` が **OK** で通る
2. `Signing …` が **約 9 本**出る（sidecar → 本体 → NSIS プラグイン DLL → アンインストーラ → installer）
3. ⚠⚠⚠ **`…setup.exe` の署名が先・`.sig` の生成が後**（＝本タスクの芯）
4. `Verify updater artifacts` の一覧に `StreamDock_<version>_x64-setup.exe` と `.exe.sig` の**両方**が在る

⚠ ここで潰しきれない「実機の自己更新」は [099b](099b-updater-e2e.md) の **E2E-6**。

## ⚠ 改訂の記録（2026-08-31・実装で判明した前提の訂正）

| # | 本ファイルの旧記述 | 実際（tauri-cli 2.11.4 のソースで確認） |
|---|---|---|
| 9 | 「⇒ **署名対象も `.exe` だけ**でよい」 | ⚠⚠ **成立しない。** `signCommand` は sidecar・本体 `StreamDock.exe`・NSIS プラグイン DLL 5 本・**アンインストーラ**にも呼ばれる（**1 ビルド約 9 回**）。あれは置換署名時代の前提 |
| 10 | 「`bundle.windows.signCommand` を設定する」 | ⚠⚠⚠ **文字列記法でなければガードが通らない**。`check-updater-signing-compat.mjs` は `typeof … === "string"` で判定するので、Tauri が認めるオブジェクト記法 `{cmd, args}` だと**移行後も fail** する（⇒ 空白を含むパスが使えない） |
| 11 | 「⚠⚠ `certificateThumbprint` を設定すると Tauri 内蔵署名が動くので (a) では置かないこと」 | ⚠ **`signCommand` がある限り内蔵署名は動かない**（`sign()` が常に custom へ分岐）。`timestampUrl` / `digestAlgorithm` / `tsp` も**一切参照されない** ⇒ 結論（置かない）は同じだが理由が違う。タイムスタンプは署名ツール側の引数で付ける |
| 12 | （記載なし）「Secrets 未設定なら未署名で通す」の実現方法 | ⚠⚠⚠ **公式の `--no-sign` は使えない**——`sign_updaters` が `no_sign` で **minisign 署名ごとスキップ**するため `.exe.sig` が出ず `Verify updater artifacts` が落ちる。⇒ **ラッパー側の分岐**（`STREAMDOCK_WINDOWS_SIGNING`）でしか維持できない |
| 13 | (4)「サードパーティ Action を使うなら SHA 固定」 | ⚠ **Action を使わずに済んだ**（素の `run:` ＋ リリースタグ固定 URL ＋ **SHA-256 照合**）。`@develop` 問題は「固定する」ではなく「無くす」で解消した |
