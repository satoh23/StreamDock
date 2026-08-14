import styles from "./Tabs.module.css";

/**
 * 061i: **画面の中身をタブで切り替えるための表示専用部品**（判断 6）。
 *
 * ⚠ **061g の規律「画面を跨ぐ部品は最初から `components/` に置く」に従って新設した。**
 * 061l で「配信イベント」の一覧／詳細が入ると確実に生き続けるので、
 * `screens/obs-effects/` に置いて後から移す（＝061g がやった後追い）ことはしない。
 *
 * ⚠⚠ **状態は持たない。** `activeId` と `onChange` は呼び出し側が持つ
 * （どのタブを出しているかは画面の関心事で、部品が握ると「画面が閉じても選択が残る／残らない」を
 * この部品が決めることになる）。
 *
 * ## a11y の形は `AddToolScreen` の `.kindToggle` に倣う（判断 6）
 *
 * `role="tablist"` ＋ `role="tab"` ＋ `aria-selected` ＋ active クラス、という既存 idiom をそのまま使う。
 * ⚠⚠ **`AddToolScreen` の `.kindToggle` をこの部品へ置き換えてはいけない**——あちらは
 * 「アプリ / URL」という**値の選択**（登録するツールの種別）で、**コンテンツの切替**ではない。
 * 見た目が似ているだけで意味論が違うので、統合するなら別タスクで意味のほうから決めること。
 *
 * ⚠ **矢印キーでのタブ移動（WAI-ARIA の tabs パターン）は実装していない。** 既存 idiom に無く、
 * ここで先に作ると「この画面だけキーボード操作が違う」状態になるため。Tab キーで各タブへ到達でき、
 * Enter / Space で切り替えられる（`<button>` の既定挙動）ので操作は可能。
 * ⚠ **roving tabindex も入れていないのは意図的**（061i レビュー Q-5 で確認）——
 * 「`role="tab"` は付けたが roving tabindex だけ導入して矢印キーは無い」は
 * **どのタブにも Tab キーで到達できなくなる最悪の組み合わせ**なので、
 * 入れるなら矢印キーと**必ず同時**にすること。
 *
 * ⚠ **`role="tabpanel"` は呼び出し側が付ける**（この部品はタブ列だけを描き、中身を包まない）。
 * ⚠ `aria-controls` / `aria-labelledby` の相互参照は張っていない（既存 idiom も持っていない。
 * 中身を包まない以上、id の採番をこの部品と呼び出し側の両方が知る必要が生じるため）。
 * ⚠ **その帰結（061i レビュー Q-5）＝支援技術からは「タブ」と「その中身」の対応が辿れない。**
 * 受容するのは、パネルが常に**タブ列の直後に 1 つだけ**在る（＝読み上げ順で自然に繋がる）ためで、
 * パネルが複数同時に出る／タブ列から離れた位置に置かれる形になったら成立しない。
 *
 * **再修正トリガー＝タブが 3 枚以上になる／キーボード操作の指摘が出たとき／
 * パネルがタブ列の直後以外に置かれるとき。** そのときは**矢印キー移動・roving tabindex・
 * `aria-controls` / `aria-labelledby` の相互参照を 1 セットで**入れ、
 * `AddToolScreen` の `.kindToggle` と**同時に**直すこと（片方だけ直すと idiom が 2 つに割れる）。
 */
export interface TabItem {
  /** タブの識別子。⚠ 呼び出し側の state の値そのもの（この部品は解釈しない）。 */
  id: string;
  /** タブに出す文言。 */
  label: string;
}

export function Tabs({
  items,
  activeId,
  onChange,
  ariaLabel,
}: {
  items: readonly TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** タブ列そのものの名前（`aria-label`）。⚠ **省略可にしない**——無いとスクリーンリーダーには
   *  「何のタブ列か」が伝わらない（`AddToolScreen` も `aria-label="ツール種別"` を必ず付けている）。 */
  ariaLabel: string;
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${styles.tab} ${active ? styles.tabActive : ""}`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
