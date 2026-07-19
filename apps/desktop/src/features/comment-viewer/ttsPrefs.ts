/**
 * 033c: コメントビューアの VOICEVOX 関連トグル設定を localStorage に保持する。
 *
 * - 読み上げ ON/OFF（`tts-enabled`）: ON のときだけコメントを読み上げ、ON のときだけクレジット表記を出す。
 * - VOICEVOX 自動連携（`voicevox-autolink`）: ON なら窓オープン時に ENGINE を自動起動する。
 *
 * どちらも**非機密の UI 設定値**で、channelStorage.ts / features/tutorial/tutorialStorage.ts と同方式
 * （名前空間付き "stream-dock.*" キー・localStorage 直 read/write・文字列 "true" 保存で `=== "true"` 判定・
 * 既定 false・例外は握りつぶし）。OAuth トークン等の機密はここに保存しない。外部送信もしない。
 */

/** 読み上げ ON/OFF の保存キー（既定 OFF）。 */
const TTS_ENABLED_KEY = "stream-dock.comment-viewer.tts-enabled";
/** VOICEVOX 自動連携 ON/OFF の保存キー（既定 OFF）。 */
const AUTOLINK_KEY = "stream-dock.comment-viewer.voicevox-autolink";

/** 保存済みの読み上げ ON/OFF を読み込む。未保存・不正・例外はすべて false（OFF）にフォールバック。 */
export function loadTtsEnabled(): boolean {
  try {
    return localStorage.getItem(TTS_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/** 読み上げ ON/OFF を保存する（ローカルのみ・外部送信しない）。 */
export function saveTtsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(TTS_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}

/** 保存済みの VOICEVOX 自動連携 ON/OFF を読み込む。未保存・不正・例外はすべて false（OFF）にフォールバック。 */
export function loadVoicevoxAutolink(): boolean {
  try {
    return localStorage.getItem(AUTOLINK_KEY) === "true";
  } catch {
    return false;
  }
}

/** VOICEVOX 自動連携 ON/OFF を保存する（ローカルのみ・外部送信しない）。 */
export function saveVoicevoxAutolink(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOLINK_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}
