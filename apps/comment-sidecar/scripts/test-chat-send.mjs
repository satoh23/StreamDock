// 066: **チャットへの書き込み**の判断（チケット照合・本文検証・スロットル）の検証。
//
// ⚠⚠⚠ **`index.ts` には判断を置いていない**ので、ここで全部殺せる（060h コミット 2 と同じ理由＝
// `index.ts` は top-level で `main()` を呼ぶため import できず、そこに判断を書くと
// **チケット照合もスロットルもミューテーションで生存する**）。
// ⚠ **判断を `index.ts` へ戻したら、このファイルは意味を失う。**
import {
  CHAT_CHANNEL_MISMATCH_REASON,
  CHAT_SEND_FRAME,
  CHAT_SEND_RESULT_FRAME,
  CHAT_MESSAGE_MAX_LENGTH,
  createChatSendThrottle,
  handleChatSendFrame,
  isAllowedChatMessage,
  isSameChatSecret,
} from "../dist/src/chat-send/chat-send-frame.js";
import { createTwitchChatSender } from "../dist/src/chat-send/twitch-chat-sender.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let failures = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  process.stderr.write(
    `${pass ? "PASS" : "FAIL"} ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})\n`,
  );
};

// --- 本文の検証 -------------------------------------------------------------------------------

check("空は送れない", isAllowedChatMessage(""), false);
check("空白だけも送れない", isAllowedChatMessage("   "), false);
check("非文字列は送れない", isAllowedChatMessage(42), false);
check("普通の文は送れる", isAllowedChatMessage("こんばんは"), true);
check(
  "⚠ 改行は送れない（1 要求で複数行を流し込めるとスロットルの意味が薄れる）",
  isAllowedChatMessage("a\nb"),
  false,
);
check("⚠ 制御文字は送れない", isAllowedChatMessage("a\u0001b"), false);
check(
  "上限ちょうどは送れる",
  isAllowedChatMessage("a".repeat(CHAT_MESSAGE_MAX_LENGTH)),
  true,
);
check(
  "⚠ 上限超は**切り詰めずに拒否**（送った文と流れた文が違う状態を作らない）",
  isAllowedChatMessage("a".repeat(CHAT_MESSAGE_MAX_LENGTH + 1)),
  false,
);

// --- チケット ---------------------------------------------------------------------------------

check("同じチケットは一致", isSameChatSecret("abc", "abc"), true);
check("違うチケットは不一致", isSameChatSecret("abc", "abd"), false);
check("長さ違いは不一致（throw しない）", isSameChatSecret("abc", "abcd"), false);

// --- スロットル -------------------------------------------------------------------------------

{
  const t = createChatSendThrottle({
    minIntervalMs: 1000,
    windowMs: 10_000,
    maxInWindow: 3,
  });
  check("1 通目は通る", t.check("a", 0).ok, true);
  t.commit("a", 0);
  check("⚠ 最短間隔より前は落ちる", t.check("b", 500).ok, false);
  check("間隔が空けば通る", t.check("b", 1500).ok, true);
  t.commit("b", 1500);
  check(
    "⚠⚠ 直前と同じ本文は落ちる（Twitch 側で黙って消えるので、こちらで理由を出す）",
    t.check("b", 3000).ok,
    false,
  );
  check("違う本文なら通る", t.check("c", 3000).ok, true);
  t.commit("c", 3000);
  check("⚠ 窓の上限に達したら落ちる", t.check("d", 4500).ok, false);
  check("⚠ 窓を抜ければ戻る", t.check("d", 20_000).ok, true);
}

// --- フレーム処理（チケット照合・結果の返し方） ------------------------------------------------

const frame = (over = {}) => ({
  type: CHAT_SEND_FRAME,
  ticket: "T",
  requestId: 1,
  message: "hello",
  // ⚠⚠⚠ S-2b: **宛先ではなく「宛先の期待値」**（sidecar が実際の宛先と突き合わせる）。
  expectedChannel: "somechannel",
  ...over,
});

/** 既定の宛先（`frame()` の `expectedChannel` と一致させる）。 */
const currentChannel = () => "somechannel";

{
  // ⚠⚠ チケット未受領（fail-closed）＝**返事もしない**。
  const replies = [];
  let sent = 0;
  await handleChatSendFrame({
    frame: frame(),
    ticket: null,
    currentChannel,
    reply: (m) => replies.push(m),
    throttle: createChatSendThrottle(),
    now: () => 0,
    send: async () => {
      sent++;
      return { ok: true };
    },
  });
  check("⚠⚠ チケット未受領なら送らない", sent, 0);
  check(
    "⚠⚠ チケット未受領なら返事もしない（総当たりの手掛かりを与えない）",
    replies.length,
    0,
  );
}

{
  const replies = [];
  let sent = 0;
  await handleChatSendFrame({
    frame: frame({ ticket: "WRONG" }),
    ticket: "T",
    currentChannel,
    reply: (m) => replies.push(m),
    throttle: createChatSendThrottle(),
    now: () => 0,
    send: async () => {
      sent++;
      return { ok: true };
    },
  });
  check("⚠⚠ チケット不一致なら送らない", sent, 0);
  check("⚠⚠ チケット不一致なら返事もしない", replies.length, 0);
}

{
  const replies = [];
  let sentMessage = null;
  await handleChatSendFrame({
    frame: frame(),
    ticket: "T",
    currentChannel,
    reply: (m) => replies.push(m),
    throttle: createChatSendThrottle(),
    now: () => 0,
    send: async (message) => {
      sentMessage = message;
      return { ok: true };
    },
  });
  check("チケット一致なら送る", sentMessage, "hello");
  check("結果は要求元へ返る", replies[0]?.type, CHAT_SEND_RESULT_FRAME);
  check("requestId が載る", replies[0]?.payload?.requestId, 1);
  check("ok が載る", replies[0]?.payload?.ok, true);
  check(
    "⚠⚠ §9: 返す結果に本文を載せない",
    JSON.stringify(replies[0]).includes("hello"),
    false,
  );
}

{
  // ⚠⚠ スロットルに落ちたら **API を 1 回も叩かない**。
  const throttle = createChatSendThrottle({ minIntervalMs: 10_000 });
  let sent = 0;
  const replies = [];
  const deps = {
    ticket: "T",
    currentChannel,
    reply: (m) => replies.push(m),
    throttle,
    now: () => 0,
    send: async () => {
      sent++;
      return { ok: true };
    },
  };
  await handleChatSendFrame({ ...deps, frame: frame({ message: "one" }) });
  await handleChatSendFrame({
    ...deps,
    frame: frame({ requestId: 2, message: "two" }),
  });
  check("⚠⚠ スロットルに落ちた分は送らない", sent, 1);
  check("⚠ 落ちたことは理由つきで返る", replies[1]?.payload?.ok, false);
  check(
    "⚠ 理由が空でない",
    typeof replies[1]?.payload?.reason === "string" &&
      replies[1].payload.reason.length > 0,
    true,
  );
}

// --- ⚠⚠⚠ S-2b: 宛先の突き合わせ（security-review 2 巡目）------------------------------------
//
// ⚠⚠ **当初の対処「画面に送信先を出す」は実装として成立していなかった。**
// 出していたのは **frontend 自身が持っている入力値**で、sidecar が実際に握っている宛先ではない
// ＝ 未認証の loopback WS から `start-session` で差し替えられても**表示は変わらない**。
// ⇒ 段 2 の着手条件だった「送信時の突き合わせ」を前倒しし、ここで固定する。

{
  // ⚠⚠⚠ **実際の宛先と期待値が違ったら送らない。**
  const replies = [];
  let sent = 0;
  await handleChatSendFrame({
    frame: frame({ expectedChannel: "mychannel" }),
    ticket: "T",
    // ⚠ 攻撃者が `start-session` で差し替えた後の状態。
    currentChannel: () => "attacker",
    reply: (m) => replies.push(m),
    throttle: createChatSendThrottle(),
    now: () => 0,
    send: async () => {
      sent++;
      return { ok: true };
    },
  });
  check("⚠⚠⚠ 宛先が食い違ったら送らない", sent, 0);
  check(
    "⚠⚠ 宛先の食い違いは**返事をする**（チケットと違い、黙ると差し替えに気づけない）",
    replies[0]?.payload?.reason,
    CHAT_CHANNEL_MISMATCH_REASON,
  );
  check(
    "⚠⚠ §9: 実際の宛先を理由に載せない",
    JSON.stringify(replies[0]).includes("attacker"),
    false,
  );
}

{
  // ⚠ 大文字小文字・前後の空白は**同じ宛先として扱う**（正しい相手なのに送れない、を作らない）。
  let sent = 0;
  await handleChatSendFrame({
    frame: frame({ expectedChannel: "  MyChannel  " }),
    ticket: "T",
    currentChannel: () => "mychannel",
    reply: () => {},
    throttle: createChatSendThrottle(),
    now: () => 0,
    send: async () => {
      sent++;
      return { ok: true };
    },
  });
  check("⚠ 大文字小文字・空白の違いでは落とさない", sent, 1);
}

{
  // ⚠⚠ 未接続（`null`）はここで弾かない——`send` が「配信に接続していません」を返す
  //   唯一の持ち主なので、文言の持ち主を 2 か所に割らない。
  let sent = 0;
  await handleChatSendFrame({
    frame: frame(),
    ticket: "T",
    currentChannel: () => null,
    reply: () => {},
    throttle: createChatSendThrottle(),
    now: () => 0,
    send: async () => {
      sent++;
      return { ok: false, reason: "配信に接続していません。" };
    },
  });
  check("⚠ 未接続は突き合わせで弾かず、send 側の文で落とす", sent, 1);
}

// --- ⚠⚠⚠ Q-066-1: スロットルの枠は「送る前」に消費する ----------------------------------------
//
// ⚠⚠ **レビューのミューテーションで唯一生き残った箇所**（`throttle.commit` を `await send()` の
// 後ろへ移してもテストが全部通った）。スロットルを sidecar 側にしか置かない理由が
// 「frontend の制限は未認証 WS から回避される」ことなので、**ここが唯一の壁**である。
// ⇒ **await の間に 2 通目が滑り込まない**ことを、実際に並行させて固定する。
{
  let sent = 0;
  let release = null;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const deps = {
    ticket: "T",
    currentChannel,
    reply: () => {},
    throttle: createChatSendThrottle(),
    now: () => 0,
    send: async () => {
      sent++;
      await gate; // ⚠ 1 通目を送信中のまま止める。
      return { ok: true };
    },
  };
  // ⚠ **await しない**（1 通目が送信中のまま 2 通目を投げる）。
  const first = handleChatSendFrame({ ...deps, frame: frame({ message: "one" }) });
  const second = handleChatSendFrame({
    ...deps,
    frame: frame({ requestId: 2, message: "two" }),
  });
  check(
    "⚠⚠⚠ 送信中に来た 2 通目はスロットルで落ちる（枠を送る前に消費している）",
    sent,
    1,
  );
  release();
  await Promise.all([first, second]);
  check("⚠ 1 通目は最後まで送られる", sent, 1);
}

// --- 送信器（宛先の決まり方） ------------------------------------------------------------------

{
  // ⚠⚠⚠ **配信に接続していなければ送らない**（宛先は viewer から来ない）。
  let called = 0;
  const sender = createTwitchChatSender({
    getAccessToken: async () => "tok",
    clientId: "cid",
    fetchImpl: async () => {
      called++;
      return new Response("{}", { status: 200 });
    },
    helixBaseUrl: "https://api.twitch.tv/helix",
  });
  const r = await sender.send("hi");
  check("⚠⚠ 未接続なら送らない", r.ok, false);
  check("⚠⚠ 未接続なら API を 1 回も叩かない", called, 0);
}

{
  // ⚠ 401/403 は「再ログインして」に翻訳する（043a の bits:read と同じ非致命化）。
  const sender = createTwitchChatSender({
    getAccessToken: async () => "tok",
    clientId: "cid",
    fetchImpl: async (url) =>
      String(url).includes("/users")
        ? new Response(JSON.stringify({ data: [{ id: "1" }] }), { status: 200 })
        : new Response("{}", { status: 401 }),
    helixBaseUrl: "https://api.twitch.tv/helix",
  });
  sender.setChannel("someone");
  const r = await sender.send("hi");
  check("⚠ 401 は失敗として返る", r.ok, false);
  check("⚠⚠ 再ログインを促す文になる", (r.reason ?? "").includes("ログイン"), true);
}

{
  // ⚠⚠ 宛先は `setChannel` でしか変わらない。⚠ 送信本体の body に載る id は解決結果である。
  let body = null;
  const sender = createTwitchChatSender({
    getAccessToken: async () => "tok",
    clientId: "cid",
    fetchImpl: async (url, init) => {
      if (String(url).includes("/users?login=")) {
        return new Response(JSON.stringify({ data: [{ id: "B" }] }), {
          status: 200,
        });
      }
      if (String(url).endsWith("/users")) {
        return new Response(JSON.stringify({ data: [{ id: "S" }] }), {
          status: 200,
        });
      }
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    },
    helixBaseUrl: "https://api.twitch.tv/helix",
  });
  sender.setChannel("someone");
  const r = await sender.send("hi");
  check("送信できる", r.ok, true);
  check("⚠⚠ broadcaster_id は接続中のチャンネル由来", body?.broadcaster_id, "B");
  check("⚠ sender_id はログイン中の本人", body?.sender_id, "S");
  check("本文がそのまま載る", body?.message, "hi");

  // ⚠⚠ チャンネルを外したら送れなくなる（＝取得を止めたら書き込めない）。
  sender.setChannel(null);
  const after = await sender.send("hi");
  check("⚠⚠ 取得を止めたら送れない", after.ok, false);
}

// --- ⚠⚠⚠ 静的検査（security-review 066 S-1）---------------------------------------------------
//
// ⚠⚠ **`index.ts` は top-level で `main()` を呼ぶため import できない**ので、
// 「どのトークン取得関数を配線しているか」は**実行しては確かめられない**。
// ⇒ **ソース文字列を直接読む**（`apps/desktop/scripts/check-css-guards.mjs` と同じ作法＝
// 「テストでは守れない不変条件を静的に守る」）。
//
// ⚠⚠⚠ **なぜ守るのか**: `authClient.refresh` は
// ①**毎回 refresh token を無条件で交換**し ②**失敗すると `tokenStore.clear` を呼ぶ**
// ＝ **Rust が keychain を削除して完全ログアウト**になる。
// ⇒ **テスト送信 1 回がユーザーをログアウトさせ、コメント取得ごと止める。**
// `getValidAccessToken` は**期限切れのときだけ**交換する非破壊のアクセサである。
{
  const here = dirname(fileURLToPath(import.meta.url));
  const indexSrc = readFileSync(join(here, "..", "src", "index.ts"), "utf8");
  // ⚠ コメントを剥がしてから見る（本文中に関数名が出てくるため・check-css-guards.mjs と同じ罠）。
  const code = indexSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  check(
    "⚠⚠⚠ S-1: チャット送信は **getValidAccessToken** を使う（非破壊）",
    code.includes('getAccessToken: () => authClient.getValidAccessToken("twitch")'),
    true,
  );
  check(
    "⚠⚠⚠ S-1: チャット送信で **authClient.refresh を使わない**（失敗で強制ログアウトするため）",
    /getAccessToken:\s*\(\)\s*=>\s*authClient\.refresh\(/.test(code),
    false,
  );
}

process.stderr.write(
  failures === 0 ? "chat-send: OK\n" : `chat-send: ${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
