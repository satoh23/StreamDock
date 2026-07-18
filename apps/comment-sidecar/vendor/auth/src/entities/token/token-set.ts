/**
 * NOTE: ドメイン寄りのモデル。振る舞いは `TokenSet` クラスに持ち、keychain 等へは
 * `toPlain()` / `create()` で JSON と同形のオブジェクト（`TokenSetPlain`）とインスタンスを往復する。
 */

/**
 * 永続化（JSON）と同じ形のトークン一式。`JSON.parse` の結果をそのまま渡せる。
 */
export type TokenSetPlain = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  obtainedAt: number;
};

/**
 * OAuth で取得したトークン一式。
 * `expiresAt` はアクセストークン失効の絶対時刻（Unix epoch ミリ秒）。
 */
export class TokenSet {
  constructor(
    readonly accessToken: string,
    readonly refreshToken: string,
    readonly expiresAt: number,
    readonly scope: string,
    readonly obtainedAt: number,
  ) {}

  /** `TokenSetPlain` からインスタンスを生成する（`JSON.parse` 結果の復元など）。 */
  static create(plain: TokenSetPlain): TokenSet {
    return new TokenSet(
      plain.accessToken,
      plain.refreshToken,
      plain.expiresAt,
      plain.scope,
      plain.obtainedAt,
    );
  }

  /** 保存・`JSON.stringify` 用に `TokenSetPlain` へ変換する。 */
  toPlain(): TokenSetPlain {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
      scope: this.scope,
      obtainedAt: this.obtainedAt,
    };
  }

  /**
   * 現在時刻を基準に、アクセストークンをまだ使ってよいか。
   * 単体テストでは `Date.now` を差し替えて時刻を固定する。
   */
  isAccessTokenLive(
    clockSkewMs: number = DEFAULT_ACCESS_TOKEN_CLOCK_SKEW_MS,
  ): boolean {
    if (!Number.isFinite(this.expiresAt)) {
      return false;
    }
    return Date.now() < this.expiresAt - clockSkewMs;
  }

  /**
   * OAuth トークンレスポンスの `expires_in`（秒）から `expiresAt`（epoch ms）を求める。
   */
  static accessTokenExpiresAtMs(
    obtainedAtMs: number,
    expiresInSeconds: number,
  ): number {
    if (!Number.isFinite(obtainedAtMs) || !Number.isFinite(expiresInSeconds)) {
      throw new Error(
        "トークンの取得時刻と有効期限は有効な数値である必要があります。",
      );
    }
    if (expiresInSeconds < 0) {
      throw new Error("トークンの有効期限は 0 秒以上である必要があります。");
    }
    return obtainedAtMs + expiresInSeconds * 1000;
  }
}

/**
 * アクセストークン失効の何ミリ秒前から「期限切れ扱い」するか。
 * ネットワーク遅延・時計ズレ・API 往復を見込み、refresh を先に走らせる。
 */
export const DEFAULT_ACCESS_TOKEN_CLOCK_SKEW_MS = 60_000;
