# 040b ROM勢一覧 UI（突合＋表示）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [040](040-lurker-list.md) を正とする。
>
> **必読前提**: 親 [040](040-lurker-list.md)、chatters 取得 [040a](040a-sidecar-twitch-chatters.md)（`chatters.snapshot` フレームの正）、
> 視聴者メモリ [038](038-viewer-memory.md)（コメント済み突合）、コメビュ画面 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、
> コメント受信 [`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts)、[`docs/security.md`](../security.md)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

040a が配信する chatters（チャット接続中ユーザー）から、**その配信でコメントした人を差し引いた ROM 勢一覧**をコメントビューアに表示する。

## 現在の前提（調査結果）

- 040a が `chatters.snapshot`（ログイン名一覧＋取得時刻）を loopback WS で viewer に配信する（overlay には送らない）。
- コメント受信は `connectCommentStream`（[`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts)）。現行セッションのコメント済みユーザーはここから、
  過去分は [038](038-viewer-memory.md) の視聴者メモリ（`list_viewers`）から取得できる。
- 権限不足（broadcaster/moderator でない）・YouTube 時は 040a がスキップ理由を state で伝える（それを UI で明示する）。

## このタスクでやること

### ROM 抽出（突合）

- `chatters.snapshot` の集合から、**その配信でコメント済み**のユーザーを差し引く: 現行セッションのコメント投稿者＋（任意で）[038](038-viewer-memory.md) の視聴者メモリで
  当該配信にコメントがある人。残り＝ROM 勢。ユーザー同定は Twitch のログイン名/ユーザー ID で行う（コメントの `author.id`/name と整合）。

### ROM 勢一覧 UI

- コメビュに ROM 勢一覧ビュー（または視聴者ビュー内のタブ）を追加。ログイン名・（あれば 038 のメモ/初見情報）を表示。取得時刻・件数も示す。
- **前提の明示**: Twitch のみ・自/モデレータ channel のみ・「チャット接続者の近似」であることを UI に注記。取得不可時（YouTube／権限なし）は理由を表示して一覧は出さない。

## このタスクでやらないこと

- chatters 取得・スコープ・ポーリング（040a）。overlay への表示。永続化（必要なら 038 の範囲）。
- 他人チャンネルでの取得。完全な視聴者計測（API 上不可・近似のみ）。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示＋突合のみ**。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- chatters/ROM 一覧は画面表示のみ（端末外に出さない・§9）。ログに出さない。

## 完了条件

- Twitch・自channel で、chatters からコメント済みを除いた ROM 勢一覧が表示される。取得不可（YouTube/権限なし）は理由が明示され一覧は出ない。
- 「近似・Twitch/自channel 限定」の注記が UI にある。新規宛先/API/capability/依存の追加が無い。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 自 Twitch 配信で ROM 勢一覧（chatters − コメント済み）が出ること、
                                         #   コメントした人が一覧から消えること、YouTube/権限なしで理由表示になることを確認
```

## 実装後に必要なレビュー

- security-review（軽）: frontend 表示＋突合のみで外部通信宛先・API・capability・依存が不変であること、chatters/ROM 一覧を端末外/ログに出さないことを確認する。
