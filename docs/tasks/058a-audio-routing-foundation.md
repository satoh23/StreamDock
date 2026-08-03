# 058a 音声ルーティング基盤（出力デバイスの列挙＋指定デバイス再生＋選択 UI）

> 状態: **実装済み（2026-08-04・[058s](058s-audio-output-device-spike.md) の結論「②-軽」に沿って全面的に書き直したうえで実装）。
> ⚠ 実機確認（`tauri dev` での耳・OBS メーターでの確認）と Windows 検証は本人が行う。**
> 分割・線引きは親 [058](058-stream-audio-routing.md) を正とし、**方式に関する記述は
> [058s](058s-audio-output-device-spike.md) の「スパイク結果」節が上書きする**。
>
> ⚠ **本ファイルは 2026-08-04 に書き直されている。** 旧版は ①（Web 側 `setSinkId`）前提で
> `audioRouting.ts` / `applyRoute` / `ttsQueue` の `getRoute` を作る計画だったが、058s の実測で
> **① は両 OS で成立しない**ことが確定した（macOS は `navigator.mediaDevices` ごと非対応、
> Windows は `setSinkId` はあるが `enumerateDevices` が `deviceId`・`label` とも空の 1 件しか返さず
> **渡せる ID が存在しない**）。**層が frontend から Rust（`rodio`）へ移り、security-review が必須になる。**
>
> **必読前提**: 親 [058](058-stream-audio-routing.md)、**方式決定 [058s](058s-audio-output-device-spike.md)
> （「スパイク結果」節が本タスクの実質的な仕様書）**、利用者側 [059](059-notification-sounds.md) /
> [059a](059a-comment-notification-sound.md) / [059b](059b-monetary-notification-sound.md)、
> [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)（Builder / `invoke_handler`）、
> [`error.rs`](../../apps/desktop/src-tauri/src/error.rs)（`AppError` / `AppResult`）、
> [`Cargo.toml`](../../apps/desktop/src-tauri/Cargo.toml)（**各 crate に追加理由コメントが付く文化**）、
> UI 設定の保存作法 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) と
> [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)、
> invoke ラッパの作法 [`obsApi.ts`](../../apps/desktop/src/features/comment-viewer/obsApi.ts)、
> 設定 UI [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)（項目名＝13px/700・説明＝`--muted`）、
> [`docs/security.md`](../security.md)（§1／§3／§4／§8／§9／§10／レビュー必須条件）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

**通知音だけを Rust（`rodio`）で鳴らし、出力デバイスを明示指定できるようにする基盤**を作る。
「配信に載せる／載せない」を出力デバイスの出し分けに還元するための土台であり、
どの音をいつ鳴らすか（音源・鳴らす条件・クールダウン・排他）は [059](059-notification-sounds.md) が決める。

### ②-軽の成立条件（058s の決定・再掲）

| 音 | 再生層 | 出力先 | 配信に | 本人に |
| --- | --- | --- | --- | --- |
| **読み上げ** | Web Audio（**現状のまま無改変**） | **OS 既定**＝仮想オーディオデバイス（または複数出力装置） | **載る** | 聞こえる（複数出力装置、または OBS の音声モニタリング経由） |
| **通知音** | **Rust（`rodio`）** | 実デバイス（スピーカー / ヘッドホン）を**明示指定** | **載らない** | 聞こえる |

- OBS 側は**アプリケーション音声キャプチャではなく**、**仮想デバイスを「音声入力キャプチャ」で拾う**構成にする。
- ⚠ **限界: 「読み上げを載せない」は選べない**（読み上げは常に OS 既定＝載る側へ出る）。
  → [058b](058b-voicevox-stream-output-toggle.md) は**保留**。
- ⚠ **ユーザーに仮想オーディオデバイスの導入を求めることになる。** UI に案内文言が必須。

## 現在の前提（調査結果・実コード）

- 音出しの実体は [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts) の `playWav` にある
  `src.connect(ctx.destination)` の 1 か所のみ。`ctx` の出どころは `createTtsQueue` が所有する単一 `AudioContext` と、
  [`voicevoxPreview.ts`](../../apps/desktop/src/features/comment-viewer/voicevoxPreview.ts) の別インスタンスの 2 系統。
  **本タスクはどちらにも触れない。**
- Rust 側に音声系 crate は無い（`rodio` / `cpal` ともゼロ）。Rust がやっている OS 操作はプロセス起動・停止、
  アイコン抽出、キーチェーン、sidecar 起動、updater。
- [`tauri.conf.json`](../../apps/desktop/src-tauri/tauri.conf.json) の `bundle` に **`resources` は無い**
  （`externalBin` と `icon` のみ）。アプリにファイルを同梱する経路は現状 sidecar だけ。
- State はすべて `std::sync::Mutex`（`DbState` / `ProcessRegistry` / `CommentSidecarState`）で、
  lock は `expect("... mutex poisoned")` が既定慣習。
- コマンドには 3 形態がある: 同期 `fn`／`#[tauri::command(async)]` ＋ 同期 `fn`（窓生成。メインスレッドを止めない）／
  `#[tauri::command]` ＋ `async fn`（`app_update` のみ）。
- 設定値の保存は **localStorage の `stream-dock.comment-viewer.*` 名前空間**が確立された作法
  （`load*` / `save*` のペア関数・例外は握りつぶし・不正値は既定へフォールバック）。
- 設定 UI は [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) にカード単位で並ぶ。
  [054](054-comment-viewer-settings-readability.md) で**書式の階層規則**が確定している
  （項目名＝`.fieldLabel` 13px/700/`var(--text)` ／ 説明＝`.note` `var(--muted)` ／ `--text-faint` は無効状態専用）。
  **新しい値を発明せず既存トークンを使うこと。**
- `SettingsView` は**表示専用**（state は親 `CommentViewerApp` が持ち `value` + `onXxxChange` で受ける。
  唯一の副作用は `useHostOs`）。

## ⚠ 058s の指示に対する 2 つの訂正（着手時に実測して判明）

`rodio` 0.22.2 / `cpal` 0.17.3 のソースを直接読んで確認した。

### 訂正 1: `wav` feature は symphonia を引く

058s は `features = ["playback","wav"]` を指示しているが、rodio 0.22.2 の実体は
`wav = ["symphonia-wav", "symphonia-pcm"]` である。＝`wav` を付けると `symphonia` /
`symphonia-core` / `symphonia-format-riff` / `symphonia-codec-pcm` / `symphonia-metadata` が入る。
058s の「39 crate」はこれを含んだ数字で、058s の確認コマンド案
`cargo tree -i symphonia || echo "OK: デコーダ一式を引いていない"` は **OK を出さない**。

**トーン生成なら decoder は一切不要**である。以下はいずれも feature gate されていない:

| API | gate |
| --- | --- |
| `rodio::source::SineWave` | 無し（`rand` も引かない） |
| `rodio::buffer::SamplesBuffer` | 無し |
| `rodio::Player::connect_new(mixer)` / `append()` | 無し |
| `rodio::play(mixer, reader)` | **← これだけ decoder が要る**（内部で `decoder::Decoder::new`） |

→ **`default-features = false, features = ["playback"]`** で `cpal` だけが入り、symphonia はゼロ。

実測（2026-08-04・macOS）: **増える crate は 11 件**（`cargo tree --edges normal` のユニーク解決後で **315 → 326**）。
`rodio` / `cpal` / `coreaudio-rs` / `dasp_sample` / `mach2` / `num-rational` / `num-bigint` / `num-integer` /
`objc2-audio-toolbox` / `objc2-core-audio` / `objc2-core-audio-types`。058s の見積もり（macOS 39）は
**使い捨てプロジェクトで測った総数**であって本体への増分ではなく、かつ symphonia を含んでいた。

⚠ **数え方が 2 通りあるので混同しないこと**（レビュー指摘で追記）。上の 11 件は **macOS ビルドツリーへの増分**で、
**`Cargo.lock` への追加は 16 件**（削除ゼロ）。差の 5 件（`alsa` / `alsa-sys` / `ndk-context` / `num-derive` /
`objc2-avf-audio`）は Linux / Android / iOS 専用で darwin ツリーには現れない。
**`cargo audit` は lock 全体を読むので、監査対象は 16 件のほう**。docs/security.md §10 は両方を書き分けている。

### 訂正 2: `cargo tree -i tokio` は「引いていない」判定に使えない

**tokio は Tauri v2 が既に保持している**（[`Cargo.toml`](../../apps/desktop/src-tauri/Cargo.toml) の
`tauri-plugin-updater` の項に明記済み）。`-i tokio` は `rodio` と無関係にヒットする。
正しい担保は「**`rodio` のサブツリーに async ランタイムが現れないこと**」。確認コマンドを差し替えた（後述）。

## このタスクでやること

### (1) `rodio` を追加する（`Cargo.toml`）

- `rodio = { version = "0.22", default-features = false, features = ["playback"] }`
- **既存 crate と同じ書式の理由コメント**を依存行の直上に置く（`tauri-plugin-updater` / `image` が手本）。
  書く内容:
  - webview では出力デバイスを選べないと **058s の実測で確定**したこと（＝この crate が要る理由）
  - `default-features = false` が**必須**である理由と、上記**訂正 1**（`wav` は symphonia を引く。
    本タスクはトーン生成なので decoder ゼロで済む）
  - **tokio / async ランタイムを引かない**こと＝「Rust は完全同期のまま」方針を破らない
  - 増える crate の実測値と `cargo audit` の結果
  - ⚠ **`rodio::speakers` は `experimental` feature 配下なので使わない**（安定 API の
    `DeviceSinkBuilder::from_device` を使う）
  - **`cpal` を直接依存にしない**（`rodio::cpal` の再エクスポートを使う）
  - ⚠ **Windows 申し送り**: `cpal` 0.17 は `windows` crate を `>=0.59, <=0.62` で要求する。
    ⚠ **レビューで実測して訂正**（当初「058a のせいで 2 系統並ぶ」と書いていたが誤り）。
    実測は **0.58.0〔自前・028〕/ 0.61.3〔tao→tauri〕/ 0.62.2〔cpal〕の 3 系統**で、
    **0.58 と 0.61.3 の併存は 058a 以前からの状態**＝058a が足すのは **3 本目の 0.62.2 だけ**。
    しかも 0.x 同士は cargo が統合しないので**「統一」は 098 でも達成できない**（028 を 0.62 へ上げても
    tao の 0.61.3 が残る＝到達点は 3→2）。098 で判断するのは統一の可否ではなく**重複コストの許容可否**。

### (2) Rust の `audio` モジュール（新規 `src/audio/`）

DB を持たないので `repository.rs` は作らない（`rakuraku/` と同型の `mod` / `model` / `service` / `commands`）。

- **`model.rs`**: `AudioOutputDevice { id, name }`（ts-rs で
  `../../src/features/comment-viewer/bindings/` へ export）と `NotificationSound`。
  - `NotificationSound` は **058a では `Test` の 1 バリアントだけ**。059a が `Comment`、059b が `Monetary` を足す。
- **`service.rs`**:
  - `list_output_devices()` — `rodio::cpal::default_host().output_devices()` を舐め、
    `DeviceTrait::id()`（→ `DeviceId` の `Display`）と `description().name()` を拾う。
    ⚠ **`devices()` ではなく `output_devices()`**（入力デバイスをそもそも見に行かない）。
    ⚠ `DeviceTrait::name()` は deprecated なので使わない。
    id / description のどちらかが取れないデバイスは飛ばす（列挙全体を落とさない）。
  - `find_output_device(id)` — **`output_devices()` を舐めて `id()` の文字列一致で探す**。
    ⚠ `HostTrait::device_by_id()` は使わない（あれは `devices()`＝**入力を含む全デバイス**を舐めるため）。
    こうすると「存在する」と「出力である」が 1 回の検査で済み、
    **再生経路が入力デバイスへ構造的に到達しない**。
  - `play_on_device(device_id, sound)` — 上で解決したデバイスに対し
    `DeviceSinkBuilder::from_device(device)?.open_stream()?` → `Player::connect_new(sink.mixer())` →
    `append(SamplesBuffer)` → **上限つきで完了を待つ**。
  - `samples_for(sound)` — トーン合成（純関数・テスト対象）。
- **`commands.rs`**: 下記 (3) の 2 本。薄く `service` へ委譲する。
- `src/lib.rs` に `mod audio;` と `invoke_handler` の 2 行を足す。

#### `OutputStream` のライフサイクル（実装の最大の勘所）

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| State に持つか | **持たない**（再生のたびに開いて閉じる） | `app.manage` が要らない＝`Sync` 問題が発生しない。音声デバイスを開きっぱなしにしない。**毎回デバイスを解決し直すので、デバイスが消えたことを再生時点で必ず検出できる** |
| 同期コマンドか | **`#[tauri::command(async)]` ＋ 同期 `fn`** | 同期コマンドはメインスレッドで走り、再生完了まで待つと UI が固まる。既存の窓生成コマンドと同型。tokio は Tauri v2 が既に保持しており**新規依存にならない** |
| 完了を待つか | **待つ（上限つき）** | `MixerDeviceSink` を drop するとストリームが閉じて音が切れる。開きっぱなしにしない以上、待つ以外の選択肢が無い。副産物として invoke の Promise 解決＝再生完了通知になり 059 が使える |
| 多重再生 | **058a は状態を持たない**（1 呼び出し 1 再生・独立） | クールダウンと排他は **059 の責務**。059b が「音源ごとに独立したクールダウン」を要求しているので、状態は 059 側に置くのが正しい |

`Send` / `Sync`: State を持たないので必要なのは **`Send` だけ**（`Sync` は不要）。
`MixerDeviceSink` は内部に `cpal::Stream` を持ち、macOS は
「`The dedicated thread architecture ensures Stream can implement Send.`」とソースに明記、
Windows（WASAPI）は `unsafe impl Send for Stream {}` / `unsafe impl Sync for Stream {}`。
→ 両 OS で `(async)` に載る。**crate 更新で壊れたら実行時ではなく `cargo check` で落ちるよう
コンパイル時アサートを置く。**

⚠ `Player::sleep_until_end()` は**使わない**（内部でチャネル受信を無期限に待ち、ストリームが死ぬと戻らない）。
合成した音の長さは自分で知っているので、`player.empty()` を**期限つきでポーリング**する
（050 の再生ストール監視と同じ発想＝無限待ちを作らない）。

### (3) コマンドは単一目的の 2 本だけ（§3）

```rust
#[tauri::command(async)]
pub fn list_audio_output_devices() -> AppResult<Vec<AudioOutputDevice>>;

#[tauri::command(async)]
pub fn play_notification_sound(device_id: String, sound: NotificationSound) -> AppResult<()>;
```

- **`run_command` 的な汎用は作らない。** `play_arbitrary_file(path)` のようなものも作らない。
- **frontend から任意のファイルパスを受け取らない**（そもそも音源ファイルが存在しない・下記 (4)）。
- **frontend から受けたデバイス ID は Rust 側で列挙結果と照合してから使う**（§8）。
- **`DbState` を取らない**（`extract_app_icon` の「DB は使わないため State を取らない（最小権限）」と同型）。
  副産物として**デバイス名がログ DB へ到達する経路が構造的に存在しない**（§9）。
- 列挙も `(async)` にする（WASAPI の列挙をメインスレッドで走らせない）。

### (4) 音源＝**Rust でトーンを生成する**（アセット同梱ゼロ）

058s のスパイクが正弦波で検証した経路をそのまま本番にする。

- **`bundle.resources` を足さない・`include_bytes!` もしない**
  ＝`tauri.conf.json` 差分ゼロ、ファイル I/O ゼロ、パス解決ゼロ。
  「frontend からパスを渡させない」より強く、**パスという概念自体が存在しない**。
- ライセンス確認の論点が 058a に発生しない（059 の責務のまま残る）。
- 副次効果として `wav` feature が不要になり、**symphonia を 1 crate も引かない**（訂正 1）。

### (5) エラー（`src/error.rs`）

`ErrorCode` に `AudioDeviceUnavailable` / `AudioPlaybackFailed` を足す。

- コンストラクタは **`update_check_failed()` と同じく引数を取らない**形にし、
  呼び出し側が生エラーを載せられないようにする（必ず `map_err(|_| ...)` の形にし、エラー値を束縛しない）。
- `log_message()` は**デバイス名・デバイス ID を含まない静的文字列**（§9）。

### (6) frontend（invoke ラッパ＋設定の永続化＋設定 UI）

- **`features/comment-viewer/audioOutputApi.ts`（新規）** — invoke の薄いラッパ 2 本。
  `obsApi.ts` と同型（`async`/`await` を使わず `return invoke<T>(...)`・catch しない・
  JSDoc にタスク番号と §番号）。**デバイス ID を frontend が組み立てない**（列挙結果の値をそのまま返すだけ）。
- **`features/comment-viewer/audioOutputPrefs.ts`（新規）** — 既存の `load*`/`save*` 作法どおり。
  - `AUDIO_OUTPUT_DEVICE_KEY = "stream-dock.comment-viewer.audio-output-device"`
  - `loadAudioOutputDeviceId(): string` — 未保存 / 空 / 長すぎる値 / 例外はすべて `""`（未選択）へ。
    localStorage は手で書き換えられるので長さ上限を持つ（§8）。
  - `saveAudioOutputDeviceId(id): void` — 例外は握りつぶす。
  - 保存するのは**ユーザーが選んだデバイス ID のみ**＝非機密の UI 設定値（`OBS_AUTO_ADD_KEY` と同種）。
- **`SettingsView.tsx`** — 「読み上げ（VOICEVOX）」カードの**直後**に「音声出力（通知音）」カードを新設。
  - デバイス選択（`Select`。先頭に「選択しない（通知音を鳴らさない）」）
  - **テスト再生ボタン**（034c の話者試聴ボタンと同じ考え方。⚠ **これが無いと 058s の合格基準
    「切替先で鳴る」＋「既定では鳴らない」を 058a 単体で測れない**）
  - 「再読み込み」ボタン（デバイスを挿し直したとき用。ホットプラグ監視は入れない）
  - フォールバック警告（下記 (7)）
  - **仮想オーディオデバイスの案内**（`.note` ＋ `<details className={styles.obsPasswordHelp}>`）
  - 書式は [054](054-comment-viewer-settings-readability.md) の規則どおり。
    **既存クラスのみ使用＝CSS 差分ゼロ**（新しい px / weight を発明しない）。
- **`CommentViewerApp.tsx`** — 既存作法どおり**親が state を所有**し `value` + `onXxxChange` で渡す
  （`obsConfig` / `onPreview` と同型。`SettingsView` の「表示専用」を崩さない）。
  059a が親の受信 effect から通知音を鳴らすので、親が持つのが前向きでもある。

### (7) フォールバックは **fail-closed（鳴らさない）**

⚠ **旧版（① 前提）の判断を意図的に反転させる。** 旧版は
「音が鳴らなくなるより、意図と違うデバイスから鳴るほうがマシ＝配信中に無音になる事故を作らない」だったが、
それは**読み上げ**の理屈である。**通知音では逆転する** —— 鳴らないのは軽微な不便だが、
既定デバイス（＝②-軽の運用では仮想オーディオデバイス）へ落ちると
**「載せないつもりの通知音が配信に載る」＝この機能の存在理由そのものが壊れる**。

| 状況 | Rust | UI |
| --- | --- | --- |
| 保存済み ID が現在の一覧に無い | `AppError`（**既定へ落とさない**） | `.errorText` で警告＋ select は「選択しない」表示。**保存済み ID は消さない**（挿し直せば復帰する） |
| 未選択 | frontend が invoke しない | `.note`「デバイスが未選択のあいだ、通知音は鳴りません。」 |
| 列挙失敗 / 0 件 | `AppError` / 空 `Vec` | `.errorText`「音声出力デバイスを取得できませんでした。」 |
| テスト再生失敗 | `AppError` | `.errorText`「テスト音を再生できませんでした。デバイスを選び直してください。」 |

⚠ **警告文にデバイス名・デバイス ID を出さない**（§9）。「以前選んだ」で特定せずに済ませる。

気付かせる仕組みは 3 段: ①設定を開いた時点で一覧と突き合わせて警告 ②「再読み込み」ボタンで再列挙
③テスト再生の失敗表示。

### (8) テスト

| 対象 | 方式 |
| --- | --- |
| `audioOutputPrefs.ts` | 純関数テスト（`ttsPrefs.test.ts` と同型）: 未保存 / 空 / 壊れた値 / 長すぎる値 / `getItem` 例外 / `setItem` 例外 / 往復 |
| `SettingsView` の新カード | コンポーネントテスト: デバイスが**名前で**並ぶ／保存済み ID が一覧に無いと警告が出る／未選択だとテスト再生が押せない／`onTestSound` が呼ばれる／**デバイス ID を画面に出していない** |
| `samples_for()` | Rust 純関数テスト: 長さ > 0・振幅が `[-1.0, 1.0]` に収まる・宣言した長さと実サンプル数が一致 |
| `MixerDeviceSink: Send` | コンパイル時アサート（crate 更新で壊れたら `cargo check` が落ちる） |
| デバイス列挙・実再生 | **単体テスト不可**（環境依存）。代わりに `include_str!` の**契約テスト**で不変条件を機械的に固定する |

契約テスト（`obs_config.rs` / `app_update::commands` の先例と同型。
⚠ **自己ヒットを避けるため needle は `format!` で実行時に組む**）:

- `src/audio/` に `default_output_device` / `from_default_device` / `open_default_sink` が現れない
  ＝ **既定デバイスへ黙って落ちる経路が無い**（(7) の担保）
- `src/audio/` に `input_devices` / `default_input_device` / `build_input_stream` / `devices(` が現れない
  ＝ **マイク（入力）に触れない**
- `src/audio/` に `unwrap()` / `.expect(` が現れない ＝ panic 経路が無い

**ミューテーションで実効性を確認する**（既存タスクの慣習）。最低限:
①`find_output_device` の照合を `default_output_device()` へのフォールバックに書き換えると契約テストがレッド
②`loadAudioOutputDeviceId` の空判定を反転させると prefs テストがレッド。

## このタスクでやらないこと

- **通知音そのもの**（[059](059-notification-sounds.md)）。本タスクが持つ音は
  「テスト再生用のトーン」1 つだけで、コメント音・投げ銭音は 059 が足す。
- **クールダウン・排他・音量**（059）。058a は状態を持たない。
- **読み上げのルーティング**（[058b](058b-voicevox-stream-output-toggle.md)＝**保留**）。
  `ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` は**無改変**（差分ゼロ）。
- 音量調整・正規化・ダッキング（読み上げ中に通知音を絞る等）。
- 仮想オーディオデバイスの自動インストール・導入支援。**案内文言のみ。**
- **マイク入力**・`getUserMedia`。**呼ばない。**
- ホットプラグ監視（デバイス着脱のイベント購読）。「再読み込み」ボタンで足りる。
- 窓間の設定同期（音はコメビュ窓でしか鳴らない）。
- `windows` crate のバージョン統一（⚠ そもそも 0.x 同士は cargo が統合しないので**統一は達成できない**。
  重複コストの許容可否を [098](098-windows-build.md) で判断する）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。新しい宛先は増えない。`csp: null` 不変・capability 追加ゼロ。
- **マイク（入力）に一切触れない。** `output_devices()` しか呼ばず、`getUserMedia` も呼ばない。
  契約テストで機械的に固定する。
- **コマンドは単一目的の 2 本**（§3）。汎用コマンド・任意パスの受け取りを作らない。
- **frontend から受けたデバイス ID は Rust 側で列挙結果と照合してから使う**（§8）。
- **デバイス名・デバイス ID をログ／外部へ出さない**（§9）。コマンドが `DbState` を取らないので
  ログ DB へ到達する経路が構造的に無い。`AppError` の文言も静的文字列のみ。
  localStorage に置くのは**ユーザー自身が選んだデバイス ID のみ**＝§9 追補（046a）が対象とする
  第三者の個人データではない（`OBS_AUTO_ADD_KEY` と同種の非機密値）。
- **新規 crate は `rodio` 1 本**。§10 に理由を記録し `cargo audit` を通す
  （`.githooks/pre-commit` が `Cargo.lock` のステージを検知して走る）。
- **`tauri.conf.json` 差分ゼロ**（音源を同梱しないので `bundle.resources` を足さない）。
- **全経路を `AppResult` に落とす**。`unwrap()` / `expect()` を使わない。

## 完了条件

- 本ファイルが ②-軽版に書き直され、059a/059b への申し送りがある。
- Rust の `audio` モジュールに列挙・トーン合成・指定デバイス再生が閉じており、
  コマンドは**単一目的の 2 本**（`list_audio_output_devices` / `play_notification_sound`）。
- **全経路が `AppResult`**。`src/audio/` に `unwrap()` / `expect()` が 1 つも無い。
- デバイス ID は **Rust 側で出力デバイス一覧と照合**され、見つからなければ**既定へ落とさずエラー**。
- **入力デバイスに一切触れていない**（契約テストで固定）。
- 設定ビューに「音声出力（通知音）」カードがあり、デバイスを選べ、テスト再生でき、
  見つからないデバイスは警告が出る。
- **CSS 差分ゼロ**・**`tauri.conf.json` 差分ゼロ**・新規 capability ゼロ・`csp: null` 不変・外部通信ゼロ。
- `ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` の**差分ゼロ**。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- `cargo check` / `cargo test` / `typecheck` / `lint` / `test` / `cargo audit` が通る。
- [`docs/security.md`](../security.md) の §4 / §9 / §10 とレビュー必須条件が更新され、
  **security-review を通っている**。
- [`docs/progress.md`](../progress.md) と [`docs/task-board.md`](../task-board.md) を更新。

## 確認コマンド

⚠ 058s の確認コマンド案のうち **2 つは訂正済み**（上記「2 つの訂正」を参照）。

```bash
git diff --stat
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml   # ← ts-rs bindings がここで出る
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# 依存が膨らんでいないことの担保（ユニーク crate 数で数える。行数ではツリーの重複を数えてしまう）
cargo tree --manifest-path apps/desktop/src-tauri/Cargo.toml --edges normal --prefix none | sort -u | wc -l

# デコーダを引いていないこと（features=["playback"] なので OK が出るのが正）
cargo tree --manifest-path apps/desktop/src-tauri/Cargo.toml -i symphonia || echo "OK: デコーダを引いていない"

# ⚠ 訂正: tokio は Tauri v2 が既に保持しているので `-i tokio` は必ずヒットする。
#   見るべきは「rodio のサブツリーに async ランタイムが現れないこと」。
cargo tree --manifest-path apps/desktop/src-tauri/Cargo.toml -p rodio --edges normal \
  | grep -E "tokio|async-std|futures-executor" || echo "OK: rodio は async ランタイムを引いていない"

cargo audit -f apps/desktop/src-tauri/Cargo.lock

# 読み上げ経路を触っていないことの担保（差分ゼロが期待）
git status --short -- apps/desktop/src/features/comment-viewer/ttsQueue.ts \
  apps/desktop/src/features/comment-viewer/voicevox.ts \
  apps/desktop/src/features/comment-viewer/voicevoxPreview.ts
# ゼロ拡大の担保（差分ゼロが期待。音源を同梱しないので tauri.conf.json も差分ゼロ）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json \
  .github/ apps/comment-sidecar/
# CSS 差分ゼロの担保
git status --short -- apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css
# panic 経路が無いことの担保
grep -rn "unwrap()\|\.expect(" apps/desktop/src-tauri/src/audio/ || echo "OK: panic 経路無し"
# マイクに触れていないことの担保
grep -rn "input_devices\|default_input_device\|build_input_stream\|getUserMedia" \
  apps/desktop/src-tauri/src/audio/ apps/desktop/src/features/comment-viewer/audioOutput*.ts \
  || echo "OK: 入力デバイスに触れていない"

pnpm --filter ./apps/desktop tauri dev
# ① 設定に「音声出力（通知音）」カードが出て、デバイスが名前つきで並ぶ
# ② 選んだデバイスからテスト音が鳴る／既定デバイスからは鳴らない（2 つ揃って初めて ✅）
# ③ OBS の「音声入力キャプチャ」で仮想デバイスを選ぶと、読み上げは拾えて通知音は拾えない
# ④ 選んだデバイスを OS から抜く → 設定を開き直すと警告が出て、既定へ落ちずに鳴らない
# ⑤ アプリ再起動後も同じデバイスが選択状態で復元される
# ⑥ ライト／ダーク両テーマで破綻しない
```

## ⚠ Windows 未検証

[058s](058s-audio-output-device-spike.md) の (3)(4) は **macOS のみ**の実測で、
Windows では `rodio` の実再生も WASAPI でのデバイス名／安定 ID の取得も**未検証**である
（[098](098-windows-build.md) の Windows ビルドも未完了）。
013 / 019 / 021 / 028 と同じ作法で、**macOS で実装し「Windows 未検証」を明記して進めた**。

根拠: `cpal` の WASAPI backend は同じ `DeviceTrait` を実装しており、
`description()` / `id()` / `output_devices()` の**呼び出し形は共通**。OS 差が出るのは返る値の質であって
API 経路ではない。ここで止めると 059a / 059b（通知音そのもの）も全部止まる。

### Windows で確認すること（本人の実機・098 完了後）

1. 起動できること（`pnpm check:sidecar` が通る＝098 の Windows sidecar が要る）
2. **デバイス名が読める文字列で並ぶ**（WASAPI の `description()` が空・記号だけにならないか）
3. 選んだデバイスからテスト音が鳴る／既定デバイスからは鳴らない
4. **アプリ再起動後も選択が復元される**（＝WASAPI で `DeviceId` が安定するか。**Windows 最大の未検証点**）
5. デバイスを OS から抜く → 警告が出て、既定へ落ちずに鳴らない
6. `cargo tree --edges normal --prefix none | sort -u | wc -l` と `cargo tree -i windows`
   （⚠ **3 系統＝0.58.0 / 0.61.3 / 0.62.2 が並ぶ想定**。うち 0.58/0.61.3 は 058a 以前からで、
   058a が足すのは cpal 由来の 0.62.2 のみ）の実測
7. `cargo audit` exit 0
8. 仮想オーディオデバイス（VB-CABLE 等）を導入し、②-軽の運用（読み上げは載る／通知音は載らない）が成立するか

## 059a / 059b への申し送り

- **コマンドの形は変えずに音を増やせる。** `play_notification_sound(deviceId, sound)` の
  `NotificationSound` に variant を足すだけ（059a が `Comment`、059b が `Monetary`）。
  ts-rs が frontend の型を自動追従させる。
- **音を増やす 3 つの道**:

  | 道 | decoder | 備考 |
  | --- | --- | --- |
  | エンベロープ付きトーンを合成し続ける | 不要 | 「ポン」は短い正弦波＋指数減衰でかなり近い。058a の `samples_for()` を拡張するだけ |
  | `include_bytes!` で**生 PCM**を焼き `SamplesBuffer` へ | 不要 | WAV ヘッダを持たない生サンプル列にしておく。`bundle.resources` も不要。⚠ **下記の注意あり** |
  | WAV ファイルを同梱 | **要**（`wav` feature ＝ +symphonia 4〜5 crate） | どうしても既製音源を使いたいときのみ。**ライセンス確認が要る**（059 の既存の申し送り） |

  ⚠⚠ **道②を採るなら契約テストの手当てが要る**（レビュー指摘）。`audio::service` の
  `accepts_no_file_path_from_the_frontend` は `audio/` 配下での `include_bytes!` の出現を禁止しているので、
  **そのまま書くと `cargo test` が落ちる**。守りたい不変条件は「**frontend から任意のパス／バイト列を
  受け取らない**」であって「ビルド時に固定のバイト列を焼き込まない」ではない（`include_bytes!` は
  コンパイル時に確定するので frontend の入力とは無関係）。道②を採るときは needle から `include_bytes!` を
  外し、**代わりに `PathBuf` / `std::fs` / 実行時のパス解決の不在で守る**こと。理由を 059 のタスクファイルと
  docs/security.md §4 追補に必ず書き残すこと。

- **クールダウン（どの音を何秒に 1 回まで鳴らすか）は 059 が持つ。** 059b の「音源ごとに独立した
  クールダウン」は 059a の `soundPrefs.ts` 側（または通知音モジュール）に最終再生時刻を持たせて実装する。
  ⚠ **ただし「同時再生 1 本」の上限だけは 058a が Rust 側に持っている**（`service::PLAYING` /
  `PlaybackGuard`。再生中に来た呼び出しは**鳴らさず `Ok(())`**）。これはクールダウンの代わりではなく
  **可用性（自己 DoS）対策**で、`#[tauri::command(async)]` ＋ 同期 fn の実体が
  `async_runtime::spawn`（`spawn_blocking` ではない）＝ **tokio の worker を再生時間ぶん占有する**ため。
  窓生成コマンドや updater と同じランタイムを共有するので、上限が無いと IPC 全体が詰まる。
  ⚠ **この上限を外さないこと**（`only_one_playback_runs_at_a_time` が固定）。059 のクールダウンは
  「上限に当たって音が捨てられる」状態を避けるために依然として必要。
- **`play_notification_sound` は再生完了まで待って resolve する。** 059 は待たずに投げっぱなしでよい。
  ⚠⚠ **ただし `.catch(() => {})` で握り潰して終わりにしないこと**（レビュー指摘で反転）。058a は
  fail-closed（見つからなければ鳴らさない）で、かつ**ホットプラグ監視を持たない**——設定画面を開いた
  時点でしか突き合わせない。ここで reject を無言で捨てると、**配信中にデバイスを抜いたとき通知音が
  一切鳴らなくなったことをユーザーが知る手段がゼロ**になる。「鳴らないほうがマシ」は「鳴らないことに
  気付けなくてよい」ではない。例外は伝播させず、`AUDIO_DEVICE_UNAVAILABLE` を受けたら
  **画面に継続表示される indicator を出す**こと（表示の設計は 059 の責務）。
  バッチ 1 回 1 呼び出しの規律は 059 のまま。
- **デバイス ID は `loadAudioOutputDeviceId()` で読む。** 未選択（`""`）なら**呼ばない**
  ＝通知音は鳴らない。059 側で既定デバイスへ落とさないこと（(7) の反転理由を参照）。
- **Web Audio 由来の罠は丸ごと消えた**（`resume()` の配線・autoplay 制限・`ttsQueue.dispose()` との干渉）。
  代わりに**出力デバイスが消えたときの扱い**が新しい論点になる。

## 実装後に必要なレビュー

**security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。
新規 crate（§10）・OS 操作面の拡大（§4）・新規コマンドの権限（§3）が対象。
観点に **「frontend から任意パス／任意 ID を受け取っていないこと」**と
**「入力デバイス（マイク）に触れていないこと」**を必ず含めること。
