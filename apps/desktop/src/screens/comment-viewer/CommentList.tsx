import { useCallback, useRef, useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { RecordResult } from "../../features/viewer-memory/types";
import {
  useFollowScroll,
  type FollowMode,
} from "../../features/comment-viewer/useFollowScroll";
import styles from "./CommentViewerApp.module.css";
import overlayStyles from "./OverlayComment.module.css";
import { CommentContextMenu } from "./CommentContextMenu";
import {
  composeEventMessage,
  displayEventType,
  eventLabel,
  isMonetaryEvent,
  superchatTier,
} from "./viewerFormat";

/**
 * 033b: 受信コメントの一覧描画（listHeader の総数＋`<ol>` 本体）。`CommentViewerApp` の肥大化対策で切り出した
 * 表示コンポーネント（接続/WS/TTS の業務 state は持たず props の `comments` を描画する）。033f（OBS 透過
 * オーバーレイ）がこの一覧描画を再利用する。
 *
 * 046a: 右クリックメニューの開閉位置だけは**この一覧の描画都合の state**としてここが持つ（`menu`）。
 * 固定コメントの実体・永続化は親（`CommentViewerApp` ＋ `pinnedComments.ts`）の責務で、ここは
 * 「どのコメントが押されたか」を `onPin` で渡すだけに留める。
 */

/** 配信元の表示ラベル。 */
const SOURCE_LABEL: Record<CommentViewDto["source"], string> = {
  twitch: "Twitch",
  youtube: "YouTube",
};

/** 配信元バッジの色分けクラス。 */
const SOURCE_CLASS: Record<CommentViewDto["source"], string> = {
  twitch: styles.srcTwitch,
  youtube: styles.srcYoutube,
};

/** 034e: overlay 意匠のサイト名ピルバッジの色分けクラス（Twitch=紫 / YouTube=赤）。default の SOURCE_CLASS と同型。 */
const OVERLAY_SOURCE_CLASS: Record<CommentViewDto["source"], string> = {
  twitch: overlayStyles.sourceTwitch,
  youtube: overlayStyles.sourceYoutube,
};

/** 043c: 投げ銭カードのスパチャ金額ティア配色クラス（0=青…6=赤）。superchatTier の戻り値で引く（実通貨の superchat のみ）。 */
const OVERLAY_TIER_CLASS = [
  overlayStyles.tier0,
  overlayStyles.tier1,
  overlayStyles.tier2,
  overlayStyles.tier3,
  overlayStyles.tier4,
  overlayStyles.tier5,
  overlayStyles.tier6,
];

/** 043c: ティア非対象の課金種別（種別ごとの単色）。displayEventType の戻り値で引く。superchat は金額欠落時の保険で tier0。 */
const OVERLAY_TYPE_CLASS: Record<string, string> = {
  superchat: overlayStyles.tier0,
  bits: overlayStyles.tipBits,
  subscription: overlayStyles.tipSubscription,
  membership: overlayStyles.tipMembership,
  gift: overlayStyles.tipGift,
  donation: overlayStyles.tipDonation,
  jewels: overlayStyles.tipJewels,
};

/** 036a: overlay アイコンの画像なしフォールバック（名前の頭文字）。features/tools の toIconLetter は
 *  ツール用の別系統なので import せず、comment-viewer 内に equivalent を持つ。
 *  配信コメントの表示名は絵文字始まりが多いため、charAt(0)（UTF-16 コードユニット＝サロゲートペアを分割し
 *  孤立サロゲート「�」になる）ではなくコードポイント単位（`[...s]`）で先頭 1 文字を取り、絵文字先頭でも壊さない。
 *  ※ツール用 toIconLetter は入力特性（アプリ名・iconLabel 前提）が異なるため据え置きで問題なく、こちらのみ配慮する。 */
const authorInitial = (name: string): string => [...name.trim()][0] ?? "?";

interface CommentListProps {
  comments: CommentViewDto[];
  /**
   * 033f 追修正: コメント合計（「N 件」）見出しを出すか。既定 true（コメビュ本体）。OBS 用オーバーレイは
   * コメントだけ映したいので false を渡す。
   */
  showCount?: boolean;
  /**
   * 034a: 最新コメントへの自動追従モード。既定 "off"（既存挙動＝追従なし・素の `<ol>`）。コメビュ本体は
   * "release"（下端で追従・スクロールアップで解除＋「最新コメント N件 ↓」ボタン）、034b のオーバーレイは
   * "always"（常時追従・解除/ボタン無し）を渡してこの追従判定を再利用する。追従判定は
   * `useFollowScroll` に切り出してあり、CommentList は表示専用（接続/WS/TTS の業務 state を持たない）ままにする。
   */
  followMode?: FollowMode;
  /**
   * 034e: 表示バリアント。既定 "default"（コメビュ本体＝現行の item/meta/badge/author/text マークアップで不変）。
   * "overlay" のとき OBS オーバーレイ用のチャット意匠（アイコン枠＋名前の左カラム＋半透過グレーの吹き出しに本文）で
   * 描く。意匠クラスは OverlayComment.module.css に隔離してあり本体 CSS には波及しない。
   */
  variant?: "default" | "overlay";
  /**
   * 034e: overlay 意匠でサイト名（Twitch/YouTube）を吹き出しに小さく添えるか。既定 false。設定ビューの
   * 「サイト名を表示する」トグル値をオーバーレイ窓が渡す（受信済み source の表示のみ・新規取得はしない）。
   */
  showSource?: boolean;
  /**
   * 038b フォローアップ: 既定バリアントのコメント行をクリック可能にし、押されたコメントを渡す（コメビュ本体が
   * 視聴者詳細サイドパネルを開くのに使う）。指定時のみ行が interactive（cursor/role=button/Enter・Space）になる。
   * 未指定なら従来どおり表示専用（回帰なし）。overlay バリアントには効かない（OBS 表示は非インタラクティブのまま）。
   */
  onSelect?: (comment: CommentViewDto) => void;
  /**
   * 038c: コメント id → 初見/久しぶり判定（`record_comment` 戻り値）。該当 id の `variant="default"` 行にだけ
   * 「初見」「久しぶり」バッジ＋枠色を重ねる。未指定/非該当は従来どおり無装飾（既存 default 意匠を壊さない）。
   * overlay バリアントには効かない（コメビュ本体のみ・OBS 表示は対象外）。
   */
  badges?: ReadonlyMap<string, RecordResult>;
  /**
   * 046a: 既定バリアントのコメント行を**右クリック**したときに開くメニューから、押されたコメントを渡す
   * （コメビュ本体が上部の固定帯＋ピンストアへ反映する）。**トグル**で、既に固定済みのコメントを渡したときは
   * 親が解除する。指定時のみ行に `onContextMenu` が付き（ネイティブメニューの抑止もその行だけ）、未指定なら
   * 従来どおり右クリックは OS 標準の挙動のまま＝回帰なし。overlay バリアントには効かない（OBS 表示は
   * 非インタラクティブのまま）。左クリック導線（`onSelect` →視聴者詳細）とは独立で、互いに干渉しない。
   */
  onPin?: (comment: CommentViewDto) => void;
  /**
   * 046a: 現在固定中のコメント id 集合。メニュー文言を「上部に固定」/「固定解除」で出し分けるためだけに使う
   * （`badges` と同じ「id で引く任意 prop」の作法）。未指定・非該当は「上部に固定」。
   */
  pinnedIds?: ReadonlySet<string>;
}

export function CommentList({
  comments,
  showCount = true,
  followMode = "off",
  variant = "default",
  showSource = false,
  onSelect,
  badges,
  onPin,
  pinnedIds,
}: CommentListProps) {
  const olRef = useRef<HTMLOListElement>(null);
  const follow = useFollowScroll(olRef, comments, { mode: followMode });

  // 046a: 右クリックメニューの開閉。null＝閉。開いている間だけ <CommentContextMenu> を描く（閉じている間は
  // DOM に出さない＝表示専用時の「button ロールが 0」という既存仕様を壊さない）。対象コメントは実体で保持するので、
  // 一覧が自動追従で流れて行の位置が変わっても、固定されるのは右クリックした 1 件のまま。
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    comment: CommentViewDto;
  } | null>(null);
  // CommentContextMenu の document 購読の依存に入るため、参照を安定させる（毎レンダーの張り直しを避ける）。
  const closeMenu = useCallback(() => setMenu(null), []);

  // 034e(review L5・修正不要): renderDefaultItem/renderOverlayItem は毎レンダー再生成され、使わない分岐も生成される。
  // この一覧（最大 200 件クランプ）の規模では無視できるコストで、分岐マークアップを素直に読める形を優先した意図的な書き方。
  // 再修正トリガー＝将来コメント上限を大幅に増やす等で map 再生成のコストが実測で問題化したら、useCallback 化や
  // 分岐選択のメモ化を検討する。
  // 既定（コメビュ本体）のコメント項目。現行マークアップは不変で、038c 該当時のみ枠色クラス＋バッジを重ねる
  //（非該当・未指定は従来どおり無装飾＝本体の見た目を不変に保つ）。
  const renderDefaultItem = (c: CommentViewDto) => {
    // 038c: firstTime と longAbsence は Rust 側で排他（初見が優先）。念のため frontend でも初見を優先して 1 つだけ出す。
    const badge = badges?.get(c.id);
    // 043b: お金がかかるイベントは赤枠で強調（要望④⑤・見逃し防止）。金額を持たない種別（サブスク/メンシプ/ギフト）は
    //   「〇〇さんが…しました」の文言を組み立て、金額を持つ種別（スパチャ/ビッツ/ドネーション/ジュエル）は種別ラベル＋
    //   金額バッジ＋本文で見せる。chat は従来どおり無装飾。
    const isMoney = isMonetaryEvent(c.eventType);
    const typeLabel = eventLabel(displayEventType(c));
    const eventMessage = composeEventMessage(c);
    const itemClasses = [styles.item];
    if (onSelect) itemClasses.push(styles.itemClickable);
    if (badge?.firstTime) itemClasses.push(styles.itemFirstTime);
    else if (badge?.longAbsence) itemClasses.push(styles.itemLongAbsence);
    // 赤枠は初見/久しぶりより優先（CSS ソース順で .itemMonetary が勝つ）。お金の見逃しを最優先で防ぐ。
    if (isMoney) itemClasses.push(styles.itemMonetary);
    return (
      <li
        key={c.id}
        className={itemClasses.join(" ")}
        // onSelect 指定時のみ行をボタン化（クリック/Enter/Space で視聴者詳細へ）。未指定なら表示専用のまま。
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onClick={onSelect ? () => onSelect(c) : undefined}
        onKeyDown={
          onSelect
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(c);
                }
              }
            : undefined
        }
        // 046a: onPin 指定時のみ右クリックで固定メニューを開く。preventDefault はこの行に限定＝ツールバー・
        // 入力欄・設定画面などアプリ全体のネイティブメニューは従来どおり出る。
        onContextMenu={
          onPin
            ? (e) => {
                e.preventDefault();
                // キーボード（Shift+F10 / メニューキー）由来の contextmenu は clientX/Y が 0 で来るため、
                // その場合は行の左下に出す（左端 0px の実クリックも同じ扱いになるが実害はない）。
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({
                  x: e.clientX || rect.left,
                  y: e.clientY || rect.bottom,
                  comment: c,
                });
              }
            : undefined
        }
      >
        <div className={styles.meta}>
          <span className={`${styles.badge} ${SOURCE_CLASS[c.source]}`}>
            {SOURCE_LABEL[c.source]}
          </span>
          {badge?.firstTime ? (
            <span className={`${styles.badge} ${styles.badgeFirstTime}`}>
              初見
            </span>
          ) : (
            badge?.longAbsence && (
              <span className={`${styles.badge} ${styles.badgeLongAbsence}`}>
                久しぶり
              </span>
            )
          )}
          {/* 043b: 課金イベントの種別ラベル（サブスク/メンシプ/ギフト/ドネーション/スパチャ/ビッツ/ジュエル）。chat は空で非表示。 */}
          {typeLabel && (
            <span className={`${styles.badge} ${styles.badgeEvent}`}>
              {typeLabel}
            </span>
          )}
          <span className={styles.author}>{c.author.name}</span>
          {c.monetaryAmount && (
            <span className={styles.amount}>{c.monetaryAmount}</span>
          )}
          {/* 043e: Jewels の combo（連続ギフト）回数。金額バッジの隣に「×3」として出す。
              目的は装飾ではなく**観測**で、フェーズ2（jewels_amount が単価か累計かの判別）を実機で行うために
              combo 値と金額の変化を同時に目視できるようにする。単発は mapper が undefined へ落とすので出ない。
              オーバーレイ（renderOverlayItem）には**出さない**＝配信画面に出す情報を増やさない。 */}
          {c.comboCount != null && (
            <span className={styles.combo}>×{c.comboCount}</span>
          )}
        </div>
        {/* 043b: 金額を持たない課金イベントは組み立て文言を主表示。視聴者が自由コメントを添えていれば下段に本文を続ける。 */}
        {/* 【レビュー対応・修正不要】上の種別ラベルバッジ（.badgeEvent）と本文言が併存し軽い重複に見えるが、バッジ＝色付き分類・
            文言＝月数/件数など内訳付きの説明で役割が異なるため意図的に両方出す。再修正トリガー: 冗長との UX 指摘が出たら一本化する。 */}
        {eventMessage && <p className={styles.eventMessage}>{eventMessage}</p>}
        {c.text && <p className={styles.text}>{c.text}</p>}
      </li>
    );
  };

  // 034e: OBS オーバーレイ用チャット意匠（LINE 風）。上段＝名前＋サイト名ピルバッジ（別の行）／下段＝アイコン｜吹き出し
  // （同じ行の 2 列）。吹き出し左辺のしっぽがアイコン方向へ向く。showSource=true のときだけサイト名ピルを名前の横に
  // 添える（受信済み source の表示のみ・新規取得はしない）。
  const renderOverlayItem = (c: CommentViewDto) => {
    // 036a: 描画シンクで「webview が踏むのは data URI のみ」（親 036・§CSP の不変条件）を強制する。avatar を
    // background-image に差すのは値が data: 始まりのときだけとし、それ以外（036b にバグで raw URL が漏れた等）は
    // 画像化せずイニシャルにフォールバックさせて外部 URL を踏ませない。036a では送り側未実装で avatar は常に空＝
    // この分岐は発火しない（挙動は従来のグレー丸＋イニシャルのまま）。data: 始まりでも整形済み base64 data URI か
    // 否かの検証は egress 集約点＝converter（036b）の責務で、ここは最終防波堤の型ガードに徹する。
    const avatarDataUri = c.author.avatar?.startsWith("data:")
      ? c.author.avatar
      : undefined;
    // 036a のガードを両分岐（chat 吹き出し／043c 投げ銭カード）で共有する 1 枚のアイコン要素。
    const icon = (
      <div
        className={overlayStyles.icon}
        style={
          avatarDataUri
            ? { backgroundImage: `url("${avatarDataUri}")` }
            : undefined
        }
        aria-hidden="true"
      >
        {!avatarDataUri && (
          <span className={overlayStyles.iconFallback}>
            {authorInitial(c.author.name)}
          </span>
        )}
      </div>
    );

    // 043c: chat は従来の LINE 風吹き出しのまま。chat 以外（投げ銭）は下の YouTube スパチャ風カードで描く。
    const dtype = displayEventType(c);
    if (dtype === "chat") {
      return (
        <li key={c.id} className={overlayStyles.item}>
          <div className={overlayStyles.header}>
            <span className={overlayStyles.name}>{c.author.name}</span>
            {showSource && (
              <span
                className={`${overlayStyles.source} ${OVERLAY_SOURCE_CLASS[c.source]}`}
              >
                {SOURCE_LABEL[c.source]}
              </span>
            )}
          </div>
          <div className={overlayStyles.row}>
            {icon}
            <div className={overlayStyles.bubble}>
              <p className={overlayStyles.text}>{c.text}</p>
            </div>
          </div>
        </li>
      );
    }

    // 043c: 投げ銭カード。superchat（実通貨）は金額ティアで色分け、それ以外の課金種別は種別ごとの単色。
    //   金額換算はせず superchatTier が通貨コードで閾値表を引くだけ（038 のスコープ外）。金額欠落の superchat は tier0 の保険。
    //   【レビュー対応・修正不要】donation/jewels は実金銭だが意図的に種別単色（ティアは YT 同様スパチャ専用）。
    //   金額は amountBadge に verbatim 表示されるため見逃さない。再修正トリガー: これらもティア配色したくなったら分岐条件を拡げる。
    const cardClass =
      dtype === "superchat" && c.monetary
        ? OVERLAY_TIER_CLASS[superchatTier(c.monetary.amount, c.monetary.currency)]
        : (OVERLAY_TYPE_CLASS[dtype] ?? OVERLAY_TIER_CLASS[0]);
    // 金額を持たない種別（サブスク/メンシプ/ギフト）は「〇〇さんが…しました」の要約をボディ主表示にする（本体 043b と同じ）。
    const eventMessage = composeEventMessage(c);
    return (
      <li
        key={c.id}
        className={`${overlayStyles.item} ${overlayStyles.card} ${cardClass}`}
      >
        <div className={overlayStyles.cardHeader}>
          {icon}
          <span className={overlayStyles.cardName}>{c.author.name}</span>
          {showSource && (
            <span
              className={`${overlayStyles.source} ${OVERLAY_SOURCE_CLASS[c.source]}`}
            >
              {SOURCE_LABEL[c.source]}
            </span>
          )}
          {/* 金額はヘッダ右端の pill。監視済み monetaryAmount をそのまま表示（例 "1,000 JPY" / "100 bits"）。 */}
          {c.monetaryAmount && (
            <span className={overlayStyles.amountBadge}>{c.monetaryAmount}</span>
          )}
        </div>
        {(eventMessage || c.text) && (
          <div className={overlayStyles.cardBody}>
            {eventMessage && (
              <p className={overlayStyles.eventMessage}>{eventMessage}</p>
            )}
            {c.text && <p className={overlayStyles.cardText}>{c.text}</p>}
          </div>
        )}
      </li>
    );
  };

  // 追従有無で共有する一覧本体（map は不変）。ref/onScroll は "off" のとき no-op なので付けても素の挙動のまま。
  const list = (
    <ol className={styles.list} ref={olRef} onScroll={follow.onScroll}>
      {comments.length === 0 ? (
        <li className={styles.empty}>コメントはまだありません</li>
      ) : (
        comments.map(
          variant === "overlay" ? renderOverlayItem : renderDefaultItem,
        )
      )}
    </ol>
  );

  return (
    <>
      {showCount && (
        <div className={styles.listHeader}>
          <span className={styles.count}>{comments.length} 件</span>
        </div>
      )}

      {followMode === "release" ? (
        // release のときだけ position:relative ラッパで包み、解除中に半透過黒の長丸ボタンを重ねる。
        // "off"/"always" は素の `<ol>` のまま（オーバーレイの DOM/CSS を今と同一に保つ＝非退行）。
        <div className={styles.listWrap}>
          {list}
          {/* apply-review(L3): 中央 pill は最下部近傍行に重なりうるが、解除中（スクロールアップ中）は最新行が画面外で
              実害小・一般的な "jump to latest" 挙動のため据え置く。z-index 未指定でも DOM 後置で最前面・中央寄せで
              右スクロールバーとも干渉しない。再修正トリガー: 実機で最下部行の視認性に支障が出たら list に下パディングを足す。 */}
          {!follow.following && follow.unseenCount > 0 && (
            <button
              type="button"
              className={styles.jumpButton}
              onClick={follow.jumpToLatest}
            >
              最新コメント {follow.unseenCount}件 ↓
            </button>
          )}
        </div>
      ) : (
        list
      )}

      {/* 046a: 右クリックメニュー。開いている間だけ描く。onPin が無ければ menu は決して開かない
          （onContextMenu 自体を付けないため）が、型の絞り込みのために条件へ含める。position:fixed なので
          `<ol>` の外＝このフラグメント直下に置く（`<ol>` の子に `<div>` を入れない）。 */}
      {menu && onPin && (
        <CommentContextMenu
          x={menu.x}
          y={menu.y}
          label={pinnedIds?.has(menu.comment.id) ? "固定解除" : "上部に固定"}
          onSelect={() => {
            onPin(menu.comment);
            setMenu(null);
          }}
          onDismiss={closeMenu}
        />
      )}
    </>
  );
}
