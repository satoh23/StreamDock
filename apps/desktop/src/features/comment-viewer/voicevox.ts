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
 *
 * ⚠ **(1) の URL には読み上げ全文が載る**（049 以降は課金イベントの投稿者名を含む）。だから本モジュールは
 * `console.*` を **1 行も持たない**（docs/security.md §9）——ここにログを足さないこと。
 * なお DevTools には失敗/中断した fetch の URL が**ブラウザ機能として**出る——ネットワークパネルだけでなく
 * **Console にも出る**（Chromium 系は接続失敗時に `POST http://127.0.0.1:50021/audio_query?text=… net::ERR_…`
 * を自動で書く）。アプリのログ出力ではないので §9 の対象外だが、**診断のスクショを共有するときは
 * Console 側にも読み上げ全文＋投稿者名が写る**ので必ずマスクすること（050 の E2E-10）。
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
 *
 * 050: `signal` で**再生の打ち切り**を受け付ける（省略時は従来と完全に同じ）。目的は
 * **永久ハングを塞ぐこと**——再生中に AudioContext が suspended になると `src.onended` が発火せず、
 * この Promise が永久 pending になって ttsQueue の `playing` が true 固定になる（アプリ再起動以外に
 * 復帰手段が無くなる）。呼び出し側は **`ctx.state` が running でなくなったときだけ** abort する契約で、
 * 「まだ鳴っている音」を時間で打ち切ることはしない。
 *
 * 打ち切りでは **`stop()` ＋ `disconnect()` まで行う**。stop だけだと、後で `ctx.resume()` された瞬間に
 * この source が息を吹き返し、既に次の 1 件を再生している ttsQueue と**音が重なる**（直列＝音が重ならない、
 * という中核設計が壊れる）。suspended 中は音が出ていないので、この打ち切り自体は無音を生まない。
 * **reject ではなく resolve する**のは、打ち切りが異常ではない（諦めた 1 件を捨てて次へ進むだけ）ため
 * ——呼び出し側の catch（合成失敗のログ）を汚さない。
 */
export async function playWav(
  ctx: AudioContext,
  wav: ArrayBuffer,
  signal?: AbortSignal,
): Promise<void> {
  // decodeAudioData が入力 ArrayBuffer を破壊的に消費する実装があるため slice で複製して渡す。
  const buffer = await ctx.decodeAudioData(wav.slice(0));
  await new Promise<void>((resolve) => {
    // decode 中に打ち切られていたら鳴らさずに終える（start してから即 stop する無駄を避ける）。
    if (signal?.aborted) {
      resolve();
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const onAbort = () => {
      // suspended 中は onended が発火しないため、stop() 任せにせず自分で解決する。
      //
      // ⚠ **後始末が失敗しても必ず `resolve()` に到達させる**（050 レビュー Q-1）。このハンドラは
      // abort イベントのディスパッチ中に走るので、ここで投げた例外は `controller.abort()` の呼び出し側へ
      // 伝わらず**その場で握り潰される**——`resolve()` を飛ばすとこの Promise が永久 pending になり、
      // **ハング防止のコードがハングを作る**（呼び出し側の watchdog も `clearInterval` に到達できず
      // 1 Hz で回り続ける）。`disconnect()` は仕様上は投げないが、`ctx.close()` 済み（ttsQueue の
      // dispose 経路）でこのハンドラが走る経路が実在し、閉じた context のノード操作は実装差が出やすい。
      // 例外を**外へ出さない**のも意図的（escape すると `window.onerror` に飛ぶだけで誰も直せない。
      // 解決さえしていれば実害は無い）。
      try {
        // stop の失敗で disconnect を飛ばさないよう、内側でも握る。音が重ならない保証は
        // disconnect の側にあるので、こちらを落とす方が高くつく。
        try {
          src.stop();
        } catch {
          /* 未 start / 二重 stop は無害（打ち切りが目的で、状態は問わない） */
        }
        src.disconnect();
      } catch {
        /* closed な context でのノード操作失敗など。打ち切りの本義は「必ず解決すること」なので無視する */
      }
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    src.onended = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    src.start();
  });
}
