# 035c TTS ソース別読み上げフィルタ

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [035](035-simultaneous-youtube-twitch-comments.md) を正とする。
>
> **必読前提**: 親 [035](035-simultaneous-youtube-twitch-comments.md)、コア [035a](035a-sidecar-concurrent-sessions.md)
> ・表示 [035b](035b-viewer-overlay-simultaneous-display.md)（**035c は 035a/035b 後に着手**）、VOICEVOX 読み上げ
> [033c](033c-voicevox-toggle-autolink.md)・[033d](033d-voicevox-speaker-select.md)、[`docs/security.md`](../security.md)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

両プラットフォーム同時取得時に顕在化する **読み上げ暴発**を制御する。両 source のコメントが全部 VOICEVOX に流れると
読み上げが詰まる/やかましくなるため、**source 別に読み上げ ON/OFF** できるようにする（既定は両 ON で現行踏襲）。

> **スコープ変更（当初案からの除外・2026-07-20）**: 当初は「YouTube クォータ保護・警告」を併せて扱う予定だったが除外した。
> 現行の YouTube 取得は検出 `liveBroadcasts.list`=1 unit・生存監視 `videos.list`=1 unit・チャットは gRPC `streamList`
> （低消費）で実運用の枯渇はまず起きず、**Twitch 併走は YouTube クォータに影響しない**（クォータ消費源は YouTube Data API
> のみで、Twitch は EventSub WS＝別勘定）。枯渇時の graceful stop は 032c-d で既実装、片方停止の見せ方は 035b が担当する
> ため、035c 固有のクォータ UI/警告は不要と判断した。再検討の目安: 実運用で YouTube クォータ枯渇が実際に発生し、
> ユーザーが停止理由を把握できず困る事例が出たら、汎用の「片方停止表示」（035b）側で理由表示を強化する。

## 現在の前提（調査結果）

- 読み上げ投入は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の
  `enqueueForSpeech` が **`mergeComments().added` を source 問わず**キューへ入れる（TTS キューは
  [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)）。→ 両稼働で全コメントが読み上げ対象。
- 読み上げ設定は [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)（ON/OFF・話者等の永続化）と
  [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の VOICEVOX 節。**source 別の
  フィルタ設定は無い**。

## このタスクでやること

### TTS ソース別読み上げフィルタ

- [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) を拡張し、**source 別の読み上げ ON/OFF**
  （例 `speakTwitch: boolean` / `speakYoutube: boolean`・既定は両 ON で現行踏襲）を永続化する。
- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `enqueueForSpeech` で、
  **`comment.source` が OFF の source はキュー投入しない**。表示（`mergeComments`/一覧）は従来どおり全 source を出す
  （フィルタは読み上げのみ）。
- [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の VOICEVOX 節に **source 別トグル**
  を追加（VOICEVOX 読み上げが OFF のときは無効表示）。

## このタスクでやらないこと

- **sidecar のセッション管理（035a）**・表示層の同時表示調整（035b）。
- 読み上げの話者/速度など VOICEVOX 本体設定の変更（033c/033d の範囲）。
- 表示側のコメント間引き/フィルタ（本タスクは**読み上げ**のフィルタのみ・表示は全 source 維持）。
- **YouTube クォータの UI/警告・graceful stop の表示強化**（上記スコープ変更のとおり除外。既存 `QuotaExceededError` →
  `session.state=failed` 経路は 032c-d のまま流用し、片方停止の見せ方は 035b が担当）。

## セキュリティ制約（docs/security.md 準拠）

- frontend の設定・表示のみ（読み上げキュー投入の分岐＋設定 UI）。**外部通信宛先・API・capability・依存を
  増やさない**（§1/§3/§10）。`csp: null` 不変。VOICEVOX は既存 loopback 例外（`127.0.0.1:50021`）の範囲・新規
  エンドポイントを足さない。取得コメント本文はログ/DB に出さない（既存踏襲）。

## 完了条件

- source 別（Twitch/YouTube）に**読み上げ ON/OFF** が設定でき、OFF の source は VOICEVOX に流れない（表示は全 source 継続）。
- 設定は再起動後も保持される（`ttsPrefs` 永続化）。
- 新規宛先/API/capability/依存を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 両接続で source 別読み上げトグル（片方 OFF で読み上げされない・表示は残る）を
                                         #   目視（実配信が必要）
```

## 実装後に必要なレビュー

- security-review（軽）: **frontend の設定/表示追加のみで外部通信宛先・API・capability・依存が不変**であること、
  VOICEVOX の loopback 例外を広げていないこと、コメント本文をログ/DB に出していないことを確認する。
