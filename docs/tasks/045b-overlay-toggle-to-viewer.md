# 045b OBS表示トグルをコメビュ本体へ移設（自動反映は設定に残置）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [045](045-obs-overlay-clarity.md) を正とする。
>
> **必読前提**: 親 [045](045-obs-overlay-clarity.md)、**トグルを設定へ集約した [034d](034d-overlay-controls-in-settings.md)（本タスクで部分反転）**、
> 自動追加 [044a](044a-obs-auto-source-impl.md)（表示↔自動追加の連動を壊さない）、[`docs/security.md`](../security.md)（§1）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend の配置変更のみ**＝**軽レビュー**。

## 目的

OBS への表示 ON/OFF を配信中にワンタッチで切り替えられるよう、**表示トグルを設定ビューから本体ツールバーへ移設**する（要望②）。
一度きりのセットアップである「OBS 自動反映（自動追加）」（044a）は**設定画面のまま残す**。034d で表示トグルを設定へ集約した決定の**部分反転**。

## 現在の前提（調査結果・実コード）

- 表示トグルは設定カード内: [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 238-242 行（`overlayOpen`/`onOverlayToggle`）。
  props は `SettingsViewProps` の `overlayOpen`（51 行）/`onOverlayToggle`（52 行）、分割代入 82-83 行。
- state/ハンドラは [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) が保持:
  - `overlayOpen` state（315 行）＋マウント時の実窓同期 `isCommentOverlayOpen().then(setOverlayOpen)`（338-340 行）。
  - `handleOverlayToggle`（731-745 行）: ON で `openCommentOverlayWindow()`＋（自動追加 ON なら）`requestObsAutoAdd()`、OFF で `closeCommentOverlayWindow()`＋（自動追加 ON なら）`requestObsHide()`。
  - SettingsView への受け渡し（795-820 行・`overlayOpen` 808 / `onOverlayToggle` 809）。
- 移設先の手本: 本体ツールバー右クラスタ [`toolbarActions`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L966)（966-992 行）＝
  VOICEVOX 読み上げトグル（967-972 行・`ToggleSwitch` に `inline`）＋視聴者ボタン＋設定ボタンが並ぶ。
- 「自動反映」側は設定に残す対象: 「OBS へ自動追加（連携）」トグル（260-264 行）＋注記（266 行）＋状態表示（270-282 行）＋
  有効化ガイド（285-295 行）＋パスワード入力（299-340 行）。`handleObsAutoAddToggle`（749-765 行）は未開時にオーバーレイを開いてから追加するため、`overlayOpen` を参照する。

## このタスクでやること

### (1) 表示トグルを本体ツールバーへ移設

- [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の表示トグル（238-242 行）を**カードから撤去**する。カード内の「自動反映（自動追加）」以降（244 行〜）は残す。
- 撤去に伴い `SettingsViewProps` の `overlayOpen`/`onOverlayToggle`（51-52 行）と分割代入（82-83 行）、呼び出し側の受け渡し（808-809 行）を整理する。
  ※ただし設定カードの注記や状態表示が `overlayOpen` に依存していないことを確認のうえ外す（現状の依存は表示トグルのみ）。
- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `toolbarActions`（966-992 行）に、VOICEVOX 読み上げトグルと同じ流儀（`ToggleSwitch` + `inline`）で
  **表示トグル**を追加し、`checked={overlayOpen}` / `onChange={handleOverlayToggle}` を渡す（state・ハンドラは既存を再利用・**新規に作らない**）。ラベルは 045a の新語彙（例「コメントをOBSに表示」）。

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

- 本体ツールバーに表示トグルがあり、配信中に開閉できる。設定カードには「自動反映（OBS へ自動追加）」等のセットアップ設定だけが残る。
- 表示↔自動追加の連動（OFF で非表示・未開時オープン→追加）と、外部 close 後の再オープン同期が壊れていない。
- 新規 command/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 本体トグルで開閉できる／設定に自動反映が残る／自動反映 ON 時に表示 OFF で OBS 非表示／
                                         #   再オープンでトグル状態が実窓に同期、を目視
```

## 実装後に必要なレビュー

- 軽レビュー: 移設が UI 位置のみで、`handleOverlayToggle`/`handleObsAutoAddToggle`/マウント同期の連動を壊していないこと、
  新規 command/capability/依存が無いこと、`csp: null` 不変を確認する。
