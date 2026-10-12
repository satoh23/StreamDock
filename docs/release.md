# リリース・配布の運用

依存の脆弱性検査（pre-commitフック）と、ビルド・署名・配布（GitHub Actions）の運用手順をまとめたもの。開発環境のセットアップ・起動方法は [README](../README.md) を参照。

## 依存の脆弱性検査（pre-commitフック・056）

```sh
# 依存の脆弱性検査に使う（pre-commit フックが要求する。未導入だと Cargo.lock を変えるコミットが通らない）
cargo install cargo-audit --locked
```

`pnpm install` は root の `prepare` スクリプトで `git config core.hooksPath .githooks` を自動設定します
（新規依存ゼロ・husky 等は使いません）。設定されているかは `git config core.hooksPath` で確認できます。

`.githooks/pre-commit` が、**`Cargo.lock` か `pnpm-lock.yaml` をステージしたコミットのときだけ**
脆弱性検査を実行し、**既知の脆弱性があればコミットを中止**します。

| 検査 | 対象 | 落ちる条件 |
| --- | --- | --- |
| `cargo audit` | `apps/desktop/src-tauri/Cargo.lock` | **脆弱性**があるとき（`unmaintained` / `unsound` の警告では落ちない） |
| `pnpm audit --prod` | `pnpm-lock.yaml` | **配布される依存**に脆弱性があるとき（開発専用の依存は対象外） |

- 依存を変えないコミットでは**一切走りません**（所要 0 秒・オフラインでも困らない）。
- いつでも手動で回せます: `pnpm audit:deps`
- 走るときは外部に問い合わせます（`cargo audit` は rustsec advisory-db を GitHub から取得、
  `pnpm audit` は npm レジストリへ）。
- ⚠ **`core.hooksPath` を設定すると `.git/hooks/` 配下は無効になります。** 今後フックを足すときは
  `.githooks/` 側に置いてください（`.git/hooks/` に置いても黙って動きません）。
- ⚠ **依存が変わっていなくても脆弱性は日々公表される。** このフックは「自分が依存を変えたとき」しか
  見ないので、既存依存に後から報告されたものは捕まえられません（定期実行の仕組みは未整備・task-board の 056）。
  `git merge` / `git pull` が持ち込む依存変更も素通りします（merge commit はフックを通らないため）。
- 緊急時は `git commit --no-verify` で飛ばせますが、**飛ばした理由を `docs/progress.md` に残すこと**。

## リリース / 配布（099）

ビルドは **GitHub Actions**（`.github/workflows/release.yml`）で自動化している。VM も Docker も不要で、
macOS と Windows(x64) のインストーラをクラウドで生成する。

- **ユーザーが落とすもの**: macOS `.dmg`（universal・Intel/Apple Silicon 両対応）/ Windows x64 `.exe`(NSIS) の**各 1 本だけ**。
  - Release にはこのほか `latest.json` / `*.app.tar.gz` / `*.sig` が並ぶが、これらは **updater が使う**もので人は落とさない
    （`.app.tar.gz` は macOS の自己更新時にアプリ自身が取得して自分を置き換える実体）。
  - ⚠ **`.msi`(WiX) は作らない**（`bundle.targets` から除外）。updater の `windows-x86_64` は NSIS の `.exe` しか
    指さないため、`.msi` を並べると **MSI で入れたユーザーが更新のたびに NSIS へ入れ替わる**（アンインストールの
    エントリが二重化しうる）。使わない形式を並べる意味が無いので生成ごとやめた。
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
  - `CREDENTIAL_ID` … eSigner の署名資格情報（証明書）ID（SSL.com ダッシュボード、または `get_credential_ids` で取得）。
    署名時は jsign の `--alias` に入る
  - `ES_TOTP_SECRET` … 自動署名用の TOTP シークレット（eSigner の自動化設定で取得）
  - ⚠ 4 本とも **Windows レグの `Build installers` にだけ** env で渡す（macOS へは渡さない）。
    `ES_USERNAME` を登録した時点で署名が有効になる（＝ CI の判定キー）
- **アプリ自己アップデート（updater）の署名鍵（055a）**:
  - `TAURI_SIGNING_PRIVATE_KEY` … `pnpm --filter ./apps/desktop tauri signer generate -w <保存先>` で作った**秘密鍵ファイルの中身**
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` … 上記の生成時に設定したパスワード
  - **公開鍵は非機密**なので `apps/desktop/src-tauri/tauri.conf.json` の `plugins.updater.pubkey` にコミットしてある。
  - ⚠ **秘密鍵とパスワードを失うと、既に配布済みのインストールへ二度と更新を配れない**
    （全ユーザーに手動で入れ直してもらうしかない）。パスワードマネージャ等に**必ずバックアップする**。
    鍵を作り直すと、旧鍵で署名された配布物からは更新できない。
  - ⚠ 鍵を設定した以上、**`pnpm tauri build`（インストーラ生成）にはこの 2 つの環境変数が必要**になる。
    未設定だと「A public key has been found, but no private key」で失敗する。

### リリース手順

**1. リリースノートを先に書く。** **これから付けるバージョン番号**でファイル名を決め、
`docs/release-notes/vX.Y.Z.md` を作る（書式は
[`docs/release-notes/README.md`](release-notes/README.md)）。**このファイルが単一ソース**で、CI が
アプリ内アップデート画面（`latest.json` の `notes`）と GitHub Release 本文の両方へ流す。
CI は**タグ名ではなく手順 2 で入れる `tauri.conf.json` の `version`** でこのファイルを探すので、
両者は必ず同じ番号にすること（手順 2・3 でズレていれば CI が落ちる）。
**無いままタグを打つと CI が fail する。**

**2. バージョンを 5 箇所すべて更新する。**

```sh
# package.json（root） / apps/desktop/package.json / apps/comment-sidecar/package.json /
# apps/desktop/src-tauri/Cargo.toml の [package] / apps/desktop/src-tauri/tauri.conf.json
pnpm --filter ./apps/desktop check:version   # 5 箇所が揃っているか（pnpm test からも走る）
```

updater が比較するのは `tauri.conf.json`、診断画面が表示するのは `Cargo.toml` 由来の値なので、
**ズレたまま配ると「診断画面と updater でバージョンが食い違う」**という追いにくい不整合になる。
CI もタグ push 時に「タグ名 − `v` == 5 箇所」を検証して落とす。

**3. タグを push する。**

```sh
git tag v0.1.0
git push --tags
```

タグ push で Actions が走り、完了すると **`StreamDock-releases` の Releases に下書き**が作られる
（インストーラ・`latest.json`・各 `.sig` が添付される）。動作確認だけなら GitHub の Actions 画面から
`release` ワークフローを**手動実行（workflow_dispatch）**してもビルドできる（下書き名は `CI build <番号>`）。

**4. 内容を確認して publish する。**

> ⚠ **publish した瞬間に、既存の全ユーザーへの配信が始まる。**
> updater は `releases/latest/download/latest.json` を見ており、下書きのうちはこの URL が 404 で
> アプリからは見えない。**publish が配信スイッチ**なので、成果物を確認してから押すこと。
> 手動実行（`ci-<番号>`）の下書きは**publish しない**（配布物ではない）。
> なお手動実行の下書きは CI が **prerelease** としても作るので、誤って publish しても
> `releases/latest` からは除外され updater には配信されない（本文にも警告バナーが入る）。
> ただしこれは保険であって、**publish しないのが手順**。

なお `release.yml` の `tauri-apps/tauri-action` と `dtolnay/rust-toolchain` は、updater の秘密鍵を扱うジョブに
いるため**コミット SHA へ固定**してある（供給網対策）。更新するときは手でその SHA を上げる。

### ⚠ アーティファクトと Actions のストレージ枠

build ジョブの成果物は **workflow artifact 経由で release ジョブへ受け渡すだけ**（同じ run の中で消費される）。
⚠ ただし**サイズが大きい**——comment-sidecar だけで 110MB あり、それが macOS の `.dmg` と `.app.tar.gz`、
Windows の NSIS `.exe` にそれぞれ入るので、**1 回の実行で数百 MB** 使う。

- **保持は 1 日**（`retention-days: 1`）。⚠ **実機確認のためにインストーラを落とすなら run の当日中に。**
  期限切れ後に必要になったら run を再実行する。
- 枠が埋まると `Failed to CreateArtifact: Artifact storage quota has been hit` でビルドが落ちる。
  そのときは **Actions → `cleanup-artifacts` → Run workflow** で残っている artifact をまとめて削除する
  （UI からは run を 1 つずつ開く必要があり、**期限切れの artifact はゴミ箱アイコンすら出ない**ため）。
  ⚠ 0 件だった場合は「消せるものが既に無い」＝ **GitHub 側の使用量の再計算待ち（6〜12 時間）**か、
  **別の private リポジトリ**が枠を使っている（Settings → Billing and licensing で確認）。
- ⚠ **配布物（public 側の Releases）はこの枠とは別勘定**なので、artifact を消しても配布に影響しない。

### 署名について

- **Windows**: CI に SSL.com の署名 Secrets（`ES_USERNAME` 他）が**設定されていれば**、
  **tauri のバンドル過程の中で** NSIS `.exe` を **SSL.com の個人検証(IV)証明書 + eSigner クラウド署名**で署名する
  （プロパティ →「デジタル署名」に発行者表示）。**Secrets 未設定なら署名せず、未署名で配布**される
  ＝証明書取得前でも comment-viewer 入り MVP を配布でき、Secrets を入れた瞬間からコード変更なしで署名に切り替わる。
  - 経路は `tauri.conf.json` の **`bundle.windows.signCommand`** → `apps/desktop/src-tauri/scripts/sign-windows.ps1`
    → **jsign**（Apache-2.0・CI 上にだけ入れる。リリースタグ固定＋SHA-256 照合）→ SSL.com eSigner。
    ⚠ **ビルド後にインストーラを署名し直す形は採らない**——updater の minisign 署名はバンドル時点の
      バイト列に対して作られるので、後からバイト列を変えると**自己更新だけが静かに壊れる**（下記・055a）。
  - 「署名するかどうか」は `sign-windows.ps1` が `STREAMDOCK_WINDOWS_SIGNING` で判断する。
    ⚠ tauri 公式の `--no-sign` は**使わない**（updater の minisign 署名まで止めてしまうため）。
  - **署名に失敗したらビルドを落とす**（未署名の成果物を public 側へ出さない）。署名後に
    `signtool verify /pa` で検証もしている。
  - 未署名の間は初回に SmartScreen「不明な発行元」警告（「詳細情報 → 実行」で回避）。
  - 署名後も IV/OV は**評判蓄積型**のため配布直後は警告が残り、ダウンロード実績が貯まると発行者名表示へ切り替わる
    （即時解消は EV のみ・法人登録が要る）。
  - 補足: 当初は Azure Trusted Signing を予定したが、**日本在住の個人開発者は公開信頼証明書の対象外**
    （米国・カナダの個人／米国・カナダ・EU・英国の組織のみ）と判明したため、個人でも取得できる SSL.com IV に変更した。
  - 認証情報はすべて GitHub Secrets のみ（`ES_USERNAME` / `ES_PASSWORD` / `CREDENTIAL_ID` / `ES_TOTP_SECRET`）。
    リポジトリ・生成物・ログには含めない（`tauri.conf.json` にも書かない。**env でのみ渡す**）。
- **macOS = 未署名**（親 099 の決定どおり当面）。初回は Gatekeeper 警告が出るため、右クリック →「開く」で回避する。
- **updater の署名（minisign）はコード署名とは別物**（055a）。前者は「配った更新が改ざんされていないか」を
  アプリ自身が公開鍵で検証するためのもので、OS の「不明な発行元」警告とは無関係。両方必要。
  - ⚠ この 2 つは**壊れ方が噛み合う**: ビルド後にインストーラを署名し直すとバイト列が変わり minisign 署名と
    食い違って、**Windows の自己更新だけが静かに壊れる**（CI は緑・インストーラも動くので実機まで気づけない）。
    そのため署名は `bundle.windows.signCommand` に寄せてある。**CI にガードもあり**、この構成が崩れると
    重いビルドの前に落ちる（詳細は [`docs/tasks/099a-windows-code-signing.md`](tasks/099a-windows-code-signing.md)）。

### ローカルで手動ビルドする場合

```sh
# updater の署名鍵が必要（未設定だと bundle 段階で失敗する。055a）
export TAURI_SIGNING_PRIVATE_KEY="$(cat <秘密鍵ファイル>)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='<生成時のパスワード>'
pnpm tauri build            # 実行した OS 向けのインストーラを生成
```

⚠ 鍵を**パスワード無し**で生成した場合も、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` は**空文字で export する**こと
（`export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''`）。未設定のままだと CLI が対話プロンプトで止まる。
CI では `CI=true` のため空文字が自動で使われる。
