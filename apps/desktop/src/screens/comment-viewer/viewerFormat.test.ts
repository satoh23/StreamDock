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
  // 062a: 「レイドを課金扱いしない」を集合そのもので固定するために引く。
  MONETARY_EVENT_TYPES,
  EFFECT_CONDITION_EVENT_TYPES,
  // 065b: CSV 引き継ぎの表示整形。
  fmtImportedAmount,
  firstVisitAt,
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

/**
 * 062a: レイドは「ラベルは持つが課金ではない」という、既存にない組み合わせの種別。
 * ⚠ `MONETARY_EVENT_TYPES` に足すと、コメビュ本体のティア色カード・オーバーレイの投げ銭カード・
 * 課金ティッカー・読み上げの優先キュー・061 のエフェクト条件（`effectAssignments` はこの集合から
 * イベント条件の行を作る）が**いっせいに**発火する。ここはその境界を固定する。
 */
describe("062a レイドの表示上の位置づけ", () => {
  it("ラベルは「レイド」", () => {
    expect(eventLabel("raid")).toBe("レイド");
  });

  it("⚠⚠ 課金種別ではない（MONETARY_EVENT_TYPES に入れない）", () => {
    expect(isMonetaryEvent("raid")).toBe(false);
    expect(MONETARY_EVENT_TYPES.has("raid")).toBe(false);
  });

  it("⚠ 金額を持たない課金種別の日本語文（composeEventMessage）は作らない＝読み上げ対象外の実体", () => {
    // null が返ることで speechText が `c.text`（レイドでは空）へ落ち、ttsQueue の空判定で読まれない。
    expect(
      composeEventMessage({
        eventType: "raid",
        source: "twitch",
        author: { name: "RaiderChannel" },
      }),
    ).toBeNull();
  });
});

/**
 * 063e: チャンネルポイントの表示上の位置づけ（062a のレイドと**同型**のテスト）。
 *
 * ⚠⚠⚠ ここが緑であることが「課金の見た目が 1 つも発火しない」の担保である。
 * `MONETARY_EVENT_TYPES` にチャネポを足す変異は、ティア色カード・投げ銭ティッカー・
 * オーバーレイの課金カード・通知音の代表音・読み上げ優先キュー・061 のエフェクト条件を
 * **いっせいに発火させる**が、それを 1 か所で殺せるのはこのテストである。
 */
describe("063e チャンネルポイントの表示上の位置づけ", () => {
  it("ラベルは「チャンネルポイント」", () => {
    expect(eventLabel("channelpoint")).toBe("チャンネルポイント");
  });

  it("⚠⚠ 課金種別ではない（MONETARY_EVENT_TYPES に入れない）", () => {
    expect(isMonetaryEvent("channelpoint")).toBe(false);
    expect(MONETARY_EVENT_TYPES.has("channelpoint")).toBe(false);
  });

  it("⚠⚠ 課金集合は 6 値のまま（段 2 で足したのは別の定数であって、この集合ではない）", () => {
    expect(MONETARY_EVENT_TYPES.size).toBe(6);
  });

  // --- 063e 段 3-c: 条件表の集合（`EFFECT_CONDITION_EVENT_TYPES`） ------------------------------

  /**
   * ⚠⚠⚠ **段 3-c で `channelpoint` を条件表の集合から外した。**
   *
   * 依頼者＝「**そもそもチャンネルポイント交換しただけで表示したいエフェクトなんか無い**んだから、
   * チャンネルポイントにあるプルダウンを消して、**必ずカスタム報酬ごとに**設定する形に」。
   * ⇒ チャンネルポイントは **`effectAssignments.ts` の `{type:"channelpoint"; rewardTitle}`**
   * （id は `cp:n`）でだけ扱う。⚠ **種別としての行は存在しない。**
   *
   * ⚠⚠ **段 2 のテスト 2 本をここで反転している**（消すだけにすると、行を戻す変更に誰も気づけない）。
   */
  it("⚠⚠⚠ 段 3-c: 条件表の集合には入らない（＝割り当て表に「チャンネルポイント」の行は出ない）", () => {
    expect(EFFECT_CONDITION_EVENT_TYPES.has("channelpoint")).toBe(false);
  });

  /**
   * ## ⚠⚠⚠ 段 3-c: **ここで固定できていたものが 1 つ失われた**（正直に残す）
   *
   * 段 2 のこのテストは「**2 つの集合は別物**（課金 ⊊ 条件表）」を固定し、
   * `EFFECT_CONDITION_EVENT_TYPES = MONETARY_EVENT_TYPES` にする変異を殺していた。
   * ⚠ 段 3-c で差の 1 件（`channelpoint`）が消えた結果、⚠⚠⚠ **2 つの集合はいま
   * 偶然おなじ 6 値**であり、**統合する変異は全テストが緑のまま通る。**
   *
   * ⇒ ⚠⚠ **統合してはいけない理由は `viewerFormat.ts` の JSDoc にしか残っていない**
   * （答えている問いが違う＝①「これはお金か」／②「条件表に行を出すか」。
   * 統合すると、次に②だけを動かした日に①まで巻き添えで動く）。
   * ⚠ ここでは**中身が一致していること自体**を明示的に固定して、
   * 「同じであることは事故ではなく現在の仕様である」と読めるようにしておく。
   * **再修正トリガー＝どちらかの集合に片方だけの要素が入った日**（そのときは差を固定し直すこと）。
   */
  it("⚠⚠⚠ 段 3-c: いま 2 つの集合は同じ 6 値（⚠ それでも統合しないこと）", () => {
    expect([...EFFECT_CONDITION_EVENT_TYPES]).toEqual([...MONETARY_EVENT_TYPES]);
  });

  /**
   * ## ⚠⚠⚠ 失われた網を 1 枚だけ戻す（**参照同一性**で見る）
   *
   * 上の「中身が同じ」だけでは、⚠⚠ **`EFFECT_CONDITION_EVENT_TYPES = MONETARY_EVENT_TYPES`
   * （別名化）という変異が緑のまま通る**——中身は当然一致するからである。
   * ⚠⚠⚠ **別名化がいちばん危ない形**である。②（条件表に行を出すか）を動かした瞬間に
   * ①（これはお金か）まで動き、`viewerFormat.ts` の JSDoc が警告している
   * 「**レイドで赤枠と投げ銭音が出る**」が、条件表を触ったつもりの人に起きる。
   * ⇒ **別の Set であること**を直接見れば、中身が同じままでもこの変異は死ぬ。
   *
   * ⚠ **これで全部が守れるわけではない**——`new Set([...MONETARY_EVENT_TYPES])` は
   * 今日の実装そのものなので通る（＝①に種別を足すと②にも行が生える「巻き添え」は今も残る）。
   * それは 段 2 から変わらない既知の性質で、①へ足す＝課金種別を足すことなので受容している。
   * **再修正トリガー＝②だけに要素を足したくなった日**（そのときは `...MONETARY_EVENT_TYPES` の
   * スプレッドをやめ、②を独立に列挙し直すこと）。
   */
  it("⚠⚠⚠ 段 3-c: 2 つの集合は別のインスタンスである（別名化する変異を殺す）", () => {
    expect(EFFECT_CONDITION_EVENT_TYPES).not.toBe(MONETARY_EVENT_TYPES);
  });

  it("⚠⚠ 段 2: レイドは条件表に入れない（ガチャは「視聴者が対価を払って引く」もの）", () => {
    // ⚠⚠⚠ **判断の記録**（依頼者・2026-08-26）: ガチャは視聴者が対価（お金／チャンネルポイント）を
    //   払って引き、結果に応じて後から配信者が何かを渡すもの。**レイドは配信者の行為で、
    //   視聴者が対価を払っていない**＝ガチャの引き金にならない。
    //   ⚠ 「課金ではない」という理由でチャネポと横並びに見えるが**理由が違う**——
    //     チャネポは「対価だが金ではない」、レイドは「そもそも対価ではない」。
    // ⚠ **再修正トリガー**＝「レイドで OBS のソースを鳴らしたい」と言われたとき
    //   （それはガチャの話ではないので、そのときは足すのが正しい判断になる）。
    expect(EFFECT_CONDITION_EVENT_TYPES.has("raid")).toBe(false);
    expect(EFFECT_CONDITION_EVENT_TYPES.has("chat")).toBe(false);
  });

  it("⚠ 段 2: 並びは課金 6 値の順のまま（既存ユーザーの行が並び替わらない）", () => {
    // ⚠⚠ この集合の**挿入順が画面の行の並び**であり、保存値の正規化順でもある
    //   （`EFFECT_EVENT_ROWS` / `parseConditions`）。⇒ 既存 6 値の順序を動かすと、
    //   **既存ユーザーの割り当て表の行が黙って並び替わる**。
    // ⚠ 段 2 は末尾に "channelpoint" が付いていた。⚠⚠ **段 3-c で外した**（上の節が正）。
    expect([...EFFECT_CONDITION_EVENT_TYPES]).toEqual([...MONETARY_EVENT_TYPES]);
    expect(EFFECT_CONDITION_EVENT_TYPES.size).toBe(6);
  });

  it("⚠ 金額を持たない課金種別の日本語文（composeEventMessage）は作らない＝読み上げは本文のみ", () => {
    // null が返ることで speechText が `c.text`（＝視聴者が打った user_input）をそのまま読む
    // ＝`chat` と同じ body-only（決定・2026-08-25）。要約文を作ると投稿者名が合成テキストに乗り、
    // docs/security.md §1 の 049 追補（名前が乗るのは課金イベントに限る）の対象が広がってしまう。
    expect(
      composeEventMessage({
        eventType: "channelpoint",
        source: "twitch",
        author: { name: "Alice" },
      }),
    ).toBeNull();
  });

  it("⚠ 配色キー（monetaryTone）の専用トーンを持たない＝課金カードの配色に混ざらない", () => {
    // 呼び出し側は isMonetaryEvent で絞ってから使うので通常は到達しないが、
    // 到達しても t0 へ無害に劣化するだけ（専用色を発明していないことの記録）。
    expect(monetaryTone({ eventType: "channelpoint" })).toBe("t0");
  });
});

/**
 * 065b: CSV から取り込んだギフト累計の整形。
 *
 * あるべき挙動（親 065・(2) ／ 065a の DTO doc ／ 申し送り 4）:
 * - **単位を一切付けない**（CSV に通貨情報が無く、円ではなく Jewels の可能性が高い）
 * - **整数へ丸める**（065a はこの列にだけ上限を課しておらず、素の toLocaleString は小数 3 桁まで出す）
 * - 桁が大きくても**隠さない**（隠すと「引き継いだのに 0」と区別が付かない）
 */
describe("065b fmtImportedAmount（取り込んだギフト累計）", () => {
  it("⚠⚠ 通貨記号を付けない（fmtSuperchat を流用していないことの担保）", () => {
    expect(fmtImportedAmount(1000)).toBe("1,000");
    // 対照群: fmtSuperchat は通貨を後置する＝差し替えたらこのテストが落ちる。
    expect(fmtSuperchat(1000, "JPY")).toBe("1,000 JPY");
  });

  it("⚠ 小数は整数へ丸める（単位不明の値に小数を出さない）", () => {
    expect(fmtImportedAmount(1234.5678)).toBe("1,235");
    expect(fmtImportedAmount(0.4)).toBe("0");
    expect(fmtImportedAmount(0.5)).toBe("1");
  });

  it("0 は 0 のまま出す（「引き継ぎ額なし」を空欄にしない）", () => {
    expect(fmtImportedAmount(0)).toBe("0");
  });

  it("⚠ 桁が大きくても指数表記にせず、丸めも省略もしない", () => {
    expect(fmtImportedAmount(1e21)).toBe("1,000,000,000,000,000,000,000");
    expect(fmtImportedAmount(1e21)).not.toContain("e");
  });

  it("⚠ 非有限は「-」へ劣化する（fmtNumber は NaN をそのまま画面に出してしまう）", () => {
    expect(fmtImportedAmount(Number.NaN)).toBe("-");
    expect(fmtImportedAmount(Number.POSITIVE_INFINITY)).toBe("-");
    // 対照群: fmtNumber は防御を持たない＝この関数を fmtNumber に差し替えたら落ちる。
    expect(fmtNumber(Number.NaN)).toBe("NaN");
  });
});

/**
 * 065b: 「初回来訪」の合成（実測 firstSeenAt と引き継ぎ推定 importedFirstSeenAt の古いほう）。
 *
 * ⚠⚠ **辞書順で比較してはいけない**（065a の穴 D / 穴 L と同じ罠）。`importedFirstSeenAt` は常に `Z` 形式だが
 * `firstSeenAt` は provider 由来で `+09:00` 形が混ざりうるため、文字列比較だと**古いほうを新しいと判定する**。
 */
describe("065b firstVisitAt（初回来訪の合成）", () => {
  // ⚠⚠ **辞書順だと逆の結果になる実データ形**。前者は 1786834800000、後者は 1786836544288 で
  //   **前者が古い**が、文字列比較では "2026-08-16T…" > "2026-08-15T…" なので後者が選ばれてしまう。
  const MEASURED_OLDER = "2026-08-16T08:00:00+09:00";
  const IMPORTED_NEWER = "2026-08-15T23:29:04.288Z";

  it("⚠⚠ オフセット混在でも古いほうを選ぶ（辞書順だと逆になるケースを直接踏む）", () => {
    // 前提の実証: 辞書順で比べると「実測のほうが新しい」と誤判定する。
    expect(MEASURED_OLDER < IMPORTED_NEWER).toBe(false);
    expect(new Date(MEASURED_OLDER).getTime()).toBeLessThan(
      new Date(IMPORTED_NEWER).getTime(),
    );

    expect(
      firstVisitAt({
        firstSeenAt: MEASURED_OLDER,
        importedFirstSeenAt: IMPORTED_NEWER,
      }),
    ).toEqual({ iso: MEASURED_OLDER, fromImport: false });
  });

  it("引き継ぎ推定のほうが古ければそちらを採り、引き継ぎ由来と分かる形にする", () => {
    expect(
      firstVisitAt({
        firstSeenAt: "2026-08-16T00:00:00Z",
        importedFirstSeenAt: "2024-03-02T12:15:04.000Z",
      }),
    ).toEqual({ iso: "2024-03-02T12:15:04.000Z", fromImport: true });
  });

  it("引き継ぎが無ければ実測をそのまま返す（undefined / 空文字）", () => {
    const measured = { iso: "2026-08-16T00:00:00Z", fromImport: false };
    expect(firstVisitAt({ firstSeenAt: "2026-08-16T00:00:00Z" })).toEqual(
      measured,
    );
    expect(
      firstVisitAt({
        firstSeenAt: "2026-08-16T00:00:00Z",
        importedFirstSeenAt: undefined,
      }),
    ).toEqual(measured);
    expect(
      firstVisitAt({
        firstSeenAt: "2026-08-16T00:00:00Z",
        importedFirstSeenAt: "",
      }),
    ).toEqual(measured);
  });

  // ⚠⚠ **これが本番で実際に届く形**（レビュー Q-1）。`model.rs` は `#[ts(optional)]` を付けているので
  //   binding の型は `?: string` になるが、**`#[serde(skip_serializing_if)]` は付いていない**ので
  //   serde は `Option::None` を **JSON `null`** で送る。⇒ 型が「undefined しか来ない」と嘘をついている。
  // ⚠⚠ `new Date(null).getTime()` は **NaN ではなく 0**（実測）なので、`== null` を `=== undefined` へ
  //   「厳密化」すると NaN ガードをすり抜け、**引き継ぎの無い全視聴者が 1970 年（インポート分）になる**。
  //   このテストはその厳密化を殺すためだけに在る。
  it("⚠⚠ null（serde が実際に送る形）でも実測を返す — 型を信じた厳密化を殺す", () => {
    expect(
      firstVisitAt({
        firstSeenAt: "2026-08-16T00:00:00Z",
        importedFirstSeenAt: null,
      }),
    ).toEqual({ iso: "2026-08-16T00:00:00Z", fromImport: false });
    // 前提の実証: null は NaN にならないので、NaN ガードだけでは落とせない。
    expect(new Date(null as unknown as string).getTime()).toBe(0);
    expect(Number.isNaN(new Date(null as unknown as string).getTime())).toBe(
      false,
    );
  });

  it("⚠ 同値なら実測を優先する（引き継ぎ由来だと主張する根拠が無い）", () => {
    // 引き継ぎだけの視聴者は first_seen_at にも lcts が入るため、両者が同値になりうる。
    expect(
      firstVisitAt({
        firstSeenAt: "2026-08-15T23:29:04.288Z",
        importedFirstSeenAt: "2026-08-15T23:29:04.288Z",
      }),
    ).toEqual({ iso: "2026-08-15T23:29:04.288Z", fromImport: false });
    // 表記違いで同時刻のときも同じ（パース比較なので等しいと判定される）。
    expect(
      firstVisitAt({
        firstSeenAt: "2026-08-16T08:29:04.288+09:00",
        importedFirstSeenAt: "2026-08-15T23:29:04.288Z",
      }).fromImport,
    ).toBe(false);
  });

  it("⚠ パースできない側は候補から外し、両方壊れていても壊れず劣化する", () => {
    expect(
      firstVisitAt({
        firstSeenAt: "2026-08-16T00:00:00Z",
        importedFirstSeenAt: "bogus",
      }),
    ).toEqual({ iso: "2026-08-16T00:00:00Z", fromImport: false });
    expect(
      firstVisitAt({
        firstSeenAt: "bogus",
        importedFirstSeenAt: "2024-03-02T12:15:04.000Z",
      }),
    ).toEqual({ iso: "2024-03-02T12:15:04.000Z", fromImport: true });
    // 両方壊れていれば実測を原文のまま返す（fmtDateTime が原文フォールバックする既存挙動に乗る）。
    expect(
      firstVisitAt({ firstSeenAt: "bogus", importedFirstSeenAt: "also-bogus" }),
    ).toEqual({ iso: "bogus", fromImport: false });
  });
});
