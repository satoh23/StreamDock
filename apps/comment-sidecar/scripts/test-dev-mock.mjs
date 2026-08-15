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

const { createMockCommentSource } = await import("../dist/src/dev-mock.js");

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
const runYouTube = (count) => {
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
  flushTimeouts(); // connected + 1 件目（seq=1）
  tick(count - 1); // seq=2..count
  return { source, emitted };
};

/**
 * 062a: Twitch 単独でモックを起動し、合成コメントを seq=1..count まで集める。
 * （`runYouTube` と同型。seq は provider 共通カウンタなので単独接続で seq = 出力順になる。）
 */
const runTwitch = (count) => {
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
  source.handleControl({ type: "start-session", service: "twitch" });
  flushTimeouts(); // connected + 1 件目（seq=1）
  tick(count - 1); // seq=2..count
  return { source, emitted };
};

// ---- A. combo 更新は「同一 id の再送」（seq%20===9 と 12 が対になる）----
{
  const { source, emitted } = runYouTube(60);
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
  const { source, emitted } = runYouTube(12);
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
  const { source, emitted } = runTwitch(40);
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

if (failures > 0) {
  console.error(`\nDEV-MOCK FAILED: ${failures}`);
  process.exit(1);
}
console.log("\nDEV-MOCK PASS");
