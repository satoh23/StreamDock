// 044a: OBS 連携（obs-client）の純ヘルパ。**obs-websocket に非依存で副作用が無い**ため単体テスト対象
// （scripts/test-obs-client.mjs）。OBS プロトコル往復（GetSceneList/CreateInput/SetInputSettings 等の call 群）は
// obs-client 側に残し、実 OBS での挙動は E2E で確認する。ここには純粋な文字列/型の変換のみを置く。

/**
 * obs-websocket のエラーを機微情報なしで要約する（password は元々 message に載らない）。
 * reason は loopback WS 経由で viewer UI に表示されるが、接続/認証/窓未検出エラーに機微は載らず、UI は React で
 * エスケープ描画する（XSS なし）。再修正トリガー: 将来 message に機微が混ざり得るなら既知の定型文へマッピングする。
 */
export function safeReason(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * macOS の window itemName "[owner] title" を安定キー owner_name/window_name に分解する（044s 実測フォーマット）。
 * 数値 window ID は起動毎に変わるため、この 2 キーを併設して安定させる。角括弧で始まらない等の想定外は両方
 * undefined（呼び出し側は window 数値 ID のみで設定＝壊れず劣化）。owner は `[^\]]+`＝空にならない。title は空文字あり得る。
 */
export function parseMacWindowItemName(itemName: unknown): {
  ownerName?: string;
  windowName?: string;
} {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(String(itemName ?? ""));
  if (!m) return {};
  return { ownerName: m[1], windowName: m[2] };
}

/**
 * Windows の window_capture「キャプチャ方法」プロパティ名が WGC（Windows 10 1903 以降）を指すか。
 * 透過窓は既定「自動」だと黒くなるため、この名前一致で WGC の itemValue を優先採用する（要 098 実機検証）。
 */
export function isWgcMethodName(name: unknown): boolean {
  return (
    typeof name === "string" &&
    /1903|Windows 10|Graphics Capture|WGC/i.test(name)
  );
}

/**
 * 064a: **OBS のソース名として受理してよい文字列か**（`obs-fire-source` / `obs-list-sources` の入口）。
 *
 * ⚠⚠ **なぜこの検査が要るのか（064 の最重要点）**: 044a 以来、sidecar が OBS へ渡すソース名は
 * `OBS_OVERLAYS` の**固定表**だけで、**viewer から任意の名前を受け取らない**ことが
 * docs/security.md §3 / §8 の担保そのものだった。064a で「ユーザーが OBS 側に作ったソースを鳴らす」
 * ため、**初めて外から来た文字列が OBS 操作へ渡る**。
 *
 * ⇒ 壁は 2 枚立てる:
 *   1. **この形式検査**（型・空・長さ・制御文字）… ここ
 *   2. ⚠⚠ **実在検査**（`GetInputList` に同名があり、かつ許可された種別であること）… `obs-client` 側
 *      ——**こちらが本体**である。存在しない名前は 1 回も OBS 操作に渡らない。
 *
 * ⚠ 上限 200 文字は OBS 側の実用上の名前長を大きく上回る値（**入力の暴走を止めるための衛生上限**）。
 * ⚠ 制御文字を落とすのは、ログ・エラー文言へ回り込んだときに表示を壊さないため（§9 の作法）。
 */
export function isAllowedObsSourceName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * 064a: エフェクトを出しておく長さ（ミリ秒）を受理範囲へ落とす。
 *
 * ⚠ 範囲は `effect_template::manifest` の `durationMs`（500〜15000）と**同じ数字**にしてある——
 * ユーザーから見れば「エフェクトが出ている長さ」という 1 つの概念なので、**2 つの上限を作らない**。
 * ⚠⚠ **拒否ではなくクランプにしている**のは、ここが「表示を消し忘れない」ための安全弁だからである
 * （不正な値で**消えないまま配信に残る**のが最悪の壊れ方で、それだけは絶対に避ける）。
 */
export function clampObsFireDurationMs(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 5000;
  return Math.min(15000, Math.max(500, Math.round(n)));
}

/**
 * 064b: **出しておく長さを OBS に聞いた結果から決める**（メディアソースだけ）。
 *
 * ## ⚠⚠ なぜ固定秒ではなく OBS に聞くのか
 *
 * 064a のテスト発火は 5 秒固定だったが、**条件に割り当てて実運用に載せると
 * 「10 秒の動画が 5 秒で切れる」が必ず起きる**。これは 064a の実機確認で確かめた
 * 「一覧に出るのに鳴らない」と同じ種類の壊れ方＝**仕様どおりなのにバグとして報告される**もので、
 * かつ**設定項目を増やさずに消せる**（＝ 061d の「たぬえさ3 より簡単に」を守れる）。
 * ⇒ `GetMediaInputStatus` の `mediaDuration` を採り、取れなければ呼び出し側の既定へ落とす。
 *
 * ## ⚠⚠ それでも必ずクランプする
 *
 * `mediaDuration` は**OBS が返す外部由来の数値**である（null・0・負・巨大値がありうる）。
 * ここを素通しすると **`setTimeout` に巨大値が渡って実質「消えない」** ——
 * この機能で最悪の壊れ方（配信画面に出しっぱなし）そのものになる。
 * ⇒ 使えない値は `fallback` へ倒し、**最後は必ず [`clampObsFireDurationMs`] を通す**。
 * ⚠ **帰結として 15 秒より長い動画は 15 秒で切れる**（＝上限は残っている）。
 * **再修正トリガー＝実機で「長い動画が途中で切れる」と言われたとき**——そのときは
 * 上限を上げるのではなく、まず **`MediaInputPlaybackEnded` イベントで消す**方式を検討すること
 * （接続を張りっぱなしにできる 064b 以降の判断とセットになる）。
 *
 * ⚠ `> 0` を要求するのは、OBS が**再生していないメディア**に対して `0` や `-1` を返すため
 * （そのときは「長さが分からなかった」＝ `fallback` が正しい）。
 */
export function resolveObsFireDurationMs(
  mediaDuration: unknown,
  fallback: unknown,
): number {
  if (
    typeof mediaDuration === "number" &&
    Number.isFinite(mediaDuration) &&
    mediaDuration > 0
  ) {
    return clampObsFireDurationMs(mediaDuration);
  }
  return clampObsFireDurationMs(fallback);
}
