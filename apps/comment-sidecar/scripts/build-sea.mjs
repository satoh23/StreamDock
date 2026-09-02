// 032c-b(stream-dock): Twitch sidecar を単一実行ファイル化するビルドスクリプト。
// パイプライン: tsc(emitDecoratorMetadata) → esbuild(単一 CJS) → Node SEA(postject) → codesign 再署名。
//   - decorator metadata は esbuild が出力しないため、必ず tsc で先に JS(+__metadata) を emit する。
//   - `ws` の optional native addon（bufferutil / utf-8-validate）は external にして pure-JS で動かす。
//   - 出力は apps/desktop/src-tauri/binaries/comment-sidecar-<target-triple>（gitignore・Tauri externalBin）。
// 使い方:
//   node scripts/build-sea.mjs               … フルビルド（SEA まで）
//   node scripts/build-sea.mjs --bundle-only … tsc + esbuild まで（SEA/署名なし・疎通確認用）
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE_ONLY = process.argv.includes("--bundle-only");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(scriptDir, "..");
const distDir = join(pkgDir, "dist");
const buildDir = join(pkgDir, "build");
const bundleFile = join(buildDir, "sidecar.cjs");

// Windows では `pnpm` の実体が `pnpm.cmd`（`.exe` 無し）で、シェル無し spawn だと ENOENT になる。
// Windows のときだけ shell 経由にして `.cmd` を解決する。引数は本スクリプト内の固定値のみ（外部入力を渡さない）
// ＝注入面なし。これはビルドツールの spawn であり、アプリ実行時に frontend から shell を叩く §4 とは別物。
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", cwd: pkgDir, shell: process.platform === "win32", ...opts });

// Tauri externalBin が要求する <name>-<target-triple>。mac の host triple を rustc から取得。
function hostTargetTriple() {
  try {
    const out = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.startsWith("host:"));
    if (line) return line.replace("host:", "").trim();
  } catch {
    /* rustc 不在 → arch から推定 */
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64"
      ? "aarch64-apple-darwin"
      : "x86_64-apple-darwin";
  }
  throw new Error(
    `[build-sea] cannot determine target triple for ${process.platform}/${process.arch}`,
  );
}

function step(label, fn) {
  process.stderr.write(`\n=== ${label} ===\n`);
  return fn();
}

// 099a: Windows の `node.exe` から Authenticode 署名を外す（postject 注入の前に呼ぶ）。
// signtool は Windows SDK 同梱で、CI の windows-latest には入っている。
// ⚠ `run()` は Windows で `shell: true` にしているが、signtool のパスは
//   `C:\Program Files (x86)\...` と**空白と括弧を含む**ためシェル経由だと壊れる。
//   ここは実体の `.exe` を直接叩けばよいので `execFileSync` を素で使う。
function removeWindowsSignature(binPath) {
  const kitsBin = join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Windows Kits",
    "10",
    "bin",
  );
  const signtool = existsSync(kitsBin)
    ? readdirSync(kitsBin)
        .sort()
        .reverse()
        .map((version) => join(kitsBin, version, "x64", "signtool.exe"))
        .find((candidate) => existsSync(candidate))
    : undefined;

  if (!signtool) {
    // ⚠ ここで止めない。署名を使わないビルド（SDK 無しのローカル環境）を塞がないため。
    //   署名が要る場面では、後段の署名側が同じ問題を**必ず**検出して落ちる（fail-closed はあちらが担う）。
    process.stderr.write(
      "[build-sea] ⚠ signtool.exe が見つからないため node.exe の署名を外せませんでした。\n" +
        "[build-sea]   このバイナリには無効な署名が残り、コード署名を有効にしたビルドでは失敗します。\n",
    );
    return;
  }

  try {
    execFileSync(signtool, ["remove", "/s", binPath], { stdio: "inherit" });
  } catch {
    // 署名が最初から無い node.exe（自前ビルド等）ではエラーになるが、それは問題ない。
    process.stderr.write("[build-sea] node.exe に外すべき署名はありませんでした。\n");
  }
}

// 0) 焼き込み必須の Client ID/Secret ガード（再発防止）。
// これらは下記 esbuild の define でビルド時にバイナリへ焼き込む（ランタイム env/dotenv 不使用）。
// env 無しでフルビルドすると空文字が焼き込まれ、正常だった ID を黙って消してしまう（実際に 035a 検証で発生）。
// 配布バイナリを生成するフルビルド時のみ、未設定を fail-fast で弾く。--bundle-only（オフライン疎通/DI 解決
// 確認・ネットワークを張らない）は Client ID 不要のため対象外。
if (!BUNDLE_ONLY) {
  const requiredBakedSecrets = [
    "TWITCH_CLIENT_ID",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
  ];
  const missing = requiredBakedSecrets.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    process.stderr.write(
      `\n[build-sea] 焼き込み必須の値が未設定です: ${missing.join(", ")}\n` +
        `  空のままビルドすると配布バイナリの Client ID が空になり、Twitch/YouTube 連携が動きません。\n` +
        `  値を渡して再実行してください:\n` +
        `    TWITCH_CLIENT_ID=<...> YOUTUBE_CLIENT_ID=<...> YOUTUBE_CLIENT_SECRET=<...> pnpm --filter ./apps/desktop build:sidecar\n\n`,
    );
    process.exit(1);
  }
}

// 1) tsc: decorator metadata 付きで ESM JS を dist へ emit。
step("tsc (emit dist with decorator metadata)", () => {
  rmSync(distDir, { recursive: true, force: true });
  run("pnpm", ["exec", "tsc"]);
});

// 2) esbuild: dist の JS を単一 CJS へ束ねる。@comment-dock/* は dist 側の実体へ alias。
await step("esbuild (bundle to single CJS)", async () => {
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  const d = (p) => join(distDir, p);
  const result = await build({
    entryPoints: [d("src/index.js")],
    outfile: bundleFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    // ws の optional native addon は含めない（pure-JS で動作）。
    external: ["bufferutil", "utf-8-validate"],
    // 032c-b: Twitch アプリ Client ID（public・非機密）をビルド時に焼き込む（ランタイム env/dotenv を使わない）。
    // 032c-d: YouTube（Google Desktop app）OAuth の Client ID/Secret も同様に焼き込む。Desktop app の secret は
    //   Google 上「機密扱いされない」（インストール型は抽出前提）が、抽出されても PKCE(S256)＋インストール型
    //   モデルで被害限定される（docs/security.md「コメントビューア方針」⑧）。ランタイム env/dotenv は使わない。
    // 例: TWITCH_CLIENT_ID=xxxx YOUTUBE_CLIENT_ID=yyyy YOUTUBE_CLIENT_SECRET=zzzz \
    //       pnpm --filter @stream-dock/comment-sidecar build:sea
    define: {
      __TWITCH_CLIENT_ID__: JSON.stringify(process.env.TWITCH_CLIENT_ID ?? ""),
      __YOUTUBE_CLIENT_ID__: JSON.stringify(process.env.YOUTUBE_CLIENT_ID ?? ""),
      __YOUTUBE_CLIENT_SECRET__: JSON.stringify(
        process.env.YOUTUBE_CLIENT_SECRET ?? "",
      ),
    },
    alias: {
      "@comment-dock/shared": d("vendor/shared/src/index.js"),
      "@comment-dock/comment-delivery": d("vendor/comment-delivery/src/lib.js"),
      "@comment-dock/auth": d("src/auth/index.js"),
      "@comment-dock/comment-fetcher": d("src/comment-fetcher/index.js"),
    },
    logLevel: "info",
    metafile: true,
  });
  writeFileSync(
    join(buildDir, "meta.json"),
    JSON.stringify(result.metafile, null, 2),
  );
});

// 2.5) 封じ込め検証: バンドルに distill で落としたはずの依存が混入していないこと（スパイク2）。
// ここに載せるのは「パッケージ名が十分ユニークで、substring 一致が誤検知しにくい」ものだけ。
// `open` / `zod` は短すぎて（"socket.open" / 変数名等に一致）substring 検査に向かないため、
// このアサートには**入れない**。それらの排除は「package.json の dependencies に無い＝解決不能」
// （import グラフに現れない）で担保しており、src/vendor の import グレップでも別途確認している。
// 032c-d: `googleapis`（npm パッケージ）も同様に**このアサートから外す**。YouTube 宛先 URL の
//   `oauth2.googleapis.com` / `www.googleapis.com`（正規の allow-list 宛先）に substring 一致して誤検知するため。
//   `googleapis` パッケージ自体は使わず（グローバル fetch を使う）、package.json の dependencies に無い＝
//   解決不能で担保する（node-fetch / open / @napi-rs/keyring も同じく package.json 非依存で排除）。
// 追加/削除する依存が増えたら、ユニークな名前のものはこの配列へ足すこと。
step("verify no forbidden deps in bundle (spike 2)", () => {
  const src = readFileSync(bundleFile, "utf8");
  const forbidden = [
    // 032c-d コミット2: @grpc/grpc-js・@grpc/proto-loader は YouTube streamList 用に再導入したため
    // forbidden から外した（純 JS・ネイティブアドオン無し・§10 に理由記載）。以下は引き続き混入禁止。
    "@napi-rs/keyring",
    "@hono/node-server",
    "dotenv", // ランタイム env ロード（宛先 override 経路を持ち込まない）
  ];
  const hits = forbidden.filter((name) => src.includes(name));
  if (hits.length > 0) {
    throw new Error(`[build-sea] forbidden deps leaked into bundle: ${hits.join(", ")}`);
  }
  process.stderr.write("no keyring/hono/dotenv in bundle ✓\n");
});

if (BUNDLE_ONLY) {
  process.stderr.write(`\n[build-sea] bundle-only done: ${bundleFile}\n`);
  process.exit(0);
}

// 3) Node SEA blob を生成。
const seaConfigPath = join(buildDir, "sea-config.json");
const blobPath = join(buildDir, "sidecar.blob");
step("node --experimental-sea-config (create blob)", () => {
  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: bundleFile,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    ),
  );
  run("node", ["--experimental-sea-config", seaConfigPath]);
});

// 4) node バイナリを複製し、5) 署名を外し、6) postject で blob 注入、7) 再署名。
const triple = hostTargetTriple();
const outDir = resolve(pkgDir, "..", "desktop", "src-tauri", "binaries");
// Windows の Tauri externalBin は `<name>-<triple>.exe` を要求するため .exe を付す（mac/Linux は拡張子なし）。
const outBin = join(outDir, `comment-sidecar-${triple}${process.platform === "win32" ? ".exe" : ""}`);
step(`postject inject → ${outBin}`, () => {
  mkdirSync(outDir, { recursive: true });
  const nodeBin = process.execPath;
  copyFileSync(nodeBin, outBin);
  const isMac = process.platform === "darwin";
  if (isMac) {
    // postject が署名を無効化するため、いったん署名を外す。
    run("codesign", ["--remove-signature", outBin]);
  } else if (process.platform === "win32") {
    // 099a: **Windows でも同じ理由で署名を外す**（長らく mac だけだった）。
    //   `node.exe` には Node.js 公式の Authenticode 署名が付いており、外さずに postject で
    //   データを注入すると **「証明書テーブルがファイル末尾にない」PE** が出来上がる。
    //   ⇒ ①その署名は**無効**（プロパティで「デジタル署名が無効」になりうる）
    //     ②後段のコード署名（099a）が `The certificate table isn't at the end of the file` で**拒否される**
    //   Node 公式の SEA 手順でも Windows は注入前に `signtool remove /s` する案内になっている。
    removeWindowsSignature(outBin);
  }
  const postjectArgs = [
    "postject",
    outBin,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (isMac) {
    postjectArgs.push("--macho-segment-name", "NODE_SEA");
  }
  run("pnpm", ["exec", ...postjectArgs]);
  if (isMac) {
    // ad-hoc 再署名（hardened runtime 内で Gatekeeper に殺されないように）。
    run("codesign", ["--sign", "-", outBin]);
    run("codesign", ["--verify", "--verbose", outBin]);
  } else {
    // Linux のみ実行権限を付与する。Windows の .exe は不要で、そもそも `chmod` コマンドが無い。
    if (process.platform !== "win32") execFileSync("chmod", ["+x", outBin]);
  }
});

process.stderr.write(`\n[build-sea] done: ${outBin}\n`);
