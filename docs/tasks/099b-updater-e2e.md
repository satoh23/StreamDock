# 099b アップデータ実機 E2E（mac / Windows・2 リリース間の自己更新）

> 状態: **未着手（実機検証タスク・コード変更なし）**。方式・線引きは親 [055](055-app-self-update.md) を正とする。
>
> **着手条件（これが揃うまで開始できない）**:
> 1. [055a](055a-updater-release-pipeline.md)〜[055d](055d-update-install-and-restart.md) が実装済み
>    （[055e](055e-release-notes-markdown.md) は任意）。
> 2. **public の `satoh23/StreamDock-releases` に、updater 入りの published（draft でない）リリースが 2 本ある**。
>    ＝[098](098-windows-build.md) / [099](099-user-test-package.md)（＋必要なら [099a](099a-windows-code-signing.md)）を
>    実行して実タグを push・publish 済みであること。
>
> **番号が 099b である理由**: 着手条件が 099 の完了条件そのものなので、055f にすると 099 のほうが先に来て
> 「番号順＝実装順」が破れる。099b なら `054 → 055〜055e → 098 → 099 → 099a → 099b` で順序が厳密に保たれ、
> 既存の「MVP リリース前最後」枠にも収まる。
>
> **必読前提**: 親 [055](055-app-self-update.md)（**OS ごとにインストールの意味が違う**・**macOS 未署名のリスク**）、
> [055a](055a-updater-release-pipeline.md)（`latest.json` と署名鍵・**099a との minisign 衝突**）、
> [055d](055d-update-install-and-restart.md)（`install_app_update` / `restart_app` と UI の OS 分岐）、
> [099](099-user-test-package.md)（配布の親）、[099a](099a-windows-code-signing.md)（Windows 署名）、
> CI [`release.yml`](../../.github/workflows/release.yml)、[`docs/security.md`](../security.md)（§1/§5/§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **コード変更なし（不具合が見つかった場合の修正は該当タスクへ差し戻す）**＝**軽レビュー**。

## 目的

**アップデータは `tauri dev` では原理的に検証できない。** dev ビルドは `.app` バンドルでもインストーラでもなく、
自己置換の対象が存在しないためである。ユニットテストで固定できるのは*契約*であって*実挙動*ではない。

よって「実際に配布したインストーラを入れ、アプリ内から次のバージョンへ更新できる」ことを**実機で確定**させる。
特に、この構成に固有の 3 つの未知を潰す。

1. **macOS が未署名**（親 099 の決定）で、`.app` の自己置換が Gatekeeper / ad-hoc 署名を壊さないか。
2. **`externalBin` の sidecar（`comment-sidecar-*`）が更新後も生きているか**。
   壊れると「更新したらコメントビューアだけ死ぬ」という最悪の症状になる。
3. **Windows で「再起動ボタン」に到達するのか**（NSIS インストーラが先にアプリを終了させる可能性）。
   ＋ **eSigner の置換署名が minisign `.sig` を壊していないか**（055a に記録した地雷）。

## 現在の前提（調査結果）

- 配布は public の `satoh23/StreamDock-releases`（親 099）。CI は draft を作り、**publish は手動**。
  **publish した瞬間に全ユーザーへ配信が始まる**（055a で README に明記済み）。
- macOS は **universal `.dmg`・未署名**。sidecar は `lipo` で結合してから **ad-hoc `codesign`** している（`release.yml`）。
- Windows は NSIS `.exe` ＋ WiX `.msi` を生成。**updater が対応するのは NSIS のみ**（MSI は updater 対象外）。
  署名は `secrets.ES_USERNAME` がある時だけ実行される。
- 診断画面の「アプリバージョン」は `Cargo.toml` 由来、updater が比較するのは `tauri.conf.json` の version。
  **055a のバージョン同期ガードが両者の一致を守っている**ので、診断画面の値を更新成功の判定に使える。
- バッジは**常に「1」**（更新の有無であって件数ではない）。チェックは**起動時に自動・トグルなし**。

## 準備

1. **2 本のリリースを用意する**（例 `v0.2.0` → `v0.2.1`）。どちらも **updater 入り**であること。
   - 各タグの前に `docs/release-notes/vX.Y.Z.md` を書く（055a）。**2 本目の内容は 1 本目と明確に違う文面**にする
     （画面に出ているのが本当に新バージョンの説明かを見分けるため）。
   - 両方とも public 側で **publish** する（draft のままだと `releases/latest/download/latest.json` が 404 で updater から見えない）。
2. 検証マシンを 2 台（または VM）用意する: **macOS** と **Windows x64**。
3. **各マシンに `v0.2.0` をインストールしてから始める**（`v0.2.1` は入れない）。
4. 記録用に、更新前の状態を控える:
   - 診断画面の「アプリバージョン」
   - macOS: `codesign -dv --verbose=4 /Applications/StreamDock.app` の出力、
     `ls -l /Applications/StreamDock.app/Contents/Resources/` の sidecar の実行ビット
   - Windows: インストール先のパスと、実行ファイルのデジタル署名タブの内容
5. ⚠ **本番の配信環境で試す行為**なので、2 本目を publish する前に **1 本目のインストーラが手元にある**ことを確認しておく
   （ロールバックは手動再インストールしかない＝親 055 の「やらないこと」）。

---

## E2E（手動）確認チェックリスト

### E2E-1【macOS・前提条件】/Applications に置いてから起動する

- **何を見るか**: **App Translocation**（Gatekeeper Path Randomization）に引っかかっていないか。
  DMG から直接、あるいは `~/Downloads` から起動すると、macOS は**読み取り専用のランダムパス**でアプリを走らせる。
  この状態では**アプリが自分自身を置換できない**＝更新は必ず失敗する。
- **手順**: `.dmg` をマウント → **`/Applications` へドラッグ** → DMG をアンマウント → `/Applications` から起動。
- **期待**: アプリのパスが `/Applications/StreamDock.app` である
  （確認: ターミナルで `ps aux | grep StreamDock` か、アクティビティモニタのプロセス情報）。
- **失敗したら**: ランダムパス（`/private/var/folders/…/AppTranslocation/…`）で走っている。
  **これは更新以前の問題**なので、UI に「/Applications に入れてください」という注記が要るかを 055c/055d へ差し戻して判断する。

### E2E-2【macOS】バッジが出て、更新内容が読める

- **何を見るか**: 055b の検出 → 055c のバッジ・画面表示が、**実際の public リリース**に対して動くか。
- **手順**: `v0.2.0` を起動する（ネット接続あり）。
- **期待**: ヘッダーのベルに**バッジ「1」**が出る。ベルを押すとアップデート画面へ移り、
  **現在 `0.2.0` / 新しい `0.2.1`** と、**`v0.2.1.md` に書いた文面**が表示される
  （055e まで実装済みなら見出し・箇条書きが整形されている）。
- **失敗したら**: 404 なら publish 忘れか `latest.json` の添付漏れ（055a）。
  署名エラーなら公開鍵と秘密鍵の対応が合っていない（055a）。文面が 1 本目のものなら CI の `notes` 流し込みが壊れている（055a）。

### E2E-3【macOS・本タスクの核心その1】更新が完了し、再起動でバージョンが上がる

- **何を見るか**: **未署名 `.app` の自己置換が成立するか**。ここがこの構成で最大の未知。
- **手順**: 「アップデート」ボタンを押す → 進捗が完了するまで待つ → 「再起動」ボタンを押す。
- **期待**: 進捗バーが進み、完了表示になる。再起動後、**診断画面の「アプリバージョン」が `0.2.1`** になっている。
  ベルのバッジが消えている。
- **失敗したら**: 権限エラーなら E2E-1（Translocation）か `/Applications` の書き込み権限。
  署名検証エラーなら `latest.json` の `signature` と実ファイルの不一致（055a の glob / 生成ロジック）。
  **UI が「インストール中」から戻らないなら panic の疑い**（055d の `unwrap`/`expect` 混入・`Mutex` の `.await` 跨ぎ）。

### E2E-4【macOS・本タスクの核心その2】更新後にコメントビューアが開ける

- **何を見るか**: **`externalBin` の sidecar が生き残っているか**。
  `release.yml` は sidecar を `lipo` で結合してから **ad-hoc `codesign`** しており、
  `.app.tar.gz` の展開でこの署名と実行ビットが保たれる保証はない。**壊れると「更新したらコメビュだけ死ぬ」**。
- **手順**: 更新・再起動後に、ツール管理からコメントビューアを起動する。Twitch か YouTube に連携して**実際にコメントを受け取る**。
- **期待**: コメビュ窓が開き、sidecar が起動して WS が繋がり、コメントが流れる。
- **Console / 診断で読み取ること**: sidecar のポート受け渡しが成功しているか。診断/ログ画面にエラーが出ていないか。
- **失敗したら**: `ls -l /Applications/StreamDock.app/Contents/Resources/comment-sidecar-*` で実行ビットを、
  `codesign -v /Applications/StreamDock.app/Contents/Resources/comment-sidecar-*` で署名を確認する。
  **これは 055d ではなく `release.yml` のバンドル手順の問題**なので 055a / 099 へ差し戻す。

### E2E-5【macOS】更新後も Gatekeeper に再ブロックされない

- **何を見るか**: 置換した `.app` に quarantine 属性が付いていないか。付いていれば起動のたびに警告が出る。
- **手順**: 更新・再起動後、いったんアプリを終了して Finder から起動し直す。
- **期待**: 「開発元を確認できません」の警告が**出ない**（初回インストール時に一度回避していれば以後も出ない）。
- **確認**: `xattr -l /Applications/StreamDock.app` に `com.apple.quarantine` が無いこと。
  `codesign -v /Applications/StreamDock.app` の結果を更新前と比べる。
- **失敗したら**: 未署名 macOS 配布と自己更新の相性の問題。**macOS の署名・notarize（[099](099-user-test-package.md) の領分）を
  前倒しする必要があるか**を判断する材料として記録する。

### E2E-6【Windows・本タスクの核心その3】minisign 署名検証が通る

- **何を見るか**: **055a に記録した地雷**——eSigner が tauri ビルド後に `.exe` を `override: true` で置換署名すると、
  バイト列が変わって minisign `.sig` と一致しなくなる。
- **手順**: `v0.2.0`（Windows）を起動 → バッジ → アップデート画面 → 「アップデート」ボタン。
- **期待**: ダウンロードが完了し、**署名検証エラーにならず**インストーラの起動まで進む。
- **失敗したら**: **地雷が発火している**。`bundle.windows.signCommand` へ寄せる移行（055a で決定・[099a](099a-windows-code-signing.md) で実施）が
  未了か不十分。**099a へ差し戻す**。
  ※ `ES_USERNAME` 未設定で未署名のままリリースした場合は、この項目は通るはず（＝署名を入れた瞬間に壊れる、を意味する）。
  その場合も**署名ありのビルドで再検証するまで「通った」と書かない**こと。

### E2E-7【Windows】インストールと再起動の実挙動を確定する

- **何を見るか**: **「再起動」ボタンに到達するのか**。NSIS インストーラが先にアプリを終了させる可能性がある（親 055）。
- **手順**: E2E-6 の続き。インストーラが走るところから、アプリが立ち上がり直すまでを観察する。
- **期待**: どちらでもよいが、**UI の表示が実挙動と一致していること**。
  - アプリが生きたまま完了 → 「再起動」ボタンが出て、押すと再起動する。
  - アプリが終了して自動で立ち上がる → 「インストーラが起動します。完了後に自動で立ち上がります」の案内が出ている。
- **記録すること**: どちらの挙動だったか、管理者昇格（UAC）が出たか、SmartScreen が再度出たか。
- **失敗したら**: 表示と実挙動がズレていれば **055d の UI 分岐を修正**する。
  `installMode` を変えるべきなら **055a の `tauri.conf.json` へ差し戻す**。

### E2E-8【Windows】更新後にバージョンが上がり、コメビュが開ける

- **何を見るか**: E2E-3 / E2E-4 の Windows 版。
- **手順**: 立ち上がり直したアプリで診断画面を見る → コメントビューアを開いて実際にコメントを受け取る。
- **期待**: 「アプリバージョン」が `0.2.1`。コメビュ窓が開き、sidecar が動く。
- **失敗したら**: sidecar が動かないなら NSIS の上書きインストールで `externalBin` が欠けている可能性。
  **099 / 055a へ差し戻す**。

### E2E-8b【Windows】MSI で入れたユーザーに NSIS の `.exe` が配られたときどうなるか

- **何を見るか**: `latest.json` の `windows-x86_64` は **NSIS の `.exe` 1 本だけ**を指している（055a の決定）。
  updater のキー検索は `{os}-{arch}-{installer}` → `{os}-{arch}` の 2 段なので、**MSI（`.msi`）でインストールした
  ユーザーも 2 段目に落ちて NSIS の `.exe` を受け取る**＝更新でインストール形式が入れ替わる（055a のレビュー Q-2）。
- **手順**: `0.2.0` を **`.msi` でインストール**して起動 → 更新を実行 → 完了後に
  「アプリと機能」/「プログラムの追加と削除」の一覧を見る。
- **期待**: 更新自体は成功し、バージョンが `0.2.1` になる。
- **記録すること**: **アンインストールのエントリが 2 つ（MSI 版と NSIS 版）になっていないか**。
  なっていれば「MSI で配ってはいけない」ことが確定するので、`targets` から `msi` を外すか、
  `latest.json` に **`windows-x86_64-nsis` / `windows-x86_64-msi` の 2 キーを併記**する
  （**技術的には両方載せられる**——「1 キー 1 URL」ではない）。
- **失敗したら**: **055a の `make-latest-json.mjs` と 099（配布物の構成）へ差し戻す**。

### E2E-9【両 OS】ネット遮断・最新状態・多重押下で壊れない

- **何を見るか**: 異常系でアプリが固まらないこと（055b/055c/055d の `AppResult` 化と多重実行防止が効いているか）。
- **手順**:
  1. 機内モード（またはネット遮断）で起動する。
  2. 更新済み（`0.2.1`）の状態で起動する。
  3. 「アップデート」ボタンを**連打**する。
  4. インストール中に他の画面へ移動して戻る。
- **期待**:
  1. バッジが出ず、ヘッダーが固まらず、他の機能（ツール起動・コメビュ）に影響が無い。
     アップデート画面を開くと「確認できませんでした」の**定型文言**が出る。
  2. バッジが出ない。画面には「最新版です」。
  3. 2 回目以降が無視される（ボタンが無効化される）。二重インストールが走らない。
  4. アプリが壊れない。
- **Console で読み取ること**: ⚠ **URL・ローカルパス・環境情報がコンソールに出ていないこと**（§9）。
  出てよいのはバイト数・フェーズ・バージョン文字列・成否のみ。**出ていたら 055b/055c/055d へ差し戻す。**
- **失敗したら**: 固まる場合は panic の疑い（055d）。生エラー文字列が出る場合は §9 違反（該当タスクへ差し戻す）。

### E2E-10【両 OS】ダウングレードで誤爆しない

- **何を見るか**: 手元のバージョンが `latest.json` より**新しい**場合に、更新を promote しないこと。
- **手順**: `0.2.1` が入った状態で、public 側の latest を `0.2.0` に戻す（または `0.2.1` の Release を draft に戻す）。
  アプリを再起動する。
- **期待**: バッジが出ない。「最新版です」。**古いバージョンへ更新しようとしない。**
- **失敗したら**: バージョン比較が semver で行われていない可能性。**055b へ差し戻す**。
- **後始末**: 検証後、public 側を元に戻す。

---

## このタスクでやること

- 上記 E2E-1 〜 E2E-10 を macOS / Windows の実機で実行し、**結果（合否・観測値・スクリーンショット相当のメモ）を
  [`docs/progress.md`](../progress.md) に記録する**。
- 不具合が見つかった場合は、**このタスクでは直さず**、上記の「失敗したら」に書いた差し戻し先
  （055a / 055b / 055c / 055d / 099 / 099a）を特定して記録する。
- 実測で確定した事項を該当タスクファイルへ反映する:
  - Windows の実挙動（再起動ボタンに到達するか）→ [055d](055d-update-install-and-restart.md)
  - `installMode` の妥当性 → [055a](055a-updater-release-pipeline.md)
  - macOS の署名・notarize が必要かの判断材料 → [099](099-user-test-package.md)

## このタスクでやらないこと

- **コードの修正**（見つかった不具合は該当タスクへ差し戻す。CLAUDE.md「1 回の作業で複数機能をまとめて実装しない」）。
- macOS の署名・notarize の実施（[099](099-user-test-package.md) の領分。**必要性の判断材料を集めるだけ**）。
- Windows 署名の移行作業（[099a](099a-windows-code-signing.md) の領分）。
- 新しい検証用の仕組み（自動 E2E フレームワーク等）の導入。

## セキュリティ制約（docs/security.md 準拠）

- **コード変更なし**＝外部通信宛先・API・capability・依存はすべて不変（§1/§3/§10）。`csp: null` 不変。
- 検証の記録に **Secrets・秘密鍵・ローカルの絶対パス・ユーザー名を書かない**（§9）。
  progress.md に貼る出力は必要な部分だけに絞り、パスは伏せる。
- 検証で public リリースを一時的に draft に戻す操作（E2E-10）は、**必ず元に戻す**。
  戻し忘れると全ユーザーが更新を受け取れなくなる。

## 完了条件

- E2E-1 〜 E2E-10 のすべてに**合否と観測値**が記録されている（未実施を「合格」にしない）。
- **macOS の 3 つの未知が確定している**: 自己置換が成立するか / sidecar が生き残るか / Gatekeeper が再警告するか。
- **Windows の 2 つの未知が確定している**: minisign 検証が通るか / 「再起動」ボタンに到達するか。
- 不具合があれば差し戻し先が特定され、該当タスクファイルに追記されている。
- 実測で確定した事項（Windows の実挙動・`installMode`）が 055a / 055d に反映されている。
- [`docs/progress.md`](../progress.md) に検証記録が残っている。**リポジトリのコードに差分が無い**。

## 確認コマンド

```bash
# 本タスクはコード変更なし（差分ゼロが期待）
git status --short -- apps/ .github/
git diff --stat

# 前提の確認: public 側に published なリリースが 2 本あるか
gh release list --repo satoh23/StreamDock-releases

# latest.json が実際に取れるか（draft だと 404 になる）
curl -sL https://github.com/satoh23/StreamDock-releases/releases/latest/download/latest.json | head -40

# --- macOS 実機（更新の前後で比較する） ---
codesign -dv --verbose=4 /Applications/StreamDock.app
codesign -v /Applications/StreamDock.app
xattr -l /Applications/StreamDock.app
ls -l /Applications/StreamDock.app/Contents/Resources/ | grep comment-sidecar
lipo -info /Applications/StreamDock.app/Contents/Resources/comment-sidecar-universal-apple-darwin

# --- Windows 実機 ---
# インストール先の .exe を右クリック → プロパティ → デジタル署名 タブを確認（署名の有無・発行者）
# タスクマネージャで comment-sidecar プロセスが立つことを確認
```

## 実装後に必要なレビュー

- 軽レビュー（コード変更なし）: 検証記録に **Secrets・秘密鍵・絶対パス・ユーザー名が混ざっていない**こと（§9）、
  未実施の項目を合格にしていないこと、差し戻し先が具体的なタスク番号で特定されていること、
  E2E-10 で一時的に変更した public リリースの状態が**元に戻っている**ことを確認する。
