import {
  STREAM_EVENT_ROUND_KEY,
  STREAM_EVENT_SELECTED_KEY,
} from "../comment-viewer/overlaySettings";
import { findStreamEvent, isStreamEventId, type StreamEvent } from "./streamEventRegistry";

/**
 * 061l: 配信イベントの**開催状態**（判断 1・5）の読み書きと、時間まわりの純関数。
 *
 * ## ⚠⚠ なぜ `overlaySettings.ts` ではなくここに置くのか
 *
 * キー 2 本は `features/comment-viewer/overlaySettings.ts` にあり、**ロジックだけがここにある**。
 * 先例は `EFFECT_ASSIGNMENTS_KEY`（キーはあちら・読み書きは `screens/obs-effects/effectAssignments.ts`）で、
 * 同ファイルの JSDoc が理由まで書いている——「**localStorage のキーは overlaySettings.ts を grep すれば
 * 全部見える**」という §9 の監査上の性質を壊さないため。
 * ⚠ さらに `parseStreamEventRound` は**未知 id を落とす**ためにレジストリを参照する必要があり、
 * ここへ置かないと `features/comment-viewer → features/obs-effects` という**新しい依存方向**が生まれる
 * （`overlaySettings.ts` は現在 import ゼロで、その性質も維持したい）。
 *
 * ## ⚠⚠ 時計は 1 つ（判断 5）
 *
 * 判定はすべて **`now` を引数で受ける純関数**に閉じてある（061b / 061j と同じ規律＝
 * テストで時計を偽装しない）。⚠ `Date.now()` を呼ぶのは**呼び出し側（画面と窓）**だけ。
 */

/** 開催 1 回ぶん。⚠ **`endsAt` は絶対時刻**（両窓が同じ値から残りを計算する）。 */
export interface StreamEventRound {
  /** 同梱レジストリの id。⚠ 未知 id は `parseStreamEventRound` が落とすので、ここに載るのは実在する id だけ。 */
  eventId: string;
  /** 開始時刻（epoch ms）。 */
  startedAt: number;
  /** 終了時刻（epoch ms）。⚠ これを過ぎた保存値は「開催していない」と読む。 */
  endsAt: number;
}

/**
 * 061l（判断 8）: **イベントの描画関数へ渡してよいものの全集合**。
 *
 * ⚠⚠ **第三者の本文・表示名・アバター・金額をここへ足さないこと。**
 * 061b が `EffectRequest` に `text` / `avatar` を持たせなかったのと**同じ手**で、
 * **渡せないものを型として書けなくしておく**のが目的である
 * （＝ §9 の線を「気をつける」ではなく**構造**で引く）。
 * ⚠ 玉入れで「誰が入れたか」を出したくなったら、**そのとき `EffectRequest` と同じ議論をやり直すこと**
 * （伏せ字・長さ制限・NG ワードを先に決める）。**「便利だから」で足さない。**
 */
export interface StreamEventProgress {
  /** 開催中に届いたコメントの件数。 */
  count: number;
  /** 残り時間（ミリ秒・0 未満にはしない）。 */
  remainingMs: number;
}

/**
 * 保存値（JSON 文字列 or `null`）を開催状態へ読む。**壊れていれば必ず `null`（＝開催していない）**。
 *
 * 落とす条件（すべて「開催していない」へ倒す＝fail-safe）:
 *   1. 未保存 / 非 JSON / 配列や `null` などオブジェクトでない
 *   2. `eventId` が文字列でない、または**同梱レジストリに無い**（アプリ更新で消えた id・細工された値）
 *   3. `startedAt` / `endsAt` が有限な数値でない
 *   4. ⚠⚠ **`endsAt` を `now` が過ぎている**（＝これが「終了」の表現そのもの・判断 5）
 *
 * ⚠ `now >= endsAt` で落とす（`endsAt` ちょうどは「終わっている」側）。
 *
 * ## ⚠ 開催の長さに上限を課していない理由（061l レビュー S-3・受容）
 *
 * ここは `endsAt - startedAt` を縛っていないので、**保存値が細工されている**か
 * **配信中にシステム時計が巻き戻る**と、絶対時刻の `endsAt` がはるか未来に留まり
 * **イベントが配信画面に出っぱなしになる**。⚠ **受容する**理由:
 *   - 細工は「同一オリジンの他窓が書ける」前提の話で、そこは未認証 loopback WS と同じ姿勢
 *     （＝すでに他の手段がある相手に対して、ここだけ硬くしても意味が増えない）。
 *   - 時計の巻き戻しは実在するが、**脱出路が常時ある**——タブの「終了」は
 *     `round !== null` の間つねに出ており、押せば 1 操作で消える（＝黙って詰まない）。
 *   - 上限値を決めると「長い企画を開催できない」という**別の壊れ方**を作る（061f が
 *     「意匠を床にすると適用できないデザインが生まれる」で踏んだのと同型）。
 * ⚠ **再修正トリガー＝開催の長さをユーザーが選べるようにするとき**（061l では UI を作っていない）。
 * そのとき「選べる範囲」が決まるので、**その範囲を上限としてここでも弾く**のが自然な形になる。
 */
export function parseStreamEventRound(
  raw: string | null,
  now: number,
): StreamEventRound | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { eventId, startedAt, endsAt } = parsed as Record<string, unknown>;
  if (typeof eventId !== "string" || !isStreamEventId(eventId)) return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  if (typeof endsAt !== "number" || !Number.isFinite(endsAt)) return null;
  if (now >= endsAt) return null;
  return { eventId, startedAt, endsAt };
}

/**
 * 開催状態を読む。⚠ **ステージ窓はマウント時にこれを呼ぶ**（`storage` が届かなくても取りこぼさない・判断 5）。
 * ⚠ 例外（プライベートモード等）は「開催していない」へ倒す。
 */
export function loadStreamEventRound(now: number): StreamEventRound | null {
  try {
    return parseStreamEventRound(localStorage.getItem(STREAM_EVENT_ROUND_KEY), now);
  } catch {
    return null;
  }
}

/**
 * 開催を始める（保存する）。
 *
 * ⚠⚠ **呼んでよいのは `ObsEffectsScreen` の開始ハンドラだけ**（061i 判断 2 と同じ「書き手を 1 か所に閉じる」規律）。
 * ⚠⚠ **ステージ窓（`EffectOverlayApp`）から呼ばないこと**——両窓が書くと、判断 5 が避けた
 * 「どちらが正か分からない」状態になる。ステージ窓は**読むだけ**である。
 * ⚠ 書けない環境では**開催が始まらないだけ**（配信画面には何も出ない側＝安全側に倒れる）。
 */
export function saveStreamEventRound(round: StreamEventRound): void {
  try {
    localStorage.setItem(STREAM_EVENT_ROUND_KEY, JSON.stringify(round));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 開催を終える（保存値を消す）。
 *
 * ⚠ 呼ぶのは main 窓の 2 経路だけ＝**「終了」ボタン**と、**期限切れを見つけたときの掃除（best-effort）**。
 * ⚠⚠ **掃除に正しさを預けていない**——`parseStreamEventRound` が期限切れを必ず落とすので、
 * main 窓が閉じていて掃除が走らなくても**「終了時刻を過ぎたら開催していない」は成立する**（判断 5）。
 * ⚠ 無いときに `removeItem` を呼んでも害は無いが、他窓へ余計な `storage` を撒かないため
 * **呼び出し側が「開催中のときだけ」呼ぶ**こと。
 */
export function clearStreamEventRound(): void {
  try {
    localStorage.removeItem(STREAM_EVENT_ROUND_KEY);
  } catch {
    // プライベートモード等で消せない場合は黙って無視する（期限切れは読む側が落とす）。
  }
}

/**
 * 開始時刻とイベントから開催 1 回ぶんを作る**純関数**。
 * ⚠ 長さの持ち主は `StreamEvent.defaultDurationMs`（時間を選ばせる UI は 061l では作らない）。
 */
export function startStreamEventRound(
  event: StreamEvent,
  now: number,
): StreamEventRound {
  return {
    eventId: event.id,
    startedAt: now,
    endsAt: now + event.defaultDurationMs,
  };
}

/** 2 つの開催が同じものか（＝画面の再描画と件数のリセットを、本当に変わったときだけ起こすため）。 */
export function isSameStreamEventRound(
  a: StreamEventRound | null,
  b: StreamEventRound | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.eventId === b.eventId && a.startedAt === b.startedAt && a.endsAt === b.endsAt
  );
}

/** 残り時間（ミリ秒）。⚠ **負にしない**（期限切れは呼び出し側が「開催していない」として扱う）。 */
export function streamEventRemainingMs(
  round: StreamEventRound,
  now: number,
): number {
  return Math.max(0, round.endsAt - now);
}

/**
 * main 窓向けの残り時間の表示（**分まで**）。
 *
 * ⚠ **秒まで出さない**（判断 10）——秒を出すと前提ステータスとタブを**毎秒再描画する**ことになる。
 * ⚠ 切り上げなので「残り 1 分」は「あと 1 分以内」の意味。0 は「まもなく終了」と読ませる。
 */
export function streamEventRemainingLabel(
  round: StreamEventRound,
  now: number,
): string {
  const minutes = Math.ceil(streamEventRemainingMs(round, now) / 60_000);
  return minutes <= 0 ? "まもなく終了" : `残り ${minutes} 分`;
}

/**
 * ステージ窓向けの残り時間の表示（**`分:秒`**）。
 *
 * ⚠ こちらは秒まで出す——配信画面のカウントダウンは秒が動いていないと止まって見えるため。
 * ⚠ **判断 10 の「秒を出さない」は main 窓の前提ステータスの話**で、配信画面には及ばない。
 */
export function formatStreamEventClock(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 適用中のイベント id を読む。**未保存・未知 id・例外はすべて `null`**（＝まだ選んでいない）。
 * ⚠ 未知 id を `null` へ倒すのは `loadOverlayTheme` と同じ fail-safe
 * （アプリ更新でレジストリから消えた id を掴んだまま画面が壊れないように）。
 */
export function loadStreamEventSelected(): string | null {
  try {
    const raw = localStorage.getItem(STREAM_EVENT_SELECTED_KEY);
    return raw !== null && findStreamEvent(raw) !== null ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 適用中のイベント id を保存する（ローカルのみ・非機密・外部送信しない）。
 *
 * ⚠⚠ **これは「使うイベントを選ぶ」だけの操作である**（判断 6）——
 * **開催キーを書かない・窓を開かない**。混ぜると「詳細画面を開いた瞬間に配信画面へ出る」になる。
 * ⚠ 呼んでよいのは `StreamEventTab` の「適用」だけ。
 */
export function saveStreamEventSelected(eventId: string): void {
  try {
    localStorage.setItem(STREAM_EVENT_SELECTED_KEY, eventId);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（次に開いたときは未選択に戻る）。
  }
}
