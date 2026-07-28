import { useEffect, useRef } from "react";
import styles from "./CommentViewerApp.module.css";

/**
 * 046a: コメント行の右クリックメニュー（項目 1 個の軽量メニュー）。
 *
 * 既存に汎用メニュー基盤が無いため、この機能内で完結する最小実装を置く（新規依存は追加しない）。
 * 表示専用で、固定/解除の実処理と state は呼び出し側（`CommentList` → `CommentViewerApp`）が持つ。
 * ネイティブのコンテキストメニュー抑止（`preventDefault`）は**呼び出し側のコメント行だけ**で行い、
 * アプリ全体のコンテキストメニューは潰さない。
 */

/** メニューの想定サイズ（画面端でのはみ出しクランプ用）。項目 1 個の固定サイズなので実測せず定数で足りる。
 *  **`MENU_WIDTH` は CSS `.contextMenu` の `width` と一致させること**（レビュー対応: 当初 CSS 側が
 *  `min-width: 140px` で定数と別々に生きており、文言を長くすると実幅が 160 を超えてクランプが効かなくなる
 *  状態だった。CSS 側を `width: 160px` に固定し、両者を対で管理する）。 */
const MENU_WIDTH = 160;
const MENU_HEIGHT = 44;

interface CommentContextMenuProps {
  /** 表示位置（`contextmenu` イベントの clientX/clientY）。画面端は下のクランプで内側へ寄せる。 */
  x: number;
  y: number;
  /** 項目の文言（固定済みなら「固定解除」・未固定なら「上部に固定」）。 */
  label: string;
  /** 項目を実行したとき。 */
  onSelect: () => void;
  /** 外側クリック / Esc で閉じるとき。**安定した参照を渡すこと**（下の effect の依存に入る）。 */
  onDismiss: () => void;
}

export function CommentContextMenu({
  x,
  y,
  label,
  onSelect,
  onDismiss,
}: CommentContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  /** 開く直前にフォーカスを持っていた要素（閉じたら戻す）。 */
  const openerRef = useRef<HTMLElement | null>(null);
  /** 閉じるときにフォーカスを戻すか。外側クリックで閉じたときだけ false にする（下の onMouseDown 参照）。 */
  const restoreFocusRef = useRef(true);

  // 開いたら項目へフォーカスする（キーボードで Enter/Space で実行でき、Esc も下の購読で拾える）。
  //
  // レビュー対応（a11y）: 閉じたときは**開く直前にフォーカスを持っていた要素へ戻す**。項目が unmount されると
  // フォーカスは <body> へ落ち、Shift+F10 → Esc したキーボード利用者が一覧の先頭から Tab し直しになるため
  //（`role="menu"` を名乗る以上、WAI-ARIA の menu パターンでは呼び出し元へ返すのが期待挙動）。
  // 右クリックでコメント行がフォーカスされない環境では opener が「直前に触っていた要素」（例: チャンネル名の
  // 入力欄）になり、入力中に右クリックしてもカーソル位置を失わない副次効果もある。
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    itemRef.current?.focus();
    return () => {
      // 外側クリックで閉じたときは、ユーザーが次に触った要素からフォーカスを奪い返さない。
      if (restoreFocusRef.current) openerRef.current?.focus();
    };
  }, []);

  // 外側クリック（mousedown）と Esc で閉じる。購読はメニューが開いている間だけ（このコンポーネントの生存中だけ）張る。
  // 右クリックは mousedown → contextmenu の順に発火するため、メニューを開いた当の mousedown はここに届かない
  //（マウント前に発火済み）＝開いた瞬間に自分で閉じることはない。
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        // 外側クリック由来の close は、押した先（ボタン・入力欄など）へフォーカスが移るのが自然なので戻さない。
        restoreFocusRef.current = false;
        onDismiss();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onDismiss]);

  // 画面端のはみ出し対策（右端・下端で内側へ寄せる）。position:fixed なのでビューポート座標で判定する。
  //
  // レビュー指摘（修正不要）: この計算はレンダー時に一度きりで、**メニューを開いたまま窓をリサイズしても
  // 再計算されない**（resize 購読は張っていない）。意図は「開いている時間は数秒・項目 1 個の一過性 UI」で、
  // その間にわざわざ窓を縮める操作は現実的でなく、最悪でもメニューが画面外に出るだけ（Esc か外側クリックで
  // 閉じられ、データは一切壊れない）ため購読を増やさない方を採った。
  // 再修正トリガー＝メニューの項目が増えて滞在時間が長くなる、または「メニューを開いたまま窓端へドラッグ」が
  // 実運用で問題になったら、resize 購読か `useLayoutEffect` での実測クランプへ寄せる。
  const left = Math.max(0, Math.min(x, window.innerWidth - MENU_WIDTH));
  const top = Math.max(0, Math.min(y, window.innerHeight - MENU_HEIGHT));

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      role="menu"
      style={{ left, top }}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        className={styles.contextMenuItem}
        onClick={onSelect}
      >
        {label}
      </button>
    </div>
  );
}
