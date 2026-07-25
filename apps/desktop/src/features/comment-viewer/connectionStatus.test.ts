import { describe, it, expect } from "vitest";
import { deriveConnectionStatus, STATUS_LABEL } from "./connectionStatus";

/**
 * 042b: コメビュ本体の接続状態導出（純ロジック）の仕様テスト。もとは StatusIndicator.tsx の file-local だった導出を
 * 本体カード（ConnectionCard）が再利用するため features/ へ切り出したもの。**旧 StatusIndicator と意味的に同一**である
 * ことを表明する（回帰ガード）。
 *
 * 仕様（こうあるべき）— connectionStatus.ts の docstring が正:
 * - 入力は sidecar の取得セッション状態（session.state）**のみ**。ログイン済み(linked)や WS 接続(streamConnected)は
 *   「配信検知・取得」とは別概念なので判定に混ぜない（引数が sessionState 1 つ＝構造的に混ざらない）。
 * - 既知の 4 語彙 idle/connecting/connected/failed をそのまま状態へ写像する。
 * - 未知・空・想定外の値は "壊れず劣化" して idle（待機中）へ倒す。
 * - STATUS_LABEL は 待機中/接続中/接続済み/失敗（色覚に依存しないテキストラベル）。「接続済み」＝配信検知して取得中。
 *
 * 再修正トリガー: sidecar の session.state 語彙（idle/connecting/connected/failed）が増減したら、本テストと
 * deriveConnectionStatus を更新する（このテストが落ちること自体が「仕様が動いた」の検知になる）。
 */

describe("deriveConnectionStatus", () => {
  it("既知の session.state をそのまま接続状態へ写像する", () => {
    expect(deriveConnectionStatus("connecting")).toBe("connecting");
    expect(deriveConnectionStatus("connected")).toBe("connected");
    expect(deriveConnectionStatus("failed")).toBe("failed");
    expect(deriveConnectionStatus("idle")).toBe("idle");
  });

  it("未知・空・想定外の値は待機(idle)へ劣化する（壊れない）", () => {
    expect(deriveConnectionStatus("")).toBe("idle");
    expect(deriveConnectionStatus("unknown")).toBe("idle");
    expect(deriveConnectionStatus("reconnecting")).toBe("idle");
    // 大文字は別語彙＝未知扱い（sidecar は小文字を送る前提。フォールバックで壊れないことを確認）。
    expect(deriveConnectionStatus("CONNECTED")).toBe("idle");
  });
});

describe("STATUS_LABEL", () => {
  it("各状態を色覚非依存の日本語テキストラベルにする", () => {
    expect(STATUS_LABEL.idle).toBe("待機中");
    expect(STATUS_LABEL.connecting).toBe("接続中");
    expect(STATUS_LABEL.connected).toBe("接続済み");
    expect(STATUS_LABEL.failed).toBe("失敗");
  });

  it("導出→ラベルの結線が仕様どおり（connected=接続済み・未知=待機中）", () => {
    const labelOf = (s: string) => STATUS_LABEL[deriveConnectionStatus(s)];
    expect(labelOf("connected")).toBe("接続済み");
    expect(labelOf("connecting")).toBe("接続中");
    expect(labelOf("failed")).toBe("失敗");
    expect(labelOf("idle")).toBe("待機中");
    expect(labelOf("???")).toBe("待機中");
  });
});
