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
  createThemeImporter,
  assertResolvesToPublicAddress,
  THEME_IMPORT_MAX_BYTES,
} from "../dist/src/theme-import.js";

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
}

process.stderr.write(
  failures === 0 ? "\nTHEME-IMPORT PASS\n" : `\nTHEME-IMPORT FAIL (${failures})\n`,
);
process.exit(failures === 0 ? 0 : 1);
