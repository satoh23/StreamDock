# 041a 読み替えエンジン＋内蔵一般辞書

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [041](041-comment-viewer-reading-dictionary.md) を正とする。
>
> **必読前提**: 親 [041](041-comment-viewer-reading-dictionary.md)、TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（`sanitizeForSpeech`・29-35 行／`TtsQueueOptions` の getter 注入・46-54,96 行）、
> 話者 getter を渡す生成側 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、既存の自前データ配列の例 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)（`OVERLAY_FONTS`・25-49 行）、
> [`docs/security.md`](../security.md)（§1/§3/§10・CSP 方針）。CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。

## 目的

コメント本文を VOICEVOX に渡す**前**にかける「読み替え適用エンジン」と、**自前の内蔵一般辞書**を新設し、`ttsQueue.ts` に組み込む。これで「ww/wwww」「ChatGPT」などのネットスラング・英語/略語が意図どおりに読まれるようにする（要求1）。ユーザー編集辞書の重ね合わせは 041b で行う。

## 現在の前提（調査結果）

- 前処理は `sanitizeForSpeech`（`ttsQueue.ts:29-35`）が唯一。`enqueue`（`:113`）が呼び、整形後が空ならスキップ（`:114`）。
- キューは `getSpeakerId?()` **getter** で合成直前に選択値を読む（`ttsQueue.ts:49-53,96`）。静的値でなく getter にすることで設定変更のたびにキューを作り直さずに済む。**読み替え辞書も同じ getter パターンで注入する**。
- 「自前の固定データ配列を持ち回る」既存例が `overlaySettings.ts` の `OVERLAY_FONTS`（`as const` 配列）。内蔵辞書もこれと同型の自前配列にする。

## このタスクでやること

### 読み替えモジュール新設（`readingDictionary.ts`）

- `apps/desktop/src/features/comment-viewer/readingDictionary.ts` を新設する。
- エントリ型 `ReadingRule = { surface: string; reading: string; kind: "text" | "regex" }`（`reading` はカタカナ想定）。
- `applyReadingDictionary(text, rules): string` を提供する:
  - **長い surface 優先＋定義順**で適用し、部分一致の取りこぼし/衝突を安定化する（短い語が長い語の一部を先に食う事故を防ぐ）。
  - `kind: "text"` は文字列一致で置換、`kind: "regex"` はスラング反復（例 `w{2,}` → 「わら」）や記号向け。regex は**内蔵辞書内の定義のみ**が持つ想定（ユーザー入力は 041b で text 固定＝任意正規表現をユーザーに書かせない）。
- 内蔵一般辞書 `BUILTIN_READING_DICTIONARY: ReadingRule[]` を**自分たちで書き起こして**同梱する（第三者辞書のデータ/コードは転載しない・`OVERLAY_FONTS` と同じ自前配列）。初期キュレーション例:
  - ネットスラング: `ww`/`wwww`（regex `w{2,}` → 「わら」）、末尾 `w`、`草`、`kwsk`、`乙` 等。
  - 英語/tech 略語: `ChatGPT`→「チャットジーピーティー」、`API`→「エーピーアイ」、`OBS`→「オービーエス」、`URL`→「ユーアールエル」等。
  - 記号: `→`→「やじるし」等（読み上げに邪魔なもののみ・過剰置換はしない）。
  - **小規模で開始し、後から追記しやすい構造**（コメント付き分類）にする。網羅は狙わない（不足はユーザー辞書＝041b で補う前提）。

### TTS パイプラインへの組み込み（`ttsQueue.ts`）

- `TtsQueueOptions` に `getReadingDictionary?: () => ReadingRule[]` を追加（`getSpeakerId` と同じ getter 注入・省略時は空辞書＝現行動作）。
- `sanitizeForSpeech` の**後段**で `applyReadingDictionary` を適用する（URL/絵文字除去 → 空白畳み込み → 読み替え適用 → trim の順。適用後に空ならスキップの既存挙動は維持）。
  - `enqueue` 内で `applyReadingDictionary(sanitized, getReadingDictionary?.() ?? [])` とする形。空判定（`:114`）は適用後の文字列で行う。
- 生成側 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `createTtsQueue({...})` に `getReadingDictionary: () => BUILTIN_READING_DICTIONARY` を渡す（041a では内蔵のみ。ユーザー辞書のマージは 041b）。

## このタスクでやらないこと

- ユーザー編集 UI・localStorage 永続・内蔵とのマージ（041b）。
- VOICEVOX ユーザー辞書（`/user_dict*`）登録。形態素解析器/大型辞書の追加。
- 読み上げ ON/OFF・音量・話者など既存設定の変更。オーバーレイ/表示ロジックの変更。

## セキュリティ制約（docs/security.md 準拠）

- **frontend の純粋なテキスト置換のみ**。外部通信宛先・API・capability・依存・CSP を増やさない（§1/§3/§10・`csp: null` 不変）。通信は既存の loopback 50021（VOICEVOX）のまま。
- 内蔵辞書は**コード同梱の自前データ**（外部から DL しない・第三者辞書を転載しない）。
- regex エントリは**内蔵辞書内の定義のみ**（ユーザーに任意正規表現を書かせない）。ReDoS を招く貪欲/入れ子量指定子を内蔵定義に入れない。
- 取得コメントを Rust の DB/ログに出さない（§9・既存踏襲）。

## 完了条件

- 「ww」「wwww」が「わら」等で、「ChatGPT」が「チャットジーピーティー」で読まれる（内蔵辞書経由）。
- 辞書が空/未注入でも従来どおり読み上げが動く。適用後に空になったコメントはスキップされる。
- 新規宛先/API/capability/依存を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る（Rust 変更なし＝`cargo check` 省略可）。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # コメビュで "wwww" や "ChatGPT すごい" を含むコメントを流し、
                                         #   「わら」「チャットジーピーティー」等で読まれることを目視
```

## 実装後に必要なレビュー

- security-review（軽）: frontend の純粋テキスト置換のみで外部通信宛先・API・capability・依存・CSP が不変であること、内蔵辞書が自前データ（第三者辞書の転載でない）であること、regex 定義がユーザー入力由来でなく ReDoS を招かないことを確認する。
