import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { DEFAULT_OVERLAY_FONT } from "../../features/comment-viewer/overlaySettings";
import { TTS_MAX_LENGTH_DEFAULT } from "../../features/comment-viewer/ttsPrefs";

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
    // 048: 読み上げの文字数上限（このファイルの検証対象ではないので既定値を渡すだけ）。
    ttsMaxLength: TTS_MAX_LENGTH_DEFAULT,
    onTtsMaxLengthChange: vi.fn(),
    speakers: [],
    selectedSpeakerId: 0,
    onSpeakerIdChange: vi.fn(),
    onPreview: vi.fn(),
    // 058a: 通知音の出力デバイス（このファイルの検証対象ではないので「デバイス無し・未選択」を渡すだけ）。
    // 検証は SettingsView.audio.test.tsx が担う。
    audioOutputDevices: [],
    audioOutputListState: "ready",
    audioOutputDeviceId: "",
    onAudioOutputDeviceIdChange: vi.fn(),
    onReloadAudioOutputDevices: vi.fn(),
    // ⚠ 059c: `onTestNotificationSound` / `audioTestState` は props ごと削除された（テスト再生の廃止）。
    // 059a / 059b: 通知音（このファイルの検証対象ではないので既定＝両方 OFF を渡すだけ）。
    // 検証は SettingsView.audio.test.tsx が担う。
    soundCommentEnabled: false,
    onSoundCommentEnabledChange: vi.fn(),
    onPreviewCommentSound: vi.fn(),
    soundMonetaryEnabled: false,
    onSoundMonetaryEnabledChange: vi.fn(),
    onPreviewMonetarySound: vi.fn(),
    soundPreviewState: "idle",
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
    // 046b: 固定コメント専用オーバーレイの表示トグル（既定 OFF）。
    pinnedOverlayEnabled: false,
    onPinnedOverlayToggle: vi.fn(),
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

  // 054 追補(E2E): ここにあった「手動キャプチャ注記に OBS 実窓名を実体どおり出す（044a の窓名一致を壊さない）」を
  // 削除した。**検査対象そのものが画面から無くなった**ため——045a 以来この検査は「手動キャプチャ注記に出る窓名が
  // Rust の窓タイトル（src-tauri/src/lib.rs の `.title`）と sidecar の OBS_SOURCE_NAME
  // （apps/comment-sidecar/src/obs/obs-client.ts）と同一文字列であること」を UI 側から見張るものだったが、
  // 054 追補で依頼者の指示によりその注記を削除した（自動反映が既定の導線になり説明が過剰になっていたため）。
  // ⚠ **手放した担保**: 窓名の一致は lib.rs ↔ sidecar の 2 者間だけの契約になり、このテストスイートからは
  // 見えなくなった。窓名を変えるときは 2 ファイルを必ず同時に直すこと（片方だけ変えても desktop 側は緑のまま）。
  // 再修正トリガー＝手動キャプチャ手順を UI へ戻すとき（そのときこの検査も一緒に戻す）、または窓名一致の
  // 退行が実際に起きたとき（そのときは UI 依存をやめ、lib.rs と obs-client.ts を突き合わせる形にする）。

  it("connecting は接続中・added/reused は同じ『表示しました』を出す（再利用と区別しない）", () => {
    const { rerender } = render(
      <SettingsView {...baseProps({ obsState: "connecting" })} />,
    );
    // 045b: 「OBS に」→「OBSに」へ表記統一（045a が残した表記ゆれの解消）。検証の意図は不変。
    expect(screen.getByText("OBSに接続しています…")).toBeInTheDocument();
    // ⚠⚠ 061e(3): 「OBSにコメントを表示しました。」→「OBSに表示しました。」。`obsState` は
    // comments / pinned / effects の **3 種別で共有**されているので、**エフェクトや固定コメントの成功でも
    // この文が出る**＝「コメントを」と書くと嘘になる（061a の宿題 (C)）。
    rerender(<SettingsView {...baseProps({ obsState: "added" })} />);
    expect(screen.getByText("OBSに表示しました。")).toBeInTheDocument();
    rerender(<SettingsView {...baseProps({ obsState: "reused" })} />);
    expect(screen.getByText("OBSに表示しました。")).toBeInTheDocument();
    // 「再利用」という語はユーザーに出さない。
    expect(screen.queryByText(/再利用/)).toBeNull();
  });

  it("⚠ 061e(3): 成功文言は種別に依存しない（「コメント」を含まない）", () => {
    // ⚠ これが無いと「OBSにコメントを表示しました。」へ書き戻せてしまう（エフェクトの成功で嘘になる）。
    // ⚠ カード見出し（「OBSに表示」）やトグル label には「コメント」が残っているので、
    //   **状態表示の要素だけ**を見る（カード全体の textContent では拾えない）。
    render(<SettingsView {...baseProps({ obsState: "added" })} />);
    expect(screen.getByText("OBSに表示しました。").textContent).not.toContain(
      "コメント",
    );
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

/**
 * 046b: 固定コメント専用オーバーレイ（label `pinned-overlay`）の設定。
 *
 * ⚠⚠ **059c(2)（本人指示）で独立カードをやめ、「OBSに表示」カードへ統合した。** 046b の
 * 「上の OBS カードの隣に別カードで置く」という配置は失効している。**要素の順序・内容は変えていない**
 * ので、下記のアサートはカード統合の前後で同じものが通る（＝この describe は「カードが 1 枚か 2 枚か」
 * ではなく「設定が描画され配線されているか」を見ている）。
 *
 * あるべき挙動（docs/tasks/046b-pinned-overlay-window.md / 親 046）:
 * - 「固定コメントをOBSに表示」トグルを描画し、操作で `onPinnedOverlayToggle` を呼ぶ（窓の開閉は親が担う）。
 * - 既存の OBS カード（044a）は不変＝自動反映トグルが従来どおり出る。
 *
 * ⚠⚠ **2026-08-31（依頼者指示）で、窓名注記・自動反映の案内・固定のリセット案内の 3 本を削除した。**
 * ⇒ 旧「手動キャプチャ注記の窓名は Rust の窓タイトルと同一」「046d: 自動反映 ON/OFF の案内を明示する」の
 * 2 項目は**画面の契約ではなくなった**（下の該当ケースを撤去した理由は、その位置のコメントが正）。
 */
describe("SettingsView 046b 固定コメントオーバーレイの設定", () => {
  const PINNED_TOGGLE = "固定コメントをOBSに表示";

  it("トグルを描画し、操作で onPinnedOverlayToggle を呼ぶ", () => {
    const props = baseProps();
    render(<SettingsView {...props} />);
    // ⚠ 059c(2) でカード見出しとの同一文字列衝突は解消したが、`role="switch"` 絞りは**残す**
    // （外すと、見出しやツールバー側の label と再び衝突したときに気付けない）。
    const toggle = screen.getByRole("switch", { name: PINNED_TOGGLE });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(props.onPinnedOverlayToggle).toHaveBeenCalledWith(true);
  });

  it("ON のときは aria-checked=true で出る（永続値は親が保持）", () => {
    render(<SettingsView {...baseProps({ pinnedOverlayEnabled: true })} />);
    expect(screen.getByRole("switch", { name: PINNED_TOGGLE })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  /* ⚠⚠⚠ **2026-08-31（依頼者指示）: 固定コメントの注記 3 本を画面から削除したので、
     それに依存していた 2 つの検査（窓名の一致・自動反映の案内）を撤去した。**
     ⚠ **JSDoc 記法ではなく素のブロックコメントで書くこと**（review Q-3）——`it()` を消した跡に
     JSDoc を残すと、**直後の別テストのドキュメントとして読まれる**（当初それをやってしまった）。

     ## ⚠⚠⚠ 失われた不変条件は無い（review Q-4 で訂正）

     旧文は「再固定するなら Rust 側（`lib.rs` の 2 つの `.title`）を突き合わせる検査を書くこと」と
     書いていたが、⚠⚠ **その検査は既に存在する**:
       - `lib.rs` の `titles_do_not_contain_each_other`
         ＝ `OVERLAY_TITLES`（**3 窓・6 方向の総当たり**）の `contains` 検査。
         ⇒ **「固定用の窓名がコメント用を部分文字列として含んではいけない」はここが固定している。**
       - `lib.rs` の `titles_are_used_by_the_window_builders` ＝ `.title("…")` の実在確認。
       - 同モジュールが `obs-client.ts` を `include_str!` で読む TS↔Rust 照合。
     ⇒ ⚠ **撤去したこの層の検査は実質「重複カバレッジ」だった**（しかも 2 者・片方向で、Rust 側より弱い）。
     **新しいテストを書く必要は無い。**

     ⚠⚠ この層で本当に失ったのは「**画面に出ている窓名が Rust の `.title` と一致していること**」だけで、
     画面に窓名が出なくなった以上、ここでは固定しようがない。
     ⚠ 帰結: **自動反映を OFF にしている人は、手動キャプチャで選ぶ窓名がアプリ内から読めない。**
     ⚠ 文言を書き戻すときは、この 2 検査も一緒に戻すこと。 */

  // 054 追補(E2E): 旧名「既存の OBS カード（044a）は不変（自動反映トグルと窓名注記が残る）」。
  // 窓名注記（「StreamDock コメントオーバーレイ」を含む手動キャプチャ手順）は依頼者の指示で削除したため、
  // そのアサートを外した。**自動反映トグルが残っていること**は 046b が「上の OBS カードには手を入れていない」
  // ことを担保する検査なので維持する（固定コメントカードの追加でこのトグルが巻き添えで消えないため）。
  it("既存の OBS カードの自動反映トグルは残っている（046b/054 追補で巻き添えにしない）", () => {
    render(<SettingsView {...baseProps()} />);
    expect(
      screen.getByRole("switch", {
        name: "「コメントをOBSに表示」ON時、OBSに自動で反映する",
      }),
    ).toBeInTheDocument();
  });

  it("⚠ 059c(2): 固定コメントの設定は独立カードではなく「OBSに表示」カードの中にある", () => {
    // 本人指示によるカード統合の固定。⚠ **見出しの数**まで見るのは、「カード枠だけ残して見出しを
    // 消す」中途半端な状態（＝視覚的には統合されているが DOM は 2 枚）を弾くため。
    render(<SettingsView {...baseProps()} />);

    // 統合後の見出しは「OBSに表示」1 つだけ（旧「コメントをOBSに表示」「固定コメントをOBSに表示」は無い）。
    const heads = Array.from(
      document.querySelectorAll<HTMLElement>('[class*="cardHead"]'),
    ).map((el) => el.textContent);
    expect(heads).toContain("OBSに表示");
    expect(heads).not.toContain("コメントをOBSに表示");
    expect(heads).not.toContain("固定コメントをOBSに表示");

    // 固定トグルと自動反映トグルが**同じカード**に入っていること。
    const pinned = screen.getByRole("switch", { name: PINNED_TOGGLE });
    const autoAdd = screen.getByRole("switch", {
      name: "「コメントをOBSに表示」ON時、OBSに自動で反映する",
    });
    const card = pinned.closest('[class*="card"]');
    expect(card).not.toBeNull();
    expect(card).toContainElement(autoAdd);
  });
});
