import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { DEFAULT_OVERLAY_FONT } from "../../features/comment-viewer/overlaySettings";
import { TTS_MAX_LENGTH_DEFAULT } from "../../features/comment-viewer/ttsPrefs";
import type { AudioOutputDevice } from "../../features/comment-viewer/audioOutputApi";

/**
 * 058a: 設定ビューの「音声出力（通知音）」カードの仕様テスト。
 *
 * あるべき挙動（docs/tasks/058a-audio-routing-foundation.md 完了条件・docs/security.md §9）:
 * - デバイスが**名前つきで**並ぶ。**デバイス ID は画面に出さない**（§9）。
 * - 先頭の選択肢は「選択しない（通知音を鳴らさない）」。
 *   ⚠ **「既定デバイス」という選択肢を作らない**——②-軽では OS 既定＝仮想オーディオデバイス＝
 *   配信に載る側なので、それは「載せないつもりの音が載る」導線そのもの。
 * - 保存済み ID が現在の一覧に無いとき、**警告を出したうえで「選択しない」を表示する**。
 *   ただし警告文にデバイス名・ID を含めない（§9）。
 * - 未選択のときテスト再生は押せない（＝既定デバイスで鳴らす代替動作を持たない）。
 * - 列挙中（loading）は「見つかりません」を出さない（起動直後に必ず一瞬赤くなるのを避ける）。
 * - 列挙失敗・0 件・テスト再生失敗をそれぞれ区別して案内する。
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
// 理由＝①共通化すると片方の既定値を変えたときにもう片方のテストが巻き添えで壊れる（今回まさに props を
// 7 個足して obs 側を触っている）②各ファイルが「自分の検証対象にとって何が既定か」を宣言できなくなる
// （obs 側は `audioOutputDevices: []` を注記付きで書いていて、それ自体が意図の表明になっている）。
// 再修正トリガー＝この形の baseProps を持つファイルが 3 つ以上になるか、props 追加のたびに全ファイルを
// 触る手間が実際に負担になったとき。そのときは「必須 props の最小セット」だけを共有ヘルパへ出す。
//
// ⚠ **059b でトリガーに到達したかを判定した結果＝まだ出さない**（task-board の申し送りが「3 組目を足すのが
// 潮時」と書いていたので、明示的に評価した）。059b が増やすのは**同一ファイル内の describe** で、
// この形の baseProps を持つ**ファイル数は 2 のまま**。いま共有化すると、上の①（片方の既定値変更が
// もう片方を巻き添えにする）を先に払うことになる。props 追加も 3 個で、負担が実測で問題になっていない。
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
    onTestNotificationSound: vi.fn(),
    audioTestState: "idle",
    // 059a / 059b: 通知音（どちらも既定 OFF）。下の describe("SettingsView 通知音") が検証対象にする。
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
    ...over,
  };
}

/** 出力先セレクト（可視ラベルと aria-label が同一文言なのは既存 Select の作法どおり）。 */
function outputSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", {
    name: "通知音の出力先",
  }) as HTMLSelectElement;
}

describe("SettingsView 音声出力（通知音）", () => {
  it("デバイスを名前つきで並べ、先頭は「選択しない」", () => {
    render(<SettingsView {...baseProps()} />);
    const options = Array.from(outputSelect().options).map((o) => o.textContent);
    expect(options).toEqual([
      "選択しない（通知音を鳴らさない）",
      "内蔵スピーカー",
      "BlackHole 2ch",
    ]);
  });

  it("⚠ 「既定デバイス」という選択肢を作らない（載せないつもりの音が載る導線になる）", () => {
    render(<SettingsView {...baseProps()} />);
    const options = Array.from(outputSelect().options).map(
      (o) => o.textContent ?? "",
    );
    // 「選択しない」以外に、出力先として既定を指す選択肢が無いこと。
    expect(options.filter((label) => label.includes("既定"))).toEqual([]);
  });

  it("§9: デバイス ID を画面のテキストに出さない（出すのは名前だけ）", () => {
    const { container } = render(<SettingsView {...baseProps()} />);
    for (const device of DEVICES) {
      expect(container.textContent).not.toContain(device.id);
      expect(container.textContent).toContain(device.name);
    }
  });

  it("選択を変えると onAudioOutputDeviceIdChange をそのデバイス ID で呼ぶ", () => {
    const props = baseProps();
    render(<SettingsView {...props} />);
    fireEvent.change(outputSelect(), {
      target: { value: "CoreAudio:BlackHole2ch_UID" },
    });
    expect(props.onAudioOutputDeviceIdChange).toHaveBeenCalledWith(
      "CoreAudio:BlackHole2ch_UID",
    );
  });

  it("選択済みならテスト再生を押せて、onTestNotificationSound を呼ぶ", () => {
    const props = baseProps({
      audioOutputDeviceId: "CoreAudio:BuiltInSpeakerDevice",
    });
    render(<SettingsView {...props} />);
    const button = screen.getByRole("button", { name: "テスト再生 ▶" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(props.onTestNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("未選択のあいだはテスト再生を押せない（既定デバイスで代わりに鳴らさない）", () => {
    render(<SettingsView {...baseProps({ audioOutputDeviceId: "" })} />);
    expect(screen.getByRole("button", { name: "テスト再生 ▶" })).toBeDisabled();
  });

  it("再生中はテスト再生を押せない（多重再生を UI で抑える）", () => {
    render(
      <SettingsView
        {...baseProps({
          audioOutputDeviceId: "CoreAudio:BuiltInSpeakerDevice",
          audioTestState: "playing",
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "テスト再生 ▶" })).toBeDisabled();
  });

  it("再読み込みで onReloadAudioOutputDevices を呼ぶ", () => {
    const props = baseProps();
    render(<SettingsView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(props.onReloadAudioOutputDevices).toHaveBeenCalledTimes(1);
  });

  describe("保存済みデバイスが見つからないとき（フォールバックの向き）", () => {
    const missing = baseProps({
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

    it("セレクトは「選択しない」を表示し、テスト再生も押せない", () => {
      render(<SettingsView {...missing} />);
      expect(outputSelect().value).toBe("");
      expect(
        screen.getByRole("button", { name: "テスト再生 ▶" }),
      ).toBeDisabled();
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
          {...baseProps({
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
          {...baseProps({
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
        {...baseProps({
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
    render(<SettingsView {...baseProps({ audioOutputDeviceId: "" })} />);
    expect(
      screen.getByText(/未選択のあいだは通知音を鳴らしません/),
    ).toBeInTheDocument();
  });

  it("§8: デバイス名は文字列として描画する（HTML として解釈しない）", () => {
    // デバイス名は OS 由来＝アプリの外から来る値なので、そのまま DOM に流れる経路を作らない。
    // React が escape するので実害は無いが、`dangerouslySetInnerHTML` 等へ退行したらここで落ちる。
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <SettingsView
        {...baseProps({
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
        {...baseProps({
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
        {...baseProps({
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

  it("テスト再生に失敗したら、その旨を出す", () => {
    render(
      <SettingsView
        {...baseProps({
          audioOutputDeviceId: "CoreAudio:BuiltInSpeakerDevice",
          audioTestState: "failed",
        })}
      />,
    );
    expect(
      screen.getByText(
        "テスト音を再生できませんでした。デバイスを選び直してください。",
      ),
    ).toBeInTheDocument();
  });

  it("仮想オーディオデバイスの導入案内があり、入れないと機能しないことを明示する", () => {
    render(<SettingsView {...baseProps()} />);
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
 * 059a / 059b: 設定ビューの「通知音」カードの仕様テスト。
 *
 * 059b の追加分:
 * - 投げ銭通知音のトグル（**既定 OFF**）と試聴ボタン。**ON/OFF は 2 音で独立**。
 * - ⚠ 試聴ボタンは 2 つだが **`soundPreviewState` は共有**＝片方の再生中は両方 disabled
 *   （Rust の同時再生 1 本と一致させる）。
 * - ⚠ 未選択の赤字は **2 音の OR で 1 本だけ**（同じ状態を 2 つの言葉で二重に叱らない）。
 * - ⚠ ボタン名は「コメント音を試聴 ▶」「投げ銭音を試聴 ▶」（旧「試聴 ▶」は 034c の話者試聴と同名だった）。
 *
 * ⚠ **ファイルを分けず、この 058a のファイルに同居させている**（レビュー観点として明示）。
 * 理由＝冒頭 `baseProps` のコメントが「この形の baseProps を持つファイルが 3 つ以上になったら
 * 共有ヘルパへ出す」と再修正トリガーを定めており、3 本目を作るとそこに抵触する。両カードとも
 * 「音まわり」で props も同じ一式を要るので、describe を分けるだけで意図の分離は足りる。
 *
 * あるべき挙動（docs/tasks/059a-comment-notification-sound.md）:
 * - ⚠ **既定は OFF**（アップデート直後に無操作で鳴り始めない）。
 * - 試聴ボタンがある（ON にしても次のコメントが来るまで音を確認できない、を避ける）。
 *   ⚠ 058a の「テスト再生」とは**目的が違うので重複ではない**——あちらは出力先の検証、こちらは音の確認。
 * - ⚠ 出力先が未選択でも**トグルを disabled にしない**（別カードの状態に依存する disabled は理由が読めない）。
 *   代わりに **ON かつ未選択のときだけ**理由を文章で出し、試聴は押せなくする。
 * - ⚠ 「以前選んだデバイスが見つからない」ときは**このカードでは何も言わない**（058a のカードの担当。
 *   両方出すと同じ状態を 2 つの違う言葉で二重に叱ることになり、かつ「未選択」は事実として誤り）。
 * - ⚠ 音量スライダーは**無い**（振幅は Rust 固定・OS のデバイス別音量が独立に効く）。
 * - §9: 警告文にデバイス名・デバイス ID を出さない。
 */
describe("SettingsView 通知音", () => {
  /** 059a の試聴ボタン（058a の「テスト再生 ▶」とは別物）。 */
  function previewButton(): HTMLButtonElement {
    return screen.getByRole("button", {
      name: "コメント音を試聴 ▶",
    }) as HTMLButtonElement;
  }

  /** 059b の試聴ボタン。 */
  function monetaryPreviewButton(): HTMLButtonElement {
    return screen.getByRole("button", {
      name: "投げ銭音を試聴 ▶",
    }) as HTMLButtonElement;
  }

  it("コメント通知音のトグルがあり、既定は OFF", () => {
    render(<SettingsView {...baseProps()} />);
    expect(
      screen.getByRole("switch", { name: "コメント通知音" }),
    ).not.toBeChecked();
  });

  it("トグルを操作すると onSoundCommentEnabledChange が呼ばれる", () => {
    const onSoundCommentEnabledChange = vi.fn();
    render(
      <SettingsView {...baseProps({ onSoundCommentEnabledChange })} />,
    );
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

  it("⚠⚠ 投げ銭音 OFF のときスパチャが無音になることを説明文で伝える（059b・レビュー Q-3）", () => {
    // 排他は ON/OFF より先に効くので、このトグルが OFF だと**投げ銭のときはコメント音も鳴らない**。
    // 挙動は意図どおりだが、説明が無いと「スパチャのときだけ音が消える」原因にたどり着けない。
    // ⚠ 文言そのものではなく「無音になることに触れているか」を見る（言い回しの調整で落とさない）。
    render(<SettingsView {...baseProps()} />);
    expect(
      screen.getByText(/OFF にすると、投げ銭のときはコメント通知音も鳴りません/),
    ).toBeInTheDocument();
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

  it("⚠ 2 つの試聴ボタンは別のハンドラを呼ぶ（配線の取り違えを殺す・059b）", () => {
    // props が同型（`() => void` 2 本）なので、渡し間違えても typecheck は通ってしまう。
    // 059a レビュー Q-9 と同じ考え方で、取り違えそのものをここで検出する。
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
        "通知音の出力先が未選択です。上の「音声出力（通知音）」でデバイスを選ぶまで鳴りません。",
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
    expect(
      screen.getAllByText(/通知音の出力先が未選択です/),
    ).toHaveLength(1);
  });

  it("⚠ ON かつ出力先が未選択のとき、鳴らない理由を文章で伝える（トグルは無効化しない）", () => {
    render(
      <SettingsView
        {...baseProps({ soundCommentEnabled: true, audioOutputDeviceId: "" })}
      />,
    );
    expect(
      screen.getByText(
        "通知音の出力先が未選択です。上の「音声出力（通知音）」でデバイスを選ぶまで鳴りません。",
      ),
    ).toBeInTheDocument();
    // ⚠ 別カードの状態に依存する disabled は理由が読めないので、トグルは押せるままにする
    //（「先に ON にしてから出力先を選ぶ」順序を禁止しない）。
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

  it("⚠ 保存済みデバイスが一覧に無いときは 058a のカードだけが言う（二重に叱らない）", () => {
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
        {...baseProps({
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
    expect(container.textContent).not.toContain("CoreAudio:");
  });

  it("⚠ 音量スライダーを持たない（振幅は Rust 固定・OS のデバイス別音量が独立に効く）", () => {
    const { container } = render(<SettingsView {...baseProps()} />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });
});
