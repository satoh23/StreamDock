// 044a: obs-client の純ヘルパ（obs-helpers）の単体テスト。obs-websocket 非依存の純関数のみを対象にし、
// PASS/FAIL を表明する（既存 test-host-guard.mjs と同作法・テストフレームワーク不使用）。
// 実行前に `pnpm build:tsc` で dist を生成しておくこと（dist/src/obs/obs-helpers.js を import する）。
//
// 仕様（docs/tasks/044a / 044s 実測 / docs/security.md §9）:
//   - safeReason: Error の message を採用・空/非 Error はフォールバック（機微は載らない）。
//   - parseMacWindowItemName: itemName "[owner] title" を owner_name/window_name に分解・想定外は空へ劣化。
//   - isWgcMethodName: WGC（Windows 10 1903 以降）を指すプロパティ名だけ true・非文字列は false。
import {
  safeReason,
  parseMacWindowItemName,
  isWgcMethodName,
} from "../dist/src/obs/obs-helpers.js";

let failures = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    process.stderr.write(`PASS ${label}\n`);
  } else {
    failures++;
    process.stderr.write(`FAIL ${label}: got ${a}, expected ${e}\n`);
  }
};

// --- safeReason（obs.state の reason に機微を混ぜない要約）---
eq("safeReason: Error の message を採用", safeReason(new Error("boom"), "fb"), "boom");
eq("safeReason: message 空はフォールバック", safeReason(new Error(""), "fb"), "fb");
eq("safeReason: 非 Error はフォールバック", safeReason("nope", "fb"), "fb");
eq("safeReason: null はフォールバック", safeReason(null, "fb"), "fb");

// --- parseMacWindowItemName（mac の安定キー分解）---
eq(
  "parseMac: [owner] title を分解",
  parseMacWindowItemName("[StreamDock] StreamDock コメントオーバーレイ"),
  { ownerName: "StreamDock", windowName: "StreamDock コメントオーバーレイ" },
);
eq("parseMac: owner 内スペースを保持", parseMacWindowItemName("[Google Chrome] Tab"), {
  ownerName: "Google Chrome",
  windowName: "Tab",
});
eq("parseMac: タイトル空は windowName 空文字", parseMacWindowItemName("[Owner] "), {
  ownerName: "Owner",
  windowName: "",
});
eq("parseMac: 角括弧で始まらないは空へ劣化", parseMacWindowItemName("no brackets"), {});
eq("parseMac: null は空へ劣化", parseMacWindowItemName(null), {});
eq("parseMac: undefined は空へ劣化", parseMacWindowItemName(undefined), {});

// --- isWgcMethodName（WGC 名の一致判定）---
eq("isWgc: 'Windows 10 (1903 and up)' → true", isWgcMethodName("Windows 10 (1903 and up)"), true);
eq("isWgc: 'Windows Graphics Capture' → true", isWgcMethodName("Windows Graphics Capture"), true);
eq("isWgc: 'WGC' → true", isWgcMethodName("WGC"), true);
eq("isWgc: 'Automatic' → false", isWgcMethodName("Automatic"), false);
eq("isWgc: 'BitBlt (Windows 7 and up)' → false（BitBlt は WGC ではない）", isWgcMethodName("BitBlt (Windows 7 and up)"), false);
eq("isWgc: 非文字列（数値）→ false", isWgcMethodName(2), false);
eq("isWgc: null → false", isWgcMethodName(null), false);

process.stderr.write(
  failures === 0 ? "\nOBS-CLIENT PASS\n" : `\nOBS-CLIENT FAIL (${failures})\n`,
);
process.exit(failures === 0 ? 0 : 1);
