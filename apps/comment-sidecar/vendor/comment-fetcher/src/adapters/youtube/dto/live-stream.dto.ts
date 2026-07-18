/**
 * YouTube のライブ配信検出で使う、YouTube専用の受け取り型。
 * Step4 で必要な最小項目だけ定義する。
 */

/**
 * liveBroadcasts.list(broadcastStatus=active) の結果。
 * 032c-d″(stream-dock): 自分のアクティブ配信の検出を search.list(eventType=live・**100 unit**・検索
 * インデックス反映が遅い) から liveBroadcasts.list(**1 unit**・配信管理APIで即時整合) へ置換するため追加。
 * id=videoId、snippet.liveChatId/title が 1 コールで揃うため、従来の videos.list 追い打ちも不要になる。
 */
export type YouTubeLiveBroadcastsListResponseDto = {
  items: YouTubeLiveBroadcastItemDto[];
};

export type YouTubeLiveBroadcastItemDto = {
  /** 配信動画ID（= videoId） */
  id?: string;
  snippet?: {
    title?: string;
    /** アクティブなライブチャットID（コメント取得問い合わせに渡す） */
    liveChatId?: string;
  };
  status?: {
    /** "live" のとき配信中 */
    lifeCycleStatus?: string;
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
