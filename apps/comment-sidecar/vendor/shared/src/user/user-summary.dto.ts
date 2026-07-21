export type UserSummaryDto = {
  id: string;
  name: string;
  /** 036a: 投稿者アイコンの data URI（webview が `<img>` にそのまま使える形）。未取得時は undefined。 */
  avatar?: string;
};
