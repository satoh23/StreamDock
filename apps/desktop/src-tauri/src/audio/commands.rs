//! 058a: 音声出力の Tauri コマンド（**単一目的の 2 本だけ**・docs/security.md §3）。
//!
//! どちらも薄く `service` へ委譲する。ここに増やしてよいのは「出力デバイスを列挙する」と
//! 「同梱の音を鳴らす」の 2 つだけで、`run_command` 的な汎用コマンドも、任意のファイルを鳴らす
//! コマンドも作らない。
//!
//! ⚠ **`DbState` を取らない**（`extract_app_icon` の「DB は使わないため State を取らない（最小権限）」と
//! 同型）。副産物として**デバイス名が app_logs へ到達する経路が構造的に存在しない**（§9）。
//! 失敗は `AppError` の固定文言だけを frontend へ返す。
//!
//! いずれもアプリ定義コマンド（`generate_handler!` 登録）なので capability の列挙は不要
//! （ACL は plugin / core コマンドだけを対象とする）＝**capabilities 差分ゼロ**。

use super::model::{AudioOutputDevice, NotificationSound};
use super::service;
use crate::error::AppResult;
use crate::util;

/// 選択できる音声**出力**デバイスを列挙する（読み取りのみ・入力デバイスは含まない）。
///
/// `(async)`: WASAPI / CoreAudio の列挙は数十〜数百 ms かかりうる。同期コマンドは Tauri の
/// メインスレッドで走るため、設定画面を開くたびに UI が固まる。窓生成コマンドと同じ理由で
/// async runtime のワーカーへ逃がす（**新しい依存は増えない**——tokio は Tauri v2 が既に持っている）。
///
/// 取得できないとき（列挙そのものの失敗）は `AppError`、出力デバイスが 1 つも無いときは空の `Vec`。
/// frontend はどちらも「選べない」として案内する。
#[tauri::command(async)]
pub fn list_audio_output_devices() -> AppResult<Vec<AudioOutputDevice>> {
    service::list_output_devices()
}

/// 指定した出力デバイスで通知音を 1 回鳴らす。**鳴り終わってから resolve する。**
///
/// `device_id` は `list_audio_output_devices` が返した値をそのまま渡すこと。frontend 側で
/// 組み立てたり加工したりしない。**Rust 側で現在の出力デバイス一覧と照合**してから使い、
/// 一致しなければ**既定デバイスへ落とさずエラー**にする（§8・fail-closed。理由は
/// `service::find_output_device` の注記）。
///
/// `sound` が enum なのは意図的で、**frontend からファイルパスや任意のバイト列を渡す経路を
/// 型レベルで塞ぐため**（§3 / §4）。音はアプリ内で合成するので、そもそも読むファイルが無い。
///
/// `(async)`: 音が鳴り終わるまで待つ＝同期コマンドにするとその間メインスレッドが止まる。
/// ⚠ **ここを同期に戻さないこと**（`service` の契約テスト `both_commands_stay_off_the_main_thread`
/// が機械的に固定している）。
///
/// ⚠ **同時再生は 1 本まで**で、再生中に来た呼び出しは**鳴らさずに `Ok(())` を返す**（エラーにしない）。
/// `(async)` の実体は tokio worker を占有する `async_runtime::spawn` なので、上限が無いと 059 の
/// コメント受信ごとの呼び出しで worker が積み上がる。理由の詳細は `service::PLAYING` の注記。
/// ⚠ これは**クールダウンではない**——「どの音を何秒に 1 回まで鳴らすか」は 059 の責務のまま。
#[tauri::command(async)]
pub fn play_notification_sound(device_id: String, sound: NotificationSound) -> AppResult<()> {
    // §8: frontend の生値を信用しない。空・制御文字は照合へ渡す前に弾く（多層防御）。
    // 実際の可否は下の照合（列挙結果との一致）で決まるので、ここは「明らかに不正」を落とすだけ。
    let device_id = device_id.trim();
    util::require_non_empty(device_id, "音声出力デバイスが選択されていません")?;
    util::reject_control_chars(device_id, "音声出力デバイスの指定が不正です")?;

    service::play_on_device(device_id, sound)
}
