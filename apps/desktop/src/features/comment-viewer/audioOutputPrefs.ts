/**
 * 058a: 通知音を鳴らす音声出力デバイスの選択を localStorage に保持する。
 *
 * ②-軽では**通知音だけ**を Rust（rodio）で鳴らし、ここで選ばれたデバイスへ明示的に出す
 * （＝配信に載らない）。読み上げは Web Audio のまま OS 既定へ出る（＝配信に載る）。
 *
 * 保存するのは**ユーザー自身が選んだデバイス ID だけ**で、`ttsPrefs.ts` / `overlaySettings.ts` と
 * 同方式（名前空間付き "stream-dock.comment-viewer.*" キー・localStorage 直 read/write・
 * 例外は握りつぶし・不正値は既定へフォールバック）。**非機密の UI 設定値**であって、§9 追補（046a）が
 * 対象とする第三者の個人データではない（`OBS_AUTO_ADD_KEY` と同種）。外部送信もしない。
 * **デバイス名はここに保存しない**（表示のたびに Rust の列挙結果から取る＝古い名前が残らない・§9）。
 *
 * ⚠ **未選択（`""`）を「既定デバイスで鳴らす」と読み替えないこと。** 058a のフォールバックは
 * **fail-closed（鳴らさない）**である。②-軽の運用では OS 既定＝仮想オーディオデバイス＝**配信に載る側**
 * なので、未選択や「選んだデバイスが見つからない」を既定へ落とすと、
 * **載せないつもりの通知音が配信に載る**＝この機能の存在理由そのものが壊れる。
 * 鳴らないのは軽微な不便で、載るのは事故。判定は Rust 側（列挙結果との照合）も同じ向きに揃えてある。
 */

/** 058a: 通知音の出力デバイス ID の保存キー（既定＝未選択）。テストから参照するため export する。 */
export const AUDIO_OUTPUT_DEVICE_KEY =
  "stream-dock.comment-viewer.audio-output-device";

/** 058a: 未選択を表す値。**「既定デバイス」ではなく「鳴らさない」** を意味する（上記 ⚠）。 */
export const NO_AUDIO_OUTPUT_DEVICE = "";

/**
 * 058a: 受け付けるデバイス ID の最大長。
 *
 * 実体は `cpal::DeviceId` の `"<HostId>:<device>"` で、実測では数十文字（macOS の
 * `BuiltInSpeakerDevice` 等）。localStorage は手で書き換えられるので、桁違いの値は
 * **壊れた値として捨てる**（docs/security.md §8「ユーザー入力を信頼しない」）。
 * 512 は「実物の 10 倍でも足りる」程度の余裕を見た値で、意味のある境界ではない。
 */
export const AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH = 512;

/**
 * 058a: デバイス ID として受け付けてよい形か判定する。
 *
 * ⚠ **これは「このデバイスが実在するか」の検査ではない。** 実在するか／出力デバイスか／今つながって
 * いるかは **Rust 側が列挙結果と照合して**決める（§8 の多層防御の外側だけをここが担う）。
 * ここで見るのは「保存値として明らかに壊れていないか」だけ。
 */
export function isValidAudioOutputDeviceId(value: string): boolean {
  if (value.length === 0) return false;
  if (value.length > AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH) return false;
  // 制御文字（改行・NUL 等）を含む値は壊れている。⚠ **Rust 側と判定域を揃える**——あちらは
  // `char::is_control` なので C0（U+0000..=U+001F）と **C1（U+007F..=U+009F）の両方**を弾く。
  // 揃っていないと「frontend は保存を許すのに Rust が必ず拒否する」値が作れ、ユーザーからは
  // 「そのデバイスだけ永久に鳴らない」原因不明の故障に見える（§8 の多層防御が片肺になる）。
  // 列挙側（`service::is_selectable_device_id`）もこれを含む ID を選択肢に出さないので、
  // 正規に選んだデバイスがここで弾かれることはない。
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/**
 * 058a: 保存済みの出力デバイス ID を読み込む。
 * 未保存・空・壊れた値（長すぎる／制御文字入り）・例外はすべて**未選択**へフォールバックする。
 */
export function loadAudioOutputDeviceId(): string {
  try {
    const raw = localStorage.getItem(AUDIO_OUTPUT_DEVICE_KEY);
    if (raw === null) return NO_AUDIO_OUTPUT_DEVICE;
    const trimmed = raw.trim();
    return isValidAudioOutputDeviceId(trimmed)
      ? trimmed
      : NO_AUDIO_OUTPUT_DEVICE;
  } catch {
    return NO_AUDIO_OUTPUT_DEVICE;
  }
}

/**
 * 058a: 出力デバイス ID を保存する（ローカルのみ・外部送信しない）。
 *
 * **保存前に検証する**＝壊れた値を localStorage に残さない（`saveTtsMaxLength` が保存前に
 * クランプするのと同じ考え方）。不正値は未選択として保存する＝「鳴らさない」側へ倒れる。
 */
export function saveAudioOutputDeviceId(deviceId: string): void {
  try {
    const trimmed = deviceId.trim();
    localStorage.setItem(
      AUDIO_OUTPUT_DEVICE_KEY,
      isValidAudioOutputDeviceId(trimmed) ? trimmed : NO_AUDIO_OUTPUT_DEVICE,
    );
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（通知音以外の機能は継続できる）。
  }
}
