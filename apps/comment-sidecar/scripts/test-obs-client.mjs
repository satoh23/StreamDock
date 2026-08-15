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
  // 064a: ユーザーが OBS に作ったソースを鳴らすための入口検査。
  isAllowedObsSourceName,
  clampObsFireDurationMs,
  // 064b: 表示時間を OBS の `mediaDuration` から決める（メディアソースだけ）。
  resolveObsFireDurationMs,
} from "../dist/src/obs/obs-helpers.js";
import {
  OBS_OVERLAYS,
  OBS_OVERLAY_KINDS,
  parseOverlayKind,
  // 064c: `GetInputList` の結果 → 一覧（⚠ **0 件でも `ok:true`**）。
  toObsSourceListResult,
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
  "OBS_OVERLAY_KINDS: comments / pinned / stage の 3 種（⚠ 064d で effects を削除）",
  [...OBS_OVERLAY_KINDS].sort(),
  ["comments", "pinned", "stage"],
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
//   `"StreamDock エフェクト（全画面）"` のような名前を選ぶと**ここが落ちる**（061k 当時の effects を含むため）。
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


// --- 064a: OBS ソースを鳴らす方式の入口検査 -------------------------------------------------------
//
// ⚠⚠ **これは 044a 以来はじめて「viewer から来た文字列が OBS 操作へ渡る」経路の 1 枚目の壁**である。
//   2 枚目（実在検査＝`GetInputList` との照合）は obs-client 側にあり、実 OBS が要るのでここでは検証できない。
//   ⚠ **1 枚目だけで安全と読まないこと**——ここを通っても、OBS に無い名前は 1 回も操作へ渡らない。

eq("source name: 通常の名前", isAllowedObsSourceName("きらきら演出"), true);
eq("source name: 前後空白は許容（trim して使う）", isAllowedObsSourceName("  a  "), true);
eq("source name: 空", isAllowedObsSourceName(""), false);
eq("source name: 空白だけ", isAllowedObsSourceName("   "), false);
eq("source name: 非文字列", isAllowedObsSourceName(123), false);
eq("source name: null", isAllowedObsSourceName(null), false);
eq("source name: undefined", isAllowedObsSourceName(undefined), false);
eq("source name: 200 文字ちょうど", isAllowedObsSourceName("a".repeat(200)), true);
eq("source name: 201 文字", isAllowedObsSourceName("a".repeat(201)), false);
// ⚠ 制御文字（改行・NUL・DEL）はログ／エラー文言の表示を壊すので落とす（§9 の作法）。
eq("source name: 改行入り", isAllowedObsSourceName("a\nb"), false);
eq("source name: NUL 入り", isAllowedObsSourceName("a\u0000b"), false);
eq("source name: DEL 入り", isAllowedObsSourceName("a\u007fb"), false);

// ⚠⚠ **クランプであって拒否ではない**——不正値で「消えないまま配信に残る」のが最悪なので、
//   必ず有限の表示時間へ落とす。
eq("duration: 範囲内はそのまま", clampObsFireDurationMs(5000), 5000);
eq("duration: 下限", clampObsFireDurationMs(0), 500);
eq("duration: 上限", clampObsFireDurationMs(999999), 15000);
eq("duration: 負数", clampObsFireDurationMs(-1), 500);
eq("duration: NaN は既定へ", clampObsFireDurationMs(Number.NaN), 5000);
eq("duration: 非数値は既定へ", clampObsFireDurationMs("5000"), 5000);
eq("duration: 小数は丸める", clampObsFireDurationMs(1234.6), 1235);

// --- 064b: 表示時間を OBS の `mediaDuration` から決める --------------------------------------
// ⚠⚠ **固定 5 秒だと「10 秒の動画が 5 秒で切れる」が必ず起きる**（仕様どおりなのにバグ報告になる形）。
//   ⇒ メディアソースは OBS に長さを聞く。ただし **OBS が返す外部由来の数値**なので必ずクランプする
//   （素通しすると setTimeout に巨大値が渡り、実質「消えない」＝この機能で最悪の壊れ方）。
eq(
  "media duration: 使える長さはそれを採る",
  resolveObsFireDurationMs(8000, 5000),
  8000,
);
eq(
  "media duration: null なら fallback",
  resolveObsFireDurationMs(null, 5000),
  5000,
);
eq(
  "media duration: undefined なら fallback（GetMediaInputStatus が失敗した形）",
  resolveObsFireDurationMs(undefined, 5000),
  5000,
);
// ⚠ 未ロード／再生していないメディアは 0 や -1 を返す＝「長さが分からなかった」。
eq("media duration: 0 は fallback", resolveObsFireDurationMs(0, 5000), 5000);
eq("media duration: 負数は fallback", resolveObsFireDurationMs(-1, 5000), 5000);
eq(
  "media duration: NaN は fallback",
  resolveObsFireDurationMs(Number.NaN, 5000),
  5000,
);
eq(
  "media duration: Infinity は fallback（Number.isFinite で落ちる）",
  resolveObsFireDurationMs(Number.POSITIVE_INFINITY, 5000),
  5000,
);
eq(
  "media duration: 文字列は fallback",
  resolveObsFireDurationMs("8000", 5000),
  5000,
);
// ⚠⚠ **上限は残る**（15 秒より長い動画は 15 秒で切れる）。ここを外すと「消えない」が復活する。
eq(
  "media duration: 上限でクランプされる",
  resolveObsFireDurationMs(600000, 5000),
  15000,
);
eq(
  "media duration: 下限でクランプされる",
  resolveObsFireDurationMs(1, 5000),
  500,
);
// ⚠ fallback 自体が壊れていても有限値へ落ちる（2 段構えであることの固定）。
eq(
  "media duration: fallback も壊れていたら既定の 5 秒",
  resolveObsFireDurationMs(null, Number.NaN),
  5000,
);
eq(
  "media duration: fallback も上限を超えていたらクランプ",
  resolveObsFireDurationMs(null, 999999),
  15000,
);

// --- 064c: 一覧の結果に「取れたのか」を載せる ------------------------------------------------
//
// ⚠⚠ **064a は失敗も成功も空配列で返していた。** その結果 main 窓では
//   「**OBS へ繋がらなかった**」と「**繋がったが鳴らせるソースが 0 件**」が区別できず、
//   OBS が起動していないだけのユーザーへ「OBS のシーンにソースを追加してください」という
//   **間違った対処**を案内していた（061a レビュー Q-1 と同じ失敗モードの 3 度目）。
// ⚠ **`onState("failed", …)` では代替できない**——あちらは comments/pinned/stage と共有の
//   状態通知で、どの操作が失敗したのか受け手が判別できない（061e レビュー Q-5 の限界）。
//
// ⚠ ここで検証できるのは **`GetInputList` が返った後**（`toObsSourceListResult`）だけである。
//   実接続の失敗経路（`ok:false`）は実 OBS が要るので**実機確認で見る**。

// ⚠⚠ **これが 064c の核心**——絞り込んだ結果が 0 件でも「取れた」は真である。
eq(
  "source list: 0 件でも ok:true（＝「OBS に繋がらない」と混ぜない）",
  toObsSourceListResult([]),
  { ok: true, sources: [] },
);
eq(
  "source list: 許可種別だけを名前と種別で返す",
  toObsSourceListResult([
    { inputName: "花火", inputKind: "ffmpeg_source" },
    { inputName: "拍手", inputKind: "image_source" },
  ]),
  {
    ok: true,
    sources: [
      { name: "花火", kind: "ffmpeg_source" },
      { name: "拍手", kind: "image_source" },
    ],
  },
);
// ⚠⚠ **allow-list 外は一覧にも出さない**＝ユーザーが選べるのは鳴らせる種別だけ（064a の判断）。
//   ⚠ `browser_source` を足すには頭出しが別 API になるので、§3 の再評価が要る。
eq(
  "source list: browser_source は落とす（頭出しの手段が別 API）",
  toObsSourceListResult([{ inputName: "html", inputKind: "browser_source" }]),
  { ok: true, sources: [] },
);
eq(
  "source list: 未知の種別は落とす",
  toObsSourceListResult([{ inputName: "音", inputKind: "wasapi_output_capture" }]),
  { ok: true, sources: [] },
);
// ⚠ 名前の入口検査（`isAllowedObsSourceName`）は一覧側にも効く——ここで通した名前が
//   そのまま main 窓の `<select>` に並び、発火要求として戻ってくるため。
eq(
  "source list: 名前が不正な入力は落とす（制御文字）",
  toObsSourceListResult([{ inputName: "a\nb", inputKind: "ffmpeg_source" }]),
  { ok: true, sources: [] },
);
eq(
  "source list: 名前は trim して返す（発火要求と同じ形にする）",
  toObsSourceListResult([{ inputName: "  花火  ", inputKind: "ffmpeg_source" }]),
  { ok: true, sources: [{ name: "花火", kind: "ffmpeg_source" }] },
);
// ⚠ `GetInputList` の要素が想定外でも落ちない（外部由来の形を信用しない・§9 の作法）。
eq(
  "source list: 壊れた要素は落とす（null / 非オブジェクト）",
  toObsSourceListResult([null, 42, "x", { inputName: "花火", inputKind: "ffmpeg_source" }]),
  { ok: true, sources: [{ name: "花火", kind: "ffmpeg_source" }] },
);

process.stderr.write(
  failures === 0 ? "\nOBS-CLIENT PASS\n" : `\nOBS-CLIENT FAIL (${failures})\n`,
);
process.exit(failures === 0 ? 0 : 1);
