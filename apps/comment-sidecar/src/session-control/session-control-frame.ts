import { timingSafeEqual } from "node:crypto";

/**
 * 066 段 2: **取得セッションの制御（`start-session` / `stop-session`）にチケットを要求する。**
 *
 * ⚠⚠⚠ **これは 063f（ガチャ結果の自動送信・旧「066 段 3」）の着手条件**である
 * （`docs/security.md` §1 の 066 節が「これを済ませずに自動送信を繋がないこと」と明記）。
 *
 * ## ⚠⚠ 何を塞ぐのか（段 1 の対処では足りなかった理由）
 *
 * **sidecar の loopback WS は未認証**で、ブラウザで開いた悪意あるページも
 * `ws://127.0.0.1:<port>` へ繋げる。⚠⚠⚠ **`start-session` は「送信の宛先」を決めるフレーム**である
 * ——`index.ts` の `startSession` が `chatSender.setChannel(channel)` を呼ぶ唯一の場所で、
 * その `channel` は**このフレームで viewer から来る**。
 * ⇒ チケットが無いと、**任意のページが宛先を自分のチャンネルへ差し替えられる**
 * （security-review 066 S-2）。
 *
 * ⚠ **段 1 の対処（`chat-send` の `expectedChannel` 突き合わせ）が守るのは
 * 「ユーザーがテスト送信ボタンを押した*その瞬間*、画面の宛先と sidecar の宛先が一致していること」だけ**である。
 * ⚠⚠ **自動送信（段 3）はユーザーが画面を見ていないときに走る**ので、
 * 突き合わせる相手（見ている画面）がそもそも存在しない。⇒ **入口を塞ぐしかない。**
 *
 * ## ⚠⚠ なぜ「新しい機構」を作らないのか
 *
 * 060c（テーマ取り込み）と 066 段 1（チャット送信）が**まったく同じ経路を 2 回作っている**
 * ——Rust が uuid v4 を採番 → **stdin private pipe** で sidecar へ → sidecar が定数時間比較。
 * ⇒ 本モジュールは**その 3 例目**であり、発明は 1 つもしていない。
 *
 * ⚠⚠⚠ **秘密は 3 本目を別に採番する**（テーマ／チャット／セッション制御）。
 * 使い回すと「片方の秘密が漏れたらもう一方の能力も奪われる」形になり、被害範囲が繋がる。
 *
 * ## ⚠ 判断をここに置く理由（`index.ts` に書かない）
 *
 * `index.ts` は top-level で `main()` を呼ぶため `scripts/test-*.mjs` から import できない。
 * ⇒ **そこに判断を書くと、チケット照合がミューテーションで生存する**
 * （060h コミット 2・066 段 1 とまったく同じ理由。security-review 060c S-3 の宿題）。
 * ⚠ **`index.ts` の分岐に判断を書き戻さないこと。** あちらが持ってよいのは「配線」だけである。
 *
 * ## ⚠⚠ 対象を `start-session` / `stop-session` の 2 本にした理由（穴 B の結論）
 *
 * - **`start-session`** … 必須。上記のとおり**宛先を決めるフレーム**である。
 * - **`stop-session`** … ⚠ 乗っ取られても「送信できなくなる」＝ fail-closed 側に倒れるので
 *   秘密は漏れないが、**配信中に取得を止められる**（嫌がらせ）。
 *   ⇒ **同じチケットを要求する。** 取得セッションの開始と停止は**同じ能力**であり、
 *   ここで割ると「止めるほうだけ誰でも叩ける」という説明の付かない非対称になる。
 *   ⚠ 「止められなくなるのでは」＝**ならない**。チケットが取れないのは sidecar 未起動のときだけで、
 *   そのときは止める対象のセッションも存在しない。
 * - ⚠⚠ **`start-login` は対象外**（本段のスコープ外・**残る穴として記録する**）。
 *   乗っ取られたときの実害は「Device Code の取得が走る／ブラウザで同意画面が開く」で、
 *   **宛先の乗っ取りではない**（発行されるトークンはユーザー自身の sidecar に入る）。
 *   ⚠ 嫌がらせにはなるので、**次に本節を触るときに 4 本目として検討すること。**
 *   ⚠⚠ **レビュー S-7（補足）: 実害は「同意画面が 1 枚開く」より少し重い**——
 *   連打されると **Twitch の Device Code エンドポイントを叩き続ける**ので、
 *   **レート制限側へ倒れうる**（それでも宛先の乗っ取りではないので、段 2 の判断は変えない）。
 */

/**
 * 制御フレームで受け付けるチケット文字列の上限（文字数）。
 *
 * ⚠ 実物は uuid v4 の simple 形＝ **32 文字**なので余裕をみた値（060c / 066 段 1 と同値）。
 * ⚠⚠ **上限を置く理由**＝ 未認証の loopback クライアントが**巨大文字列を送るだけで**
 * `Buffer.from()` の確保を強いられるのを防ぐ（security-review 060c S-5）。
 */
export const SESSION_TICKET_MAX_CHARS = 128;

/**
 * フレームに載っているチケットが**形として受理できるか**（空でない・上限以内の文字列）。
 *
 * ⚠⚠ **これは照合ではない。** 秘密と突き合わせるのは [`isAuthorizedSessionControl`] で、
 * ここは `parseControlFrame` が**フレームを組む前に**通す形式検査である
 * （060c / 066 段 1 の `ticket` 検査と同じ役割）。
 */
export function isAllowedSessionTicket(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SESSION_TICKET_MAX_CHARS
  );
}

/**
 * 066 段 2（レビュー S-5 の修正）: `start-session` の `channel` の上限（文字数）。
 *
 * ⚠⚠ **これは「実際に宛先になる値」の上限である。** 段 1 は `chat-send` の
 * `expectedChannel`（＝**期待値**）に `CHAT_CHANNEL_MAX_CHARS = 64` を置いていたのに、
 * ⚠⚠⚠ **その期待値と突き合わせる相手＝ `start-session` の `channel` には上限が無かった**
 * ——「期待値には上限があるのに実値には無い」は説明の付かない非対称である。
 *
 * ⚠ 値は `CHAT_CHANNEL_MAX_CHARS` と**同じ 64**（Twitch のログイン名は 25 文字まで）。
 * ⚠⚠ **それでも別の定数として宣言する**——3 本のチケットの `*_MAX_CHARS` を別々に持っているのと
 * 同じ規律で、**能力ごとに独立させる**（`chat-send/chat-send-frame.ts` から import しない）。
 * ⚠ **超過は切り詰めず不受理**（`parseControlFrame` が `null` を返す）＝ 066 の
 * 「送ったつもりの値と実際に流れた値が違う、を作らない」と同じ向き。
 */
export const SESSION_CHANNEL_MAX_CHARS = 64;

/**
 * `start-session` の `channel` が**形として受理できるか**（文字列・上限以内）。
 *
 * ⚠⚠ **空文字はここでは弾いていない。** 弾くほうが素直に見えるが、
 * ①**弾くのは本レビューの指摘（＝上限を置くこと）の範囲外の挙動変更**である
 * ②frontend は `channel.trim()` が空なら**そもそも送らない**（`handleStartSession` の `if (!ch) return`）
 * ③空のまま通っても `chatSender.setChannel("")` が宛先解決に失敗して**送れなくなるだけ**（fail-closed 側）
 * ——の 3 点で、いま塞ぐ実害が無い。
 * ⚠ **再修正トリガー＝ `channel` を frontend 以外から組み立てる経路ができたとき**
 * （そのときは `isAllowedSessionTicket` と同じく `value.length > 0` を足すこと）。
 */
export function isAllowedSessionChannel(value: unknown): value is string {
  return typeof value === "string" && value.length <= SESSION_CHANNEL_MAX_CHARS;
}

/**
 * 060c / 066 段 1 と同じ定数時間比較。
 *
 * ⚠ **長さが違うと `timingSafeEqual` は throw する**ので先に長さを見る。
 * ⚠⚠ **`theme-import-frame.ts` / `chat-send/chat-send-frame.ts` から import しないこと**
 * ——能力ごとに独立させてあるので、依存させると**片方を消したときにもう片方が壊れる**
 * （066 段 1 が同じ理由で 060c から独立させている）。
 */
export function isSameSessionSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * 066 段 2: **この制御フレームを受け付けてよいか。**
 *
 * ⚠⚠⚠ **fail-closed**: `ticket`（Rust から stdin private pipe で受領した秘密）が
 * **未受領（`null`）なら何も通さない**。⚠ 「まだ受け取っていないから今回だけ通す」を作らないこと
 * ——それは**チケットを取り外すのとまったく同じ**である。
 *
 * ⚠⚠ **不一致でも返事をしない**（呼び出し側が黙って捨てる）。
 * 理由は 060c / 066 段 1 と同じで、「チケットが違う」と返すと**総当たりの手掛かり**になる。
 *
 * ### ⚠⚠⚠ 穴 C: 「黙って効かない」を作らないための分担
 *
 * ⚠ 黙殺は**攻撃者にだけ当たる**ようにしなければならない。正規の窓が黙殺されると
 * **「コメントが取れない、原因不明」**という本機能で最も重い回帰になる。
 * ⇒ 分担は次のとおり:
 *
 * 1. **frontend が送る前に自分で気づく** … `commentStream.ts` の `startSession` /
 *    `stopSession` はチケットを `invoke` で取り直し、**取れなければ送らずに理由を返す**。
 *    呼び出し側（`CommentViewerApp`）はそれを**画面の「状態」欄に出す**。
 *    ⚠ **正規の窓で起こりうる失敗はこちら側に全部寄せてある。**
 * 2. **sidecar 側の不一致は黙殺** … ここへ来るのは
 *    「Rust が採番した値と違う値を持っている者」＝**正規の窓ではありえない**。
 *    ⚠ 唯一の理屈上の例外は「sidecar が stdin のチケット行をまだ読んでいない」だが、
 *    Rust は **spawn 直後（ポート報告より前）**に書き、sidecar は
 *    **ポートを stdout へ書くのと同じ同期ブロックで** stdin ハンドラを登録する。
 *    ⇒ frontend がポートを取得（1 秒ポーリング）して WS を張り、
 *    **人間がボタンを押す**までには必ず読み終わっている。
 *
 * @param received フレームに載っていたチケット（形式検査済み）
 * @param ticket   Rust から受領した秘密。⚠ **未受領なら `null`**
 */
export function isAuthorizedSessionControl(
  received: string,
  ticket: string | null,
): boolean {
  if (ticket === null) return false;
  return isSameSessionSecret(received, ticket);
}
