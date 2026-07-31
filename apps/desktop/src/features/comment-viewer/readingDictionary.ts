/**
 * 041a: コメント読み上げの「読み替え適用エンジン」＋自前の内蔵一般辞書。
 *
 * VOICEVOX（内部 OpenJTalk）の読み推定は「ww→ダブリューダブリュー」「ChatGPT→チャットグプト」等の
 * ネットスラング・英語略語を誤読する。これを直すため、合成へ渡す**前**にコメント本文へ自前の置換テーブルを
 * かける（棒読みちゃん等が採る「TTS 前にテキスト置換する」手法＝アイデアのみを参考にした純テキスト置換）。
 *
 * 本モジュールは frontend 完結の純関数のみで、外部通信・依存・CSP を一切増やさない（docs/security.md §1/§3/§10・
 * `csp: null` 不変）。内蔵辞書は**自前の独自データ**で、MeCab/NEologd/IPAdic/棒読みちゃん/VOICEVOX 同梱辞書の
 * データ・コードを転載/機械変換していない（親 041 のライセンス方針）。ユーザー編集辞書の重ね合わせは 041b。
 */

/**
 * 読み替えルール 1 件。`reading` はカタカナ想定（VOICEVOX が読みからアクセントを再推定する）。
 * - `kind:"text"`: `surface` を**文字列一致**で置換する。
 * - `kind:"regex"`: `surface` を**正規表現ソース**として扱い、反復スラング（笑いの w）・語境界つき略語・記号に使う。
 *   **regex は内蔵辞書内の定義のみ**が持つ（041b のユーザー入力は `kind:"text"` 固定＝任意正規表現を書かせない）。
 */
export type ReadingRule = {
  surface: string;
  reading: string;
  kind: "text" | "regex";
};

/**
 * regex ルールのコンパイル用固定フラグ。
 * - `i`: 大小無視（`API`/`api`、`OBS`/`obs` を同一視）。
 * - `u`: Unicode モード（将来のプロパティ escape・厳密なエスケープに対応。既存 `EMOJI_RE` と同水準）。
 * - `y`: sticky（トークナイザで `lastIndex` の位置に**開始する**一致だけを見る）。
 */
const REGEX_FLAGS = "iuy";

/**
 * 読み替え辞書をテキストへ適用する（**単一パスのトークナイザ・最長一致＋定義順**）。
 *
 * 左から 1 文字ずつ走査し、各位置で「その位置に開始する一致」のうち**最長**を採用する。これにより
 * ①短い語が長い語の一部を先に食う事故（例: `煙草` を `草` が先食い）と ②置換後の読み（カタカナ）を後続ルールが
 * 再マッチする事故、の両方を構造的に防ぐ。同一長は**先に定義したルールが勝つ**（定義順タイブレーク）。
 *
 * 辞書未注入・空辞書のときは入力をそのまま返す（＝現行動作）。trim はしない（純粋な置換。空判定・trim は呼び出し側）。
 */
export function applyReadingDictionary(
  text: string,
  rules: ReadingRule[],
): string {
  if (!text || rules.length === 0) return text;

  // regex ルールは sticky で 1 回だけ precompile する（text ルールは null）。不正ソースは握りつぶして no-op に
  // する（内蔵は静的で通常起きないが、1 件の破損で読み上げ全体を落とさないための防御）。
  // precompile は「1 呼び出し（＝1 コメント）につき 1 回」で module レベルにキャッシュしない。純関数・ステートレスを
  // 保つ意図的な割り切りで、内蔵ルール数本の compile ＋ O(text長 × ルール数) は人間の投稿速度では無視できる。
  // 再検討条件: 高頻度・大量ルールでこの compile が実測でホットになったら module レベルの compile キャッシュへ寄せる。
  const compiled: (RegExp | null)[] = rules.map((rule) => {
    if (rule.kind !== "regex") return null;
    try {
      return new RegExp(rule.surface, REGEX_FLAGS);
    } catch {
      return null;
    }
  });

  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    let bestLen = 0;
    let bestReading: string | null = null;
    for (let k = 0; k < rules.length; k++) {
      const rule = rules[k];
      let matchLen = 0;
      if (rule.kind === "text") {
        if (rule.surface.length > 0 && text.startsWith(rule.surface, i)) {
          matchLen = rule.surface.length;
        }
      } else {
        const re = compiled[k];
        if (re) {
          re.lastIndex = i;
          const m = re.exec(text);
          // sticky なので m.index === i は保証されるが、防御的に確認する。空一致（長さ 0）は無視する。
          if (m && m.index === i && m[0].length > 0) matchLen = m[0].length;
        }
      }
      // 厳密な > 比較なので、同一長では先に定義したルール（小さい k）が勝つ＝定義順タイブレーク。
      if (matchLen > bestLen) {
        bestLen = matchLen;
        bestReading = rule.reading;
      }
    }
    // reading が空文字のルールは一致部を「削除」する（bestReading !== null は満たすため）。内蔵は全件非空で無問題。
    // 再検討条件: 041b でユーザー入力辞書を重ねる際、空 reading を許すと文字が消えるため 041b 側で空 reading を
    // 弾く/無視する検証を入れること（本関数はユーザー入力を検証しない純適用層＝入力の健全性は呼び出し側の責務）。
    if (bestLen > 0 && bestReading !== null) {
      out += bestReading;
      i += bestLen;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/**
 * 内蔵の一般読み替え辞書（自前の独自データ・小規模で開始）。`OVERLAY_FONTS` と同じ「コード同梱の固定配列」方式。
 *
 * 方針:
 * - 網羅は狙わない。誤読が目立つ高頻度パターンだけを手書きし、不足は 041b のユーザー辞書で補う。
 * - スラング（草/乙/末尾 w）も含めるが、それが壊す常用語・英単語は「保護エントリ」を**より長い surface**で併記して守る
 *   （`applyReadingDictionary` の最長一致が保護を先取りする）。
 * - 英字略語は語境界 `\b` つき regex にし、"curl"→"cユーアールエル" のような部分一致の誤爆を防ぐ。
 * - 笑い/末尾 w は「w の直前がアルファベットでないときだけ わら」に変換する negative lookbehind 1 本に集約する
 *   （law/how/few は非変換・楽しいw/wwww は わら）。
 *
 * ライセンス: 上記はすべて日本語話者に自明なカタカナ読み（事実としての発音）を手書きしたもので、第三者辞書
 * （MeCab/NEologd/IPAdic/棒読みちゃん/VOICEVOX 同梱辞書）のデータ・コードを転載/機械変換していない。
 */
export const BUILTIN_READING_DICTIONARY: ReadingRule[] = [
  // --- 笑い（w） -------------------------------------------------------------
  // **前後どちらもアルファベットでない** w だけを笑いとして読み替える。law/how/few（直前が英字）と
  // was/want/wataru/William（直後が英字）は変換せず、楽しいw（直前が日本語・直後なし）・wwww（文頭）・
  // 空白/記号直後の w は変換する。URL 内の www は sanitizeForSpeech で除去済み。
  // w が 2 つ以上（末尾も含む）なら「わらわら」、1 つなら「わら」。最長一致トークナイザが w{2,} を先取りするため、
  // 連続 w はまとめて 1 回「わらわら」になる（wwww も わらわら で、回数には比例させない）。w{2,} を先に置く。
  //
  // ⚠ **後方境界 `(?![A-Za-z])` は 049 の実機確認で足した**（2026-07-31）。当初は直前しか見ておらず、
  //   **英単語・英字表示名の先頭 w がすべて「わら」に化けていた**——実機で
  //   `"that clutch was insane"` →「that clutch わらas insane」と読まれて発覚。049 で課金イベントの
  //   **投稿者名**も本辞書を通るようになり（`wataru` →「わらataru」／`William` →「わらilliam」）、
  //   英字表示名が高頻度で壊れるため実害が顕在化した。
  //   **笑いの w が英字に続くことは無いので、この境界で取りこぼす笑いはゼロ**（`wwwa` のような列は
  //   英単語の一部とみなして非変換＝安全側に倒す）。回帰は `readingDictionary.test.ts` で固定した。
  //
  // 既知の割り切り（いずれも網羅を狙わず・意図的に残す。不足は 041b のユーザー辞書で補う前提）:
  // - 全角ｗ（U+FF57）・全角略語は非対象（半角 w/W のみ）。頻出するなら 041b の内蔵追記候補にする。
  // - `i` フラグにより前後が非英字の単独大文字 W も笑い化する（例「ビタミンW」／表示名 `W` 1 文字）＝
  //   低頻度の false positive として残す（後方境界では防げない。防ぐには大文字単独を別ルールで除外することに
  //   なるが、「W」だけの表示名・語は稀で、笑いの大文字 W〔「WWW」等〕を落とす副作用のほうが大きい）。
  // - lookbehind 非対応の旧 webview では上の new RegExp が throw → try/catch で当該ルールのみ no-op に縮退し、笑い w
  //   だけ効かず他ルールは動く（＝安全側）。開発対象（macOS 13.3+ / WebView2 Chromium）では発生しない。
  { surface: "(?<![A-Za-z])w{2,}(?![A-Za-z])", reading: "わらわら", kind: "regex" },
  { surface: "(?<![A-Za-z])w(?![A-Za-z])", reading: "わら", kind: "regex" },

  // --- 保護（常用語）: 下のスラング単漢字より長いので最長一致で先取りされる ---------------------
  // 単漢字スラング（草/乙）が常用語を誤読するのを防ぐ高頻度ガード。網羅はしない（七草/早乙女/草案 等は残る）。
  { surface: "煙草", reading: "たばこ", kind: "text" },
  { surface: "草原", reading: "そうげん", kind: "text" },
  { surface: "草食", reading: "そうしょく", kind: "text" },
  { surface: "雑草", reading: "ざっそう", kind: "text" },
  { surface: "乙女", reading: "おとめ", kind: "text" },

  // --- スラング（単漢字・略語） ----------------------------------------------
  { surface: "草", reading: "くさ", kind: "text" },
  { surface: "乙", reading: "おつ", kind: "text" },
  { surface: "\\bkwsk\\b", reading: "くわしく", kind: "regex" },
  { surface: "\\bwktk\\b", reading: "わくわくてかてか", kind: "regex" },

  // --- 英語・tech 略語（語境界つきで部分一致の誤爆を防ぐ） ----------------------
  { surface: "\\bChatGPT\\b", reading: "チャットジーピーティー", kind: "regex" },
  { surface: "\\bAPI\\b", reading: "エーピーアイ", kind: "regex" },
  { surface: "\\bOBS\\b", reading: "オービーエス", kind: "regex" },
  { surface: "\\bURL\\b", reading: "ユーアールエル", kind: "regex" },
  { surface: "\\bPC\\b", reading: "ピーシー", kind: "regex" },
  { surface: "\\bOS\\b", reading: "オーエス", kind: "regex" },

  // --- 記号 -------------------------------------------------------------------
  { surface: "→", reading: "やじるし", kind: "text" },
];
