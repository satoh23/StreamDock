# 016 Light/Dark Theme + Settings

## 目的

ライトモード / ダークモードを追加する。既定は **PC（OS）の設定に追従**し、さらに**設定画面**で
「システム / ライト / ダーク」を選べるようにする（ユーザー要望 4）。

015 で整備したデザイントークンを土台に、ライト値セットとテーマ切替の仕組みを載せる。

## 現在の前提

- 015 Design Tokens & Color Unification 完了。配色は役割ベースのトークン（`src/styles/theme.css`）に
  集約され、`*.module.css` はトークン参照になっている（ライト値を差し込める状態）。
- 画面遷移は `App.tsx` の `useState<Screen>` による条件レンダリング（ルータ無し）。
  `Screen` は `src/types.ts` に定義（現状 `"main" | "add-tool" | "add-preset" | "diagnostics"`）。
- サイドバー（`src/components/Sidebar.tsx`）に各画面へのナビゲーションボタンがある
  （「🩺 診断 / ログ」= diagnostics が新規画面追加のテンプレート）。
- 独立した設定画面は**まだ存在しない**（diagnostics のみ）。
- MainScreen 編集フッタにプレースホルダボタン「起動間隔を設定」「PC起動時の動作」がある（ハンドラ未接続）。

## このタスクでやること

- 015 のトークンに対し**ライト値セット**を定義する。
  - `:root[data-theme="dark"]` / `:root[data-theme="light"]` で各トークン値を上書きする。
  - `data-theme` 未指定（= システム追従）時は `@media (prefers-color-scheme: light)` /
    `(prefers-color-scheme: dark)` で OS 設定に追従する。
- `Screen` union に `"settings"` を追加（`src/types.ts`）、`App.tsx` に設定画面の描画を追加、
  `Sidebar.tsx` に設定へのナビゲーションを追加する（diagnostics 追加パターンを踏襲）。
- 設定画面に**テーマ選択（システム / ライト / ダーク）**を実装する。
- 選択したテーマ設定を永続化する（localStorage で可。将来 SQLite への移行は本タスク範囲外）。
- ルート要素（`documentElement`）に `data-theme` を反映するロジックを追加する。
  - 「システム」選択時は `data-theme` を外し、`prefers-color-scheme` に委ねる。
  - 「ライト / ダーク」選択時は `data-theme="light" | "dark"` を付与する。
- 初期表示時（アプリ起動時）に、保存済み設定（無ければ「システム」）を反映する。
- docs/progress.md を更新する。

## このタスクでやらないこと

- 019 の「PC起動時にプリセット自動起動」設定（MainScreen フッタの「PC起動時の動作」プレースホルダは
  **019 用に温存**し、本タスクでは触れない）。「起動間隔を設定」プレースホルダも触れない。
- 015 の配色トークン自体の再設計（土台は 015 済み前提。ライト値の追加とスイッチのみ行う）。
- テーマ設定の外部同期・クラウド保存
- 設定画面へのテーマ以外の設定項目の作り込み（テーマ選択に集中する）
- アニメーション付きのテーマトランジション等の作り込み

## テーマ切替の設計方針

- 状態は「システム / ライト / ダーク」の 3 値。既定は「システム」。
- 適用は `documentElement.setAttribute("data-theme", ...)` / `removeAttribute` で行い、CSS は
  `[data-theme=...]` と `@media (prefers-color-scheme)` の両方で成立させる（トグルが両方向で勝つ）。
- 「システム」選択中は OS 設定変更にライブ追従できるとなお良い（`matchMedia` の change 監視は任意）。
- 永続化キーは 1 つ（例: `stream-dock.theme`）。不正値は「システム」にフォールバックする。

## セキュリティ制約（docs/security.md 準拠）

- 外部リソースを読み込まない（§CSP）。外部フォント・CSS・CDN・リモート画像を追加しない。
- 外部通信・telemetry を増やさない。テーマ設定はローカル保存のみ。
- OS 操作・ファイル操作・プロセス操作には触れない（frontend のみ）。

## 完了条件

- 初回起動時、`data-theme` 未設定なら OS 設定（ライト/ダーク）に応じた配色になる
- 設定画面で「システム / ライト / ダーク」を選べ、選択が即時反映される
- 選択がアプリ再起動後も保持される（永続化されている）
- 「システム」選択時は OS 設定に追従する
- ライト・ダーク双方で、全画面（メイン / ツール追加 / プリセット追加 / 診断 / 設定 / サイドバー /
  プレビュー）が視覚的に破綻しない
- サイドバーから設定画面へ遷移できる
- MainScreen の「PC起動時の動作」「起動間隔を設定」プレースホルダを本タスクで実装していない
- 新しいライブラリを追加していない / 外部リソースを読み込んでいない
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る
- docs/progress.md が更新されている

## 確認コマンド

```bash
git diff --stat
git diff --name-only
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev
```
