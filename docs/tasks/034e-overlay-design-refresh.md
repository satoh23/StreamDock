# 034e OBSオーバーレイ デザイン刷新（アイコン＋吹き出しチャット意匠・文字拡大・フォント選択・サイト名表示トグル）

> 状態: **実装済み（実装サブタスク・034 系）**。分割・線引きは親 [034](034-comment-viewer-obs-ux-round2.md) を正とする。
>
> **必読前提**: 親 [034](034-comment-viewer-obs-ux-round2.md)、先行 [034d](034d-overlay-controls-in-settings.md)
> （設定ビューのオーバーレイ節）・[034b](034b-overlay-autofollow-scrollbar.md)（追従・サイドバー抑止）・
> 第1弾 [033f](033f-obs-transparent-overlay.md)（透過オーバーレイ窓）、[`docs/security.md`](../security.md)（CSP 方針）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。オーバーレイは**表示専用**を維持する。
>
> **デザイン方針の変更（本人指示）**: 当初の「透過・本文＋アカウント名のみのフラット表示」から、**「アイコン＋吹き出し」
> チャット意匠**へ差し替えた（下記）。サイト名トグル・`data-overlay` スコープ限定・表示専用・security-review 軽通しの枠組みは踏襲。
> **実アイコンの取得（Twitch/YouTube CDN・sidecar 経由）は本タスクでは行わず、アイコン枠だけ確保して次タスク 034f へ分離**する。

## 目的

OBS オーバーレイのデザインを、各コメントを**「上段＝ユーザー名（＋任意のサイト名ピル）／下段＝アイコン｜吹き出しに本文」**という
**チャット体裁**へ刷新する。名前は**黒＋白い縁取り**、吹き出しは**不透明のほぼ純白カード＋太枠＋しっぽ**で、透過窓（＝OBS 映像）の
上でも読める**大きめサイズ**にする（バッジ/スパチャ額/余分な余白は最小化）。あわせて設定ビューに**フォント選択（OS 標準のみ）**と
**サイト名（配信サービス）を表示するかの ON/OFF トグル**を足す。**要望3（ダサい）・要望6（文字が小さい）・要望4（意匠を設定できる）**を
満たす。**複数デザイン＋プレビュー選択は本タスクでは作らない**（親 034 の段階的方針・将来枠）。

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

### (1) オーバーレイ専用デザイン（アイコン＋吹き出しチャット意匠・文字拡大）

- 意匠の当て方は **`CommentList` の `variant` プロップ**。新意匠は DOM 構造自体が違う（アイコン要素・名前要素・吹き出し要素が
  要る）ため `data-overlay` の CSS 上書きだけでは作れない。`CommentList` に `variant?: "default" | "overlay"`（既定 `default`）と
  `showSource?: boolean` を足し、`variant==="overlay"` のときだけ**新クラスの別マークアップ**を描く。既定分岐は現行のまま不変＝**本体
  （`comment-viewer`）の見た目は変えない**。新クラスは**新規 CSS モジュール** [`OverlayComment.module.css`](../../apps/desktop/src/screens/comment-viewer/OverlayComment.module.css)
  に隔離（本体 `CommentViewerApp.module.css`・窓透過専用 `OverlayApp.module.css` には触れない）。
- overlay 分岐のマークアップ: `li(flex column)` ＝ `div.header(span.name ＋任意の色付き span.source ピル)` ＋
  `div.row(div.icon｜div.bubble>p.text)` の縦積み。overlay 項目は本体の不透明 `.item`（`var(--surface)`）を使わないので**窓の背景は
  透過のまま＝吹き出しだけが不透明カード**になる（半透過だとしっぽが透けて見えるため吹き出しは不透明化。窓透過＝OBS 合成は維持）。
- 配色は theme.css に **`--overlay-*` トークン**を新設（`:root` 基底のみ・OBS 映像の上なのでテーマ非依存）: 名前＝太め黒、本文＝
  少し薄い黒、縁取り＝白（多重 `text-shadow`）、吹き出し＝不透明のほぼ純白（`--overlay-bubble-bg`）＋太枠＋ソフト影、サイト名ピル＝
  サービス別の色（Twitch 紫 / YouTube 赤）に白文字、アイコン＝グレー丸（枠なし）。`*.module.css` には生 hex/rgba を残さず
  `var(--overlay-*)` 経由で参照。色/寸法（吹き出し色・px・しっぽ幾何）は `tauri dev` で目視調整する前提の初期値。
- **デフォルトアイコン枠（034f を見据える）**: `div.icon` を **44×44 の丸グレー プレースホルダ**（枠なし・CSS のみ・外部画像/data-URI
  なし）で描く。034f では `background-image` をインライン指定するか `<img>` を内側に足すだけで済む（枠＝サイズ/位置は確保済み）。

### (2) フォント選択（OS 標準のみ・外部フォント無し）

- 設定ビュー（034d のオーバーレイ節）に **フォント選択ドロップダウン**を追加し、オーバーレイの `font-family` を切替。候補は 4 種
  （**システム標準 / ゴシック / 丸ゴシック / 明朝**）で、すべて **OS 標準フォントのスタック**（日本語表示可）。**外部 Web フォント
  （Google Fonts 等 CDN）・新規 `@font-face` は追加しない**（CSP 方針）。登録簿と適用は `overlaySettings.ts` に置き、`OverlayApp` の
  `.root` に inline `font-family` で当てる（子孫の名前/本文が継承）。選択は localStorage 永続化。

### (3) サイト名（配信サービス）表示トグル

- 設定ビュー（034d のオーバーレイ節）に **「サイト名を表示する」トグル**を追加。localStorage 永続化（新設 `overlaySettings.ts`・
  `ttsPrefs`/`channelStorage` の load/save パターンを手本）。既定 OFF。
- ON のとき、オーバーレイの各コメントに `source`（`twitch`/`youtube`）を**名前の横に色付きピルバッジ**（Twitch 紫 / YouTube 赤・
  白文字）で小さく添える。OFF のときは出さない。
  設定値はオーバーレイ窓へ**即反映**する（両窓は別 webview・同一 localStorage を共有。`OverlayApp` が `storage` イベントを購読して
  再読込＝設定窓の変更が開いたままのオーバーレイに反映される）。**受信済み `CommentViewDto.source` の表示のみ・新規取得はしない**。

## このタスクでやらないこと

- **実アイコンの取得（Twitch/YouTube CDN からの画像取得・sidecar 経由）＝次タスク 034f**。本タスクはデフォルトアイコン＋枠確保まで
  （`CommentAuthor` は `{id,name}` のみ＝ts-rs 生成でアイコン URL 無し。bindings/DTO/Rust/sidecar には触れない）。
- **窓ごと不透明化**（窓の透過は維持・033f/034b の OBS 合成を壊さない。不透明化するのは吹き出しカードだけ）。
- **複数デザイン＋画像/GIF プレビュー選択 UI**（親 034 の将来枠。今回は単一デザイン刷新のみ）。
- **外部 Web フォント/画像/CSS/CDN の追加**（CSP 方針）。新規ライブラリ・Tauri command・capability の追加。
- オーバーレイの開閉操作・状態インジケータ（034d）、追従・サイドバー抑止（034b）。
- 本体（コメビュ）の見た目変更（オーバーレイ専用の `variant` 分岐＋新モジュールに限定）。
- obs-websocket 連携、通信面・sidecar・新規宛先の追加（オーバーレイは表示専用・`source` は受信済みデータのみ利用）。

## セキュリティ制約（docs/security.md 準拠・重点 CSP 方針）

- オーバーレイは**表示専用**を維持（loopback WS 読み取り専用接続のみ・§1 /「方針②」）。本タスクは frontend の描画/CSS と
  localStorage 設定のみで、**新規外部通信・宛先・依存・capability を作らない**。`csp: null` 不変。外部 script/style/image/font を
  増やさない（CSP 方針。装飾は既存トークン・CSS のみで賄い、外部フォント等は導入しない）。
- サイト名は**受信済み `CommentViewDto.source`** を使うのみ（新規取得しない）。取得コメント本文はログ/DB に出さない（既存踏襲）。
- **表示専用・通信/CSP/依存 不変の確認のため security-review を軽く通す**。

## 完了条件

- オーバーレイが背景透過のまま、各コメントを〈名前(黒＋白縁取り)＋任意のサイト名ピル〉＋〈アイコン｜不透明のほぼ純白吹き出し
  (太枠＋しっぽ)に本文(少し薄い黒・大きめ)〉のチャット意匠で見やすく表示する（バッジ/スパチャ額/余分な余白は最小化）。
- アイコンはデフォルト（グレー丸プレースホルダ）で、034f が src を差し込める枠（サイズ/位置）を確保できている。
- 本体（コメビュ）の見た目に影響が無い（`variant` 分岐＋新モジュールに限定できている）。
- 設定ビューの**フォント選択**でオーバーレイの font-family が切り替わり（OS 標準 4 種・外部フォントなし）、**「サイト名を表示する」
  トグル**でオーバーレイのサイト名表示が ON/OFF でき、どちらも localStorage に永続化＋開いたままのオーバーレイへ即反映される。
- OBS のウィンドウキャプチャで従来どおり透過合成できる（033f の挙動を維持・不透明化するのは吹き出しカードだけ）。
- 新規外部通信・新しいライブラリ / Tauri command / capability・外部フォント/画像を追加していない。`csp: null` 不変。
  `*.module.css` に生 hex/rgba を残していない（配色は `--overlay-*` トークン経由）。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。
- **security-review を通過**している。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # アイコン＋吹き出し意匠／大きめ文字／フォント選択／サイト名トグルON/OFF／本体は不変／OBS 透過合成を目視
```

## 実装後に必要なレビュー

- security-review: オーバーレイが**表示専用**のままで**新規外部通信・宛先・依存・capability・外部アセット（フォント/画像）を
  足していない**こと、`data-overlay` スコープで本体へ波及していないこと、サイト名が受信済み `source` の利用のみで新規取得を
  していないこと、`csp: null` 不変を確認。
