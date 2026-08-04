/**
 * 059a / 059b: 通知音（コメント／投げ銭）の ON/OFF を localStorage に保持する。
 *
 * ⚠ **`ttsPrefs.ts` に足さない。** あちらは「読み上げ（VOICEVOX）の設定」というまとまりで、
 * 通知音は別概念（再生層すら違う——読み上げは Web Audio、通知音は Rust の `rodio`）。
 *
 * 方式は `ttsPrefs.ts` / `audioOutputPrefs.ts` と同じ（名前空間付き `"stream-dock.comment-viewer.*"` キー・
 * localStorage 直 read/write・文字列 `"true"` 保存で `=== "true"` 判定・例外は握りつぶし・
 * 不正値は既定へフォールバック）。**非機密の UI 設定値**であって、docs/security.md §9 追補（046a）が
 * 対象とする第三者の個人データではない（`OBS_AUTO_ADD_KEY` と同種）。外部送信もしない。
 *
 * ⚠ **通知音の実装でコメント本文・表示名・金額を保存しない**（鳴らすのに要らない）。
 * ⚠ **デバイス ID はここに置かない。** それは 058a の `audioOutputPrefs.ts` の担当で、
 * 「どのデバイスへ出すか」と「そもそも鳴らすか」は別の設定である。
 *
 * ### ここに音量キーが無い理由（059a の決定・2026-08-04）
 *
 * 059a の当初案は `sound-volume`（既定 0.5）を持つ計画だったが、**その根拠は Web Audio 前提で失効している**。
 * 旧案は読み上げと通知音が同じ出力先（`ctx.destination`）へ出るため「OS 音量を下げると読み上げも下がる」
 * ＝アプリ内の相対音量調整が要る、という構図だった。058s の結論（②-軽）では**通知音だけが
 * ユーザーの選んだ実デバイスへ出て、読み上げは OS 既定へ出る**ので、**OS のデバイス別音量が通知音だけに
 * 独立して効く**（macOS＝出力デバイスごとの音量 / Windows＝音量ミキサー）。
 * 加えて振幅は Rust の `PEAK_AMPLITUDE` 固定で、frontend にキーだけ作っても**何も効かない**。
 *
 * **再修正トリガー**: 実機で「小さすぎ／大きすぎ」と感じたら、まず Rust の `PEAK_AMPLITUDE` を調整する
 * （1 行・コマンドの引数面は増えないのでレビュー区分も変わらない）。それでも足りず
 * 「デバイスや配信ごとに変えたい」となったら**別タスクとして切り出す**——そのときに必要なのは
 * 「Rust の引数追加＋§8 のクランプ（NaN / Inf / 範囲外）＋`every_sound_never_clips` の書き換え
 * ＋security-review」のセットで、いずれも 059a のスコープではない。
 *
 * ⚠ **059b でも音量キーは作らなかった**（2 音になっても判断は変わらない）。059b の旧タスクファイルは
 * 「音量は 059a の `sound-volume` を共有する」と書いていたが、**共有すべき `sound-volume` が存在しない**
 * ＝この記述はもともと失効している。「投げ銭音だけ大きくしたい」となったら上記の別タスクへ。
 *
 * ### ここに「配信に載せる」キーが無い理由
 *
 * ②-軽では「通知音＝選んだ実デバイス＝配信に載らない」で固定されており、**トグルにする余地が無い**
 * （切り替え先＝OS 既定は「載る側」なので、それを選べるようにすると 058a の fail-closed が壊れる）。
 * 説明は「通知音」カードの出力先セクションの案内文が担っている
 * （⚠ 059c 以前は独立した「音声出力（通知音）」カードだったが、1 枚に統合された）。
 */

/**
 * 059a: コメント通知音の ON/OFF 保存キー（**既定 OFF**）。テストから参照するため export する。
 *
 * ⚠ **既定 OFF の理由**: 既存ユーザーの環境で、アップデート直後に**ユーザー操作ゼロで音が鳴り始める**のを
 * 避ける（`OBS_AUTO_ADD_KEY` 等が既定 OFF なのと同じ考え方）。配信中に予期しない音が出るのは、
 * 機能が無いことより悪い。
 */
export const SOUND_COMMENT_ENABLED_KEY =
  "stream-dock.comment-viewer.sound-comment-enabled";

/**
 * 059a: 保存済みのコメント通知音 ON/OFF を読み込む。
 * 未保存・不正値・例外はすべて **false（OFF）** にフォールバックする。
 */
export function loadSoundCommentEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_COMMENT_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/** 059a: コメント通知音の ON/OFF を保存する（ローカルのみ・外部送信しない）。 */
export function saveSoundCommentEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_COMMENT_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（コメント表示・読み上げは継続できる）。
  }
}

/**
 * 059b: 投げ銭通知音の ON/OFF 保存キー（**既定 OFF**）。テストから参照するため export する。
 *
 * ⚠ **コメント音とは独立したキーにする**（1 つのキーに詰め込まない）。ON/OFF は音ごとに独立で、
 * 「コメント音は要らないが投げ銭だけは気づきたい」が実際に一番ありそうな使い方だから。
 * ⚠ **既定 OFF の理由は `SOUND_COMMENT_ENABLED_KEY` と同じ**——アップデート直後に
 * ユーザー操作ゼロで音が鳴り始めるのを避ける。
 * ⚠ ここに保存するのも**真偽値 1 つだけ**。投げ銭の**金額・投稿者名・本文は保存しない**
 * （鳴らすのに要らない。§9 追補 046a の対象へ踏み込まない）。
 */
export const SOUND_MONETARY_ENABLED_KEY =
  "stream-dock.comment-viewer.sound-monetary-enabled";

/**
 * 059b: 保存済みの投げ銭通知音 ON/OFF を読み込む。
 * 未保存・不正値・例外はすべて **false（OFF）** にフォールバックする（059a と同じ劣化の向き）。
 */
export function loadSoundMonetaryEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_MONETARY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/** 059b: 投げ銭通知音の ON/OFF を保存する（ローカルのみ・外部送信しない）。 */
export function saveSoundMonetaryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_MONETARY_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（059a と同じ）。
  }
}
