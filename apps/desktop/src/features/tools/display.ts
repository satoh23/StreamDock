import type { ToolRecord } from "./types";

/** サイドバー等のアイコン表示用の1文字（iconLabel 優先、無ければ name 先頭文字）。 */
export function toIconLetter(tool: Pick<ToolRecord, "iconLabel" | "name">): string {
  const label = tool.iconLabel.trim();
  if (label) return label;
  return tool.name.trim().charAt(0) || "?";
}
