# 046 固定コメント（ピン留め）＋専用オーバーレイ（親設計）

> 状態: **未着手（親設計・線引きの正）**。実装は [046a](046a-viewer-pin-comment.md)（本体ピン留め＋ピンストア）→ [046b](046b-pinned-overlay-window.md)（固定専用オーバーレイ窓）の順。
>
> **必読前提**: 既存オーバーレイ窓の配線 [033f](033f-obs-transparent-overlay.md)・[034e](034e-overlay-design-refresh.md)、開閉トグル [034d](034d-overlay-controls-in-settings.md)、
> 窓間データ受け渡しの手本 [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)（localStorage＋`storage` イベント・60-73 行）、
> 設定永続化の手本 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)、
> [`docs/security.md`](../security.md)（§1 外部通信／§3 単一目的コマンド／Capabilities 方針）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **046b は新規ウィンドウ＋新規 capability＋新規 Rust command のため security-review 必須**。

## 目的

配信者がコメントを**右クリックで選んで上部に固定**でき（要望③前半）、その固定コメントが**OBS 側にも固定表示される**（要望③後半）ようにする。
固定は**既存のコメント表示オーバーレイ（label `comment-overlay`）とは独立した別ウィンドウ**として作る（ユーザー要望の明示: 「コメビュのオーバーレイとは別で独立しているイメージ」）。

## 全体像（データの流れ）

```
コメビュ本体（comment-viewer 窓）
  └ コメント右クリック → コンテキストメニュー「上部に固定」
        └ ピンストア（localStorage: pinned-comments）へ CommentViewDto を保存 ＝ 046a
              ├ 本体上部に固定表示（046a）
              └ 固定専用オーバーレイ窓（pinned-overlay 窓）が同じ localStorage を
                 起動時 load＋storage 購読で読み、OBS 向けに固定表示 ＝ 046b
```

- **窓間伝達は localStorage＋`storage` イベント**（`OverlayApp.tsx` 60-73 行の既存方式）を採用する。**新規 WS/Rust emit/外部通信を増やさない**。
  固定コメントは本体で保持済みの `CommentViewDto`（本文・名前・種別・金額）をそのまま localStorage に載せるため、専用オーバーレイは WS へ接続せず localStorage を読むだけで描ける。
- 固定専用オーバーレイは既存 `comment-overlay` と同じく**透過・フレームレス・最背面・非フォーカス・表示専用**で開き、OBS の「ウィンドウキャプチャ」で取り込む（またはウィンドウ位置を分けて別ソースにする）。

## 現在の前提（調査結果・実コード）

- コメント行は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderDefaultItem`（128-195 行）。左クリック導線 `onSelect`（101/116/138/148-160 行）で視聴者詳細を開くが、**右クリック（`onContextMenu`）は未使用**。一意キーは `c.id`（145 行）。
- 既存オーバーレイ窓の配線（**新窓 1 枚を増やす手本**）:
  - Rust: `open_comment_overlay_window`（[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs#L174) 174-220 行）／`close_comment_overlay_window`（227-235 行）／`is_comment_overlay_open`（262-265 行）。`WINDOW_OPEN_LOCK`（38 行）と `SHARED_BROWSER_ARGS`（72 行・**全窓一致必須**）を共有。`invoke_handler` 登録（428-436 行）。
  - フロント: 同一 `index.html` を全窓が読み、[`App.tsx`](../../apps/desktop/src/App.tsx#L355) の label 分岐（355-364 行）で描画コンポーネントを切替。オーバーレイ本体は [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)。ラッパは [`windowApi.ts`](../../apps/desktop/src/features/comment-viewer/windowApi.ts)（38-58 行）。
  - capability: [`capabilities/comment-overlay.json`](../../apps/desktop/src-tauri/capabilities/comment-overlay.json)（`windows:["comment-overlay"]`・`permissions:["core:default"]`）。`csp: null`（[`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json) 25-27 行）・`macOSPrivateApi:true`（24 行）。
  - **Vite は単一入口**（[`vite.config.ts`](../../apps/desktop/vite.config.ts) に複数入口なし）＝新窓も `WebviewUrl::App("index.html")`＋App.tsx の label 分岐で足りる（**vite.config.ts / tauri.conf.json は変更不要**）。
- 意匠の流用: 投げ銭カード等の overlay 意匠は [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css) に隔離済み。固定表示の意匠はこれを流用/参考にできる。

## 子タスクと線引き

| 子 | 内容 | 実装有無 | レビュー |
|---|---|---|---|
| [046a](046a-viewer-pin-comment.md) | 右クリック→「固定/固定解除」＋本体上部の固定表示＋ピンストア（localStorage） | frontend | 軽 |
| [046b](046b-pinned-overlay-window.md) | 固定専用オーバーレイ窓（新 label `pinned-overlay`・Rust 窓コマンド＋capability＋App.tsx 分岐＋窓間受け渡し＋開閉トグル） | Rust＋新窓＋frontend | **security-review 必須** |

## この親でやること（設計判断の固定）

- **固定は複数可・新しい順・上限 N（既定は少数＝例 3 件）**とする（YouTube の単一ピンより柔軟だが無制限にはしない）。上限超過は最古を押し出す。厳密な N は 046a で確定。
- **ピンストアは localStorage の 1 キー**（例 `stream-dock.comment-viewer.pinned-comments`・JSON 配列）に `CommentViewDto` の必要フィールドを保存する。
  本体（046a）が唯一の書き手、専用オーバーレイ（046b）は読み手（`overlaySettings.ts`/`OverlayApp.tsx` と同じ read-on-mount＋storage 購読）。
- **専用オーバーレイの開閉は明示トグル**（自動開閉にしない）。理由: OBS の「ウィンドウキャプチャ」ソースは一度追加すると窓の存在に依存するため、
  ピン 0 件で窓が自動で閉じると OBS ソースが黒くなる。開閉トグルの置き場所（本体 or 設定）は 046b で確定（初期案＝設定の OBS カードに「固定コメントをOBSに表示」トグル）。
- **専用オーバーレイは WS に接続しない**（localStorage のピンだけを描く）。これにより新規通信面ゼロ＝表示専用で最も安全。

## この親でやらないこと

- 実装（子タスク）。既存 `comment-overlay` の意匠・挙動変更（本機能は別窓）。
- 固定専用オーバーレイの **OBS 自動ソース追加**（044a の枠組み拡張・本機能では手動キャプチャ前提。将来タスク）。
- **新規外部インターネット通信・新規 WS・新規 Rust emit・新規依存**（窓間伝達は localStorage で完結させる）。sidecar の変更。

## セキュリティ制約（docs/security.md 準拠）

- 窓間伝達は **localStorage の非機密 UI データ**（表示するコメント本文・名前・金額）に限る。**外部送信しない・Rust の DB/ログに出さない**（§9・既存踏襲）。
- 046b の新規 Rust command は**単一目的**（`open_pinned_overlay_window` / `close_*` / `is_*_open`）で、既存 overlay コマンドと同型（任意ラベル・任意オプションの窓生成は露出しない・§3）。
  新 capability は `windows:["pinned-overlay"]`・`permissions:["core:default"]` の最小権限（既存 `comment-overlay.json` と同型）。`main`/`comment-viewer`/`comment-overlay` の capability は不変・`csp: null` 不変。
- 専用オーバーレイは**表示専用**（WS/制御フレームを持たない）で sidecar に触れない（no-orphan kill 契機を壊さない）。**新規通信面・依存ゼロ**。
- **046b は新規ウィンドウ＋新規 capability＋新規 command のため security-review 必須**。046a は frontend のみ＝軽レビュー。

## 完了条件（親）

- 046a: コメントを右クリックで固定/固定解除でき、本体上部に固定表示される。ピンストア（localStorage）に保存され再オープンで復元する。
- 046b: 固定専用の独立オーバーレイ窓が開閉でき、本体のピンと連動（追加/解除）して OBS 向けに固定表示する。既存 `comment-overlay` とは別窓で独立している。
- 窓間伝達が localStorage で完結し、新規外部通信・WS・emit・依存が無い。`csp: null` 不変。046b の security-review を通過している。

## 実装後に必要なレビュー

- 046a＝軽レビュー（frontend のみ・localStorage 非機密・外部送信/DB/ログ出力なし）。
- 046b＝**security-review 必須**（新規窓/capability/command が最小権限・単一目的で、表示専用・通信面/依存ゼロ・既存窓 capability と `csp: null` 不変・no-orphan kill を壊していないこと）。
