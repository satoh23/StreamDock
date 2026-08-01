import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AppUpdateStatus } from "../../features/app-update/bindings/AppUpdateStatus";
import type {
  AppUpdatePhase,
  AppUpdateProgressState,
} from "../../features/app-update/useAppUpdate";
import {
  UPDATE_CHECK_ERROR_MESSAGE,
  UPDATE_INSTALL_ERROR_MESSAGE,
  UPDATE_INSTALL_STALLED_MESSAGE,
} from "../../features/app-update/useAppUpdate";
import { UpdateScreen } from "./UpdateScreen";

/**
 * 055c/055d: アップデート画面の仕様テスト。
 *
 * 仕様（こうあるべき・docs/tasks/055c / 055d）:
 * - 状態を**別表示**にする（更新あり／最新／失敗／DL 中／インストール中／完了）。
 *   ⚠「更新なし」と「確認できなかった」を混ぜない。
 * - 更新ありのとき **現在バージョン・新バージョン・更新内容**が出て、右下の「アップデート」ボタンが**押せる**。
 * - 最新・失敗のときはアップデートボタンを**出さない**。
 * - `downloading` / `installing` の間はボタンを**無効化**する（多重実行防止）。
 * - 総バイト数が分かるときは**決定形**の進捗バー、分からないときと `installing` 中は**不定形**。
 * - 完了後は **OS で分岐**する（macOS＝再起動ボタン／Windows＝案内文言）。
 * - 更新内容は**改行を保持したプレーンテキスト**（マークダウン記法はまだ文字として見える）。
 * - §9: 失敗・進捗の表示に**生エラー文字列・URL・ローカルパスを出さない**。
 * - ⚠ 省略可フィールドは `undefined` ではなく **`null` で届く**（055b レビュー Q-4）。
 *   `!== undefined` で書くと `null` に対して true になり「新バージョン: null」と表示される。
 *
 * このコンポーネントは表示専用＝invoke も通信も一切起こさない（props を描くだけ）。
 * ⚠ 055d review Q-9 で `useHostOs()` の呼び出しを **props（`hostOs`）に寄せた**ので、
 * この性質は 055d でも保たれている＝**モックが 1 つも要らない**。
 */
let hostOs: string | null = "macos";

beforeEach(() => {
  hostOs = "macos";
});

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
    progress?: AppUpdateProgressState | null;
    hostOs?: string | null;
  } = {},
) {
  const onRecheck = vi.fn();
  const onInstall = vi.fn();
  const onRestart = vi.fn();
  const utils = render(
    <UpdateScreen
      status={overrides.status ?? null}
      phase={overrides.phase ?? "ready"}
      error={overrides.error ?? null}
      progress={overrides.progress ?? null}
      hostOs={overrides.hostOs ?? hostOs}
      onRecheck={onRecheck}
      onInstall={onInstall}
      onRestart={onRestart}
    />,
  );
  return { onRecheck, onInstall, onRestart, ...utils };
}

const updateButton = () => screen.queryByRole("button", { name: "アップデート" });
const restartButton = () => screen.queryByRole("button", { name: "再起動" });
const progressBar = () => screen.queryByRole("progressbar");

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

  it("055d: アップデートボタンが押せて onInstall に配線されている", () => {
    const { onInstall } = renderScreen({ status: hasUpdate });
    const button = updateButton();
    expect(button).toBeInTheDocument();
    expect(button).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "アップデート" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
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

describe("UpdateScreen —— 失敗（phase:error）", () => {
  it("定型文言と再確認の導線を出す（アップデートボタンは出さない）", () => {
    const { onRecheck } = renderScreen({
      status: null,
      phase: "error",
      error: UPDATE_CHECK_ERROR_MESSAGE,
    });
    // ⚠ 055d で見出しを「更新を確認できませんでした」→「更新できませんでした」に変えた。
    //    `phase: "error"` が**取得失敗とインストール失敗の両方**を表すようになったため
    //    （どちらだったかは本文の定型文言が示す）。
    expect(screen.getByText("更新できませんでした")).toBeInTheDocument();
    expect(screen.getByText(UPDATE_CHECK_ERROR_MESSAGE)).toBeInTheDocument();
    expect(updateButton()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "再確認" }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("055d: インストール失敗も同じ枠で、定型文言だけを出す", () => {
    // status は残ったまま error になる（フックは install 失敗時に status を捨てない）。
    // ⚠ それでも「更新あり」と「失敗」が同時に描かれないこと（`!failed &&` の多重防御）。
    const { container, onRecheck } = renderScreen({
      status: { currentVersion: "0.0.9", available: true, latestVersion: "0.1.0" },
      phase: "error",
      error: UPDATE_INSTALL_ERROR_MESSAGE,
    });
    expect(screen.getByText("更新できませんでした")).toBeInTheDocument();
    expect(screen.getByText(UPDATE_INSTALL_ERROR_MESSAGE)).toBeInTheDocument();
    expect(updateButton()).toBeNull();
    expect(restartButton()).toBeNull();
    expect(progressBar()).toBeNull();
    expect(container.textContent).not.toMatch(
      /https?:|:\/\/|github|latest\.json|\/Users\/|\\Users\\|\/Applications|\/var\/folders/,
    );

    fireEvent.click(screen.getByRole("button", { name: "再確認" }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("055d: watchdog 発火時も同じ枠で、再起動を促す定型文言を出す", () => {
    const { container } = renderScreen({
      status: { currentVersion: "0.0.9", available: true, latestVersion: "0.1.0" },
      phase: "error",
      error: UPDATE_INSTALL_STALLED_MESSAGE,
    });
    expect(screen.getByText(UPDATE_INSTALL_STALLED_MESSAGE)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/https?:|:\/\/|\/Users\/|\/var\/folders/);
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
    // 「更新あり」自体は成立しているので、ボタンは出るし押せる（055d で disabled を外した）。
    expect(updateButton()).toBeEnabled();
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
      expect(progressBar()).toBeNull();
      unmount();
    }
  });
});

describe("UpdateScreen —— 055d ダウンロード中 / インストール中", () => {
  const hasUpdate: AppUpdateStatus = {
    currentVersion: "0.0.9",
    available: true,
    latestVersion: "0.1.0",
  };

  it("総バイト数が分かるときは決定形の進捗バーとパーセントを出す", () => {
    renderScreen({
      status: hasUpdate,
      phase: "downloading",
      progress: { downloadedBytes: 2_500_000, totalBytes: 10_000_000 },
    });
    expect(screen.getByText("更新をダウンロードしています")).toBeInTheDocument();
    const bar = progressBar();
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("ダウンロードしています（25%）。")).toBeInTheDocument();
  });

  it("総バイト数が不明（Content-Length 無し）なら不定形にする（パーセントを出さない）", () => {
    renderScreen({
      status: hasUpdate,
      phase: "downloading",
      progress: { downloadedBytes: 2_500_000, totalBytes: null },
    });
    const bar = progressBar();
    expect(bar).toBeInTheDocument();
    // ⚠ 不定形なので現在値を持たない（0% と表示して「止まっている」ように見せない）。
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("ダウンロードしています。")).toBeInTheDocument();
  });

  it("総バイト数が 0 でも 0 除算にならず不定形へ落ちる", () => {
    renderScreen({
      status: hasUpdate,
      phase: "downloading",
      progress: { downloadedBytes: 0, totalBytes: 0 },
    });
    expect(progressBar()).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("ダウンロードしています。")).toBeInTheDocument();
  });

  it("受信済みが総バイト数を超えても 100% で頭打ちにする（バーが枠から出ない）", () => {
    renderScreen({
      status: hasUpdate,
      phase: "downloading",
      progress: { downloadedBytes: 12_000_000, totalBytes: 10_000_000 },
    });
    expect(progressBar()).toHaveAttribute("aria-valuenow", "100");
  });

  it("進捗 state がまだ無くても（1 発目のイベント前）壊れず不定形で出る", () => {
    renderScreen({ status: hasUpdate, phase: "downloading", progress: null });
    expect(progressBar()).toBeInTheDocument();
    expect(progressBar()).not.toHaveAttribute("aria-valuenow");
  });

  it("installing 中は総バイト数が分かっていても不定形にする（満杯で止まって見せない）", () => {
    renderScreen({
      status: hasUpdate,
      phase: "installing",
      progress: { downloadedBytes: 10_000_000, totalBytes: 10_000_000 },
    });
    expect(screen.getByText("更新をインストールしています")).toBeInTheDocument();
    expect(progressBar()).not.toHaveAttribute("aria-valuenow");
    expect(
      screen.getByText("ダウンロードが完了しました。インストールしています。"),
    ).toBeInTheDocument();
  });

  it("DL / インストール中はアップデートボタンを無効化する（多重実行防止）", () => {
    for (const phase of ["downloading", "installing"] as const) {
      const { unmount, onInstall } = renderScreen({
        status: hasUpdate,
        phase,
        progress: { downloadedBytes: 1, totalBytes: 2 },
      });
      const button = updateButton();
      expect(button).toBeDisabled();
      // 念のため：無効でもクリックが通ってしまう退行を落とす。
      fireEvent.click(button as HTMLElement);
      expect(onInstall).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("§9: 進捗表示に URL・ローカルパス・ファイル名を出さない", () => {
    const { container } = renderScreen({
      status: hasUpdate,
      phase: "downloading",
      progress: { downloadedBytes: 2_500_000, totalBytes: 10_000_000 },
    });
    expect(container.textContent ?? "").not.toMatch(
      /https?:|:\/\/|github|latest\.json|\.tar\.gz|\.app|\/Users\/|\\Users\\|\/var\/folders/,
    );
  });
});

describe("UpdateScreen —— §9 全状態の網羅", () => {
  it("どの phase・どちらの OS でも、画面が自前で URL・ローカルパス・ファイル名を出さない", () => {
    // ⚠ 個別の phase については既にテストがあるが、**状態を足したときの漏れ**は止められない
    //   （055d で 4 → 7 に増えた／055e でも増えうる）。ここで全状態を機械的に舐める。
    // ⚠ サーバ由来の可変データ（notes）と `error` の文言は「渡されたものを出す」のが仕様なので、
    //   ここでは漏れの無い値を渡し、**画面が自分で足す文字列**だけを見る。
    const phases: AppUpdatePhase[] = [
      "idle",
      "checking",
      "ready",
      "downloading",
      "installing",
      "installed",
      "error",
    ];
    const leaks = /https?:|:\/\/|github|latest\.json|\.tar\.gz|\.app\b|\/Users\/|\\Users\\|\/Applications|\/var\/folders|AppData/;

    for (const phase of phases) {
      for (const os of ["macos", "windows", null] as const) {
        const { container, unmount } = renderScreen({
          status: {
            currentVersion: "0.0.9",
            available: true,
            latestVersion: "0.1.0",
            notes: "- 不具合を修正",
          },
          phase,
          error: phase === "error" ? UPDATE_INSTALL_ERROR_MESSAGE : null,
          progress: { downloadedBytes: 2_500_000, totalBytes: 10_000_000 },
          hostOs: os,
        });
        expect(
          container.textContent ?? "",
          `phase=${phase} / hostOs=${String(os)} で漏洩語彙が出ている`,
        ).not.toMatch(leaks);
        unmount();
      }
    }
  });

  it("どの phase でも「アップデート」と「再起動」が同時に出ることはない（操作の取り違えを防ぐ）", () => {
    // 仕様: 更新あり → アップデート／完了後 → 再起動。**同時に出る状態は無い**。
    const phases: AppUpdatePhase[] = [
      "idle",
      "checking",
      "ready",
      "downloading",
      "installing",
      "installed",
      "error",
    ];
    for (const phase of phases) {
      const { unmount } = renderScreen({
        status: { currentVersion: "0.0.9", available: true, latestVersion: "0.1.0" },
        phase,
      });
      const both = updateButton() !== null && restartButton() !== null;
      expect(both, `phase=${phase} で両方のボタンが出ている`).toBe(false);
      unmount();
    }
  });
});

describe("UpdateScreen —— 055d 完了後の OS 分岐", () => {
  const hasUpdate: AppUpdateStatus = {
    currentVersion: "0.0.9",
    available: true,
    latestVersion: "0.1.0",
  };

  it("macOS では再起動ボタンを出して onRestart に配線する", () => {
    hostOs = "macos";
    const { onRestart } = renderScreen({ status: hasUpdate, phase: "installed" });

    expect(screen.getByText("更新の準備ができました")).toBeInTheDocument();
    expect(
      screen.getByText("「再起動」を押すと、新しいバージョンで起動し直します。"),
    ).toBeInTheDocument();
    // 完了後にアップデートボタンは残さない（もう一度走らせる導線を作らない）。
    expect(updateButton()).toBeNull();

    const button = restartButton();
    expect(button).toBeInTheDocument();
    fireEvent.click(button as HTMLElement);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("Windows では再起動ボタンを出さず、案内文言に分岐する", () => {
    hostOs = "windows";
    renderScreen({ status: hasUpdate, phase: "installed" });

    expect(
      screen.getByText("インストーラが起動します。完了後に自動で立ち上がります。"),
    ).toBeInTheDocument();
    expect(restartButton()).toBeNull();
    expect(updateButton()).toBeNull();
  });

  it("⚠ Windows は installing の時点で案内文言を出す（installed に到達しないため）", () => {
    // plugin の `install()` はインストーラ起動後に `std::process::exit(0)` するので、
    // Windows で最後に見える状態は `installing`。ここで案内が出ないと何も説明されないまま消える。
    hostOs = "windows";
    renderScreen({
      status: hasUpdate,
      phase: "installing",
      progress: { downloadedBytes: 10, totalBytes: 10 },
    });
    expect(
      screen.getByText("インストーラが起動します。完了後に自動で立ち上がります。"),
    ).toBeInTheDocument();
  });

  it("hostOs が未判定（null）なら Windows 扱いにしない（安全側フォールバック）", () => {
    // `useHostOs` は invoke 失敗時に null のまま。判定できないことを Windows 扱いにして
    // 「自動で立ち上がります」と嘘をつかない（macOS では自動で立ち上がらない）。
    hostOs = null;
    renderScreen({ status: hasUpdate, phase: "installed" });
    expect(restartButton()).toBeInTheDocument();
    expect(
      screen.queryByText("インストーラが起動します。完了後に自動で立ち上がります。"),
    ).toBeNull();
  });
});
