// 032c-d(stream-dock・スパイク1 proto-under-SEA の解決): `stream_list.proto` を **文字列として同梱**する。
//
// なぜ文字列埋め込みか: sidecar は単一ファイル SEA（Node Single Executable Application）で配布するため、
// `@grpc/proto-loader` の `loadSync(<path>)` が実ファイルとして読める `stream_list.proto` がディスク上に無い
// （SEA には隣接ファイルが存在しない）。そこで proto をこのモジュールに文字列として埋め込み、起動時に一度
// OS の一時ディレクトリへ書き出してその一時パスを `loadSync` に渡す（youtube-grpc-runtime.ts）。これにより
// SEA / 開発（tsx・非 SEA）の双方で同一経路で動く（`import.meta.url` 依存を排除）。
//
// 【出典（043d・2026-07-27 に単一の正を差し替え）】YouTube Live Streaming API の**公式ガイド**
//   https://developers.google.com/youtube/v3/live/streaming-live-chat
//   に `stream_list.proto` の全文（enum 整数値・フィールド番号込み）がインライン掲載されている。
//   メソッド仕様は https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList
//   ⚠ フィールド番号は load-bearing（`next_page_token=100602` / `channel_id=10101` 等）。番号を変える場合は
//     必ず上記公式ガイドを正とすること（旧出典の「osareview 逐語コピー」からは 043d で移行済み）。
//
// 【公式との意図的な差分（ワイヤ表現は同一・mapper から見た挙動も同一）】
//   ※ レビュー指摘（2026-07-27）で「デコード結果も変わらない」は不正確と判明したため表現を訂正。
//     ワイヤ表現は等価だが、**デコード後の JS オブジェクトの形は違う**（下記 1 の実測差分を参照）。
//   1. `oneof displayed_content`: 公式は詳細メッセージ 10 種を oneof に入れるが、oneof のワイヤ表現は
//      flat な optional と同一。採用すると `oneofs: true`（api.client.ts）により `displayed_content` 仮想
//      プロパティが DTO に増えるだけなので、flat な optional のまま宣言する。
//      実測差分（protobufjs の converter.toObject は `partOf`＝oneof 所属フィールドを既定値ブロックから
//      除外する）: flat 宣言では不在の details に `null` が入り、oneof 宣言ではキー自体が現れない。
//      mapper は `?.` / `??` で null を吸収するため**挙動差は無い**が、`defaults: true` で 0 / null が
//      入るのは flat 宣言を選んだことの副作用である（mapGiftCount / mapJewelsAmount の 0 対策の前提）。
//      複数 details が同時に立った場合も flat / oneof とも全値を保持するため mapper の優先順位は不変。
//   2. `TypeWrapper.Type` ネスト: 公式は enum を `message TypeWrapper` で包むが enum のワイヤ表現は varint で
//      同一のため、`enum Type` 直置きを維持する（TS 側の参照は V3DataLiveChatMessageService のみ）。
//   3. 未採用フィールドは宣言せず**番号だけコメントに記録**する。未宣言フィールドはワイヤ型に従って
//      安全にスキップされる（＝受信データ項目を増やさずに出典の完全性だけ残す）。
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
  // 未採用（公式）: page_info = 1004 / active_poll_item = 1008
  optional string kind = 200;
  optional string etag = 201;
  optional string offline_at = 2;
  optional string next_page_token = 100602;
  repeated LiveChatMessage items = 1007;
}

message LiveChatMessage {
  optional string kind = 200;
  optional string etag = 201;
  // 【043e で対応済み(2026-07-27)】公式ガイドの proto は本フィールドに
  //   「Note: For giftEvents, the same ID may be reused to update the combo count.」と明記している。
  //   つまり **GIFT_EVENT（Jewels）だけは同一 id が combo_count 更新のために再送される**。
  //   043d 時点の帰結（過少計上）: 3 層すべて（frontend mergeComments の id 重複排除／ttsQueue の seenIds／
  //   Rust の INSERT OR IGNORE INTO viewer_comments）が 2 件目以降を捨てるため、combo 更新が Rust に到達せず
  //   **連続ギフトの Jewels が 1 回ぶんしか記録されなかった**。
  //   043e フェーズ1 の対応: LiveChatGiftDetails.combo_count = 8 を宣言（下記）し、mergeComments の updated
  //   バケット経由で Rust まで到達させ、event_type='jewels' 限定で既存行の amount を差し替える。
  //   **換算は最新の jewels_amount をそのまま採り乗算しない**（意味論が公式に無いため＝推測ゼロ原則）。
  //   残り（フェーズ2）: 実データで jewels_amount が「単価」と確定したら mapJewelsAmount に
  //   × max(combo_count, 1) を入れる（comment.mapper.ts のコメント参照）。
  optional string id = 101;
  optional LiveChatMessageSnippet snippet = 2;
  optional LiveChatMessageAuthorDetails author_details = 3;
}

message LiveChatMessageSnippet {
  // 043d: 公式ガイド掲載の enum 集合に整合させた。公式に存在しない MESSAGE_DELETED_EVENT = 8 /
  //   MESSAGE_RETRACTED_EVENT = 9（旧 vendored の独自値）は削除済み。未知の整数は enums:String でも
  //   数値のまま届き、mapper の「未対応 type は除外」で落ちるため退行はしない。
  enum Type {
    INVALID_TYPE = 0;
    TEXT_MESSAGE_EVENT = 1;
    TOMBSTONE = 2;
    FAN_FUNDING_EVENT = 3;
    CHAT_ENDED_EVENT = 4;
    SPONSOR_ONLY_MODE_STARTED_EVENT = 5;
    SPONSOR_ONLY_MODE_ENDED_EVENT = 6;
    NEW_SPONSOR_EVENT = 7;
    USER_BANNED_EVENT = 10;
    SUPER_CHAT_EVENT = 15;
    SUPER_STICKER_EVENT = 16;
    MEMBER_MILESTONE_CHAT_EVENT = 17;
    // 043d: メンバーシップギフト（贈与側＝購入者本人）。mapper で eventType=gift へ写す。
    MEMBERSHIP_GIFTING_EVENT = 18;
    // 043d(決定1): 受領側は 1 購入につき受領者数ぶん発火するため**取り込まない**（二重計上ゼロ）。
    //   enum 値だけ宣言して出典の完全性を残し、詳細メッセージ（= 32）は宣言しない。
    GIFT_MEMBERSHIP_RECEIVED_EVENT = 19;
    POLL_EVENT = 20;
    // 043d: 縦型ライブの Jewels ギフト。mapper で eventType=jewels へ写す。
    GIFT_EVENT = 21;
  }

  // 未採用（公式）: text_message_details = 19 / user_banned_details = 22 / new_sponsor_details = 29 /
  //   poll_details = 33
  // 未採用（公式・043d 決定1）: gift_membership_received_details = 32
  //   → 受領側イベントを扱わないため宣言しない。受贈者情報（member_level_name / gifter_channel_id /
  //     associated_membership_gifting_message_id）を**そもそも受信しない**＝security.md §9 と最整合。
  //     再検討トリガー: 「誰が受け取ったか」を表示したい要望が出たら、集計対象外の新種別として起票し直す
  //     （membership 流用は subscription_count が N+1 に膨らむため不可）。
  optional Type type = 1;
  optional string live_chat_id = 201;
  optional string author_channel_id = 301;
  optional string published_at = 4;
  optional bool has_display_content = 17;
  optional string display_message = 16;
  optional LiveChatSuperChatDetails super_chat_details = 27;
  optional LiveChatSuperStickerDetails super_sticker_details = 28;
  optional LiveChatMemberMilestoneChatDetails member_milestone_chat_details = 30;
  optional LiveChatMembershipGiftingDetails membership_gifting_details = 31;
  optional LiveChatGiftDetails gift_details = 34;
}

message LiveChatMessageAuthorDetails {
  // 未採用（公式）: channel_url = 102 / is_verified = 4 / is_chat_owner = 5 / is_chat_sponsor = 6 /
  //   is_chat_moderator = 7
  optional string channel_id = 10101;
  optional string display_name = 103;
  // 036b: 投稿者プロフィール画像 URL（アバター取得元）。リクエストの profile_image_size=48 で CDN が
  // 小サイズ URL を返す。converter が data URI 化する（sidecar 内完結・§CSP 不変）。
  // 043d: 036b 時点の「⚠ 未確定（要実レスポンス検証）」注記は**解消**。公式ガイドの proto 全文に
  //   profile_image_url = 104 と明記されており、暫定採用していた 104 が正しいと確定した。
  optional string profile_image_url = 104;
}

message LiveChatSuperChatDetails {
  // 未採用（公式）: amount_display_string = 3 / user_comment = 4 / tier = 5
  // 043d(バグ修正): 公式のワイヤ型は uint64（varint）。旧 vendored の string 宣言は length-delimited として
  //   読むためワイヤ型不一致で読み取り位置が壊れていた。loadSync の longs:String により uint64 は JS へ
  //   文字列で届くので、DTO（amount_micros: string）と mapper（Number(...)）は無変更で正しく動く。
  optional uint64 amount_micros = 1;
  optional string currency = 2;
}

message LiveChatSuperStickerDetails {
  // 未採用（公式）: amount_display_string = 3 / tier = 4 / super_sticker_metadata = 5
  // 043d(バグ修正): 上記 LiveChatSuperChatDetails と同じ理由で string → uint64。
  optional uint64 amount_micros = 1;
  optional string currency = 2;
}

message LiveChatMemberMilestoneChatDetails {
  // 未採用（公式）: member_level_name = 1（string） / user_comment = 3
  // 043d(バグ修正): 旧 vendored は member_month = 1 だったが、公式の 1 は member_level_name（string）。
  //   string フィールドを uint32 として読むため月数が誤値になり、以降の読み取り位置もずれて本メッセージの
  //   デコードが破損していた。公式どおり 2 に修正する。
  optional uint32 member_month = 2;
}

message LiveChatMembershipGiftingDetails {
  // 未採用（公式）: gift_memberships_level_name = 2（表示要件なし・§9 で受信面を最小化）
  optional int32 gift_memberships_count = 1;
}

message LiveChatGiftDetails {
  // 未採用（公式）: gift_name = 1 / gift_duration = 2(google.protobuf.Duration) / gift_url = 4 /
  //   alt_text = 5 / language = 6 / has_visual_effect = 7
  //   ※ gift_url は画像取得＝CSP・§9 の新たな論点を生むため意図的に除外する。
  //   ※ gift_duration を採らないので google.protobuf.Duration の import は不要（SEA 下の proto 解決経路は
  //     単一ファイルのままで不変）。
  optional int32 jewels_amount = 3;
  // 043e: combo（連続ギフト）の回数。公式の記述は「The combo count of the gift; 0 if not a combo」＝
  //   **単発は 0** なので、合計を出すなら max(combo_count, 1) が要る（素の乗算は不可）。フェーズ1 では
  //   金額計算に使わず、表示（コメント行の「×N」）まで通して**単価か累計かを実機で判別する観測手段**にする。
  //   受信するのは整数のみで個人情報を含まない（§9 の新論点なし）。
  optional int32 combo_count = 8;
}
`;
