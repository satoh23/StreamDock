/**
 * サイドバー等のアイコン表示用の1文字。
 * `iconLabel` があれば優先し、無ければ `name` の先頭文字を使う。
 * 022 で入力欄は廃止したが、DB 残置の `icon_label` を持つ既存ツールのため任意で受け付ける。
 */
export function toIconLetter(tool: { iconLabel?: string; name: string }): string {
  const label = tool.iconLabel?.trim();
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
