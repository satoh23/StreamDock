// 044a: obs-client の純ヘルパ（obs-helpers）の単体テスト。obs-websocket 非依存の純関数のみを対象にし、
// PASS/FAIL を表明する（既存 test-host-guard.mjs と同作法・テストフレームワーク不使用）。
// 実行前に `pnpm build:tsc` で dist を生成しておくこと（dist/src/obs/obs-helpers.js を import する）。
//
// 仕様（docs/tasks/044a / 044s 実測 / docs/security.md §9）:
//   - safeReason: Error の message を採用・空/非 Error はフォールバック（機微は載らない）。
//   - parseMacWindowItemName: itemName "[owner] title" を owner_name/window_name に分解・想定外は空へ劣化。
//   - isWgcMethodName: WGC（Windows 10 1903 以降）を指すプロパティ名だけ true・非文字列は false。
//
// 061a で追加（obs-client 本体から純データ／純関数だけを読む）:
//   - OBS_OVERLAYS / OBS_OVERLAY_KINDS: 種別ごとのソース名・窓名のレジストリ。
//     ⚠ **窓名が互いに `includes` で紛れないこと**を総当たりで固定する（sidecar の候補一致が `includes` のため。
//     紛れると `ensureOverlaySource` が誤った窓を掴み、しかも M2 フォールバックで "reused"＝成功として返る）。
//   - parseOverlayKind: 制御フレームの `overlay` を固定 union へ落とす **allow-list**（§3/§8）。
//     ⚠ 046d 時点では index.ts にあり import 不能（top-level で main() が走る）で**検証ゼロ**だった。
//     061a で obs-client.ts へ移し、ここで初めてテストできるようになった。
// ⚠ obs-client.js は obs-websocket-js を import するが top-level 副作用は無い（接続も listen もしない）。
import {
  safeReason,
  parseMacWindowItemName,
  isWgcMethodName,
} from "../dist/src/obs/obs-helpers.js";
import {
  OBS_OVERLAYS,
  OBS_OVERLAY_KINDS,
  parseOverlayKind,
} from "../dist/src/obs/obs-client.js";

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

// --- OBS_OVERLAYS レジストリ（061a: 2 種 → 3 種／061k: 3 種 → 4 種）---
// 種別の集合そのものを固定する（増減に必ず気付く。並び順には依存しない）。
eq(
  "OBS_OVERLAY_KINDS: comments / pinned / effects / stage の 4 種",
  [...OBS_OVERLAY_KINDS].sort(),
  ["comments", "effects", "pinned", "stage"],
);
// 044a からの慣習: OBS に作るソース名はキャプチャ対象の窓名と同じにする（OBS 上で対応が分かる）。
for (const kind of OBS_OVERLAY_KINDS) {
  eq(
    `OBS_OVERLAYS[${kind}]: sourceName と windowTitle が一致`,
    OBS_OVERLAYS[kind].sourceName === OBS_OVERLAYS[kind].windowTitle,
    true,
  );
}
// ⚠⚠ **本命**: 候補一致は `findOverlayWindowItem` の `itemName.includes(windowTitle)` なので、
// どれかの窓名が他の窓名を部分文字列として含むと、そのソースが**別の窓を掴む**。
// しかも `ensureOverlaySource` の M2 フォールバックにより既存ソースがあれば "reused"＝成功で返るため、
// UI は成功表示・OBS のソースは別の窓、という静かな壊れ方をする。
// ⚠ **総当たりで回す**（2 種のときの手書き比較を 3 種へ増やす形にしない）。
// ⚠⚠ **061k で 4 種目（stage）を足したが、このループは 1 行も変えていない**＝総当たり化が意図どおり効いた。
//   `"StreamDock エフェクト（全画面）"` のような名前を選ぶと**ここが落ちる**（既存の effects を含むため）。
for (const a of OBS_OVERLAY_KINDS) {
  for (const b of OBS_OVERLAY_KINDS) {
    if (a === b) continue;
    eq(
      `窓名が紛れない: ${a} が ${b} を includes しない`,
      OBS_OVERLAYS[a].windowTitle.includes(OBS_OVERLAYS[b].windowTitle),
      false,
    );
  }
}

// --- parseOverlayKind（制御フレームの allow-list・§3/§8）---
// 既知の値はそのまま受理する。
for (const kind of OBS_OVERLAY_KINDS) {
  eq(`parseOverlayKind: "${kind}" を受理`, parseOverlayKind(kind), kind);
}
// 未知・未指定・非文字列はすべて既定 "comments" へ落ちる（044a 時点の viewer からのフレームと同じ挙動）。
eq("parseOverlayKind: undefined → comments（後方互換）", parseOverlayKind(undefined), "comments");
eq("parseOverlayKind: null → comments", parseOverlayKind(null), "comments");
eq("parseOverlayKind: 未知の文字列 → comments", parseOverlayKind("nope"), "comments");
eq("parseOverlayKind: 数値 → comments", parseOverlayKind(123), "comments");
eq("parseOverlayKind: オブジェクト → comments", parseOverlayKind({ overlay: "pinned" }), "comments");
// ⚠⚠ **プロトタイプ経由の fail-open を塞ぐ**。`v in OBS_OVERLAYS` や `OBS_OVERLAYS[v] !== undefined`
// で判定すると、この 3 つは真になって未検証の値が通る（`OBS_OVERLAYS["__proto__"]` は Object.prototype）。
// 実装が `Object.keys` の配列に対する `includes` であることを、この 3 ケースが担保している。
eq('parseOverlayKind: "__proto__" → comments', parseOverlayKind("__proto__"), "comments");
eq('parseOverlayKind: "constructor" → comments', parseOverlayKind("constructor"), "comments");
eq('parseOverlayKind: "toString" → comments', parseOverlayKind("toString"), "comments");

process.stderr.write(
  failures === 0 ? "\nOBS-CLIENT PASS\n" : `\nOBS-CLIENT FAIL (${failures})\n`,
);
process.exit(failures === 0 ? 0 : 1);
