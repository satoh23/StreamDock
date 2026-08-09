// 060c: 外部 `@import` 取得（スナップショット）の取得本体の検証。
//
// ⚠⚠ **URL の形のガード（`assertAllowedThemeImportUrl`）は `test-host-guard.mjs` の担当**で、ここでは
// 検証しない。理由＝テスト用のローカルサーバは必ず `127.0.0.1` に立つので、ガードを通したままでは
// 取得本体を 1 行も動かせない。だから取得は「ガード / DNS 検査 / 取得本体」の 3 つに割ってあり、
// ここは**取得本体（`runThemeImportFetch`）だけ**を直接叩く。
// ⚠ この分割を潰す（ガードを取得本体の中へ埋め戻す）と、このファイルは丸ごと動かなくなる。
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runThemeImportFetch,
  runThemeFontFetch,
  createThemeImporter,
  createThemeFontFetcher,
  assertResolvesToPublicAddress,
  THEME_IMPORT_MAX_BYTES,
  THEME_FONT_MAX_BYTES,
  // 060h security-review S-8: レート枠（とくに**バイト側の天井**）を直接叩くため。
  __themeImportInternals,
} from "../dist/src/theme-import.js";
// 060h コミット 2: `index.ts` から切り出した「制御フレーム 1 件の処理」。
// ⚠⚠ **060c ではここがテスト不能でミューテーションが生存していた**（`index.ts` は top-level で
// `main()` を呼ぶため import できない）。切り出したのはこの 3 件を殺せるようにするため。
import {
  handleThemeImportFrame,
  THEME_IMPORT_FETCH_FRAME,
  THEME_IMPORT_RESULT_FRAME,
  THEME_FONT_FETCH_FRAME,
  THEME_FONT_RESULT_FRAME,
} from "../dist/src/theme-import-frame.js";

let failures = 0;
const check = (label, actual, expected) => {
  const pass = actual === expected;
  if (!pass) failures++;
  process.stderr.write(
    `${pass ? "PASS" : "FAIL"} ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})\n`,
  );
};

/** ローカル HTTP サーバを 1 本立て、`handler` で応答する。戻り値は base URL と停止関数。 */
async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** 取得本体をローカルサーバに向けて直接叩く（ガードは通さない＝上の注記の理由）。 */
const fetchDirect = (url, init) => fetch(url, init);

// --- 正常系 -------------------------------------------------------------------------------------

await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    res.end(".sd-comment{color:red}");
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 1024, {
      fetchImpl: fetchDirect,
    });
    check("text/css is fetched", r.ok, true);
    check("body round-trips", r.ok ? r.css : null, ".sd-comment{color:red}");
  },
);

// --- Content-Type ------------------------------------------------------------------------------

await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>not css</html>");
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 1024, {
      fetchImpl: fetchDirect,
    });
    check("text/html is refused", r.ok === false && r.reason, "type");
  },
);

await withServer(
  (_req, res) => {
    // 前方一致の抜けを作っていないこと（`text/csshack` を通さない）。
    res.writeHead(200, { "content-type": "text/csshack" });
    res.end("x");
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 1024, {
      fetchImpl: fetchDirect,
    });
    check("text/csshack is refused (no prefix match)", r.ok === false && r.reason, "type");
  },
);

// --- リダイレクト -------------------------------------------------------------------------------
// ⚠⚠ 追うとガードをリダイレクト先で迂回できるので、必ず失敗にする。

// ⚠ **ミューテーションの読み方（実測 2026-08-09）**: リダイレクト禁止は **2 層**ある——
//   ①`redirect: "error"`（fetch が reject する） ②`response.redirected` / 3xx の明示検査。
//   **片方ずつ外す変異は生存する**（もう一方が受け止めるため）が、**両方外すと KILLED**。
//   ＝ ここで守られているのは「リダイレクトが**成功した取得にならない**」という不変条件であって、
//   特定の 1 行ではない。片方の生存を「テストが弱い」と誤読しないこと。
// ⚠⚠ **リダイレクト先を「追えば成功する」ものにするのが要点。**
//   到達できない外部ホスト（`https://evil.example/…`）へ飛ばすと、`follow` にしても結局
//   接続失敗で `ok:false` になり、**`redirect:"error"` を外す変異が生き残る**（実測で生存した）。
//   実際のリスクは「リダイレクト先でガードを迂回して**取得に成功する**」ことなので、
//   追った場合に**正しい CSS が返る**構成にして `ok` の値で殺せるようにする。
await withServer(
  (req, res) => {
    if (req.url === "/after-redirect.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(".redirected{color:red}");
      return;
    }
    res.writeHead(302, { location: "/after-redirect.css" });
    res.end();
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 1024, {
      fetchImpl: fetchDirect,
    });
    check("302 is not followed (following it would succeed)", r.ok, false);
    check(
      "the redirected body never reaches the caller",
      r.ok ? r.css : "(none)",
      "(none)",
    );
  },
);

// --- サイズ上限 ---------------------------------------------------------------------------------
// ⚠⚠ **`Content-Length` を判定に使わないこと**が要件。実際の抜け道は「小さく申告する」ではなく
// **`Content-Length` を一切付けない（chunked）**形である——実測で分かったこと:
//   - 過少申告（`Content-Length: 10` で 1MB 流す）は、undici が**宣言長で読み止める**ので
//     クライアントには 10 バイトしか届かない＝そもそも上限を超えない。
//   - 一方 chunked には宣言長が無いので、`Content-Length` を見て判断する実装は**無制限に読む**。
// したがって「読みながら数えて打ち切る」が守っているのは下のケースである。

await withServer(
  (_req, res) => {
    // ⚠ Content-Length を付けない＝ chunked。宣言長が無いので事前検査では止められない。
    res.writeHead(200, { "content-type": "text/css" });
    for (let i = 0; i < 64; i++) res.write("a".repeat(16 * 1024));
    res.end();
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 4096, {
      fetchImpl: fetchDirect,
    });
    check(
      "a chunked body with no Content-Length is still cut off at the cap",
      r.ok === false && r.reason,
      "size",
    );
  },
);

await withServer(
  (_req, res) => {
    // 過少申告。undici が 10 バイトで読み止めるので成功する（＝これは脆弱性ではない）。
    // ここで固定したいのは「**宣言長を信じて全部読む実装になっていない**」ことなので、
    // 受け取ったバイト数が宣言長どおりであることを見る。
    res.writeHead(200, { "content-type": "text/css", "content-length": "10" });
    res.end("0123456789" + "a".repeat(1024 * 1024));
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 4096, {
      fetchImpl: fetchDirect,
    });
    check("an understated Content-Length yields only the declared bytes", r.ok ? r.css : null, "0123456789");
  },
);

// 上限が**引数で動く**こと（定数へ戻す変異で落ちる）。
await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "text/css" });
    res.end("a".repeat(5000));
  },
  async (base) => {
    const small = await runThemeImportFetch(`${base}/a.css`, 1000, {
      fetchImpl: fetchDirect,
    });
    const large = await runThemeImportFetch(`${base}/a.css`, 10_000, {
      fetchImpl: fetchDirect,
    });
    check("5000 bytes exceeds a 1000-byte budget", small.ok === false && small.reason, "size");
    check("5000 bytes fits a 10000-byte budget", large.ok, true);
  },
);

// 天井（256KB）を超える maxBytes を渡してもクランプされること。
await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "text/css" });
    res.end("a".repeat(THEME_IMPORT_MAX_BYTES + 1024));
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, Number.MAX_SAFE_INTEGER, {
      fetchImpl: fetchDirect,
    });
    check(
      "maxBytes is clamped to the 256KB ceiling",
      r.ok === false && r.reason,
      "size",
    );
  },
);

// --- タイムアウト -------------------------------------------------------------------------------

await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "text/css" });
    // 応答を返さずぶら下げる。
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 1024, {
      fetchImpl: fetchDirect,
      timeoutMs: 150,
    });
    check("a hanging response times out", r.ok === false && r.reason, "timeout");
  },
);

// --- HTTP エラー --------------------------------------------------------------------------------

await withServer(
  (_req, res) => {
    res.writeHead(404, { "content-type": "text/css" });
    res.end("");
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 1024, {
      fetchImpl: fetchDirect,
    });
    check("404 is a failure", r.ok === false && r.reason, "network");
  },
);

// --- 送信データがゼロであること -------------------------------------------------------------------
// ⚠ ユーザーの識別子になるものを 1 つも送らない（§9）。

await withServer(
  (req, res) => {
    const leaked = ["cookie", "referer", "authorization"].filter(
      (h) => req.headers[h] !== undefined,
    );
    res.writeHead(200, { "content-type": "text/css" });
    res.end(`/*${req.method}|${leaked.join(",")}*/`);
  },
  async (base) => {
    const r = await runThemeImportFetch(`${base}/a.css`, 1024, {
      fetchImpl: fetchDirect,
    });
    check("method is GET and no identifying headers are sent", r.ok ? r.css : null, "/*GET|*/");
  },
);

// --- DNS 事前検査 -------------------------------------------------------------------------------
// ⚠⚠ ホスト名ベースの拒否では「社内ドメインが内部 IP を指す」形を塞げないので、解決先も見る。

const resolvesTo = (entries) => async () => entries;

let rebindBlocked = false;
try {
  await assertResolvesToPublicAddress(
    "internal.corp.example",
    resolvesTo([{ address: "10.0.0.5", family: 4 }]),
  );
} catch {
  rebindBlocked = true;
}
check("a name resolving to a private address is refused", rebindBlocked, true);

let mixedBlocked = false;
try {
  await assertResolvesToPublicAddress(
    "mixed.example",
    resolvesTo([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
  );
} catch {
  mixedBlocked = true;
}
check("one internal address among many is enough to refuse", mixedBlocked, true);

let publicAllowed = true;
try {
  await assertResolvesToPublicAddress(
    "example.com",
    resolvesTo([{ address: "93.184.216.34", family: 4 }]),
  );
} catch {
  publicAllowed = false;
}
check("a public-only resolution is allowed", publicAllowed, true);

let emptyBlocked = false;
try {
  await assertResolvesToPublicAddress("nx.example", resolvesTo([]));
} catch {
  emptyBlocked = true;
}
check("an empty resolution is refused (fail-closed)", emptyBlocked, true);

// --- レート制限 ---------------------------------------------------------------------------------
// ⚠ 失敗理由は `blocked`（URL の形・解決先が内部）と**別語彙 `rate`** にしてある。
//   まとめると UI が「アドレスが変わっている」と案内してしまい、ユーザーが取る行動が変わる
//   （前者は URL を直す／後者は少し待つ）。security-review 060c S-7。

{
  let calls = 0;
  const spy = async () => {
    calls++;
    return new Response("x", { headers: { "content-type": "text/css" } });
  };
  // ⚠ `assertResolvesToPublicAddress` を通すので実 DNS を引かない形にはできない。ここで見たいのは
  //   「9 件目が rate になること」だけなので、**ガードで確実に落ちる URL** を使って回数だけ数える。
  //   ＝ 1..8 は `blocked`（形）で返り、9 件目以降が `rate` になる（順序が入れ替わると落ちる）。
  const limited = createThemeImporter({ fetchImpl: spy });
  const reasons = [];
  for (let i = 0; i < 10; i++) {
    const r = await limited("https://127.0.0.1/a.css", 1024, 1_000_000 + i);
    reasons.push(r.ok === false ? r.reason : "ok");
  }
  check("the 8th attempt within the window is still a shape rejection", reasons[7], "blocked");
  check("the 9th attempt within the window is rate limited", reasons[8], "rate");
  check("a rate-limited attempt never reaches the fetcher", calls, 0);

  // 窓が過ぎれば再び受け付ける（＝恒久的に締め出さない）。
  const after = await limited("https://127.0.0.1/a.css", 1024, 1_000_000 + 60_001);
  check("the window slides", after.ok === false && after.reason, "blocked");
}

// --- 060h: フォント実体の取得（本リポジトリ初のバイナリ egress）----------------------------------
//
// ⚠⚠ **`runThemeImportFetch` と共通化していない**のは意図（あちらは `TextDecoder` を通す）。
// ここでは「①MIME allow-list が厳密一致であること ②`octet-stream` を通さないこと
// ③デコードせず base64 化していること ④chunked でもサイズ上限で打ち切ること ⑤タイムアウト
// ⑥リダイレクト」を固定する。

/** 生バイトを 1 本返すローカルサーバを立ててフォント取得を叩く。 */
const fontDirect = (url, init) => fetch(url, init);

// ① 正常系: 生バイトが base64 で往復し、`mime` は**サーバではなく allow-list を通った値**が返る。
await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "font/woff2" });
    // ⚠ **UTF-8 として不正なバイト列**を返す（woff2 は当然そうなる）。`TextDecoder` を通していたら
    //   U+FFFD へ置換されて往復に失敗する＝この 1 本が「デコードしていないこと」の証明になる。
    res.end(Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0xfe, 0x80]));
  },
  async (base) => {
    const r = await runThemeFontFetch(`${base}/a.woff2`, 1024, { fetchImpl: fontDirect });
    check("a woff2 is fetched", r.ok, true);
    check("the mime comes from the allow-list", r.ok ? r.mime : null, "font/woff2");
    check(
      "the bytes round-trip without decoding (no U+FFFD replacement)",
      r.ok ? Buffer.from(r.base64, "base64").toString("hex") : null,
      "774f463200fffe80",
    );
  },
);

// ② Content-Type: allow-list の厳密一致だけ。⚠⚠ `application/octet-stream` は**通さない**。
for (const [type, label] of [
  ["application/octet-stream", "octet-stream is refused (would void the mime check)"],
  ["text/css", "text/css is not a font"],
  ["text/html", "text/html is refused"],
  ["font/woff2x", "no prefix match"],
  ["", "a missing content-type is refused"],
]) {
  await withServer(
    (_req, res) => {
      res.writeHead(200, type === "" ? {} : { "content-type": type });
      res.end(Buffer.from([0x00, 0x01]));
    },
    async (base) => {
      const r = await runThemeFontFetch(`${base}/a.woff2`, 1024, { fetchImpl: fontDirect });
      check(`font ${label}`, r.ok === false && r.reason, "type");
    },
  );
}

// ②' 綴りの揺れは通す（実サーバに存在する形）。
for (const type of ["font/woff", "application/font-woff2", "application/x-font-woff"]) {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": `${type}; charset=binary` });
      res.end(Buffer.from([0x00]));
    },
    async (base) => {
      const r = await runThemeFontFetch(`${base}/a.woff`, 1024, { fetchImpl: fontDirect });
      check(`font ${type} is accepted`, r.ok, true);
    },
  );
}

// ④ サイズ上限: **`Content-Length` 無し（chunked）でも**読みながら打ち切る。
await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "font/woff2" }); // ⚠ Content-Length を出さない＝ chunked
    res.write(Buffer.alloc(64));
    res.write(Buffer.alloc(64));
    res.end(Buffer.alloc(64));
  },
  async (base) => {
    const r = await runThemeFontFetch(`${base}/a.woff2`, 100, { fetchImpl: fontDirect });
    check("font size limit stops a chunked response", r.ok === false && r.reason, "size");
  },
);

// ④' 天井（512KiB）を超える `maxBytes` を渡してもクランプされる。
await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "font/woff2" });
    res.end(Buffer.alloc(THEME_FONT_MAX_BYTES + 1));
  },
  async (base) => {
    const r = await runThemeFontFetch(`${base}/a.woff2`, Number.MAX_SAFE_INTEGER, {
      fetchImpl: fontDirect,
    });
    check("font maxBytes is clamped to the ceiling", r.ok === false && r.reason, "size");
  },
);

// ⑤ タイムアウト。
await withServer(
  (_req, res) => {
    res.writeHead(200, { "content-type": "font/woff2" });
    // 応答を完了させない。
  },
  async (base) => {
    const r = await runThemeFontFetch(`${base}/a.woff2`, 1024, {
      fetchImpl: fontDirect,
      timeoutMs: 50,
    });
    check("font timeout", r.ok === false && r.reason, "timeout");
  },
);

// ⑥ リダイレクトは追わない（ガードをリダイレクト先で迂回されないため）。
await withServer(
  (req, res) => {
    if (req.url?.startsWith("/a.woff2")) {
      res.writeHead(302, { location: "/b.woff2" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "font/woff2" });
    res.end(Buffer.alloc(4));
  },
  async (base) => {
    const r = await runThemeFontFetch(`${base}/a.woff2`, 1024, { fetchImpl: fontDirect });
    check("font redirect is refused", r.ok === false, true);
  },
);

// --- 060h: フォント枠のレート制限（CSS 枠とは**別枠**）------------------------------------------
//
// ⚠⚠ 枠を分けても濫用防止が薄くならない根拠は「①専用ガード＋MIME allow-list を通った宛先しか叩けない
// ②**バイト側の天井を新設した** ③チケットと毎回の同意はそのまま」。②をここで固定する。

{
  // ⚠ ガードで確実に落ちる URL を使い、**回数だけ**数える（CSS 枠のテストと同じ作法）。
  const fetchFont = createThemeFontFetcher({ fetchImpl: async () => new Response("x") });
  const reasons = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetchFont("https://127.0.0.1/a.woff2", 1024, 2_000_000 + i);
    reasons.push(r.ok === false ? r.reason : "ok");
  }
  // CSS 枠は 8 件で `rate` になるが、フォント枠は 300 件まで通る（＝枠が独立している）。
  check("the font quota is separate from the css quota", reasons[8], "blocked");
  check("the font quota is still a shape rejection at 12", reasons[11], "blocked");
}

{
  // CSS 枠のほうは 060c のまま 8 件（フォント枠を足しても緩んでいないこと）。
  const fetchCss = createThemeImporter({ fetchImpl: async () => new Response("x") });
  const reasons = [];
  for (let i = 0; i < 10; i++) {
    const r = await fetchCss("https://127.0.0.1/a.css", 1024, 3_000_000 + i);
    reasons.push(r.ok === false ? r.reason : "ok");
  }
  check("the css quota is unchanged (8 per window)", reasons[8], "rate");
}

{
  // ⚠⚠ **060h security-review S-8**: フォント枠の**バイト側の天井**を直接固定する。
  //   ここが無かったので「バイト枠をコンストラクタから外す」変異が**生存していた**（実測）——
  //   `docs/security.md` §1 が枠分割を正当化する 3 根拠の 1 つが、1 行もテストされていなかった。
  //   ⚠ `createThemeFontFetcher` 経由では**成功する取得**が要る＝実ネットワークになるので、
  //     `RateLimiter` を直接叩く（`__themeImportInternals`）。
  const { RateLimiter, FONT_RATE_MAX_BYTES_IN_WINDOW, FONT_RATE_MAX_IN_WINDOW } =
    __themeImportInternals;

  const bytes = new RateLimiter(FONT_RATE_MAX_IN_WINDOW, FONT_RATE_MAX_BYTES_IN_WINDOW);
  let started = 0;
  // 1 本 512KiB を積んでいくと、16MiB 到達後は**件数がまだ余っていても**始まらない。
  for (let i = 0; i < 40; i++) {
    if (!bytes.tryStart(4_000_000 + i)) break;
    started++;
    bytes.record(THEME_FONT_MAX_BYTES);
    bytes.finish();
  }
  // ⚠ 判定は「**窓の中で既に上限へ達していたら始めない**」なので、ぴったり割り切れる積み方だと
  //   ちょうど 32 本で止まる（1 本ぶんの超過を許す設計＝取得中の 1 本は途中で切らない）。
  check(
    "the font byte quota stops the loop well before the count quota",
    started,
    FONT_RATE_MAX_BYTES_IN_WINDOW / THEME_FONT_MAX_BYTES,
  );
  check("the byte quota is not the count quota", started < FONT_RATE_MAX_IN_WINDOW, true);

  // ⚠ 件数だけの枠（CSS 側の形）はバイトをいくら積んでも止まらない＝上の停止はバイト枠が効いた証拠。
  const countOnly = new RateLimiter(FONT_RATE_MAX_IN_WINDOW);
  let countStarted = 0;
  for (let i = 0; i < 40; i++) {
    if (!countOnly.tryStart(5_000_000 + i)) break;
    countStarted++;
    countOnly.record(THEME_FONT_MAX_BYTES);
    countOnly.finish();
  }
  check("a count-only limiter never stops on bytes", countStarted, 40);

  // ⚠ 窓が滑ればバイト枠も回復する（永久に止まらない）。
  check(
    "the byte window slides",
    bytes.tryStart(4_000_000 + 60_001 + 40),
    true,
  );

  // ⚠⚠ **上の 3 本は `RateLimiter` の振る舞いしか見ていない**——`createThemeFontFetcher` が
  //   バイト枠を**実際に渡しているか**は別問題で、そこを外す変異はこれだけでは生存する（実測）。
  //   成功する取得が要る＝実ネットワークになるので、**配線はソースで固定する**
  //   （`fetchImpl` の静的検査と同じ作法。下の「静的検査」節と同型）。
  const themeImportSrc = readFileSync(
    fileURLToPath(new URL("../src/theme-import.ts", import.meta.url)),
    "utf8",
  );
  const fontFactory = themeImportSrc.slice(
    themeImportSrc.indexOf("export function createThemeFontFetcher"),
  );
  check(
    "createThemeFontFetcher actually wires the byte quota in",
    /new RateLimiter\(\s*FONT_RATE_MAX_IN_WINDOW\s*,\s*FONT_RATE_MAX_BYTES_IN_WINDOW\s*,?\s*\)/.test(
      fontFactory,
    ),
    true,
  );
  // ⚠ 成功したぶんを実際に計上していること（`record()` を消す変異も上の 3 本では生存する）。
  check(
    "createThemeFontFetcher records the bytes it actually received",
    /limiter\.record\(/.test(fontFactory),
    true,
  );
}

{
  // ⚠⚠ **060h security-review S-8**: 「1 本 512KiB」という §1 の数字そのものを固定する。
  //   `parseControlFrame` の受理上限もこの定数から導くので、ここが動くと**フレームの受理範囲まで動く**。
  //   実測では 64MiB へ書き換える変異が全スイート緑で生存していた。
  check("the per-font ceiling is 512KiB", THEME_FONT_MAX_BYTES, 512 * 1024);
  check("the per-css ceiling is 256KiB", THEME_IMPORT_MAX_BYTES, 256 * 1024);
}

{
  // ⚠⚠ **060h security-review S-8**: 「送信データはゼロ」（§1/§9）を固定する。
  //   Cookie / Referer / 認証 / **カスタムヘッダ**を 1 つも送らない、が §9 の中核なのに
  //   テストが無く、`X-StreamDock: 1` を足す変異が生存していた（実測）。
  //   ⚠ ここが緩むと**ユーザーの識別子になりうる値が実際に外へ出る**。
  const seen = [];
  const spy = async (_url, init) => {
    seen.push(init);
    return new Response(Buffer.from([0x00]), {
      status: 200,
      headers: { "content-type": "font/woff2" },
    });
  };
  await runThemeFontFetch("https://f.example/a.woff2", 1024, { fetchImpl: spy });
  await runThemeImportFetch("https://f.example/a.css", 1024, {
    fetchImpl: async (_url, init) => {
      seen.push(init);
      return new Response("a{}", {
        status: 200,
        headers: { "content-type": "text/css" },
      });
    },
  });
  check("both fetches happened", seen.length, 2);
  for (const [i, init] of seen.entries()) {
    const label = i === 0 ? "font" : "css";
    check(`${label} request is a GET`, init.method, "GET");
    check(`${label} request does not follow redirects`, init.redirect, "error");
    check(`${label} request sends no referrer`, init.referrerPolicy, "no-referrer");
    check(`${label} request omits credentials`, init.credentials, "omit");
    check(`${label} request has no body`, init.body === undefined, true);
    // ⚠⚠ **ヘッダは 1 つも足さない**（`Accept` すら送らない＝識別子になりうるものをゼロにする）。
    check(
      `${label} request adds no custom header`,
      Object.keys(init.headers ?? {}).length,
      0,
    );
  }
}

// --- 060h コミット 2: 制御フレーム 1 件の処理 ----------------------------------------------------
//
// ⚠⚠ **loopback WS は未認証**なので、チケット照合が「同意ダイアログを経ない取得」を塞ぐ唯一の壁である。
// 060c 時点ではこの分岐が `index.ts` にあり **import できない＝ミューテーションでも生存**していた
// （担保は実機確認のみ）。切り出したので、ここで 3 つの不変条件を殺せる形に固定する:
//   ①チケット不一致は**黙って捨てる（返信もしない）** ②未受領（null）も捨てる（fail-closed）
//   ③返信は**要求元 1 本への unicast**（`send` が 1 回だけ・1 件だけ）

const FRAME_TICKET = "0123456789abcdef0123456789abcdef";
const themeFrame = (over = {}) => ({
  type: THEME_IMPORT_FETCH_FRAME,
  ticket: FRAME_TICKET,
  requestId: 7,
  url: "https://example.com/a.css",
  maxBytes: 1024,
  ...over,
});

/** `send` / `fetchThemeCss` / `fetchThemeFont` の呼び出しを記録するだけの依存一式。 */
function frameSpies(
  result = { ok: true, css: ".sd-comment{color:red}" },
  fontResult = { ok: true, mime: "font/woff2", base64: "d09GMg==" },
) {
  const sent = [];
  const fetched = [];
  const fetchedFonts = [];
  return {
    sent,
    fetched,
    fetchedFonts,
    send: (message) => sent.push(message),
    fetchThemeCss: async (url, maxBytes) => {
      fetched.push({ url, maxBytes });
      return result;
    },
    fetchThemeFont: async (url, maxBytes) => {
      fetchedFonts.push({ url, maxBytes });
      return fontResult;
    },
  };
}

// ① チケット不一致（同じ長さ・違う中身）＝ 黙って捨てる。
{
  const spy = frameSpies();
  await handleThemeImportFrame({
    frame: themeFrame({ ticket: "f".repeat(32) }),
    ticket: FRAME_TICKET,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("a mismatched ticket never replies", spy.sent.length, 0);
  check("a mismatched ticket never reaches the fetcher", spy.fetched.length, 0);
}

// ①' 長さが違うチケット＝ `timingSafeEqual` を throw させずに捨てる。
{
  const spy = frameSpies();
  let threw = false;
  try {
    await handleThemeImportFrame({
      frame: themeFrame({ ticket: "short" }),
      ticket: FRAME_TICKET,
      send: spy.send,
      fetchThemeCss: spy.fetchThemeCss,
    });
  } catch {
    threw = true;
  }
  check("a differently-sized ticket does not throw", threw, false);
  check("a differently-sized ticket never replies", spy.sent.length, 0);
  check("a differently-sized ticket never fetches", spy.fetched.length, 0);
}

// ② チケット未受領（Rust から stdin で届く前）＝ fail-closed。
{
  const spy = frameSpies();
  await handleThemeImportFrame({
    frame: themeFrame(),
    ticket: null,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("an unissued ticket never replies (fail-closed)", spy.sent.length, 0);
  check("an unissued ticket never fetches (fail-closed)", spy.fetched.length, 0);
}

// ③ 一致＝ フレームの url/maxBytes を**そのまま**渡し、要求元へ 1 件だけ返す。
{
  const spy = frameSpies();
  await handleThemeImportFrame({
    frame: themeFrame(),
    ticket: FRAME_TICKET,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("a matching ticket fetches exactly once", spy.fetched.length, 1);
  // ⚠ **URL を組み立て直さない**（同意ダイアログが表示した文字列と同一であることの担保）。
  check("the frame url is passed through verbatim", spy.fetched[0]?.url, "https://example.com/a.css");
  check("the frame maxBytes is passed through verbatim", spy.fetched[0]?.maxBytes, 1024);
  check("a matching ticket replies exactly once (unicast)", spy.sent.length, 1);
  check("the reply type is the result frame", spy.sent[0]?.type, THEME_IMPORT_RESULT_FRAME);
  check("the reply echoes the requestId", spy.sent[0]?.payload?.requestId, 7);
  check("the reply carries the css", spy.sent[0]?.payload?.css, ".sd-comment{color:red}");
}

// ④ 取得失敗＝ 固定語彙だけを返し、URL も本文も載せない（§9）。
{
  const spy = frameSpies({ ok: false, reason: "blocked" });
  await handleThemeImportFrame({
    frame: themeFrame(),
    ticket: FRAME_TICKET,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("a failure replies once", spy.sent.length, 1);
  check("a failure carries the fixed vocabulary", spy.sent[0]?.payload?.reason, "blocked");
  check("a failure carries no css", spy.sent[0]?.payload?.css, undefined);
  // ⚠ 失敗のペイロードに URL が混ざっていないこと（§9）。
  check(
    "a failure payload never contains the url",
    JSON.stringify(spy.sent[0]).includes("example.com"),
    false,
  );
}

// --- 060h: **フォントフレームでも**同じ 3 つの不変条件が効くこと -----------------------------------
//
// ⚠⚠ **新しい制御フレームを足したときに検証を書き忘れる**のが最も現実的な失敗モードなので、
// 「チケット照合は種別で分岐する**前**にある」ことを、フォント側でも同じケースで固定する。

const fontFrame = (over = {}) => ({
  type: THEME_FONT_FETCH_FRAME,
  ticket: FRAME_TICKET,
  requestId: 11,
  url: "https://fonts.gstatic.com/s/x/y.woff2",
  maxBytes: 4096,
  ...over,
});

// ① チケット不一致（フォント側）＝ 黙って捨てる。
{
  const spy = frameSpies();
  await handleThemeImportFrame({
    frame: fontFrame({ ticket: "f".repeat(32) }),
    ticket: FRAME_TICKET,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("font frame: a mismatched ticket never replies", spy.sent.length, 0);
  check("font frame: a mismatched ticket never fetches", spy.fetchedFonts.length, 0);
}

// ② チケット未受領（フォント側）＝ fail-closed。
{
  const spy = frameSpies();
  await handleThemeImportFrame({
    frame: fontFrame(),
    ticket: null,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("font frame: an unissued ticket never replies", spy.sent.length, 0);
  check("font frame: an unissued ticket never fetches", spy.fetchedFonts.length, 0);
}

// ③ 一致＝ フォント取得だけを 1 回呼び、要求元へ 1 件だけ返す。
{
  const spy = frameSpies();
  await handleThemeImportFrame({
    frame: fontFrame(),
    ticket: FRAME_TICKET,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("font frame: fetches exactly once", spy.fetchedFonts.length, 1);
  // ⚠ **CSS 取得の口は呼ばない**（種別で口が混ざっていないこと＝レート枠も混ざらない）。
  check("font frame: never uses the css fetcher", spy.fetched.length, 0);
  check("font frame: the url is passed through verbatim", spy.fetchedFonts[0]?.url, "https://fonts.gstatic.com/s/x/y.woff2");
  check("font frame: replies exactly once (unicast)", spy.sent.length, 1);
  check("font frame: the reply type is the font result frame", spy.sent[0]?.type, THEME_FONT_RESULT_FRAME);
  check("font frame: the reply echoes the requestId", spy.sent[0]?.payload?.requestId, 11);
  check("font frame: the mime comes from the sidecar", spy.sent[0]?.payload?.mime, "font/woff2");
  check("font frame: the base64 is carried", spy.sent[0]?.payload?.base64, "d09GMg==");
}

// ③' CSS フレームはフォント取得の口を呼ばない（逆向きも固定する）。
{
  const spy = frameSpies();
  await handleThemeImportFrame({
    frame: themeFrame(),
    ticket: FRAME_TICKET,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("css frame: never uses the font fetcher", spy.fetchedFonts.length, 0);
}

// ④ 取得失敗（フォント側）＝ 固定語彙だけ・URL も本文も載せない（§9）。
{
  const spy = frameSpies(undefined, { ok: false, reason: "type" });
  await handleThemeImportFrame({
    frame: fontFrame(),
    ticket: FRAME_TICKET,
    send: spy.send,
    fetchThemeCss: spy.fetchThemeCss,
    fetchThemeFont: spy.fetchThemeFont,
  });
  check("font frame: a failure carries the fixed vocabulary", spy.sent[0]?.payload?.reason, "type");
  check("font frame: a failure carries no base64", spy.sent[0]?.payload?.base64, undefined);
  check(
    "font frame: a failure payload never contains the url",
    JSON.stringify(spy.sent[0]).includes("gstatic.com"),
    false,
  );
}

// --- ⚠⚠ 静的検査: テスト用の差し替え口が本番コードへ漏れていないこと -----------------------------
// security-review 060c S-6。`fetchImpl` はガードを迂回できる唯一の口なので、
// **本番の `src/` から渡す形が 1 つも無いこと**を機械で固定する（3 分割の前提そのもの）。

{
  const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  const offenders = walk(srcDir)
    .filter((p) => p.endsWith(".ts") && !p.endsWith("theme-import.ts"))
    .filter((p) => /fetchImpl\s*:/.test(readFileSync(p, "utf8")))
    .map((p) => p.slice(srcDir.length));
  check(
    `no production module outside theme-import.ts passes fetchImpl (found: ${offenders.join(",") || "none"})`,
    offenders.length,
    0,
  );

  const indexSrc = readFileSync(join(srcDir, "index.ts"), "utf8");
  check(
    "index.ts calls createThemeImporter() with no deps (production uses the guarded fetch)",
    /createThemeImporter\(\s*\)/.test(indexSrc),
    true,
  );
  // 060h: フォント取得の入口も同じ規則（引数なしで作る＝必ずガード付きの `themeFontFetch` を通る）。
  check(
    "index.ts calls createThemeFontFetcher() with no deps",
    /createThemeFontFetcher\(\s*\)/.test(indexSrc),
    true,
  );
}

process.stderr.write(
  failures === 0 ? "\nTHEME-IMPORT PASS\n" : `\nTHEME-IMPORT FAIL (${failures})\n`,
);
process.exit(failures === 0 ? 0 : 1);
