# 054 内蔵コメビュ設定画面の可読性修正（ラベル／説明の階層統一）

> 状態: **実装済み（2026-08-01）**。記録は [`docs/progress.md`](../progress.md) の
> 「2026-08-01 (054 内蔵コメビュ設定画面の可読性修正)」節を正とする。**実機確認は未実施**。
>
> 実装時の確定事項（起票時から変えた点）:
> - **`.fieldLabel` は 13px/700/`var(--text)`**（`.toggleLabel` 一致）。統一の単位は「**コメビュ窓の中**」で
>   あって「アプリ全体」ではない、という整理で確定（お手本の実測が 12px/800・14px/800 と揃っていないため。
>   詳細は progress の「なぜ 13px/700 なのか」）。
> - **`.fontPreviewLabel` は色だけ `--muted` へ**（11px/700 は据え置き）。3 段規則のどの段でもない
>   インライン注記のため。`.obsPasswordHelp` は `.note` と同じ書式へ。
> - **完了条件の内部矛盾を実態へ修正した**（下記「完了条件」参照）。原文は「`--text-faint` は無効状態と
>   プレースホルダにしか残っていない」だったが、同じタスクの (1) が `.pastTime` を据え置きと指示しており
>   両立しない。加えて**この CSS モジュールに `::placeholder` ルールは 1 つも無い**。
>
> 実際に変更したファイル: `CommentViewerApp.module.css` / `SettingsView.tsx`（`className` 付け替えのみ）/
> `scripts/check-css-guards.mjs`（ガード (6-a)〜(6-d) ＋ `hasDecl` ヘルパの修正）。
>
> **E2E 追補②（2026-08-01・同日）**: 依頼者の指示で OBS カードの可視文言 3 本を**削除**した
> （045b の移設先導線 ／ 033f の手動キャプチャ手順 ／ 044a の「上の手動での…が不要になります」）。
> 3 本目は 2 本目を消すと指示先が無くなるため確認のうえ同時削除。Windows 向け注記は残す
> （044a が自動化するのはキャプチャ方式だけで「透過を許可」は自動化されていないため）。
> 窓名 `StreamDock コメントオーバーレイ` を見ていたテスト 2 件を整理し、**窓名一致は lib.rs ↔ sidecar の
> 2 者間契約になった**（desktop のテストからは見えない）。詳細は progress の「E2E フィードバック②」節。
>
> **E2E 追補（2026-08-01・同日）**: 実機確認で「書式は分かれたが**まだ読み分けられない**」となったため、
> **余白の追補**を実施した。原因は `.cardBody` が `gap: 10px` の一律で、「項目名 → その説明」と
> 「説明 → 次の項目」が同じ間隔だったこと。`.cardBody` に 2 段の余白
> （`--card-block-gap: 10px` = 項目ブロック同士 ／ `--card-inner-gap: 4px` = ブロック内）を入れ、
> `.cardBody > * + .note` で説明を直前の項目へ引き寄せた。**JSX 差分ゼロ**（CSS 2 ルールのみ）。
> ガード (7-a)〜(7-d) を追加。詳細は progress の「E2E フィードバック反映」節。
>
> **レビュー反映（2026-08-01・同日）**: セキュリティ判定は「問題なし」（見た目のみ・差分ゼロを実測）。
> 品質面はガード (6) に偽陰性 4 種・偽陽性 3 種・fail-open 2 種が実証されたため全件修正した
> （詳細は progress の「レビュー指摘を受けた改訂」）。併せて **`.note` の波及先の記述が誤っていた**
> （ツールバーではなく `position:absolute` の接続ポップオーバーの中）ので、progress・CSS コメント・
> 実機確認項目を訂正した。

> 状態（起票時）: **未着手**。実機フィードバック起点の単独タスク（親設計なし）。
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
- **設定項目とその説明が 1 つのブロックに見え、ブロック同士が余白で分かれている**（E2E 追補で追加）。
  書式のコントラストだけでは等間隔に積まれたテキストを「かたまり」として読ませられなかったため、
  `.cardBody` の縦余白を 2 段（項目ブロック同士 10px ／ ブロック内 4px）にすることを完了条件に含める。
- 補助説明文が `--muted` になり、`--text-faint` は **無効状態（`:disabled`）と、設定画面外のメタ情報
  （`.pastTime`）にしか残っていない**。**設定画面内の可読テキスト（設定項目名・補助説明）には一切残っていない**。
  > ⚠ **起票時の文言「無効状態とプレースホルダにしか残っていない」を実装時に修正した。**
  > 理由 2 つ: ①同じタスクの (1) が `.pastTime`（視聴者詳細の過去コメント時刻＝設定画面外のメタ情報）を
  > **据え置き**と指示しており、`.pastTime` は無効状態でもプレースホルダでもないため原文は**実装後も
  > 満たされない**。②**この CSS モジュールに `::placeholder` ルールは 1 つも存在しない**（`--text-faint` を
  > プレースホルダに使っているのは `formLayout.module.css` 側）ので、「プレースホルダ」は規則の宣言に
  > とどまり実体が無い。
  > この矛盾はガード (6) の書き方に直結する——「faint は `:disabled` のみ」という素の走査型を入れると
  > `.pastTime` で**正しい CSS のまま fail する**。当初はこれを避けて `.note` / `.fieldLabel` を名指しする
  > denylist 型にしたが、レビューで「それは規則ではなく今あるものしか守らない（新設クラスの誤用が素通りする）」と
  > 実証されたため、**許可リスト `FAINT_ALLOWED` 付きの走査型**へ改めた。`.pastTime` はそこに理由付きで
  > 登録してあるので、正しい CSS で fail することもない。
- `.speakerField` がレイアウト専用クラスに戻っている（`font-size` / `color` を持たない）。
- `check-css-guards.mjs` にガード (6-a)〜(6-d) が入り、**31 種のミューテーション**を隔離コピーで実走して
  「退行は fail する／正しい CSS は pass する」の両方を確認した（内訳は progress の 054 節）。
  意図的に残した穴（`.note` の `font-size` 変更・`.fieldLabel` の `@media` 内への移動）も同節に明記した。
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
