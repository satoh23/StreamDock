// 032c-d(stream-dock・スパイク1 proto-under-SEA の解決): osareview の `stream_list.proto` を **文字列として同梱**する。
//
// なぜ文字列埋め込みか: sidecar は単一ファイル SEA（Node Single Executable Application）で配布するため、
// `@grpc/proto-loader` の `loadSync(<path>)` が実ファイルとして読める `stream_list.proto` がディスク上に無い
// （SEA には隣接ファイルが存在しない）。そこで proto をこのモジュールに文字列として埋め込み、起動時に一度
// OS の一時ディレクトリへ書き出してその一時パスを `loadSync` に渡す（youtube-grpc-runtime.ts）。これにより
// SEA / 開発（tsx・非 SEA）の双方で同一経路で動く（`import.meta.url` 依存を排除）。
//
// ⚠ フィールド番号は load-bearing（`next_page_token=100602` / `channel_id=10101` 等）。YouTube Data API v3
//   `liveChatMessages.streamList` の内部 gRPC スキーマに一致させること。osareview の
//   backend/comment-fetcher/src/adapters/youtube/client/stream_list.proto の**逐語コピー**（単一の正）。
export const STREAM_LIST_PROTO = `syntax = "proto2";

package youtube.api.v3;

service V3DataLiveChatMessageService {
  rpc StreamList (LiveChatMessageListRequest) returns (stream LiveChatMessageListResponse) {}
}

message LiveChatMessageListRequest {
  optional string live_chat_id = 1;
  optional string hl = 2;
  optional uint32 profile_image_size = 3;
  optional uint32 max_results = 98;
  optional string page_token = 99;
  repeated string part = 100;
}

message LiveChatMessageListResponse {
  optional string kind = 200;
  optional string etag = 201;
  optional string offline_at = 2;
  optional string next_page_token = 100602;
  repeated LiveChatMessage items = 1007;
}

message LiveChatMessage {
  optional string kind = 200;
  optional string etag = 201;
  optional string id = 101;
  optional LiveChatMessageSnippet snippet = 2;
  optional LiveChatMessageAuthorDetails author_details = 3;
}

message LiveChatMessageSnippet {
  enum Type {
    INVALID_TYPE = 0;
    TEXT_MESSAGE_EVENT = 1;
    NEW_SPONSOR_EVENT = 7;
    SUPER_CHAT_EVENT = 15;
    SUPER_STICKER_EVENT = 16;
    MEMBER_MILESTONE_CHAT_EVENT = 17;
    MESSAGE_DELETED_EVENT = 8;
    MESSAGE_RETRACTED_EVENT = 9;
    USER_BANNED_EVENT = 10;
    POLL_EVENT = 20;
  }

  optional Type type = 1;
  optional string live_chat_id = 201;
  optional string author_channel_id = 301;
  optional string published_at = 4;
  optional bool has_display_content = 17;
  optional string display_message = 16;
  optional SuperChatDetails super_chat_details = 27;
  optional SuperStickerDetails super_sticker_details = 28;
  optional MemberMilestoneChatDetails member_milestone_chat_details = 30;
}

message LiveChatMessageAuthorDetails {
  optional string channel_id = 10101;
  optional string display_name = 103;
  // 036b: 投稿者プロフィール画像 URL（アバター取得元）。リクエストの profile_image_size=48 で CDN が
  // 小サイズ URL を返す。converter が data URI 化する（sidecar 内完結・§CSP 不変）。
  // ⚠ フィールド番号 104 は **未確定（要実レスポンス検証）**: osareview の正 proto にも本フィールドは無く
  //   逐語コピー元が存在しないため、display_name=103 に隣接する reverse-engineered 値 104 を暫定採用している。
  //   フィールド番号が実スキーマと異なる場合は profile_image_url が空のまま（=avatar undefined→グレー丸）で
  //   クラッシュはしない。実配信で author_details の生メッセージを一度確認し、正しい番号へ確定すること。
  optional string profile_image_url = 104;
}

message SuperChatDetails {
  optional string amount_micros = 1;
  optional string currency = 2;
}

message SuperStickerDetails {
  optional string amount_micros = 1;
  optional string currency = 2;
}

message MemberMilestoneChatDetails {
  optional uint32 member_month = 1;
}
`;
