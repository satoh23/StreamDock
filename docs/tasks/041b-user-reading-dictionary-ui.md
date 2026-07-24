# 041b ユーザー読み替え辞書 CRUD＋設定 UI

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [041](041-comment-viewer-reading-dictionary.md) を正とする。
>
> **必読前提**: 親 [041](041-comment-viewer-reading-dictionary.md)、先行 [041a](041a-reading-dictionary-engine-and-builtin.md)（`readingDictionary.ts`＝`ReadingRule`／`applyReadingDictionary`／`getReadingDictionary` 注入）、
> localStorage 流儀 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)（レジストリ＋`load/save`＋別窓 `storage` 購読同期）・[`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)、
> 設定 UI [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)（カード羅列・props 駆動）・状態保持 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、リスト編集の既存例 preset-items、
> [`docs/security.md`](../security.md)（§1/§3/§8/§10・CSP 方針）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

ユーザーが**特定単語の読み方を自分で追加/変更/削除**でき、それが**内蔵一般辞書を上書きして最優先**で読み上げに反映されるようにする（要求2）。保存は既存コメビュ設定と同じ localStorage。

## 現在の前提（調査結果）

- 041a で `readingDictionary.ts`（`ReadingRule`・`applyReadingDictionary`）と `ttsQueue` の `getReadingDictionary` 注入が入り、`CommentViewerApp` は `getReadingDictionary: () => BUILTIN_READING_DICTIONARY` を渡している。本タスクはこの getter が返す辞書を「ユーザー辞書 → 内蔵辞書」にマージする。
- localStorage 永続の定型は `overlaySettings.ts`（名前空間キー・`load/save`・例外握りつぶし・既定フォールバック・別窓は `storage` 購読で反映）。コメビュ設定状態は `CommentViewerApp` が保持し props で `SettingsView` へ渡す。
- リスト（行の追加/削除/編集）UI の既存流儀は preset-items（`usePresetItems.ts` 等）。UI 部品は `SettingsView` 近傍の `ToggleSwitch`/`Select` や `components/primitives.tsx`。

## このタスクでやること

### ユーザー辞書ストレージ（`readingDictionaryStorage.ts`）

- `apps/desktop/src/features/comment-viewer/readingDictionaryStorage.ts` を `overlaySettings.ts` と同型で新設する。
- キー `stream-dock.comment-viewer.reading-dict` に `{ surface: string; reading: string }[]` を JSON で保存。`loadUserReadingDictionary()` / `saveUserReadingDictionary(list)`（例外握りつぶし・不正/未保存は空配列フォールバック）。
- 別窓反映用に `storage` 購読ヘルパ（`overlaySettings.ts` 同様。読み上げは基本コメビュ窓のみだが、既存流儀に合わせて用意）。
- 入力検証（§8・frontend 完結データ）: `surface`/`reading` を trim、空・制御文字・過長を拒否、`reading` は**カタカナ（＋長音/中黒程度）**に制限、重複 `surface` は後勝ち（または警告）。ユーザーエントリは `kind:"text"` 固定（任意正規表現は書かせない）。

### 内蔵とのマージ（優先順位）

- `readingDictionary.ts` に `mergeReadingDictionary(user, builtin): ReadingRule[]` を追加。**ユーザー → 内蔵の順**に並べ、同 `surface` はユーザー定義で上書き（最優先）。ユーザーエントリは `kind:"text"` として合流。
- `CommentViewerApp` の `getReadingDictionary` を `() => mergeReadingDictionary(userDict, BUILTIN_READING_DICTIONARY)` に差し替え、`userDict` は state 保持＋localStorage 永続。編集で state 更新すれば getter 経由で**キューを作り直さず即反映**する。

### 設定 UI（`SettingsView.tsx` / `CommentViewerApp.tsx`）

- 読み上げ（VOICEVOX）カード付近に「**読み替え辞書**」カードを追加。行エディタで一覧（`surface → reading`）・追加・編集・削除（preset-items のリスト編集流儀）。
- 状態は `CommentViewerApp` が保持＋localStorage 永続し、props（`readingDict` / `onReadingDictChange` 等）で `SettingsView` に渡す既存流儀。
- **内蔵辞書を上書きしている項目が分かる表示**（例: 同 surface が内蔵にもある場合に「内蔵を上書き中」の注記）。入力不正時は保存させず軽い注意表示。

## このタスクでやらないこと

- SQLite 保存・Rust 側変更・sidecar 変更。VOICEVOX ユーザー辞書（`/user_dict*`）登録。
- 内蔵辞書自体の編集（内蔵は固定・ユーザー辞書の上書きで対応）。任意正規表現のユーザー入力。
- CSV 一括インポート/エクスポート（将来検討）。オーバーレイ/表示ロジックの変更。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示・設定追加のみ**。外部通信宛先・API・capability・依存・CSP を増やさない（§1/§3/§10・`csp: null` 不変）。
- localStorage は**非機密の UI 設定のみ**（`overlaySettings.ts` 既存方針）。外部送信しない。
- ユーザー入力（`surface`/`reading`）を trim・制御文字/長さ検証・カタカナ制限（§8）。ユーザーエントリは `kind:"text"` 固定で任意正規表現を持たせない（ReDoS 回避）。
- 取得コメント・辞書内容を Rust の DB/ログに出さない（§9・既存踏襲）。

## 完了条件

- 設定で単語を追加/編集/削除でき、ユーザー登録が**内蔵を上書きして最優先**で読み上げに即反映される（getter 経由・キュー作り直し不要）。
- 削除すると内蔵辞書/VOICEVOX 既定の読みに戻る。未保存/不正値は無害フォールバック（表示が壊れない）。
- 新規宛先/API/capability/依存を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る（Rust 変更なし＝`cargo check` 省略可）。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 設定→「読み替え辞書」で単語を登録し、同単語が新しい読みで読まれること、
                                         #   内蔵と同 surface を登録すると上書きされること、削除で既定へ戻ることを目視
```

## 実装後に必要なレビュー

- security-review（軽）: frontend 表示/設定追加のみで外部通信宛先・API・capability・依存・CSP が不変であること、localStorage が非機密 UI 設定のみであること、ユーザー入力の検証（trim/制御文字/長さ/カタカナ・`kind:"text"` 固定）が備わっていることを確認する。
