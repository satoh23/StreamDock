# 049 課金イベントの読み上げ（メンシプ／ギフト／サブスク／ジュエルを無音にしない）

> 状態: **未着手（単体タスク・2026-07-28 起票）**。読み上げ不具合の調査で判明した**設計の穴**への対応。
>
> **必読前提**: TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)、表示文言の組立
> [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) の `composeEventMessage`、
> getter 注入の配線 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、
> [048 読み上げ文字数上限](048-tts-reading-length-cap.md)（**同じ `enqueue` を触るので実装順に注意**）、
> [`docs/security.md`](../security.md)（§1/§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ・ローカル整形のみ**＝**軽レビュー**。

## 目的

メンバーシップ継続・メンバーシップギフト・サブスクなどの課金イベントが**まったく読み上げられない**（無音になる）。
配信者が見逃したくない種別ほど音で分からない、という逆転が起きているため、**表示に出ている文言をそのまま読み上げる**。

## 現在の前提（調査結果・実コード）

- **読み上げの入力は `comment.text` だけ**。[`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の `enqueue`（117-138 行）が
  `sanitizeForSpeech(comment.text)`（121 行）→ 読み替え辞書（126-129 行）→ **空ならスキップ**（130 行）という流れで、
  `comment.text` 以外のフィールドを一切見ない。
- **一方、課金イベントの `text` は空**。043b の設計で「要約文言は表示側が組み立てる」ことにしたため、
  `membership` / `gift` は `text = ""`、`subscription` は自由コメントがある時だけ本文が入る。
  表示は [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) の `composeEventMessage`（133-157 行）が
  「〇〇さんがメンバーシップを6ヶ月継続しました」を**別途**組み立てて `CommentList.tsx` が描画している。
  ＝**画面に出ている文言が TTS の入力に一度も渡っていない**（043b で表示側だけ実装され読み上げ側が追従しなかった）。
- 現状の種別ごとの読み上げ結果:

  | 種別 | `comment.text` | `composeEventMessage` | 現在の読み上げ |
  | --- | --- | --- | --- |
  | `chat` / `superchat` / `bits` / `donation` | 視聴者の本文 | null | 読まれる（金額は読まれない） |
  | `membership` | 空 | あり | **無音** |
  | `gift` | 空 | あり | **無音** |
  | `subscription` | 自由コメントのみ | あり | 自由コメントがある時だけ本文のみ |
  | `jewels` | 実データはほぼ空 | **null（未実装）** | **無音** |

- ⚠ **`jewels` は dev-mock でだけ読まれる**。`dev-mock.ts` が `text = "投げ銭ジュエル 🎁"` を入れているため
  dev では音が出るが、実データの `GIFT_EVENT` は本文を持たないので**本番で無音**になる。dev 確認では気付けない。
- オプションは getter 注入方式（[`TtsQueueOptions`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts#L47) の
  `getSpeakerId` 54 行 / `getReadingDictionary` 60 行）。キューはマウント時 1 回生成で、合成直前に getter で最新値を読む。
  **本タスクも同じ手本に乗る**（キューを作り直さない）。
- `viewerFormat.ts` は「**依存ゼロ**（React/CSS/DOM 非依存）」と冒頭に明記された純関数モジュール。
  ただし置き場所は `screens/` 配下なので、`features/` 配下の `ttsQueue.ts` から直接 import すると**層が逆転する**。

## 決定事項（2026-07-28）

1. **課金イベントは投稿者名を読む**。`ttsQueue.ts` 冒頭の既存方針「著者名は読まない（本文のみ）」は
   **通常チャット・スパチャに限って維持**し、課金イベントだけ「〇〇さんが〜」と読む（誰が支援したかを音で分かるようにするのが目的のため）。
   ＝**既存方針の限定的な例外**であり、方針そのものは変えない。
2. **`jewels` の読み上げ文言を新設する**。ただし **読み上げ専用**とし、**表示側（`composeEventMessage`）は変更しない**。
   - 理由: `composeEventMessage` が jewels に対し null を返すのは「金額バッジと文言が重複するのを避ける」という 043b の
     意図的な設計で、ここを変えると `CommentList` の表示とテスト（043b/043c/043d/043e）に波及する。
     読み上げだけを足せば**表示の回帰リスクはゼロ**になる。
   - ※ 起票時の選択肢説明では「表示側にも同じ文言が出る」と書いたが、実コードを追った結果**読み上げ専用のほうが安全**と判断した。
     表示にも出したい場合は本タスク完了後に別途起票する（1 行の追加で済む）。
3. **種別ごとの読み上げ ON/OFF トグルは作らない**（既定で全種別を読む）。source 別トグル（035c）の下に種別軸を足すと
   設定が増えすぎるため、要望が出てから別タスクにする。
4. **層の逆転を避けるため、読み上げ文言の組立は `screens/` 側に置いて getter で注入する**（下記 (1)(3)）。
   `composeEventMessage` を `features/` へ移動する案は、import 元の書き換えが発生し「仕様にない大規模リファクタ」に当たるため採らない。

## このタスクでやること

### (1) 読み上げ文言の組立（新規・純関数）

- **新規** `apps/desktop/src/screens/comment-viewer/speechText.ts` に `composeSpeechText(c: CommentViewDto): string` を作る。
  `viewerFormat.ts` と同じ層・**依存ゼロの純関数**（React/CSS/DOM 非依存＝単体テスト可能）にする。
- 種別ごとの返り値:
  - `membership` / `gift` / `subscription` … `composeEventMessage` と**同じ文面**（`viewerFormat.ts` から import して再利用し、
    文言を二重管理しない）。自由コメント（`c.text`）があれば「。」で連結して続けて読む。
  - `jewels` … **新設**「`{名前}さんがジュエルを{数}贈りました`」。数は `c.monetary?.amount`。
    金額が無い（`monetary` 未設定）ときは「`{名前}さんがジュエルを贈りました`」。
  - `chat` / `superchat` / `bits` / `donation` / 未知の種別 … **従来どおり `c.text` をそのまま返す**（名前は読まない＝現行踏襲）。
- **読み上げ用の整形**を入れる（表示用文言をそのまま読むと不自然になるため）:
  - `（Tier2）` → `ティア2`（丸括弧のままだと「かっこ ティア に かっこ」と読まれる）。
  - 数値は素のまま渡す（VOICEVOX 側が読む）。
- 未知の種別は `c.text` へ無害に劣化させる（`composeEventMessage` の default が null を返す設計と同じ作法）。

### (2) 読み上げ入力の差し替え（ttsQueue）

- [`TtsQueueOptions`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts#L47) に
  `getSpeechText?: (comment: CommentViewDto) => string` を足す（既存 getter 2 つと同じ注入方式）。
- `enqueue` の **121 行**を `sanitizeForSpeech(getSpeechText?.(comment) ?? comment.text)` に変える。
  以降（読み替え辞書 → 048 の切り詰め → 空判定 → `queue.push`）は**一切変えない**。
  ＝未注入時は現行と完全に同じ挙動（後方互換）。
- 冒頭の docstring「著者名は読まない（本文のみ）」に、**課金イベントだけ例外である旨と理由**を追記する。

### (3) 本体の配線

- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の `createTtsQueue` 呼び出しに
  `getSpeechText: composeSpeechText` を渡す。**純関数なので ref 同期は不要**（`getSpeakerId` のような state 依存が無い）。

### (4) テスト

- **新規** `speechText.test.ts`: 種別ごとの文言（`membership` / `gift`(Twitch/YouTube 語彙) / `subscription` / `jewels`）／
  自由コメントの連結／`（TierN）` の整形／**`chat` と `superchat` は名前を読まない**（現行方針の維持を固定）／
  未知の種別は `c.text` へ劣化／`monthCount` 等が無いときの分岐。
- **新規** `ttsQueue.test.ts`（**現状 TTS 経路には単体テストが 1 つも無い**ので、この機会に作る）:
  `getSpeechText` を注入すると `text` が空のコメントでも読み上げキューに載ること／未注入なら従来どおり `text` を読むこと／
  `sanitizeForSpeech` の既存仕様（URL・絵文字除去）。`synthesize` / `playWav` はモックし、**通信も音声再生も行わない**。

## このタスクでやらないこと

- **表示側の変更**（`composeEventMessage` / `CommentList` / オーバーレイ / ティッカーは一切触らない）。
- 種別ごとの読み上げ ON/OFF トグル（決定事項 3）。金額の読み上げ（スパチャ額を読むかは別要望）。
- 読み上げ文字数上限（**048 の担当**）。取りこぼしの可視化・合成タイムアウト（**050 の担当**）。
- 読み替え辞書（041）の変更。取得側（sidecar / wire / Rust）の変更。**新規外部通信・API・capability・依存の追加**。

## 実装順の注意（048 との関係）

- 048 と本タスクは**同じ `enqueue`（121-130 行）を触る**。**048 を先に実装する**こと。
  - 理由: 本タスクで読み上げテキストが長くなる（名前＋要約＋自由コメント）ため、先に上限が入っていないと
    長文起因の取りこぼし（050 の背景）を悪化させる。
  - 048 実装後の `enqueue` は「① 入力決定 → ② sanitize → ③ 読み替え → ④ 切り詰め → ⑤ 空判定」となり、
    本タスクは **① だけ**を差し替える形になる（衝突しない）。

## セキュリティ制約（docs/security.md 準拠）

- **frontend のローカル整形のみ**（純関数の文字列組立）。外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。
- 合成は従来どおり **loopback 50021 のみ**。読み上げテキストを端末外へ送信しない・Rust の DB/ログに出さない（§9・既存踏襲）。
- **§9 の注意**: 本タスクで読み上げ文言に**投稿者名（第三者の個人情報）が入る**。ただし宛先は既存の loopback VOICEVOX のみで、
  044a 以前から `comment.text` も同じ経路を通っており、**新たな宛先・保存・ログは一切増えない**（音声として再生されるだけ）。
  受贈者名は 043d 決定1 のとおりそもそも受信していないため、読み上げ対象にもなり得ない。

## 完了条件

- メンバーシップ継続／メンバーシップギフト（YouTube）／サブギフト（Twitch）／サブスク／ジュエルが**読み上げられる**。
- 通常チャット・スパチャの読み上げは**従来と完全に同じ**（名前を読まない・本文のみ）。
- 表示（一覧／オーバーレイ／ティッカー／視聴者詳細）が**1 ピクセルも変わらない**。
- 新規宛先／API／capability／依存の追加が無い。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test            # speechText.test.ts / ttsQueue.test.ts が緑
COMMENT_SIDECAR_MOCK=1 pnpm tauri dev        # YouTube 単独接続・読み上げ ON で下記を耳で確認
#   seq%20===7  membership → 「〇〇さんがメンバーシップを6ヶ月継続しました」
#   seq%20===14 gift       → 「〇〇さんがメンバーシップギフトを5件贈りました」
#   seq%20===9  jewels     → 「〇〇さんがジュエルを30贈りました」
#   seq%20===12 combo 更新 → **読み上げない**（043e: updated は added に載らない）
#   通常チャット           → 名前を読まず本文のみ（従来どおり）
```

## 実装後に必要なレビュー

- 軽レビュー: frontend のローカル整形のみで外部通信宛先・API・capability・依存が不変であること、
  **表示側に一切手を入れていない**こと、読み上げテキストを端末外送信／DB／ログに出していないこと、
  通常チャット・スパチャの読み上げ挙動が従来と同一であること（名前を読んでいないこと）を確認する。
