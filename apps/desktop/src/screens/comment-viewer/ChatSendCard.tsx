import { useState } from "react";
import { Button } from "../../components/primitives";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import {
  loadChatSendEnabled,
  saveChatSendEnabled,
  saveGachaChatEnabled,
} from "../../features/comment-viewer/overlaySettings";
import styles from "./CommentViewerApp.module.css";

/**
 * 066: **配信のチャットへ書き込む**（⚠⚠⚠ **StreamDock 初の「書き込み」機能**）。
 *
 * ## ⚠⚠⚠ これまでと何が違うのか
 *
 * StreamDock の失敗はこれまで全部「**出ない・鳴らない**」だった（061h が「黙って出る」を最悪と
 * 定めて既定を反転させたのも、実害がその範囲に収まっていたから）。
 * ⚠⚠ **書き込みは視聴者に見えて、消せない。** ⇒ **誤爆の重さがまったく違う。**
 *
 * ## ⚠⚠⚠ 門は **2 枚**（⚠ **063f で 3 枚目が無くなった**・どちらも外さないこと）
 *
 * 1. **チケット**（Rust が採番 → stdin private pipe → sidecar が照合）…
 *    未認証の loopback WS へ繋いだだけのページが投稿する経路を塞ぐ。**これが壁である。**
 * 2. **このカードのトグル（既定 OFF）** … ユーザーの明示的な同意。⚠ **既定を ON にしないこと。**
 *    ⚠⚠⚠ **063f でトグルは 2 つになった**（「書き込みを許可する」＋「ガチャの結果を自動で書き込む」）。
 *    **両方が ON のときだけ自動送信が 1 通出る**（AND・判定の持ち主は `loadGachaChatEnabled` 1 か所）。
 *    ⚠⚠⚠ **063f 段 1-b: 2 枚目は「OBSエフェクト」画面（`GachaLibraryCard` の「高度な設定」）へ移った**
 *    ——依頼者の指示「**ガチャ機能でしか使わない予定なのでまとめたい**」。
 *    ⚠⚠ **同意の 2 枚が別々の窓に分かれた**ので、**あちらには親（このトグル）の状態を出してある**。
 *    ⚠ **このカードに残っているのは「親」と「自動送信の結果表示」と「在り処の案内」**である。
 * 3. ~~**自動送信の経路が 1 本も無い**~~ … ⚠⚠⚠ **2026-08-29・063f で外した。**
 *    送信を起こせるのは**このボタンだけ**ではなくなり、**ガチャの当選**でも起きる
 *    （`CommentViewerApp` の `sendGachaChat`）。⚠ **ユーザーが画面を見ていないときに走る。**
 *    ⚠⚠ **残る 2 枚で足りると判断した根拠は `docs/security.md` §1 の「追補（063f）」が正**
 *    ——ここに書き写さないこと（2 通りに書くと片方だけ古くなる）。
 *    ⚠⚠⚠ **送信の契機をさらに増やすときは、必ずあの追補を読み直すこと。**
 *
 * ## ⚠ Twitch だけである
 *
 * **YouTube は対象外**（依頼者の決定・2026-08-22）。①`youtube.force-ssl` は同意画面が
 * 「YouTube の管理」相当になり拒否されやすい ②書き込みは 1 回 50 units・既定 10,000 units/日で
 * **取得と枠を共用**する（＝1 日およそ 200 通で頭打ち）。
 * ⇒ ⚠ **YouTube だけを使っている人には、この機能は無い**。画面でもそう書く（黙って効かないを作らない）。
 *
 * ## §9
 *
 * ⚠ 保存するのは**トグル 2 つの真偽値だけ**。⚠⚠ **送った文も結果も保存しない**
 * （結果は state のみ＝窓を閉じれば消える）。⚠ チケットは**ここには 1 度も現れない**
 * （`commentStream.ts` が送信のたびに Rust から取り直す）。
 * ⚠⚠⚠ **063f: 自動送信の結果も同じ扱いである**（[`gachaChatResult`] は親の state で、
 * **最後の 1 件を上書きし続ける**＝ **送ったものの記録を残さない**）。⚠ **記録にしないこと。**
 */

/** テスト送信の既定文。⚠ **視聴者に見える**ので、意味が伝わる短文にする。 */
const TEST_MESSAGE = "StreamDock のテスト送信です";

export function ChatSendCard({
  onTestSend,
  channel,
  gachaChatResult,
}: {
  /** ⚠ `CommentStreamHandle.sendChat`。**宛先は渡さない**（sidecar が接続中の配信から決める）。 */
  onTestSend: (message: string) => Promise<{ ok: boolean; reason?: string }>;
  /**
   * ⚠⚠⚠ **security-review 066 S-2 / S-2b: 送信先の表示に使う値。**
   *
   * ⚠⚠ **これは「宛先を決める値」ではない**（宛先は sidecar が取得セッションから決める）。
   * ⚠⚠⚠ **出す理由**: 実際の宛先の元になる `channel` は **`start-session` フレーム由来＝ viewer から来ている**。
   * ✅ **066 段 2 でその `start-session` 自体をチケット必須にした**（2026-08-23）ので、
   * **未認証の loopback WS から差し替える経路は塞がった**——⚠⚠ **それでもこの表示と突き合わせは残す**
   * （チケットは「アプリの窓から来たこと」しか担保せず、**窓が別の配信に繋ぎ直したこと**は担保しない）。
   *
   * ⚠⚠⚠ **S-2b（レビュー 2 巡目）: 当初は「見える」ことだけが対処だったが、それは成立していなかった。**
   * ここに来るのは **frontend 自身が持っている入力値**で、sidecar が実際に握っている宛先ではない
   * ——**差し替えられても表示は変わらないので、気づけなかった**。
   * ⇒ いまは同じ値を `onTestSend` 経由で **sidecar へ「期待値」として送り、突き合わせている**
   * （不一致なら送らずに理由が返る）。⚠ **表示と突き合わせの値が同じであることが、この対処の全て**である。
   * ⚠ **この表示を消さないこと**（消すと「なぜ送れないのか」が画面から読めなくなる）。
   * ✅ **段 2（`start-session` のチケット化）は完了した**（2026-08-23）。
   * ✅ ⚠⚠⚠ **自動送信（`docs/tasks/063f-gacha-chat-output.md`・旧「066 段 3」）も入った**
   * （2026-08-29）＝ **門の 3 枚目は無くなった**（上の「門は 2 枚」の節が正）。
   * ⚠⚠ **突き合わせの重みはむしろ増している**——自動送信には「押した瞬間」が無く、
   * `CommentViewerApp` は**この表示と同じ `channel` state**を期待値として渡している。
   * ⚠ **表示に使う値と、あちらが渡す値をずらさないこと**（ずれると検査の意味が消える）。
   */
  channel: string;
  /**
   * ⚠⚠⚠ **063f: 直近の「自動送信」の結果**（`null` ＝まだ 1 度も走っていない）。
   *
   * ⚠⚠⚠ **自動送信はユーザーが画面を見ていないときに走る**ので、
   * **失敗をその場で見せる相手がいない**。⇒ **最後の 1 件をここに残す**のが対処である
   * （061a Q-1「黙って効かない、を作らない」）。
   * ⚠⚠ **上の `result`（テスト送信の結果）と別枠にしてある**——混ぜると
   * 「押していないのにテスト送信の結果が変わった」ように見える。
   * ⚠ **§9: 本文も宛先も載っていない**（`ok` と定型の短文だけ）。**保存もしない。**
   */
  gachaChatResult: { ok: boolean; text: string } | null;
}) {
  /**
   * ⚠⚠ **既定 OFF。** 読み取りに失敗したら OFF へ倒す（061h の「読めなかったら安全側」と同じ向き。
   * ⚠ こちらは「安全側＝送らない」である）。
   */
  const [enabled, setEnabled] = useState<boolean>(() => loadChatSendEnabled());
  /** ⚠ 送信の結果。**state にしか置かない**（§9・窓を閉じれば消える）。 */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [sending, setSending] = useState(false);

  const toggle = (next: boolean): void => {
    setEnabled(next);
    setResult(null);
    // ⚠ OFF は**キーごと消す**（「未保存＝OFF」と「明示的に OFF」を同じ状態に潰す・
    //   `saveOverlayTheme(null)` と同じ判断）。⚠ 063f で規則を `overlaySettings.ts` へ寄せた。
    saveChatSendEnabled(next);
    // ⚠⚠⚠ **親を OFF にしたら子の旗（ガチャの自動書き込み）も消す。**
    //   残すと **`GACHA_CHAT_ENABLED_KEY` が true のまま端末に残り**、
    //   次に親を ON にした瞬間に**自動送信がユーザーの操作ゼロで復活する**。
    //   ⚠ 063c 段 1 の「旗を落とす契機を減らさない」と同じ規律で、**安全側へ倒す。**
    //   ⚠⚠⚠ **063f 段 1-b: 子のトグル自体は OBS エフェクト画面へ移った**が、
    //   **この連動は親の側に残す**（`docs/security.md` §1「追補（063f）」）——
    //   あちらは親を OFF にできないので、ここで落とさないと誰も落とさない。
    //   ⚠ あちらの画面は `storage` を購読しているので、開いていればその場でトグルが落ちる。
    if (!next) saveGachaChatEnabled(false);
  };

  const testSend = async (): Promise<void> => {
    // ⚠⚠ **トグルが OFF なら呼ばない。** ボタンも `disabled` だが、
    //   「押せてしまう経路が将来できたときに送ってしまう」形を残さない（二重で見る）。
    if (!enabled || sending) return;
    setSending(true);
    setResult(null);
    const r = await onTestSend(TEST_MESSAGE);
    setSending(false);
    setResult({
      ok: r.ok,
      // ⚠ 失敗の理由は sidecar が作った短文をそのまま出す（本文も token も載っていない・§9）。
      text: r.ok
        ? "送信しました。配信のチャットを確認してください。"
        : (r.reason ?? "送信に失敗しました。"),
    });
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h3>チャットに書き込む</h3>
        <p>
          StreamDock から配信のチャットへメッセージを送れるようにします（Twitch
          のみ）。
        </p>
      </div>
      <div className={styles.cardBody}>
        {/* ⚠⚠ **既定 OFF。** ⚠ label に「Twitch のみ」を入れないのは、見出し下の説明で
            既に述べているため（同じことを 2 か所に書かない・061p の規律）。 */}
        <ToggleSwitch
          label="チャットへの書き込みを許可する"
          checked={enabled}
          onChange={toggle}
        />
        {/* ⚠⚠⚠ **約束できることだけ書く**（061a Q-1）。
            ⚠⚠⚠ **063f で「自動での書き込みはしません」を消した**——下のトグルを ON にすると
            ガチャの当選で自動送信が走るので、あの 1 文は**嘘になった**。
            ⚠ **送信の契機を増やしたら、必ずこの文も直すこと。** */}
        <p className={styles.note}>
          ⚠
          有効にすると、あなたのアカウント名でチャットに書き込めるようになります。書き込みは視聴者に見え、あとから消せません。
          下のボタンを押したときと、「ガチャの結果を自動で書き込む」を ON
          にしたときのガチャ当選時に送信します。
        </p>
        <p className={styles.note}>
          ⚠ 初回は Twitch
          にログインし直す必要があります（書き込みの許可を得るため）。
          YouTube のチャットには対応していません。
        </p>
        {/* ⚠⚠⚠ **063f 段 1-b: 自動送信のトグルは OBS エフェクト画面へ移した**
            （依頼者の指示＝「**ガチャ機能でしか使わない予定なのでまとめたい**」）。
            ⚠⚠ **この 1 行を消さないこと**——消すと、**このカードだけを見た人には
            「自動で書き込まれることがある」という事実が読めなくなる**。
            ⚠ 上の警告文（視聴者に見えて消せない）はここに在り続けるので、
            **同意の重さを説明している場所と、設定の在り処が、必ず 1 本の線でつながる。** */}
        <p className={styles.note}>
          ⚠ ガチャの結果を自動で書き込む設定は、「OBSエフェクト」画面の「ガチャ」にある
          「高度な設定」です（このトグルが ON のときだけ有効になります）。
        </p>
        {/* ⚠⚠⚠ S-2: **送信先を必ず出す。** 見えていないと、差し替えられても気づけない。 */}
        <p className={styles.note}>
          送信先: {channel.trim().length > 0 ? channel.trim() : "（未接続）"}
        </p>
        {/* ⚠ ボタンの意匠は既存の compact ボタンに揃える（新しい px を発明しない・061a の要件）。 */}
        <Button
          type="button"
          onClick={() => void testSend()}
          disabled={!enabled || sending}
        >
          テスト送信
        </Button>
        {result !== null && (
          <p className={result.ok ? styles.note : styles.errorText}>
            {result.text}
          </p>
        )}
        {/* ⚠⚠⚠ **063f: 直近の自動送信の結果。** ⚠ **自動送信は画面を見ていないときに走る**ので、
            ここに残さないと「黙って効かない」になる（061a Q-1）。
            ⚠ **§9: 本文も宛先も出さない**（sidecar が作った定型の短文だけ）。 */}
        {gachaChatResult !== null && (
          <p
            className={gachaChatResult.ok ? styles.note : styles.errorText}
          >{`ガチャの自動書き込み: ${gachaChatResult.text}`}</p>
        )}
      </div>
    </section>
  );
}
