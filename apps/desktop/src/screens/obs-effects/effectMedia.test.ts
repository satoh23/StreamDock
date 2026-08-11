import { describe, it, expect } from "vitest";
import {
  effectMediaDataUri,
  effectSoundDataUri,
  safeEffectMedia,
} from "./effectMedia";

/**
 * 061c: 描画シンクの最終防波堤（036a の `avatarDataUri` と同型）の仕様テスト。
 *
 * ⚠⚠ **ここが緑であることの意味**＝「Rust が壊れても webview は `data:` の許可 MIME しか踏まない」。
 * Rust 側の検証（拡張子の許可リスト・マジックバイト）とは**層が違う**ので、両方に置くのが正しい。
 *
 * ⚠ **ミューテーション**: `effectMedia.ts` の MIME 許可リスト判定を
 * 「`value.startsWith("data:")` だけ」に緩めると、下の `data:image/svg+xml` と
 * `data:text/html` のケースがレッドになる。base64 の文字集合検査を外すと
 * 「`"` や改行を含むペイロード」のケースがレッドになる。
 */

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZF";

describe("effectMediaDataUri", () => {
  it("許可した MIME の data URI だけを通す", () => {
    for (const good of [
      PNG,
      "data:image/apng;base64,iVBORw0KGgo=",
      "data:image/gif;base64,R0lGODlhAQABAA==",
      "data:image/webp;base64,UklGRhIAAABXRUJQ",
      "data:video/webm;base64,GkXfow==",
    ]) {
      expect(effectMediaDataUri(good)).toBe(good);
    }
  });

  it("⚠⚠ SVG と HTML は data URI でも通さない", () => {
    // `<img>` の SVG は secure static mode だが、`filter:` / `mask:` は
    // 「リソース文書」として読むのでその保証が及ばない（060b の `data:` フラグメント論と同じ構図）。
    expect(effectMediaDataUri("data:image/svg+xml;base64,PHN2Zy8+")).toBeUndefined();
    expect(effectMediaDataUri("data:text/html;base64,PGh0bWw+")).toBeUndefined();
    // 音源の MIME も media 枠では通さない（枠ごとに許可リストが違う）。
    expect(effectMediaDataUri(WAV)).toBeUndefined();
  });

  it("data URI 以外は 1 つも通さない", () => {
    for (const bad of [
      "https://evil.example/x.png",
      "//evil.example/x.png",
      "/local/x.png",
      "javascript:alert(1)",
      "blob:http://localhost/abc",
      "file:///etc/passwd",
      "DATA:image/png;base64,iVBORw0KGgo=", // 大文字は通さない（Rust が作らない形）
      "data:image/png,notbase64",
      "",
    ]) {
      expect(effectMediaDataUri(bad)).toBeUndefined();
    }
  });

  it("base64 の文字集合から外れるペイロードを弾く", () => {
    // ⚠ ここが `avatarDataUri` の `URL_STRING_BREAKOUT` に相当する部分。
    //   許可制なので、引用符・改行・空白・URL-safe 版の文字がすべて落ちる。
    for (const payload of [
      'iVBOR"w0KGgo=',
      "iVBOR\nw0KGgo=",
      "iVBOR w0KGgo=",
      "iVBOR-w0KGgo=", // URL-safe 版は Rust が作らない
      "iVBOR_w0KGgo=",
      "iVBORw0KGgo===", // パディング過多
      "", // 空のペイロード（描けない＝壊れた表示になる）
      // ⚠ 061c security-review Q-6: 本体が `*` だとパディングだけの値が通っていた。
      "=",
      "==",
    ]) {
      expect(effectMediaDataUri(`data:image/png;base64,${payload}`)).toBeUndefined();
    }
  });

  it("null / undefined / 非文字列で落ちない", () => {
    expect(effectMediaDataUri(null)).toBeUndefined();
    expect(effectMediaDataUri(undefined)).toBeUndefined();
    // ⚠ IPC 越しに来る値なので、型注釈どおりとは限らない前提で守る。
    expect(effectMediaDataUri(123 as unknown as string)).toBeUndefined();
    expect(effectMediaDataUri({} as unknown as string)).toBeUndefined();
  });
});

describe("effectSoundDataUri", () => {
  it("許可した音源の MIME だけを通す", () => {
    for (const good of [
      WAV,
      "data:audio/mpeg;base64,SUQzAwAA",
      "data:audio/ogg;base64,T2dnUwAC",
    ]) {
      expect(effectSoundDataUri(good)).toBe(good);
    }
  });

  it("画像・SVG・外部 URL は通さない", () => {
    for (const bad of [
      PNG,
      "data:image/svg+xml;base64,PHN2Zy8+",
      "https://evil.example/x.wav",
      "data:audio/x-wav;base64,UklGRg==", // 許可リストに無い MIME
    ]) {
      expect(effectSoundDataUri(bad)).toBeUndefined();
    }
  });
});

describe("safeEffectMedia", () => {
  it("両方が許可形なら両方返す", () => {
    expect(safeEffectMedia({ media: PNG, sound: WAV })).toEqual({
      media: PNG,
      sound: WAV,
    });
  });

  it("音源だけが不正ならメディアは出す（音が鳴らないだけ）", () => {
    // ⚠ 音が鳴らないことは配信を壊さないが、エフェクトが出ないことは「反応が無い」に見える。
    expect(
      safeEffectMedia({ media: PNG, sound: "https://evil.example/x.wav" }),
    ).toEqual({ media: PNG, sound: undefined });
  });

  it("⚠ メディアが不正ならエフェクトごと出さない（061d は組み込みへフォールバックする）", () => {
    expect(
      safeEffectMedia({ media: "https://evil.example/x.png", sound: WAV }),
    ).toBeUndefined();
    expect(safeEffectMedia(null)).toBeUndefined();
    expect(safeEffectMedia(undefined)).toBeUndefined();
  });

  it("音源が無いテンプレート（sound: null）でもメディアを返す", () => {
    expect(safeEffectMedia({ media: PNG, sound: null })).toEqual({
      media: PNG,
      sound: undefined,
    });
  });
});
