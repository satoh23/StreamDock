//! 058a: 出力デバイスの列挙・照合と、指定デバイスでの通知音再生。
//!
//! rodio / cpal に触れるのは**このファイルだけ**（`commands.rs` は薄く委譲するだけ）。
//! セキュリティ上の不変条件は下部の `contract` テストがソース文字列で機械的に守っている。

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{buffer::SamplesBuffer, ChannelCount, Device, DeviceSinkBuilder, Player, SampleRate};

use super::model::{AudioOutputDevice, NotificationSound};
use crate::error::{AppError, AppResult};

/// ⚠ **tripwire**: `MixerDeviceSink` は内部に `cpal::Stream` を持つ。
///
/// 058a はストリームを State に置かず再生ごとに開いて閉じるので、`Sync` は要らないし、
/// `#[tauri::command(async)]` の中で await を跨がないためコンパイラは `Send` も要求しない。
/// それでも明示的に固定しておくのは、**この型がスレッドをまたいで動かせる**という前提の上に
/// 設計が乗っているから——再生は Tauri の async runtime のワーカースレッド（＝メインスレッドとは
/// 限らない）で走り、将来 State（`Mutex<MixerDeviceSink>`）へ移すなら `Sync` を得るために
/// `Send` が要る。rodio / cpal の更新でこの性質が崩れたら、実行時の不可解な挙動ではなく
/// **ここでコンパイルエラー**になる。
///
/// 実測（058a 着手時）: macOS は `Stream { inner: Arc<Mutex<StreamInner>>, _disconnect_manager }` で
/// ソースに「dedicated thread architecture ensures Stream can implement Send」と明記、
/// Windows(WASAPI) は `unsafe impl Send for Stream {}`。
const _: fn() = || {
    fn assert_send<T: Send>() {}
    assert_send::<rodio::MixerDeviceSink>();
};

/// 合成する音のサンプリング周波数（48 kHz）。
///
/// `SampleRate` は `NonZero<u32>` なので `new()` は `Option` を返す。`unwrap()` を書かずに済ませる
/// ため const 文脈で `match` する。
///
/// ⚠ **これは「0 を書いたらコンパイルエラーになる」仕掛けではない**（レビュー指摘で訂正）。
/// リテラルを 0 にすると `None` アームに落ちて `SampleRate::MIN`（＝**1 Hz**）へ静かに縮退し、
/// コンパイルは通ってしまう。実際の検出は `test_tone_has_samples_and_a_matching_duration`
/// （サンプル数が 0 になって落ちる）が担う。`match` の狙いは panic 経路を作らないことだけ。
const SAMPLE_RATE: SampleRate = match SampleRate::new(48_000) {
    Some(rate) => rate,
    None => SampleRate::MIN,
};

/// モノラル。通知音に定位は要らないうえ、デバイスのチャンネル数に依らず鳴らせる
/// （rodio の mixer が出力側の構成へ合わせる）。`ChannelCount::MIN` はちょうど 1。
const CHANNELS: ChannelCount = ChannelCount::MIN;

/// 波形の最大振幅。1.0 に張り付かせない（クリップと「うるさすぎ」を避ける）。
/// 音量調整 UI は 059 の領分なので、058a は固定値で鳴らす。
const PEAK_AMPLITUDE: f32 = 0.25;

/// 立ち上がり。0 から始めないと再生開始時に「プチッ」というクリックノイズが出る。
const ATTACK: Duration = Duration::from_millis(4);

/// 終端。指数減衰だけだと厳密には 0 で終わらないので、最後を直線的に 0 へ落として段差を消す。
const RELEASE: Duration = Duration::from_millis(12);

/// 再生完了待ちのポーリング間隔。
const PLAYBACK_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// 再生完了待ちの猶予。**無限に待たないための上限**で、音の長さに加算する。
///
/// ⚠ `Player::sleep_until_end()` を使わない理由がこれ。あれは内部で `recv()` を無期限に待つ。
/// ⚠ レビュー指摘で理由を訂正: **sink を drop した場合は送信側が落ちて即 `Err` で戻る**ので、
/// そこは危険ではない。本当に戻ってこないのは**ストリームは生きているのに OS がコールバックを
/// 呼ばなくなった（デバイスが stall した）**ときで、そうなると invoke の Promise が永久未解決になる。
/// 050 で読み上げに再生ストール監視を入れたのと同じ発想で、こちらも最初から上限を持たせる。
const PLAYBACK_GRACE: Duration = Duration::from_secs(1);

/// 再生完了を検出したあと、**ドライバのキューに残った音が鳴り切るまで**待つ時間。
///
/// ⚠⚠ **`Player::empty()` は「物理的に鳴り終わった」を意味しない**（レビュー指摘）。`empty()` が見る
/// カウンタは `Done` ラッパが**内部ソースを消費し切った**ときに減るもので、消費しているのは cpal の
/// データコールバックである。`DeviceSinkBuilder::from_device()` は buffer_size を **50 ms 相当**
/// （rodio 0.22 の `// aim for 50ms of audio`＝`sample_rate / 20`）に固定するので、`empty()` が true に
/// なった時点で**まだ最大 50 ms 分が未再生のままキューに残っている**。ここで `sink` を drop するとその
/// 分が破棄され、**末尾が切れてクリックノイズになる**（180 ms・tau=60 ms のテスト音だと打ち切り位置の
/// 振幅はピーク比 11% 程度＝無視できない）。RELEASE のランプは波形の末尾にあるので、この切断位置には効かない。
/// バッファ 50 ms に余裕を足して 80 ms 待つ。⚠ 上限つきである性質は保たれる（固定値・待ち続けない）。
const PLAYBACK_TAIL: Duration = Duration::from_millis(80);

/// 1 つの音の波形パラメータ。
struct ToneSpec {
    frequency_hz: f32,
    duration: Duration,
    /// 指数減衰の時定数。**大きいほど余韻が長い**（`exp(-t / decay_tau)`）。
    ///
    /// 059a で追加した。058a は `duration / 3` 固定だったが、それだと**長さを変えないと余韻を変えられない**
    /// ＝「短くて余韻の速い『ポン』」が作れない。音の性格は長さと減衰の 2 軸で決まるので、spec 側に出した。
    /// ⚠ 0 にすると `samples_for` の除算が壊れる（`f32::EPSILON` で下限を切ってあるが、意味のある音にならない）。
    decay_tau: Duration,
}

/// 音の種類ごとの波形パラメータ。
///
/// 音を増やすときは、`NotificationSound` に variant を足してここに 1 アーム足すだけでよい
/// （**デコーダも同梱ファイルも要らない**）。059a / 059b はどちらもこの手順だけで済んでいる。
///
/// ⚠ **同じ (周波数, 長さ) の音を 2 つ作らない**（`every_sound_has_a_distinct_tone` が固定している）。
/// 鳴らし分ける意味が消えるうえ、コピペで増やしたときに気付けない。
fn tone_spec(sound: NotificationSound) -> ToneSpec {
    match sound {
        // A5（880Hz）を 180ms。短く高めにすると「通知らしく」聞こえ、
        // 読み上げ（人の声の帯域）とも被りにくい。
        // decay_tau の 60ms は 058a の固定式（長さの 1/3）と**同じ狙いの値**で、テスト音の性格は変えていない。
        // ⚠ ただし **f32 のビット単位では一致しない**（実測: `0.18f32 / 3.0` = 0.060000002 に対し
        // `Duration::from_millis(60).as_secs_f32()` = 0.059999999 で**最下位ビット 1 つ分**ずれる）。
        // 相対誤差 6e-8＝サンプル値の丸め幅より小さく可聴差は無いので受容する。完全一致にこだわって
        // `duration / N` の形に戻すと**長さと余韻を独立に決められなくなる**——それが 059a で decay_tau を
        // spec 側へ出した理由そのものなので、そちらは採らない。
        NotificationSound::Test => ToneSpec {
            frequency_hz: 880.0,
            duration: Duration::from_millis(180),
            decay_tau: Duration::from_millis(60),
        },
        // 059a: コメント通知音の「ポン」。E5（660Hz）を 140ms・減衰 23ms。
        // Test（A5・180ms・減衰 60ms）から**完全 4 度低く・短く・余韻を速く**した。
        // 正弦波でも減衰を速くすると「ピーッ」ではなく打点のある「ポッ／ポン」寄りに聞こえる。
        // ⚠ 純正弦波なので木琴のような「ポン」そのものにはならない。**再修正トリガー＝実機で
        // 「ポンに聞こえない」と感じたとき**。そのとき初めて倍音（オクターブ上を低振幅で加算）を
        // 検討する（重みの和を 1 以下にすれば `every_sound_never_clips` の不変条件は保たれる）。
        NotificationSound::Comment => ToneSpec {
            frequency_hz: 660.0,
            duration: Duration::from_millis(140),
            decay_tau: Duration::from_millis(23),
        },
        // 059b: 投げ銭通知音。A4（440Hz）を 300ms・減衰 90ms。
        // **3 音（Test / Comment / Monetary）を続けて鳴らしても聞き分けられる**ことが唯一の設計目標で、
        // そのために音高・長さ・余韻の **3 軸すべて**で離した:
        //   ・音高: A5(880) / E5(660) / **A4(440)**。Test のちょうど 1 オクターブ下・Comment の完全 5 度下＝
        //     3 音が別のレジスタに並ぶ。低いほうへ外したのは「軽い通知」ではなく「重み」として聞こえるため。
        //   ・長さ: 180 / 140 / **300**ms。Comment の 2.1 倍で、「短い打点」対「長く伸びる 1 音」として
        //     音高を聞き取れなくても時間軸だけで判別できる。
        //   ・余韻: 60 / 23 / **90**ms。Comment が「ポッ」ならこちらは「ポーン」と残る。
        // ⚠ **倍音を足していない**（重みの和を 1 以下にすれば `every_sound_never_clips` は保てるが、
        //   `every_sound_decays_with_its_declared_time_constant` が「1 周期窓の最大値 ≒ 包絡」という前提で
        //   下限 0.90 を切っているので、**倍音の位相干渉で下振れしてレッドになりうる**。1 音足すために
        //   契約テストの許容帯を緩めるのは順序が逆）。
        //   **再修正トリガー＝実機で「区別はつくが安っぽい」と感じたとき**。そのときは倍音とテスト側の
        //   前提（包絡の推定方法）をセットで見直すこと。
        // ⚠ この 300ms は frontend のクールダウン下限にも効く。Rust の `PLAYING` は 300ms ＋
        //   `PLAYBACK_TAIL`(80ms) ＋ デバイス再列挙 ＋ stream open で概ね 400〜550ms 立つので、
        //   `notificationSound.ts` の `COOLDOWN_MS.monetary` はそれを下回らないこと（理由は同ファイル）。
        NotificationSound::Monetary => ToneSpec {
            frequency_hz: 440.0,
            duration: Duration::from_millis(300),
            decay_tau: Duration::from_millis(90),
        },
    }
}

/// その音の再生にかかる長さ。
pub fn duration_of(sound: NotificationSound) -> Duration {
    tone_spec(sound).duration
}

/// 音の波形を合成する（純関数＝環境に依らずテストできる唯一の部分）。
///
/// エンベロープは 3 つの gain の積で、いずれも `0.0..=1.0`。したがって
/// **出力の絶対値は必ず `PEAK_AMPLITUDE` 以下**になる（クリップしない）。この性質はテストで固定する。
pub fn samples_for(sound: NotificationSound) -> Vec<f32> {
    let spec = tone_spec(sound);
    let rate = f64::from(SAMPLE_RATE.get());

    let total = (rate * spec.duration.as_secs_f64()).round() as usize;
    // 0 除算を作らないため、各区間は最低 1 サンプル。
    let attack = ((rate * ATTACK.as_secs_f64()).round() as usize).max(1);
    let release = ((rate * RELEASE.as_secs_f64()).round() as usize).max(1);
    // 指数減衰の時定数は音ごとに `tone_spec` が持つ（059a で固定式から spec 側へ出した）。
    // 0 除算を作らないための下限だけここで切る。
    let decay_tau = spec.decay_tau.as_secs_f32().max(f32::EPSILON);

    (0..total)
        .map(|index| {
            let t = index as f32 / SAMPLE_RATE.get() as f32;
            let attack_gain = (index as f32 / attack as f32).min(1.0);
            let decay_gain = (-t / decay_tau).exp();
            let release_gain = ((total - index) as f32 / release as f32).min(1.0);
            let envelope = attack_gain * decay_gain * release_gain;
            PEAK_AMPLITUDE * envelope * (std::f32::consts::TAU * spec.frequency_hz * t).sin()
        })
        .collect()
}

/// その ID を**選択肢として出してよいか**（＝あとで必ず再生に使えるか）。純関数＝テストできる。
///
/// ⚠ **`play_notification_sound` の検証を通らない ID は、列挙の時点で落とす**（レビュー指摘）。
/// コマンド側は受け取った ID を `trim()` してから制御文字を弾き（§8 の多層防御）、その値で
/// `find_output_device` の**完全一致**照合を行う。列挙がその正規化に耐えない ID を返してしまうと、
/// **UI には出て選べるのに再生時には必ず失敗する**——fail-closed 方向なので危険ではないが、
/// ユーザーからは「そのデバイスだけ永久に鳴らない」原因不明の故障に見え、直しようがない。
/// ここで揃えることで「**一覧に出るなら必ず鳴らせる**」が不変条件になる。
///
/// ⚠ Rust の `char::is_control` は U+0080..=U+009F も含み、frontend 側の
/// `isValidAudioOutputDeviceId`（U+0000..=U+001F / U+007F）より**広い**。**広いほう＝ここに合わせる**
/// （狭いほうに合わせると「frontend が通した値を Rust が弾く」という同じ問題が残る）。
fn is_selectable_device_id(id: &str) -> bool {
    id.trim() == id && !id.chars().any(char::is_control)
}

/// 選択できる音声**出力**デバイスを列挙する。
///
/// ⚠ **`output_devices()` しか呼ばない**（`devices()` は入力を含む全件を返す）。マイクを一覧に混ぜない
/// ためだけでなく、「このアプリは入力デバイスを見に行かない」を構造的に言い切るため。
///
/// 名前か ID のどちらかを取れないデバイスは**黙って飛ばす**（列挙全体を失敗させない）。
/// 名前が無いものは UI に出しても選べず、ID が無いものは保存しても再指定できないので、
/// どちらも「選択肢として成立しない」＝落とすのが正しい。
///
/// ⚠ 同じ理由で、**`play_notification_sound` の検証を通らない ID も落とす**（レビュー指摘）。
/// 詳細はループ内の注記。
pub fn list_output_devices() -> AppResult<Vec<AudioOutputDevice>> {
    let host = rodio::cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|_| AppError::audio_device_unavailable())?;

    let mut result = Vec::new();
    for device in devices {
        let (Ok(id), Ok(description)) = (device.id(), device.description()) else {
            continue;
        };
        let id = id.to_string();
        if !is_selectable_device_id(&id) {
            continue;
        }
        result.push(AudioOutputDevice {
            id,
            name: description.name().to_string(),
        });
    }
    Ok(result)
}

/// frontend から受け取った ID を、**現在の出力デバイス一覧と照合**して解決する（docs/security.md §8）。
///
/// ⚠⚠ **見つからなくても既定デバイスへ落とさない。** ここが 058a のいちばん重要な設計判断で、
/// ②-軽の運用では OS 既定＝仮想オーディオデバイス＝**配信に載る側**なので、既定へ落とすと
/// 「載せないつもりの通知音が配信に載る」＝この機能の存在理由そのものが壊れる。
/// 鳴らないのは軽微な不便で、載るのは事故。**fail-closed。**
///
/// ⚠ `HostTrait::device_by_id()` は使わない。あれは内部で `devices()`（**入力を含む全件**）を舐めるため。
/// 出力一覧を舐めて自分で照合すれば「存在する」と「出力である」を 1 回で検査でき、
/// 再生経路が入力デバイスへ構造的に到達しない。
fn find_output_device(device_id: &str) -> Option<Device> {
    rodio::cpal::default_host()
        .output_devices()
        .ok()?
        .find(|device| device.id().is_ok_and(|id| id.to_string() == device_id))
}

/// 同時に走ってよい再生を 1 本に制限するフラグ。⚠ **クールダウンではなくリソース保護である。**
///
/// ⚠⚠ `#[tauri::command(async)]` ＋ 同期 fn は、`tauri-macros` の tracing ラベルが
/// `"sync_threadpool"` になるので「専用のブロッキングプールへ逃げる」と誤解しやすいが、**あれは
/// ラベル文字列にすぎない**。実体は `tauri/src/ipc/mod.rs` の `InvokeResolver::respond_async` →
/// **`async_runtime::spawn`**（`spawn_blocking` **ではない**）で、`async_runtime` の実体は
/// tokio のマルチスレッドランタイムである。つまり同期 fn の本体は **worker を 1 本占有したまま**
/// 再生が終わるのを待つ。窓生成コマンドや `check_app_update` / `install_app_update` と
/// **同じランタイムを共有している**ので、積み上がると IPC 全体が詰まる（自己 DoS）。
///
/// 058a 単体では呼び出し元がテスト再生ボタン 1 つ（再生中は disabled）なので実害は無い。だが
/// **059 はコメント受信ごとにこれを呼ぶ**ため、クールダウンが音の長さより短いと worker が積み上がる。
/// 「059 が正しくクールダウンを実装すること」に可用性を賭けたくないので、**上限は 058a 側で構造的に持つ**。
///
/// ⚠ 競合したときは**エラーにせず黙って捨てる**（`Ok(())`）。理由は 2 つ——新しいエラー面（UI 文言・
/// エラーコード）を増やさないため、および 059 の「投げっぱなし（`.catch(() => {})`）」導線と噛み合うため。
/// これは 059b が要求する「音源ごとに独立したクールダウン」の代わりにはならない（あちらは依然 059 の責務）。
static PLAYING: AtomicBool = AtomicBool::new(false);

/// `PLAYING` を RAII で解放する。
///
/// early return でもエラー経路でもフラグが立ちっぱなしにならないようにするためのもの。手で
/// `store(false)` を書くと、`?` で抜けた経路を 1 つ落としただけで**以降まったく鳴らなくなる**。
struct PlaybackGuard;

impl PlaybackGuard {
    /// 取れなければ `None`（＝別の再生が進行中）。
    fn acquire() -> Option<Self> {
        PLAYING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for PlaybackGuard {
    fn drop(&mut self) {
        PLAYING.store(false, Ordering::Release);
    }
}

/// 指定デバイスで通知音を 1 回鳴らし、**鳴り終わるまで待ってから**返る。
///
/// **ストリームは State に持たず、再生のたびに開いて閉じる。** 理由:
/// - `app.manage` が要らない＝このリポジトリの `std::sync::Mutex` State に載せる話が発生しない。
/// - 音声デバイスを開きっぱなしにしない。
/// - **毎回デバイスを解決し直すので、デバイスが抜かれたことを再生時点で必ず検出できる**
///   （キャッシュしていると「もう無いデバイス」へ鳴らし続けることになる）。
///
/// 完了まで待つのは選択ではなく帰結で、`MixerDeviceSink` を drop するとストリームが閉じて音が切れる。
/// 開きっぱなしにしない以上、待つ以外にない。副産物として invoke の Promise 解決＝再生完了通知になり、
/// 059 が「鳴り終わった」を知れる。⚠ **UI を止めないため、呼び出し側のコマンドは必ず
/// `#[tauri::command(async)]` にすること**（同期コマンドはメインスレッドで走る）。
///
/// **クールダウン（どの音を何秒に 1 回まで鳴らすか）は持たない**——それは 059b が「音源ごとに独立した
/// クールダウン」を要求しているので 059 側の状態である。一方で**同時再生は 1 本に制限する**
/// （`PLAYING` の注記。リソース保護であってクールダウンではない）。
pub fn play_on_device(device_id: &str, sound: NotificationSound) -> AppResult<()> {
    // 同時再生は 1 本まで。取れなければ**この呼び出しは鳴らさずに成功で返す**（理由は `PLAYING`）。
    let Some(_playback) = PlaybackGuard::acquire() else {
        return Ok(());
    };

    let device = find_output_device(device_id).ok_or_else(AppError::audio_device_unavailable)?;

    let mut sink = DeviceSinkBuilder::from_device(device)
        .map_err(|_| AppError::audio_playback_failed())?
        .open_stream()
        .map_err(|_| AppError::audio_playback_failed())?;
    // rodio は既定で drop 時に「ストリームを閉じると音が止まる」旨を stderr へ出す。ここでは
    // **鳴り終わってから閉じるのが設計どおり**なので、鳴らすたびに警告を出させない
    //（§9 的にも、通知音 1 回ごとに標準エラーへ行を増やす理由が無い）。
    sink.log_on_drop(false);

    let player = Player::connect_new(sink.mixer());
    player.append(SamplesBuffer::new(
        CHANNELS,
        SAMPLE_RATE,
        samples_for(sound),
    ));
    wait_until_finished(&player, duration_of(sound));
    // ⚠ `empty()` は「mixer が最後のサンプルを引き取った」時点で true になるだけで、**物理再生の完了
    // ではない**。ここで待たずに抜けると、ドライバのキューに残った最大 50ms が破棄されて末尾が切れる
    //（詳細は `PLAYBACK_TAIL`）。
    std::thread::sleep(PLAYBACK_TAIL);

    // ここで player → sink → _playback（PLAYING の解放）の順に drop され、OS の出力ストリームが閉じる。
    Ok(())
}

/// 再生が終わるまで待つ。**上限つき**（無限待ちを作らない）。
///
/// `Player::empty()` は `append` で加算され、音が終わると `Done` が減らすカウンタを見ている。
/// `append` はカウンタを同期的に増やすので、直後に呼んでも「もう空」にはならない。
fn wait_until_finished(player: &Player, duration: Duration) {
    let limit = duration.saturating_add(PLAYBACK_GRACE);
    let started = Instant::now();
    while !player.empty() && started.elapsed() < limit {
        std::thread::sleep(PLAYBACK_POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    //! 058a の仕様テスト。
    //!
    //! デバイス列挙と実再生は**環境依存で単体テスト不可**（CI にも開発機にも同じ音声デバイスは無い）。
    //! そこで検証は 2 本立てにする:
    //! 1. **純関数**（波形合成）の性質を固定する。
    //! 2. **ソース文字列の契約テスト**で、テストでは踏めないセキュリティ不変条件を機械的に守る。
    //!    `obs_config` / `app_update::commands` / `lib.rs::pinned_overlay_contract` の先例と同型。
    use super::*;

    /// 鳴らせる音の全種類。
    ///
    /// ⚠ **059 が variant を足すと `sound_label` の `match` がコンパイルエラーになる**ので、
    /// ここへの追加を忘れられない（`error.rs` の `wire_name` / `ALL` と同じ idiom）。
    /// 波形の不変条件（クリップしない・無音から始まって無音で終わる・宣言した長さと一致する）は
    /// **どの音についても成立しなければならない**——058a の申し送りが「音を増やすのは
    /// `samples_for` の `match` に 1 アーム足すだけ」と書いている以上、増えた音が自動で検査される必要がある。
    const ALL_SOUNDS: [NotificationSound; 3] = [
        NotificationSound::Test,
        NotificationSound::Comment,
        NotificationSound::Monetary,
    ];

    /// 失敗メッセージ用のラベル。**exhaustive な `match`** であることが上記の担保。
    fn sound_label(sound: NotificationSound) -> &'static str {
        match sound {
            NotificationSound::Test => "Test",
            NotificationSound::Comment => "Comment",
            NotificationSound::Monetary => "Monetary",
        }
    }

    const MOD_RS: &str = include_str!("mod.rs");
    const MODEL_RS: &str = include_str!("model.rs");
    const SERVICE_RS: &str = include_str!("service.rs");
    const COMMANDS_RS: &str = include_str!("commands.rs");

    /// `audio` モジュールの**本番コード**（コメントとテスト自身を除いたもの）。
    ///
    /// ⚠ この 2 段の除去が無いと契約テストは原理的に無意味になる:
    /// - `include_str!` は自分自身も読むので、**禁止語をこのテストに書いた時点で自己ヒットする**。
    ///   → `#[cfg(test)]` 以降を切り落とし、needle は `format!` で実行時に組む。
    /// - 禁止 API は「使わない理由」を doc コメントで説明したい。
    ///   → 行コメントを剥がしてから照合する。
    ///
    /// ⚠ `audio/` にファイルを足したら、ここの一覧にも足すこと
    /// （足し忘れは `the_contract_covers_every_file_in_the_audio_module` が検出する）。
    ///
    /// 剥がすのは**行コメント（`//` 始まり）だけ**でブロックコメント（`/* */`）には対応しない
    /// （レビュー指摘に対する判断）。理由＝誤検知方向（テストが不当に落ちる側）に倒れるだけで
    /// 不変条件は破られないうえ、このリポジトリのコメントは `//` / `//!` / `///` に統一されているため。
    /// 再修正トリガー＝`audio/` にブロックコメントを書きたくなり、実際にここが誤検知で落ちたとき。
    fn production_sources() -> Vec<(&'static str, String)> {
        let test_marker = format!("#[cfg({})]", "test");
        [
            ("mod.rs", MOD_RS),
            ("model.rs", MODEL_RS),
            ("service.rs", SERVICE_RS),
            ("commands.rs", COMMANDS_RS),
        ]
        .into_iter()
        .map(|(name, raw)| {
            let head = raw.split(&test_marker).next().unwrap_or(raw);
            let code = head
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            (name, code)
        })
        .collect()
    }

    fn assert_absent(needle: &str, why: &str) {
        for (name, code) in production_sources() {
            assert!(
                !code.contains(needle),
                "audio/{name} に {needle:?} が現れた。{why}"
            );
        }
    }

    /// 指定ファイルの本番コード（コメントとテストを除いたもの）。
    fn production_source(file: &str) -> String {
        production_sources()
            .into_iter()
            .find(|(name, _)| *name == file)
            .map(|(_, code)| code)
            .unwrap_or_else(|| panic!("audio/{file} が production_sources() の一覧に無い"))
    }

    /// `assert_absent` の対。指定ファイルに `needle` が**在る**ことを固定する。
    ///
    /// ⚠ 「禁止 API の不在」だけでは、**検証やスレッド逃がしを削除する**方向の退行を検出できない
    /// （レビュー指摘）。守りたい不変条件には「無い」ではなく「在る」で表すものがあるので、両方要る。
    fn assert_present_in(file: &str, needle: &str, why: &str) {
        let code = production_source(file);
        assert!(
            code.contains(needle),
            "audio/{file} から {needle:?} が消えた。{why}"
        );
    }

    #[test]
    fn never_falls_back_to_the_default_output_device() {
        // 058a の最重要不変条件（fail-closed）。②-軽では OS 既定＝仮想オーディオデバイス＝
        // **配信に載る側**なので、既定へ落とすと「載せないつもりの通知音が配信に載る」。
        // 保存済み ID が一覧に無いときは鳴らさず AppError を返すのが正しい。
        let why = "既定デバイスへのフォールバックは禁止（載せないつもりの音が配信に載る）。\
                   見つからないときは AppError::audio_device_unavailable() を返すこと。";
        assert_absent(&format!("default_{}_device", "output"), why);
        assert_absent(&format!("from_default_{}", "device"), why);
        assert_absent(&format!("open_default_{}", "sink"), why);

        // ⚠ レビュー指摘で理由を分離: `open_sink_or_fallback` は**既定デバイスへは落ちない**
        // （`with_device(device.clone())` で同一デバイスのまま、別の supported config を試すだけ）。
        // 上の 3 つとは禁止理由が違うので、失敗メッセージを混ぜない（混ぜると将来の実装者を誤誘導する）。
        assert_absent(
            &format!("open_sink_or_{}", "fallback"),
            "058a は config フォールバックも持たない（失敗の意味を「default config で開けなければ \
             AudioPlaybackFailed」に統一する）。⚠ これは既定デバイスへのフォールバックとは**別物**で、\
             解禁しても fail-closed は壊れない。採るなら docs/security.md §4 追補を更新すること。",
        );
    }

    #[test]
    fn validates_the_device_id_before_using_it() {
        // docs/security.md §8 の多層防御。禁止 API の**不在**テストでは「検証呼び出しを消す」退行を
        // 検出できない（レビュー指摘）ので、**在ること**を固定する。
        let why = "§8: frontend の生値を照合へ渡す前に、空と制御文字を弾くこと（多層防御）。";
        assert_present_in("commands.rs", &format!("require_non_{}", "empty"), why);
        assert_present_in("commands.rs", &format!("reject_control_{}", "chars"), why);
    }

    #[test]
    fn both_commands_stay_off_the_main_thread() {
        // 再生は完了まで待つ＝同期コマンドに戻すと、その間メインスレッドが止まって UI が固まる。
        // 列挙も WASAPI / CoreAudio で数十〜数百 ms かかりうる。doc に「⚠ 同期に戻さないこと」と
        // 書いてあるだけで機械的担保が無かった（レビュー指摘）。
        let marker = format!("command({})", "async");
        let count = production_source("commands.rs").matches(&marker).count();
        assert_eq!(
            count, 2,
            "audio のコマンド 2 本はどちらも #[tauri::{marker}] であること（同期に戻すと UI が固まる）"
        );
    }

    #[test]
    fn commands_take_no_db_state() {
        // docs/security.md §9: デバイス名 / ID が app_logs や診断サマリーへ到達する経路を
        // **構造的に**作らない（`extract_app_icon` と同じ最小権限）。State を取らなければ到達しようがない。
        assert_absent(
            &format!("Db{}", "State"),
            "§9: audio のコマンドは DbState を取らない（デバイス名/ID がログ DB へ到達する経路を作らない）。",
        );
    }

    #[test]
    fn the_contract_covers_every_file_in_the_audio_module() {
        // ⚠ `production_sources()` は `include_str!` の手書き一覧なので、`audio/` にファイルを足しても
        // 自動では検査対象に入らない（レビュー指摘）。数を固定して、足した瞬間にここが落ちるようにする。
        // **落ちたら `production_sources()` の一覧にそのファイルを足すこと**（消して通してはいけない）。
        assert_eq!(
            production_sources().len(),
            4,
            "audio/ のファイル構成が変わった。production_sources() の一覧に足し忘れていないか確認すること"
        );
    }

    #[test]
    fn only_one_playback_runs_at_a_time() {
        // ⚠ 再生中は tokio の worker を 1 本占有する（`PLAYING` の注記）。059 がコメント受信ごとに
        // 呼ぶので、上限が無いと worker が積み上がって IPC 全体が詰まる（自己 DoS）。
        // ⚠ ガード単体の挙動だけでなく、**再生経路が実際にガードを取っていること**も固定する
        // （これが無いと `play_on_device` から acquire を消しても下の 3 つの assert は通ってしまう）。
        assert_present_in(
            "service.rs",
            &format!("PlaybackGuard::{}", "acquire"),
            "play_on_device が同時再生の上限を取らなくなった（tokio worker が積み上がる）。",
        );

        let first = PlaybackGuard::acquire().expect("最初の取得は必ず成功する");
        assert!(
            PlaybackGuard::acquire().is_none(),
            "同時に 2 本目の再生を開始できてしまう（worker が積み上がる）"
        );
        drop(first);
        assert!(
            PlaybackGuard::acquire().is_some(),
            "再生終了後にガードが解放されていない（以降まったく鳴らなくなる）"
        );
    }

    #[test]
    fn never_touches_input_devices() {
        // docs/security.md §4: 追加するのは出力デバイスの列挙と再生のみ。マイクには触れない。
        let why = "マイク（入力）に触れない方針の違反。出力は output_devices() だけで列挙すること。";
        assert_absent(&format!("{}_devices", "input"), why);
        assert_absent(&format!("default_{}_device", "input"), why);
        assert_absent(&format!("build_{}_stream", "input"), why);
        assert_absent(&format!("{}", "microphone"), why);
        // `host.devices()`（入力を含む全件）。`output_devices(` は `_devices(` なので一致しない。
        assert_absent(&format!(".{}(", "devices"), why);
    }

    #[test]
    fn has_no_panicking_paths() {
        // 全経路を AppResult に落とす（058a の完了条件）。
        let why = "audio モジュールは panic 経路を持たない（全経路を AppResult に落とす）。";
        assert_absent(&format!("unwrap{}", "()"), why);
        assert_absent(&format!(".{}(", "expect"), why);
        assert_absent(&format!("{}!(", "panic"), why);
    }

    #[test]
    fn accepts_no_file_path_from_the_frontend() {
        // docs/security.md §3 / §4: 音源はアプリ内で合成する。パスもバイト列も受け取らない。
        let why = "frontend から任意パス/任意バイト列を受け取らない（音はアプリ内で合成する）。";
        assert_absent(&format!("Path{}", "Buf"), why);
        assert_absent(&format!("include_{}!", "bytes"), why);
        assert_absent(&format!("std::{}", "fs"), why);
    }

    #[test]
    fn only_lists_device_ids_that_playback_will_accept() {
        // 「一覧に出るなら必ず鳴らせる」を固定する。デバイス列挙そのものは環境依存で試せないが、
        // 判定は純関数に切り出してあるのでここで検査できる（レビュー指摘のミューテーション対策）。
        //
        // ⚠ 判定の中身だけでなく、**列挙が実際にこれを通していること**も固定する
        // （呼び出し側から外されると、下の assert が全部通ったまま不変条件だけ壊れる）。
        assert_present_in(
            "service.rs",
            &format!("{}(&id)", "is_selectable_device_id"),
            "list_output_devices が選択可否の判定を通さなくなった\
             （再生で必ず失敗する ID を一覧に出してしまう）。",
        );

        assert!(is_selectable_device_id("CoreAudio:BuiltInSpeakerDevice"));

        // ⚠ 前後空白: コマンド側が trim() してから完全一致照合するので、そのままでは絶対に一致しない。
        assert!(!is_selectable_device_id(" CoreAudio:Speaker"));
        assert!(!is_selectable_device_id("CoreAudio:Speaker "));

        // ⚠ 制御文字: コマンド側の reject_control_chars で弾かれる。
        assert!(!is_selectable_device_id("CoreAudio:Spea\nker"));
        assert!(!is_selectable_device_id("CoreAudio:Spea\u{0}ker"));
        // ⚠ U+0080..=U+009F は frontend 側の正規表現では通ってしまうが、Rust の char::is_control は弾く。
        // **広いほう（ここ）に合わせる**ので、これも選択肢に出さない。
        assert!(!is_selectable_device_id("CoreAudio:Spea\u{85}ker"));
    }

    #[test]
    fn every_sound_has_samples_and_a_matching_duration() {
        // ⚠ `duration_of()` は `wait_until_finished` の上限そのものなので、実サンプル数とずれると
        // 「宣言より長い音が途中で切られる」または「短い音で無駄に待つ」ことになる。
        for sound in ALL_SOUNDS {
            let label = sound_label(sound);
            let samples = samples_for(sound);
            assert!(!samples.is_empty(), "{label} が無音（0 サンプル）になっている");

            let expected =
                (f64::from(SAMPLE_RATE.get()) * duration_of(sound).as_secs_f64()).round() as usize;
            assert_eq!(
                samples.len(),
                expected,
                "{label}: duration_of() と実サンプル数がずれている\
                 （再生完了待ちの上限が実際の長さと合わなくなる）"
            );
        }
    }

    #[test]
    fn every_sound_never_clips() {
        // エンベロープはすべて 0.0..=1.0 の gain の積なので、絶対値は PEAK_AMPLITUDE を超えない。
        // ここが崩れると耳に痛い音・歪んだ音になる（かつ 059 で音量を足したとき前提が壊れる）。
        for sound in ALL_SOUNDS {
            let label = sound_label(sound);
            for sample in samples_for(sound) {
                assert!(
                    sample.is_finite(),
                    "{label}: 波形に NaN / Inf が混ざっている（合成式のバグ）"
                );
                assert!(
                    sample.abs() <= PEAK_AMPLITUDE,
                    "{label}: 振幅 {sample} が上限 {PEAK_AMPLITUDE} を超えた（クリップする）"
                );
            }
        }
    }

    #[test]
    fn every_sound_starts_and_ends_at_silence() {
        // 先頭・末尾が 0 付近でないと、再生の切れ目で「プチッ」というクリックノイズが出る。
        // 末尾はピーク比で見る（絶対値で閾値を切ると振幅や長さを変えたときに壊れる）。
        // ATTACK / RELEASE を外すと末尾はピーク比 3% 程度まで跳ねるので、1% で両側に十分な余裕がある。
        for sound in ALL_SOUNDS {
            let label = sound_label(sound);
            let samples = samples_for(sound);
            let peak = samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
            let first = samples.first().copied().unwrap_or_default();
            let last = samples.last().copied().unwrap_or_default();

            assert_eq!(
                first, 0.0,
                "{label}: 先頭が無音から始まっていない（クリックノイズ）"
            );
            assert!(peak > 0.0, "{label}: 波形の振幅が 0（無音）になっている");
            assert!(
                last.abs() <= peak * 0.01,
                "{label}: 末尾が無音へ落ちていない（クリックノイズ）: last={last} peak={peak}"
            );
        }
    }

    #[test]
    fn every_sound_has_a_distinct_tone() {
        // 059a: 音を増やす手順が「`tone_spec` に 1 アーム足すだけ」である以上、**直前のアームを
        // コピペして値を変え忘れる**のが一番ありうる事故で、しかも耳で聞くまで気付けない。
        //
        // ⚠ これは「**実機で聞き分けられる**」の証明ではない（それはテストで担保できないので
        // 059a / 059b の実機確認項目にしてある）。ここが止めるのは「値がまるごと同一」だけ。
        // 周波数は `to_bits()` で比べる＝浮動小数の等値比較を避けつつ「同じリテラルを書いた」を検出する。
        let mut seen: Vec<(u32, Duration, &'static str)> = Vec::new();
        for sound in ALL_SOUNDS {
            let label = sound_label(sound);
            let spec = tone_spec(sound);
            let key = (spec.frequency_hz.to_bits(), spec.duration);
            let clashes: Vec<&str> = seen
                .iter()
                .filter(|(frequency, duration, _)| (*frequency, *duration) == key)
                .map(|(_, _, other)| *other)
                .collect();
            assert!(
                clashes.is_empty(),
                "{label} と {clashes:?} の (周波数, 長さ) が同一。\
                 鳴らし分ける意味が消えるので、どちらかの値を変えること"
            );
            seen.push((key.0, key.1, label));
        }
    }

    #[test]
    fn every_pair_of_sounds_differs_on_all_three_axes() {
        // 059b の仕様: 「**3 音を続けて鳴らしても聞き分けられる**ことが唯一の設計目標で、そのために
        // 音高・長さ・余韻の **3 軸すべて**で離した」（`model.rs` の `Monetary` の doc と `tone_spec`）。
        //
        // ⚠ `every_sound_has_a_distinct_tone` は **(周波数, 長さ) のタプル一致**しか見ないので、
        // 「音高だけ Comment と同じ 660Hz にする」ような変更は**長さが違えば通ってしまう**。
        // 3 軸のどれか 1 つでも被ると、その軸で区別しているユーザー（音高で聞き分ける人／
        // 時間軸で聞き分ける人）にとって 2 音が同じ音になるので、軸ごとに固定する。
        //
        // ⚠ これも「実機で聞き分けられる」ことの証明ではない（それは実機確認の項目）。
        // ここが止めるのは「設計目標として離すと決めた軸が、値の変更で静かに縮む」ことだけ。
        for (i, a) in ALL_SOUNDS.iter().enumerate() {
            for b in ALL_SOUNDS.iter().skip(i + 1) {
                let (label_a, label_b) = (sound_label(*a), sound_label(*b));
                let (spec_a, spec_b) = (tone_spec(*a), tone_spec(*b));

                // 周波数は `to_bits()` で比べる（浮動小数の等値比較を避ける・上のテストと同じ idiom）。
                assert_ne!(
                    spec_a.frequency_hz.to_bits(),
                    spec_b.frequency_hz.to_bits(),
                    "{label_a} と {label_b} の音高が同じ（音高で聞き分けられなくなる）"
                );
                assert_ne!(
                    spec_a.duration, spec_b.duration,
                    "{label_a} と {label_b} の長さが同じ（時間軸で聞き分けられなくなる）"
                );
                assert_ne!(
                    spec_a.decay_tau, spec_b.decay_tau,
                    "{label_a} と {label_b} の余韻が同じ（「ポッ」と「ポーン」の差が消える）"
                );
            }
        }
    }

    #[test]
    fn every_sound_decays_with_its_declared_time_constant() {
        // 059a: `decay_tau` を `ToneSpec` へ出した目的は「**長さと余韻を独立に決められる**」ことなので、
        // **spec に書いた値が実際に波形へ効いていること**を固定する。
        //
        // ⚠ これが無いと `samples_for` の tau 導出を 058a の固定式（`duration / 3`）へ戻す退行を
        // 誰も検出できない——`every_sound_has_a_distinct_tone` は (周波数, 長さ) しか見ず、
        // クリップ／無音始まり終わり／宣言長の 3 本も固定式のままで全部通ってしまう（実測）。
        //
        // 検査するのは**指数減衰の定義そのもの**＝「`t = decay_tau` で包絡がピークの 1/e になる」。
        // 実装の式ではなく仕様を見ているので、合成方法を変えても意味が保たれる。
        // 正弦波なので個々のサンプルは包絡を下回る。**1 周期ぶんの窓の最大値**を取れば
        // `|sin|` はほぼ 1 に達するので、その最大値を包絡の推定値として使える。
        for sound in ALL_SOUNDS {
            let label = sound_label(sound);
            let spec = tone_spec(sound);
            let samples = samples_for(sound);
            let rate = f64::from(SAMPLE_RATE.get());

            // ATTACK(4ms) より後・RELEASE(12ms) より前でないと、他の gain が混ざって
            // 「減衰だけを見ている」と言えなくなる。前提が崩れたらここで気付けるようにする。
            assert!(
                spec.decay_tau > ATTACK && spec.decay_tau + RELEASE < spec.duration,
                "{label}: decay_tau({:?}) が ATTACK/RELEASE と重なっていて、\
                 このテストは減衰以外の gain も一緒に測ってしまう。音の設計を見直すこと",
                spec.decay_tau
            );

            let period = (rate / f64::from(spec.frequency_hz)).ceil() as usize;
            let window_max = |start: usize| {
                samples[start..(start + period).min(samples.len())]
                    .iter()
                    .fold(0.0_f32, |acc, s| acc.max(s.abs()))
            };

            let tau_index = (rate * spec.decay_tau.as_secs_f64()).round() as usize;
            let measured = window_max(tau_index);
            // 期待値＝ピーク振幅の 1/e。窓の中でも減衰は進むので**下振れ方向にだけ**余裕を見る
            //（上振れは「減衰が遅すぎる」＝検出したい退行そのものなので許さない）。
            let expected = PEAK_AMPLITUDE * (-1.0_f32).exp();
            assert!(
                measured <= expected * 1.02 && measured >= expected * 0.90,
                "{label}: decay_tau({:?}) の時点の振幅が {measured}。\
                 指数減衰なら概ね {expected}（ピークの 1/e）になるはずで、外れているなら\
                 `samples_for` が spec の decay_tau を使っていない疑いがある",
                spec.decay_tau
            );
        }
    }

    #[test]
    fn append_makes_the_player_non_empty_right_away() {
        // `wait_until_finished` は `Player::empty()` を見て「まだ鳴っている」を判定する。
        // `append` がカウンタを**同期的に**増やさないと、直後の empty() が true になって
        // **一度も鳴らないまま関数を抜ける**（音が出ない）。この前提が rodio 更新で崩れたら落とす。
        //
        // 実デバイスは要らない: `rodio::mixer::mixer()` で OS へ繋がっていない mixer を作れる。
        let (mixer, _source) = rodio::mixer::mixer(CHANNELS, SAMPLE_RATE);
        let player = Player::connect_new(&mixer);
        assert!(player.empty(), "何も append していないのに空でない");

        player.append(SamplesBuffer::new(
            CHANNELS,
            SAMPLE_RATE,
            samples_for(NotificationSound::Test),
        ));
        assert!(
            !player.empty(),
            "append 直後に empty() が true（再生待ちが即座に終わり、音が出ないまま抜ける）"
        );
    }

    #[test]
    fn waiting_for_playback_always_has_an_upper_bound() {
        // ⚠ 058a の可用性の要。`Player::sleep_until_end()` を避けて上限つきポーリングにした理由が
        // これで、**デバイスが stall して誰もサンプルを引かなくなっても invoke の Promise を
        // 永久未解決にしない**。上限を外す退行をここで止める。
        //
        // `_source`（MixerSource）を**消費しない**＝誰もサンプルを引かない＝ `Done` が発火しない
        // ＝ `empty()` は永久に false のまま、という「stall した状態」を再現している。
        let (mixer, _source) = rodio::mixer::mixer(CHANNELS, SAMPLE_RATE);
        let player = Player::connect_new(&mixer);
        player.append(SamplesBuffer::new(
            CHANNELS,
            SAMPLE_RATE,
            samples_for(NotificationSound::Test),
        ));

        let started = Instant::now();
        // 音の長さは 0 として、上限が PLAYBACK_GRACE ちょうどになる条件で測る。
        wait_until_finished(&player, Duration::ZERO);
        let waited = started.elapsed();

        assert!(
            !player.empty(),
            "誰も再生していないのに empty になった（このテストの前提が崩れている）"
        );
        assert!(
            waited >= PLAYBACK_GRACE,
            "上限より早く抜けた（鳴り終わる前に打ち切っている）: {waited:?}"
        );
        assert!(
            waited < PLAYBACK_GRACE * 3,
            "上限で抜けていない＝無限待ちになっている（invoke の Promise が解決しない）: {waited:?}"
        );
    }
}
