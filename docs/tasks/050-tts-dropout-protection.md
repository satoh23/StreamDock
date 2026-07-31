# 050 読み上げ取りこぼしの可視化と保護（無言で捨てない・詰まらせない）

> 状態: **未着手（単体タスク・2026-07-28 起票）**。[048](048-tts-reading-length-cap.md) は **2026-07-31 に実装済み**
> だが、**実機での実測がまだ**（長文起因の取りこぼしがどこまで減ったか）。**実測してから着手する**という取り決めは
> そのまま有効で、実測結果は `docs/progress.md` の「2026-07-31 (048 …)」節に追記されるので、それを見てから始めること。
>
> **必読前提**（⚠ 行番号は **048 実装後の現状**に更新済み）: TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（`pump` 129 行〜 / `enqueue` 170 行〜）、
> 合成クライアント [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts)（`synthesize` 94 行〜）、
> [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)（`engineBanner` 1442 行付近＝既存の通知面）、
> [048](048-tts-reading-length-cap.md) / [049](049-monetary-event-speech.md)（同じ `enqueue` を触る）、[`docs/security.md`](../security.md)（§1/§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ**＝**軽レビュー**。

## 目的

「読まれるコメントと読まれないコメントがある」の根本は、**読み上げが黙って諦める経路が 3 つある**こと。
どれも `console.debug` か無言で、**ユーザーには壊れているようにしか見えない**。捨てるなら見せる／詰まるなら塞ぐ。

## 現在の前提（調査結果・実コード）

### 経路1: backlog 上限による「古い未読の破棄」（無言）

[`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) 190-195 行:

```ts
queue.push(text);
if (queue.length > MAX_BACKLOG) {          // MAX_BACKLOG = 20（22 行）
  const dropped = queue.length - MAX_BACKLOG;
  queue.splice(0, dropped);                // 古い方＝直前の長文の後に来たコメントから捨てる
  console.debug(`TTS backlog 上限超過: 古い未読 ${dropped} 件を破棄`);
}
```

読み上げは FIFO 直列（`playing` フラグ・`pump` 129 行〜）で、1 件の再生が終わるまで次に進まない。**実測に基づく試算**:

| 1 件の長さ | 読み上げ所要（VOICEVOX 日本語 ≒ 4.5〜6 文字/秒） | dev-mock（1800ms 間隔）でその間に届く数 | 破棄される数 |
| --- | --- | --- | --- |
| 290 文字（`dev-mock.ts` の長文枠・赤スパ本文上限相当） | **約 48〜64 秒** | 27〜38 件 | **7〜18 件** |
| 200 文字 | 約 33〜44 秒 | 18〜24 件 | 0〜4 件 |
| 60 文字（048 の既定上限） | 約 10〜13 秒 | 5〜7 件 | **0 件** |

→ **048（文字数上限）を入れるだけで長文起因の破棄はほぼ解消する**。ただし**バースト起因の破棄は残る**
（実チャットで毎秒 2 件が 20 秒続けば 40 件到着 → 20 件破棄）。また破棄されること自体が今は見えない。

### 経路2: 合成のタイムアウトが無い（詰まると全部詰まる）

[`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts) の `synthesize`（94 行〜）は
`signal?: AbortSignal` を**受け取れるのに、`ttsQueue` から渡していない**（[`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) 151-155 行に
「dispose で中断しないため意図的に渡さない」と明記）。結果、VOICEVOX ENGINE が応答を返さないと
`playing` が **true のまま張り付き**、その間の到着分がすべて経路1 で捨てられる。

### 経路3: AudioContext が running でないときの「1 件スキップして次へ」（無言）

[`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) 140-150 行。`ctx.state !== "running"` なら `resume` を試み、
それでも running でなければ**その 1 件を捨てて `finally` から `pump()` を再帰**する。
macOS でアプリが背面に回る等で AudioContext が suspended になると、ユーザー操作が来るまで resume できないため
**キュー全体が数十件まとめて無音消費**されうる。通知は `console.debug`（148 行）のみ。

- ⚠ この設計は「**永久ハングを塞ぐため**」に意図的にこうしてある（135-139 行のコメントに経緯が明記）。
  **ハングを再発させない形でしか変えてはいけない**。
- **未確定**: 実機で本当に発生しているかは未確認。**本タスクの (1) を先に入れて可視化し、発生の有無を確定させてから (3) を判断する**。

### その他

- **048（2026-07-31）で `ttsQueue.test.ts` / `ttsPrefs.test.ts` が新設された**が、対象は純関数（`capForSpeech` /
  `sanitizeForSpeech`）だけで、**キュー本体（`createTtsQueue` / `pump`）のテストはまだ無い**（`voicevox.ts` /
  `readingDictionary.ts` も同様）。本タスクの (5) はこの `ttsQueue.test.ts` へ追記する形になる。
- 既存の通知面は `CommentViewerApp.tsx` の `engineBanner`（1442 行付近・`role="alert"`／VOICEVOX 未起動の誘導）。
  本タスクの通知はここに相乗りするのが自然（新規の UI 概念を増やさない）。

## このタスクでやること

### (1) 捨てたことを見せる（3 経路すべて）

- `TtsQueueOptions`（91 行〜・048 で `getMaxLength` が加わり getter は 3 つ）に
  `onSkipped?: (reason: "backlog" | "audio-suspended" | "synth-timeout", count: number) => void` を足す
  （既存 getter 群と同じ注入方式・未注入なら現行どおり `console.debug` のみ）。
- 呼び出し箇所: 経路1（193 行の `splice` 直後）／経路2（新設のタイムアウト catch）／経路3（148 行の `console.debug` と同じ場所）。
- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) 側で件数を集計し、
  既存 `engineBanner` の並びに**控えめな注記**を出す（例: 「読み上げが追いつかず 12 件スキップしました」）。
  - **一定時間で自動的に消す**（常時出しっぱなしにしない）。読み上げ OFF のときは出さない。
  - 理由別に文言を変える（backlog＝追いつかない／audio-suspended＝音声が止まっている／synth-timeout＝ENGINE が応答しない）。

### (2) 合成タイムアウト（詰まりを塞ぐ）

- [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の `pump`（158 行）で `synthesize` に **`AbortSignal` を渡す**
  （`AbortController` ＋ `setTimeout` の標準 API のみ＝**新規依存ゼロ**）。既定 10 秒（要調整）。
- タイムアウトしたら**その 1 件だけ諦めて次へ進む**（既存 catch と同じ作法・直列は止めない）。`onSkipped("synth-timeout", 1)` を呼ぶ。
- 151-155 行の「意図的に signal を渡さない」コメントは、**dispose 中断とタイムアウト中断は別目的**である旨に更新する
  （dispose 時は従来どおり中断しない＝`disposed` ガードで再生を抑止する設計は維持）。

### (3) AudioContext suspended の扱い（**(1) の実測後に判断**）

- (1) で `audio-suspended` が実際に発生すると確認できた場合のみ着手する。発生しなければ**何もしない**。
- 方針候補（実装時に決める）: 「捨てる」→「**キューに戻して待ち、再開導線（クリックで再開）を出す**」。
  ただし **`playing` を true のまま放置しない**こと（永久ハングの再発は絶対に避ける）。

### (4) MAX_BACKLOG の再評価

- 048 は実装済み（2026-07-31）。**実機で実測してから** 20 のままでよいか判断する。**上限導入で溢れにくくなっているはずなので、安易に増やさない**
  （増やすと「今のコメント」ではなく「数分前のコメント」を読み続ける、より悪い体験になる）。
- 変える場合は根拠（実測値）を [`docs/progress.md`](../progress.md) に残す。

### (5) テスト

- `ttsQueue.test.ts` へ**追記**（048 で新規作成済み・純関数のみが対象なのでキュー本体は未カバー）: `synthesize` / `playWav` をモックし、**通信も音声再生も行わない**前提で、
  - backlog 超過で**古い方から**破棄され `onSkipped("backlog", n)` が呼ばれる（現在の「無言で捨てる」の回帰検知）。
  - 合成がタイムアウトしたら**その 1 件だけ**諦め、**次の 1 件は読まれる**（直列が止まらない＝経路2 の担保）。
  - 合成が例外を投げても直列が止まらない（既存挙動の回帰）。
  - `dispose` 後は enqueue しても何も起きない（既存挙動の回帰）。

## このタスクでやらないこと

- **読み上げ文字数上限**（048 の担当）。**課金イベントの読み上げ**（049 の担当）。
- 並列合成・先読み合成（直列＝音が重ならない、という現行の中核設計は変えない）。
- 読み替え辞書（041）の変更。取得側（sidecar / wire / Rust）の変更。**新規外部通信・API・capability・依存の追加**。
- 経路3 の挙動変更を**発生確認前に**行うこと（(3) の前提）。

## セキュリティ制約（docs/security.md 準拠）

- **frontend のみ**（`AbortController` / `setTimeout` / コールバック注入＝標準 API のみ）。
  外部通信宛先・API・capability・依存を増やさない（§1/§3/§10）。`csp: null` 不変。合成は従来どおり **loopback 50021 のみ**。
- **通知にコメント本文・投稿者名を出さない**（**件数と理由だけ**）。§9 の非ログ・非外部送信は不変。

## 完了条件

- 読み上げが取りこぼしたとき、**件数と理由が画面に出る**（一定時間で消える・読み上げ OFF 時は出ない）。
- VOICEVOX が応答しなくても**その 1 件で止まらず次が読まれる**。
- 通知に本文・投稿者名が含まれない。新規宛先／API／capability／依存の追加が無い。`csp: null` 不変。
- `ttsQueue.test.ts` が上記 4 ケースで緑（**キュー本体に初めて単体テストが入る**）。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新
  （経路3 の発生有無と、MAX_BACKLOG を変えたならその実測根拠を必ず残す）。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
COMMENT_SIDECAR_MOCK=1 pnpm tauri dev
#   ・VOICEVOX を停止した状態で読み上げ ON → 1 件で固まらず「ENGINE が応答しない」旨が出る
#   ・長文（seq%20===1 / 19）の直後のコメントが読まれるか、読まれないならスキップ通知が出る
#   ・アプリを背面に回してから戻す → audio-suspended の通知が出るか（経路3 の発生有無の確定）
```

## 実装後に必要なレビュー

- 軽レビュー: frontend のみで外部通信宛先・API・capability・依存が不変であること、
  **通知に本文・投稿者名が出ていない**こと（件数と理由のみ＝§9）、
  タイムアウト導入で**永久ハングの経路が新たに生まれていない**こと（`playing` が必ず false に戻る）を確認する。
