# 055e リリースノートのマークダウン描画（最小サブセット・新規依存ゼロ）

> 状態: **未着手（実装サブタスク・055 系の最後／磨き）**。位置づけ・方式決定・線引きは
> 親 [055](055-app-self-update.md) を正とする。**[055c](055c-update-notice-and-screen.md) の
> アップデート画面が前提**（描画箇所を 1 箇所に閉じ込めてある）。
>
> **必読前提**: 親 [055](055-app-self-update.md)（**リリースノートはリポジトリ内が単一ソース**・
> **自前レンダラで新規依存ゼロ**の決定）、[055a](055a-updater-release-pipeline.md)（`docs/release-notes/vX.Y.Z.md` と
> CI が `latest.json` の `notes` に流す経路）、[055c](055c-update-notice-and-screen.md)（`UpdateScreen` の描画箇所）、
> [054](054-comment-viewer-settings-readability.md)（タイポグラフィの階層規則）、
> [`docs/security.md`](../security.md)（§1/§10/CSP 方針）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **frontend の純関数＋表示のみ**＝**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
>
> **なぜ最後なのか**: [055d](055d-update-install-and-restart.md) までで機能ループは閉じており、本タスクは磨き。
> 期日が詰まったら落とせる位置に置いてある（落としても 055c のプレーンテキスト表示で内容は読める）。

## 目的

アップデート画面の更新内容が、**マークダウンとして整形されて**表示されるようにする。
現状（055c 時点）は `# 見出し` や `- 箇条書き` がそのまま文字として見えている。

**新しいライブラリは入れない。** 自前の最小レンダラで、`docs/release-notes/vX.Y.Z.md` に実際に書く範囲だけを扱う。

## 現在の前提（調査結果・実コード）

- リポジトリに**マークダウンレンダラは 1 つも入っていない**（`react-markdown` / `marked` / `remark-*` / `mdx` は
  `apps/desktop/package.json` / `apps/comment-sidecar/package.json` / root / `pnpm-lock.yaml` のいずれにも無い）。
- [055a](055a-updater-release-pipeline.md) で **`docs/release-notes/vX.Y.Z.md` がリリースノートの単一ソース**になり、
  CI がその内容を `latest.json` の `notes` へそのまま流す。
  ＝**描画する文字列は自分たちが書いたもの**で、第三者の任意入力ではない。
- [055c](055c-update-notice-and-screen.md) の `UpdateScreen` は `notes` を `white-space: pre-wrap` の
  プレーンテキストとして 1 箇所で描画しており、**そこを差し替えるだけで済む形**になっている。
- `docs/security.md` §10 は「新しい npm package を追加する場合は理由を説明する」とし、
  **明示的に落とした依存**（`sharp` / `canvas` / `jimp` / `open` / `hono` / `dotenv` など）を列挙する文化がある。
- CSP 方針は「外部 script/style/image を読み込まない・**inline script を増やさない**・remote domain IPC を使わない」。

### なぜ `react-markdown` を採らないのか（記録として残す）

- `react-markdown` + `remark-gfm` は unified / remark / micromark / mdast 系の**推移的依存が 20 以上**増える。
  §10「依存関係を増やしすぎない」に照らして、**リリースノート 1 画面のために払うコストとして重い**。
- 描画対象は**自分たちが書いた数十行のテキスト**であり、任意のマークダウンを正確に再現する必要がない。
- 自前レンダラは **React 要素を返す**ので `dangerouslySetInnerHTML` が要らず、**XSS 面がそもそも生まれない**
  （`marked` + `DOMPurify` 案は HTML 文字列を経由するため、この利点を失う）。

## このタスクでやること

### (1) 最小レンダラ（純関数）

- 新規 `apps/desktop/src/screens/app-update/renderReleaseNotes.tsx`。
  `renderReleaseNotes(notes: string): React.ReactNode` を export する。
- **対応する記法（これ以外は対応しない）**:

  | 記法 | 出力 |
  | --- | --- |
  | `# ` / `## ` / `### ` | 見出し 3 段（`<h2>` / `<h3>` / `<h4>` 相当。画面の見出し階層に合わせる） |
  | `- ` / `* ` | 箇条書き（`<ul>` / `<li>`。ネストは対応しない） |
  | `**太字**` | `<strong>` |
  | `` `コード` `` | `<code>` |
  | 空行 | 段落の区切り |
  | それ以外の行 | 段落（`<p>`）としてそのまま |

- **リンク（`[text](url)`）は「テキストとして表示するだけ」**にする。
  ⚠ 踏ませない理由: 外部 URL を開く経路（`tauri-plugin-opener`）を増やすと、
  **「外部から来た文字列に含まれる URL を開く」**という新しい面が生まれる。
  リリースノートは自分で書いているので現状は安全だが、**面を増やさない方を選ぶ**。
  どうしても必要になったら、**https 限定 ＋ ホスト検証**を入れたうえで別タスクにする（再修正トリガー）。
- **画像・表・引用・コードブロック（```）・水平線・ネストしたリストは対応しない。**
  対応しない記法は**そのままテキストとして出す**（消さない・壊さない）。
- **`dangerouslySetInnerHTML` を使わない。** すべて React 要素として組み立てる。
- ⚠ **`key` を必ず付ける**（配列で返すため）。行番号などの安定した値を使う。
- ⚠ **入力が空・`null`・巨大でも壊れないこと**。行数の上限は設けないが、
  1 行が極端に長い場合に画面が横に伸びないよう CSS 側で `overflow-wrap` を当てる。

### (2) 画面への差し込み

- `UpdateScreen.tsx` の更新内容の描画箇所（055c で 1 箇所に閉じ込めてある）を
  `renderReleaseNotes(notes)` に置き換える。
- `UpdateScreen.module.css` に見出し・箇条書き・`<code>` の書式を足す。
  **054 の階層規則に従う**（見出し＝`--text`×太字、本文＝`--text`、補足＝`--muted`、`--text-faint` は使わない）。
  色は**役割トークン経由のみ**（生 hex/rgba を書かない）。
- **`notes` が空・未取得のときのフォールバック**（「更新内容の記載がありません」等）を用意する。

### (3) リリースノートの雛形を実際の対応範囲に揃える

- [055a](055a-updater-release-pipeline.md) で作った `docs/release-notes/README.md` の雛形を、
  **本タスクで実際に対応した記法だけ**に揃える（対応外の記法を雛形に残さない）。
  「ここに書ける記法＝アプリで整形して表示される記法」という 1 対 1 の関係にする。

### (4) テスト

- `renderReleaseNotes` の単体テスト（純関数なので書きやすい）:
  - 見出し 3 段 / 箇条書き / 太字 / インラインコード / 空行の段落分け
  - **対応外の記法（表・画像・コードブロック・リンク）がテキストとして残る**こと（消えない・壊れない）
  - 空文字・改行だけ・巨大入力で例外を投げないこと
  - **`dangerouslySetInnerHTML` を使っていない**こと（レンダリング結果に生 HTML が混ざらない）
- `UpdateScreen` のテストに「見出しと箇条書きが要素として出る」ケースを 1 つ足す。

## このタスクでやらないこと

- **新しい npm package の追加**（`react-markdown` / `remark-gfm` / `marked` / `DOMPurify` すべて入れない）。
- **リンクを踏ませること**（外部 URL を開く経路を増やさない）。画像の表示。
- 表・引用・コードブロック（```）・水平線・ネストしたリスト・脚注・チェックボックスへの対応。
- リリースノートの**取得経路**の変更（`latest.json` の `notes` を読むだけ。`api.github.com` を叩かない）。
- **全リリース履歴の一覧表示**（表示するのは最新リリース 1 件だけ）。
- Rust / capability / `tauri.conf.json` / CI の変更。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の純関数＋表示のみ**。外部通信宛先・API・capability・**依存**を増やさない（§1/§3/§10）。`csp: null` 不変。
- **`dangerouslySetInnerHTML` を使わない**。`notes` は `latest.json` 由来の外部文字列なので、
  React 要素としてしか組み立てない（＝HTML インジェクションの経路が構造的に存在しない）。
- **外部リソースを一切読み込まない**（画像・フォント・script・style）。CSP 方針の「inline script を増やさない」も維持。
- **リンクを開く経路を作らない**（`tauri-plugin-opener` を新たに呼ばない）。
- §10 の「追加した依存（055）」に、**`react-markdown` / `remark-gfm` / `marked` / `DOMPurify` を
  明示的に落とした**ことと理由（推移的依存 20+ ／ HTML 文字列を経由しない方が安全）を追記する
  （「明示的に落とした依存」を書く既存の文化に沿う）。

## 完了条件

- アップデート画面の更新内容が、**見出し・箇条書き・太字・インラインコードとして整形表示**される。
- **対応外の記法が消えたり壊れたりしない**（テキストとして残る）。
- `notes` が空・未取得でも壊れず、フォールバック文言が出る。
- **`package.json` / `pnpm-lock.yaml` に差分が無い**（新規依存ゼロ）。
- `dangerouslySetInnerHTML` を使っていない。外部リソースを読み込んでいない。
- ライト/ダーク両テーマで破綻しない。生 hex/rgba を書いていない。054 の階層規則に従っている。
- `docs/release-notes/README.md` の雛形が実際の対応範囲と一致している。
- §10 に「明示的に落とした依存」が追記されている。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test        # renderReleaseNotes.test.tsx ＋ UpdateScreen の非退行

# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json
# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/

# dangerouslySetInnerHTML を使っていないことの担保
grep -rn "dangerouslySetInnerHTML" apps/desktop/src/screens/app-update/ || echo "OK: 生 HTML 経路なし"

pnpm --filter ./apps/desktop tauri dev   # アップデート画面で:
                                         #   ①見出し/箇条書き/太字/コードが整形される
                                         #   ②対応外の記法（表・画像）が文字として残る（消えない）
                                         #   ③長い 1 行でも画面が横に伸びない
                                         #   ④ライト/ダーク両方で読める
```

## 実装後に必要なレビュー

- 軽レビュー: **新規依存がゼロ**であること（`package.json` / `pnpm-lock.yaml` 差分ゼロ）、
  **`dangerouslySetInnerHTML` を使っていない**こと、外部リソース（画像・フォント・script）を読み込んでいないこと、
  **リンクを開く経路を作っていない**こと、対応外の記法が消えずにテキストとして残ること、
  色が役割トークン経由で 054 の階層規則に従っていること、
  §10 に「明示的に落とした依存」が記録されていることを確認する。
