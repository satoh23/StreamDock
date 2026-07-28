# 046 固定コメント（ピン留め）＋専用オーバーレイ（親設計）

> 状態: **046a 実装済み（2026-07-28）／046b 実装済み（2026-07-29）＝親 046 完了**（親設計・線引きの正）。実装は [046a](046a-viewer-pin-comment.md)（本体ピン留め＋ピンストア）→ [046b](046b-pinned-overlay-window.md)（固定専用オーバーレイ窓）の順で行った。
>
> **046b 実装時に確定した、この親の記述との差分（3 点）**:
> 1. 下の「専用オーバーレイの開閉は明示トグル（**自動開閉にしない**）」は、**自動 close の禁止**として運用する。
>    046b では「トグルを localStorage に永続し、ON ならコメビュ本体のマウント時に窓を**自動で開く**」を採用した（依頼者の決定）。
>    禁止の理由（ピン 0 件で窓が消えると OBS ソースが壊れる）とは向きが逆＝窓がより確実に存在する方向のため意図に沿う。
>    **自動 close は実装していない**（設定 OFF で窓が開いていても閉じない）。
> 2. 開閉トグルの置き場所は「初期案＝設定の OBS カード」だったが、**設定ビューに専用カードを新設**した
>    （既存 OBS カードには相乗りしない＝既存カードは無改変）。理由と 045b の線引きとの整合は
>    [`docs/progress.md`](../progress.md) の 046b 節を正とする。
> 3. **ピンは配信（コメビュ窓のセッション）をまたいで残さない**（046b レビュー S-1・依頼者の決定で挙動変更）。
>    046a は「窓の再オープンで復元」だったが、046b で ①ピン永続 ②トグル永続 ③ON ならマウント時に窓を自動 open
>    が揃った結果、**前回配信で固定したコメントが次の配信開始時に操作ゼロで本番画面へ出る**ようになったため、
>    **コメビュ窓のマウント時にピンストアを空へ倒す**ことにした。ピンストア（`pinnedComments.ts`）自体は無改変で、
>    「いつ空へ倒すか」だけが本体側の判断。詳細は [`docs/security.md`](../security.md) §9 追補（046a）の ⚠ 節と
>    [`docs/progress.md`](../progress.md) の 046b レビュー対応節。
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
        └ ピンストア（localStorage: pinned-comments）へ PinnedComment を保存 ＝ 046a
             （＝CommentViewDto から author.avatar を除いた部分型）
              ├ 本体上部に固定表示（046a）
              └ 固定専用オーバーレイ窓（pinned-overlay 窓）が同じ localStorage を
                 起動時 load＋storage 購読で読み、OBS 向けに固定表示 ＝ 046b
```

- **窓間伝達は localStorage＋`storage` イベント**（`OverlayApp.tsx` 60-73 行の既存方式）を採用する。**新規 WS/Rust emit/外部通信を増やさない**。
  固定コメントは本体で保持済みの `CommentViewDto` から **`author.avatar` を除いた `PinnedComment`**（本文・名前・種別・金額）を localStorage に載せるため、専用オーバーレイは WS へ接続せず localStorage を読むだけで描ける
  （046a 実装時の確定。当初この行は「`CommentViewDto` をそのまま載せる」だったが、avatar 非保存の決定に合わせて訂正した）。
- 固定専用オーバーレイは既存 `comment-overlay` と同じく**透過・フレームレス・最背面・非フォーカス・表示専用**で開き、OBS の「ウィンドウキャプチャ」で取り込む（またはウィンドウ位置を分けて別ソースにする）。

## 現在の前提（調査結果・実コード）

- コメント行は [`CommentList.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentList.tsx) の `renderDefaultItem`（**046a 実装後は 159-250 行**）。左クリック導線 `onSelect`（prop 106 行・分割代入 134 行）で視聴者詳細を開く。**右クリック（`onContextMenu`）は 046a で実装済み**（194 行〜・`onPin` 120 行 / `pinnedIds` 125 行）。一意キーは `c.id`（176 行）。
  ※行番号はずれるので**シンボル名で特定**すること（046a 実装で当初の 128-195 / 101/116/138/148-160 / 145 行から移動した）。
- 既存オーバーレイ窓の配線（**新窓 1 枚を増やす手本**）:
  - Rust: `open_comment_overlay_window`（[`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs#L174) 174-220 行）／`close_comment_overlay_window`（227-235 行）／`is_comment_overlay_open`（262-265 行）。`WINDOW_OPEN_LOCK`（38 行）と `SHARED_BROWSER_ARGS`（72 行・**全窓一致必須**）を共有。`invoke_handler` 登録（428-436 行）。
  - フロント: 同一 `index.html` を全窓が読み、[`App.tsx`](../../apps/desktop/src/App.tsx#L355) の label 分岐（355-364 行）で描画コンポーネントを切替。オーバーレイ本体は [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)。ラッパは [`windowApi.ts`](../../apps/desktop/src/features/comment-viewer/windowApi.ts)（38-58 行）。
  - capability: [`capabilities/comment-overlay.json`](../../apps/desktop/src-tauri/capabilities/comment-overlay.json)（`windows:["comment-overlay"]`・`permissions:["core:default"]`）。`csp: null`（[`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json) 25-27 行）・`macOSPrivateApi:true`（24 行）。
  - **Vite は単一入口**（[`vite.config.ts`](../../apps/desktop/vite.config.ts) に複数入口なし）＝新窓も `WebviewUrl::App("index.html")`＋App.tsx の label 分岐で足りる（**vite.config.ts / tauri.conf.json は変更不要**）。
- 意匠の流用: 投げ銭カード等の overlay 意匠は [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css) に隔離済み。固定表示の意匠はこれを流用/参考にできる。

## 子タスクと線引き

| 子 | 内容 | 実装有無 | レビュー |
|---|---|---|---|
| [046a](046a-viewer-pin-comment.md) | 右クリック→「固定/固定解除」＋本体上部の固定表示＋ピンストア（localStorage） | frontend（**実装済み 2026-07-28**） | 軽 |
| [046b](046b-pinned-overlay-window.md) | 固定専用オーバーレイ窓（新 label `pinned-overlay`・Rust 窓コマンド＋capability＋App.tsx 分岐＋窓間受け渡し＋開閉トグル） | Rust＋新窓＋frontend | **security-review 必須** |

## この親でやること（設計判断の固定）

- **固定の上限 N は 1（単一ピン）**＝YouTube / Twitch のコメント固定と同じ体験にする。新しく固定すると直前の固定を置き換える。
  - **2026-07-28 更新**: 当初この節は「固定は複数可・新しい順・上限 N（既定は少数＝例 3 件）／YouTube の単一ピンより柔軟だが無制限にはしない」としていたが、
    046a の実装時に依頼者が **N=1（単一ピン）**を選択したため確定値を書き換えた（「厳密な N は 046a で確定」の結論）。
  - 保存形は N に依らず **JSON 配列**のままで、上限は `pinnedComments.ts` の `PINNED_LIMIT` 1 箇所に閉じてある。
    将来複数ピンにしたくなったらこの定数を増やすだけで、046b の読み手契約（配列・先頭＝最新）は変わらない。上限超過は最古を押し出す。
- **ピンストアは localStorage の 1 キー**（`stream-dock.comment-viewer.pinned-comments`・JSON 配列）に `CommentViewDto` の必要フィールドを保存する。
  本体（046a）が唯一の書き手、専用オーバーレイ（046b）は読み手（`overlaySettings.ts`/`OverlayApp.tsx` と同じ read-on-mount＋storage 購読）。
  - **046a の確定（2026-07-28）**: 保存するのは `CommentViewDto` から **`author.avatar`（base64 data URI）を除いた** `PinnedComment`。
    容量・`storage` イベントのペイロード・§9 の観点で avatar は載せない。**046b は WS へ繋がないためアバターを再取得できない**ので、
    専用オーバーレイのアイコンは `CommentList` の 036a フォールバック（頭文字の丸）になる。スキーマ全文は
    [`docs/progress.md`](../progress.md) の 046a 節（046b が読む契約）を正とする。
- **専用オーバーレイの開閉は明示トグル**（自動開閉にしない）。理由: OBS の「ウィンドウキャプチャ」ソースは一度追加すると窓の存在に依存するため、
  ピン 0 件で窓が自動で閉じると OBS ソースが黒くなる。開閉トグルの置き場所（本体 or 設定）は 046b で確定（初期案＝設定の OBS カードに「固定コメントをOBSに表示」トグル）。
- **専用オーバーレイは WS に接続しない**（localStorage のピンだけを描く）。これにより新規通信面ゼロ＝表示専用で最も安全。

## この親でやらないこと

- 実装（子タスク）。既存 `comment-overlay` の意匠・挙動変更（本機能は別窓）。
- ~~固定専用オーバーレイの **OBS 自動ソース追加**（044a の枠組み拡張・本機能では手動キャプチャ前提。将来タスク）。~~
  → **2026-07-29 撤回・[046d](046d-pinned-overlay-obs-auto-add.md) で実装した**。先送りに技術的な根拠は無く（sidecar の
  ソース名/窓名が定数 1 組だったという実装都合のみ）、依頼者の意図は当初から「自動追加の対象内」だった。
  **「将来タスク」と書いた時点で依頼者に確認すべきだった**（この行が手動キャプチャ前提の UI 文言を生み、E2E で「自動で反映されない」として顕在化した）。
- **新規外部インターネット通信・新規 WS・新規 Rust emit・新規依存**（窓間伝達は localStorage で完結させる）。sidecar の変更。

## セキュリティ制約（docs/security.md 準拠）

- 窓間伝達は **localStorage の表示データ**（コメント本文・投稿者の表示名・金額表示）に限る。**外部送信しない・Rust の DB/ログに出さない**（§9）。
  - **2026-07-28 訂正（security-review 指摘）**: 当初この行は上記を「**非機密 UI データ**」と書いていたが誤り。
    コメント本文・投稿者名・金額は**第三者の個人データ**であり、既存 localStorage キー（テーマ・フォント・トグル・
    チャンネル名＝ユーザー自身の UI 設定値）とはデータの性質が違う。この誤ったラベリングを根拠に
    「046a は軽レビューで足りる」「security.md への追記は不要」と判断していたため、**[`docs/security.md`](../security.md) §9 に
    「追補（046a・固定コメントの端末内 localStorage 保存）」を新設**して端末内保存の限定解禁として明文化した
    （保存先が SQLite か localStorage かではなく、保存するデータの種類が §9 の対象という整理）。
  - **削除手段の範囲**: 固定の削除は固定帯の「固定解除」のみ。**038a の `delete_viewer` / `clear_viewers` は
    このキーを消さない**（SQLite 専用コマンド）。端末内保存データの一括削除・エクスポートを作る場合は本キーも対象に含めること。
- 機密（OAuth トークン・OBS パスワード・`code_verifier` 等）は従来どおり localStorage に一切載せない。
- 046b の新規 Rust command は**単一目的**（`open_pinned_overlay_window` / `close_*` / `is_*_open`）で、既存 overlay コマンドと同型（任意ラベル・任意オプションの窓生成は露出しない・§3）。
  新 capability は `windows:["pinned-overlay"]`・`permissions:["core:default"]` の最小権限（既存 `comment-overlay.json` と同型）。`main`/`comment-viewer`/`comment-overlay` の capability は不変・`csp: null` 不変。
- 専用オーバーレイは**表示専用**（WS/制御フレームを持たない）で sidecar に触れない（no-orphan kill 契機を壊さない）。**新規通信面・依存ゼロ**。
- **046b は新規ウィンドウ＋新規 capability＋新規 command のため security-review 必須**。046a は frontend のみ＝軽レビュー。

## 完了条件（親）

- 046a: コメントを右クリックで固定/固定解除でき、本体上部に固定表示される。ピンストア（localStorage）に保存され、専用オーバーレイ窓（046b）が読める。※当初あった「コメビュ窓の再オープンで復元する」は**上記差分 3 で撤回**（セッションをまたがない）。
- 046b: 固定専用の独立オーバーレイ窓が開閉でき、本体のピンと連動（追加/解除）して OBS 向けに固定表示する。既存 `comment-overlay` とは別窓で独立している。
- 窓間伝達が localStorage で完結し、新規外部通信・WS・emit・依存が無い。`csp: null` 不変。046b の security-review を通過している。

## 実装後に必要なレビュー

- 046a＝当初は軽レビュー指定だったが、**2026-07-28 に security-review と code-review を実施**。判定は「軽微な懸念あり」で
  コード側の修正必須はゼロ（通信・Rust・capabilities・依存はすべて差分ゼロを実測）。ただし
  **「第三者の個人データを初めて localStorage に永続化する」点が保存ポリシーの変更に当たる**ため、
  [`docs/security.md`](../security.md) §9 に追補（046a）を新設し、「レビュー必須条件」の
  「取得コメント・視聴者情報の端末保存」は**保存先を問わない**旨を明記した。
  **教訓**: frontend のみ・通信ゼロでも、保存するデータの種類が変わる変更は軽レビューに置かない。
- 046b＝**security-review 必須**（新規窓/capability/command が最小権限・単一目的で、表示専用・通信面/依存ゼロ・既存窓 capability と `csp: null` 不変・no-orphan kill を壊していないこと）。
