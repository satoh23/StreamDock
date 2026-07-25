import { useEffect, useRef } from "react";
import styles from "./CommentViewerApp.module.css";

/**
 * 038b: 破壊的操作（視聴者の個別削除・複数選択のまとめて削除）の前に必ず挟む確認ダイアログ。
 *
 * 新規依存を増やさないため、ネイティブの HTML `<dialog>` 要素＋`showModal()` を使う（focus trap・Esc で閉じる・
 * backdrop・モーダル化がブラウザ標準で付く）。見た目は CommentViewerApp.module.css の役割トークンで統一し、
 * 外部リソース・画像・data-URI は使わない（CSP 安全）。表示専用で、削除の実処理・state は呼び出し側が持つ。
 */

interface ConfirmDialogProps {
  /** true でモーダル表示。false でアンマウント（＝閉じる）。 */
  open: boolean;
  title: string;
  message: string;
  /** 実行ボタンの文言（例「削除」）。 */
  confirmLabel: string;
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
  confirmLabel,
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
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onCancel}
            disabled={busy}
          >
            キャンセル
          </button>
          <button
            type="button"
            className={danger ? styles.dangerBtn : styles.btn}
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
