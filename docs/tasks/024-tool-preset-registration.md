# 024 Tool → Preset Registration

## 目的

ツール追加画面の「登録先プリセット」を**本実装**する（現状は表示専用スタブ）。ツールを新規登録する
と同時に、選んだプリセットへそのツールを登録できるようにする。あわせて「追加位置」を、登録先が
選ばれているときだけ意味を持つよう条件表示にする。

- 登録先プリセットのセレクトを実データ（登録済みプリセット）に置き換える。
- プリセットが 1 つも無い場合は登録先セレクトを非活性化する。
- 「追加位置」は、登録先が非活性、または「プリセットには追加しない」を選んでいる場合は表示しない。

## 現在の前提

- ツール追加/編集は同一 `apps/desktop/src/screens/add-tool/AddToolScreen.tsx`（`isEdit = !!editingTool`）。
  追加モード（`!isEdit`）でのみ「登録先プリセット」「追加位置」を表示する（296 行の `{!isEdit && (...)}`）。
- 「登録先プリセット」（298-311 行）と「追加位置」（313-320 行）は
  `apps/desktop/src/data/mockData.ts` の `targetPresetOptions` / `insertModeOptions`（ハードコード配列）を
  表示するだけの**スタブ**。`state` は `targetPreset` / `insertMode`（81-82 行、コメントに「表示のみに使う
  （保存には関与しない）」と明記）で、`handleSave`（103-136 行）では**一切使われていない**。
  ヘルプ「プリセットへの登録は今後のバージョンで対応予定です。」（308-309 行）。
- 再利用できる既存 API:
  - `createTool(input): Promise<ToolRecord>`（`features/tools/toolApi.ts:23`）。生成された Tool の `id` が返る。
  - `addToolToPreset({ presetId, toolId, launchMode? }): Promise<PresetItemRecord>`
    （`features/presets/presetItemApi.ts:24`、command `add_tool_to_preset`）。**末尾に自動採番して追加**する。
    入力型は `AddPresetItemInput`（`features/presets/bindings/AddPresetItemInput.ts`、`order_index` は入力に含めない）。
  - `reorderPresetItems(presetId, orderedIds): Promise<PresetItemRecord[]>`（同 44 行）。先頭配置に使える。
  - `LaunchMode`（`features/presets/bindings/LaunchMode.ts`）＝ `ordered` / `parallel`。省略時は ordered。
  - `usePresets(): { presets, ... }`（`features/presets/usePresets.ts`）で登録済みプリセット一覧を取得できる。
- `App.tsx` は `usePresets()` を保持しており、`AddToolScreen` へ presets を props で渡すか、
  `AddToolScreen` 内で `usePresets()` を呼ぶ形にできる（既存の配線方針に合わせる）。
- エラー表示は既存 `toErrorMessage`（`features/tools/useTools.ts`）を利用する。

## このタスクでやること

### (1) 登録先プリセットの実データ化

- `AddToolScreen.tsx` の登録先プリセット select を、`mockData` の固定配列ではなく**登録済みプリセット**
  （`usePresets()` もしくは props）から生成する。各 option の value は `presetId`、表示は preset 名。
- 末尾に固定の「プリセットには追加しない」選択肢（センチネル値、例 `""`）を残し、既定値にする。
- **プリセットが 0 件のとき**は select を `disabled` にし、「プリセットには追加しない」相当の状態に固定する
  （ヘルプ文言も「先にプリセットを作成してください」等に更新）。

### (2) 追加位置の条件表示

- 「追加位置」は、**登録先セレクトが非活性、または「プリセットには追加しない」選択時は表示しない**。
  実プリセットを選んでいるときのみ表示する。
- 選択肢を「末尾に追加」「先頭に追加」「並行（順番なし）」の 3 つに簡素化する（`mockData` の 4 択は撤去）。

### (3) 保存時のプリセット登録

- `handleSave` で `createTool` 成功後、実プリセットが選択されている場合のみ:
  - `addToolToPreset({ presetId, toolId: created.id, launchMode })` を呼ぶ（`launchMode` は「並行」選択時 `parallel`、
    それ以外 `ordered`）。デフォルトは**末尾追加**。
  - 「先頭に追加」を選んだ場合は、続けて `reorderPresetItems(presetId, [created.id, ...既存 id])` で先頭へ移動する。
- プリセット登録に失敗した場合も、ツール自体は作成済みである点をふまえ、`toErrorMessage` でエラー表示する
  （二重作成を避けるためツール作成のリトライはしない）。
- 成功後は既存どおり `onSaved?.()` → `onNavigate("main")`。

### (4) スタブの整理

- `mockData.ts` の `targetPresetOptions`（および不要になった `insertModeOptions`）を撤去/整理する。
- 表示専用だった state・ヘルプ文言（「今後のバージョンで対応予定です。」）を実装済みの内容に更新する。

## このタスクでやらないこと

- ツール**編集**時のプリセット登録変更（編集画面では従来どおり登録先/追加位置を出さない）。
- Rust 側 command / モデル / DB スキーマの変更（既存 `add_tool_to_preset` / `reorder_preset_items` の再利用のみ）。
- 起動順の高度制御（挿入位置の任意指定・launch group・待機秒数等）。「先頭/末尾/並行」以外は扱わない。
- 複数プリセットへの同時登録。
- プリセット側画面（`AddPresetScreen`）やメイン画面のツール構成 UI の変更。

## セキュリティ制約（docs/security.md 準拠）

- frontend のみの変更。OS 操作・ファイル操作・プロセス操作を追加しない（§2 / §4）。
- 新しい Tauri command / capabilities を追加しない。既存の `add_tool_to_preset` / `reorder_preset_items` /
  `create_tool` のみを利用する。
- 外部通信・外部リソース読み込みを増やさない（§1 / §CSP）。
- frontend から任意の path / command を渡さない（渡すのは `presetId` / `toolId` / `launchMode` のみ）。

## 完了条件

- 登録先プリセットが登録済みプリセットの実データから選べ、選んだプリセットにツールが登録される
- プリセットが 0 件のとき登録先セレクトが非活性になり、「追加しない」相当に固定される
- 追加位置は、登録先が非活性 / 「追加しない」選択時は非表示、実プリセット選択時のみ表示される
- 追加位置「末尾 / 先頭 / 並行」が実挙動（`addToolToPreset` 末尾＋必要に応じ `reorderPresetItems`、
  並行は `launchMode = parallel`）と一致している
- ツール作成後にプリセット登録が行われ、失敗時はエラー表示される（ツールの二重作成は起きない）
- 表示専用スタブ（`mockData` の該当配列・「今後対応予定」ヘルプ）が撤去/更新されている
- 新しいライブラリ / Tauri command / capabilities を追加していない
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
