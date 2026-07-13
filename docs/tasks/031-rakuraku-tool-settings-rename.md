# 031 Rakuraku Tool Settings Rename

## 目的

「らくらくツール**導入**」を「らくらくツール**設定**」に改名する。今後この画面では導入だけでなく設定等も
行えるようにするため、名称を「設定」に寄せる。**本タスクは名称変更のみ**で、画面自体は 032 の新機能実装
までは現状の ComingSoon（準備中）プレースホルダのままとする。frontend の表示文言のみの変更。

## 現在の前提（調査結果）

- ヘッダーのセクション定義は単一ソース `apps/desktop/src/components/headerSections.ts`。`rakuraku` エントリの
  `label`（`:22`）がサイドバー導線とページ見出しの両方に波及する（`App.tsx` が `comingSoonSection.label` を
  ページタイトルに使用）。ラベルの重複直書きは他に無い。
- `headerSections.ts:22` — `label: "らくらくツール導入"`。
- `headerSections.ts:26` — `comingSoonDescription: "おすすめの配信ツールをまとめて確認し、ワンクリックで導入できる機能を準備中です。"`
  （「導入」動詞を含む）。
- `apps/desktop/src/features/tutorial/tutorialSteps.ts:62` — 本文でラベルを**直書き引用** `『らくらくツール導入』`。
  HEADER_SECTIONS を参照していないため個別に同期が必要。
- `apps/desktop/src/screens/coming-soon/ComingSoonScreen.tsx:5` — 非表示コメント内に `らくらくツール導入` の参照。
- 内部識別子（変更しない）: `screen: "rakuraku-tools"`（`headerSections.ts:23` / `types.ts:8` / `App.tsx:241`）は
  ローマ字 ID で「導入/設定」の語を含まないため据え置き。

## このタスクでやること

### (1) ラベルの改名

- `headerSections.ts:22` の `label` を `"らくらくツール設定"` にする（サイドバー導線＋準備中ページ見出しに自動波及）。

### (2) 説明文の「導入」動詞をリワード

- `headerSections.ts:26` の `comingSoonDescription` を「設定」寄りに一言調整する
  （例: 「おすすめの配信ツールをまとめて確認し、ワンクリックで設定できる機能を準備中です。」）。

### (3) チュートリアル文言の同期

- `tutorialSteps.ts:62` の引用 `『らくらくツール導入』` を `『らくらくツール設定』` に更新する。

### (4) コメントの参照更新（任意・非表示）

- `ComingSoonScreen.tsx:5` のコメント内 `らくらくツール導入` 参照を `らくらくツール設定` に更新する。

## このタスクでやらないこと

- らくらくツール設定画面の実装（専用画面・機能一覧・詳細/同意/ワンクリック設定）。**032（別チャットで設計）で扱う。**
- 内部識別子 `rakuraku-tools` / `types.ts` の `Screen` union / `App.tsx` の分岐 ID の変更。
- `headerSections.ts` の `implemented:false` を変更しない（画面は準備中プレースホルダのまま）。
- ロジック・API・DB スキーマの変更。

## セキュリティ制約（docs/security.md 準拠）

- frontend の表示文字列のみの変更。OS 操作・ファイル操作・プロセス操作を追加しない（§2 / §4 / §5）。
- 新しい Tauri command / capabilities / 依存を追加しない（§3 / §10）。
- 外部通信・外部リソース読み込みを増やさない（§1 / §CSP）。

## 完了条件

- ヘッダー導線・準備中ページ見出しが「らくらくツール設定」になっている
- 説明文の「導入」動詞が「設定」寄りに調整されている
- チュートリアル引用が新ラベルと一致している
- 内部識別子 `rakuraku-tools` は変更されておらず、画面は準備中プレースホルダのまま
- 新しいライブラリ / Tauri command / capabilities を追加していない
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る
- docs/progress.md が更新されている

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # ヘッダー導線 / 準備中ページ / チュートリアルの表示を目視確認
```
