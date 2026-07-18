/**
 * 032c-b: コメントビューアの取得対象チャンネル名を localStorage に保持する。
 *
 * 窓を閉じると webview が破棄され React state（channel）が消えるため、再オープン・アプリ再起動でも
 * 直前のチャンネル名を復元できるようにする。features/theme/theme.ts・tutorialStorage.ts と同方式
 * （名前空間付き "stream-dock.*" キー・localStorage 直 read/write・例外は握りつぶし）。
 *
 * チャンネル名は非機密の UI 入力値で、OS/ファイル操作ではなくブラウザストレージのため Rust/SQLite は
 * 使わない（CLAUDE.md のファイル/OS操作ルールに非該当）。OAuth トークン等の機密はここに保存しない。
 */

/** localStorage の保存キー（1 個のみ）。 */
const STORAGE_KEY = "stream-dock.comment-viewer.channel";

/** 保存済みのチャンネル名を読み込む。未保存・不正・例外はすべて空文字にフォールバック。 */
export function loadChannel(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

/** チャンネル名を保存する（ローカルのみ・外部送信しない）。 */
export function saveChannel(channel: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, channel);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}
