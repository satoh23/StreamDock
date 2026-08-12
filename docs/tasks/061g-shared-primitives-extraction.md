# 061g 画面を跨ぐ共通部品 3 本を `components/` へ移す

> 状態: **未着手（2026-08-12 起票）**。⚠ **既存の再修正トリガーが発火して立てたタスク**——
> 061d-1 が「`ConfirmDialog` と `ToggleSwitch` で跨ぎ部品が 2 本。**3 本目が跨いだら 2 本まとめて
> `components/` へ移す**」と書いており、061d-2 で **`Select` が 3 本目として跨いだ**
> （061d-2 レビュー Q-2 で「跨ぎ部品は増えていない」という記述が誤りだったことも判明）。
> 分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> **必読前提**: 親 [061](061-obs-effects.md)、跨ぎの発生源 [061d](061d-effect-template-ui.md)（**トリガーの本文**）、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)（⚠⚠ **`.toggleLabel` を基準に静的ガードが動いている**）、
> 既存の共通部品 [`components/primitives.tsx`](../../apps/desktop/src/components/primitives.tsx)（**移設先の作法**）、
> 静的ガード [`scripts/check-css-guards.mjs`](../../apps/desktop/scripts/check-css-guards.mjs)（**(6-a) が壊れる**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件なし**。⚠⚠ **親 061 のクローズ条件には含めない**（配信機能ではなく置き場所の整理で、
> 要望⑦の達成には関係しないため）。**ただし未完了として盤面に残す**（✅ にぶら下げない）。

## 目的

**「コメントビューア画面の部品」という名前のまま他画面から使われている 3 本を、名前どおりの場所へ移す。**

いまは `screens/obs-effects/` の 4 ファイルが `screens/comment-viewer/` の部品を import している。
この形が悪いのは見た目の問題ではなく、**次の 2 つが起きるから**である:

1. **コメビュ画面の都合で部品を変えると、OBSエフェクト画面が黙って壊れる**
   （import 元を見ただけでは「他画面が使っている」ことが分からない）。
2. **意匠が `CommentViewerApp.module.css` に同居している**ので、
   コメビュ画面の CSS を整理するだけで**他画面の見た目が変わる**。

⚠ **これは仕事を増やす変更ではない。** 061d-1 が予告した作業が発火しただけで、
「3 本目が跨いだら」という条件は**まさに満たされた**。

## 現在の前提（調査結果・実コード）

### 対象 3 本と、実際の呼び出し元（2026-08-12 時点・テストを除く）

| 部品 | 実体 | 呼び出し元（⚠ = 画面を跨いでいる） |
|---|---|---|
| **`ConfirmDialog`** | `screens/comment-viewer/ConfirmDialog.tsx` | `ViewersView` / `ViewerDetailPanel` / `OverlayThemeCard` ／ ⚠ `obs-effects/EffectTemplateCard` |
| **`ToggleSwitch`** | `screens/comment-viewer/ToggleSwitch.tsx` | `CommentViewerApp` / `SettingsView` / `OverlayThemeCard` ／ ⚠ `obs-effects/ObsEffectsScreen` ／ ⚠ `obs-effects/EffectTemplatePreview` |
| **`Select`** | `screens/comment-viewer/Select.tsx` | `ViewersView` / `SettingsView` ／ ⚠ `obs-effects/EffectAssignmentCard` |

**合計 12 箇所の import**（うち跨ぎ 4 箇所）。

### 3 本とも意匠は `CommentViewerApp.module.css` から読んでいる

移設に伴って切り出す必要があるクラス:

- **`ConfirmDialog`**: `.confirmDialog` / `.confirmBody` / `.confirmTitle` / `.confirmMessage` /
  `.confirmActions` / `.btnGhost` / `.btn` / `.dangerBtn`
- **`ToggleSwitch`**: `.toggleRow` / `.toggleRowInline` / `.toggleRowDisabled` / `.toggleLabel` /
  `.switch` / `.switchOn` / `.knob`
- **`Select`**: `.selectWrap` / `.selectCustom` / `.chevron`

⚠ `.btn` / `.btnGhost` / `.dangerBtn` は **`ConfirmDialog` 専用ではない可能性がある**
（`CommentViewerApp.module.css` の他の場所からも使われうる）。**切り出す前に必ず全参照を洗うこと**
——ここを機械的に移すと、コメビュ画面のボタンだけ意匠が消える。

### ⚠⚠ 静的ガード (6-a) が `.toggleLabel` を「基準」として読んでいる

`scripts/check-css-guards.mjs` の (6-a) は **`CommentViewerApp.module.css`（`VIEWER_CSS`）から
`.toggleLabel` と `.fieldLabel` を取り出して、`font-size` / `font-weight` / `color` の一致を突き合わせている。**
054 が決めた「設定項目名の書式は 1 種類」という規則の唯一の担保で、**jsdom では検出できない**。

＝ **`.toggleLabel` を別ファイルへ移した瞬間、`ruleBody` が null を返して (6-a) が落ちる。**
⚠ **落ちるのは正しい**（規則が割れたまま進めないためのガード）が、
**本タスクは「ガードの読み先を新しい CSS モジュールへ向け直す」ところまでを含む。**
⚠ **ガードを消して通すのは禁止**（054 の規則が無防備になる）。

⚠ (7)（余白の 2 段）は `.cardBody` / `.note` を見ており、本タスクの対象クラスには触れていない（確認済み）。

### 移設先の作法（既存）

`components/primitives.tsx` に `IconTile` / `OrderBadge` / `Chip` / `StatusBadge` / `Spinner` / `Button` があり、
意匠は `components/primitives.module.css`。**`Button` は既に `obs-effects` から使われている**
（＝「画面を跨ぐ部品は `components/` に置く」という規律は**この repo に既にある**）。

## このタスクでやること

⚠⚠ **振る舞いを 1mm も変えない。** 移設だけで、props も DOM も意匠も同一にする。

### (1) 3 本を `components/` へ移す

- `components/ConfirmDialog.tsx` / `components/ToggleSwitch.tsx` / `components/Select.tsx`
  （⚠ **`primitives.tsx` へ詰め込まない**——あちらは「1 ファイルに小さい部品を並べる」形で、
  `ConfirmDialog` は `useEffect` / `useRef` を持つ独立した部品。ファイルを分けるほうが既存と揃う）
- ⚠ **ファイル名・export 名・props は変えない**（呼び出し側の変更を import パス 1 行だけに閉じる）。

### (2) 意匠を切り出す

- `components/ConfirmDialog.module.css` / `ToggleSwitch.module.css` / `Select.module.css`
  （⚠ 1 枚にまとめるか 3 枚に分けるかは実装時に決めてコメントへ残す。
  **3 本が互いの意匠を共有していないなら 3 枚**が素直）
- ⚠⚠ **`CommentViewerApp.module.css` から該当ルールを「移動」する**（コピーして両方に残さない）。
  二重定義は「片方だけ直して片方が古くなる」の温床で、この repo が繰り返し戒めている形そのもの。
- ⚠ **`.btn` / `.btnGhost` / `.dangerBtn` は共有されている可能性がある**ので、
  全参照を洗ってから「移す／複製せず両方から読む／`primitives` の `Button` へ寄せる」を決める。

### (3) 静的ガード (6-a) の読み先を直す

`check-css-guards.mjs` に **`.toggleLabel` を持つ新しい CSS モジュール**を登録し、
`.fieldLabel`（`CommentViewerApp.module.css` に残る）との突き合わせを**ファイルを跨いで**行う形にする。

⚠ **突き合わせの意味は変えない**（「設定項目名の書式は 1 種類」）。
⚠ **失敗メッセージも更新する**（どちらのファイルを見ればよいかが分かるように）。
⚠ ここは **jsdom で殺せない規則の唯一の担保**なので、**変更後に必ず変異で FAILED を実測する**
（`.toggleLabel` の `font-size` をずらす変異／`.fieldLabel` 側をずらす変異の両方）。

### (4) 呼び出し側 12 箇所の import を書き換える

⚠ **import パスだけ**。JSX も props も触らない。

### (5) テスト

- **既存テストが全部緑のまま**であること（＝ これが「振る舞いを変えていない」ことの主要な担保）。
- ⚠ **テストファイル内の import も追随**する（`ConfirmDialog` を直接 render しているテストがある）。
- ⚠ **新しいテストは足さない**（振る舞いを変えないので固定すべき新しい仕様が無い）。
  代わりに **(3) の変異検証**を progress.md に記録する。

## このタスクでやらないこと

- **props / DOM 構造 / クラス名 / 意匠の変更。** 「ついでに整える」を混ぜない
  （混ぜると「緑のまま＝無変更」という担保が消え、レビューが差分全部を目で追うことになる）。
- **`primitives.tsx` の既存部品を触ること。**
- **4 本目以降の切り出し**（`OverlayThemeCard` など、いまは跨いでいないもの）。
  ⚠ **再修正トリガー＝また 3 本目が跨いだとき**、という形は本タスクでは作らない
  ——今回で「画面を跨ぐ部品は `components/`」という規律が明文化されるので、
  **次からは跨ぐ時点で `components/` へ置く**（後追いの移設を繰り返さない）。
- **`screens/comment-viewer/` の他の CSS 整理。**

## セキュリティ制約（docs/security.md 準拠）

- **触るのは frontend の置き場所だけ**——OS 操作・ファイル操作・プロセス操作・外部通信のいずれも増やさない。
- **ゼロ拡大**: `src-tauri/` / `capabilities/` / `tauri.conf.json` / `apps/comment-sidecar/` / 依存は**差分ゼロ**。
- ⚠ **静的ガードを弱めないこと**（(3)）。**通すためにガードを消す・条件を緩めるのは禁止。**
- ⚠ **`ConfirmDialog` は破壊的操作（テンプレート削除・視聴者メモリ削除・テーマ削除）の
  最後の確認 UI である**——移設で `danger` の見た目やフォーカス挙動が変わっていないか、
  **実機で 3 つの削除導線すべてを確認する**。

## 完了条件

- **3 本が `components/` にあり、`screens/comment-viewer/` からも `screens/obs-effects/` からも
  同じパスで import されている**（＝ 跨ぎがゼロになる）。
- **意匠が `CommentViewerApp.module.css` から移動している**（複製ではない）。
- **`check-css-guards.mjs` の (6-a) が新しい配置で動いている**（変異で FAILED を実測）。
- **既存テストが全部緑**（新規テストなし）。
- `pnpm typecheck` / `pnpm lint` / `pnpm test` が緑。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ。**
- ⚠ **実機で 3 つの削除確認ダイアログ・トグル・選択ボックスの見た目と操作が変わっていない。**

## 確認コマンド

```bash
git status --short
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test   # ⚠ check:css を含む（(6-a) がここで落ちる）

# 跨ぎがゼロになったことの担保（ヒットゼロが期待）
grep -rn "from \"../comment-viewer/ConfirmDialog\"\|from \"../comment-viewer/ToggleSwitch\"\|from \"../comment-viewer/Select\"" apps/desktop/src
# 意匠が二重定義になっていないことの担保（片方にしか出ないこと）
grep -rn "\.toggleLabel\|\.selectCustom\|\.confirmDialog" apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css apps/desktop/src/components/

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① コメントビューア設定のトグル・選択ボックスの見た目が変わっていない
# ② OBSエフェクト画面のトグル・選択ボックスの見た目が変わっていない
# ③ テンプレート削除の確認ダイアログ（danger 表示・Esc・フォーカス）が変わっていない
# ④ 視聴者メモリの削除確認ダイアログが変わっていない
# ⑤ カスタム CSS テーマの削除確認ダイアログが変わっていない
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  振る舞いを変えない移設で、OS 操作も通信も増やさないため。
- ⚠ ただし次は軽レビューでも必ず確認する:
  - **意匠が複製になっていない**こと（`CommentViewerApp.module.css` に古いルールが残っていない）
  - **`check-css-guards.mjs` (6-a) が実際に効いている**こと（変異で落ちること）
  - **`.btn` / `.btnGhost` / `.dangerBtn` の扱い**（共有されているものを片方へ持って行っていないか）
  - **既存テストが 1 件も書き換わっていない**こと（書き換わっているなら振る舞いが変わった疑い）
