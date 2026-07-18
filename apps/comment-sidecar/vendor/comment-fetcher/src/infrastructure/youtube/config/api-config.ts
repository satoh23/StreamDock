import { injectable } from "tsyringe";

const DEFAULT_YOUTUBE_DATA_API_BASE_URL =
  "https://www.googleapis.com/youtube/v3";

export interface YouTubeConfigProvider {
  getDataApiBaseUrl(): string;
}

// 032c-d(stream-dock): これは osareview 原本の env 可変版（Data API base URL を process.env で override 可能）。
// stream-dock では **未配線・到達不能**で、代わりに定数固定の `PinnedYouTubeConfigProvider`
// （src/youtube-config.ts）を register-youtube-deps.ts で直接 new して使う（§1 の env ピン留め＝宛先 override
// 経路を持ち込まない）。gRPC の target host（www.googleapis.com:443）はこの base URL から導出されるため、
// 定数固定＝二層 fail-closed の(a)。parity 維持のため残置・distill 最終化時の削除候補。型
// （YouTubeConfigProvider）は vendored youtube アダプタが参照するためこのファイルに置く。
@injectable()
export class EnvYouTubeConfigProvider implements YouTubeConfigProvider {
  getDataApiBaseUrl(): string {
    return (
      process.env.YOUTUBE_DATA_API_BASE_URL ?? DEFAULT_YOUTUBE_DATA_API_BASE_URL
    );
  }
}
