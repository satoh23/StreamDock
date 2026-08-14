import { useEffect, useRef, type ReactNode } from "react";
import styles from "./ConfirmDialog.module.css";
import btnStyles from "./compactButtons.module.css";

/**
 * 038b: 破壊的操作（視聴者の個別削除・複数選択のまとめて削除）の前に必ず挟む確認ダイアログ。
 *
 * 新規依存を増やさないため、ネイティブの HTML `<dialog>` 要素＋`showModal()` を使う（focus trap・Esc で閉じる・
 * backdrop・モーダル化がブラウザ標準で付く）。見た目は役割トークンで統一し、
 * 外部リソース・画像・data-URI は使わない（CSP 安全）。表示専用で、削除の実処理・state は呼び出し側が持つ。
 *
 * 061g: `screens/comment-viewer/` から `components/` へ移設した（`obs-effects/EffectTemplateCard` も使う＝
 * 画面を跨ぐ部品）。⚠ 意匠は 2 モジュールに分かれている:
 *   - `ConfirmDialog.module.css` … 枠・本文・見出し・操作行。**`MonetaryDetailDialog` と 4 クラス共有**
 *   - `compactButtons.module.css` … `.btn` / `.btnGhost` / `.dangerBtn`。**コメビュ側 25 箇所と共有**
 * どちらも「このダイアログ専用」ではないので、寸法や配色を動かす前に各モジュール先頭の注記を読むこと。
 */

interface ConfirmDialogProps {
  /** true でモーダル表示。false でアンマウント（＝閉じる）。 */
  open: boolean;
  title: string;
  message: string;
  /**
   * 060c: 本文の下に置く追加の要素（省略可）。
   *
   * ⚠ 外部 `@import` の同意ダイアログは**取得先ホストを別行で強調**する必要があり（userinfo 付き URL の
   * 表示偽装対策・060b review② S-6）、`message: string` だけでは表せない。
   * ⚠ 呼び出し側が渡す文字列は**ユーザー CSS 由来の未署名データ**なので、必ず clamp してから渡すこと。
   */
  details?: ReactNode;
  /** 実行ボタンの文言（例「削除」）。 */
  confirmLabel: string;
  /**
   * 060c: キャンセルボタンの文言（既定「キャンセル」）。
   * 同意ダイアログでは「取得しない」＝**何が起きないか**が分かる語にする。
   */
  cancelLabel?: string;
  /** true で実行ボタンを危険色にする（破壊的操作向け）。 */
  danger?: boolean;
  /** 実行中は両ボタンを無効化して二重実行・誤キャンセルを防ぐ。 */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  details,
  confirmLabel,
  cancelLabel = "キャンセル",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // open が false→true になった再レンダ後にモーダル表示する。依存配列は [open]。
  // 親は <ConfirmDialog> を無条件レンダし open だけを切り替えるため、`if (!open) return null` は
  // React 上はアンマウントではなくインスタンスが生存する。よって依存を [] にすると showModal は初回
  // マウント（＝open=false）時に一度評価されるだけで再実行されず、<dialog> は showModal 未呼び出し＝
  // display:none のまま永遠に表示されない（＝削除確認が出ず削除できない）。[open] にすることで
  // open=true への再レンダ（<dialog> コミット済み・ref セット済み）後に effect が走り showModal できる。
  // !dialog.open ガードで二重 showModal（InvalidStateError）を防ぐ。閉じは従来どおり open=false →
  // 下の early return で <dialog> を DOM から外す＝ブラウザが自動で閉じる（close() の明示呼びは不要）。
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className={styles.confirmDialog}
      // Esc（cancel イベント）はブラウザ既定の close を止め、state 経由で閉じる（open の不整合を防ぐ）。
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      // backdrop クリック（target が dialog 要素自身）でキャンセル。dialog は padding:0 で中身を
      // .confirmBody に寄せてあるため、本文上のクリックは target がこの要素にならない。
      onClick={(e) => {
        if (e.target === ref.current && !busy) onCancel();
      }}
    >
      <div className={styles.confirmBody}>
        <h2 className={styles.confirmTitle}>{title}</h2>
        <p className={styles.confirmMessage}>{message}</p>
        {details}
        <div className={styles.confirmActions}>
          {/* ⚠⚠ **既定フォーカスはキャンセル側**（060c）。`<dialog>.showModal()` は autofocus が
              無ければ「最初のフォーカス可能な要素」を選ぶので DOM 順でも結果は同じだが、
              **並び順を入れ替えただけで既定が反転する**のは危うい（外部取得の同意ダイアログでは
              「うっかり Enter で取得してしまう」が実害になる）。明示しておく。
              ⚠ 061g レビューまで**この `autoFocus` も下の `danger` 分岐もどの層も検査していなかった**ので、
              2026-08-14 に守りを足した（並び順を入れ替える／分岐を潰す変更を実際に殺せることを変異で実測）:
                - `ConfirmDialog.test.tsx`「既定フォーカスはキャンセル側」… **フォーカスそのもの**を見る
                  （DOM の並び順ではなく。並び順に依存させないためにこの `autoFocus` がある）
                - `ConfirmDialog.test.tsx`「danger で危険色クラスに切り替わる」… 当たるクラス名を見る
                - `scripts/check-css-guards.mjs` (11-b)(11-c)(11-d) … 危険色の**実体と分岐**
                  （色は jsdom が解決しないのでテストでは殺せない＝3 つで 1 組） */}
          <button
            type="button"
            className={btnStyles.btnGhost}
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? btnStyles.dangerBtn : btnStyles.btn}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "処理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
