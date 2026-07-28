import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { DEFAULT_OVERLAY_FONT } from "../../features/comment-viewer/overlaySettings";

/**
 * 044a: 設定ビューの OBS 連携 UI の仕様テスト。
 * あるべき挙動（docs/tasks/044a / docs/security.md §9）:
 * - 自動反映トグル（045a「OBS へ自動追加（連携）」→「OBSに自動で反映する」→ 045c で条件付きの現 label）を
 *   描画し、操作で onObsAutoAddToggle を呼ぶ。
 * - OBS パスワード欄は **認証が必要なとき（authRequired=true）だけ**出す。未検出/認証不要では出さない。
 * - WS 未検出（null）/未有効（enabled=false）のときだけ有効化ガイドを出す。
 * - 保存ボタンは入力が空/空白のみのとき無効。保存で onSetObsPassword に入力値を渡し、**入力欄を即クリア**（§9）。
 * - 削除で onClearObsPassword を呼び、入力欄をクリアする。
 * - obs.state（connecting/added/reused/failed）に応じた状態文言を出す。
 * - 手動キャプチャ注記の OBS 実窓名は Rust/sidecar と同一文字列（045a・044a の窓名一致を壊さないための回帰テスト）。
 * 表示専用＝WS/invoke は持たない（唯一の副作用 useHostOs のみ固定モック）。
 */

// useHostOs は Rust host_os を invoke するため、テストでは OS を固定してコンポーネントを隔離する（表示専用性は不変）。
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
    speakers: [],
    selectedSpeakerId: 0,
    onSpeakerIdChange: vi.fn(),
    onPreview: vi.fn(),
    // 045b: 表示（開閉）トグルは本体ツールバーへ移設したため、SettingsViewProps に overlayOpen /
    // onOverlayToggle は無い（余剰プロパティ検査で typecheck が落ちるので残さない）。移設先の検証は
    // CommentViewerApp.toolbar.test.tsx が担う。このファイルの検証対象（044a の OBS 連携 UI）は不変。
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
    ...over,
  };
}

const GUIDE = /OBSの設定が不足しています/;

describe("SettingsView OBS 連携", () => {
  it("OBS 自動追加トグルを描画し、操作で onObsAutoAddToggle を呼ぶ", () => {
    const props = baseProps();
    render(<SettingsView {...props} />);
    // 045c: label は「いつ反映されるのか」が読み取れる条件付きの文（鉤括弧内は本体ツールバーの表示トグルと同一文字列）。
    const toggle = screen.getByRole("switch", {
      name: "「コメントをOBSに表示」ON時、OBSに自動で反映する",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(props.onObsAutoAddToggle).toHaveBeenCalledWith(true);
  });

  it("認証不要（authRequired=false）ではパスワード欄を出さない", () => {
    render(
      <SettingsView
        {...baseProps({
          obsConfig: { enabled: true, port: 4455, authRequired: false },
        })}
      />,
    );
    expect(screen.queryByPlaceholderText("OBS のサーバーパスワード")).toBeNull();
  });

  it("未検出（null）ではパスワード欄を出さず、有効化ガイドを出す", () => {
    render(<SettingsView {...baseProps({ obsConfig: null })} />);
    expect(screen.queryByPlaceholderText("OBS のサーバーパスワード")).toBeNull();
    expect(screen.getByText(GUIDE)).toBeInTheDocument();
  });

  it("WS 未有効（enabled=false）でも有効化ガイドを出す", () => {
    render(
      <SettingsView
        {...baseProps({
          obsConfig: { enabled: false, port: 4455, authRequired: false },
        })}
      />,
    );
    expect(screen.getByText(GUIDE)).toBeInTheDocument();
  });

  it("WS 有効かつ認証不要では有効化ガイドを出さない", () => {
    render(
      <SettingsView
        {...baseProps({
          obsConfig: { enabled: true, port: 4455, authRequired: false },
        })}
      />,
    );
    expect(screen.queryByText(GUIDE)).toBeNull();
  });

  it("認証必要（authRequired=true）: パスワード欄と取得方法（折りたたみ）を出し、冗長な注記は出さない", () => {
    render(
      <SettingsView
        {...baseProps({
          obsConfig: { enabled: true, port: 4455, authRequired: true },
        })}
      />,
    );
    expect(
      screen.getByPlaceholderText("OBS のサーバーパスワード"),
    ).toBeInTheDocument();
    // 取得方法は折りたたみ（summary）でフォーム下に置く。
    expect(
      screen.getByText("OBSのサーバーパスワード取得方法"),
    ).toBeInTheDocument();
    // 冗長なキャプション/キーチェーン注記は出さない。
    expect(screen.queryByText(/OS キーチェーン/)).toBeNull();
  });

  it("保存ボタンは入力が空/空白のみのとき無効", () => {
    render(
      <SettingsView
        {...baseProps({
          obsConfig: { enabled: true, port: 4455, authRequired: true },
        })}
      />,
    );
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();
    const input = screen.getByPlaceholderText("OBS のサーバーパスワード");
    fireEvent.change(input, { target: { value: "   " } });
    expect(save).toBeDisabled(); // 空白のみは無効
    fireEvent.change(input, { target: { value: "pw" } });
    expect(save).toBeEnabled();
  });

  it("保存で onSetObsPassword に入力値を渡し、入力欄を即クリアする（§9）", () => {
    const props = baseProps({
      obsConfig: { enabled: true, port: 4455, authRequired: true },
    });
    render(<SettingsView {...props} />);
    const input = screen.getByPlaceholderText(
      "OBS のサーバーパスワード",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(props.onSetObsPassword).toHaveBeenCalledWith("s3cret");
    // §9: 保存後は DOM/メモリに残さない＝入力欄を即クリアする。
    expect(input.value).toBe("");
  });

  it("削除で onClearObsPassword を呼び、入力欄をクリアする", () => {
    const props = baseProps({
      obsConfig: { enabled: true, port: 4455, authRequired: true },
    });
    render(<SettingsView {...props} />);
    const input = screen.getByPlaceholderText(
      "OBS のサーバーパスワード",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed" } });
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(props.onClearObsPassword).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
  });

  // 045a: 手動キャプチャ注記に出る窓名は、Rust の窓タイトル（src-tauri/src/lib.rs:197）と sidecar の
  // OBS_SOURCE_NAME（apps/comment-sidecar/src/obs/obs-client.ts:39）と同一文字列でなければならない
  // （044a の自動追加が owner_name + window_name の一致でこの窓を探すため）。プロセスを跨ぐ契約なので共有定数に
  // できず、さらにこの注記は JSX で行分割されている＝改行位置を変えると結合結果（区切りの半角スペース）が
  // 黙って変わる。getByText は空白を正規化してしまい差を吸収するため、**未正規化の textContent** で厳密に見る。
  it("手動キャプチャ注記に OBS 実窓名を実体どおり出す（044a の窓名一致を壊さない）", () => {
    const { container } = render(<SettingsView {...baseProps()} />);
    expect(container.textContent).toContain(
      "「StreamDock コメントオーバーレイ」",
    );
  });

  it("connecting は接続中・added/reused は同じ『表示しました』を出す（再利用と区別しない）", () => {
    const { rerender } = render(
      <SettingsView {...baseProps({ obsState: "connecting" })} />,
    );
    // 045b: 「OBS に」→「OBSに」へ表記統一（045a が残した表記ゆれの解消）。検証の意図は不変。
    expect(screen.getByText("OBSに接続しています…")).toBeInTheDocument();
    rerender(<SettingsView {...baseProps({ obsState: "added" })} />);
    expect(
      screen.getByText("OBSにコメントを表示しました。"),
    ).toBeInTheDocument();
    rerender(<SettingsView {...baseProps({ obsState: "reused" })} />);
    expect(
      screen.getByText("OBSにコメントを表示しました。"),
    ).toBeInTheDocument();
    // 「再利用」という語はユーザーに出さない。
    expect(screen.queryByText(/再利用/)).toBeNull();
  });

  it("failed は技術エラー（ECONNREFUSED 等）を出さず、平易な確認文だけを出す（§8）", () => {
    const { container } = render(
      <SettingsView {...baseProps({ obsState: "failed" })} />,
    );
    expect(
      screen.getByText(
        "OBSに接続できませんでした。OBSが起動しているか確認してください。",
      ),
    ).toBeInTheDocument();
    // 生の技術エラーや旧「連携に失敗しました：<reason>」形式は画面に出さない。
    expect(container.textContent).not.toContain("ECONNREFUSED");
    expect(screen.queryByText(/連携に失敗しました/)).toBeNull();
  });
});
