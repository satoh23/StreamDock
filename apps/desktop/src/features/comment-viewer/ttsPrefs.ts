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
 *
 * 048: 読み上げの最大文字数（`tts-max-length`）を追加する。**このモジュール初の数値設定**で、真偽値と違い
 * 「パース失敗」「範囲外」がありうるため、既定値・範囲・クランプ関数をここに置いて**定義元を 1 箇所**にする
 * （`overlaySettings.ts` の `DEFAULT_OVERLAY_FONT` ＋ `loadOverlayFont` と同型）。`ttsQueue.ts` はこのモジュールを
 * import せず getter 注入で値を受け取る（キュー → 設定永続化の依存を張らない）。
 */

/** 読み上げ ON/OFF の保存キー（既定 OFF）。 */
const TTS_ENABLED_KEY = "stream-dock.comment-viewer.tts-enabled";
/** VOICEVOX 自動連携 ON/OFF の保存キー（既定 OFF）。 */
const AUTOLINK_KEY = "stream-dock.comment-viewer.voicevox-autolink";
/** 035c: Twitch コメントを読み上げるか（既定 ON）。 */
const SPEAK_TWITCH_KEY = "stream-dock.comment-viewer.speak-twitch";
/** 035c: YouTube コメントを読み上げるか（既定 ON）。 */
const SPEAK_YOUTUBE_KEY = "stream-dock.comment-viewer.speak-youtube";
/** 048: 1 件あたりの読み上げ最大文字数（超過分は「以下略」で打ち切る）。テストから参照するため export する。 */
export const TTS_MAX_LENGTH_KEY = "stream-dock.comment-viewer.tts-max-length";

/**
 * 048: 読み上げ最大文字数の既定値。**60 文字**（読み上げ約 10〜13 秒＝VOICEVOX 日本語の 4.5〜6 文字/秒）。
 *
 * 根拠: dev-mock（1800ms 間隔）ではこの間に届くのは 5〜7 件で、`ttsQueue` の `MAX_BACKLOG`(20) に届かない
 * ＝**長文起因の無言破棄が 0 件**になる（290 文字なら 48〜64 秒かかり 7〜18 件が捨てられていた）。
 */
export const TTS_MAX_LENGTH_DEFAULT = 60;
/**
 * 048: 下限 **20 文字**（約 3〜4 秒）。これ未満だと日本語の一文が助詞の途中で切れて意味が通らず、
 * 接尾辞「、以下略」（4 文字）が相対的に大きくなりすぎる。
 */
export const TTS_MAX_LENGTH_MIN = 20;
/**
 * 048: 上限 **200 文字**（約 33〜44 秒）。050 の試算で 200 文字は「破棄 0〜4 件」＝**backlog 破棄が始まる境界**で、
 * これを超える設定は本タスクの目的（長文起因の取りこぼし解消）を自ら壊す。**「上限なし」は用意しない**
 * （省略は常時有効・ON/OFF トグルも設けない）。
 */
export const TTS_MAX_LENGTH_MAX = 200;

/**
 * 048: 読み上げ最大文字数を有効範囲へ丸める。**クランプのロジックはこの 1 関数だけ**が持ち、
 * load（他窓・手書きの不正値に耐える最後の砦）／save（範囲外を localStorage に残さない）／設定 UI の確定時
 * （画面の値と保存値を一致させる）の 3 箇所がこれを呼ぶ。
 * 非有限（NaN / Infinity）は既定値へ、小数は切り捨てて整数化する。
 */
export function clampTtsMaxLength(value: number): number {
  if (!Number.isFinite(value)) return TTS_MAX_LENGTH_DEFAULT;
  return Math.min(
    TTS_MAX_LENGTH_MAX,
    Math.max(TTS_MAX_LENGTH_MIN, Math.trunc(value)),
  );
}

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

/**
 * 048: 保存済みの読み上げ最大文字数を読み込む。未保存・パース不能・範囲外・例外はすべて安全側へ丸める
 * （`Number("")` が 0 になる罠を避けるため、空文字は数値化する前に弾く）。
 */
export function loadTtsMaxLength(): number {
  try {
    const raw = localStorage.getItem(TTS_MAX_LENGTH_KEY);
    if (raw === null || raw.trim() === "") return TTS_MAX_LENGTH_DEFAULT;
    return clampTtsMaxLength(Number(raw));
  } catch {
    return TTS_MAX_LENGTH_DEFAULT;
  }
}

/** 048: 読み上げ最大文字数を保存する（**保存前にクランプ**＝範囲外を localStorage に残さない・外部送信しない）。 */
export function saveTtsMaxLength(value: number): void {
  try {
    localStorage.setItem(TTS_MAX_LENGTH_KEY, String(clampTtsMaxLength(value)));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（読み上げは既定値のまま継続できる）。
  }
}
