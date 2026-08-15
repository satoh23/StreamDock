import type { CommentViewDto } from "../../features/comment-viewer/types";
import { viewerIdOf } from "./viewerFormat";

/**
 * 051: 「**その配信で初めてしたコメント**」の追跡（コメント一覧の「初コメ」バッジ＋枠色に使う）。
 * ⚠ 当初の指定は「本文を太字」だったが実機で分かりにくく、**バッジ＋初見と同じ枠色**（`var(--ok)`）へ
 * 作り直した。本モジュール（判定）は表現の作り直しの影響を受けていない。
 * React/CSS/DOM 非依存の純関数（`monetaryFeed.ts` / `viewerFormat.ts` と同じく、単体でテストできる状態に保つ）。
 *
 * ## なぜ 038c の判定（初見/久しぶり）では足りないのか
 *
 * `record_comment` が返す判定は **初見**（DB に viewer 行が無い＝人生初コメント）と **久しぶり**
 * （直前の最終コメントから 1 ヶ月以上）で、どちらも**その視聴者の「来訪の 1 件目」にしか付かない**。
 * よって「初見/久しぶりが付いたコメント」は必ず「その配信での初コメント」でもあるが、**逆は成り立たない**
 * ——毎回来る常連の初コメントには判定が付かない。「今日はじめて喋った人」を出すにはここが要る。
 *
 * ## 保持するもの（なぜ Set ではなく Map なのか）
 *
 * `viewerId → その視聴者がこの配信で最初にしたコメントの id` の Map を持つ。「見た viewerId の Set」＋
 * 「初コメントの id の Set」の 2 本立てにすると**2 つの state が同時に動かないと壊れる**ので、
 * 1 本の Map に畳んである（表示側が要る `Set<commentId>` は呼び出し側で `values()` から導出する）。
 *
 * ## 冪等（**この関数の肝**）
 *
 * **既に記録済みの viewerId は絶対に上書きしない**。これにより同じ入力を何度渡しても結果が変わらないので、
 * ①React StrictMode の updater 二重実行 ②同一コメントの再送 ③jewels の combo 更新（同一 id の再配信）
 * のいずれでも「初コメント」の位置がぶれない。**もし「見た viewerId の Set に入っていなければ記録」と
 * 書くと、二重実行の 2 回目に 1 回目の副作用が見えてしまい判定が消える**（＝上書き禁止が冪等性の実体）。
 *
 * 呼び出し側は `mergeComments` の `added` ではなく**受信バッチ `incoming` をそのまま**渡してよい。
 * 上書き禁止なので再送・更新は自然に no-op になり、`MAX_COMMENTS`(=200) クランプから落ちた行に後から
 * combo 更新が届いて `added` に載る（`mergeComments` の既知の挙動）ケースにも影響されない。
 *
 * ## セッションの範囲（⚠⚠ 062b で `session_id` と粒度が分かれた）
 *
 * この Map は `CommentViewerApp` のマウント単位で持つ＝**窓を開き直したら初期化される**。
 *
 * ⚠⚠ **062b 以前はこれで `sessionIdRef`（窓マウント毎に採番していたローカル session_id）と粒度が
 * 揃っていたが、062b で `session_id` が「1 回の配信」（`stream_sessions` の 1 行）になったため、
 * 両者は初めて食い違う。**
 *
 * | | 同じ配信の途中で窓を開き直したとき |
 * |---|---|
 * | `session_id`（062b 後） | **変わらない**（進行中セッションを Rust から引き継ぐ） |
 * | この Map | **リセットされる**（マウント単位のまま） |
 *
 * ⇒ **同じ配信の途中で窓を開き直すと、既に喋っていた常連にもう一度「初コメ」バッジが出る。**
 *
 * **これは 062b で受容した挙動である**（`CommentViewerApp.session.test.tsx` が固定している＝
 * 意図しない回帰ではない）。受容の理由は 2 つ:
 *   ①バッジは**表示だけ**で、記録（`viewer_comments`）にも集計にも 1 バイトも影響しない。
 *   ②粒度を合わせるには「このセッションで既に喋った viewerId」を窓の外から復元する必要があり、
 *     DB からなら**新しい読み取りコマンド**が要り、localStorage からなら**第三者の viewerId を
 *     永続化する**ことになる（docs/security.md §9 追補〔046a〕と同じ土俵＝保存ポリシーの変更）。
 *     どちらも 062b の範囲を超える。
 *
 * 永続化はしない（セッション内のみ・`viewerBadges` と同じ扱い）。
 * **再修正トリガー**＝「窓を開き直すと初コメが出直す」が実運用で邪魔になったとき。そのときは
 * 062c が持つセッション単位の集計から復元する（**新しい保存先を作らない**方向で解く）。
 */

/**
 * 受信バッチから「この配信での初コメント」を確定させる。
 *
 * @param prev viewerId → 初コメント id（この配信ぶん）
 * @param incoming 受信バッチ（chat/課金を問わない・整形前でよい）
 * @returns 変化があれば新しい Map、**変化ゼロなら `prev` を同一参照で返す**（無駄な再レンダを起こさない
 *   ＝`mergeMonetary` と同じ作法。コメントの大半は既出の視聴者なので、この early-out が効く場面が支配的）。
 */
export function trackFirstOfStream(
  prev: ReadonlyMap<string, string>,
  incoming: readonly CommentViewDto[],
): ReadonlyMap<string, string> {
  let next: Map<string, string> | null = null;
  const current = (): ReadonlyMap<string, string> => next ?? prev;

  for (const c of incoming) {
    const viewerId = viewerIdOf(c);
    // **上書きしない**（冪等の実体・上の docstring 参照）。
    if (current().has(viewerId)) continue;
    // 複製は**初回の 1 回だけ**（以降は確保済みの next へ直接 set する）。1 件挿入ごとに複製すると
    // バッチ k 件・既存 m 件で O(k·m) になる。実運用は 1 件ずつ届くので実害は無いが、
    // 「初コメが大量に混ざったバッチ」（配信開始直後の一斉挨拶）で効く。
    next ??= new Map(prev);
    next.set(viewerId, c.id);
  }

  return next ?? prev;
}
