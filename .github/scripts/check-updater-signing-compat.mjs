// 055a: **Windows のビルド後置換署名と updater の minisign 署名は両立しない**——これを CI で機械的に止める。
//
// ## なぜ「タスクファイルへの申し送り」では足りないのか
//
// `sslcom/esigner-codesign` は tauri のビルド**後**に `.exe` / `.msi` を `override: true` で置換署名する。
// updater の `.sig`（minisign）は**バンドルした時点のバイト列**に対して作られるので、置換でバイト列が変われば
// 必ず食い違う。しかも壊れ方が **「CI 緑・インストーラも普通に起動する・自己更新だけが署名検証で落ちる」**＝
// 実機 E2E（099b）まで発覚しない。現在は `secrets.ES_USERNAME` 未設定でステップごとスキップされるため
// 顕在化しておらず、099a で Secrets を入れた瞬間に発火する。しかも 099a の作業者が 055a のタスクファイルを
// 読む保証はない。
//
// このリポジトリは `apps/desktop/scripts/check-css-guards.mjs` の冒頭で
// **「コメントはファイル境界を越えないので、境界を越える検査が要る」**（同じバグを 3 回踏んだ実績）を
// 既に明文化している。ここもまったく同じ構図なので、**文書ではなく検査**で止める。
//
// ## 判定（両側を見る）
//
//   `createUpdaterArtifacts` が真 かつ ①`bundle.windows.signCommand` 未設定           → fail（移行前）
//   `createUpdaterArtifacts` が真 かつ ②release.yml にビルド後の置換署名ステップが残存 → fail（移行が中途半端）
//
// ⚠ ①だけを見ていると「`signCommand` を設定したがビルド後の署名ステップを消し忘れた」＝**元の地雷とまったく
//   同じ壊れ方**が素通りする。移行途中で気を抜くのが一番ありそうな失敗なので、②も併せて見る（レビュー Q-5）。
//   ②は YAML パーサを持ち込まず、ステップ単位に切って文字列で見る（依存ゼロ・`check-css-guards.mjs` が
//   CSS 原文を文字列検査しているのと同じ作法）。
//
// 実行条件は release.yml 側で `env.HAS_WINDOWS_SIGNING == 'true'`（＝ES_USERNAME がある）に絞ってあり、
// **今日は no-op**。移行手順は下のエラーメッセージが持つ（説明を二重に書かない）。
//
// 実行: node .github/scripts/check-updater-signing-compat.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const confPath = resolve(repoRoot, "apps/desktop/src-tauri/tauri.conf.json");
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

const read = (path, label) => {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    // 読めない＝このチェッカーの想定と実装がずれている。黙って素通りさせない（fail-closed）。
    console.error(`\n[check-updater-signing-compat] ${label} を読めません（${e.code ?? e.message}）。\n`);
    process.exit(1);
  }
};

const conf = JSON.parse(read(confPath, "tauri.conf.json"));
const bundle = conf.bundle ?? {};
const createsUpdaterArtifacts = Boolean(bundle.createUpdaterArtifacts);
const hasSignCommand = typeof bundle.windows?.signCommand === "string" && bundle.windows.signCommand !== "";

// ビルド後の置換署名ステップ（`sslcom/esigner-codesign` を `override: true` で使うもの）が残っているか。
// ステップは `- name:` で始まる単位に切る（インデントの深さに依存しない）。
// ⚠ 文字列検査なので、**コメント中に `uses: sslcom/esigner-codesign` と `override: true` の両方が現れると
//    誤検知する**（fail-closed 側なので危険はないが、099a でステップを消したあとコメントに両方を残さないこと。
//    現在の release.yml のコメントは「override でその場置換する」という文なので当たらない＝実測で 0 件を確認済み）。
const workflow = read(workflowPath, ".github/workflows/release.yml");
const postBuildSigningSteps = workflow
  .split(/^\s*- name:/m)
  .filter((step) => /uses:\s*sslcom\/esigner-codesign/.test(step) && /override:\s*true/.test(step)).length;

const MIGRATION = [
  "",
  "  対処（099a の領分・055a で決定済み）:",
  "    1. tauri.conf.json の `bundle.windows.signCommand` に署名コマンドを設定し、",
  "       **tauri のバンドル過程の中で**署名させる（その後に updater 署名が作られる順序になる）。",
  "    2. release.yml のビルド後 `Sign NSIS installer (.exe)` / `Sign WiX installer (.msi)` ステップと、",
  "       その前段の `Locate Windows installers` を削除する。**1 と 2 は必ずセットで行う。**",
  "    3. 検証は 099b の E2E（実機の自己更新）で行う。",
  "",
  "  詳細: docs/tasks/099a-windows-code-signing.md 冒頭の申し送り／docs/tasks/055a-updater-release-pipeline.md",
  "",
].join("\n");

if (createsUpdaterArtifacts && !hasSignCommand) {
  console.error(
    "\n[check-updater-signing-compat] Windows のコード署名と updater の署名が両立しない構成です。\n" +
      "\n" +
      "  現状: `bundle.createUpdaterArtifacts` が有効で、updater の `.sig`（minisign）は\n" +
      "        **tauri がバンドルした時点のバイト列**に対して作られます。\n" +
      "        しかし `bundle.windows.signCommand` が未設定のため、このワークフローは **ビルド後**に\n" +
      "        `sslcom/esigner-codesign` で `.exe` / `.msi` を `override: true` 置換署名します。\n" +
      "        → 署名でバイト列が変わり `.sig` と一致しなくなり、**Windows の自己更新が必ず署名検証で落ちます**。\n" +
      "        （インストーラ自体は動くので CI も手動インストールも成功し、自己更新だけが静かに壊れます）\n" +
      MIGRATION,
  );
  process.exit(1);
}

if (createsUpdaterArtifacts && postBuildSigningSteps > 0) {
  console.error(
    "\n[check-updater-signing-compat] `signCommand` へ移行済みですが、ビルド後の置換署名が残っています。\n" +
      "\n" +
      `  release.yml に \`sslcom/esigner-codesign\` を \`override: true\` で使うステップが ${postBuildSigningSteps} 個残っています。\n` +
      "  この状態は **移行前とまったく同じ壊れ方**になります——バンドル中に署名して `.sig` を作った直後に、\n" +
      "  ビルド後の置換署名が同じファイルを上書きしてバイト列を変えるため、`.sig` と一致しなくなります。\n" +
      "  （やはり CI は緑・インストーラも動き、**Windows の自己更新だけが静かに落ちます**）\n" +
      MIGRATION,
  );
  process.exit(1);
}

console.log(
  `[check-updater-signing-compat] OK (createUpdaterArtifacts=${createsUpdaterArtifacts}, ` +
    `windows.signCommand=${hasSignCommand ? "設定あり" : "未設定"}, ビルド後の置換署名ステップ=${postBuildSigningSteps} 個)`,
);
