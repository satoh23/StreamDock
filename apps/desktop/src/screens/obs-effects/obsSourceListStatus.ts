import type { ObsSourceListSnapshot } from "../../features/comment-viewer/overlaySettings";

/**
 * 064c: **「OBS のソースを鳴らす」カードがいま出すべき状態**を 1 つに決める純関数。
 *
 * ## ⚠⚠ なぜ独立したモジュールなのか
 *
 * ① **これが 064 の受け入れ条件「OBS 未接続・ソース未設置のときに黙って何も起きない状態を
 *    作らない（画面で理由が読める）」の本体**であり、DOM を経由せず直接固定できる形にしておきたい。
 * ② `ObsSourceCard.tsx` から export すると Fast Refresh が効かなくなる
 *    （`react-refresh/only-export-components`）。⚠ 061j (0) で `effectSelectValue.ts` を
 *    切り出したのと同じ判断＝**規則の持ち主を 1 モジュールに閉じる**。
 *
 * ## ⚠⚠⚠ `disconnected` と `empty` を混ぜないこと
 *
 * 064a は失敗も成功も**空配列**で返していたので両者を区別できず、
 * **OBS が起動していないユーザーへ「OBS のシーンにソースを追加してください」**という
 * 間違った対処を案内していた（061a レビュー Q-1 と同じ失敗モードの 3 度目）。
 * 区別できるようになったのは `obs.sources` フレームが `ok` を運ぶようになったから（064c）。
 */
export type ObsSourceListStatus =
  /** コメビュ窓が閉じている＝依頼を代行できる窓が無い（押しても何も起きない）。 */
  | "no-viewer"
  /** まだ 1 度も取得していない。 */
  | "never"
  /** 依頼を出して返事を待っている。 */
  | "pending"
  /** 待ちきれなかった（`storage` が届かなかった／コメビュ窓が途中で閉じた等）。 */
  | "timeout"
  /** ⚠ OBS へ繋がらなかった（**「0 件」ではない**）。 */
  | "disconnected"
  /** 繋がったが、鳴らせるソースが 1 つも無い。 */
  | "empty"
  /** 取れた。 */
  | "ready";

/**
 * 064c: 状態を 1 つに決める。
 *
 * ⚠⚠ **順序に意味がある。**
 * 1. **「コメビュ窓が無い」が最優先**——依頼そのものが誰にも届かないので、
 *    他のどの状態を出しても対処にならない（＝ 8 秒待って `timeout` を出すのは遅すぎる）。
 * 2. **返事待ち**は「要求時刻より新しい一覧が届いたか」で判定する（`at` の比較）。
 *    ⚠ 一覧の中身では判定できない——**取り直した結果がまったく同じ**ことが普通にあるため。
 * 3. 以降は届いた一覧の中身で決める。
 *
 * ⚠ **`viewerOpen === null`（未取得）を `no-viewer` にしない**——2 秒ポーリングの初回まで
 * 「閉じています」が点滅する（061d-2 レビュー S-1 の「取れていないなら断言しない」と同じ規律）。
 *
 * @param list      localStorage の一覧（`null` ＝ まだ 1 度も書かれていない）
 * @param viewerOpen コメビュ窓が開いているか（`null` ＝ まだ確認できていない）
 * @param requestedAt 依頼を出した時刻（`null` ＝ この画面ではまだ押していない）
 * @param timedOut  返事を待ちきれなかったか
 */
export function obsSourceListStatus(
  list: ObsSourceListSnapshot | null,
  viewerOpen: boolean | null,
  requestedAt: number | null,
  timedOut: boolean,
): ObsSourceListStatus {
  if (viewerOpen === false) return "no-viewer";
  const answered =
    list !== null && requestedAt !== null && list.at >= requestedAt;
  if (requestedAt !== null && !answered) return timedOut ? "timeout" : "pending";
  if (list === null) return "never";
  // ⚠⚠ **ここが 064c の分かれ目**（`ok` が無ければ「0 件」に化ける）。
  if (!list.ok) return "disconnected";
  return list.sources.length === 0 ? "empty" : "ready";
}
