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
  /** 043d: type=MEMBERSHIP_GIFTING_EVENT（贈与側）のときに付与 */
  membership_gifting_details?: YouTubeMembershipGiftingDetailsDto;
  /** 043d: type=GIFT_EVENT（Jewels）のときに付与 */
  gift_details?: YouTubeGiftDetailsDto;
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
 *
 * 043d: 公式ガイド掲載の proto（stream-list-proto.ts の出典参照）の enum Type と**同じ集合**に揃えた。
 * 旧 vendored 独自値だった MESSAGE_DELETED_EVENT / MESSAGE_RETRACTED_EVENT は公式に存在しないため
 * proto と併せて除去した（参照ゼロを確認済み。未知値は下の string フォールバックで受かる）。
 *
 * 043d(レビュー指摘・2026-07-27／修正不要と判断): **未知の enum 値は実行時に `number` で届く**
 * （protobufjs は `enums: String` でも valuesById に無い値を数値のままフォールバックする。実測確認済み）。
 * つまり `(string & {})` は数値を救えず、本 union は実行時に対して厳密には嘘になる。それでも修正
 * しないのは、唯一の利用箇所が mapper の `type in YOUTUBE_MESSAGE_TYPE_TO_COMMENT_EVENT_TYPE` で、
 * `in` は数値を文字列化して引くため**未知値は正しく除外され実害がゼロ**だから（`| number` を足すと
 * 逆に「数値 type を業務的に扱う」誤読を招く）。再修正トリガー: type を文字列前提で加工する処理
 * （比較・整形・保存など）を新設するなら、その時点で `| number` を足すか正規化関数を挟むこと。
 */
export type YouTubeLiveChatMessageType =
  | "TEXT_MESSAGE_EVENT"
  | "TOMBSTONE"
  | "FAN_FUNDING_EVENT"
  | "CHAT_ENDED_EVENT"
  | "SPONSOR_ONLY_MODE_STARTED_EVENT"
  | "SPONSOR_ONLY_MODE_ENDED_EVENT"
  | "NEW_SPONSOR_EVENT"
  | "USER_BANNED_EVENT"
  | "SUPER_CHAT_EVENT"
  | "SUPER_STICKER_EVENT"
  | "MEMBER_MILESTONE_CHAT_EVENT"
  // 043d: メンバーシップギフト。贈与側のみ mapper で扱い、受領側は**意図的に非マップ**（決定1）。
  | "MEMBERSHIP_GIFTING_EVENT"
  | "GIFT_MEMBERSHIP_RECEIVED_EVENT"
  | "POLL_EVENT"
  // 043d: 縦型ライブの Jewels ギフト。
  | "GIFT_EVENT"
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

/**
 * スーパーチャット詳細
 *
 * 043d: proto 側の amount_micros は公式どおり uint64（旧 vendored の string 宣言はワイヤ型不一致のバグ）。
 * それでも本 DTO が string のままで正しいのは、loadSync に `longs: String` を指定しており（api.client.ts）
 * uint64 が JS へ**文字列で届く**ため。型を number に変えると桁落ちの余地を作るので string を維持する。
 *
 * 043d(レビュー指摘・2026-07-27／修正不要と判断): この「proto は uint64／DTO は string」という非対称は
 * `longs: String` オプションへの暗黙の依存である。放置してよいのは、scripts/test-youtube-mapper.mjs の
 * スパチャ往復テストが `amount_micros: "1000000000"` → `amount: 1000` を固定しており、`longs` を変えると
 * 必ず FAIL してレッドで気付けるため（＝コメントだけでなくテストで担保されている）。
 * 再修正トリガー: api.client.ts の loadSync オプションから `longs: String` を外す／変更するなら、本 DTO を
 * number へ揃えるか変換層を挟むこと（同時に上記テストの期待値も見直す）。
 */
export type YouTubeSuperChatDetailsDto = {
  /** 金額（マイクロ単位。1,000,000 = 1通貨単位） */
  amount_micros: string;
  /** 通貨コード（ISO 4217） */
  currency: string;
};

/** スーパーステッカー詳細（amount_micros が string である根拠は YouTubeSuperChatDetailsDto と同じ） */
export type YouTubeSuperStickerDetailsDto = {
  /** 金額（マイクロ単位） */
  amount_micros: string;
  /** 通貨コード（ISO 4217） */
  currency: string;
};

/** メンバー継続マイルストーンイベント詳細 */
export type YouTubeMemberMilestoneChatDetailsDto = {
  /** 継続月数（043d: proto の番号を公式の member_month = 2 へ修正済み。旧 1 は member_level_name） */
  member_month?: number;
};

/**
 * 043d: メンバーシップギフト（贈与側）詳細。
 * 受信するのは件数（数値）だけで、gift_memberships_level_name は採用しない（§9・表示要件なし）。
 */
export type YouTubeMembershipGiftingDetailsDto = {
  /** 贈ったメンバーシップの件数 */
  gift_memberships_count?: number;
};

/**
 * 043d: Jewels ギフト詳細。
 * 受信するのはジュエル数（数値）だけ。gift_name/gift_url/alt_text 等のギフト資産情報は
 * 採用しない（gift_url は画像取得＝CSP・§9 の新たな論点を生むため）。
 *
 * 043e: combo（連続ギフト）の回数 `combo_count` を追加した（整数のみ・個人情報なし）。
 */
export type YouTubeGiftDetailsDto = {
  /** ジュエル数（仮想通貨・micros ではなく個数がそのまま届く） */
  jewels_amount?: number;
  /**
   * 043e: combo 回数。公式は「The combo count of the gift; 0 if not a combo」＝**単発は 0**。
   * mapper で 0 以下は undefined へ落とす（mapGiftCount と同じ方針＝「combo 0 回」という文言を作らない）。
   */
  combo_count?: number;
};
