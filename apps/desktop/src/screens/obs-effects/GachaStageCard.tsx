import { useState } from "react";
import { Select } from "../../components/Select";
import { ToggleSwitch } from "../../components/ToggleSwitch";
// ⚠ プレビューの「レア！」は**保存する**（2026-08-30・依頼者の指摘）。
//   ⚠⚠ 保存先の規則は `overlaySettings.ts` が持つ（ここで localStorage を直に触らない）。
import {
  loadGachaPreviewRare,
  saveGachaPreviewRare,
} from "../../features/comment-viewer/overlaySettings";
import {
  GACHA_PLACEMENTS,
  GACHA_PRIZE_COLORS,
  type GachaPlacement,
} from "../../features/comment-viewer/overlaySettings";
import { STAGE_OVERLAY_WINDOW_TITLE } from "./effectAssignments";
// ⚠ 段 5 レビュー Q-5: 「レア！」の閾値は `gachaDraw.ts` の 1 か所が持つ（画面に直書きしない）。
import { GACHA_RARE_MAX_PERCENT } from "./gachaDraw";
import { GACHA_TEMPLATES } from "./gachaStageTemplates";
import { GachaStagePreview } from "./GachaStagePreview";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * ⚠⚠⚠ **063c 段 4-d: ガチャ「演出」の設定とプレビュー**。
 *
 * ## なぜ [`GachaLibraryCard`] から分けたのか
 *
 * 依頼者の指摘＝「**項目が増えることで画面が複雑になってしまっている**」。
 * ⚠⚠ あのカードは **「ガチャ（＝景品と確率）を作る場所」** なのに、
 * **配信画面へ出すかどうか・どこへ出すか・何色で出すか**という**別の関心**が混ざっていた。
 * ⇒ ⚠ **「何が当たるか」と「どう見えるか」で切った。**
 * ⚠⚠⚠ **ここへ景品・確率・抽選を持ち込まないこと**（持ち込むと切った意味が消える）。
 *
 * ## ⚠⚠⚠ 段 5-g: **`Select` を `layout.field` の中へ入れないこと**
 *
 * 段 4-d はここだけ `<label className={layout.field}><span>…</span><Select/></label>` と書いていて、
 * **この画面で唯一、他の部品と見た目が揃っていなかった**（依頼者＝「**明らかにここのドロップダウンや
 * テキストだけ周りから浮いています**」）。原因は 2 つ重なっていた:
 *
 *   1. ⚠ ラベルを `<span>` に入れたので **`formLayout.module.css` の `.field label`
 *      （12px / 700 相当 / `display:block`）が 1 つも当たらず**、素の本文サイズで**横に並んだ**
 *   2. ⚠⚠⚠ **`.field select`（詳細度 0,1,1）が `Select.module.css` の `.selectCustom`（0,1,0）に勝ち**、
 *      高さ・角丸・文字サイズ・背景・padding を**丸ごと上書きしていた**
 *      （この画面の他の `Select` は `layout.field` の外に素で置かれている）
 *
 * ⇒ ⚠⚠ **`Select` は素で置き、ラベルは専用クラスで上に出す。**
 * ⚠ ラベルの値（12px / 800 / 余白 6px）は `.field label` と**同値**にしてある
 * （**新しい px を発明しない**——061a 以来の要件）。
 *
 * ## ⚠⚠ このカードは表示専用である
 *
 * 値の書き手は [`ObsEffectsScreen`] 1 か所（`obsSources` / `gachas` と同じ役割分担）。
 * ⚠⚠⚠ とくに **`saveGachaStageEnabled` の呼び出しが 1 か所であること**は
 * `docs/security.md` §1（063c 追補）の不変条件なので、**ここで保存しないこと。**
 *
 * ## §9
 *
 * ⚠ プレビューに出る名前は**固定のサンプル文字列**で、
 * **コメントも視聴者一覧も 1 バイトも読まない**（[`GachaStagePreview`] の注記が正）。
 */
export function GachaStageCard({
  stageEnabled,
  canEnableStage,
  onStageEnabledChange,
  placement,
  onPlacementChange,
  prizeColor,
  onPrizeColorChange,
}: {
  /**
   * 063c 段 1: 「ガチャの演出を配信画面に出す」の現在値。
   * ⚠⚠ **書き手は `ObsEffectsScreen` 1 か所**（`docs/security.md` §1 の 063c 追補）。
   */
  stageEnabled: boolean;
  /**
   * 063c 段 1: **ON にできるか**＝「ガチャを指す条件が 1 件以上あるか」（AND ゲートの片側）。
   * ⚠ false でも **OFF にはできる**（下の `disabled` の式が正）。
   */
  canEnableStage: boolean;
  onStageEnabledChange: (next: boolean) => void;
  /** 063c 段 4-c: 配置（左寄せ／中央／右寄せ）。 */
  placement: GachaPlacement;
  onPlacementChange: (next: GachaPlacement) => void;
  /**
   * 063c 段 5-e: 景品名の色（⚠ **`#rrggbb` そのもの**・段 4-b の id ではない）。
   * ⚠⚠ 値の検査は `parseGachaPrizeColor` / `saveGachaPrizeColor` が持つ（**ここでは検査しない**）。
   */
  prizeColor: string;
  onPrizeColorChange: (next: string) => void;
}) {
  /**
   * プレビューで「レア！」を出すか。
   *
   * ⚠⚠ **配信画面には 1 ミリも影響しない**——**レアのときの見え方を目で確かめるためだけ**の
   * スイッチである。⚠ 実際に出るかどうかを決めるのは
   * `isGachaRarePrize`（景品の確率が `GACHA_RARE_MAX_PERCENT` 未満か）だけ。
   *
   * ⚠⚠⚠ **2026-08-30: 保存するようにした**（依頼者の指摘＝「**再起動でOFFに戻るのは論外**」）。
   * 旧実装は `useState(false)` で、**画面を開き直すたびに OFF へ戻っていた**。
   * ⚠⚠ 旧実装の根拠は「保存すると**本番に効く設定**と誤解される」だったが、これは誤りである
   * ——誤解を防ぐのは**注記の仕事**で、**スイッチが状態を覚えないこと**の理由にはならない。
   * ⇒ 保存は [`saveGachaPreviewRare`]（**書き手はこの 1 か所だけ**）。
   * ⚠ 誤解の側は下の注記（「配信画面には影響しません」）が引き受けている。
   */
  const [previewRare, setPreviewRare] = useState<boolean>(() =>
    loadGachaPreviewRare(),
  );
  /** ⚠ **state と保存を必ず同時に動かす**（片方だけだと、開き直したときに OFF へ戻る）。 */
  const handlePreviewRareChange = (next: boolean): void => {
    setPreviewRare(next);
    saveGachaPreviewRare(next);
  };

  return (
    // ⚠⚠ 骨格は `formLayout.module.css` の `panel`（この画面の他のカードと同じ）。
    //   ⚠ `ObsEffectsScreen.module.css` に `card` / `cardHead` は**無い**
    //   （あれはコメビュ窓のクラス。間違えると枠も余白も無い素の DOM になり、
    //   jsdom では気づけない＝ `GachaLibraryCard` の注記が正）。
    <section className={layout.panel}>
      <div className={layout.panelHead}>
        <h3>ガチャの演出</h3>
        <p>
          当たったときに配信画面へ出す演出です。下のプレビューは、実際に出るものと同じものを
          縮めて再生します。
        </p>
      </div>
      {/* ⚠⚠ 段 5-g: **`layout.form`（`display:grid; gap:14px`）で包む。**
          `panelBody` は `padding` しか持たないので、包まないと**子どうしが貼り付いて**
          「注記の直後に見出しが来る」という崩れ方をする（依頼者の画像がまさにそれ）。
          ⚠ **新しい余白を発明しない**——14px はアプリ既存の値である。 */}
      <div className={layout.panelBody}>
        <div className={layout.form}>
          {/* ⚠⚠⚠ **063c 段 1: `docs/security.md` §1（044a 例外）が認める 2 つ目の明示操作。**

              ⚠⚠ **これは「設定を書くだけ」のトグルではない**——ON にした瞬間に
              **配信画面用のウィンドウが開き、OBS にウィンドウキャプチャのソースが作られる**
              （＝ OBS へ loopback の TCP 接続が張られる）。⇒ **何が起きるかを必ず書く**
              （061a Q-1 の「黙って何かが起きる／黙って何も起きない、を作らない」）。

              ⚠ **押せない条件は「ガチャを条件に割り当てていない」ときだけ**で、
              そのときは理由を下に出す。⚠⚠ **ON のときは常に押せる**
              （`!stageEnabled && !canEnableStage`）——ここを `!canEnableStage` だけにすると、
              **ON のまま割り当てを消したユーザーが OFF に戻せなくなる**。

              ⚠ 窓名は [`STAGE_OVERLAY_WINDOW_TITLE`] から引く（直書きすると Rust の実タイトルとずれ、
              ⚠⚠ **ユーザーは OBS のウィンドウ一覧をこの文字列で探す**ので窓が見つからなくなる）。 */}
          <div className={styles.gachaStageSetting}>
            <ToggleSwitch
              label="ガチャの演出を配信画面に出す"
              checked={stageEnabled}
              disabled={!stageEnabled && !canEnableStage}
              onChange={onStageEnabledChange}
            />
            <p className={styles.note}>
              ON にすると、配信画面用のウィンドウ（「
              {STAGE_OVERLAY_WINDOW_TITLE}
              」）が開き、 OBS
              に「ウィンドウキャプチャ」のソースとして自動で追加されます。 OFF
              にすると OBS 側では非表示になります（ソースは削除されません）。
              配信画面用のウィンドウは開いたままになります。
            </p>
            {/* ⚠ 押せない理由／効いていない理由を出す（061a Q-1）。⚠⚠ **2 つは別の状態である**——
                「まだ ON にできない」と「ON だがいまは出ない」を同じ文にしない。 */}
            {!stageEnabled && !canEnableStage ? (
              <p className={styles.note}>
                上の「エフェクトを表示する条件」でガチャを割り当てると、この設定を
                ON にできます。
              </p>
            ) : stageEnabled && !canEnableStage ? (
              <p className={styles.note}>
                ガチャを割り当てた条件がないため、いまは配信画面に出ません。
              </p>
            ) : null}
          </div>

          {/* ⚠⚠ **選択欄は 2 つだけ**（配置・文字色）。
              ⚠⚠⚠ **`disabled` にしない**——トグルが OFF でも設定は保存でき、ON にした瞬間から効く
              （押せるのに何も起きない状態を作らない）。
              ⚠⚠⚠ 段 5-g: **`layout.field` で包まないこと**（上のクラス JSDoc が理由を持つ）。 */}
          <div className={styles.gachaLookFields}>
            <div className={styles.gachaLookField}>
              <span className={styles.gachaLookLabel}>出す位置</span>
              <Select
                value={placement}
                ariaLabel="演出を出す位置"
                onChange={(e) =>
                  onPlacementChange(e.target.value as GachaPlacement)
                }
              >
                {GACHA_PLACEMENTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className={styles.gachaLookField}>
              <span className={styles.gachaLookLabel}>景品名の色</span>
              {/* ⚠⚠⚠ 段 5-e: **OS のカラーパレットを開く**（依頼者＝「カラーパレットが出せるなら
                  それが最も UX が良い」）。⚠ `<input type="color">` は**ブラウザ標準**なので、
                  **新規ライブラリはゼロ**・**外部リソースもゼロ**（CSP に触らない）。
                  ⚠⚠ **値の検査はここでしない**——`saveGachaPrizeColor` が唯一の関門である
                  （2 か所で検査すると、必ず片方だけ緩む）。 */}
              <div className={styles.gachaColorRow}>
                <input
                  type="color"
                  className={styles.gachaColorInput}
                  aria-label="景品名の色"
                  value={prizeColor}
                  onChange={(e) => onPrizeColorChange(e.target.value)}
                />
                {/* ⚠ いま何色かを**文字でも出す**（色だけだと、似た色を選び直したときに変わったか分からない）。 */}
                <span className={styles.gachaColorValue}>{prizeColor}</span>
              </div>
              {/* ⚠⚠ **見本**（`GACHA_PRIZE_COLORS`）。⚠⚠⚠ 段 5-e で**自由色になった代わりに、
                  「縁取りとの相性を確認済みの色」を選べる場所が消えた**ので、
                  ⚠ **押せば入る見本として残してある**（＝ 迷ったらここから選べる）。
                  ⚠ `style` に入るのは**同梱の静的な表の値**で、保存値ではない。 */}
              <div className={styles.gachaColorPresets}>
                {GACHA_PRIZE_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.gachaColorPreset} ${
                      c.css === prizeColor ? styles.gachaColorPresetOn : ""
                    }`}
                    style={{ backgroundColor: c.css }}
                    aria-label={`景品名の色を${c.label}にする`}
                    aria-pressed={c.css === prizeColor}
                    onClick={() => onPrizeColorChange(c.css)}
                  />
                ))}
              </div>
            </div>
          </div>
          <p className={styles.note}>
            位置は、配信画面用のウィンドウ（1280×720）の中でどこへ寄せるかです。
            OBS 側でソースそのものを動かすこともできます。
          </p>

          {/* ⚠ テンプレートは**表を並べるだけ**（`gachaStageTemplates.ts` の注記が正）。
              ⚠⚠ **いまは 1 件**なので 1 つだけ並ぶ。2 件目を足せば自動で 2 つになる。
              ⚠⚠⚠ 段 5-g: **プレビューは 1 つの箱にまとめる**——「レア！」のスイッチが
              箱の外に在ると、**配信画面に効く設定に見える**。
              ⚠⚠ **2026-08-30 訂正: 旧「（実際は保存されない）」は嘘になった**——
              スイッチは保存するようになったので、⚠ **箱で囲う理由は「保存されないから」ではなく
              「プレビューの一部だから」**である（囲いを外さないこと）。 */}
          <div className={styles.gachaPreviewBox}>
            {GACHA_TEMPLATES.map((template) => (
              <div key={template.id} className={styles.gachaPreviewItem}>
                <div className={styles.gachaPreviewHead}>
                  <strong>{template.label}</strong>
                  <p className={styles.note}>{template.description}</p>
                </div>
                <GachaStagePreview
                  templateId={template.id}
                  placement={placement}
                  prizeColor={prizeColor}
                  rare={previewRare}
                />
              </div>
            ))}
            {/* ⚠⚠ **プレビュー専用**であることを文に書く（保存される設定と誤解させない）。 */}
            <ToggleSwitch
              label="プレビューで「レア！」を出す"
              checked={previewRare}
              onChange={handlePreviewRareChange}
            />
            {/* ⚠⚠⚠ 段 5 レビュー Q-5: **閾値を文字で書かない**（旧: 「10%」の直書き）。
                閾値の持ち主は [`GACHA_RARE_MAX_PERCENT`] 1 か所という規律
                （`isGachaRarePrize` / `GachaEffectStage` の JSDoc が正）に対して、
                ⚠⚠ **ユーザーに見える文字列が 2 か所目**になっていた——閾値を動かすと
                **画面だけが嘘になる**（しかもテストは緑のまま）。⇒ 定数から引く。 */}
            <p className={styles.note}>
              「レア！」は、当たった景品の確率が {GACHA_RARE_MAX_PERCENT}%
              未満のときだけ実際に出ます。
              このスイッチはプレビューの見え方を変えるだけで、配信画面には影響しません。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
