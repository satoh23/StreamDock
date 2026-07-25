/**
 * 038b: 視聴者ビューの純粋な表示整形ヘルパ（React/CSS/DOM 非依存）。
 *
 * ViewersView から「ロジックのある純関数」だけを切り出したもの。CSS モジュール（styles）に依存する
 * providerClass や、ViewerSort 型に紐づく SORT_LABEL は UI 側（ViewersView）に残し、この module は
 * 依存ゼロ＝プレーン Node から import して単体テストできる状態に保つ（scripts/test-viewer-format.mjs）。
 * 端末外へは何も出さない（表示整形のみ）。
 */

/** 配信元の表示ラベル（CommentList の SOURCE_LABEL と同型・provider 文字列のまま fallback）。 */
export const PROVIDER_LABEL: Record<string, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
};

/** 過去コメントの特別イベントだけ日本語ラベルを付ける（通常チャット等・未知の種別はラベル無しで無害に劣化）。 */
export const EVENT_LABEL: Record<string, string> = {
  superchat: "スーパーチャット",
  bits: "ビッツ",
  subscription: "サブスク",
  membership: "メンバーシップ",
};

/** 既知の provider は日本語表示名、未知はそのまま（fallback）。 */
export const providerLabel = (p: string): string => PROVIDER_LABEL[p] ?? p;

/** 既知のイベント種別だけラベル化、未知は空文字（ラベル無しで劣化）。 */
export const eventLabel = (eventType: string): string =>
  EVENT_LABEL[eventType] ?? "";

/** RFC3339 文字列をローカル表記へ。パースできなければ原文のまま返す（端末外へは出さないローカル表示）。 */
export const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP");
};

export const fmtNumber = (n: number): string => n.toLocaleString("ja-JP");

/** スパチャ額（f64）＋通貨。通貨が無ければ額のみ。 */
export const fmtSuperchat = (amount: number, currency?: string): string =>
  currency ? `${fmtNumber(amount)} ${currency}` : fmtNumber(amount);

/**
 * 過去コメント 1 件の投げ銭表示（整形済み文字列があれば優先、無ければ数値＋通貨、いずれも無ければ null）。
 * ViewerCommentRecord の構造部分集合を受ける（bindings 型に依存させず、この module を純粋に保つため）。
 *
 * 【レビュー：型安全のトレードオフ】全フィールドが optional なので、キー名が食い違うオブジェクトを渡しても
 * 型エラーにならず黙って null（＝金額バッジ非表示）に劣化する。現時点は ViewerCommentRecord の
 * `amount?/currency?/monetaryAmount?` と一致を確認済み。【再修正トリガー】bindings のキー名を変える改修が入ったら、
 * viewerFormat.test に「実 ViewerCommentRecord 型注釈付きのオブジェクト」を通すケースを 1 件足し、リネームを
 * コンパイルで検知できるようにする（viewerIdOf は呼び出し側が完全な DTO を渡すため名前不一致はコンパイルで捕まる）。
 */
export interface CommentAmountInput {
  monetaryAmount?: string;
  amount?: number;
  currency?: string;
}

export const commentAmount = (c: CommentAmountInput): string | null => {
  if (c.monetaryAmount) return c.monetaryAmount;
  if (c.amount != null) {
    return c.currency ? `${fmtNumber(c.amount)} ${c.currency}` : fmtNumber(c.amount);
  }
  return null;
};

/**
 * 038b フォローアップ: 流れているコメント（CommentViewDto の構造部分集合）から視聴者の安定キー
 * `provider:providerUserId` を導出する。Rust の record_comment（viewer_memory/service.rs）と同じ規則＝
 * source（"twitch"|"youtube"）と author.id を trim して連結する。これによりコメントをクリック→getViewer(id) で
 * 詳細を引ける。Rust 側 key と完全一致させるため **trim 必須**（bindings 型に依存させず構造部分集合を受ける）。
 */
export interface ViewerIdSource {
  source: string;
  author: { id: string };
}

export const viewerIdOf = (c: ViewerIdSource): string =>
  `${c.source}:${c.author.id.trim()}`;
