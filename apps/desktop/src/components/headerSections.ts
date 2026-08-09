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
    label: "らくらくツール設定",
    screen: "rakuraku-tools",
    // 032a: 画面枠組み（一覧→詳細→同意→実行の器）を実装したため実画面へ遷移する。
    implemented: true,
    comingSoonDescription:
      "おすすめの配信ツールをまとめて確認し、ワンクリックで設定できる機能を準備中です。",
  },
  {
    id: "obs",
    label: "OBSエフェクト",
    screen: "obs-effects",
    // 061a: エフェクト専用の透過オーバーレイ窓・OBS へのソース自動追加・画面の枠を実装したため実画面へ遷移する。
    // ⚠ `comingSoonDescription` は**消してある**。`implemented: true` では使われないので、残すと
    // 「準備中です」という嘘の説明がコード上に残り続ける（らくらくツール設定は移行時に消し忘れている）。
    implemented: true,
  },
];
