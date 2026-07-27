import type { CommentViewDto } from "./types";

/**
 * 033f: 受信コメントの蓄積ロジック（append ＋ id 重複排除 ＋ 上限クランプ）。032c-a 以来
 * `CommentViewerApp` 内 local だったものを、OBS 透過オーバーレイ（`OverlayApp`）と共有するため切り出した
 * 純関数。**本体コメントビューとオーバーレイで完全に同じ表示（同一の重複排除・クランプ）を保証**する。
 *
 * 043e: ここは**表示・TTS・保存の 3 系統がぶら下がる単一注入点**なので、戻り値の 3 バケットの役割を
 * 取り違えないこと:
 *   - `next`    … 表示用の全体リスト（クランプ後）。`CommentViewerApp` と `OverlayApp` の両方が使う。
 *   - `added`   … **`prev` に存在しない id**。TTS enqueue の単一注入点＝ここに載ったものだけが読み上げられる。
 *   - `updated` … **既存行の中身が変わったもの**（YouTube Jewels の combo 更新）。**絶対に TTS へ渡さない**。
 *                 視聴者メモリへの記録（`recordComments`）専用。
 *
 * 【レビュー指摘 Q-1・仕様として正しいので修正不要】`added` は「新規コメント」ではなく厳密には
 * 「**`prev` に無い id**」である。`MAX_COMMENTS` クランプで `next` から落ちた jewels 行に後から combo 更新が
 * 届くと、`prev` に無いため `updated` ではなく `added` に載り、`enqueueForSpeech` まで到達する
 * （記録側は Rust が `INSERT OR IGNORE` → 0 行 → jewels の UPDATE 経路に落ちるので正しく更新される）。
 * このとき再読み上げを防いでいるのは `added` の構造ではなく **`ttsQueue` の `seenIds`（同 id は no-op）**。
 * 発生条件は「jewels の初報と combo 更新の間に 200 件のコメントが流れる」で、combo 更新は数秒以内に届くため
 * 実運用では稀。行が既に表示から消えている以上「再出現＝新規行」の扱いが自然なので、挙動は変えない。
 * 再修正トリガー: `seenIds` に上限や期限を入れる／`MAX_COMMENTS` を大幅に下げる、のどちらかを行う場合は
 * 再読み上げが実際に起きるようになるため、`updated` 側へ寄せる設計（排除済み id の別管理）を検討する。
 */

/** 表示上限（超過分は古い方から捨てる＝末尾 MAX 件を保持）。 */
export const MAX_COMMENTS = 200;

/**
 * 043e: 同一 id の再送で「中身が変わった」と見なす比較キー。
 *
 * 比較するのは **Rust `record_comment` が既存行へ UPDATE する 4 列と同じもの**
 * （`text` / `monetaryAmount` / `monetary.amount` / `monetary.currency`）＋表示専用の `comboCount`。
 * 「**比較キー ⊇ Rust が書き込む列**」を不変条件にすることで、取りこぼし（更新が Rust へ届かない列がある）も
 * 空振り（同じ値で UPDATE を撃つ）も構造的に起きない。`publishedAt` / `author` / `source` は Rust が
 * **意図的に更新しない**（集計 first/last と 038c 判定の基準を動かさないため）ので比較にも含めない。
 *
 * 【レビュー指摘 Q-6・冗長ではないので修正不要】`monetaryAmount`（表示文字列）と `monetary.amount`（数値）を
 * 両方比較するのは重複に見えるが、Rust 側は `monetary_amount` と `amount`/`currency` を**独立した列として
 * SET する**ため、片方だけの比較では「比較キー ⊇ 更新列」が破れる（例: 数値は同じで表示フォーマットだけ
 * 変わった更新を取りこぼす）。どちらか一方に減らせるのは、Rust が対応する列を SET しなくなったときだけ。
 *
 * 再修正トリガー: repository.rs の UPDATE 対象列を増減したら、本関数の比較キーも必ず合わせること。
 */
const hasComboPayloadChanged = (
  prev: CommentViewDto,
  next: CommentViewDto,
): boolean =>
  prev.text !== next.text ||
  prev.monetaryAmount !== next.monetaryAmount ||
  prev.monetary?.amount !== next.monetary?.amount ||
  prev.monetary?.currency !== next.monetary?.currency ||
  prev.comboCount !== next.comboCount;

/**
 * 既存リストに incoming を追加する。id 重複は排除し、上限を超えたら古い方から捨てる。
 *
 * 戻り値の `next` は表示用の全体リスト（上限クランプ後）、`added` は**重複排除後に実際に追加された
 * 新規行**。`added` を TTS enqueue の単一注入点として使う（表示上限でクランプされても読み上げ対象に
 * 含めるため、クランプ前の追加分を返す）。`OverlayApp` は読み上げしないため `next` のみ使う。
 *
 * 043e: `updated` は**同一 id で再送された jewels（YouTube の combo 更新）のうち中身が変わったもの**。
 * 公式 proto の `LiveChatMessage.id` に「For giftEvents, the same ID may be reused to update the combo count」と
 * あるとおり、Jewels だけは「別メッセージが N 件届く」のではなく「同じ 1 件が N 回更新される」。よって
 * **表示行は増やさず（`merged` の該当要素を差し替える）・読み上げもせず（`added` に載せない）・記録だけ更新する**。
 * `updated` もクランプ前に確定するため、上限で `next` から落ちた行の更新も記録には届く（`added` と同じ論拠）。
 */
export function mergeComments(
  prev: CommentViewDto[],
  incoming: CommentViewDto[],
): {
  next: CommentViewDto[];
  added: CommentViewDto[];
  updated: CommentViewDto[];
} {
  // 043e: 従来の Set(seen) を Map(id → merged 内の位置) へ置き換えた。重複判定は has → get で同値のまま、
  // 同一 id の差し替え位置を O(1) で引けるようにするため（表示行を増やさず中身だけ入れ替える）。
  // 【レビュー指摘 Q-8・修正不要】Set→Map で `prev` に重複 id があると「後勝ち」になる非同値が入るが、
  //   `prev` は常に本関数自身の `next`（＝id 一意）で初期 state は空配列のため発生しない。仮に混入しても
  //   後ろの要素が差し替わるだけで壊れ方は穏当。再修正トリガー: 本関数を通さない経路から `comments` state を
  //   直接組み立てるようになったら、id 一意性を呼び出し側で保証するか本関数側で弾く。
  const indexById = new Map(prev.map((c, i) => [c.id, i]));
  const merged = [...prev];
  const added: CommentViewDto[] = [];
  const updated: CommentViewDto[] = [];
  for (const c of incoming) {
    const at = indexById.get(c.id);
    if (at === undefined) {
      // 新規 id: 従来どおり末尾へ積み、TTS/記録の対象（added）にする。
      indexById.set(c.id, merged.length);
      merged.push(c);
      added.push(c);
      continue;
    }
    // ---- ここから 043e: 同一 id の「更新」経路（従来はここで無条件に continue していた）----
    // (a) jewels 以外は従来どおり**完全にスキップ**する。id 更新型イベントは GIFT_EVENT だけで、
    //     他種別の同一 id は「同じコメントの再配信」でしかないため、表示も invoke も 0 のまま
    //     （＝jewels 以外の挙動は 3 層すべてで従来と 1 バイトも変わらない）。
    if (c.eventType !== "jewels") continue;
    // (b) 中身が変わっていなければ従来どおりスキップ（StrictMode の updater 二重実行や再配信で
    //     無駄な UPDATE を Rust へ飛ばさない）。
    if (!hasComboPayloadChanged(merged[at], c)) continue;
    // (c) 表示は 1 行のまま中身だけ差し替える（行数も並び順も動かない＝金額バッジだけが更新される）。
    merged[at] = c;
    if (at >= prev.length) {
      // 同一バッチ内で同じ id が 2 回来た場合（sidecar は comments.append を 1 件ずつ送るため実運用では
      // 起きない防御）。この id はまだ Rust に INSERT されていないので、added の該当要素を最新値へ
      // 差し替えるだけにして updated には積まない＝INSERT と UPDATE の順序競合を作らない。
      // 【不変条件・レビュー指摘 Q-7】`at - prev.length` が added の添字になるのは、**merged への push と
      //   added への push を常に対で行う**（上の新規 id 分岐のみが両方を push する）ため。この対応が崩れると
      //   添字がずれて**別のコメントを上書きする**という気付きにくい壊れ方をするので、merged.push を足す
      //   ときは必ず added.push も同じ分岐で行うこと。
      added[at - prev.length] = c;
      continue;
    }
    updated.push(c);
  }
  // 上限クランプ（新しい順に末尾 MAX 件を残す）。
  const next =
    merged.length > MAX_COMMENTS
      ? merged.slice(merged.length - MAX_COMMENTS)
      : merged;
  return { next, added, updated };
}
