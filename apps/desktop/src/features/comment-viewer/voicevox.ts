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

/** VOICEVOX の 1 スタイル（話者内の声色バリエーション）。`id` が合成時の speaker 引数になる。 */
export interface VoicevoxStyle {
  id: number;
  name: string;
}
/** VOICEVOX の 1 話者（`name` ＝ずんだもん等・複数スタイルを持つ）。 */
export interface VoicevoxSpeaker {
  name: string;
  styles: VoicevoxStyle[];
}

/**
 * 033d: `GET /speakers` で話者＋スタイル一覧を取得する（話者選択 UI の選択肢に使う）。
 *
 * 宛先は既存 `VOICEVOX_BASE`（`127.0.0.1:50021`・ループバック）不変。**GET・body 無し**で、
 * コメント本文・著者名・認証情報は一切送らない。抽出するのは **話者名 ＋ styles[{id,name}] のみ**で、
 * 返る一覧は呼び出し側で選択肢に使うだけ（端末外へは送信しない・docs/security.md §1 例外 032c-c）。
 *
 * ENGINE 未起動・到達不能・非 200・不正応答はすべて空配列を返す（`checkEngineRunning` と同じく
 * 「例外を握って落とさない」作法）。呼び出し側は空一覧＝起動誘導（033c のバナー/トグル）で扱う。
 */
export async function fetchSpeakers(signal?: AbortSignal): Promise<VoicevoxSpeaker[]> {
  try {
    const res = await fetch(`${VOICEVOX_BASE}/speakers`, { method: "GET", signal });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    const mapped = data.map((sp): VoicevoxSpeaker => {
      const rawStyles = (sp as { styles?: unknown })?.styles;
      const styles = Array.isArray(rawStyles)
        ? rawStyles
            .map((st): VoicevoxStyle => ({
              id: Number((st as { id?: unknown })?.id),
              name: String((st as { name?: unknown })?.name ?? ""),
            }))
            .filter((st) => Number.isInteger(st.id))
        : [];
      return { name: String((sp as { name?: unknown })?.name ?? ""), styles };
    });
    // 033d: スタイルが 0 個の話者は選択肢・合成の単位（style id）を持たず選べない。病的応答（id が
    // 非整数で全 filter 除去された等）由来の styles 空話者を落とし、reconcile の list[0].styles[0].id
    // 参照や話者/スタイル select の controlled-value 不整合を根から防ぐ。
    return mapped.filter((sp) => sp.styles.length > 0);
  } catch {
    return [];
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
  // speaker は常に検証済みの数値（loadSpeakerId の整数検証／fetchSpeakers の Number.isInteger filter／
  // Number(select.value)）のため encodeURIComponent は不要。speaker が非数値を取り得る経路が増えたら要エンコード。
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
