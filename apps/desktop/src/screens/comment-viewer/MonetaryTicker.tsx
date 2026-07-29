import { useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import styles from "./CommentViewerApp.module.css";
import { MonetaryDetailDialog } from "./MonetaryDetailDialog";
import { TONE_CLASS } from "./monetaryTone";
import {
  authorInitial,
  avatarDataUri,
  displayEventType,
  eventLabel,
  monetaryTone,
} from "./viewerFormat";

/**
 * 047: コメビュ本体の上部に出す**課金コメントの常時ティッカー**（横スクロールの 1 行帯）。
 *
 * 流れて消えるコメント一覧の中で投げ銭を見失わないための機能。043b（一覧の赤枠強調）は「流れている最中」しか
 * 効かず、一覧は `MAX_COMMENTS`(=200) でクランプされるため、席を外している間に来たスパチャは構造的に見失う。
 * 蓄積の実体は `monetaryFeed.ts`（`comments` とは別の 50 件ウィンドウ）が持ち、ここは表示専用。
 *
 * ## 構造（047b・実機フィードバックによる作り直し）
 *
 * **固定ラベル ＋ 横スクロールトラック**の 2 ブロック。当初は帯全体が 1 つの `overflow-x: auto` で、その中に
 * 未読チップを `position: sticky` で貼り付けていたが、これは**原理的に破綻していた**——チップは角丸要素で、
 * 角丸は bounding box の四隅を塗らないので、下をスクロールするピルが四隅から必ず覗く（`box-shadow` の目張りは
 * 右側しか塞げない）。ラベルをスクロールコンテナの**外**へ出すことで、透けようがない構造にした。
 * 副産物として「この帯が何なのか分からない」（ラベル不在）も同時に解消している。
 *
 * ## 設計上の要点
 *
 * - **課金 0 件なら何も描かない**（`return null`）。この機能を使わないユーザーには既存レイアウトが完全に不変
 *   （`PinnedCommentBar` と同じ作法）。
 * - **最新が左**（`mergeMonetary` が先頭へ積む）。**自動スクロールしない**ので、配信者が過去のスパチャを
 *   見ている最中に位置を飛ばされない。それでも最新は常に左端の定位置に出る＝見逃さない。
 *   マーキー（CSS アニメーション）にもしない＝動く的をクリックさせない。
 * - **ピルは YouTube 厳守＝ティア色で塗りつぶし、中身はアイコン＋金額だけ**（047b）。当初は無彩色の枠線ピルに
 *   種別ラベル＋名前＋金額を詰めていたが、実機で「色が金額の情報を持っていない／細くて見にくい」となったため、
 *   `superchatTier` によるティア配色（`monetaryTone`）へ移した。名前と種別はクリックで開くダイアログで読む。
 * - **既読（✓）**: ピルを押してダイアログを開いた時点で既読になる。**色チャネルはティアが占有している**ので、
 *   既読は減光（opacity）＋ ✓ で示す（当初の「未読＝赤枠」は 047b で撤去）。**既読 id は親
 *   （`CommentViewerApp`）が持つ**——ここに置くと設定/視聴者ビューへ切り替えて戻った時点で
 *   `view === "comment"` の分岐ごとアンマウントされ、既読が消えてしまうため。
 * - ピルは実 `<button>`。Tab 移動・Enter/Space・フォーカス時の自動横スクロールがブラウザ標準で付く。
 *   【レビュー・修正不要】トラック（`overflow-x: auto` のスクロール領域）には `tabIndex` を付けていない。
 *   フォーカス可能な子孫を含むスクロール領域はキーボード到達可能とみなされる（axe の
 *   `scrollable-region-focusable` も PASS）ため、ピルが実 `<button>` である限り不要。
 *   再修正トリガー: トラックの中身をボタン以外（テキストのみのピル等）に変えるとき。
 */

interface MonetaryTickerProps {
  /** 課金コメント（先頭＝最新）。`mergeMonetary` の戻り値をそのまま渡す。 */
  items: readonly CommentViewDto[];
  /** 展開済み（既読）の id 集合。親が保持する（ビュー切替で消さないため）。 */
  readIds: ReadonlySet<string>;
  /** ダイアログを開いたときに、その id を親へ既読として返す。 */
  onRead: (id: string) => void;
}

export function MonetaryTicker({ items, readIds, onRead }: MonetaryTickerProps) {
  // 展開中のピルの id（null＝閉）。これは描画都合の一時 state なので、既読 id と違いここで持つ
  //（ビュー切替で閉じてよい・`CommentList` の右クリックメニュー state と同じ位置づけ）。
  const [openId, setOpenId] = useState<string | null>(null);

  // 実体は id ではなく items から引き直す＝043e の combo 更新で金額が伸びたら、開いているダイアログにも反映される。
  //
  // 【レビュー Q-3・修正不要】対象が上限 50 を追い越して窓から落ちると null になりダイアログが閉じるが、
  // **openId は残る**ので劣化は「閉じる」だけではない: 落ちた jewels に後から combo 更新が届くと
  // `mergeMonetary` の findIndex が -1 を返して**新規として先頭へ積み直す**ため、ここで再びヒットし
  // open が false→true に戻って `showModal()` が走る＝**閉じたダイアログが独りでに開き直してフォーカスを奪う**。
  // 据え置く理由は発生条件の厳しさ（ダイアログを開いたまま課金が 50 件届き、かつその id に後から combo 更新が
  // 来る）で、潰すなら `selected === null && openId !== null` で openId を落とす effect 1 本で足りる。
  // 再修正トリガー: MONETARY_MAX を大きく下げる／ダイアログを開いたまま放置する運用が普通になったとき。
  const selected = items.find((c) => c.id === openId) ?? null;

  if (items.length === 0) return null;

  // 【レビュー・修正不要】未読件数は毎レンダー reduce で数え直す（useMemo を使わない）。items は
  // MONETARY_MAX(=50) 件が上限で、`CommentList` の「renderDefaultItem は毎レンダー再生成・200 件では
  // 無視できる」と同じ判断に揃えている。再修正トリガー: MONETARY_MAX を桁で増やすとき。
  const unreadCount = items.reduce(
    (n, c) => (readIds.has(c.id) ? n : n + 1),
    0,
  );

  return (
    <>
      <section className={styles.tickerBar} aria-label="課金コメント">
        {/* スクロールコンテナの**外**。ラベルは未読 0 件でも消さない＝帯が無名になる時間を作らない。 */}
        <div className={styles.tickerLabel}>
          <span className={styles.tickerLabelText}>投げ銭</span>
          {unreadCount > 0 && (
            <span className={styles.tickerUnread}>未読 {unreadCount}</span>
          )}
        </div>

        <div className={styles.tickerTrack}>
          {items.map((c) => {
            const isRead = readIds.has(c.id);
            // 043b と同じ整形（ビッツは superchat＋BITS で届くのでラベルだけ振り替わる）。重複実装しない。
            const typeLabel = eventLabel(displayEventType(c));
            // ピルに出す主表示。金額を持たない種別（サブスク/メンシプ/ギフト）は金額の代わりに種別語を出す
            //（空のピルを作らない）。金額を持つ種別では typeLabel は色が担うので出さない。
            const primary = c.monetaryAmount || typeLabel;
            const avatar = avatarDataUri(c.author.avatar);
            const pillClasses = [
              styles.tickerPill,
              TONE_CLASS[monetaryTone(c)],
              isRead ? styles.tickerPillRead : "",
            ].filter(Boolean);
            // 支援技術向けの読み上げ名。**ピルの視覚表現からは名前と種別が落ちている**ので、ここが唯一の
            // テキスト経路になる（title も同文字列＝ホバーで名前が読める実利がある）。二重読み上げにはならない
            //（両方あるとき支援技術は aria-label を名前として採用し title は名前計算から除外される）。
            // 本文（c.text）は入れない（§9）。
            const label = [
              isRead ? "既読" : "未読",
              typeLabel,
              c.author.name,
              c.monetaryAmount,
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={c.id}
                type="button"
                className={pillClasses.join(" ")}
                aria-label={label}
                title={label}
                onClick={() => {
                  setOpenId(c.id);
                  onRead(c.id);
                }}
              >
                <span
                  className={styles.tickerAvatar}
                  style={
                    avatar ? { backgroundImage: `url("${avatar}")` } : undefined
                  }
                  aria-hidden="true"
                >
                  {!avatar && authorInitial(c.author.name)}
                </span>
                {isRead && (
                  <span className={styles.tickerCheck} aria-hidden="true">
                    ✓
                  </span>
                )}
                <span className={styles.tickerAmount}>{primary}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ダイアログは top-layer に出るので、帯（overflow-x:auto のスクロールコンテナ）の外に置く
          ＝帯の中をスクロールしても取り残されない・クリップの懸念も持ち込まない。 */}
      <MonetaryDetailDialog
        comment={selected}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
