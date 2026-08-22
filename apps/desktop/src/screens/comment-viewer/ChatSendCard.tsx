import { useState } from "react";
import { Button } from "../../components/primitives";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import { CHAT_SEND_ENABLED_KEY } from "../../features/comment-viewer/overlaySettings";
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
 * ## ⚠⚠ 門は 3 枚（どれも外さないこと）
 *
 * 1. **チケット**（Rust が採番 → stdin private pipe → sidecar が照合）…
 *    未認証の loopback WS へ繋いだだけのページが投稿する経路を塞ぐ。**これが壁である。**
 * 2. **このトグル（既定 OFF）** … ユーザーの明示的な同意。⚠ **既定を ON にしないこと。**
 * 3. ⚠⚠⚠ **自動送信の経路が 1 本も無い** … 段 1 で送信を起こせるのは**このボタンだけ**である。
 *    ⚠ **063b で自動送信を繋ぐときは、必ずここへ戻って 3 枚目が無くなることを意識すること。**
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
 * ⚠ 保存するのは**このトグルの真偽値だけ**。⚠⚠ **送った文も結果も保存しない**
 * （結果は state のみ＝窓を閉じれば消える）。⚠ チケットは**ここには 1 度も現れない**
 * （`commentStream.ts` が送信のたびに Rust から取り直す）。
 */

/** テスト送信の既定文。⚠ **視聴者に見える**ので、意味が伝わる短文にする。 */
const TEST_MESSAGE = "StreamDock のテスト送信です";

export function ChatSendCard({
  onTestSend,
  channel,
}: {
  /** ⚠ `CommentStreamHandle.sendChat`。**宛先は渡さない**（sidecar が接続中の配信から決める）。 */
  onTestSend: (message: string) => Promise<{ ok: boolean; reason?: string }>;
  /**
   * ⚠⚠⚠ **security-review 066 S-2 / S-2b: 送信先の表示に使う値。**
   *
   * ⚠⚠ **これは「宛先を決める値」ではない**（宛先は sidecar が取得セッションから決める）。
   * ⚠⚠⚠ **出す理由**: 実際の宛先の元になる `channel` は **`start-session` フレーム由来＝ viewer から来ており、
   * しかもチケットで守られていない**。⇒ **未認証の loopback WS に繋いだページが宛先を差し替えられる。**
   *
   * ⚠⚠⚠ **S-2b（レビュー 2 巡目）: 当初は「見える」ことだけが対処だったが、それは成立していなかった。**
   * ここに来るのは **frontend 自身が持っている入力値**で、sidecar が実際に握っている宛先ではない
   * ——**差し替えられても表示は変わらないので、気づけなかった**。
   * ⇒ いまは同じ値を `onTestSend` 経由で **sidecar へ「期待値」として送り、突き合わせている**
   * （不一致なら送らずに理由が返る）。⚠ **表示と突き合わせの値が同じであることが、この対処の全て**である。
   * ⚠ **この表示を消さないこと**（消すと「なぜ送れないのか」が画面から読めなくなる）。
   * ⚠⚠ **段 2（自動送信）の残りの宿題＝ `start-session` そのもののチケット化**
   * （突き合わせは「押した瞬間」しか守らない・docs/tasks/066-chat-send.md）。
   */
  channel: string;
}) {
  /**
   * ⚠⚠ **既定 OFF。** 読み取りに失敗したら OFF へ倒す（061h の「読めなかったら安全側」と同じ向き。
   * ⚠ こちらは「安全側＝送らない」である）。
   */
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAT_SEND_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  });
  /** ⚠ 送信の結果。**state にしか置かない**（§9・窓を閉じれば消える）。 */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [sending, setSending] = useState(false);

  const toggle = (next: boolean): void => {
    setEnabled(next);
    setResult(null);
    try {
      // ⚠ OFF は**キーごと消す**（「未保存＝OFF」と「明示的に OFF」を同じ状態に潰す・
      //   `saveOverlayTheme(null)` と同じ判断）。
      if (next) localStorage.setItem(CHAT_SEND_ENABLED_KEY, "1");
      else localStorage.removeItem(CHAT_SEND_ENABLED_KEY);
    } catch {
      /* 書けない環境では設定が残らないだけ（既定＝OFF で続く） */
    }
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
        {/* ⚠⚠⚠ **約束できることだけ書く**（061a Q-1）。⚠ いま自動送信は 1 本も無いので、
            「ガチャの結果が流れる」等と書かないこと。⚠ **063b で自動送信を繋いだら、ここを直すこと。** */}
        <p className={styles.note}>
          ⚠
          有効にすると、あなたのアカウント名でチャットに書き込めるようになります。書き込みは視聴者に見え、あとから消せません。
          いまは下のボタンを押したときだけ送信します（自動での書き込みはしません）。
        </p>
        <p className={styles.note}>
          ⚠ 初回は Twitch
          にログインし直す必要があります（書き込みの許可を得るため）。
          YouTube のチャットには対応していません。
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
      </div>
    </section>
  );
}
