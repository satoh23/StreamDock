// 043e: dev-mock（COMMENT_SIDECAR_MOCK=1 の合成発行）の周期仕様の単体検証。
// dist（tsc 出力）から createMockCommentSource を import し、素の assert で表明する
// （test-host-guard.mjs と同じ体裁。テストフレームワークは足さない）。
//
//   pnpm --filter @stream-dock/comment-sidecar build:tsc
//   node apps/comment-sidecar/scripts/test-dev-mock.mjs
//
// 何を担保するか（＝仕様としてこうあるべき）:
//   A. **combo 更新は「同一 id の再送」である**（投げ銭枠 seq%20===0 で jewels を出した周の seq%20===12 が、
//      本体と同じ id・同じ投稿者）。これが崩れると 3 層（mergeComments の updated → recordComments →
//      Rust の jewels 限定 UPDATE）の実機確認そのものが成立しない（別 id なら単なる新規コメント 2 件になる）。
//   B. **投げ銭は 20 件に 1 件だけ**: 金額つき（monetary を持つ）コメントは投げ銭枠（seq%20===0）と、
//      jewels 周の combo 更新（seq%20===12・同一 id の再送＝行は増えない）以外に出ない。
//      種別・金額ティアはサイクル番号のローテーションで一巡する（makeComment 冒頭のコメントが正）。
//   C. **境界**: jewels をまだ出していない状態で seq%20===12 に当たったら通常チャットへ落ちる
//      （combo の 1 回目が無いのに「更新」だけ出さない）。combo を 1 回出したら記憶を捨てる
//      （jewels を出していない周の 12 で古い id へ再送しない＝一対で完結）。
//   D. **回帰（レビュー指摘 S-6）**: YouTube セッションを stop すると combo の記憶を捨てる。
//      viewer_comments は**永続**なので、覚えたまま stop → start すると前セッションで保存された行へ
//      UPDATE を撃つ（session_id は前のまま金額だけ変わる＝手動確認で誤読を招く）。
//   E. **§9 / §1**: 合成コメントに受贈者名等の第三者個人情報を含まない。外部宛先を持たない
//      （出力は渡された broadcastMessage だけ＝ネットに出ない）。
//
// タイマーは偽物に差し替えて駆動する（実時間 1800ms × N を待たない）。dev-mock は setTimeout/setInterval を
// **呼び出し時に globalThis から解決**するため、import 前に差し替えておけば確実に捕まえられる。
//
// dist の JS は `@comment-dock/*` の path alias を保持したまま emit されるため、
// dist-alias-loader.mjs を resolve フックとして登録する（登録後に動的 import する必要がある）。
import { register } from "node:module";

register("./dist-alias-loader.mjs", import.meta.url);

// ---- 偽タイマー（差し替えは import より前に行う）----
let nextTimerId = 1;
const pendingTimeouts = new Map();
const pendingIntervals = new Map();
globalThis.setTimeout = (fn) => {
  const id = nextTimerId++;
  pendingTimeouts.set(id, fn);
  return id;
};
globalThis.setInterval = (fn) => {
  const id = nextTimerId++;
  pendingIntervals.set(id, fn);
  return id;
};
globalThis.clearTimeout = (id) => pendingTimeouts.delete(id);
globalThis.clearInterval = (id) => pendingIntervals.delete(id);
/** 保留中の setTimeout（connecting → connected の擬似遅延）をすべて実行する。 */
const flushTimeouts = () => {
  for (const [id, fn] of [...pendingTimeouts]) {
    pendingTimeouts.delete(id);
    fn();
  }
};
/** setInterval を n 回ぶん進める。 */
const tick = (n) => {
  for (let i = 0; i < n; i += 1) {
    for (const fn of [...pendingIntervals.values()]) fn();
  }
};

const { createMockCommentSource, CHANNEL_POINTS_ENVELOPES } = await import(
  "../dist/src/dev-mock.js"
);
// 063e 段 2-b: チャンネルポイントは**生の EventSub ペイロード**として発行され、
//   `repairNotificationEvent` → mapper まではモックが、その先は**本番の出力ポート**が担う。
//   ⇒ ここでは `index.ts` の `outputPort.outputComments` と**同じ 2 段**を組み立てて渡す
//   （＝ converter → `wire.ts` の写像もこのテストの検証対象に入る）。
const { convertCommentToViewDto } = await import(
  "../dist/vendor/comment-delivery/src/adapters/presenters/converters/comment-to-view.converter.js"
);
const { toCanonicalComment } = await import("../dist/src/wire.js");

/**
 * ⚠ 保留中のマイクロタスクを流す（`convertCommentToViewDto` は async）。
 * ⚠⚠ `setTimeout` は偽物に差し替え済みなので**タイマーに頼らない**。
 */
const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/**
 * 063e 段 2-b: 本番の `outputPort.outputComments` と同じ変換を行いつつ、**発行順を保つ**収集器。
 *
 * ⚠⚠ `outputComments` は**同期的に呼ばれる**が中身は非同期なので、素直に push すると
 * **チャンネルポイントだけ配列の末尾へ回り、`at(seq)` が壊れる**。
 * ⇒ 呼ばれた瞬間に**枠を予約**し、変換が終わったらその枠へ書き込む（＝実際の発行順のまま並ぶ）。
 */
const makeOrderedOutputPort = (emitted) => (comments) => {
  const slot = emitted.length;
  emitted.length = slot + comments.length;
  return (async () => {
    const views = await Promise.all(comments.map(convertCommentToViewDto));
    views.forEach((view, i) => {
      emitted[slot + i] = toCanonicalComment(view);
    });
  })();
};

let failures = 0;
const ok = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
};

/**
 * YouTube 単独でモックを起動し、合成コメントを seq=1..count まで集める。
 * （seq は provider 共通カウンタなので、単独接続にすると seq = 出力順になり周期を検証できる。）
 */
const runYouTube = async (count) => {
  const emitted = [];
  const source = createMockCommentSource({
    output: {
      broadcastMessage(message) {
        if (message?.type === "comments.append") emitted.push(message.payload.comment);
      },
    },
    sendSessionState: () => {},
    logInfo: () => {},
    // ⚠ YouTube にチャンネルポイントは無いので**1 度も呼ばれない**（呼ばれたら下のケースが落ちる）。
    outputComments: makeOrderedOutputPort(emitted),
  });
  source.handleControl({ type: "start-session", service: "youtube" });
  flushTimeouts(); // connected + 1 件目（seq=1）
  tick(count - 1); // seq=2..count
  await flushMicrotasks();
  return { source, emitted };
};

/**
 * 062a: Twitch 単独でモックを起動し、合成コメントを seq=1..count まで集める。
 * （`runYouTube` と同型。seq は provider 共通カウンタなので単独接続で seq = 出力順になる。）
 */
const runTwitch = async (count) => {
  const emitted = [];
  const source = createMockCommentSource({
    output: {
      broadcastMessage(message) {
        if (message?.type === "comments.append") emitted.push(message.payload.comment);
      },
    },
    sendSessionState: () => {},
    logInfo: () => {},
    // 063e 段 2-b: チャンネルポイントはこちらを通る（converter → `wire.ts` も検証対象に入る）。
    outputComments: makeOrderedOutputPort(emitted),
  });
  source.handleControl({ type: "start-session", service: "twitch" });
  flushTimeouts(); // connected + 1 件目（seq=1）
  tick(count - 1); // seq=2..count
  await flushMicrotasks();
  return { source, emitted };
};

// ---- A. combo 更新は「同一 id の再送」（YouTube ローテで jewels が出る seq=240 と 252 が対になる）----
// YouTube の投げ銭ローテ: seq=20..200 がスパチャ全ティア（10 種）→ 220 が長文赤スパ → 240 が jewels。
{
  const { source, emitted } = await runYouTube(280);
  ok("dev-mock: seq 1..280 で 280 件出る", emitted.length, 280);

  const jewels = emitted.filter((c) => c.eventType === "jewels");
  // 240（本体）と 252（combo 更新）の 2 件だけ。
  ok("dev-mock: jewels は 2 件（本体 1 ＋ combo 1）", jewels.length, 2);

  // seq は 1 始まりなので emitted[i] の seq は i+1。
  const at = (seq) => emitted[seq - 1];
  const base = 240;
  const combo = 252;
  ok(`dev-mock: seq=${base} は jewels 本体`, at(base).eventType, "jewels");
  ok(`dev-mock: seq=${combo} は jewels の combo 更新`, at(combo).eventType, "jewels");
  // **本質**: 同一 id・同一投稿者でなければ「更新」にならない。
  ok(`dev-mock: seq=${combo} は seq=${base} と同一 id`, at(combo).id, at(base).id);
  ok(`dev-mock: seq=${combo} は seq=${base} と同一投稿者`, at(combo).author, at(base).author);
  // combo 側だけが comboCount を持つ（本体＝combo の 1 回目には付けない）。
  ok(`dev-mock: seq=${base}（本体）に comboCount は付かない`, at(base).comboCount, undefined);
  ok(`dev-mock: seq=${combo} の comboCount`, at(combo).comboCount, 3);
  // 金額は「累計で届く」世界の合成（Q-3: 実データの判別根拠にはしない）。
  ok(
    `dev-mock: seq=${combo} の金額は本体の 3 倍`,
    at(combo).monetary.amount,
    at(base).monetary.amount * 3,
  );
  ok(`dev-mock: seq=${combo} の通貨は JEWELS のまま`, at(combo).monetary.currency, "JEWELS");
  // combo は一対で完結する（記憶を捨てる）。次の 12 枠（seq=272）は jewels を出していない周なので
  // 通常チャットへ落ちる＝古い id への再送が続かない。
  ok("dev-mock: combo の次の 12 枠（seq=272）は再送しない", at(272).eventType, "chat");

  // ---- B. 投げ銭は 20 件に 1 件だけ ----
  // **仕様**（makeComment 冒頭のコメントが正）: 金額つき（monetary を持つ）コメントは
  //   投げ銭枠（seq%20===0）と、jewels 周の combo 更新（seq%20===12・行は増えない）以外に出ない。
  //   新しい周期に金額つきを足すと、ここが落ちる（＝「20 件に 1 件」の頻度設計が守られる）。
  const offSlot = emitted
    .map((c, i) => ({ seq: i + 1, eventType: c.eventType, monetary: c.monetary }))
    .filter((x) => x.monetary !== undefined)
    .filter(
      (x) => !(x.seq % 20 === 0 || (x.seq % 20 === 12 && x.eventType === "jewels")),
    );
  ok("dev-mock: 投げ銭枠の外に金額つきコメントは出ない", offSlot, []);
  // 新しい行として出る投げ銭は 280 件中 14 件（20 件に 1 件）。combo 更新は行を増やさないので数えない。
  ok(
    "dev-mock: 投げ銭の新規行は 20 件に 1 件（280 件中 14 件）",
    emitted.filter((c, i) => c.monetary !== undefined && (i + 1) % 20 === 0).length,
    14,
  );
  // ローテーションの端: 最初の枠は最小ティア（100 JPY）から始まり、11 枠目（seq=220）が長文赤スパ。
  ok(
    "dev-mock: seq=20 はスパチャ（ローテ先頭・100 JPY）",
    [at(20).eventType, at(20).monetary.amount, at(20).monetary.currency],
    ["superchat", 100, "JPY"],
  );
  ok(
    "dev-mock: seq=220 は長文赤スパ（20,000 JPY・本文が長文）",
    [at(220).eventType, at(220).monetary.amount, at(220).text.length >= 200],
    ["superchat", 20000, true],
  );

  // ---- E. §9: 合成コメントに第三者の個人情報を含まない ----
  const asJson = JSON.stringify(emitted);
  ok("dev-mock(§9): 受領側フィールド名が現れない", asJson.includes("received"), false);
  ok("dev-mock(§9): gifter/recipient 等の語が現れない", /gifter|recipient/.test(asJson), false);
  ok("dev-mock(§1): 合成コメントに URL が現れない", /https?:\/\//.test(asJson), false);

  source.stopAll();
}

// ---- C. 境界: combo の 1 回目が無ければ「更新」だけを出さない ----
// **仕様**: lastMockJewels が無い状態（jewels 未発行）で seq%20===12 に当たったら通常チャットへ落ちる。
//   （jewels 本体は seq=240 の投げ銭枠まで出ないので、最初の 12 枠は必ずこの経路になる。）
{
  const { source, emitted } = await runYouTube(12);
  ok("dev-mock: jewels 未発行の seq=12 は通常チャットへ落ちる", emitted[11].eventType, "chat");
  ok("dev-mock: comboCount も付かない", emitted[11].comboCount, undefined);
  source.stopAll();
}
{
  // jewels 本体（seq=240）の直後に stop → start して記憶を捨てた状態で 252 まで進める。
  const emitted = [];
  const source = createMockCommentSource({
    output: {
      broadcastMessage(message) {
        if (message?.type === "comments.append") emitted.push(message.payload.comment);
      },
    },
    sendSessionState: () => {},
    logInfo: () => {},
  });
  source.handleControl({ type: "start-session", service: "youtube" });
  flushTimeouts();
  tick(239); // seq=2..240（240 で jewels 本体が出て記憶される）
  ok("dev-mock(前提): seq=240 で jewels 本体", emitted[239].eventType, "jewels");

  // ---- D. 回帰（レビュー指摘 S-6）: stop で combo の記憶を捨てる ----
  source.handleControl({ type: "stop-session", service: "youtube" });
  source.handleControl({ type: "start-session", service: "youtube" });
  flushTimeouts(); // 再 start の 1 件目（seq=241）
  tick(11); // seq=242..252

  const seq252 = emitted[251];
  ok("dev-mock(S-6): stop→start 後の seq=252 は combo にならない", seq252.eventType, "chat");
  ok("dev-mock(S-6): 前セッションの jewels と id が一致しない", seq252.id === emitted[239].id, false);
  ok("dev-mock(S-6): comboCount も付かない", seq252.comboCount, undefined);
  source.stopAll();
}

// ---- F. 062a: レイド（Twitch・seq%20===16）----
// ⚠⚠ **このモックが検証できる範囲を取り違えないこと。** dev-mock は `CanonicalComment` を
//   **直接**組んでおり `wire.ts` を通らない（dev-mock.ts の該当コメントが正）。よってここで
//   固定できるのは「合成が正しい形で出ること」だけで、**vendor mapper と wire.ts の詰め替えは
//   1 バイトも通らない**（そちらは test-twitch-mapper.mjs / test-comment-relay.mjs が担保）。
{
  const { source, emitted } = await runTwitch(40);
  const at = (seq) => emitted[seq - 1];

  const raids = emitted.filter((c) => c.eventType === "raid");
  ok("dev-mock(062a): raid は 2 件（seq=16, 36）", raids.length, 2);
  ok("dev-mock(062a): seq=16 は raid", at(16).eventType, "raid");
  ok("dev-mock(062a): レイド人数が入る", at(16).raidViewerCount, 42);
  ok("dev-mock(062a): 本文は空（system_message を持ち回らない）", at(16).text, "");
  ok("dev-mock(062a): 金額は付かない（課金扱いしない）", at(16).monetaryAmount, undefined);
  ok("dev-mock(062a): 数値 monetary も付かない", at(16).monetary, undefined);
  ok("dev-mock(062a): author はレイド元チャンネル", at(16).author.name, "RaiderChannel");
  ok("dev-mock(062a): アバターは持たない（§9）", at(16).author.avatar, undefined);

  // ⚠ 現行の設計原則: 投げ銭枠（%20===0）を奪わない。レイドも同じ原則に従う。
  ok("dev-mock(062a): raid の周期は投げ銭枠（%20===0）を奪わない", 16 % 20 === 0, false);
  // ⚠ 既存の周期（13=gift / 17=subscription）を踏まない。投げ銭は枠（seq=20, 40）だけに出る。
  ok("dev-mock(062a): seq=13 は gift のまま", at(13).eventType, "gift");
  ok("dev-mock(062a): seq=17 は subscription のまま", at(17).eventType, "subscription");
  ok(
    "dev-mock(062a): seq=20 は投げ銭枠（bits）",
    [at(20).eventType, at(20).monetary.currency],
    ["superchat", "BITS"],
  );

  source.stopAll();
}

// ---- B'. Twitch の投げ銭ローテーション（bits 5 種 → donation 4 種 → Power-up の 10 周期で一巡）----
//
// ⚠ **不変条件 B の「枠の外に金額つきは出ない」を YouTube 側（上の B）と二重に書いている**
//   （レビュー I-2・修正不要と判断）。**意図**: provider ごとに除外条件が違う——YouTube は
//   jewels の combo 更新（`%20===12` の同一 id 再送）を許すが、**Twitch に combo は無い**ので
//   例外ゼロで断言できる（＝こちらのほうが強い表明になっている）。
//   **なぜ helper に括らないか**: 差分が「例外を 1 つ許すか」だけで、引数で切り替える helper にすると
//   **どちらの provider が何を許しているかがテストの字面から消える**（テストは仕様の表として読めることを優先）。
//   **再修正のトリガー**: 3 つ目の provider が増えるか、除外条件がもう 1 種類増えたとき
//   ⇒ そのときは `expectMonetaryOnlyInSlots(emitted, { allowJewelsCombo })` に括る。
{
  const { source, emitted } = await runTwitch(200);
  const at = (seq) => emitted[seq - 1];

  // 投げ銭枠の外に金額つきコメントは出ない（YouTube 側 B と同じ不変条件。Twitch に combo 更新は無い）。
  const offSlot = emitted
    .map((c, i) => ({ seq: i + 1, monetary: c.monetary }))
    .filter((x) => x.monetary !== undefined && x.seq % 20 !== 0);
  ok("dev-mock(twitch): 投げ銭枠の外に金額つきコメントは出ない", offSlot, []);
  ok(
    "dev-mock(twitch): 投げ銭は 20 件に 1 件（200 件中 10 件）",
    emitted.filter((c, i) => c.monetary !== undefined && (i + 1) % 20 === 0).length,
    10,
  );
  ok(
    "dev-mock(twitch): seq=20 は bits（ローテ先頭・100 bits）",
    [at(20).eventType, at(20).monetary.amount, at(20).monetary.currency],
    ["superchat", 100, "BITS"],
  );
  ok(
    "dev-mock(twitch): seq=120 は donation（6 枠目・500 JPY）",
    [at(120).eventType, at(120).monetary.amount, at(120).monetary.currency],
    ["donation", 500, "JPY"],
  );
  ok(
    "dev-mock(twitch): seq=200 は Power-up（10 枠目）",
    [at(200).eventType, at(200).text, at(200).monetary.currency],
    ["superchat", "Power-up 🎉", "BITS"],
  );
  source.stopAll();
}

// ---- G. 063e: チャンネルポイント（Twitch・seq%20 が 6 / 8 / 4）----
//
// ## ⚠⚠⚠ 063e 段 2-b: ここだけ**本番の変換チェーンを通っている**
//
// 他の合成コメントは `CanonicalComment` を**直接**組んでおり、`wire.ts` も vendor の mapper も
// 1 バイトも通らない（＝確認できるのは「wire から先」だけ）。
// ⚠ チャンネルポイントは**作者が実機で 1 度も受信できない**ので、段 2-b で
//   **Twitch 公式の形の生 EventSub ペイロード**を流す経路へ移した:
//     生 envelope → `repairNotificationEvent` → `mapTwitchChatEventsToComments`
//                 → **本番の outputPort**（`convertCommentToViewDto` → `toCanonicalComment`）
//   ⇒ **WebSocket と Helix 以外は全部本番のコード**である。このテストもその 2 段を通して検証する。
//
// ⚠ ペイロードの出典（2 つの独立した一次情報で一致・2026-08-26）:
//   `twitch_api` crate の `ChannelPointsCustomRewardRedemptionAddV1Payload` ／
//   公式 Twitch CLI の `internal/events/types/channel_points_redemption/redemption_event.go`
{
  const { source, emitted } = await runTwitch(40);
  const at = (seq) => emitted[seq - 1];

  const cps = emitted.filter((c) => c.eventType === "channelpoint");
  ok("dev-mock(063e): channelpoint は 6 件（seq=4, 6, 8, 24, 26, 28）", cps.length, 6);

  // --- 入力あり（公式どおり・本文が読み上げられる／一覧に本文が出ることの目視用）---
  ok("dev-mock(063e): seq=6 は channelpoint", at(6).eventType, "channelpoint");
  ok("dev-mock(063e): 入力ありは本文を持つ", at(6).text, "がんばれー！");
  // ⚠⚠ **id は引き換えイベント自身のもの**（dedup キー・envelope の message_id ではない）。
  // ⚠ **id はイベント本体由来**（envelope の message_id ではない）＝接頭辞がそれを示す。
  //   ⚠ 接尾辞は発行ごとの一意化（同じ id を出すと `mergeComments` が畳んで一覧に 1 行しか出ない）。
  ok("⚠ dev-mock(063e): id は引き換えイベント自身の id 由来", at(6).id, "mock-redemption-1-6");
  // ⚠ author は**引き換えた視聴者**（broadcaster ではない）。
  ok("dev-mock(063e): author は引き換えた視聴者", at(6).author.id, "mock-twitch-redeemer");
  ok("dev-mock(063e): 表示名も視聴者のもの", at(6).author.name, "night_owl");
  ok("⚠⚠ dev-mock(063e): 金額は付かない（課金扱いしない）", at(6).monetaryAmount, undefined);
  ok("⚠ dev-mock(063e): 数値 monetary も付かない", at(6).monetary, undefined);
  ok("dev-mock(063e): レイド人数は付かない", at(6).raidViewerCount, undefined);
  ok("⚠ dev-mock(063e): source は twitch", at(6).source, "twitch");
  // ⚠ アバターは解決しない＝**実ネットに出ない**（`resolveAvatarDataUri` は url 無しで即 return）。
  ok("⚠⚠ dev-mock(063e): アバターは付かない（fetch に到達していない）", at(6).author.avatar, undefined);

  // ⚠⚠⚠ **063e 段 3 でここが反転した**——`reward.title` **だけ**を取り込むと決めたため。
  //   ⚠ 反転させたぶん、**他が今も出ないこと**を同じ強さで固定する（線を 1 つだけ動かした証拠）。
  const cpJson = JSON.stringify(cps);
  ok("⚠⚠⚠ dev-mock(063e 段 3): 報酬名は出る", at(6).rewardTitle, "読み上げ");
  ok("⚠⚠ dev-mock(063e) §9: 報酬の prompt は今も現れない", cpJson.includes("好きな言葉"), false);
  ok("⚠ dev-mock(063e) §9: 報酬の id も現れない", cpJson.includes("mock-reward-"), false);
  ok("⚠ dev-mock(063e) §9: status も現れない", cpJson.includes("unfulfilled"), false);
  ok("⚠ dev-mock(063e) §9: redeemed_at も現れない", cpJson.includes("2026-08-26T10:00"), false);

  // --- 入力なし（**配信画面に空の吹き出しを出さない**ことを実機で目視するための分岐）---
  ok("dev-mock(063e): seq=8 も channelpoint", at(8).eventType, "channelpoint");
  ok("⚠⚠ dev-mock(063e): 入力なしは本文が空", at(8).text, "");
  ok("dev-mock(063e): seq=8 の id も引き換えイベント自身のもの", at(8).id, "mock-redemption-2-8");
  // ⚠⚠⚠ **063e 段 3: ここが「出し分け」の目視の主役。**
  //   割り当て表の「対象の報酬」に `ガチャを引く` と入れると、**この 1 件だけ**が鳴る。
  ok("⚠⚠⚠ dev-mock(063e 段 3): seq=8 の報酬名は「ガチャを引く」", at(8).rewardTitle, "ガチャを引く");
  ok("⚠⚠ dev-mock(063e 段 3): seq=6 は別の報酬名（＝出し分けが目視できる）", at(6).rewardTitle, "読み上げ");

  // --- ⚠⚠⚠ 仕様外（`user_input: null` ＋ `id` 欠落）---
  //   ⚠ 公式仕様はどちらも「必ず来る」と書いているので、これは**仕様外の想定**である。
  //     それでも流すのは、**実機で確認できない以上「仕様を信じて外したときに何が起きるか」を
  //     目視できる必要がある**ため。⇒ 期待＝**普通に 1 行出る**（本文は空・id は補填）。
  //   ⚠⚠ ここが落ちたら、段 1-b の防御（`repairNotificationEvent` ＋ mapper の判別）が壊れている。
  ok("⚠⚠⚠ dev-mock(063e): 仕様外（user_input=null・id 欠落）でも行が出る", at(4).eventType, "channelpoint");
  ok("⚠⚠ dev-mock(063e): 仕様外でも本文は空文字（null を漏らさない）", at(4).text, "");
  ok(
    "⚠⚠ dev-mock(063e): 仕様外の id は envelope の message_id で補填される",
    at(4).id,
    "mock-envelope-4",
  );
  ok("⚠ dev-mock(063e): 仕様外でも author は引き換えた視聴者", at(4).author.id, "mock-twitch-redeemer3");
  // ⚠⚠⚠ **063e 段 3: 報酬名が取れない引き換え**（`reward` ごと欠落）。
  //   ⚠ 期待＝**対象の報酬を指定していると鳴らない／空欄なら鳴る**。
  //   ⚠⚠ ここが空文字や `null` になると、`effectAssignments.ts` 側で
  //   「報酬を指定していない条件」と同じ値で出会って**当たってしまう**。
  ok("⚠⚠⚠ dev-mock(063e 段 3): 仕様外は報酬名を持たない（undefined）", at(4).rewardTitle, undefined);
  // ⚠⚠ **JSON にしてから見る**——中継は `rewardTitle: dto.rewardTitle` の明示列挙なので
  //   JS オブジェクト上はキーが `undefined` 値で存在する。⚠ 実際に frontend / Rust へ渡るのは
  //   直列化後なので、**「キーごと落ちている」ことはそちらで確かめるのが正しい**
  //   （`wire.ts` の「undefined は JSON 直列化時に落ちる＝Rust 側 None」がこれである）。
  ok(
    "⚠⚠⚠ dev-mock(063e 段 3): 直列化するとキーごと落ちる（Rust 側 None）",
    "rewardTitle" in JSON.parse(JSON.stringify(at(4))),
    false,
  );

  // --- ⚠⚠⚠ 2 周目でも同じ 3 パターンが**別の id で**出ること ---
  //   ⚠ 同じ id を出すと `mergeComments` が畳むので、**一覧に 1 行しか現れない**
  //     ＝目視の導線が 1 周目で終わる（モックを置いた意味が消える）。
  //   ⚠⚠ さらに `structuredClone` を外すと `repairNotificationEvent` が fixture を in-place で書き換え、
  //     **2 周目には「仕様外」が修復済みの形になって模せなくなる**（id も 1 周目の補填値で固定される）。
  for (const [first, second] of [
    [4, 24],
    [6, 26],
    [8, 28],
  ]) {
    ok(`⚠⚠ dev-mock(063e): seq=${first} と ${second} は別の id`, at(first).id !== at(second).id, true);
    ok(`dev-mock(063e): seq=${second} も channelpoint`, at(second).eventType, "channelpoint");
  }
  // ⚠ 2 周目の仕様外も**やはり envelope 由来の id**（＝ fixture が汚れていない証拠）。
  ok("⚠⚠⚠ dev-mock(063e): 2 周目の仕様外も補填 id のまま", at(24).id, "mock-envelope-24");
  ok("⚠⚠ dev-mock(063e): 2 周目の仕様外も本文は空", at(24).text, "");

  // --- ⚠⚠⚠ fixture が「守る対象」を実際に持っていること ---
  //   ⚠⚠ **これが無いと §9 の検証が空振りする**——fixture から `reward` を落とすと
  //     「報酬名が出力に現れない」は**当たり前に緑**になり、何も守らなくなる
  //     （`test-twitch-mapper.mjs` が `system_message` / `profile_image_url` について書いている理由と同じ）。
  const fixtureJson = JSON.stringify(CHANNEL_POINTS_ENVELOPES);
  ok("⚠⚠⚠ fixture 自体は報酬名を持っている（出し分けの目視が空振りしていない）", fixtureJson.includes("読み上げ"), true);
  ok("⚠⚠⚠ fixture にガチャ用の報酬名がある（出し分けの主役）", fixtureJson.includes("ガチャを引く"), true);
  ok("⚠⚠ fixture 自体は prompt を持っている", fixtureJson.includes("好きな言葉"), true);
  // ⚠⚠⚠ **報酬名が 3 パターンとも違うこと**（同じだと「出し分けできている」ように見えて
  //   実は全部鳴っているだけ、という状態を見分けられない）。
  {
    const titles = CHANNEL_POINTS_ENVELOPES.map((f) => f.event.reward?.title);
    ok("⚠⚠⚠ fixture の報酬名は 3 つとも異なる（1 つは無し）", new Set(titles).size, 3);
    ok("⚠⚠ fixture の 1 つは報酬名を持たない", titles.includes(undefined), true);
  }
  ok("⚠ fixture 自体は status を持っている", fixtureJson.includes("unfulfilled"), true);
  ok("⚠ fixture 自体は redeemed_at を持っている", fixtureJson.includes("2026-08-26T10:00"), true);
  // ⚠ 3 パターン（入力あり／入力なし／仕様外）が揃っていること。
  ok(
    "⚠ fixture は 3 パターン（入力あり・入力なし・仕様外＝報酬名なし）",
    CHANNEL_POINTS_ENVELOPES.map((f) => f.label),
    ["text-input", "no-text-input", "out-of-spec-no-reward"],
  );
  // ⚠⚠ 仕様外パターンが**本当に仕様外**であること（直すと防御の目視ができなくなる）。
  const outOfSpec = CHANNEL_POINTS_ENVELOPES[2].event;
  ok("⚠⚠ 仕様外パターンの user_input は null", outOfSpec.user_input, null);
  ok("⚠⚠ 仕様外パターンは id を持たない", "id" in outOfSpec, false);

  // ⚠ 現行の設計原則: 投げ銭枠（%20===0）を奪わない。
  for (const n of [4, 6, 8]) {
    ok(`dev-mock(063e): ${n} の周期は %20 ≠ 0（投げ銭枠を奪わない）`, n % 20 === 0, false);
  }
  // ⚠ 既存の周期を 1 つも踏んでいないこと（踏むと既存の目視確認が消える）。
  ok("dev-mock(063e): seq=13 は gift のまま", at(13).eventType, "gift");
  ok("dev-mock(063e): seq=16 は raid のまま", at(16).eventType, "raid");
  ok("dev-mock(063e): seq=17 は subscription のまま", at(17).eventType, "subscription");
  ok("dev-mock(063e): seq=20 は投げ銭枠のまま", at(20).eventType, "superchat");

  source.stopAll();
}

// ⚠ YouTube 側にチャンネルポイントを出さないこと（Twitch 限定＝相当機能が存在しない）。
{
  const { source, emitted } = await runYouTube(40);
  ok(
    "⚠ dev-mock(063e): YouTube には channelpoint を 1 件も出さない",
    emitted.filter((c) => c.eventType === "channelpoint").length,
    0,
  );
  source.stopAll();
}

// ---------------------------------------------------------------------------
// 063e 段 1-b: チャンネルポイント購読の成否（モックの目視導線）
// ---------------------------------------------------------------------------
//
// ⚠⚠⚠ **これは「作者が実機で確認できない画面」を目視するための唯一の導線である。**
//   チャンネルポイントは Twitch 側で有効化されるまで存在せず、有効化はアフィリエイト条件を
//   満たしたあとのオンボーディングを通るため、作者の環境では常に「受信できていません」にしかならない。
//   ⇒ 3 状態すべてを見せられるのはモードON の合成発行だけなので、その巡回をここで固定する。
{
  const frames = [];
  const source = createMockCommentSource({
    output: {
      broadcastMessage(message) {
        if (message?.type === "channelpoints.state") frames.push(message.payload.state);
      },
    },
    sendSessionState: () => {},
    logInfo: () => {},
  });

  source.handleControl({ type: "start-session", service: "twitch" });
  flushTimeouts();
  ok("dev-mock(063e 段 1-b): 1 回目の取得開始は receiving", frames, ["receiving"]);

  source.handleControl({ type: "stop-session", service: "twitch" });
  ok("dev-mock(063e 段 1-b): 停止で unknown へ戻る", frames, ["receiving", "unknown"]);

  source.handleControl({ type: "start-session", service: "twitch" });
  flushTimeouts();
  // ⚠ 交互にするのは、**3 状態すべてを目視できる導線が他に無い**ため（本物の挙動の模倣ではない）。
  ok("⚠ dev-mock(063e 段 1-b): 2 回目は unavailable（3 状態を巡回して見せる）", frames, [
    "receiving",
    "unknown",
    "unavailable",
  ]);

  source.stopAll();
}

// ⚠ YouTube では 1 通も出さない（チャンネルポイントは Twitch 限定＝実物に無い状態を見せない）。
{
  const frames = [];
  const source = createMockCommentSource({
    output: {
      broadcastMessage(message) {
        if (message?.type === "channelpoints.state") frames.push(message.payload.state);
      },
    },
    sendSessionState: () => {},
    logInfo: () => {},
  });
  source.handleControl({ type: "start-session", service: "youtube" });
  flushTimeouts();
  source.handleControl({ type: "stop-session", service: "youtube" });
  ok("⚠ dev-mock(063e 段 1-b): YouTube では 1 通も出さない", frames, []);
  source.stopAll();
}

if (failures > 0) {
  console.error(`\nDEV-MOCK FAILED: ${failures}`);
  process.exit(1);
}
console.log("\nDEV-MOCK PASS");
