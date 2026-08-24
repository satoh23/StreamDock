import type { ReactNode } from "react";
import type { GachaPlacement } from "../../features/comment-viewer/overlaySettings";
import styles from "./EffectOverlayApp.module.css";

/**
 * ⚠⚠⚠ **063c 段 5-a: 演出を載せる「層」**（配信画面とプレビューで**同じ 1 枚**を使う）。
 *
 * ## なぜ部品にしたのか（⚠ 依頼者の指摘 3 件が**これ 1 つの原因**だった）
 *
 * 段 4 までは、この `<div>` を [`EffectOverlayApp`] が**直に書いていて**、
 * [`GachaStagePreview`] は `<GachaEffectStage>` を**裸で置いていた**。
 * ⚠⚠ ところがこの層は**見た目の話ではなく、3 つの前提を持っている**:
 *
 *   1. **配置クラス**（`justify-content`）… 無いと **「出す位置」を変えても 1 ピクセルも動かない**
 *   2. **`display:flex` / `align-items:center` / `padding`** … 無いと 720px の `.gachaStage` が
 *      1280px の枠の**左端に貼り付く**（中央を選んでいても左に寄って見える）
 *   3. **`--gacha-outline`（縁取り）と `--gacha-card-scrim`（文字の下地）** …
 *      ⚠⚠⚠ 無いと `var()` が**無効値になり、縁取りも下地も丸ごと消える**
 *      ＝ 白文字が金のキラキラに直接載って**読めなくなる**
 *
 * ⇒ **「実物を縮めて出す」というプレビューの設計思想が、器 1 枚ぶんだけ破れていた。**
 * ⚠⚠ **裸で `<GachaEffectStage>` を置く経路を作らないこと**——作った瞬間に上の 3 つが消える。
 *
 * ⚠ 3 については段 5-a で **`--gacha-outline` の定義を `.gachaStage` 側へも移した**ので、
 * いまは**二重の保険**になっている（層を外しても縁取りだけは残る）。
 * ⚠⚠ それでも**この部品を通すこと**——1 と 2 は層にしか無い。
 */

/**
 * ⚠⚠ 063c 段 4-c: **配置 id → CSS クラス**の対応表（⚠ **持ち主はこのファイル 1 つ**）。
 *
 * ⚠ **export しない**——外へ出すと「層を自分で組み立てる」2 通り目の経路ができる
 * （それが段 4 でプレビューと実機がずれた原因そのものである）。上の [`GachaStageLayer`] を使うこと。
 *
 * ⚠⚠⚠ **`styles[\`gachaAlign${id}\`]` のような動的参照にしないこと**——
 * CSS モジュールのクラス名は**ビルド時にハッシュ化される**ので、文字列連結で引くと
 * **未使用と判定されて消えたことに気づけない**（`undefined` が付いて黙って中央に出る）。
 * ⇒ **明示的に 3 本書く**（増えたら型エラーで気づく）。
 */
const GACHA_PLACEMENT_CLASS: Record<GachaPlacement, string> = {
  left: styles.gachaAlignLeft,
  center: styles.gachaAlignCenter,
  right: styles.gachaAlignRight,
};

export function GachaStageLayer({
  placement,
  children,
}: {
  /** 出す位置（⚠ **保存値の検査は `loadGachaPlacement` が済ませている**）。 */
  placement: GachaPlacement;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.gachaLayer} ${GACHA_PLACEMENT_CLASS[placement]}`}>
      {children}
    </div>
  );
}
