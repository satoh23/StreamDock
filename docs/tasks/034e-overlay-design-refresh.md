# 034e OBSオーバーレイ デザイン刷新（透過・本文＋アカウント名のみ・文字拡大・サイト名表示トグル）

> 状態: **未着手（実装サブタスク・034 系の最後）**。分割・線引きは親 [034](034-comment-viewer-obs-ux-round2.md) を正とする。
>
> **必読前提**: 親 [034](034-comment-viewer-obs-ux-round2.md)、先行 [034d](034d-overlay-controls-in-settings.md)
> （設定ビューのオーバーレイ節）・[034b](034b-overlay-autofollow-scrollbar.md)（追従・サイドバー抑止）・
> 第1弾 [033f](033f-obs-transparent-overlay.md)（透過オーバーレイ窓）、[`docs/security.md`](../security.md)（CSP 方針）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。オーバーレイは**表示専用**を維持する。

## 目的

OBS オーバーレイのデザインを、**背景透過・コメント本文＋アカウント名のみ**を**大きめの読みやすい文字**で見せる形へ刷新する
（バッジ/スパチャ額/カード余白などの装飾は最小化）。あわせて設定ビューに**サイト名（配信サービス）を表示するかの ON/OFF
トグル**を足す。**要望3（ダサい）・要望6（文字が小さい）・要望4（意匠を設定できる）**を満たす。**複数デザイン＋プレビュー選択は
本タスクでは作らない**（親 034 の段階的方針・将来枠）。

## 現在の前提（調査結果）

- オーバーレイは [`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx) が本体と同じ `CommentList` を
  表示。コメントカードの見た目は**本体 CSS を共用**（[`CommentViewerApp.module.css`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css)
  の `.item`/`.meta`/`.badge`/`.author`/`.amount`/`.text`）。オーバーレイ専用の上書きは今のところ透過のみ。
- 文字サイズ（本体 CSS 共用）: `.text` 13px（244-248行）・`.author` 12px（227-231行）・`.badge` 10px（207-213行）・
  `.amount` 11px（233-242行）。オーバーレイでもこの小さい値のまま。
- オーバーレイは既に `data-overlay="1"` 属性を付与（[`OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx)
  28-34行）＋透過 CSS（[`OverlayApp.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.module.css)）。
  この属性スコープで**他窓に波及させずオーバーレイだけ上書き**できる（透過処理と同じ手法）。
- 表示に使えるデータ: `CommentViewDto`（[`bindings/CommentViewDto.ts`](../../apps/desktop/src/features/comment-viewer/bindings/CommentViewDto.ts)）。
  `source`（`twitch`/`youtube`）が**受信済み**なので、サイト名表示は**新規通信不要**。
- 非機密な UI 設定の localStorage 永続化は [`speakerStorage.ts`](../../apps/desktop/src/features/comment-viewer/speakerStorage.ts)
  の `load*/save*` パターンが手本。
- 設定ビューのオーバーレイ節は 034d で新設済みの前提。

## このタスクでやること

### (1) オーバーレイ専用デザイン（透過・本文＋名前・文字拡大）

- `OverlayApp` で、コメント項目を**アカウント名（`author`）＋本文（`text`）のみ**の表示に整える（バッジ・スパチャ額・
  カード余白などの装飾は最小化/非表示）。本体（`comment-viewer`）の見た目は変えない。
- **`data-overlay="1"` スコープの CSS** をオーバーレイ専用に足す（[`OverlayApp.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.module.css)）:
  `.text`/`.author` を**大きめ**へ（実値は `tauri dev` で目視調整・OBS 取り込み時の可読性優先）、背景は透過のまま、
  縁取り/影で透過背景上でも読める配色にする。本体 CSS のクラス値は変えず、オーバーレイ側で上書きする
  （`OverlayApp` 側で別クラスを当てる or `data-overlay` セレクタで上書き。実装時に軽い方を選ぶ）。

### (2) サイト名（配信サービス）表示トグル

- 設定ビュー（034d のオーバーレイ節）に **「サイト名を表示する」トグル**を追加。localStorage 永続化
  （`speakerStorage` の load/save パターンを手本に、例 `overlaySettings.ts` を新設）。
- ON のとき、オーバーレイの各コメントに `source`（`twitch`/`youtube`）を**小さく**添える（本文の可読性を邪魔しない範囲）。
  OFF のときは出さない。設定値はオーバーレイ窓へ渡す（本体と同じ localStorage を参照・両窓は同一バンドル）。

## このタスクでやらないこと

- **複数デザイン＋画像/GIF プレビュー選択 UI**（親 034 の将来枠。今回は単一デザイン刷新のみ）。
- オーバーレイの開閉操作・状態インジケータ（034d）、追従・サイドバー抑止（034b）。
- 本体（コメビュ）の見た目変更（オーバーレイ専用スコープに限定）。
- obs-websocket 連携、通信面・sidecar・新規宛先の追加（オーバーレイは表示専用・`source` は受信済みデータのみ利用）。

## セキュリティ制約（docs/security.md 準拠・重点 CSP 方針）

- オーバーレイは**表示専用**を維持（loopback WS 読み取り専用接続のみ・§1 /「方針②」）。本タスクは frontend の描画/CSS と
  localStorage 設定のみで、**新規外部通信・宛先・依存・capability を作らない**。`csp: null` 不変。外部 script/style/image/font を
  増やさない（CSP 方針。装飾は既存トークン・CSS のみで賄い、外部フォント等は導入しない）。
- サイト名は**受信済み `CommentViewDto.source`** を使うのみ（新規取得しない）。取得コメント本文はログ/DB に出さない（既存踏襲）。
- **表示専用・通信/CSP/依存 不変の確認のため security-review を軽く通す**。

## 完了条件

- オーバーレイが背景透過のまま、アカウント名＋本文を大きめ文字で見やすく表示する（バッジ/スパチャ額等は最小化）。
- 本体（コメビュ）の見た目に影響が無い（`data-overlay` スコープに限定できている）。
- 設定ビューの「サイト名を表示する」トグルで、オーバーレイのサイト名表示が ON/OFF でき、設定が localStorage に永続化される。
- OBS のウィンドウキャプチャで従来どおり透過合成できる（033f の挙動を維持）。
- 新規外部通信・新しいライブラリ / Tauri command / capability・外部フォント/画像を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。
- **security-review を通過**している。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # オーバーレイが透過・本文＋名前・大きめ文字／サイト名トグルON/OFF／本体は不変／OBS 透過合成を目視
```

## 実装後に必要なレビュー

- security-review: オーバーレイが**表示専用**のままで**新規外部通信・宛先・依存・capability・外部アセット（フォント/画像）を
  足していない**こと、`data-overlay` スコープで本体へ波及していないこと、サイト名が受信済み `source` の利用のみで新規取得を
  していないこと、`csp: null` 不変を確認。
