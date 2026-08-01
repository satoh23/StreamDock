# 055a リリース基盤（バージョン同期＋updater 署名鍵＋CI 成果物＋latest.json）

> 状態: **実装済み（2026-08-01）／CI 空回しは未実施・未コミット**。実装の記録は
> [`docs/progress.md`](../progress.md) の「2026-08-01 (055a リリース基盤 …)」節を正とする。
> **アプリのコード差分はゼロ**（`apps/*/src/` / `capabilities/` / `Cargo.toml` / `pnpm-lock.yaml` すべて無変更＝
> **前借りフォールバックには該当しなかった**。ただし bundle 段階の可否は空回しで最終確認する）。
>
> **実装時に決めたこと（タスク記述からの変更点）**:
> - `latest.json` の `version` は**タグ名ではなく `tauri.conf.json` から読む**。notes も `<tag>.md` ではなく
>   **`docs/release-notes/v<version>.md`** を見る。**必須判定はタグ push 時のみ**（空回しはプレースホルダで続行）。
>   → 空回しで `RELEASE_TAG` が `ci-<番号>` になり (5) と完了条件が両立しない問題と、`version` が semver に
>   ならない問題を同時に解消するため。**タグ push 経路に抜け道は作っていない。**
> - 欠落検出は **2 段**（build の `Verify updater artifacts` ＋ `make-latest-json.mjs` の fail-closed）。
>   `if-no-files-found: error` は全パターン 0 件でしか落ちないため。
> - eSigner 地雷は**申し送りだけでなく CI ガード**にした（`Guard - post-build signing breaks updater signature (099a)`）。
> - `tauri-apps/tauri-action` を **コミット SHA へ固定**（秘密鍵を渡すため。挙動は不変）。
> - Windows の updater 対象は **NSIS `.exe` のみ**（`.msi` は Release に並ぶが `latest.json` は指さない）。
>
> **security-review（2026-08-01）の指摘を反映済み**。判定は「軽微な懸念あり・修正必須ゼロ」で、
> 反映した主なものは ①**署名鍵の同一性検査**（下の「(4) `release.yml`」6.）②**空回しの誤 publish 対策**
> （`prerelease` ＋本文の警告バナー）③`Verify updater artifacts` の**シェルフラグ修正**
> ④eSigner ガードの**両側判定化とビルド前への移動** ⑤`dtolnay/rust-toolchain` の SHA 固定。
> 詳細は [`docs/progress.md`](../progress.md) の 055a 節「### レビュー指摘の反映（2026-08-01）」。
>
> ⚠ **空回し後に追記すること**: 成果物の**実ファイル名**（下の「空回しで確定した実ファイル名」節）。
> `platforms` のキーと前借りフォールバックの該否は、**tauri のソースを読んで静的に確定済み**（同節）。
>
> 位置づけ・方式決定・線引きは親 [055](055-app-self-update.md) を正とする。
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
6. **（レビュー S-1 で追加）署名鍵の同一性を検査する。** tauri-cli の `sign_updaters` は、
   `TAURI_SIGNING_PRIVATE_KEY` の鍵が `plugins.updater.pubkey` と食い違っても **`log::warn!` だけでビルドを通す**。
   ＝**間違った鍵で署名された `.sig`** は存在チェックも対の検査も素通りし、publish 後に全ユーザーの更新だけが落ちる。
   `make-latest-json.mjs` で `.sig` と `pubkey` の **keynum（minisign ボックス 2 行目のバイト 2..10）を突き合わせ**、
   不一致なら fail する（併せて `.sig` の trusted comment の `file:` と実体名も照合する）。
7. **（レビュー S-2 で追加）空回しの誤 publish を機械で無害化する。** `prerelease: ${{ github.ref_type != 'tag' }}` を
   足す（`releases/latest` は draft と **prerelease の両方**を除外するため、誤 publish しても updater には見えない）。
   併せて空回しの Release 本文の先頭に警告バナーを入れる（`docs/release-notes/v<version>.md` を実物として置いた結果、
   下書きが本物のリリースと見分けがつかなくなったため）。

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

## ⚠ 実装時に確認しフォールバックを持つこと → **該当しないことが確定した**

当初の懸念: **`createUpdaterArtifacts: true` なのに Rust 側に `tauri-plugin-updater` が無い状態を、Tauri CLI が
拒否する可能性がある。** 拒否された場合は `Cargo.toml` への crate 追加と `lib.rs` への `.plugin(…)` 1 行だけを
前借りする方針だった。

**結論（レビューで tauri-cli のソースを読んで確定・2026-08-01）: 拒否されない。前借りは不要。**

- 手元の `@tauri-apps/cli` と同版（2.11.4）の `crates/tauri-cli/src/interface/rust.rs` は、
  `create_updater_artifacts != Bool(false)` のとき **`config.plugins` の `"updater"` キーだけ**を見る
  （無ければ `failed to get updater configuration: plugins > updater doesn't exist` で落ちる）。
  **`Cargo.toml` の依存も `lib.rs` の plugin 登録も一切参照しない。**
- `crates/tauri-cli/src/bundle.rs` の `sign_updaters` も `settings.updater()`（＝上の config 由来）しか見ない。
- ＝ **`plugins.updater` が config にあれば bundle は通る**。空回しでの確認は「念のため」であって、
  ここが理由でビルドが落ちることはない。

＝ **完了条件の「アプリのコードに差分が無い」は緩めない。**

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

## 空回しで確定した実ファイル名と `platforms` キー（**確定済み・2026-08-01**）

`workflow_dispatch` の空回しが両 OS とも緑になり、`satoh23/StreamDock-releases` の draft に成果物が並んだ。

**updater がキーを引く規則（tauri-plugin-updater の `get_urls` を実測）**: **`{os}-{arch}-{installer}` → `{os}-{arch}`
の 2 段**でしか検索しない（`Installer::name()` は `app` / `nsis` / `msi` / `deb` / `rpm` / `appimage`）。
`platforms` は `HashMap` で、**どの段でも引かれないキーは単に無視される**。

| プラットフォーム | 実際に引かれるキー | 併記しているキー | 成果物の実ファイル名 | 署名ファイル |
| --- | --- | --- | --- | --- |
| macOS (universal) | `darwin-aarch64` / `darwin-x86_64`（2 段目） | `darwin-universal`（**引かれないが無害**・将来の保険） | `StreamDock.app.tar.gz`（72.2 MB） | `StreamDock.app.tar.gz.sig`（408 B） |
| Windows x64 | `windows-x86_64`（2 段目。1 段目の `windows-x86_64-nsis` は置いていない） | ― | `StreamDock_0.1.0_x64-setup.exe`（21.9 MB） | 同左 `.sig`（420 B） |

**Release の添付一覧（`ci-<番号>` の draft）**: `latest.json`（4.93 KB）/ `StreamDock.app.tar.gz`(+`.sig`) /
`StreamDock_0.1.0_universal.dmg`（71.2 MB）/ `StreamDock_0.1.0_x64-setup.exe`(+`.sig`)。

**検算で確認したこと**:

- `.sig` のサイズ 408 / 420 B は minisign ボックスの理論値と**完全一致**（差の 12 B は trusted comment に埋まる
  `file:<ファイル名>` の長さの差 9 文字を base64 した分）＝ 切り詰めも混入もない本物の署名。
- `latest.json` の 4.93 KB もリリースノート 2619 B ＋ mac 署名 3 回分 ＋ win 1 回分 ＋ URL 4 本から**計算値と一致**。
- 8 個すべてのファイル名が **`encodeURIComponent` で 1 文字も変化しない**（英数字と `_ . -` のみ）
  ＝ `latest.json` の `url` と GitHub 側のアセット名がズレて 404 になる余地はない。
- `StreamDock_0.1.0_universal.dmg` の名前が **macOS ビルドが universal である**ことを示す
  ＝ `darwin-aarch64` / `darwin-x86_64` に同じ `.app.tar.gz` を割り当てている前提が成立している。

### ⚠ `.msi`(WiX) は配布対象から外した（**本人の決定・2026-08-01**）

初回の空回しでは `.msi` も並んでいた（`StreamDock_0.1.0_x64_en-US.msi` ＋ `.sig`）。しかし:

- `latest.json` の `windows-x86_64` は **NSIS の `.exe` しか指さない**。これは 2 段目のフォールバックなので、
  **`.msi` で入れたユーザーにも NSIS の `.exe` が配られる**＝更新のたびにインストール形式が入れ替わり、
  アンインストールのエントリが二重化しうる。
- 「どちらを落としてもよい」状態は事故のもとで、**使わない形式を並べる意味が無い**。

→ `tauri.conf.json` の `bundle.targets` を **`"all"` → `["app", "dmg", "nsis"]`** に変更した。

- **`app` を必ず含めること。** tauri-bundler は `PackageType::MacOsBundle`（＝`app`）が package types に無いと
  **`.app.tar.gz`（macOS の updater 成果物）を作らない**（`bundle.rs` の `matches!(package_type, PackageType::MacOsBundle)`）。
  `dmg` だけにすると mac の自己更新が丸ごと死ぬ。
- `package_types()` は**プラットフォーム外の指定を黙って除外する**ので、この 1 つのリストが mac（app+dmg）と
  Windows（nsis）の両方で正しく効く。
- 併せて `release.yml` から `msi/*.msi` / `msi/*.sig` の glob と、`Sign WiX installer (.msi)` ステップ、
  `Locate Windows installers` の `msi=` 出力を削除した（099a の署名対象も `.exe` だけになる）。
- **復活の検知**: `.msi` が dist/ に現れたら `make-latest-json.mjs` が `::warning` を出す
  （`bundle.targets` に戻ったのに `latest.json` を直し忘れる、を防ぐため）。

⚠ **記述の訂正（レビュー Q-2）**: 当初「1 キー 1 URL なので `.exe` と `.msi` の両方は載せられない」と書いていたが
**これは誤り**。1 段目に installer 名を含むキー（`windows-x86_64-nsis` / `windows-x86_64-msi`）を置けば両方載せられる。
`.msi` を採らない理由は上記のとおり「**そもそも配らない**」から。

## security.md を変更しなかった判断（レビュー S-5 で追認）

本タスクでは `docs/security.md` を**意図的に変更していない**。根拠:

- §1 の「許可する可能性があるもの」に**「将来的なアップデート確認」が既にある**＝方針違反ではない。
- 親 [055](055-app-self-update.md) の「security.md へ追記する節の割り当て」表が、§1 例外／§10 依存／
  Capabilities 方針の追記を **055b の担当**と定めている（task-board にも記録済み）。
- **実際の egress はゼロ**（`plugins.updater` を読むコードが存在しない。`apps/` 内で当該 URL が出るのは
  `tauri.conf.json` の 1 箇所のみで、`tauri-plugin-updater` は `Cargo.toml` に無い）。
  条文の追記は「実際に通信が発生する変更」に紐づけたほうが、条文と実装の対応が保てる。

⚠ **残る非対称**: security.md は「正」なのに、`tauri.conf.json` には外部ホストの URL が書かれていて
security.md からは辿れない。**再修正トリガー＝ 055b の着手が長引き、その間に別件の security-review が入るとき**。
そのときは §1 の末尾に「055a で配布側のみ実装済み・読むコードが無く egress は発生しない・条文追記は 055b」という
**所在のポインタ 1 行**を置く（条文の緩和ではないので 055b の担当範囲は侵さない）。

## 実装後に必要なレビュー

- **security-review 必須**。観点:
  - updater 秘密鍵・eSigner 資格情報が**リポジトリ・成果物・ログのどこにも出ていない**こと（公開鍵のコミットは可）。
  - `endpoints` が**単一のコンパイル時定数**で、動的プレースホルダやアプリ側データを含まないこと。
  - 新しい GitHub Action を増やしていないこと。`latest.json` 生成が素の node で完結していること。
  - `draft: true` が維持され、「publish＝配信開始」が README に明記されていること。
  - **アプリのコード・capability・CSP・依存が不変**であること（前借りフォールバック時はその範囲に収まっていること）。
  - 099a への申し送り（minisign 衝突）が入っていること。
