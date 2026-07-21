import { inject, injectable } from "tsyringe";
import { TWITCH_DI_TOKENS } from "../access-token/di-tokens.js";
import { mapTwitchChatEventsToComments } from "../mapper/comment.mapper.js";
import type { TwitchEventSubWebSocketClient } from "../client/eventsub-websocket.client.js";
import type { TwitchHelixClient } from "../client/helix.client.js";
import type {
  CommentRepository,
  FetchCommentsInput,
  FetchCommentsResult,
} from "../../../usecases/comment-collection/comment-repository.interface.js";

// Repositoryが必要とする最小機能だけに依存し、結合度とモック実装コストを下げるための境界。
interface TwitchCommentEventStreamApi {
  streamChatEvents: TwitchEventSubWebSocketClient["streamChatEvents"];
}

// 036c: 投稿者 ID→アバター URL キャッシュ（Layer A）の件数上限。メモリ上限・非永続。
// URL→data URI 変換側（036b resolveAvatarDataUri）の正 LRU 500 件と揃える。
const AVATAR_URL_CACHE_MAX = 500;

@injectable()
export class TwitchCommentRepository implements CommentRepository {
  // 036c: chatter_user_id → profile_image_url（未取得は null）。同一投稿者の Helix 再照会を避ける。
  // 挿入順で最古から落とす件数上限のみ・メモリ内・非永続（DB/ログには出さない）。
  private readonly avatarUrlCache = new Map<string, string | null>();

  constructor(
    @inject(TWITCH_DI_TOKENS.eventSubClient)
    private readonly eventSubClient: TwitchCommentEventStreamApi,
    @inject(TWITCH_DI_TOKENS.helixClient)
    private readonly helixClient: TwitchHelixClient,
  ) {}

  async *streamComments(
    input: FetchCommentsInput,
  ): AsyncIterable<FetchCommentsResult> {
    const selfUserId = await this.helixClient.getSelfUserId();

    for await (const event of this.eventSubClient.streamChatEvents({
      broadcasterUserId: input.liveChatId,
      userId: selfUserId,
    })) {
      // 036c: chat イベントにアバターが載らないため Helix で URL を解決してから mapper へ渡す。
      // キャッシュ済み投稿者は Helix を叩かない（過剰呼び出し防止）。
      // 【レビュー対応・修正不要】現状は 1 id ずつ解決（getUserProfileImagesByIds のバッチ形は将来の
      // ウィンドウ化への備えで、今は単一 id 呼び出し）。per-event await のためレイド時に未キャッシュ新規
      // 投稿者の解決が直列化するが、キャッシュで各投稿者最大 1 回に抑制済み＋Helix にタイムアウト有り。
      // 再修正トリガー: レイド時の配信遅延が実測で問題化したら、複数 id をまとめる window/バッチ化を導入する。
      await this.ensureAvatarResolved(event.chatter_user_id);

      yield {
        comments: mapTwitchChatEventsToComments(
          [event],
          (chatterUserId) => this.avatarUrlCache.get(chatterUserId) ?? undefined,
        ),
        // Twitch EventSub は pageToken を持たないため常に undefined。
        nextPageToken: undefined,
      };
    }
  }

  /**
   * 036c: chatter_user_id のアバター URL を Helix で解決し Layer A キャッシュへ入れる。
   * 既に解決済み（成功/URL 不在いずれも）なら再照会しない。Helix が throw した一過性失敗は
   * キャッシュに入れず、次コメントで再試行できるようにする（毒キャッシュ回避）。
   */
  private async ensureAvatarResolved(chatterUserId: string): Promise<void> {
    if (this.avatarUrlCache.has(chatterUserId)) {
      return;
    }

    try {
      const resolved = await this.helixClient.getUserProfileImagesByIds([
        chatterUserId,
      ]);
      this.rememberAvatarUrl(chatterUserId, resolved.get(chatterUserId) ?? null);
    } catch {
      // Helix 照会失敗はアバター無しで続行し、キャッシュしない（コメント配信は止めない）。
      // 【レビュー対応・修正不要】UnauthorizedRequestError / タイムアウト(AbortError) 含む全例外を握りつぶすのは
      // 意図的（アバターは best-effort・本線を止めない）。EventSub 本線は別トークン経路のため、ここで認証系を
      // silent にしても本線配信には影響しない。再修正トリガー: 恒常的なトークン不整合で毎コメント Helix を叩き
      // 続ける等の実害が観測されたら、redact 済み URL で 1 回だけ warn する観測性を足す（§9 の非ログ方針と両立させる）。
    }
  }

  private rememberAvatarUrl(chatterUserId: string, url: string | null): void {
    if (
      !this.avatarUrlCache.has(chatterUserId) &&
      this.avatarUrlCache.size >= AVATAR_URL_CACHE_MAX
    ) {
      const oldestKey = this.avatarUrlCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.avatarUrlCache.delete(oldestKey);
      }
    }
    this.avatarUrlCache.set(chatterUserId, url);
  }
}
