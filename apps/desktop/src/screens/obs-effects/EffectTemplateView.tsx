import type { EffectAnchor } from "../../features/obs-effects/bindings/EffectAnchor";
import type { EffectLayout } from "../../features/obs-effects/bindings/EffectLayout";
import type { EffectText } from "../../features/obs-effects/bindings/EffectText";
import type { SafeEffectMedia } from "./effectMedia";
import {
  effectTemplateLine,
  type EffectTemplateVars,
} from "./effectTemplateText";
import styles from "./EffectTemplateView.module.css";

/**
 * 061d: 取り込んだテンプレート 1 件を描く**唯一の実装**。
 *
 * ⚠⚠ **エフェクト窓（`EffectOverlayApp`）と main 窓のプレビュー（`EffectTemplateCard`）が
 * この 1 本を共有する。** 2 実装に分けない——036a と 親 061 が繰り返し警告している「片方だけ更新漏れ」が
 * 起きる形で、しかも漏れる側が**配信に出る側**になりうる。
 *
 * ## 共有する / しないの線引き
 *
 * ここが持つのは**中身だけ**である。窓に固有の作法は**持たない**:
 *   - `data-overlay="1"` の付与／`OverlayApp.module.css` の明示 import ／ 安定クラス `sd-overlay` を
 *     付けないこと … いずれも `EffectOverlayApp` の責務（この部品は窓ルートを作らない）
 *   - WS 購読・発火層・撤去タイマー・セットアップ用ガイド … 同上
 *   - ⚠⚠ **`<audio>` の再生はここでやらない。** 音の扱いは窓ごとにポリシーが違う——エフェクト窓は
 *     「鳴らす（配信に載るのが目的）」、main 窓のプレビューは「**既定で鳴らさない**（配信への
 *     漏れを既定にしない）」。ここに置くと片方のポリシーがもう片方へ漏れる。
 *
 * ## セキュリティ上の不変条件（docs/security.md・061a 節の受容根拠そのもの）
 *
 * 1. ⚠⚠ **メディアは [`SafeEffectMedia`] しか受け取らない**（`EffectTemplateMedia`（生）は受け取らない）。
 *    ＝ `safeEffectMedia` を通さずにここへ値を渡す呼び出しは**型として書けない**（061b が
 *    `EffectRequest` に `text` を持たせないことで「本文を描く変異はコンパイルが通らない」を作ったのと同じ手）。
 * 2. ⚠⚠ **`dangerouslySetInnerHTML` / `innerHTML` を使わない。** 差し込み変数の置換結果は
 *    React のテキストノードとして描く（`{name}` は**第三者の自由入力**）。
 *    リポジトリ全体での不在は `scripts/check-css-guards.mjs` の (10-i) が固定している。
 * 3. ⚠ **属性値（`style`）へ入るのは「数値だけ」**。`layout` / `text` の数値は Rust が範囲検証済みだが、
 *    IPC 境界を越えてきた値なので [`finitePx`] で**必ず数値へ落としてから**組み立てる
 *    ＝ 文字列が `style` へ流れ込む経路を型と実装の両方で塞ぐ。
 */

/**
 * anchor ごとの「自分の大きさぶんの寄せ戻し」。CSS クラス側が `top/left/right/bottom` を持ち、
 * ここが中央寄せの `-50%` を足す（オフセットの px と**同じ `transform` に並べて**書けるので、
 * `translate` 個別プロパティのブラウザ差を踏まない）。
 */
const ANCHOR_SHIFT: Record<EffectAnchor, string> = {
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

/** anchor ごとの寄せ先（`top/left/right/bottom`）。⚠ 上の `ANCHOR_SHIFT` と**必ず対で**触ること。 */
const ANCHOR_CLASS: Record<EffectAnchor, string> = {
  "top-left": styles.anchorTopLeft,
  top: styles.anchorTop,
  "top-right": styles.anchorTopRight,
  left: styles.anchorLeft,
  center: styles.anchorCenter,
  right: styles.anchorRight,
  "bottom-left": styles.anchorBottomLeft,
  bottom: styles.anchorBottom,
  "bottom-right": styles.anchorBottomRight,
};

/**
 * 未知の anchor を `center` へ落とす**実行時ガード**。
 *
 * ⚠ これは `EffectAnchor.ts` の注記が戒めている「fail-open な既定値」**ではない**——あちらは
 * **取り込み時**に未知の anchor を受け入れるなという話で、serde が実際に拒否している。
 * ここは「検証を通って保存済みの値が IPC を越えて壊れて届いた」場合に、
 * `transform: translate(0px, 0px) undefined` という**壊れた CSS を組み立てない**ためだけの分岐である。
 */
const knownAnchor = (value: EffectAnchor): EffectAnchor =>
  // ⚠ `Object.hasOwn` は使わない（この repo の `tsconfig` の `lib` が es2022 未満）。
  //   `Record` の引きが `undefined` なら未知、で同じ判定になる。
  ANCHOR_SHIFT[value] === undefined ? "center" : value;

/**
 * `style` へ入れてよい数値だけを通す。⚠ **数値でなければ `undefined`**（React が属性ごと省く）。
 *
 * Rust 側は範囲まで検証済み（`width` ≤ 1920 / `height` ≤ 1080 / `|offset|` ≤ 4096 /
 * `fontSize` 8〜128）だが、**ここは IPC 境界の内側**なので型を信じ切らない。
 * ⚠ **上限をここに複製しない**——サイズの方針の持ち主は Rust（`manifest.rs`）で、
 * TS 側に数字を写すと必ず片方が古くなる（`effectMedia.ts` が長さ上限を持たないのと同じ理由）。
 */
const finitePx = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : undefined;

/** メディアが動画かどうか。⚠ 判定は**ガードを通った data URI の MIME** で行う（拡張子は frontend に来ない）。 */
const isVideoDataUri = (media: string): boolean =>
  media.startsWith("data:video/");

interface EffectTemplateViewProps {
  /** `manifest.layout`（配置と大きさ）。 */
  layout: EffectLayout;
  /** `manifest.text`（差し込み文面）。⚠ **`null` がありうる**＝メディアだけのテンプレート。 */
  text: EffectText | null;
  /** ⚠⚠ **`safeEffectMedia` を通した値だけ**（生の `EffectTemplateMedia` は受け取らない）。 */
  media: SafeEffectMedia;
  /** 差し込み変数の値。 */
  vars: EffectTemplateVars;
  /**
   * メディアの読み込みに失敗したときの通知。
   * ⚠ 呼び出し側は**組み込み意匠へフォールバック**すること（配信中に無反応になるより、素の表示でも出るほうがよい）。
   */
  onMediaError?: () => void;
}

export function EffectTemplateView({
  layout,
  text,
  media,
  vars,
  onMediaError,
}: EffectTemplateViewProps) {
  const anchor = knownAnchor(layout.anchor);
  // ⚠ オフセットは「+x で右・+y で下」で統一する（anchor が `right` / `bottom` 側でも向きを変えない）。
  //   窓の外へ出た分は**見えないだけ**（`manifest.rs` が「オフセットは窓サイズに紐づけない」と決めている）。
  const dx = finitePx(layout.offsetX) ?? 0;
  const dy = finitePx(layout.offsetY) ?? 0;
  const mediaStyle = {
    // ⚠ 宣言サイズが窓より大きくても**切らずに縮める**（CSS の `max-width/height: 100%` ＋
    //   `object-fit: contain`）。エフェクト窓は 960×360 固定・`decorations(false)` で
    //   手動リサイズもできない（046c の教訓）ので、はみ出しは frontend で吸収するしかない。
    //   ⚠ 046c の `fitScale`（DOM を測って反復するソルバ）は**使わない**——あちらは本文の
    //   折り返しで高さが決まる可変内容のためのもので、こちらは `width`/`height` が宣言されている。
    width: finitePx(layout.width),
    height: finitePx(layout.height),
    transform: `translate(${dx}px, ${dy}px) ${ANCHOR_SHIFT[anchor]}`,
  };

  const line = text !== null ? effectTemplateLine(text, vars) : null;
  const textAnchor = text !== null ? knownAnchor(text.anchor) : "center";

  return (
    <div className={styles.root} data-testid="effect-template">
      {isVideoDataUri(media.media) ? (
        // ⚠ `muted` と `playsInline` は**外さないこと**（061c の指定）。音は別系統（`<audio>`）で、
        //   `<video>` に音を持たせると「映像だけ出したい」テンプレートで勝手に鳴る。
        //   ⚠ `loop` は付けない（`durationMs` で消えるので、ループすると途中で切れた印象になる）。
        <video
          className={`${styles.media} ${ANCHOR_CLASS[anchor]}`}
          style={mediaStyle}
          src={media.media}
          autoPlay
          muted
          playsInline
          onError={onMediaError}
        />
      ) : (
        // ⚠ `alt=""` ＝ 装飾画像（スクリーンリーダーに読ませない）。テンプレートの名前は
        //   **第三者が書いた文字列**なので、代替テキストとして持ち込まない（§9）。
        <img
          className={`${styles.media} ${ANCHOR_CLASS[anchor]}`}
          style={mediaStyle}
          src={media.media}
          alt=""
          onError={onMediaError}
        />
      )}
      {line !== null && text !== null && (
        // ⚠⚠ **テキストノードとして描く**（`dangerouslySetInnerHTML` を使わない）。`{name}` に
        //   `<img src=x onerror=…>` を入れられても、React が文字としてエスケープする。
        <p
          className={`${styles.text} ${ANCHOR_CLASS[textAnchor]}`}
          style={{
            fontSize: finitePx(text.fontSize),
            transform: ANCHOR_SHIFT[textAnchor],
          }}
        >
          {line}
        </p>
      )}
    </div>
  );
}
