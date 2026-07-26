# 048 ずんだもん読み上げ 文字数上限（以下略で省略）

> 状態: **未着手（単体タスク）**。
>
> **必読前提**: TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)、設定永続化 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)、
> 設定画面 [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、getter 注入の配線 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、
> 読み替え辞書 [041a](041a-reading-dictionary-engine-and-builtin.md)（適用順の直後に切り詰める）、[`docs/security.md`](../security.md)（§1）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ・ローカル整形のみ**＝**軽レビュー**。

## 目的

長すぎるコメントをずんだもん（VOICEVOX）が全部読み上げると配信が地獄になるため、**一定文字数を超えたら「以下略」で打ち切る**（要望⑤）。
省略は**常時有効**（トグルなし）で、**文字数はデフォルト値を持ち、設定画面からユーザーが変更できる**。表示（一覧/オーバーレイ）は従来どおり全文のまま、**読み上げテキストだけ**を切り詰める。

## 現在の前提（調査結果・実コード）

- 読み上げテキストの組立は [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の `enqueue`（117-138 行）:
  1. `sanitizeForSpeech(comment.text)`（30-36 行・URL/絵文字除去・空白畳み込み・著者名は読まない）。
  2. `applyReadingDictionary(sanitized, getReadingDictionary?.() ?? [])`（126-129 行・読み替え適用）→ `.trim()`。
  3. 空ならスキップ（130 行）→ `queue.push(text)`（131 行）→ `pump()`（137 行）で `synthesize`（105 行）へ。
  - **1 件あたりの文字数上限は現状なし**（`MAX_BACKLOG=20` は 19 行・**件数**上限であって文字数ではない）。切り詰めの単一チョークポイントは **129 行の `.trim()` 直後（130 行の空判定の前）**。ここを通せば表示に影響せず読み上げテキストだけ制限できる。
- オプションは getter 注入方式: [`TtsQueueOptions`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts#L47)（`getSpeakerId` 54 行 / `getReadingDictionary` 60 行）。キューはマウント時 1 回生成（[`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) 405-408 行）で、**その時点の値**を getter で読むため、上限値の変更でキューを作り直さずに済む（同じ手本で `getMaxLength` を足す）。
- 設定の永続化は [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)（名前空間 `stream-dock.comment-viewer.*`・localStorage 直 read/write・例外握りつぶし）。数値設定はまだ無いため、**数値の load/save を新設**する（既存は真偽値のみ）。
- 本体の state/永続化/ref 同期の手本: `CommentViewerApp.tsx` の `useState(()=>load*())`＋`useEffect(()=>save*(x),[x])`（240-399 行）と、getter 用 ref 同期（`selectedSpeakerIdRef` 273/391-392 行）。
- 設定 UI は [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の「読み上げ（VOICEVOX）」カード（127-227 行・`ToggleSwitch`/`Select` を使用）。数値入力欄は既存に無いため、この機能内で数値入力行を足す。

## このタスクでやること

### (1) 設定の保存（数値・既定値・常時有効）

- [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) に読み上げ最大文字数の load/save を追加する。
  - キー例 `stream-dock.comment-viewer.tts-max-length`。**既定値 60 文字**（要調整・親方針は「デフォルト値あり・省略は常時有効」）。
  - 読込は数値パース＋範囲クランプ（下限/上限を設け、不正・未保存・例外は既定へフォールバック）。**省略機能自体のトグルは設けない**（常時有効）。

### (2) 切り詰めロジック（ttsQueue）

- [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の `TtsQueueOptions`（47-61 行）に `getMaxLength?: () => number` を足し、`enqueue` の **129 行 `.trim()` 直後・130 行の空判定の前**で、
  `text.length > max` のとき `text.slice(0, max) + "、以下略"` に置き換える（読み替え適用後の実読み上げテキストに対して数える）。空判定・`queue.push` はそのまま後段に流す。
  - 表示側（`renderDefaultItem`/`renderOverlayItem`・ティッカー 047）には触れない＝**表示は全文のまま**。

### (3) 本体の配線と設定 UI

- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) に `maxReadLength` state（`useState(()=>loadTtsMaxLength())`）＋永続化 `useEffect`＋ref 同期を追加し、`createTtsQueue`（405-408 行）へ `getMaxLength: () => maxReadLengthRef.current` を渡す。
- [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の読み上げカード（127-227 行）に**文字数の数値入力行**を追加し、値・onChange を props で受け渡す（`SettingsViewProps` に prop を追加・表示専用の性質は不変）。注記で「これ以上は『以下略』で省略して読み上げます（表示は全文のまま）」を添える。

## このタスクでやらないこと

- **表示側の切り詰め**（一覧/オーバーレイ/ティッカーは全文のまま）。省略の ON/OFF トグル（常時有効のため作らない）。
- 読み替え辞書（041）の変更。文数/秒数など文字数以外の上限。取得側（sidecar/wire/Rust）の変更。**新規外部通信・API・capability・依存の追加**。

## セキュリティ制約（docs/security.md 準拠）

- **frontend のローカル整形のみ**（localStorage の非機密数値設定＋合成前テキストの `slice`）。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 読み上げテキストを外部送信しない・Rust の DB/ログに出さない（§9・既存踏襲）。合成は従来どおり loopback 50021 のみ。

## 完了条件

- 既定文字数を超えるコメントの**読み上げ**が「…、以下略」で打ち切られ、超えないコメントは従来どおり全文読み上げられる。
- 文字数を設定画面から変更でき、再オープン・再起動で復元する。省略機能は常時有効（トグル無し）。
- **表示（一覧/オーバーレイ/ティッカー）は全文のまま**で変わらない。新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 長文コメントで読み上げが「以下略」で止まる／短文は全文読む／設定で文字数変更が効く／
                                         #   一覧・オーバーレイ表示は全文のまま、を目視
```

## 実装後に必要なレビュー

- 軽レビュー: frontend のローカル整形のみで外部通信宛先・API・capability・依存が不変であること、切り詰めが**読み上げテキストのみ**で表示を変えていないこと、
  読み上げテキストを外部送信/DB/ログに出していないことを確認する。
