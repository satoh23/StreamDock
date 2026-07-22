# 037a オーバーレイ意匠 選択機構＋シンプル意匠

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [037](037-overlay-design-expansion.md) を正とする。
>
> **必読前提**: 親 [037](037-overlay-design-expansion.md)、現行意匠 [034e](034e-overlay-design-refresh.md)、
> [`docs/security.md`](../security.md)（CSP方針）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

オーバーレイの意匠を**ユーザーが複数から選べる仕組み**を新設し、第 1 の新意匠「**ユーザー名＋コメントのみ・背景透過・
白い細めの文字**」を追加する。既存の overlay 意匠（アイコン＋吹き出し）は選択肢の 1 つとして残す。

## 現在の前提（調査結果）

- 意匠はコード固定 2 種（[`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の
  `variant`・60 行）。overlay は `renderOverlayItem`（101-144 行）で「上段＝名前＋サイト名ピル／下段＝アイコン｜吹き出し」を描く。
- 表示設定は localStorage を単一経路で伝播する既存パターンがある（[`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)）:
  `OVERLAY_FONTS` レジストリ＋`OVERLAY_FONT_KEY`＋`load/saveOverlayFont`＋`resolveOverlayFontStack`（14-90 行）。
  オーバーレイ窓は起動時 `load*`＋`storage` 購読で反映（[`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)）。
- 選択 UI は設定ビューの「OBSオーバーレイ」カード（[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 357-411 行）。
  フォントは `Select`＋プレビュー（372-401 行）で、意匠選択もこの並びに追加できる。値の保持は `CommentViewerApp` が担い props で渡す既存流儀。
- overlay 意匠 CSS は [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)、色は `theme.css` の `--overlay-*` トークン。

## このタスクでやること

### 意匠レジストリ＋永続化（overlaySettings.ts）

- `OVERLAY_DESIGNS`（`{ id, label }` の配列・例 `chat`＝現行アイコン＋吹き出し／`minimal`＝シンプル）と `OverlayDesignId` 型、
  `DEFAULT_OVERLAY_DESIGN`（＝現行 `chat`・移行時に見た目を変えない）、`OVERLAY_DESIGN_KEY`（`stream-dock.comment-viewer.overlay-design`）、
  `load/saveOverlayDesign` を `OVERLAY_FONTS`/`loadOverlayFont` と同型で追加する。

### 選択 UI（SettingsView.tsx / CommentViewerApp.tsx）

- 「OBSオーバーレイ」カードにフォント選択と同じ `Select` で「デザイン」選択を追加。値は `CommentViewerApp` が state 保持＋
  localStorage 永続し、`overlayFont` と同じ props 経路で `SettingsView` へ渡す（`overlayDesign` / `onOverlayDesignChange`）。

### 描画分岐＋シンプル意匠（CommentList.tsx / CSS）

- `CommentList` に `overlayDesign?: OverlayDesignId` を受け取り、overlay 分岐（`variant==="overlay"`）で意匠 ID により
  `renderOverlayItem`（現行）と新規 `renderMinimalItem` を切り替える。`OverlayApp` から選択中の意匠 ID を渡す。
- **シンプル意匠**: `<名前><本文>` のみ（アイコン枠・吹き出し・しっぽ無し）。背景透過、白い細めの文字
  （`font-weight` を細め・`color` は白系の `--overlay-*` トークン／必要なら `--overlay-text-strong` 等を `theme.css` に追加）。
  OBS 上の視認性のため軽い text-shadow は可。サイト名表示トグル（`showSource`）はこの意匠でも尊重する。

## このタスクでやらないこと

- 投げ銭強調意匠（037b）。本タスクは意匠の骨格と選択機構まで。
- 意匠プレビュー用の画像/GIF 同梱（選択はラベル＋任意のテキストプレビューに留める）。
- コメビュ本体（`variant="default"`）の変更。新規データ取得・外部通信。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示・設定追加のみ**。外部通信宛先・API・capability・依存・CSP を増やさない（§1/§3/§10・CSP方針）。`csp: null` 不変。
- localStorage は非機密 UI 設定のみ（`overlaySettings.ts` 既存方針）。外部送信しない。
- `<img>`/`background-image` は data URI のみ（036a のガード維持）。シンプル意匠はアイコンを出さないので画像を扱わない。
- 取得コメントを Rust の DB/ログに出さない（§9・既存踏襲）。

## 完了条件

- 設定ビューで意匠を選べ、選択がオーバーレイ窓へ即反映される（フォント/サイト名と同じ `storage` 経路）。
- シンプル意匠が「名前＋本文のみ・背景透過・白い細字」で表示され、既存意匠（アイコン＋吹き出し）も従来どおり選べる。
- 意匠未保存/不正値は既定（現行意匠）へフォールバックし、表示が壊れない。
- 新規宛先/API/capability/依存を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint`・`cargo check`（binding 変更が無ければ省略可）が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # コメビュ→設定→OBSオーバーレイでデザインを切替え、オーバーレイ窓に
                                         #   シンプル意匠（名前＋本文・透過・白細字）が即反映されることを目視
```

## 実装後に必要なレビュー

- security-review（軽）: frontend 表示/設定追加のみで外部通信宛先・API・capability・依存・CSP が不変であること、
  localStorage が非機密 UI 設定のみであること、`<img>`/`background-image` が data URI 以外を踏まないことを確認する。
