/**
 * 033d: コメントビューアの VOICEVOX 読み上げ話者（style id）を localStorage に保持する。
 *
 * 設定ビューで選んだ話者・スタイルを、窓を閉じても・アプリ再起動でも復元できるようにする。
 * 永続するのは **style id ひとつ**（VOICEVOX の style id は話者横断で一意なので、これだけで
 * 話者＋スタイルが一意に復元できる）。channelStorage.ts / ttsPrefs.ts と同方式（名前空間付き
 * "stream-dock.*" キー・localStorage 直 read/write・例外は握りつぶし）。
 *
 * style id は非機密の UI 選択値で、OS/ファイル操作ではなくブラウザストレージのため Rust/SQLite は
 * 使わない。OAuth トークン等の機密はここに保存しない。外部送信もしない。
 */

/** localStorage の保存キー（1 個のみ）。 */
const SPEAKER_ID_KEY = "stream-dock.comment-viewer.voicevox-speaker-id";

/** 未選択時の既定 style id（ずんだもんノーマル）。033d 以前の固定値と同じ値を維持する。 */
export const DEFAULT_SPEAKER_ID = 3;

/** 保存済みの話者 style id を読み込む。未保存・不正・例外はすべて既定（ずんだもんノーマル）にフォールバック。 */
export function loadSpeakerId(): number {
  try {
    const raw = localStorage.getItem(SPEAKER_ID_KEY);
    const n = Number(raw);
    return raw !== null && Number.isInteger(n) && n >= 0 ? n : DEFAULT_SPEAKER_ID;
  } catch {
    return DEFAULT_SPEAKER_ID;
  }
}

/** 話者 style id を保存する（ローカルのみ・外部送信しない）。 */
export function saveSpeakerId(id: number): void {
  try {
    localStorage.setItem(SPEAKER_ID_KEY, String(id));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}
