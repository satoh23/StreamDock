import { describe, it, expect } from "vitest";
import { composeSpeechText } from "./speechText";
// 049 レビュー（Q-7）: 「表示側は jewels に文言を作らない」という前提だけを直接固定するために使う
// （文言そのものの期待値には使わない＝下の ⚠ のとおり恒真式になるため）。
import { composeEventMessage } from "./viewerFormat";
import type { CommentViewDto } from "../../features/comment-viewer/types";

/**
 * 049: 読み上げ用テキスト組立（`composeSpeechText`）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/049-monetary-event-speech.md 完了条件）:
 * - membership / gift（Twitch=サブギフト・YouTube=メンバーシップギフト）/ subscription / jewels が**読み上げられる**。
 * - 課金イベントだけ**投稿者名を読む**（決定事項 1 の限定的な例外）。
 * - 通常チャット・スパチャ・ビッツ・ドネーション・未知種別は**従来と完全に同じ**＝`c.text` のまま・**名前を読まない**。
 * - `（TierN）` は「ティアN」へ整形する（丸括弧を読ませない）。
 *
 * ⚠ 期待文字列は**意図的にリテラルで書いている**（`composeEventMessage` を呼んで比べると恒真式になり、
 * 表示側の文言が変わったときに読み上げ側の退行を検知できなくなる）。
 */

/** 必須フィールドを埋めた最小の DTO を作る（テストごとに差分だけ上書きする）。 */
const dto = (over: Partial<CommentViewDto>): CommentViewDto => ({
  id: "c1",
  source: "twitch",
  author: { id: "u1", name: "Alice" },
  text: "",
  publishedAt: "2026-07-31T00:00:00Z",
  eventType: "chat",
  ...over,
});

describe("composeSpeechText: メンバーシップ / サブスク", () => {
  it("メンバーシップ継続は月数つきで読む（Tier は付かない）", () => {
    expect(
      composeSpeechText(
        dto({ source: "youtube", eventType: "membership", monthCount: 6 }),
      ),
    ).toBe("Aliceさんがメンバーシップを6ヶ月継続しました");
  });

  it("メンバーシップ新規加入は月数なしで読む", () => {
    expect(
      composeSpeechText(dto({ source: "youtube", eventType: "membership" })),
    ).toBe("Aliceさんがメンバーシップに加入しました");
  });

  // 049 フォローアップ: Tier は**名前の直後**（「ティア2のサブスクを…」）。末尾に付ける旧方式
  // （「〜継続しましたティア2」）は文が終わった後に階級が来て日本語として不自然だった。
  it("サブスク継続は「ティアNの」を名前の直後に置く（自由コメントは「。」で続ける）", () => {
    expect(
      composeSpeechText(
        dto({
          eventType: "subscription",
          monthCount: 3,
          tier: 2,
          text: "いつも応援してます！",
        }),
      ),
    ).toBe("Aliceさんがティア2のサブスクを3ヶ月継続しました。いつも応援してます！");
  });

  it("サブスク新規加入は加入文言（自由コメント無しなら「。」も付けない）", () => {
    expect(
      composeSpeechText(dto({ eventType: "subscription", tier: 1 })),
    ).toBe("Aliceさんがティア1のサブスクに加入しました");
  });

  it("Tier が無ければ差し込まない（表示と同じ文面のまま）", () => {
    expect(
      composeSpeechText(dto({ eventType: "subscription", monthCount: 3 })),
    ).toBe("Aliceさんがサブスクを3ヶ月継続しました");
  });
});

describe("composeSpeechText: ギフト（配信元で語彙が変わる）", () => {
  it("Twitch は「サブギフト」（件数と Tier）", () => {
    expect(
      composeSpeechText(
        dto({ source: "twitch", eventType: "gift", giftCount: 5, tier: 1 }),
      ),
    ).toBe("Aliceさんがティア1のサブギフトを5件贈りました");
  });

  // 043d: YouTube の gift は MEMBERSHIP_GIFTING_EVENT（贈与側）で届くため呼び名が異なる。
  it("YouTube は「メンバーシップギフト」（tier を持たないので Tier は付かない）", () => {
    expect(
      composeSpeechText(
        dto({ source: "youtube", eventType: "gift", giftCount: 5 }),
      ),
    ).toBe("Aliceさんがメンバーシップギフトを5件贈りました");
  });

  it("件数が無ければ件数を読まない", () => {
    expect(composeSpeechText(dto({ source: "twitch", eventType: "gift" }))).toBe(
      "Aliceさんがサブギフトを贈りました",
    );
  });
});

describe("composeSpeechText: Tier の読み上げ整形", () => {
  // `composeEventMessage` の接尾辞書式（全角括弧＋"Tier"＋数字）が変わると置換が黙って効かなくなり
  // 「かっこティア1かっこ」と読まれる。丸括弧が 1 つも残らないことで書式変更を検知する。
  it.each([
    { label: "サブスク", c: { eventType: "subscription" as const, monthCount: 3, tier: 2 } },
    { label: "サブギフト", c: { eventType: "gift" as const, giftCount: 5, tier: 1 } },
  ])("$label: 丸括弧を残さず「ティアN」と読む", ({ c }) => {
    const spoken = composeSpeechText(dto(c));
    expect(spoken).not.toContain("（");
    expect(spoken).not.toContain("）");
    expect(spoken).not.toContain("Tier");
    expect(spoken).toContain("ティア");
  });

  it("自由コメント側の「（Tier2）」は書き換えない（視聴者の文字列に手を入れない）", () => {
    expect(
      composeSpeechText(
        dto({ eventType: "subscription", monthCount: 3, tier: 2, text: "（Tier2）最高" }),
      ),
    ).toBe("Aliceさんがティア2のサブスクを3ヶ月継続しました。（Tier2）最高");
  });

  /**
   * 049 フォローアップ: 「どの種別に Tier を付けるか」という**表示側の判断を複製していない**ことを固定する。
   * `membership` は YouTube に階級の概念が無いため `composeEventMessage` が tier を無視する。
   * 読み上げ側が `c.tier` の有無だけを見て差し込む実装だと、異常データで**表示と読み上げが食い違う**。
   */
  it("membership は tier が入っていても差し込まない（表示側が付けない種別だから）", () => {
    expect(
      composeSpeechText(
        dto({
          source: "youtube",
          eventType: "membership",
          monthCount: 6,
          tier: 3,
        }),
      ),
    ).toBe("Aliceさんがメンバーシップを6ヶ月継続しました");
  });
});

describe("composeSpeechText: ジュエル（読み上げ専用の新設文言）", () => {
  it("金額があれば数値を読む", () => {
    expect(
      composeSpeechText(
        dto({
          source: "youtube",
          eventType: "jewels",
          monetary: { amount: 30, currency: "JEWELS" },
          monetaryAmount: "30 jewels",
        }),
      ),
    ).toBe("Aliceさんがジュエルを30贈りました");
  });

  it("monetary が無ければ数を省く", () => {
    expect(
      composeSpeechText(dto({ source: "youtube", eventType: "jewels" })),
    ).toBe("Aliceさんがジュエルを贈りました");
  });

  // 「ジュエルを0贈りました」は日本語として破綻するため、異常値は「数なし」へ倒す。
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "amount が %p のときは数を省く",
    (amount) => {
      expect(
        composeSpeechText(
          dto({
            source: "youtube",
            eventType: "jewels",
            monetary: { amount, currency: "JEWELS" },
          }),
        ),
      ).toBe("Aliceさんがジュエルを贈りました");
    },
  );

  // 043e: combo 更新は mergeComments の `updated` に載り `added` へ来ないので再読み上げは起きないが、
  // 初回到達時に値が入っていても読まない（回数の意味が曖昧・文字数上限を無駄に使う）。
  it("comboCount は読まない", () => {
    expect(
      composeSpeechText(
        dto({
          source: "youtube",
          eventType: "jewels",
          monetary: { amount: 90, currency: "JEWELS" },
          comboCount: 3,
        }),
      ),
    ).toBe("Aliceさんがジュエルを90贈りました");
  });

  // dev-mock だけが text="投げ銭ジュエル 🎁" を入れている。連結すると dev と本番で読みが変わり、
  // dev 確認が本番の担保にならなくなる（本タスクが直した罠そのもの）。
  it("本文があっても連結しない（dev-mock と本番で読みを一致させる）", () => {
    expect(
      composeSpeechText(
        dto({
          source: "youtube",
          eventType: "jewels",
          monetary: { amount: 30, currency: "JEWELS" },
          text: "投げ銭ジュエル 🎁",
        }),
      ),
    ).toBe("Aliceさんがジュエルを30贈りました");
  });

  /**
   * 049 レビュー（Q-7）: `composeSpeechText` が jewels 分岐を `composeEventMessage` **より前**に置ける前提
   * ＝「表示側は jewels に文言を作らない」（043b の意図的な設計・金額バッジと重複するため）を固定する。
   *
   * この前提が崩れた（表示側が jewels にも文言を付けた）とき、現状の実装は読み上げ専用文言で
   * **黙ってそれを覆い隠す**ため、表示と読みが乖離し「文言を二重管理しない」という本タスクの前提が壊れる。
   * ここが落ちたら、jewels の読み上げ専用文言を捨てて `composeEventMessage` の再利用へ寄せるか、
   * 両者が別物であることを意図として明記し直すかを判断すること。
   */
  it("表示側は jewels に文言を作らない（読み上げ専用文言と二重にならない前提）", () => {
    expect(
      composeEventMessage({
        eventType: "jewels",
        source: "youtube",
        author: { name: "Alice" },
      }),
    ).toBeNull();
  });
});

describe("composeSpeechText: 課金イベント以外は従来どおり（名前を読まない）", () => {
  // 049 の完了条件「通常チャット・スパチャの読み上げは従来と完全に同じ」を固定する。
  // bits は eventType="superchat" ＋ currency="BITS" で届くため、種別としては superchat の一種。
  it.each([
    { label: "通常チャット", c: { eventType: "chat" as const } },
    { label: "スーパーチャット", c: { eventType: "superchat" as const, monetary: { amount: 500, currency: "JPY" } } },
    { label: "ビッツ", c: { eventType: "superchat" as const, monetary: { amount: 100, currency: "BITS" } } },
    { label: "ドネーション", c: { eventType: "donation" as const, monetary: { amount: 10, currency: "USD" } } },
    // 未知種別（将来 provider 側が増やす）も無害に本文へ劣化する。union に無い値なので二重アサーションで作る。
    { label: "未知の種別", c: { eventType: "poll" as unknown as CommentViewDto["eventType"] } },
  ])("$label: 本文をそのまま返し、投稿者名を含まない", ({ c }) => {
    const spoken = composeSpeechText(dto({ ...c, text: "こんにちは" }));
    expect(spoken).toBe("こんにちは");
    expect(spoken).not.toContain("Alice");
  });

  it("本文が空なら空のまま（後段の空判定で読み上げをスキップできる）", () => {
    expect(composeSpeechText(dto({ eventType: "chat", text: "" }))).toBe("");
  });
});

/**
 * 049 レビュー（Q-8）: **種別の網羅を型で強制する**。
 *
 * `composeEventMessage` の `default` が null を返し `c.text` へ劣化する設計をそのまま踏襲しているため、
 * provider が新しい課金種別（`text` が空のもの）を足すと **また誰も気付かないまま無音**になる
 * ——049 が直した穴がそっくり再発する。
 *
 * `composeEventMessage` の引数型（`EventMessageInput.eventType`）は `string` なので `satisfies never` 等の
 * 網羅チェックは効かない。そこで**この表を `Record<CommentEventType, …>` にする**ことで、bindings の union に
 * 種別が増えた瞬間に**キー不足でコンパイルが落ち**、実装者に「読み上げをどうするか」の判断を強制する。
 *
 * - `"summary"` … 本文が空でも要約文言が読まれる（無音にならない）
 * - `"body-only"` … 本文のみを読む＝本文が空なら読まない（投稿者名も読まない現行方針）
 */
const SPEECH_KIND: Record<CommentViewDto["eventType"], "summary" | "body-only"> =
  {
    chat: "body-only",
    superchat: "body-only", // ビッツ（currency=BITS）もこの種別で届く
    donation: "body-only",
    membership: "summary",
    subscription: "summary",
    gift: "summary",
    jewels: "summary",
    // 062a: レイドは**読み上げ対象外**（決定⑦）。`composeEventMessage` に raid 分岐を足さないので
    //   null が返り `c.text`（実データでは空文字）へ落ち、`ttsQueue.enqueue` の空判定で読まれない。
    //   ＝「何もしない」ことが実装そのもの。理由と再修正トリガーは `speechText.ts` の JSDoc を正とする。
    raid: "body-only",
    // 063e: チャンネルポイントは **`chat` と同じ body-only**（決定・2026-08-25）。
    //   ⚠⚠ **新しい能力は増えない**——`chat` は既に本文が全文読まれているので、`user_input` を
    //   同じ扱いにするだけである。⚠ 優先読み上げは `isMonetaryEvent` を見ており、チャネポは
    //   `MONETARY_EVENT_TYPES` に入れていないので**優先キューには載らない**（穴 A に自動追従）。
    //   ⚠⚠ `summary` を選ばなかった理由がもう 1 つある: 要約文には**投稿者名が入る**ため、
    //   docs/security.md §1 の 049 追補「合成テキストに投稿者名が乗るのは**課金イベントに限る**」の
    //   対象が広がってしまう。body-only なら §1 は 1 文字も変わらない。
    //   ⚠ 入力なしの報酬は `c.text` が空 → `ttsQueue.enqueue` の空判定で無音になる。
    channelpoint: "body-only",
  };

describe("composeSpeechText: 種別の網羅（新種別の追従漏れで無音に戻らないこと）", () => {
  it.each(Object.entries(SPEECH_KIND))(
    "%s は %s として扱う",
    (eventType, kind) => {
      const spoken = composeSpeechText(
        dto({ eventType: eventType as CommentViewDto["eventType"], text: "" }),
      );
      expect(spoken === "" ? "body-only" : "summary").toBe(kind);
    },
  );
});
