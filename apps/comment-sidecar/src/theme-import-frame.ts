// 060h コミット 2（2026-08-09）: `index.ts` の `theme-import.fetch` 分岐を**純関数として切り出した**もの。
//
// ⚠⚠ **このファイルは「切り出しだけ」のコミットで作られた＝ロジックは 1 文字も変えていない。**
//
// ## なぜ切り出したのか（security-review 060c S-3 の宿題）
//
// `index.ts` は top-level で `main()` を呼ぶ＝**import すると sidecar が起動してしまう**ため、
// `scripts/test-*.mjs` から読み込めない。その結果 060c 時点では
// **チケット照合・unicast・fail-closed がランタイムテストで殺せず、ミューテーションでも生存していた**
// （担保は実機確認⑧だけだった）。
// 060h は同じ経路にフレームを 1 つ足すので、**足す前にテストで殺せる形にする**のが着手条件だった。
//
// ## ここが守っている 3 つの不変条件（テストで固定してある）
//
// 1. **チケットが一致しなければ黙って捨てる。返信もしない**（存在も漏らさない）。
//    loopback WS は**未認証**なので、これが「同意ダイアログを経ない取得」を塞ぐ唯一の壁である。
// 2. **チケット未受領（`null`）は無条件で捨てる**（fail-closed）。
// 3. **返信は要求元 1 本への unicast**（`send` は `sendToClient` を束ねたもの。`broadcastMessage` を渡さない）。
//    オーバーレイ窓も同じ WS に読み取り専用で繋がっており、取得した CSS 本文を配る理由が無い（§9）。
//
// ⚠ 取得先 URL も CSS 本文も**ログに出さない**（§9）。件数すら出さない。
import { timingSafeEqual } from "node:crypto";

import type { ThemeFontResult, ThemeImportResult } from "./theme-import.js";

/** 060c: viewer → sidecar の制御フレーム種別（外部 `@import` の取得）。 */
export const THEME_IMPORT_FETCH_FRAME = "theme-import.fetch";
/** 060c: sidecar → **要求元クライアント**へ返す取得結果のメッセージ種別。 */
export const THEME_IMPORT_RESULT_FRAME = "theme-import.result";
/** 060h: viewer → sidecar（`@font-face` の `src` が指すフォント実体の取得）。 */
export const THEME_FONT_FETCH_FRAME = "theme-import.fetch-font";
/** 060h: sidecar → **要求元クライアント**へ返すフォント取得結果。 */
export const THEME_FONT_RESULT_FRAME = "theme-import.font-result";

/**
 * 060c: 外部 `@import` の取り込み時スナップショット。**1 フレーム 1 URL**（バッチ取得しない）。
 * ⚠ `ticket` は Rust が起動時に採番し stdin private pipe で渡した値。一致しないものは黙って捨てる。
 */
export interface ThemeImportFetchFrame {
  type: typeof THEME_IMPORT_FETCH_FRAME;
  ticket: string;
  requestId: number;
  url: string;
  maxBytes: number;
}

/**
 * 060h: フォント実体の取得。**形は CSS のフレームと完全に同一**（種別だけが違う）。
 * ⚠ 同一にしてあるのは、受理条件（`ticket` 長・`url` 長・`maxBytes` の範囲）と
 * チケット照合・unicast を **1 か所で**扱うため。片方だけ検証が抜ける形を作らない。
 */
export interface ThemeFontFetchFrame {
  type: typeof THEME_FONT_FETCH_FRAME;
  ticket: string;
  requestId: number;
  url: string;
  maxBytes: number;
}

/** 060h: `theme-import-frame` が処理する制御フレーム（CSS / フォント）。 */
export type ThemeFrame = ThemeImportFetchFrame | ThemeFontFetchFrame;

/**
 * 060c: 秘密（テーマ取り込みチケット）を**定数時間で**比較する。
 *
 * ⚠ `timingSafeEqual` は長さが違うと throw するので、長さを先に見る（長さの差は 1 回の比較で漏れるが、
 * チケットは固定長 32 文字の hex なので情報量はゼロ）。
 */
export function isSameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface ThemeImportFrameDeps {
  /** `parseControlFrame` が**明示構築**した検証済みフレーム（未検証フィールドは 1 つも混入しない）。 */
  frame: ThemeFrame;
  /** Rust から stdin private pipe で受領したチケット。⚠ **未受領なら `null`＝どのフレームも通さない**。 */
  ticket: string | null;
  /** ⚠⚠ **要求元 1 本へだけ**送る関数（`sendToClient` を束ねたもの）。broadcast を渡さないこと。 */
  send: (message: unknown) => void;
  /** ガード → DNS 検査 → 取得の 3 分割を通る唯一の入口（`createThemeImporter()` の戻り値）。 */
  fetchThemeCss: (url: string, maxBytes: number) => Promise<ThemeImportResult>;
  /** 060h: 同上（`createThemeFontFetcher()` の戻り値）。**別枠のレート制限・別ガード**を通る。 */
  fetchThemeFont: (url: string, maxBytes: number) => Promise<ThemeFontResult>;
}

/**
 * 制御フレーム 1 件を処理する。**チケットが一致したときだけ**取得を行い、要求元へ unicast で返す。
 *
 * ⚠⚠ **チケット照合は種別より前にある**（060h）。ここを種別ごとの分岐の中へ落とすと、
 * 「新しいフレームを足したときにチケット検証を書き忘れる」形が作れてしまう
 * ——`docs/security.md` のレビュー必須条件が「新しい制御フレームが egress を起こすなら
 * チケット必須」と名指ししているのは、まさにこの取りこぼしを想定している。
 *
 * ⚠ 呼び出し側は `void handleThemeImportFrame({...})` と fire-and-forget で呼ぶ（`index.ts` の
 * 制御ハンドラは同期の戻り値を要求するため）。取得の実体は `createThemeImporter` /
 * `createThemeFontFetcher` が返す関数で、**失敗を reject ではなく `{ ok:false, reason }` で返す**
 * 契約なのでここでは catch しない。
 */
export async function handleThemeImportFrame({
  frame,
  ticket,
  send,
  fetchThemeCss,
  fetchThemeFont,
}: ThemeImportFrameDeps): Promise<void> {
  // ⚠⚠ **チケットが一致しなければ黙って捨てる**（返信もしない＝存在も漏らさない）。
  // ⚠ **種別で分岐する前**に置くこと（フレームが増えても検証を通り抜けられない形にする）。
  if (ticket === null || !isSameSecret(frame.ticket, ticket)) {
    return;
  }
  if (frame.type === THEME_FONT_FETCH_FRAME) {
    const result = await fetchThemeFont(frame.url, frame.maxBytes);
    send({
      type: THEME_FONT_RESULT_FRAME,
      payload:
        result.ok === true
          ? {
              requestId: frame.requestId,
              ok: true,
              // ⚠ `mime` は sidecar が allow-list で検証した値だけ（frontend が型を決められない）。
              mime: result.mime,
              base64: result.base64,
            }
          : { requestId: frame.requestId, ok: false, reason: result.reason },
    });
    return;
  }
  const result = await fetchThemeCss(frame.url, frame.maxBytes);
  send({
    type: THEME_IMPORT_RESULT_FRAME,
    payload:
      result.ok === true
        ? { requestId: frame.requestId, ok: true, css: result.css }
        : { requestId: frame.requestId, ok: false, reason: result.reason },
  });
}
