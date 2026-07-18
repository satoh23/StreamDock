import { createHash, randomBytes } from "node:crypto";
import "reflect-metadata";
import { injectable } from "tsyringe";
import type {
  PkceGenerator,
  PkcePair,
} from "../../../usecases/interfaces/pkce.interface.js";

function base64UrlEncode(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function toCodeChallengeS256(codeVerifier: string): string {
  const digest = createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(digest);
}

@injectable()
export class RandomPkceGenerator implements PkceGenerator {
  generate(): PkcePair {
    // RFC 7636: code_verifier は 43-128 文字。32 bytes を base64url 化すると 43 文字。
    const codeVerifier = base64UrlEncode(randomBytes(32));
    return {
      codeVerifier,
      codeChallenge: toCodeChallengeS256(codeVerifier),
      codeChallengeMethod: "S256",
    };
  }
}
