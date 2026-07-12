# 027 First-Run Tutorial (Onboarding)

## 目的

ツール管理まわりがほぼ動く状態になったので、初見ユーザーに「ツールを登録 → 配信プリセットを作成 →
一括起動」というコア導線を体験で伝える。**初回起動時のみ**、薄暗いオーバーレイ＋スポットライトで
16 ステップのガイドツアーを表示し、実際のツール/プリセットを 1 つ作らせながら使い方を習得させる。

frontend のみで完結させ、OS/プロセス/ファイル操作・外部通信・新規依存を増やさない（Rust 変更なし）。
既存挙動は変えない方針とし、唯一の例外＝チュートリアル中のキャンセルボタン無効化のみとする。

## 現在の前提（調査結果）

- 画面遷移は React Router 不使用。`apps/desktop/src/App.tsx` の `useState<Screen>` で切替、props でバケツリレー。
  `Screen = "main" | "add-tool" | "add-preset" | "diagnostics" | "settings" | "rakuraku-tools" | "obs-effects"`。
- 状態管理ライブラリなし（React 標準フックのみ）。グローバルストア無し。
- オーバーレイ/モーダル/スクリム実装は皆無（確認ダイアログは OS ネイティブ `ask()`）。→ スポットライト UI は新規実装。
- 要素識別子（id / data-testid）は皆無。CSS Modules のクラス名はハッシュ化され不安定。
  → ハイライト対象へ `data-tutorial-id` 目印属性を新規付与する必要がある。
- 永続化の先例＝`apps/desktop/src/features/theme/theme.ts`（localStorage を直接 read/write、例外は握りつぶし）。
- `import.meta.env` 未使用・`.env*` 無し。root `.gitignore` に `*.local` があり `.env.local` は ignore 対象。
- `apps/desktop/src/components/primitives.tsx` の `Button` は `...rest` を透過（`disabled` / `data-*` を props で
  そのまま渡せる → Button 自体の改修はほぼ不要）。
- ヘッダーセクションは `apps/desktop/src/components/headerSections.ts` の単一ソース。3 セクション中 2 つ
  （らくらくツール導入 / OBSエフェクト）は `implemented: false` の「準備中」ダミー。

## 決定事項（仕様確定）

- 完了/スキップ状態は **localStorage**（`theme.ts` と同方式、frontend のみ）。SQLite/Rust は触らない。
- ヘッダー巡回では未実装セクションへは**遷移せず**、その場で「今後こういう機能が入る」と一言添える。
- **中断時**: チュートリアル開始時点で完了フラグを立てる → 途中で閉じても再表示しない
  （＝「閉じたら完了扱い」を最小実装で満たす。ステップ保存・再開ロジックは作らない）。
- 開発時の表示切替は **`.env.local` の `VITE_` 変数のみ**（`VITE_SHOW_TUTORIAL=true` で完了フラグを無視し毎起動表示）。

## このタスクでやること

### (1) チュートリアル状態（新規 feature）

`apps/desktop/src/features/tutorial/` を新設。

- `tutorialStorage.ts` — `theme.ts` を踏襲。キー `stream-dock.tutorial.completed`。
  `isTutorialCompleted()` / `markTutorialCompleted()`（try/catch で握りつぶし）。
- `tutorialSteps.ts` — 16 ステップの静的定義配列。各ステップ = `{ id, mode, targetId?, copy, advanceOn }`。
  - `mode`: `"dialog"`（中央・全面ディム・「次へ」）/ `"spotlight-info"`（対象を穴あきで明るく＋吹き出し＋「次へ」、
    対象クリック不可）/ `"spotlight-action"`（対象を明るく＋クリック可、ボタン非表示、対象操作で進む）。
  - `advanceOn`: `"next-button"` / `"target-click"` / 状態条件（`screen` 一致 / `tools.length` 増 / `presets.length` 増）。
- `TutorialProvider.tsx` + `useTutorial.ts` — 薄い Context。`currentStep`・`active`・`advance()`・`skip()`・
  `isCancelLockedByTutorial()` を提供。初回判定＝`!isTutorialCompleted()`（or env 強制表示）で `active=true`、
  **開始時に `markTutorialCompleted()`**（中断=完了扱い。env 強制表示時のみフラグを書かず毎回表示）。
  状態条件 advance は App から渡す `screen`・`tools.length`・`presets.length` を監視する `useEffect` に集約
  （各画面のハンドラは書き換えない＝非破壊）。
- env 強制表示: `import.meta.env.VITE_SHOW_TUTORIAL === "true"`。型は `apps/desktop/src/vite-env.d.ts` に
  `interface ImportMetaEnv { readonly VITE_SHOW_TUTORIAL?: string }` を追加。`.env.local.example` を用意して変数を明記。

### (2) オーバーレイ描画（新規コンポーネント）

`apps/desktop/src/components/tutorial/`。

- `TutorialOverlay.tsx` — `#root` へ `createPortal`。対象は `document.querySelector('[data-tutorial-id="..."]')` を
  `getBoundingClientRect()` で計測。**穴あきディムは上下左右 4 枚のサイドパネル方式**（各 div は `pointer-events:auto`
  でディム＋外側クリック遮断、穴の領域だけ何も置かず対象がネイティブにクリックを受ける）。`spotlight-info` は
  穴にも透明ブロッカーを重ねてクリック不可にする。再計測は `resize`/`scroll`＋`ResizeObserver`＋step 変化で
  `requestAnimationFrame`。吹き出し（copy＋必要時「次へ」）、クリック可ステップに指/矢印インジケータ、
  常時右下に「チュートリアルをスキップ」ボタン。`target-click` は対象クリックをキャプチャして `advance()`。
- `TutorialOverlay.module.css` — ディム色・z-index・吹き出し・インジケータ（既存 z-index 規約が無いため新規定義）。

### (3) 目印属性の付与（既存ファイルへ加算的・挙動不変）

対象要素へ `data-tutorial-id="<id>"` を付与（Button は `...rest` 透過で props 渡し可）。

- `Header.tsx` — 各ヘッダーセクション項目（`headerSections.ts` の id 単位）。
- `Sidebar.tsx` — 「＋ ツールを登録」「＋ プリセットを追加」ボタン。
- `screens/add-tool/AddToolScreen.tsx` — 種別トグル・アプリ選択エリア・保存して追加。
  加えてキャンセルボタンに `disabled={isCancelLockedByTutorial()}`（**唯一の挙動変更点**）。
- `screens/add-preset/AddPresetScreen.tsx` — ツール選択リスト・「次へ」・並行トグル/起動リスト・「保存して作成」。
  キャンセルボタンに同様の `disabled`。
- `screens/main/MainScreen.tsx` — 右上の一括起動ボタン（任意でツール行）。

### (4) App への配線

`apps/desktop/src/App.tsx`：ツリーを `TutorialProvider` でラップし、`Window` と同階層に `TutorialOverlay` を描画。
Provider に `screen`・`tools.length`・`presets.length` を渡し、状態条件 advance の監視元にする（既存ハンドラは不変）。

## ステップ → 進行方式（16 ステップ）

1. `dialog`「StreamDockへようこそ！」（次へ）。
2. `dialog`「配信者向けのツール利用をサポートするアプリです」（次へ）。
3. ヘッダー各セクションを `spotlight-info` で順に説明（次へ。遷移せず、準備中2つは「今後こういう機能が入る」と補足）。
   ※任意で 診断/設定 アイコンにも触れる。
4. ツール管理を `spotlight-action`（クリックでツール管理チュートリアルへ。コピーは実態に合わせ調整）。
5. サイドバー「ツールを登録」`spotlight-action` → `screen==="add-tool"` で進む。
6. 種別トグル等を `spotlight-info`（デスクトップアプリの他に URL からブラウザツールを登録できる旨。クリック不可・次へ）。
7. アプリ選択エリアを `spotlight-action`＋キャンセル無効化。ツール作成後 `screen==="main" && tools.length` 増で進む。
8. `dialog`（成功＋プリセット追加を促す）→ サイドバー「プリセットを追加」`spotlight-action` → `screen==="add-preset"`。
9. プリセット画面の説明 `spotlight-info`（複数登録・個別/一括/自動起動・サイドバーから編集可）。
10. フォーム操作可＋キャンセル無効化。Step1 の「次へ」`target-click` で進む。
11. 起動設定（Step2）の説明 `spotlight-info`（並行/番号/並び替え）。
12. 「保存して作成」`spotlight-action` → `screen==="main" && presets.length` 増で進む。
13. `dialog`（個別起動・右上の一括起動/停止の説明）。
14. 右上「一括起動」`spotlight-action`（`target-click` で進む＝クリックが実起動を兼ねる。MainScreen は不変）。
15. `dialog`（一括起動できました／同ボタンで停止も）。
16. `dialog`（完了。フラグは開始時に立て済み）。

## このタスクでやらないこと

- Rust / SQLite / Tauri コマンド・capabilities・CSP の変更。
- ステップ途中保存・再開ロジック（中断＝完了扱いで済ませる）。
- 設定画面の「もう一度見る」リセットボタン。
- キャンセル無効化以外の既存挙動変更・大規模リファクタ。
- 未実装ヘッダーセクション（らくらく/OBS）の実画面実装。

## セキュリティ制約（docs/security.md 準拠）

- frontend のみの変更。OS 操作・ファイル操作・プロセス操作を追加しない（§2 / §4）。Rust / capabilities 不変。
- 外部リソース（外部フォント・CSS・CDN・リモート画像）を読み込まない。インジケータは絵文字 / インライン SVG に限る（§CSP）。
- 外部通信・telemetry を増やさない（§1）。localStorage はローカルのみ（テーマ設定と同方針）。
- 新しい npm / crate / plugin を追加しない（§10）。

## 完了条件

- 初回起動時（localStorage 未設定 or `VITE_SHOW_TUTORIAL=true`）に 16 ステップのツアーが表示される
- 実ツール1件＋実プリセット1件が作られ、一括起動まで到達できる
- スポットライトの穴がウィンドウリサイズ・スクロール時に対象へ追従する
- ステップ 7 / 10 でキャンセルボタンが無効（クリック不可）になっている
- 右下「チュートリアルをスキップ」で即終了でき、以降再表示されない
- 完了フラグ済み（env 強制表示なし）では何も表示されない
- 新しいライブラリを追加していない / 外部リソースを読み込んでいない / Rust・CSP 不変
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る
- docs/progress.md が更新されている

## 確認コマンド

```bash
git diff --stat
git diff --name-only
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
# .env.local に VITE_SHOW_TUTORIAL=true を置いて起動し 16 ステップを踏破
pnpm --filter ./apps/desktop tauri dev
```
