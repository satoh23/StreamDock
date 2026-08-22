import { timingSafeEqual } from "node:crypto";

/**
 * 066: **配信のチャットへ書き込む**（viewer → sidecar）。⚠⚠ **StreamDock 初の「書き込み」経路**である。
 *
 * ⚠⚠⚠ **本モジュールが持っているのは「送ってよいか」の判断だけ**で、実際の送信は
 * [`twitch-chat-sender.ts`] にある。分けてある理由は 060h コミット 2 とまったく同じ——
 * `index.ts` は top-level で `main()` を呼ぶため `scripts/test-*.mjs` から import できず、
 * **そこに判断を書くとチケット照合・スロットル・検証がミューテーションで生存する**。
 * ⚠ **`index.ts` の分岐に判断を書き戻さないこと。** あちらが持ってよいのは「配線」だけである。
 *
 * ## ⚠⚠⚠ なぜチケットが要るのか（ここが本モジュールの存在理由）
 *
 * **sidecar の loopback WS は未認証**である。ブラウザで開いた悪意あるページも
 * `ws://127.0.0.1:<port>` へ繋げるので、**チケットが無ければ「任意のページが
 * ユーザーの Twitch チャットへ投稿できる」**ことになる。
 * ⚠ 060c が `theme-import.fetch` に対してまったく同じ理由でチケットを導入している
 * （`theme-import-frame.ts` の注記が正）。⇒ **同じ作法をそのまま踏襲する。**
 *
 * ⚠⚠ **テーマ取り込みのチケットを使い回さないこと。** 能力ごとに別の秘密にしてあるのは、
 * 片方が漏れたときの被害範囲を分けるため（テーマ取り込みは「読む」、こちらは「書く」）。
 *
 * ## ⚠⚠ 二重の門
 *
 * 1. **チケット**（本モジュール）… 「**アプリの窓から来た要求**であること」の担保
 * 2. **ユーザーの明示的な有効化**（frontend のトグル・**既定 OFF**）… 「**本人が望んだ**」ことの担保
 *
 * ⚠ 1 が壁で、2 は同意である。**どちらか片方にしないこと。**
 */

/** viewer → sidecar: チャットへ 1 通送る。⚠ **宛先を載せない**（下の注記が正）。 */
export const CHAT_SEND_FRAME = "chat-send";
/** sidecar → **要求元 1 本**へ返す結果。⚠ broadcast しない。 */
export const CHAT_SEND_RESULT_FRAME = "chat.send.result";

/**
 * 066: 送信フレーム。
 *
 * ⚠⚠ **宛先（チャンネル・broadcaster_id）をこのフレームには載せない。** 送り先は
 * **sidecar が「いま取得しているセッション」から決める**。
 * ⚠ 064a が OBS のソース名で踏んだのと同じ論点で、あちらは「実在照合」を壁にしたが、
 * **こちらは壁を作れない**——他人のチャンネルへ投稿する要求は、形式的には完全に正当に見える。
 *
 * ⚠⚠⚠ **security-review 066 S-2（訂正）: これは「宛先が viewer から来ない」ことを意味しない。**
 * 宛先の元になる `channel` は **`start-session` フレーム由来＝ viewer から来ており、
 * しかも `start-session` はチケットで守られていない**。
 * ⇒ **未認証の loopback WS に繋いだページが宛先を差し替えられる。**
 *
 * ⚠⚠⚠ **S-2b（レビュー 2 巡目・段 2 から前倒しした）: 当初の対処は
 * 「画面に送信先を出して気づけるようにする」だけだったが、それは実装として成立していなかった**
 * ——`ChatSendCard` が出していたのは **frontend 自身が持っている入力値**で、
 * sidecar が実際に握っている宛先ではない。⇒ **差し替えられても表示は変わらず、気づけない。**
 * ⇒ **段 2 の着手条件だった「送信時の突き合わせ」をここへ前倒しした**（[`expectedChannel`]）。
 * ⚠ 残る段 2 の宿題＝ `start-session` そのもののチケット化（本フレームの突き合わせは
 * 「**ユーザーが押した瞬間の宛先が、画面に出ている宛先と同じ**」ことしか保証しない）。
 */
export interface ChatSendFrame {
  type: typeof CHAT_SEND_FRAME;
  ticket: string;
  requestId: number;
  message: string;
  /**
   * ⚠⚠⚠ **これは「宛先」ではない。「宛先の期待値」である。**
   *
   * frontend が「**いま自分はこのチャンネルに繋いでいるつもりだ**」（＝`ChatSendCard` が
   * 画面に出している値）を載せる。sidecar は**これを宛先として使わない**——
   * 宛先はあくまで `setChannel` が握っている値で、⚠ **本フィールドは
   * それとの等値検査にしか使わない**（不一致なら送らない）。
   *
   * ⚠⚠ **この区別を崩さないこと。** 宛先として使った瞬間、
   * 「未認証の loopback WS から任意のチャンネルへ投稿できる」に戻る——
   * S-2 が指摘したのはまさにその形の穴である。
   */
  expectedChannel: string;
}

/**
 * `expectedChannel` の上限（文字数）。⚠ Twitch のログイン名は 25 文字までなので十分余裕がある。
 * ⚠ 上限を置くのは `ticket` と同じ理由＝**長大な文字列を握らせない**ため。
 */
export const CHAT_CHANNEL_MAX_CHARS = 64;

/**
 * S-2b: 「いま送ろうとしている宛先」と「frontend が繋いでいるつもりの宛先」が同じか。
 *
 * ⚠ **`trim` して小文字化して比べる**——Twitch のログイン名は大文字小文字を区別しないので、
 * ユーザーが `MyChannel` と打っても `mychannel` として扱われる。
 * ⚠⚠ **ここを厳格な `===` にしないこと**——正しい相手なのに送れない（＝
 * 「押したのに何も起きない」）を作るほうが、この検査の目的を損なう。
 * ⚠ 秘密の比較ではないので**定数時間である必要はない**（[`isSameChatSecret`] とは別物）。
 */
export function isSameChatChannel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * 宛先が食い違ったときにユーザーへ返す文。
 *
 * ⚠⚠ **実際の宛先を文に載せない**（§9）。攻撃者が差し替えた値をそのまま画面に出す意味が無く、
 * 載せると「sidecar が握っている状態」を未認証の WS へ教えることになる。
 * ⚠ 直し方（取得を開始し直す）まで書く（061a Q-1）。
 */
export const CHAT_CHANNEL_MISMATCH_REASON =
  "接続中の配信が変わっています。画面の送信先を確かめて、コメントの取得を開始し直してください。";

/** チケット文字列の上限（文字数）。⚠ 実物は uuid v4 の simple 形＝32 文字（060c と同値）。 */
export const CHAT_TICKET_MAX_CHARS = 128;

/**
 * 送信できる本文の上限（**UTF-16 コード単位**）。
 *
 * 根拠＝ Twitch のチャット 1 通の上限が 500 文字であること。⚠ **超過を切り詰めない**——
 * 切り詰めると「送ったつもりの文と実際に流れた文が違う」状態を作る（064 レビュー S-10 と同じ向き）。
 */
export const CHAT_MESSAGE_MAX_LENGTH = 500;

/** 制御文字か（`U+0000〜U+001F` と `U+007F`）。⚠ `effectAssignments.ts` と同じ規則。 */
const isControlCodePoint = (cp: number): boolean => cp < 0x20 || cp === 0x7f;

/**
 * 066: **チャットへ送ってよい本文か**（型・空・上限・制御文字）。
 *
 * ⚠⚠ **改行も弾く**（`U+000A` は制御文字なのでこの検査で落ちる）。改行を通すと
 * **1 回の要求で複数行を流し込める**ので、スロットルの意味が薄れる。
 */
export function isAllowedChatMessage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
    return false;
  }
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isControlCodePoint(cp)) return false;
  }
  return true;
}

/**
 * 060c と同じ定数時間比較。⚠ **長さが違うと `timingSafeEqual` は throw する**ので先に長さを見る。
 * ⚠ **`theme-import-frame.ts` から import しないこと**——あちらは「読む」能力の実装であり、
 * こちらが依存すると**片方を消したときにもう片方が壊れる**（能力ごとに独立させる）。
 */
export function isSameChatSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** スロットルの判定結果。⚠ `reason` は**ユーザーに見せる文**（token も本文も載せない・§9）。 */
export type ChatThrottleVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * 066: **送信スロットル**（sidecar 側にしか置かない）。
 *
 * ⚠⚠ **frontend 側に置かないこと。** 未認証の loopback WS から直接叩かれる経路が残るので、
 * 数を数えてよいのは**実際に送る側**だけである。
 *
 * 規則は 3 つ:
 *   1. **最短間隔** … 連打で 1 秒に何通も出ない
 *   2. **窓あたりの上限** … Twitch の 20 通/30 秒より**十分低く**取る（BAN 側へ倒れない）
 *   3. ⚠⚠ **直前と同じ本文を拒否** … Twitch 自身が短時間の重複を落とすので、
 *      **こちらで先に落として理由を出す**（向こうで黙って消えると原因が読めない）
 *
 * ⚠ `now` を引数で受けるのは**テストで固定するため**（`Date.now()` を直接呼ばない）。
 */
export function createChatSendThrottle(options?: {
  minIntervalMs?: number;
  windowMs?: number;
  maxInWindow?: number;
}): {
  check: (message: string, now: number) => ChatThrottleVerdict;
  commit: (message: string, now: number) => void;
} {
  const minIntervalMs = options?.minIntervalMs ?? CHAT_MIN_INTERVAL_MS;
  const windowMs = options?.windowMs ?? CHAT_WINDOW_MS;
  const maxInWindow = options?.maxInWindow ?? CHAT_MAX_IN_WINDOW;
  let recent: number[] = [];
  let lastMessage: string | null = null;

  return {
    check(message, now) {
      recent = recent.filter((at) => now - at < windowMs);
      if (recent.length > 0 && now - recent[recent.length - 1] < minIntervalMs) {
        return { ok: false, reason: "送信の間隔が短すぎます。少し待ってください。" };
      }
      if (recent.length >= maxInWindow) {
        return { ok: false, reason: "短時間に送りすぎです。少し待ってください。" };
      }
      if (lastMessage !== null && lastMessage === message) {
        return {
          ok: false,
          reason: "直前と同じ内容は送れません（Twitch 側で弾かれるため）。",
        };
      }
      return { ok: true };
    },
    commit(message, now) {
      recent.push(now);
      lastMessage = message;
    },
  };
}

/**
 * 最短の送信間隔。⚠ Twitch の制限（20 通/30 秒＝1.5 秒に 1 通）より**十分長く**取る。
 * 根拠＝ 段 1 は**手動のテスト送信しかない**ので、間隔を詰める理由がまったく無い。
 * ⚠ **再修正トリガー＝自動送信（063b）を繋ぐとき**。そのとき改めて実配信で決めること。
 */
export const CHAT_MIN_INTERVAL_MS = 3_000;
/** スロットルの窓。 */
export const CHAT_WINDOW_MS = 30_000;
/** 窓あたりの上限。⚠ Twitch の 20 通/30 秒に対して**大きく余裕を取る**（BAN 側へ倒れない）。 */
export const CHAT_MAX_IN_WINDOW = 5;

/** [`handleChatSendFrame`] の依存。⚠ ネットワークに触るのは `send` だけ。 */
export interface ChatSendFrameDeps {
  /** `parseControlFrame` が**明示構築**した検証済みフレーム。 */
  frame: ChatSendFrame;
  /** Rust から stdin private pipe で受領したチケット。⚠ **未受領なら `null`＝1 通も通さない**。 */
  ticket: string | null;
  /**
   * S-2b: sidecar が**実際に握っている宛先**（`setChannel` の現在値・未接続なら `null`）。
   * ⚠⚠ **これが宛先の唯一の持ち主**で、`frame.expectedChannel` は等値検査にしか使わない。
   */
  currentChannel: () => string | null;
  /** ⚠⚠ **要求元 1 本へだけ**返す（broadcast しない）。 */
  reply: (message: unknown) => void;
  /** スロットル（`createChatSendThrottle` の戻り値）。 */
  throttle: ReturnType<typeof createChatSendThrottle>;
  /** 現在時刻。⚠ テストで固定するために注入する。 */
  now: () => number;
  /** 実際に送る関数。⚠ **失敗は throw ではなく `{ok:false, reason}` で返すこと**。 */
  send: (message: string) => Promise<{ ok: boolean; reason?: string }>;
}

/**
 * 066: 送信フレーム 1 件を処理する。**チケットが一致しなければ黙って捨てる**（fail-closed）。
 *
 * ⚠⚠ **返す結果に本文を載せない**（§9）。載せるのは `ok` と、ユーザーに見せる `reason` だけ。
 * ⚠ **チケットの不一致は返事もしない**——「チケットが違う」と返すと、
 * **総当たりの手掛かりになる**（060c と同じ判断）。
 *
 * ⚠⚠⚠ **S-2b: 宛先の突き合わせは「返事をする」**（チケットと違う）。
 * ⚠ チケットを黙殺するのは**総当たりの手掛かりを与えない**ためだが、
 * 宛先の食い違いには**秘密が何も無い**（差し替えた側は自分が入れた値を知っている）。
 * 一方で**ユーザーには絶対に伝える必要がある**——黙って落とすと
 * 「押したのに何も起きない」になり、**差し替えられたことに気づけない**。
 */
export async function handleChatSendFrame(deps: ChatSendFrameDeps): Promise<void> {
  const { frame, ticket, reply, throttle, now, send, currentChannel } = deps;
  if (ticket === null || !isSameChatSecret(frame.ticket, ticket)) return;

  // ⚠⚠⚠ S-2b: **frontend が繋いでいるつもりの宛先と、実際の宛先が違ったら送らない。**
  //   ⚠ `null`（未接続）はここで弾かない——`send` が「配信に接続していません」を返す
  //     唯一の持ち主なので、文言の持ち主を 2 か所に割らない。
  const current = currentChannel();
  if (current !== null && !isSameChatChannel(current, frame.expectedChannel)) {
    reply({
      type: CHAT_SEND_RESULT_FRAME,
      payload: {
        requestId: frame.requestId,
        ok: false,
        reason: CHAT_CHANNEL_MISMATCH_REASON,
      },
    });
    return;
  }

  const message = frame.message.trim();
  const at = now();
  const verdict = throttle.check(message, at);
  if (!verdict.ok) {
    reply({
      type: CHAT_SEND_RESULT_FRAME,
      payload: { requestId: frame.requestId, ok: false, reason: verdict.reason },
    });
    return;
  }
  // ⚠⚠ **実際に送る前に枠を消費する**（`await` の間に 2 通目が滑り込むのを防ぐ）。
  throttle.commit(message, at);
  const result = await send(message);
  reply({
    type: CHAT_SEND_RESULT_FRAME,
    payload: {
      requestId: frame.requestId,
      ok: result.ok,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    },
  });
}
