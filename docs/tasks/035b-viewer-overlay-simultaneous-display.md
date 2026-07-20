# 035b viewer/overlay の同時表示 検証＋UI 微調整

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [035](035-simultaneous-youtube-twitch-comments.md) を正とする。
>
> **必読前提**: 親 [035](035-simultaneous-youtube-twitch-comments.md)、コア [035a](035a-sidecar-concurrent-sessions.md)
> （sidecar 同時取得・**035b は 035a 実装後に着手**）、設定ビュー [033b](033b-settings-view-connection.md)・オーバーレイ意匠
> [034e](034e-overlay-design-refresh.md)、[`docs/security.md`](../security.md)。CLAUDE.md どおり **「実装して」まで変更せず、
> まず変更計画と対象ファイルを提示する**。純粋な frontend の表示調整で、通信面・sidecar・Rust command は触らない。

## 目的

035a で両プラットフォーム同時取得が可能になった後、**viewer と overlay で Twitch/YouTube のコメントが混在表示
（mixed）されても見やすく・区別できる**ことを保証する。両接続状態が一目で分かり、各コメントの出所（source）が
分かり、片方だけ停止しても表示が破綻しない状態にする。表示層は既にマージ対応のため、**検証と小さな UI 調整が中心**。

## 現在の前提（調査結果）

- [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts) は **source 非依存**で id 重複排除
  ＋末尾 append（上限 `MAX_COMMENTS = 200`）。両 source が来れば時系列で自然に混ざる（partition しない）。
- [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) は `source` バッジ（`{ twitch: "Twitch",
  youtube: "YouTube" }`）を持ち、**`showSource` プロップ**で表示制御。viewer/overlay 双方がこの `CommentList` を
  `variant`（default/overlay）で共用。overlay は [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)
  が **`onComments` のみ**（表示専用）で、WS ブロードキャストにより両窓へ同一コメントが届く。
- 接続 UI は [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) に集約され、
  **各プラットフォーム独立の connect/start/stop** と接続状態インジケータ（円アイコン＋テキスト）を持つ。
  [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) は Twitch 用
  （`linked`/`sessionState`）と YouTube 用（`youtubeLinked`/`youtubeSessionState`）の **provider 別 state** を既に保持。
- つまり **UI は既に両プラットフォームを独立操作できる**。035a 後は「両方 start して両方 active」が実際に成立するため、
  その状態での表示・状態表示・停止挙動を確認・調整するのが本タスク。

## このタスクでやること

### (1) 両同時接続時の状態インジケータを検証・調整

- Twitch/YouTube を**同時に取得中**のとき、[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)
  の接続状態インジケータが**両方とも「取得中」を並列に**正しく表示することを確認する。片方 idle/失敗・他方取得中の
  組み合わせも齟齬なく出るか確認し、必要なら文言/配色を微調整する（provider 別 state は既存を利用）。

### (2) mixed 表示で source バッジが常に分かるように

- viewer・overlay とも、両 source が混在するとき **各コメントの出所（Twitch/YouTube バッジ）が常に判別できる**よう
  `CommentList` の `showSource` の渡し方を確認・調整する。overlay（034e 意匠）でも source が識別できることを確認
  （034e の「サイト名表示トグル」との整合を壊さない範囲で）。

### (3) 片方 stop の UX を検証

- 片方の取得を stop しても、**他方の取得・表示は継続**し、既に表示済みの停止側コメントが不自然に消えない/残ることを
  確認する（`mergeComments` は source で消さない）。停止側インジケータのみ idle に戻ることを確認し、必要なら微調整する。

## このタスクでやらないこと

- **sidecar のセッション管理（035a）**・通信面の変更。Rust command / capability / 依存の追加もしない。
- **TTS のソース別フィルタ・YouTube クォータ保護（035c）**。
- overlay の意匠刷新（034e 済み）・複数デザイン選択 UI（将来枠）。
- `mergeComments` の partition 化やプラットフォーム別カラム表示などの大規模改修（1 リストのマージ表示を維持）。

## セキュリティ制約（docs/security.md 準拠）

- frontend の表示調整のみ。**OS 操作・ファイル操作・プロセス操作・外部通信を増やさない**（§1/§2/§4/§5）。新規 Tauri
  command / capability / 依存を追加しない（§3/§10）。`csp: null` 不変。取得コメント本文はログ/DB に出さない（既存踏襲）。
- overlay は**表示専用**（loopback WS 読み取り専用・制御フレームを送らない）を維持する。

## 完了条件

- 両プラットフォーム同時取得中に、viewer と overlay で **両 source のコメントが 1 リストにマージ表示**され、各コメントの
  出所（Twitch/YouTube）が判別できる。
- [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の状態インジケータが**両接続を並列に
  正しく表示**する。
- 片方 stop で他方の取得・表示が継続し、停止側インジケータのみ idle に戻る。表示済みコメントが破綻しない。
- 新規 command / capability / 依存を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 両接続で mixed 表示／source バッジ判別／両インジケータ並列／片方 stop で他方継続を
                                         #   viewer・overlay の両方で目視（035a 実装済みが前提・実配信が必要）
```
