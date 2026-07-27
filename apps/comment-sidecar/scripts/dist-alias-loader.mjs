// 043d: テスト専用の ESM resolve フック。tsc は `@comment-dock/*` の path alias を emit 後の JS に
// 書き換えない（実体は esbuild の alias でバンドル時に解決される）ため、dist の JS を `node` で直接
// import すると bare specifier `@comment-dock/shared` 等が解決できない。build-sea.mjs の alias 表と
// 同じ対応で dist の実ファイルへ解決する（テスト実行用のみ・バンドルには無関係）。
//
// 本モジュールは**フック定義のみ**。登録はテスト側が `module.register()` で行う
// （例: scripts/test-youtube-mapper.mjs）。ここで自己登録するとフックスレッドで再帰的に
// register が走るため、意図的に分離している。
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");

// ⚠ 二重管理（043d レビュー指摘・2026-07-27）: 下の表は scripts/build-sea.mjs の esbuild alias 表と
//   **同じ対応を手で写したもの**で、片方だけ変えると「バンドルは通るがテストだけ壊れる」（またはその逆）に
//   なる。alias を増減・改名するときは**必ず両方**を更新すること。
//   現状ここを共通化していない理由: build-sea.mjs は esbuild プラグイン用の形（正規表現＋filter）で表を
//   持っており、ESM loader 用の完全一致表とは形が違うため、共通化すると却って読みにくくなる。
//   再修正トリガー: alias が 3 つ以上増える／変更頻度が上がるなら、単一の JSON を両者から読む形へ寄せる。
const ALIASES = {
  "@comment-dock/shared": join(dist, "vendor/shared/src/index.js"),
  "@comment-dock/comment-delivery": join(dist, "vendor/comment-delivery/src/lib.js"),
  "@comment-dock/auth": join(dist, "src/auth/index.js"),
  "@comment-dock/comment-fetcher": join(dist, "src/comment-fetcher/index.js"),
};

export async function resolve(specifier, context, nextResolve) {
  if (Object.prototype.hasOwnProperty.call(ALIASES, specifier)) {
    return { url: pathToFileURL(ALIASES[specifier]).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
