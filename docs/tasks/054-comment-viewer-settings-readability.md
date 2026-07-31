# 054 内蔵コメビュ設定画面の可読性修正（ラベル／説明の階層統一）

> 状態: **未着手**。実機フィードバック起点の単独タスク（親設計なし）。
>
> **必読前提**: 設定画面 [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、
> コメビュ配下の共有 CSS [`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css)、
> トグル [`ToggleSwitch.tsx`](../../apps/desktop/src/screens/comment-viewer/ToggleSwitch.tsx)、
> 役割トークン [`theme.css`](../../apps/desktop/src/styles/theme.css)、
> **お手本になる既存実装** [`formLayout.module.css`](../../apps/desktop/src/screens/formLayout.module.css) と
> [`SettingsScreen.module.css`](../../apps/desktop/src/screens/settings/SettingsScreen.module.css)、
> CSS ガード [`check-css-guards.mjs`](../../apps/desktop/scripts/check-css-guards.mjs)、
> [`docs/security.md`](../security.md)（§1/§10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **frontend の見た目のみ（CSS ＋ className の付け替え）**＝**軽レビュー**。
>
> ⚠ **行番号は書かない**（起票時の値はすぐ古くなる。特定は**クラス名・シンボル名で**行うこと）。
>
> ⚠ **055c が新しい画面（アップデート画面）を 1 枚作る前に、本タスクで階層規則を確定させること。**
> 規則が無いまま新画面を作ると、アプリ内に**3 つ目の流儀**が生まれる。これが本タスクを 054＝最初に置いた理由。

## 目的

内蔵コメントビューアの設定画面が**非常に見づらい**。「読み上げの文字数上限」「話者」「読み上げ話者」などの
**設定項目名が、補助説明文とまったく同じ見た目**（同じサイズ・同じ淡色・同じ太さ）で描かれており、
どこが項目名でどこが説明なのか読み取れない。一方でトグルのラベルだけは太い濃色になっているため、
**同じカードの中に「設定項目名」の書式が 2 種類混在**している。

**設定項目名は太字・濃色**、**補助説明は細字・中間色**という規則を確定し、画面全体をそれに揃える。
規則は既にアプリ本体側で確立しているものを流用し、新しい流儀を発明しない。

## 現在の前提（調査結果・実コード）

### 問題の実体（`CommentViewerApp.module.css` の 3 クラス）

| クラス | 現状の宣言 | 実際の役割 |
| --- | --- | --- |
| `.speakerField` | `font-size: 11px` / `color: var(--text-faint)` / **`font-weight` 指定なし＝400** | 設定項目名（文字数上限・話者・スタイル・フォント） |
| `.note` | `font-size: 11px` / `color: var(--text-faint)` | 補助説明文 |
| `.toggleLabel` | `font-size: 13px` / `font-weight: 700` / `color: var(--text)` | トグルの設定項目名 |

- **`.speakerField` と `.note` は指定が完全に同一**（11px・`--text-faint`・weight 400）。
  ＝「読み上げの文字数上限」というラベルと、その直下の説明文が**視覚的に一切区別できない**。
- `--text-faint` は `theme.css` で `color-mix(in srgb, var(--color-text-muted) 72%, transparent)`＝
  `--muted` をさらに 72% まで薄めた色で、**本文用ではなく無効状態・プレースホルダ用の濃度**。
  実際、同じ CSS モジュール内で `.btn:disabled` / `.btnGhost:disabled` / `.dangerBtn:disabled` が
  この同じトークンを使っている（＝「押せない」を意味する色をラベルに使っている状態）。
- `.toggleLabel` だけが 13px/700/`--text`。**同じカード内で項目名の階層が 2 系統**になっている。
- 「固定コメントをOBSに表示」カードは `.note` が **5 連続**で並ぶため、淡色 11px の文章壁になっている。

### `.speakerField` は「レイアウト」と「タイポグラフィ」を兼務してしまっている

```css
.speakerField {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;          /* ← タイポグラフィ（本タスクで剥がす） */
  color: var(--text-faint); /* ← タイポグラフィ（本タスクで剥がす） */
}
```

`SettingsView.tsx` では `<label className={styles.speakerField}>ラベル文字列<Select …/></label>` という形で、
**ラベル文字列が直下のテキストノード**として置かれ、コントロールと縦積みになっている。
つまり `.speakerField` は**縦積みコンテナ兼ラベル書式**という二役で、ラベルだけに書式を当てる術がない。

`SettingsView.tsx` での `.speakerField` の使用は **5 箇所**:
読み上げの文字数上限 / 話者 / スタイル / フォント / OBS パスワード欄（ここだけ `<div>` でラベル文字列を持たない）。

### お手本（既に整っている既存実装）

`formLayout.module.css`（`AddToolScreen` / `AddPresetScreen` / `SettingsScreen` が共有）:

```css
.field label   { display:block; margin-bottom:7px; color: var(--text);  font-size:12px; font-weight:800; }
.fieldHelp     { margin-top:6px;                   color: var(--muted); font-size:11px; line-height:1.5; }
.field input::placeholder { color: var(--text-faint); }   /* ← faint はプレースホルダ用 */
```

`SettingsScreen.module.css`:

```css
.optionLabel { font-size:14px; font-weight:800; }
.optionDesc  { color: var(--muted); font-size:12px; line-height:1.4; }
```

**どちらも「項目名＝`--text` × 太字」「説明＝`--muted` × 標準」で、`--text-faint` は使っていない。**

### `.note` の使用箇所（実測）

`styles.note` の参照は `SettingsView.tsx` に **16 箇所**、
[`ViewerDetailPanel.tsx`](../../apps/desktop/src/screens/comment-viewer/ViewerDetailPanel.tsx) に **1 箇所**、
[`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) に **1 箇所**。
後 2 者も同じ「補助説明」の役割なので、**同じ規則が当たるのは意図どおり**（除外しない）。
`ComingSoonScreen.module.css` にも `.note` があるが**別 CSS モジュール**なので本タスクの対象外。

### CSS ガードが必要な理由（051 のガード (5) と同じ穴）

`check-css-guards.mjs` の (5) に記録済みのとおり、**CSS モジュールは vitest 上で存在しないキーでも文字列を返す**
（実測: `styles.nonExistentKey` → `"_nonExistentKey_<hash>"`）。よって
「新クラスを付けたが CSS 側にルールが無い／クラス名を打ち間違えた」状態は**コンポーネントのテストでは緑のまま通る**。
色・太さも jsdom では解決されないため、**規則の実在は CSS 原文の静的検査でしか守れない**。

## このタスクでやること

### (1) 役割 3 段のタイポグラフィ規則を確定する

`CommentViewerApp.module.css` の先頭付近に、規則をコメントで明文化したうえで下記に揃える。

| 役割 | 色 | サイズ | 太さ |
| --- | --- | --- | --- |
| **設定項目名**（ラベル・トグル label） | `var(--text)` | 13px | **700** |
| **補助説明**（`.note`） | `var(--muted)` | 12px | 400（`line-height` を付ける） |
| 無効・プレースホルダ | `var(--text-faint)` | ― | ― |

- **`.toggleLabel` の値は変えない**（13px/700/`--text` のまま）。理由: `ToggleSwitch` は設定画面だけでなく
  **本体コメントビューのツールバーのトグルでも使われる**ため、値を動かすと設定画面以外にも波及する。
  新設するラベルクラスを**こちらに合わせる**方向で統一する。
- `--text-faint` の用途を「**無効状態・プレースホルダ専用**」に限定する旨を CSS コメントに書く。
  既存の `.btn:disabled` / `.btnGhost:disabled` / `.dangerBtn:disabled` の `--text-faint` は**そのまま残す**（正しい用法）。
- **`.fontPreviewLabel` / `.obsPasswordHelp` / `.pastTime` の `--text-faint` も見直す**。
  - `.fontPreviewLabel`（「プレビュー」の小見出し）と `.obsPasswordHelp`（パスワード取得方法の details）は
    **設定画面内の可読テキスト**なので `--muted` へ寄せる。
  - `.pastTime`（視聴者詳細の過去コメント時刻）は設定画面外のメタ情報なので**据え置く**。

### (2) `.speakerField` からタイポグラフィを剥がし、`.fieldLabel` を新設する

- `.speakerField` は `display/flex-direction/gap` **のみ**のレイアウトクラスに戻す。
- 新クラス `.fieldLabel`（`font-size:13px; font-weight:700; color:var(--text);`）を追加する。
- `SettingsView.tsx` の該当箇所で、ラベル文字列を `<span className={styles.fieldLabel}>…</span>` で包む。
  対象は **ラベル文字列を持つ 4 箇所**（読み上げの文字数上限 / 話者 / スタイル / フォント）。
  OBS パスワード欄の `.speakerField` はラベル文字列を持たない `<div>` なので**そのまま**（レイアウト用途のみ）。
- ⚠ `<label>` 直下のテキストノードを `<span>` で包むだけなので、**`<label>` とコントロールの関連付けは変わらない**
  （既存どおり `<label>` が子の `<select>`/`<input>` を包む暗黙ラベル）。`htmlFor`/`id` は導入しない。

### (3) `.note` を補助説明の書式へ

- `.note` を `color: var(--muted)` / `font-size: 12px` / `line-height: 1.5` にする。
- 「固定コメントをOBSに表示」カードの `.note` 5 連続は、**この書式変更だけで**読みやすくする
  （文章の要約・分割・削除はしない＝(4) 参照）。

### (4) CSS ガード (6) を追加する

`check-css-guards.mjs` に、既存 (1)〜(5) と同じ作法（`read()` でコメント除去 → `ruleBody()` → `hasDecl()` → `fail()`）で追加する。

- `.fieldLabel` のルールが実在し、`font-weight` と `color` が **`.toggleLabel` と一致**すること
  （＝「設定項目名は 1 種類の書式」を値の重複ではなく検査で担保する）。
- `.note` が `--text-faint` を**使っていない**こと（＝無効色をラベル/説明に戻す退行を止める）。
- fail メッセージには「CSS モジュールは存在しないキーでも文字列を返すため、コンポーネントのテストでは検出できない」
  という理由を (5) と同じ調子で書く。

## このタスクでやらないこと

- **可視文言の書き換え**（`.note` の文章の要約・分割・削除を含む）。カードの再構成・カードの追加・並べ替え。
- `.cardHead`（カード見出し）の書式変更。「**見出しとコントロール名が同一文字列**」問題（045b レビューの既知課題）の解消。
- `ToggleSwitch` / `Select` のマークアップ変更。`formLayout.module.css` をコメビュ側から import する形への統合
  （コメビュは別ウィンドウ・別 CSS 集約という既存構造を崩さない）。
- 設定項目の追加・削除・挙動変更（`commitMaxLength` などのロジックは一切触らない）。
- **新規外部通信・API・capability・依存の追加**。Rust / sidecar の変更。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の見た目のみ**（CSS 宣言と `className` の付け替え）。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 色は**必ず役割トークン経由**で参照し、`*.module.css` に生 hex/rgba を残さない（`theme.css` 冒頭の明文規約）。
  新設する `.fieldLabel` も `var(--text)` のみを使う。
- ログ・DB・外部送信に関わる経路を一切触らない（§9・既存踏襲）。

## 完了条件

- 設定画面の**すべての設定項目名**（トグル label・文字数上限・話者・スタイル・フォント）が
  **同じ太字・同じ濃色**で表示され、補助説明文と一目で区別できる。
- 補助説明文が `--muted` になり、`--text-faint` は**無効状態とプレースホルダにしか残っていない**。
- `.speakerField` がレイアウト専用クラスに戻っている（`font-size` / `color` を持たない）。
- `check-css-guards.mjs` にガード (6) が入り、`.fieldLabel` を消す／`.note` を `--text-faint` に戻す
  ミューテーションで **fail する**ことを実際に手で試して確認した。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test`（vitest ＋ CSS ガード）が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test        # SettingsView.obs.test.tsx / CommentViewerApp.toolbar.test.tsx の非退行 ＋ CSS ガード

# ガード (6) が本当に効くかを手で確認する（いずれも FAIL になること。確認後に戻す）
#   - .fieldLabel の font-weight を消す
#   - .note の color を var(--text-faint) に戻す
node apps/desktop/scripts/check-css-guards.mjs

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json \
  apps/desktop/src/styles/theme.css

# 表示ロジックを触っていないことの担保（差分は className の付け替えのみであること）
git diff -- apps/desktop/src/screens/comment-viewer/SettingsView.tsx

pnpm --filter ./apps/desktop tauri dev   # コメビュ窓 → 歯車 → 設定ビューで:
                                         #   ①項目名がすべて同じ太字・濃色 ②説明文と一目で区別できる
                                         #   ③「固定コメントをOBSに表示」カードの説明 5 連続が読める
                                         #   ④ライト/ダーク両テーマで破綻しない（トークン経由の担保）
                                         #   ⑤本体ツールバーのトグル（読み上げ / コメントをOBSに表示）が変わっていない
```

## 実装後に必要なレビュー

- 軽レビュー: frontend の見た目のみで外部通信宛先・API・capability・依存が不変であること、
  生 hex/rgba を持ち込んでいないこと（役割トークン経由）、`.toggleLabel` を変更していない
  （＝本体ツールバーへ波及していない）こと、`--text-faint` が無効状態・プレースホルダ以外に
  残っていないこと、ガード (6) が実際に退行を検出できること（ミューテーション確認の記録）を見る。
