import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  within,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import type { OverlayThemeImportResult } from "../../features/comment-viewer/overlayThemeApi";
import type { OverlayThemeRecord } from "../../features/comment-viewer/bindings/OverlayThemeRecord";
import { OVERLAY_THEME_KEY } from "../../features/comment-viewer/overlaySettings";
import { OverlayThemeCard } from "./OverlayThemeCard";

/**
 * 060d: 設定ビューの「コメントのデザイン」カードの仕様テスト。
 *
 * あるべき挙動（docs/tasks/060d-css-theme-management-ui.md / 060b からの申し送り）:
 * - 一覧に「既定」＋取り込み済みテーマが並び、**現在選択中が分かる**。選ぶと localStorage に載る
 *   （＝オーバーレイ窓へ伝わる唯一の経路）。
 * - ⚠⚠ **「既定のデザインに戻す」が必ずあり、常に押せる。** ユーザー CSS は `.sd-comment{display:none}` の
 *   一行でオーバーレイを不可視にでき、オーバーレイ窓からは復帰できない＝**ここが唯一の脱出路**。
 * - 削除は確認を挟み、**選択中を消したら既定へ戻る**。
 * - 取り込み結果に「取り込めない参照を N 件除去」「M 個のルールを変換」「K 種類は変換できず」を出す。
 *   ⚠ `unmatched` は**ユーザー CSS 由来の未署名文字列**なので、件数・1 件の長さとも **clamp してから出す**。
 * - ⚠ **同名はブロックしない**（`name` に UNIQUE を張らない 060b の設計）。警告だけ出す。
 * - ⚠ 対応の取れていない `(` で中身が落ちた疑いがあるときは警告する（060b review② Q-3）。
 *
 * Rust は呼ばず `invoke` をモックする（＝テストは端末外通信も OS 操作も一切しない・§1）。
 * ⚠ ラッパ（`overlayThemeApi`）は**モックしない**——コマンド名・引数の受け渡しごと固定するため。
 */

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

const THEME_A_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const THEME_B_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const NEW_ID = "11111111-2222-4333-8444-555555555555";

const makeTheme = (
  id: string,
  name: string,
  strippedCount = 0,
): OverlayThemeRecord => ({
  id,
  name,
  origin: "local",
  strippedCount,
  createdAt: "2026-08-05T00:00:00Z",
  updatedAt: "2026-08-05T00:00:00Z",
});

/** モックされた Rust 側の状態（テストごとに組み替える）。 */
let themes: OverlayThemeRecord[] = [];
let cssById: Record<string, string> = {};
let importResult: OverlayThemeImportResult | null = null;
let importError: unknown = null;

beforeEach(() => {
  localStorage.clear();
  themes = [makeTheme(THEME_A_ID, "ふきだし"), makeTheme(THEME_B_ID, "シンプル")];
  cssById = {
    [THEME_A_ID]: ".sd-comment{color:red}",
    [THEME_B_ID]: ".sd-comment{color:blue}",
  };
  importResult = null;
  importError = null;

  mocks.open.mockReset();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((cmd: string, args?: Record<string, string>) => {
    switch (cmd) {
      case "list_overlay_themes":
        return Promise.resolve([...themes]);
      case "get_overlay_theme_css": {
        const css = cssById[args?.id ?? ""];
        return css === undefined
          ? Promise.reject({ message: "テーマが見つかりません。" })
          : Promise.resolve(css);
      }
      // ⚠ 060e: ファイル版と貼り付け版は**同じ共通コア**（Rust の `store_sanitized_css`）へ委譲するので、
      // モックも同じ結果を返す。分けると「片方だけ検証が緩い」形をテストが追認してしまう。
      case "import_overlay_theme":
      case "import_overlay_theme_text": {
        if (importError !== null) return Promise.reject(importError);
        if (importResult === null) return Promise.reject(new Error("no fixture"));
        themes = [importResult.theme, ...themes];
        return Promise.resolve(importResult);
      }
      case "rename_overlay_theme": {
        themes = themes.map((t) =>
          t.id === args?.id ? { ...t, name: args?.name ?? t.name } : t,
        );
        return Promise.resolve(themes.find((t) => t.id === args?.id));
      }
      case "delete_overlay_theme":
        themes = themes.filter((t) => t.id !== args?.id);
        return Promise.resolve();
      default:
        return Promise.reject(new Error(`unexpected command: ${cmd}`));
    }
  });
});

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style[data-sd-preview-theme]").forEach((el) => {
    el.remove();
  });
});

function renderCard() {
  return render(
    <OverlayThemeCard overlayFont="system" overlayShowSource={false} />,
  );
}

/** 一覧が描かれるまで待つ。 */
async function renderLoaded() {
  const view = renderCard();
  await screen.findByRole("radio", { name: "ふきだし" });
  return view;
}

describe("一覧と選択", () => {
  it("「既定」＋取り込み済みテーマがラジオで並ぶ", async () => {
    await renderLoaded();
    expect(
      screen.getByRole("radio", { name: "既定（StreamDock 標準）" }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: "ふきだし" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "シンプル" })).toBeInTheDocument();
  });

  it("保存済みの選択が反映される", async () => {
    localStorage.setItem(OVERLAY_THEME_KEY, THEME_B_ID);
    await renderLoaded();
    expect(screen.getByRole("radio", { name: "シンプル" })).toBeChecked();
  });

  it("選ぶと localStorage に載る（オーバーレイ窓へ伝わる唯一の経路）", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("radio", { name: "ふきだし" }));
    expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBe(THEME_A_ID);
  });
});

describe("⚠ 壊れたテーマからの脱出路", () => {
  it("「既定のデザインに戻す」が常にあり、押すと既定へ戻る", async () => {
    localStorage.setItem(OVERLAY_THEME_KEY, THEME_A_ID);
    await renderLoaded();

    const reset = screen.getByRole("button", { name: "既定のデザインに戻す" });
    expect(reset).toBeEnabled();
    fireEvent.click(reset);

    expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBeNull();
    expect(
      screen.getByRole("radio", { name: "既定（StreamDock 標準）" }),
    ).toBeChecked();
  });

  it("一覧の取得に失敗しても「既定のデザインに戻す」は押せる", async () => {
    mocks.invoke.mockImplementation((cmd: string) =>
      cmd === "list_overlay_themes"
        ? Promise.reject(new Error("db down"))
        : Promise.resolve(undefined),
    );
    localStorage.setItem(OVERLAY_THEME_KEY, THEME_A_ID);
    renderCard();

    const reset = await screen.findByRole("button", {
      name: "既定のデザインに戻す",
    });
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBeNull();
  });

  it("選択中テーマが一覧に無いときは警告する（黙って既定へ倒さない）", async () => {
    localStorage.setItem(OVERLAY_THEME_KEY, NEW_ID);
    await renderLoaded();
    expect(
      screen.getByText(/選択中のデザインが見つかりません/),
    ).toBeInTheDocument();
    // ⚠ 値そのものは消さない（058a と同型：気付かせてからユーザーに決めさせる）。
    expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBe(NEW_ID);
  });
});

describe("削除", () => {
  it("確認ダイアログを挟んでから削除する", async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/「ふきだし」を削除します/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("delete_overlay_theme", {
        id: THEME_A_ID,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("radio", { name: "ふきだし" })).toBeNull(),
    );
  });

  it("キャンセルすると削除しない", async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));

    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "delete_overlay_theme",
      expect.anything(),
    );
  });

  it("選択中のテーマを削除したら既定へ戻る", async () => {
    localStorage.setItem(OVERLAY_THEME_KEY, THEME_A_ID);
    await renderLoaded();

    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));

    await waitFor(() =>
      expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBeNull(),
    );
  });
});

describe("取り込み", () => {
  /**
   * ファイル選択 → 名前入力フォームまで進める。
   *
   * ⚠ 060e で**貼り付けフォームが常時表示**になったため、クリック前から「デザインの名前」の入力欄が
   * 存在する。`findByRole` だけだと**切り替わる前の貼り付け欄の入力を掴んでしまう**ので、
   * 「…に名前を付ける」見出し（ファイル取り込みフォームにしか無い）が出るのを待ってから取る。
   */
  async function startImport(path = "/Users/me/Downloads/fukidashi.css") {
    mocks.open.mockResolvedValue(path);
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    await screen.findByText(/」に名前を付ける$/);
    return screen.getByRole("textbox", { name: "デザインの名前" });
  }

  it("ファイル名から初期値を入れ、パスは画面に出さない（§9）", async () => {
    await renderLoaded();
    const input = await startImport();
    expect(input).toHaveValue("fukidashi");
    expect(screen.getByText(/「fukidashi.css」に名前を付ける/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("/Users/me/Downloads");
  });

  it("名前を付けて取り込むと import_overlay_theme を呼ぶ", async () => {
    importResult = {
      theme: makeTheme(NEW_ID, "配信用", 0),
      strippedImportUrls: [],
    };
    cssById[NEW_ID] = ".sd-comment{color:green}";
    await renderLoaded();

    const input = await startImport();
    fireEvent.change(input, { target: { value: "配信用" } });
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("import_overlay_theme", {
        path: "/Users/me/Downloads/fukidashi.css",
        name: "配信用",
      }),
    );
    expect(await screen.findByRole("radio", { name: "配信用" })).toBeInTheDocument();
  });

  it("空の名前では取り込めない（Rust の validate_theme_name と同じ規則を先に当てる）", async () => {
    await renderLoaded();
    const input = await startImport();
    fireEvent.change(input, { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "取り込む" })).toBeDisabled();
    expect(screen.getByText("テーマ名を入力してください。")).toBeInTheDocument();
  });

  it("81 文字以上の名前も止める（Rust と同じ 80 コードポイント上限）", async () => {
    await renderLoaded();
    const input = await startImport();
    fireEvent.change(input, { target: { value: "あ".repeat(81) } });
    expect(screen.getByRole("button", { name: "取り込む" })).toBeDisabled();
  });

  it("⚠ 同名でもブロックせず警告だけ出す（060b は name に UNIQUE を張っていない）", async () => {
    importResult = {
      theme: makeTheme(NEW_ID, "ふきだし", 0),
      strippedImportUrls: [],
    };
    cssById[NEW_ID] = ".sd-comment{color:green}";
    await renderLoaded();

    const input = await startImport();
    fireEvent.change(input, { target: { value: "ふきだし" } });
    // 入力中の警告は出るが、ボタンは押せる。
    expect(
      screen.getByText(/同じ名前のデザインが既にあります（このまま進められます）/),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "取り込む" });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(
      await screen.findByText(/同じ名前のデザインが既にあります。区別しにくいときは/),
    ).toBeInTheDocument();
  });

  it("Rust が返した固定文言をそのまま出す（@media のプレリュード拒否）", async () => {
    importError = {
      code: "VALIDATION_FAILED",
      message:
        "この CSS は取り込めません。@media / @supports などの条件部分に、取り除けない参照が書かれています。該当箇所を削ってから取り込んでください。",
    };
    await renderLoaded();
    const input = await startImport();
    fireEvent.change(input, { target: { value: "だめなCSS" } });
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    expect(
      await screen.findByText(/@media \/ @supports などの条件部分に、取り除けない参照/),
    ).toBeInTheDocument();
  });
});

describe("取り込み結果の表示", () => {
  async function importWith(
    css: string,
    strippedCount: number,
    strippedImportUrls: string[] = [],
  ) {
    importResult = {
      theme: makeTheme(NEW_ID, "テーマ", strippedCount),
      strippedImportUrls,
    };
    cssById[NEW_ID] = css;
    await renderLoaded();
    mocks.open.mockResolvedValue("/tmp/x.css");
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    await screen.findByText(/」に名前を付ける$/);
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
    await screen.findByText(/「テーマ」を取り込みました。/);
  }

  it("除去件数は「外部参照」ではなく「取り込めない参照」と出す（申し送り③）", async () => {
    await importWith(".sd-comment{color:red}", 3);
    expect(
      screen.getByText(/取り込めない参照を 3 件除去しました/),
    ).toBeInTheDocument();
  });

  it("⚠ 外部 @import の件数を出して「書体しか効かない」理由を説明する（URL 自体は出さない）", async () => {
    await importWith(".sd-comment{color:red}", 1, [
      "https://ruri.info/tool/css/midashi1Comment.css",
    ]);
    expect(
      screen.getByText(/1 件は外部サイトの CSS の読み込み（@import）です/),
    ).toBeInTheDocument();
    // ⚠ §9: URL 本体は出さない（ホスト強調付きで見せるのは 060c の同意ダイアログの責務）。
    expect(document.body.textContent).not.toContain("ruri.info");
  });

  it("変換できたルール数と、それだけでは成功と言えない旨を併記する（レビュー Q-1）", async () => {
    await importWith(".chat-line__no-background{color:red}", 0);
    expect(
      screen.getByText(/1 個のルールを StreamDock 用に変換しました/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/指定の一部が StreamDock に無い要素を指していると反映されない/),
    ).toBeInTheDocument();
  });

  it("変換できなかったセレクタは「K 種類」と出す（ルール数ではない・申し送り②）", async () => {
    await importWith(".chat-zzz{color:red}.chat-yyy{color:blue}", 0);
    expect(
      screen.getByText(/2 種類のセレクタは変換できませんでした/),
    ).toBeInTheDocument();
    expect(screen.getByText(/\.chat-zzz/)).toBeInTheDocument();
  });

  it("⚠ 件数が膨大でも画面が壊れない（clamp・060a レビュー S-1）", async () => {
    const huge = Array.from(
      { length: 20000 },
      (_, i) => `.chat-x${i}{color:red}`,
    ).join("");
    await importWith(huge, 0);

    const warning = screen.getByText(/種類のセレクタは変換できませんでした/);
    expect(warning.textContent).toContain("20000 種類");
    expect(warning.textContent).toContain("ほか 19990 件");
    // 2 万件を並べていない＝画面に流し込む文字列が有界であること。
    expect(warning.textContent!.length).toBeLessThan(1000);
  });

  it("⚠ 1 件が超長文でも切り詰める（引用符なしの属性値は ] まで無制限）", async () => {
    const long = "x".repeat(50000);
    await importWith(`.a[data-a-target=${long}]{color:red}`, 0);

    const warning = screen.getByText(/種類のセレクタは変換できませんでした/);
    expect(warning.textContent!.length).toBeLessThan(1000);
    expect(warning.textContent).toContain("…");
  });

  it("⚠ 対応の取れていない ( で中身が落ちた疑いを警告する（060b review② Q-3）", async () => {
    // `.a{width:calc(100% - 10px;}` ＋以降 を取り込むと、060b の保存結果は `.a{` だけになる。
    await importWith(".a{", 1);
    expect(
      screen.getByText(/CSS の大部分が取り込めていない可能性があります/),
    ).toBeInTheDocument();
  });

  // ⚠ **誤報しないことが要件の半分**。実サンプルは全 6 行のうち 1 行（@import）が除去されるし、
  // url() を多数持つテーマは正常に数割減る。ここが誤報すると警告そのものが読まれなくなる。
  it.each([
    ["小さいが健全な CSS（除去 1 件）", ".sd-comment{color:red}", 1],
    [
      "実サンプル相当（@import が除去され書体指定と :root が残る）",
      ':root{--txtcolor:#555555;}\n.sd-comment-text{font-family:"M PLUS 1p",sans-serif;}',
      1,
    ],
    [
      "url() を多数持つテーマ（宣言ごと除去されて大きく減る）",
      ".sd-comment{color:red}.sd-comment-name{color:blue}",
      40,
    ],
  ])("正常な取り込み（%s）では切り詰め警告を出さない", async (_l, css, n) => {
    await importWith(css, n);
    expect(
      screen.queryByText(/CSS の大部分が取り込めていない可能性があります/),
    ).toBeNull();
  });
});

describe("プレビュー", () => {
  it("トグルを ON にするとダミーコメントを描き、CSS はラッパ配下へ閉じる", async () => {
    cssById[THEME_A_ID] = ":root{--txtcolor:#555}.sd-comment{color:red}";
    localStorage.setItem(OVERLAY_THEME_KEY, THEME_A_ID);
    await renderLoaded();

    fireEvent.click(screen.getByRole("switch", { name: "プレビューを表示する" }));
    expect(await screen.findByText("これはプレビュー用のサンプルコメントです。")).toBeInTheDocument();

    await waitFor(() => {
      const style = document.head.querySelector("style[data-sd-preview-theme]");
      expect(style).not.toBeNull();
      // ⚠ 窓全体へ漏れない＝すべてのセレクタが .sd-preview 配下に閉じている。
      expect(style!.textContent).toBe(
        ".sd-preview{--txtcolor:#555}.sd-preview .sd-comment{color:red}",
      );
    });
  });

  it("トグルを OFF にすると <style> を取り除く（@font-face 等の露出時間を限る）", async () => {
    localStorage.setItem(OVERLAY_THEME_KEY, THEME_A_ID);
    await renderLoaded();

    const toggle = screen.getByRole("switch", { name: "プレビューを表示する" });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        document.head.querySelector("style[data-sd-preview-theme]"),
      ).not.toBeNull(),
    );

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        document.head.querySelector("style[data-sd-preview-theme]"),
      ).toBeNull(),
    );
  });

  // ⚠ ラッパのクラスが**素の `sd-preview`** でないと、スコープ化した CSS の当たる的が存在せず
  // プレビューが黙って無反映になる（CSS モジュールのハッシュ名に差し替える退行が典型）。
  // 静的ガード (10-h) と二重に固定する。
  it("プレビューのラッパに素の sd-preview クラスが付く（スコープ化した CSS と一致する的）", async () => {
    localStorage.setItem(OVERLAY_THEME_KEY, THEME_A_ID);
    const { container } = await renderLoaded();
    fireEvent.click(screen.getByRole("switch", { name: "プレビューを表示する" }));
    await screen.findByText("これはプレビュー用のサンプルコメントです。");
    expect(container.querySelector(".sd-preview")).not.toBeNull();
  });

  it("既定（未選択）のときは <style> を作らない", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("switch", { name: "プレビューを表示する" }));
    await screen.findByText("これはプレビュー用のサンプルコメントです。");
    expect(
      document.head.querySelector("style[data-sd-preview-theme]"),
    ).toBeNull();
  });

  // ⚠⚠ **実機確認 10-(b) のうち「機械で見られる部分」をここで固定する。**
  // プレビューの担保は 2 枚に分かれている:
  //   ①**どの要素に当たるか** … `scopeSelectors`（＝このテストが見る）
  //   ②**どこに描かれるか** … `.themePreview` の `contain: paint`（＝ jsdom はレイアウトを持たないので
  //     静的ガード (10-j) と実機確認でしか見られない）
  // ここが緑でも②が壊れていれば窓を覆えるし、②が生きていてもここが壊れれば
  // **枠の外の要素そのもの**（「既定のデザインに戻す」ボタン等）にスタイルが当たる。**両方要る。**
  it.each([
    [
      "窓全体を覆おうとするテーマ",
      ".sd-comment{position:fixed;inset:0;z-index:2147483647;background:#000}",
      ".sd-preview .sd-comment{position:fixed;inset:0;z-index:2147483647;background:#000}",
    ],
    [
      "全称セレクタで窓ごと狙うテーマ",
      "*{display:none}",
      ".sd-preview *{display:none}",
    ],
    [
      "ルート要素を狙うテーマ（ラッパへ読み替える）",
      "html,body{background:#f00}",
      ".sd-preview,.sd-preview{background:#f00}",
    ],
    [
      "祖先を狙う :has() を含むテーマ",
      "html:has(.sd-comment) button{pointer-events:none}",
      ".sd-preview:has(.sd-comment) button{pointer-events:none}",
    ],
  ])(
    "⚠ %s でも、注入される CSS のセレクタはすべて .sd-preview 配下に閉じている",
    async (_label, css, expected) => {
      cssById[THEME_A_ID] = css;
      localStorage.setItem(OVERLAY_THEME_KEY, THEME_A_ID);
      await renderLoaded();

      fireEvent.click(
        screen.getByRole("switch", { name: "プレビューを表示する" }),
      );
      await waitFor(() => {
        const style = document.head.querySelector("style[data-sd-preview-theme]");
        expect(style).not.toBeNull();
        expect(style!.textContent).toBe(expected);
      });

      // ⚠⚠ 脱出路は覆われる以前に**存在して押せる**こと（覆われないことは実機確認 10-(b)）。
      const escape = screen.getByRole("button", {
        name: "既定のデザインに戻す",
      });
      expect(escape).toBeEnabled();
    },
  );
});

describe("⚠ security-review（2026-08-05）の回帰", () => {
  /** ファイル名フォームまで進めるだけの最小フロー（取り込みは実行しない）。 */
  async function openNameFormFor(path: string) {
    await renderLoaded();
    mocks.open.mockResolvedValue(path);
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    // ⚠ 060e: 貼り付け欄の入力と区別するため、見出しで切り替わりを待つ。
    await screen.findByText(/」に名前を付ける$/);
    return screen.getByRole("textbox", { name: "デザインの名前" });
  }

  it("S-6: 長すぎるファイル名は clamp して出す（`unmatched` と同じ扱いに揃える）", async () => {
    const long = `${"あ".repeat(300)}.css`;
    await openNameFormFor(`/tmp/${long}`);
    const label = screen.getByText(/」に名前を付ける$/);
    // 60 文字 ＋ 省略記号 だけになり、生の 300 文字がそのまま出ていないこと。
    expect(label.textContent).toContain("…");
    expect(label.textContent!.length).toBeLessThan(100);
  });

  it("S-6: ファイル名の bidi / 制御文字は表示前に落とす（拡張子偽装の見た目を作らせない）", async () => {
    // ⚠ `\u202E`（RIGHT-TO-LEFT OVERRIDE）は `\p{Cf}` であって `\p{Cc}` ではないので、
    // `defaultThemeName` の制御文字除去では落ちない。表示側で別途落とす必要がある。
    await openNameFormFor(`/tmp/theme${"\u202E"}ssc.css`);
    const label = screen.getByText(/」に名前を付ける$/);
    expect(label.textContent).not.toContain("\u202E");
    expect(label.textContent).toContain("themessc.css");
  });

  it("Q-6: 保存後 CSS を読めなかったときは結果パネルを黙って縮めない", async () => {
    importResult = {
      theme: makeTheme(NEW_ID, "テーマ", 2),
      strippedImportUrls: [],
    };
    // ⚠ `cssById[NEW_ID]` を用意しない＝ `analyze` の `get_overlay_theme_css` が reject する。
    await renderLoaded();
    mocks.open.mockResolvedValue("/tmp/x.css");
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    await screen.findByText(/」に名前を付ける$/);
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await screen.findByText(/「テーマ」を取り込みました。/);
    expect(
      screen.getByText(/内容を確認できませんでした/),
    ).toBeInTheDocument();
    // 除去件数は Rust の戻り値なので、こちらは出せていること。
    expect(
      screen.getByText(/取り込めない参照を 2 件除去しました/),
    ).toBeInTheDocument();
  });

  it("Q-8: 除去した @import は「うち少なくとも N 件」と出す（Rust 側で 16 件に clamp されるため）", async () => {
    importResult = {
      theme: makeTheme(NEW_ID, "テーマ", 40),
      strippedImportUrls: Array.from(
        { length: 16 },
        (_, i) => `https://example.test/${i}.css`,
      ),
    };
    cssById[NEW_ID] = ".sd-comment{color:red}";
    await renderLoaded();
    mocks.open.mockResolvedValue("/tmp/x.css");
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    await screen.findByText(/」に名前を付ける$/);
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    const note = await screen.findByText(/件は外部サイトの CSS の読み込み/);
    expect(note.textContent).toContain("うち少なくとも 16 件");
    // ⚠ URL そのものは相変わらず出さない（§9）。
    expect(document.body.textContent).not.toContain("example.test");
  });
});

describe("⚠⚠ プレビューの <style> ライフサイクル（特権窓に第三者 CSS を置く時間を限る）", () => {
  // ⚠⚠ プレビューは**オーバーレイ窓ではなくコメビュ窓**（設定 UI・OBS のパスワード入力・
  // 視聴者メモリの削除導線がある窓）の `<head>` に第三者の CSS を注入する。
  // `scopeSelectors` が「どの要素に当たるか」を閉じ、`.themePreview` の `contain: paint` が
  // 「どこに描かれるか」を閉じるが、**`@font-face` の family 名と `@keyframes` の名前は文書グローバルで
  // 閉じられない**（docs/security.md「## CSP方針」060d 節）。
  // したがって残る担保は「**開いている間だけ置く**」＝露出時間を限ることだけなので、
  // ⚠ **外れる経路をすべて固定する**。ここが 1 本でも漏れると、第三者 CSS が窓に残り続ける。
  const styles = () =>
    document.head.querySelectorAll("style[data-sd-preview-theme]");

  async function openPreview(themeId = THEME_A_ID) {
    localStorage.setItem(OVERLAY_THEME_KEY, themeId);
    const view = await renderLoaded();
    fireEvent.click(screen.getByRole("switch", { name: "プレビューを表示する" }));
    return view;
  }

  it("テーマを何回切り替えても <style> は常に 0 個か 1 個（積み上がらない）", async () => {
    await openPreview(THEME_A_ID);
    await waitFor(() => expect(styles()).toHaveLength(1));

    for (const [id, name] of [
      [THEME_B_ID, "シンプル"],
      [THEME_A_ID, "ふきだし"],
      [THEME_B_ID, "シンプル"],
      [THEME_A_ID, "ふきだし"],
      [THEME_B_ID, "シンプル"],
    ] as const) {
      fireEvent.click(screen.getByRole("radio", { name }));
      await waitFor(() => {
        expect(styles()).toHaveLength(1);
        expect(styles()[0].textContent).toBe(
          `.sd-preview ${cssById[id].slice(0, cssById[id].indexOf("{"))}${cssById[
            id
          ].slice(cssById[id].indexOf("{"))}`,
        );
      });
    }
  });

  it("設定ビューを離れる（アンマウント）と <style> が外れる", async () => {
    const { unmount } = await openPreview();
    await waitFor(() => expect(styles()).toHaveLength(1));

    unmount();
    expect(styles()).toHaveLength(0);
  });

  it("プレビュー中に選択テーマを削除すると <style> も外れる（既定へ戻るのと同時）", async () => {
    await openPreview(THEME_A_ID);
    await waitFor(() => expect(styles()).toHaveLength(1));

    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));

    await waitFor(() => {
      expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBeNull();
      expect(styles()).toHaveLength(0);
    });
  });

  it("CSS の取得に失敗したら <style> を作らない（既定意匠へ倒す）", async () => {
    delete cssById[THEME_A_ID]; // get_overlay_theme_css が reject する
    await openPreview(THEME_A_ID);
    await screen.findByText("これはプレビュー用のサンプルコメントです。");

    await waitFor(() => expect(styles()).toHaveLength(0));
  });

  it("選択中テーマが一覧に無いときは <style> を作らない（警告だけ出す）", async () => {
    localStorage.setItem(OVERLAY_THEME_KEY, "00000000-0000-4000-8000-000000000000");
    await renderLoaded();
    fireEvent.click(screen.getByRole("switch", { name: "プレビューを表示する" }));

    await screen.findByText(/選択中のデザインが見つかりません/);
    expect(styles()).toHaveLength(0);
  });

  it("⚠ プレビューの注入も textContent のみ（`</style>` を含む CSS でも DOM を壊さない）", async () => {
    // 060b は `content: "</style>"` を**正当な CSS として保存する**（除去すると壊れるため）。
    // `innerHTML` に入れると要素が閉じ、その後ろが HTML として解釈される。
    cssById[THEME_A_ID] = '.sd-comment::after{content:"</style><img src=x>"}';
    await openPreview(THEME_A_ID);

    await waitFor(() => expect(styles()).toHaveLength(1));
    const style = styles()[0];
    expect(style.textContent).toBe(
      '.sd-preview .sd-comment::after{content:"</style><img src=x>"}',
    );
    // 逃げ出した要素が 1 つも生まれていないこと。
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(style.childElementCount).toBe(0);
  });
});

describe("⚠⚠ 脱出路は他の操作に巻き込まれない（security-review Q-5 の意図を固定）", () => {
  it("取り込みの実行中でも「既定のデザインに戻す」で既定へ戻せる", async () => {
    // ⚠ ユーザー CSS は `.sd-comment{display:none}` の一行でオーバーレイを不可視にでき、
    // オーバーレイ窓は表示専用・非フォーカスなので**そこからは復帰できない**。
    // ここが唯一の脱出路なので、他の操作の実行中（`busy`）でも殺してはいけない。
    localStorage.setItem(OVERLAY_THEME_KEY, THEME_A_ID);
    // import_overlay_theme を**永久に解決しない**ようにして `busy` を張り付かせる
    // （reject にすると runImport が catch して busy が下りてしまい、狙った状態を作れない）。
    const pending = new Promise<never>(() => {});
    importResult = null;
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_overlay_themes") return Promise.resolve([...themes]);
      if (cmd === "import_overlay_theme") return pending;
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });

    await renderLoaded();
    mocks.open.mockResolvedValue("/tmp/x.css");
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    await screen.findByText(/」に名前を付ける$/);
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    // busy 中＝他のボタンは無効になっている。
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled(),
    );

    const escape = screen.getByRole("button", {
      name: "既定のデザインに戻す",
    });
    expect(escape).toBeEnabled();
    fireEvent.click(escape);
    expect(localStorage.getItem(OVERLAY_THEME_KEY)).toBeNull();
  });
});

describe("⚠⚠ 060e: CSS を貼り付けて取り込む（ファイルを作らせない主導線）", () => {
  // あるべき挙動（docs/tasks/060e-*.md）:
  // - **カードを開いた時点で貼り付け欄が出ている**（ボタンを探させない）。
  // - **貼って「取り込む」を押すだけ**で終わる＝名前は既定値が入る。
  // - 保存先・ファイル名・サニタイズは**ファイル版と同じ共通コア**が持つので、
  //   frontend は本文と名前を渡すだけ（`import_overlay_theme_text` を正しい引数で呼ぶ）。
  // - ⚠ **CSS 本文を画面にもログにも出さない**（§9）。
  // - ⚠ Rust の `validate_css_body` と同じ規則を先に当てる（空・**256KB はバイト長**）。

  /** ⚠ §9: CSS 本文がログへ出ないことを毎回見る（`overlayThemeApi` はログ 0 行が要件）。 */
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const pasteBox = () => screen.getByRole("textbox", { name: "CSS" });
  const nameBox = () => screen.getByRole("textbox", { name: "デザインの名前" });
  const submit = () => screen.getByRole("button", { name: "取り込む" });

  it("カードを開いた時点で貼り付け欄が出ている（ボタンを探させない）", async () => {
    await renderLoaded();
    expect(pasteBox()).toBeInTheDocument();
    expect(submit()).toBeInTheDocument();
    // ファイル選択は副導線として残っている。
    expect(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    ).toBeInTheDocument();
  });

  it("貼って押すだけで取り込める（名前は既定値が入る）", async () => {
    importResult = {
      theme: makeTheme(NEW_ID, "デザイン 1", 0),
      strippedImportUrls: [],
    };
    cssById[NEW_ID] = ".sd-comment{color:red}";
    await renderLoaded();

    fireEvent.change(pasteBox(), {
      target: { value: ".sd-comment{color:red}" },
    });
    fireEvent.click(submit());

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("import_overlay_theme_text", {
        css: ".sd-comment{color:red}",
        name: "デザイン 1",
      }),
    );
    // ⚠ ファイル版のコマンドは呼ばない（＝ダイアログを経由していない）。
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "import_overlay_theme",
      expect.anything(),
    );
    await screen.findByText(/「デザイン 1」を取り込みました。/);
  });

  it("既定の名前は既存と重複しない番号になる", async () => {
    themes = [makeTheme(THEME_A_ID, "デザイン 1"), makeTheme(THEME_B_ID, "b")];
    importResult = {
      theme: makeTheme(NEW_ID, "デザイン 2", 0),
      strippedImportUrls: [],
    };
    cssById[NEW_ID] = ".a{color:red}";
    render(<OverlayThemeCard overlayFont="system" overlayShowSource={false} />);
    await screen.findByRole("radio", { name: "デザイン 1" });

    fireEvent.change(pasteBox(), { target: { value: ".a{color:red}" } });
    fireEvent.click(submit());

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("import_overlay_theme_text", {
        css: ".a{color:red}",
        name: "デザイン 2",
      }),
    );
  });

  it("名前を打てばそれが使われる", async () => {
    importResult = {
      theme: makeTheme(NEW_ID, "配信用", 0),
      strippedImportUrls: [],
    };
    cssById[NEW_ID] = ".a{color:red}";
    await renderLoaded();

    fireEvent.change(pasteBox(), { target: { value: ".a{color:red}" } });
    fireEvent.change(nameBox(), { target: { value: "  配信用  " } });
    fireEvent.click(submit());

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("import_overlay_theme_text", {
        css: ".a{color:red}",
        name: "配信用",
      }),
    );
  });

  it("空のままでは取り込めない（Rust の validate_css_body と同じ規則を先に当てる）", async () => {
    await renderLoaded();
    expect(submit()).toBeDisabled();
    fireEvent.change(pasteBox(), { target: { value: "   \n  " } });
    expect(submit()).toBeDisabled();
    fireEvent.change(pasteBox(), { target: { value: ".a{color:red}" } });
    expect(submit()).toBeEnabled();
  });

  it("⚠ 256KB 超は取り込めない（Rust と同じ**バイト長**で数える）", async () => {
    await renderLoaded();
    // ⚠ 「あ」は UTF-16 で 1・UTF-8 で 3 バイト。文字数で数えると 256KB 超を見逃す
    //（Rust は `css.len()`＝バイト長で拒否するので「入力できるのに保存できない」になる）。
    const over = "あ".repeat(90 * 1024); // 約 270KB・文字数では 256K 未満
    expect(over.length).toBeLessThan(256 * 1024);
    fireEvent.change(pasteBox(), { target: { value: over } });

    expect(submit()).toBeDisabled();
    expect(
      screen.getByText(/CSS が大きすぎます。256KB 以内にしてください。/),
    ).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "import_overlay_theme_text",
      expect.anything(),
    );
  });

  it("⚠ Rust が拒否したら固定文言をそのまま出し、CSS 本文は画面に出さない（§9）", async () => {
    importError = {
      message:
        "@media / @supports などの条件部分に、取り除けない参照が含まれています。",
    };
    await renderLoaded();
    const secret = "SECRET-MARKER-9f2b";
    fireEvent.change(pasteBox(), {
      target: { value: `@media (min-width: calc(1px + url(https://evil.example/${secret}))){.a{color:red}}` },
    });
    fireEvent.click(submit());

    await screen.findByText(
      /@media \/ @supports などの条件部分に、取り除けない参照/,
    );

    // ⚠ §9 が禁じているのは「**本文をアプリが出す**」ことで、ユーザー自身が貼った入力欄の中身は対象外
    //（パスワード欄に打った文字が見えるのと同じ）。したがって判定は「**入力欄の外**に出ていないこと」。
    // ⚠ **body を複製して入力欄だけ取り除いてから見る**（security-review②）。
    // 「葉要素だけを集める」形にしていたが、それだと**子要素を持つ容器の直下テキストを見落とす**
    // （`<div>本文<span/></div>` が検査対象から外れる）。複製方式なら位置に依らず全テキストを見る。
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const input of clone.querySelectorAll("textarea, input")) input.remove();
    const outsideTheInput = clone.textContent ?? "";
    expect(outsideTheInput).not.toContain(secret);
    expect(outsideTheInput).not.toContain("evil.example");
    // ⚠ ログにも出さない（`overlayThemeApi.ts` / このカードに console.* を書かない・§9）。
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("取り込みに成功したら貼り付け欄を空に戻す（次の 1 本をすぐ貼れる）", async () => {
    importResult = {
      theme: makeTheme(NEW_ID, "デザイン 1", 0),
      strippedImportUrls: [],
    };
    cssById[NEW_ID] = ".a{color:red}";
    await renderLoaded();

    fireEvent.change(pasteBox(), { target: { value: ".a{color:red}" } });
    fireEvent.click(submit());
    await screen.findByText(/「デザイン 1」を取り込みました。/);

    expect(pasteBox()).toHaveValue("");
    expect(nameBox()).toHaveValue("");
  });

  it("ファイル選択を開いてキャンセル（フォームを戻す）と貼り付け欄に戻る", async () => {
    await renderLoaded();
    mocks.open.mockResolvedValue("/tmp/x.css");
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    await screen.findByText(/」に名前を付ける$/);
    expect(screen.queryByRole("textbox", { name: "CSS" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(pasteBox()).toBeInTheDocument();
  });

  // ⚠⚠ **security-review②（品質 #1）で見つかったデータロスの回帰。**
  // `cancelForm()` が無条件に `setCssInput("")` を呼んでいたため、貼りかけの CSS が
  // 「キャンセル」「改名の成功」「ファイル取り込みの成功」の 3 経路すべてで消えていた。
  // ⚠ **本文を捨てるのは「貼り付けたものが保存できた」ときだけ**である。
  it("⚠ 貼りかけの CSS は、ファイル選択→キャンセルで消えない（データロスの回帰）", async () => {
    await renderLoaded();
    fireEvent.change(pasteBox(), { target: { value: ".sd-comment{color:red}" } });

    mocks.open.mockResolvedValue("/tmp/x.css");
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    await screen.findByText(/」に名前を付ける$/);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(pasteBox()).toHaveValue(".sd-comment{color:red}");
  });

  it("⚠ 貼りかけの CSS は、改名（成功）でも消えない", async () => {
    await renderLoaded();
    fireEvent.change(pasteBox(), { target: { value: ".sd-comment{color:red}" } });

    fireEvent.click(screen.getAllByRole("button", { name: "名前を変更" })[0]);
    await screen.findByText("デザインの名前を変更する");
    fireEvent.change(nameBox(), { target: { value: "新しい名前" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      "rename_overlay_theme",
      expect.objectContaining({ name: "新しい名前" }),
    ));

    await waitFor(() => expect(pasteBox()).toHaveValue(".sd-comment{color:red}"));
  });

  // ⚠⚠ **実機確認 [060b-1] のうち「機械で見られる部分」をここで固定する。**
  // 依頼者の実サンプルは**意匠の実体が丸ごと外部 `@import` の中**にあるため、取り込むと
  // **「書体しか効かない」のが仕様どおり**になる。ユーザーがそれをバグと誤解しないための説明は
  // 「除去件数」「うち少なくとも N 件は外部サイトの CSS」「変換したルール数」「それでも反映されないことがある」の
  // **4 本が同時に出ること**で成立している。1 本でも欠けると「入れたのに変わらない」が説明されない。
  // ⚠ 実機で見るのは「この文面で人が納得するか」だけに絞れる（出る/出ないはここが担保する）。
  it("⚠⚠ 実サンプル（意匠が外部 @import の中）を取り込むと、「書体しか効かない」理由が 4 本そろって出る", async () => {
    // 060b が `@import` 文だけを除去したあとの保存内容（前後の空白は動かさない）。
    const savedAfterSanitize = `
yt-live-chat-text-message-renderer #message,
yt-live-chat-text-message-renderer #message * {
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
`;
    importResult = {
      theme: makeTheme(NEW_ID, "YouTube サンプル", 1),
      strippedImportUrls: ["https://ruri.info/tool/css/midashi1Comment.css"],
    };
    cssById[NEW_ID] = savedAfterSanitize;
    await renderLoaded();

    fireEvent.change(pasteBox(), { target: { value: ".x{}" } });
    fireEvent.click(submit());
    await screen.findByText(/「YouTube サンプル」を取り込みました。/);

    // ①何かが取り除かれたこと
    await screen.findByText(/取り込めない参照を 1 件除去しました/);
    // ②それが外部サイトの CSS で、その中のデザインは反映されないこと（＝「書体しか効かない」の理由）
    await screen.findByText(
      /うち少なくとも 1 件は外部サイトの CSS の読み込み（@import）です/,
    );
    await screen.findByText(/その中に書かれたデザインは反映されません/);
    // ③変換は成功していること（＝取り込み自体は壊れていない）
    await screen.findByText(/1 個のルールを StreamDock 用に変換しました/);
    // ④変換できても当たるとは限らないこと
    await screen.findByText(
      /変換できたルールでも、指定の一部が StreamDock に無い要素を指していると反映されないことがあります/,
    );
    // ⚠ 実サンプルは健全な CSS なので、切り詰め警告は**出ない**（誤報を出さないこと）。
    expect(
      screen.queryByText(/CSS の大部分が取り込めていない可能性があります/),
    ).toBeNull();
    // ⚠ URL そのものは出さない（§9・ホスト強調付きで出すのは 060c の同意ダイアログの責務）。
    expect(document.body.textContent).not.toContain("ruri.info");
  });

  it("⚠ 貼りかけの CSS は、ファイル取り込み（成功）でも消えない", async () => {
    importResult = {
      theme: makeTheme(NEW_ID, "ファイル由来", 0),
      strippedImportUrls: [],
    };
    cssById[NEW_ID] = ".a{color:red}";
    await renderLoaded();
    fireEvent.change(pasteBox(), { target: { value: ".sd-comment{color:red}" } });

    mocks.open.mockResolvedValue("/tmp/x.css");
    fireEvent.click(
      screen.getByRole("button", { name: "CSSファイルを取り込む…" }),
    );
    await screen.findByText(/」に名前を付ける$/);
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
    await screen.findByText(/「ファイル由来」を取り込みました。/);

    expect(pasteBox()).toHaveValue(".sd-comment{color:red}");
  });
});
