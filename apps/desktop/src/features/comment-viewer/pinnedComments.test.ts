import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CommentViewDto } from "./types";
import {
  PINNED_COMMENTS_KEY,
  PINNED_LIMIT,
  loadPinned,
  savePinned,
  toPinned,
  type PinnedComment,
} from "./pinnedComments";

/**
 * 046a: 固定コメント（ピン留め）のピンストアの仕様テスト。
 *
 * あるべき挙動（docs/tasks/046a-viewer-pin-comment.md 完了条件・親 046 の設計判断・docs/security.md §9）:
 * - 保存するのは**非機密の表示データのみ**。`author.avatar`（base64 data URI）は**保存しない**。
 * - 上限 `PINNED_LIMIT`（046a では 1＝単一ピン）で、先頭（最新）から N 件だけ残す。
 * - 046b が読む契約は **JSON 配列**。壊れた値でも表示が続くよう、丸ごと捨てる／要素だけ捨てるを使い分ける。
 * - 読み書きが失敗（プライベートモード・容量超過等）しても例外を投げず固定なしへ劣化する。
 */

const makeComment = (over: Partial<CommentViewDto> = {}): CommentViewDto => ({
  id: "c1",
  source: "twitch",
  author: { id: "u1", name: "Alice" },
  text: "hello",
  publishedAt: "2026-07-28T10:00:00Z",
  eventType: "chat",
  ...over,
});

const storedRaw = (): string | null => localStorage.getItem(PINNED_COMMENTS_KEY);

const storedKeys = (): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  return keys;
};

beforeEach(() => {
  localStorage.clear();
});

describe("pinnedComments 上限と往復", () => {
  it("046a の既定は単一ピン（PINNED_LIMIT === 1）", () => {
    // 「YouTube / Twitch のコメント固定と同じ体験にする」という 046a の確定事項を固定する。
    // 複数ピンへ広げるのは意図的な仕様変更なので、このテストを更新する形で行うこと。
    expect(PINNED_LIMIT).toBe(1);
  });

  it("未保存のときは空配列", () => {
    expect(loadPinned()).toEqual([]);
  });

  it("保存して読み直すと表示に必要なフィールドが往復する", () => {
    const pinned = toPinned(
      makeComment({
        id: "sc1",
        source: "youtube",
        text: "応援してます",
        eventType: "superchat",
        monetary: { amount: 1000, currency: "JPY" },
        monetaryAmount: "1,000 JPY",
      }),
    );
    savePinned([pinned]);
    expect(loadPinned()).toEqual([pinned]);
  });

  it("金額を持たない課金種別の内訳（monthCount/giftCount/tier）も往復する（要約文言が劣化しない）", () => {
    const pinned = toPinned(
      makeComment({
        id: "sub1",
        eventType: "subscription",
        text: "",
        monthCount: 3,
        tier: 1,
      }),
    );
    savePinned([pinned]);
    const [loaded] = loadPinned();
    expect(loaded.monthCount).toBe(3);
    expect(loaded.tier).toBe(1);
  });

  it("PINNED_LIMIT を超えて保存しても先頭（新しい方）から N 件だけ残る", () => {
    const many = Array.from({ length: PINNED_LIMIT + 2 }, (_, i) =>
      toPinned(makeComment({ id: `p${i}` })),
    );
    savePinned(many);
    // 書込側のクランプも見る（読込側だけでも load の結果は N 件になるため、ここが無いと save 側の
    // slice を消すミューテーションを素通りさせてしまう＝localStorage に余分が残り続ける）。
    expect(JSON.parse(storedRaw() ?? "[]")).toHaveLength(PINNED_LIMIT);
    const loaded = loadPinned();
    expect(loaded).toHaveLength(PINNED_LIMIT);
    expect(loaded.map((p) => p.id)).toEqual(
      many.slice(0, PINNED_LIMIT).map((p) => p.id),
    );
  });

  it("手で N 件超に書き換えられていても読み込み時にクランプする", () => {
    const many = Array.from({ length: PINNED_LIMIT + 2 }, (_, i) =>
      toPinned(makeComment({ id: `p${i}` })),
    );
    localStorage.setItem(PINNED_COMMENTS_KEY, JSON.stringify(many));
    expect(loadPinned()).toHaveLength(PINNED_LIMIT);
  });

  it("空配列を保存してもキーは残る（046b へ『解除』を伝えるため）", () => {
    savePinned([toPinned(makeComment())]);
    savePinned([]);
    expect(storedRaw()).toBe("[]");
    expect(loadPinned()).toEqual([]);
  });
});

describe("pinnedComments アバターを保存しない（§9・容量）", () => {
  it("toPinned は author.avatar を落とす", () => {
    const pinned = toPinned(
      makeComment({
        author: { id: "u1", name: "Alice", avatar: "data:image/png;base64,AAAA" },
      }),
    );
    expect(pinned.author).toEqual({ id: "u1", name: "Alice" });
    expect("avatar" in pinned.author).toBe(false);
  });

  it("保存された JSON に data URI が現れない", () => {
    savePinned([
      toPinned(
        makeComment({
          author: {
            id: "u1",
            name: "Alice",
            avatar: "data:image/png;base64,AAAA",
          },
        }),
      ),
    ]);
    expect(storedRaw()).not.toContain("data:image");
    expect(storedRaw()).not.toContain("avatar");
  });

  it("保存済み JSON に avatar が混じっていても読み込みで落ちる（外部から書かれた場合の防御）", () => {
    localStorage.setItem(
      PINNED_COMMENTS_KEY,
      JSON.stringify([
        {
          ...toPinned(makeComment()),
          author: { id: "u1", name: "Alice", avatar: "data:image/png;base64,AAAA" },
        },
      ]),
    );
    const [loaded] = loadPinned();
    expect(loaded.author).toEqual({ id: "u1", name: "Alice" });
  });
});

describe("pinnedComments 壊れた値へのフォールバック", () => {
  it("JSON として壊れていれば空配列", () => {
    localStorage.setItem(PINNED_COMMENTS_KEY, "{not json");
    expect(loadPinned()).toEqual([]);
  });

  it("配列でない JSON（オブジェクト/文字列/null）は丸ごと空配列", () => {
    localStorage.setItem(PINNED_COMMENTS_KEY, JSON.stringify({ id: "c1" }));
    expect(loadPinned()).toEqual([]);
    localStorage.setItem(PINNED_COMMENTS_KEY, JSON.stringify("c1"));
    expect(loadPinned()).toEqual([]);
    localStorage.setItem(PINNED_COMMENTS_KEY, JSON.stringify(null));
    expect(loadPinned()).toEqual([]);
  });

  it("必須フィールドを欠く要素だけを捨て、正常な要素は残す", () => {
    const valid = toPinned(makeComment({ id: "ok1" }));
    localStorage.setItem(
      PINNED_COMMENTS_KEY,
      JSON.stringify([
        null,
        "文字列",
        { id: "no-source", author: { id: "u", name: "n" }, text: "", publishedAt: "x", eventType: "chat" },
        { ...valid, id: "" }, // id が空文字
        { ...valid, author: { id: "u1" } }, // name 欠落
        valid,
      ]),
    );
    expect(loadPinned()).toEqual([valid]);
  });

  it("未知の source / eventType の要素は捨てる（bindings の union 外は描けないため）", () => {
    const valid = toPinned(makeComment({ id: "ok1" }));
    localStorage.setItem(
      PINNED_COMMENTS_KEY,
      JSON.stringify([
        { ...valid, id: "bad-source", source: "niconico" },
        { ...valid, id: "bad-type", eventType: "cheer" },
        valid,
      ]),
    );
    expect(loadPinned()).toEqual([valid]);
  });

  it("任意フィールドの型が違うときはそのフィールドだけ落として要素は生かす", () => {
    const valid = toPinned(makeComment({ id: "ok1" }));
    localStorage.setItem(
      PINNED_COMMENTS_KEY,
      JSON.stringify([
        {
          ...valid,
          monetaryAmount: 1000, // 数値（本来は文字列）
          monetary: { amount: "1000", currency: "JPY" }, // amount が文字列
          monthCount: "3", // 文字列（本来は数値）
        },
      ]),
    );
    const [loaded] = loadPinned();
    expect(loaded.id).toBe("ok1");
    expect(loaded.monetaryAmount).toBeUndefined();
    expect(loaded.monetary).toBeUndefined();
    expect(loaded.monthCount).toBeUndefined();
  });

  it("localStorage 読取が例外でも空配列へフォールバック（表示は継続）", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPinned()).toEqual([]);
    spy.mockRestore();
  });

  it("localStorage 書込が例外でも投げない（プライベートモード・容量超過でも壊れない）", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const list: PinnedComment[] = [toPinned(makeComment())];
    expect(() => savePinned(list)).not.toThrow();
    spy.mockRestore();
  });
});

describe("pinnedComments 機密を持ち込まない（§9）", () => {
  it("作るキーはピンストアの 1 つだけで、機密を思わせるキーは作らない", () => {
    savePinned([toPinned(makeComment())]);
    const keys = storedKeys();
    expect(keys).toEqual([PINNED_COMMENTS_KEY]);
    expect(keys.some((k) => /password|secret|token/i.test(k))).toBe(false);
  });

  it("toPinned はフィールドを明示列挙するので、DTO に増えたフィールドは保存 JSON に載らない", () => {
    // §9 の核心的な不変条件のテスト。`CommentViewDto` は ts-rs 自動生成で将来フィールドが増える型なので、
    // toPinned をスプレッド（`{...c, author:{id,name}}`）に書き換えると機密フィールドが黙って localStorage へ
    // 載るようになる。avatar だけを見るケースはスプレッドでも通ってしまう（avatar は author の中なので落ちる）ため、
    // **保存 JSON のキー集合そのもの**を固定してミューテーションを検知する
    //（セキュリティレビュー S-4: これが無いとスプレッド化が素通りする）。
    const dto = {
      ...makeComment(),
      // 将来 DTO に機密フィールドが生えた状況を模す（型には無いのでキャストで押し込む）。
      accessToken: "should-never-be-persisted",
    } as CommentViewDto;

    savePinned([toPinned(dto)]);

    const stored: unknown = JSON.parse(storedRaw() ?? "[]");
    const [first] = stored as Record<string, unknown>[];
    expect(Object.keys(first).sort()).toEqual(
      ["author", "eventType", "id", "publishedAt", "source", "text"].sort(),
    );
    expect(storedRaw()).not.toContain("accessToken");
    expect(storedRaw()).not.toContain("should-never-be-persisted");
  });

  it("任意フィールドを持つ DTO でも、保存 JSON のキーは PinnedComment の範囲に収まる", () => {
    // 上のケースは任意フィールドが全部 undefined なので、埋まっているときの上限も固定しておく
    //（progress.md の「046b が読む契約」に載っている 12 キー＝author.avatar を除いた全体）。
    savePinned([
      toPinned(
        makeComment({
          eventType: "superchat",
          monetaryAmount: "1,000 JPY",
          monetary: { amount: 1000, currency: "JPY" },
          monthCount: 3,
          giftCount: 2,
          tier: 1,
          comboCount: 4,
        }),
      ),
    ]);

    const [first] = JSON.parse(storedRaw() ?? "[]") as Record<string, unknown>[];
    expect(Object.keys(first).sort()).toEqual(
      [
        "author",
        "comboCount",
        "eventType",
        "giftCount",
        "id",
        "monetary",
        "monetaryAmount",
        "monthCount",
        "publishedAt",
        "source",
        "text",
        "tier",
      ].sort(),
    );
    // author も id/name の 2 キーだけ（avatar が生えない）。
    expect(Object.keys(first.author as object).sort()).toEqual(["id", "name"]);
  });
});
