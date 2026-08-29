// 043e: dev-mock（COMMENT_SIDECAR_MOCK=1 の合成発行）の周期仕様の単体検証。
// dist（tsc 出力）から createMockCommentSource を import し、素の assert で表明する
// （test-host-guard.mjs と同じ体裁。テストフレームワークは足さない）。
//
//   pnpm --filter @stream-dock/comment-sidecar build:tsc
//   node apps/comment-sidecar/scripts/test-dev-mock.mjs
//
// 何を担保するか（＝仕様としてこうあるべき）:
//   A. **combo 更新は「同一 id の再送」である**（seq%20===12 が seq%20===9 と同じ id・同じ投稿者）。
//      これが崩れると 3 層（mergeComments の updated → recordComments → Rust の jewels 限定 UPDATE）の
//      実機確認そのものが成立しない（別 id なら単なる新規コメント 2 件になり、何も検証できない）。
//   B. **既存の設計原則を壊さない**: 投げ銭の周期は `%5 ≠ 0` で superchat 枠（seq%5===0）を奪わない。
//   C. **境界**: jewels をまだ出していない状態で seq%20===12 に当たったら通常チャットへ落ちる
//      （combo の 1 回目が無いのに「更新」だけ出さない）。
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

// ---- A. combo 更新は「同一 id の再送」（seq%20===9 と 12 が対になる）----
{
  const { source, emitted } = await runYouTube(60);
  ok("dev-mock: seq 1..60 で 60 件出る", emitted.length, 60);

  const jewels = emitted.filter((c) => c.eventType === "jewels");
  // 9/12/29/32/49/52 の 6 件（3 ブロック × 本体＋combo）。
  ok("dev-mock: jewels は 6 件（本体 3 ＋ combo 3）", jewels.length, 6);

  // seq は 1 始まりなので emitted[i] の seq は i+1。
  const at = (seq) => emitted[seq - 1];
  for (const [base, combo] of [
    [9, 12],
    [29, 32],
    [49, 52],
  ]) {
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
  }

  // ---- B. 既存の設計原則: superchat 枠（seq%5===0）を奪わない ----
  // **仕様**（makeComment 冒頭のコメントが正）: 投げ銭系イベントの周期はすべて `%5 ≠ 0` を選ぶ。
  //   したがって守るべき不変条件は「**seq%5===0 が必ず superchat のまま**」であって、
  //   「superchat が %5===0 にしか出ない」ではない（043c の赤スパ長文 seq%20===1 等が別途 superchat を出す）。
  //   新しい周期に %5===0 を選ぶと superchat 枠が潰れ、ここが落ちる。
  const stolen = emitted
    .map((c, i) => ({ seq: i + 1, eventType: c.eventType }))
    .filter((x) => x.seq % 5 === 0 && x.eventType !== "superchat");
  ok("dev-mock: seq%5===0 の superchat 枠を奪った周期は無い", stolen, []);
  ok(
    "dev-mock: jewels（本体・combo とも）の周期はすべて %5 ≠ 0",
    [9, 12, 29, 32, 49, 52].filter((s) => s % 5 === 0),
    [],
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
{
  const { source, emitted } = await runYouTube(12);
  // seq=9 で本体が出ているので、この経路では 12 が combo になる（前提の確認）。
  ok("dev-mock(前提): seq=9 で本体が出ている", emitted[8].eventType, "jewels");
  ok("dev-mock(前提): seq=12 は combo になる", emitted[11].eventType, "jewels");
  source.stopAll();
}
{
  // seq=9 の直後に stop → start して記憶を捨てた状態で 12 まで進める（下の D と同じ操作）。
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
  tick(8); // seq=1..9（9 で jewels 本体が出て記憶される）
  ok("dev-mock(前提): seq=9 で jewels 本体", emitted[8].eventType, "jewels");

  // ---- D. 回帰（レビュー指摘 S-6）: stop で combo の記憶を捨てる ----
  source.handleControl({ type: "stop-session", service: "youtube" });
  source.handleControl({ type: "start-session", service: "youtube" });
  flushTimeouts(); // 再 start の 1 件目（seq=10）
  tick(2); // seq=11, 12

  const seq12 = emitted[11];
  ok("dev-mock(S-6): stop→start 後の seq=12 は combo にならない", seq12.eventType, "chat");
  ok("dev-mock(S-6): 前セッションの jewels と id が一致しない", seq12.id === emitted[8].id, false);
  ok("dev-mock(S-6): comboCount も付かない", seq12.comboCount, undefined);
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

  // ⚠ 既存の設計原則: 投げ銭の周期は %5 ≠ 0（superchat 枠を奪わない）。レイドも同じ原則に従う。
  ok("dev-mock(062a): raid の周期は %5 ≠ 0（superchat 枠を奪わない）", 16 % 5 === 0, false);
  // ⚠ 既存の周期（13=gift / 17=subscription / 11=power-up / 3=donation）を踏まない。
  ok("dev-mock(062a): seq=13 は gift のまま", at(13).eventType, "gift");
  ok("dev-mock(062a): seq=17 は subscription のまま", at(17).eventType, "subscription");
  ok("dev-mock(062a): seq=11 は superchat(bits) のまま", at(11).eventType, "superchat");
  ok("dev-mock(062a): seq=3 は donation のまま", at(3).eventType, "donation");

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

  // ⚠⚠⚠ **§9: 報酬名も prompt も出力に 1 文字も現れない。**
  //   fixture には**載せてある**（`reward: { title: "読み上げ", prompt: "好きな言葉をどうぞ" }`）ので、
  //   これが緑であることが「DTO に宣言していない＝構造的に到達しない」ことの実証になる。
  const cpJson = JSON.stringify(cps);
  ok("⚠⚠⚠ dev-mock(063e) §9: 報酬名が出力に現れない", cpJson.includes("読み上げ"), false);
  ok("⚠⚠ dev-mock(063e) §9: 報酬の prompt も現れない", cpJson.includes("好きな言葉"), false);
  ok("⚠ dev-mock(063e) §9: status も現れない", cpJson.includes("unfulfilled"), false);
  ok("⚠ dev-mock(063e) §9: redeemed_at も現れない", cpJson.includes("2026-08-26T10:00"), false);

  // --- 入力なし（**配信画面に空の吹き出しを出さない**ことを実機で目視するための分岐）---
  ok("dev-mock(063e): seq=8 も channelpoint", at(8).eventType, "channelpoint");
  ok("⚠⚠ dev-mock(063e): 入力なしは本文が空", at(8).text, "");
  ok("dev-mock(063e): seq=8 の id も引き換えイベント自身のもの", at(8).id, "mock-redemption-2-8");

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
  ok("⚠⚠⚠ fixture 自体は報酬名を持っている（§9 検証が空振りしていない）", fixtureJson.includes("読み上げ"), true);
  ok("⚠⚠ fixture 自体は prompt を持っている", fixtureJson.includes("好きな言葉"), true);
  ok("⚠ fixture 自体は status を持っている", fixtureJson.includes("unfulfilled"), true);
  ok("⚠ fixture 自体は redeemed_at を持っている", fixtureJson.includes("2026-08-26T10:00"), true);
  // ⚠ 3 パターン（入力あり／入力なし／仕様外）が揃っていること。
  ok(
    "⚠ fixture は 3 パターン（入力あり・入力なし・仕様外）",
    CHANNEL_POINTS_ENVELOPES.map((f) => f.label),
    ["text-input", "no-text-input", "out-of-spec"],
  );
  // ⚠⚠ 仕様外パターンが**本当に仕様外**であること（直すと防御の目視ができなくなる）。
  const outOfSpec = CHANNEL_POINTS_ENVELOPES[2].event;
  ok("⚠⚠ 仕様外パターンの user_input は null", outOfSpec.user_input, null);
  ok("⚠⚠ 仕様外パターンは id を持たない", "id" in outOfSpec, false);

  // ⚠ 既存の設計原則: 周期は %5 ≠ 0（superchat 枠を奪わない）。
  for (const n of [4, 6, 8]) {
    ok(`dev-mock(063e): ${n} の周期は %5 ≠ 0`, n % 5 === 0, false);
  }
  // ⚠ 既存の周期を 1 つも踏んでいないこと（踏むと既存の目視確認が消える）。
  ok("dev-mock(063e): seq=3 は donation のまま", at(3).eventType, "donation");
  ok("dev-mock(063e): seq=11 は superchat(bits) のまま", at(11).eventType, "superchat");
  ok("dev-mock(063e): seq=13 は gift のまま", at(13).eventType, "gift");
  ok("dev-mock(063e): seq=16 は raid のまま", at(16).eventType, "raid");
  ok("dev-mock(063e): seq=17 は subscription のまま", at(17).eventType, "subscription");
  ok("dev-mock(063e): seq=5 は superchat のまま（%5 枠）", at(5).eventType, "superchat");

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
