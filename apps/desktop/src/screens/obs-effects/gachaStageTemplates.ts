import type { ComponentType } from "react";
import { GachaEffectStage } from "./GachaEffectStage";
import type { GachaStageView } from "./gachaStagePlayback";

/**
 * ⚠⚠⚠ **063c 段 4-d: ガチャ演出の「絵」の一覧**（＝ プレビューに並ぶもの）。
 *
 * ## なぜ表にしたのか
 *
 * 依頼者の予定＝「**おみくじはガチャのテンプレートの一つで、今後ガチャエフェクトとは別のエフェクトとして
 * 追加する予定。あくまで違うのは OBS のエフェクトだけで、それ以外は全て同じ。エフェクトを差し替えるだけ**」。
 * ⇒ ⚠⚠ **違うのは「描く側」だけ**なので、差し替わるのは [`GachaStageTemplate.Stage`] 1 本で足りる
 * （抽選・発火・伝達・キュー・時間の進み方は**全部そのまま共有される**）。
 *
 * ## ⚠⚠ いまは 1 件だけである（**座席を作って住人は 1 人**）
 *
 * ⚠ **2 件目が来るまで、選ぶ UI も保存するキーも作らない。**
 * 作ると「選べるのに 1 つしかない選択欄」が画面に増え、⚠⚠ **依頼者が今回まさに指摘した
 * 「項目が増えることで画面が複雑になってしまっている」を自分で作る**ことになる。
 * ⇒ プレビューは**この表を並べるだけ**なので、**2 件目を足せば自動的に 2 つ並ぶ**。
 *
 * ## ⚠⚠⚠ 2 件目を足すときに必ず決めること
 *
 * **「どのガチャがどのテンプレートを使うか」をどこに保存するか**——
 * ⚠ 候補は ①ガチャ定義（`GachaDefinition`）に持たせる ②全体で 1 つ選ぶ、の 2 つで、
 * **①ならガチャごとに絵が変わり、②なら全部同じ絵**になる。
 * ⚠⚠ **①は保存形の変更**なので、`parseGachaDefinition` の後方互換（未知は既定へ倒す）が要る。
 * ⇒ **この判断を先送りしたまま 2 件目を足さないこと。**
 */

/** テンプレートの id（⚠ **保存する形が決まったら、この文字列がそのまま保存値になる**）。 */
export type GachaTemplateId = "capsule";

/**
 * 演出を描くコンポーネントの形。
 *
 * ⚠⚠ **この 5 つ以外を受け取らせないこと。** とくに
 * ⚠⚠⚠ **コメント本文・視聴者 id・金額を足さない**（`docs/security.md` §9 追補・
 * 演出に載ってよい第三者データは**表示名だけ**である）。
 */
export interface GachaStageProps {
  view: GachaStageView;
  prizeLabel: string;
  viewerName: string | null;
  rare: boolean;
  prizeColor: string;
}

export interface GachaStageTemplate {
  id: GachaTemplateId;
  /** 設定画面に出る名前。⚠ プレビューの見出しになる。 */
  label: string;
  /** ⚠ 1 行の説明（**何が起きるか**を書く。意匠の説明は書かない）。 */
  description: string;
  Stage: ComponentType<GachaStageProps>;
}

/** ⚠ 並び順がそのままプレビューの並び順になる。 */
export const GACHA_TEMPLATES: readonly GachaStageTemplate[] = [
  {
    id: "capsule",
    label: "カプセルガチャ",
    description:
      "ガチャマシンが回り、出てきたカプセルが二つに割れて景品名が出ます。",
    Stage: GachaEffectStage,
  },
];

/** ⚠ いま使うテンプレート（**選ぶ仕組みが無いあいだの唯一の答え**・上の JSDoc が正）。 */
export const GACHA_TEMPLATE_DEFAULT: GachaTemplateId = "capsule";
