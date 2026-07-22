# 040 ROM勢一覧（親・設計/方針・Twitch 限定・スパイク先行）

> 状態: **未着手（親ドキュメント）**。本ファイルは 040a〜040b の**分割・線引き・実装順の正**。
>
> **必読前提**: sidecar のセッション制御 [`apps/comment-sidecar/src/index.ts`](../../apps/comment-sidecar/src/index.ts)（provider 別 `Map<Provider, AbortController>`・035a）、
> Twitch スコープ [`apps/comment-sidecar/src/twitch-config.ts`](../../apps/comment-sidecar/src/twitch-config.ts)（29 行 `TWITCH_SCOPES=["user:read:chat"]`）、
> Twitch Helix クライアント [`helix.client.ts`](../../apps/comment-sidecar/vendor/comment-fetcher/src/adapters/twitch/client/helix.client.ts)、視聴者メモリ [038](038-viewer-memory.md)（コメント済み突合）、
> [`docs/security.md`](../security.md)（**「## コメントビューア（配信サービス連携）方針」441 行・新規スコープは allow-list/fail-closed・レビュー必須**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

コメントビューア（配信者だけが見る画面）に、**コメントはしていないが配信を見ている視聴者（ROM 勢）の一覧**を表示する機能を追加する。

## 現在の前提（調査結果・実現性の限界）

- **視聴者一覧／ROM 取得のコードは皆無**。取得はコメント（チャット/投げ銭/サブスク）のみ。
- **YouTube は視聴者一覧 API が存在しない**（同時視聴者「数」は取れるが「誰が見ているか」の一覧は取得不可）。→ **YouTube は対象外**とする。
- **Twitch は Helix `Get Chatters`（`GET /helix/chat/chatters`）が唯一の手段**。取得できるのは**チャットルームに接続中のユーザー**（＝チャットを開いている
  非コメント者 ≒ ROM の**近似**）。**制約**:
  - スコープ **`moderator:read:chatters`** が必要（現状 `TWITCH_SCOPES=["user:read:chat"]` のみ）。
  - 認証ユーザーが対象チャンネルの **broadcaster または moderator** である必要がある → **自分のチャンネル（またはモデレータ権限のあるチャンネル）でのみ機能する**。
    コメビュの Twitch はチャンネル名入力式のため、他人のチャンネルに繋いだ場合は取得できない旨を UI で明示する。
  - `broadcaster_id` はチャンネル名から Helix `users` で解決（036c で既に Helix `users` を使用）。`moderator_id` は認証ユーザー ID。
  - 「チャットを開かず視聴（埋め込み等）」の視聴者は含まれない＝**完全な視聴者一覧ではない**（近似）。レート/ページングにも配慮が要る。

## 確定した方針

- **まず親でスパイク（実現性確認）を行ってから 040a に進む**。スパイクで次を確定する:
  - `moderator:read:chatters` スコープ追加でトークン取得〜`Get Chatters` 呼び出しが実際に通るか（自チャンネルで）。
  - ポーリング間隔（レート制限に配慮した既定・例 30〜60s）とページング上限の扱い。
  - 「近似」であること（チャット接続者のみ・自/モデレータ channel 限定）の UI 上の明示方針。
- **取得はすべて Node sidecar 側に閉じる**（既存の no-internet 境界・fail-closed ホストガード踏襲）。宛先 `api.twitch.tv` は 032c-b で allow-list 済み。
  **新規スコープ追加＝方針変更のため 040a は security-review 必須**、security.md「## コメントビューア方針」に chatters 取得とスコープを明文化する。
- **ROM の抽出（突合）は frontend 側**で行う: 040a が届ける chatters（ログイン名一覧）から、**その配信でコメント済み**の人（現行セッションのコメント＋
  [038](038-viewer-memory.md) の視聴者メモリ）を差し引いて ROM 一覧を作る。040b で表示する。
- **Twitch セッション時のみ・自/モデレータ channel でのみ**機能を出す。取得不可時は理由（YouTube 非対応／権限なし）を UI で示す。

## サブタスク分割

| ID | 内容 | 外部通信（新規） | security-review |
|----|------|-----------------|-----------------|
| [040a](040a-sidecar-twitch-chatters.md) | sidecar: `moderator:read:chatters` スコープ追加＋Helix `Get Chatters` の定期ポーリング（broadcaster_id 解決・ページング・レート配慮）＋chatters を loopback で viewer へ配信＋security.md/スコープ更新 | あり（Helix chatters・新規スコープ） | **必須**（新規スコープ・方針変更） |
| [040b](040b-lurker-list-ui.md) | ROM 抽出（chatters − コメント済み〔セッション＋038 視聴者メモリ〕）＋ROM 勢一覧 UI（コメビュ内・Twitch/自channel 限定・近似の注記） | なし | 軽（表示＋突合） |

## 依存関係と推奨実装順

```
040(スパイク) → 040a → 040b
```

- **親でスパイク**して実現性を確定（不可なら 040a/b を保留に切替）。
- **040a** で取得基盤（スコープ＋chatters ポーリング＋配信）を作り、**040b** で突合＋UI。040b は [038](038-viewer-memory.md) の視聴者メモリを参照するため、
  番号の大小で 038 完了後に着手される。

## 横断セキュリティ方針（docs/security.md 準拠）

- **新規の外部通信（chatters 取得）は sidecar 内に閉じ、fail-closed ホストガードを通す**（§1）。宛先 `api.twitch.tv` は既存 allow-list。
- **新規スコープ `moderator:read:chatters` の追加は方針変更**。security.md「## コメントビューア方針」に追記し、**040a は security-review 必須**。スコープは必要最小に留める（§3）。
- 取得した chatters（ログイン名）は端末外に出さない・Rust の DB/ログに保存しない（§9。永続化するなら 038 視聴者メモリの範囲で・端末内限定）。
- トークンは既存の OS キーチェーン運用（[`token_vault.rs`](../../apps/desktop/src-tauri/src/comment_sidecar/token_vault.rs)）踏襲。code_verifier/secret は載せない。
- 新規 npm/crate/plugin を増やさない方針（必要なら 040a で理由を添えて提案）。

## 完了条件

- 040a〜040b のタスクファイルが本親の分割・依存どおりに存在し、既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 040 系が追記され、**Twitch 限定・近似・自/モデレータ channel 限定**という前提が明記されている。
- 本親ドキュメント自体はコードを変更しない（スパイクの結論を本ファイルに追記し、実装は各サブタスクで「実装して」後）。
- 各サブタスク完了時に [`docs/progress.md`](../progress.md) を更新する。

## このタスク（親）でやらないこと

- コード実装（040a〜b それぞれで行う。親はスパイク＝実現性確認と方針確定まで）。
- **YouTube の ROM 取得**（視聴者一覧 API が無く不可）。
- 他人のチャンネル（broadcaster/moderator 権限が無いチャンネル）での取得。
- 「チャット未接続の視聴者」まで含む完全な視聴者計測（API 上不可能・近似に留める）。
