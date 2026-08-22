import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CHAT_SEND_ENABLED_KEY } from "../../features/comment-viewer/overlaySettings";
import { ChatSendCard } from "./ChatSendCard";

/**
 * 066: **チャットへの書き込み**カードの仕様テスト。
 *
 * ⚠⚠⚠ **この 1 ファイルが固定している最重要の不変条件は 3 つ。**
 *
 * ① ⚠⚠⚠ **既定 OFF**——未保存なら送信できない。
 *    ⚠ これまでの失敗は「出ない・鳴らない」で済んだが、**書き込みは視聴者に見えて消せない**。
 * ② ⚠⚠⚠ **自動送信の経路が 1 本も無い**——`onTestSend` が呼ばれるのは**ボタンを押したときだけ**。
 *    ⚠ **描画しただけ／トグルを ON にしただけでは 1 通も送らない。**
 * ③ ⚠ **§9: 送った文も結果も保存しない**（結果は state のみ＝窓を閉じれば消える）。
 *
 * ⚠ **壁はここではない**——未認証の loopback WS からの投稿を塞いでいるのは
 * sidecar 側のチケット照合（`chat-send/chat-send-frame.ts`）である。ここは**同意**を固定している。
 */

describe("ChatSendCard（066）", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const toggle = () =>
    screen.getByLabelText("チャットへの書き込みを許可する", { exact: false });
  const testButton = () => screen.getByRole("button", { name: "テスト送信" });

  it("⚠⚠⚠ 既定は OFF（未保存ならトグルが入っておらず、テスト送信も押せない）", () => {
    const onTestSend = vi.fn(async () => ({ ok: true }));
    render(<ChatSendCard onTestSend={onTestSend} channel="mychannel" />);
    expect(toggle()).not.toBeChecked();
    expect(testButton()).toBeDisabled();
    expect(onTestSend).not.toHaveBeenCalled();
  });

  it("⚠⚠⚠ 描画・トグル操作だけでは 1 通も送らない（自動送信の経路が無い）", () => {
    const onTestSend = vi.fn(async () => ({ ok: true }));
    render(<ChatSendCard onTestSend={onTestSend} channel="mychannel" />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(onTestSend).not.toHaveBeenCalled();
  });

  it("⚠ ON にすると保存され、OFF でキーごと消える（未保存＝OFF と潰す）", () => {
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" />);
    fireEvent.click(toggle());
    expect(localStorage.getItem(CHAT_SEND_ENABLED_KEY)).toBe("1");
    fireEvent.click(toggle());
    expect(localStorage.getItem(CHAT_SEND_ENABLED_KEY)).toBeNull();
  });

  it("⚠ 保存済みなら ON で復元される", () => {
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" />);
    expect(toggle()).toBeChecked();
    expect(testButton()).toBeEnabled();
  });

  it("⚠⚠ 値が壊れていたら OFF へ倒れる（安全側＝送らない）", () => {
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "yes");
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" />);
    expect(toggle()).not.toBeChecked();
    expect(testButton()).toBeDisabled();
  });

  it("ON のときだけテスト送信が送られ、結果が画面に出る", async () => {
    const onTestSend = vi.fn(async () => ({ ok: true }));
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
    render(<ChatSendCard onTestSend={onTestSend} channel="mychannel" />);
    fireEvent.click(testButton());
    await waitFor(() => expect(onTestSend).toHaveBeenCalledTimes(1));
    // ⚠⚠ **宛先を渡していない**（引数は本文 1 つだけ）。
    expect(onTestSend.mock.calls[0]).toHaveLength(1);
    expect(
      await screen.findByText(/送信しました/),
    ).toBeInTheDocument();
  });

  it("⚠ 失敗したら理由がそのまま画面に出る（押したのに何も起きない、を作らない）", async () => {
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
    render(
      <ChatSendCard
        onTestSend={vi.fn(async () => ({
          ok: false,
          reason: "Twitch にログインし直してください。",
        }))}
        channel="mychannel"
      />,
    );
    fireEvent.click(testButton());
    expect(
      await screen.findByText("Twitch にログインし直してください。"),
    ).toBeInTheDocument();
  });

  it("⚠⚠ §9: 送った文も結果も localStorage に残らない", async () => {
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" />);
    fireEvent.click(testButton());
    await screen.findByText(/送信しました/);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      const value = localStorage.getItem(key) ?? "";
      expect(value).not.toContain("テスト送信");
      expect(value).not.toContain("送信しました");
    }
    // ⚠ 残ってよいのはトグルの真偽値だけ。
    expect(localStorage.getItem(CHAT_SEND_ENABLED_KEY)).toBe("1");
  });

  it("⚠⚠ 画面に「視聴者に見える・消せない」と「YouTube 非対応」が書いてある", () => {
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" />);
    // ⚠ 061a Q-1: 約束できることだけを書き、危ないことは隠さない。
    expect(screen.getByText(/視聴者に見え/)).toBeInTheDocument();
    expect(screen.getByText(/YouTube/)).toBeInTheDocument();
    // ⚠⚠ 自動送信をしない旨も明記されていること（063b で挙動が入るまで消さない）。
    expect(screen.getByText(/自動での書き込みはしません/)).toBeInTheDocument();
  });

  /**
   * ⚠⚠⚠ **security-review 066 S-2 で足した 1 本。**
   *
   * 実際の宛先の元になる `channel` は **`start-session` フレーム由来＝ viewer から来ており、
   * チケットで守られていない**。⇒ **未認証の loopback WS に繋いだページが宛先を差し替えられる。**
   * 壁で防げない以上、**目に見える**ようにするのが段 1 での対処である。
   * ⚠ **この表示を消さないこと。** ⚠⚠ 段 2（自動送信）では「見える」だけでは足りない。
   */
  it("⚠⚠⚠ 送信先が画面に出る（差し替えられても気づけるように）", () => {
    render(
      <ChatSendCard
        onTestSend={vi.fn(async () => ({ ok: true }))}
        channel="somechannel"
      />,
    );
    expect(screen.getByText(/送信先: somechannel/)).toBeInTheDocument();
  });

  it("⚠ 未接続なら送信先は「（未接続）」と出る（空欄で誤魔化さない）", () => {
    render(
      <ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="  " />,
    );
    expect(screen.getByText(/送信先: （未接続）/)).toBeInTheDocument();
  });

  it("⚠ 送信中は二度押しできない", async () => {
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
    // ⚠ 解決を握って「送信中」を作る。⚠ 型は明示する（`vi.fn` 越しだと推論が潰れる）。
    let resolveSend: (v: { ok: boolean }) => void = () => {};
    const onTestSend = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((r) => {
          resolveSend = r;
        }),
    );
    render(<ChatSendCard onTestSend={onTestSend} channel="mychannel" />);
    fireEvent.click(testButton());
    await waitFor(() => expect(testButton()).toBeDisabled());
    fireEvent.click(testButton());
    expect(onTestSend).toHaveBeenCalledTimes(1);
    resolveSend({ ok: true });
  });
});
