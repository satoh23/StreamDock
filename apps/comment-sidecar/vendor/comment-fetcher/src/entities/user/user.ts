export type User = {
  id: string;
  name: string;
  /** 036a: 投稿者アイコンの取得元 URL（純ドメイン値）。036b/036c が埋める。未取得時は undefined。 */
  avatar?: string;
};
