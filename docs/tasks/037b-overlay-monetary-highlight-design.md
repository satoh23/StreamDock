# 037b オーバーレイ 投げ銭メッセージの強調意匠

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [037](037-overlay-design-expansion.md) を正とする。
>
> **必読前提**: 親 [037](037-overlay-design-expansion.md)、意匠選択機構 [037a](037a-overlay-design-selector-and-minimal-design.md)、
> ワイヤ契約 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)（`event_type`/`monetary_amount`）、
> [`docs/security.md`](../security.md)（CSP方針）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

オーバーレイで、**お金が投げられたコメント（スーパーチャット／サブスク・メンバーシップ／ビッツ）を目立つデザインに差し替える**。
選択中の意匠（037a のシンプル／既存のアイコン＋吹き出し）に関わらず適用される、意匠と直交する強調装飾として実装する。

## 現在の前提（調査結果）

- `event_type`（`chat / superchat / membership / subscription`）と `monetary_amount`（整形済み文字列・例 "100 bits"）は
  **既にワイヤ契約で全層に届いている**（[`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) 26-31・64-66 行、
  bindings `CommentEventType.ts` / `CommentViewDto.ts`）。sidecar 側で Twitch cheer→bits・YouTube SUPER_CHAT/STICKER・
  各種サブスク通知が既にこれらへマッピング済み（追加取得は不要）。
- 現状オーバーレイ描画（[`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderOverlayItem` 101-144 行）は
  **`event_type` で見た目を分けていない**（`monetary_amount` も overlay 意匠では未表示）。コメビュ本体の `renderDefaultItem`（83-96 行）は
  `monetary_amount` を `.amount` バッジで表示している（overlay には未反映）。
- overlay 意匠 CSS は [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)、色は `theme.css` の `--overlay-*` トークン。

## このタスクでやること

### 投げ銭判定と強調クラスの付与（CommentList.tsx）

- overlay 描画で `c.event_type !== "chat"`（＝ superchat / subscription / membership）のコメントに**強調用クラスを重ねる**。
  037a で導入した意匠分岐（`renderOverlayItem` / `renderMinimalItem`）の**両方**に効くよう、item 要素へ共通の
  `styles.monetary`（＋種別で色分けが要るなら `superchat`/`subscription` バリアント）を条件付与する。
- `monetary_amount` があれば金額を**目立つバッジ**で表示（overlay ではこれまで未表示のため新規に追加）。無い種別（メンシプ加入等）は
  種別ラベルやアイコン的強調で代替する。

### 強調スタイル（CSS / トークン）

- [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css) に強調スタイル（枠・背景・金額バッジ）を追加。
  背景透過運用と両立するよう、半透過の縁取り/グロー等で「投げ銭が来た」ことが一目で分かる意匠にする。色は `--overlay-*` トークンを使い、
  不足分は `theme.css` の overlay トークンに追加する（OBS 上で一定・アプリのライト/ダークに非依存）。

## このタスクでやらないこと

- 新規データ取得・`event_type`/`monetary_amount` の意味変更（表示分岐のみ）。sidecar / Rust 変更。
- コメビュ本体（`variant="default"`）の投げ銭意匠変更（本タスクは overlay のみ）。
- 金額の通貨換算・集計（集計・履歴は 038 視聴者メモリの領分）。
- 音・アニメーション演出の作り込み（強調表示に留める。演出強化は将来タスク）。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示分岐追加のみ**。外部通信宛先・API・capability・依存・CSP を増やさない（§1/§3/§10・CSP方針）。`csp: null` 不変。
- `<img>`/`background-image` は data URI のみ（036a のガード維持）。
- 取得コメント（本文・金額）を Rust の DB/ログに出さない（§9・既存踏襲）。

## 完了条件

- スパチャ／サブスク・メンシプ／ビッツのコメントが、選択中の意匠（シンプル／アイコン＋吹き出し）いずれでも強調表示される。
- `monetary_amount` がある種別は金額バッジが出て、通常チャットは従来どおり（強調なし）で表示が壊れない。
- 新規宛先/API/capability/依存を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # overlay を開き、投げ銭種別（superchat/subscription/membership）の
                                         #   ダミーコメントで強調意匠＋金額バッジが出ること、通常 chat は従来どおりを目視
```

## 実装後に必要なレビュー

- security-review（軽）: frontend 表示分岐のみで外部通信宛先・API・capability・依存・CSP が不変であること、
  コメント本文/金額を DB/ログに出していないことを確認する。
