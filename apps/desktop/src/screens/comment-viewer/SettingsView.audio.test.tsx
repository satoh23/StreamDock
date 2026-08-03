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
