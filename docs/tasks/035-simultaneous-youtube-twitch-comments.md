# 035 YouTube+Twitch コメント同時取得・マージ表示（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 035a〜035c の**分割・線引き・実装順の正**。
>
> **必読前提**: コメントビューアの土台 [032c](032c-comment-viewer-voicevox-design.md)（親設計）・
> [032c-b](032c-b-node-sidecar-twitch-comments.md)（Twitch/sidecar 初解禁）・[032c-d](032c-d-youtube-comments.md)
> （YouTube 追加）、UX 系 [033](033-comment-viewer-ux-revamp.md)・[034](034-comment-viewer-obs-ux-round2.md)、
> [`docs/security.md`](../security.md)（特に「## コメントビューア（配信サービス連携）方針」＝**現状は「Twitch と YouTube は
> 併存し各サービス個別選択（同時取得・マージ表示はしない）」と明文化**）。CLAUDE.md どおり **「実装して」まで
> コードは変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

内蔵コメントビューア（label `comment-viewer` / [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)）
と OBS 透過オーバーレイ（label `comment-overlay` / [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)）で、
**Twitch と YouTube のコメントを同時に取得し、1 つのリストにマージ表示**できるようにする。現状は sidecar が
**「同時取得しない・1 つだけ」**（片方の取得開始が他方を abort）に制限しており、配信者は両プラットフォームを同時に
拾えない。この制限を外し、両サービス視聴者のコメントを漏らさず表示・読み上げできる水準にする。

## 確定した方針

- **セキュリティ方針を反転する**: [`docs/security.md`](../security.md) の「## コメントビューア（配信サービス連携）方針」に
  ある **「同時取得・マージ表示はしない」を「同時取得・マージ表示する」へ更新**する（文言更新は 035a で実施）。
  **これは方針変更であり security-review 必須**。ただし**新規の外部通信宛先は増やさない**（Twitch/YouTube の宛先は
  032c-b/032c-d で既に allow-list 済み）。二層 fail-closed（env ピン留め＋ホスト/gRPC チャネルガード）・loopback WS・
  **main 窓と Rust の no-internet 維持**は不変。同時取得は「既存の 2 パイプラインを並行に走らせる」だけで、通信面の
  拡大ではない。
- **コアは sidecar の 1 箇所**: [`apps/comment-sidecar/src/index.ts`](../../apps/comment-sidecar/src/index.ts) の単一
  `sessionAbort`/`activeSessionPlatform`（237-346行）が唯一の排他点。これを **provider 別**にすれば両パイプラインが並行
  稼働できる（035a）。取得パイプライン本体（`runTwitchPipeline`/`runYouTubePipeline`）は独立した `outputPort`＋`signal`
  を取り、直列化していない。
- **表示層は変更不要（既にマージ対応）**: [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts)
  は source 非依存で id 重複排除しつつ末尾 append（上限 200）、[`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)
  は `source` バッジ（Twitch/YouTube）を持ち、WS はブロードキャストで viewer/overlay の両窓へ届く。よって 035b は
  **同時表示の検証と UI 微調整**が中心。
- **1 タスク 1 機能で分割**（CLAUDE.md）。035a〜c ＋ 本親 035。ユーザー選択「フル一式」に従い TTS ソース別フィルタ（035c）を含む。

## サブタスク分割

| ID | 内容 | 対象問題 | security-review |
|----|------|---------|-----------------|
| [035a](035a-sidecar-concurrent-sessions.md) | sidecar のセッション排他を provider 別化（`Map<Provider, AbortController>`）＋security.md 方針を「同時取得する」へ更新 | 同時取得できない（排他） | **必須**（方針反転・並行 egress） |
| [035b](035b-viewer-overlay-simultaneous-display.md) | viewer/overlay の同時表示 検証＋UI 微調整（両接続インジケータ・source バッジ常時表示・片方 stop の UX） | mixed 表示の見え方 | 不要〜軽（表示のみ） |
| [035c](035c-tts-source-filter.md) | TTS ソース別読み上げフィルタ（source 別 読み上げ ON/OFF） | 両稼働時の読み上げ暴発 | 軽（表示/設定・宛先不変） |

## 依存関係と推奨実装順

```
035a → 035b → 035c
```

- **035a が土台**（これで両セッション並行が可能になる）。**035b** は 035a 後に「両稼働時の表示」を検証・調整。
  **035c** は 035a/035b 後に、両稼働で顕在化する「読み上げ暴発」を制御する。
- 035b は既存のマージ/バッジ/ブロードキャストを再利用するため実装量は小さい見込み（検証中心）。

## 横断セキュリティ方針（docs/security.md 準拠）

- **新規宛先を増やさない**。同時取得は既存の Twitch/YouTube 宛先（allow-list 済み）への **並行接続**であり、
  ホストガード・gRPC チャネルガード・env ピン留めのロジックは**一切変更しない**（035a はセッション管理のみ）。
- **main 窓と Rust の no-internet 維持**・loopback WS（`ws://127.0.0.1:<port>`）・token/device_code 非ログは不変。
  取得コメント本文は端末外に出さない（既存踏襲）。
- **方針文言の更新は 035a で実施**（「同時取得・マージ表示はしない」→「する」）。並行 egress・リソース増（CPU/メモリ/
  ソケットが 2 セッション分）の留意点も同時に追記する。YouTube クォータの枯渇時 graceful stop は 032c-d で既実装のため、
  035 系で新規宛先・クォータ算定/監視ロジックは変更しない（Twitch 併走は YouTube クォータに影響しない）。
- 新規 npm/crate/plugin・`csp` 変更は入れない。

## 完了条件

- 035a〜035c のタスクファイルが本親の分割・依存どおりに存在し、各々が既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 035 系が追記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。
- 各サブタスク完了時に [`docs/progress.md`](../progress.md) を更新する（各ファイルの完了条件に含む）。

## このタスク（親）でやらないこと

- コード実装（035a〜c それぞれで行う）。
- **新しい配信プラットフォームの追加**（Twitch/YouTube の 2 者に限定）。
- **新規の外部通信宛先・host-guard/gRPC ガードのロジック変更**（同時取得はセッション管理の変更のみ）。
- **Rust 側の no-internet 方針変更**（通信は sidecar と viewer webview に封じ込めたまま）。
- overlay の意匠刷新（034e 済み）・複数デザイン選択 UI（将来枠）。
