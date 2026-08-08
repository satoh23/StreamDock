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
import { OVERLAY_TONE_CLASS, TONE_CLASS } from "./monetaryTone";
import {
  authorInitial,
  avatarDataUri,
  composeEventMessage,
  displayEventType,
  eventLabel,
  isMonetaryEvent,
  monetaryTone,
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

/* 043c/047b: 投げ銭の配色クラスは `monetaryTone()` の戻り値 1 本で引く（本体＝TONE_CLASS / OBS＝OVERLAY_TONE_CLASS）。
   043c 時点はこのファイル内に「ティア表＋種別表＋どちらを引くかの三項演算」がインラインで書かれていたが、
   047b で本体側の 3 箇所（ティッカー・一覧カード・全文ダイアログ）と固定帯も同じ判定を必要としたため、
   判定は `viewerFormat.ts`（純関数）へ、クラス対応表は `monetaryTone.ts` へ切り出した。 */

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
   * 051: 「**その配信で初めてしたコメント**」の id 集合（`firstOfStream.ts` が確定させる）。該当行は
   * **「初コメ」バッジ ＋ 初見と同じ枠色**（`.itemFirstComment` = `var(--ok)`）にする。
   * ⚠ 当初の指定は「本文を太字・枠色は変えない」だったが、実機で分かりにくく作り直した（太字は撤去済み）。
   * 枠色を持たせた結果、038c の判定と信号が競合しうるので**下の付与は `else if` 連鎖が必須**
   * （優先順＝初見 > 久しぶり > 初コメ）。
   * `badges` / `pinnedIds` と同じ「id で引く任意 prop」の作法で、**未指定なら従来どおり無装飾**。
   * overlay バリアントには効かない（配信画面に出す情報を増やす判断は別件なのでコメビュ本体のみ）。
   */
  firstOfStreamIds?: ReadonlySet<string>;
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
  firstOfStreamIds,
  onPin,
  pinnedIds,
}: CommentListProps) {
  // ⚠ 060c 追修正(2026-08-09): スクロールするのは `<ol>` ではなく**外側の `<div>`**（`.scroller`）。
  // 理由は `CommentViewerApp.module.css` の `.scroller` のコメント（ユーザー CSS が `<ol>` の
  // `overflow` を潰せてしまい、スクロール機能ごと死んでいた）。
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useFollowScroll(scrollRef, comments, { mode: followMode });

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
    // 043b/047b: お金がかかるイベントは **YouTube スパチャ風のティア色カード**で強調する（要望④⑤・見逃し防止）。
    //   金額を持たない種別（サブスク/メンシプ/ギフト）は「〇〇さんが…しました」の文言を組み立て、金額を持つ種別
    //   （スパチャ/ビッツ/ドネーション/ジュエル）は金額を主表示にする。chat は従来どおり無装飾（このカードに入らない）。
    //   047b までは赤枠（.itemMonetary）だったが、実機で「見にくい・額が分からない」となり色に金額の情報を
    //   持たせるティア配色へ移行した（OBS の投げ銭カードと同じトークン＝配信画面と本体で同じ額は同じ色になる）。
    const isMoney = isMonetaryEvent(c.eventType);
    const typeLabel = eventLabel(displayEventType(c));
    const eventMessage = composeEventMessage(c);
    // 036a のガードは 1 回だけ評価して使い回す（下のヘッダ帯で背景画像と頭文字フォールバックの両方が見る）。
    const tipAvatar = avatarDataUri(c.author.avatar);
    const itemClasses = [styles.item];
    if (onSelect) itemClasses.push(styles.itemClickable);
    // 051: 枠色は **1 行 1 信号**。優先順は **初見 > 久しぶり > 初コメ**（情報量の多い方を残す＝
    // 038c の「初見優先」と同じ考え方）。下の judgementBadge も同じ順で 1 つだけ出す。
    //
    // ⚠ **else if の連鎖であることが必須**。038c の判定（初見/久しぶり）は論理的に「その配信の初コメント」に
    // 含まれる（どちらも `record_comment` が**その視聴者の来訪 1 件目**にしか返さないため）ので、素朴に
    // 並べて足すと ①**久しぶり（青枠）と初コメ（緑枠）が同じ行に同時に付き**、勝敗が CSS のソース順で
    // 決まる＝コードから意図が読めない ②「初見」と「初コメ」のバッジが**二重に出る**。
    const isFirstOfStream = firstOfStreamIds?.has(c.id) ?? false;
    if (badge?.firstTime) itemClasses.push(styles.itemFirstTime);
    else if (badge?.longAbsence) itemClasses.push(styles.itemLongAbsence);
    else if (isFirstOfStream) itemClasses.push(styles.itemFirstComment);
    // 課金カードは枠色（初見/久しぶり）より優先。判定は帯の中にチップとして出るので情報は落ちない。
    if (isMoney) itemClasses.push(styles.itemTipCard, TONE_CLASS[monetaryTone(c)]);
    // 初見/久しぶりのチップは chat 行（.badge 系）と課金カードのヘッダ帯（.tipChip）で下地が違うため、
    // 文言は同じまま器だけ差し替える（色付き帯の上に無彩色前提の役割トークンを乗せると沈む/喧嘩する）。
    const chipClass = isMoney ? styles.tipChip : styles.badge;
    // 051: 「初コメ」を最後段に足す。上の枠色クラスと**同じ優先順**（初見 > 久しぶり > 初コメ）で
    // 1 つだけ出す＝初見の行に「初見」と「初コメ」が並ばない。
    const judgementBadge = badge?.firstTime ? (
      <span className={`${chipClass} ${isMoney ? "" : styles.badgeFirstTime}`}>
        初見
      </span>
    ) : badge?.longAbsence ? (
      <span className={`${chipClass} ${isMoney ? "" : styles.badgeLongAbsence}`}>
        久しぶり
      </span>
    ) : isFirstOfStream ? (
      <span className={`${chipClass} ${isMoney ? "" : styles.badgeFirstComment}`}>
        初コメ
      </span>
    ) : null;
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
        {isMoney ? (
          <>
            {/* 047b: ティア色ヘッダ帯。アイコン→名前→（配信元/判定/種別チップ）→金額→combo の順で、
                一番見たい金額を右端に置く。アイコンは 036a のガード（avatarDataUri）を通した data URI のときだけ。
                047e: ガードは**一度だけ評価して束ねる**（renderOverlayItem と同じ作法）。§1 の不変条件を背負う
                唯一の関数なので「1 回評価・1 つの値」が読んで明らかな形に揃える。 */}
            <div className={styles.tipHeader}>
              <span
                className={styles.tipAvatar}
                style={
                  tipAvatar
                    ? { backgroundImage: `url("${tipAvatar}")` }
                    : undefined
                }
                aria-hidden="true"
              >
                {!tipAvatar && authorInitial(c.author.name)}
              </span>
              <span className={styles.tipName}>{c.author.name}</span>
              <span className={styles.tipChip}>{SOURCE_LABEL[c.source]}</span>
              {judgementBadge}
              {/* 043b: 課金イベントの種別ラベル。色でも種別は分かるが、7 種別を色だけで覚えるのは無理なので残す。 */}
              {typeLabel && <span className={styles.tipChip}>{typeLabel}</span>}
              {c.monetaryAmount && (
                <span className={styles.tipAmount}>{c.monetaryAmount}</span>
              )}
              {/* 043e: Jewels の combo（連続ギフト）回数。金額の隣に「×3」として出す。
                  目的は装飾ではなく**観測**で、フェーズ2（jewels_amount が単価か累計かの判別）を実機で行うために
                  combo 値と金額の変化を同時に目視できるようにする。単発は mapper が undefined へ落とすので出ない。
                  オーバーレイ（renderOverlayItem）には**出さない**＝配信画面に出す情報を増やさない。 */}
              {c.comboCount != null && (
                <span className={styles.tipChip}>×{c.comboCount}</span>
              )}
            </div>
            {/* 金額を持たない課金イベントは組み立て文言を主表示。自由コメントがあれば下段に本文を続ける。
                【レビュー対応・修正不要】ヘッダの種別チップと本文言が併存し軽い重複に見えるが、チップ＝分類・
                文言＝月数/件数など内訳付きの説明で役割が異なるため意図的に両方出す。 */}
            {(eventMessage || c.text) && (
              <div className={styles.tipBody}>
                {eventMessage && (
                  <p className={styles.eventMessage}>{eventMessage}</p>
                )}
                {c.text && <p className={styles.text}>{c.text}</p>}
              </div>
            )}
          </>
        ) : (
          /* chat（と未知種別）の行。047b で課金分岐と JSX を分けた結果、この分岐は旧統合パスにあった
             typeLabel / monetaryAmount / comboCount / eventMessage の描画を**持たない**。
             【レビュー Q-4・修正不要】既知の種別ではすべて空になるので無害（composeEventMessage が非 null を
             返すのは subscription/membership/gift＝全て課金・comboCount は jewels 専用・EVENT_LABEL に chat キー無し）。
             唯一効くのは「上流に新しい課金種別が増えたのに MONETARY_EVENT_TYPES への追加を忘れた」場合で、
             従来は金額だけ .amount で出ていたのがここでは出ない。フォールバックを足さないのは、その状態では
             ティッカー・固定帯・OBS カードも同時に効かない＝**追加漏れというバグを一覧だけが隠してしまう**ため
             （金額が出ると「動いている」ように見えて発見が遅れる）。正しい直し方は常に MONETARY_EVENT_TYPES への追加。
             再修正トリガー: 課金種別の追加が頻繁になり、追加漏れの検知を型（union）側で担保できるようになったとき。 */
          <>
            <div className={styles.meta}>
              <span className={`${styles.badge} ${SOURCE_CLASS[c.source]}`}>
                {SOURCE_LABEL[c.source]}
              </span>
              {judgementBadge}
              <span className={styles.author}>{c.author.name}</span>
            </div>
            {c.text && <p className={styles.text}>{c.text}</p>}
          </>
        )}
      </li>
    );
  };

  // 034e: OBS オーバーレイ用チャット意匠（LINE 風）。上段＝名前＋サイト名ピルバッジ（別の行）／下段＝アイコン｜吹き出し
  // （同じ行の 2 列）。吹き出し左辺のしっぽがアイコン方向へ向く。showSource=true のときだけサイト名ピルを名前の横に
  // 添える（受信済み source の表示のみ・新規取得はしない）。
  //
  // 060a: ユーザーが持ち込むカスタム CSS が狙える的として、**ハッシュ化されない安定クラス（`sd-*`）と
  // data 属性**を CSS Modules のクラスに**併記**する。意匠は 1px も変えない（クラスと属性が増えるだけ）。
  //   ⚠ **chat と課金で「同じ役割」には同じ安定クラスを当てる**（`text` と `cardText` はどちらも
  //   `sd-comment-text`／`bubble` と `cardBody` はどちらも `sd-comment-body`）。ユーザーは「本文の色を
  //   変えたい」としか思っておらず、StreamDock 内部の分岐を知らない。**既存の CSS Modules クラス名を
  //   そのまま sd- にした写像にはしないこと。**
  //   ⚠ この関数は **`PinnedOverlayApp`（固定コメント窓）とも共有**なので、ここで足したクラス・属性は
  //   あちらの DOM にも出る。それでよい（060d の注入先は `comment-overlay` のみで、固定窓に降りる CSS は
  //   無い＝クラスは付くだけの無害な文字列。将来 046d のように広げるとき DOM 側は用意済みになる）。
  //   窓の区別が要るときは `OverlayApp` のルートにだけ付く `sd-overlay` を使う。
  //   契約の正は docs/tasks/060a-overlay-selector-contract.md。変換表は `features/comment-viewer/cssCompat.ts`。
  //
  // ⚠⚠⚠ 060f 追修正④(2026-08-08・本人決定): **安定クラスと `data-sd-*` は chat にだけ付ける。**
  //   **課金カード（投げ銭カード）にはどちらも 1 つも付けない**＝ユーザー CSS の的にしない。
  //   理由と受容したトレードオフは下の課金カード分岐のコメントに書いてある（要点は「配布テーマは
  //   課金カードを**名指しで消しにくる**ので、目印クラスによる限定では原理的に防げない」）。
  //   ⚠ 静的ガード **(10-o)** が「課金分岐に `sd-comment*` / `data-sd-*` が無いこと」を機械で固定している。
  //   ⚠ したがって **`.sd-comment` は chat 専用**になった（従来は chat / 課金 共通の `<li>`）。
  //
  // 060f: 実サンプルを通して分かった**構造的なズレ 3 つ**を DOM 側から埋める（契約の拡張は 060f が正）。
  //   ① ⚠⚠ **`sd-comment-chat` は chat の `<li>` にだけ付ける。** 変換表は YouTube の
  //      `yt-live-chat-text-message-renderer`（＝テキストコメント**専用**レンダラ）をここへ向けている。
  //      従来は `.sd-comment`（chat と課金の**両方**に付く）へ向けていたため、**chat 用に書かれた
  //      テーマが課金カードの意匠を壊していた**。⚠ 追修正④で課金カードから安定クラスが消えたので
  //      `.sd-comment` と `.sd-comment-chat` は**実質同義**になったが、変換表の `to` が
  //      `.sd-comment-chat` を指しているため両方残してある（統合は別タスク）。
  //      ⚠ **なぜ属性（`.sd-comment[data-sd-event="chat"]`）ではなくクラスなのか**（060f ④）:
  //        (a) **詳細度**——属性形にすると変換先が `(0,2,0)`、子孫を足すと `(0,3,0)` まで上がり、
  //            既定意匠（CSS Modules の単一クラス＝`(0,1,0)`）との差が開きすぎる。
  //        (b) **静的ガード (10-b)** は変換表の `to` から `\.([A-Za-z0-9_-]+)` でクラストークンを抜いて
  //            契約と突き合わせる。属性形は 1 トークンも抜けず、**変換先の打ち間違いを機械で検出できなくなる**。
  //        (c) **可読性**——ユーザーが書くのは `.sd-comment-chat{…}`。`sd-comment-tip` と対の語彙に揃う。
  //   ② ⚠⚠ **chat の吹き出しは `<p>` 1 枚**（中間の `<div class="bubble">` を廃した）。YouTube 側に
  //      `.sd-comment-body` に相当する要素が無く、取り込んだ CSS は `#message`（→ `.sd-comment-text`）に
  //      吹き出しとしっぽを描くため、器が 2 段あると**吹き出しの内側にもう 1 個吹き出しが描かれる**。
  //      ⚠ **`sd-comment-body` はこの `<p>` に残す**——契約「chat と課金で同じ役割には同じ安定クラス」を
  //      保つため（`.sd-comment-body` の意味は「吹き出し／カード本体」のままで、chat ではそれが `<p>` になった）。
  //      ⚠⚠ **意匠クラスは `bubble` と `text` を両方併記する**（統合した 1 つの規則に書き直さない）。
  //      2 つの規則に**重複プロパティが 1 つも無い**ことを実測しており、併記なら `.bubble` / `.text` の
  //      宣言を 1 つも触らずに済む（`check-css-guards.mjs` の (10-e) も現行のまま緑）。
  //      ⚠⚠ **「`OverlayComment.module.css` を非コメント差分ゼロに保てる」はもう成立しない**
  //      （レビュー指摘 Q-4 で訂正・2026-08-08）。060f 追修正①のグリッド化で手放しており、
  //      代替の担保は **(10-n)（レイアウト器の宣言インベントリ）** ＋ 実機の A/B スクショ
  //      （⚠ **chat と課金カードの両方**——`.icon` を共有しているので chat だけ見ても回帰が出ない）。
  //      ⚠ 課金カードは触らない（`cardBody` はヘッダ帯＋ボディの 2 段構造に必要）。
  //   ③ 器に安定クラスが無かったので `sd-comment-header` / `sd-comment-row` / `sd-comment-list` を足した
  //      （YouTube の `yt-live-chat-item-list-renderer #items` の対応先）。
  //      ⚠⚠ **`sd-comment-list` は `variant === "overlay"` のときだけ**（`<ol>` は本体コメビュと共有）。
  //      ⚠⚠ 060c 追修正(2026-08-09): **`sd-comment-header` を狙う変換表エントリ（`div#author-info`）は
  //        削除した**——YouTube の `#author-info` は課金カードのヘッダで、テキストコメントには無いため
  //        （実機で「空の 16px の帯」が全コメントに出た。詳細は `cssCompat.ts` の当該コメント）。
  //        安定クラス `sd-comment-header` 自体は契約として残す（ユーザーは直接書ける）。
  //      ⚠⚠ 060c 追修正: **`sd-comment-list` はスクロール容器ではない**（外側の `.scroller` が持つ）。
  //        1 層だった頃はテーマの `#items{overflow:hidden!important}` がここに当たって
  //        **スクロール機能ごと死んでいた**（`CommentViewerApp.module.css` の `.scroller` のコメントが正）。
  //      ⚠ 060f 追修正(2026-08-08): **`sd-comment-row` の意味は「吹き出しの行」に変わった**
  //        （アイコンが `<li>` 直下へ移ったので、この中には吹き出ししか無い）。契約としては残す。
  //
  // 060f 追修正（security-review Q-1・2026-08-06）: ⚠⚠⚠ **`sd-comment-in-chat` の契約。**
  //   **規則は 1 文**——「**chat の `<li>` 自身は `sd-comment-chat`、その中の要素はすべて
  //   `sd-comment-in-chat` を持つ**」。例外を作らないこと（後述の理由で、
  //   「まだ変換表が使っていないから付けない」は将来の当たらないセレクタになる）。
  //   ⚠ 060f 追修正④で**対になっていた `sd-comment-in-tip` は廃止した**（課金カードには安定クラスを
  //   付けなくなったため）。⚠ 目印が chat 側だけになったぶん `-in-chat` は冗長に見えるが、変換表の `to`
  //   （`.sd-comment-text.sd-comment-in-chat` 等）が依存しているので**残す**。整理は別タスク。
  //
  //   ⚠⚠ **なぜ「子孫セレクタ」ではなく「同一要素の目印」なのか。** 変換表の `to` を
  //   `.sd-comment-chat .sd-comment-text` のような**子孫セレクタ**にしていたところ、
  //   ユーザー CSS が `親 子孫` / `span.クラス` の形で書かれていると**前置が二重に積まれて
  //   永久に当たらなくなる**ことが実測された（`.chat-line__message .chat-line__message-body` →
  //   `.sd-comment-chat .sd-comment-chat .sd-comment-text` ＝ `<li>` の中に `<li>` が要る）。
  //   しかも `rewritten` は加算され `unmatched` は空なので、060d の UI が「M 個変換しました」と**誤報する**。
  //   → `to` を「**1 要素の複合セレクタ**」（`.sd-comment-text.sd-comment-in-chat`）に限れば
  //   合成しても構造が保存される。**それを機械で守るのが静的ガード (10-l)**（`to` に結合子を禁じる）。
  //
  //   ⚠ **`sd-comment-chat` の意味は変えていない**（＝ chat の `<li>` だけ）。ユーザーが
  //   `.sd-comment-chat{background:red}` と書いたら `<li>` だけが塗られる——`sd-comment-tip` と対称で、
  //   ユーザーが最初に触る語彙をここで崩さないため。目印を別クラスに分けたのはそのため（2026-08-06 決定）。
  //   ⚠ 目印を `sd-comment-` 接頭辞にしているのも意図で、「`variant="default"` には安定クラスが
  //   1 つも付かない」を固定する既存テストが `[class*="sd-comment"]` で拾う＝**漏れが自動で検出される**。
  const renderOverlayItem = (c: CommentViewDto) => {
    // 036a: 描画シンクで「webview が踏むのは data URI のみ」（親 036・§CSP の不変条件）を強制する。avatar を
    // background-image に差すのは値が data: 始まりのときだけとし、それ以外（036b にバグで raw URL が漏れた等）は
    // 画像化せずイニシャルにフォールバックさせて外部 URL を踏ませない。data: 始まりでも整形済み base64 data URI か
    // 否かの検証は egress 集約点＝converter（036b）の責務で、ここは最終防波堤の型ガードに徹する。
    // 047b: ガード本体は `viewerFormat.ts` の `avatarDataUri` へ移設した（本体側のティッカー/課金カードも
    // 同じガードを必要とするため。**2 実装に分裂させると片方だけ緩んで外部 URL を踏む経路が生まれる**）。
    const avatar = avatarDataUri(c.author.avatar);
    // 036a のガードを両分岐（chat 吹き出し／043c 投げ銭カード）で共有する 1 枚のアイコン要素。
    //
    // ⚠⚠ 060f 追修正④(2026-08-08): **付与する安定クラスを引数で受け取る**（要素そのものを共有しない）。
    // アイコンは chat と課金の両方に出るので、素の共有要素にすると chat 向けの安定クラスが
    // **課金カードのアイコンにも付いて**しまう。⚠ **課金側は空文字**＝安定クラスを 1 つも付けない
    // （下の「課金カードはユーザー CSS の的にしない」を参照）。
    // ⚠ **036a のガード（`avatarDataUri` を通した data URI のときだけ background-image）は 1 実装のまま**
    // ——ここを 2 か所へ複製すると片方だけ緩んで外部 URL を踏む経路が生まれる。
    const renderIcon = (stable: string) => (
      <div
        className={stable ? `${overlayStyles.icon} ${stable}` : overlayStyles.icon}
        style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}
        aria-hidden="true"
      >
        {!avatar && (
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
        // 060a: chat には `data-sd-tone` を**付けない**。`monetaryTone()` は chat を "t0" へ無害劣化
        // させる（viewerFormat.ts の docstring）ので、付けると `[data-sd-tone="t0"]` で「最低額スパチャ
        // だけ光らせる」と書いたユーザーの CSS が**全部の chat にも当たる**。
        // ⚠ 060f 追修正④(2026-08-08): 課金カード側は `data-sd-*` も安定クラスも持たなくなったので、
        //   **ユーザー CSS から見えるコメントは chat だけ**＝ chat / 課金の区別を CSS で書く必要自体が消えた。
        //   ここに `data-sd-source` / `data-sd-event` を残すのは「配信元・種別で chat を出し分けたい」
        //   という 060a の用途がそのまま生きているため（課金カードとの区別のためではない）。
        <li
          key={c.id}
          className={`${overlayStyles.item} sd-comment sd-comment-chat`}
          data-sd-source={c.source}
          data-sd-event={dtype}
        >
          {/* 060f 追修正(2026-08-08): ⚠⚠ **アイコンは `.row` の中ではなく `<li>` の直下**（グリッド 1 列目）。
              テーマが `.sd-comment-icon{display:none}` でアイコンを消したとき、`.row` の中に居ると
              **名前行だけ 72px のインデントが残っていた**（`.header` がハードコードの margin を持っていたため）。
              ⚠ CSS では「兄弟が display:none か」を検出できないので、インデントを**アイコンの実体**
              （グリッドの 1 列目）から作る形に変えた＝消えれば列ごと畳まれる。
              ⚠ 行の割り当ては CSS 側（`.icon` が grid-row:2）。**DOM の順番は見た目に影響しない**が、
              読み上げ順が「アイコン→名前→本文」になるよう先頭に置いてある（アイコンは aria-hidden）。 */}
          {renderIcon("sd-comment-icon sd-comment-in-chat")}
          <div
            className={`${overlayStyles.header} sd-comment-header sd-comment-in-chat`}
          >
            <span
              className={`${overlayStyles.name} sd-comment-name sd-comment-in-chat`}
            >
              {c.author.name}
            </span>
            {showSource && (
              <span
                className={`${overlayStyles.source} ${OVERLAY_SOURCE_CLASS[c.source]} sd-comment-source sd-comment-in-chat`}
              >
                {SOURCE_LABEL[c.source]}
              </span>
            )}
          </div>
          <div
            className={`${overlayStyles.row} sd-comment-row sd-comment-in-chat`}
          >
            {/* 060f ②: 吹き出しの器と本文を 1 枚の <p> に畳む。`bubble`（箱＝背景/枠/角丸/影/しっぽの基準）と
                `text`（文字＝サイズ/行間/色/margin:0）は**重複プロパティが無い**ので、併記して同じ要素へ当てる。
                ⚠ `<p>` の UA 既定 margin は `.text` の `margin: 0` が従来どおり打ち消す（要素は元から `<p>`）。
                ⚠ しっぽ（`.bubble::before` / `::after`）の基準要素がこの `<p>` になるが、`position: relative` と
                絶対配置の値は自分自身のパディングボックス基準なので位置は動かない。
                ⚠ **子にブロック要素を入れないこと**（`<p>` は段落なので `<div>` / `<p>` を子に持てない＝
                将来スタンプ・絵文字・リンクを差すときは `<span>` に限る。器の div が無くなったぶん、
                ここで `<div>` を足すと HTML として不正になる）。 */}
            <p
              className={`${overlayStyles.bubble} ${overlayStyles.text} sd-comment-body sd-comment-text sd-comment-in-chat`}
            >
              {c.text}
            </p>
          </div>
        </li>
      );
    }

    // 043c: 投げ銭カード。superchat（実通貨）は金額ティアで色分け、それ以外の課金種別は種別ごとの単色。
    //   金額換算はせず superchatTier が通貨コードで閾値表を引くだけ（038 のスコープ外）。金額欠落の superchat は t0 の保険。
    //   【レビュー対応・修正不要】donation/jewels は実金銭だが意図的に種別単色（ティアは YT 同様スパチャ専用）。
    //   金額は amountBadge に verbatim 表示されるため見逃さない。再修正トリガー: これらもティア配色したくなったら
    //   `monetaryTone` の分岐条件を拡げる（本体側の一覧カード/ティッカーにも同時に効く）。
    const tone = monetaryTone(c);
    const cardClass = OVERLAY_TONE_CLASS[tone];
    // 金額を持たない種別（サブスク/メンシプ/ギフト）は「〇〇さんが…しました」の要約をボディ主表示にする（本体 043b と同じ）。
    const eventMessage = composeEventMessage(c);
    return (
      // ⚠⚠⚠ 060f 追修正④(2026-08-08・本人決定): **課金カードはユーザー CSS の的にしない。**
      //   この `<li>` と配下には**安定クラス（`sd-comment*`）も `data-sd-*` 属性も 1 つも付けない**。
      //   静的ガード **(10-o)** がこれを機械で固定している。
      //
      //   ⚠⚠ **なぜ「限定」ではなく「切り離し」なのか**（060f は 3 巡ぶん「限定」で解こうとして失敗した）:
      //   OBS 用に配られている純正チャットのテーマは、**課金カードを名指しで消しにくる**のが定番である。
      //     /* スーパーチャット非表示 */
      //     yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer { display: none !important }
      //     .yt-live-chat-membership-item-renderer { display: none !important }
      //   純正チャットではスパチャが**ティッカー（上部の帯）にも出る**ので「二重に出るからインライン側を消す」
      //   という意図だが、StreamDock にティッカーは無いので**この意図は成立せず、課金カードが丸ごと消える**
      //   （2026-08-08 実機で発生）。⚠ **`sd-comment-in-tip` のような目印を足す方向では絶対に防げない**
      //   ——テーマが狙っているのは「課金カードそのもの」だからである。
      //
      //   ⚠ **受容したトレードオフ**: 060a が公開していた
      //   `.sd-comment[data-sd-tone="t6"] .sd-comment-body { … }`（ティア別に課金カードを飾る）は**できなくなる**。
      //   本人決定「スパチャのデザインは常に同じで、配信窓に必ず出る」の直接の帰結。
      //   ⚠ **`.sd-comment` の意味も変わった**（「コメント 1 件（chat / 課金 共通）」→「**chat のコメント 1 件**」）。
      //   契約の正は docs/tasks/060a・060f と progress.md の 060f 節。
      //
      //   ⚠ 意匠クラス（`.item` / `.card` / `.tierN`）は CSS モジュールのハッシュ名なので、
      //   ユーザー CSS からは**名指しできない**（＝ここに残っていても的にはならない）。
      <li
        key={c.id}
        className={`${overlayStyles.item} ${overlayStyles.card} ${cardClass}`}
      >
        <div className={overlayStyles.cardHeader}>
          {renderIcon("")}
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
  //
  // 060f ③: 一覧の器にも安定クラスを出す（YouTube の `yt-live-chat-item-list-renderer #items` の対応先）。
  // ⚠⚠ **`variant === "overlay"` のときだけ**付けること。この `<ol>` の CSS モジュールは
  // `CommentViewerApp.module.css`＝**本体コメビュと共有**で、060a が置いた不変条件
  // 「`variant="default"` には安定クラスも data 属性も 1 つも付かない」（`CommentList.test.tsx` が固定）を
  // 破ってしまう。⚠ overlay 側は固定コメント窓（`PinnedOverlayApp`）とも共有なのでそちらにも出るが、
  // あの窓には注入経路が無いので**付くだけの無害な文字列**（`sd-overlay` が付かないことで窓を区別する）。
  const list = (
    // ⚠⚠ 060c 追修正(2026-08-09): **スクロールするのはこの `<div>`、`sd-comment-list` が付くのは中の `<ol>`。**
    // 1 層だった頃はテーマの `#items{overflow:hidden!important}` が `<ol>` に当たって
    // **スクロール機能ごと死んでいた**（理由と YouTube 側の 2 層構造は `.scroller` の CSS コメントが正）。
    // ⚠ `<div>` は `<ol>` の**外側**に置くこと——内側に入れると `<ol>` の子が `<li>` でなくなり、
    //   リストの意味論（role="list" / "listitem"）が壊れる。
    // ⚠ `data-comment-scroll` は**意匠 CSS からこの要素を名指しするための目印**で、
    //   `sd-*` を付けていないのは**ユーザー CSS 契約ではない**ことを名前で示すため
    //   （安定クラスにすると「スクロールを止められる」穴が別の名前で開き直る）。
    //   ⚠ `variant === "overlay"` のときだけ付ける＝ 060a の不変条件
    //   「`variant="default"` には安定クラスも data 属性も 1 つも付かない」を守る。
    <div
      className={styles.scroller}
      data-comment-scroll={variant === "overlay" ? "" : undefined}
      ref={scrollRef}
      onScroll={follow.onScroll}
    >
      <ol
        className={
          variant === "overlay" ? `${styles.list} sd-comment-list` : styles.list
        }
      >
        {comments.length === 0 ? (
          <li className={styles.empty}>コメントはまだありません</li>
        ) : (
          comments.map(
            variant === "overlay" ? renderOverlayItem : renderDefaultItem,
          )
        )}
      </ol>
    </div>
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
