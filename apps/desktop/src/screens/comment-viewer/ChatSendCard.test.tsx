import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  CHAT_SEND_ENABLED_KEY,
  GACHA_CHAT_ENABLED_KEY,
} from "../../features/comment-viewer/overlaySettings";
import { ChatSendCard } from "./ChatSendCard";

/**
 * 066: **チャットへの書き込み**カードの仕様テスト。
 *
 * ⚠⚠⚠ **この 1 ファイルが固定している最重要の不変条件は 3 つ。**
 *
 * ① ⚠⚠⚠ **既定 OFF**——未保存なら送信できない。
 *    ⚠ これまでの失敗は「出ない・鳴らない」で済んだが、**書き込みは視聴者に見えて消せない**。
 * ② ⚠⚠⚠ **このカードは自分では 1 通も送らない**——`onTestSend` が呼ばれるのは**ボタンを押したときだけ**。
 *    ⚠ **描画しただけ／トグルを ON にしただけでも 1 通も送らない。**
 *    ⚠⚠⚠ **2026-08-29 訂正（063f）: 旧文「自動送信の経路が 1 本も無い」は
 *    アプリ全体としては成立しなくなった**——ガチャの当選で自動送信が走るようになった。
 *    ⚠ **ただしその持ち主は `CommentViewerApp` の `sendGachaChat` であって、このカードではない**
 *    （ここは同意＝トグルの保存と、直近結果の表示だけを持つ）。
 *    ⇒ **自動送信そのものの担保は `CommentViewerApp.effects.test.tsx` が持つ。**
 * ③ ⚠ **§9: 送った文も結果も保存しない**（結果は state のみ＝窓を閉じれば消える）。
 * ④ ⚠⚠⚠ **063f: 2 枚のトグルは AND である**——親（書き込み許可）が OFF なら、
 *    子（ガチャの自動書き込み）の保存値は **必ず消える**（＝無操作で復活しない）。
 *    ⚠⚠⚠ **063f 段 1-b: 子のトグル自体は「OBSエフェクト」画面へ移った**ので、
 *    **このファイルが持つのは「消す側」だけ**である（子の検査は `GachaLibraryCard.test.tsx`）。
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
    render(<ChatSendCard onTestSend={onTestSend} channel="mychannel" gachaChatResult={null} />);
    expect(toggle()).not.toBeChecked();
    expect(testButton()).toBeDisabled();
    expect(onTestSend).not.toHaveBeenCalled();
  });

  it("⚠⚠⚠ 描画・トグル操作だけでは 1 通も送らない（このカードは自分では送らない）", () => {
    const onTestSend = vi.fn(async () => ({ ok: true }));
    render(<ChatSendCard onTestSend={onTestSend} channel="mychannel" gachaChatResult={null} />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(onTestSend).not.toHaveBeenCalled();
  });

  it("⚠ ON にすると保存され、OFF でキーごと消える（未保存＝OFF と潰す）", () => {
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" gachaChatResult={null} />);
    fireEvent.click(toggle());
    expect(localStorage.getItem(CHAT_SEND_ENABLED_KEY)).toBe("1");
    fireEvent.click(toggle());
    expect(localStorage.getItem(CHAT_SEND_ENABLED_KEY)).toBeNull();
  });

  it("⚠ 保存済みなら ON で復元される", () => {
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" gachaChatResult={null} />);
    expect(toggle()).toBeChecked();
    expect(testButton()).toBeEnabled();
  });

  it("⚠⚠ 値が壊れていたら OFF へ倒れる（安全側＝送らない）", () => {
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "yes");
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" gachaChatResult={null} />);
    expect(toggle()).not.toBeChecked();
    expect(testButton()).toBeDisabled();
  });

  it("ON のときだけテスト送信が送られ、結果が画面に出る", async () => {
    const onTestSend = vi.fn(async () => ({ ok: true }));
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
    render(<ChatSendCard onTestSend={onTestSend} channel="mychannel" gachaChatResult={null} />);
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
        gachaChatResult={null}
      />,
    );
    fireEvent.click(testButton());
    expect(
      await screen.findByText("Twitch にログインし直してください。"),
    ).toBeInTheDocument();
  });

  it("⚠⚠ §9: 送った文も結果も localStorage に残らない", async () => {
    localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" gachaChatResult={null} />);
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
    render(<ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="mychannel" gachaChatResult={null} />);
    // ⚠ 061a Q-1: 約束できることだけを書き、危ないことは隠さない。
    expect(screen.getByText(/視聴者に見え/)).toBeInTheDocument();
    expect(screen.getByText(/YouTube/)).toBeInTheDocument();
    // ⚠⚠⚠ **063f: 旧アサーション「自動での書き込みはしません」を意図して外した。**
    //   自動送信が入ったのであの 1 文は**嘘になった**（消した理由は本体の JSX コメントが正）。
    // ⚠⚠⚠ **063f 段 1-b: 「引いた人の名前は書きません」もここから外した。**
    //   あの文は**設定の隣に在るべき**なので、トグルと一緒に「OBSエフェクト」画面へ移した
    //   （`GachaLibraryCard.test.tsx` が固定している）。
    //   ⇒ ⚠ **このカードが約束するのは「自動で書き込まれる設定がどこに在るか」**である。
    expect(screen.getByText(/「OBSエフェクト」画面/)).toBeInTheDocument();
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
        gachaChatResult={null}
      />,
    );
    expect(screen.getByText(/送信先: somechannel/)).toBeInTheDocument();
  });

  it("⚠ 未接続なら送信先は「（未接続）」と出る（空欄で誤魔化さない）", () => {
    render(
      <ChatSendCard onTestSend={vi.fn(async () => ({ ok: true }))} channel="  " gachaChatResult={null} />,
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
    render(<ChatSendCard onTestSend={onTestSend} channel="mychannel" gachaChatResult={null} />);
    fireEvent.click(testButton());
    await waitFor(() => expect(testButton()).toBeDisabled());
    fireEvent.click(testButton());
    expect(onTestSend).toHaveBeenCalledTimes(1);
    resolveSend({ ok: true });
  });

  /**
   * ⚠⚠⚠ **063f 段 1-b: 自動送信のトグルは「OBSエフェクト」画面へ移った。**
   *
   * 依頼者の指示（2026-08-29）＝「**ガチャ機能でしか使わない予定なのでまとめたい**」。
   * ⇒ ⚠⚠ **このカードに残っているのは 3 つだけ**である:
   *   ① 親のトグル（＝あちらを有効にできる唯一の鍵）
   *   ② ⚠⚠⚠ **親を OFF にしたときに子の旗も消す連動**（あちらは親を OFF にできない）
   *   ③ 在り処の案内と、自動送信の結果表示
   * ⚠ 子のトグルそのものの検査は `GachaLibraryCard.test.tsx` が持つ。
   */
  describe("⚠⚠⚠ 063f 段 1-b: 移設後に残る責務", () => {
    const renderCard = () =>
      render(
        <ChatSendCard
          onTestSend={vi.fn(async () => ({ ok: true }))}
          channel="mychannel"
          gachaChatResult={null}
        />,
      );

    it("⚠⚠ 自動送信のトグルはこのカードに無い（移設済み）", () => {
      renderCard();
      expect(
        screen.queryByLabelText("ガチャの結果を自動で書き込む", {
          exact: false,
        }),
      ).toBeNull();
    });

    /**
     * ⚠⚠⚠ **消すと「このカードだけを見た人には、自動で書き込まれる可能性が読めない」**。
     * ⚠ 警告文（視聴者に見えて消せない）がここに在る以上、
     * **設定の在り処までを 1 本の線でつなぐ**必要がある（061a Q-1）。
     */
    it("⚠⚠⚠ どこに移ったかが画面に書いてある", () => {
      renderCard();
      expect(screen.getByText(/「OBSエフェクト」画面/)).toBeInTheDocument();
    });

    /**
     * ⚠⚠⚠ **これが移設で最も壊れやすいところ。**
     * 子のトグルは別の窓にあり、**あちらから親を OFF にはできない**。
     * ⇒ ここで落とさないと **`GACHA_CHAT_ENABLED_KEY` が `"1"` のまま端末に残り**、
     * 次に親を ON にした瞬間に**ユーザーの操作ゼロで自動送信が復活する**。
     */
    it("⚠⚠⚠ 親を OFF にすると子の旗も消える（無操作で復活しない）", () => {
      localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
      localStorage.setItem(GACHA_CHAT_ENABLED_KEY, "1");
      renderCard();
      // 親を OFF へ。
      fireEvent.click(toggle());
      expect(localStorage.getItem(CHAT_SEND_ENABLED_KEY)).toBeNull();
      expect(localStorage.getItem(GACHA_CHAT_ENABLED_KEY)).toBeNull();
      // ⚠ 親を ON に戻しても、子は消えたまま（＝明示的に入れ直すまで送らない）。
      fireEvent.click(toggle());
      expect(localStorage.getItem(GACHA_CHAT_ENABLED_KEY)).toBeNull();
    });

    /**
     * ⚠⚠⚠ **自動送信はユーザーが画面を見ていないときに走る**ので、
     * 失敗が**あとから読める**ことがこの機能の「黙って効かないを作らない」対処である（061a Q-1）。
     * ⚠ 結果の表示だけは**この窓に残る**——あちらへ運ぶには localStorage が要り、
     * それは §9（送信結果を端末に残さない）に反するため。
     */
    it("⚠⚠ 直近の自動送信の結果が出る（テスト送信の結果と別枠）", () => {
      render(
        <ChatSendCard
          onTestSend={vi.fn(async () => ({ ok: true }))}
          channel="mychannel"
          gachaChatResult={{
            ok: false,
            text: "送信の間隔が短すぎます。少し待ってください。",
          }}
        />,
      );
      expect(
        screen.getByText(/ガチャの自動書き込み: 送信の間隔が短すぎます/),
      ).toBeInTheDocument();
    });
  });
});
