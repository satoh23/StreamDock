// 055a: updater 用の静的 `latest.json` と GitHub Release 本文を生成する（**素の node・依存ゼロ**）。
//
// release ジョブから呼ばれ、`dist/`（= download-artifact の展開先）を再帰走査して updater 成果物を見つけ、
//   - `dist/latest.json`      … updater が読む配信メタデータ（既存の `files: dist/**/*` がそのまま添付する）
//   - `<BODY_PATH>`           … GitHub Release の本文（`dist/` の**外**に書く。中に書くと成果物として添付されてしまう）
// を書き出す。
//
// ## 設計上の決定（055a）
//
// - **新しい GitHub Action を増やさない**（供給網の面を広げない）。生成は素の node で完結させる。
// - **`version` は常に `apps/desktop/src-tauri/tauri.conf.json` から読む**。タグ名からは作らない。
//   理由: `workflow_dispatch` の空回しでは `RELEASE_TAG` が `ci-<run番号>` になり **semver ではない**ため、
//   タグ名由来にすると空回しの成果物が「妥当性を確認できないもの」になる。
//   タグ push 時は build ジョブの `Check version sync`（`EXPECT_VERSION`）が
//   「タグ名 − `v` == 5 箇所の version」を保証するので、結果としてタグ由来と一致する。
// - **リリースノートは `docs/release-notes/v<version>.md` の 1 ファイルが単一ソース**。
//   `latest.json` の `notes` と Release 本文の**両方**へ同じ内容を流す。
//   **タグ push 時にこのファイルが無ければ fail**（リリースノート無しの配信を防ぐ）。
//   dispatch（空回し）時だけはプレースホルダで続行する——空回しは配布物ではなく CI の疎通確認であり、
//   ここを必須にすると「バージョンを上げた直後、notes を書く前に CI を回せない」ため。
// - **成果物の発見は拡張子ベースの再帰走査**にする。`download-artifact` の展開パスは upload 時の
//   共通祖先に依存して変わるので、固定パスを書くと Tauri やワークフローの変更で黙って壊れる。
// - **fail-closed**: mac / win いずれかの updater 成果物が無い、`.sig` が対になっていない、候補が複数あって
//   一意に決まらない場合は **必ず exit 1**。中身の欠けた `latest.json` を配ることのほうが危険なため
//   （`upload-artifact` の `if-no-files-found: error` は「全パターンが 0 件」のときしか失敗せず、
//   `.sig` が 1 つも生成されなくても dmg/exe が拾われる限り CI は緑のまま通ってしまう）。
//
// ## 署名の同一性検査（レビュー S-1 / Q-7 で追加）
//
// **欠落だけを見ていては足りない。** tauri-cli の `sign_updaters` は、`TAURI_SIGNING_PRIVATE_KEY` の鍵と
// `plugins.updater.pubkey` の鍵が食い違っていても **`log::warn!` を出すだけでビルドを続行する**
// （"The updater secret key ... does not match the public key from `plugins > updater > pubkey`"）。
// つまり **間違った鍵で署名された `.sig`** はそのまま生成され、存在チェックも対の検査も素通りし、
// **CI 緑・インストーラも動く・publish 後に全ユーザーの更新だけが署名検証で落ちる**——
// 055a が eSigner について潰したのとまったく同じ壊れ方が、鍵側に残っていた。
// Secrets の貼り間違い・鍵ローテーション・複数鍵の取り違えで容易に起きるので、ここで機械的に止める。
//
// 併せて、`.sig` の trusted comment に入っている `file:<ファイル名>` を実体の名前と突き合わせる
// （署名自身が名乗っているファイル名を照合する＝対応付けの誤りを構造的に潰す）。
//
// ## 秘密情報について
//
// ここで扱うのは **公開してよい値だけ**。`.sig` は minisign の**署名**（公開鍵で検証する側の値）であり、
// 秘密鍵は `tauri-action` の env にしか存在せず、このスクリプトも `latest.json` も一切触らない。
// 読む env も `DIST_DIR` / `BODY_PATH` / `RELEASE_TAG` / `RELEASE_REPO` / `IS_TAG` の 5 つだけ。

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."); // .github/scripts → リポジトリ root

const DIST_DIR = resolve(repoRoot, process.env.DIST_DIR || "dist");
const BODY_PATH = resolve(repoRoot, process.env.BODY_PATH || "release-body.md");
const RELEASE_TAG = process.env.RELEASE_TAG || "";
const RELEASE_REPO = process.env.RELEASE_REPO || "satoh23/StreamDock-releases";
const IS_TAG = process.env.IS_TAG === "true";

const die = (msg) => {
  console.error(`\n[make-latest-json] ${msg}\n`);
  process.exit(1);
};

if (!RELEASE_TAG) die("RELEASE_TAG が空です（ワークフローの env が渡っていません）。");

// --- (1) version は tauri.conf.json が単一ソース -----------------------------------------------
const confPath = resolve(repoRoot, "apps/desktop/src-tauri/tauri.conf.json");
if (!existsSync(confPath)) die(`${confPath} がありません（release ジョブで checkout していますか？）。`);
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const version = conf.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
  die(`tauri.conf.json の version が semver ではありません: ${JSON.stringify(version)}`);
}

// --- (2) リリースノート（単一ソース） ----------------------------------------------------------
const notesPath = resolve(repoRoot, "docs/release-notes", `v${version}.md`);
let notes;
if (existsSync(notesPath)) {
  notes = readFileSync(notesPath, "utf8").trim();
  if (notes === "") die(`docs/release-notes/v${version}.md が空です。リリースノートを書いてください。`);
} else if (IS_TAG) {
  die(
    `docs/release-notes/v${version}.md がありません。\n` +
      `  タグ push は「リリースノートを先に書く」運用です（README の「リリース手順」参照）。\n` +
      `  このファイルが latest.json の notes と GitHub Release 本文の**単一ソース**なので、\n` +
      `  無いまま配信するとユーザーのアップデート画面に更新内容が出ません。`,
  );
} else {
  // 空回し（workflow_dispatch）のみの安全弁。タグ push には来ない経路。
  notes = `CI build \`${RELEASE_TAG}\` — this is not a release. (docs/release-notes/v${version}.md is not written yet)`;
  console.log(`::warning::docs/release-notes/v${version}.md がありません。空回しのためプレースホルダで続行します。`);
}

// --- (3) dist/ を再帰走査して updater 成果物を見つける ------------------------------------------
if (!existsSync(DIST_DIR)) die(`${DIST_DIR} がありません（download-artifact の後に実行していますか？）。`);

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

const allFiles = walk(DIST_DIR);

/**
 * `.sig` を起点に「署名対象の実体」を探す。Tauri は updater 成果物と同じ場所に `<成果物>.sig` を置くため、
 * `.sig` から先に引くほうが「署名の無い成果物を誤って載せる」事故を構造的に防げる。
 */
const sigs = allFiles.filter((f) => f.endsWith(".sig"));
const pick = (suffix) => {
  const hits = sigs.filter((s) => s.slice(0, -".sig".length).endsWith(suffix));
  return hits.map((s) => ({ sig: s, asset: s.slice(0, -".sig".length) }));
};

const macCandidates = pick(".app.tar.gz");
const winCandidates = pick(".exe"); // NSIS。Windows の updater 対象はこれだけ
// `.msi`(WiX) は **配布対象から外した**（tauri.conf.json の `bundle.targets` から除外）。
// ここで拾うのは「気づかないうちに戻っていないか」を見るためだけ（下で ::warning を出す）。
const msiCandidates = pick(".msi");

const problems = [];
const requireOne = (label, candidates, hint) => {
  if (candidates.length === 0) {
    problems.push(
      `${label} の updater 成果物（<成果物>.sig）が dist/ に 1 つもありません。${hint}`,
    );
    return null;
  }
  if (candidates.length > 1) {
    problems.push(
      `${label} の updater 成果物が複数あり一意に決まりません: ${candidates.map((c) => basename(c.asset)).join(", ")}。` +
        `どれを配るべきか機械では決められないため fail します。`,
    );
    return null;
  }
  const only = candidates[0];
  if (!existsSync(only.asset)) {
    problems.push(
      `${label}: 署名 ${basename(only.sig)} はありますが、対になる成果物 ${basename(only.asset)} が dist/ にありません。` +
        `release.yml の upload-artifact の glob を確認してください。`,
    );
    return null;
  }
  return only;
};

const HINT =
  "tauri.conf.json の `bundle.createUpdaterArtifacts: true` と、build ジョブの署名鍵 env" +
  "（TAURI_SIGNING_PRIVATE_KEY / …_PASSWORD）、および upload-artifact の glob を確認してください。";

const mac = requireOne("macOS (.app.tar.gz)", macCandidates, HINT);
const win = requireOne("Windows (NSIS .exe)", winCandidates, HINT);

// --- (3b) 署名が「配布に埋め込んだ公開鍵で検証できる鍵」で作られているか --------------------------
//
// minisign のボックスは `base64(テキスト)` で、テキストは
//   1 行目: untrusted comment
//   2 行目: base64( alg(2 バイト) + keynum(8 バイト) + 本体 )
//   3 行目: trusted comment（署名側のみ。`timestamp:<unix>\tfile:<ファイル名>`）
// という形。**keynum（8 バイト）が鍵ペアの同一性**で、公開鍵ボックスと署名ボックスで一致する。
// alg は公開鍵が `Ed`、署名は prehash の有無で `Ed`/`ED` と揺れうるので **先頭 2 バイトは比較しない**。
const boxLines = (b64) => Buffer.from(b64, "base64").toString("utf8").split("\n");
const keynumOf = (lines) => {
  const payload = Buffer.from((lines[1] ?? "").trim(), "base64");
  return payload.length >= 10 ? payload.subarray(2, 10).toString("hex") : null;
};

const pubkey = conf.plugins?.updater?.pubkey;
const expectedKeynum = typeof pubkey === "string" ? keynumOf(boxLines(pubkey)) : null;
if (!expectedKeynum) {
  problems.push(
    "tauri.conf.json の `plugins.updater.pubkey` から鍵 ID（keynum）を取り出せませんでした。" +
      "公開鍵が壊れているか、本スクリプトの想定と minisign のボックス形式がずれています（fail-closed）。",
  );
}

const verifySig = (label, pair) => {
  const raw = readFileSync(pair.sig, "utf8").trim();
  const lines = boxLines(raw);
  const actualKeynum = keynumOf(lines);
  if (!actualKeynum) {
    problems.push(`${label}: ${basename(pair.sig)} を minisign 署名として解釈できませんでした。`);
    return;
  }
  if (expectedKeynum && actualKeynum !== expectedKeynum) {
    problems.push(
      `${label}: ${basename(pair.sig)} は **tauri.conf.json の pubkey とは別の鍵**で署名されています` +
        `（署名 keynum=${actualKeynum} / 公開鍵 keynum=${expectedKeynum}）。\n` +
        `      GitHub Secrets の TAURI_SIGNING_PRIVATE_KEY が、tauri.conf.json の plugins.updater.pubkey と\n` +
        `      **同じ鍵ペアの秘密鍵**か確認してください。tauri のビルドはこの食い違いを警告するだけで通してしまうため、\n` +
        `      ここで止めないと「CI 緑・インストーラも動く・全ユーザーの自動更新だけが署名検証で落ちる」状態を配ることになります。`,
    );
    return;
  }
  // trusted comment（`timestamp:<unix>\tfile:<ファイル名>`）が名乗るファイル名と実体を突き合わせる。
  const signedName = (lines[2] ?? "").match(/\bfile:(.*)$/)?.[1]?.trim();
  if (signedName && signedName !== basename(pair.asset)) {
    problems.push(
      `${label}: 署名 ${basename(pair.sig)} は \`${signedName}\` に対して作られていますが、` +
        `対にした実体は \`${basename(pair.asset)}\` です。名前の対応付けが壊れています。`,
    );
  }
};

if (mac) verifySig("macOS (.app.tar.gz)", mac);
if (win) verifySig("Windows (NSIS .exe)", win);

if (problems.length > 0) {
  console.error("\n[make-latest-json] updater 成果物が揃っていません:\n");
  for (const p of problems) console.error(`  - ${p}\n`);
  console.error(`  dist/ にあったファイル:\n${allFiles.map((f) => `    ${f.slice(DIST_DIR.length + 1)}`).join("\n")}\n`);
  process.exit(1);
}

// --- (4) latest.json を組み立てる ---------------------------------------------------------------
const urlFor = (assetPath) =>
  `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(RELEASE_TAG)}/${encodeURIComponent(basename(assetPath))}`;

const entry = (a) => ({
  signature: readFileSync(a.sig, "utf8").trim(),
  url: urlFor(a.asset),
});

const macEntry = entry(mac);

const latest = {
  version,
  notes,
  // `pub_date` は tauri-plugin-updater 側で `OffsetDateTime::parse(.., Rfc3339)` に掛けられる。
  // ⚠ **パースに失敗すると `pub_date` が無視されるのではなく latest.json 全体のデシリアライズが失敗し、
  //   更新チェックが丸ごとエラーになる**（`RemoteRelease` の Deserialize 実装が `DeError::custom` を返すため）。
  //   `toISOString()` が返す小数秒付き（`2026-08-01T00:00:00.000Z`）は RFC 3339 の `time-secfrac` として
  //   正当で、`time` crate の well-known `Rfc3339` も受理するのでこのままでよい（レビュー Q-4）。
  //   再修正トリガー＝099b の実機 E2E で `invalid value for pub_date` が出たとき。
  //   その場合はフィールドごと落とせばよい（`pub_date` は Option で、無くても更新は成立する）。
  pub_date: new Date().toISOString(),
  platforms: {
    // macOS は universal（Intel/Apple Silicon 両対応）1 本。
    // updater の `get_urls` は **`{os}-{arch}-{installer}` → `{os}-{arch}` の 2 段でしかキーを引かない**ため、
    // 実際に当たるのは `darwin-aarch64` / `darwin-x86_64`（1 段目 `darwin-<arch>-app` は無いので 2 段目）。
    // `darwin-universal` は**どの経路からも引かれない**が、`platforms` は HashMap で未知キーは単に無視される
    // ので害はない。将来 tauri 側の解決規則が変わっても当たる側に倒す保険として残す（レビュー Q-3）。
    "darwin-aarch64": macEntry,
    "darwin-x86_64": macEntry,
    "darwin-universal": macEntry,
    // Windows は **NSIS の `.exe` のみ**。Tauri の Windows 自己更新の標準経路が NSIS で、
    // `plugins.updater.windows.installMode` も NSIS の概念だから。
    // ⚠ 技術的には `windows-x86_64-nsis` と `windows-x86_64-msi` を**両方載せることもできる**
    //   （上記のとおり 1 段目に installer 名を含むキーを引くため。「1 キー 1 URL だから無理」は誤り）。
    //   採らない理由は「`.msi` はそもそも**配布しない**」から——`windows-x86_64`（installer 名なし）は
    //   2 段目のフォールバックなので、`.msi` を配ると **MSI で入れたユーザーにも NSIS の `.exe` が配られ、
    //   更新のたびにインストール形式が入れ替わる**（アンインストールのエントリが二重化しうる）。
    //   使わない形式を並べておく意味が無いので `bundle.targets` から `msi` ごと外した（本人の決定・2026-08-01）。
    "windows-x86_64": entry(win),
  },
};

// Release 本文。**空回し（dispatch）は必ず警告バナー付き**にする——`docs/release-notes/v<version>.md` を
// 実物として置いた結果、空回しの下書きが本物のリリースと見分けがつかなくなったため（レビュー S-2）。
// `latest.json` の `notes` は素のままにしておく（空回しだけで「notes がファイルの内容そのまま」を検証したいので、
// ここにバナーを混ぜない）。誤 publish そのものの防御は release.yml の `prerelease:` が担う。
const CI_BANNER =
  `> ⚠ **これは CI 検証用のビルド（\`${RELEASE_TAG}\`）です。リリースではありません。**\n` +
  `> publish しないでください（publish した瞬間に配信対象になります）。`;
const body = IS_TAG ? notes : `${CI_BANNER}\n\n${notes}`;

writeFileSync(join(DIST_DIR, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
writeFileSync(BODY_PATH, `${body}\n`);

// --- (5) ログ（秘密情報は無い。実ファイル名は空回しで確定させるために必ず出す） -------------------
console.log("[make-latest-json] 生成しました:");
console.log(`  version   : ${version}`);
console.log(`  tag       : ${RELEASE_TAG}${IS_TAG ? "" : "（空回し＝Release 本文に警告バナーを付与）"}`);
console.log(`  署名鍵    : keynum=${expectedKeynum}（tauri.conf.json の pubkey と一致することを検査済み）`);
console.log(`  notes     : ${existsSync(notesPath) ? `docs/release-notes/v${version}.md（${notes.length} 文字）` : "プレースホルダ"}`);
console.log(`  macOS     : ${basename(mac.asset)}  (+ ${basename(mac.sig)})`);
console.log(`  Windows   : ${basename(win.asset)}  (+ ${basename(win.sig)})`);
if (msiCandidates.length > 0) {
  // 配布対象から外したはずの `.msi` が復活している。放置すると「MSI で入れたユーザーが
  // 更新のたびに NSIS へ入れ替わる」状態が黙って戻るので、必ず気づけるようにする。
  console.log(
    `::warning::配布対象外のはずの .msi が dist/ にあります（${msiCandidates.map((c) => basename(c.asset)).join(", ")}）。` +
      `tauri.conf.json の bundle.targets に msi が戻っていないか確認してください。` +
      `latest.json は NSIS の .exe しか指さないため、MSI で入れたユーザーは更新でインストール形式が入れ替わります。`,
  );
}
console.log(`  出力      : ${join(DIST_DIR, "latest.json")} / ${BODY_PATH}`);
console.log(`  dist/ 内の全ファイル:\n${allFiles.map((f) => `    ${f.slice(DIST_DIR.length + 1)}`).join("\n")}`);
// 空回しの結果からファイル名・キーを確定してタスクファイルへ追記するため、中身も出す（すべて公開値）。
console.log(`\n${JSON.stringify({ ...latest, notes: `<${notes.length} chars>` }, null, 2)}`);
