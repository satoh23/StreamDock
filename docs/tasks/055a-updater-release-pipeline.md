# 055a リリース基盤（バージョン同期＋updater 署名鍵＋CI 成果物＋latest.json）

> 状態: **未着手（実装サブタスク・055 系の先頭／配布側）**。位置づけ・方式決定・線引きは
> 親 [055](055-app-self-update.md) を正とする。
>
> **必読前提**: 親 [055](055-app-self-update.md)（方式決定・egress の定義・実装順の絶対制約・**099a との地雷**）、
> 配布の親 [099](099-user-test-package.md) と署名 [099a](099a-windows-code-signing.md)、
> CI [`release.yml`](../../.github/workflows/release.yml)、Tauri 設定 [`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json)、
> 依存ゼロ検査スクリプトの先例 [`check-css-guards.mjs`](../../apps/desktop/scripts/check-css-guards.mjs) と
> [`check-fresh.mjs`](../../apps/comment-sidecar/scripts/check-fresh.mjs)、[`README.md`](../../README.md) の「リリース / 配布（099）」節、
> [`docs/security.md`](../security.md)（§1/§10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **配布設定・CI・鍵の取り扱いを変える**＝**security-review 必須**。
>
> ⚠ **本タスクはアプリのコードを 1 行も変更しない**（Rust / frontend の差分ゼロ）。plugin 登録もコマンド追加もしない。
> ⚠ **行番号は書かない**（特定はジョブ名・ステップ名・キー名で行うこと）。

## 目的

updater が動くための**配布側**をすべて揃える。具体的には
①バージョン番号のズレを機械で止める ②updater 署名鍵を用意する ③CI が updater 成果物と `latest.json` を吐く
④リリースノートの単一ソースを作る、の 4 点。

本タスクが終わった時点で、**アプリはまだ何も変わっていないが、public リリースに `latest.json` と `.sig` が並んでいる**
状態になる。055b 以降はそこへ繋ぎ込むだけになる。

## 現在の前提（調査結果・実コード）

### バージョン番号（5 箇所・同期の仕組みなし）

| ファイル | キー | 現在値 |
| --- | --- | --- |
| `package.json`（root） | `version` | `0.1.0` |
| `apps/desktop/package.json` | `version` | `0.1.0` |
| `apps/desktop/src-tauri/Cargo.toml` | `[package] version` | `0.1.0` |
| `apps/desktop/src-tauri/tauri.conf.json` | `version` | `0.1.0` |
| `apps/comment-sidecar/package.json` | `version` | `0.1.0` |

- README の「リリース手順」は **3 箇所しか挙げていない**（`apps/desktop/package.json` / `Cargo.toml` / `tauri.conf.json`）。
  root と sidecar が漏れている。
- **updater が比較するのは `tauri.conf.json` の version**。一方、**診断画面が表示する「アプリバージョン」は
  `Cargo.toml` 由来**（[`app_logs/service.rs`](../../apps/desktop/src-tauri/src/app_logs/service.rs) の
  `env!("CARGO_PKG_VERSION")` → [`DiagnosticsScreen.tsx`](../../apps/desktop/src/screens/diagnostics/DiagnosticsScreen.tsx)）。
  **この 2 つがズレると「診断は 0.1.0 なのに updater は 0.2.0 として振る舞う」**という追いにくい不整合になる。
- `git tag` は **0 件**＝タグ経由のリリースは一度も走っていない。

### 依存ゼロの検査スクリプトという既存の型

`check-css-guards.mjs` の冒頭コメントに理屈が書かれている: **`scripts/` は `tsconfig.json` の `include: ["src"]` の外**
なので、素の `.mjs` を置けば `node:fs` を使っても **`@types/node` 不要・typecheck 影響ゼロ・新規依存ゼロ**。
`apps/desktop/package.json` の `test` は `vitest run && pnpm check:css` の形で、素の node スクリプトを直列実行している。
本タスクの同期ガードもこの型に乗る。

### CI（`release.yml`）の現状

- トリガー: `v*` タグ push / `workflow_dispatch`。`RELEASE_TAG` は前者ならタグ名、後者なら `ci-<run番号>`。
- build ジョブ（macOS universal / Windows x64）が sidecar を SEA ビルド → macOS は `lipo` で universal 化して ad-hoc `codesign`
  → `tauri-apps/tauri-action@v0` を **`tagName` 無し**で実行（＝Release を作らず成果物だけ生成）。
- Windows のみ `sslcom/esigner-codesign` で `.exe` / `.msi` を `override: true` で置換署名（`secrets.ES_USERNAME` がある時だけ）。
- `actions/upload-artifact` の glob は **`dmg/*.dmg` / `nsis/*.exe` / `msi/*.msi` の 3 つだけ**
  （＝`.app.tar.gz` や `.sig` は現状 1 つも収集されない）。
- release ジョブが `softprops/action-gh-release@v2` で public の `satoh23/StreamDock-releases` に
  **draft** Release を作って全成果物を添付する（別リポジトリへ書くため `secrets.RELEASE_REPO_TOKEN` を使う）。

### ⚠ 既に埋まっている地雷（親 055 と同じ内容・ここが対処の起点）

eSigner は **tauri のビルド後**に `.exe` / `.msi` を `override: true` で**置換署名**する。
updater の `.sig`（minisign）は **tauri がバンドルした時点のバイト列**に対して作られる。
＝**署名でバイト列が変わり `.sig` と一致しなくなり、Windows の自己更新が必ず署名検証で落ちる。**
現在は `ES_USERNAME` 未設定でステップごとスキップされるため顕在化していない。

## このタスクでやること

### (1) バージョン同期ガード（新規依存ゼロ）

- 新規 `apps/desktop/scripts/check-version-sync.mjs` を作る。`check-css-guards.mjs` と同じ作法
  （`readFileSync` で読む → 不一致を `failures` に貯める → 最後に `process.exit(1)`）。
  - 上表の **5 箇所**を読み、すべて一致することを検査する。
  - **なぜ 5 箇所が要るのか**（updater は `tauri.conf.json`、診断画面は `Cargo.toml`、CI/開発者は `package.json`、
    sidecar は同梱物としての整合）を fail メッセージとファイル冒頭コメントに書く。
  - `Cargo.toml` は TOML パーサを持ち込まず、`[package]` セクション内の `version = "…"` を正規表現で拾う
    （依存ゼロの前提を崩さない。他セクションの `version` に誤ヒットしないよう `[package]` 以降・次の `[` までに限定する）。
- `apps/desktop/package.json` に `"check:version": "node scripts/check-version-sync.mjs"` を足し、
  `"test": "vitest run && pnpm check:css && pnpm check:version"` にする。
- `release.yml` の build ジョブに **「タグ名と version の一致検証」ステップ**を 1 つ足す
  （`github.ref_type == 'tag'` のときだけ実行。`v` を除いたタグ名が `tauri.conf.json` の version と一致すること）。
  不一致のまま配信すると updater が無反応になるか、下位バージョンを配って更新ループを作る。

### (2) updater 署名鍵

- `pnpm --filter ./apps/desktop tauri signer generate` で鍵ペアを作る。
- **秘密鍵とパスワードは private リポジトリの Secrets のみ**に置く
  （`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。リポジトリにコミットしない。
- **公開鍵は `tauri.conf.json` にコミットする**（これは公開してよい値）。
- README に **「秘密鍵を失うと、既に配布済みのインストールへ二度と更新を配れない」**ことと、
  鍵のバックアップ手順（パスワードマネージャ等・本人管理）を書く。

### (3) `tauri.conf.json`

- `bundle.createUpdaterArtifacts: true` を追加（これが無いと `.app.tar.gz` / `.sig` が生成されない）。
- `plugins.updater` セクションを新設する。
  - `endpoints`: `https://github.com/satoh23/StreamDock-releases/releases/latest/download/latest.json` の 1 本のみ。
    **`{{current_version}}` などの動的プレースホルダを埋めない**（バージョンを外部へ送らないため・親 055）。
  - `pubkey`: (2) で生成した公開鍵。
  - `windows.installMode`: 実装時に選定する（`passive` を第一候補とし、実挙動は [099b](099b-updater-e2e.md) で確定）。
- `app.security.csp` は **`null` のまま**（変更しない）。

### (4) `release.yml`

1. build ジョブの `tauri-action` ステップに `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` を env で渡す。
2. `upload-artifact` の glob に **updater 成果物**を足す（macOS の `.app.tar.gz` と `.sig`、Windows インストーラの `.sig`）。
   ⚠ **正確なファイル名・出力ディレクトリは Tauri のバージョン依存**なので、
   **空回し 1 回で実物を確認してから glob を確定し、確定した名前を本ファイルに追記する**。
3. release ジョブに **`latest.json` を生成するステップ**を足す。中身:
   - `version`（タグから `v` を除いたもの）/ `pub_date`
   - `notes` ← **`docs/release-notes/<tag>.md` の内容をそのまま**（(5)）
   - `platforms`: `darwin-universal` と `windows-x86_64`。各々 `signature`（`.sig` ファイルの中身）と
     `url`（`https://github.com/satoh23/StreamDock-releases/releases/download/<tag>/<ファイル名>`）。
   - ⚠ **release ジョブは `actions/download-artifact` しかしておらず checkout していない**。
     `docs/release-notes/` を読むには **`actions/checkout` を足す**か、build ジョブ側で artifact に含めて運ぶ。
     どちらにするか実装時に決めて記録する（checkout を足す方が素直）。
   - 生成は素の `node`（`actions/github-script` でも可）で行い、**新しい Action を増やさない**。
4. `softprops/action-gh-release` の `files` に `latest.json` が含まれるようにする。
5. **`draft: true` は維持する。** `releases/latest/download/latest.json` は draft 中 404 になり updater から見えないが、
   これは「成果物を確認してから publish する」安全弁として**望ましい**。
   README に **「publish した瞬間に全ユーザーへ配信が始まる」**と明記する。

### (5) リリースノートの単一ソース

- 新規ディレクトリ `docs/release-notes/` を作り、`vX.Y.Z.md` を 1 リリース 1 ファイルで置く。
  雛形（見出し / 箇条書き / 太字 / インラインコードのみ＝[055e](055e-release-notes-markdown.md) が描画できる範囲）を
  `docs/release-notes/README.md` に書いておく。
- CI が `latest.json` の `notes` と GitHub Release 本文の**両方**へ流す。
- ⚠ **ファイルが無いままタグを打った場合の挙動を決める**: CI を fail させる（推奨。リリースノート無しの配信を防ぐ）。

### (6) 099a への申し送りと README 更新

- [`099a-windows-code-signing.md`](099a-windows-code-signing.md) に、
  **「eSigner の `override: true` 置換署名は updater の minisign `.sig` を壊す。
  `bundle.windows.signCommand` へ寄せてから署名すること（055a の決定）」**を 1 行追記する。
  ⚠ **実際の移行は 099a で行う**（`ES_USERNAME` 未設定の今は検証できないため、ここでは決定の記録だけ）。
- README の「リリース手順」を更新する:
  - バージョン更新箇所を **3 → 5** に修正し、`pnpm --filter ./apps/desktop check:version` で確認できることを書く。
  - タグを打つ前に `docs/release-notes/vX.Y.Z.md` を書く手順を追加する。
  - **draft を publish した瞬間に全ユーザーへ配信が始まる**ことを書く。
  - updater 秘密鍵の Secrets 名と、**失うと更新を配れなくなる**ことを書く。

## ⚠ 実装時に確認しフォールバックを持つこと

**`createUpdaterArtifacts: true` なのに Rust 側に `tauri-plugin-updater` が無い状態を、Tauri CLI が拒否する可能性がある。**
拒否された場合は、**`Cargo.toml` への crate 追加と `lib.rs` への `.plugin(…)` 1 行だけを本タスクに前借りし、
コマンド（`check_app_update` 等）は [055b](055b-updater-check-command.md) のまま**にする。
前借りした場合はその旨を本ファイルと 055b の両方に追記する（「アプリコード差分ゼロ」の完了条件も併せて緩める）。

## このタスクでやらないこと

- **アプリのコード変更**（Rust コマンド・plugin 登録・frontend の一切。上記フォールバックに該当した場合を除く）。
- Windows 署名の実際の移行（`bundle.windows.signCommand` 化）＝**099a の領分**。macOS の署名・notarize＝**099 の領分**。
- 実タグ push（`v0.2.0` 等）と publish。**検証は `workflow_dispatch` の空回しだけ**で行う。
- バージョン番号を実際に上げること（同期ガードを入れるだけで、値は `0.1.0` のまま）。
- `tauri.conf.json` の `version` を `"../package.json"` 参照に変える案（**採らない**。診断画面が `Cargo.toml` を見ている以上
  Cargo.toml は同期対象から外せず、ガード方式のほうが素直）。
- **新規 GitHub Action の追加**（`latest.json` 生成は素の node で行う）。

## セキュリティ制約（docs/security.md 準拠）

- **鍵と資格情報はすべて GitHub の暗号化 Secrets のみ**に置く。リポジトリ・成果物・ログに含めない（§9・099a と同じ扱い）。
  updater 秘密鍵をワークフローのログに `echo` しない。**公開鍵は非機密**なのでコミットしてよい。
- `endpoints` はコンパイル時定数の 1 本だけ。**動的プレースホルダを埋めず、アプリ側のデータを URL に載せない**（親 055 の egress 定義）。
- 本タスクではアプリのコードを変えないため、**capability / CSP / 依存はすべて不変**（§3/§10）。
  `csp: null` 不変（§CSP 方針）。
- `docs/release-notes/` に置くのは公開してよいリリース説明のみ。パス・環境情報・Secrets を書かない（§9）。
- **新しい GitHub Action を増やさない**（供給網の面を広げない。099a の「`@develop` ではなくコミット SHA へ固定を推奨」と同じ思想）。

## 完了条件

- `pnpm --filter ./apps/desktop check:version` が存在し、**5 箇所のどれか 1 つを書き換えると fail する**ことを手で確認した。
  `test` から呼ばれている。
- `tauri.conf.json` に `bundle.createUpdaterArtifacts: true` と `plugins.updater.{endpoints, pubkey, windows.installMode}` がある。
  `csp: null` 不変。
- `workflow_dispatch` の空回し 1 回で、public の draft Release（`ci-<番号>`）に
  **`latest.json` と 各プラットフォームの `.sig`（および macOS の `.app.tar.gz`）が並んでいる**ことを目視確認した。
  **そのときの実ファイル名を本ファイルに追記した。**
- `latest.json` の `notes` に `docs/release-notes/<tag>.md` の内容がそのまま入っている。
- `099a-windows-code-signing.md` に minisign 衝突の申し送りが入っている。
- README のリリース手順が 5 箇所・リリースノート・publish の意味・鍵の取り扱いを反映している。
- **アプリのコードに差分が無い**（前借りフォールバックに該当した場合は、その差分が crate 追加と `.plugin(…)` 1 行のみ）。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop check:version
pnpm --filter ./apps/desktop test          # vitest ＋ CSS ガード ＋ バージョン同期ガード

# ガードが本当に効くか（FAIL になること。確認後に戻す）
#   apps/desktop/src-tauri/Cargo.toml の version を 0.1.1 に書き換えてから
node apps/desktop/scripts/check-version-sync.mjs

# ゼロ拡大の担保（差分ゼロが期待。※前借りフォールバック時は Cargo.toml と lib.rs のみ差分可）
git status --short -- apps/desktop/src/ apps/desktop/src-tauri/src/ apps/comment-sidecar/src/
# capability を触っていないことの担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/

# CI 空回し（タグは打たない）: GitHub の Actions 画面から release ワークフローを workflow_dispatch で実行し、
#   satoh23/StreamDock-releases の draft `ci-<番号>` に latest.json / *.sig / *.app.tar.gz が添付されるのを確認する。
#   （成果物の実ファイル名をこのタスクファイルへ追記すること）
gh run list --workflow release --limit 3
```

## 実装後に必要なレビュー

- **security-review 必須**。観点:
  - updater 秘密鍵・eSigner 資格情報が**リポジトリ・成果物・ログのどこにも出ていない**こと（公開鍵のコミットは可）。
  - `endpoints` が**単一のコンパイル時定数**で、動的プレースホルダやアプリ側データを含まないこと。
  - 新しい GitHub Action を増やしていないこと。`latest.json` 生成が素の node で完結していること。
  - `draft: true` が維持され、「publish＝配信開始」が README に明記されていること。
  - **アプリのコード・capability・CSP・依存が不変**であること（前借りフォールバック時はその範囲に収まっていること）。
  - 099a への申し送り（minisign 衝突）が入っていること。
