// 063e 段 1-b: EventSub notification envelope の**修復**（repairNotificationEvent）の単体検証。
//
//   pnpm --filter @stream-dock/comment-sidecar build:tsc
//   node apps/comment-sidecar/scripts/test-eventsub-repair.mjs
//
// ⚠⚠⚠ **なぜ独立したテストが要るのか。**
//   ここは「Twitch から実際に何が届くか」に依存する唯一の場所で、**実ネットに出ないと再現できない**。
//   しかも依頼者はチャンネルポイントを実機で確認できない（新規チャンネルでは Twitch 側で
//   有効化されておらず、有効化はマイルストーン達成後のオンボーディングを通る）。
//   ⇒ **「公式仕様どおりに来るはず」に賭けない**ことを、源コードではなくテストで固定する。
//
// 何を担保するか（＝仕様としてこうあるべき）:
//   A. `metadata.subscription_type` を**根拠**に修復する（イベント本体の形を推測しない）。
//   B. **`user_input` が `null` / キー欠落 / 非文字列**でも、`""` の string にして通す
//      （＝「本文が空の引き換え」に劣化させる。**行を静かに消さない**）。
//   C. **`id` が欠落**していたら `metadata.message_id` から補填する
//      （欠けたままだと Rust の `record_comment` が DTO ごとデシリアライズに失敗し、
//        fire-and-forget なので**画面には何も出ない**＝気付けない全滅）。
//   D. **載っている値は 1 つも書き換えない**（修復であって上書きではない）。
//   E. **§9**: 新しいフィールドを生やさない・`reward` 等に触れない。
//   F. **他の購読種別を巻き込まない**（chat.message / chat.notification は素通し）。
//   G. **壊れた envelope でも throw しない**（handleMessage の try/catch に頼らない）。
//   H. **修復 → mapper の 2 段を通しても、引き換えとして取り込まれる**（統合）。
// ⚠ 063e 段 2-b: 修復は**純粋モジュール**（`eventsub-repair.ts`）へ切り出したので、
//   `reflect-metadata` も `ws` も要らなくなった（`@injectable()` を持つ client を読み込まないため）。
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

register("./dist-alias-loader.mjs", import.meta.url);

const { repairNotificationEvent } = await import(
  "../dist/vendor/comment-fetcher/src/adapters/twitch/client/eventsub-repair.js"
);
const { mapTwitchChatEventsToComments } = await import(
  "../dist/vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.js"
);

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

const REDEMPTION_TYPE = "channel.channel_points_custom_reward_redemption.add";

/** notification envelope（metadata.message_id は envelope 側の一意 ID）。 */
const envelope = (subscriptionType, event, over = {}) => ({
  metadata: {
    message_type: "notification",
    message_id: "env-msg-1",
    subscription_type: subscriptionType,
    subscription_version: "1",
    ...over,
  },
  payload: {
    subscription: {
      id: "sub1",
      type: subscriptionType,
      version: "1",
      status: "enabled",
      condition: { broadcaster_user_id: "b1" },
      transport: { method: "websocket", session_id: "s1" },
    },
    event,
  },
});

/** 引き換えイベントの素の形（`reward` は「取り込まないことを検証する対象」なので必ず入れておく）。 */
const redemptionEvent = (over = {}) => ({
  id: "cp1",
  broadcaster_user_id: "b1",
  broadcaster_user_login: "broadcaster",
  broadcaster_user_name: "Broadcaster",
  user_id: "u9",
  user_login: "alice",
  user_name: "Alice",
  user_input: "がんばれー！",
  status: "unfulfilled",
  reward: { id: "r1", title: "読み上げ", cost: 500 },
  redeemed_at: "2026-08-26T10:00:00Z",
  ...over,
});

// ---------------------------------------------------------------------------
// B. user_input の正規化（**これが穴 H' の対処そのもの**）
// ---------------------------------------------------------------------------
//
// ⚠⚠⚠ 段 1 は `typeof user_input === "string"` を**種別の判別材料**に使っていた。
//   `null` が 1 度でも来ると引き換えとして認識されず、chat フォールバックで捨てられ、
//   **引き換えが 1 件も出ない**（エラーも出ない）。⇒ ここと mapper の 2 か所で殺す。
for (const [label, given] of [
  ["null", null],
  ["キー欠落", undefined],
  ["数値", 12345],
  ["オブジェクト", { text: "x" }],
  ["真偽値", false],
]) {
  const event =
    given === undefined
      ? (() => {
          const e = redemptionEvent();
          delete e.user_input;
          return e;
        })()
      : redemptionEvent({ user_input: given });
  const env = envelope(REDEMPTION_TYPE, event);
  repairNotificationEvent(env);
  ok(
    `⚠⚠⚠ user_input が ${label} でも string の空文字になる`,
    env.payload.event.user_input,
    "",
  );
}

// ⚠ D. 載っている文字列は書き換えない（空文字も「載っている値」である）。
{
  const env = envelope(REDEMPTION_TYPE, redemptionEvent());
  repairNotificationEvent(env);
  ok("本文が入っていればそのまま", env.payload.event.user_input, "がんばれー！");

  const empty = envelope(REDEMPTION_TYPE, redemptionEvent({ user_input: "" }));
  repairNotificationEvent(empty);
  ok("空文字もそのまま（入力を求めない報酬）", empty.payload.event.user_input, "");
}

// ---------------------------------------------------------------------------
// C. id の補填
// ---------------------------------------------------------------------------
{
  const missing = redemptionEvent();
  delete missing.id;
  const env = envelope(REDEMPTION_TYPE, missing);
  repairNotificationEvent(env);
  ok(
    "⚠⚠ id が無ければ metadata.message_id で補填する",
    env.payload.event.id,
    "env-msg-1",
  );

  const emptyId = envelope(REDEMPTION_TYPE, redemptionEvent({ id: "" }));
  repairNotificationEvent(emptyId);
  ok("⚠ 空文字の id も補填の対象", emptyId.payload.event.id, "env-msg-1");

  const kept = envelope(REDEMPTION_TYPE, redemptionEvent());
  repairNotificationEvent(kept);
  ok("⚠ id が入っていれば書き換えない", kept.payload.event.id, "cp1");
}

// ⚠ 補填元が無ければ**何もしない**（`undefined` を入れて別の壊れ方を作らない）。
{
  const missing = redemptionEvent();
  delete missing.id;
  const env = envelope(REDEMPTION_TYPE, missing, { message_id: "" });
  repairNotificationEvent(env);
  ok(
    "⚠ metadata.message_id が空なら id を作らない（undefined を詰めない）",
    Object.prototype.hasOwnProperty.call(env.payload.event, "id"),
    false,
  );
  // ⚠ この場合でも user_input の正規化は走る（片方の失敗が他方を巻き込まない）。
  ok("⚠ id を補填できなくても user_input の正規化は走る", env.payload.event.user_input, "がんばれー！");
}

// ---------------------------------------------------------------------------
// E. §9: 生やさない・触らない
// ---------------------------------------------------------------------------
{
  const env = envelope(REDEMPTION_TYPE, redemptionEvent());
  const before = Object.keys(env.payload.event).sort();
  repairNotificationEvent(env);
  ok(
    "⚠⚠ §9: フィールドを増やしていない（修復は既存キーの穴埋めだけ）",
    Object.keys(env.payload.event).sort(),
    before,
  );
  ok(
    "⚠⚠ §9: reward には触らない（段 1 は報酬を区別しない）",
    env.payload.event.reward,
    { id: "r1", title: "読み上げ", cost: 500 },
  );
}

// ---------------------------------------------------------------------------
// A/F. 根拠は metadata.subscription_type であり、他の購読を巻き込まない
// ---------------------------------------------------------------------------
{
  // ⚠⚠ 引き換え**そっくりの形**でも、subscription_type が違えば触らない
  //   （＝形の推測で修復していないことの証明）。
  const env = envelope("channel.chat.message", redemptionEvent({ user_input: null }));
  repairNotificationEvent(env);
  ok(
    "⚠⚠ subscription_type が chat.message なら user_input に触らない",
    env.payload.event.user_input,
    null,
  );
}
{
  const chat = {
    broadcaster_user_id: "b1",
    chatter_user_id: "u1",
    chatter_user_name: "Alice",
    message_id: "m1",
    message: { text: "hi", fragments: [] },
  };
  const env = envelope("channel.chat.message", chat);
  const before = JSON.stringify(env.payload.event);
  repairNotificationEvent(env);
  ok("⚠ 通常チャットは 1 バイトも変えない", JSON.stringify(env.payload.event), before);
}

// 043a 回帰: channel.bits.use の message_id 補填（段 1-b で関数へ括り出した挙動）。
{
  const bits = {
    broadcaster_user_id: "b1",
    user_id: "u2",
    user_name: "Bob",
    bits: 100,
    type: "power_up",
  };
  const env = envelope("channel.bits.use", bits);
  repairNotificationEvent(env);
  ok(
    "⚠ 回帰(043a): bits.use は metadata.message_id を message_id に補填する",
    env.payload.event.message_id,
    "env-msg-1",
  );

  const kept = envelope("channel.bits.use", { ...bits, message_id: "own" });
  repairNotificationEvent(kept);
  ok("⚠ 回帰(043a): 既に持っていれば書き換えない", kept.payload.event.message_id, "own");
}

// ---------------------------------------------------------------------------
// G. 壊れた envelope でも throw しない
// ---------------------------------------------------------------------------
//
// ⚠⚠ **`handleMessage` の try/catch に頼らないこと。** あそこで例外を拾うと
//   `streamError` が立って**コメント取得セッションが落ちる**（catch は握りつぶしではない）。
{
  const broken = [
    { metadata: { message_type: "notification" }, payload: { event: null } },
    { metadata: { message_type: "notification" }, payload: { event: "text" } },
    { metadata: undefined, payload: { event: redemptionEvent() } },
    {
      metadata: { message_type: "notification", subscription_type: REDEMPTION_TYPE },
      payload: { event: redemptionEvent() },
    },
    // ⚠⚠⚠ レビュー S-2: **`payload` そのものが無い形**。上流の `isEventSubEnvelope` は
    //   `metadata.message_type` しか検査していないので、この envelope は**ここまで到達する**。
    //   ⚠ 素の `notification.payload.event` だと TypeError になり、`handleMessage` の catch が
    //   `streamError` を立てて**取得セッションごと落ちる**（＝ここが最後の砦である）。
    { metadata: { message_type: "notification" } },
    { metadata: { message_type: "notification" }, payload: null },
    {},
  ];
  let threw = false;
  for (const env of broken) {
    try {
      repairNotificationEvent(env);
    } catch {
      threw = true;
    }
  }
  ok("⚠⚠⚠ 壊れた envelope でも throw しない（本線が止まらない）", threw, false);
  // ⚠ metadata.message_id が無い最後のケースでも user_input の正規化だけは効く。
  ok(
    "⚠ metadata が部分的でも、できる修復はする",
    broken[3].payload.event.user_input,
    "がんばれー！",
  );
}

// ---------------------------------------------------------------------------
// H. 統合: 修復 → mapper（**これが「実機で確認できない経路」の本体**）
// ---------------------------------------------------------------------------
//
// ⚠⚠⚠ 段 1 の実装ではこのケースが **1 件も取り込まれなかった**（静かに消えていた）。
{
  const broken = redemptionEvent({ user_input: null });
  delete broken.id;
  const env = envelope(REDEMPTION_TYPE, broken);
  repairNotificationEvent(env);
  const comments = mapTwitchChatEventsToComments([env.payload.event]);
  ok("⚠⚠⚠ 統合: id 欠落＋user_input=null でも 1 件取り込む", comments.length, 1);
  ok("統合: 種別は channelpoint", comments[0]?.eventType, "channelpoint");
  ok("統合: id は envelope の message_id", comments[0]?.id, "env-msg-1");
  ok("統合: 本文は空文字（null を漏らさない）", comments[0]?.text, "");
  ok("統合: author は引き換えた視聴者", comments[0]?.author?.id, "u9");
  ok(
    "⚠⚠ 統合 §9: 報酬名は出力に現れない",
    JSON.stringify(comments[0]).includes("読み上げ"),
    false,
  );
}

// ---------------------------------------------------------------------------
// I. 静的検査: 修復が handleMessage から**実際に呼ばれている**こと
// ---------------------------------------------------------------------------
//
// ⚠⚠ 上の単体検証は「関数が正しい」ことしか言えない。**呼び出しが消えても全部 PASS する**ので、
//   配線のほうを源コードで固定する（`test-twitch-mapper.mjs` の静的検査 K と同じ作法）。
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(
      here,
      "..",
      "vendor",
      "comment-fetcher",
      "src",
      "adapters",
      "twitch",
      "client",
      "eventsub-websocket.client.ts",
    ),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  ok(
    "⚠⚠ 修復は受信ハンドラから呼ばれている（queue へ積む前に）",
    /repairNotificationEvent\(notification\);[\s\S]{0,200}queue\.push\(event\)/.test(src),
    true,
  );
  // ⚠ 043a の補填がインラインに戻っていないこと（戻ると 2 か所で二重管理になる）。
  ok(
    "⚠ bits.use の補填が handleMessage 内へ戻っていない",
    /handleMessage[\s\S]*?metadata\.message_id;\s*\}/.test(src),
    false,
  );
}

// ---------------------------------------------------------------------------
// J. 静的検査: 購読の成否が **viewer まで配線されている**こと（063e 段 1-b・穴 B）
// ---------------------------------------------------------------------------
//
// ⚠⚠⚠ **実ネットに出ないと再現できない経路なので、源コードで固定するしかない。**
//   ここが 1 か所でも切れると、症状は「設定画面がずっと『まだ分かりません』のまま」＝
//   **本来の待ち状態と見分けが付かない**（＝気付けない）。
{
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (...parts) =>
    readFileSync(join(here, "..", ...parts), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

  const indexSrc = read("src", "index.ts");
  const depsSrc = read("src", "comment-fetcher", "register-twitch-deps.ts");
  const clientSrc = read(
    "vendor", "comment-fetcher", "src", "adapters", "twitch", "client",
    "eventsub-websocket.client.ts",
  );

  // ① vendor: 成否の両方を報告している。
  ok(
    "⚠ 購読成功で true を報告している",
    /reportChannelPointsSubscription\(true\)/.test(clientSrc),
    true,
  );
  ok(
    "⚠ 購読失敗で false を報告している（`.catch` を握りつぶしっぱなしにしない）",
    /reportChannelPointsSubscription\(false\)/.test(clientSrc),
    true,
  );
  // ⚠⚠⚠ 通知が**本線を落とさない**こと。ここが try/catch でないと、通知先の例外が
  //   `Promise.all` を reject させ、**購読が成功しているのにセッションが死ぬ**。
  ok(
    "⚠⚠⚠ 通知は try/catch で包まれている（通知の失敗で取得が止まらない）",
    /private reportChannelPointsSubscription\(ok: boolean\): void \{\s*try \{/.test(
      clientSrc,
    ),
    true,
  );

  // ② DI: 通知先が登録されている（未登録だと tsyringe が解決できず Twitch グラフごと落ちる）。
  ok(
    "⚠ DI に通知先が登録されている",
    depsSrc.includes("channelPointsSubscriptionReporter"),
    true,
  );

  // ③ sidecar 入口: フレーム名・配線・リセット・再接続時の再送。
  ok(
    "⚠ フレーム名は channelpoints.state",
    indexSrc.includes('"channelpoints.state"'),
    true,
  );
  ok(
    "⚠ DI 登録時に通知先を渡している",
    /registerCommentFetcherDependencies\(\{[\s\S]*?onChannelPointsSubscription/.test(
      indexSrc,
    ),
    true,
  );
  // ⚠⚠ **接続先が変わったら成否を捨てる**（自分のチャンネル → 他人のチャンネルで嘘の緑を残さない）。
  //   ⚠ 取得停止時にも畳む。⇒ `unknown` へ戻す箇所が 2 つ以上あること。
  const resets = (indexSrc.match(/sendChannelPointsState\("unknown"\)/g) ?? []).length;
  // ⚠⚠⚠ **3 か所すべてが要る**:
  //   ①開始時（接続先が変わったら捨てる）②停止時（止めたのに緑を残さない）
  //   ③**セッション終了時**（`findActiveLiveStream` の失敗などで購読まで到達しなかったとき、
  //     前のチャンネルの緑が**そのまま残る**のを防ぐ＝①だけでは塞げない）
  ok("⚠⚠⚠ 未接続へ戻す箇所が 3 つある（開始時・停止時・セッション終了時）", resets, 3);
  // ⚠⚠ 再接続時の再送（これが無いと、設定画面を開いただけの人に何も届かない）。
  ok(
    "⚠⚠ viewer の（再）接続時に現在値を送り直している",
    /setConnectionHandler\(\(client\) => \{[\s\S]*?CHANNEL_POINTS_STATE_FRAME/.test(
      indexSrc,
    ),
    true,
  );

  // ④ §9: フレームに載るのは state だけ（reason も channel も載せない）。
  const payloads = indexSrc.match(
    /type: CHANNEL_POINTS_STATE_FRAME,\s*payload: \{([^}]*)\}/g,
  ) ?? [];
  ok("⚠ フレームの組み立ては 2 か所（broadcast と接続時 unicast）", payloads.length, 2);
  // ⚠ **キー名だけを取り出して比べる**（値の側に `channelPointsState` のような識別子が来るので、
  //   payload 全体を文字列で検査すると自分の変数名に引っかかる）。
  const payloadKeys = payloads.map((p) =>
    (/payload: \{([^}]*)\}/.exec(p)?.[1] ?? "")
      .split(",")
      .map((pair) => pair.split(":")[0].trim())
      .filter((k) => k.length > 0),
  );
  ok(
    "⚠⚠ §9: payload に載るのは state だけ（理由・チャンネル名を載せない）",
    payloadKeys,
    [["state"], ["state"]],
  );
}

if (failures > 0) {
  console.error(`\nEVENTSUB-REPAIR FAILED: ${failures}`);
  process.exit(1);
}
console.log("\nEVENTSUB-REPAIR PASS");
