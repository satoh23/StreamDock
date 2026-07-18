/**
 * YouTube のライブ配信検出で使う、YouTube専用の受け取り型。
 * Step4 で必要な最小項目だけ定義する。
 */

/** 配信中かどうかを調べる問い合わせの結果。配信動画IDの取得に使う。 */
export type YouTubeSearchListResponseDto = {
  items: YouTubeSearchItemDto[];
};

export type YouTubeSearchItemDto = {
  id?: {
    /** ライブ配信動画ID */
    videoId?: string;
  };
};

/** 認証中ユーザー自身のチャンネルID解決に使う。 */
export type YouTubeChannelsListResponseDto = {
  items: YouTubeChannelItemDto[];
};

export type YouTubeChannelItemDto = {
  id?: string;
};

/** 配信動画の詳細問い合わせ結果。ライブチャットIDの取得に使う。 */
export type YouTubeVideosListResponseDto = {
  items: YouTubeVideoItemDto[];
};

export type YouTubeVideoItemDto = {
  id: string;
  snippet?: {
    title?: string;
  };
  liveStreamingDetails?: {
    /** コメント取得問い合わせに渡すライブチャットID */
    activeLiveChatId?: string;
  };
};
