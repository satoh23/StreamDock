---
name: implement-feature
description: docs/tasks の仕様をもとに、1機能だけを計画・実装・検証する
---

# implement-feature

## 手順

1. 指定された docs/tasks/\*.md を読む
2. 関連ファイルを最小限だけ調査する
3. 実装前に変更対象ファイルと方針を提示する
4. ユーザーが「実装して」と言うまでコード変更しない
5. 実装する
6. typecheck / lint / cargo check を実行する
7. 変更内容と未完了事項を docs/progress.md に追記する

## 制約

- 1回に1機能だけ実装する
- 仕様にないリファクタリングをしない
- 新規ライブラリ追加は事前確認する
- 大きなファイルは全文読む前に search / grep で該当箇所を探す
