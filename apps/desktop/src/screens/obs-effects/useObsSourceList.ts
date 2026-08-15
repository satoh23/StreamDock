import { useCallback, useEffect, useState } from "react";
import {
  loadObsSourceList,
  requestObsSourceList,
  OBS_SOURCE_LIST_KEY,
  type ObsSourceListSnapshot,
} from "../../features/comment-viewer/overlaySettings";
import {
  obsSourceListStatus,
  type ObsSourceListStatus,
} from "./obsSourceListStatus";

/**
 * 064f: **OBS のソース一覧の状態**（取得の依頼・返事待ち・書き戻しの購読）を 1 か所に持つ。
 *
 * ## ⚠⚠ なぜフックへ切り出したのか
 *
 * 064f で依頼者の指示により、**取得ボタンが「OBSエフェクト」のタイトル行**（画面の最上部）へ移り、
 * **一覧と状態の表示は [`ObsSourceCard`] に残った**。⇒ **同じ状態を 2 か所が読む**ことになる。
 * ⚠⚠ **state をどちらかのコンポーネントに置くと、もう片方へ props で配り直すことになり、
 * 「ボタンは押せたのにカードが『取得中』にならない」ような食い違いが構造的に作れてしまう。**
 * ⇒ **持ち主は `ObsEffectsScreen` 1 つ**にして、そこからカードへ渡す（このフックがその器）。
 *
 * ⚠ **状態の決め方（7 つのどれか）は [`obsSourceListStatus`] が持ったまま**で、
 * こちらは「いつ再計算するか」だけを担う。**規則を 2 か所に書かない。**
 *
 * ## ⚠⚠ main 窓は OBS へ直接繋げない（構造上の制約）
 *
 * sidecar と WS で繋がっているのは**コメビュ窓だけ**なので、ここでやるのは
 * **localStorage に依頼を書くこと**だけで、実際に OBS を叩くのはコメビュ窓である。
 * ⚠ 伝達は `storage` イベント＝**別 webview 間ではベストエフォート**なので、
 * 届かなかったときの出口として [`REQUEST_TIMEOUT_MS`] を持つ。
 */

/**
 * 064c: **依頼の返事を待つ上限**（ミリ秒）。
 *
 * ⚠⚠ **これは「遅い」への対策ではなく「返事が来ない」への出口である。**
 * 依頼は localStorage の `storage` イベントで飛ぶ＝**別 webview 間ではベストエフォート**なので、
 * 落ちると「取得しています…」が**セッション中ずっと残る**（＝黙って何も起きない）。
 *
 * ⚠ 8 秒の根拠＝ sidecar の `CONNECT_TIMEOUT_MS`（4 秒）＋ `GetInputList` の往復に余裕を持たせた値。
 * **これより短くすると、OBS が落ちているときの正しい失敗（`ok:false`）を待ちきれず
 * 「返事がありません」に化ける**（＝理由が読めなくなる方向の劣化）。
 *
 * ⚠⚠ **タイマーは「待っている間だけ」張り、返事が来たら／アンマウントで必ず止める**
 * （061a 以来の「配信中にタイマーを残さない」）。
 */
export const REQUEST_TIMEOUT_MS = 8000;

export interface ObsSourceListState {
  /** localStorage に書かれている一覧（`null` ＝ まだ 1 度も書かれていない）。 */
  list: ObsSourceListSnapshot | null;
  /** いま出すべき状態（**必ず 1 つ**）。[`obsSourceListStatus`] が決める。 */
  status: ObsSourceListStatus;
  /** 取得を依頼する（＝ localStorage に nonce を書くだけ）。 */
  refresh: () => void;
  /**
   * ⚠ コメビュ窓が閉じていて**依頼が誰にも届かない**状態か。
   * ⚠ `viewerOpen === null`（未取得）では `false`（初回の一瞬だけ押せなくなるのを避ける）。
   */
  blocked: boolean;
}

/**
 * @param viewerOpen コメビュ窓が開いているか（`null` ＝ **まだ確認できていない**）。
 *   ⚠⚠ `ObsEffectsScreen` が既に 2 秒ポーリングしている値を使う（新しい invoke もタイマーも増やさない）。
 *   ⚠ これが無いと「コメビュ窓が閉じているので依頼が誰にも届かない」を
 *   **8 秒待ってから『返事がありません』としてしか**言えず、原因が読めない。
 */
export function useObsSourceList(viewerOpen: boolean | null): ObsSourceListState {
  const [list, setList] = useState<ObsSourceListSnapshot | null>(() =>
    loadObsSourceList(),
  );
  /** 依頼を出した時刻（`null` ＝ この画面ではまだ 1 度も押していない）。 */
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  /** ⚠ 返事を待ちきれなかったか（[`REQUEST_TIMEOUT_MS`]）。次の依頼で必ず倒す。 */
  const [timedOut, setTimedOut] = useState(false);

  // ⚠⚠ **コメビュ窓が書き戻すのを `storage` で受ける。** ⚠ 同一窓の書き込みでは飛ばないイベントなので、
  //   この購読は「別窓（コメビュ）が書いた」ときだけ発火する＝ここでは正しい使い方である。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === OBS_SOURCE_LIST_KEY || e.key === null) {
        setList(loadObsSourceList());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const status = obsSourceListStatus(list, viewerOpen, requestedAt, timedOut);

  // ⚠⚠ **待っている間だけタイマーを張る**（`status === "pending"` のときだけ）。
  //   返事が来ると status が変わって effect が畳まれ、アンマウントでも必ず止まる。
  //
  // ⚠ **064 レビュー Q-9（修正不要）: deps が `[status]` だけなので、`pending` のまま
  //   もう一度 `refresh()` してもタイマーは張り直されない**（1 回目の 8 秒デッドラインが生き残る）。
  //   意図＝ここが見ているのは「返事が来ない」という 1 つの事象で、依頼のたびに待ち直す必要は無い。
  //   修正不要の理由＝**その状態には UI から到達できない**（取得ボタンは
  //   `disabled={blocked || status === "pending"}`＝返事待ちの二度押しを構造的に塞いである）。
  //   ⚠ **再修正トリガー＝取得の契機が増えたとき**（キーボード操作・別画面からの依頼・自動取得など）。
  //   そのときは deps を `[status, requestedAt]` にすること（依頼ごとに待ち直す形へ変わる）。
  useEffect(() => {
    if (status !== "pending") return;
    const timer = window.setTimeout(() => setTimedOut(true), REQUEST_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [status]);

  const refresh = useCallback(() => {
    // ⚠ 押し直しは必ず「待ちきれなかった」を倒してから（倒さないと 2 回目が即 `timeout` に見える）。
    setTimedOut(false);
    setRequestedAt(Date.now());
    requestObsSourceList();
  }, []);

  return { list, status, refresh, blocked: viewerOpen === false };
}
