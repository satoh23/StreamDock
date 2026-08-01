// 055a: バージョン番号 **5 箇所**の同期ガード。
//
// ## なぜ 5 箇所すべてを揃える必要があるのか（1 つでもズレると何が起きるか）
//
// このリポジトリのバージョン番号は「1 つの値」ではなく、**参照系が分かれている**:
//
//   1. `apps/desktop/src-tauri/tauri.conf.json` … **updater が比較する値**。ここが実バイナリより低いと
//      更新が届かず、高いと「更新したのに更新が残り続ける」ループを作る（055a/055b）。
//   2. `apps/desktop/src-tauri/Cargo.toml` [package] … **診断画面が表示する「アプリバージョン」**
//      （`app_logs/service.rs` の `env!("CARGO_PKG_VERSION")` → `DiagnosticsScreen.tsx`）。
//      1 とズレると「診断は 0.1.0 なのに updater は 0.2.0 として振る舞う」という**追いにくい不整合**になる。
//      ユーザーからの不具合報告のバージョンが当てにならなくなるのが実害。
//   3. `apps/desktop/package.json` … 開発者・CI が見る値。
//   4. `package.json`（root） … workspace の代表値。README のリリース手順が**長らく漏らしていた**箇所。
//   5. `apps/comment-sidecar/package.json` … sidecar は `externalBin` として本体バンドルに**同梱**され、
//      本体の更新で一緒に入れ替わる。同梱物なので本体と同じ版であることが整合の前提になる。
//
// **同期の仕組みは無く、README のリリース手順は 3 箇所しか挙げていなかった**（4 と 5 が漏れていた）。
// タグを打つ直前に手で 5 ファイルを触る運用なので、人間のチェックリストでは必ず落ちる。だから機械で止める。
//
// ## なぜ vitest ではなくこの形なのか
//
// `check-css-guards.mjs` の冒頭と同じ理屈: **`scripts/` は `tsconfig.json` の `include: ["src"]` の外**なので、
// 素の `.mjs` を置けば `node:fs` を使っても **@types/node 不要・typecheck 影響ゼロ・新規依存ゼロ**。
// TOML/JSON パーサも持ち込まない（依存ゼロがこのスクリプトの前提）。
//
// ## 使い方
//
//   node scripts/check-version-sync.mjs              # 5 箇所が互いに一致することだけを見る
//   EXPECT_VERSION=v0.2.0 node scripts/…             # ＋「その値と一致すること」も見る（CI のタグ検証）
//   node scripts/check-version-sync.mjs --expect v0.2.0   # 同上（引数版）
//
// `pnpm check:version` から呼ばれ、`pnpm test` にも連結されている。
// CI（release.yml の `Check version sync`）は **同じスクリプトに `EXPECT_VERSION` を渡すだけ**で
// 「タグ名 − `v` == 5 箇所」を検証する（タグ検証用の別ロジックを書かない＝二重管理を作らない）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // apps/desktop
const repoRoot = resolve(desktopDir, "..", ".."); // リポジトリ root（apps/desktop の 2 つ上）

const failures = [];
const fail = (msg) => failures.push(msg);

/** メッセージは常にリポジトリ root からの相対パスで出す（どこから実行しても同じ文字列になる）。 */
const show = (abs) => relative(repoRoot, abs);

/**
 * `package.json` / `tauri.conf.json` の `version`。
 * 読めない・キーが無い場合は **null を返して fail-closed**（黙って「一致した」ことにしない）。
 */
function readJsonVersion(abs) {
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (e) {
    fail(`${show(abs)}: 読み込めません（${e.code ?? e.message}）。ファイルを移動・改名したなら本スクリプトも一緒に直してください。`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`${show(abs)}: JSON として解析できません（${e.message}）。`);
    return null;
  }
  if (typeof parsed.version !== "string") {
    fail(`${show(abs)}: \`version\` キーがありません（または文字列ではありません）。`);
    return null;
  }
  return parsed.version;
}

/**
 * `Cargo.toml` の **`[package]` セクションの** `version`。
 *
 * ⚠ 正規表現一発（`/version\s*=\s*"([^"]+)"/`）にしてはいけない。この Cargo.toml には
 * `tauri = { version = "2", features = [...] }` や `[target.'cfg(windows)'.dependencies]` の
 * `windows = { version = "0.58", … }` があり、**最初に当たるのが依存クレートのバージョン**になる
 * （＝アプリのバージョンを 1 度も見ないまま「一致」と言う検査が出来上がる）。
 *
 * TOML パーサを足さずにこれを構造的に不可能にするため、**セクションを追いながらの行走査**にする:
 *   - `^\s*\[…\]` の行だけを「セクション見出し」とみなす（`# [package]` はコメントなので当たらない）
 *   - `[package]` の中の **行頭の** `version = "…"` だけを拾う（インラインテーブル内の version は行頭に来ない）
 */
function readCargoPackageVersion(abs) {
  let toml;
  try {
    toml = readFileSync(abs, "utf8");
  } catch (e) {
    fail(`${show(abs)}: 読み込めません（${e.code ?? e.message}）。`);
    return null;
  }
  let section = null;
  for (const line of toml.split(/\r?\n/)) {
    const head = line.match(/^\s*\[([^\]]+)\]/);
    if (head) {
      section = head[1].trim();
      continue;
    }
    if (section !== "package") continue;
    const m = line.match(/^\s*version\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  fail(
    `${show(abs)}: \`[package]\` セクションの \`version\` を取り出せませんでした。` +
      `セクション構成が変わったか、値が別の書き方（インラインテーブル / workspace 継承 \`version.workspace = true\` 等）に` +
      `なった可能性があります。**このチェッカーの想定と実装がずれている状態なので、素通りさせず fail します**` +
      `（黙って検査が無効になるのを防ぐため）。本スクリプトの readCargoPackageVersion を一緒に直してください。`,
  );
  return null;
}

// 検査対象。`why` は fail メッセージに出す「その箇所がズレると何が壊れるか」。
// `baseline: true` の 1 件が「期待値が指定されなかったときの基準」になる（下の baseline 参照）。
const TARGETS = [
  {
    abs: resolve(desktopDir, "src-tauri", "tauri.conf.json"),
    read: readJsonVersion,
    baseline: true,
    why: "updater が「更新があるか」を比較する値（ここがズレると更新が届かない／更新ループになる）",
  },
  {
    abs: resolve(desktopDir, "src-tauri", "Cargo.toml"),
    read: readCargoPackageVersion,
    why: "診断画面が表示するアプリバージョン（env!(\"CARGO_PKG_VERSION\")）。tauri.conf.json とズレると『診断は 0.1.0 なのに updater は 0.2.0 として振る舞う』",
  },
  {
    abs: resolve(desktopDir, "package.json"),
    read: readJsonVersion,
    why: "開発者・CI が見るデスクトップアプリの版",
  },
  {
    abs: resolve(repoRoot, "package.json"),
    read: readJsonVersion,
    why: "workspace root の代表値（README のリリース手順が長らく漏らしていた箇所）",
  },
  {
    abs: resolve(repoRoot, "apps", "comment-sidecar", "package.json"),
    read: readJsonVersion,
    why: "externalBin として本体バンドルに同梱される sidecar の版（本体の更新で一緒に入れ替わるため同版であることが前提）",
  },
];

const found = TARGETS.map((t) => ({ ...t, version: t.read(t.abs) }));

// 期待値。CI のタグ検証は `EXPECT_VERSION`（または `--expect`）で渡す。先頭の `v` は落とす（`v0.2.0` → `0.2.0`）。
const expectArgIndex = process.argv.indexOf("--expect");
const expectRaw =
  (expectArgIndex !== -1 ? process.argv[expectArgIndex + 1] : undefined) ??
  process.env.EXPECT_VERSION ??
  "";
const expected = expectRaw.trim().replace(/^v/, "");

// 期待値が無いときの基準は **tauri.conf.json**（updater が実際に比較する値＝「正」に最も近い）。
// これにより fail メッセージが「updater が見る 0.1.0 に対して Cargo.toml が 0.1.1」という読み方になる。
// ⚠ 基準は `TARGETS` の**並び順ではなく `baseline: true` フラグ**で選ぶ（配列を並べ替えたときに
//   黙って基準がすり替わらないようにするため）。フラグが無い＝チェッカーの整合が崩れているので fail-closed。
const baselineTarget = found.find((t) => t.baseline);
if (!baselineTarget) {
  fail("TARGETS に `baseline: true` の項目がありません。本スクリプトの想定と実装がずれています。");
}
const baseline = expected || baselineTarget?.version;
const baselineLabel = expected
  ? `指定された期待値 \`${expected}\`（EXPECT_VERSION / --expect）`
  : `\`${baselineTarget ? show(baselineTarget.abs) : "?"}\` の \`${baseline}\``;

// 末尾までアンカーする（`0.1.0garbage` のようなゴミを通さない）。
// プレリリース／ビルドメタデータ（`0.2.0-beta.1`）は形としては許すが、⚠ **Windows の MSI / NSIS は
// プレリリース識別子付きのバージョンを受け付けない**（bundle 段階で落ちる）。プレリリースタグを打つ運用を
// 始めるなら、まず 099b の実機ビルドで通ることを確認すること。
if (expected && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(expected)) {
  fail(`期待値 \`${expectRaw}\` が semver（X.Y.Z）の形ではありません。タグは \`vX.Y.Z\` で打ってください。`);
}

if (baseline) {
  for (const t of found) {
    if (t.version === null) continue; // 読めなかったものは既に fail 済み
    if (t.version === baseline) continue;
    fail(
      `${show(t.abs)}: バージョンが \`${t.version}\` ですが、${baselineLabel} と一致していません。\n` +
        `      この箇所の役割: ${t.why}。\n` +
        `      リリース時は **5 箇所すべて**を同じ値に揃えてください` +
        `（tauri.conf.json / Cargo.toml [package] / apps/desktop/package.json / root package.json / apps/comment-sidecar/package.json）。`,
    );
  }
}

if (failures.length > 0) {
  console.error("Version sync check FAILED:\n");
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`Version sync check OK (${baseline} / 5 files)`);
