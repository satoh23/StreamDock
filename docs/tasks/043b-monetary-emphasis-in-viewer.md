# 043b コメビュ本体の投げ銭強調＋種別ラベル表示

> ⚠ **意匠は 047b（2026-07-29）で置き換わった**。本タスクが導入した**赤枠強調（`.itemMonetary`）＋琥珀の
> 種別バッジ（`.badgeEvent`）は削除済み**で、現在の課金コメント行は **OBS オーバーレイと同じ YouTube スパチャ風の
> ティア色カード**（`.itemTipCard` ＋ tone クラス・色帯ヘッダ＋淡色ボディ）で描かれる。実機で「赤枠は見にくく、
> 金額の大小が分からない」となったため、色そのものに金額の情報を持たせる方向へ移した
> （「お金の見逃し防止」という 043b の**目的は不変**で、達成手段だけが変わった）。
> 種別ラベル・金額・要約文言・初見/久しぶりバッジは**すべてカードのヘッダ帯へ移設して残っている**。
> 現在の正は [`docs/progress.md`](../progress.md) の「047b 課金コメントの YouTube 意匠化」節。
>
> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [043](043-monetary-emphasis.md) を正とする。
>
> **必読前提**: 親 [043](043-monetary-emphasis.md)、取得精緻化 [043a](043a-monetary-ingestion-fidelity.md)（種別語彙の正・ただし本タスクは 043a 未了でも成立）、
> 描画 [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx)、整形 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)、
> ワイヤ契約 [`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs)（`event_type`/`monetary`）、[`docs/security.md`](../security.md)。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

配信者だけが見るコメビュ**本体**で、**お金がかかっているコメントを絶対に見逃さない**ようにする（要望⑤）。スパチャ・ビッツだけでなく、
サブスク・メンシプ・ギフトも通常コメントと視覚的に区別し、**枠色＋種別ラベル＋金額**で強調する。

## 現在の前提（調査結果・実コード）

- 本体描画は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderDefaultItem`（99-148 行・`variant="default"`）。
  - **`event_type` で分岐していない**。`monetaryAmount` があるときだけ `.amount` バッジ（141-143 行）を出すのみ。
  - そのため **サブスク/メンシプ/ギフト（金額文字列なし）は通常コメントと同じ見た目**で埋もれる。ビッツ/スパチャも小バッジだけで目立たない。
- 既存の視聴者メモリ整形 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) にラベル（スーパーチャット/ビッツ/サブスク/メンバーシップ・18-21 行）と金額整形（`fmtSuperchat` 40-41 行）があり、**流用**できる。
- 型は `CommentViewDto`（`event_type: "chat"|"superchat"|"membership"|"subscription"`、`monetary { amount, currency }`、`monetaryAmount`）。ビッツは `currency === "BITS"` で判別。
- スタイルは [`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css) の `.item`/`.meta`/`.amount`／役割トークン（[`theme.css`](../../apps/desktop/src/styles/theme.css)）。038c が同 `renderDefaultItem` に枠色クラス（`itemFirstTime`/`itemLongAbsence`）を条件付与する設計なので**共存**させる。

## このタスクでやること

### 投げ銭判定と強調（CommentList.tsx / renderDefaultItem）

- `renderDefaultItem` を `event_type` で分岐させ、**`event_type !== "chat"` の行に強調**を付与する（`<li>` に強調クラスを重ねる・038c の枠色クラスと両立）。
- **種別ラベル**をバッジで表示: スパチャ／ビッツ（`currency==="BITS"`）／サブスク／メンシプ／ギフト（043a の語彙が来ればそれで判別、未了なら現行 `subscription` を「サブスク」系として表示）。ラベル/金額整形は [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) の既存 util を流用する（重複実装しない）。
- **金額**は `monetaryAmount`（整形済み文字列）を優先表示。スパチャは金額帯に応じて強調度を上げる意匠（YouTube 風の段階色など）を検討（見逃さないことが主目的）。金額の無い種別（メンシプ加入等）は種別ラベル＋枠色で強調。

### 強調スタイル（CSS / トークン）

- [`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css) に投げ銭強調（枠・背景・金額バッジ）を追加。色は役割トークン（[`theme.css`](../../apps/desktop/src/styles/theme.css)）を使い、不足分はトークンを追加（アプリのライト/ダーク両テーマに追従）。038c の枠色と重なっても破綻しないよう優先/重ね順を決める。

## このタスクでやらないこと

- sidecar / wire / Rust の変更（**043a**）。オーバーレイの強調（**043c**）。
- 通貨換算・投げ銭の集計/履歴 UI（038 視聴者メモリの領分）。音/アニメ演出の作り込み。
- YouTube のギフトメンシプ／Jewels（`giftEvent`）は API には存在するが現状未受信＝取得は [043d](043d-youtube-jewels-gift-membership.md)。第三者投げ銭連携は対象外。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示分岐追加のみ**。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 取得コメント（本文・金額）を Rust の DB/ログに出さない（§9・既存踏襲）。

## 完了条件

- スパチャ／ビッツ／サブスク／メンシプ／ギフトのコメントが、本体で**枠色＋種別ラベル（＋金額）**で強調され、通常チャットは従来どおり（強調なし）で表示が壊れない。
- 038c の初見/久しぶり枠色と共存して破綻しない。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 投げ銭種別（superchat/bits/subscription/membership/gift）のダミー/実コメントで
                                         #   枠色＋種別ラベル＋金額が出ること、通常 chat は従来どおりを目視
```

## 実装後に必要なレビュー

- 軽レビュー: frontend 表示分岐のみで外部通信宛先・API・capability・依存が不変であること、コメント本文/金額を DB/ログに出していないこと、038c の枠色と共存して既存 default 意匠を壊していないことを確認する。
