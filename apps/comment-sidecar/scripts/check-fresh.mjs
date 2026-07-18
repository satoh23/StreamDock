// 032c-b(stream-dock): sidecar SEA バイナリの鮮度ガード。
// sidecar の入力（src/ vendor/ scripts/build-sea.mjs package.json tsconfig.json）が
// 出力バイナリ（apps/desktop/src-tauri/binaries/comment-sidecar-<triple>）より新しい、または
// バイナリが未生成なら fail-fast する。build:sea を毎回走らせると重い（Node 複製＋postject＋署名）ため、
// dev/build 前に stat 比較だけで「古いコードを実行してしまう」事故を防ぐ。
//   なぜ必要か: `beforeDevCommand`(Vite) も `beforeBuildCommand` も sidecar をリビルドしないため、
//   ソースを編集して `build:sea` を流し忘れると Tauri が古いバイナリを実行し、無反応バグの温床になる。
// 使い方: node scripts/check-fresh.mjs  （tauri.conf.json の before*Command から呼ぶ）
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(scriptDir, "..");

// build-sea.mjs と同じ target-triple 解決（rustc host → 失敗時は arch 推定）。
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
    `[check-fresh] cannot determine target triple for ${process.platform}/${process.arch}`,
  );
}

// 再帰的に最新 mtime を求める（node_modules/dist/build は入力ではないので除外）。
const SKIP_DIRS = new Set(["node_modules", "dist", "build"]);
function newestMtimeMs(path) {
  const st = statSync(path);
  if (st.isFile()) return st.mtimeMs;
  if (!st.isDirectory()) return 0;
  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const child = join(path, entry.name);
    const m = newestMtimeMs(child);
    if (m > newest) newest = m;
  }
  return newest;
}

const inputs = [
  join(pkgDir, "src"),
  join(pkgDir, "vendor"),
  join(pkgDir, "scripts", "build-sea.mjs"),
  join(pkgDir, "package.json"),
  join(pkgDir, "tsconfig.json"),
];

const triple = hostTargetTriple();
const binPath = resolve(
  pkgDir,
  "..",
  "desktop",
  "src-tauri",
  "binaries",
  `comment-sidecar-${triple}`,
);

const rebuildHint = `TWITCH_CLIENT_ID=<Client ID> pnpm build:sidecar`;

if (!existsSync(binPath)) {
  process.stderr.write(
    `\n[check-fresh] sidecar バイナリが未生成です:\n  ${binPath}\n` +
      `  リビルドしてください: ${rebuildHint}\n\n`,
  );
  process.exit(1);
}

const binMtime = statSync(binPath).mtimeMs;
let newestInput = 0;
let newestInputPath = "";
for (const input of inputs) {
  if (!existsSync(input)) continue;
  const m = newestMtimeMs(input);
  if (m > newestInput) {
    newestInput = m;
    newestInputPath = input;
  }
}

if (newestInput > binMtime) {
  process.stderr.write(
    `\n[check-fresh] sidecar ソースがバイナリより新しい（stale）です。\n` +
      `  最新入力 : ${newestInputPath}\n` +
      `  バイナリ : ${binPath}\n` +
      `  リビルドしてください: ${rebuildHint}\n\n`,
  );
  process.exit(1);
}

process.stderr.write("[check-fresh] sidecar バイナリは最新です ✓\n");
