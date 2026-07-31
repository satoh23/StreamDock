# 048 ずんだもん読み上げ 文字数上限（以下略で省略）

> 状態: **実装済み（2026-07-31）／実機確認は未実施**。記録は [`docs/progress.md`](../progress.md) の
> 「2026-07-31 (048 …)」節。実装の要点:
> - 切り詰めは**純関数 `capForSpeech(text, max)`**（`ttsQueue.ts` から export・`sanitizeForSpeech` の隣）で行い、
>   `enqueue` の読み替え適用直後・空判定の前で 1 回だけ呼ぶ。`enqueue` は
>   **① 入力決定 → ② sanitize → ③ 読み替え → ④ 切り詰め → ⑤ 空判定 → push** の 5 段になった（049 は ① だけを差し替える）。
> - **数える単位はコードポイント**（`[...text]`）。`slice` はサロゲートペアを割るため（`viewerFormat.ts` の
>   `authorInitial` と同じ理由）。書記素クラスタ（`Intl.Segmenter`）は意図的に採らない。
> - 上限値は getter 注入（`TtsQueueOptions.getMaxLength`）。**未注入なら切り詰めない**（既存 getter と同じ作法）。
> - 既定 **60** / 下限 **20** / 上限 **200**。クランプは `ttsPrefs.ts` の `clampTtsMaxLength` 1 関数だけが持つ。
> - 接尾辞は `SPEECH_ELLIPSIS = "、以下略"`。**実機での読みは未判定**——崩れていたら `、以下省略` /
>   `、いかりゃく` へ差し替え、結果を progress.md に追記すること。⚠ **差し替えは定数 1 行では終わらない**：
>   `ttsQueue.test.ts` がこの文字列をリテラルで期待している **4 箇所**も同時に直すこと
>   （テストから定数を import すると恒真式になるため、意図的にリテラルにしてある）。
> - 設定 UI は `<input type="number">`（**blur / Enter で確定**・打鍵ごとに localStorage へ書かない）。
> - **新規 `ttsQueue.test.ts` / `ttsPrefs.test.ts`**＝TTS 経路に初めて単体テストが入った（049/050 が追記する土台）。
>
> **調査で判明した定量根拠（本タスクが最優先である理由・**行番号は 048 実装前のもの**）**: 読み上げは FIFO 直列で、1 件の再生が終わるまで次に進まない
> （`ttsQueue.ts` の `playing` フラグ）。一方 `MAX_BACKLOG = 20` は超過分を**古い未読から破棄**するため、
> **長文 1 件の読み上げ中に届いたコメントが無言で捨てられる**。「長文コメントの後のコメントが読まれない」の直接原因。
>
> | 1 件の長さ | 読み上げ所要（≒4.5〜6 文字/秒） | dev-mock(1800ms) でその間に届く数 | 破棄される数 |
> | --- | --- | --- | --- |
> | 290 文字（`dev-mock.ts` の長文枠） | **約 48〜64 秒** | 27〜38 件 | **7〜18 件** |
> | 60 文字（本タスクの既定上限） | 約 10〜13 秒 | 5〜7 件 | **0 件** |
>
> ＝**本タスクだけで長文起因の取りこぼしはほぼ解消する**。残る「バースト起因の破棄」「破棄が見えない」
> 「合成タイムアウトが無い」は [050](050-tts-dropout-protection.md) が担当（**048 実装後に実測してから着手**）。
> 同じ `enqueue` を触る [049 課金イベントの読み上げ](049-monetary-event-speech.md) は **本タスクの後に**実装すること。
>
> **必読前提**: TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)、設定永続化 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)、
> 設定画面 [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、getter 注入の配線 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、
> 読み替え辞書 [041a](041a-reading-dictionary-engine-and-builtin.md)（適用順の直後に切り詰める）、[`docs/security.md`](../security.md)（§1）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ・ローカル整形のみ**＝**軽レビュー**。

## 目的

長すぎるコメントをずんだもん（VOICEVOX）が全部読み上げると配信が地獄になるため、**一定文字数を超えたら「以下略」で打ち切る**（要望⑤）。
省略は**常時有効**（トグルなし）で、**文字数はデフォルト値を持ち、設定画面からユーザーが変更できる**。表示（一覧/オーバーレイ）は従来どおり全文のまま、**読み上げテキストだけ**を切り詰める。

## 現在の前提（**行番号は 048 実装後の現状**。以下は実装済みの姿）

- 読み上げテキストの組立は [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の `enqueue`（170 行〜）:
  1. `sanitizeForSpeech(comment.text)`（33 行・URL/絵文字除去・空白畳み込み・著者名は読まない）。
  2. `applyReadingDictionary(sanitized, getReadingDictionary?.() ?? [])`（179 行・読み替え適用）→ `.trim()`。
  3. **`capForSpeech(replaced, getMaxLength?.() ?? Infinity)`（188 行・048 の切り詰め）**。
  4. 空ならスキップ（189 行）→ `queue.push(text)`（190 行）→ `pump()` で `synthesize`（158 行）へ。
  - 切り詰めの実体は**純関数 `capForSpeech`（72 行・export 済み）**で、接尾辞は `SPEECH_ELLIPSIS`（50 行）。
    `MAX_BACKLOG = 20`（22 行）は**件数**上限で文字数ではない（050 の領分・本タスクでは触っていない）。
- オプションは getter 注入方式: `TtsQueueOptions`（91 行〜）の `getSpeakerId`（97 行）/ `getReadingDictionary`（103 行）/
  **`getMaxLength`（112 行）**。キューはマウント時 1 回生成（[`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) 628 行）で、
  **その時点の値**を getter で読むため、上限値を変えてもキューは作り直されない。
- 設定の永続化は [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)（名前空間 `stream-dock.comment-viewer.*`・localStorage 直 read/write・例外握りつぶし）。
  048 で**このモジュール初の数値設定**が入った: `TTS_MAX_LENGTH_KEY`（32 行）/ `_DEFAULT` 60（40 行）/ `_MIN` 20（45 行）/
  `_MAX` 200（51 行）/ `clampTtsMaxLength`（59 行）/ `loadTtsMaxLength`（149 行）/ `saveTtsMaxLength`（160 行）。
- 本体の state/永続化/ref 同期: `CommentViewerApp.tsx` の `ttsMaxLength`（275 行）＋ `ttsMaxLengthRef`（299 行）＋
  永続化 effect ＋ ref 同期 effect（`selectedSpeakerId` と同じ作法）。
- 設定 UI は [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の「読み上げ（VOICEVOX）」カード（167 行〜）。
  文字数入力行は 200 行〜で、確定処理は `commitMaxLength`（127 行・blur / Enter で確定）。

## このタスクでやったこと（2026-07-31 実装・計画時の記述を実装結果へ更新）

### (1) 設定の保存（数値・既定値・常時有効）

- [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) にキー `stream-dock.comment-viewer.tts-max-length` を追加した
  （**このモジュール初の数値設定**。既存は真偽値のみ）。
  - 既定 **60** / 下限 **20** / 上限 **200** を定数で公開し、**クランプは `clampTtsMaxLength` 1 関数**が持つ。
    load（他窓・手書きの不正値への最後の砦）／save（範囲外を localStorage に残さない）／設定 UI の確定時 の 3 箇所が呼ぶ。
  - `loadTtsMaxLength` は未保存・空文字（`Number("")===0` の罠）・パース不能・例外をすべて既定へ、範囲外はクランプへ落とす。
  - **省略機能自体のトグルは設けない**（常時有効）。**「上限なし」も作らない**——クランプ下限/上限が構造的に保証する。

### (2) 切り詰めロジック（ttsQueue）

- **純関数 `capForSpeech(text, max)` を export** した（`sanitizeForSpeech` の隣）。`createTtsQueue` は `new AudioContext()` を
  作るため jsdom で動かず、**`enqueue` 直書きだと単体テストが書けない**ため切り出した。
- `TtsQueueOptions` に `getMaxLength?: () => number` を足し、`enqueue` の**読み替え適用＋ `.trim()` の直後・空判定の前**で
  1 回だけ呼ぶ。**未注入なら切り詰めない**（既存 getter と同じ「省略時は現行動作」）。
- **数える単位はコードポイント**（`[...text]`）。`slice` は UTF-16 コードユニット単位でサロゲートペアを割り孤立サロゲート
  「�」を作るため（`viewerFormat.ts` の `authorInitial` と同じ理由・非絵文字の 𠮷 は `sanitizeForSpeech` を通過する）。
  書記素クラスタ（`Intl.Segmenter`）は意図的に不採用。`text.length <= max` の高速パスあり。
- 接尾辞は定数 `SPEECH_ELLIPSIS = "、以下略"`（**読み替え辞書の適用後**に足すので辞書に壊されない）。`max` に含めない。
- 表示側（`renderDefaultItem`/`renderOverlayItem`・ティッカー 047・固定帯 046a）には**触れていない**（差分ゼロを実測）。

### (3) 本体の配線と設定 UI

- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) に `ttsMaxLength` state（`useState(() => loadTtsMaxLength())`）＋永続化 `useEffect`＋
  `ttsMaxLengthRef` 同期を追加し、`createTtsQueue` へ `getMaxLength: () => ttsMaxLengthRef.current` を渡す
  （**設定を変えてもキューを作り直さない**）。
- [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の読み上げカードに `<input type="number">` の行を追加した（CSS 追加ゼロ・既存クラス流用）。
  **確定は blur / Enter のみ**——打鍵途中の `8` が下限 20 へクランプされる事故と、1 打鍵ごとの localStorage 書き込みを
  同時に避けるため。空・NaN（全角数字はここに落ちる）は**直前の確定値へ戻す**。注記は
  「読み上げは指定文字数で打ち切り、続きは『以下略』と読みます（コメントの表示は全文のままです）。20〜200 文字。」

### (4) テスト（TTS 経路に初めて単体テストが入った）

- **新規** `ttsQueue.test.ts`（`capForSpeech` のみ・`createTtsQueue` は呼ばない＝AudioContext 不要）と
  **新規** `ttsPrefs.test.ts`（クランプ・往復・破損値の劣化先・save 前クランプ・localStorage 例外）。
  `SettingsView.obs.test.tsx` は `baseProps` に必須 props 2 つを足しただけ（検証対象は不変）。

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
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。
  → **2026-07-31 時点: typecheck / lint / test（22 files / 324 tests ＋ CSS guard）すべて green・progress.md 更新済み。
  残るのは実機確認のみ**（「以下略」の実際の読み・長文直後のコメントが読まれるかの実測）。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test        # ttsQueue.test.ts / ttsPrefs.test.ts ＋ 既存テストの非退行

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ apps/desktop/package.json
# 表示側を触っていないことの担保（差分ゼロが期待）
git status --short -- apps/desktop/src/screens/comment-viewer/CommentList.tsx \
  apps/desktop/src/screens/comment-viewer/PinnedCommentBar.tsx \
  apps/desktop/src/screens/comment-viewer/OverlayApp.tsx \
  apps/desktop/src/screens/comment-viewer/PinnedOverlayApp.tsx

pnpm --filter ./apps/desktop tauri dev   # 長文コメントで読み上げが「以下略」で止まる／**「以下略」の読みが意図どおりか**／
                                         #   短文は全文読む／設定で文字数変更が即座に効く（キューが作り直されない）／
                                         #   一覧・ティッカー・固定帯・オーバーレイ表示は全文のまま／
                                         #   **長文の直後に届いたコメントが読まれる**（本タスクの目的・050 の判断材料）
```

## 実装後に必要なレビュー

- 軽レビュー: frontend のローカル整形のみで外部通信宛先・API・capability・依存が不変であること、切り詰めが**読み上げテキストのみ**で表示を変えていないこと、
  読み上げテキストを外部送信/DB/ログに出していないことを確認する。
