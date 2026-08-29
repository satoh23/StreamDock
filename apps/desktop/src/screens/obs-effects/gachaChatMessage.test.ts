import { describe, it, expect } from "vitest";
import { buildGachaChatMessage } from "./gachaChatMessage";
import { GACHA_UNNAMED_PRIZE_LABEL } from "./effectAssignments";
import { GACHA_VIEWER_NAME_MAX } from "./effectFire";

/**
 * ⚠⚠⚠ **063f: チャットへ書く本文の仕様。**
 *
 * ⚠⚠ **このファイルが固定しているのは 4 つ:**
 *
 * ① **`rare` で文面が変わる**（⚠ 閾値はここにも本体にも無い＝ `isGachaRarePrize` の持ち物）
 * ② **`prizeLabel` / `viewerName` をそのまま使う**（規則の再実装をしていない）
 * ③ ⚠⚠⚠ **§9: 本文に載るのは景品名と表示名だけ**——本文・視聴者 id・金額は**型として渡せない**
 * ④ ⚠⚠ **`@` を付けない／名前が無ければ代替名を作らない**（§9 追補の明示的な制約）
 *
 * ## ⚠⚠⚠ ③ をテストで書いていない理由（**型が先に落とすから**）
 *
 * `buildGachaChatMessage` の引数は [`GachaChatSource`]
 * （`prizeLabel` / `rare` / `viewerName` の 3 つ）なので、
 * **本文や視聴者 id を渡す・読む形が型として存在しない**——テストで「出ないこと」を書くより、
 * ⚠ **コンパイルが通らないほうが強い**（テストは消せるが、型は消すと本体が落ちる）。
 * ⚠⚠ **`GachaFireDetail` をそのまま受ける形へ広げると、この担保は消える。**
 *
 * ## ⚠ 「`isAllowedChatMessage` に落ちないこと」をここで検証しない理由（§8）
 *
 * 本文の検査の持ち主は sidecar の `isAllowedChatMessage` **1 か所だけ**である。
 * ⚠⚠ **ここに 2 通り目を書かないこと**——書くと片方だけ緩んだときに
 * 「保存できるのに送れない」「送れるのに保存できない」が起きる。
 * ⚠ 落ちる入力を作れない根拠（制御文字・長さ・空）は本体の JSDoc に置いてある。
 * ⇒ **落ちたときの見え方はテストできていない**（正直な限界）。
 */
describe("buildGachaChatMessage（063f）", () => {
  it("⚠⚠⚠ 引いた人の表示名と景品名の両方が入る", () => {
    expect(
      buildGachaChatMessage({
        prizeLabel: "大当たり",
        rare: false,
        viewerName: "視聴者A",
      }),
    ).toBe("🎉 視聴者A さんが「大当たり」を当てました！");
  });

  it("⚠⚠ レアなら文面が変わる（`rare` を無視していないこと）", () => {
    const base = { prizeLabel: "大当たり", viewerName: "視聴者A" };
    const hit = buildGachaChatMessage({ ...base, rare: false });
    const rare = buildGachaChatMessage({ ...base, rare: true });
    expect(rare).not.toBe(hit);
    expect(rare).toContain("レア");
    // ⚠ 名前と景品名の扱いは変わらない（頭が変わるだけ）。
    expect(rare).toContain("視聴者A さんが「大当たり」");
  });

  /**
   * ⚠⚠⚠ **§9 追補の明示的な制約**——付けると視聴者に通知が飛び、
   * **本人が望んでいない呼び出し**になる。
   */
  it("⚠⚠⚠ メンション（@）を付けない", () => {
    expect(
      buildGachaChatMessage({
        prizeLabel: "大当たり",
        rare: true,
        viewerName: "視聴者A",
      }),
    ).not.toContain("@");
  });

  /**
   * ⚠⚠⚠ **名前が無いときは代替名を作らない**（§9 追補）。
   * ⚠ 「名無しさん」等を発明すると**視聴者に対する嘘**になる。
   * ⚠⚠ **当選そのものは必ず出す**（名前が無いだけで黙らない）。
   */
  it("⚠⚠⚠ 表示名が null なら名前の部分ごと落とす（代替名を作らない）", () => {
    const message = buildGachaChatMessage({
      prizeLabel: "大当たり",
      rare: false,
      viewerName: null,
    });
    expect(message).toBe("🎉 「大当たり」が当たりました！");
    expect(message).not.toContain("さんが");
    expect(message).not.toContain("名無し");
  });

  /** ⚠ 空文字も `null` と同じに扱う（「 さんが」だけが出る壊れ方を型の外でも塞ぐ）。 */
  it("⚠ 表示名が空文字でも名前の部分は出ない", () => {
    expect(
      buildGachaChatMessage({
        prizeLabel: "大当たり",
        rare: false,
        viewerName: "",
      }),
    ).toBe("🎉 「大当たり」が当たりました！");
  });

  /**
   * ⚠⚠ **表示名の規則を再実装していないことの担保。**
   * 20 文字で切るのは `stageViewerName`（`effectFire.ts`）で、
   * ⚠ **ここは切らずにそのまま出す**（持ち主が 2 つになると片方だけずれる）。
   */
  it("⚠⚠⚠ 受け取った表示名を切り直さない（切るのは stageViewerName の仕事）", () => {
    // ⚠ 既に切られた後の値（20 文字 ＋ `…`）を渡す＝ そのまま出るはず。
    const cut = `${"あ".repeat(GACHA_VIEWER_NAME_MAX)}…`;
    expect(
      buildGachaChatMessage({
        prizeLabel: "大当たり",
        rare: false,
        viewerName: cut,
      }),
    ).toContain(cut);
    // ⚠⚠ **切っていないこと**（21 文字目の `…` が残っている）。
    expect(
      buildGachaChatMessage({
        prizeLabel: "大当たり",
        rare: false,
        viewerName: cut,
      }),
    ).not.toContain(`${"あ".repeat(GACHA_VIEWER_NAME_MAX)} さん`);
  });

  /**
   * ⚠⚠ 無名の景品は `gachaPrizeLabel` が [`GACHA_UNNAMED_PRIZE_LABEL`] に決めてからここへ来る。
   * ⚠ **この関数は「空だったら…」を 1 つも持たない**（持つと規則が 2 か所になる）。
   */
  it("⚠⚠ 受け取った景品の表示名を組み立て直さない（無名の既定もそのまま出る）", () => {
    expect(
      buildGachaChatMessage({
        prizeLabel: GACHA_UNNAMED_PRIZE_LABEL,
        rare: false,
        viewerName: "視聴者A",
      }),
    ).toContain(`「${GACHA_UNNAMED_PRIZE_LABEL}」`);
  });

  /**
   * ⚠⚠⚠ **改行を作らないこと**（`isAllowedChatMessage` が改行を拒否するので、
   * 入れると **sidecar がフレームごと捨てて 15 秒後にタイムアウト**する＝
   * 「送れたか分からない」という最も読めない壊れ方になる）。
   */
  it("⚠⚠⚠ 改行も制御文字も作らない（1 通で送れる形）", () => {
    const message = buildGachaChatMessage({
      prizeLabel: "長い名前でも 1 行",
      rare: true,
      viewerName: "視聴者A",
    });
    // ⚠ 正規表現ではなくコードポイントで見る（`no-control-regex` を避けるためと、
    //   sidecar の `isAllowedChatMessage` が同じ数え方をしているため）。
    const hasControl = [...message].some((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp < 0x20 || cp === 0x7f;
    });
    expect(hasControl).toBe(false);
  });

  /**
   * ⚠ 表示名は最長 20 コードポイント（＋`…`）、景品名は最長でも OBS のソース名（200 UTF-16 単位）。
   * ⇒ **定型部分を足しても 500 文字の上限に届かない**（切り詰めを書かなくてよい根拠）。
   * ⚠⚠ **ここで切り詰めを実装しないこと**——切り詰めると
   * 「送ったつもりの文と実際に流れた文が違う」状態を作る（`CHAT_MESSAGE_MAX_LENGTH` の注記が正）。
   */
  it("⚠ 最長の入力でも 500 文字に届かない（切り詰めを実装しなくてよい根拠）", () => {
    expect(
      buildGachaChatMessage({
        prizeLabel: "あ".repeat(200),
        rare: true,
        // ⚠ サロゲートペア（絵文字）で 20 コードポイント＝ UTF-16 では 40 単位になる最悪形。
        viewerName: `${"🎉".repeat(GACHA_VIEWER_NAME_MAX)}…`,
      }).length,
    ).toBeLessThan(500);
  });
});
