import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * 034a: コメント一覧の「最新コメント自動追従」判定を切り出した再利用フック。純粋な frontend の
 * スクロール/DOM 制御のみ（通信・sidecar・Rust には一切触れない）。新着は末尾 append 前提
 * （`mergeComments`）なので、**最新はリスト下端**にある。
 *
 * mode:
 *  - "release" … コメビュ本体（034a）。下端付近にいる間だけ追従し、閾値を超えてスクロールアップすると
 *      追従を解除する。解除中は自動スクロールせず、解除後に増えた件数を `unseenCount` で数える
 *      （「最新コメント N件 ↓」ボタンの N）。
 *  - "always"  … OBS オーバーレイ（034b で再利用予定）。常に最下部へ追従し、解除・カウントを持たない。
 *  - "off"     … 追従しない（既存挙動）。ラッパ/ボタンを出さない呼び出し側の既定。
 *
 * `following` は**ユーザーのスクロール（onScroll）でのみ**切り替える。新着 append では変えないので、
 * 閾値と行高が結合してチラつく（append 直後に一瞬「解除」判定になる）ことを避けられる。
 */

export type FollowMode = "release" | "always" | "off";

/** 下端判定のしきい値（px）。この距離以内なら「下端にいる＝追従中」とみなす。 */
const FOLLOW_THRESHOLD_PX = 64;

export interface FollowScroll {
  /** 追従中か（release で false のときだけジャンプボタンを出す）。 */
  following: boolean;
  /** 追従解除後に増えた新着件数（ボタンの N）。追従中は常に 0。 */
  unseenCount: number;
  /** スクロールコンテナの onScroll に渡す。release 以外は no-op。 */
  onScroll: () => void;
  /** 最下部へスクロールして追従を再開し、unseenCount を 0 に戻す。 */
  jumpToLatest: () => void;
}

/** items 内で watermark(=最後に数え込んだ id) 以降の新規件数を数える。 */
function countSince(
  items: readonly { id: string }[],
  watermark: string | null,
): number {
  if (watermark === null) return items.length;
  const idx = items.findIndex((c) => c.id === watermark);
  // watermark が 200 件クランプで落ちた稀ケース（解除中に >200 件到来）は全件を未読扱いにフォールバックする。
  // apply-review(C1): 過大カウントはボタンの N 表示のみ（機能挙動に非波及）で最大 ~200 に有界＝実害小のため据え置く。
  // 再修正トリガー: N の正確さが要件化される / 表示上限 200 を大きく変える場合は、脱落した watermark 手前の件数を
  // 差分計算する方式（例: 前回件数との差）へ切り替える。
  return idx < 0 ? items.length : items.length - 1 - idx;
}

export function useFollowScroll<E extends HTMLElement>(
  scrollRef: RefObject<E | null>,
  items: readonly { id: string }[],
  { mode }: { mode: FollowMode },
): FollowScroll {
  const [following, setFollowing] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  // stale closure を避けつつ、effect / handler から最新値を読むための ref 群。
  // apply-review(L2): followingRef は render 本体で同値代入する（冪等・StrictMode 二重 render でも安全）。effect を
  // `following` 変化で再実行させず「最新の追従状態」だけを handler/effect から読むための意図的な最新値 ref パターン。
  // 再修正トリガー: Concurrent の中断 render で厳密性が問題化したら useLayoutEffect(() => { followingRef.current = following }) へ寄せる。
  const followingRef = useRef(following);
  followingRef.current = following;
  // 最後に「数え込んだ / 追従で最下部に着けた」最新コメントの id。unseenCount の起点。
  const watermarkRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollRef]);

  // 新着反映: items が変わるたびに、追従中なら最下部へ寄せ、解除中なら増分を unseenCount に積む。
  // レイアウト確定後・描画前に走らせてスクロールのチラつきを避ける（useLayoutEffect）。
  // apply-review(L1): mergeComments が毎バッチ新配列を返す（重複のみ added=0 でも [...prev]）ため、本 effect と
  // onScroll（deps に items）は毎バッチ再実行/再生成される。ただし追従中は scrollToBottom が no-op、解除中は
  // countSince が watermark=lastId で 0 を返し冪等なので正しい。コストは DOM 書込 1 回＋リスナ再アタッチ/バッチで軽微。
  // 再修正トリガー: プロファイルで scroll ハンドラ再アタッチがコスト化したら items を ref 化して deps から外す。
  useLayoutEffect(() => {
    if (mode === "off") return;
    const lastId = items.length > 0 ? items[items.length - 1].id : null;

    if (mode === "always" || followingRef.current) {
      scrollToBottom();
      watermarkRef.current = lastId;
      setUnseenCount(0);
      return;
    }

    // release かつ解除中: watermark 以降の新規件数を積み増し、watermark を進める。
    const added = countSince(items, watermarkRef.current);
    if (added > 0) setUnseenCount((n) => n + added);
    watermarkRef.current = lastId;
  }, [items, mode, scrollToBottom]);

  const onScroll = useCallback(() => {
    if (mode !== "release") return; // always/off は解除判定を持たない。
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nowFollowing = dist <= FOLLOW_THRESHOLD_PX;
    if (nowFollowing && !followingRef.current) {
      // 手動で下端へ戻った: 追従再開＋カウントリセット。
      watermarkRef.current = items.length > 0 ? items[items.length - 1].id : null;
      setUnseenCount(0);
    }
    if (nowFollowing !== followingRef.current) setFollowing(nowFollowing);
  }, [mode, scrollRef, items]);

  const jumpToLatest = useCallback(() => {
    scrollToBottom();
    watermarkRef.current = items.length > 0 ? items[items.length - 1].id : null;
    setUnseenCount(0);
    setFollowing(true);
  }, [scrollToBottom, items]);

  return { following, unseenCount, onScroll, jumpToLatest };
}
