import { useEffect, useRef } from "react";
import type {
  CommentSource,
  CommentViewDto,
} from "../../features/comment-viewer/types";
import styles from "./CommentViewerApp.module.css";
// 061g: `ConfirmDialog` が `components/` へ出たので、流用している意匠もそちらへ移った。
// ⚠⚠ **このダイアログは `.confirmDialog` / `.confirmBody` / `.confirmTitle` / `.confirmActions` の
// 4 クラスを `ConfirmDialog` と共有している**（`.confirmMessage` だけがあちらの専有）。
// あちらの寸法を触るとこの画面も動くので、`components/ConfirmDialog.module.css` 先頭の注記も読むこと。
import confirmStyles from "../../components/ConfirmDialog.module.css";
import btnStyles from "../../components/compactButtons.module.css";
import { TONE_CLASS } from "./monetaryTone";
import {
  authorInitial,
  avatarDataUri,
  composeEventMessage,
  displayEventType,
  eventLabel,
  fmtDateTime,
  monetaryTone,
  providerLabel,
} from "./viewerFormat";

/**
 * 047: 課金ティッカーのピルをクリックしたときに全文を出す重ねダイアログ。
 *
 * ティッカーのピルは高さ 22px で「種別・名前・金額」しか入らないため、本文（`c.text`）や
 * サブスク継続月数などの要約文（`composeEventMessage`）はここで初めて読める。
 *
 * 実装は `ConfirmDialog` と**同じ idiom**＝ネイティブ `<dialog>` ＋ `showModal()`。
 * ①focus trap・Esc・backdrop・モーダル化が**新規依存ゼロ**で付く
 * ②`<dialog>` は top-layer に出るので z-index 競合が構造的に起きない（狭窓の `.detailPane`=5 /
 *   `.contextMenu`=20 という既存の重なり順に行を増やさない）
 * の 2 点による。全幅オーバーレイ（`.detailPane`）は「広窓は横並び・狭窓のみ absolute」という別要求の意匠で、
 * 「背景を止めて全文を読む」という本ダイアログの目的とは合わないため土台にしない。
 *
 * `ConfirmDialog` を props 拡張して流用しないのは confirm/cancel の意味論が違うため。**CSS は流用する**
 *（`.confirmDialog` / `.confirmBody` / `.confirmTitle` / `.confirmActions` / `.btnGhost`）。
 * ⚠ 061g 以降、この 5 クラスは `components/ConfirmDialog.module.css` と `components/compactButtons.module.css`
 * にある（`confirmStyles` / `btnStyles`）。`screens/` → `components/` は正しい向きの依存。
 * 文言整形は `viewerFormat.ts`、メタ行の意匠はコメント行（`.meta` / `.badge` / `.author` / `.amount` /
 * `.eventMessage` / `.text`）を流用する（重複実装しない＝こちらは `styles`＝この窓の CSS のまま）。
 *
 * 表示専用。開閉 state は呼び出し側（`MonetaryTicker`）が持つ。
 */

/** 配信元バッジの色分けクラス（`CommentList` / `PinnedCommentBar` の `SOURCE_CLASS` と同型）。 */
const SOURCE_CLASS: Record<CommentSource, string> = {
  twitch: styles.srcTwitch,
  youtube: styles.srcYoutube,
};

interface MonetaryDetailDialogProps {
  /** 表示中の課金コメント。**null で閉**（アンマウント）。 */
  comment: CommentViewDto | null;
  /** Esc / backdrop クリック / 「閉じる」ボタンのいずれでも呼ばれる。 */
  onClose: () => void;
}

export function MonetaryDetailDialog({
  comment,
  onClose,
}: MonetaryDetailDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = comment !== null;

  // 依存配列が [open] であることが重要。親は <MonetaryDetailDialog> を無条件レンダして comment だけを
  // 切り替えるため、下の early return は React 上のアンマウントではなくインスタンスが生存する。依存を []
  // にすると showModal が初回（＝閉じている状態）に一度評価されるだけで再実行されず、<dialog> は
  // showModal 未呼び出し＝display:none のまま永遠に開かない。閉じは open=false → early return で
  // DOM から外れ、ブラウザが自動で閉じる（close() の明示呼びは不要）。詳細は ConfirmDialog.tsx の同箇所。
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [open]);

  if (comment === null) return null;

  // 043b と同じ整形（重複実装しない）。ティッカーには課金種別しか入らないので typeLabel は通常必ず埋まるが、
  // 未知の種別が来ても eventLabel が空文字へ無害に劣化するため見出しにはフォールバックを置く。
  const typeLabel = eventLabel(displayEventType(comment));
  const eventMessage = composeEventMessage(comment);
  // 047b: ピルがティア色の塗りつぶしになったので、開いた先が無彩色だと繋がりが切れる。ピルと同じ tone を
  // ヘッダ帯に当てて「どのピルを開いたか」を色でも示す。
  const avatar = avatarDataUri(comment.author.avatar);

  return (
    <dialog
      ref={ref}
      // ⚠ 061g: **2 つの CSS モジュールのクラスを 1 要素に並べている**（枠＝components/ 側、
      // ティア色＝この窓の monetaryTone.ts 側）。成立する根拠は実測した次の 2 点:
      //   ① `.confirmDialog.toneT0` のような**複合セレクタが存在しない**
      //   ② tone クラスは `--tone-bg` / `--tone-fg` の**カスタムプロパティしか宣言していない**ので、
      //      `.confirmDialog` の padding / max-width / width / color / background / border / border-radius と
      //      **プロパティが 1 つも重ならない**＝モジュールの読み込み順（カスケード順）に依存しない
      // ⚠ どちらかが崩れたら（tone クラスに実プロパティを足す・複合セレクタを作る）この前提は消える。
      className={`${confirmStyles.confirmDialog} ${TONE_CLASS[monetaryTone(comment)]}`}
      // Esc（cancel イベント）はブラウザ既定の close を止め、state 経由で閉じる（open の不整合を防ぐ）。
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // backdrop クリック（target が dialog 要素自身）で閉じる。dialog は padding:0 で中身を .confirmBody に
      // 寄せてあるため、本文上のクリックは target がこの要素にならない。
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {/* 047b: ティア色ヘッダ帯（アイコン＋名前＋金額）。.confirmDialog は padding: 0 なので帯が
          ダイアログ幅いっぱいに出る（内側の余白は .confirmBody が持つ）。 */}
      <div className={styles.monetaryDialogHeader}>
        <span
          className={styles.tipAvatar}
          style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}
          aria-hidden="true"
        >
          {!avatar && authorInitial(comment.author.name)}
        </span>
        <span className={styles.monetaryDialogName}>{comment.author.name}</span>
        {comment.monetaryAmount && (
          <span className={styles.tipAmount}>{comment.monetaryAmount}</span>
        )}
      </div>
      <div className={confirmStyles.confirmBody}>
        <h2 className={confirmStyles.confirmTitle}>{typeLabel || "課金コメント"}</h2>
        <div className={styles.meta}>
          <span className={`${styles.badge} ${SOURCE_CLASS[comment.source]}`}>
            {providerLabel(comment.source)}
          </span>
        </div>
        {/* 金額を持たない課金種別（サブスク/メンシプ/ギフト）は継続月数・件数つきの要約文がここで初めて読める。 */}
        {eventMessage && (
          <p className={styles.eventMessage}>{eventMessage}</p>
        )}
        {/* 【レビュー Q-6・修正不要／実機確認事項】047 は `.confirmDialog`（max-width: 360px・**max-height 無し**）へ
            第三者の任意長テキストを流し込む初めての利用（`ConfirmDialog` はアプリが書いた短い固定文言のみ）。
            500 字級の bits メッセージは約 18 行＝440px 前後になり最小窓の 520px に迫るが、UA スタイルの
            `dialog { overflow: auto }` ＋ `dialog:modal { max-height: calc(100% - 6px - 2em) }` により
            内部スクロールへ穏当に劣化する見込み。ここで高さを足さないのは、`.confirmDialog` を直接触ると
            `ConfirmDialog` を巻き添えにするため。再修正トリガー＝実機（WKWebView / WebView2）でダイアログが
            窓からはみ出したら、`.monetaryDialog { max-height: 70vh }` ＋ 本文側 `overflow-y: auto` を**新設**して
            className に併記する（`.confirmDialog` は変えない）。 */}
        {comment.text && <p className={styles.text}>{comment.text}</p>}
        <p className={styles.monetaryDialogTime}>
          {fmtDateTime(comment.publishedAt)}
        </p>
        <div className={confirmStyles.confirmActions}>
          <button type="button" className={btnStyles.btnGhost} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}
