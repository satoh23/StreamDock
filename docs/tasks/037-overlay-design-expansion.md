# 037 OBSオーバーレイ 意匠の拡張（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 037a〜037b の**分割・線引き・実装順の正**。
>
> **必読前提**: オーバーレイ意匠の現行 [034e](034e-overlay-design-refresh.md)（アイコン＋吹き出し・サイト名トグル・フォント選択）、
> アバター描画 [036a](036a-avatar-wire-and-overlay-render.md)（overlay の `<img>`/data URI 分岐）、
> [`docs/security.md`](../security.md)（特に「## CSP方針」＝外部 script/style/image/font を増やさない）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

OBS 透過オーバーレイ（label `comment-overlay` / [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)）の
コメント意匠を **ユーザーが複数から選べる**ようにし、次の 2 意匠を追加する。

1. **シンプル意匠**（037a）: ユーザー名＋コメントのみを表示。背景透過・白い細めの文字（アイコン/吹き出し無し）。
2. **投げ銭強調意匠**（037b）: スパチャ／サブスク／ビッツなど**お金が投げられたコメント**を、どの意匠でも目立つデザインに差し替える。

task-board.md の Todo「（将来）OBSオーバーレイ 複数デザイン＋プレビュー選択 UI」を本タスクで実体化する。

## 現在の前提（調査結果）

- オーバーレイの意匠は **`CommentList.tsx` の `variant` が `"default" | "overlay"` のコード固定 2 種**
  （[`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) 60・101 行の `renderOverlayItem`）。
  ユーザーが選べる「意匠選択機構」は存在しない。overlay 意匠の CSS は
  [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)、
  色は `theme.css` の `--overlay-*` トークン（OBS 映像上で一定・アプリのライト/ダークに非依存）。
- オーバーレイの表示設定（フォント・サイト名表示）は **localStorage を単一の伝播経路**にしている
  （[`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)・設定窓が `save*`／オーバーレイ窓が
  `storage` イベントで受信）。選択 UI は設定ビューの「OBSオーバーレイ」カード
  （[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 357-411 行）。
- コメント種別 `event_type`（`chat / superchat / membership / subscription`）と `monetary_amount`（整形済み文字列・例 "100 bits"）は
  **既にワイヤ契約で全層に届いている**（[`model.rs`](../../apps/desktop/src-tauri/src/comment_viewer/model.rs) 26-31・64-66 行）。
  → **投げ銭強調はデータ取得の追加なしで実装できる**（表示分岐のみ）。

## 確定した方針

- **意匠 ID のレジストリ＋選択機構を新設**する。既存 `OVERLAY_FONTS`（[`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)）と
  同方式で `OVERLAY_DESIGNS`（id/label と描画分岐キー）を定義し、`load/saveOverlayDesign`（localStorage キー
  `stream-dock.comment-viewer.overlay-design`・既定は現行意匠）で永続化する。設定ビューにフォント選択と同じ `Select` で
  意匠選択を追加し、オーバーレイ窓（`OverlayApp`）が `storage` 購読で即反映する（既存フォント/サイト名と完全同型）。
- **描画は `CommentList.tsx` の overlay 分岐を意匠 ID で切り替える**。既存の `renderOverlayItem`（アイコン＋吹き出し）は
  意匠の 1 つとして残し、新意匠を関数分岐で追加する。CSS は `OverlayComment.module.css` を拡張するか意匠別 module を追加し、
  色は `--overlay-*` トークンを踏襲（新規トークンが要る場合は `theme.css` に追加）。
- **投げ銭強調（037b）は意匠に直交する装飾**として実装する。選択中の意匠に関わらず、`event_type != "chat"`（＝スパチャ/サブスク/
  ビッツ/メンシプ）のコメントに強調クラスを重ねる。`monetary_amount` があれば金額を強調表示する。
- **表示専用・外部通信ゼロ・CSP 不変・capabilities 不変・依存追加なし**。data URI 以外を `<img>`/`background-image` に踏ませない
  036a の最終防波堤は維持する。すべて frontend 内で完結し、sidecar / Rust / メイン窓の no-internet 境界に影響しない。

## サブタスク分割

| ID | 内容 | 外部通信（新規） | security-review |
|----|------|-----------------|-----------------|
| [037a](037a-overlay-design-selector-and-minimal-design.md) | 意匠選択機構の新設（`OVERLAY_DESIGNS` レジストリ＋localStorage 永続＋設定 UI＋`storage` 反映）＋シンプル意匠（ユーザー名＋コメントのみ・背景透過・白い細字）の追加 | なし | 軽（表示/設定のみ） |
| [037b](037b-overlay-monetary-highlight-design.md) | 投げ銭コメント（`event_type` が superchat/subscription/membership）の強調意匠（枠/背景/金額バッジ）を全意匠に相乗り | なし | 軽（表示のみ） |

## 依存関係と推奨実装順

```
037a → 037b
```

- **037a が土台**（意匠選択機構＋描画分岐＋第 1 の新意匠）。これが入ると意匠を切り替えられる状態になる。
- **037b** は 037a の overlay 描画分岐に強調装飾を相乗りさせる（意匠と直交）。単体でも成立するが、描画分岐が整った 037a の後が素直。

## 横断セキュリティ方針（docs/security.md 準拠）

- **frontend の表示・設定追加のみ**。外部通信宛先・API・capability・依存・CSP を一切増やさない（§1/§3/§10・CSP方針）。
- localStorage は非機密の UI 設定値のみ（`overlaySettings.ts` の既存方針踏襲・外部送信しない）。
- `<img>`/`background-image` が踏むのは data URI のみ（036a の型ガード維持）。新意匠でも外部 URL を踏ませない。
- 取得コメント（本文・data URI）を Rust の DB/ログに保存しない（§9）は不変（本タスクは表示のみで永続化しない）。

## 完了条件

- 037a〜037b のタスクファイルが本親の分割・依存どおりに存在し、各々が既存フォーマット（[036a](036a-avatar-wire-and-overlay-render.md) 等）に沿う。
- [`docs/task-board.md`](../task-board.md) に 037 系が追記され、Todo の「複数デザイン＋プレビュー選択 UI」が本タスクで解消と注記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。
- 各サブタスク完了時に [`docs/progress.md`](../progress.md) を更新する（各ファイルの完了条件に含む）。

## このタスク（親）でやらないこと

- コード実装（037a〜b それぞれで行う）。
- **意匠プレビュー用の画像/GIF アセット同梱**（Todo の「画像/GIF で選ぶ」まではやらない。選択はラベル＋テキストプレビューに留める）。
- コメビュ本体（`variant="default"` / `renderDefaultItem`）の意匠変更（本タスクは overlay 意匠のみ）。
- 新しい配信プラットフォームの追加・新規データ取得（既存の `event_type`/`monetary_amount` の表示のみ）。
