import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { DEFAULT_OVERLAY_FONT } from "../../features/comment-viewer/overlaySettings";
import { TTS_MAX_LENGTH_DEFAULT } from "../../features/comment-viewer/ttsPrefs";
import type { AudioOutputDevice } from "../../features/comment-viewer/audioOutputApi";

/**
 * 058a / 059a / 059b / 059c: 設定ビューの「通知音」カードの仕様テスト。
 *
 * ⚠⚠ **059c で 058a の「音声出力（通知音）」カードと 059a/059b の「通知音」カードは 1 枚に統合された**
 * （本人指示）。このファイルの 2 つの describe は、統合後のカードを
 * 「**何を鳴らすか**（トグルと試聴）」と「**どこへ出すか**（出力先セクション）」で分けて見ている
 * ——カードは 1 枚でも検証したい性質は別物だから。
 *
 * 059c で変わった前提（**ここを読まずに古いテストを足さないこと**）:
 * - ⚠ **出力先セクションは「どちらかの音が ON のときだけ」描画される。** よって出力先まわりを見る
 *   テストは `outputVisibleProps()` を使う（`baseProps()` は本番と同じ「両方 OFF」なので出力先が無い）。
 * - ⚠ **「テスト再生 ▶」は削除された。** 出力先の検証は「通知音を試聴 ▶」が同じデバイスで実音を
 *   鳴らすことで果たす。`onTestNotificationSound` / `audioTestState` props も無い。
 * - ⚠ **2 つの試聴ボタンは表示名もアクセシブル名も「通知音を試聴 ▶」で同一。** `getAllByRole` の
 *   並び順で引く（下記 `previewButtons()` が `title` で並び順を明示検証している）。
 *
 * あるべき挙動（docs/tasks/058a-audio-routing-foundation.md / 059a / 059b の完了条件・docs/security.md §9）:
 * - デバイスが**名前つきで**並ぶ。**デバイス ID は画面に出さない**（§9）。
 * - 先頭の選択肢は「選択しない（通知音を鳴らさない）」。
 *   ⚠ **「既定デバイス」という選択肢を作らない**——②-軽では OS 既定＝仮想オーディオデバイス＝
 *   配信に載る側なので、それは「載せないつもりの音が載る」導線そのもの。
 * - 保存済み ID が現在の一覧に無いとき、**警告を出したうえで「選択しない」を表示する**。
 *   ただし警告文にデバイス名・ID を含めない（§9）。
 * - 未選択のとき試聴は押せない（＝既定デバイスで鳴らす代替動作を持たない）。
 * - 列挙中（loading）は「見つかりません」を出さない（起動直後に必ず一瞬赤くなるのを避ける）。
 * - 列挙失敗・0 件・試聴失敗をそれぞれ区別して案内する。
 * - 仮想オーディオデバイスの導入案内がある（導入しないと「配信に載せない」が機能しない）。
 *
 * 表示専用＝WS/invoke は持たない（唯一の副作用 useHostOs のみ固定モック）。
 */

// useHostOs は Rust host_os を invoke するため、テストでは OS を固定してコンポーネントを隔離する。
vi.mock("../../features/platform/useHostOs", () => ({
  useHostOs: () => "macos",
}));

type Props = ComponentProps<typeof SettingsView>;

const DEVICES: AudioOutputDevice[] = [
  { id: "CoreAudio:BuiltInSpeakerDevice", name: "内蔵スピーカー" },
  { id: "CoreAudio:BlackHole2ch_UID", name: "BlackHole 2ch" },
];

// `SettingsView.obs.test.tsx` の baseProps と内容が重複するが、**共通化しない**（レビュー指摘に対する判断）。
// 理由＝①共通化すると片方の既定値を変えたときにもう片方のテストが巻き添えで壊れる ②各ファイルが
// 「自分の検証対象にとって何が既定か」を宣言できなくなる（obs 側は `audioOutputDevices: []` を注記付きで
// 書いていて、それ自体が意図の表明になっている）。
// 再修正トリガー＝この形の baseProps を持つファイルが 3 つ以上になるか、props 追加のたびに全ファイルを
// 触る手間が実際に負担になったとき。そのときは「必須 props の最小セット」だけを共有ヘルパへ出す。
//
// ⚠ **059b でトリガーに到達したかを判定した結果＝まだ出さない**（task-board の申し送りが「3 組目を足すのが
// 潮時」と書いていたので、明示的に評価した）。059b が増やすのは**同一ファイル内の describe** で、
// この形の baseProps を持つ**ファイル数は 2 のまま**。059c は props を**減らす**変更なので判断は不変。
//
// ⚠ **通知音は両方 OFF が既定**（本番と同じ）。059c 以降これは「出力先セクションが描画されない」も
// 意味するので、出力先を見るテストは下の `outputVisibleProps()` を使うこと。
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
    audioOutputDevices: DEVICES,
    audioOutputListState: "ready",
    audioOutputDeviceId: "",
    onAudioOutputDeviceIdChange: vi.fn(),
    onReloadAudioOutputDevices: vi.fn(),
    // 059a / 059b: 通知音（どちらも既定 OFF）。
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
    onSetObsPassword: vi.fn(),
    onClearObsPassword: vi.fn(),
    pinnedOverlayEnabled: false,
    onPinnedOverlayToggle: vi.fn(),
    // 066: 送信は使わないが型を満たす（⚠ 既定 OFF なので押せない）。
    onChatTestSend: async () => ({ ok: false, reason: "offline" }),
    chatSendChannel: "",
    ...over,
  };
}

/**
 * 059c: **出力先セクションが描画される状態**（＝どちらかの音が ON）の props。
 *
 * ⚠ コメント音を ON にしているのは「どちらか」を満たす最小の指定であって、コメント音固有の性質を
 * 見ているわけではない（OR であることは下の条件表示テストが両方向で固定している）。
 */
function outputVisibleProps(over: Partial<Props> = {}): Props {
  return baseProps({ soundCommentEnabled: true, ...over });
}

/** 出力先セレクト（可視ラベルと aria-label が同一文言なのは既存 Select の作法どおり）。 */
function outputSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", {
    name: "通知音の出力先",
  }) as HTMLSelectElement;
}

/**
 * 059c: 2 つの試聴ボタン（[コメント音, 投げ銭音]）。
 *
 * ⚠⚠ **表示名もアクセシブル名も「通知音を試聴 ▶」で完全に同一**（本人決定）なので、`getAllByRole` の
 * 並び順で引くしかない。並び順を**暗黙の前提**にすると、JSX で入れ替えたときに「別のボタンを黙って
 * テストしている」状態になって気付けないので、引いた直後に `title` を assert して
 * 「1 番目＝コメント音／2 番目＝投げ銭音」を**明示的に検証**する（入れ替わったらここで落ちる）。
 */
function previewButtons(): [HTMLButtonElement, HTMLButtonElement] {
  const buttons = screen.getAllByRole("button", {
    name: "通知音を試聴 ▶",
  }) as HTMLButtonElement[];
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toHaveAttribute(
    "title",
    "コメント通知音を選択中のデバイスで鳴らします",
  );
  expect(buttons[1]).toHaveAttribute(
    "title",
    "投げ銭通知音を選択中のデバイスで鳴らします",
  );
  return [buttons[0], buttons[1]];
}

/** コメント通知音の試聴ボタン（上段）。 */
function previewButton(): HTMLButtonElement {
  return previewButtons()[0];
}

/** 投げ銭通知音の試聴ボタン（下段）。 */
function monetaryPreviewButton(): HTMLButtonElement {
  return previewButtons()[1];
}

describe("SettingsView 通知音カード（出力先セクション）", () => {
  it("デバイスを名前つきで並べ、先頭は「選択しない」", () => {
    render(<SettingsView {...outputVisibleProps()} />);
    const options = Array.from(outputSelect().options).map((o) => o.textContent);
    expect(options).toEqual([
      "選択しない（通知音を鳴らさない）",
      "内蔵スピーカー",
      "BlackHole 2ch",
    ]);
  });

  it("⚠ 「既定デバイス」という選択肢を作らない（載せないつもりの音が載る導線になる）", () => {
    render(<SettingsView {...outputVisibleProps()} />);
    const options = Array.from(outputSelect().options).map(
      (o) => o.textContent ?? "",
    );
    // 「選択しない」以外に、出力先として既定を指す選択肢が無いこと。
    expect(options.filter((label) => label.includes("既定"))).toEqual([]);
  });

  it("§9: デバイス ID を画面のテキストに出さない（出すのは名前だけ）", () => {
    const { container } = render(<SettingsView {...outputVisibleProps()} />);
    for (const device of DEVICES) {
      expect(container.textContent).not.toContain(device.id);
      expect(container.textContent).toContain(device.name);
    }
  });

  it("選択を変えると onAudioOutputDeviceIdChange をそのデバイス ID で呼ぶ", () => {
    const props = outputVisibleProps();
    render(<SettingsView {...props} />);
    fireEvent.change(outputSelect(), {
      target: { value: "CoreAudio:BlackHole2ch_UID" },
    });
    expect(props.onAudioOutputDeviceIdChange).toHaveBeenCalledWith(
      "CoreAudio:BlackHole2ch_UID",
    );
  });

  it("再読み込みで onReloadAudioOutputDevices を呼ぶ", () => {
    const props = outputVisibleProps();
    render(<SettingsView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(props.onReloadAudioOutputDevices).toHaveBeenCalledTimes(1);
  });

  it("⚠ 059c: 「テスト再生」ボタンは無い（出力先の検証は試聴が兼ねる）", () => {
    // 削除したボタンが復活したら、**同じ役割のボタンが 2 種類**並ぶことになる（058a が
    // 「テスト再生＝出力先の検証／試聴＝音の確認」で分けていた区別は、カード統合で意味を失った）。
    render(<SettingsView {...outputVisibleProps()} />);
    expect(
      screen.queryByRole("button", { name: /テスト再生/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/テスト音を再生できませんでした/)).toBeNull();
  });

  describe("⚠ 059c: 出力先セクションはどちらかの音が ON のときだけ出す", () => {
    /** 出力先セクションを構成する要素が「揃って」出ているか（部分的に出ていたら設計の崩れ）。 */
    function outputSectionShown(): boolean {
      return (
        screen.queryByRole("combobox", { name: "通知音の出力先" }) !== null &&
        screen.queryByRole("button", { name: "再読み込み" }) !== null &&
        screen.queryByText(/未選択のあいだは通知音を鳴らしません/) !== null
      );
    }

    it("両方 OFF なら出さない（鳴らないのに出力先を選ばせない）", () => {
      render(
        <SettingsView
          {...baseProps({
            soundCommentEnabled: false,
            soundMonetaryEnabled: false,
          })}
        />,
      );
      expect(outputSectionShown()).toBe(false);
      // 一部だけ残っていないこと（セクションごと消えていること）。
      expect(
        screen.queryByRole("combobox", { name: "通知音の出力先" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "再読み込み" }),
      ).not.toBeInTheDocument();
    });

    it("コメント通知音を ON にすると出る", () => {
      render(
        <SettingsView
          {...baseProps({
            soundCommentEnabled: true,
            soundMonetaryEnabled: false,
          })}
        />,
      );
      expect(outputSectionShown()).toBe(true);
    });

    it("⚠ 投げ銭通知音だけ ON でも出る（ゲートは 2 音の OR）", () => {
      // 片方向だけ通ると「コメント音の ON/OFF で出し分ける」実装でも緑になる。
      render(
        <SettingsView
          {...baseProps({
            soundCommentEnabled: false,
            soundMonetaryEnabled: true,
          })}
        />,
      );
      expect(outputSectionShown()).toBe(true);
    });

    it("⚠ トグルと試聴ボタンは両方 OFF でも消えない（出力先だけが条件表示）", () => {
      // 条件表示の範囲が広がって「OFF にすると ON へ戻せない」になっていないことの担保。
      render(
        <SettingsView
          {...baseProps({
            soundCommentEnabled: false,
            soundMonetaryEnabled: false,
          })}
        />,
      );
      expect(
        screen.getByRole("switch", { name: "コメント通知音" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("switch", { name: "投げ銭通知音" }),
      ).toBeInTheDocument();
      expect(previewButtons()).toHaveLength(2);
    });
  });

  describe("保存済みデバイスが見つからないとき（フォールバックの向き）", () => {
    const missing = outputVisibleProps({
      audioOutputDeviceId: "CoreAudio:UnpluggedHeadphones",
      audioOutputListState: "ready",
    });

    it("警告を出す（黙って既定デバイスへ落とさない）", () => {
      render(<SettingsView {...missing} />);
      expect(
        screen.getByText(
          "以前選んだ音声出力デバイスが見つかりません。通知音は鳴りません。デバイスを選び直してください。",
        ),
      ).toBeInTheDocument();
    });

    it("セレクトは「選択しない」を表示し、試聴も押せない", () => {
      render(<SettingsView {...missing} />);
      expect(outputSelect().value).toBe("");
      // 059c: 旧「テスト再生 ▶」が担っていた「押せない」の担保を試聴 2 本が引き継ぐ。
      expect(previewButton()).toBeDisabled();
      expect(monetaryPreviewButton()).toBeDisabled();
    });

    it("§9: 警告文に保存済みのデバイス ID を含めない", () => {
      const { container } = render(<SettingsView {...missing} />);
      expect(container.textContent).not.toContain(
        "CoreAudio:UnpluggedHeadphones",
      );
    });

    it("列挙中（loading）はまだ警告を出さない（起動直後に一瞬赤くならない）", () => {
      render(
        <SettingsView
          {...outputVisibleProps({
            audioOutputDeviceId: "CoreAudio:UnpluggedHeadphones",
            audioOutputListState: "loading",
            audioOutputDevices: [],
          })}
        />,
      );
      expect(
        screen.queryByText(/以前選んだ音声出力デバイスが見つかりません/),
      ).not.toBeInTheDocument();
    });

    it("列挙に失敗したときは『見つかりません』ではなく列挙失敗として案内する（案内を二重にしない）", () => {
      // 「取得できなかった」ときに一覧が空なのは当然なので、「以前選んだデバイスが見つかりません」を
      // 併記すると原因を取り違えさせる（ユーザーが取る行動は『再読み込み』であって『選び直し』ではない）。
      render(
        <SettingsView
          {...outputVisibleProps({
            audioOutputDeviceId: "CoreAudio:UnpluggedHeadphones",
            audioOutputListState: "failed",
            audioOutputDevices: [],
          })}
        />,
      );
      expect(
        screen.queryByText(/以前選んだ音声出力デバイスが見つかりません/),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/音声出力デバイスを取得できませんでした/),
      ).toBeInTheDocument();
    });
  });

  it("未選択のときは『見つかりません』警告を出さない（まだ何も選んでいないので警告ではない）", () => {
    render(
      <SettingsView
        {...outputVisibleProps({
          audioOutputDeviceId: "",
          audioOutputListState: "ready",
          audioOutputDevices: [],
        })}
      />,
    );
    expect(
      screen.queryByText(/以前選んだ音声出力デバイスが見つかりません/),
    ).not.toBeInTheDocument();
  });

  it("未選択が『鳴らさない』であることを常に説明する（『既定で鳴る』と誤解させない）", () => {
    render(
      <SettingsView {...outputVisibleProps({ audioOutputDeviceId: "" })} />,
    );
    expect(
      screen.getByText(/未選択のあいだは通知音を鳴らしません/),
    ).toBeInTheDocument();
  });

  it("⚠ 059c: 「配信に載る/載らない」の説明はこのセクションが唯一の置き場所", () => {
    // 各トグルの .note から同趣旨の説明を落としたので（本人指示）、ここが消えると
    // **「配信に載せない」という機能の意味そのものが画面から消える**。
    render(<SettingsView {...outputVisibleProps()} />);
    expect(
      screen.getByText(
        /配信に流していないデバイス（PCのスピーカーやヘッドホン）を選べば、通知音は配信に載りません/,
      ),
    ).toBeInTheDocument();
  });

  it("§8: デバイス名は文字列として描画する（HTML として解釈しない）", () => {
    // デバイス名は OS 由来＝アプリの外から来る値なので、そのまま DOM に流れる経路を作らない。
    // React が escape するので実害は無いが、`dangerouslySetInnerHTML` 等へ退行したらここで落ちる。
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <SettingsView
        {...outputVisibleProps({
          audioOutputDevices: [{ id: "CoreAudio:Evil", name: hostile }],
        })}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      Array.from(outputSelect().options).map((o) => o.textContent),
    ).toContain(hostile);
  });

  it("列挙に失敗したら、その旨と再読み込みを案内する", () => {
    render(
      <SettingsView
        {...outputVisibleProps({
          audioOutputListState: "failed",
          audioOutputDevices: [],
        })}
      />,
    );
    expect(
      screen.getByText(
        "音声出力デバイスを取得できませんでした。「再読み込み」をお試しください。",
      ),
    ).toBeInTheDocument();
  });

  it("出力デバイスが 0 件なら、失敗とは別の案内を出す", () => {
    render(
      <SettingsView
        {...outputVisibleProps({
          audioOutputListState: "ready",
          audioOutputDevices: [],
        })}
      />,
    );
    expect(
      screen.getByText(/使える音声出力デバイスがありません/),
    ).toBeInTheDocument();
    // 「取得できませんでした」（列挙失敗）と混同させない。
    expect(
      screen.queryByText(/音声出力デバイスを取得できませんでした/),
    ).not.toBeInTheDocument();
  });

  it("仮想オーディオデバイスの導入案内があり、入れないと機能しないことを明示する", () => {
    render(<SettingsView {...outputVisibleProps()} />);
    expect(
      screen.getByText(
        "読み上げを配信に載せて、通知音は載せない設定にするには",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /仮想オーディオデバイスを導入していない場合、この設定をしても「配信に載せない」は機能しません/,
      ),
    ).toBeInTheDocument();
  });
});

/**
 * 059a / 059b: 「通知音」カードのトグルと試聴（＝**何を鳴らすか**）の仕様テスト。
 *
 * あるべき挙動（docs/tasks/059a-comment-notification-sound.md / 059b）:
 * - ⚠ **既定は OFF**（アップデート直後に無操作で鳴り始めない）。
 * - **ON/OFF は 2 音で独立**（片方 OFF でもう片方は鳴る）。
 * - 試聴ボタンが**音ごとに 1 つずつトグルの直下**にある（ON にしても次のコメントが来るまで音を
 *   確認できない、を避ける）。⚠ **`soundPreviewState` は 2 つで共有**＝片方の再生中は両方 disabled
 *   （Rust の同時再生 1 本と一致させる）。
 * - ⚠ 出力先が未選択でも**トグルを disabled にしない**（押せない理由が画面から読めないため）。
 *   代わりに **ON かつ未選択のときだけ**理由を文章で出し、試聴は押せなくする。
 * - ⚠ 「以前選んだデバイスが見つからない」ときは**「未選択」とは言わない**（同じ状態を 2 つの違う
 *   言葉で二重に叱ることになり、かつ「未選択」は事実として誤り）。
 * - ⚠ 音量スライダーは**無い**（振幅は Rust 固定・OS のデバイス別音量が独立に効く）。
 * - §9: 警告文にデバイス名・デバイス ID を出さない。
 */
describe("SettingsView 通知音カード（トグルと試聴）", () => {
  it("コメント通知音のトグルがあり、既定は OFF", () => {
    render(<SettingsView {...baseProps()} />);
    expect(
      screen.getByRole("switch", { name: "コメント通知音" }),
    ).not.toBeChecked();
  });

  it("トグルを操作すると onSoundCommentEnabledChange が呼ばれる", () => {
    const onSoundCommentEnabledChange = vi.fn();
    render(<SettingsView {...baseProps({ onSoundCommentEnabledChange })} />);
    fireEvent.click(screen.getByRole("switch", { name: "コメント通知音" }));
    expect(onSoundCommentEnabledChange).toHaveBeenCalledWith(true);
  });

  it("デバイス選択済みなら試聴が押せて onPreviewCommentSound を呼ぶ", () => {
    const onPreviewCommentSound = vi.fn();
    render(
      <SettingsView
        {...baseProps({
          audioOutputDeviceId: "CoreAudio:BuiltInSpeakerDevice",
          onPreviewCommentSound,
        })}
      />,
    );
    expect(previewButton()).toBeEnabled();
    fireEvent.click(previewButton());
    expect(onPreviewCommentSound).toHaveBeenCalledTimes(1);
  });

  it("⚠ 出力先が未選択のとき試聴は押せない（押しても何も起きないボタンにしない）", () => {
    render(<SettingsView {...baseProps({ audioOutputDeviceId: "" })} />);
    expect(previewButton()).toBeDisabled();
  });

  it("再生中は試聴を押せない（連打で Rust の同時再生上限に当てない）", () => {
    render(
      <SettingsView
        {...baseProps({
          audioOutputDeviceId: "CoreAudio:BuiltInSpeakerDevice",
          soundPreviewState: "playing",
        })}
      />,
    );
    expect(previewButton()).toBeDisabled();
  });

  it("投げ銭通知音のトグルがあり、既定は OFF（059b）", () => {
    render(<SettingsView {...baseProps()} />);
    expect(
      screen.getByRole("switch", { name: "投げ銭通知音" }),
    ).not.toBeChecked();
  });

  it("投げ銭トグルを操作すると onSoundMonetaryEnabledChange が呼ばれる（059b）", () => {
    const onSoundMonetaryEnabledChange = vi.fn();
    render(<SettingsView {...baseProps({ onSoundMonetaryEnabledChange })} />);
    fireEvent.click(screen.getByRole("switch", { name: "投げ銭通知音" }));
    expect(onSoundMonetaryEnabledChange).toHaveBeenCalledWith(true);
  });

  it("⚠ 2 つのトグルは独立している（片方を押してももう片方のハンドラは呼ばれない）", () => {
    const onSoundCommentEnabledChange = vi.fn();
    const onSoundMonetaryEnabledChange = vi.fn();
    render(
      <SettingsView
        {...baseProps({
          onSoundCommentEnabledChange,
          onSoundMonetaryEnabledChange,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "投げ銭通知音" }));
    expect(onSoundMonetaryEnabledChange).toHaveBeenCalledTimes(1);
    expect(onSoundCommentEnabledChange).not.toHaveBeenCalled();
  });

  it("⚠⚠ 2 つの試聴ボタンは別のハンドラを呼ぶ（配線の取り違えを殺す・059b/059c）", () => {
    // props が同型（`() => void` 2 本）なので、渡し間違えても typecheck は通ってしまう。
    // ⚠ 059c で**ボタン名が同一になった**ので、取り違えは「名前で引けば分かる」ものではなくなった。
    // `previewButtons()` が title で並び順を検証したうえで、ここでハンドラの対応を固定する。
    const onPreviewCommentSound = vi.fn();
    const onPreviewMonetarySound = vi.fn();
    render(
      <SettingsView
        {...baseProps({
          audioOutputDeviceId: "CoreAudio:BuiltInSpeakerDevice",
          onPreviewCommentSound,
          onPreviewMonetarySound,
        })}
      />,
    );

    fireEvent.click(previewButton());
    expect(onPreviewCommentSound).toHaveBeenCalledTimes(1);
    expect(onPreviewMonetarySound).not.toHaveBeenCalled();

    fireEvent.click(monetaryPreviewButton());
    expect(onPreviewMonetarySound).toHaveBeenCalledTimes(1);
    expect(onPreviewCommentSound).toHaveBeenCalledTimes(1);
  });

  it("⚠ 059c: 試聴ボタンは音ごとに 1 つずつで、名前は同一「通知音を試聴 ▶」", () => {
    // 本人決定の固定（aria-label で区別しない）。⚠ ボタンが 1 つに減る／名前が音種入りに戻る、
    // のどちらの変更でも落ちる＝「同名 2 つ」という状態が意図であることを明示する。
    render(<SettingsView {...baseProps()} />);
    expect(
      screen.getAllByRole("button", { name: "通知音を試聴 ▶" }),
    ).toHaveLength(2);
    // 059b までの音種入りの名前（「コメント音を試聴 ▶」「投げ銭音を試聴 ▶」）へ戻っていないこと。
    // ⚠ `/音を試聴/` では新しい名前「通知音を試聴」にも一致してしまうので、音種を明示して絞る。
    expect(
      screen.queryByRole("button", { name: /(コメント|投げ銭)音を試聴/ }),
    ).not.toBeInTheDocument();
  });

  it("⚠ 出力先が未選択のとき投げ銭試聴も押せない（fail-closed を UI でも守る）", () => {
    render(<SettingsView {...baseProps({ audioOutputDeviceId: "" })} />);
    expect(monetaryPreviewButton()).toBeDisabled();
  });

  it("⚠ 再生中は 2 つの試聴が両方 disabled（Rust の同時再生 1 本と一致させる）", () => {
    // state を共有している帰結。分けると「再生中にもう片方を押せる」→ Rust に黙って捨てられる＝
    // 押したのに鳴らない、になる。
    render(
      <SettingsView
        {...baseProps({
          audioOutputDeviceId: "CoreAudio:BuiltInSpeakerDevice",
          soundPreviewState: "playing",
        })}
      />,
    );
    expect(previewButton()).toBeDisabled();
    expect(monetaryPreviewButton()).toBeDisabled();
  });

  it("⚠ 投げ銭音だけ ON でも未選択の理由を伝える（059b・ゲートは 2 音の OR）", () => {
    render(
      <SettingsView
        {...baseProps({
          soundCommentEnabled: false,
          soundMonetaryEnabled: true,
          audioOutputDeviceId: "",
        })}
      />,
    );
    expect(
      screen.getByText(
        "通知音の出力先が未選択です。デバイスを選ぶまで鳴りません。",
      ),
    ).toBeInTheDocument();
  });

  it("⚠⚠ 両方 ON でも未選択の赤字は 1 本だけ（同じ状態を二重に叱らない）", () => {
    render(
      <SettingsView
        {...baseProps({
          soundCommentEnabled: true,
          soundMonetaryEnabled: true,
          audioOutputDeviceId: "",
        })}
      />,
    );
    expect(screen.getAllByText(/通知音の出力先が未選択です/)).toHaveLength(1);
  });

  it("⚠ ON かつ出力先が未選択のとき、鳴らない理由を文章で伝える（トグルは無効化しない）", () => {
    render(
      <SettingsView
        {...baseProps({ soundCommentEnabled: true, audioOutputDeviceId: "" })}
      />,
    );
    expect(
      screen.getByText(
        "通知音の出力先が未選択です。デバイスを選ぶまで鳴りません。",
      ),
    ).toBeInTheDocument();
    // ⚠ 「先に ON にしてから出力先を選ぶ」順序を禁止しない（059c の条件表示はこの順序が前提）。
    expect(screen.getByRole("switch", { name: "コメント通知音" })).toBeEnabled();
  });

  it("両方 OFF のあいだは未選択でも赤字を出さない（鳴らないのが正常な状態）", () => {
    render(
      <SettingsView
        {...baseProps({
          soundCommentEnabled: false,
          soundMonetaryEnabled: false,
          audioOutputDeviceId: "",
        })}
      />,
    );
    expect(
      screen.queryByText(/通知音の出力先が未選択です/),
    ).not.toBeInTheDocument();
  });

  it("⚠ 保存済みデバイスが一覧に無いときは『見つかりません』だけを言う（二重に叱らない）", () => {
    render(
      <SettingsView
        {...baseProps({
          soundCommentEnabled: true,
          // 一覧（DEVICES）に無い ID ＝「未選択」ではなく「見つからない」。
          audioOutputDeviceId: "CoreAudio:UnpluggedHeadphones",
        })}
      />,
    );
    expect(
      screen.getByText(/以前選んだ音声出力デバイスが見つかりません/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/通知音の出力先が未選択です/),
    ).not.toBeInTheDocument();
  });

  it("試聴に失敗したら案内する（§9: デバイス名・ID を出さない）", () => {
    const { container } = render(
      <SettingsView
        {...outputVisibleProps({
          audioOutputDeviceId: "CoreAudio:BuiltInSpeakerDevice",
          soundPreviewState: "failed",
        })}
      />,
    );
    expect(
      screen.getByText(
        "通知音を再生できませんでした。デバイスを選び直してください。",
      ),
    ).toBeInTheDocument();
    // 選択中デバイスの ID が画面に出ていないこと（名前は Select の option に出るが ID は出さない）。
    // ⚠ outputVisibleProps を使うのは、**セレクトが描画された状態**で ID が漏れないことを見たいから
    //（両方 OFF だとセレクトごと消えるので、この assert が自明に通る空振りになる）。
    expect(container.textContent).not.toContain("CoreAudio:");
  });

  it("⚠ 音量スライダーを持たない（振幅は Rust 固定・OS のデバイス別音量が独立に効く）", () => {
    const { container } = render(<SettingsView {...outputVisibleProps()} />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });
});
