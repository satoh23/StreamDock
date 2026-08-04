import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 059a: 通知音のクールダウン層の仕様テスト。
 *
 * あるべき挙動（docs/tasks/059a-comment-notification-sound.md・058a の申し送り）:
 * - クールダウン内の 2 回目は **invoke しない**（鳴らさない）。⚠ **キューイングしない**（落とすのが正しい）。
 * - ⚠⚠ **クールダウンは音源 ID ごとに独立。** 共有すると「コメントが流れている最中のスパチャ音が
 *   コメント音のクールダウンで消える」＝一番気づいてほしい音が鳴らないという最悪の挙動になる。
 * - ⚠⚠ **投げ銭音（059b）は Rust の同時再生 1 本にも譲る。** クールダウンの独立だけでは足りず、
 *   コメント音の再生中に来た投げ銭音は Rust に**黙って捨てられる**（`"played"` に見える）ため、
 *   直前の再生の完了を待ってから invoke する（最後の describe）。
 * - ⚠⚠ **デバイス未選択（`""`）では invoke しない。** 「既定デバイスで鳴らす」ではなく「鳴らさない」
 *   （②-軽では OS 既定＝仮想オーディオデバイス＝配信に載る側なので、落とすと載せないつもりの音が載る）。
 * - ⚠⚠ **失敗を握り潰さない。** 例外は投げない（コメント受信経路を巻き添えにしない）が、
 *   `"failed"` として呼び出し側へ伝える（058a はホットプラグ監視を持たないので、ここで捨てると
 *   配信中にデバイスが抜けたことに気付く手段がゼロになる）。
 * - 失敗してもクールダウンは進む（デバイスが抜けている間に invoke を撃ち続けない）。
 *
 * ⚠ **`AudioContext` はモックしない**（このモジュールは Web Audio に触れない）。モックするのは
 * 058a の invoke ラッパ（`audioOutputApi`）で、`audioOutputApi.test.ts` /
 * `CommentViewerApp.audio.test.tsx` と同じ型。テストは外部通信も OS 操作も一切行わない。
 */

// vi.mock のファクトリは巻き上げられるため、共有スパイは vi.hoisted で先に作る。
const mocks = vi.hoisted(() => ({
  playNotificationSound: vi.fn(),
}));

vi.mock("./audioOutputApi", () => ({
  playNotificationSound: mocks.playNotificationSound,
}));

import {
  requestNotificationSound,
  resetNotificationSoundStateForTest,
} from "./notificationSound";

/** 実物に近い形の ID（`cpal::DeviceId` の `Display` は `"<HostId>:<device>"`）。 */
const DEVICE_ID = "CoreAudio:BuiltInSpeakerDevice";

/** コメント音のクールダウン（notificationSound.ts の COOLDOWN_MS.comment）。 */
const COMMENT_COOLDOWN_MS = 600;

/** 059b: 投げ銭音のクールダウン（notificationSound.ts の COOLDOWN_MS.monetary）。 */
const MONETARY_COOLDOWN_MS = 1500;

beforeEach(() => {
  // ⚠ モジュールスコープの Map / Promise はテスト間で持ち越されるので、必ず消してから始める
  //（消さないと実行順で結果が変わる。未解決の Promise を持ち越すと投げ銭音が永久に待つ）。
  resetNotificationSoundStateForTest();
  mocks.playNotificationSound.mockReset();
  mocks.playNotificationSound.mockResolvedValue(undefined);
  // Date.now() を進めるため。setSystemTime で基準を固定し、advanceTimersByTime で進める。
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestNotificationSound", () => {
  it("デバイス選択済み・クールダウン外なら鳴らす（deviceId と音源 ID をそのまま渡す）", async () => {
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledWith(
      DEVICE_ID,
      "comment",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("⚠ クールダウン内の 2 回目は鳴らさない（invoke しない・キューイングもしない）", async () => {
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );

    // クールダウンぎりぎり手前まで進める。
    vi.advanceTimersByTime(COMMENT_COOLDOWN_MS - 1);
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("同一 tick の 2 回目も鳴らさない（StrictMode の updater 二重実行に相当）", async () => {
    // ⚠ `CommentViewerApp` は setComments の updater 内から呼ぶので、main.tsx の <React.StrictMode> で
    // updater が 2 回走る。通知音は構造的には冪等でなく、**ここで潰れることが冪等化を担っている**。
    await requestNotificationSound("comment", DEVICE_ID);
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("クールダウンが明けたら再び鳴る", async () => {
    await requestNotificationSound("comment", DEVICE_ID);

    vi.advanceTimersByTime(COMMENT_COOLDOWN_MS);
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("⚠⚠ クールダウンは音源 ID ごとに独立（059b の前提をここで固定する）", async () => {
    // コメント音を鳴らした直後でも、別の音は**必ず鳴る**。
    // これが共有カウンタになると、059b で「コメント連投中のスパチャ音が消える」＝
    // 一番気づいてほしい音が鳴らない、という最悪の壊れ方をする。
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    await expect(requestNotificationSound("test", DEVICE_ID)).resolves.toBe(
      "played",
    );

    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      1,
      DEVICE_ID,
      "comment",
    );
    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      2,
      DEVICE_ID,
      "test",
    );
  });

  it("⚠⚠ コメント音の直後の投げ銭音は鳴る（本タスクで一番壊れやすいところ）", async () => {
    // 059b の核心。共有カウンタにすると**ここだけが静かに落ちる**——
    // 「コメントが流れている最中に来たスパチャの音がコメント音のクールダウンで消える」＝
    // 一番気づいてほしい音が鳴らない。
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      2,
      DEVICE_ID,
      "monetary",
    );
  });

  it("⚠ 投げ銭音の直後のコメント音も鳴る（独立性は両方向）", async () => {
    // 片方向だけ通ると「monetary だけ特別扱いして comment を潰す」実装でも緑になる。
    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "played",
    );
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("投げ銭音のクールダウン内の 2 回目は鳴らさない（Twitch の N+1 ギフトをここで潰す）", async () => {
    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "played",
    );

    vi.advanceTimersByTime(MONETARY_COOLDOWN_MS - 1);
    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("投げ銭音のクールダウンが明けたら再び鳴る", async () => {
    await requestNotificationSound("monetary", DEVICE_ID);

    vi.advanceTimersByTime(MONETARY_COOLDOWN_MS);
    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("⚠ 投げ銭音のクールダウンはコメント音より長い（N+1 ギフトを凌ぐのに要る）", async () => {
    // 059b のタスクファイルは「コメント音より**短くて**よい」と書いていたが、実コードでは逆になる
    //（理由は notificationSound.ts の COOLDOWN_MS の JSDoc）。値の大小そのものを固定して、
    // 「短くてよい」と読んで縮める変更をここで止める。
    expect(MONETARY_COOLDOWN_MS).toBeGreaterThan(COMMENT_COOLDOWN_MS);

    await requestNotificationSound("monetary", DEVICE_ID);
    // コメント音のクールダウンが明ける時刻では、投げ銭音はまだ明けていない。
    vi.advanceTimersByTime(COMMENT_COOLDOWN_MS);
    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "skipped",
    );
  });
});

/**
 * 059b: **Rust の「同時再生 1 本」への譲り**（`WAITS_FOR_IN_FLIGHT`）。
 *
 * ⚠⚠ クールダウンを独立させただけでは「スパチャは必ず鳴る」は成立しない。058a の `PLAYING` は
 * 音の種類に関係なく全体で 1 本で、競合した呼び出しを**鳴らさずに `Ok(())`** で返す＝ここからは
 * `"played"` に見えて検出できない。コメント音の占有は 150〜350ms、コメント音が鳴りうる最短間隔は
 * 600ms なので、コメントが流れ続けている配信では **2〜4 回に 1 回、投げ銭音が黙って捨てられる**。
 * そこで投げ銭音だけは**直前の再生の完了を待ってから** invoke する。
 *
 * ⚠ ここで固定するのは「待つ／待たない」の非対称そのもの。コメント音まで待たせると 059a の挙動が変わる
 *（かつ「落ちてよいのはコメント音の側」という優先順が壊れる）。
 */
describe("requestNotificationSound の同時再生 1 本への譲り（059b）", () => {
  /** 手で解決できる Promise（＝「まだ鳴り終わっていない再生」を作る）。 */
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => {
      resolve = () => r();
    });
    return { promise, resolve };
  }

  /**
   * マイクロタスクを空にする。
   *
   * ⚠ `await Promise.resolve()` 1 回では足りない——連結は `.then` を数段重ねるので、
   * 段数を数えるテストにすると実装の書き方に密着して壊れやすくなる。回数で押し切る。
   * （タイマーは進めないので、クールダウンの検証と混ざらない。）
   */
  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  }

  it("⚠⚠ 直前の再生が飛行中なら、投げ銭音はその完了を待ってから invoke する", async () => {
    const inFlight = deferred();
    mocks.playNotificationSound.mockReturnValueOnce(inFlight.promise);

    // コメント音が「鳴っている最中」。
    void requestNotificationSound("comment", DEVICE_ID);
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);

    // その最中に投げ銭音を要求しても、まだ invoke しない（ここで撃つと Rust に黙って捨てられる）。
    const monetary = requestNotificationSound("monetary", DEVICE_ID);
    await Promise.resolve();
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);

    // コメント音が鳴り終わった＝Rust の PLAYING が空いた瞬間に投げ銭音が飛ぶ。
    inFlight.resolve();
    await expect(monetary).resolves.toBe("played");
    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      2,
      DEVICE_ID,
      "monetary",
    );
  });

  it("⚠ 直前の再生が失敗しても投げ銭音は投げられる（チェインが切れない）", async () => {
    // 失敗も「もう鳴っていない」なので待ちは解ける。ここで reject が伝播すると、
    // **一度デバイスが抜けただけで以降の投げ銭音が永久に鳴らなくなる**。
    mocks.playNotificationSound.mockRejectedValueOnce({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    await requestNotificationSound("comment", DEVICE_ID);

    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("⚠ コメント音は待たない（059a の挙動を変えない／落ちてよいのはコメント音の側）", async () => {
    const inFlight = deferred();
    mocks.playNotificationSound.mockReturnValueOnce(inFlight.promise);

    void requestNotificationSound("monetary", DEVICE_ID);
    // ⚠ 投げ銭音は「待つ側」なので、飛行中の再生が無くても invoke は**1 マイクロタスク後**になる
    //（解決済みの Promise に連結するため）。実挙動としては無害だが、テストではここを飛ばすと空振りする。
    await Promise.resolve();
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);

    // 投げ銭音の再生中でも、コメント音は待たずに**同期的に** invoke する（Rust に落とされうるが、それでよい）。
    void requestNotificationSound("comment", DEVICE_ID);
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      2,
      DEVICE_ID,
      "comment",
    );

    inFlight.resolve();
  });

  it("⚠ 'test' も待たない（明示操作を飛行中の再生で遅らせない）", () => {
    // `WAITS_FOR_IN_FLIGHT.test = false` の固定。仕様は「**ユーザーの明示操作は絞らない**」で、
    // `COOLDOWN_MS.test = 0` と対になっている（notificationSound.ts の JSDoc）。
    // ⚠ 今のところ本番はテスト再生／試聴を `audioOutputApi` へ直に投げるのでこの経路を通らないが、
    // **将来この関数を通すようにしたときに「押したのに待たされる」へ倒れない**ことをここで固定する。
    const inFlight = deferred();
    mocks.playNotificationSound.mockReturnValueOnce(inFlight.promise);

    void requestNotificationSound("comment", DEVICE_ID);
    void requestNotificationSound("test", DEVICE_ID);
    // 待たない側なので**同期的に** invoke される（await を挟まずに 2 回目が立っている）。
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      2,
      DEVICE_ID,
      "test",
    );

    inFlight.resolve();
  });

  it("⚠ 待っている間に来た投げ銭音はクールダウンが落とす（溜めて後から連打しない）", async () => {
    // 親 059 の決定「**キューイングしない・落とすのが正しい**」＋ `lastPlayback` の
    // 「溜め込むキューではない」を、**待ちが発生している最中**について固定する。
    // ⚠ ここが崩れると N+1 ギフトが「待たされたぶん後からまとめて鳴る」になり、
    // クールダウンで凌ぐという 059b の前提が壊れる。
    const inFlight = deferred();
    mocks.playNotificationSound.mockReturnValueOnce(inFlight.promise);

    void requestNotificationSound("comment", DEVICE_ID); // 鳴っている最中
    const first = requestNotificationSound("monetary", DEVICE_ID); // 待ちに入る

    // 待っている最中に届いた 2 件目（＝N+1 ギフトの 2 件目に相当）は**溜めずに落とす**。
    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "skipped",
    );

    inFlight.resolve();
    await expect(first).resolves.toBe("played");
    await flushMicrotasks();
    // invoke は「コメント音 1 回 ＋ 投げ銭音 1 回」だけ（待ち行列に溜まっていない）。
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("⚠ 投げ銭音のクールダウンは「要求した時刻」から数える（待った時間ぶん伸びない）", async () => {
    // `lastRequestedAt` の JSDoc「**最後に要求した時刻**を記録する」＋ `requestNotificationSound` の
    // 「クールダウンの記録は**待ち始めた時点**で行う」の固定。
    // ⚠ 記録を invoke 時点へ動かすと、待たされた回数ぶんクールダウンが後ろへずれて
    // 「スパチャが来たのに前の待ちのせいで鳴らない」が起きる（クールダウンの意味がぶれる）。
    const inFlight = deferred();
    mocks.playNotificationSound.mockReturnValueOnce(inFlight.promise);

    void requestNotificationSound("comment", DEVICE_ID);
    void requestNotificationSound("monetary", DEVICE_ID); // t=0 に**要求**（invoke はまだ）

    // 待たされている間に 1000ms 経ち、実際の invoke は t=1000 になる。
    vi.advanceTimersByTime(1000);
    inFlight.resolve();
    await flushMicrotasks();
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);

    // t=1500。起点が invoke 時刻(1000) なら skip、**要求時刻(0) なら鳴る**。仕様は後者。
    vi.advanceTimersByTime(MONETARY_COOLDOWN_MS - 1000);
    await expect(requestNotificationSound("monetary", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(3);
  });

  it("⚠⚠ 飛行中の投げ銭音を、後から投げたコメント音の完了が追い越さない", async () => {
    // レビュー Q-1。`lastPlayback` を「置き換え」にすると**ここだけ**が落ちる——
    // Rust に捨てられたコメント音はほぼ即座に解決するので、まだ鳴っている投げ銭音の完了を
    // 見失い、次の投げ銭音が「解決済み」を待って即 invoke ＝黙って捨てられる
    //（059b が潰そうとした事象そのものが、占有の長い環境で戻ってくる）。
    const inFlightComment = deferred();
    const inFlightMonetary = deferred();
    mocks.playNotificationSound
      .mockReturnValueOnce(inFlightComment.promise)
      .mockReturnValueOnce(inFlightMonetary.promise);

    // ① コメント音が鳴っている最中に ② 投げ銭音が来て連結する。
    void requestNotificationSound("comment", DEVICE_ID);
    void requestNotificationSound("monetary", DEVICE_ID);
    inFlightComment.resolve();
    await flushMicrotasks();
    // ② が飛んだ（＝これは「まだ鳴り終わっていない長い再生」）。
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);

    // ③ ②の再生中に来たコメント音。Rust に捨てられて即 Ok ＝ ほぼ即座に解決する。
    vi.advanceTimersByTime(COMMENT_COOLDOWN_MS);
    void requestNotificationSound("comment", DEVICE_ID);
    await flushMicrotasks();
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(3);

    // ④ ②がまだ鳴っているので、次の投げ銭音は ③ の完了で追い越して invoke してはいけない。
    vi.advanceTimersByTime(MONETARY_COOLDOWN_MS);
    void requestNotificationSound("monetary", DEVICE_ID);
    await flushMicrotasks();
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(3);

    // ② が鳴り終わってはじめて飛ぶ。
    inFlightMonetary.resolve();
    await flushMicrotasks();
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(4);
    expect(mocks.playNotificationSound).toHaveBeenNthCalledWith(
      4,
      DEVICE_ID,
      "monetary",
    );
  });
});

/**
 * 059a: 明示操作・未選択・失敗の扱い（クールダウンとも「譲り」とも別軸の性質）。
 *
 * ⚠ これらは元々 `describe("requestNotificationSound")` の中にあったが、059b が上の
 * 「同時再生 1 本への譲り」describe を**その途中に差し込んだ**結果、意味の合わない見出しの下に
 * 取り残されていた（レビュー Q-10）。**中身は 059a のまま・グルーピングだけを戻している。**
 */
describe("requestNotificationSound の明示操作・未選択・失敗の扱い（059a）", () => {
  it("⚠ 'test' はクールダウン 0（ユーザーの明示操作にレート制限をかけない）", async () => {
    // 058a の「テスト再生」と 059a の「試聴」はユーザーが押したときだけ鳴る。
    // 押したのに鳴らないのは「壊れている」と見えるので、ここにレート制限を入れてはいけない
    //（034c の話者試聴と同じ考え方。連打は「再生中は disabled」で抑える）。
    // ⚠ 連打の上限は Rust の同時再生 1 本（可用性対策）が別途持っている。
    await expect(requestNotificationSound("test", DEVICE_ID)).resolves.toBe(
      "played",
    );
    await expect(requestNotificationSound("test", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2);
  });

  it("⚠⚠ デバイス未選択では invoke しない（既定デバイスへ落とさない＝fail-closed）", async () => {
    await expect(requestNotificationSound("comment", "")).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
  });

  it("未選択で skip してもクールダウンを消費しない（選んだ直後の 1 件目が鳴る）", async () => {
    await requestNotificationSound("comment", "");
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "played",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ 失敗は握り潰さず 'failed' で呼び出し側へ伝える（例外は投げない）", async () => {
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    // reject しない＝コメント受信経路を通知音の失敗で巻き添えにしない。
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "failed",
    );
  });

  it("再生失敗のときも既定デバイスで鳴らし直さない（リトライを持たない）", async () => {
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    await requestNotificationSound("comment", DEVICE_ID);
    // 2 回目の invoke が無い＝既定へのフォールバック経路が存在しない。
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("⚠ 失敗してもクールダウンは進む（デバイスが抜けている間 invoke を撃ち続けない）", async () => {
    mocks.playNotificationSound.mockRejectedValue({
      code: "AUDIO_DEVICE_UNAVAILABLE",
    });
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "failed",
    );

    vi.advanceTimersByTime(COMMENT_COOLDOWN_MS - 1);
    await expect(requestNotificationSound("comment", DEVICE_ID)).resolves.toBe(
      "skipped",
    );
    expect(mocks.playNotificationSound).toHaveBeenCalledTimes(1);
  });
});
