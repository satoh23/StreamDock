# 045b OBS表示トグルをコメビュ本体へ移設（自動反映は設定に残置）

> 状態: **2026-07-28 実装済み**（記録は [`docs/progress.md`](../progress.md) の 045b 節）。分割・線引きは親 [045](045-obs-overlay-clarity.md) を正とする。
>
> 実装時の差分（このファイルの記載との違い）:
> - 移設先は `toolbarActions` の **先頭**（VOICEVOX 読み上げの左）。右寄せクラスタでは先頭挿入だけが既存要素の画面位置を動かさないため。
> - 設定カードには**移設先への導線注記を 1 行残した**（トグル撤去だけだと設定画面から ON にする場所を辿れなくなるため）。
> - CSS は変更なし（親 `.toolbar` に既に `flex-wrap: wrap` があり、最小幅 560px に右クラスタ ≈470px が収まる）。
> - `SettingsViewProps` から 2 プロパティを消すと `SettingsView.obs.test.tsx` の `baseProps()` が余剰プロパティ検査で
>   typecheck を落とすため追従。あわせて **`CommentViewerApp.toolbar.test.tsx` を新規追加**（移設先の描画・開閉・
>   マウント同期・移設の担保・044a 連動の 6 ケース）。
>
> **必読前提**: 親 [045](045-obs-overlay-clarity.md)、**トグルを設定へ集約した [034d](034d-overlay-controls-in-settings.md)（本タスクで部分反転）**、
> 自動追加 [044a](044a-obs-auto-source-impl.md)（表示↔自動追加の連動を壊さない）、[`docs/security.md`](../security.md)（§1）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend の配置変更のみ**＝**軽レビュー**。

## 目的

OBS への表示 ON/OFF を配信中にワンタッチで切り替えられるよう、**表示トグルを設定ビューから本体ツールバーへ移設**する（要望②）。
一度きりのセットアップである「OBS 自動反映（自動追加）」（044a）は**設定画面のまま残す**。034d で表示トグルを設定へ集約した決定の**部分反転**。

## 現在の前提（調査結果・実コード）

> **行番号は 045a 実装後（2026-07-28）の現物に更新済み**。045a がカード先頭にコメントを足したため
> `SettingsView.tsx` のカード内の行番号は全体に後ろへずれた（旧記載 238-242 のままだと見出しと `cardBody` の
> 開きタグを巻き込んで JSX が壊れる）。`CommentViewerApp.tsx` 側は 045a で無変更＝下記の行番号はそのまま有効。

- 表示トグルは設定カード内: [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 245-249 行（`overlayOpen`/`onOverlayToggle`）。
  直前の 240-244 行に「label を見出しと同文にした理由」の 045a レビューコメントがあるので、撤去時は一緒に消す。
  props は `SettingsViewProps` の `overlayOpen`（51 行）/`onOverlayToggle`（52 行）、分割代入 82-83 行。
- state/ハンドラは [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) が保持:
  - `overlayOpen` state（315 行）＋マウント時の実窓同期 `isCommentOverlayOpen().then(setOverlayOpen)`（338-340 行）。
  - `handleOverlayToggle`（731-745 行）: ON で `openCommentOverlayWindow()`＋（自動追加 ON なら）`requestObsAutoAdd()`、OFF で `closeCommentOverlayWindow()`＋（自動追加 ON なら）`requestObsHide()`。
  - SettingsView への受け渡し（795-820 行・`overlayOpen` 808 / `onOverlayToggle` 809）。
- 移設先の手本: 本体ツールバー右クラスタ [`toolbarActions`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L966)（966-992 行）＝
  VOICEVOX 読み上げトグル（967-972 行・`ToggleSwitch` に `inline`）＋視聴者ボタン＋設定ボタンが並ぶ。
- 「自動反映」側は設定に残す対象: **「OBSに自動で反映する」**（045a で「OBS へ自動追加（連携）」から改名）トグル（267-271 行）
  ＋注記（272-274 行）＋状態表示（276-290 行）＋有効化ガイド（292-303 行）＋パスワード入力（305-348 行）。
  `handleObsAutoAddToggle`（749-765 行）は未開時にオーバーレイを開いてから追加するため、`overlayOpen` を参照する。

## このタスクでやること

### (1) 表示トグルを本体ツールバーへ移設

- [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の表示トグル（245-249 行）＋直前の 045a レビューコメント（240-244 行）を**カードから撤去**する。
  カード見出し（238 行）と `cardBody`（239 行）、および手動キャプチャ注記（250-253 行）以降は**残す**。
  ※250-253 行の注記には OBS 実窓名リテラルが入っており 044a の窓名一致の案内なので、撤去に巻き込まないこと
  （`SettingsView.obs.test.tsx` に回帰テストあり）。
- 撤去に伴い `SettingsViewProps` の `overlayOpen`/`onOverlayToggle`（51-52 行）と分割代入（82-83 行）、呼び出し側の受け渡し（808-809 行）を整理する。
  ※ただし設定カードの注記や状態表示が `overlayOpen` に依存していないことを確認のうえ外す（現状の依存は表示トグルのみ）。
- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `toolbarActions`（966-992 行）に、VOICEVOX 読み上げトグルと同じ流儀（`ToggleSwitch` + `inline`）で
  **表示トグル**を追加し、`checked={overlayOpen}` / `onChange={handleOverlayToggle}` を渡す（state・ハンドラは既存を再利用・**新規に作らない**）。
  ラベルは 045a で確定した **「コメントをOBSに表示」をそのまま持っていく**（自己完結型にしてあるので再改名は不要）。

### (2) 連動と状態同期の維持

- `handleOverlayToggle`（731-745 行）・`handleObsAutoAddToggle`（749-765 行）・マウント同期（338-340 行）は**そのまま**流用する（移設は UI 位置のみ）。
  表示 OFF で自動追加 ON なら OBS 非表示（`requestObsHide`）、自動追加 ON かつ未開ならオーバーレイを開いてから追加、の連動を壊さない。
- 034d で導入した「外部 close 時の同期」方針（034f 回帰修正：cross-window 購読は張らず、再オープン時のマウント同期で復元）は不変。

## このタスクでやらないこと

- **自動反映（OBS 自動追加）トグルの移設**（設定に残す・044a の領分）。**文言の言い換え自体**（045a）。
- 意匠設定（フォント/サイト名）の移設。開閉/自動追加の**ロジック変更**。新規 Rust command・capability・依存の追加。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の UI 配置変更のみ**（既存 state/ハンドラ/コマンドを別の場所から呼ぶだけ）。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- オーバーレイは表示専用のまま。sidecar の起動/停止契機（no-orphan kill）に触れない。

## 完了条件

- 本体ツールバーに表示トグルがあり、配信中に開閉できる。設定カードには「OBSに自動で反映する」等のセットアップ設定だけが残る。
- 手動キャプチャ注記の OBS 実窓名「StreamDock コメントオーバーレイ」が撤去に巻き込まれず残っている（044a の窓名一致）。
- 表示↔自動追加の連動（OFF で非表示・未開時オープン→追加）と、外部 close 後の再オープン同期が壊れていない。
- 新規 command/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test        # 必須: SettingsView.obs.test.tsx が可視文言と OBS 実窓名リテラルを直接アサートしている
pnpm --filter ./apps/desktop tauri dev   # 本体トグルで開閉できる／設定に自動反映が残る／自動反映 ON 時に表示 OFF で OBS 非表示／
                                         #   再オープンでトグル状態が実窓に同期、を目視
```

## 実装後に必要なレビュー

- 軽レビュー: 移設が UI 位置のみで、`handleOverlayToggle`/`handleObsAutoAddToggle`/マウント同期の連動を壊していないこと、
  新規 command/capability/依存が無いこと、`csp: null` 不変を確認する。
