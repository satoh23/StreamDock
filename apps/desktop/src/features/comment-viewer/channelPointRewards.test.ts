import { describe, it, expect, beforeEach } from "vitest";
import {
  CHANNEL_POINT_REWARDS_MAX,
  loadRecentChannelPointRewards,
  rememberChannelPointRewards,
} from "./channelPointRewards";
import { CHANNEL_POINT_REWARDS_KEY } from "./overlaySettings";

/**
 * ⚠⚠⚠ **063e 段 3: 「最近届いた報酬名」の記録**（割り当て画面のチップの出どころ）。
 *
 * ⚠ 依頼者＝「**極力画面操作は少なく、簡潔に設定できる方が良い**」。
 * ⇒ 押すだけで欄に入る候補を出すのがこのモジュールの唯一の目的である。
 *
 * ⚠⚠ **ここで固定する不変条件は 3 つ**:
 *   1. **§9: 報酬名しか載らない**（呼び出し側が本文や表示名を渡す口を作っていないこと）
 *   2. ⚠⚠⚠ **中身が変わらないなら書かない**（書くと `storage` が他窓へ飛ぶ＝毎秒再描画になる）
 *   3. 壊れた保存値は**その要素だけ**捨てる（候補が全部消えない）
 */
const raw = (): string | null =>
  localStorage.getItem(CHANNEL_POINT_REWARDS_KEY);

describe("063e 段 3: channelPointRewards", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("届いた報酬名を覚える（新しいものが先頭）", () => {
    expect(rememberChannelPointRewards(["A", "B"])).toBe(true);
    // ⚠ バッチの後ろほど新しいので、B が先頭に来る。
    expect(loadRecentChannelPointRewards()).toEqual(["B", "A"]);
  });

  it("報酬名を持たないコメント（undefined）は無視する", () => {
    expect(rememberChannelPointRewards([undefined, undefined])).toBe(false);
    expect(raw()).toBeNull();
  });

  it("空配列でも落ちない・書かない", () => {
    expect(rememberChannelPointRewards([])).toBe(false);
    expect(raw()).toBeNull();
  });

  /**
   * ⚠⚠⚠ **これが本モジュールでいちばん重要な性質である。**
   * localStorage への書き込みは**他窓へ `storage` イベントを撒く**ので、
   * コメントが来るたびに書くと **割り当て画面が毎秒再描画される**
   * （＝入力中の欄からフォーカスが飛ぶ形の事故になりうる）。
   */
  it("⚠⚠⚠ 同じ報酬が続けて来ても、中身が変わらなければ書かない", () => {
    rememberChannelPointRewards(["A"]);
    const before = raw();
    expect(rememberChannelPointRewards(["A"])).toBe(false);
    expect(raw()).toBe(before);
  });

  it("⚠⚠ 既知の報酬が「先頭以外」に居るときは書く（順序を新しいほうへ寄せる）", () => {
    rememberChannelPointRewards(["A", "B"]); // → ["B", "A"]
    expect(rememberChannelPointRewards(["A"])).toBe(true);
    expect(loadRecentChannelPointRewards()).toEqual(["A", "B"]);
  });

  it("重複は 1 つに畳む（同じバッチ内でも）", () => {
    rememberChannelPointRewards(["A", "A", "A"]);
    expect(loadRecentChannelPointRewards()).toEqual(["A"]);
  });

  it(`上限 ${CHANNEL_POINT_REWARDS_MAX} 件を超えたら古いほうから落ちる`, () => {
    for (let i = 0; i < CHANNEL_POINT_REWARDS_MAX + 3; i += 1) {
      rememberChannelPointRewards([`R${i}`]);
    }
    const list = loadRecentChannelPointRewards();
    expect(list).toHaveLength(CHANNEL_POINT_REWARDS_MAX);
    // ⚠ 最新が先頭・いちばん古い R0 は落ちている。
    expect(list[0]).toBe(`R${CHANNEL_POINT_REWARDS_MAX + 2}`);
    expect(list).not.toContain("R0");
  });

  it("⚠ 空文字・空白のみは覚えない", () => {
    expect(rememberChannelPointRewards(["", "   "])).toBe(false);
    expect(raw()).toBeNull();
  });

  /**
   * ⚠⚠⚠ **制御文字は必ずエスケープ（`\u0000` の形）で書くこと**（リテラルの NUL を埋め込まない）。
   * 埋め込むと `git` がこのファイルを**バイナリ扱い**にして
   * ⚠ **差分に中身が出なくなり、`grep -rn` も黙って素通りする**
   * （＝ §9 を grep で確かめる網が 1 枚死ぬ）。`effectAssignments.ts` の
   * `isControlCodePoint` の JSDoc が正——同ファイルのテストも全箇所エスケープで書いている。
   */
  it("⚠⚠ 制御文字を含む名前は覚えない（画面へそのまま描かせない）", () => {
    expect(rememberChannelPointRewards(["ガ\u0000チャ"])).toBe(false);
    expect(raw()).toBeNull();
  });

  it("⚠ 45 文字を超える名前は覚えない（Twitch が作れない長さ）", () => {
    expect(rememberChannelPointRewards(["あ".repeat(46)])).toBe(false);
    expect(rememberChannelPointRewards(["あ".repeat(45)])).toBe(true);
  });

  /**
   * ⚠⚠ **localStorage は他窓からも手でも書ける**ので、読むたびに検証する
   * （`OBS_SOURCE_TEST_FIRE_KEY` の「localStorage を信用しない」と同じ姿勢）。
   */
  it("⚠⚠ 壊れた要素はその要素だけ捨てる（候補が全部消えない）", () => {
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(["OK", 123, null, { a: 1 }, "", "ガ\u0000チャ", "OK2"]),
    );
    expect(loadRecentChannelPointRewards()).toEqual(["OK", "OK2"]);
  });

  it("不正 JSON・配列でない値・未保存は空配列へ倒す", () => {
    expect(loadRecentChannelPointRewards()).toEqual([]);
    localStorage.setItem(CHANNEL_POINT_REWARDS_KEY, "{");
    expect(loadRecentChannelPointRewards()).toEqual([]);
    localStorage.setItem(CHANNEL_POINT_REWARDS_KEY, JSON.stringify({ a: 1 }));
    expect(loadRecentChannelPointRewards()).toEqual([]);
  });

  it("⚠ 保存値が上限を超えていても、読み出しは上限で止める", () => {
    localStorage.setItem(
      CHANNEL_POINT_REWARDS_KEY,
      JSON.stringify(
        Array.from({ length: 50 }, (_, i) => `R${i}`),
      ),
    );
    expect(loadRecentChannelPointRewards()).toHaveLength(
      CHANNEL_POINT_REWARDS_MAX,
    );
  });

  /**
   * ⚠⚠⚠ **§9: 載るのは報酬名だけ**であることを、保存値そのもので確かめる。
   * ⚠ 呼び出し側（`CommentViewerApp`）は `c.rewardTitle` しか渡さないので型でも守られているが、
   * **保存値を直接見る網を 1 枚置いておく**（型を緩めた変更が入ったときに気づける）。
   */
  it("⚠⚠⚠ §9: 保存値に載るのは報酬名だけ（本文も表示名も混ざらない）", () => {
    rememberChannelPointRewards(["ガチャを引く"]);
    expect(JSON.parse(raw() ?? "[]")).toEqual(["ガチャを引く"]);
  });
});
