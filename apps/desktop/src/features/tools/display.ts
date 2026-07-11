import type { ToolRecord } from "./types";

/** サイドバー等のアイコン表示用の1文字（iconLabel 優先、無ければ name 先頭文字）。 */
export function toIconLetter(tool: Pick<ToolRecord, "iconLabel" | "name">): string {
  const label = tool.iconLabel.trim();
  if (label) return label;
  return tool.name.trim().charAt(0) || "?";
}

/**
 * 018: 自動抽出した base64 PNG（`data:` 無し）を `<img src>` 用の data URI にする。
 * 無ければ `undefined` を返し、呼び出し側は文字アイコン（`toIconLetter`）にフォールバックする。
 * CSP はリモート画像禁止のまま `data:` inline のみを使う（外部通信なし）。
 */
export function iconDataUri(iconPng?: string | null): string | undefined {
  if (!iconPng) return undefined;
  return `data:image/png;base64,${iconPng}`;
}
