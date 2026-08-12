// 061d: **TS ↔ Rust の層をまたぐ契約**を機械的に固定するガード。
//
// ## なぜ要るのか（片側だけを変えたときに何が起きるか）
//
// エフェクトテンプレートの契約は 3 つあり、**どれも 2 つの層に同じ内容が書かれている**:
//
//   1. **コマンド名**（`invoke("import_effect_template")` ↔ `#[tauri::command] pub async fn import_effect_template`）
//   2. **引数キー**（`invoke(..., { dir })` ↔ `dir: String`）
//   3. **許可 MIME**（`effectMedia.ts` の `ALLOWED_*_PREFIXES` ↔ `service.rs` の `AssetKind::mime()`）
//
// ⚠⚠ **既存のテストは「片側だけ」を見ている。**
//   - `effectTemplateApi.test.ts` は TS 側が `"import_effect_template"` を呼ぶことを固定する。
//   - Rust の `exposes_exactly_four_single_purpose_commands` は Rust 側にコマンドが 4 本あることを固定する。
//   ＝ **どちらも相手を見ていないので、片側だけ改名すると両方緑のまま実機でだけ失敗する。**
//   `effectTemplateApi.ts` の doc 自身が「ここがずれると typecheck も lint も通ったまま
//   **実機でだけ失敗する**（コマンド名は文字列なので）」と書いているのに、それを止める検査が無かった。
//
// ⚠ 3 について docs/security.md「CSP方針 → 061c」は「この一覧は Rust 側の MIME 表と**対になっている**。
//   片方だけ増やすと『取り込めるのに描けない』（あるいはその逆）になるので、**必ず両方を見ること**」と
//   書いている。その「必ず」を、レビュー時の注意力ではなく機械で担保する。
//
// ## なぜ vitest ではなくこのスクリプトなのか
//
// Rust ソースを読むには `node:fs` が要るが、`apps/desktop` の tsconfig は**ブラウザ向け**で
// `@types/node` を持たない。型のためだけに依存を増やすのは docs/security.md §10 に反する。
// `check-css-guards.mjs` / `check-version-sync.mjs` と**同じ作法**（tsc を通さない .mjs を
// `pnpm test` から呼ぶ）に寄せる。
//
// ⚠ 読むのは「両層が共有する仕様」だけ（コマンド名・引数キー・MIME）。**ロジックは読まない。**

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUST = "src-tauri/src/effect_template";

const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

let failed = 0;
const fail = (message) => {
  failed += 1;
  console.error(`✗ ${message}`);
};
const eq = (actual, expected, message) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${message}\n    実際: ${a}\n    期待: ${b}`);
};

const commands = read(`${RUST}/commands.rs`);
const service = read(`${RUST}/service.rs`);
const api = read("src/features/obs-effects/effectTemplateApi.ts");
const guard = read("src/screens/obs-effects/effectMedia.ts");

// --- (1) コマンド名が両層で一致すること ---------------------------------------------------------

const declared = [
  ...commands.matchAll(/#\[tauri::command\]\s*pub\s+(?:async\s+)?fn\s+(\w+)/g),
]
  .map((m) => m[1])
  .sort();
const invoked = [...api.matchAll(/invoke<[^>]*>\(\s*"([a-z_]+)"/g)]
  .map((m) => m[1])
  .sort();

// 抽出そのものが壊れていたら以降が無意味なので先に見る。
if (declared.length !== 4) {
  fail(`Rust の #[tauri::command] が 4 本ではない（${declared.length} 本）。抽出が壊れたか、§3 の再評価が要る。`);
}
if (invoked.length !== 4) {
  fail(`effectTemplateApi.ts の invoke が 4 本ではない（${invoked.length} 本）。`);
}
eq(
  invoked,
  declared,
  "コマンド名が TS と Rust でずれています（片側だけ改名すると **実機でだけ** 失敗します）。" +
    " effectTemplateApi.ts と effect_template/commands.rs を必ず同時に直してください。",
);

// --- (2) 引数キーが両層で一致すること -----------------------------------------------------------

const tsArgs = new Map(
  [...api.matchAll(/invoke<[^>]*>\(\s*"([a-z_]+)"(?:,\s*\{\s*(\w+)\s*\})?/g)].map(
    (m) => [m[1], m[2] ?? null],
  ),
);
for (const [command, key] of [
  ["import_effect_template", "dir"],
  ["get_effect_template_media", "id"],
  ["delete_effect_template", "id"],
  // ⚠ 一覧は引数を取らない。取るようになったら §3 の再評価が要る。
  ["list_effect_templates", null],
]) {
  eq(tsArgs.get(command) ?? null, key, `${command} の引数キー`);
}
// Rust 側が実際にそのキーで受けていること。
for (const key of ["dir: String", "id: String"]) {
  if (!commands.includes(key)) fail(`commands.rs が \`${key}\` を受けていません。`);
}
// ⚠ 汎用の読み書き経路（§3 の禁止例 `write_file(path, content)` 型）が生えていないこと。
//   Rust 側にも同型の契約テストがあるが、**frontend の契約としても見張る**（片側だけ緩む形を作らない）。
for (const banned of ["path", "content", "bytes", "data", "css"]) {
  if (commands.includes(`${banned}: String`)) {
    fail(`commands.rs が \`${banned}: String\` を受け取っています（汎用の読み書き経路になる・§3）。`);
  }
}

// --- (3) 許可 MIME が両層で一致すること ---------------------------------------------------------

// Rust: `AssetKind::Png => "image/png",` と `fn slot()` の振り分けから、スロットごとの集合を作る。
// ⚠⚠ **`fn mime()` のブロックに限定すること。** `AssetKind::X => "..."` という同じ形は
//   `fn extension()` にもあり（`AssetKind::Png => "png"`）、範囲を絞らないと**拡張子まで MIME として
//   拾ってしまう**（初版がこれを踏んだ）。関数名で切り出してから読む。
const blockOf = (name) =>
  new RegExp(`fn ${name}\\(self\\)[\\s\\S]*?\\n {4}\\}`).exec(service)?.[0] ?? "";
const mimeBlock = blockOf("mime");
const mimeOf = [...mimeBlock.matchAll(/AssetKind::(\w+)\s*=>\s*"([\w/+.-]+)"/g)];
const slotBlock = blockOf("slot");
const mediaSide = /([\s\S]*?)=>\s*\{?\s*AssetSlot::Media/.exec(slotBlock)?.[1] ?? "";
const rustMedia = new Set();
const rustSound = new Set();
for (const [, kind, mime] of mimeOf) {
  (mediaSide.includes(`AssetKind::${kind}`) ? rustMedia : rustSound).add(mime);
}

// TS: `"data:image/png;base64,"` の並びから MIME を取り出す。
const listOf = (name) => {
  const block = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(guard)?.[1] ?? "";
  return new Set([...block.matchAll(/"data:([\w/+.-]+);base64,"/g)].map((m) => m[1]));
};

if (rustMedia.size === 0 || rustSound.size === 0 || mimeOf.length === 0) {
  fail("service.rs から MIME 表を抽出できませんでした（表の書き方が変わった可能性があります）。");
}
const sorted = (s) => [...s].sort();
eq(
  sorted(listOf("ALLOWED_MEDIA_PREFIXES")),
  sorted(rustMedia),
  "メディアの許可 MIME が effectMedia.ts と service.rs でずれています" +
    "（片方だけ増やすと『取り込めるのに描けない』/『描けるのに取り込めない』になります）。",
);
eq(
  sorted(listOf("ALLOWED_SOUND_PREFIXES")),
  sorted(rustSound),
  "音源の許可 MIME が effectMedia.ts と service.rs でずれています。",
);

// --- (4) 危険な MIME が **どちらの層にも** 無いこと ----------------------------------------------

// docs/security.md「CSP方針 → 061c」/「§8 の 061c 節」: `<img>` の SVG は secure static mode でも
// `filter:` / `mask:` 経由の保証が及ばない。⚠ **「増やすな」という規約が唯一の壁**なので両層を見張る。
// ⚠ コメント中の言及（「足さないこと」）は許すので、**許可リストの形**での出現だけを見る。
for (const banned of ["image/svg+xml", "text/html"]) {
  if (guard.includes(`"data:${banned};base64,"`)) {
    fail(`effectMedia.ts の許可リストに ${banned} が入っています（docs/security.md の CSP方針 061c）。`);
  }
  if (service.includes(`=> "${banned}"`)) {
    fail(`service.rs の MIME 表に ${banned} が入っています（docs/security.md の CSP方針 061c）。`);
  }
}
// ⚠ base64 の本体検査が `+`（1 文字以上）のままであること。`*` にすると `"="` だけのペイロードが通る
//   （061c security-review Q-6）。
if (!guard.includes("[A-Za-z0-9+/]+={0,2}")) {
  fail("effectMedia.ts の BASE64_BODY が緩んでいます（`+` を `*` にすると空ペイロードが通ります）。");
}

// --- (5) docs/security.md の許可拡張子が Rust の表と一致すること ---------------------------------

// ⚠⚠ **061f レビュー Q-7 で追加。** (3) は Rust ↔ TS を守るが、**`docs/security.md` だけが
//   古くなる変異は誰も止めなかった**。security.md は許可リストの「正」として参照される文書なので、
//   そこだけ `ogg` を許可したまま残ると、次にこの節を読む人が**戻してよいと誤読する**。
//   ⚠ 「規約で足りる」は 061f の時点で反証されている——同じ許可リストを書いた docs が
//   **2 か所古いまま残っていた**（レビュー Q-2）。人の注意力ではなく機械で突き合わせる。
// ⚠ 読むのは「**拡張子は許可リスト（media = …、sound = …）**」の 1 行だけ。**散文は読まない。**
// ⚠⚠ **抽出が空なら fail させること**（下記）。これが無いと、行の書き方を変えた瞬間に
//   この検査が**黙って無効化される**（(3) の「抽出そのものが壊れていたら先に見る」と同じ作法）。

const securityMd = readFileSync(resolve(ROOT, "../../docs/security.md"), "utf8");

const allowLine =
  /\*\*拡張子は許可リスト\*\*（media = ([^、]*)、sound = ([^）]*)）/.exec(securityMd);
if (allowLine === null) {
  fail(
    "docs/security.md から「拡張子は許可リスト（media = …、sound = …）」の行を見つけられませんでした。" +
      " 行の書き方を変えたなら、この検査（(5)）の正規表現も直してください（黙って無効化しないこと）。",
  );
}

// Rust: `fn extension()` の表を (3) と同じ `slot()` の振り分けでスロット別に分ける。
const extBlock = blockOf("extension");
const extOf = [...extBlock.matchAll(/AssetKind::(\w+)\s*=>\s*"([a-z0-9]+)"/g)];
const rustMediaExt = new Set();
const rustSoundExt = new Set();
for (const [, kind, ext] of extOf) {
  (mediaSide.includes(`AssetKind::${kind}`) ? rustMediaExt : rustSoundExt).add(ext);
}
if (extOf.length === 0) {
  fail("service.rs から `fn extension()` の表を抽出できませんでした（表の書き方が変わった可能性があります）。");
}

if (allowLine !== null && extOf.length > 0) {
  const docExts = (chunk) => new Set([...chunk.matchAll(/`([a-z0-9]+)`/g)].map((m) => m[1]));
  eq(
    sorted(docExts(allowLine[1])),
    sorted(rustMediaExt),
    "docs/security.md の許可拡張子（media）が service.rs の `fn extension()` とずれています" +
      "（⚠ security.md だけが古いと、次に読む人が『戻してよい』と誤読します）。",
  );
  eq(
    sorted(docExts(allowLine[2])),
    sorted(rustSoundExt),
    "docs/security.md の許可拡張子（sound）が service.rs の `fn extension()` とずれています" +
      "（⚠ `.ogg` を戻すなら Rust / TS / security.md の 3 か所を同時に直してください・061f）。",
  );
}

if (failed > 0) {
  console.error(`\nEffect template contract check FAILED (${failed} 件)`);
  process.exit(1);
}
console.log("Effect template contract check OK");
