// 044a: OBS 連携（obs-client）の純ヘルパ。**obs-websocket に非依存で副作用が無い**ため単体テスト対象
// （scripts/test-obs-client.mjs）。OBS プロトコル往復（GetSceneList/CreateInput/SetInputSettings 等の call 群）は
// obs-client 側に残し、実 OBS での挙動は E2E で確認する。ここには純粋な文字列/型の変換のみを置く。

/**
 * obs-websocket のエラーを機微情報なしで要約する（password は元々 message に載らない）。
 * reason は loopback WS 経由で viewer UI に表示されるが、接続/認証/窓未検出エラーに機微は載らず、UI は React で
 * エスケープ描画する（XSS なし）。再修正トリガー: 将来 message に機微が混ざり得るなら既知の定型文へマッピングする。
 */
export function safeReason(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * macOS の window itemName "[owner] title" を安定キー owner_name/window_name に分解する（044s 実測フォーマット）。
 * 数値 window ID は起動毎に変わるため、この 2 キーを併設して安定させる。角括弧で始まらない等の想定外は両方
 * undefined（呼び出し側は window 数値 ID のみで設定＝壊れず劣化）。owner は `[^\]]+`＝空にならない。title は空文字あり得る。
 */
export function parseMacWindowItemName(itemName: unknown): {
  ownerName?: string;
  windowName?: string;
} {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(String(itemName ?? ""));
  if (!m) return {};
  return { ownerName: m[1], windowName: m[2] };
}

/**
 * Windows の window_capture「キャプチャ方法」プロパティ名が WGC（Windows 10 1903 以降）を指すか。
 * 透過窓は既定「自動」だと黒くなるため、この名前一致で WGC の itemValue を優先採用する（要 098 実機検証）。
 */
export function isWgcMethodName(name: unknown): boolean {
  return (
    typeof name === "string" &&
    /1903|Windows 10|Graphics Capture|WGC/i.test(name)
  );
}
