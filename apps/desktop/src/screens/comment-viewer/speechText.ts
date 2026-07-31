/**
 * 049: 読み上げ用テキストの組立（React/CSS/DOM 非依存の純関数）。
 *
 * 課金イベント（membership/gift/subscription/jewels）は 043b の設計で `comment.text` が空（要約文言は
 * **表示側が組み立てる**）ため、`comment.text` だけを見る `ttsQueue` からは**完全に無音**だった。
 * 本モジュールは「画面に出ている文言をそのまま読ませる」ための入力を作り、`ttsQueue` へ getter
 * （`TtsQueueOptions.getSpeechText`）で注入される。
 *
 * **置き場所が `screens/` なのは意図的**（決定事項 4）。文言を二重管理しないために表示側の
 * `composeEventMessage`（viewerFormat.ts）を再利用する必要があり、`features/` に置くと features → screens の
 * 層の逆転が起きる。逆転を避けるため「screens 側で組み立てて features へ注入する」形にした
 * （`composeEventMessage` を features へ移す案は import 元の書き換えが広範＝仕様にない大規模リファクタになる）。
 *
 * `viewerFormat.ts` と同じく**依存ゼロ**（型のみ import・実行時依存なし）＝プレーンに単体テストできる。
 * 端末外へは何も出さない（組み立てた文字列は既存の loopback VOICEVOX 合成にのみ渡る。docs/security.md §1 の
 * 032c-c 例外＋その 049 追補を参照＝**課金イベントに限り投稿者名が合成テキストに乗る**）。
 *
 * ※ **`viewerFormat.ts` とは型方針だけ意図的に違う**（049 レビュー Q-11／修正不要）。あちらは bindings 型に
 *   依存させず構造部分集合の interface（`EventMessageInput` 等）を受けるが、本モジュールは `CommentViewDto` を
 *   直接受ける。構造部分集合は「キー名が食い違っても型エラーにならず黙って劣化する」という代償があり、
 *   `viewerFormat.ts` 自身が `CommentAmountInput` / `EventMessageInput` の JSDoc でそれを既知リスクとして
 *   記録している。読み上げの入力側は **bindings のリネームをコンパイルで検知できる**ほうが価値が高いので、
 *   一貫性のために劣る側へ揃えない。再修正トリガー＝この関数を bindings 非依存の場所から呼びたくなったとき。
 */

import type { CommentViewDto } from "../../features/comment-viewer/types";
import { composeEventMessage } from "./viewerFormat";

/**
 * `composeEventMessage` が付ける Tier 接尾辞「（Tier2）」を読み上げ向けに「ティア2」へ直すための正規表現。
 * 丸括弧のままだと VOICEVOX が「かっこ ティア に かっこ」と読む。
 *
 * ⚠ **通常経路では使わない**（049 フォローアップ）。本文の語順を自然にするため、Tier は
 * `withSpokenTier` が**名前の直後へ差し込む**（「〇〇さんが**ティア2の**サブスクを3ヶ月継続しました」）ように
 * なったので、この末尾置換は**表示側の文型が想定と変わったときのフォールバック専用**になっている。
 *
 * **`composeEventMessage` の出力にだけ**適用し、視聴者の自由コメント（`c.text`）には適用しない
 * （視聴者が書いた文字列を勝手に書き換えないため）。接尾辞は `subscription` と `gift` の両方に付き、
 * `membership` には付かない（YouTube に階級の概念が無い）が、本置換は**種別を見ない**ので両方に効く。
 *
 * ⚠ **表示側の書式に追従する必要がある**: `composeEventMessage` の `tierSuffix` の書式（全角括弧＋"Tier"＋数字）が
 * 変わると、この置換が黙って効かなくなり「かっこティア1かっこ」と読まれる。`speechText.test.ts` に
 * 「tier 付きの読み上げ文に `（` `）` が残らない」ケースを置いて検知できるようにしてある。
 *
 * ※ 種別ごとに Tier を付けるか否かを読み上げ側で組み直す案（`composeEventMessage({...c, tier: undefined})` で
 *   接尾辞を消して自前で付け直す）は採らない。**「どの種別に Tier を付けるか」という表示側の判断を
 *   読み上げ側にも複製する**ことになり、文言を二重管理しないという本タスクの前提に反するため。
 *
 * ⚠ 上の「自由コメントには適用しない」は**投稿者名までは守らない**（049 レビュー Q-6／修正不要）。
 *   `composeEventMessage` の出力には表示名が含まれ、表示名も視聴者が自由に決められる文字列なので、
 *   `（Tier9）` を含む表示名は「ティア9さんが…」と読まれる（実測で確認済み）。名前だけを置換対象から
 *   外すには要約を名前と定型文に分けて扱う必要があり、影響は音声のみ（表示・保存・通信には及ばない）ため
 *   割に合わない。再修正トリガー＝表示名の誤変換が実機で問題になったとき。
 *
 * ※ `g` 付き正規表現は `lastIndex` を持つが、`String.prototype.replace` は呼び出しごとに 0 へ戻すため
 *   モジュールレベル定数でも安全。**`.test()` へ転用すると呼び出しごとに結果が変わる**ので使わないこと。
 */
const TIER_SUFFIX_RE = /（Tier(\d+)）/g;

/**
 * 049 フォローアップ: Tier を**名前の直後**へ差し込んで日本語として自然な語順にする。
 *
 * 表示（変更なし）: `Aliceさんがサブスクを3ヶ月継続しました（Tier2）`
 * 読み上げ（本関数）: `Aliceさんがティア2のサブスクを3ヶ月継続しました`
 *
 * 末尾に「ティア2」を付ける旧方式は「〜継続しましたティア2」と文が終わった後に階級が来て不自然だった。
 *
 * **「どの種別に Tier を付けるか」という表示側の判断は複製しない**（049 決定事項 4 の維持）。
 * `composeEventMessage` を **tier あり/なしの 2 回呼び、その出力差**から「この種別は Tier を出すのか」を
 * 読み取る。差が無ければ表示側がそもそも Tier を付けない種別（membership 等）なので、たとえ `c.tier` に
 * 値が入っていても**差し込まない**＝表示と読み上げで Tier の有無が食い違わない。
 *
 * 文型（`${name}さんが…`）が想定と違うときは末尾置換（`TIER_SUFFIX_RE`）へフォールバックする。
 * 再修正トリガー＝`composeEventMessage` の文型が「〇〇さんが〜」以外になったら、ここの prefix 判定を直すこと
 * （フォールバックが効くので読み上げが壊れることはないが、語順は旧方式へ戻る）。
 */
function withSpokenTier(c: CommentViewDto, message: string): string {
  if (c.tier == null) return message;
  const withoutTier = composeEventMessage({ ...c, tier: undefined });
  // 差が無い＝この種別に表示側は Tier を付けない（membership 等）。読み上げでも付けない。
  if (withoutTier === null || withoutTier === message) return message;
  const prefix = `${c.author.name}さんが`;
  if (withoutTier.startsWith(prefix)) {
    return `${prefix}ティア${c.tier}の${withoutTier.slice(prefix.length)}`;
  }
  return message.replace(TIER_SUFFIX_RE, "ティア$1");
}

/**
 * コメント 1 件を読み上げ用テキストへ変換する。
 *
 * - `membership` / `gift` / `subscription` … 表示と**同じ文面**（`composeEventMessage` を再利用）。
 *   Tier だけ読み上げ向けに**名前の直後へ差し込み**（「〇〇さんがティア2のサブスクを3ヶ月継続しました」）、
 *   自由コメントがあれば「。」で連結する。
 * - `jewels` … **読み上げ専用の新設文言**（表示側は金額バッジと重複するため 043b の設計どおり文を作らない）。
 * - `chat` / `superchat` / `bits` / `donation` / 未知の種別 … **従来どおり `c.text` をそのまま返す**
 *   （＝投稿者名を読まない現行方針の維持。`composeEventMessage` が null を返すことで自然にこの経路になる）。
 *
 * 課金イベントだけ投稿者名を含むのは決定事項 1（既存方針「著者名は読まない」の**限定的な例外**）。
 * URL/絵文字の除去・読み替え辞書・文字数上限は**この関数の責務ではない**（`ttsQueue.enqueue` の ②〜④ が後段で行う）。
 *
 * ⚠ **投稿者名が後段 ②〜④ の対象にもなった副作用**（049 レビュー・いずれも本タスクでは修正不要と判断）:
 * - **③ 読み替え辞書（041a）が名前に当たる**。実測で `wataru` →「わらataru」／`William` →「わらilliam」／
 *   `W`（1 文字）→「わら」と、**英字始まりの表示名が壊れる**（内蔵辞書の `(?<![A-Za-z])w` ルール）。
 *   `草太` →「くさ太」も同様。逆に `PCマスター` →「ピーシーマスター」は望ましい方向。
 *   **ここでは直さない**——原因は 041a の内蔵辞書側にあり、正しい直し方は `w` ルールへ後方境界 `(?![A-Za-z])`
 *   を足すこと（笑いの w が英字に続くことは無いので取りこぼしゼロ・本文側の `warota` 誤爆も同時に直る）。
 *   名前だけを辞書適用から外す案は 5 段の単一チョークポイントを崩すので不可。辞書の変更は別関心なので
 *   別タスクで扱う（CLAUDE.md「1 回の作業で複数機能をまとめて実装しない」）。
 *   **再修正トリガー＝実機で名前の誤読を確認したら、041a 側の小タスクとして上記の後方境界を入れる。**
 * - **② sanitize / ④ 切り詰めも名前に効く**。絵文字のみの表示名は消えて「さんがメンバーシップに…」になり、
 *   名前が 40 文字以上だと要約自体が 048 の上限で切れる（Twitch は表示名 25 文字上限なので YouTube のみ該当）。
 *   いずれも音声だけの軽微な劣化で、名前を別扱いにすると単一チョークポイントが崩れるため対策しない。
 * - **表示名で読み上げ内容を詐称できる**（例「〇〇さんがサブスクを100ヶ月継続しました。実は」という表示名）。
 *   ただしチャット本文は元々全文が読まれるので**新しい攻撃能力ではなく**、影響は音声のみ（画面・保存・通信に
 *   及ばない）。再修正トリガー＝読み上げ内容を配信面へ出す（字幕化等）機能を作るとき。
 *
 * **例外を投げないことで安全を担保する**（049 レビュー Q-9）: 参照するのは `c.author.name` / `c.text` /
 * `c.monetary?.amount` だけで、前 2 者は DTO の必須フィールド（欠ければ表示側が先に壊れる）、3 つ目は
 * optional chaining 済み。ここで throw すると `enqueueForSpeech` の forEach どころか **`setComments` の
 * updater 内で throw する**（React の状態更新を巻き込む）ため、防御的な try/catch を足すのではなく
 * **「投げない実装を保つ」**ことを不変条件とする。
 * 再修正トリガー＝optional フィールドや外部入力を新たに参照するようになったとき。
 */
export function composeSpeechText(c: CommentViewDto): string {
  // 043b の `composeEventMessage` は jewels に null を返す（表示は金額バッジのみ）。読み上げでは無音になるため、
  // ここで**読み上げ専用の文言**を作る。表示側は一切変えないので表示の回帰リスクはゼロ（決定事項 2）。
  if (c.eventType === "jewels") {
    // 数値 `monetary.amount` を使い、整形済みの表示文字列 `monetaryAmount`（"30 jewels"）は使わない。
    // 表示文字列は末尾に英字 "jewels" が付き OpenJTalk が綴り読みするうえ、optional で欠落しうる。
    // 数値なら VOICEVOX がそのまま日本語の数詞で読む。
    const amount = c.monetary?.amount;
    // 0・負値・非有限は「数なし」へ倒す（「ジュエルを0贈りました」は日本語として破綻するため）。
    // `monetary` 自体が無いとき（実データで金額が付かない場合の保険）も同じ分岐に落ちる。
    const count =
      typeof amount === "number" && Number.isFinite(amount) && amount > 0
        ? `${amount}`
        : "";
    // 043e の combo 回数（`comboCount`）は**読まない**。combo 更新は mergeComments の `updated` に載り `added` へは
    // 来ないため再読み上げは起きず、初回到達時に値が入っていても意味が曖昧（公式仕様は「単発は 0」）で、
    // 048 の文字数上限を無駄に消費するため。
    // `c.text` も連結しない: 実データの jewels は本文を持たず、dev-mock だけが "投げ銭ジュエル 🎁" を入れている。
    // 連結すると dev と本番で読みが変わり、dev 確認が本番の担保にならなくなる（本タスクが直した罠そのもの）。
    return `${c.author.name}さんがジュエルを${count}贈りました`;
  }

  // `CommentViewDto` は `EventMessageInput`（eventType/source/author/monthCount/giftCount/tier）の上位互換なので
  // そのまま渡せる。null が返るのは chat/superchat/bits/donation/未知＝従来どおり本文だけを読む種別。
  const message = composeEventMessage(c);
  if (message === null) return c.text;

  // 049 フォローアップ: Tier は末尾ではなく**名前の直後**へ差し込む（日本語として自然な語順にするため）。
  const spoken = withSpokenTier(c, message);
  // 視聴者が添えた自由コメント（subscription で発生・membership/gift は実データでは空）を要約の後ろに続ける。
  // **順序は「要約 → 自由コメント」固定**: 048 の切り詰めは末尾から効くため、「誰が何をしたか」を先頭に置くと
  // 上限に当たっても要約は必ず残る。空白のみは trim で空判定に落ちて「。」も付かない。
  const body = c.text.trim();
  return body ? `${spoken}。${body}` : spoken;
}
