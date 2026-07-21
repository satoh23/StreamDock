/**
 * YouTube Data API v3 liveChatMessages.streamList レスポンスのうち、
 * 現時点の実装で必要なフィールドに絞ったプロバイダ固有DTO。
 *
 * 注意:
 * - gRPC + proto-loader(keepCase: true) で受けるため、フィールド名は snake_case。
 * - DTO層は外部API仕様に寄せ、業務判断は mapper/usecase 層で行う。
 */
export type YouTubeLiveChatMessagesListResponseDto = {
  /** リソース種別。固定で youtube#liveChatMessageListResponse */
  kind: "youtube#liveChatMessageListResponse";
  /** レスポンスのETag */
  etag: string;
  /** 再接続時に使う次ページトークン */
  next_page_token?: string;
  /** チャットメッセージ一覧 */
  items: YouTubeLiveChatMessageDto[];
};

/** liveChatMessages リソースの1件 */
export type YouTubeLiveChatMessageDto = {
  /** メッセージID（重複排除キーとして利用可） */
  id: string;
  /** メッセージ本体情報 */
  snippet: YouTubeLiveChatMessageSnippetDto;
  /** 投稿者情報 */
  author_details: YouTubeLiveChatAuthorDetailsDto;
};

/** メッセージ本文・イベント種別などの本体情報 */
export type YouTubeLiveChatMessageSnippetDto = {
  /** メッセージ種別（例: TEXT_MESSAGE_EVENT, SUPER_CHAT_EVENT） */
  type: YouTubeLiveChatMessageType;
  /** 所属するライブチャットID */
  live_chat_id: string;
  /** 投稿者のチャンネルID */
  author_channel_id: string;
  /** 投稿日時（RFC3339 文字列） */
  published_at: string;
  /** 画面表示可能な本文を持つかどうか */
  has_display_content: boolean;
  /** 表示用本文（絵文字含む） */
  display_message: string;
  /** type=SUPER_CHAT_EVENT のときに付与 */
  super_chat_details?: YouTubeSuperChatDetailsDto;
  /** type=SUPER_STICKER_EVENT のときに付与 */
  super_sticker_details?: YouTubeSuperStickerDetailsDto;
  /** type=MEMBER_MILESTONE_CHAT_EVENT のときに付与 */
  member_milestone_chat_details?: YouTubeMemberMilestoneChatDetailsDto;
};

/**
 * YouTube Live Chat message type の既知集合。
 * 未知値が来ても受けられるように string フォールバックを許可する。
 *
 * 未知値を受け取る理由:
 * - DTO層は「外部APIから受け取った事実」を保持する責務であり、
 *   ここで未知値を弾くと API 側の仕様追加時に取得処理全体が停止するため。
 * - 未知値の扱いは mapper/usecase 層で明示的に行う
 *   （例: ログ出力して無視、unknownイベントとして変換、必要ならエラー化）。
 *
 * つまり「DTOでは受け取る」「業務判断は後段で行う」という責務分離を採用する。
 */
export type YouTubeLiveChatMessageType =
  | "TEXT_MESSAGE_EVENT"
  | "SUPER_CHAT_EVENT"
  | "SUPER_STICKER_EVENT"
  | "MEMBER_MILESTONE_CHAT_EVENT"
  | "NEW_SPONSOR_EVENT"
  | "MESSAGE_DELETED_EVENT"
  | "MESSAGE_RETRACTED_EVENT"
  | "USER_BANNED_EVENT"
  | "POLL_EVENT"
  | (string & {});

/** 投稿者情報 */
export type YouTubeLiveChatAuthorDetailsDto = {
  /** 投稿者チャンネルID */
  channel_id: string;
  /** 表示名 */
  display_name: string;
  /**
   * 036b: プロフィール画像 URL（アバター取得元）。リクエストの profile_image_size で小サイズを要求する。
   * 本文なしイベント等では欠落し得るため任意。gRPC chunk を直キャストで受けるため proto の keepCase 名と一致させる。
   */
  profile_image_url?: string;
};

/** スーパーチャット詳細 */
export type YouTubeSuperChatDetailsDto = {
  /** 金額（マイクロ単位。1,000,000 = 1通貨単位） */
  amount_micros: string;
  /** 通貨コード（ISO 4217） */
  currency: string;
};

/** スーパーステッカー詳細 */
export type YouTubeSuperStickerDetailsDto = {
  /** 金額（マイクロ単位） */
  amount_micros: string;
  /** 通貨コード（ISO 4217） */
  currency: string;
};

/** メンバー継続マイルストーンイベント詳細 */
export type YouTubeMemberMilestoneChatDetailsDto = {
  /** 継続月数 */
  member_month?: number;
};
