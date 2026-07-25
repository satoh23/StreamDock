---
name: write-tests
description: stream-dockのテスト（単体・コンポーネント）を、仕様ベースで作成・実行する
---

# write-tests

## 目的

stream-dock の実装に対して、**「仕様としてこうあるべき」** を検証するテストを作成・実行する。
新しいテストを書くよう指示されたときにこの skill を読み、下記のルール・置き場所・手順に従う。

## 最優先ルール（絶対）

- **テストケースは「仕様としてこうあるべき」を最優先で作成する。**
  タスクファイル（`docs/tasks/*`）・`docs/security.md`・親設計に書かれた「あるべき挙動」を根拠にケースを起こす。
- **テストを通すためのテストケースは作らない。**
  実装の現状に合わせてアサーションを緩めたり、たまたま通る値を書いたりしない。
  実装がバグっているなら、テストは **落ちるのが正しい**（＝仕様どおりに直す対象を示す）。
- 実装の内部都合（CSS クラス名・内部 state 名・呼び出し順の偶然）に依存したアサーションはしない。
  ユーザーから見える振る舞い（表示テキスト・role・呼ばれる command と引数・有効/無効）で表明する。
- 迷ったら「この挙動は仕様上どうあるべきか？」に戻る。仕様が曖昧なら、**推測でテストを書かず先に確認する**。

## 参照するもの

テスト対象の仕様を、必ず先に読む。

- 対象タスクファイル（`docs/tasks/<id>-*.md`）＝やること/やらないこと/完了条件が仕様の正。
- `docs/security.md`＝セキュリティ不変条件（外部通信ゼロ／機密を出さない／破壊的操作は確認必須 等）。
- `docs/progress.md` の該当節＝決定事項・申し送り。
- 対象の実装ファイルと、その公開 I/F（props・command ラッパ・DTO）。

## ケースの起こし方（仕様ベースの網羅）

各対象について、少なくとも次を検討する。

- **正常系**: 代表的な入力で期待どおりの表示/呼び出しになる。
- **境界**: 0 件 / 1 件 / 空文字 / 0 値 / null・undefined / 最大。
- **異常系・劣化**: 未知の種別・不正な値でも **壊れず劣化**する（原文フォールバック・ラベル無し・"-" 等）。
- **破壊的操作**: 削除などは **必ず確認 UI を経由**し、確定後にのみ command が呼ばれる（未確認では呼ばれない）。
- **セキュリティ不変条件**: 外部通信/OS 操作は行わない（invoke は全てモック）。失敗時に本文・機密を画面/ログに出さない。
- **回帰**: 過去に混入したバグは、そのバグが再発したら落ちるテストを残す（例: `ConfirmDialog` の showModal 回帰）。

## 置き場所・書き方（このリポジトリ）

### frontend（apps/desktop）＝ vitest + Testing Library + jsdom

- 純ロジック（表示整形など）→ 依存ゼロの純 module に切り出し `*.test.ts`。
- React コンポーネント/状態機械 → `*.test.tsx`。DOM は jsdom、操作は Testing Library（`getByRole`/`findByText` 等）。
- **invoke ラッパ（Tauri command）は必ず `vi.mock` する**（テストは端末外通信も OS 操作もしない）。
- テスト用グローバルは使わず、`import { describe, it, expect, vi } from "vitest"` と明示 import する（lint 対応）。
- 設定: `apps/desktop/vitest.config.ts`（jsdom）／セットアップ: `apps/desktop/src/test/setup.ts`
  （jest-dom マッチャ登録・`<dialog>` の showModal 等 jsdom 未実装 API のポリフィル）。
- jsdom で再現しきれない実挙動（`<dialog>` の focus trap/backdrop/Esc、webview 固有）は **E2E（手動）** で確認する。

### sidecar（apps/comment-sidecar）＝ フレームワーク無しの純 Node

- 既存イディオムに倣う: `scripts/test-*.mjs` が tsc 出力（`dist/`）を import して PASS/FAIL を表明
  （例: `scripts/test-host-guard.mjs`）。テストフレームワークは足さない。

### 依存の追加

- 新規ライブラリ（テストフレームワーク含む）を足すときは **理由を説明し、承認を得てから**入れる（`docs/security.md` §10）。
  テスト専用は devDependencies に限定し、shell/fs/network/telemetry 系の実行時依存は増やさない。

## 手順

1. 対象の仕様（上記「参照するもの」）を読み、「あるべき挙動」を箇条書きにする。
2. その箇条書きから正常/境界/異常/破壊的/セキュリティ/回帰のケースを起こす。
3. テストを書く（仕様ベース。実装に合わせて緩めない）。
4. 実行して確認する（下記コマンド）。落ちたら **実装 or 仕様** のどちらが正か判断する
   （テストを通すためにアサーションを歪めない）。
5. `typecheck` / `lint` も通す。

## 検証コマンド

- `pnpm --filter ./apps/desktop test`（vitest 一括・CI モード）
- `pnpm --filter ./apps/desktop test:watch`（監視）
- `pnpm --filter ./apps/desktop typecheck`
- `pnpm --filter ./apps/desktop lint`

## 出力

- 追加/変更したテストファイルと、各テストが検証している **仕様**（何が「あるべき」か）を簡潔に報告する。
- 仕様と実装が食い違って落ちた場合は、テストを歪めず、その食い違いを指摘する。
