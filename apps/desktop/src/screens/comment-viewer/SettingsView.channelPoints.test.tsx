import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { DEFAULT_OVERLAY_FONT } from "../../features/comment-viewer/overlaySettings";
import { TTS_MAX_LENGTH_DEFAULT } from "../../features/comment-viewer/ttsPrefs";

/**
 * 063e: 設定ビューの「チャンネルポイント」説明カードの仕様テスト。
 *
 * ⚠⚠⚠ **このカードは「黙って効かない」を作らないために存在する**（061a Q-1）。
 * チャンネルポイントの購読は**非致命**（403 でもコメント取得は続く）なので、届かない人には
 * **エラーすら出ない**。しかも届かない条件が 3 つあり、そのうち①は**新規配信者の既定状態**である:
 *   ① Twitch 側でチャンネルポイントが有効になっていない
 *      ⚠⚠ 新規チャンネルには**そもそも存在しない**（アフィリエイト条件を満たすと Twitch から
 *         オンボーディングの案内が届いて初めて使える）。依頼者自身がここで詰まった。
 *   ② 他人のチャンネルに接続している（購読はブロードキャスター本人のトークンでしか通らない
 *      ＝公式の Authorization 要件。なのに接続先は**手入力のチャンネル名**である）
 *   ③ 再ログイン前（旧トークンに `channel:read:redemptions` が無い）
 * ⇒ **書いていなければ、ユーザーは「なぜ届かないのか」を知る手段が 1 つも無い。**
 *
 * ⚠ 併せて次の 3 点も固定する（どれも「書き忘れると気付けない」種類の情報）:
 *   - 再ログインが要ること＋**そのやり方**（⚠ アプリに連携解除の導線が無いため、手順が無いと成立しない）
 *   - YouTube に相当機能が無いこと（066 の ChatSendCard と同じ非対称）
 *   - 引き換えの取り消し／完了変更は**しない**こと（`channel:manage:redemptions` を取っていない）
 *
 * ⚠⚠ **段 1 では「ガチャが回せる」と書いてはいけない**（約束できることだけ書く）。
 * 063e 段 2 でエフェクト条件に行が出たら、そのときに文言を足すこと。
 *
 * ## 段 1-b で足したもの
 *
 * ⚠⚠⚠ **受信状態の表示**（`channelPointsState`）。①が既定状態だと分かった以上、固定文だけでは
 * 「自分がどれなのか」を切り分けられない。⚠ **`unknown`（まだ接続していない）を
 * `unavailable`（試して駄目だった）と混ぜないこと**——混ぜると未接続の人に「Twitch の設定を
 * 確認してください」と誤案内する（064c が `obs.sources` の `ok` で潰したのと同型の失敗）。
 *
 * ⚠⚠ **ベータであること**と、その理由（作者が実機確認できていない）。
 * ⚠ **`.cardBody` を挟んでいること**（段 1 はこれが抜けていて、説明文がカードの端に
 *   貼り付いた 1 かたまりの文として描画されていた）。
 */

// useHostOs は Rust host_os を invoke するため、テストでは OS を固定してコンポーネントを隔離する。
vi.mock("../../features/platform/useHostOs", () => ({
  useHostOs: () => "macos",
}));

type Props = ComponentProps<typeof SettingsView>;

function baseProps(over: Partial<Props> = {}): Props {
  return {
    onBack: vi.fn(),
    voicevoxAutolink: false,
    onVoicevoxAutolinkChange: vi.fn(),
    ttsEnabled: false,
    speakTwitch: true,
    onSpeakTwitchChange: vi.fn(),
    speakYoutube: true,
    onSpeakYoutubeChange: vi.fn(),
    ttsMaxLength: TTS_MAX_LENGTH_DEFAULT,
    onTtsMaxLengthChange: vi.fn(),
    speakers: [],
    selectedSpeakerId: 0,
    onSpeakerIdChange: vi.fn(),
    onPreview: vi.fn(),
    audioOutputDevices: [],
    audioOutputListState: "ready",
    audioOutputDeviceId: "",
    onAudioOutputDeviceIdChange: vi.fn(),
    onReloadAudioOutputDevices: vi.fn(),
    soundCommentEnabled: false,
    onSoundCommentEnabledChange: vi.fn(),
    onPreviewCommentSound: vi.fn(),
    soundMonetaryEnabled: false,
    onSoundMonetaryEnabledChange: vi.fn(),
    onPreviewMonetarySound: vi.fn(),
    soundPreviewState: "idle",
    overlayFont: DEFAULT_OVERLAY_FONT,
    onOverlayFontChange: vi.fn(),
    overlayShowSource: false,
    onOverlayShowSourceChange: vi.fn(),
    obsConfig: null,
    obsAutoAdd: false,
    onObsAutoAddToggle: vi.fn(),
    obsState: "idle",
    // 063e 段 1-b: 既定は「まだ分かりません」（Twitch の取得を開始していない状態）。
    channelPointsState: "unknown",
    onSetObsPassword: vi.fn(),
    onClearObsPassword: vi.fn(),
    pinnedOverlayEnabled: false,
    onPinnedOverlayToggle: vi.fn(),
    onChatTestSend: async () => ({ ok: false, reason: "offline" }),
    chatSendChannel: "",
    // 063f: 自動送信の直近結果（表示専用）。⚠ 既定は「まだ 1 度も走っていない」。
    gachaChatResult: null,
    ...over,
  };
}

describe("SettingsView 063e チャンネルポイントの説明", () => {
  /** 見出しから、このカードの `<section>` を引く（DOM 構造の検査用）。 */
  const cardSection = (): HTMLElement => {
    const head = screen.getByText("チャンネルポイント（ベータ）");
    const section = head.closest("section");
    expect(section).toBeTruthy();
    return section as HTMLElement;
  };

  it("見出しと、何が表示されるようになるのかが書いてある", () => {
    render(<SettingsView {...baseProps()} />);
    // ⚠⚠ 段 1-b: **見出しにベータと書く**（カード末尾にだけ書くと、読まない人に届かない）。
    expect(screen.getByText("チャンネルポイント（ベータ）")).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).toContain("コメント一覧に「チャンネルポイント」として表示");
  });

  /**
   * ⚠⚠⚠ **063e 段 3-b: 語は「カスタム報酬」で揃える。**
   *
   * ⚠ 取っている購読は `channel.channel_points_custom_reward_redemption.add` の 1 本だけで、
   * Twitch が最初から用意している**自動報酬**（「ハイライトされたメッセージ」など）は
   * `...automatic_reward_redemption.add` という**別の購読で届く＝取っていない**。
   * ⚠⚠ 「報酬」とだけ書くと、**出るはずのものが出ない**ように見える
   * （エフェクト画面では、その名前を打った人が**黙って永久に鳴らない**）。
   * ⇒ **2 つの画面で語を 1 つにする**（あちらの網は `EffectAssignmentCard.test.tsx` が持つ）。
   * ⚠ **再修正トリガー＝自動報酬の購読も取るようになったとき**（そのときは語を広げること）。
   */
  it("⚠⚠ 語は「カスタム報酬」で揃っている（エフェクト画面と 2 通りにしない）", () => {
    render(<SettingsView {...baseProps()} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("カスタム報酬の引き換え");
    // ⚠ 「チャンネルポイント報酬」という段 1 の語が残っていないこと。
    expect(body).not.toContain("チャンネルポイント報酬");
  });

  it("⚠ 段 1-b: 説明文が .cardBody の中にある（カードの端に貼り付かない）", () => {
    render(<SettingsView {...baseProps()} />);
    // ⚠⚠ 段 1 はここが抜けていた。`.card` は padding を持たず `.note` は inline なので、
    //   `<span>` を `<section>` 直下に置くと**説明文が 1 かたまりの文としてカードの端に貼り付く**
    //   （他の全カードは `.cardBody` を挟んでいる＝この 1 枚だけ崩れていた）。
    // ⚠ クラス名はビルドでハッシュ化されうるので、**構造**で固定する。
    expect(cardSection().querySelectorAll(":scope > span").length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 段 1-b: 受信状態の表示（⚠⚠⚠ unknown と unavailable を混ぜない）
  // -------------------------------------------------------------------------

  it("⚠⚠⚠ 未接続（unknown）では「受信できていません」と言わない", () => {
    render(<SettingsView {...baseProps({ channelPointsState: "unknown" })} />);
    const body = document.body.textContent ?? "";
    // ⚠ まだ取得を開始していないだけの人に「Twitch の設定を確認してください」と誤案内しない
    //   （064c が `obs.sources` の `ok` で潰したのとまったく同じ失敗モード）。
    expect(body).not.toContain("引き換えを受信できていません");
    expect(body).not.toContain("引き換えを受信できる状態です");
    expect(body).toContain("受信できる状態かどうかがここに出ます");
  });

  it("受信できているとき（receiving）はそう出る", () => {
    render(<SettingsView {...baseProps({ channelPointsState: "receiving" })} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("引き換えを受信できる状態です");
    expect(body).not.toContain("引き換えを受信できていません");
  });

  it("⚠⚠ 受信できていないとき（unavailable）は、条件を見るよう促す", () => {
    render(
      <SettingsView {...baseProps({ channelPointsState: "unavailable" })} />,
    );
    const body = document.body.textContent ?? "";
    expect(body).toContain("引き換えを受信できていません");
    expect(body).not.toContain("引き換えを受信できる状態です");
  });

  it("⚠ 知らない状態語は「まだ分かりません」側へ倒す（断言しない）", () => {
    // ⚠⚠ sidecar が将来 語を増やしても、**「受信できています」と嘘をつかない**方へ倒れること。
    //   ⚠ 逆向き（unavailable 側へ倒す）にもしない——未接続の人へ誤案内する側だからである。
    render(<SettingsView {...baseProps({ channelPointsState: "bogus" })} />);
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("引き換えを受信できる状態です");
    expect(body).not.toContain("引き換えを受信できていません");
    expect(body).toContain("受信できる状態かどうかがここに出ます");
  });

  // -------------------------------------------------------------------------
  // 届かない 3 条件（⚠ 状態表示だけでは切り分けられないので、両方が要る）
  // -------------------------------------------------------------------------

  it("⚠⚠⚠ ① Twitch 側での有効化が要る＝新しいチャンネルでは使えないと書いてある", () => {
    render(<SettingsView {...baseProps()} />);
    const body = document.body.textContent ?? "";
    // ⚠⚠ **このカードで最も重要な 1 行**。依頼者自身がここで詰まった（チャンネルを作った直後で、
    //   クリエイターダッシュボードに項目自体が無かった）。段 1 の文言には**これが無かった**。
    expect(body).toContain("新しいチャンネルでは使えません");
    // ⚠ 確認できる事実だけを書く（有効化手順は Twitch 側の達成状況で変わるので書かない）。
    expect(body).toContain("クリエイターダッシュボード");
  });

  it("⚠⚠⚠ ② 「自分のチャンネルのときだけ届く」が書いてある（黙って効かない、を作らない）", () => {
    render(<SettingsView {...baseProps()} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("あなた自身のチャンネルに接続していること");
    // ⚠ 他人のチャンネルでも**コメント取得は止まらない**（非致命購読）ことも併せて伝える。
    expect(body).toContain("コメントの取得は通常どおり続きます");
  });

  it("⚠⚠ ③ 再ログインが要ることと、そのやり方が書いてある（アプリに連携解除の導線が無いため）", () => {
    render(<SettingsView {...baseProps()} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("ログインし直す");
    // ⚠ 「ログインし直してください」だけでは手順として成立しない（アプリ内に導線が無い）。
    expect(body).toContain("接続");
    expect(body).toContain("連携をいったん解除");
  });

  it("⚠ 3 つ全部が要る、と書いてある（1 つ直せば動くと誤解させない）", () => {
    render(<SettingsView {...baseProps()} />);
    expect(document.body.textContent ?? "").toContain(
      "次の 3 つがすべて必要です",
    );
  });

  // -------------------------------------------------------------------------
  // できないこと・ベータ表記
  // -------------------------------------------------------------------------

  it("⚠ YouTube 非対応が書いてある（066 の ChatSendCard と同じ非対称）", () => {
    render(<SettingsView {...baseProps()} />);
    expect(document.body.textContent ?? "").toContain(
      "YouTube に同じ機能はありません",
    );
  });

  it("⚠⚠ 読み取りのみ＝引き換えの取り消し／完了変更はしないことが書いてある", () => {
    render(<SettingsView {...baseProps()} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("読み取りのみ");
  });

  it("⚠⚠⚠ ベータであることと、実機確認できていないことを正直に書いてある", () => {
    render(<SettingsView {...baseProps()} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("ベータ");
    // ⚠ 「動作確認済みです」と読める書き方をしないこと（作者は Twitch 側で有効化できない）。
    expect(body).toContain("動作確認ができていません");
    // ⚠ 「動きません」だけでは①②③のどれかを切り分けられないので、報告してほしい内容を具体的に書く。
    expect(body).toContain("報告してください");
  });

  // ⚠⚠⚠ 063e 段 2（レビュー Q-H1）: **このテストは反転した。**
  //   段 1 の版は `expect(body).not.toContain("ガチャ")` で「まだ回らないのだから約束しない」を
  //   固定していた（＝当時は正しい）。段 2 で `EFFECT_CONDITION_EVENT_TYPES` に `channelpoint` が入り、
  //   `effectAssignments.ts` の課金ゲートが消えて**実際に回るようになった**ので、
  //   ⚠⚠ 書かないままにすると「できるようになったことに気付けない」という**逆向きの黙って効かない**になる。
  //
  // ⚠⚠⚠ 063e 段 3-c: **この網は「嘘を書かない」側も見るようにした。**
  //   段 3-c で条件表から「チャンネルポイント」の行を消したのに、この文だけが
  //   「割り当て表に行が出ます／**引き換えのたびに動きます**」と**存在しない挙動を約束**していた。
  //   ⚠ 旧テストは `toContain("ガチャ")` と `toContain("割り当て")` しか見ていなかったので
  //   **嘘のまま緑で通った**。⇒ **条件（カスタム報酬ごと）まで固定する。**
  it("⚠⚠⚠ 段 3-c: 割り当ての導線を、条件つきで正確に書く", () => {
    render(<SettingsView {...baseProps()} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("ガチャ");
    // ⚠ 「どこで割り当てるのか」まで書く（「回せます」だけだと探し先が分からない）。
    expect(body).toContain("割り当て");
    // ⚠⚠⚠ **無条件に動くと読める書き方をしないこと。**
    expect(body).toContain("カスタム報酬ごと");
    expect(body).toContain("割り当てたカスタム報酬の引き換えだけ");
    // ⚠ 段 3-c で消した「割り当て表に行が出る」案内が残っていないこと。
    expect(body).not.toContain("割り当て表に「チャンネルポイント」の行");
  });

  it("⚠ 設定できることは無いので、このカードにトグルを置かない", () => {
    render(<SettingsView {...baseProps()} />);
    // 「チャンネルポイント」を名前に含むスイッチが存在しないこと。
    const switches = screen.queryAllByRole("switch");
    expect(
      switches.some((el) =>
        (el.getAttribute("aria-label") ?? el.textContent ?? "").includes(
          "チャンネルポイント",
        ),
      ),
    ).toBe(false);
  });
});
