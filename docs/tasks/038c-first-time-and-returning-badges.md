# 038c 初見／久しぶり バッジ＋枠色

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [038](038-viewer-memory.md) を正とする。
>
> **必読前提**: 親 [038](038-viewer-memory.md)、データ基盤 [038a](038a-viewer-memory-data-layer.md)（`first_seen_at`/`last_comment_at` の正）、
> コメント描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)、[`docs/security.md`](../security.md)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

コメントビューア（配信者だけが見る画面）で、**初見**の人と**久しぶり**の人が一目で分かるようにする。該当コメントの
枠に色を付け、「初見」「久しぶり」バッジを表示する。

- **初見**: その視聴者の**初めてのコメント**（過去に記録が無い）。
- **久しぶり**: **最後にコメントした日から 1 ヶ月以上経過した後の、最初のコメント**。

## 現在の前提（調査結果）

- 038a が視聴者ごとの `first_seen_at` / `last_comment_at` を保持し、`record_comment` 時に更新する。→ **判定は「記録前の状態」を使う**必要がある
  （upsert 前の last_comment_at と今回コメント時刻を比較）。判定結果の受け渡し方（`record_comment` の戻り値で `firstTime`/`longAbsence` を返す等）は
  038a と整合させる（本タスクで必要なら 038a のコマンド戻り値に判定フラグを含める）。
- コメビュ本体の描画は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderDefaultItem`（83-96 行）。
  バッジ/枠色クラスはここに条件付与する。色は `CommentViewerApp.module.css` の役割トークン。
- 「久しぶり」の 1 ヶ月境界は `last_comment_at` と現在時刻の差で判定（初コメントは「初見」が優先で「久しぶり」は付けない）。

## このタスクでやること

### 判定（038a データに基づく）

- 受信コメントに対し、その視聴者の**記録前の** `last_comment_at` を参照して判定する:
  - 記録が無ければ **初見**。
  - 記録があり `now - last_comment_at >= 1 ヶ月` なら **久しぶり**（その配信でのその人の最初のコメントに 1 回だけ）。
  - それ以外はバッジ無し。
- 判定は 038a の Rust 側（保存直前の状態を持つ）で行い戻り値/イベントで frontend に渡すのが正確。frontend 単独判定にすると再起動後の
  `last_comment_at` を持たず不正確になるため、**038a 側で判定して結果を返す**方式を基本とする（本タスクで 038a のコマンド戻り値拡張が要れば明記）。

### 表示（CommentList.tsx / CSS）

- コメビュ本体（`variant="default"`）のコメント行に、判定に応じて **枠色**（初見/久しぶりで色分け）と **バッジ**（「初見」「久しぶり」）を付与。
- 同一視聴者の 2 回目以降のコメント（同一配信内）にはバッジを付けない（初回のみ）。既存の default 意匠を壊さない（該当時のみ装飾を重ねる）。

## このタスクでやらないこと

- 保存・集計・判定データの永続化（038a）。視聴者一覧/詳細 UI（038b）。オーバーレイ側の表示（本タスクはコメビュ本体のみ）。
- 「久しぶり」閾値のユーザー設定化（1 ヶ月固定。設定化は将来タスク）。

## セキュリティ制約（docs/security.md 準拠）

- **frontend 表示（＋038a の判定結果消費）のみ**。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 判定に使う時刻/日時は端末内データのみ。視聴者データを端末外/ログに出さない（§9）。

## 完了条件

- 初コメントに「初見」、最終コメントから 1 ヶ月以上後の初コメントに「久しぶり」バッジ＋枠色が付く。通常コメントは従来どおり表示が壊れない。
- 判定が再起動をまたいでも正しい（`last_comment_at` を 038a の永続データから参照）。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint`（038a の戻り値拡張を伴う場合は `cargo check`）が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 新規視聴者→「初見」、last_comment_at を 1 ヶ月以上前に細工した視聴者の新規コメント→
                                         #   「久しぶり」バッジ＋枠色が出ること、既存常連はバッジ無しを目視
```

## 実装後に必要なレビュー

- security-review（軽）: frontend 表示＋判定結果消費のみで外部通信宛先・API・capability・依存が不変であること、
  判定データを端末外/ログに出さないことを確認する。
