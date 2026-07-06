---
name: security-review
description: stream-dockの変更差分について、docs/security.mdに基づきセキュリティレビューを行う
---

---

# security-review

## 目的

stream-dockの実装差分について、ユーザーのPCを壊さないこと、意図しないOS操作・ファイル操作・外部通信がないことを確認する。

## 参照するファイル

必ず以下を読む。

- docs/security.md
- docs/architecture.md
- docs/progress.md
- 今回のタスクファイル
- 変更された主要ファイル

## レビュー観点

### 外部通信

- 外部API通信を追加していないか
- telemetry / analytics / crash report送信を追加していないか
- CDNや外部script/css/imageを読み込んでいないか
- remote configやcloud syncを追加していないか

### Tauri / Rust

- frontendから直接shell実行できる設計になっていないか
- 汎用的な `run_command` や `execute_shell` のようなcommandを追加していないか
- Tauri commandが強すぎないか
- commandの引数をRust側で検証しているか
- service / repository / commandの責務が分かれているか

### Capabilities / Permissions

- capabilitiesに不要なpermissionを追加していないか
- shell pluginやfilesystem pluginに広すぎる権限を与えていないか
- 使っていないplugin権限が残っていないか
- scopeが必要以上に広くないか

### ファイル操作

- 任意パスへの書き込みを許していないか
- 任意パスの削除を許していないか
- アプリ管理領域外のファイルを勝手に変更していないか
- ユーザーの設定ファイルを勝手に上書きしていないか

### プロセス操作

- ユーザー入力をそのままコマンド実行していないか
- shell経由でコマンドを実行していないか
- processNameだけでkillする設計になっていないか
- stream-dock経由で起動していないプロセスを停止する設計になっていないか

### 入力検証

- frontendだけでなくRust側でも入力検証しているか
- 空文字、重複、不正な値を防いでいるか
- IDやpathを信用しすぎていないか

### ログ

- 機密情報や過剰な個人情報をログに出していないか
- ログを外部送信していないか

## 出力形式

以下の形式で出力する。

1. 総合判定
   - 問題なし
   - 軽微な懸念あり
   - 修正必須
   - 危険

2. 修正必須項目

3. 後回しでよい改善項目

4. 良かった点

5. 次に確認すべきファイル・コマンド

## 重要ルール

- レビューでは原則コード変更しない
- 修正が必要な場合は、まず修正方針だけ提示する
- 危険な実装を見つけた場合は、はっきり指摘する
