# 026 Header Polish & Navigation Foundation

## 目的

020 で新設した共通ヘッダーを、見た目と導線の両面で整える。

- 右側アイコンを、背景色無しのフラットな白アイコンにし、ホバー等のエフェクトを無くす。うっすら見える枠を
  消し、アイコンを大きくして視認性を上げる。
- ヘッダーからメイン画面へ戻れるリンクを追加する。
- 今後、ツール管理以外の配信周り機能（OBS エフェクト反映 / おすすめツールまとめ・ワンクリック DL /
  棒読みちゃん × VOICEVOX 連携 等）をヘッダーから大別して切り替える想定の**導線の土台**を用意する。

## 現在の前提

- 画面遷移は React Router を使わず `App.tsx` の `useState<Screen>`
  （`Screen = "main" | "add-tool" | "add-preset" | "diagnostics" | "settings"`, `apps/desktop/src/types.ts`）。
  `handleNavigate` を `onNavigate` として各画面へ渡す。
- ヘッダーは `apps/desktop/src/components/Header.tsx` ＋ `apps/desktop/src/components/Header.module.css`。
  - 右側 `<nav className={styles.nav}>`（Header.tsx 34 行）に 🩺 診断（35-42 行, `onNavigate("diagnostics")`）と
    ⚙ 設定（43-50 行, `onNavigate("settings")`）。Windows のみ min/max/close コントロール（51-95 行）。
  - `.navBtn`（`Header.module.css` 50-60 行）は `width/height: 36px`・`border-radius: 10px`・
    `background: var(--btn-ghost-bg)`（≒テキスト 6% の半透明 = **薄い枠に見える正体**）・`font-size: 16px`。
    `.navBtn:hover`（62-64 行）で `--control-bg-hover`、`.navBtn.active`（67-70 行）で `surface` チップ。
  - ヘッダー背景 `.header` は `var(--primary)`（9 行）、高さ 65px。
  - 左のロゴ（29-33 行, `img /icon.png` ＋「StreamDock」ワードマーク）は**クリック不可**
    （`data-tauri-drag-region` のみでウィンドウドラッグ用）。メイン画面へ戻る導線はヘッダーに無い。
  - `activeNav` の型は `Extract<Screen, "diagnostics" | "settings">`（Header.tsx 22 行）。`App.tsx` は
    diagnostics / settings のときのみ導出して渡す。
- 020 の方針: ヘッダーは「今後プリセット/ツール管理**以外**の追加機能はヘッダーから遷移する想定で、その土台」。

## このタスクでやること

### (1) 右アイコンのフラット白アイコン化

- `Header.module.css .navBtn` の `background`（薄枠の正体）を撤去し、**背景無し**にする。アイコン色を白系
  （`--primary` ヘッダー上で見やすい前景）にする。
- `.navBtn:hover` の背景変化・`.navBtn.active` の surface チップなど、ホバー/アクティブのエフェクトを無くす
  （active はエフェクト無しか、色の濃淡程度に留める）。うっすら見える枠を完全に消す。
- アイコンサイズ（現状 `36px` / `font-size: 16px`）を拡大し、視認性を上げる。タップ領域が破綻しない範囲で調整。

### (2) メイン画面リンクの追加

- ヘッダー左のロゴ（`img` ＋ワードマーク, 29-33 行）を押すとメイン画面へ戻れるようにする
  （`onNavigate("main")`）。`data-tauri-drag-region` によるウィンドウドラッグと両立するよう配慮する
  （ドラッグ領域とクリック可能領域の切り分け、またはロゴを明示的なボタン/ホームアイコンにする）。
- 必要に応じて `activeNav` の型（現状 `"diagnostics" | "settings"`）と `App.tsx` の導出を拡張し、メインが
  アクティブなときの表現を整合させる。

### (3) 今後の機能大別への導線土台

- ツール管理以外の配信機能（OBS エフェクト反映 / おすすめツールまとめ・ワンクリック DL /
  棒読みちゃん × VOICEVOX 連携 等）をヘッダーから大別して切り替える想定の**導線構造**を用意する
  （例: ヘッダー中央/左のセクション切替スロット。当面はツール管理のみが有効で、他は placeholder / 無効表示）。
- 020 の「ヘッダーは土台」の方針の延長とし、**構造の土台まで**をこのタスクの範囲とする。

## このタスクでやらないこと

- ヘッダーから遷移する**新規機能画面そのもの**の実装（OBS 連携・おすすめツール・読み上げ連携等は各別タスク）。
- 実際の機能を伴う `Screen` 追加（追加するとしても placeholder 導線のための最小限に留め、実画面は作らない）。
- ウィンドウのネイティブ枠のカスタム化（カスタムタイトルバー・信号機ボタン移動）／Windows コントロールの挙動変更。
- サイドバーやプリセット/ツール管理の導線変更。
- 配色トークンの大規模変更（021 の範囲。ここではヘッダーのアイコン表現に限定）。

## セキュリティ制約（docs/security.md 準拠）

- frontend のみの変更。OS 操作・ファイル操作・プロセス操作を追加しない（§2 / §4）。
- 外部リソース（外部フォント・CSS・CDN・リモート画像）を読み込まない。アイコンは同梱アセット or
  インライン SVG / 絵文字に限る（§CSP）。
- 外部通信・telemetry を増やさない（§1）。

## 完了条件

- ヘッダー右のアイコンが背景無しの白アイコンになり、ホバー/アクティブのエフェクトとうっすら見える枠が消えている
- アイコンが以前より大きく、視認しやすい
- ヘッダーからメイン画面へ戻れる（ロゴ or ホームアイコン、ウィンドウドラッグと両立）
- 今後の機能大別をヘッダーから切り替える導線の土台が用意されている（実機能画面は未実装で可）
- 各画面でヘッダーが常時表示され、レイアウトが破綻していない（sidebar 有/無の両方）
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
