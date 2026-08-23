// 066 段 2: **取得セッションの制御（`start-session` / `stop-session`）のチケット照合**の検証。
//
// ⚠⚠⚠ **`index.ts` には判断を置いていない**ので、ここで殺せる（060h コミット 2 / 066 段 1 と同じ理由＝
// `index.ts` は top-level で `main()` を呼ぶため import できず、そこに判断を書くと
// **チケット照合がミューテーションで生存する**）。
// ⚠ **判断を `index.ts` へ戻したら、このファイルは意味を失う。**
//
// ⚠⚠ **ここで殺せないもの**（＝別の担保が要るもの）:
//   - `parseControlFrame` の形式検査 … `index.ts` にあるので import できない
//     ⇒ 下の「静的検査」で**ソース文字列として**固定する（`test-chat-send.mjs` の S-1 と同じ作法）。
//   - dev-mock より前に照合していること（穴 A） … Rust 側 `lib.rs` の
//     `sidecar_ticket_contract::session_ticket_check_precedes_the_dev_mock_branch` が固定している。
//   - Rust と sidecar の stdin prefix 一致 … 同 `sidecar_ticket_stdin_prefixes`。
import {
  SESSION_CHANNEL_MAX_CHARS,
  SESSION_TICKET_MAX_CHARS,
  isAllowedSessionChannel,
  isAllowedSessionTicket,
  isAuthorizedSessionControl,
  isSameSessionSecret,
} from "../dist/src/session-control/session-control-frame.js";
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

// --- チケットの形式検査 -------------------------------------------------------------------------

check("非文字列は受けない", isAllowedSessionTicket(42), false);
check("undefined は受けない", isAllowedSessionTicket(undefined), false);
check("null は受けない", isAllowedSessionTicket(null), false);
check(
  "⚠⚠ 空文字は受けない（受けると「長さ 0 のチケット」で誰でも通る形になる）",
  isAllowedSessionTicket(""),
  false,
);
check("普通のチケットは受ける", isAllowedSessionTicket("a".repeat(32)), true);
check(
  "上限ちょうどは受ける",
  isAllowedSessionTicket("a".repeat(SESSION_TICKET_MAX_CHARS)),
  true,
);
check(
  "⚠ 上限超は受けない（未認証クライアントに巨大文字列を握らせない・060c S-5）",
  isAllowedSessionTicket("a".repeat(SESSION_TICKET_MAX_CHARS + 1)),
  false,
);

// --- 宛先（channel）の形式検査（レビュー S-5）-----------------------------------------------------
//
// ⚠⚠ `chat-send` の `expectedChannel` にだけ上限があり、**実際に宛先になる `start-session` の
//   `channel` には無かった**——その非対称を解消したぶん。

check("非文字列は受けない", isAllowedSessionChannel(42), false);
check("undefined は受けない", isAllowedSessionChannel(undefined), false);
check("普通のチャンネル名は受ける", isAllowedSessionChannel("mychannel"), true);
check(
  "上限ちょうどは受ける",
  isAllowedSessionChannel("a".repeat(SESSION_CHANNEL_MAX_CHARS)),
  true,
);
check(
  "⚠⚠ 上限超は受けない（切り詰めず不受理＝送ったつもりと実際がずれない）",
  isAllowedSessionChannel("a".repeat(SESSION_CHANNEL_MAX_CHARS + 1)),
  false,
);
check(
  "⚠ 空文字は**意図的に**通す（frontend が送る前に落とす・JSDoc の再修正トリガーが正）",
  isAllowedSessionChannel(""),
  true,
);

// --- 定数時間比較 -------------------------------------------------------------------------------

check("同じチケットは一致", isSameSessionSecret("abc", "abc"), true);
check("違うチケットは不一致", isSameSessionSecret("abc", "abd"), false);
check(
  "⚠ 長さ違いは不一致（timingSafeEqual を throw させない）",
  isSameSessionSecret("abc", "abcd"),
  false,
);
check("⚠ 前方一致でも通さない", isSameSessionSecret("abcd", "abc"), false);

// --- 受理判定（fail-closed）----------------------------------------------------------------------

check(
  "⚠⚠⚠ チケット未受領（null）なら何も通さない（fail-closed）",
  isAuthorizedSessionControl("abc", null),
  false,
);
check(
  "⚠⚠ 未受領のときは空文字でも通さない",
  isAuthorizedSessionControl("", null),
  false,
);
check("チケット一致なら通る", isAuthorizedSessionControl("abc", "abc"), true);
check(
  "⚠⚠ チケット不一致なら通さない（宛先の差し替えを塞ぐ本体）",
  isAuthorizedSessionControl("WRONG", "abc"),
  false,
);
check(
  "⚠ テーマ／チャットのチケットを流用しても通らない（能力ごとに秘密が別）",
  isAuthorizedSessionControl("theme-ticket", "session-ticket"),
  false,
);

// --- ⚠⚠⚠ 静的検査（`index.ts` は import できないので、ソース文字列として固定する）-----------------
//
// ⚠⚠ **ここで守るのは「門が外れていないこと」だけ**である。実装の中身は上の純関数テストが持つ。
// 作法は `test-chat-send.mjs` の S-1 静的検査とまったく同じ（コメントを剥がしてから見る）。
{
  const here = dirname(fileURLToPath(import.meta.url));
  const indexSrc = readFileSync(join(here, "..", "src", "index.ts"), "utf8");
  // ⚠ コメントを剥がしてから見る（本文中に関数名が出てくるため・check-css-guards.mjs と同じ罠）。
  const code = indexSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  check(
    "⚠⚠⚠ 取得セッション制御のチケット照合が index.ts に配線されている",
    code.includes(
      "isAuthorizedSessionControl(frame.ticket, sessionControlTicket)",
    ),
    true,
  );
  check(
    "⚠⚠ 照合は start-session と stop-session の両方に掛かっている",
    /frame\.type === "start-session" \|\| frame\.type === "stop-session"/.test(
      code,
    ),
    true,
  );
  check(
    "⚠⚠⚠ 不一致は黙って捨てる（返事をしない＝総当たりの手掛かりを与えない）",
    /isAuthorizedSessionControl\([\s\S]{0,120}?\)\s*\)\s*\{\s*return;/.test(code),
    true,
  );
  check(
    "⚠⚠ start-session は形式検査を通らないフレームを組まない",
    /if \(!isAllowedSessionTicket\(ticket\)\) return null;/.test(code),
    true,
  );
  check(
    "⚠ 形式検査は 2 か所（start-session / stop-session）にある",
    (code.match(/isAllowedSessionTicket\(ticket\)/g) ?? []).length,
    2,
  );
  check(
    "⚠⚠ レビュー S-5: start-session の channel も形式検査を通る（実値にも上限が掛かる）",
    /if \(isAllowedSessionChannel\(m\.channel\)\)/.test(code),
    true,
  );
  check(
    "⚠⚠⚠ チケットは stdin private pipe でしか入らない（WS からは設定できない）",
    (code.match(/sessionControlTicket = /g) ?? []).length,
    1,
  );
  check(
    "⚠⚠ 空文字の stdin 行は受けない（長さ 0 のチケットで誰でも通る形を作らない）",
    /if \(value\.length > 0\) sessionControlTicket = value;/.test(code),
    true,
  );

  // ⚠⚠⚠ **§9: チケットをログにも WS にも出さない。**
  //   `logInfo` / `broadcastMessage` / `sendToClient` の引数に載っていないことを、
  //   「その行に変数名が出てこない」で見る（雑だが、載せた瞬間に落ちる）。
  // ⚠⚠ **レビュー Q-9: これは「同一行」しか見ていない。** 複数行に分けて
  //   `logInfo({\n  t: sessionControlTicket,\n})` と書かれると**素通りする**。
  //   ⚠ 完全な担保ではなく「うっかり 1 行で足した」を止めるだけだと理解すること。
  //   ⚠ 再修正トリガー＝ここが複数行の呼び出しを含むようになったら、AST か
  //     「`sessionControlTicket` を含む行から前方 N 行に呼び出しが無いこと」まで踏み込む。
  const leaks = code
    .split("\n")
    .filter(
      (line) =>
        line.includes("sessionControlTicket") &&
        (line.includes("logInfo") ||
          line.includes("broadcastMessage") ||
          line.includes("sendToClient")),
    );
  check("⚠⚠ §9: チケットをログにも WS にも載せていない", leaks.length, 0);
}

process.stderr.write(
  failures === 0 ? "session-control: OK\n" : `session-control: ${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
