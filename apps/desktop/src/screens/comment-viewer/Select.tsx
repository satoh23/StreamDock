import type { ChangeEvent, ReactNode } from "react";
import styles from "./CommentViewerApp.module.css";

/**
 * 034(UI刷新): コメビュ設定ビューの選択 UI を統一する自作スタイルの選択ボックス。native `<select>` を
 * `appearance:none` で素の見た目だけ消し、独自シェブロン（文字グリフ ▾・CSS のみ・画像/data-URI なし＝CSP 安全）を
 * 重ねる薄いラッパ。native select を維持するのでキーボード操作・OS ポップアップ・アクセシビリティはそのまま、
 * 話者一覧が多く（20 件前後）ても破綻しない。話者・スタイル・フォントの 3 箇所で共用する。
 *
 * 表示専用で状態は持たない（value/onChange は呼び出し側がそのまま渡す＝native select と同じ API）。
 *
 * レビュー(L2): 呼び出し側が <label> で包む場合、可視ラベルと ariaLabel が同一文言で二重になるが、aria-label が
 * 優先されるだけでアクセシブル名は正しく付くため無害（＝修正不要）。ariaLabel は <label> の外で使う場合にも
 * 明示的なアクセシブル名を保証するため任意で受ける。再修正トリガー＝可視ラベルの無い箇所でも使い回すようになり、
 * ラベル関連付けを ariaLabel 一本に統一したくなった場合は、呼び出し側の <label> テキスト重複を整理する。
 */
export function Select({
  value,
  onChange,
  ariaLabel,
  children,
}: {
  value: string | number;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <span className={styles.selectWrap}>
      <select
        className={styles.selectCustom}
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
      >
        {children}
      </select>
      <span className={styles.chevron} aria-hidden="true">
        ▾
      </span>
    </span>
  );
}
