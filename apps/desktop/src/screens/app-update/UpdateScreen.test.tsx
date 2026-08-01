import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AppUpdateStatus } from "../../features/app-update/bindings/AppUpdateStatus";
import type { AppUpdatePhase } from "../../features/app-update/useAppUpdate";
import { UPDATE_CHECK_ERROR_MESSAGE } from "../../features/app-update/useAppUpdate";
import { UpdateScreen } from "./UpdateScreen";

/**
 * 055c: アップデート画面の仕様テスト。
 *
 * 仕様（こうあるべき・docs/tasks/055c）:
 * - 3 状態を**別表示**にする（更新あり／最新／取得失敗）。⚠「更新なし」と「確認できなかった」を混ぜない。
 * - 更新ありのとき **現在バージョン・新バージョン・更新内容**が出て、右下の
 *   「アップデート」ボタンは **`disabled`**（配線は 055d）。
 * - 最新・取得失敗のときはアップデートボタンを**出さない**。
 * - 更新内容は**改行を保持したプレーンテキスト**（マークダウン記法はまだ文字として見える）。
 * - §9: 取得失敗の表示に**生エラー文字列・URL・ローカルパスを出さない**。
 * - ⚠ 省略可フィールドは `undefined` ではなく **`null` で届く**（055b レビュー Q-4）。
 *   `!== undefined` で書くと `null` に対して true になり「新バージョン: null」と表示される。
 *
 * このコンポーネントは表示専用＝invoke も通信も一切起こさない（props を描くだけ）。
 */

/**
 * **Rust が実際に送ってくる JSON の形**（`appUpdateApi.test.ts` と同じ作法）。
 * ts-rs が出す型は `latestVersion?: string` だが、serde 側に `skip_serializing_if` が無いため
 * 省略可フィールドは **`null`** で届く。型の上では表現できないので、ここで宣言して流し込む。
 */
type WireAppUpdateStatus = {
  currentVersion: string;
  available: boolean;
  latestVersion: string | null;
  notes: string | null;
  pubDate: string | null;
};

function renderScreen(
  overrides: {
    status?: AppUpdateStatus | null;
    phase?: AppUpdatePhase;
    error?: string | null;
  } = {},
) {
  const onRecheck = vi.fn();
  const utils = render(
    <UpdateScreen
      status={overrides.status ?? null}
      phase={overrides.phase ?? "ready"}
      error={overrides.error ?? null}
      onRecheck={onRecheck}
    />,
  );
  return { onRecheck, ...utils };
}

const updateButton = () => screen.queryByRole("button", { name: "アップデート" });

describe("UpdateScreen —— 更新あり", () => {
  const hasUpdate: AppUpdateStatus = {
    currentVersion: "0.0.9",
    available: true,
    latestVersion: "0.1.0",
    notes: "## 0.1.0\n\n- 初回リリース\n- 不具合を修正",
  };

  it("現在バージョン・新バージョン・更新内容を表示する", () => {
    renderScreen({ status: hasUpdate });
    expect(screen.getByText("新しいバージョンがあります")).toBeInTheDocument();
    expect(screen.getByText("現在のバージョン")).toBeInTheDocument();
    expect(screen.getByText("0.0.9")).toBeInTheDocument();
    expect(screen.getByText("新しいバージョン")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("更新内容")).toBeInTheDocument();
  });

  it("⚠ アップデートボタンは disabled（配線は 055d）", () => {
    renderScreen({ status: hasUpdate });
    const button = updateButton();
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("更新内容は改行を保持したプレーンテキストで出す（HTML として解釈しない）", () => {
    const { container } = renderScreen({ status: hasUpdate });
    // jsdom は white-space: pre-wrap を解決しないので、改行が文字列として残っていることを見る。
    const notes = container.querySelector('[class*="notesBody"]');
    expect(notes).not.toBeNull();
    expect(notes?.textContent).toBe(hasUpdate.notes);
    expect(notes?.textContent).toContain("\n");
    // マークダウン記法はまだ文字として見える（描画は 055e）。
    expect(notes?.textContent).toContain("## 0.1.0");
  });

  it("S-5: 極端に長い notes は DOM に載る前に打ち切る（未署名・長さ無制限データの丈の制御）", () => {
    const huge = "あ".repeat(50000);
    const { container } = renderScreen({ status: { ...hasUpdate, notes: huge } });

    const shown = container.querySelector('[class*="notesBody"]')?.textContent ?? "";
    expect(shown.length).toBeLessThan(huge.length);
    // 打ち切ったことがユーザーに分かる。
    expect(shown).toContain("以下省略");

    // ⚠ 上限「値」そのものも上下から挟む（055c review S-2）。当初は「50,000 字より手前のどこかで
    //   切れる」しか見ていなかったため、MAX_NOTES_CHARS を 20,000 → 40,000 に**緩める**変異が
    //   生き残っていた（50,000 未満の任意の値で緑になる）。ここで初めて上限値が固定される。
    //   併せて、clampNotes() ごと消す差し替え（055e）もこの 2 本が落として気づける。
    expect(shown.length).toBeGreaterThanOrEqual(20000);
    expect(shown.length).toBeLessThan(20100);
  });

  it("通常の長さの notes は 1 文字も削らない（打ち切りが日常で発動しない）", () => {
    const { container } = renderScreen({ status: hasUpdate });
    const shown = container.querySelector('[class*="notesBody"]')?.textContent ?? "";
    expect(shown).toBe(hasUpdate.notes);
    expect(shown).not.toContain("以下省略");
  });

  it("notes に HTML が入っていても要素として解釈しない（未署名データ・dangerouslySetInnerHTML 不使用）", () => {
    const { container } = renderScreen({
      status: {
        ...hasUpdate,
        notes: '<img src=x onerror="alert(1)"><b>bold</b>',
      },
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector('[class*="notesBody"]')?.textContent).toContain(
      "<b>bold</b>",
    );
  });
});

describe("UpdateScreen —— 最新（available:false）", () => {
  it("現在バージョンと「最新版です」を出し、アップデートボタンは出さない", () => {
    renderScreen({
      status: { currentVersion: "0.1.0", available: false },
    });
    expect(screen.getByText("お使いのバージョンは最新です")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.queryByText("新しいバージョン")).toBeNull();
    expect(updateButton()).toBeNull();
  });
});

describe("UpdateScreen —— 取得失敗（phase:error）", () => {
  it("「更新を確認できませんでした」と再確認の導線を出す（アップデートボタンは出さない）", () => {
    const { onRecheck } = renderScreen({
      status: null,
      phase: "error",
      error: UPDATE_CHECK_ERROR_MESSAGE,
    });
    expect(screen.getByText("更新を確認できませんでした")).toBeInTheDocument();
    expect(screen.getByText(UPDATE_CHECK_ERROR_MESSAGE)).toBeInTheDocument();
    expect(updateButton()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "再確認" }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("§9: 生エラー文字列・URL・ローカルパスを画面に出さない", () => {
    const { container } = renderScreen({
      status: null,
      phase: "error",
      error: UPDATE_CHECK_ERROR_MESSAGE,
    });
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/https?:|:\/\/|github|latest\.json|\/Users\/|\\Users\\/);
  });

  it("取得失敗を「最新です」に化けさせない（2 状態が別表示である担保）", () => {
    renderScreen({
      status: null,
      phase: "error",
      error: UPDATE_CHECK_ERROR_MESSAGE,
    });
    expect(screen.queryByText("お使いのバージョンは最新です")).toBeNull();
  });
});

describe("UpdateScreen —— 省略可フィールドが null で届くケース（055b レビュー Q-4）", () => {
  it("更新なし＋全フィールド null で「null」を描かない", () => {
    const wire: WireAppUpdateStatus = {
      currentVersion: "0.1.0",
      available: false,
      latestVersion: null,
      notes: null,
      pubDate: null,
    };
    const { container } = renderScreen({
      status: wire as unknown as AppUpdateStatus,
    });

    expect(screen.getByText("お使いのバージョンは最新です")).toBeInTheDocument();
    // ⚠ `!== undefined` で分岐すると、ここに「新バージョン: null」が出る。
    expect(container.textContent).not.toContain("null");
    expect(screen.queryByText("新しいバージョン")).toBeNull();
  });

  it("更新あり＋latestVersion/notes が null でも「null」を描かず、行そのものを出さない", () => {
    // `latest.json` は minisign 署名の対象外＝壊れた/改変された JSON でも届きうるので防御的に固定する。
    const wire: WireAppUpdateStatus = {
      currentVersion: "0.0.9",
      available: true,
      latestVersion: null,
      notes: null,
      pubDate: null,
    };
    const { container } = renderScreen({
      status: wire as unknown as AppUpdateStatus,
    });

    expect(container.textContent).not.toContain("null");
    expect(screen.queryByText("新しいバージョン")).toBeNull();
    expect(screen.queryByText("更新内容")).toBeNull();
    // 「更新あり」自体は成立しているので、ボタンは出るが押せない。
    expect(updateButton()).toBeDisabled();
  });
});

describe("UpdateScreen —— 確認中", () => {
  it("起動直後（idle/checking）は確認中の表示にし、ボタンを出さない", () => {
    for (const phase of ["idle", "checking"] as const) {
      const { unmount } = renderScreen({ status: null, phase });
      expect(screen.getByText("更新を確認しています")).toBeInTheDocument();
      // ⚠ 見出しだけでなく**本文**も見る（055c review Q-5）。見出しは headline() が idle を
      //   別途処理しているため、`checking` 定数から `idle` を落とす変異でも見出しは出たままになり、
      //   本文だけが空になる状態を見逃していた。
      expect(screen.getByText("最新のリリース情報を取得しています。")).toBeInTheDocument();
      expect(updateButton()).toBeNull();
      unmount();
    }
  });
});
