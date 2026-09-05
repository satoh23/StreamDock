import { invoke } from "@tauri-apps/api/core";
import type { CommentViewDto } from "./types";

/**
 * 032c-b: 内蔵コメントビューアと Twitch コメント取得 sidecar の単一双方向 WebSocket。
 *
 * 接続先ポートは Rust が sidecar の stdout から受領した実ポート（既定 17331・使用中なら空きポート）を
 * 読み取り専用コマンド `get_comment_stream_port` で取得してから `ws://127.0.0.1:<port>` に接続する
 * （frontend は raw ポート/パスを組み立てない・localhost のみ・main は no-internet）。
 *
 * - viewer→sidecar 制御: `start-login`（Device Code 開始）/ `start-session`（channel 指定で取得開始）/ `stop-session`
 *   （⚠ **066 段 2: `start-session` / `stop-session` はチケット必須**。宛先の差し替え対策・下記 [`sendSessionControl`]）
 *   / `theme-import.fetch`（060c・外部 `@import` を 1 本だけ取得。**チケット必須**）
 * - sidecar→viewer: `device_code`（user_code / verification_uri をテキスト提示）/ `session.state` / `comments.append`
 *   / `theme-import.result`（060c・⚠ **要求元だけへの unicast**。broadcast ではない）
 *
 * `comments.append` の payload.comment は Rust 正規化 CommentViewDto と**同形**（sidecar が正規化済み）なので、
 * ここでの形式変換は不要（コミット1 の暫定アダプタは撤去済み）。
 */

/** Device Code の提示情報（user_code / verification_uri）。 */
export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
}

/** 032c-d: 配信サービス（各サービス個別選択・併存）。 */
export type CommentService = "twitch" | "youtube";

/**
 * 046d/061a/**061k**: OBS へ自動追加する対象オーバーレイの種別。sidecar 側の `ObsOverlayKind` と
 * **同じ 4 値**で、制御フレームにはこの識別子だけを載せる
 * （ソース名・窓名は sidecar 内の表に閉じる＝任意の名前を渡さない）。
 *
 * ⚠ **型定義は 2 か所（ここと sidecar の `obs/obs-client.ts`）にあり、同期は人手**。ずれても
 * typecheck では気付けない（WS 境界で型が失われる）が、実害は「送っても sidecar 側の
 * `parseOverlayKind` が `"comments"` へ落とす」＝**誤った窓のソースが作られる**方向に出る。
 * ⚠ 窓名の 2 者間契約は Rust の `overlay_window_contract` が固定しているが、**この union のずれは
 * そこでは捕まらない**（あちらが見るのは窓タイトル文字列）。値を足すときは必ず両方を直すこと。
 * ⚠⚠ **061a レビュー Q-7 でこのずれを止める契約テストが入っている**
 * （`obs_overlay_kind_union_matches_between_sidecar_and_desktop`＝両側の union の**右辺を文字列として
 * 突き合わせ**、さらに**値の数と Rust の窓数**も照合する）。
 * ⚠ **片側だけ 4 値にすると `"stage"` が sidecar で `"comments"` に化け、
 * コメントオーバーレイのソースが黙って作られる**——壊れ方の向きを知っておくこと。
 */
export type ObsOverlayKind = "comments" | "pinned" | "stage";

export interface CommentStreamHandlers {
  onComments: (comments: CommentViewDto[]) => void;
  onDeviceCode?: (prompt: DeviceCodePrompt) => void;
  /** 032c-d: session.state を platform 別に受け取る（twitch/youtube を viewer が別パネルに反映）。 */
  onSessionState?: (
    platform: CommentService,
    state: string,
    reason?: string,
  ) => void;
  onConnectionChange?: (connected: boolean) => void;
  /** 032c-b/032c-d: ログイン済みか（platform 別）。twitch=keychain 復元/成功/失効、youtube=in-memory の当該セッション。 */
  onLinkState?: (platform: CommentService, linked: boolean) => void;
  /**
   * 044a: OBS 連携の状態（idle/connecting/added/reused/failed）。UI のトグル状態・失敗時の手動誘導に使う。
   *
   * 2026-09-05（静音化）: `lane`（発生元レーン）が増えた。sidecar は
   * `"comments" | "pinned" | "stage"`（enable/hide の対象窓）または `"effects"`（発火・一覧取得）の
   * 固定 union 値を送るが、**WS 境界で型が失われるので `string` で受ける**
   * （`state` と同じ作法・受け手がリテラル比較で判定する）。
   * `disable` 由来の echo（idle）には載らない（undefined）。
   * 受け手（`CommentViewerApp`）は `lane === "stage" | "effects"` を **UI に出さずに捨てる**——
   * 判断の全文はあちらの `requestObsAutoAdd` の JSDoc が正。
   */
  onObsState?: (state: string, reason?: string, lane?: string) => void;
  /**
   * 064a: **OBS に既にあるソースのうち、エフェクトとして鳴らせるものの一覧**。
   *
   * ⚠ 載るのは**名前と種別だけ**（設定値もファイルパスも sidecar が落としている・§9）。
   *
   * ## ⚠⚠ 064c: `ok`（取れたのか）が増えた
   *
   * 064a は失敗時も**空配列**で来て、受け手が「取れていない」と「0 件」を区別できなかった。
   * その結果 main 窓が **OBS 未起動のユーザーへ「OBS のシーンにソースを追加してください」**という
   * 間違った対処を案内していた（061a レビュー Q-1 と同じ失敗モードの 3 度目）。
   * ⚠ **`onObsState` では代替できない**——あちらは comments/pinned/stage 共有の状態通知で、
   * どの操作が失敗したのか判別できない（061e レビュー Q-5 が受容している限界）。
   *
   * @param ok `true` ＝ OBS へ繋がって一覧を取れた（**0 件でも `true`**）。
   */
  onObsSources?: (sources: { name: string; kind: string }[], ok: boolean) => void;
  /**
   * 063e 段 1-b: **チャンネルポイント購読の成否**（sidecar の `channelpoints.state`）。
   *
   * ⚠⚠⚠ **これが無いと「黙って効かない」が残る**（061a Q-1）。チャンネルポイントの購読は
   * **非致命**（403 でもコメント取得は続く）なので、失敗しても画面には**何も起きない**。
   * しかも失敗は例外ではなく**新規配信者の既定状態**である——チャンネルポイントは Twitch 側で
   * 有効化されるまで存在せず、有効化はマイルストーン達成後のオンボーディングを通る。
   *
   * ⚠ 受け取る値は 3 語だけ:
   *   - `"unknown"` ……… Twitch の取得を開始していない（**「駄目だった」ではない**）
   *   - `"receiving"` …… 購読できた＝引き換えが届く
   *   - `"unavailable"` … 購読できなかった（未有効化／再ログイン前／他人のチャンネル）
   * ⚠⚠ **`unknown` と `unavailable` を混ぜないこと。** 混ぜると「まだ接続していないだけ」の人に
   *   「Twitch の設定を確認してください」と案内する——064c が `obs.sources` の `ok` で潰した失敗と同型。
   * ⚠ **理由（エラー内容）は載っていない**（§9・sidecar が載せない）。切り分けは固定の文言が担う。
   *
   * ⚠ `obs.state` と同じく **WS 境界で型が失われる**ので `string` で受ける
   *   （消費側の `SettingsView` がリテラル比較で網羅する）。
   */
  onChannelPointsState?: (state: string) => void;
}

/**
 * 060c: 外部 `@import` の取得結果（sidecar → **要求元のクライアントだけ**へ unicast で届く）。
 *
 * ⚠ `reason` は sidecar 側の**固定語彙のみ**（`blocked` / `redirect` / `type` / `size` / `timeout` /
 * `network`）。HTTP ステータスもレスポンス本文も URL も載らない（§9）。
 */
export type ThemeImportFetchResult =
  | { ok: true; css: string }
  | { ok: false; reason: string };

/**
 * 060h: `@font-face` の `src` が指すフォント実体の取得結果（同じく unicast）。
 *
 * ⚠⚠ **`mime` は sidecar が allow-list で検証した値だけ**（`font/woff2` 等）。
 * frontend はこれをそのまま `data:<mime>;base64,<base64>` に組むので、
 * **こちら側で型を決められない**ことが要件である。
 */
export type ThemeFontFetchResult =
  | { ok: true; mime: string; base64: string }
  | { ok: false; reason: string };

/**
 * 066 段 2: **取得セッションの制御（開始・停止）の結果。**
 *
 * ⚠⚠ **`ok: true` は「フレームを送れた」であって「取得が始まった」ではない。**
 * 取得が始まったかは従来どおり [`CommentStreamHandlers.onSessionState`] が伝える
 * （`connecting` → `connected`）。⚠ ここで両方を背負わせると、状態の持ち主が 2 か所になる。
 *
 * ⚠ `reason` は**そのまま画面に出してよい短文**（061a Q-1「黙って効かない、を作らない」）。
 */
export interface SessionControlResult {
  ok: boolean;
  reason?: string;
}

/**
 * 066 段 2（レビュー Q-4 の修正）: **viewer → sidecar の取得セッション制御フレーム。**
 *
 * ⚠⚠ **旧実装は `Record<string, unknown>` だった**ので、`type: "start-sesion"` のような綴り間違いを
 * `tsc` が 1 つも止めなかった（テストが形を固定していただけ）。
 * ⚠⚠⚠ **このリポジトリの規律は「runtime で等価ならコンパイル時に強い方を採る」**である
 * （`createEffectFireMatcher` の `!== "none"` を採った理由と同じ）。⇒ union で縛る。
 *
 * ⚠⚠ **`ticket` をここに含めないこと。** 秘密は [`connectCommentStream`] の中で
 * `send({ ...frame, ticket })` として**最後に足す**もので、呼び出し側から渡せてはいけない
 * （渡せると `frame` 側の `ticket` がスプレッド順しだいで本物を上書きしうる）。
 * ⚠ **含めない限り、その上書きは型として起こせない。**
 */
type SessionControlOutgoingFrame =
  | { type: "start-session"; service: CommentService; channel?: string }
  | { type: "stop-session"; service: CommentService };

/**
 * 066 段 2: 制御チケットが取れなかったときに画面へ出す文。
 *
 * ⚠⚠⚠ **これが「穴 C」の対処そのものである。** sidecar 側はチケットが一致しないフレームを
 * **黙って捨てる**（総当たりの手掛かりを与えないため・060c と同じ判断）ので、
 * **正規の窓が黙殺される状況をこちら側で 1 つも残さない**必要がある。
 * ⇒ 送る前にチケットを取り直し、**取れなければ送らずにこの文を返す**。
 * ⚠ ここを `return` だけにして黙ると、**「取得開始を押したのに何も起きない、原因不明」**という
 * 本機能で最も重い回帰になる。
 *
 * ⚠ 文面が「接続していません」なのは、チケットが `null` になる**主な**原因が
 * **sidecar が起動していない（＝ Rust 側の state が `None`）**ことだから。
 * ⚠⚠ **レビュー S-2（訂正）: 「それしかない」は言い過ぎだった。** 他に
 * ①`invoke` 自体が失敗する ②Rust 側の mutex が poison している
 * ③[`SESSION_CONTROL_TICKET_TIMEOUT_MS`] を超えた、の 3 つがある。
 * ⚠ **どれも「少し待ってからもう一度」で正しい案内になる**ので文面は 1 つのままにしてあるが、
 * **「取れない＝未起動」を前提に別の判断を組み立てないこと。**
 */
export const SESSION_CONTROL_UNAVAILABLE_REASON =
  "コメント取得プロセスに接続できていません。少し待ってからもう一度お試しください。";

export interface CommentStreamHandle {
  disconnect(): void;
  /** 032c-d: service 省略時は twitch（後方互換）。youtube はブラウザ同意フロー。 */
  startLogin(service?: CommentService): void;
  /**
   * 032c-d: service ごとに取得開始。twitch は channel 必須／youtube は channel 不要（mine=true）。
   *
   * ⚠⚠⚠ **066 段 2: チケット必須になった**（戻り値が `void` → `Promise<SessionControlResult>`）。
   * `start-session` は **sidecar 側で `chatSender.setChannel` を呼ぶ唯一の経路＝
   * チャット送信の宛先を決めるフレーム**で、未認証の loopback WS から差し替えられていた
   * （security-review 066 S-2）。⚠ **チケットは操作のたびに取り直す**（sidecar 再 spawn で値が変わる）。
   * ⚠⚠ **呼び出し側は結果を捨てないこと**——`ok:false` を画面に出さないと
   * 「押したのに何も起きない」になる（穴 C・[`SESSION_CONTROL_UNAVAILABLE_REASON`] が正）。
   */
  startSession(
    service: CommentService,
    channel?: string,
  ): Promise<SessionControlResult>;
  /**
   * 032c-d: service ごとに取得停止。
   *
   * ⚠ **066 段 2: `startSession` と同じチケットを要求する。** 乗っ取られても fail-closed 側
   * （送信できなくなるだけ）だが、**配信中に取得を止められる**のは実害である。
   * ⚠⚠ 「止められなくなるのでは」＝**ほぼならない**。チケットが取れない主因は sidecar 未起動で、
   * そのときは止める対象のセッションも無い。
   * ⚠⚠⚠ **レビュー S-2（訂正）: ただし「絶対に起きない」ではない。**
   * Rust 側の mutex が poison した場合など、**sidecar は稼働中なのにチケットだけ取れない**状態は
   * 理屈上作れる（段 2 以前は停止がチケット不要だったので、この失敗モードは無かった）。
   * ⚠ **そのときも黙らない**（理由が画面に出る）ので最悪でも「窓を閉じる／アプリを終了する」で回復できる
   * ——sidecar は ppid 監視で親の消滅を検知して self-exit する。
   */
  stopSession(service: CommentService): Promise<SessionControlResult>;
  /** 044a: OBS 連携を有効化し、指定ポート（read-only 検出由来・非秘密）の OBS へソースを自動追加させる。
   *  パスワードはこの WS には載せず、Rust コマンド（set_obs_websocket_password）経由で sidecar へ渡す。
   *  046d: `overlay` は対象種別。実際のソース名/窓名は **sidecar 内の表**に閉じており、ここから名前は渡さない。 */
  enableObs(port: number, overlay: ObsOverlayKind): void;
  /**
   * 064a: 鳴らせる OBS ソースの一覧を要求する（結果は [`CommentStreamHandlers.onObsSources`]）。
   * ⚠ port のみ・非秘密（`enableObs` と同じ）。
   */
  listObsSources(port: number): void;
  /**
   * 064a: **ユーザーが OBS に作ったソースを 1 回だけ鳴らす**（表示 → 頭出し → `durationMs` 後に非表示）。
   *
   * ⚠⚠ **これは「viewer から来た文字列が OBS 操作へ渡る」唯一の経路**である。
   * sidecar 側で①形式検査②**`GetInputList` との実在照合**を通してからしか使われない
   * （`obs/obs-helpers.ts` の `isAllowedObsSourceName` と `obs-client` の `fireSource` が正）。
   * ⚠ **ソースを作る／消す能力は無い**（表示・非表示・頭出しの 3 操作だけ）。
   */
  fireObsSource(port: number, sourceName: string, durationMs: number): void;
  /** 044a: オーバーレイ表示 OFF 連動。OBS 側ソースを削除せず非表示にする（ON で enableObs が再表示）。port のみ・非秘密。 */
  hideObs(port: number, overlay: ObsOverlayKind): void;
  /** 044a: OBS 連携 OFF（状態を idle に戻す・OBS 側のソースは消さない）。 */
  disableObs(): void;
  /**
   * 066: **配信のチャットへ 1 通送る**（⚠⚠ **StreamDock 初の「書き込み」経路**）。
   *
   * ⚠⚠ **宛先を渡さない。** 送り先は sidecar が「いま取得しているセッション」から決める
   * （`chat-send/chat-send-frame.ts` の `ChatSendFrame` の注記が正）。
   * ⚠⚠⚠ **security-review 066 S-2: ただし「宛先が viewer から来ない」わけではない**
   * ——その取得セッションの `channel` は `start-session` 由来である。
   * ✅ **066 段 2 でその `start-session` 自体をチケット必須にした**（[`startSession`] が正）。
   * ⚠ **チケットは送信のたびに取り直す**（sidecar 再 spawn で値が変わる）。
   * ⚠ **呼ぶ前にユーザーが明示的に有効化していること**（既定 OFF のトグル）。
   *
   * @param expectedChannel ⚠⚠⚠ **S-2b: 宛先ではなく「宛先の期待値」。**
   *   **画面に「送信先」として出しているのと同じ値**を渡すこと。sidecar は実際の宛先と
   *   突き合わせ、**食い違ったら送らない**。⚠ 当初は「画面に出すだけ」で済ませていたが、
   *   出していたのは frontend 自身の入力値で、**差し替えられても表示が変わらない**＝
   *   気づけなかった（＝対処になっていなかった）。⚠ **表示とここに渡す値を必ず一致させること。**
   * @returns `{ok:true}` / `{ok:false, reason}`。⚠ `reason` は**そのまま画面に出してよい短文**。
   */
  sendChat(
    message: string,
    expectedChannel: string,
  ): Promise<{ ok: boolean; reason?: string }>;
  /**
   * 060c: 外部 `@import` を **1 本だけ** sidecar に取得させる（スナップショット）。
   *
   * ⚠⚠ **呼ぶ前にユーザーの明示同意を得ていること。** 同意ダイアログは `OverlayThemeCard` にあり、
   * sidecar 側からは同意の有無を検証できない（代わりにチケット認証で「StreamDock の窓以外は
   * そもそも送れない」ようにしてある）。
   * ⚠ **`url` は同意ダイアログに表示したものと同一の変数を渡すこと**（別々に組み立てない）。
   * ⚠ WS が未接続なら `{ ok:false, reason:"offline" }` を即返す（送信して黙って捨てられるのを防ぐ）。
   *
   * @param url      取得先（sidecar 側の `assertAllowedThemeImportUrl` が再検証する）
   * @param maxBytes `256KB − 既存 CSS 長` の動的値
   */
  requestThemeImport(
    url: string,
    maxBytes: number,
  ): Promise<ThemeImportFetchResult>;
  /**
   * 060h: `@font-face` の `src` が指すフォント実体を **1 本だけ** sidecar に取得させる。
   *
   * ⚠⚠ 前提は `requestThemeImport` とまったく同じ（**呼ぶ前に明示同意を得ていること**・
   * **URL は同意ダイアログが示したものと同一の変数**・チケットは取得のたびに取り直す）。
   * ⚠ sidecar 側は **別ガード（`.woff2` / `.woff`）と別枠のレート制限**を通る。
   *
   * @param url      取得先（sidecar 側の `assertAllowedThemeFontUrl` が再検証する）
   * @param maxBytes 残り予算（sidecar 側で 512KiB の天井にクランプされる）
   */
  requestThemeFont(
    url: string,
    maxBytes: number,
  ): Promise<ThemeFontFetchResult>;
}

/** sidecar から届く platform を正規化する（未指定・不正は既定 twitch＝後方互換）。 */
function parsePlatform(v: unknown): CommentService {
  return v === "youtube" ? "youtube" : "twitch";
}

/** ポート未確定時・切断時の再試行間隔（ミリ秒）。 */
const RETRY_INTERVAL_MS = 1000;

/**
 * 060c: 取得結果を待つ上限（ミリ秒）。sidecar 側の取得タイムアウト（10 秒）＋往復の余裕。
 * ⚠ これが無いと、sidecar が応答しないときに同意ループが永久に止まる。
 */
const THEME_IMPORT_TIMEOUT_MS = 15_000;

/**
 * 060h: フォント 1 本の待ち上限（ミリ秒）。sidecar 側の 5 秒＋往復の余裕。
 * ⚠ CSS の 15 秒と分けてあるのは、日本語 1 ファミリで 110 本を逐次で引くため
 * （15 秒 × 110 本＝最悪 27 分になり、取り込みが終わらなくなる）。
 */
const THEME_FONT_TIMEOUT_MS = 8_000;

/** 060h: sidecar 側の制御フレーム種別（`theme-import-frame.ts` と同じ綴り）。 */
const THEME_IMPORT_FETCH_FRAME = "theme-import.fetch";
const THEME_IMPORT_RESULT_FRAME = "theme-import.result";
const THEME_FONT_FETCH_FRAME = "theme-import.fetch-font";
const THEME_FONT_RESULT_FRAME = "theme-import.font-result";
/**
 * 066: sidecar → **要求元 1 本**へ返すチャット送信の結果。
 * ⚠ 値は sidecar 側の `chat-send/chat-send-frame.ts` の `CHAT_SEND_RESULT_FRAME` と**同じ文字列**。
 * ⚠⚠ **片方だけ変えないこと**（変えると送信が永久に `null` で返る＝「送れたか分からない」に倒れる）。
 */
const CHAT_SEND_RESULT_FRAME = "chat.send.result";
/** 066: viewer → sidecar のチャット送信フレーム種別。⚠ 上と同じ理由で sidecar 側と揃える。 */
const CHAT_SEND_FRAME = "chat-send";
/**
 * 066: 送信の応答を待つ上限。⚠ `GET /users` の解決（初回のみ 2 往復）＋ 送信の 1 往復ぶんを見込む。
 * ⚠ **短すぎると「送れているのにタイムアウト」**＝二重送信を誘発するので、余裕を取る。
 */
const CHAT_SEND_TIMEOUT_MS = 15_000;

/**
 * 066 段 2（レビュー S-1 の修正）: **制御チケットの取得（`invoke`）を待つ上限。**
 *
 * ⚠⚠⚠ **これが無いと `sessionControlChain` が永久に詰まる**——鎖のリンクが settle しないと
 * 以後の取得開始／停止が 1 本も実行されず、しかも呼び出し側の `await` も返らないので
 * **画面に理由すら出ない**（穴 C の最悪形。あちらの JSDoc が正）。
 * ⚠ **超過は「取れなかった」と同じ扱い**（[`SESSION_CONTROL_UNAVAILABLE_REASON`] を返す）＝
 * fail-closed のまま、**黙らない**。
 * ⚠ 値の根拠＝ [`CHAT_SEND_TIMEOUT_MS`] より**十分短い**こと。あちらは Twitch API の往復を
 * 含むが、こちらは **Rust の in-memory な文字列を 1 つ返すだけ**（ネットワークもディスクも無い）で、
 * 正常時は数 ms しか掛からない。⚠ **長くすると「押したのに反応しない」時間がそのまま伸びる。**
 * ⚠ **再修正トリガー**＝実測でチケット取得が 1 秒を超えるようになったとき
 * （そのときは値を上げる前に **Rust 側が mutex を長く握っている理由**を先に調べること）。
 */
const SESSION_CONTROL_TICKET_TIMEOUT_MS = 5_000;

/**
 * 060h: 取得待ちの 1 件（CSS / フォント共通）。
 *
 * ⚠ **WS 境界を跨ぐ値なので型は信用しない**——応答の中身を検証して所定の形へ落とすのは
 * 各 `request*` の責務で、ここは「どのフレームの、どの requestId を待っているか」だけを持つ。
 */
interface PendingThemeRequest {
  requestId: number;
  /** 期待する応答フレーム種別（別種別の応答を取り違えない）。 */
  resultType: string;
  settle: (payload: Record<string, unknown> | null) => void;
}

function isDeviceCodePrompt(v: unknown): v is DeviceCodePrompt {
  if (typeof v !== "object" || v === null) return false;
  const p = v as { userCode?: unknown; verificationUri?: unknown };
  return typeof p.userCode === "string" && typeof p.verificationUri === "string";
}

export function connectCommentStream(
  handlers: CommentStreamHandlers,
): CommentStreamHandle {
  let closed = false;
  let ws: WebSocket | null = null;
  let retryTimer: number | null = null;
  /**
   * 060c: 進行中のテーマ取得（**同時 1 本だけ**）。同意ループが逐次なので自然に 1 本になる。
   * `requestId` が一致しない結果は捨てる（stale な応答を取り違えない）。
   */
  let pendingThemeImport: PendingThemeRequest | null = null;
  let nextThemeImportRequestId = 1;
  /**
   * 066: 進行中のチャット送信（**同時 1 本だけ**）。
   * ⚠ `requestId` が一致しない結果は捨てる（stale な応答を取り違えない・060c と同じ作法）。
   *
   * ⚠⚠⚠ **063f 段 2-a 訂正: 「段 1 は手動のテスト送信しか無いので自然に 1 本になる」は嘘になった。**
   * 063f が**視聴者の行動**を契機にしたので、**同じ tick で最大 3 本**呼ばれる
   * （同一バッチの当選が同じ遅延で予約されるため）。⇒ **1 本に絞っているのは
   * [`sendChat`] の予約（この変数）だけ**であり、その予約が実際に効くようになったのが段 2-a である。
   */
  let pendingChatSend: {
    requestId: number;
    settle: (payload: { ok: boolean; reason?: string } | null) => void;
  } | null = null;
  let nextChatSendRequestId = 1;

  const clearRetry = (): void => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    clearRetry();
    retryTimer = window.setTimeout(() => void connect(), RETRY_INTERVAL_MS);
  };

  const send = (frame: unknown): void => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(frame));
    }
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    let port: number | null = null;
    try {
      port = await invoke<number | null>("get_comment_stream_port");
    } catch {
      port = null;
    }
    if (closed) return;
    if (port === null) {
      scheduleReconnect();
      return;
    }

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    /**
     * ⚠⚠ 062b: **この接続で `session.state` をまだ 1 通も受けていない platform**。
     *
     * sidecar（`websocket-comment.output-port.ts` の `server.on("connection")`）は、新規クライアントへ
     * **必ず・同期で・最初に** `sendSessionSnapshots` を送る。ところがそのスナップショットを更新するのは
     * `publishSessionState` だけで、stream-dock の制御経路（sidecar の `index.ts`）は
     * `broadcastMessage` を直接使うため、**スナップショットは永久に初期値（`idle`）のまま**である。
     * ⇒ **WS が繋がるたびに、両 platform へ嘘の `idle` が 1 通ずつ届く**（しかも sidecar は状態が
     * 変化するまで `connected` を送り直さないので、**その後 `idle` のまま据え置かれる**）。
     *
     * 062b 以前は「再接続直後の一瞬だけ待機表示」で済んでいたが、062b は接続状態から
     * **配信セッションの終了**を判定するので、これを信じると:
     *   - ステージ窓を開いたままコメビュ窓を開き直す（sidecar は生きていてコメントは流れ続ける）
     *   - WS が一瞬切れて 1 秒後に自動再接続する（`RETRY_INTERVAL_MS`）
     * のどちらでも **配信中なのにセッションが終了させられる**。
     *
     * ⇒ **接続 1 本につき platform ごとの最初の 1 通が `idle` なら捨てる。** これは経験則ではなく
     * 構造上の厳密規則である（スナップショットは常に接続直後の最初の 1 通・常に `idle`）。
     * ⚠ `idle` 以外なら通す——将来 sidecar が `publishSessionState` 経由へ変わってスナップショットが
     * 正確になったとき、その情報を捨てないため。
     * ⚠ 接続ごとに作り直す（`connect()` のローカル）ので、再接続でも必ず効く。
     */
    const snapshotPending = new Set<CommentService>(["twitch", "youtube"]);
    ws = socket;
    socket.onopen = () => {
      handlers.onConnectionChange?.(true);
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: unknown;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (typeof msg !== "object" || msg === null) return;
      const m = msg as { type?: unknown; payload?: unknown };
      if (m.type === "comments.append") {
        const comment = (m.payload as { comment?: unknown } | undefined)?.comment;
        if (comment) handlers.onComments([comment as CommentViewDto]);
      } else if (m.type === "device_code") {
        if (isDeviceCodePrompt(m.payload)) handlers.onDeviceCode?.(m.payload);
      } else if (m.type === "session.state") {
        const p = m.payload as
          | { platform?: unknown; state?: unknown; reason?: unknown }
          | undefined;
        if (typeof p?.state === "string") {
          const platform = parsePlatform(p.platform);
          // ⚠⚠ 062b: 接続直後のスナップショット（常に `idle`）は捨てる。理由は上の
          //   `snapshotPending` の注記（＝配信中のセッションを終了させないための本体）。
          const isFirstSinceOpen = snapshotPending.delete(platform);
          if (isFirstSinceOpen && p.state === "idle") return;
          handlers.onSessionState?.(
            platform,
            p.state,
            typeof p.reason === "string" ? p.reason : undefined,
          );
        }
      } else if (m.type === "link.state") {
        const p = m.payload as
          | { platform?: unknown; linked?: unknown }
          | undefined;
        if (typeof p?.linked === "boolean") {
          handlers.onLinkState?.(parsePlatform(p.platform), p.linked);
        }
      } else if (m.type === CHAT_SEND_RESULT_FRAME) {
        // 066: 要求元だけに unicast で届く送信結果。⚠ `requestId` が一致しないものは捨てる。
        // ⚠⚠ payload に**本文は載っていない**（§9・sidecar 側が載せない）。
        const p = m.payload as
          | { requestId?: unknown; ok?: unknown; reason?: unknown }
          | undefined;
        if (
          pendingChatSend !== null &&
          p?.requestId === pendingChatSend.requestId &&
          typeof p?.ok === "boolean"
        ) {
          const settle = pendingChatSend.settle;
          pendingChatSend = null;
          settle({
            ok: p.ok,
            ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
          });
        }
      } else if (
        m.type === THEME_IMPORT_RESULT_FRAME ||
        m.type === THEME_FONT_RESULT_FRAME
      ) {
        // 060c/060h: 要求元だけに unicast で届く取得結果。
        // ⚠ **`requestId` と応答フレーム種別の両方が一致するものだけ**受ける
        //   （stale な応答も、別種別の応答も取り違えない）。
        // ⚠ **CSS 本文もフォントのバイト列もエラー理由も `console.*` に出さない**（§9）。
        const p = m.payload as Record<string, unknown> | undefined;
        if (
          pendingThemeImport !== null &&
          m.type === pendingThemeImport.resultType &&
          typeof p?.requestId === "number" &&
          p.requestId === pendingThemeImport.requestId
        ) {
          const settle = pendingThemeImport.settle;
          pendingThemeImport = null;
          settle(p);
        }
      } else if (m.type === "obs.sources") {
        // 064a: 鳴らせる OBS ソースの一覧。⚠ **型は WS 境界で失われる**ので、
        //   ここで**配列であること・各要素が name/kind の文字列であること**まで見てから渡す
        //   （`obs.state` が `typeof p?.state === "string"` を見ているのと同じ作法）。
        const p = m.payload as { sources?: unknown; ok?: unknown } | undefined;
        const sources = Array.isArray(p?.sources)
          ? p.sources.filter(
              (s): s is { name: string; kind: string } =>
                typeof s === "object" &&
                s !== null &&
                typeof (s as { name?: unknown }).name === "string" &&
                typeof (s as { kind?: unknown }).kind === "string",
            )
          : [];
        // ⚠⚠ 064c: **`ok` が boolean でなければ `false`**（＝「取れた」と断言しない）。
        //   ⚠ **倒し先を間違えないこと。** `true` へ倒すと、0 件のときに
        //   「OBS のシーンにソースを追加してください」＝**064c が潰した当の誤案内**が復活する。
        //   `false` 側の誤りは「OBS を確認してください」で済み、ユーザーの行動が無害である。
        handlers.onObsSources?.(sources, typeof p?.ok === "boolean" ? p.ok : false);
      } else if (m.type === "channelpoints.state") {
        // 063e 段 1-b: チャンネルポイント購読の成否。⚠ 非秘密（状態語 1 つだけ・§9）。
        // ⚠⚠ **未知の語は捨てる**（`obs.state` の `typeof p?.state === "string"` と同じ作法だが、
        //   こちらは受け手が 3 語を網羅する前提なので、**型が違うものを渡さない**ことだけ守れば足りる）。
        const p = m.payload as { state?: unknown } | undefined;
        if (typeof p?.state === "string") {
          handlers.onChannelPointsState?.(p.state);
        }
      } else if (m.type === "obs.state") {
        // 044a: OBS 連携の状態通知。非秘密（state/reason/lane のみ・パスワードは載らない）。
        // L4(修正不要): state は WS 境界を跨ぐため string で受ける（sidecar の ObsState union は共有しない）。
        // SettingsView がリテラル比較で網羅する。再修正トリガー: 状態語が増えて取りこぼしが問題化したら共有 union 化する。
        // 2026-09-05（静音化）: lane も同じ作法（string で受け、受け手がリテラル比較）。
        const p = m.payload as
          | { state?: unknown; reason?: unknown; lane?: unknown }
          | undefined;
        if (typeof p?.state === "string") {
          handlers.onObsState?.(
            p.state,
            typeof p.reason === "string" ? p.reason : undefined,
            typeof p.lane === "string" ? p.lane : undefined,
          );
        }
      }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      handlers.onConnectionChange?.(false);
      // 060c: 進行中の取得を即座に失敗させる（待たせても結果は来ないし、15 秒固まるだけ）。
      if (pendingThemeImport !== null) {
        const settle = pendingThemeImport.settle;
        pendingThemeImport = null;
        // ⚠ `null` ＝「応答が来なかった」。各 `request*` が `offline` へ落とす。
        settle(null);
      }
      // 066: 送信の待ちも落とす（待たせても結果は来ない）。⚠ **成功へ倒さない**——
      //   「送れたのか分からない」ときに「送れた」と出すのが最悪の壊れ方である。
      if (pendingChatSend !== null) {
        const settle = pendingChatSend.settle;
        pendingChatSend = null;
        settle(null);
      }
      scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* noop */
      }
    };
  };

  void connect();

  /**
   * 060c/060h: テーマ資産（CSS / フォント）の取得を **1 本だけ** sidecar へ依頼し、応答を待つ。
   *
   * ⚠⚠ **CSS とフォントで 1 本に共通化してある**のが要点——未接続の扱い・同時 1 本の制限・
   * **チケットの取り直し**・タイムアウト・stale 応答の破棄はどちらにも等しく要るので、
   * 分けると「新しいほうだけチケットを付け忘れる」形が作れてしまう。
   * 違うのは**フレーム種別・応答種別・待ち時間**の 3 つだけで、すべて引数で受ける。
   *
   * @returns 応答の payload（そのまま）。`null` は「応答が来なかった／送れなかった」。
   *
   * ⚠ **戻り値に 3 種類の意味が混ざっている**（060h review Q-8・受容）:
   * ① sidecar から届いた payload ② ローカルで合成した `{ok:false, reason:"busy"|"timeout"}`
   * ③ `null`（未接続・チケット無し・切断）。判別する必要が無いので型を割っていない——
   * **呼び出し側（`requestThemeImport` / `requestThemeFont`）は 3 つとも同じ扱い**
   * （`ok===true` かつ期待フィールドが揃っていれば成功、それ以外は `reason` を出す）で、
   * ①と②を区別してユーザーの行動が変わることは無い。
   * ⚠ 再修正トリガー＝「sidecar 由来かどうか」で処理を分けたくなったとき
   * （そのときは `{ kind: "payload" | "local", value }` の union へ割ること）。
   */
  const requestThemeAsset = async (
    frameType: string,
    resultType: string,
    url: string,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> => {
    // ⚠ **未接続なら送らない。** `send` は OPEN でなければ黙って捨てるので、送ってから待つと
    // タイムアウトまで固まったうえに「なぜ効かないか」が伝わらない。
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return null;
    }
    // 進行中があれば拒否する（同時 1 本。同意ループは逐次なので通常起きない）。
    // ⚠ **この検査と `pendingThemeImport` への代入の間に `await invoke` が挟まる**ので、
    // 厳密には 2 本が同時に通り抜けうる（security-review 060c Q-11）。塞いでいない理由は
    // 呼び出し元が**逐次ループ 1 か所だけ**で、同時に 2 本呼ぶ経路が存在しないから。
    // ⚠ 再修正トリガー＝呼び出し元が 2 か所以上になったら「予約席を先に立てる」形へ直すこと。
    if (pendingThemeImport !== null) {
      return { ok: false, reason: "busy" };
    }
    // ⚠⚠ チケットは**取得のたびに取り直す**。sidecar が再 spawn されると値が変わるので、
    // 握ったまま使い回すと再起動後に黙って無視される。⚠ 値はログにも画面にも出さない（§9）。
    let ticket: string | null = null;
    try {
      ticket = await invoke<string | null>("get_theme_import_ticket");
    } catch {
      ticket = null;
    }
    if (ticket === null) {
      return null;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return null;
    }

    const requestId = nextThemeImportRequestId++;
    return await new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = window.setTimeout(() => {
        if (pendingThemeImport?.requestId === requestId) {
          pendingThemeImport = null;
          resolve({ ok: false, reason: "timeout" });
        }
      }, timeoutMs);
      pendingThemeImport = {
        requestId,
        resultType,
        settle: (payload) => {
          window.clearTimeout(timer);
          resolve(payload);
        },
      };
      // ⚠ **`url` はここまで一度も組み立て直していない**（同意ダイアログが表示した文字列そのもの）。
      send({ type: frameType, ticket, requestId, url, maxBytes });
    });
  };

  /**
   * 066: **配信のチャットへ 1 通送る。**
   *
   * ⚠⚠⚠ **宛先を送らない**（`CommentStreamHandle.sendChat` の注記が正）。
   * ⚠⚠ **チケットは送信のたびに取り直す**（sidecar 再 spawn で値が変わる・060c と同じ規律）。
   * ⚠ **同時 1 本**（[`pendingChatSend`] が唯一の持ち主）。
   *
   * ⚠⚠ **失敗の理由はすべて短文で返す**——「押したのに何も起きない」を作らないため。
   * ⚠ **`null` を返さない**（テーマ取得と違い、呼び出し側が必ず画面に文を出すので、
   * ここで「送れなかった理由」まで決めてしまう）。
   *
   * ## ⚠⚠⚠ 063f 段 2-a（`security-review` S-1 の修正）: **予約は `await` の前に置く**
   *
   * 旧実装は ①`pendingChatSend !== null` のガード → ②**`await invoke`** → ③代入 の順で、
   * ⚠⚠ **ガードと代入のあいだに中断点があった**（TOCTOU）。
   * 063f の自動送信は**同一バッチの当選を同じ遅延で予約する**ので
   * **最大 3 本のタイマーが同じ tick で発火し、3 本とも①を素通りしていた**
   * （⚠ 同構造の再現スクリプトで実測＝**フレーム 3 本送出／settle した Promise は 1 件のみ**）。
   *
   * ⚠⚠⚠ **最も重い帰結は「画面が嘘をつく」ことだった**——1 通目は実際に投稿されて成功するのに、
   * その結果フレームは [`pendingChatSend`] が 3 本目に上書きされているせいで
   * **`requestId` 不一致で捨てられ**、ユーザーに出るのは**3 本目の拒否理由**だった
   * ⇒ **「投稿されたのに『失敗しました』と出る」**。
   * ⚠ 1・2 本目の `Promise` は**永久に未解決**になった（タイムアウト分岐も `requestId` 一致を要求するため）。
   * ⚠⚠ **セキュリティ上の実害はここで止まっていた**——落としていたのは **sidecar のスロットルだけ**で、
   * **Twitch へ届くのは 1 通**だった（⇒ `docs/security.md` §1 の追補は書き換えていない）。
   *
   * ## ⚠⚠ 予約は**必ず**解放する（解放し忘れが最悪の壊れ方）
   *
   * 予約を前へ出した代償として、**解放し忘れると 1 度失敗しただけで以後 1 通も送れなくなる。**
   * ⇒ 解放の経路を 3 本すべて塞いである:
   *
   * 1. **チケットが取れなかった**／**待っているあいだに WS が閉じた** … 下記 `release()`
   * 2. **切断** … `socket.onclose` の既存分岐（進行中の待ちを `settle(null)` で落とす）
   * 3. ⚠⚠⚠ **[`CHAT_SEND_TIMEOUT_MS`] のタイマーを「予約の直後」に張る** …
   *    ⚠ **`invoke` が永久に返らなくても予約が有限時間で必ず解ける。**
   *    旧実装はこのタイマーを**フレーム送出の直前**に張っていたので、
   *    予約を前へ出しただけだと**チケット取得が固まった瞬間に恒久ロック**になっていた
   *    （＝ [`sessionControlChain`] の JSDoc が「鎖にしたこちらだけが持つ穴」と呼んでいたものが、
   *    そのまま `sendChat` へ引っ越してくる形。⚠ **タイマーを送出直前へ戻さないこと**）。
   *    ⚠ タイマーの意味は「**送出 → 結果**」から「**予約 → 結果**」へ広がっている（予約窓の全体を縛る）。
   *
   * ⚠⚠ **解放は必ず `pendingChatSend?.requestId === requestId` を確かめてから行う**——
   * `onclose` が先に `null` にしていることがあり、確かめずに消すと**他人の予約を巻き添えにする**。
   *
   * ⚠⚠⚠ **チケットの扱いは 1 バイトも変えていない**（**送信のたびに取り直す**規律は不変＝
   * `docs/security.md` §1 追補の門 1 枚目の根拠）。
   */
  const sendChat = async (
    message: string,
    expectedChannel: string,
  ): Promise<{ ok: boolean; reason?: string }> => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { ok: false, reason: "コメントの取得に接続していません。" };
    }
    // ⚠⚠ S-2b: 期待値が空なら**送る前に落とす**（空を送っても sidecar が弾くが、
    //   「未接続の表示のまま押した」ときの文はこちらのほうが分かりやすい）。
    if (expectedChannel.trim().length === 0) {
      return { ok: false, reason: "コメントの取得に接続していません。" };
    }
    if (pendingChatSend !== null) {
      // ⚠⚠⚠ **2026-08-30・レビュー Q-4: 文言を「送信中です。少し待ってください。」から変えた。**
      //   旧文は**テスト送信ボタン（手動）時代のもの**で、⚠ 063f の自動送信では
      //   **ユーザーが「待つ」操作は存在しない**（当選のたびに勝手に走る）。
      //   ⇒ **起きた事実だけを言う**（ツールバーの `title` にそのまま出るため）。
      //   ⚠ 落ちた分を溜めない・まとめないのは不変（`sendGachaChat` の JSDoc が正）。
      return {
        ok: false,
        reason: "前の書き込みが終わっていないため送れませんでした。",
      };
    }

    // ⚠⚠⚠ S-1: **上のガードからこの代入までに `await` を 1 つも挟まないこと。**
    //   挟んだ瞬間に TOCTOU が復活し、同じ tick の 2 本目以降が全部素通りする（上記 JSDoc が正）。
    const requestId = nextChatSendRequestId++;
    let settle: (payload: { ok: boolean; reason?: string } | null) => void =
      () => {};
    const settled = new Promise<{ ok: boolean; reason?: string } | null>(
      // ⚠ executor は**同期に**走るので、下の代入の時点で `settle` は既に resolve に入っている。
      (resolve) => {
        settle = resolve;
      },
    );
    pendingChatSend = { requestId, settle };
    // ⚠⚠⚠ 解放経路 3: **予約の直後**に張る（`invoke` が返らなくても有限時間で必ず解ける）。
    //   ⚠ **送出の直前へ戻さないこと**——戻すとチケット取得が固まった瞬間に恒久ロックになる。
    const timer = window.setTimeout(() => {
      if (pendingChatSend?.requestId === requestId) pendingChatSend = null;
      settle(null);
    }, CHAT_SEND_TIMEOUT_MS);
    // ⚠⚠ 解放経路 1: 予約を手放す。**自分の予約のときだけ**消す
    //   （`onclose` が先に `null` にしていることがあり、確かめずに消すと他人の予約を巻き添えにする）。
    const release = (): void => {
      window.clearTimeout(timer);
      if (pendingChatSend?.requestId === requestId) pendingChatSend = null;
    };

    // ⚠⚠ チケットは**送信のたびに取り直す**（握ったまま使い回すと再起動後に黙って無視される）。
    //   ⚠ 値はログにも画面にも出さない（§9）。⚠⚠⚠ **S-1 の修正でもこの規律は変えていない。**
    let ticket: string | null = null;
    try {
      ticket = await invoke<string | null>("get_chat_send_ticket");
    } catch {
      ticket = null;
    }
    if (ticket === null) {
      release();
      return { ok: false, reason: "コメントの取得に接続していません。" };
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      release();
      return { ok: false, reason: "コメントの取得に接続していません。" };
    }
    // ⚠⚠ 待っているあいだに予約が解けていたら（切断・タイムアウト）**フレームを出さない**——
    //   出しても結果は `requestId` 不一致で捨てられるだけで、sidecar のスロットル枠を無駄に食う。
    if (pendingChatSend?.requestId !== requestId) {
      release();
      return { ok: false, reason: "送信の結果を確認できませんでした。" };
    }

    send({
      type: CHAT_SEND_FRAME,
      ticket,
      requestId,
      message,
      // ⚠⚠⚠ S-2b: **宛先ではなく期待値**（sidecar が実際の宛先と突き合わせる）。
      expectedChannel: expectedChannel.trim(),
    });
    const payload = await settled;
    window.clearTimeout(timer);
    // ⚠⚠ **応答が無いときは成功へ倒さない**（「送れたか分からない」を「送れた」と出さない）。
    return payload ?? { ok: false, reason: "送信の結果を確認できませんでした。" };
  };

  /**
   * 066 段 2: **取得セッション制御の送信を「呼ばれた順」に直列化する鎖。**
   *
   * ⚠⚠⚠ **これは段 2 が持ち込んだ回帰の返済である**（自 security-review・2026-08-23）。
   * 段 2 以前の `startSession` / `stopSession` は**同期送信**だったので順序は自明だった。
   * チケット取得（`await invoke`）を挟んだことで、
   * **「取得開始」→ すぐ「停止」と押したとき、2 本の `invoke` の解決順が入れ替わりうる**
   * ⇒ ⚠⚠ **停止したのに取得が始まる**（ユーザーの**最後の**意思が消える）。
   * ⚠ 実測で再現した（1 本目のチケット取得だけ遅らせると `stop` → `start` の順で届く）。
   *
   * ⚠ **`sendChat` の「同時 1 本なら拒否」方式を採らない理由**＝あちらは
   * **落としてよい操作**（理由を返せば済む）だが、こちらは
   * **落とすと「押したのに効かない」になる**（061a Q-1）。⇒ **拒否ではなく順番待ちにする。**
   *
   * ## ⚠⚠⚠ レビュー S-1（修正）: 鎖のリンクは**必ず有限時間で settle** しなければならない
   *
   * 順番待ちにした代償として、**1 本が永久に settle しないと以後どの取得開始／停止も実行されない**
   * （`.then()` の待ち行列に積まれるだけ）。⚠⚠ しかも呼び出し側の `await` も返らないので
   * **`reportSessionControl` が走らず、画面に理由すら出ない**——
   * ⚠⚠⚠ **穴 C が名指しした「押したのに何も起きない、原因不明」そのもの**である。
   * ⚠⚠⚠ **063f 段 2-a 訂正: 「`sendChat` にこの失敗モードは無い（ガードが `invoke` の後だから）」は
   * もう成立しない。** あちらは S-1 の修正で**予約を `invoke` の前へ移した**ので、
   * **固まると後続が素通りできなくなった**（＝同じ失敗モードを持つようになった）。
   * ⚠ ただし**あちらは [`CHAT_SEND_TIMEOUT_MS`] のタイマーを予約の直後に張って有限時間で必ず解く**
   * のに対し、**鎖はリンクが settle しない限り永久に詰まる**——
   * ⇒ **「無い」から「縛ってある」へ変わっただけで、こちらの対処が要る理由は 1 ミリも変わらない。**
   * ⇒ **対処＝チケット取得に [`SESSION_CONTROL_TICKET_TIMEOUT_MS`] を掛ける**
   * （下記 [`sendSessionControlNow`]）。⚠ **鎖を外して直さないこと**（順序が壊れる＝ S-3 の再来）。
   */
  let sessionControlChain: Promise<unknown> = Promise.resolve();

  /**
   * 066 段 2: **取得セッションの制御フレーム（`start-session` / `stop-session`）を 1 本送る。**
   *
   * ⚠⚠ **チケットは操作のたびに取り直す**（sidecar が再 spawn されると値が変わるので、
   * 握ったまま使い回すと**再起動後に黙って無視される**）。060c / 066 段 1 と同じ規律。
   * ⚠ 値はログにも画面にも出さない（§9）。
   *
   * ⚠⚠⚠ **失敗は必ず理由つきで返す**（穴 C）。sidecar 側はチケット不一致を黙殺するので、
   * **正規の窓が黙殺される状況をこちら側に 1 つも残さない**のがこの関数の役目である。
   *
   * ⚠ **`await invoke` を挟むので、その前後で WS の状態を 2 回見る**（`sendChat` と同じ作法）。
   * 挟んでいる間に切断されうるため、後段の検査を省くと**閉じたソケットへ送って黙って消える**。
   *
   * ⚠⚠⚠ **レビュー S-1（修正）: `invoke` は必ずタイムアウトさせる。**
   * settle しない `invoke` を待つと [`sessionControlChain`] が永久に詰まる（あちらの JSDoc が正）。
   */
  const sendSessionControlNow = async (
    frame: SessionControlOutgoingFrame,
  ): Promise<SessionControlResult> => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { ok: false, reason: SESSION_CONTROL_UNAVAILABLE_REASON };
    }
    let ticket: string | null = null;
    // ⚠⚠ **タイムアウトは「取れなかった」へ倒す**（超過しても必ず settle する＝鎖が進む）。
    //   ⚠ タイマーは必ず片付ける（残すとテストの fake timer と実行環境の両方でゴミが残る）。
    let ticketTimer: number | undefined;
    try {
      ticket = await Promise.race([
        invoke<string | null>("get_session_control_ticket"),
        new Promise<null>((resolve) => {
          ticketTimer = window.setTimeout(
            () => resolve(null),
            SESSION_CONTROL_TICKET_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      ticket = null;
    } finally {
      if (ticketTimer !== undefined) window.clearTimeout(ticketTimer);
    }
    if (ticket === null) {
      return { ok: false, reason: SESSION_CONTROL_UNAVAILABLE_REASON };
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { ok: false, reason: SESSION_CONTROL_UNAVAILABLE_REASON };
    }
    send({ ...frame, ticket });
    // ⚠⚠ **ここは「送れた」までしか言わない**（取得が始まったかは `session.state` が持つ）。
    return { ok: true };
  };

  /**
   * 066 段 2: [`sendSessionControlNow`] を [`sessionControlChain`] に並べて**呼ばれた順**に流す。
   *
   * ⚠ **`ticket` を上書きされないよう、スプレッドの最後に置くこと**（[`sendSessionControlNow`] 内）。
   * ⚠⚠ [`SessionControlOutgoingFrame`] に `ticket` を含めていないので、**呼び出し側からは渡せない**
   * ＝スプレッド順への依存が**型で担保**されている（レビュー Q-4 の修正）。
   * ⚠⚠ **鎖に reject を持ち越さない**——1 本が失敗しても後続を止めない
   * （止めると「一度失敗したら以後ずっと押しても効かない」になる。⚠ 実際には
   * `sendSessionControlNow` は throw しない設計だが、**鎖の性質として**塞いでおく）。
   * ⚠⚠⚠ **この `.catch` が塞ぐのは reject だけで、「settle しない」は塞げない。**
   * そちらは [`SESSION_CONTROL_TICKET_TIMEOUT_MS`] が塞いでいる（レビュー S-1）。
   * ⚠ **`.catch` があるから鎖は安全、と読まないこと**——**2 つ揃って**初めて鎖が必ず進む。
   */
  const sendSessionControl = (
    frame: SessionControlOutgoingFrame,
  ): Promise<SessionControlResult> => {
    const run = sessionControlChain.then(() => sendSessionControlNow(frame));
    sessionControlChain = run.catch(() => undefined);
    return run;
  };

  return {
    disconnect(): void {
      closed = true;
      clearRetry();
      if (ws) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
        ws = null;
      }
    },
    startLogin(service?: CommentService): void {
      send({ type: "start-login", ...(service ? { service } : {}) });
    },
    startSession(
      service: CommentService,
      channel?: string,
    ): Promise<SessionControlResult> {
      return sendSessionControl({
        type: "start-session",
        service,
        ...(channel ? { channel } : {}),
      });
    },
    stopSession(service: CommentService): Promise<SessionControlResult> {
      return sendSessionControl({ type: "stop-session", service });
    },
    enableObs(port: number, overlay: ObsOverlayKind): void {
      send({ type: "obs-enable", port, overlay });
    },
    listObsSources(port: number): void {
      send({ type: "obs-list-sources", port });
    },
    fireObsSource(port: number, sourceName: string, durationMs: number): void {
      // ⚠ 整形も検証もここではしない（**検証の持ち主は sidecar 側 1 か所**＝規則が 2 か所に割れない）。
      send({ type: "obs-fire-source", port, sourceName, durationMs });
    },
    hideObs(port: number, overlay: ObsOverlayKind): void {
      send({ type: "obs-hide", port, overlay });
    },
    disableObs(): void {
      send({ type: "obs-disable" });
    },
    sendChat(
      message: string,
      expectedChannel: string,
    ): Promise<{ ok: boolean; reason?: string }> {
      // ⚠ 検証も整形もここではしない（**検証の持ち主は sidecar 側 1 か所**＝規則が 2 か所に割れない。
      //   `fireObsSource` とまったく同じ規律）。
      return sendChat(message, expectedChannel);
    },
    async requestThemeImport(
      url: string,
      maxBytes: number,
    ): Promise<ThemeImportFetchResult> {
      const payload = await requestThemeAsset(
        THEME_IMPORT_FETCH_FRAME,
        THEME_IMPORT_RESULT_FRAME,
        url,
        maxBytes,
        THEME_IMPORT_TIMEOUT_MS,
      );
      if (payload === null) return { ok: false, reason: "offline" };
      if (payload.ok === true && typeof payload.css === "string") {
        return { ok: true, css: payload.css };
      }
      return {
        ok: false,
        reason: typeof payload.reason === "string" ? payload.reason : "network",
      };
    },
    async requestThemeFont(
      url: string,
      maxBytes: number,
    ): Promise<ThemeFontFetchResult> {
      const payload = await requestThemeAsset(
        THEME_FONT_FETCH_FRAME,
        THEME_FONT_RESULT_FRAME,
        url,
        maxBytes,
        THEME_FONT_TIMEOUT_MS,
      );
      if (payload === null) return { ok: false, reason: "offline" };
      // ⚠⚠ **`mime` も `base64` も sidecar 由来のものだけを通す。** 片方でも欠けていたら失敗扱いにする
      // （欠けたまま `data:` を組むと、型の無い data URI や空フォントが CSS に混ざる）。
      if (
        payload.ok === true &&
        typeof payload.mime === "string" &&
        typeof payload.base64 === "string"
      ) {
        return { ok: true, mime: payload.mime, base64: payload.base64 };
      }
      return {
        ok: false,
        reason: typeof payload.reason === "string" ? payload.reason : "network",
      };
    },
  };
}
