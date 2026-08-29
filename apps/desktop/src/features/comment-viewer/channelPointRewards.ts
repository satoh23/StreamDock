import { CHANNEL_POINT_REWARDS_KEY } from "./overlaySettings";

/**
 * ⚠⚠⚠ **063e 段 3: 最近届いたチャンネルポイント報酬の名前**（コメビュ窓が書き、割り当て画面が読む）。
 *
 * ## ⚠⚠ これは設定ではなく**観測値**である
 *
 * 依頼者の要望は「**極力画面操作は少なく、簡潔に設定できる方が良い**」。
 * エフェクト画面の「チャンネルポイント」ブロックには**カスタム報酬ごとの行**が並び、
 * 各行に対象の報酬名を打つ欄があるが、
 * ⚠⚠⚠ **打ち間違えると黙って鳴らない**（061a Q-1 が最も嫌う壊れ方）。
 * ⚠ 段 3-c で総称の受け皿を廃止したので、**打ち間違いは「別の演出が出る」ではなく「何も出ない」**になる。
 * ⇒ **実際に届いた名前をそのまま押せる**ようにして、操作を「チップを 1 回」まで減らす。
 *
 * ⚠ **手入力を置き換えるものではない**——ここが空でも欄には打てる。
 * 空になるのは「まだ 1 件も届いていない」ときで、⚠⚠ **配信者は自分のチャンネルの
 * チャンネルポイントを自分では引き換えられない可能性が高い**（未確認）。
 * ⇒ **設定したい時点でここが空**という事態は普通に起こる。だから主は手入力である。
 *
 * ## ⚠ 置き場所が `features/` なのは、**両方の窓から import されるから**
 *
 * 書き手は `screens/comment-viewer/CommentViewerApp.tsx`（コメビュ窓）、
 * 読み手は `screens/obs-effects/EffectAssignmentCard.tsx`（main 窓）である。
 * ⚠ `screens/` に置くと片方が他方の画面を import することになる
 * （`OBS_SOURCE_LIST_KEY` の読み書きと同じ非対称・同じ扱い）。
 *
 * ## §9
 *
 * ⚠⚠ 扱うのは **`reward.title`＝配信者自身が Twitch で付けた名前**だけである
 * （`prizeLabel` や OBS のソース名と同じ「ユーザー自身の設定値」の側）。
 * ⚠⚠⚠ **引き換えた視聴者の名前も本文（`user_input`）も、この経路へ渡す口を作らないこと**——
 * 渡した瞬間に「第三者のコメント本文が localStorage に残る」ことになる。
 * ⚠ 呼び出し側は `CommentViewDto.rewardTitle` **だけ**を渡すこと（型でそうなっている）。
 *
 * ⚠ **報酬名が第三者データでない根拠**（063e 段 3 レビュー S-1）: `reward.title` を書けるのは
 * **配信者本人**と、**配信者自身が `channel:manage:redemptions` を許可したアプリ**だけである
 * （視聴者もモデレーターも書けない。購読はブロードキャスター本人のトークンでしか通らないので、
 * 届く報酬名も必ず自チャンネルのものになる）。
 * ⚠⚠ 「第三者が影響できる経路が**ゼロ**」ではない——**配信者が入れた bot** が報酬名を作る形はありうる。
 * それは OBS のソース名（ユーザーが入れたツールが名前を付ける）と**同じ信頼水準**なので受容している。
 * **再修正トリガー＝ここへ `title` 以外（`user_input` / 引き換えた人の名前 / 報酬 id）を載せたくなったとき。**
 * そのときは「レビュー必須条件」の localStorage 追補（第三者の個人データの永続化）に**該当する**ので、
 * `docs/security.md` の更新と security-review を先に通すこと。
 *
 * ## ⚠ `no-console` の対象外である（意図的・記録）
 *
 * `eslint.config.js` の `no-console: "error"` は `src/screens/obs-effects/**` と
 * `src/features/obs-effects/**` に効いており、⚠ **このファイル（`features/comment-viewer/`）は外**である。
 * 修正不要と判断した理由＝**扱う値が第三者データではない**（上記）ので §9 の観点で守るものが無く、
 * スコープを `features/comment-viewer/**` 全体へ広げると**第三者データと無関係な既存モジュールまで巻き込む**
 * （061i レビュー S-6 が `components/**` について採ったのと同じ判断）。
 * ⚠ **このファイルにログを 1 行も書かないこと**（現在 0 行）。
 * **再修正トリガー＝ここに `user_input` / 表示名など第三者データが流れ込むようになったとき。**
 * そのときは lint スコープにこのファイルを名指しで足すこと。
 */

/**
 * 覚えておく件数。
 *
 * ⚠ **選択肢として一覧できる上限**であって、報酬の数の上限ではない。
 * ⚠⚠ 少なすぎると「ガチャ用の報酬が押し出される」、多すぎるとチップが画面を埋める。
 * ⇒ 配信で同時に走るカスタム報酬の実数（数個〜十数個）の下側に置く。
 * ⚠ **超えたぶんは古いほうから落ちる**（新しい順に持つ）。
 */
export const CHANNEL_POINT_REWARDS_MAX = 8;

/**
 * 1 件あたりの上限（文字数）。
 *
 * ⚠⚠ **`effectAssignments.ts` の `REWARD_TITLE_MAX_LENGTH`（45）と同じ根拠**
 * （Twitch のカスタム報酬タイトルの上限）。⚠ **あちらを import しないのは、
 * `features/` → `screens/` の層の逆転を作らないため**である。
 * ⚠⚠⚠ **片方だけ変えないこと**——ここだけ短いと「押せるのに保存で落ちる」、
 * ここだけ長いと「押したのに当たらない」（どちらも黙って起きる）。
 * 一致は `EffectAssignmentCard.test.tsx` が固定している。
 */
const REWARD_TITLE_MAX = 45;

/**
 * 制御文字を 1 文字でも含むか。⚠ **コードポイント単位**で見る（サロゲートペアを割らない）。
 *
 * ⚠⚠ `effectAssignments.ts` の `hasControlChar` と**同じ規則を書いている**
 * （あちらは非 export のうえ `screens/` に在り、`features/` から引くと層が逆転する）。
 * ⚠ 判定の中身は 1 行なので写しても drift しにくいが、**片方を変えるときは両方見ること。**
 *
 * ⚠ **C1（`U+0080`〜`U+009F`）と双方向制御（`U+202E` 等）は弾いていない**（意図的・記録）。
 * 修正不要と判断した理由＝**リポジトリ全体で同じ規則**（`isControlCodePoint`）を使っており、
 * ここだけ厳しくすると「保存では通るのにチップに出ない」という**規則の 2 通り化**を作るため。
 * 実害も無い——値は**配信者自身が付けた報酬名**で、チップは React がエスケープして描く。
 * **再修正トリガー＝`isControlCodePoint` の側を広げる日**（そのときは必ずここも同時に広げること）。
 */
const hasControlChar = (s: string): boolean => {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && (cp < 0x20 || cp === 0x7f)) return true;
  }
  return false;
};

/** 受け入れてよい報酬名か（型・空・上限・制御文字）。 */
const isUsable = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim() !== "" &&
  [...value].length <= REWARD_TITLE_MAX &&
  !hasControlChar(value);

/**
 * 覚えている報酬名を読む（新しい順）。
 *
 * ⚠⚠ **読むたびに検証する**（localStorage は**他窓からも手でも書ける**ので、
 * 書いた時点の検証を信用しない＝`OBS_SOURCE_TEST_FIRE_KEY` の注記と同じ姿勢）。
 * ⚠ 壊れていたら**その要素だけ捨てる**。キーごと捨てないのは、
 * 1 件の破損で**押せる候補が全部消える**ほうが分かりにくいためである。
 * ⚠ 例外・不正 JSON は**空配列**へ倒す（＝チップが出ないだけ・手入力は効く）。
 */
export function loadRecentChannelPointRewards(): string[] {
  try {
    const raw = localStorage.getItem(CHANNEL_POINT_REWARDS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (!isUsable(item)) continue;
      // ⚠ 重複も落とす（手で編集された場合に同じチップが 2 つ出ない）。
      if (out.includes(item)) continue;
      out.push(item);
      if (out.length >= CHANNEL_POINT_REWARDS_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 届いた報酬名を覚える。**新しいものが先頭**・重複なし・上限まで。
 *
 * @param names このバッチで届いた報酬名（`undefined` が混ざってよい＝報酬名を持たないコメント）
 * @returns 実際に書き込んだら `true`（⚠ テストと呼び出し側の早期 return の両方が見る）
 *
 * ⚠⚠⚠ **中身が変わらないときは書かない。** localStorage への書き込みは
 * **他窓へ `storage` イベントを撒く**ので、コメントが来るたびに書くと
 * **割り当て画面が毎秒再描画される**（入力中の欄からフォーカスが飛ぶ形の事故になりうる）。
 * ⇒ **新しい名前が 1 つも無ければ何もしない**のが、この関数のいちばん重要な性質である。
 */
export function rememberChannelPointRewards(
  names: readonly (string | undefined)[],
): boolean {
  // ⚠ バッチ内の新しい順を保つ（後ろのコメントほど新しいので逆順に見る）。
  const incoming: string[] = [];
  for (let i = names.length - 1; i >= 0; i -= 1) {
    const name = names[i];
    if (!isUsable(name)) continue;
    if (incoming.includes(name)) continue;
    incoming.push(name);
  }
  if (incoming.length === 0) return false;

  const current = loadRecentChannelPointRewards();
  // ⚠ 既に全部覚えていて**順序も先頭から一致**しているなら書かない（上記の理由）。
  //   ⚠⚠ 「含まれているか」だけで判定すると、**同じ報酬が繰り返し来るたびに
  //   先頭へ繰り上げる書き込みが走る**（＝ storage イベントが毎回飛ぶ）。
  const unchanged =
    incoming.length <= current.length &&
    incoming.every((name, i) => current[i] === name);
  if (unchanged) return false;

  const next = [...incoming];
  for (const name of current) {
    if (next.includes(name)) continue;
    next.push(name);
    if (next.length >= CHANNEL_POINT_REWARDS_MAX) break;
  }
  try {
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(next.slice(0, CHANNEL_POINT_REWARDS_MAX)),
    );
    return true;
  } catch {
    // ⚠ 書けなくても壊れ方は「チップが増えない」だけ（手入力は効く）＝握り潰してよい。
    return false;
  }
}
