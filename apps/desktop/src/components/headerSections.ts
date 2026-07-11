import type { Screen } from "../types";

/**
 * ヘッダーの機能大別セクション導線の定義。Header（リンク描画）と App（未実装の
 * 「準備中」ダミーページ描画）が同じ配列を参照するため、label の重複を避ける単一ソース。
 * 将来ここに項目を足すだけでヘッダー導線と遷移先が増える。
 */
export interface HeaderSection {
  id: string;
  label: string;
  screen: Screen;
  /** false: 未実装。クリックで「準備中」ダミーページへ遷移する。 */
  implemented: boolean;
  /** 未実装ページに出す説明（implemented=true では未使用）。 */
  comingSoonDescription?: string;
}

export const HEADER_SECTIONS: readonly HeaderSection[] = [
  { id: "tools", label: "ツール管理", screen: "main", implemented: true },
  {
    id: "rakuraku",
    label: "らくらくツール導入",
    screen: "rakuraku-tools",
    implemented: false,
    comingSoonDescription:
      "おすすめの配信ツールをまとめて確認し、ワンクリックで導入できる機能を準備中です。",
  },
  {
    id: "obs",
    label: "OBSエフェクト",
    screen: "obs-effects",
    implemented: false,
    comingSoonDescription:
      "OBS と連携して配信画面にエフェクトを反映する機能を準備中です。",
  },
];
