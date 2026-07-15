import { useRef, useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import styles from "./CommentViewerApp.module.css";

/**
 * 032c-a: 内蔵コメントビューア（別ウィンドウ label `comment-viewer`）の描画本体。
 *
 * 本タスクは枠組みのみで、**frontend 専用モック `CommentViewDto`** を最小描画する
 * （append ＋ id 重複排除 ＋ 上限クランプ）。実データ取得（Twitch/YouTube・Node sidecar・WebSocket）・
 * VOICEVOX 読み上げ・Web Audio は 032c-b/-c/-d で配線する。ネイティブタイトルバー（capability は
 * `core:default` のみ）で動くため、メイン画面のカスタム Header は再利用しない。
 */

/** 表示上限（超過分は古い方から捨てる＝末尾 MAX 件を保持）。 */
const MAX_COMMENTS = 200;

/** 初期表示のモック（Twitch/YouTube・通常/投げ銭を混在）。 */
const SEED_COMMENTS: CommentViewDto[] = [
  {
    id: "seed-1",
    source: "youtube",
    author: { id: "u-aoi", name: "あおいそら" },
    text: "配信お疲れさまです！今日も楽しみにしてました",
    publishedAt: "2026-07-15T12:00:00.000Z",
    eventType: "chat",
  },
  {
    id: "seed-2",
    source: "twitch",
    author: { id: "u-kuro", name: "くろねこ" },
    text: "この場面すごい",
    publishedAt: "2026-07-15T12:00:05.000Z",
    eventType: "chat",
  },
  {
    id: "seed-3",
    source: "youtube",
    author: { id: "u-momo", name: "ももか" },
    text: "スパチャで応援します！これからも頑張ってください",
    publishedAt: "2026-07-15T12:00:12.000Z",
    eventType: "superchat",
    monetaryAmount: "¥1,000",
  },
];

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

/**
 * 既存リストに incoming を追加する。id 重複は排除し、上限を超えたら古い方から捨てる。
 * 実データ配線（032c-b/-d）でも同じ「append ＋ 重複排除 ＋ クランプ」を使う想定。
 */
function mergeComments(
  prev: CommentViewDto[],
  incoming: CommentViewDto[],
): CommentViewDto[] {
  const seen = new Set(prev.map((c) => c.id));
  const merged = [...prev];
  for (const c of incoming) {
    if (seen.has(c.id)) continue; // id 重複排除
    seen.add(c.id);
    merged.push(c);
  }
  // 上限クランプ（新しい順に末尾 MAX 件を残す）。
  return merged.length > MAX_COMMENTS
    ? merged.slice(merged.length - MAX_COMMENTS)
    : merged;
}

/** モックコメントを 1 件生成する（連番 ID で安定・重複しない）。 */
function makeMock(seq: number): CommentViewDto {
  const source: CommentViewDto["source"] = seq % 2 === 0 ? "twitch" : "youtube";
  return {
    id: `mock-${seq}`,
    source,
    author: { id: `u-${seq}`, name: `視聴者${seq}` },
    text: `モックコメント #${seq}`,
    publishedAt: new Date().toISOString(),
    eventType: "chat",
  };
}

export function CommentViewerApp() {
  const [comments, setComments] = useState<CommentViewDto[]>(SEED_COMMENTS);
  // 連番の払い出しカウンタ（生成 ID を安定させ、重複を意図的に注入できるようにする）。
  const seqRef = useRef(1);

  const addMock = () => {
    const a = makeMock(seqRef.current++);
    const b = makeMock(seqRef.current++);
    // 既存の seed-1 を再投入して「重複排除」を実演する（追加されないのが正しい挙動）。
    const dup = SEED_COMMENTS[0];
    setComments((prev) => mergeComments(prev, [a, b, dup]));
  };

  const clearAll = () => setComments([]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>コメントビューア</h1>
        <span className={styles.count}>{comments.length} 件</span>
      </header>

      <div className={styles.toolbar}>
        <button type="button" className={styles.btn} onClick={addMock}>
          モックを追加
        </button>
        <button type="button" className={styles.btnGhost} onClick={clearAll}>
          クリア
        </button>
        <span className={styles.note}>
          モック表示（実データ取得・読み上げは今後のタスク）
        </span>
      </div>

      <ol className={styles.list}>
        {comments.length === 0 ? (
          <li className={styles.empty}>コメントはまだありません</li>
        ) : (
          comments.map((c) => (
            <li key={c.id} className={styles.item}>
              <div className={styles.meta}>
                <span className={`${styles.badge} ${SOURCE_CLASS[c.source]}`}>
                  {SOURCE_LABEL[c.source]}
                </span>
                <span className={styles.author}>{c.author.name}</span>
                {c.monetaryAmount && (
                  <span className={styles.amount}>{c.monetaryAmount}</span>
                )}
              </div>
              <p className={styles.text}>{c.text}</p>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}
