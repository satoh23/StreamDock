import { useEffect, useState } from "react";
import { Button } from "../../components/primitives";
import type { GachaPlacement } from "../../features/comment-viewer/overlaySettings";
import { GACHA_TEMPLATES, type GachaTemplateId } from "./gachaStageTemplates";
import { GachaStageLayer } from "./GachaStageLayer";
import { gachaStageTotalMs, gachaStageView } from "./gachaStagePlayback";
import styles from "./ObsEffectsScreen.module.css";

/**
 * ⚠⚠⚠ **063c 段 4-d: 設定画面で演出を再生して見せる**（依頼者の要望
 * 「**それぞれのエフェクトのプレビューが設定画面から見られると良い**」）。
 *
 * ## ⚠⚠ 「実物を縮めて出す」以外の作り方をしていない
 *
 * ⚠⚠⚠ **配信画面と同じ [`GachaStageLayer`] ＋ [`GachaEffectStage`] を、同じ CSS で、
 * 1280×720 のまま描いて `transform: scale()` で縮めている。**
 * ⚠ プレビュー用に別の絵を用意したり、幅を可変にしたりすると
 * **プレビューと実機で見え方が変わる**——それは「プレビューが無い」より悪い
 * （設定を確かめたつもりで、実際は違うものを見ていることになる）。
 * ⇒ **箱は固定サイズ**（[`PREVIEW_SCALE`]）で、器の幅には追従させない。
 *
 * ⚠⚠⚠ **063c 段 5-a: 段 4 は「層」を描いていなかった。**
 * `<GachaEffectStage>` を裸で置いていたため、依頼者の指摘が **3 件同時に**出た——
 * ①「出す位置」を変えても動かない ②中央を選んでも左に寄る ③文字がめちゃくちゃ見えない。
 * ⚠⚠ **理由は 1 つで、あの層が配置・寄せ・縁取りの変数を持っていたから**である
 * （[`GachaStageLayer`] の JSDoc が正）。⇒ **層ごと共有した。**
 *
 * ## ⚠⚠ 何もしない（副作用ゼロ）
 *
 * ⚠⚠⚠ **抽選しない・イベントを送らない・localStorage を書かない・OBS に触らない。**
 * ここは「設定を目で確かめる」だけの場所で、⚠ **ステージ窓が開いていなくても動く**
 * （トグルが OFF でもプレビューは見られる＝押す前に何が起きるか分かる）。
 *
 * ## ⚠⚠⚠ 063c 段 5-d: **自動では動かない**
 *
 * 依頼者の指摘＝「**自動で再生されるのは分かりにくいし画面が喧しい**」。
 * ⇒ 既定は **[`POSTER_MS`]（結果の絵）で静止**し、⚠ **タイマーは 1 本も張らない**。
 * ボタンを押した間だけ通しで 1 回再生し、終わったらまた静止へ戻る。
 * ⚠⚠ **ループへ戻さないこと**——設定画面はユーザーが**長く開いたまま作業する**場所なので、
 * 動き続けるものを置くと「見ていない間もずっと動いている」になる。
 *
 * ## §9
 *
 * ⚠⚠ **実在の視聴者名を出さない。** 出すのは [`SAMPLE_VIEWER_NAME`] という固定の文字列で、
 * **コメントも視聴者一覧も 1 バイトも読まない**（読む口が無い）。
 */

/**
 * 縮小率。⚠ **1280 × 0.375 = 480px**（整数になる値を選んである）。
 * ⚠⚠ 半端な倍率にすると**素材の拡大縮小で像がぶれ**、「にじんで見える」がプレビュー由来なのか
 * 素材由来なのか分からなくなる。
 */
const PREVIEW_SCALE = 0.375;
/** ステージ窓の実寸（⚠ Rust の `inner_size(1280, 720)` と揃えてある）。 */
const STAGE_W = 1280;
const STAGE_H = 720;

/** プレビューの時計の刻み（ミリ秒）。⚠ 実機（`GACHA_TICK_MS`）と同じ 60ms。 */
const PREVIEW_TICK_MS = 60;

/**
 * ⚠⚠⚠ 063c 段 5-d: **止まっているときに出す時刻**＝ **結果の段のいちばん最後**。
 *
 * ⚠ 「押す前は空」にしなかったのは、⚠⚠ **色と位置を確かめたいユーザーが、
 * 確かめるために毎回ボタンを押さなければならなくなる**から
 * （この 2 つは段 5 で直した指摘そのものなので、静止画で見えている必要がある）。
 * ⚠ `-1` なのは、全長ちょうどだと [`gachaStageView`] が `null`（＝出し終わり）を返すため。
 */
const POSTER_MS = gachaStageTotalMs() - 1;

/** ⚠⚠ §9: **固定のサンプル名**（実在の視聴者名を出さない）。 */
const SAMPLE_VIEWER_NAME = "視聴者さん";
/** サンプルの景品名。⚠ ユーザーが打つ景品名の代わりに出すだけで、保存もされない。 */
const SAMPLE_PRIZE_LABEL = "大当たり";

export function GachaStagePreview({
  templateId,
  placement,
  prizeColor,
  rare,
}: {
  /** どのテンプレートを出すか（⚠ **いまは 1 つだけ**・`gachaStageTemplates.ts` の注記が正）。 */
  templateId: GachaTemplateId;
  /**
   * ⚠⚠⚠ 063c 段 5-a: 出す位置（**実機とまったく同じ層へ渡す**）。
   * ⚠ ここを渡し忘れると、依頼者が踏んだ「設定を変えてもプレビューが動かない」に戻る。
   */
  placement: GachaPlacement;
  /** 景品名の色（⚠ **検査済みの CSS 色**・`parseGachaPrizeColor` が唯一の関門）。 */
  prizeColor: string;
  /** 「レア！」を出すか。⚠ プレビューでは**ユーザーが目で確かめるための切り替え**である。 */
  rare: boolean;
}) {
  /**
   * ⚠⚠ **演出の状態はこれ 1 本**（実機の [`EffectOverlayApp`] とまったく同じ形）。
   * ⚠ 何を出すかは [`gachaStageView`] が導出するので、**ここに段の分岐を書かない**。
   */
  const [elapsedMs, setElapsedMs] = useState(POSTER_MS);
  /** ⚠⚠⚠ 段 5-d: **再生中か**（`false` のあいだ**タイマーは 1 本も無い**）。 */
  const [playing, setPlaying] = useState(false);
  /**
   * 何回目の再生か。⚠⚠ **`<Stage>` の `key` に使う**——同じ要素を使い回すと
   * **2 回目以降に CSS の入場アニメーション（`gachaPop` / `gachaDrop`）が走らない**
   * （実機で `seq` を `key` に置いているのと**まったく同じ理由**）。
   */
  const [runId, setRunId] = useState(0);

  // ⚠⚠ **再生中だけ回る時計**（061a 以来の「動いていないならタイマーを張らない」＝判断 11）。
  //   ⚠⚠⚠ **cleanup で必ず止める**（アンマウントでタイマーを残さない）。
  //   ⚠⚠ **更新関数は純粋**にしておく（`EffectOverlayApp` の `gachaStage` と同じ規律）——
  //     ここで「終わったから止める」まで書くと、StrictMode が更新関数を 2 回呼ぶ dev で
  //     **描画の途中に別の state を書き換える**ことになる。⇒ **止めるのは下の effect。**
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setElapsedMs((prev) => prev + PREVIEW_TICK_MS);
    }, PREVIEW_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing]);

  // ⚠⚠⚠ 段 5-d: **通しで 1 回だけ**。全長に達したら止めて静止画（[`POSTER_MS`]）へ戻す。
  //   ⚠ **ループさせないこと**（依頼者＝「自動で再生されるのは分かりにくいし画面が喧しい」）。
  //   ⚠⚠ この 1 レンダーだけ `gachaStageView` が `null` を返すが、
  //     下の `?? gachaStageView(POSTER_MS)` が受けるので**絵が一瞬消えることはない**。
  useEffect(() => {
    if (playing && elapsedMs >= gachaStageTotalMs()) {
      setPlaying(false);
      setElapsedMs(POSTER_MS);
    }
  }, [playing, elapsedMs]);

  const template = GACHA_TEMPLATES.find((t) => t.id === templateId);
  // ⚠ 知らない id は**何も出さない**（既定へ倒すと「別のテンプレートのプレビューを見ている」になる）。
  if (template === undefined) return null;
  const Stage = template.Stage;
  const view = gachaStageView(elapsedMs) ?? gachaStageView(POSTER_MS);
  if (view === null) return null;

  return (
    <div className={styles.gachaPreview}>
      {/* ⚠ `aria-hidden` ＝ 中身は**装飾**（読み上げ対象にしない）。説明はカード側の文が持つ。 */}
      <div
        className={styles.gachaPreviewFrame}
        style={{
          width: STAGE_W * PREVIEW_SCALE,
          height: STAGE_H * PREVIEW_SCALE,
        }}
        aria-hidden="true"
      >
        {/* ⚠⚠ **1280×720 のまま描いて縮める**（上の JSDoc が正）。
            ⚠ `transform-origin` を既定（中央）のままにすると、縮めた絵が枠の外へずれる。
            ⚠⚠⚠ 段 5-d: **止まっている間はアニメーションごと切る**（`.gachaPreviewStill`）——
            切らないとキラキラの明滅（`infinite`）だけが回り続け、
            「押していないのに動いている」という依頼者の指摘がそのまま残る。 */}
        <div
          className={`${styles.gachaPreviewStage} ${playing ? "" : styles.gachaPreviewStill}`}
          style={{
            width: STAGE_W,
            height: STAGE_H,
            transform: `scale(${PREVIEW_SCALE})`,
          }}
        >
          {/* ⚠⚠⚠ 段 5-a: **実機とまったく同じ層で包む**（`GachaStageLayer` の JSDoc が正）。 */}
          <GachaStageLayer placement={placement}>
            <Stage
              key={runId}
              view={view}
              prizeLabel={SAMPLE_PRIZE_LABEL}
              viewerName={SAMPLE_VIEWER_NAME}
              rare={rare}
              prizeColor={prizeColor}
            />
          </GachaStageLayer>
        </div>
      </div>
      {/* ⚠ 押している間は押せない（二重に走らせても意味が無く、`runId` だけが増える）。
          ⚠⚠ **ラベルで状態を伝える**（`disabled` だけだと「壊れている」に見える）。 */}
      <Button
        type="button"
        onClick={() => {
          setRunId((prev) => prev + 1);
          setElapsedMs(0);
          setPlaying(true);
        }}
        disabled={playing}
      >
        {playing ? "再生中…" : `${template.label}を再生`}
      </Button>
    </div>
  );
}
