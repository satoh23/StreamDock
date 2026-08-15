// 044a: OBS 連携（方式A＝ウィンドウキャプチャ自動追加）の sidecar 側クライアント。
//
// オーバーレイ ON かつ OBS 連携が有効なとき、obs-websocket v5 で OBS に接続し、透過オーバーレイ窓
// 「StreamDock コメントオーバーレイ」を「ウィンドウキャプチャ」ソースとして**自動追加（既存なら再利用）**する。
// 044s スパイクで方式A を実測決定（B＝ブラウザソースは当該環境で未描画・不採用）。
//
// セキュリティ（docs/security.md §1/§9・fail-closed 二層）:
//   - 宛先は **loopback のみ**。URL は `ws://127.0.0.1:${port}`（`127.0.0.1` はコード定数＝ホストピン留め）で組み、
//     接続直前に host-guard の `assertAllowedObsUrl()` を必ず通す（他ホスト/非 ws/userinfo は throw）。
//     obs-websocket-js は isomorphic-ws→`ws` を使い global WebSocket を通らないため、この2層で loopback 限定を担保する。
//   - パスワードは **in-memory のみ**（Rust→stdin private pipe で受領＝loopback WS には載せない・ログにも出さない）。
//     認証が無効な OBS では password 無しで接続する。
//   - 取得も配信もしない（OBS へソースを1つ作るだけ）。外部インターネット通信は増やさない。
//
// 接続方針: **オンデマンド接続**（enable のたびに connect→ソース確保→disconnect）。ソースは一度作れば OBS 側に
// 残り、こちらの接続は不要になるため常時接続は張らない（loopback ソケットの寿命も最小化）。失敗後の**接続リトライ
// ループは張らない**（再接続はユーザーのトグル操作＝hot-loop しない）。ただし窓が OBS の一覧に載るまでの遅延は
// 1 回の enable 内で**有界リトライ**する（frontend の固定遅延に依存しない・M1）。失敗は graceful に onState("failed", reason)。
import OBSWebSocket from "obs-websocket-js";
import { assertAllowedObsUrl } from "../host-guard.js";
// 044a: 純ヘルパ（obs-websocket 非依存）は別 module に分離し単体テスト対象にする（scripts/test-obs-client.mjs）。
import {
  safeReason,
  parseMacWindowItemName,
  isWgcMethodName,
  // 064a: ユーザーが OBS 側に作ったソースを鳴らすための入口検査（純関数）。
  isAllowedObsSourceName,
  clampObsFireDurationMs,
  resolveObsFireDurationMs,
} from "./obs-helpers.js";

/** OBS 連携の状態（viewer へ通知して UI に反映する）。 */
export type ObsState =
  | "idle" // 未接続 / 連携 OFF
  | "connecting" // 接続試行中
  | "added" // ソースを新規作成した
  | "reused" // 既存ソースを再利用した
  | "failed"; // 接続/作成に失敗（手動手順へフォールバック）

export type ObsStateListener = (state: ObsState, reason?: string) => void;

/**
 * 046d: 自動追加の対象オーバーレイ種別。**viewer から任意の名前を受け取らない**ための固定 union で、
 * 実際のソース名／窓名は下の `OBS_OVERLAYS` に閉じてある（§3/§8＝ユーザー入力が OBS 操作へ渡る経路を作らない）。
 * 061a: 3 本目 `"effects"`（エフェクト専用オーバーレイ窓）を追加。
 * ⚠⚠ **064d でその `"effects"` を削除した**——コーナー窓は**取り込んだテンプレート専用**で、
 * 064 の方針転換（エフェクトは OBS 側のソースを鳴らす）で窓ごと廃止したため。
 * 061k: 4 本目 `"stage"`（全画面／ステージ側の出力窓）を追加。⚠ 064d 以降**これが唯一のエフェクト系の窓**。
 * ⚠⚠ **この union は desktop 側（`features/comment-viewer/commentStream.ts`）と人手で同期している。**
 * WS 境界で型が失われるのでずれても typecheck では気付けず、実害は
 * 「desktop が送った種別を下の `parseOverlayKind` が `"comments"` へ落とす」＝
 * **誤った窓のソースが OBS に作られる**という静かな方向に出る（Rust の
 * `obs_overlay_kind_union_matches_between_sidecar_and_desktop` が両側を突き合わせて止めている）。
 */
export type ObsOverlayKind = "comments" | "pinned" | "stage";

/**
 * オーバーレイ種別ごとの「OBS に作るソース名」と「キャプチャ対象の窓名」。
 * ソース名は窓名に一致させる（ユーザーが OBS 上で対応を見て分かるようにする・044a からの慣習）。
 *
 * 窓名は Rust の窓タイトルと**バイト一致**させること:
 *   comments → `open_comment_overlay_window` の `.title`（033f）
 *   pinned   → `open_pinned_overlay_window` の `.title`（046b）
 *   stage    → `open_stage_overlay_window` の `.title`（061k）
 * 候補一致は `includes` なので、**どれかが他を部分文字列として含んではいけない**
 * （3 つとも相互に含まないことを実測済み。Rust 側 `overlay_window_contract` が総当たりで固定している）。
 * ⚠⚠ **061k で "StreamDock エフェクト（全画面）" を採らなかったのはこの制約のため**
 * （当時あった `effects` を部分文字列として含むと、ステージ用のソースがエフェクト窓を掴む）。
 * ⚠ 064d で `effects` は消えたが、**この制約は残る**（名前を足すときは必ず総当たりを確認すること）。
 *
 * ⚠ **export しているのはテストのため**（`scripts/test-obs-client.mjs`）。046d までは module-private で、
 * その結果「3 つが `includes` で紛れないこと」を検証する対象がどこにも公開されておらず、
 * **窓名の衝突を TS 側から確かめる手段がゼロ**だった（061a で解消）。
 *
 * ⚠⚠ 061a レビュー（Q-6）: **`Object.freeze` で読み取り専用を構造にした**（061a 時点は「書き換えはしない」と
 * コメントで宣言していただけ）。export した以上どのモジュールからも書き換えられる状態で、この表は
 * ①`parseOverlayKind` の allow-list の導出元（＝境界検証そのもの）②OBS のソース名／窓名の唯一の出所、
 * という二重の役割を持つため、宣言ではなく制約にしておく。`Readonly` は型の話（コンパイル時のみ）で、
 * 実行時に止めるのは `Object.freeze` の方＝**両方要る**。
 */
export const OBS_OVERLAYS: Readonly<
  Record<ObsOverlayKind, Readonly<{ sourceName: string; windowTitle: string }>>
> = Object.freeze({
  comments: Object.freeze({
    sourceName: "StreamDock コメントオーバーレイ",
    windowTitle: "StreamDock コメントオーバーレイ",
  }),
  pinned: Object.freeze({
    sourceName: "StreamDock 固定コメント",
    windowTitle: "StreamDock 固定コメント",
  }),
  stage: Object.freeze({
    sourceName: "StreamDock ステージ演出",
    windowTitle: "StreamDock ステージ演出",
  }),
});

/**
 * 061a: 受理する種別の allow-list。**`OBS_OVERLAYS` から導出する**ので、表に足せば自動的に受理される
 * （＝「表を増やしたのに検証側を更新し忘れる」が構造的に起きない）。
 */
export const OBS_OVERLAY_KINDS: readonly ObsOverlayKind[] = Object.keys(
  OBS_OVERLAYS,
) as ObsOverlayKind[];

/**
 * 046d/061a: 制御フレームの `overlay` フィールドを `ObsOverlayKind` へ正規化する。**allow-list 方式**で、
 * 既知の値以外はすべて既定 `"comments"` に落とす（未指定＝044a 時点の viewer からのフレーム＝後方互換）。
 * 任意文字列がソース名/窓名として OBS へ渡る経路は作らない（§3/§8）。
 *
 * ⚠⚠ **これは「信頼できない JSON（loopback WS の制御フレーム）が最初に入ってくる境界」に置かれた
 * 実質的なセキュリティ制御**で、TypeScript の型はここでは何も守らない（引数は `JSON.parse` 由来の `unknown`）。
 *
 * ⚠⚠ **照合は「`Object.keys` の配列に対する `includes`」でなければならない。**
 * `v in OBS_OVERLAYS` や `OBS_OVERLAYS[v] !== undefined` にすると、`"__proto__"` / `"constructor"` /
 * `"toString"` が**プロトタイプ経由で真になり fail-open する**（`OBS_OVERLAYS["__proto__"]` は
 * Object.prototype を返す）。`scripts/test-obs-client.mjs` がこの 3 つを名指しで固定している。
 *
 * ⚠ **061a で `index.ts` からここへ移した。** 046d の JSDoc は移動先として `obs/obs-helpers.ts` を
 * 予告していたが、allow-list を**表から導出する**形にするには表と同居している必要がある
 * （helpers へ移すと表も一緒に動かすことになり、Rust の `overlay_window_contract` が
 * `include_str!` する先まで変わる）。副産物として **`obs-helpers.ts` は差分ゼロ**を維持できている
 * ＝ 044a/046d の fail-closed 層に手を入れていないことの担保が続く。
 * 移した動機は 046d の JSDoc が挙げていた再修正トリガー①そのもの——`index.ts` は top-level で `main()` を
 * 呼ぶ＝**import すると sidecar が起動する**ためテスト不能で、3 つ目の値を足すと三項演算子で書けなくなる。
 */
export function parseOverlayKind(v: unknown): ObsOverlayKind {
  return typeof v === "string" &&
    (OBS_OVERLAY_KINDS as readonly string[]).includes(v)
    ? (v as ObsOverlayKind)
    : "comments";
}

/** obs-websocket 接続の timeout（ミリ秒）。未起動/無効は速やかに graceful 失敗させる。 */
const CONNECT_TIMEOUT_MS = 4000;
/** ホストは loopback にピン留め（ユーザー/viewer からの host 指定は受けない）。ポートのみ検出値で可変。 */
const OBS_HOST = "127.0.0.1";
/** 窓候補が OBS の「ウィンドウ一覧」に載るまでのリトライ回数（開いた直後は載らないことがあるため・M1）。 */
const WINDOW_LOOKUP_RETRIES = 5;
/** 窓候補リトライの間隔（ミリ秒）。5 回 × 300ms ≒ 最大 1.2s 待ってから未検出と判断する。 */
const WINDOW_LOOKUP_INTERVAL_MS = 300;

/** 指定ミリ秒だけ待つ（窓候補リトライの間隔用）。 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ObsClient {
  /** Rust→stdin で受領した OBS WebSocket パスワードを in-memory に設定（null で破棄）。 */
  setPassword(password: string | null): void;
  /** OBS 連携を有効化し、指定ポートの OBS へ**種別ごとの**ソースを自動追加（既存なら再利用）＋表示する。 */
  enable(port: number, overlay: ObsOverlayKind): Promise<void>;
  /** オーバーレイ表示 OFF 時: 該当種別の OBS 側ソースを**削除せず非表示**にする（best-effort・ON で enable が再表示）。 */
  hide(port: number, overlay: ObsOverlayKind): Promise<void>;
  /** 連携 OFF（状態を idle に戻す・OBS 側ソースは消さない）。 */
  disable(): void;
  /**
   * 064a: **OBS に既にあるソースのうち、エフェクトとして鳴らせるものの一覧**を返す。
   *
   * ⚠ 失敗（未起動・認証失敗等）でも throw しない（[`ObsSourceListResult`] の `ok:false`）。
   * ⚠⚠ **064c で戻り値に `ok` が付いた**——理由の全文は [`ObsSourceListResult`] の JSDoc が正。
   */
  listSources(port: number): Promise<ObsSourceListResult>;
  /**
   * 064a: 指定ソースを**頭出しして表示し、`durationMs` 後に非表示へ戻す**。
   * ⚠ 戻り値は「出せたか」。失敗理由は `onState("failed", …)` で伝える。
   */
  fireSource(
    port: number,
    sourceName: string,
    durationMs: number,
  ): Promise<boolean>;
}

/**
 * 064a: エフェクトとして鳴らせる OBS ソース 1 件。
 *
 * ⚠ **返すのは名前と種別だけ**（設定値・ファイルパスは 1 つも持ち帰らない）。
 * ユーザーのローカルパスが viewer へ渡る経路を作らないため（§9）。
 */
export interface ObsSourceInfo {
  name: string;
  kind: ObsSourceKind;
}

/**
 * 064c: [`ObsClient.listSources`] の結果。
 *
 * ## ⚠⚠ なぜ `ok` が要るのか（064c の中心）
 *
 * 064a は失敗も成功も**空配列**で返していた。その結果 main 窓では
 * 「**OBS に繋がらなかった**」と「**繋がったが鳴らせるソースが 0 件**」が区別できず、
 * OBS が起動していないだけのユーザーへ
 * 「OBS のシーンに『メディアソース』か『画像』を追加してください」という
 * **間違った対処**を案内していた（061a レビュー Q-1 と同じ失敗モードの 3 度目）。
 *
 * ⚠ **`onState("failed", …)` では代替できない。** あちらは comments / pinned / stage と
 * **共有**の状態通知で、「固定コメントの自動追加が失敗した」のか
 * 「一覧が取れなかった」のかを受け手が判別できない（061e レビュー Q-5 が受容している限界）。
 * ⇒ **一覧要求への直接の返事**にだけ載せるのが正しい。
 *
 * ⚠ `ok:false` のときの `sources` は**必ず空**（部分的に取れた一覧を返す経路は無い）。
 */
export interface ObsSourceListResult {
  /** `true` ＝ OBS へ繋がって一覧を取れた（0 件でも `true`）。`false` ＝ 取れなかった。 */
  ok: boolean;
  sources: ObsSourceInfo[];
}

/**
 * 064a: **鳴らしてよいソース種別**（allow-list）。
 *
 * - `ffmpeg_source` … OBS の「メディアソース」（mp4 / mov / webm …）。⚠ **頭出しができる唯一の種別**。
 * - `image_source` … 「画像」（png / gif …）。頭出しの概念が無いので表示/非表示だけ。
 *
 * ⚠⚠ **`browser_source` を足さないこと**（064a の判断）。他ツールの HTML エフェクトを OBS 経由で
 * 鳴らせるようになる魅力はあるが、**頭出しの手段が別 API（`PressInputPropertiesButton`）**になり、
 * 操作面が 1 つ増える。⚠ **再修正トリガー＝「ブラウザソースを鳴らしたい」と言われたとき**
 * （そのとき §3 の再評価と security-review を行うこと）。
 * ⚠ 一覧にも出さない＝**ユーザーが選べるのは、ここに載っている種別だけ**である。
 */
const FIREABLE_SOURCE_KINDS = ["ffmpeg_source", "image_source"] as const;
export type ObsSourceKind = (typeof FIREABLE_SOURCE_KINDS)[number];

/**
 * 064c: **`GetInputList` の結果を [`ObsSourceListResult`] へ落とす**（＝一覧が取れたときの唯一の作り方）。
 *
 * ⚠⚠ **`ok` が必ず `true` であることがこの関数の意味である。** ここへ来ているということは
 * **OBS へ繋がって `GetInputList` が返った**ということなので、**絞り込んだ結果が 0 件でも `ok:true`**。
 * ⇒ main 窓は「OBS のシーンにソースを追加してください」を出す（「OBS を起動して」ではなく）。
 * ⚠ **`ok:false` を返してよいのは接続に辿り着けなかったときだけ**（`listSources` の `catch`）。
 *
 * ⚠ **純関数として切り出してある理由**＝ [`listSources`] 本体は OBS への実接続を要するので
 * `test-obs-client.mjs` から呼べない。**allow-list による絞り込みと「0 件でも `ok:true`」**という
 * 064c の核心だけは、実機を待たずに固定できるようにしておく。
 */
export function toObsSourceListResult(
  inputs: readonly unknown[],
): ObsSourceListResult {
  return {
    ok: true,
    // ⚠ 名前と種別だけを取り出す（設定値やファイルパスは持ち帰らない・§9）。
    sources: inputs
      .map(toFireableSource)
      .filter((s): s is ObsSourceInfo => s !== null),
  };
}

/** `GetInputList` の 1 件を [`ObsSourceInfo`] に落とす（許可外の種別は `null`）。 */
function toFireableSource(input: unknown): ObsSourceInfo | null {
  if (typeof input !== "object" || input === null) return null;
  const { inputName, inputKind } = input as {
    inputName?: unknown;
    inputKind?: unknown;
  };
  if (!isAllowedObsSourceName(inputName)) return null;
  const kind = FIREABLE_SOURCE_KINDS.find((k) => k === inputKind);
  return kind === undefined ? null : { name: inputName.trim(), kind };
}

/** connect を timeout 付きで行う（未起動/無効を速やかに graceful 失敗へ）。 */
async function connectWithTimeout(
  obs: OBSWebSocket,
  url: string,
  password: string | null,
): Promise<void> {
  // L3: connect が先に解決したら timeout タイマを片付ける（残タイマが後から解決済み Promise を reject しないよう）。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`)),
      CONNECT_TIMEOUT_MS,
    );
  });
  // password が空/未設定なら undefined を渡し認証ハンドシェイクをスキップ（認証無効の OBS 用）。
  try {
    await Promise.race([
      obs.connect(url, password || undefined, { rpcVersion: 1 }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * OBS の "window" プロパティ候補から透過オーバーレイ窓を探す。開いた直後は一覧に載らないことがあるため、
 * 載るまで有界リトライ（WINDOW_LOOKUP_RETRIES 回）する（M1）。見つからなければ null（呼び出し側でフォールバック）。
 */
async function findOverlayWindowItem(obs: OBSWebSocket, kind: ObsOverlayKind) {
  const { sourceName, windowTitle } = OBS_OVERLAYS[kind];
  for (let attempt = 0; attempt < WINDOW_LOOKUP_RETRIES; attempt++) {
    const { propertyItems } = await obs.call(
      "GetInputPropertiesListPropertyItems",
      { inputName: sourceName, propertyName: "window" },
    );
    const overlay = propertyItems.find((it) => {
      const name = it.itemName;
      return typeof name === "string" && name.includes(windowTitle);
    });
    if (overlay) return overlay;
    if (attempt < WINDOW_LOOKUP_RETRIES - 1) {
      await sleep(WINDOW_LOOKUP_INTERVAL_MS);
    }
  }
  return null;
}

/**
 * 現在シーンに種別ごとのウィンドウキャプチャを作成/再利用し、対応する透過オーバーレイ窓をターゲットにする。
 * 046d: `kind` ごとに**別ソース**を作る（コメント一覧と固定コメントは OBS 上でも独立したソースになる）。
 * @returns 新規作成なら "added"、既存再利用なら "reused"。
 */
async function ensureOverlaySource(
  obs: OBSWebSocket,
  kind: ObsOverlayKind,
): Promise<ObsState> {
  const { sourceName } = OBS_OVERLAYS[kind];
  const isWindows = process.platform === "win32";
  const inputKind = "window_capture"; // 044s 実測: mac/win とも window_capture が存在

  const { currentProgramSceneName } = await obs.call("GetSceneList");
  const { inputs } = await obs.call("GetInputList");
  const exists = inputs.some((i) => i.inputName === sourceName);

  if (!exists) {
    await obs.call("CreateInput", {
      sceneName: currentProgramSceneName,
      inputName: sourceName,
      inputKind,
      inputSettings: {},
      sceneItemEnabled: true,
    });
  }

  // ウィンドウ候補から透過オーバーレイ窓を探して設定する（OS 依存の窓指定）。開いた直後は OBS の一覧に載らない
  // ことがあるため、findOverlayWindowItem が有界リトライで載るまで待つ（frontend 固定遅延に依存しない・M1）。
  const overlay = await findOverlayWindowItem(obs, kind);
  if (!overlay) {
    // M2: 既存ソースを再利用する場合は、過去に設定済みの窓指定を維持して "reused" を返す（一時的な未列挙で
    // 成功済みソースを failed 表示にしない）。新規作成直後の未検出は対象未設定＝手動誘導へフォールバック。
    if (exists) return "reused";
    throw new Error(
      "オーバーレイ窓が見つかりません（先にオーバーレイを表示してください）",
    );
  }

  if (isWindows) {
    // Windows: itemValue は "title:class:exe" 文字列。透過窓は既定「自動」だと真っ黒になるため
    // キャプチャ方法を WGC（Windows 10 1903 以降）に自動設定する（044a 追加2）。
    // method の実 enum は 098 VM で確認（想定 2）。候補名から 1903/WGC を含む項目の itemValue を優先採用し、
    // 見つからなければ 2 にフォールバックする（実 enum 差に堅くする）。要 098 実機検証。
    // Windows では常にキャプチャ方法を設定する（pickWgcMethodValue は必ず数値を返す・下記 JSDoc）。
    const method = await pickWgcMethodValue(obs, kind);
    await obs.call("SetInputSettings", {
      inputName: sourceName,
      inputSettings: {
        window: overlay.itemValue,
        method,
      },
    });
  } else {
    // macOS: 設定は {owner_name, window_name, window(数値ID)}。数値 ID は起動毎に変わるため
    // 安定キー owner_name/window_name を itemName "[owner] title" から取り出して併設する（044s 実測）。
    const { ownerName, windowName } = parseMacWindowItemName(overlay.itemName);
    await obs.call("SetInputSettings", {
      inputName: sourceName,
      inputSettings: {
        window: overlay.itemValue,
        ...(ownerName ? { owner_name: ownerName } : {}),
        ...(windowName ? { window_name: windowName } : {}),
      },
    });
  }

  return exists ? "reused" : "added";
}

/**
 * Windows の window_capture「キャプチャ方法」プロパティから WGC（Windows 10 1903 以降）の値を選ぶ。
 * L1: 透過窓は既定「自動」だと黒くなるため Windows では**常に**キャプチャ方法を設定する方針。よって取得不能・
 * 非該当でも null は返さず既定 2（一般的な WGC enum）にフォールバックする。要 098 実機検証（"method" 名/enum を確定）。
 */
async function pickWgcMethodValue(
  obs: OBSWebSocket,
  kind: ObsOverlayKind,
): Promise<number> {
  try {
    const { propertyItems } = await obs.call(
      "GetInputPropertiesListPropertyItems",
      { inputName: OBS_OVERLAYS[kind].sourceName, propertyName: "method" },
    );
    const wgc = propertyItems.find((it) => isWgcMethodName(it.itemName));
    if (wgc && typeof wgc.itemValue === "number") return wgc.itemValue;
  } catch {
    // "method" プロパティが無い/取得不可な OBS もある。フォールバックへ。
  }
  return 2; // 一般的な WGC の enum（要 098 確認）。
}

/**
 * 作成/再利用したオーバーレイソースの scene item を現在シーンで表示/非表示する（**削除はしない**）。
 * `GetSceneItemId` で sceneItemId を引き `SetSceneItemEnabled` で切り替える。現在シーンに該当ソースが無い等は
 * throw するため、呼び出し側で握りつぶす（best-effort）。宛先は enable と同じ loopback WS で外部宛先は増やさない。
 */
async function setOverlaySceneItemEnabled(
  obs: OBSWebSocket,
  kind: ObsOverlayKind,
  enabled: boolean,
): Promise<void> {
  const { currentProgramSceneName } = await obs.call("GetSceneList");
  const { sceneItemId } = await obs.call("GetSceneItemId", {
    sceneName: currentProgramSceneName,
    sourceName: OBS_OVERLAYS[kind].sourceName,
  });
  await obs.call("SetSceneItemEnabled", {
    sceneName: currentProgramSceneName,
    sceneItemId,
    sceneItemEnabled: enabled,
  });
}

export function createObsClient(onState: ObsStateListener): ObsClient {
  let password: string | null = null;
  /**
   * 064a: **出したソースを消す予定**（ソース名 → タイマーと接続の後始末）。
   *
   * ⚠⚠ **「消し忘れ」＝配信画面に出しっぱなし**がこの機能で最悪の壊れ方なので、
   * 予定は必ずここに載せ、**同じソースの再発火では前の予定を捨ててから張り直す**。
   * ⚠ プロセスが落ちれば OBS 側は表示のままだが、それは**ユーザーが OBS で消せる**
   * （StreamDock が作ったソースではなくユーザー自身のソースなので、見つけられる）。
   */
  const pendingHides = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; close: () => Promise<void> }
  >();

  return {
    setPassword(next: string | null): void {
      password = next && next.length > 0 ? next : null;
    },

    // L5(修正不要): enable は index.ts から fire-and-forget で呼ばれ、連打時は多重発火し得るが、毎回独立の
    // OBSWebSocket インスタンスで完結し共有状態を壊さない（in-memory password は読み取りのみ）。よって排他は
    // 設けない。再修正トリガー: 同時接続が OBS 側でエラーや二重ソース作成を招くなら in-flight フラグで抑止する。
    async enable(port: number, overlay: ObsOverlayKind): Promise<void> {
      const url = `ws://${OBS_HOST}:${port}`;
      // fail-closed: loopback 以外・非 ws・userinfo・ポート不正は throw（ホストピン留めの二層目）。
      try {
        assertAllowedObsUrl(url);
      } catch {
        onState("failed", "OBS の接続先が不正です");
        return;
      }
      onState("connecting");
      const obs = new OBSWebSocket();
      try {
        await connectWithTimeout(obs, url, password);
        const result = await ensureOverlaySource(obs, overlay);
        // reuse 時に前回の非表示を確実に戻す（新規作成は sceneItemEnabled:true と冪等）。失敗は無視（現在シーンに無い等）。
        await setOverlaySceneItemEnabled(obs, overlay, true).catch(() => {});
        onState(result);
      } catch (err) {
        // OBS 未起動 / WS 無効 / 認証失敗 / 窓未検出 等はすべて graceful に失敗通知（hot-loop しない）。
        onState("failed", safeReason(err, "OBS に接続できませんでした"));
      } finally {
        await obs.disconnect().catch(() => {});
      }
    },

    // 044a: オーバーレイ表示 OFF 時に OBS 側ソースを**削除せず非表示**にする（ON で enable が再表示）。
    // best-effort＝成功/該当なし/失敗いずれも idle に落とし、技術的な失敗メッセージ（failed）は出さない。
    async hide(port: number, overlay: ObsOverlayKind): Promise<void> {
      const url = `ws://${OBS_HOST}:${port}`;
      try {
        assertAllowedObsUrl(url);
      } catch {
        onState("idle");
        return;
      }
      const obs = new OBSWebSocket();
      try {
        await connectWithTimeout(obs, url, password);
        await setOverlaySceneItemEnabled(obs, overlay, false);
      } catch {
        // OBS 未起動 / ソース未作成 / 現在シーンに無い等はすべて無視（非表示は best-effort・hot-loop しない）。
      } finally {
        await obs.disconnect().catch(() => {});
        onState("idle");
      }
    },

    disable(): void {
      onState("idle");
    },

    /**
     * 064a: 鳴らせるソースの一覧（`GetInputList` → allow-list で絞る）。
     *
     * ⚠ **オンデマンド接続のまま**（`enable` / `hide` と同じ作法）。一覧の取得は
     * **ユーザーがボタンを押した瞬間だけ**なので、常時接続にする理由が無い。
     * ⚠⚠ **発火（`fireSource`）は本来オンデマンドでは遅い**（接続 1 往復ぶん）。064a は
     * 「OBS のソースを出せること」を確かめるためのもので、**コメントで自動発火させるのは 064b**。
     * **接続を維持するかどうかは 064b で決める**（security.md に姿勢の追補が要るため）。
     *
     * ⚠⚠ **064c: 戻り値に `ok` が付いた**（[`ObsSourceListResult`]）。
     * **`ok:false` を返すのは「OBS へ辿り着けなかった」ときだけ**で、
     * 繋がって 0 件だったときは **`ok:true` ＋ 空配列**である——この 2 つを混ぜると
     * main 窓が間違った対処を案内する（型の JSDoc が正）。
     * ⚠ `onState("failed", …)` は**従来どおり残す**（コメビュ窓ツールバーの赤字＝既存の観測点）。
     */
    async listSources(port: number): Promise<ObsSourceListResult> {
      const url = `ws://${OBS_HOST}:${port}`;
      try {
        assertAllowedObsUrl(url);
      } catch {
        onState("failed", "OBS の接続先が不正です");
        return { ok: false, sources: [] };
      }
      const obs = new OBSWebSocket();
      try {
        await connectWithTimeout(obs, url, password);
        const { inputs } = await obs.call("GetInputList");
        // ⚠⚠ 絞り込みと `ok:true` は [`toObsSourceListResult`] が持つ（0 件でも `ok:true`）。
        return toObsSourceListResult(inputs);
      } catch (err) {
        onState("failed", safeReason(err, "OBS に接続できませんでした"));
        return { ok: false, sources: [] };
      } finally {
        await obs.disconnect().catch(() => {});
      }
    },

    /**
     * 064a: **ソースを頭出しして出し、`durationMs` 後に戻す**（064 の中心）。
     *
     * 手順は fail-closed:
     *   ①名前の形式検査 ②**`GetInputList` で実在と種別を確認**（⚠ **ここが本体の壁**）
     *   ③現在シーンの scene item を引く ④表示 ⑤メディアなら頭出し
     *   ⑥⚠ 064b: メディアなら**長さを OBS に聞く**（[`resolveObsFireDurationMs`]）⑦その長さで非表示
     *
     * ⚠⚠ **消す責任をここに閉じる。** 表示だけして消し忘れると**配信画面に出しっぱなし**になる——
     * この機能で最悪の壊れ方なので、①タイマーは必ず張る ②同じソースの再発火では
     * **前のタイマーを捨てて張り直す**（先に張った方が消すと、出したばかりのものが即座に消える）
     * ③接続は**消し終えるまで保持する**（消すためだけに繋ぎ直さない）。
     *
     * ## ⚠⚠⚠ 064 レビュー S-2（修正）: ①が破れる経路が 2 本あった
     *
     * - **(a) `TriggerMediaInputAction` を素の `await` で呼んでいた。** すぐ下の
     *   `GetMediaInputStatus` は `.catch` で握っているのに、**より危険なこちらだけ素通し**で、
     *   throw すると **`SetSceneItemEnabled(true)` 済み／タイマー未設定**のまま catch へ抜けていた
     *   ＝ **そのソースは誰も消さない**。⇒ 同じ理由（頭出しの失敗は「出せない」ではない）で握る。
     * - **(b) 前の「消す」予定を、新しい接続より先に捨てていた。** 前回の発火がまだ表示中のときに
     *   再発火し、その 2 回目が connect timeout 等で失敗すると、**消す予定だけが消えて出しっぱなし**に
     *   なっていた（`SetSceneItemEnabled` の値は OBS のシーンコレクションに永続するので
     *   OBS を再起動しても戻らない）。⇒ **捨てるのは「対象が実在すると分かってから」**へ移し、
     *   さらに **捨てた後に失敗したら、その場で消してから切る**（`shownSceneItem`）。
     *
     * ⚠⚠ **この 2 経路は `scripts/test-obs-client.mjs` から固定できていない**——
     * あちらは obs-websocket 非依存の純関数だけを対象にしており、ここを検査するには
     * `createObsClient` に `OBSWebSocket` を注入する seam が要る（＝ 044a 以来
     * 手を入れていない fail-closed 層の構造変更になる）。
     * ⚠ **再修正トリガー＝この経路をもう一度触るとき**（そのとき seam の導入を先に判断すること）。
     * それまでは**上の 3 つの不変条件を人が読んで守る**しかない。
     *
     * ⚠ **`hide` と違って `enable` を経由しない**＝ **ソースを作らない**。鳴らせるのは
     * **ユーザーが自分で OBS に作ったもの**だけである（§3＝この経路は作成能力を持たない）。
     */
    async fireSource(
      port: number,
      sourceName: string,
      durationMs: number,
    ): Promise<boolean> {
      if (!isAllowedObsSourceName(sourceName)) {
        onState("failed", "ソース名が不正です");
        return false;
      }
      const name = sourceName.trim();
      // ⚠ 064b: メディアソースなら下で **OBS が返した長さ**へ差し替える（[`resolveObsFireDurationMs`]）。
      //   ⚠⚠ **ここで一度クランプしておくことが要点**——差し替えに失敗しても、
      //   `showMs` は常に有限で範囲内（＝「消えないまま残る」経路が存在しない）。
      let showMs = clampObsFireDurationMs(durationMs);
      const url = `ws://${OBS_HOST}:${port}`;
      try {
        assertAllowedObsUrl(url);
      } catch {
        onState("failed", "OBS の接続先が不正です");
        return false;
      }

      const obs = new OBSWebSocket();
      let connected = false;
      /**
       * ⚠⚠⚠ S-2(b): **前の「消す」予定を捨てた後で失敗したときに、消してから切るための控え。**
       * `null` ＝ まだ何も出していない（＝失敗しても出しっぱなしにはならない）。
       */
      let shownSceneItem: { sceneName: string; sceneItemId: number } | null =
        null;
      try {
        await connectWithTimeout(obs, url, password);
        connected = true;
        // ⚠⚠ **実在検査（本体の壁）**——OBS に無い名前は 1 回も操作へ渡さない。
        const { inputs } = await obs.call("GetInputList");
        const target = inputs
          .map(toFireableSource)
          .find((s): s is ObsSourceInfo => s !== null && s.name === name);
        if (target === undefined) {
          onState("failed", "そのソースが OBS に見つかりません");
          return false;
        }

        const { currentProgramSceneName } = await obs.call("GetSceneList");
        // ⚠ 現在シーンに置かれていないソースは出せない（`GetSceneItemId` が throw する）。
        const { sceneItemId } = await obs.call("GetSceneItemId", {
          sceneName: currentProgramSceneName,
          sourceName: name,
        });

        // ⚠⚠ 同じソースが再発火したら、**前の「消す」予定を捨てる**（捨てないと今出したものが即消える）。
        // ⚠⚠⚠ **S-2(b): 捨てるのはここ**——「接続できて、対象が実在して、scene item も引けた」＝
        //   このあと確実に出せると分かってからである。⚠ **これより前へ戻さないこと**
        //   （戻すと、接続や実在確認で失敗したときに**前回出したぶんの消す予定だけが消える**）。
        const pending = pendingHides.get(name);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          pendingHides.delete(name);
          // ⚠ 既に出ている状態を引き継ぐ＝ここから先で失敗したら下の catch が消す。
          shownSceneItem = { sceneName: currentProgramSceneName, sceneItemId };
          await pending.close();
        }

        await obs.call("SetSceneItemEnabled", {
          sceneName: currentProgramSceneName,
          sceneItemId,
          sceneItemEnabled: true,
        });
        // ⚠⚠ S-2: ここから先で throw したら**出しっぱなし**になるので、消す手段を控える。
        shownSceneItem = { sceneName: currentProgramSceneName, sceneItemId };
        // ⚠ メディアソースだけ頭出しする（画像には再生位置の概念が無い）。
        // ⚠⚠ 064b: **同じ理由で「長さ」もメディアソースだけ聞く**（画像に長さは無い）。
        //   `showMs` を上書きするのはここ 1 か所だけ＝「何秒出るか」の決まり方が 2 通りにならない。
        if (target.kind === "ffmpeg_source") {
          // ⚠⚠⚠ **S-2(a): 失敗しても止めない**（`catch` で握る）。頭出しできないのは
          //   「出せない」ではなく「頭から出ないだけ」で、ここで発火ごと落とすと
          //   **表示済みのソースを消さないまま catch へ抜ける**＝最悪の壊れ方そのものになる。
          //   ⚠ すぐ下の `GetMediaInputStatus` と**同じ扱い**に揃えてある。
          await obs
            .call("TriggerMediaInputAction", {
              inputName: name,
              mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
            })
            .catch(() => {});
          // ⚠⚠ **失敗しても止めない**（`catch` で `null`）——長さが分からないのは
          //   「出せない」ではなく「既定の秒数で出す」なので、ここで発火ごと落とすほうが害が大きい。
          // ⚠ 非表示だったソースは OBS 側で未ロードのことがあり、**頭出しの直後でも
          //   `mediaDuration` が来ないことがある**。そのときも既定へ落ちる（`resolveObsFireDurationMs`）。
          const status = await obs
            .call("GetMediaInputStatus", { inputName: name })
            .catch(() => null);
          showMs = resolveObsFireDurationMs(status?.mediaDuration, durationMs);
        }

        // ⚠⚠ **消すところまでがこの関数の責任**（接続は消し終えるまで保持する）。
        const close = async () => {
          await obs.disconnect().catch(() => {});
        };
        const timer = setTimeout(() => {
          pendingHides.delete(name);
          void obs
            .call("SetSceneItemEnabled", {
              sceneName: currentProgramSceneName,
              sceneItemId,
              sceneItemEnabled: false,
            })
            .catch(() => {})
            .finally(close);
        }, showMs);
        // ⚠ Node のプロセス終了をこのタイマーで引き延ばさない。
        timer.unref?.();
        pendingHides.set(name, { timer, close });
        return true;
      } catch (err) {
        onState("failed", safeReason(err, "OBS に接続できませんでした"));
        if (connected) {
          // ⚠⚠⚠ S-2: **出した後で失敗したなら、切る前に必ず消す。**
          //   ここに来る経路は 2 つ——①`SetSceneItemEnabled(true)` の後の想定外の throw
          //   ②前の「消す」予定を引き継いだ直後の throw（どちらも `shownSceneItem !== null`）。
          //   ⚠ 消せなくても切る（`catch` で握る）＝ここで throw して disconnect を飛ばさない。
          if (shownSceneItem !== null) {
            await obs
              .call("SetSceneItemEnabled", {
                ...shownSceneItem,
                sceneItemEnabled: false,
              })
              .catch(() => {});
          }
          await obs.disconnect().catch(() => {});
        }
        return false;
      }
    },
  };
}
