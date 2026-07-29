import { describe, it, expect } from "vitest";
import {
  providerLabel,
  eventLabel,
  fmtNumber,
  fmtSuperchat,
  commentAmount,
  fmtDateTime,
  viewerIdOf,
  isMonetaryEvent,
  displayEventType,
  composeEventMessage,
  superchatTier,
  monetaryTone,
  avatarDataUri,
  authorInitial,
} from "./viewerFormat";

/**
 * 038b: 視聴者ビューの純粋な表示整形ヘルパの仕様テスト。
 *
 * 「こうあるべき（仕様）」を先に決めて表明する:
 * - 既知の値は表示名/日本語ラベルに、未知の値は "壊れず劣化" する（原文 or 空文字）。
 * - 金額は整形済み優先 → 数値(+通貨) → 無ければ null。0 は "0"（null にしない）。
 * - 日時は不正なら原文フォールバック（端末外へは出さないローカル整形）。
 */

describe("providerLabel", () => {
  it("既知 provider は表示名にする", () => {
    expect(providerLabel("twitch")).toBe("Twitch");
    expect(providerLabel("youtube")).toBe("YouTube");
  });
  it("未知 provider は原文のまま返す（壊れず劣化）", () => {
    expect(providerLabel("kick")).toBe("kick");
    expect(providerLabel("")).toBe("");
  });
});

describe("eventLabel", () => {
  it("既知イベントだけ日本語ラベルにする", () => {
    expect(eventLabel("superchat")).toBe("スーパーチャット");
    expect(eventLabel("bits")).toBe("ビッツ");
    expect(eventLabel("subscription")).toBe("サブスク");
    expect(eventLabel("membership")).toBe("メンバーシップ");
    // 043a/043d: 種別分離した gift/donation/jewels も必ずラベルを持つ（視聴者詳細パネルの
    // 空ラベルを避けるために追加した種別なので、ラベル欠落は仕様違反）。
    expect(eventLabel("gift")).toBe("ギフト");
    expect(eventLabel("donation")).toBe("ドネーション");
    expect(eventLabel("jewels")).toBe("ジュエル");
  });
  it("未知イベント（通常チャット等）はラベル無し＝空文字で劣化", () => {
    expect(eventLabel("chat")).toBe("");
    expect(eventLabel("")).toBe("");
  });
});

describe("fmtNumber", () => {
  it("ja-JP の桁区切りにする", () => {
    expect(fmtNumber(0)).toBe("0");
    expect(fmtNumber(1234567)).toBe("1,234,567");
  });
});

describe("fmtSuperchat", () => {
  it("通貨があれば『額 通貨』、無ければ額のみ", () => {
    expect(fmtSuperchat(500, "JPY")).toBe("500 JPY");
    expect(fmtSuperchat(1500)).toBe("1,500");
    expect(fmtSuperchat(1000, "")).toBe("1,000"); // 空通貨は falsy → 額のみ
  });
});

describe("commentAmount", () => {
  it("整形済み monetaryAmount を最優先する", () => {
    expect(commentAmount({ monetaryAmount: "¥500", amount: 999 })).toBe("¥500");
  });
  it("monetaryAmount が空なら amount(+通貨) にフォールバックする", () => {
    expect(commentAmount({ monetaryAmount: "", amount: 5 })).toBe("5");
    expect(commentAmount({ amount: 100, currency: "USD" })).toBe("100 USD");
    expect(commentAmount({ amount: 1000 })).toBe("1,000");
  });
  it("amount が 0 のときは '0' を表示（null にしない）", () => {
    expect(commentAmount({ amount: 0, currency: "USD" })).toBe("0 USD");
  });
  it("金額情報が無ければ null（金額バッジを出さない）", () => {
    expect(commentAmount({})).toBeNull();
    expect(commentAmount({ amount: undefined })).toBeNull();
  });
});

describe("fmtDateTime", () => {
  it("不正な日時は原文のままフォールバックする", () => {
    expect(fmtDateTime("not-a-date")).toBe("not-a-date");
    expect(fmtDateTime("")).toBe("");
  });
  it("正常な日時は整形される（原文 ISO とは異なり、年を含む）", () => {
    const out = fmtDateTime("2026-07-25T10:00:00Z");
    expect(out).not.toBe("2026-07-25T10:00:00Z");
    expect(out).toContain("2026");
  });
});

describe("isMonetaryEvent", () => {
  it("chat 以外の課金系は true（赤枠強調の対象）", () => {
    for (const t of [
      "superchat",
      "subscription",
      "membership",
      "gift",
      "donation",
      "jewels",
    ]) {
      expect(isMonetaryEvent(t)).toBe(true);
    }
  });
  it("chat/normal/未知は false（無装飾）", () => {
    expect(isMonetaryEvent("chat")).toBe(false);
    expect(isMonetaryEvent("normal")).toBe(false);
    expect(isMonetaryEvent("")).toBe(false);
  });
});

describe("displayEventType", () => {
  it("BITS 通貨の superchat はラベル用に bits へ振り分ける", () => {
    expect(
      displayEventType({ eventType: "superchat", monetary: { currency: "BITS" } }),
    ).toBe("bits");
  });
  it("実通貨の superchat は superchat のまま", () => {
    expect(
      displayEventType({ eventType: "superchat", monetary: { currency: "JPY" } }),
    ).toBe("superchat");
    expect(displayEventType({ eventType: "superchat" })).toBe("superchat");
  });
  it("superchat 以外はそのまま返す", () => {
    expect(displayEventType({ eventType: "subscription" })).toBe("subscription");
    expect(displayEventType({ eventType: "chat" })).toBe("chat");
  });
  // 043d: Jewels は currency="JEWELS" を持つが superchat ではないので bits 振り分けの対象外。
  // ここが superchat 側に流れるとラベルが「ビッツ」に化けるため固定する。
  it("jewels は currency を持っていても jewels のまま（bits/superchat に化けない）", () => {
    expect(
      displayEventType({ eventType: "jewels", monetary: { currency: "JEWELS" } }),
    ).toBe("jewels");
    expect(displayEventType({ eventType: "gift" })).toBe("gift");
  });
});

describe("superchatTier", () => {
  it("JPY（大単位通貨）は ¥100 系の閾値でティア分けする", () => {
    expect(superchatTier(50, "JPY")).toBe(0); // 境界未満でもティア0にクランプ
    expect(superchatTier(100, "JPY")).toBe(0);
    expect(superchatTier(150, "JPY")).toBe(0);
    expect(superchatTier(200, "JPY")).toBe(1);
    expect(superchatTier(500, "JPY")).toBe(2);
    expect(superchatTier(1000, "JPY")).toBe(3);
    expect(superchatTier(2000, "JPY")).toBe(4);
    expect(superchatTier(5000, "JPY")).toBe(5);
    expect(superchatTier(10000, "JPY")).toBe(6);
    expect(superchatTier(50000, "JPY")).toBe(6); // 上限超えも最上ティア
  });
  it("USD（小単位通貨）は $1 系の閾値でティア分けする", () => {
    expect(superchatTier(1, "USD")).toBe(0);
    expect(superchatTier(4.99, "USD")).toBe(1);
    expect(superchatTier(5, "USD")).toBe(2);
    expect(superchatTier(20, "USD")).toBe(4);
    expect(superchatTier(100, "USD")).toBe(6);
  });
  it("未知通貨は小単位表にフォールバックする（近似）", () => {
    expect(superchatTier(5, "XYZ")).toBe(2);
    expect(superchatTier(100, "XYZ")).toBe(6);
  });
  it("通貨コードは大小文字を無視する", () => {
    expect(superchatTier(500, "jpy")).toBe(2);
  });
  it("境界直下は 1 つ下のティアに留まる（>= 判定の確認）", () => {
    expect(superchatTier(199, "JPY")).toBe(0); // 200 未満
    expect(superchatTier(999, "JPY")).toBe(2); // 1000 未満
    expect(superchatTier(99, "USD")).toBe(5); // 100 未満
  });
  it("0/負値/NaN は無害にティア0へ劣化する（異常系）", () => {
    expect(superchatTier(0, "JPY")).toBe(0);
    expect(superchatTier(-100, "USD")).toBe(0);
    expect(superchatTier(Number.NaN, "JPY")).toBe(0);
  });
});

describe("composeEventMessage", () => {
  const alice = { name: "Alice" };
  it("サブスク: 継続は月数（＋Tier）、新規は加入", () => {
    expect(
      composeEventMessage({ eventType: "subscription", author: alice, monthCount: 3, tier: 2 }),
    ).toBe("Aliceさんがサブスクを3ヶ月継続しました（Tier2）");
    expect(
      composeEventMessage({ eventType: "subscription", author: alice, tier: 1 }),
    ).toBe("Aliceさんがサブスクに加入しました（Tier1）");
  });
  it("メンバーシップ: 継続は月数、新規は加入（Tier は付けない）", () => {
    expect(
      composeEventMessage({ eventType: "membership", author: alice, monthCount: 6 }),
    ).toBe("Aliceさんがメンバーシップを6ヶ月継続しました");
    expect(composeEventMessage({ eventType: "membership", author: alice })).toBe(
      "Aliceさんがメンバーシップに加入しました",
    );
  });
  it("ギフト: 件数（＋Tier）", () => {
    expect(
      composeEventMessage({ eventType: "gift", author: alice, giftCount: 5, tier: 1 }),
    ).toBe("Aliceさんがサブギフトを5件贈りました（Tier1）");
    expect(composeEventMessage({ eventType: "gift", author: alice })).toBe(
      "Aliceさんがサブギフトを贈りました",
    );
  });
  // 043d: YouTube の gift は MEMBERSHIP_GIFTING_EVENT（贈与側）で届くため「メンバーシップギフト」と呼ぶ。
  it("ギフト: YouTube は「メンバーシップギフト」（YouTube 側は tier を持たない）", () => {
    expect(
      composeEventMessage({
        eventType: "gift",
        source: "youtube",
        author: alice,
        giftCount: 5,
      }),
    ).toBe("Aliceさんがメンバーシップギフトを5件贈りました");
    expect(
      composeEventMessage({ eventType: "gift", source: "youtube", author: alice }),
    ).toBe("Aliceさんがメンバーシップギフトを贈りました");
  });
  // 043d: source 追加で Twitch 側の既存文言が変わらないこと（明示 twitch／source 未指定の両方）。
  it("ギフト: Twitch は「サブギフト」のまま（source 未指定も同じ＝後方互換）", () => {
    expect(
      composeEventMessage({
        eventType: "gift",
        source: "twitch",
        author: alice,
        giftCount: 5,
        tier: 1,
      }),
    ).toBe("Aliceさんがサブギフトを5件贈りました（Tier1）");
    expect(
      composeEventMessage({ eventType: "gift", author: alice, giftCount: 5, tier: 1 }),
    ).toBe("Aliceさんがサブギフトを5件贈りました（Tier1）");
  });
  it("金額を持つ種別（スパチャ/ドネーション/ジュエル）と chat は null（ラベル＋金額＋本文で表示）", () => {
    expect(composeEventMessage({ eventType: "superchat", author: alice })).toBeNull();
    expect(composeEventMessage({ eventType: "donation", author: alice })).toBeNull();
    expect(composeEventMessage({ eventType: "jewels", author: alice })).toBeNull();
    expect(composeEventMessage({ eventType: "chat", author: alice })).toBeNull();
  });
});

describe("viewerIdOf", () => {
  it("source と author.id を連結して安定キー（provider:providerUserId）にする", () => {
    expect(viewerIdOf({ source: "twitch", author: { id: "u1" } })).toBe("twitch:u1");
    expect(viewerIdOf({ source: "youtube", author: { id: "abc" } })).toBe("youtube:abc");
  });
  it("author.id は trim して Rust 側の key と完全一致させる", () => {
    expect(viewerIdOf({ source: "twitch", author: { id: "  u1  " } })).toBe("twitch:u1");
  });
});

/**
 * 047b: 課金コメントの配色キー（tone）。
 *
 * 仕様（こうあるべき）:
 * - スパチャ（実通貨）だけ**金額ティア** `t0..t6`。それ以外は種別ごとの単色キー。
 * - ビッツは `eventType="superchat"` ＋ `currency="BITS"` で届くので、ティア表ではなく "bits" へ振り替わる。
 * - 金額（monetary）を持たないスパチャは t0 の保険（043c から踏襲）。
 * - chat / 未知種別も壊れず t0 へ劣化する（呼び出し側は isMonetaryEvent で絞ってから使う）。
 *
 * この関数は本体の一覧カード・上部ティッカー・全文ダイアログ・固定帯の 4 箇所と OBS の投げ銭カードが
 * 共有する**単一の判定**なので、ここが崩れると 5 箇所の配色が同時に狂う。
 */
describe("monetaryTone 047b 課金コメントの配色キー", () => {
  it("スパチャ（実通貨）は金額ティアになる（JPY 系の閾値表）", () => {
    const sc = (amount: number) =>
      monetaryTone({ eventType: "superchat", monetary: { amount, currency: "JPY" } });
    expect(sc(100)).toBe("t0");
    expect(sc(200)).toBe("t1");
    expect(sc(500)).toBe("t2");
    expect(sc(1000)).toBe("t3");
    expect(sc(2000)).toBe("t4");
    expect(sc(5000)).toBe("t5");
    expect(sc(10000)).toBe("t6");
  });

  it("境界未満は最低ティア、上限超えは最上ティアへ飽和する（壊れない）", () => {
    const sc = (amount: number) =>
      monetaryTone({ eventType: "superchat", monetary: { amount, currency: "JPY" } });
    expect(sc(50)).toBe("t0");
    expect(sc(999999)).toBe("t6");
  });

  it("ビッツ（superchat + BITS）はティア表に落とさず bits へ振り替わる", () => {
    expect(
      monetaryTone({
        eventType: "superchat",
        monetary: { amount: 10000, currency: "BITS" },
      }),
    ).toBe("bits");
  });

  it("金額を持たないスパチャは t0 の保険へ落ちる", () => {
    expect(monetaryTone({ eventType: "superchat" })).toBe("t0");
  });

  it("ティア非対象の課金種別は種別ごとの単色キーになる", () => {
    expect(monetaryTone({ eventType: "subscription" })).toBe("subscription");
    expect(monetaryTone({ eventType: "membership" })).toBe("membership");
    expect(monetaryTone({ eventType: "gift" })).toBe("gift");
    expect(monetaryTone({ eventType: "donation" })).toBe("donation");
    expect(monetaryTone({ eventType: "jewels" })).toBe("jewels");
  });

  it("donation / jewels は実金銭でもティアにしない（ティアは YT 同様スパチャ専用）", () => {
    expect(
      monetaryTone({
        eventType: "donation",
        monetary: { amount: 20000, currency: "JPY" },
      }),
    ).toBe("donation");
    expect(
      monetaryTone({
        eventType: "jewels",
        monetary: { amount: 20000, currency: "JEWELS" },
      }),
    ).toBe("jewels");
  });

  it("chat / 未知種別は壊れず t0 へ劣化する", () => {
    expect(monetaryTone({ eventType: "chat" })).toBe("t0");
    expect(monetaryTone({ eventType: "unknown_future_type" })).toBe("t0");
  });
});

/**
 * 036a のガード（`avatarDataUri`）と頭文字フォールバック（`authorInitial`）。047b で `CommentList.tsx` の
 * file-local から移設したもの。**外部 URL を webview に踏ませない最終防波堤**なので、移設で緩んでいないことを
 * この層でも固定する（描画側の CommentList.test / MonetaryTicker.test でも別途見ている）。
 */
describe("avatarDataUri / authorInitial 036a のガード", () => {
  it("data: 始まりだけ通し、それ以外（外部 URL・空・未定義）は undefined へ落とす", () => {
    expect(avatarDataUri("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(avatarDataUri("https://evil.example/a.png")).toBeUndefined();
    expect(avatarDataUri("//evil.example/a.png")).toBeUndefined();
    expect(avatarDataUri("")).toBeUndefined();
    expect(avatarDataUri(undefined)).toBeUndefined();
  });

  // 047e（セキュリティレビュー S-A）: 呼び出し側は値を `background-image: url("${uri}")` へ補間する。
  // `background-image` は**カンマ区切りの多層指定が正当な単一値**なので、`data:` で始まりつつ `"` を含む値は
  // `url("data:…"), url("https://evil.example/x.png")` という 2 層背景を作れてしまい、2 層目が
  // **本体窓からの実 egress** になる（csp: null なので img-src の網も無い）。ガードの存在意義そのものなので固定する。
  it("data: 始まりでも url(\"…\") の文字列を閉じられる値は通さない（CSS 多層指定による外部 URL 混入を防ぐ）", () => {
    // 実際の攻撃形: 引用符で文字列を閉じ、2 層目に外部 URL を足す。
    expect(
      avatarDataUri('data:image/png;base64,AAA"),url("https://evil.example/x.png'),
    ).toBeUndefined();
    // 文字列を閉じうる文字は単体でも弾く（引用符・バックスラッシュ・生の改行）。
    expect(avatarDataUri('data:image/png;base64,AA"A')).toBeUndefined();
    expect(avatarDataUri("data:image/png;base64,AA\\A")).toBeUndefined();
    expect(avatarDataUri("data:image/png;base64,AA\nA")).toBeUndefined();
    expect(avatarDataUri("data:image/png;base64,AA\rA")).toBeUndefined();
  });

  // ⚠ 過剰なブロックは「アバターが 1 枚も出ない」という別の壊れ方になる。`;` と `,` は**あらゆる data URI の
  // 構造そのもの**なので、引用符の内側で無害なこれらを弾いてはいけない（初回実装で弾いてしまい全滅した）。
  it("正常な data URI は通る（`;` `,` `/` `=` `+` を含んでも落とさない）", () => {
    const png = "data:image/png;base64,AAAA";
    expect(avatarDataUri(png)).toBe(png);
    // converter（036b）が実際に emit する形（base64 は / + = を含みうる）。
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    expect(avatarDataUri(jpeg)).toBe(jpeg);
    const webp = "data:image/webp;base64,UklGRh4A+AABBg==";
    expect(avatarDataUri(webp)).toBe(webp);
  });

  it("頭文字はコードポイント単位で取る（絵文字始まりの表示名を壊さない）", () => {
    expect(authorInitial("Alice")).toBe("A");
    expect(authorInitial("  Bob ")).toBe("B");
    // サロゲートペア（charAt(0) だと孤立サロゲート「�」になる）。
    expect(authorInitial("😀ねこ")).toBe("😀");
    expect(authorInitial("   ")).toBe("?");
  });
});
