import { renderReleaseNotes } from "./renderReleaseNotes";
import styles from "./UpdateScreen.module.css";

/**
 * 055c/055e: リリースノート（`AppUpdateStatus.notes`）の描画。**描画点はこのファイル 1 つ**。
 *
 * 055c は「**改行を保持したプレーンテキスト**」（`white-space: pre-wrap`）で、マークダウン記法は
 * そのまま文字として見えていた。**055e でその `<p>` を `renderReleaseNotes(clampNotes(notes))` に
 * 差し替えた**（`UpdateScreen.tsx` は 1 バイトも変わっていない。CSS は `.notesBody` の子孫セレクタを足した）。
 * ⚠ 記法・段落の分け方・崩れた入力の扱いは `renderReleaseNotes.tsx` の JSDoc を正とする。
 *
 * ⚠ **`dangerouslySetInnerHTML` を使わない**（好みではなく要件）。`notes` は `latest.json` 由来で、
 * **minisign 署名の対象外**（署名が守るのは DL した実体のバイト列だけ）＝HTTPS で守られるだけの
 * 未署名の外部文字列なので、**テキストノードと React 要素としてしか描画しない**。
 * この不変条件は**ランタイムのテストと静的検査の 2 本**で守っている（055e レビュー Q-2 で訂正——
 * 当初ここには「テストでは検査できない＝空虚になる」と書いていたが**誤り**で、実測では
 * `dangerouslySetInnerHTML` を足す変異も `createElement("a", { href })` を足す変異も
 * **ランタイム側が殺した**）:
 * 1. **ランタイム**… `UpdateScreen.test.tsx` の `<img>`/`<b>` 非解釈、`renderReleaseNotes.test.tsx` の
 *    `<a>`/`<img>` ゼロ・**要素の属性がゼロ**（`notes` が属性値へ流れない）。**消さないこと。**
 * 2. **静的検査**… `scripts/check-css-guards.mjs` の **(9)**。描画結果に現れない追加
 *    （別ファイルへ経路を足す・needle 回避・clamp の順序）を止める。
 *
 * ⚠ **表示丈の制御もここに置く**（055b レビュー S-5: `notes` は長さ無制限かつ未署名）。2 段構え:
 * 1. `clampNotes()` で **DOM に入る前に**文字数で打ち切る（`max-height` だけでは全量が DOM に載る）。
 * 2. CSS の `max-height` ＋ `overflow-y: auto` で**縦に伸び続けない**ようにする
 *    （伸びると右下のアップデートボタンが画面外へ押し出され、055d で「押せない」に化ける）。
 */

/**
 * DOM へ載せる最大文字数。根拠は「人が 1 リリース分として読む量の上限」で、
 * `docs/release-notes/vX.Y.Z.md` が数十行である限り絶対に当たらない。
 * 当たるのは `latest.json` が壊れている / 改変されている場合だけ＝**上限に当たること自体が異常の合図**。
 */
const MAX_NOTES_CHARS = 20000;

const TRUNCATED_SUFFIX = "\n…（以下省略）";

/** `notes` が空白だけのときの文言。⚠ `null` / `""` は `UpdateScreen` 側が行ごと出さない（055c review S-4）。 */
const EMPTY_NOTES_MESSAGE = "更新内容の記載がありません。";

/**
 * 長すぎる notes を打ち切る。打ち切ったことがユーザーに分かる形にする。
 * ⚠ **export しない**（このファイルの外から使う理由が無く、export するとコンポーネント以外の
 * 公開シンボルが混ざって Fast Refresh が効かなくなる）。挙動は描画結果ごしにテストする。
 *
 * ⚠ **055e で消さずに残した**（055c review Q-4 が予告した罠）。「描画点はこのファイル 1 つ」と
 * 「丈の制御もこのファイルが持つ」が同居しているため、**このファイルを書き直す形の作業をすると
 * `clampNotes` が自然に消える**。それを防ぐのはコメントではなく `UpdateScreen.test.tsx` の
 * S-5 テストで、**上限値を上下から挟んでいる**ので消しても緩めても落ちる。
 * 併せて `scripts/check-css-guards.mjs` の (9) が **`renderReleaseNotes(clampNotes(` という
 * 呼び出しの形（＝順序）**まで固定している——**先に clamp してからパースする**のが要件で、
 * 逆順（パースしてから clamp）ではパーサに 20,000 字超が渡ってしまう。
 */
function clampNotes(notes: string): string {
  if (notes.length <= MAX_NOTES_CHARS) return notes;
  // ⚠ `slice()` は UTF-16 単位なので、20,000 字目がサロゲートペアの途中だと**孤立サロゲート**が残り
  //    画面に U+FFFD が 1 文字出る（055c からの既存挙動・055e レビュー Q-9・修正不要と判断）。
  //    直さないのは、ここに到達する条件が「latest.json が壊れている / 改変されている」＝
  //    **上限に当たること自体が異常の合図**であり、その 1 文字は表示の劣化としては無視できるため。
  //    **再修正のトリガー**: 上限を「日常的に当たりうる値」まで下げるとき（そのときは末尾の
  //    孤立ハイサロゲートを 1 文字落とす）。
  return notes.slice(0, MAX_NOTES_CHARS) + TRUNCATED_SUFFIX;
}

export function ReleaseNotes({ notes }: { notes: string }) {
  // ⚠ **clamp が先・パースが後**（上の JSDoc と (9) ガードを参照）。
  const blocks = renderReleaseNotes(clampNotes(notes));

  // 空白・改行だけだった場合（`latest.json` は未署名の外部データなので届きうる）。
  // ⚠ `notes` が `null` / `""` のときは `UpdateScreen` 側で「更新内容」の行ごと出ない＝ここには来ない。
  if (blocks.length === 0) {
    return (
      <p className={`${styles.notesBody} ${styles.notesEmpty}`}>{EMPTY_NOTES_MESSAGE}</p>
    );
  }

  // ⚠ `<p>` ではなく `<div>`。中身が見出し / リスト / 段落の**ブロック要素**になったため
  //    （`<p>` の中にブロック要素は入れられない）。**クラス名 `.notesBody` は変えない**——
  //    `check-css-guards.mjs` の (8-b) が `.notesBody` のルール本体で `max-height` / `overflow-y` を
  //    見ており、クラス名を変えるとガードが黙って無効になる。
  return <div className={styles.notesBody}>{blocks}</div>;
}
