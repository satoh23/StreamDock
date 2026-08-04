# 059a 通知音の基盤＋コメント通知音

> 状態: **実装済み（2026-08-04・[058s](058s-audio-output-device-spike.md) の結論「②-軽」に沿って全面的に書き直したうえで実装）。
> ⚠ 実機確認（`tauri dev` での耳での確認・デバイス抜き差し）は本人が行う。**
> 分割・線引きは親 [059](059-notification-sounds.md) を正とし、**再生方式に関する記述は
> [058s](058s-audio-output-device-spike.md) の「スパイク結果」節と [058a](058a-audio-routing-foundation.md) が上書きする**。
>
> ⚠ **本ファイルは 2026-08-04 に書き直されている。** 旧版は **Web Audio（専用 `AudioContext`）前提**で
> 「音源を同梱して `decodeAudioData` し、`GainNode` で音量を掛け、autoplay 対策に `resume()` を配線する」計画だったが、
> 058s の実測で **webview では出力デバイスを選べない**ことが確定し（macOS は `navigator.mediaDevices` ごと非対応、
> Windows は `setSinkId` はあるが `enumerateDevices` が `deviceId`・`label` とも空）、**再生層が Rust（`rodio`）へ移った**。
> 058a がその基盤を実装済み（2026-08-04・`122ebd6`）なので、059a は**その上にクールダウンと配線を載せるだけ**になった。
> 失効した記述の一覧は下記「⚠ 旧版から失効した記述」。
>
> **必読前提**: 親 [059](059-notification-sounds.md)、**方式決定 [058s](058s-audio-output-device-spike.md)（「スパイク結果」節）**、
> **基盤 [058a](058a-audio-routing-foundation.md)（特に末尾「059a / 059b への申し送り」節）**、
> 次に乗るもの [059b](059b-monetary-notification-sound.md)、
> invoke ラッパ [`audioOutputApi.ts`](../../apps/desktop/src/features/comment-viewer/audioOutputApi.ts)、
> デバイス ID の永続化 [`audioOutputPrefs.ts`](../../apps/desktop/src/features/comment-viewer/audioOutputPrefs.ts)、
> コメント受信の合流点 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、
> 差分検出 [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts)（`{ next, added, updated }`）、
> UI 設定の保存作法 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) /
> [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)、
> [`docs/security.md`](../security.md)（§3 / §4 追補〈058a〉/ §8 / §9 追補〈058a〉/ §10 / **レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示した**。
> ⚠ **レビュー区分は当初「軽レビュー」と判定したが、レビューで security-review 必須へ是正された**（判定と経緯は末尾）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

依頼者の要望①「**コメントが来たときに通知音**（「ポン」というような音）を出す」を実装する。
あわせて [059b](059b-monetary-notification-sound.md)（投げ銭音）が乗る**通知音の基盤**——
**音源 ID ごとに独立したクールダウン層**——をここで作る。

## ⚠ 旧版から失効した記述（Web Audio 前提の箇所）

| 旧版の記述 | 現在の正 |
| --- | --- |
| (1) 音源を base64 data URI / `src/assets/` で**同梱**する | **音は Rust 側で合成する**（`audio::service::samples_for`）。同梱ファイルもパスも存在しない |
| (2) `notificationSound.ts` が**専用 `AudioContext`** を持つ／`decodeAudioData` の結果をキャッシュ／`GainNode` で音量 | Web Audio を使わない。`playNotificationSound(deviceId, sound)` を呼ぶだけ |
| (2)(4) `suspended` のとき黙って return ／ `resume()` を公開し `ttsQueue.resume()` と同じ契機で呼ぶ | **autoplay の壁は丸ごと消えた**。`resume` の配線は不要（忘れて macOS で鳴らない、という事故も消えた） |
| (2) 「配信に載せる」は 058a の `applyRoute(ctx, route)` を設定変更のたびに呼ぶ | **`applyRoute` は 058a 旧版（①`setSinkId` 前提）の API で実在しない**。058a は ②-軽版へ全面的に書き直されている |
| (3) `sound-volume`（既定 0.5・0〜1・範囲外クランプ）／「**音量スライダーは出す**。固定音量では実用にならない」 | **音量 UI は出さない**（下記 (3)）。根拠が「読み上げと同じ出力先へ出る」＝Web Audio 前提で失効している |
| (3) `sound-comment-stream-output`（配信に載せるか） | **作らない**。②-軽では「通知音＝選んだ実デバイス＝載らない」で固定済みで、トグルにする余地が無い |
| 「現在の前提」節の「音を鳴らす手本は `playWav`」「`AudioContext` は `createTtsQueue` が 1 つだけ所有」「autoplay の壁」 | 事実としては今も正しいが、**059a の設計判断には一切効かない**。必読前提からも外した |
| 完了条件「`AudioContext` が `suspended` のとき例外を投げず、`resume()` 後に鳴る（macOS で確認）」 | 同上（削除） |
| 完了条件「**音源のライセンス**が確認され progress.md に記録されている」 | 道①（自作合成）を採ったので**ライセンス確認の論点自体が消えた**。「同梱音源ではなくアプリ内合成である」ことの記録に置換 |
| 完了条件・確認コマンドの「**Rust / 依存は差分ゼロ**」「`git status -- apps/desktop/src-tauri/`（差分ゼロ期待）」 | **Rust には差分が出る**（`NotificationSound` に variant 追加）。**依存・capabilities・`tauri.conf.json` は差分ゼロのまま** |
| セキュリティ制約「再生は既存の **Web Audio API** で完結する」／レビュー節「**frontend のみ**だから軽レビュー」 | 再生は Rust。`csp: null` 不変・外部通信ゼロ・**新規依存ゼロ**（`rodio` は 058a で導入済み）は不変。レビュー区分の判定は末尾 |

## 現在の前提（調査結果・実コード）

- **058a が実装済み**（2026-08-04・`122ebd6`）。次はすべて存在するので**作り直さない**:
  - Rust コマンド 2 本 `list_audio_output_devices()` / `play_notification_sound(deviceId, sound)`
  - frontend ラッパ [`audioOutputApi.ts`](../../apps/desktop/src/features/comment-viewer/audioOutputApi.ts)、
    デバイス ID の永続化 [`audioOutputPrefs.ts`](../../apps/desktop/src/features/comment-viewer/audioOutputPrefs.ts)
  - 設定 UI の「音声出力（通知音）」カード（デバイス選択・**テスト再生**・再読み込み・警告表示・仮想デバイス案内）
  - 親（`CommentViewerApp`）が持つ `audioOutputDeviceId` / `audioOutputDevices` / `audioOutputListState` / `audioTestState`
- **音を増やすのは `NotificationSound` に variant を足し、`tone_spec` に 1 アーム足すだけ**（decoder も同梱ファイルも不要）。
  ts-rs が frontend の型を自動追従させる。テストの `ALL_SOUNDS` / `sound_label` は
  **variant を足すとコンパイルエラーになる設計**なので追加漏れを起こせない。
- ⚠ **デバイス未選択（`""`）は「既定デバイスで鳴らす」ではなく「鳴らさない」**（fail-closed）。②-軽では
  OS 既定＝仮想オーディオデバイス＝**配信に載る側**なので、既定へ落とすと
  「載せないつもりの通知音が配信に載る」＝機能の存在理由が壊れる。**059a 側でも既定へ落とさない。**
- ⚠ **`play_notification_sound` は鳴り終わってから resolve する。** 059 は待たずに投げっぱなしでよいが、
  **`.catch(() => {})` で握り潰さない**（058a は fail-closed かつホットプラグ監視を持たないため、
  無言で捨てると配信中にデバイスを抜いたことに気付く手段がゼロになる）。
- ⚠ **同時再生 1 本の上限は Rust が持っている**（`PLAYING` / `PlaybackGuard`）。これは**クールダウンではなく
  可用性（自己 DoS）対策**なので**外さない・緩めない**。「どの音を何秒に 1 回まで鳴らすか」は 059a の責務。
- 新着コメントの検出点は既にある: `mergeComments(prev, incoming)` が **`added`** を返す
  （`updated` は 043e の Jewels combo 限定）。**通知音も `added` に相乗りする**（新しい差分検出を発明しない）。
- 設定値は localStorage の `stream-dock.comment-viewer.*` 名前空間が確立された作法。

## このタスクでやったこと

### (1) 音は **Rust でトーン合成する**（アセット同梱ゼロ）

058a の申し送りにある 3 つの道のうち **道①（エンベロープ付きトーン合成）** を採った（本人決定・2026-08-04）。

| 道 | decoder | 契約テスト | ライセンス | 依存 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **① トーン合成** | 不要 | **手当て不要** | **論点が消える**（自作） | ゼロ | **採用** |
| ② `include_bytes!` で生 PCM | 不要 | ⚠ 要手当て（`accepts_no_file_path_from_the_frontend` が `include_bytes!` を禁止） | 出所しだいで要確認 | ゼロ | 見送り |
| ③ WAV 同梱 | **要**（`wav` feature） | 不要 | **要確認** | ⚠ +symphonia 4〜5 crate | 見送り |

- **道②を見送った理由**: 守りたい不変条件は「frontend から任意のパス／バイト列を受け取らない」であって
  「ビルド時に固定バイト列を焼かない」ではない——という整理自体は正しいが、**needle を外す＝セキュリティ契約を
  触る変更**なので、1 音足すだけの作業に security-review 級の判断がぶら下がる。得るのは音色の自由度だけ。
- **道③を見送った理由**: 059 の「新規依存ゼロ」方針の変更にあたる（＋ライセンス）。要望は
  「コメントが来たと気づける」であって「良い音を鳴らす」ではない。
- **`bundle.resources` を足さない・`include_bytes!` もしない**＝`tauri.conf.json` 差分ゼロ・ファイル I/O ゼロ・
  パス解決ゼロ。「frontend からパスを渡させない」より強く、**パスという概念自体が存在しない**。
- **ライセンス確認は不要**（第三者素材を配布バイナリに入れない）。ただし
  **「同梱音源ではなくアプリ内合成である」ことを [`docs/progress.md`](../progress.md) に記録する**。

#### `Test` と `Comment` は**別の音**にする

同じ音にしない理由＝設定画面に「テスト再生」（058a・出力先の検証）と「試聴」（059a・音の確認）の
**2 つのボタンが並ぶ**ので、同じ音だと「どちらを押したか分からない」＝テスト再生の診断価値が落ちる。
`tone_spec` に同じ値のアームが 2 つ並ぶのも、後から意味の読めないコードになる。

| 音 | 周波数 | 長さ | 減衰時定数 |
| --- | --- | --- | --- |
| `Test`（既存） | 880 Hz (A5) | 180 ms | 60 ms |
| **`Comment`（059a）** | **660 Hz (E5)** | **140 ms** | **23 ms** |

- 完全 4 度低く・短く・余韻を速くした。正弦波でも減衰を速くすると「ピーッ」ではなく打点のある「ポッ／ポン」寄りになる。
- 実装は `ToneSpec` に `decay_tau: Duration` を 1 フィールド足し、`samples_for` の tau 導出を
  「`duration / 3` 固定」から spec の値へ変えた（1 行）。**長さと余韻を独立に決められる**ようにするため。
- ⚠ **`Test` の波形は「同じ狙いの値」だが f32 ビット単位では一致しない**（実測: `0.18f32 / 3.0` = 0.060000002 に対し
  `Duration::from_millis(60).as_secs_f32()` = 0.059999999 で**最下位ビット 1 つ分**ずれる）。相対誤差 6e-8 ＝
  サンプル値の丸め幅より小さく可聴差は無いので受容した。完全一致にこだわって `duration / N` の形に戻すと
  **長さと余韻を独立に決められなくなる**（それが decay_tau を spec 側へ出した理由そのもの）。
- ⚠ 純正弦波なので木琴のような「ポン」そのものにはならない。**再修正トリガー＝実機で「ポンに聞こえない」と
  感じたとき**。そのとき初めて倍音（オクターブ上を低振幅で加算）を検討する
  （重みの和を 1 以下にすれば `every_sound_never_clips` の不変条件は保たれる）。

### (2) 通知音のクールダウン層（新規 `notificationSound.ts`）

`features/comment-viewer/notificationSound.ts` を新設。**Web Audio には一切触れない**（旧版の (2) は全面失効）。

```ts
export type NotificationSoundOutcome = "played" | "skipped" | "failed";
export function requestNotificationSound(
  sound: NotificationSound,
  deviceId: string,
): Promise<NotificationSoundOutcome>;
export function resetNotificationSoundCooldownForTest(): void;
```

- **音源 ID ごとに独立したクールダウン**（`Record<NotificationSound, number>` ＋ `Map<NotificationSound, number>`）。
  ⚠⚠ **共有カウンタにしない**——共有すると 059b で「コメントが流れている最中のスパチャ音が
  コメント音のクールダウンで消える」＝**一番気づいてほしい音が鳴らない**という最悪の挙動になる。
  059b は `COOLDOWN_MS` に `monetary` の行を足すだけで乗る。
  ⚠ `Record<NotificationSound, number>` なので、Rust に variant を足すと**ここが型エラーになる**（追加漏れ不能）。
- **コメント音のクールダウン＝600ms**（初期値）。根拠:
  1. **下限は Rust の占有時間で決まる。** コメント音は 140ms ＋ `PLAYBACK_TAIL`(80ms) ＝ **約 220ms** のあいだ
     Rust の `PLAYING` が立つ。これより短いと「**クールダウンは通ったのに Rust に黙って捨てられる**」状態になり、
     クールダウンが効いていないのに音だけ減る、という読み解けない挙動になる。220ms の 2 倍以上の余裕を取る。
  2. **上限は体験で決まる。** 600ms なら 1 秒あたり最大 1〜2 回。気づく目的には十分でうるさくない。
     dev-mock（1800ms 間隔）は素通しなので動作確認では毎回鳴る。
  3. 投げ銭音（059b）は独立なので、この 600ms がスパチャの検知を遅らせない。
  ⚠ **実機で調整した最終値と理由をコメントに残すこと。**
- ⚠ **時刻は「invoke を投げた時点」で記録する（成否を待たない）**。`play_notification_sound` は鳴り終わってから
  resolve するので、解決を待つとクールダウンが再生時間ぶん伸びて意味がぶれる。
  **失敗しても記録する**＝デバイスが抜けている間 invoke を撃ち続けない。
- **未選択（`""`）なら invoke しない**＝`"skipped"`。⚠⚠ **既定デバイスへ落とさない**（fail-closed）。
- **失敗は例外にせず `"failed"` で返す。** 例外を投げない（コメント受信経路を巻き添えにしない）が、
  **握り潰しもしない**（呼び出し側が indicator を出せる）。
- ⚠ **キューイングしない**（溜めて後から連打しない）。落とすのが正しい（親 059 の決定）。
- ⚠ **ユーザーの明示操作（試聴・テスト再生）はこの関数を通さない。** 押したのに鳴らないのは壊れて見えるので、
  明示操作にレート制限をかけない（034c の話者試聴と同じ）。連打は「再生中は disabled」で抑える。

#### ⚠ Rust の「同時再生 1 本」との役割の違い

| | 何のためか | 粒度 | 競合時 | 触ってよいか |
| --- | --- | --- | --- | --- |
| Rust の `PLAYING` / `PlaybackGuard`（058a） | **可用性（自己 DoS）対策**。`#[tauri::command(async)]` は tokio worker を占有する | 音の種類に関係なく**全体で 1 本** | 鳴らさず `Ok(())` | ⚠ **外さない・緩めない**（レビュー必須条件） |
| `notificationSound` のクールダウン（059a） | **体験（うるささ）対策** | **音源 ID ごとに独立** | 呼ばずに `"skipped"` | 059 の責務・調整可 |

### (3) 設定（`ttsPrefs.ts` ではなく新規 `soundPrefs.ts`）

- ⚠ **`ttsPrefs.ts` に足さない**（読み上げとは別概念。再生層すら違う）。
- キーは **`sound-comment-enabled`（既定 OFF）の 1 つだけ**。
  **既定 OFF の理由**＝アップデート直後に**ユーザー操作ゼロで音が鳴り始める**のを避ける
  （`OBS_AUTO_ADD_KEY` 等が既定 OFF なのと同じ考え方）。**この判断は JSDoc に残した。**
- ⚠ **`sound-volume` は作らない**（本人決定・2026-08-04）。旧版の「固定音量では実用にならない」という根拠は
  **Web Audio 前提で失効している**——旧案は読み上げと通知音が同じ出力先へ出るのでアプリ内の相対音量調整が要る、
  という構図だった。②-軽では**通知音だけがユーザーの選んだ実デバイス**へ出て読み上げは OS 既定へ出るので、
  **OS のデバイス別音量が通知音だけに独立して効く**（macOS＝出力デバイスごとの音量 / Windows＝音量ミキサー）。
  加えて振幅は Rust の `PEAK_AMPLITUDE` 固定で、frontend にキーだけ作っても**何も効かない**。
  - **再修正トリガー**: 実機で「小さすぎ／大きすぎ」なら**まず `PEAK_AMPLITUDE` を調整する**
    （1 行・引数面は増えないのでレビュー区分も不変）。それでも足りず「デバイスや配信ごとに変えたい」となったら
    **別タスクへ切り出す**——必要なのは「Rust の引数追加＋§8 のクランプ（NaN / Inf / 範囲外）＋
    `every_sound_never_clips` の書き換え＋**security-review**」のセット。
- ⚠ **`sound-comment-stream-output` も作らない**（②-軽では「通知音＝選んだ実デバイス＝載らない」で固定済みで、
  トグルにする余地が無い。説明は 058a の音声出力カードの案内文が担っている）。

### (4) 配線（`CommentViewerApp.tsx` / `SettingsView.tsx`）

- `CommentViewerApp` の受信 effect（`mergeComments` の合流点）で、**`added` が 1 件以上なら 1 回だけ**鳴らす。
  - ⚠⚠ **`added.length` の回数だけ呼ばない**（バッチで 20 件届いても 1 回）。クールダウンで潰れるとしても、
    **意図として「1 バッチ 1 回」をコードとテストで明示**した。
  - ⚠ **`updated`（043e の Jewels combo 更新）では鳴らさない**（`added` しか渡さないことで守る）。
  - ⚠ ON かつデバイス選択済みのときだけ invoke する。未選択なら**呼ばない**。
  - ⚠ **ref を 2 本使う**（`soundCommentEnabledRef` / `audioOutputDeviceIdRef`）。state を直接依存に入れると
    コールバックが作り直され、それを依存に持つ **WS 接続 effect が張り直されて「窓内 WS 1 本」の原則に反する**。
  - ⚠ **StrictMode の updater 二重実行**: `main.tsx` は `<React.StrictMode>` なので dev では updater が 2 回走る。
    `enqueueForSpeech` は `seenIds`、`recordComments` は `INSERT OR IGNORE` で冪等だが、**通知音は構造的には
    冪等でない**。1 回で済むのは同一 tick の 2 回目が必ずクールダウンに当たるため＝**クールダウンが冪等化も
    担っている**。偶然に見えて設計なので、コメントに明記しテストで固定した。
- **`resume()` の配線は不要**（autoplay の壁が消えた）。`ttsQueue` / `voicevox` / `voicevoxPreview` は**差分ゼロ**。
- 設定ビューに **新カード「通知音」** を「音声出力（通知音）」カードの**直後**に新設
  （読み上げ → 音声出力 → 通知音 ＝「どこへ出すか」→「何を鳴らすか」の順）。
  - ON/OFF トグル（既定 OFF）＋ **試聴ボタン**＋ 説明。
  - **試聴は 058a のテスト再生と重複しない**——あちらは出力先の検証（`Test` 音）、こちらは音の確認（`Comment` 音）。
  - ⚠ 出力先が未選択でも**トグルを disabled にしない**（別カードの状態に依存する disabled は理由が読めず、
    「先に ON にしてから出力先を選ぶ」順序を禁止する理由も無い）。代わりに **ON かつ未選択のときだけ**
    `.errorText` で理由を文章にし、**試聴ボタンだけ disabled** にする。
  - ⚠ 「保存済みデバイスが見つからない」ときは**このカードでは何も言わない**（058a のカードの担当。
    両方出すと同じ状態を 2 つの違う言葉で二重に叱ることになり、かつ「未選択」は事実として誤り）。
  - 書式は [054](054-comment-viewer-settings-readability.md) の規則どおり。**既存クラスのみ＝CSS 差分ゼロ。**
- ⚠ ON/OFF をツールバーへ置かない理由＝通知音は「一度 ON にしたらそのまま」寄りの設定
  （045b がツールバーへ移したのは配信中に頻繁に切り替える操作）。右クラスタは既にトグル 2＋ボタン 2 で、
  059b が来ると 4 トグルになり狭窓で崩れる。**再修正トリガー＝実機で「配信中に頻繁に切りたい」と感じたとき。**

### (5) 鳴らせなかったことの**継続表示** indicator（058a が 059 へ投げた宿題）

⚠⚠ **これが無いと、配信中にデバイスを抜いたとき黙って鳴らなくなる。** 058a は fail-closed かつ
ホットプラグ監視を持たない（設定画面を開いた時にしか突き合わせない）ので、ここが唯一の気付ける経路になる。

| 論点 | 決定 |
| --- | --- |
| どこに | コメビュ本体ツールバーの `.toolbarActions`（**045c の OBS エラーと同じ位置・同じ `.toolbarError`** ＝CSS 差分ゼロ） |
| 文言（表示） | 「**通知音を再生できません**」 |
| 文言（`title`） | 「通知音の出力先が見つかりません。設定の「音声出力（通知音）」でデバイスを選び直してください。」 |
| 表示条件 | `soundCommentEnabled && notificationSoundFailed`。⚠ **OFF のときは出さない**（045c の `obsAutoAdd &&` と同じ非対称ゲート） |
| いつ立つ | 再生要求が **`"failed"` を返したとき** |
| いつ消える | ①次の再生が**成功**②出力デバイスを**選び直した**③**試聴が成功**④**OFF にした**（表示条件で自動）。⚠ **時間経過では消さない** |
| `role` | `role="status"`（045c と同じ。視覚表示が主目的で、role は意味付け） |

- ⚠ **エラーコードで分岐しない。** `AUDIO_DEVICE_UNAVAILABLE` と `AUDIO_PLAYBACK_FAILED` はユーザーが取る行動が
  同じ（設定でデバイスを選び直す）ため、**reject したという事実だけ**を見る。コードを読むと例外オブジェクトの
  中身に触れる経路ができ、§9 に対して余計な面が増える。
- **`audioTestState` との関係**: あちらは**ユーザーが押したボタンの結果**を設定カード内に出すもの。
  こちらは**ユーザー操作なしに起きた失敗**なので、性質は `obsState === "failed"` と同じ＝置き場所はツールバー。
- ⚠ OBS エラーと同時に 2 つ並びうるが、`.toolbarActions` は `flex-wrap: wrap` なので折り返して収まる。

### (6) テスト

| 対象 | 方式 |
| --- | --- |
| `notificationSound.test.ts`（新規） | **invoke ラッパ（`audioOutputApi`）をモック**（`AudioContext` ではない）。クールダウン／**音源 ID ごとの独立性**／未選択で invoke しない／失敗を `"failed"` で伝える／失敗でもクールダウンが進む |
| `soundPrefs.test.ts`（新規） | 未保存 / 不正値 / 例外のフォールバック（`audioOutputPrefs.test.ts` と同型）＋「このキー以外を書かない」 |
| `CommentViewerApp.notificationSound.test.tsx`（新規） | **1 バッチ 1 回**／`updated` 無音／OFF 無音／未選択で invoke なし／StrictMode 相当の二重実行で invoke 1 回／indicator の出現・消滅・§9 |
| `SettingsView.audio.test.tsx`（追記） | 通知音カード（既定 OFF／試聴／未選択時の案内と disabled／二重に叱らない／音量スライダーが無い） |
| Rust | `ALL_SOUNDS` に `Comment` を足す＝**波形の不変条件テスト 3 本が自動で新しい音にも適用される**。追加 1 本＝**`tone_spec` の (周波数, 長さ) が全 variant で一意** |

#### ⚠ モックの掛け方が肝（「1 バッチ 1 回」を守れるかの分かれ目）

`CommentViewerApp` 側は `notificationSound` を **実装を素通しする spy** にして、**クールダウンより手前**の
呼び出し回数を数える。`audioOutputApi` だけをモックして invoke 回数を数えると、
`added.forEach` へ書き換えるミューテーションを入れても**クールダウンが下流で 1 回に潰してしまい、緑のまま通る**。
「1 バッチ 1 回」は**意図**であってクールダウンの副産物ではないので、意図の側を直接固定する。
⚠ `beforeEach` で `mockReset()` を使わないこと（実装ごと消えて素通しでなくなる）。`mockClear()` を使う。

#### ミューテーションで実効性を確認（実施済み・2026-08-04）

| # | 変異 | 結果 |
| --- | --- | --- |
| ① | `notificationSound` のクールダウン判定の比較演算子を `<` → `>` | **レッド 4 件** |
| ② | 「1 バッチ 1 回」を `added.forEach(...)` に書き換え | **レッド 1 件**（⚠ 下流の invoke カウントは**緑のまま**＝上流 seam が必須だった証拠） |
| ③ | 未選択ガードを外して既定デバイスへ落とす | **レッド 15 件** |

## このタスクでやらないこと

- **投げ銭通知音**（[059b](059b-monetary-notification-sound.md)）。本タスクは「コメントが来たら鳴る」1 音のみ。
  ⚠ ただし基盤は **2 音目を足せる形**にしてある（音源 ID を引数に取る・クールダウンは音源ごとに独立）。
- **出力デバイスの選択・列挙・ルーティング**（[058a](058a-audio-routing-foundation.md) で完了済み）。
  `audioOutputApi.ts` / `audioOutputPrefs.ts` / 058a の音声出力カードのロジックは**差分ゼロ**。
- **「配信に載せる」トグル**（②-軽では成立しない）。
- **音量 UI**（上記 (3)。再修正トリガーも記載）。
- **読み上げ（VOICEVOX）の変更**。`ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` は**差分ゼロ**。
  通知音と読み上げは独立して鳴る（ダッキングもしない）。
- **同時再生 1 本の上限（`PLAYING` / `PlaybackGuard`）の変更**。外さない・緩めない。
- ユーザーが自分の音源ファイルを差し替える機能（将来タスク）。
- コメント内容による出し分け（特定ワードで別の音、等）。
- 視覚エフェクト（[061](061-obs-effects.md)）。
- ホットプラグ監視（デバイス着脱イベントの購読）。**継続表示 indicator で代替する。**
- 新しいライブラリの追加。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。`csp: null` 不変・capability 追加ゼロ・`tauri.conf.json` 差分ゼロ・sidecar 差分ゼロ。
- **音を指定する経路は `NotificationSound` enum のみ**（§3 / §4 追補）。パス・バイト列・URL を frontend から渡せる形にしない。
  ⚠ 追加した `Comment` は**ペイロードなしの unit variant**（`Comment { volume: f32 }` 等にしない。
  レビュー必須条件が「enum 以外で指定できるようにする変更」に含むと名指ししている）。
- **入力デバイス（マイク）に一切触れない**。`getUserMedia` を呼ばない。既存の契約テストを弱めない。
- **既定デバイスへのフォールバックを作らない**（fail-closed）。frontend 側でも守る。
- **新規依存ゼロ**（`rodio` は 058a で導入済み。`Cargo.toml` / `Cargo.lock` 差分ゼロ）。
- 追加した localStorage キーは**ユーザー自身の UI 設定値**（bool 1 つ）で、§9 追補（046a）の対象外。
  **通知音の実装でコメント本文・表示名・金額を保存しない・ログに出さない。デバイス名／ID も画面とログに出さない。**
- `src-tauri/src/audio/` に `unwrap()` / `expect()` / `panic!` を持ち込まない（契約テストが固定）。

## 完了条件

- コメントが届くと通知音が鳴り、設定ビューの ON/OFF・試聴が動く。**既定は OFF。**
- **連投時にクールダウンで間引かれる**（10 連投で 10 回鳴らない）。
- **1 バッチで複数コメントが届いても 1 回しか鳴らない**（テストで固定）。
- **`updated`（Jewels combo）では鳴らない。**
- **デバイス未選択のあいだは鳴らない**（既定へ落ちない）。
- **鳴らせなかったら画面に継続表示が出る**（黙って鳴らなくならない）。
- 音が**アプリ内合成**であることが [`docs/progress.md`](../progress.md) に記録されている（ライセンス確認は対象外）。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- **依存 / capabilities / `tauri.conf.json` / sidecar / CSS は差分ゼロ**・`csp: null` 不変。
  `ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` / `audioOutput*.ts` も差分ゼロ。
- `cargo check` / `cargo test` / `typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml   # ← ts-rs bindings がここで出る
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json \
  apps/comment-sidecar/ .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
  apps/desktop/package.json pnpm-lock.yaml package.json
# 読み上げ経路を触っていないことの担保（差分ゼロが期待）
git status --short -- apps/desktop/src/features/comment-viewer/ttsQueue.ts \
  apps/desktop/src/features/comment-viewer/voicevox.ts \
  apps/desktop/src/features/comment-viewer/voicevoxPreview.ts
# 058a 無改変の担保（差分ゼロが期待）
git status --short -- apps/desktop/src/features/comment-viewer/audioOutputApi.ts \
  apps/desktop/src/features/comment-viewer/audioOutputPrefs.ts \
  apps/desktop/src-tauri/src/audio/commands.rs
# CSS 差分ゼロの担保
git status --short -- apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css
# panic 経路が無いことの担保（⚠ ヒットする 2 件は 058a 由来の doc コメントと #[cfg(test)] 内）
grep -rn "unwrap()\|\.expect(" apps/desktop/src-tauri/src/audio/ || echo "OK: panic 経路無し"

pnpm --filter ./apps/desktop tauri dev
# ① 設定に「通知音」カードが出る（既定 OFF）／「試聴 ▶」で鳴る／058a の「テスト再生 ▶」と聞き分けられる
# ② ON にして dev-mock でコメントを流す → 1 件で 1 回鳴る
# ③ バッチ受信・連投で鳴りっぱなしにならない（1 バッチ 1 回 ＋ クールダウン 600ms）
#    → うるさい／少なすぎるならこの場で値を決める（決めた値と理由をコメントへ）
# ④ 043e の Jewels combo 更新（dev-mock）では鳴らない
# ⑤ 出力デバイス未選択のあいだは鳴らない（既定へ落ちない）＋ ON かつ未選択のとき案内が出る
# ⑥ 選んだデバイスを OS から抜く → ツールバーに「通知音を再生できません」が継続表示 → 挿し直すと消える
# ⑦ 読み上げと同時に鳴っても互いを止めない
# ⑧ ライト／ダーク両テーマで設定 UI とツールバー indicator が破綻しない
# ⑨ OBS の「音声入力キャプチャ」で仮想デバイスを拾うと、読み上げは載り通知音は載らない（②-軽の運用確認）
```

## 実装後に必要なレビュー

**⚠ security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）**＋品質レビュー。実施済み・2026-08-04。**

> ⚠ **当初は「軽レビュー」と判定したが、レビューで是正された。** 判断の履歴として下の判定表は残す。
> **誤りは「5 つの下位条件＝本項のスコープの定義」と読んだこと**で、実際には下位条件は
> **「該当する例」の列挙**にすぎない。親項目の文言は「音声デバイスの列挙・音声の再生」と広く、
> 059a は `NotificationSound` の variant 追加（＝鳴らせる音の集合の変更）と `samples_for` の
> 減衰導出の書き換え（＝既存の Test 音を含む全再生波形の生成ロジック）に触れているので、
> **素直に本項に該当する**。とくに 5 番目の「ペイロードを持たせる変更」を
> **反対解釈（＝ペイロードなしなら免除）の根拠に使ったのが誤り**——あの条文の役割は
> 「契約テストの `PathBuf` needle で捕まらない抜け道を条文で塞ぐ」ことであって、それ以外の
> `audio/` 変更を免除することではない。**046a が「当初『軽レビュー』指定だったが保存ポリシーに
> 触れるので必須」と是正されたのと同型の誤り**である（`docs/security.md` §9 追補 046a）。
> **セキュリティ実体の逸脱はゼロ**（レビュー結果＝修正必須 0 件）で、判定ミスによる見落としは無かった。
> 再発防止として `docs/security.md`「レビュー必須条件」に
> **「`src-tauri/src/audio/` の本番コードに差分が出る変更は下位条件に当たらなくても該当する」**を追記した。
> ⚠ **059b も同じ理由で security-review 必須**（`NotificationSound::Monetary` の追加＝同じく再生系の差分）。

以下は当初の（誤っていた）判定表。**下位条件の当てはめ自体は正しい**ので、
「何に触れていないか」のチェックリストとしては引き続き有効:

⚠ **旧版の理由（「frontend のみだから」）は失効している**（`src/audio/` に差分が出る）ので、
[`docs/security.md`](../security.md) の「レビュー必須条件」の
**「音声デバイスの列挙・音声の再生」の 5 つの下位条件**に照らして判定し直した:

| 下位条件 | 該当 | 根拠 |
| --- | --- | --- |
| 列挙対象を**出力デバイス以外へ広げる**（＝マイクに触れる） | **✕** | `list_output_devices` 差分ゼロ。`never_touches_input_devices` も無改変 |
| 再生できる音を **enum 以外**（パス・バイト列・URL）で指定できるようにする | **✕** | 指定経路は `NotificationSound` のまま。道①なので `include_bytes!` も無し（`accepts_no_file_path_from_the_frontend` 無改変） |
| **既定デバイスへフォールバックする**向きの変更 | **✕** | `find_output_device` 差分ゼロ。frontend も未選択なら呼ばない |
| **同時再生の上限を外す・緩める** | **✕** | `PLAYING` / `PlaybackGuard` / `only_one_playback_runs_at_a_time` すべて無改変 |
| `NotificationSound` の variant に**ペイロードを持たせる** | **✕** | `Comment` は unit variant |

**5 つとも非該当。** ~~とくに 5 番目が「**ペイロードを持たせる変更**」を名指ししていることは、
**ペイロードなしの variant 追加が想定内の安全な増やし方**であることの反対解釈になる~~
→ ⚠ **この反対解釈がレビュー区分の判定を誤らせた**（上の是正を参照）。危険度の序列としては正しいが、
**レビュー区分の判定根拠には使えない**。5 つとも非該当という事実は変わらないので、
チェックリストとしてはそのまま有効。

⚠ **親項目の文言は「音声デバイスの列挙・音声の再生」と広く、`src/audio/` に差分が出るのは事実**なので、
**次の 3 点はレビューで必ず確認する**（実施済み・いずれも問題なし）:
①`audio` の契約テストが 1 本も緩んでいない（`git diff` の削除行が 5 行だけであることを実測）
②`ALL_SOUNDS` / `sound_label` が更新されている
③fail-closed（未選択なら呼ばない・既定へ落とさない）が frontend 側でも守られている（3 経路すべて）。

### レビュー結果（2026-08-04）

- **セキュリティ: 修正必須 0 件。** 12 観点すべて実コードで確認し逸脱なし。
- **品質: 要修正 4 件を反映済み**——(Q-1) StrictMode テストが空振りしていたので `<React.StrictMode>` を
  使う本物の経路へ書き直し（クールダウン 0 のミューテーションで**赤になることを実測**）／
  (Q-2) 058a の「テスト再生」成功でも継続表示を畳む 1 行を追加（同じデバイスの抜き挿し導線）／
  (Q-3) テストのモック seam を「記録専用 spy ＋実装は常に actual」へ堅牢化（`mockReset` 耐性）／
  (Q-9) `SoundPreviewState` の取り違えを殺す配線テストを追加（branded type の代わり）。
- **受容した指摘はコードにコメントで固定した**（再修正トリガー付き）: 時間ベースの冪等化への依存／
  飛行中の失敗が「対処済み」を上書きしうる／`"played"` が実再生を保証しない／
  モジュールスコープの `Map`／test-only export／`mergeComments` の `added` の既知性質。
- **文言の訂正**: 継続表示の `title` から原因の断定を外し、両カードの「配信には載りません」を
  条件付きの言い回しへ（実デバイスを選んだ場合にのみ真であるため）。

⚠ **音量引数（`play_notification_sound` に `volume` を足す）を将来採るなら security-review 必須**。
frontend から渡る値が「enum 1 個」から「enum ＋ 任意の f32」へ増えて §8 の検証面が広がり
（`NaN` / `Inf` / 範囲外＝クリップ＝耳に痛い大音量。localStorage は手で書き換えられるので Rust 側クランプが必須）、
`every_sound_never_clips` が固定している前提も動くため。
