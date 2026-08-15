import { Button } from "../../components/primitives";
import {
  requestObsSourceTestFire,
  OBS_SOURCE_FALLBACK_DURATION_MS,
} from "../../features/comment-viewer/overlaySettings";
import type { ObsSourceListState } from "./useObsSourceList";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 064a: **OBS 側のソースを StreamDock から手動で再生する**（064d 以降、エフェクトの**唯一の出し方**）。
 *
 * ⚠ 064e: **画面に出す語は「再生」で統一した**（依頼者＝「鳴らすは言葉の意味が不明」）。
 * ⚠ 064f: **見出しは「エフェクトを手動再生」**（依頼者の指示）。⚠ 「手動」が入ったことで、
 * 下の [`EffectAssignmentCard`]（＝**コメントで自動再生**）との対比が見出しだけで読めるようになった。
 * ⚠ **型名・ファイル名の `ObsSource*` は据え置き**——あちらは obs-websocket の
 * `GetInputList` が返す「input（ソース）」と 1 対 1 で対応しており、
 * UI の言い換えのために sidecar・wire との対応を崩さない。
 *
 * ## ⚠⚠ 064f: このカードは**表示専用**になった
 *
 * 取得ボタンが画面のタイトル行へ移り（依頼者の指示）、**状態の持ち主は [`ObsEffectsScreen`]**
 * （[`useObsSourceList`]）になった。⇒ ここは渡された `status` / `list` を描くだけで、
 * **localStorage の購読もタイマーも持たない**。
 * ⚠⚠ **state をこちらに戻さないこと**——ボタンとカードが別々の state を持つと
 * 「押したのにカードが『取得中』にならない」という食い違いが構造的に作れてしまう。
 *
 * ⚠⚠ **このカードは [`EffectAssignmentCard`] の「上」に置く**（064c）。
 * ①ソースを取得 → ②条件に割り当てる、という順にしか進めないため。
 * 逆順（064a〜064b の並び）だと、**空の `<select>` を先に見せて、その理由を下に書く**ことになる。
 *
 * ## ⚠ セキュリティ（064 の最重要点）
 *
 * ここは**ユーザーが OBS で付けたソース名**を sidecar へ渡す唯一の UI である。
 * ⚠⚠ **この画面では検証しない**——壁は sidecar 側の 2 枚
 * （形式検査 ＋ **`GetInputList` との実在照合**）で、そこが唯一の持ち主である。
 * ⚠ StreamDock がソースを**作る／消す**ことはない（できるのは表示・非表示・頭出しの 3 つだけ）。
 * ⚠ 取得は**ボタンを押した瞬間だけ**（064c/064f でも自動取得にしていない）＝
 * `docs/security.md` §1「ユーザーが明示接続した時のみ」の姿勢は 1 ミリも動いていない。
 */

/**
 * 確認用の表示時間（ミリ秒）。
 *
 * ⚠⚠ **064b で「条件ごとに持つ」という予定を撤回した。** 実際の長さは
 * **OBS 側のメディアが持っている**ので sidecar が `GetMediaInputStatus` で聞く
 * （`resolveObsFireDurationMs`）＝ **設定項目を 1 つも増やさずに「動画が途中で切れる」を消せる**。
 * ⇒ ここで渡すのは**聞けなかったときの既定**だけで、064b の自動発火とも同じ値を使う
 * （[`OBS_SOURCE_FALLBACK_DURATION_MS`]）。⚠ **2 か所に別の数字を書かないこと。**
 */
const TEST_FIRE_DURATION_MS = OBS_SOURCE_FALLBACK_DURATION_MS;

/** ソース種別の**画面での呼び方**。⚠ 未知の種別はそのまま出さない（allow-list 外は一覧に来ない）。 */
const SOURCE_KIND_LABEL: Readonly<Record<string, string>> = {
  ffmpeg_source: "動画",
  image_source: "画像",
};

/**
 * 064c: 一覧の**時刻**を `HH:MM` で出す。
 *
 * ⚠ **`toLocaleTimeString` を使わない**——実行環境のロケールで表記が変わり、
 * 「12:34」を期待している検査が環境依存で落ちる（画面の意味も環境で変わる）。
 */
function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function ObsSourceCard({
  /** 064f: 一覧の状態（持ち主は [`ObsEffectsScreen`]・[`useObsSourceList`]）。 */
  state,
}: {
  state: ObsSourceListState;
}) {
  const { list, status, blocked } = state;
  const sources = list?.sources ?? [];

  return (
    <section className={layout.panel}>
      <div className={layout.panelHead}>
        {/* ⚠ 064f: 「エフェクトを手動再生」（依頼者の指示）。
            ⚠⚠ **064e でカードの説明文を削除した**（依頼者＝説明が長い）。⚠ **消してよかった理由**＝
            この文が言っていたこと（何ができるか／まず一覧を取ること）は、
            **見出しとタイトル行の取得ボタン、および `never` 状態の案内が既に出している**。
            ⚠ 「黙って何も起きない」を防いでいたのは説明文ではなく**状態の出し分け**（064c）である。 */}
        <h3>エフェクトを手動再生</h3>
      </div>
      <div className={layout.panelBody}>
        {/* ⚠⚠ **ここから下は必ず 1 つだけ出る**（[`obsSourceListStatus`] が状態を 1 つに決める）。
            ⚠ 061a 以来の規律＝**黙って何も起きない状態を作らない**の本体である。
            ⚠⚠ 064f: **取得ボタンは画面のタイトル行にある**ので、案内でボタン名を出すときは
            「最新のOBSのソースを取得」と揃えること（画面に無い操作名を書かない・061i レビュー S-1）。

            ⚠ **064 レビュー Q-7（修正不要）: 7 状態を `&&` の羅列で書いており、網羅性は型で
            担保していない**（8 個目を足して分岐を書き忘れると「どれも出ない」を静かに作れる）。
            意図＝`switch` や `Record<Status, ReactNode>` にすると、各状態の**文言と className の
            対応が 1 か所に固まって読みにくくなる**ため、いまは素直な羅列を採っている。
            修正不要の理由＝**7 状態すべてに個別のテストがある**（`ObsSourceCard.test.tsx`）ので、
            分岐を消す変異はレッドになる。⚠ **再修正トリガー＝状態が 8 個目に増えるとき**
            （そのとき `Record<ObsSourceListStatus, …>` へ寄せて網羅性を型で固定すること）。 */}

        {status === "no-viewer" && (
          // ⚠⚠ 064f: 依頼を代行する窓が無い＝押しても何も起きない。**理由と導線は画面上部の案内**
          //   （「コメントビューア for StreamDock の専用機能です」＋開くボタン）が出すので、
          //   ここは**同じことを繰り返さない**（061a Q-1 が戒めた「同じことを 2 か所に別の言葉で載せる」）。
          //
          // ⚠ **064 レビュー Q-10（修正不要）: 厳密には「開くだけ」では足りない**——依頼を sidecar へ
          //   投げるにはコメビュ窓が **WS に接続済み**である必要があり、未接続なら送信は黙って捨てられて
          //   8 秒後に `timeout` へ落ちる。修正不要の理由＝**画面上部の案内が
          //   「コメントビューアを起動し、配信に接続してください」と接続まで書いており**、
          //   その案内はここと**同じ条件**（`viewerOpen === false`）で必ず並んで出るため、
          //   ユーザーが取る行動は正しくなる（＝この 1 行を長くすると 061a Q-1 の「2 か所に別の言葉」になる）。
          //   ⚠ **再修正トリガー＝「窓は開いているのに『応答がありません』になる」と実機で言われたとき。**
          //   そのときは `blocked` の判定を「窓の存在」から「WS 接続の有無」へ寄せること
          //   （コメビュ窓が `obs.state` を localStorage へ書く既存の再修正トリガーが使える）。
          <p className={styles.note}>
            コメントビューアを開くと、OBS からソースを取得できます。
          </p>
        )}

        {status === "never" && (
          // ⚠⚠ **これが無いと、下の条件カードの `<select>` が空である理由がどこからも読めない。**
          <p className={styles.note}>
            まだ取得していません。「最新のOBSのソースを取得」を押してください。
          </p>
        )}

        {status === "pending" && (
          <p className={styles.note}>OBS から取得しています…</p>
        )}

        {status === "timeout" && (
          // ⚠ `storage` が届かなかった／コメビュ窓が途中で閉じた等。⚠ **原因は特定できない**ので
          //   断定しない（061a レビュー Q-1 の「約束できることだけ書く」）。
          <p className={styles.errorText}>
            OBS からの応答がありませんでした。コメントビューアが開いていることを確認して、もう一度お試しください。
          </p>
        )}

        {status === "disconnected" && (
          // ⚠⚠⚠ **064c の中心。** 064a はここを「再生できるソースが見つかりませんでした。OBS の
          //   シーンに『メディアソース』か『画像』を追加してください」と出していた——
          //   **OBS が落ちているだけのユーザーを、OBS でソースを作る作業へ誘導していた**。
          //   ⚠ 区別できるようになったのは `obs.sources` が `ok` を運ぶようになったから（064c）。
          <p className={styles.errorText}>
            OBS に接続できませんでした。OBS
            が起動しているか、OBS 側で WebSocket サーバーが有効かを確認してください。
          </p>
        )}

        {status === "empty" && (
          // ⚠ **繋がったうえで 0 件**のときだけ出す（＝この案内は必ず正しい対処になる）。
          <p className={styles.note}>
            再生できるソースが見つかりませんでした。OBS
            のシーンに「メディアソース」か「画像」を追加してください。
          </p>
        )}

        {/* ⚠⚠ **一覧は状態と独立に出す**（`ready` のときだけにしない）。
            ⚠ コメビュ窓が閉じていても**条件への割り当ては続けられる**（下の [`EffectAssignmentCard`] は
            同じ localStorage を読む）ので、ここで一覧を隠すと「`<select>` には出るのに
            このカードには無い」という食い違いになる。⚠ **取得中も古い一覧を出したままにする**
            （消すと画面が一瞬空になり、失敗したように見える）。 */}
        {sources.length > 0 && (
          <ul className={styles.templateList}>
            {sources.map((source) => (
              <li key={source.name} className={styles.templateRow}>
                {/* ⚠ ソース名は**ユーザー自身が OBS で付けた文字列**なので画面に出してよい（§9）。
                    ⚠ React のテキストノードとして描く（`dangerouslySetInnerHTML` は使わない）。 */}
                <span className={styles.templateName}>{source.name}</span>
                <span className={styles.templateMeta}>
                  {SOURCE_KIND_LABEL[source.kind] ?? source.kind}
                </span>
                <Button
                  type="button"
                  onClick={() =>
                    requestObsSourceTestFire(source.name, TEST_FIRE_DURATION_MS)
                  }
                  // ⚠⚠ 再生の依頼もコメビュ窓が代行する＝**閉じていれば押しても何も起きない**。
                  //   上の `no-viewer` の 1 行が理由を出しているので、ここは押せなくしてよい。
                  disabled={blocked}
                >
                  再生する
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* ⚠⚠ **「いつ時点の一覧か」を出す**（`OBS_SOURCE_LIST_KEY` の JSDoc が 064a から
            要求していたのに、画面へ出していたのは 1 か所も無かった）。
            ⚠ これが無いと、OBS 側でソースを足したユーザーが**古い一覧を新しいものと誤認する**。
            ⚠ 064f: **取得ボタンがタイトル行へ移ったので、時刻も一覧の側（ここ）へ移した**
            ——ボタンの隣に置くと、画面最上部に「12:34 時点」だけが浮いて何の時刻か読めない。 */}
        {list !== null && status !== "pending" && (
          <p className={styles.note}>{formatClock(list.at)} 時点の一覧です。</p>
        )}

        {/* ⚠⚠⚠ **064e: 「いま OBS で表示しているシーンに置いてあるソースだけ再生できます」を削除した**
            （依頼者の指示）。⚠ **これは情報を 1 つ失う判断である**——現在のシーンに置かれていない
            ソースは OBS の仕様（scene item が無い）で出せず、**一覧には出るのに再生されない**。
            064a はこの文を「書かないとバグとして報告される」として置いていた。
            ⚠⚠ **再修正トリガー＝「一覧に出るのに再生されない」と実機で言われたとき。**
            そのときは常時表示の note ではなく、**再生が失敗した行にだけ**理由を出すこと
            （常時出す説明文は 061p 以来ずっと「長い」と言われている側である）。

            ⚠ **064 レビュー S-8（受容の裏取り・修正不要）: この失敗は「黙って」は起きない**——
            現在シーンに無いソースは sidecar の `GetSceneItemId` が throw し、
            `onState("failed", …)` が**コメビュ窓ツールバーの赤字**に出る。
            ⚠⚠ **ただし main 窓には出ない**（`obs.state` を読めるのは WS を持つコメビュ窓だけ）ので、
            ボタンを押した本人＝main 窓を見ている人には「押しても何も起きない」に見える。
            ⚠ **上記の再修正トリガーが発火したら、行ごとの失敗表示**（＝ 064c が `ok` を足したのと
            同じ手で、`fireSource` の結果を localStorage 経由で返す）**まで含めて設計すること。** */}
      </div>
    </section>
  );
}
