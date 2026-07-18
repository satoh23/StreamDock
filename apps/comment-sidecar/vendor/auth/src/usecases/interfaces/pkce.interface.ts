export type PkcePair = {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
};

export interface PkceGenerator {
  generate(): PkcePair;
}
