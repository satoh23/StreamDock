/**
 * 034c: 設定ビューの話者/スタイル選択時に「その声のサンプル」を試聴するための、中断切替つきプレイヤー。
 *
 * 実コメント読み上げ本線（ttsQueue.ts）とは**完全に別経路**にする:
 * - 本線とは**別の AudioContext** を持つ（干渉しない・キューにも積まない）。
 * - 「現在の合成 AbortController」と「再生中の AudioBufferSourceNode」を保持し、新しい試聴要求が来たら
 *   前を中断（`AbortController.abort()` で合成 fetch を止め、保持 source の `stop()` で再生を止める）してから
 *   新しい声を鳴らす。これにより「合成中の切替」も「再生中の切替」も両方その場で切り替わる。
 *
 * 合成 HTTP は `voicevox.ts` の `synthesize()` を**そのまま再利用**する（宛先はループバック 127.0.0.1:50021・
 * POST /audio_query → /synthesis のみ・新規メソッド/宛先を足さない）。再生（decode → source → start）は
 * 中断のため source 参照を保持する必要があり、既存 `playWav`（source を外に出さず onended まで解決する形・
 * 唯一の呼び出し元 ttsQueue の直列 await 契約を持つ）は**改修せず**、試聴用の同等再生を本モジュール内に持つ。
 * 送るのは固定サンプル文のみ（コメント本文・著者名・認証情報は送らない）。合成結果 WAV はローカル再生のみで
 * 端末外へ送信しない（docs/security.md §1 例外 032c-c）。
 */

import { synthesize } from "./voicevox";

/**
 * 試聴で読み上げる固定サンプル文。**この定型のみ**を VOICEVOX へ送る（コメント本文は送らない）。
 * 声色が分かる程度に短い定型にする。
 */
const PREVIEW_TEXT = "こんにちは。VOICEVOXの音声サンプルです。";

export interface VoicevoxPreview {
  /**
   * 指定 style id のサンプルを試聴する。再生中（または合成中）なら前を中断して新しい声へ切り替える。
   * fire-and-forget（呼び出し側は await しない）。ENGINE 未起動・合成失敗は内部で握って落とさない。
   */
  play: (styleId: number) => void;
  /** 破棄（進行中の合成/再生を中断し AudioContext を閉じる）。アンマウント時に呼ぶ。 */
  dispose: () => void;
}

/**
 * 中断切替つきの試聴プレイヤーを生成する。AudioContext は初回 `play`（＝ユーザー操作契機の onChange 内で
 * 同期的に `new` される）まで作らない（WKWebView の autoplay 制限を通すため・未使用時に context を作らない）。
 */
export function createVoicevoxPreview(): VoicevoxPreview {
  let ctx: AudioContext | null = null;
  let currentController: AbortController | null = null;
  let currentSource: AudioBufferSourceNode | null = null;
  let disposed = false;

  /** 進行中の合成を abort し、再生中の source があれば onended を外して stop する。 */
  function stopCurrent(): void {
    currentController?.abort();
    currentController = null;
    if (currentSource) {
      try {
        currentSource.onended = null;
        currentSource.stop();
      } catch {
        // 既に stop 済み・未 start 等は無視（再生停止は best-effort）。
      }
      currentSource = null;
    }
  }

  async function run(styleId: number): Promise<void> {
    if (disposed) return;
    // 前の試聴（合成中/再生中）を中断してから切り替える。
    stopCurrent();
    const controller = new AbortController();
    currentController = controller;

    // 初回だけ AudioContext を生成する（onChange = ユーザー操作内で同期実行されるため autoplay を通る）。
    const audioCtx = (ctx ??= new AudioContext());
    try {
      if (audioCtx.state !== "running") {
        try {
          await audioCtx.resume();
        } catch {
          // resume 不可（gesture 未取得など）でも合成は試みる。鳴らなくても本線には影響しない。
        }
      }

      const wav = await synthesize(PREVIEW_TEXT, styleId, controller.signal);
      // await 中に別の試聴要求（切替）や dispose が来ていたら、この再生は捨てる。
      if (disposed || controller.signal.aborted) return;

      // decodeAudioData が入力 ArrayBuffer を破壊的に消費する実装があるため slice で複製して渡す。
      const buffer = await audioCtx.decodeAudioData(wav.slice(0));
      if (disposed || controller.signal.aborted) return;

      // 中断のため source を保持する（playWav と違い外から stop できる）。
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(audioCtx.destination);
      src.onended = () => {
        // 自然終了時、まだ自分が現行なら参照を片付ける（次の stopCurrent の空振りを避ける）。
        if (currentSource === src) currentSource = null;
      };
      currentSource = src;
      src.start();
    } catch (e) {
      // 中断切替（abort）は正常系なので黙って return。それ以外（ENGINE 未起動・合成失敗）は握って落とさない。
      if (controller.signal.aborted) return;
      console.debug("VOICEVOX サンプル試聴に失敗しました", e);
    }
  }

  return {
    play(styleId) {
      void run(styleId);
    },
    dispose() {
      disposed = true;
      stopCurrent();
      if (ctx) {
        // `void ctx.close()`: 意図＝アンマウント時に試聴用 AudioContext を解放する。reject を握っていないのは、
        // close はこの ctx につき dispose で 1 回だけ呼ばれ（マウントごとに別クロージャ・二重 dispose や同一 ctx への
        // 二重 close 経路が無い）実際には reject しないため（既存 ttsQueue.ts と同じ作法）。
        // 再修正トリガー: 将来 dispose が複数回走り得る／同一 ctx を再 close し得る経路を作ったら `.catch(() => {})` を付す。
        void ctx.close();
        ctx = null;
      }
    },
  };
}
