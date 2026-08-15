/**
 * 046a: 固定コメント（ピン留め）のピンストア。
 *
 * コメビュ本体（CommentViewerApp）が**唯一の書き手**で、046b の固定専用オーバーレイ窓（`pinned-overlay`）が
 * **読み手**になる。両窓は別 webview だが同一 Vite バンドル・同一 localStorage を共有するため、本体が
 * `savePinned` で書き、オーバーレイ窓が起動時 `loadPinned`＋`storage` イベント購読で受ける（`overlaySettings.ts` /
 * `OverlayApp.tsx` と同じ方式）。**新規 WS / Rust emit / 外部通信は増やさない**（親 046 の設計判断）。
 *
 * ttsPrefs.ts / channelStorage.ts / overlaySettings.ts と同方式（名前空間付き "stream-dock.*" キー・
 * localStorage 直 read/write・例外は握りつぶし）。保存するのは**非機密の表示データのみ**（本文・表示名・金額表示）で、
 * OAuth トークン等の機密は載せない。**Rust の DB/ログには出さず外部送信もしない**（docs/security.md §9）。
 */

import type { CommentEventType } from "./bindings/CommentEventType";
import type { CommentSource } from "./bindings/CommentSource";
import type { CommentViewDto } from "./types";

/** 固定コメントの保存キー（値は JSON 配列・既定は未保存＝空配列扱い）。 */
export const PINNED_COMMENTS_KEY = "stream-dock.comment-viewer.pinned-comments";

/**
 * 固定できる件数の上限。**046a では 1（単一ピン）**＝YouTube / Twitch のコメント固定と同じ体験にする、という
 * 依頼者の決定（親 046 の初期案「例 3」から変更・親 046 側の記述も更新済み）。
 *
 * 値をここ 1 箇所に閉じてあるので、将来複数ピンにしたくなったらこの定数を増やすだけで
 * ストア（クランプ）・本体のトグル・固定帯がそのまま追随する（保存形は N に依らず JSON 配列で不変＝
 * 046b の読み手契約を壊さない）。
 */
export const PINNED_LIMIT = 1;

/**
 * ピンストアに保存する 1 件。`CommentViewDto` から **`author.avatar` を除いた構造部分集合**（046b が読む契約）。
 *
 * avatar を落とす理由: 036b/036c 以降 avatar は base64 data URI（1 件で数十 KB）で、
 * ①localStorage が溢れると `savePinned` が QuotaExceededError で黙って失敗し「固定が復元しない」という
 * 原因の分かりにくい壊れ方をする ②`storage` イベントのペイロード（oldValue＋newValue）にも毎回載る
 * ③端末に残す表示データは最小限にする（§9 の精神・038a で「視聴者メモリに data URI を保存しない」と決めた前例に揃う）。
 * 046b は WS へ接続しない設計なので**アバターを再取得しない前提**で、アイコンは
 * `CommentList` の 036a フォールバック（頭文字の丸）になる。
 *
 * `CommentViewDto` ⇄ `PinnedComment` は avatar が optional なので双方向に構造的代入可＝
 * `viewerFormat.ts` のヘルパにも `CommentList` にもそのまま渡せる（型の壁を作らない）。
 */
export type PinnedComment = Omit<CommentViewDto, "author"> & {
  author: { id: string; name: string };
};

/**
 * 既知の `CommentSource` / `CommentEventType` の集合。`Record<Union, true>` で持つことで、
 * **bindings の union に値が増えたらコンパイルエラーになる**（キー不足が型エラー）＝
 * ts-rs 生成型と検証テーブルが黙って乖離しない。`in` 演算子は prototype のキー（"toString" 等）も拾うため、
 * 参照は必ず `=== true` で比較する。
 */
const SOURCES: Record<CommentSource, true> = {
  twitch: true,
  youtube: true,
};

const EVENT_TYPES: Record<CommentEventType, true> = {
  chat: true,
  superchat: true,
  membership: true,
  subscription: true,
  gift: true,
  donation: true,
  jewels: true,
  // 062a: レイド。⚠ **`PinnedComment` のスキーマに `raidViewerCount` は無い**ので、レイド行を固定すると
  //   ラベルは残るが**人数だけ落ちる**（既知の劣化）。足さないのは、保存項目の追加＝§9 追補 046a
  //   （固定コメントの localStorage 保存範囲）の変更にあたり、別途 security-review が要るため。
  //   再修正トリガー: 固定帯にレイド人数を出したくなったら、046a の追補としてスキーマ追加を起票する。
  raid: true,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 文字列ならそのまま、そうでなければ undefined（任意フィールドの型ガード）。 */
const asString = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** 有限数ならそのまま、そうでなければ undefined（NaN/Infinity も落とす）。 */
const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** `CommentMonetaryDto` 相当（amount:number / currency:string）だけを通す。片方でも欠けたら undefined。 */
const asMonetary = (v: unknown): { amount: number; currency: string } | undefined => {
  if (!isRecord(v)) return undefined;
  const amount = asNumber(v.amount);
  const currency = asString(v.currency);
  return amount != null && currency != null ? { amount, currency } : undefined;
};

/**
 * localStorage から読んだ未検証の値を `PinnedComment` へ検証する。**必須フィールドが揃わない要素は null**
 * （呼び出し側が丸ごと捨てる）、**任意フィールドは型が合わなければそのフィールドだけ落とす**（要素は生かす）。
 *
 * スキーマに version 欄は持たない。①046a が唯一の書き手で 046b は同一バンドルで同時に配られるため、
 * 版ズレが起きるのは「古い localStorage が残った新バイナリ」だけで、それはこの要素単位の検証で安全に劣化する
 * ②ラッパ `{v:1, items:[]}` にすると親 046 が明文化した「JSON 配列」から外れる
 * ③将来スキーマを壊す変更が必要になったら**キー名を変える**（`...pinned-comments-v2`）方が単純で、旧キーは自然に無視される。
 *
 * レビュー指摘（修正不要）: **未知の `eventType` を持つ要素は丸ごと捨てる**が、`eventLabel` / `isMonetaryEvent` /
 * `composeEventMessage` はいずれも未知種別を無害に劣化させるため「要素を生かす」選択も成立した。捨てる方を採ったのは、
 * `source` については捨てないと `SOURCE_CLASS[p.source]` が undefined クラスになり、上の `Record<Union, true>` による
 * コンパイル時 exhaustiveness と足並みが揃うため（両者を同じ扱いにして分岐を増やさない）。
 * 代償は前方互換が無いこと＝`CommentEventType` に値が増えた新バージョンで固定 → 旧バージョンへ戻すと固定が消える。
 * デスクトップアプリのダウングレードは稀で、消えても再固定すれば済むため許容する。
 * 再修正トリガー＝ダウングレード運用（複数バージョン併用・ロールバック配布）が現実の要件になったら、
 * eventType だけは未知でも要素を生かす（ラベルは空文字へ劣化）方へ倒す。
 */
const parsePinned = (raw: unknown): PinnedComment | null => {
  if (!isRecord(raw)) return null;

  const id = asString(raw.id);
  const source = asString(raw.source);
  const text = asString(raw.text);
  const publishedAt = asString(raw.publishedAt);
  const eventType = asString(raw.eventType);
  const author = isRecord(raw.author) ? raw.author : undefined;
  const authorId = author ? asString(author.id) : undefined;
  const authorName = author ? asString(author.name) : undefined;

  if (
    !id ||
    !source ||
    SOURCES[source as CommentSource] !== true ||
    text == null ||
    !publishedAt ||
    !eventType ||
    EVENT_TYPES[eventType as CommentEventType] !== true ||
    authorId == null ||
    authorName == null
  ) {
    return null;
  }

  return {
    id,
    source: source as CommentSource,
    author: { id: authorId, name: authorName },
    text,
    publishedAt,
    eventType: eventType as CommentEventType,
    monetaryAmount: asString(raw.monetaryAmount),
    monetary: asMonetary(raw.monetary),
    monthCount: asNumber(raw.monthCount),
    giftCount: asNumber(raw.giftCount),
    tier: asNumber(raw.tier),
    comboCount: asNumber(raw.comboCount),
  };
};

/**
 * 受信コメント（`CommentViewDto`）を保存用の `PinnedComment` へ落とす。**`author.avatar` を落とす唯一の場所**。
 * フィールドを明示列挙するので、DTO に機密性のあるフィールドが増えても黙って localStorage に載ることはない。
 * 値が undefined のキーは `JSON.stringify` が省くため、保存 JSON にも現れない。
 */
export const toPinned = (c: CommentViewDto): PinnedComment => ({
  id: c.id,
  source: c.source,
  author: { id: c.author.id, name: c.author.name },
  text: c.text,
  publishedAt: c.publishedAt,
  eventType: c.eventType,
  monetaryAmount: c.monetaryAmount,
  monetary: c.monetary,
  monthCount: c.monthCount,
  giftCount: c.giftCount,
  tier: c.tier,
  comboCount: c.comboCount,
});

/**
 * 保存済みの固定コメントを読み込む（先頭＝最新の固定）。未保存・不正 JSON・配列でない値・例外はすべて `[]` へ
 * フォールバックし、壊れた要素だけを落として残りは生かす。手で書き換えられた場合に備え `PINNED_LIMIT` でもクランプする。
 */
export function loadPinned(): PinnedComment[] {
  try {
    const raw = localStorage.getItem(PINNED_COMMENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: PinnedComment[] = [];
    for (const item of parsed) {
      const pinned = parsePinned(item);
      if (pinned) list.push(pinned);
    }
    return list.slice(0, PINNED_LIMIT);
  } catch {
    // 壊れた JSON・プライベートモード等で読めない場合は固定なしとして続行する（表示は継続できる）。
    return [];
  }
}

/**
 * 固定コメントを保存する（ローカルのみ・外部送信しない）。先頭＝最新として `PINNED_LIMIT` でクランプする。
 * 空配列でも `"[]"` を書く＝**固定解除を 046b へ伝えるため**（キーを削ると `storage` イベントの newValue が
 * null になり、読み手側で「未保存」と「解除」の区別が付かない）。
 *
 * レビュー指摘（修正不要）: 書込失敗（`QuotaExceededError`・プライベートモード等）を**黙って握りつぶす**ため、
 * ユーザーは失敗に気付かない（表面化するのは「窓を開き直すと固定が復元しない」という形）。`overlaySettings.ts` /
 * `channelStorage.ts` と同じ慣習に揃えたもので、保存するのは avatar 抜きの数 KB＝5MB 枠に対して現実的な
 * quota 超過はまず起きず、失敗しても本体の固定表示は React state 側で継続するため据え置く。
 * 再修正トリガー＝046b（固定専用オーバーレイ）実装後は「本体には出るのに OBS に出ない」という切り分けにくい
 * 壊れ方になるため、046b 側で不整合を検知したくなったら savePinned に失敗を返す口を足して UI へ通知する。
 */
export function savePinned(list: readonly PinnedComment[]): void {
  try {
    localStorage.setItem(
      PINNED_COMMENTS_KEY,
      JSON.stringify(list.slice(0, PINNED_LIMIT)),
    );
  } catch {
    // プライベートモード・容量超過等で書けない場合は黙って無視する（本体の固定表示は state 側で継続する）。
  }
}
