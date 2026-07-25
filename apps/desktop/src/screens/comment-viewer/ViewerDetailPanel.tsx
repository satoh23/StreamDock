import { useEffect, useState } from "react";
import {
  getViewer,
  updateViewerNote,
  deleteViewer,
} from "../../features/viewer-memory/viewerMemoryApi";
import type { ViewerDetail } from "../../features/viewer-memory/types";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  providerLabel,
  eventLabel,
  fmtDateTime,
  fmtNumber,
  fmtSuperchat,
  commentAmount,
} from "./viewerFormat";
import styles from "./CommentViewerApp.module.css";

/**
 * 038b フォローアップ: 視聴者「詳細」（集計・配信者メモ・過去コメント・個別削除）を描く再利用コンポーネント。
 * ViewersView の詳細ブロックを切り出し、(a) 一覧からの詳細（← 戻る）と (b) コメビュ本体の流れるコメントを
 * クリックして横に出すサイドパネル（× 閉じる）の両方から使えるようにしたもの。表示専用の流儀は不変＝操作は
 * 038a ラッパ（invoke）のみ・WS/TTS/sidecar は持たない・端末外送信なし・失敗時は固定安全文言のみ（§9）。
 */

/** 配信元バッジの色分けクラス（styles 依存のため UI 側に持つ）。 */
const PROVIDER_CLASS: Record<string, string> = {
  twitch: styles.srcTwitch,
  youtube: styles.srcYoutube,
};
const providerClass = (p: string): string => PROVIDER_CLASS[p] ?? "";

interface ViewerDetailPanelProps {
  /** 表示する視聴者の安定キー（provider:providerUserId）。 */
  id: string;
  /** 閉じる/戻る操作。 */
  onDismiss: () => void;
  /** 戻る導線の種類。"back"＝一覧へ戻る（←）／"close"＝サイドパネルを閉じる（×）。既定 "back"。 */
  dismissKind?: "back" | "close";
  /** 削除成功時に親へ通知（親が選択解除・一覧再取得などを行う）。 */
  onDeleted?: (id: string) => void;
}

export function ViewerDetailPanel({
  id,
  onDismiss,
  dismissKind = "back",
  onDeleted,
}: ViewerDetailPanelProps) {
  const [detail, setDetail] = useState<ViewerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 詳細取得（id 変更時）。取得中に別 id へ切り替わったら結果を捨てる（cancelled ガード）。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setNoteSaved(false);
    getViewer(id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setNote(d.viewer.note);
      })
      .catch(() => {
        // NotFound（まだ記録の無い視聴者）を含む取得失敗。§9: エラー本文は出さず固定の安全文言のみ。
        // コメント受信直後は best-effort 記録がまだ DB に無いことがあるため、その旨を案内する。
        if (!cancelled) {
          setError(
            "この視聴者の記録が見つかりませんでした。コメントを受信した直後は、少し待ってから開き直すと表示されます。",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const v = detail?.viewer;

  const saveNote = async () => {
    setNoteSaving(true);
    setError(null);
    setNoteSaved(false);
    try {
      const updated = await updateViewerNote(id, note);
      setDetail((cur) => (cur ? { ...cur, viewer: updated } : cur));
      setNote(updated.note);
      setNoteSaved(true);
    } catch {
      setError("メモの保存に失敗しました。");
    } finally {
      setNoteSaving(false);
    }
  };

  // 個別削除。必ず ConfirmDialog を経由（pendingDelete）してから実行する。成功後は親へ通知して閉じる。
  const runDelete = async () => {
    setDeleting(true);
    try {
      await deleteViewer(id);
      setDeleting(false);
      setPendingDelete(false);
      onDeleted?.(id);
    } catch {
      setDeleting(false);
      setPendingDelete(false);
      setError("削除に失敗しました。");
    }
  };

  const isClose = dismissKind === "close";

  return (
    <div className={styles.settingsView}>
      <div className={`${styles.settingsHeader} ${styles.stickyHeader}`}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onDismiss}
          title={isClose ? "閉じる" : "一覧へ戻る"}
          aria-label={isClose ? "閉じる" : "一覧へ戻る"}
        >
          {isClose ? "×" : "←"}
        </button>
        <h1 className={`${styles.settingsTitle} ${styles.viewerDetailName}`}>
          {v ? v.name : "視聴者"}
        </h1>
      </div>

      {loading && <p className={styles.status}>読み込み中…</p>}
      {error && <p className={styles.errorText}>{error}</p>}

      {v && detail && (
        <>
          <div className={styles.card}>
            <div className={styles.cardHead}>集計</div>
            <div className={styles.cardBody}>
              <div className={styles.statGrid}>
                <span className={styles.statLabel}>サイト</span>
                <span className={styles.statValue}>
                  <span className={`${styles.badge} ${providerClass(v.provider)}`}>
                    {providerLabel(v.provider)}
                  </span>
                </span>
                <span className={styles.statLabel}>総コメント数</span>
                <span className={styles.statValue}>
                  {fmtNumber(v.totalComments)}
                </span>
                <span className={styles.statLabel}>bits</span>
                <span className={styles.statValue}>
                  {fmtNumber(v.bitsCount)} 回 / {fmtNumber(v.bitsAmount)}
                </span>
                <span className={styles.statLabel}>スーパーチャット</span>
                <span className={styles.statValue}>
                  {fmtNumber(v.superchatCount)} 回 /{" "}
                  {fmtSuperchat(v.superchatAmount, v.superchatCurrency)}
                </span>
                <span className={styles.statLabel}>サブスク/メンシプ</span>
                <span className={styles.statValue}>
                  {v.isMember ? "メンバー" : "非メンバー"} /{" "}
                  {fmtNumber(v.subscriptionCount)} 回
                  {v.lastSubscriptionAt
                    ? ` / 最終 ${fmtDateTime(v.lastSubscriptionAt)}`
                    : ""}
                </span>
                <span className={styles.statLabel}>初回コメント</span>
                <span className={styles.statValue}>
                  {fmtDateTime(v.firstSeenAt)}
                </span>
                <span className={styles.statLabel}>最終コメント</span>
                <span className={styles.statValue}>
                  {fmtDateTime(v.lastCommentAt)}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>配信者メモ</div>
            <div className={styles.cardBody}>
              <textarea
                className={styles.memoArea}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteSaved(false);
                }}
                placeholder="この視聴者についてのメモ（端末内にのみ保存されます）"
                rows={3}
              />
              <div className={styles.memoActions}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => void saveNote()}
                  disabled={noteSaving || note === v.note}
                >
                  {noteSaving ? "保存中…" : "保存"}
                </button>
                {noteSaved && <span className={styles.status}>保存しました</span>}
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>
              過去のコメント（{fmtNumber(detail.comments.length)} 件）
            </div>
            <div className={styles.cardBody}>
              {detail.comments.length === 0 ? (
                <p className={styles.status}>保存されたコメントはありません。</p>
              ) : (
                <ul className={styles.pastList}>
                  {detail.comments.map((c) => {
                    const amount = commentAmount(c);
                    const event = eventLabel(c.eventType);
                    return (
                      <li key={c.id} className={styles.item}>
                        <div className={styles.meta}>
                          <span
                            className={`${styles.badge} ${providerClass(c.source)}`}
                          >
                            {providerLabel(c.source)}
                          </span>
                          {event && <span className={styles.author}>{event}</span>}
                          <span className={styles.pastTime}>
                            {fmtDateTime(c.publishedAt)}
                          </span>
                          {amount && <span className={styles.amount}>{amount}</span>}
                        </div>
                        {c.text && <p className={styles.text}>{c.text}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>情報の削除</div>
            <div className={styles.cardBody}>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => setPendingDelete(true)}
              >
                この視聴者の情報を削除する
              </button>
              <p className={styles.note}>
                この視聴者の情報（保存済みコメント含む）を端末から削除します。取り消せません。
              </p>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete}
        title="視聴者の情報を削除"
        message={
          v
            ? `「${v.name}」の情報（保存済みコメント含む）を削除します。取り消せません。`
            : ""
        }
        confirmLabel="削除"
        danger
        busy={deleting}
        onConfirm={() => void runDelete()}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
