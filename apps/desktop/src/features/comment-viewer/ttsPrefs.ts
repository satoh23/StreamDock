/**
 * 033c: コメントビューアの VOICEVOX 関連トグル設定を localStorage に保持する。
 *
 * - 読み上げ ON/OFF（`tts-enabled`）: ON のときだけコメントを読み上げ、ON のときだけクレジット表記を出す。
 * - VOICEVOX 自動連携（`voicevox-autolink`）: ON なら窓オープン時に ENGINE を自動起動する。
 *
 * どちらも**非機密の UI 設定値**で、channelStorage.ts / features/tutorial/tutorialStorage.ts と同方式
 * （名前空間付き "stream-dock.*" キー・localStorage 直 read/write・文字列 "true" 保存で `=== "true"` 判定・
 * 既定 false・例外は握りつぶし）。OAuth トークン等の機密はここに保存しない。外部送信もしない。
 *
 * 035c: source 別の読み上げ ON/OFF（`speak-twitch` / `speak-youtube`）を追加する。両プラットフォーム同時取得時に
 * source 別で読み上げを絞るための設定で、**既定は両方 ON（未保存時に true を返す）**＝現行の全読み上げを踏襲する。
 * 保存方式は上記と同じ（名前空間キー・`String()` 保存・例外握りつぶし）だが、**判定だけ `!== "false"` で既定 ON**に
 * する点が `tts-enabled` / `voicevox-autolink`（既定 OFF）と逆である。読み上げの ON/OFF フィルタのみで、表示・一覧は
 * 全 source を従来どおり出す（フィルタは読み上げキュー投入側だけに効く）。
 */

/** 読み上げ ON/OFF の保存キー（既定 OFF）。 */
const TTS_ENABLED_KEY = "stream-dock.comment-viewer.tts-enabled";
/** VOICEVOX 自動連携 ON/OFF の保存キー（既定 OFF）。 */
const AUTOLINK_KEY = "stream-dock.comment-viewer.voicevox-autolink";
/** 035c: Twitch コメントを読み上げるか（既定 ON）。 */
const SPEAK_TWITCH_KEY = "stream-dock.comment-viewer.speak-twitch";
/** 035c: YouTube コメントを読み上げるか（既定 ON）。 */
const SPEAK_YOUTUBE_KEY = "stream-dock.comment-viewer.speak-youtube";

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

/**
 * 035c: Twitch コメントの読み上げ ON/OFF を読み込む。**既定 ON**（現行の全読み上げ踏襲）。
 * `!== "false"` 判定なので、未保存(null)・不正値・例外はすべて true（ON）にフォールバックする。
 */
export function loadSpeakTwitch(): boolean {
  try {
    return localStorage.getItem(SPEAK_TWITCH_KEY) !== "false";
  } catch {
    return true;
  }
}

/** 035c: Twitch コメントの読み上げ ON/OFF を保存する（ローカルのみ・外部送信しない）。 */
export function saveSpeakTwitch(enabled: boolean): void {
  try {
    localStorage.setItem(SPEAK_TWITCH_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（読み上げは既定 ON のまま継続できる）。
  }
}

/**
 * 035c: YouTube コメントの読み上げ ON/OFF を読み込む。**既定 ON**（現行の全読み上げ踏襲）。
 * `!== "false"` 判定なので、未保存(null)・不正値・例外はすべて true（ON）にフォールバックする。
 */
export function loadSpeakYoutube(): boolean {
  try {
    return localStorage.getItem(SPEAK_YOUTUBE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** 035c: YouTube コメントの読み上げ ON/OFF を保存する（ローカルのみ・外部送信しない）。 */
export function saveSpeakYoutube(enabled: boolean): void {
  try {
    localStorage.setItem(SPEAK_YOUTUBE_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（読み上げは既定 ON のまま継続できる）。
  }
}
