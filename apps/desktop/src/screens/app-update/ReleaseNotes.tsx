import styles from "./UpdateScreen.module.css";

/**
 * 055c: リリースノート（`AppUpdateStatus.notes`）の描画。**055e への差し替え点はこのファイル 1 つ**。
 *
 * いまは「**改行を保持したプレーンテキスト**」（`white-space: pre-wrap`）。マークダウン記法は
 * そのまま文字として見える。055e はこの `<p>` を `renderReleaseNotes(notes)` の呼び出しへ
 * 差し替えるだけでよく、`UpdateScreen.tsx` は 1 バイトも変わらない。
 * ⚠ ただし **CSS は触ることになる**（055c review Q-4）。`.notesBody` は `UpdateScreen.module.css`
 * にあり、マークダウン要素（見出し・リスト・コード）のスタイルはそこへ足す必要がある
 * （`white-space: pre-wrap` も描画後は不要になる）。＝「差し替えは 1 ファイル」は **.tsx の話**で、
 * CSS を含めると 2 ファイル。`max-height` / `overflow-y` は CSS ガードが守るので消せない。
 *
 * ⚠ **`dangerouslySetInnerHTML` を使わない**（好みではなく要件）。`notes` は `latest.json` 由来で、
 * **minisign 署名の対象外**（署名が守るのは DL した実体のバイト列だけ）＝HTTPS で守られるだけの
 * 未署名の外部文字列なので、**テキストノードとしてしか描画しない**。055e の自前レンダラも同じ制約を継ぐ。
 *
 * ⚠ **表示丈の制御もここに置く**（055b レビュー S-5: `notes` は長さ無制限かつ未署名）。2 段構え:
 * 1. `clampNotes()` で **DOM に入る前に**文字数で打ち切る（`max-height` だけでは全量が DOM に載る）。
 * 2. CSS の `max-height` ＋ `overflow-y: auto` で**縦に伸び続けない**ようにする
 *    （伸びると右下のアップデートボタンが画面外へ押し出され、055d で「押せない」に化ける）。
 * 055e もこの 2 つをそのまま引き継ぐこと。
 */

/**
 * DOM へ載せる最大文字数。根拠は「人が 1 リリース分として読む量の上限」で、
 * `docs/release-notes/vX.Y.Z.md` が数十行である限り絶対に当たらない。
 * 当たるのは `latest.json` が壊れている / 改変されている場合だけ＝**上限に当たること自体が異常の合図**。
 */
const MAX_NOTES_CHARS = 20000;

const TRUNCATED_SUFFIX = "\n…（以下省略）";

/**
 * 長すぎる notes を打ち切る。打ち切ったことがユーザーに分かる形にする。
 * ⚠ **export しない**（このファイルの外から使う理由が無く、export するとコンポーネント以外の
 * 公開シンボルが混ざって Fast Refresh が効かなくなる）。挙動は描画結果ごしにテストする。
 *
 * ⚠ **055e への警告（055c review Q-4）**: 「差し替え点はこのファイル 1 つ」と
 * 「丈の制御もこのファイルが持つ」が同居しているため、**このファイルを書き直す形の作業をすると
 * `clampNotes` が自然に消える**。それを防ぐのはコメントではなく `UpdateScreen.test.tsx` の
 * S-5 テストで、**上限値を上下から挟んでいる**ので消しても緩めても落ちる。
 * 055e で描画を差し替えるときは `renderReleaseNotes(clampNotes(notes))` のように
 * **clamp を外側に残す**こと（先に clamp してからパースする。パーサに 20,000 字超を渡さない）。
 */
function clampNotes(notes: string): string {
  if (notes.length <= MAX_NOTES_CHARS) return notes;
  return notes.slice(0, MAX_NOTES_CHARS) + TRUNCATED_SUFFIX;
}

export function ReleaseNotes({ notes }: { notes: string }) {
  // 055e: ここを `renderReleaseNotes(clampNotes(notes))` に差し替える。
  return <p className={styles.notesBody}>{clampNotes(notes)}</p>;
}
