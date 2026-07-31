# 055 アプリ自己アップデート（親設計・線引きの正）

> 状態: **未着手（親設計・線引きの正）**。**このタスク自体はコードを 1 行も変更しない**（方式決定と分割の記録のみ）。
> 実装は 055a → 055b → 055c → 055d → 055e、実機 E2E は [099b](099b-updater-e2e.md)。
>
> **必読前提**: [`docs/security.md`](../security.md)（**§1 外部通信** / **§5 ファイル操作** / §3 最小権限 / §9 ログ / §10 依存 /
> 「Tauri Permissions / Capabilities 方針」/ 「レビュー必須条件」の**自動アップデート**）、
> 配布の親 [099](099-user-test-package.md) と署名 [099a](099a-windows-code-signing.md)、
> CI [`release.yml`](../../.github/workflows/release.yml)、Tauri 設定 [`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json)、
> Rust エントリ [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)、エラー型 [`error.rs`](../../apps/desktop/src-tauri/src/error.rs)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> 各サブタスクのレビュー区分は本ファイルの「分割と実装順」表を正とする（**055a / 055b / 055d は security-review 必須**）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

StreamDock 自身を**アプリ内で更新できる**ようにする（Docker Desktop 相当の体験）。

1. ヘッダーに**ベルのアイコン**を置き、更新があるときだけ**バッジ**を出す。
2. ベルを押すと**アップデート画面**へ遷移し、**バージョン番号**と**そのバージョンの更新内容**が表示される。
3. 画面右下の**アップデートボタン**でダウンロードとインストールが自動で走る。
4. 完了後の**再起動ボタン**で再起動し、新しいバージョンが反映される。

更新の有無は **public リポジトリ `satoh23/StreamDock-releases` の Releases** を見て判定する。
更新内容は**そのリリースの説明文がそのまま**表示され、**マークダウンが反映される**。

## 現在の前提（調査結果・実コード）

### アプリ側

- Tauri **v2**（`tauri = "2"` / `@tauri-apps/api ^2` / `@tauri-apps/cli ^2`）。pnpm workspace モノレポ（`apps/desktop` が本体）。
- `tauri.conf.json` には **`plugins` セクションが無い**。`bundle.createUpdaterArtifacts` も未設定。
  `app.security.csp` は **`null`**（CSP を強制していない）。`bundle.targets: "all"`（Windows は NSIS + WiX の両方を生成）。
  `bundle.externalBin` に Node sidecar（`binaries/comment-sidecar`）を同梱している。
- Rust の既存プラグインは `opener` / `dialog` / `autostart` / `shell` の 4 つ。
  **`updater` / `process` / HTTP クライアント（`reqwest` / `ureq` 等）はいずれも未導入**。
- capability は 4 枚（`default.json` がメイン窓、`comment-viewer` / `comment-overlay` / `pinned-overlay` は `core:default` のみ）。
- **`tauri-plugin-shell` は「crate は入れるが capability に `shell:*` をゼロ付与し、Rust API からのみ使う」という先例**
  （`Cargo.toml` と `lib.rs` の該当コメント、および security.md「コメントビューア方針」）。本タスクはこれと同型の構えを採る。
- Rust コマンドの戻り値は必ず `AppResult<T>`（`error.rs`）。型は ts-rs で TS へエクスポート（`pnpm gen:bindings` / `check:bindings`）。
- フロントは `src/features/*/xxxApi.ts` という薄い invoke ラッパ経由（コンポーネントから直接 `invoke` しない）。

### バージョン番号（**参照系が二重化している**）

`package.json`（root）/ `apps/desktop/package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` /
`apps/comment-sidecar/package.json` の **5 箇所**がすべて `0.1.0`。**同期の仕組みは無い**
（README のリリース手順は 3 箇所しか挙げておらず、root と sidecar が漏れている）。

さらに、**診断画面が表示する「アプリバージョン」は `Cargo.toml` 由来**
（[`app_logs/service.rs`](../../apps/desktop/src-tauri/src/app_logs/service.rs) の `env!("CARGO_PKG_VERSION")` →
[`DiagnosticsScreen.tsx`](../../apps/desktop/src/screens/diagnostics/DiagnosticsScreen.tsx)）なのに対し、
**updater が比較するのは `tauri.conf.json` の version**。ズレると
「診断画面は 0.1.0 なのに updater は 0.2.0 として振る舞う」が起きる。055a で同期ガードを入れる理由。

### リリース基盤

- ソースは private リポジトリ。成果物だけを **public の `satoh23/StreamDock-releases`** の Releases に置く（親 099 の決定）。
- `release.yml` は既にある。`v*` タグ push / `workflow_dispatch` で macOS(universal) と Windows(x64) をビルドし、
  `tauri-apps/tauri-action@v0` を **`tagName` 無し**で使って成果物だけ作り、`softprops/action-gh-release@v2` で
  public 側に **draft** Release を作って添付する。
- **`git tag` は 0 件**＝タグ経由のリリースは一度も実施していない。
- macOS は **未署名**（親 099 の決定）。Windows は SSL.com eSigner で署名するが、`secrets.ES_USERNAME` 未設定のため
  現在はステップごとスキップされている。

### セキュリティ方針の現状

- §1 は「MVPでは、stream-dock は外部サーバーと通信しない」。ただし**「許可する可能性があるもの」に
  「将来的なアップデート確認」が既に列挙されている**。既存の例外は 6 件（032c-b / 032c-c / 032c-d / 036b / 036c / 044a）で、
  いずれも「### 例外（…）」節を追記する形式。
- **インターネットへの egress は現在すべて Node sidecar 側**に集約され、
  [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) の fail-closed allow-list で守られている。
  **Tauri 本体プロセスがインターネットに出た前例は無い。**
- §10 の「特に注意するもの」に **auto update 系 / network・http 系 / updater 系**が明記されている。
- 「レビュー必須条件」に **自動アップデート**が既に列挙されている（新設不要・参照するだけ）。

## 方式決定（比較と採用理由）

### 採用: `tauri-plugin-updater`（**Rust API 専用**）＋ public Release 上の静的 `latest.json`

| 案 | 検出 | DL/インストール | 追加 egress | capability | 判定 |
| --- | --- | --- | --- | --- | --- |
| **① updater plugin（Rust API のみ）＋静的 latest.json** | plugin | plugin | `github.com` / `objects.githubusercontent.com` | **ゼロ** | **採用** |
| ② ①＋ JS 側 plugin（`@tauri-apps/plugin-updater` / `-process`） | plugin(JS) | plugin(JS) | 同上 | `updater:*` ＋ `process:allow-restart` をメイン窓へ | 機能は①と同一で ACL 面だけ広がる。**却下** |
| ③ GitHub Releases API を webview `fetch` ＋ 手動 DL 誘導（opener） | fetch | **やらない** | `api.github.com` | ゼロ | Rust に reqwest が入らない唯一の案だが、**「アプリから更新まで完結」という要望を満たさない**。**却下** |
| ④ 検出＝`fetch`（`api.github.com`）／DL・インストール＝plugin | fetch | plugin | `api.github.com` **＋**上記 2 つ | ゼロ | reqwest は結局入るのに egress ホストが 1 つ増える。**バッジに件数を出す場合のみ**意味がある（本タスクは件数を出さない）。**却下** |

**① を採る理由**

- リリースノートを**リポジトリ内の単一ソース**にして CI が `latest.json` の `notes` に流し込むため、
  `api.github.com` を叩かずにマークダウン本文が UI まで届く。**egress は 2 ホストで済む**。
- 完全性の担保が **minisign 公開鍵検証**（`plugins.updater.pubkey`）で fail-closed。
  「宛先 allow-list」より強い保証で、§1 に例外を書くときの根拠として明確。
- 宛先が `tauri.conf.json` の**コンパイル時定数**で、**フロントから宛先を差し替える経路がゼロ**（§3/§8 と整合）。
  実行時に `UpdaterBuilder::endpoints()` で上書きする実装は**採らない**。

### capability ゼロで閉じる（`tauri-plugin-shell` と同型）

- Rust crate `tauri-plugin-updater` のみ追加し、**JS 側 `@tauri-apps/plugin-updater` は入れない**。
- アプリ定義コマンド 3 本（`check_app_update` / `install_app_update` / `restart_app`）だけを公開する。
  アプリ定義コマンドは Tauri v2 の ACL 対象外なので **capability の差分はゼロ**。
- 再起動は `AppHandle::restart()` を使い、**`tauri-plugin-process` は入れない**（`process:allow-restart` を配らずに済む）。
- ⚠ **限界を明記する**: capability ゼロは「安全」を意味しない。**アプリ定義コマンドは 4 窓すべてから呼べる**ため、
  コメビュ窓やオーバーレイ窓からも `install_app_update` を呼べる。既存構造と同じ性質だが、
  security.md の Capabilities 方針節に 1 行残す（046b の申し送りと同じ扱い）。

### egress の定義（これ以外に出ない）

- `https://github.com/satoh23/StreamDock-releases/releases/latest/download/latest.json`（302）
  → `objects.githubusercontent.com`（実体）。**GET のみ・リクエストボディなし・送信するアプリ側データはゼロ**。
- **`{{current_version}}` などの動的プレースホルダを endpoint URL に埋めない**（＝バージョンを外部へ送らない）。
- `api.github.com` は**使わない**。

### Rust に HTTP スタックが入ることの受容

- 新たに入るのは `reqwest` / `zip` / `tar` / `flate2` / `minisign-verify` 等（tokio は Tauri v2 が既に保持）。
  §10 の「auto update 系・network/http 系・updater 系」に**正面から該当**する。だから 055b/055d は security-review 必須。
- TLS は **`rustls` 系 feature を選ぶ**（OpenSSL/native-tls を持ち込まない・クロスビルドを増やさない）。
  正確な feature 名は実装時に crate のドキュメントで確認する。
- 「検出だけ webview `fetch` にして reqwest を回避する」案（④）は**インストールで結局 reqwest が要る**ので成立しない。
  reqwest を本当に避けられるのは「インストールしない」案（③）だけで、それは要望を満たさない。

### リポジトリ初の真の `async fn` コマンドになる

- 現状 `src-tauri/src` に **`async fn` は 1 つも無い**。窓生成コマンドの `#[tauri::command(async)]` は
  「同期 fn を tokio worker で走らせる」だけで、本体は同期。
- updater の Rust API は `.await` 必須で、**tokio ランタイム内なので `block_on` の逃げ道がない**。
- ⚠ **panic は invoke の Promise を永久未解決にする**（`lib.rs` の `WINDOW_OPEN_LOCK` 周辺のコメントが同じ罠を記録済み）。
  `unwrap()` / `expect()` を使わず、**全経路を `AppResult` に落とす**こと。

### 更新チェックの契機・バッジの意味（本人の決定）

- **起動時に自動で 1 回チェックする。ON/OFF トグルは設けない**（既定 ON 固定）。
  ⚠ これは**外部通信を止める手段をユーザー側に残さない**選択である。§1 が「将来的なアップデート確認」を
  許可する可能性があるものとして既に挙げているためポリシー違反ではないが、
  **§1 の例外節に「既定 ON 固定・ユーザーによる停止手段は設けない（本人の決定）」と明記**し、
  後から「なぜ止められないのか」を追えるようにする。
- **バッジの数字は常に「1」**。仕様として「**未確認の更新通知が 1 件あることを示す**（新しいリリースの件数ではない）」と定義する。
  件数表示は `api.github.com` へのリリース一覧取得と semver 比較が要り、未認証レート制限（60 回/時）と
  draft/prerelease の扱い判断が発生するため採らない。

### リリースノートの出どころ（本人の決定）

- **`docs/release-notes/vX.Y.Z.md` をリポジトリ内の単一ソース**にする。タグを打つ前にこのファイルを書く。
  CI が **`latest.json` の `notes` と GitHub Release 本文の両方**へ流し込む。
- 実行時に `api.github.com` から本文を取りに行く案は採らない（egress +1・レート制限・draft 中は取得不可）。
- 描画は **自前の最小マークダウンレンダラ**（React 要素を返す・`dangerouslySetInnerHTML` 不使用・**新規依存ゼロ**）。
  `react-markdown` + `remark-gfm` は推移的依存が 20 以上あり §10 に照らして重いので採らない（055e）。

## 分割と実装順

| # | タスク | レビュー区分 | 依存 |
| --- | --- | --- | --- |
| [055a](055a-updater-release-pipeline.md) | リリース基盤（バージョン同期＋署名鍵＋CI 成果物＋latest.json）。**アプリコード差分ゼロ** | **security-review 必須** | 055 |
| [055b](055b-updater-check-command.md) | 更新検出エンジン（plugin 導入＋Rust コマンド・**UI なし**） | **security-review 必須** | 055a |
| [055c](055c-update-notice-and-screen.md) | ベル＋バッジ＋アップデート画面（**表示まで**） | 軽レビュー | 055b, [054](054-comment-viewer-settings-readability.md) |
| [055d](055d-update-install-and-restart.md) | ダウンロード → インストール → 再起動 | **security-review 必須** | 055c |
| [055e](055e-release-notes-markdown.md) | リリースノートのマークダウン描画（最小サブセット・依存ゼロ） | 軽レビュー | 055c |
| [099b](099b-updater-e2e.md) | アップデータ実機 E2E（mac/win・2 リリース間の自己更新） | 軽レビュー（コード変更なし） | **099 の実タグ push・publish 完了後** |

```
054（独立）
055（本ファイル・設計のみ）
 └ 055a ─→ 055b ─→ 055c ─→ 055d ─→ 055e
                                      │
        ［098 / 099 / 099a を実行してタグ push・publish］
                                      ↓
                                    099b（実機 E2E）
```

### ⚠ 絶対に守る実装順の制約

- **055a〜055d は、最初の公開リリース（099 の実タグ push・publish）より前に完了していること。**
  updater を含まない `v0.1.0` を配ってしまうと、**それを入れたユーザーは以後永久に自動更新できない**
  （手動で入れ直させるしかない）。これが本タスク群を 098/099 より前に置く理由。
- ただし **055a の検証は `workflow_dispatch` の空回しだけで完結する**（タグ push 不要）ので、
  **098/099 の完了待ちにはならない**。ブロックされるのは 099b の実機 E2E だけ。
- **E2E だけ 099b に置いた理由**: 着手条件が「public 側に published（draft でない）リリースが 2 本ある」＝
  099 の完了条件そのもの。055f にすると 099 のほうが先に来て「番号順＝実装順」が破れる。
  099b なら `054 → 055〜055e → 098 → 099 → 099a → 099b` で番号順＝実装順が厳密に保たれる。

## ⚠ 既に埋まっている地雷（099a との衝突）

`release.yml` の `sslcom/esigner-codesign` は **tauri のビルド後**に `.exe` / `.msi` を `override: true` で
**置換署名**する。一方、updater の `.sig`（minisign）は **tauri がバンドルした時点のバイト列**に対して作られる。
＝**署名でバイト列が変わり `.sig` と一致しなくなり、Windows の自己更新が必ず署名検証で落ちる。**

現在は `secrets.ES_USERNAME` 未設定でステップごとスキップされるため顕在化しておらず、**099a に着手した瞬間に発火する**。
対処は「`bundle.windows.signCommand` へ寄せて tauri のバンドル過程内で署名し、その後 updater 署名を作らせる」。
**方針決定と記録は 055a**、**実際の移行は 099a**（ES_USERNAME 未設定の今は検証できないため）。
055a で 099a のタスクファイルに申し送りを 1 行追記する。

## このタスクでやらないこと（＝ 055 系全体のスコープ外）

- **サイレント自動更新**（ユーザーの操作なしに更新を当てる）。差分更新。ロールバック。beta / stable のチャンネル分け。
- **全リリース履歴の一覧表示**（表示するのは最新リリース 1 件の内容のみ）。
- macOS のコード署名・notarize（親 [099](099-user-test-package.md) の領分。**未署名のまま自己更新できるかは 099b で実測する**）。
- Linux 配布。telemetry / analytics（§1 の禁止事項・入れない）。
- **sidecar 単体の更新**（`externalBin` として本体バンドルに同梱されているため、本体の更新で一緒に入れ替わる）。
- 更新チェックの ON/OFF トグル（本人の決定により作らない）。バッジの件数表示。

## セキュリティ制約（docs/security.md 準拠）

055 系全体で守る不変条件。各サブタスクの「セキュリティ制約」節はこれを参照して具体化する。

- **egress は前掲の 2 ホスト・GET のみ・送信データゼロ**。宛先はコンパイル時定数で、実行時にもフロントからも差し替えない。
- **capability の差分はゼロ**（`updater:*` / `process:*` を配らない）。JS 側 plugin を入れない。`csp: null` 不変。
- **アプリ定義コマンドは 4 窓すべてから呼べる**という限界を security.md に明記する。
- **§9**: 更新経路のログに URL・ローカルパス・環境情報を出さない（出してよいのはバージョン文字列と成否のみ）。
  更新の成否を Rust の DB へ記録しない（新規の保存経路を作らない）。
- **§5 の例外が発生する**: アップデータは**自分自身の `.app` / インストール先を置換する**＝
  「アプリの管理領域内に限定する」原則の外に出る。**見落としやすい最重要ポイントなので必ず節を追記する。**
- **§10**: `tauri-plugin-updater` の追加理由と、**明示的に足さないもの**（`tauri-plugin-process` / JS 側 plugin /
  マークダウンライブラリ）を記録する。

### security.md へ追記する節の割り当て

| 節 | 内容 | 実施タスク |
| --- | --- | --- |
| §1 に「### 例外（055・アプリ自己アップデート）」 | 本体プロセス初のインターネット egress。宛先 2 ホスト・GET のみ・送信データゼロ・minisign 検証必須・**既定 ON 固定で停止手段なし** | 055b |
| §5 に「### 例外（055・自己置換）」 | 自分自身の `.app` / インストール先を置換する＝管理領域外への書き込み | 055d |
| §10 に「**追加した依存（055・アプリ自己アップデート）**」 | `tauri-plugin-updater`（→ reqwest / zip / tar / flate2 / minisign-verify）と、明示的に足さないもの | 055b |
| 「Tauri Permissions / Capabilities 方針」に 055 節 | updater を追加するが capability はゼロ（032c-b と同型）＋**4 窓から呼べる限界** | 055b |
| 「レビュー必須条件」 | **「自動アップデート」に既に該当**。新設不要・参照するだけ | ― |

## 完了条件（本タスク＝親設計）

- 本ファイルが方式決定・egress の定義・capability 方針とその限界・実装順の絶対制約・地雷（099a 衝突）・
  やらないこと・security.md 追記の割り当てを記録している。
- サブタスク 055a〜055e と 099b のファイルが起票され、[`docs/task-board.md`](../task-board.md) に反映されている。
- **リポジトリのコード（`apps/` / `.github/`）に差分が無い**（本タスクは設計のみ）。

## 確認コマンド

```bash
git diff --stat
# 本タスクはドキュメントのみ（差分ゼロが期待）
git status --short -- apps/ .github/
ls docs/tasks/055*.md docs/tasks/099b-*.md
```

## 実装後に必要なレビュー

- 本タスク単体はコード変更が無いためレビュー不要。ただし **055a / 055b / 055d は security-review 必須**で、
  そのレビューは本ファイルの「セキュリティ制約」と「security.md へ追記する節の割り当て」を判断基準にする。
