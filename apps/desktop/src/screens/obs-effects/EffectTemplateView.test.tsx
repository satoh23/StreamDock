import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EffectLayout } from "../../features/obs-effects/bindings/EffectLayout";
import type { EffectText } from "../../features/obs-effects/bindings/EffectText";
import type { SafeEffectMedia } from "./effectMedia";
import {
  applyTemplateText,
  effectTemplateLine,
  type EffectTemplateVars,
} from "./effectTemplateText";
import { EffectTemplateView } from "./EffectTemplateView";

/**
 * 061d: テンプレート描画（エフェクト窓と main 窓のプレビューが共有する唯一の実装）と、
 * その差し込み文面（`effectTemplateText.ts`）の仕様テスト。
 *
 * ⚠⚠ 固定したい不変条件:
 * - **`{name}` に HTML を入れてもテキストとして出る**（投稿者名は第三者の自由入力）。
 * - **`{amount}` と `{message}` が同時に空へ落ちた行は描かない**（061c 申し送り 3）。
 * - **`templateWithoutAmount` が「金額なし」で使われる**（既定 `"{message}"` を含む）。
 * - **`text` が `null`**（メディアだけのテンプレート）でも落ちない。
 * - **`style` へ入るのは数値だけ**（属性値へ第三者由来の文字列を入れない）。
 * - **メディアの `src` は渡した data URI と完全一致**（この部品は `SafeEffectMedia` しか受け取らない）。
 */

const LAYOUT: EffectLayout = {
  anchor: "center",
  offsetX: 0,
  offsetY: 0,
  width: 480,
  height: 240,
};

const TEXT: EffectText = {
  template: "{name}さんが{amount}",
  templateWithoutAmount: "{message}",
  anchor: "bottom",
  fontSize: 32,
};

const PNG: SafeEffectMedia = {
  media: "data:image/png;base64,iVBORw0KGgo=",
  sound: undefined,
};

const VARS: EffectTemplateVars = {
  name: "テスト太郎",
  amountText: "¥1,000",
  message: null,
  eventLabel: "スーパーチャット",
};

describe("applyTemplateText", () => {
  it("4 つの変数を差し替える", () => {
    expect(
      applyTemplateText("{event}: {name} / {amount} / {message}", {
        name: "太郎",
        amountText: "¥500",
        message: "文",
        eventLabel: "スパチャ",
      }),
    ).toBe("スパチャ: 太郎 / ¥500 / 文");
  });

  it("null の変数は空文字になる", () => {
    expect(
      applyTemplateText("[{amount}][{message}]", {
        ...VARS,
        amountText: null,
        message: null,
      }),
    ).toBe("[][]");
  });

  it("⚠ 未知の変数は素通しする（Rust が取り込み時に弾いているので通常来ない）", () => {
    expect(applyTemplateText("{ipaddr}{name}", VARS)).toBe("{ipaddr}テスト太郎");
  });

  it("⚠⚠ 置換先の `$&` / `$'` が置換パターンとして解釈されない（関数の replacer である担保）", () => {
    // ⚠ 文字列の replacer を使う実装へ戻すと、投稿者名の `$&` が「マッチ全体」に展開されて
    //   `{name}` という文字列が画面へ出る。ここが赤くなったらその退行。
    expect(applyTemplateText("[{name}]", { ...VARS, name: "$&$'" })).toBe(
      "[$&$']",
    );
  });
});

describe("effectTemplateLine", () => {
  it("金額があれば template を使う", () => {
    expect(effectTemplateLine(TEXT, VARS)).toBe("テスト太郎さんが¥1,000");
  });

  it("⚠ 金額が無ければ templateWithoutAmount を使う（既定は `{message}`）", () => {
    expect(
      effectTemplateLine(TEXT, {
        ...VARS,
        amountText: null,
        message: "テスト太郎さんがサブスクしました",
      }),
    ).toBe("テスト太郎さんがサブスクしました");
  });

  it("⚠⚠ amount も message も無いときは null（＝描かない）", () => {
    expect(
      effectTemplateLine(TEXT, { ...VARS, amountText: null, message: null }),
    ).toBeNull();
  });

  it("⚠ 空白だけになった行も描かない", () => {
    expect(
      effectTemplateLine(
        { ...TEXT, templateWithoutAmount: "  {message}  " },
        { ...VARS, amountText: null, message: null },
      ),
    ).toBeNull();
  });
});

describe("EffectTemplateView", () => {
  it("メディアを描き、`src` は渡した data URI と完全一致する", () => {
    const { container } = render(
      <EffectTemplateView layout={LAYOUT} text={TEXT} media={PNG} vars={VARS} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(PNG.media);
  });

  it("⚠ 動画の data URI は <video>（muted / playsinline・loop なし）で描く", () => {
    const { container } = render(
      <EffectTemplateView
        layout={LAYOUT}
        text={null}
        media={{ media: "data:video/webm;base64,GkXf", sound: undefined }}
        vars={VARS}
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(false);
    expect(container.querySelector("img")).toBeNull();
  });

  it("⚠⚠ `{name}` に HTML を入れても *テキストとして* 出る（要素にならない）", () => {
    render(
      <EffectTemplateView
        layout={LAYOUT}
        text={TEXT}
        media={PNG}
        vars={{ ...VARS, name: '<img src=x onerror="alert(1)">' }}
      />,
    );
    expect(
      screen.getByText('<img src=x onerror="alert(1)">さんが¥1,000'),
    ).toBeTruthy();
    // ⚠ 画像は**テンプレートのメディア 1 枚だけ**（名前から <img> が生えていない）。
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("⚠⚠ amount も message も無いときはテキストの要素そのものを置かない", () => {
    const { container } = render(
      <EffectTemplateView
        layout={LAYOUT}
        text={TEXT}
        media={PNG}
        vars={{ ...VARS, amountText: null, message: null }}
      />,
    );
    expect(container.querySelector("p")).toBeNull();
    // メディアは出る（文が空でもエフェクト自体は出す）。
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("⚠ `text` が null（メディアだけのテンプレート）でも描ける", () => {
    const { container } = render(
      <EffectTemplateView layout={LAYOUT} text={null} media={PNG} vars={VARS} />,
    );
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("⚠ layout の数値が style に入り、オフセットは +x で右・+y で下", () => {
    const { container } = render(
      <EffectTemplateView
        layout={{ ...LAYOUT, offsetX: 12, offsetY: -8 }}
        text={null}
        media={PNG}
        vars={VARS}
      />,
    );
    const img = container.querySelector("img");
    expect(img?.style.width).toBe("480px");
    expect(img?.style.height).toBe("240px");
    expect(img?.style.transform).toContain("translate(12px, -8px)");
  });

  it("⚠⚠ 数値でない layout 値は style へ 1 文字も出ない（属性値へ文字列を入れない）", () => {
    const hostile = {
      ...LAYOUT,
      width: "480px; background:url(http://evil/x)" as unknown as number,
      offsetX: "9999" as unknown as number,
    };
    const { container } = render(
      <EffectTemplateView layout={hostile} text={null} media={PNG} vars={VARS} />,
    );
    const img = container.querySelector("img");
    expect(img?.style.width).toBe("");
    expect(img?.style.backgroundImage).toBe("");
    expect(img?.style.transform).toContain("translate(0px, 0px)");
  });

  it("⚠⚠ 9 つの anchor すべてで、寄せ先クラスと `translate` の寄せ戻しが対になっている", () => {
    // `EffectTemplateView.module.css` が「中央寄せの `-50%` は tsx 側の `ANCHOR_SHIFT` が足す。
    // **必ず対で触ること**」と書いている＝これは仕様。従来は `center` と 1 件しか見ておらず、
    // **`ANCHOR_SHIFT` の 2 要素を入れ替える変異が生存する**状態だった。
    // ⚠ jsdom は CSS Modules のクラス名を解決しないので、ここで見るのは
    //   「anchor ごとに *別々の* クラスが付く」ことと「寄せ戻しの値が仕様どおり」の 2 点。
    const expected: Record<EffectLayout["anchor"], string> = {
      "top-left": "translate(0, 0)",
      top: "translate(-50%, 0)",
      "top-right": "translate(0, 0)",
      left: "translate(0, -50%)",
      center: "translate(-50%, -50%)",
      right: "translate(0, -50%)",
      "bottom-left": "translate(0, 0)",
      bottom: "translate(-50%, 0)",
      "bottom-right": "translate(0, 0)",
    };
    const classes = new Set<string>();
    for (const [anchor, shift] of Object.entries(expected)) {
      const { container, unmount } = render(
        <EffectTemplateView
          layout={{ ...LAYOUT, anchor: anchor as EffectLayout["anchor"] }}
          text={null}
          media={PNG}
          vars={VARS}
        />,
      );
      const img = container.querySelector("img");
      expect(img?.style.transform, `anchor=${anchor} の寄せ戻し`).toBe(
        `translate(0px, 0px) ${shift}`,
      );
      // 寄せ先クラスは anchor ごとに異なること（同じクラスを 2 つの anchor へ割り当てない）。
      const cls = (img?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).pop();
      expect(cls, `anchor=${anchor} のクラス`).toBeTruthy();
      classes.add(String(cls));
      unmount();
    }
    expect(classes.size, "9 つの anchor に 9 つの別々のクラスが要る").toBe(9);
  });

  it("⚠ 金額なしの経路（templateWithoutAmount）が実際に描かれる（実機確認⑩ の frontend 側）", () => {
    // ⚠ プレビューのダミー値（`PREVIEW_VARS`）は**金額ありの経路しか通らない**ので、
    //   この経路が描画まで通ることは実機（実機確認⑩）とここでしか確かめられない。
    render(
      <EffectTemplateView
        layout={LAYOUT}
        text={TEXT}
        media={PNG}
        vars={{
          ...VARS,
          amountText: null,
          message: "テスト太郎さんがサブスクしました",
        }}
      />,
    );
    expect(screen.getByText("テスト太郎さんがサブスクしました")).toBeTruthy();
    // 金額ありの文面は出ない（2 本のうち正しいほうが選ばれている）。
    expect(screen.queryByText(/¥1,000/)).toBeNull();
  });

  it("⚠ 未知の anchor でも壊れた transform を組み立てない（center へ落ちる）", () => {
    const { container } = render(
      <EffectTemplateView
        layout={{ ...LAYOUT, anchor: "diagonal" as EffectLayout["anchor"] }}
        text={null}
        media={PNG}
        vars={VARS}
      />,
    );
    const transform = container.querySelector("img")?.style.transform ?? "";
    expect(transform).not.toContain("undefined");
    expect(transform).toContain("translate(-50%, -50%)");
  });

  it("メディアの読み込み失敗を onMediaError で通知する（呼び出し側が組み込みへ落ちるため）", () => {
    const onMediaError = vi.fn();
    const { container } = render(
      <EffectTemplateView
        layout={LAYOUT}
        text={TEXT}
        media={PNG}
        vars={VARS}
        onMediaError={onMediaError}
      />,
    );
    const img = container.querySelector("img");
    if (img === null) throw new Error("img not rendered");
    fireEvent.error(img);
    expect(onMediaError).toHaveBeenCalledTimes(1);
  });
});
