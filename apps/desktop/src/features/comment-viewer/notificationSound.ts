import { playNotificationSound } from "./audioOutputApi";
import type { NotificationSound } from "./audioOutputApi";
import { NO_AUDIO_OUTPUT_DEVICE } from "./audioOutputPrefs";

/**
 * 059a: 通知音を「鳴らしすぎない」ための層。**音源 ID ごとに独立したクールダウン**を持つ。
 *
 * ⚠ **Web Audio には一切触れない。** 058s の結論（②-軽）で通知音の再生層は Rust（`rodio`）へ移っており、
 * このモジュールがやるのは「`playNotificationSound` を**呼ぶか呼ばないか**を決める」ことだけ。
 * `AudioContext` / `decodeAudioData` / `GainNode` / autoplay の `resume()` はどれも登場しない
 * （059a の当初案にあったこれらの記述は 058a 完了時点で失効している）。
 *
 * ### 責務の線引き
 *
 * | ここでやる | ここでやらない |
 * | --- | --- |
 * | 音源 ID ごとのクールダウン判定 | 出力デバイスの選択・列挙・保存（058a の `audioOutput*.ts`） |
 * | 未選択なら呼ばない（fail-closed） | 既定デバイスへのフォールバック（**禁止**） |
 * | 失敗を戻り値で伝える | React state の更新・画面表示（`CommentViewerApp` の責務） |
 * | — | 「どのコメントで鳴らすか」の判断（`CommentViewerApp` の責務） |
 * | — | キューイング（溜めて後から連打しない。落とすのが正しい＝親 059 の決定） |
 *
 * ### ⚠ Rust の「同時再生 1 本」との役割の違い（混同しないこと）
 *
 * | | 何のためか | 粒度 | 競合したとき | 触ってよいか |
 * | --- | --- | --- | --- | --- |
 * | Rust の `PLAYING` / `PlaybackGuard`（058a） | **可用性（自己 DoS）対策**。`#[tauri::command(async)]` は tokio の worker を占有するので、積み上がると IPC 全体が詰まる | 音の種類に関係なく**全体で 1 本** | 鳴らさず `Ok(())`（成功で返る） | ⚠ **外さない・緩めない**（docs/security.md のレビュー必須条件） |
 * | このモジュールのクールダウン（059a） | **体験（うるささ）対策**。「どの音を何秒に 1 回まで鳴らすか」 | **音源 ID ごとに独立** | 呼ばずに `"skipped"` | 059 の責務・実機で調整してよい |
 *
 * → ここは Rust の上限に**到達させないための上流の絞り**でもある（上限に当たって音が黙って捨てられる
 * 状態は「クールダウンが効いていないのに音だけ減る」という読み解けない挙動になるため、避ける）。
 */

/**
 * 059a: 再生要求の結果。
 *
 * ⚠ **例外を投げない**（コメント受信経路を通知音の失敗で巻き添えにしない）が、
 * ⚠⚠ **失敗を握り潰しもしない。** 058a は fail-closed（デバイスが見つからなければ鳴らさない）で、かつ
 * **ホットプラグ監視を持たない**——設定画面を開いた時にしか突き合わせない。ここで失敗を無言で捨てると、
 * **配信中にデバイスを抜いたとき通知音が一切鳴らなくなったことをユーザーが知る手段がゼロ**になる。
 * 「鳴らないほうがマシ」は「鳴らないことに気付けなくてよい」ではない（058a の申し送り）。
 * 呼び出し側は `"failed"` を受けたら**画面に継続表示される indicator を出す**こと。
 */
export type NotificationSoundOutcome = "played" | "skipped" | "failed";

/**
 * 059a: 音源 ID ごとのクールダウン（ミリ秒）。
 *
 * ⚠⚠ **共有カウンタにしない。** 共有すると「コメントが流れている最中に来たスパチャの音が、
 * コメント音のクールダウンで消える」＝**一番気づいてほしい音が鳴らない**という最悪の挙動になる
 * （059b の要求）。059b は `monetary` の行をここへ足すだけでよく、値はコメント音より短くてよい。
 *
 * ⚠ `Record<NotificationSound, number>` なので、Rust 側で `NotificationSound` に variant を足すと
 * **ここが型エラーになる**（追加漏れを起こせない）。Rust の `ALL_SOUNDS` / `sound_label` と同じ idiom。
 *
 * **`comment` を 600ms にした根拠**:
 * 1. **下限は Rust の占有時間で決まる。** コメント音は 140ms ＋ `PLAYBACK_TAIL`(80ms) ＝ **最低でも約 220ms** の
 *    あいだ Rust の `PLAYING` が立つ。これより短いと「クールダウンは通ったのに Rust に黙って捨てられる」
 *    状態になり、上の表のとおり読み解けない挙動になる。
 *    ⚠ **220ms は下限であって実測値ではない**（レビュー Q-4 で訂正）。`PLAYING` が立つのは
 *    `play_on_device` の**先頭**（`PlaybackGuard::acquire()`）からなので、実際にはさらに
 *    **出力デバイスの再列挙**（`find_output_device`。CoreAudio / WASAPI で数十〜数百 ms かかりうる）と
 *    **ストリームの open**、`wait_until_finished` の**ポーリング粒度 10ms** が乗る。
 *    逆向きに、`Player::empty()` は cpal の 50ms バッファを引き取り終えた時点で true になるので
 *    最大 50ms 早く抜けうる。差し引きで実占有は概ね **150〜350ms**、環境によってはもっと長い。
 *    → ⚠ **実機で値を下げるときも 250ms は下回らないこと。**
 * 2. **上限は体験で決まる。** 600ms なら 1 秒あたり最大 1〜2 回。「コメントが来たと気づく」目的には十分で、
 *    連投時にうるさくない。dev-mock（1800ms 間隔）は素通しなので動作確認では毎回鳴る。
 * 3. 投げ銭音（059b）は独立なので、この 600ms がスパチャの検知を遅らせることはない。
 *
 * `test` が 0 なのは、**テスト再生／試聴はユーザーの明示操作**だから（下記 ⚠ を参照）。
 */
const COOLDOWN_MS: Record<NotificationSound, number> = {
  test: 0,
  comment: 600,
};

/**
 * 音源 ID → 最後に**要求した**時刻（`Date.now()`）。
 *
 * ⚠ **「鳴り終わった時刻」ではなく「invoke を投げた時刻」を記録する。** 理由は 2 つ:
 * - `play_notification_sound` は**鳴り終わってから resolve する**ので、解決を待って記録すると
 *   クールダウンが再生時間ぶん勝手に伸びて意味がぶれる。
 * - **失敗しても記録する**＝デバイスが抜けている間、コメントのたびに invoke を撃ち続けない
 *   （Rust 側は呼ばれるたびに出力デバイスを再列挙するので、無制限の再試行は素直に無駄）。
 *
 * ⚠ **モジュールスコープ＝窓ごとではなくモジュールごとの可変状態**（レビュー指摘・意図どおり）。
 * webview は窓ごとに独立した JS realm なので、実質「窓ごと」になる。かつ通知音を鳴らすのは
 * コメビュ窓（`CommentViewerApp`）だけで、オーバーレイ窓はこのモジュールを import していない。
 * **再修正トリガー＝コメビュ窓以外からも通知音を鳴らすようになったとき**（そのときは窓をまたいだ
 * 抑制が要るかを先に決めること。localStorage 経由の共有は 1 音のために重すぎるので、まず
 * 「鳴らすのは 1 窓だけ」を維持できないかを検討する）。
 */
const lastRequestedAt = new Map<NotificationSound, number>();

/**
 * 059a: 通知音を 1 回鳴らすよう要求する。**鳴り終わるのは待たない**（投げっぱなしでよい）。
 *
 * - `deviceId` が未選択（`""`）なら **invoke しない**＝`"skipped"`。
 *   ⚠⚠ **既定デバイスへ落とさない。** ②-軽の運用では OS 既定＝仮想オーディオデバイス＝**配信に載る側**
 *   なので、落とすと「載せないつもりの通知音が配信に載る」＝この機能の存在理由そのものが壊れる。
 *   鳴らないのは軽微な不便で、載るのは事故（058a の fail-closed をここでも守る）。
 * - 直近 `COOLDOWN_MS[sound]` 以内に同じ音を要求済みなら **invoke しない**＝`"skipped"`。
 *   ⚠ **キューイングしない**（溜めて後から連打しない）。落とすのが正しい。
 * - それ以外は invoke し、成功で `"played"` / 失敗で `"failed"` に解決する。**reject しない。**
 *   ⚠ **`"played"` は「実際に音が出た」の保証ではない**（レビュー Q-5）。058a の同時再生 1 本の上限に
 *   競合した呼び出しは、Rust が**鳴らさずに `Ok(())` で返す**ため、ここでは `"played"` になる。
 *   ＝試聴／テスト再生とコメント音がぶつかった数 ms の窓では、鳴っていないのに indicator が畳まれうる。
 *   fail-closed は壊れない（既定デバイスへは行かない）ので受容している。
 *   **再修正トリガー＝「鳴ったこと」を UI が強く主張するようになったとき**（例: 再生回数の表示）。
 *   そのときは Rust 側の戻り値を `Ok(bool)` 等に変える必要があり、コマンドの戻り面を変える＝
 *   docs/security.md のレビュー必須条件（音声の再生）に該当する。
 *
 * ⚠ **ユーザーの明示操作（設定画面の試聴・テスト再生）はこの関数を通さないこと。**
 * 押したのに鳴らないのは「壊れている」と見えるので、明示操作にレート制限をかけてはいけない
 * （034c の話者試聴と同じ考え方）。あちらは `audioOutputApi.playNotificationSound` を直接呼び、
 * 連打は「再生中はボタンを disabled」で抑える。
 */
export function requestNotificationSound(
  sound: NotificationSound,
  deviceId: string,
): Promise<NotificationSoundOutcome> {
  if (deviceId === NO_AUDIO_OUTPUT_DEVICE) {
    return Promise.resolve("skipped");
  }

  const now = Date.now();
  const last = lastRequestedAt.get(sound);
  if (last !== undefined && now - last < COOLDOWN_MS[sound]) {
    return Promise.resolve("skipped");
  }
  lastRequestedAt.set(sound, now);

  return playNotificationSound(deviceId, sound).then(
    () => "played" as const,
    // §9: 例外オブジェクトを覗かない・ログにも出さない（デバイス名／OS のエラー表現を含みうる）。
    // 失敗の種別（AUDIO_DEVICE_UNAVAILABLE / AUDIO_PLAYBACK_FAILED）で分けないのは、
    // ユーザーが取れる行動が同じ（設定でデバイスを選び直す）で、分けても案内が変わらないため。
    () => "failed" as const,
  );
}

/**
 * テスト専用: クールダウンの記録を消す。
 *
 * モジュールスコープの `Map` はテスト間で持ち越されるので、これが無いと**テストの実行順で結果が変わる**。
 * 本番コードから呼ばないこと（呼ぶ意味のある場面が無い）。
 *
 * ⚠ **本番モジュールに test-only の口を開ける判断について**（レビュー指摘・意図どおり）。
 * 引数なしで `Map.clear()` するだけ＝万一本番から呼ばれても副作用は「次の 1 回が鳴りやすくなる」だけで、
 * fail-closed にも §9 にも影響しない。代替（`Date.now` の依存注入・テストごとの `vi.resetModules()`）は
 * この 130 行のモジュールに払うコストとして重く、名前の `ForTest` で意図も表現できている。
 * **再修正トリガー＝この口が「クールダウンを消す」以上のことをしたくなったとき**
 * （状態を注入する・値を書き換える等になったら、素直に依存注入へ作り替えること）。
 */
export function resetNotificationSoundCooldownForTest(): void {
  lastRequestedAt.clear();
}
