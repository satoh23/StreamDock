# 050 読み上げ取りこぼしの可視化と保護（無言で捨てない・詰まらせない）

> 状態: **未着手（単体タスク・2026-07-28 起票）**。[048](048-tts-reading-length-cap.md) は **2026-07-31 に実装済み**
> だが、**実機での実測がまだ**（長文起因の取りこぼしがどこまで減ったか）。**実測してから着手する**という取り決めは
> そのまま有効で、実測結果は `docs/progress.md` の「2026-07-31 (048 …)」節に追記されるので、それを見てから始めること。
>
> **必読前提**（⚠ 行番号は **049 フォローアップ後の現状**に更新済み。原則は**行番号ではなくシンボル名で特定**すること）:
> TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（`pump` 211 行〜 / `enqueue` 254 行〜 /
> `MAX_BACKLOG` 42 行 / `MAX_PRIORITY_BACKLOG` 49 行 / `priorityQueue.push` 280 行 / `queue.push` 288 行〜 /
> AudioContext ガード 224-233 行 / AbortSignal を渡さない理由 235-239 行）、
> 合成クライアント [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts)（`synthesize` 94 行〜）、
> [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)（`engineBanner` 1453 行付近＝既存の通知面）、
> [048](048-tts-reading-length-cap.md) / [049](049-monetary-event-speech.md)（同じ `enqueue` を触る）、[`docs/security.md`](../security.md)（§1/§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**frontend のみ**＝**軽レビュー**。

## 目的

「読まれるコメントと読まれないコメントがある」の根本は、**読み上げが黙って諦める経路が 3 つある**こと。
どれも `console.debug` か無言で、**ユーザーには壊れているようにしか見えない**。捨てるなら見せる／詰まるなら塞ぐ。

## 現在の前提（調査結果・実コード）

### 経路1: backlog 上限による「古い未読の破棄」（無言）

⚠ **049 フォローアップ（2026-07-31）で大きく変わった**。実機で「同じコメントが何度も読み上げられる」
「課金が読まれないことがある」と報告され、原因が**この経路の常時発動**だと判明したため、着手前に手当てを入れた:

- **`MAX_BACKLOG` を 20 → 6 に下げた**（下記「実機で分かったこと」）。
- **課金イベントは専用の優先キュー**（`priorityQueue`）へ載せ、**破棄せず・通常キューより先に読む**ようにした
  （`TtsQueueOptions.isPriority` で注入＝`ttsQueue` は種別を見ない）。**経路1 で捨てられるのは通常チャットだけ**になった。

[`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) 279-293 行:

```ts
if (isPriority?.(comment)) {                 // 課金＝捨てない・先に読む（49 行の MAX_PRIORITY_BACKLOG=50 は防御用）
  priorityQueue.push(text);
  ...
} else {
  queue.push(text);
  if (queue.length > MAX_BACKLOG) {          // MAX_BACKLOG = 6（42 行・049 フォローアップで 20 から変更）
    const dropped = queue.length - MAX_BACKLOG;
    queue.splice(0, dropped);                // 古い方＝直前の長文の後に来たコメントから捨てる
    console.debug(`TTS backlog 上限超過: 古い未読 ${dropped} 件を破棄`);
  }
}
```

**残る課題は「捨てたことが見えない」こと**（本タスクの (1)）＝ 上の変更は「何を捨てるか」を直しただけで、
`console.debug` 止まりなのは変わっていない。

#### 実機で分かったこと（2026-07-31・本タスクの前提を書き換える実測）

**読み上げは到着に構造的に追いつかない**。048 の既定 60 文字は VOICEVOX で 10〜13 秒かかるが、
dev-mock は 1800ms 間隔／provider なので:

| 接続 | 到着間隔 | 1 件読む間に届く数 |
| --- | --- | --- |
| provider 1 本 | 1.8 秒 | **5.6〜7.4 件** |
| provider 2 本 | 0.9 秒 | **11.1〜14.8 件** |

＝ **キューは定常的に満杯**になり、経路1 が**常時**発動している（048 の「60 文字なら破棄 0 件」は
「1 件の長文の直後に何件届くか」の試算で、**定常状態の到着レートを見ていなかった**）。
さらに `MAX_BACKLOG=20` は**満杯の消化に 3〜4 分**かかるため、読み上げが画面から数分遅れて
「今は流れていないコメントを延々読む」状態になっていた（＝「同じコメントが何度も読まれる」の正体）。
6 件なら遅延の上限が **1 分程度**に収まる。

⚠ **`(4) MAX_BACKLOG の再評価` は上記で前倒し実施済み**。本タスクでは (1) の可視化を入れたうえで、
**6 が妥当かを実測で再評価**すること（「安易に増やさない」原則は不変）。

読み上げは FIFO 直列（`playing` フラグ・`pump` 211 行〜）で、1 件の再生が終わるまで次に進まない。**実測に基づく試算**:

| 1 件の長さ | 読み上げ所要（VOICEVOX 日本語 ≒ 4.5〜6 文字/秒） | dev-mock（1800ms 間隔）でその間に届く数 | 破棄される数 |
| --- | --- | --- | --- |
| 290 文字（`dev-mock.ts` の長文枠・赤スパ本文上限相当） | **約 48〜64 秒** | 27〜38 件 | **7〜18 件** |
| 200 文字 | 約 33〜44 秒 | 18〜24 件 | 0〜4 件 |
| 60 文字（048 の既定上限） | 約 10〜13 秒 | 5〜7 件 | **0 件** |

→ **048（文字数上限）を入れるだけで長文起因の破棄はほぼ解消する**。ただし**バースト起因の破棄は残る**
（実チャットで毎秒 2 件が 20 秒続けば 40 件到着 → 20 件破棄）。また破棄されること自体が今は見えない。

⚠ **049 実装（2026-07-31）で上表の「届く数」の前提が変わった**。従来は `membership` / `gift` / `jewels` が
`text` 空で ⑤ 空判定に落ち**キューに載っていなかった**が、049 以降は要約文言が読まれるので載る。
**1 件あたりの長さは 048 の上限（既定 60）で頭打ち**なので、1 件の占有時間の上限は変わらない（増えるのは件数だけ）。

増分の内訳（**049 レビュー Q-3 で数え直して訂正**。当初「seq 7/9/13/14 の 4 件・約 +20%」と書いたが誤り）:

- **`seq 9`（jewels）は増分に数えない**。dev-mock だけが `text = "投げ銭ジュエル 🎁"` を入れているため
  **従来から dev では読まれていた**（049 で変わるのは読まれる内容だけ）。本番のみ無音だったのが本タスクの罠。
- **`seq 7 / 9 / 13 / 14` は同時に成立しない**。`dev-mock.ts` の `seq` は**両 provider 共通の単調カウンタ**で、
  各イベントは `seq % 20 === k` **かつ**特定 `source` を要求する。両 provider は同一間隔（1800ms）なので seq は
  厳密に交互＝**{7, 9, 13} は同じパリティ・14 は逆**。7/9/14 は youtube、13 は twitch を要求するため、
  **1 周期で発火するのは最大 2 件**。

| 構成 | 新たに読み上げ対象になる件（20 seq あたり） | 増分 |
| --- | --- | --- |
| 両接続・odd=youtube | seq 7（9 は既読・13/14 は不発） | **+1 件（+5%）** |
| 両接続・odd=twitch | seq 13, 14 | **+2 件（+10%）** |
| YouTube 単独 | seq 7, 14（9 は既読） | **+2 件（+10%）** |
| Twitch 単独 | seq 13（17 は既読） | **+1 件（+5%）** |

＝**dev-mock での実際の増加は +5〜10%**（seq 12 の combo 更新は `mergeComments` の `updated` なので従来どおり
載らない＝この点は当初の記述どおり正しい。`seenIds` も二重の防波堤になる）。

⚠ **dev-mock の比率は実データを代表しない**。本番では `membership` / `gift` / `jewels` が
**100% 無音 → 100% 読み上げ**に変わるので、**課金イベントの多い配信ほど増分は大きい**。
バースト起因の破棄を実測するときは dev-mock の数字ではなく**実配信での課金イベント比率**を根拠にすること。

### 経路2: 合成のタイムアウトが無い（詰まると全部詰まる）

[`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts) の `synthesize`（94 行〜）は
`signal?: AbortSignal` を**受け取れるのに、`ttsQueue` から渡していない**（[`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) 235-239 行に
「dispose で中断しないため意図的に渡さない」と明記）。結果、VOICEVOX ENGINE が応答を返さないと
`playing` が **true のまま張り付き**、その間の到着分がすべて経路1 で捨てられる。

### 経路3: AudioContext が running でないときの「1 件スキップして次へ」（無言）

[`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) 219-233 行。`ctx.state !== "running"` なら `resume` を試み、
それでも running でなければ**その 1 件を捨てて `finally` から `pump()` を再帰**する。
macOS でアプリが背面に回る等で AudioContext が suspended になると、ユーザー操作が来るまで resume できないため
**キュー全体が数十件まとめて無音消費**されうる。通知は `console.debug`（232 行）のみ。

- ⚠ この設計は「**永久ハングを塞ぐため**」に意図的にこうしてある（219-223 行のコメントに経緯が明記）。
  **ハングを再発させない形でしか変えてはいけない**。
- **未確定**: 実機で本当に発生しているかは未確認。**本タスクの (1) を先に入れて可視化し、発生の有無を確定させてから (3) を判断する**。

### その他

- **048（2026-07-31）で `ttsQueue.test.ts` / `ttsPrefs.test.ts` が新設**され、**049（2026-07-31）でキュー本体
  （`createTtsQueue` / `enqueue`）のテストが入った**（`vi.mock("./voicevox")` ＋ **AudioContext スタブは
  `ttsQueue.test.ts` のファイル内で `vi.stubGlobal`**・`src/test/setup.ts` には置かない／⚠ 初期 `state` は
  **"running" 必須**＝`pump` が running でない 1 件を読み上げずに return するため）。**この土台をそのまま使える**
  ので、本タスクの (5) は `ttsQueue.test.ts` へ追記する形になる（`voicevox.ts` / `readingDictionary.ts` は未カバーのまま）。
- 既存の通知面は `CommentViewerApp.tsx` の `engineBanner`（**1453** 行付近・`role="alert"`／VOICEVOX 未起動の誘導）。
  本タスクの通知はここに相乗りするのが自然（新規の UI 概念を増やさない）。

## このタスクでやること

### (1) 捨てたことを見せる（3 経路すべて）

- `TtsQueueOptions`（126 行〜・048 で `getMaxLength`・049 で `getSpeechText`・049 フォローアップで `isPriority` が加わり注入は 5 つ）に
  `onSkipped?: (reason: "backlog" | "audio-suspended" | "synth-timeout", count: number) => void` を足す
  （既存 getter 群と同じ注入方式・未注入なら現行どおり `console.debug` のみ）。
- 呼び出し箇所: 経路1（290 行の `splice` 直後）／経路2（新設のタイムアウト catch）／経路3（232 行の `console.debug` と同じ場所）。
- [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) 側で件数を集計し、
  既存 `engineBanner` の並びに**控えめな注記**を出す（例: 「読み上げが追いつかず 12 件スキップしました」）。
  - **一定時間で自動的に消す**（常時出しっぱなしにしない）。読み上げ OFF のときは出さない。
  - 理由別に文言を変える（backlog＝追いつかない／audio-suspended＝音声が止まっている／synth-timeout＝ENGINE が応答しない）。

### (2) 合成タイムアウト（詰まりを塞ぐ）

- [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の `pump`（211 行〜）で `synthesize` に **`AbortSignal` を渡す**
  （`AbortController` ＋ `setTimeout` の標準 API のみ＝**新規依存ゼロ**）。既定 10 秒（要調整）。
- タイムアウトしたら**その 1 件だけ諦めて次へ進む**（既存 catch と同じ作法・直列は止めない）。`onSkipped("synth-timeout", 1)` を呼ぶ。
- 235-239 行の「意図的に signal を渡さない」コメントは、**dispose 中断とタイムアウト中断は別目的**である旨に更新する
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

- `ttsQueue.test.ts` へ**追記**（049 で `synthesize` / `playWav` のモックと AudioContext スタブが入っており、その土台に乗せる）。**通信も音声再生も行わない**前提で、
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
- ⚠ **同じ制約はログ側にも掛かる**（049 レビュー S-2）。049 以降、読み上げテキストには**課金イベントの投稿者名が
  含まれる**（security.md §1 032c-c 例外の 049 追補）。`synthesize` の合成 URL
  （`/audio_query?text=<encodeURIComponent(読み上げ全文)>`）は**その名前と本文をそのまま含む**ので、
  詰まりの診断で `console.error` / `console.debug` へ **URL・リクエスト内容・読み上げテキストを出さないこと**
  （現状 `voicevox.ts` はステータス番号だけを載せている＝この状態を維持する）。出してよいのは**件数と理由**のみ。

## 完了条件

- 読み上げが取りこぼしたとき、**件数と理由が画面に出る**（一定時間で消える・読み上げ OFF 時は出ない）。
- VOICEVOX が応答しなくても**その 1 件で止まらず次が読まれる**。
- 通知に本文・投稿者名が含まれない。新規宛先／API／capability／依存の追加が無い。`csp: null` 不変。
- `ttsQueue.test.ts` が上記 4 ケースで緑（キュー本体のテストは 049 で入っており、そこへ追記する）。
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
