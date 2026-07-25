# 043c オーバーレイ 投げ銭コメントの強調（現行意匠・単独）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [043](043-monetary-emphasis.md) を正とする。**本タスクは保留中の [037b](037b-overlay-monetary-highlight-design.md) を supersede する**（037a 意匠選択機構には依存しない）。
>
> **必読前提**: 親 [043](043-monetary-emphasis.md)、supersede 元 [037b](037b-overlay-monetary-highlight-design.md)、
> 描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)（`renderOverlayItem`）、意匠 [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)、
> ワイヤ契約 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)（`event_type`/`monetary`）、[`docs/security.md`](../security.md)（CSP方針・036a の data URI ガード）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

OBS オーバーレイで、**お金が投げられたコメント（スパチャ／ビッツ／サブスク／メンシプ／ギフト）を目立つ意匠に差し替える**（要望④）。
配信画面上でも投げ銭が来たことが一目で分かるようにし、視聴者の投げ銭が埋もれないようにする。**現行のオーバーレイ意匠に相乗り**する強調として実装し、
037a（意匠選択機構）には依存しない。

## 現在の前提（調査結果・実コード）

- オーバーレイ描画は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderOverlayItem`（153-196 行・`variant="overlay"`）。
  **`event_type` で見た目を分けておらず `monetary_amount` も表示していない**（全コメントが同じ吹き出し）。オーバーレイ窓は [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx) が read-only で映す表示専用。
- オーバーレイ意匠 CSS は [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)。色は [`theme.css`](../../apps/desktop/src/styles/theme.css) の `--overlay-*` トークン（OBS 上で一定・アプリのライト/ダークに非依存）。
- `event_type`（`chat/superchat/membership/subscription`＋043a でギフト等）と `monetary { amount, currency }`／`monetaryAmount` は wire で届いている。ビッツは `currency==="BITS"`。
- 036a のガード: `<img>`/`background-image` に差すのは `data:` 始まりのときのみ（`renderOverlayItem` 159-161 行）。強調でも維持する。

## このタスクでやること

### 投げ銭判定と強調（renderOverlayItem）

- `renderOverlayItem`（153-196 行）で `c.event_type !== "chat"` のコメントに**強調用クラスを重ねる**（種別で色分けが要るなら superchat/subscription/membership/gift のバリアント）。
- `monetaryAmount` があれば**金額を目立つバッジ**でオーバーレイに表示（オーバーレイではこれまで未表示のため新規追加）。金額の無い種別（メンシプ加入・ギフト等）は種別ラベル/アイコン的強調で代替。
- 043a の新種別（membership/gift）が来ればそれで色分け・ラベルする。未了なら現行 `subscription` を強調（見逃し解消を優先）。

### 強調スタイル（CSS / トークン）

- [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css) に強調スタイル（縁取り・グロー・金額バッジ）を追加。**背景透過運用と両立**するよう半透過の縁取り/グロー等で「投げ銭が来た」ことが一目で分かる意匠にする。色は `--overlay-*` トークンを使い、不足分は [`theme.css`](../../apps/desktop/src/styles/theme.css) の overlay トークンに追加する。

## このタスクでやらないこと

- **037a（意匠選択機構）に依存しない・作らない**（保留のまま）。sidecar / wire / Rust の変更（**043a**）。コメビュ本体の意匠（**043b**）。
- 通貨換算・集計（038 の領分）。音・アニメーション演出の作り込み（強調表示に留める）。YouTube のギフトメンシプ／Jewels（`giftEvent`）は
  API には存在するが現状未受信＝取得は [043d](043d-youtube-jewels-gift-membership.md)。第三者投げ銭連携は対象外。

## セキュリティ制約（docs/security.md 準拠・CSP方針）

- **frontend の表示分岐追加のみ**。外部通信宛先・API・capability・依存・CSP を増やさない（§1/§3/§10・CSP方針）。`csp: null` 不変。
- `<img>`/`background-image` は data URI のみ（036a のガード維持）。取得コメント（本文・金額）を Rust の DB/ログに出さない（§9・既存踏襲）。

## 完了条件

- スパチャ／ビッツ／サブスク／メンシプ／ギフトのコメントが、オーバーレイの現行意匠上で**強調表示**される（金額がある種別は金額バッジ）。通常 chat は従来どおり（強調なし）で表示が壊れない。
- 背景透過運用（OBS ウィンドウキャプチャ）と両立する（強調で背景が不透明化しない）。
- 037a に依存していない。新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。**037b が supersede 済みであることを task-board に反映**。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # オーバーレイを開き、投げ銭種別のダミー/実コメントで強調意匠＋金額バッジが出ること、
                                         #   通常 chat は従来どおり・背景透過が保たれることを目視（OBS ウィンドウキャプチャで合成確認）
```

## 実装後に必要なレビュー

- 軽レビュー: frontend 表示分岐のみで外部通信宛先・API・capability・依存・CSP が不変であること、`<img>`/`background-image` が data URI のみであること、コメント本文/金額を DB/ログに出していないことを確認する。
