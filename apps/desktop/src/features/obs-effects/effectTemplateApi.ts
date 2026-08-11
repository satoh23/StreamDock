import { invoke } from "@tauri-apps/api/core";
import type { EffectAnchor } from "./bindings/EffectAnchor";
import type { EffectLayout } from "./bindings/EffectLayout";
import type { EffectTemplateMedia } from "./bindings/EffectTemplateMedia";
import type { EffectTemplateRecord } from "./bindings/EffectTemplateRecord";
import type { EffectText } from "./bindings/EffectText";

/**
 * 061d: エフェクトテンプレート（061c）の Rust command 4 本の薄いラッパ。
 *
 * 既存の作法どおり **コンポーネントは `invoke` を直接呼ばない**（`overlayThemeApi.ts` /
 * `obsApi.ts` / `windowApi.ts` と同型）。型は 061c が ts-rs で生成した `bindings/` の
 * 5 本をそのまま再 export する（**新しい bindings 先は作らない**）。
 *
 * - **検証・サニタイズは Rust 側**（061c の `effect_template::service` / `manifest`）。
 *   ⚠ **frontend でスキーマ検証を再実装しない**——061c は「`manifest.json` が参照するファイルだけを読む・
 *   ディレクトリを列挙しない」という**構造**で担保しており、TS 側に写しを置くと 2 実装に分裂する。
 * - ⚠⚠ **`get_effect_template_media` が返す data URI は、描画の直前に必ず
 *   `screens/obs-effects/effectMedia.ts` の `safeEffectMedia` を通すこと。** このラッパは
 *   **検査しない**（IPC 境界を越えてきた値を描画シンクで検査する、という向きを崩さないため。
 *   ここで検査すると「ガードが 2 か所にあり片方だけ緩む」形になる）。
 * - **テンプレート名・パス・エラー詳細を `console.*` にも画面のログにも出さない**（§9）。
 *   ⚠ **061d-1 レビュー S-3 で `eslint.config.js` の `no-console` override へ
 *   `src/features/obs-effects/**` を足したので、ここは lint で守られている**（それ以前は
 *   `src/screens/obs-effects/**` 限定＝このコメントだけが規約を支えていた）。
 *   **この override を外すなら、その前に「第三者データを含まない」ことを型か関数の境界で担保すること。**
 *
 * ⚠⚠ **この 4 本はアプリ定義コマンドなので ACL の対象外＝全 5 窓から呼べる**（046b / 055b / 061c と
 * 同じ限界）。絞りは Rust 側（コマンド自体を狭く作る＝`content` / `bytes` / `css` を受け取らない・
 * 保存先の組み立てにユーザー入力が入らない）で担保済み。詳細は `effect_template/commands.rs` の
 * module doc と docs/security.md「Capabilities 方針」。
 *
 * ⚠ **capability の追加はゼロ**——main 窓は `capabilities/default.json` に `dialog:allow-open` を
 * 既に持っており、`open` コマンドが `options.directory` の分岐を内包している（＝ファイル選択と
 * ディレクトリ選択は同じ 1 コマンド）。
 */

export type {
  EffectAnchor,
  EffectLayout,
  EffectTemplateMedia,
  EffectTemplateRecord,
  EffectText,
};

/**
 * 取り込み済みテンプレートの一覧（新しい順）。
 *
 * ⚠ 返るのは表示と描画に要る値だけで、**実ファイル名（`dirName` / `media` / `sound`）は 1 つも含まれない**
 * （§3 / §5——frontend が実ファイル名を知らなければ「frontend がパスを組み立てる」経路そのものが作れない）。
 * 音の有無は `hasSound` だけで判断する。
 *
 * ⚠ Rust 側は**読めない行を黙って落とす**（`list()` の注記）。＝ 一覧に出ない行が
 * ディレクトリと DB に残りうるが、id が届かないので UI からは削除できない。
 * **061c の再修正トリガー**＝壊れた行が実際に報告されたら、戻り値へ「読めなかった件数」を足す。
 */
export function listEffectTemplates(): Promise<EffectTemplateRecord[]> {
  return invoke<EffectTemplateRecord[]>("list_effect_templates");
}

/**
 * ローカルのディレクトリをテンプレートとして取り込み、`app_data_dir/effects/<uuid v4>/` へ保存する。
 *
 * `dir` は `@tauri-apps/plugin-dialog` の `open({ directory: true })` が返した**生パス**。
 * ⚠ **Rust 側で必ず再検証される**（制御文字 → UNC → 実在 → ディレクトリ → `manifest.json` の
 * symlink 拒否 → 64KiB → UTF-8 → スキーマ → 単一ファイル名規則 → 拡張子許可リスト →
 * symlink 拒否・単体サイズ → マジックバイト → 合計サイズ）ので、ここでは何も整形しない。
 *
 * ⚠⚠ **呼び出し側は「テンプレート専用のフォルダを選ぶ」案内と、取り込み直後のプレビューを必ず出すこと**
 * （061c security-review S-3 の**唯一の緩和策**）。`manifest.media` は「**選ばれたディレクトリ直下に
 * 既に在る別のファイル**」も名指しできてしまい、Rust 側では構造的に塞げない
 * （ディレクトリを列挙しない設計上、どれが同梱ファイルかを区別する材料が無い）。
 */
export function importEffectTemplate(
  dir: string,
): Promise<EffectTemplateRecord> {
  return invoke<EffectTemplateRecord>("import_effect_template", { dir });
}

/**
 * テンプレートのメディア（と音源）を**完全な data URI** で取り出す。
 *
 * ⚠⚠ **戻り値をそのまま `src` に入れないこと。** 描画の直前に `safeEffectMedia` を通す
 * （`data:` ＋ MIME 完全一致 ＋ base64 文字集合）。Rust が組み立て frontend が検査する、という
 * 向きで初めてガードが「IPC 境界を越えてきた値」を見る最終防波堤になる。
 *
 * ⚠ **重い**——1 テンプレートで最大 5MiB ＝ base64 で約 6.7MB の文字列が返る。
 * **発火の瞬間に呼ばないこと**（061c からの申し送り 6。先読みは 061d-2 の領分）。
 */
export function getEffectTemplateMedia(
  id: string,
): Promise<EffectTemplateMedia> {
  return invoke<EffectTemplateMedia>("get_effect_template_media", { id });
}

/**
 * テンプレートを削除する（レジストリの行と `app_data_dir/effects/<uuid v4>/` の実体の両方）。
 *
 * ⚠ 呼び出し側は**確認を挟む**こと（元に戻せない）。⚠ 割り当てに使われている場合は、
 * その旨を確認文に出し、削除後に割り当てを解除すること（061d-2 の領分）。
 */
export function deleteEffectTemplate(id: string): Promise<void> {
  return invoke<void>("delete_effect_template", { id });
}
