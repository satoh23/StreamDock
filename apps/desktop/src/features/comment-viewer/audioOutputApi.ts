import { invoke } from "@tauri-apps/api/core";
import type { AudioOutputDevice } from "./bindings/AudioOutputDevice";
import type { NotificationSound } from "./bindings/NotificationSound";

/**
 * 058a: 音声出力（通知音）の Rust command 薄いラッパ。
 *
 * ②-軽の要（かなめ）。**通知音だけを Rust（rodio）で鳴らし、出力デバイスを明示指定する**ことで
 * 「配信に載せる音（読み上げ＝OS 既定＝仮想オーディオデバイス）」と「載せない音（通知音＝実デバイス）」を
 * 分ける。webview 側では実現できないことが 058s の実測で確定している（macOS は `setSinkId` ごと非対応、
 * Windows は `deviceId`/`label` が空で選択不能）ため、この 2 本は Rust にしか置けない。
 *
 * - **列挙は出力デバイスのみ**。マイク（入力）は Rust 側で構造的に触れない（`getUserMedia` も呼ばない）。
 * - **デバイス ID を frontend で組み立てない。** `listAudioOutputDevices()` が返した値をそのまま
 *   保存し、そのまま `playNotificationSound()` へ渡すだけ。実際に鳴らせるかは
 *   **Rust 側が現在の列挙結果と照合して**決める（docs/security.md §8）。
 * - **音源はアプリ内で合成する**ので、パスもバイト列も渡さない（§3 / §4）。鳴らせる音は
 *   `NotificationSound` の enum に列挙されたものだけ。
 * - **デバイス名・デバイス ID をログにも外部にも出さない**（§9）。`console.*` をこのファイルに書かない。
 *
 * いずれもアプリ定義 command（`generate_handler!` 登録）のため capability 列挙は不要。
 */

export type { AudioOutputDevice, NotificationSound };

/**
 * 選択できる音声**出力**デバイスを列挙する（読み取りのみ）。
 *
 * 出力デバイスが 1 つも無い環境では**空配列で resolve** し、列挙そのものに失敗したときだけ
 * `AppError`（`code: "AUDIO_DEVICE_UNAVAILABLE"`）で **reject** する。
 * ⚠ **reject を握り潰さないこと**——「デバイスが無い」と「取得できなかった」は UI の案内が違う。
 */
export function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  return invoke<AudioOutputDevice[]>("list_audio_output_devices");
}

/**
 * 指定した出力デバイスで通知音を 1 回鳴らす。**鳴り終わってから resolve する。**
 *
 * ⚠ **`deviceId` が現在の一覧に無ければ reject する**（`AUDIO_DEVICE_UNAVAILABLE`）。
 * Rust 側は**既定デバイスへ落とさない**——②-軽の運用では OS 既定＝仮想オーディオデバイス＝
 * 配信に載る側なので、落とすと「載せないつもりの通知音が配信に載る」。**呼び出し側もここを
 * 既定へ落とす実装で埋め合わせないこと**（fail-closed のまま、UI で気付かせるのが正）。
 *
 * ⚠ **同時再生は Rust 側で 1 本に制限されている。** 再生中に来た呼び出しは**鳴らさずに resolve する**
 * （reject しない）。`#[tauri::command(async)]` の実体は tokio worker を占有する `async_runtime::spawn`
 * なので、上限が無いと 059 のコメント受信ごとの呼び出しで worker が積み上がるため。
 * ⚠ これは**クールダウンではない**——「どの音を何秒に 1 回まで鳴らすか」は 059 が持つこと。
 *
 * 059 は完了を待つ必要がない（投げっぱなしでよい）。
 * ⚠⚠ ただし **`.catch(() => {})` で握り潰して終わりにしないこと**（レビュー指摘）。058a は
 * fail-closed（デバイスが見つからなければ鳴らさない）で、かつ**ホットプラグ監視を持たない**——
 * 設定画面を開いた時にしか突き合わせない。ここで reject を無言で捨てると、配信中にデバイスを抜いたとき
 * **通知音が一切鳴らなくなったことをユーザーが知る手段がゼロ**になる。「鳴らないほうがマシ」は
 * 「鳴らないことに気付けなくてよい」ではない。`AUDIO_DEVICE_UNAVAILABLE` を受けたら、例外は伝播させず
 * **画面に継続表示される indicator を出す**こと（表示の設計は 059 の責務）。
 */
export function playNotificationSound(
  deviceId: string,
  sound: NotificationSound,
): Promise<void> {
  return invoke<void>("play_notification_sound", { deviceId, sound });
}
