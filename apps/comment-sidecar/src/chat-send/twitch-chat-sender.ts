import { TWITCH_HELIX_API_BASE_URL } from "../twitch-config.js";

/**
 * 066: **Twitch のチャットへ 1 通送る**（Helix `POST /chat/messages`）。
 *
 * ⚠⚠⚠ **YouTube は対象外である**（依頼者の決定・2026-08-22）。理由は 2 つ:
 *   1. `youtube.readonly` → **`youtube.force-ssl`** が要り、同意画面が「**YouTube の管理**」相当になる
 *      ＝ **読み取り専用より明確に拒否されやすい**
 *   2. ⚠⚠ **クォータ**——書き込み系は 1 回 50 units・既定 10,000 units/日で **1 日およそ 200 通**、
 *      しかも**取得（streamList / search / videos）と同じ枠**を食う
 * ⇒ **YouTube 側のスコープは 1 文字も変えていない**（＝ YouTube だけの利用者に再ログインは発生しない）。
 * ⚠ **YouTube でチャットに書きたくなったら、まずクォータを実測すること。**
 *
 * ## ⚠⚠ 宛先の決め方
 *
 * **`broadcaster_id` は「いま取得しているチャンネル」から決める**（送信フレームには載らない・
 * `chat-send-frame.ts` の [`ChatSendFrame`] の注記が正）。`sender_id` は**ログイン中の本人**である。
 * ⚠⚠⚠ **security-review 066 S-2: その「いま取得しているチャンネル」自体は `start-session` 由来＝
 * viewer から来ており、チケットで守られていない。** ⚠ 段 1 の対処は画面表示だけである。
 * ⚠ どちらも `GET /users` で解決して**メモリに覚える**（毎回引かない）。
 * ⚠ **チャンネルが変わったら忘れる**（`setChannel` が担う）。
 *
 * ## §9
 *
 * ⚠⚠ **本文もトークンもログに出さない。** 返す `reason` は**ユーザーに見せる短文**だけで、
 * API のエラー本文をそのまま載せない（token や内部 id が混じりうる）。
 */

/** ⚠ 送信の結果。**throw しない**（呼び出し側が `reason` をそのまま画面に出す）。 */
export interface ChatSendResult {
  ok: boolean;
  reason?: string;
}

export interface TwitchChatSenderDeps {
  /** ログイン中の Twitch アクセストークンを返す（`authClient.refresh("twitch")`）。 */
  getAccessToken: () => Promise<string>;
  /** 焼き込み済みの公開 Client ID。⚠ 空なら送信できない（未設定ビルド）。 */
  clientId: string;
  /** ⚠ テスト用の差し替え口。**既定は global fetch**（host-guard を通る）。 */
  fetchImpl?: typeof fetch;
  /** ⚠ 既定は Helix の定数。**env で差し替えられない**（`twitch-config.ts` の方針）。 */
  helixBaseUrl?: string;
}

export interface TwitchChatSender {
  /** 取得セッションの開始／停止で呼ぶ。⚠ `null` にすると送信は「配信に接続していません」で落ちる。 */
  setChannel: (login: string | null) => void;
  /**
   * S-2b: **いま握っている宛先**を返す（未接続なら `null`）。
   *
   * ⚠⚠ **読むためだけに在る**——`chat-send-frame.ts` が
   * 「frontend が繋いでいるつもりの宛先」と突き合わせるのに使う。
   * ⚠ **これを使って宛先を「決める」経路を作らないこと**（決めるのは `setChannel` だけ）。
   */
  getChannel: () => string | null;
  send: (message: string) => Promise<ChatSendResult>;
}

/** Helix `GET /users` の必要な部分だけ。 */
interface HelixUsersResponse {
  data?: { id?: unknown; login?: unknown }[];
}

export function createTwitchChatSender(
  deps: TwitchChatSenderDeps,
): TwitchChatSender {
  // ⚠⚠ **ここで掴む `fetch` は「allow-list ガード済み」でなければならない。**
  //   `installHttpHostGuard()` が global の `fetch` を差し替える形なので、**掴む時点**で
  //   ガードが入っている必要がある。⚠ `index.ts` は top-level（import 直後・21 行目）で
  //   ガードを入れ、この関数は `main()` の中で呼ぶので**順序は満たしている**。
  //   ⚠⚠ **`main()` より前でこの関数を呼ばないこと**——素の `fetch` を掴み、
  //   §1 の「新規 egress 先ゼロ」が壁ごと外れる（レビュー指摘・後回し可の項）。
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = deps.helixBaseUrl ?? TWITCH_HELIX_API_BASE_URL;
  /** いま取得しているチャンネル（ログイン名）。⚠ **viewer からは絶対に受け取らない。** */
  let channelLogin: string | null = null;
  /** 解決済みの id（`channelLogin` が変わったら捨てる）。 */
  let broadcasterId: string | null = null;
  let senderId: string | null = null;

  const headers = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    "Client-Id": deps.clientId,
    "Content-Type": "application/json",
  });

  /** `GET /users` を 1 回引く。⚠ **失敗しても throw しない**（呼び出し側が reason を作る）。 */
  const fetchUserId = async (
    token: string,
    login: string | null,
  ): Promise<string | null> => {
    const url =
      login === null
        ? `${baseUrl}/users`
        : `${baseUrl}/users?login=${encodeURIComponent(login)}`;
    const res = await fetchImpl(url, { method: "GET", headers: headers(token) });
    if (!res.ok) return null;
    const body = (await res.json()) as HelixUsersResponse;
    const id = body.data?.[0]?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  };

  return {
    setChannel(login) {
      if (login === channelLogin) return;
      channelLogin = login;
      // ⚠ チャンネルが変わったら解決済みの id を捨てる（**別のチャンネルへ送らない**）。
      broadcasterId = null;
    },

    getChannel() {
      return channelLogin;
    },

    async send(message) {
      if (channelLogin === null) {
        return {
          ok: false,
          reason: "配信に接続していません。先にコメントの取得を開始してください。",
        };
      }
      if (deps.clientId.length === 0) {
        return {
          ok: false,
          reason: "Twitch 連携を利用できません。アプリを再インストール／アップデートしてください。",
        };
      }
      let token: string;
      try {
        token = await deps.getAccessToken();
      } catch {
        return { ok: false, reason: "Twitch にログインし直してください。" };
      }
      try {
        if (broadcasterId === null) {
          broadcasterId = await fetchUserId(token, channelLogin);
        }
        if (senderId === null) {
          senderId = await fetchUserId(token, null);
        }
        if (broadcasterId === null || senderId === null) {
          // ⚠ レビュー（後回し可）: ここは `GET /users` が **401 でも 404 でも同じ文**になる。
          //   401 のときだけ再ログインを促せると親切だが、`fetchUserId` に status を返させると
          //   **失敗の翻訳が 2 か所に散る**（下の 401/403 分岐と規則が割れる）。
          //   ⚠ **直すべき条件＝「送信先のチャンネルを特定できませんでした」が実機で
          //   原因不明の詰まりになったとき**。そのときは `fetchUserId` に status を返させ、
          //   翻訳は**この関数の中の 1 か所**にまとめること。
          return { ok: false, reason: "送信先のチャンネルを特定できませんでした。" };
        }
        const res = await fetchImpl(`${baseUrl}/chat/messages`, {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify({
            broadcaster_id: broadcasterId,
            sender_id: senderId,
            message,
          }),
        });
        if (res.status === 401 || res.status === 403) {
          // ⚠⚠ **043a の `bits:read` と同じ形**——スコープ拡大前のトークンはここで落ちる。
          //   本線（コメント取得）は止めず、**再ログインを促す文だけ**を返す。
          return {
            ok: false,
            reason:
              "チャットへの書き込みが許可されていません。Twitch にログインし直してください。",
          };
        }
        if (!res.ok) {
          // ⚠ API のエラー本文をそのまま返さない（§9）。
          return { ok: false, reason: "チャットへの送信に失敗しました。" };
        }
        return { ok: true };
      } catch {
        // ⚠ 例外の中身（URL・token）を返さない（§9）。
        return { ok: false, reason: "チャットへの送信に失敗しました。" };
      }
    },
  };
}
