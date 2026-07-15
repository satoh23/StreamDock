/**
 * 032c-c: コメントビューアの VOICEVOX ローカル合成クライアント。
 *
 * viewer webview から**ローカルの VOICEVOX ENGINE**（127.0.0.1:50021・ループバック）の
 * HTTP 合成 API を `fetch` で直接叩く。Rust 側に HTTP クライアント・音声再生ライブラリは足さない
 * （新依存ゼロ）。通信はループバック 50021 のみでインターネットには一切出ない
 * （docs/security.md §1 の loopback 50021 例外を参照）。
 *
 * 実行環境の注意（要 E2E・現時点で未修正なのはコード欠陥ではなく実機確認待ちのため）: macOS の
 * WKWebView は平文 `http://` 読込を ATS で制限しうる。loopback（127.0.0.1）への fetch が実機で通るかは
 * `pnpm tauri dev` で要確認（`csp: null` のため Tauri 側 CSP ブロックは無い）。**通らない場合のみ**
 * `tauri.conf.json` の ATS/接続許可を最小調整する（宛先は 50021 loopback 限定を維持）。通れば変更不要。
 *
 * 再生（Web Audio）は本モジュールの `playWav`（AudioContext を受け取る純粋な再生プリミティブ）で行い、
 * AudioContext のライフサイクルと直列化は呼び出し側（ttsQueue）が持つ。
 */

/** VOICEVOX ENGINE のローカル（ループバック）ベース URL。インターネット宛先は使わない。 */
export const VOICEVOX_BASE = "http://127.0.0.1:50021";

/**
 * ずんだもん（ノーマル）の speaker id。
 * 親設計の既定は 3。実機 `GET /speakers` のスパイクで確定する
 * （`name:"ずんだもん"` → `styles[]` の `name:"ノーマル"` の `id`）。観測値が 3 と異なれば更新する。
 */
export const ZUNDAMON_NORMAL_SPEAKER_ID = 3;

/**
 * ENGINE が稼働しているかを `GET /version` で確認する。
 * 起動していない・到達不能なら false（起動誘導 UI の表示判定に使う）。
 */
export async function checkEngineRunning(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${VOICEVOX_BASE}/version`, { method: "GET", signal });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * `text` を VOICEVOX で合成し、WAV を `ArrayBuffer` で返す。
 * (1) `POST /audio_query?text=&speaker=`（text/speaker はクエリパラメータ・body 空）→ query JSON
 * (2) `POST /synthesis?speaker=`（body = query JSON）→ WAV(`ArrayBuffer`)
 */
export async function synthesize(
  text: string,
  speaker: number = ZUNDAMON_NORMAL_SPEAKER_ID,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  // (1) audio_query: text/speaker はクエリパラメータで渡す（body は空）。
  const queryUrl = `${VOICEVOX_BASE}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`;
  const queryRes = await fetch(queryUrl, { method: "POST", signal });
  if (!queryRes.ok) {
    throw new Error(`audio_query に失敗しました (${queryRes.status})`);
  }
  const query = await queryRes.json();

  // (2) synthesis: speaker はクエリパラメータ・body は audio_query の結果 JSON。
  const synthUrl = `${VOICEVOX_BASE}/synthesis?speaker=${speaker}`;
  const synthRes = await fetch(synthUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/wav" },
    body: JSON.stringify(query),
    signal,
  });
  if (!synthRes.ok) {
    throw new Error(`synthesis に失敗しました (${synthRes.status})`);
  }
  return await synthRes.arrayBuffer();
}

/**
 * WAV(`ArrayBuffer`) を渡された `AudioContext` で 1 回だけ再生し、`onended` で解決する。
 * AudioContext の生成/resume/close は呼び出し側の責務（直列再生の制御は ttsQueue が持つ）。
 */
export async function playWav(ctx: AudioContext, wav: ArrayBuffer): Promise<void> {
  // decodeAudioData が入力 ArrayBuffer を破壊的に消費する実装があるため slice で複製して渡す。
  const buffer = await ctx.decodeAudioData(wav.slice(0));
  await new Promise<void>((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => resolve();
    src.start();
  });
}
