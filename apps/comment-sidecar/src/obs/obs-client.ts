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
} from "./obs-helpers.js";

/** OBS 連携の状態（viewer へ通知して UI に反映する）。 */
export type ObsState =
  | "idle" // 未接続 / 連携 OFF
  | "connecting" // 接続試行中
  | "added" // ソースを新規作成した
  | "reused" // 既存ソースを再利用した
  | "failed"; // 接続/作成に失敗（手動手順へフォールバック）

export type ObsStateListener = (state: ObsState, reason?: string) => void;

/** OBS 側に作る/再利用するソース名（透過オーバーレイ窓の窓名に一致させ、ユーザーにも分かりやすくする）。 */
const OBS_SOURCE_NAME = "StreamDock コメントオーバーレイ";
/** キャプチャ対象の透過窓名（033f・open_comment_overlay_window の窓名）。候補一致に使う。 */
const OVERLAY_WINDOW_TITLE = "StreamDock コメントオーバーレイ";
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
  /** OBS 連携を有効化し、指定ポートの OBS へソースを自動追加（既存なら再利用）＋表示する。 */
  enable(port: number): Promise<void>;
  /** オーバーレイ表示 OFF 時: OBS 側ソースを**削除せず非表示**にする（best-effort・ON で enable が再表示）。 */
  hide(port: number): Promise<void>;
  /** 連携 OFF（状態を idle に戻す・OBS 側ソースは消さない）。 */
  disable(): void;
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
async function findOverlayWindowItem(obs: OBSWebSocket) {
  for (let attempt = 0; attempt < WINDOW_LOOKUP_RETRIES; attempt++) {
    const { propertyItems } = await obs.call(
      "GetInputPropertiesListPropertyItems",
      { inputName: OBS_SOURCE_NAME, propertyName: "window" },
    );
    const overlay = propertyItems.find((it) => {
      const name = it.itemName;
      return typeof name === "string" && name.includes(OVERLAY_WINDOW_TITLE);
    });
    if (overlay) return overlay;
    if (attempt < WINDOW_LOOKUP_RETRIES - 1) {
      await sleep(WINDOW_LOOKUP_INTERVAL_MS);
    }
  }
  return null;
}

/**
 * 現在シーンに OBS_SOURCE_NAME のウィンドウキャプチャを作成/再利用し、透過オーバーレイ窓をターゲットにする。
 * @returns 新規作成なら "added"、既存再利用なら "reused"。
 */
async function ensureOverlaySource(obs: OBSWebSocket): Promise<ObsState> {
  const isWindows = process.platform === "win32";
  const inputKind = "window_capture"; // 044s 実測: mac/win とも window_capture が存在

  const { currentProgramSceneName } = await obs.call("GetSceneList");
  const { inputs } = await obs.call("GetInputList");
  const exists = inputs.some((i) => i.inputName === OBS_SOURCE_NAME);

  if (!exists) {
    await obs.call("CreateInput", {
      sceneName: currentProgramSceneName,
      inputName: OBS_SOURCE_NAME,
      inputKind,
      inputSettings: {},
      sceneItemEnabled: true,
    });
  }

  // ウィンドウ候補から透過オーバーレイ窓を探して設定する（OS 依存の窓指定）。開いた直後は OBS の一覧に載らない
  // ことがあるため、findOverlayWindowItem が有界リトライで載るまで待つ（frontend 固定遅延に依存しない・M1）。
  const overlay = await findOverlayWindowItem(obs);
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
    const method = await pickWgcMethodValue(obs);
    await obs.call("SetInputSettings", {
      inputName: OBS_SOURCE_NAME,
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
      inputName: OBS_SOURCE_NAME,
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
async function pickWgcMethodValue(obs: OBSWebSocket): Promise<number> {
  try {
    const { propertyItems } = await obs.call(
      "GetInputPropertiesListPropertyItems",
      { inputName: OBS_SOURCE_NAME, propertyName: "method" },
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
  enabled: boolean,
): Promise<void> {
  const { currentProgramSceneName } = await obs.call("GetSceneList");
  const { sceneItemId } = await obs.call("GetSceneItemId", {
    sceneName: currentProgramSceneName,
    sourceName: OBS_SOURCE_NAME,
  });
  await obs.call("SetSceneItemEnabled", {
    sceneName: currentProgramSceneName,
    sceneItemId,
    sceneItemEnabled: enabled,
  });
}

export function createObsClient(onState: ObsStateListener): ObsClient {
  let password: string | null = null;

  return {
    setPassword(next: string | null): void {
      password = next && next.length > 0 ? next : null;
    },

    // L5(修正不要): enable は index.ts から fire-and-forget で呼ばれ、連打時は多重発火し得るが、毎回独立の
    // OBSWebSocket インスタンスで完結し共有状態を壊さない（in-memory password は読み取りのみ）。よって排他は
    // 設けない。再修正トリガー: 同時接続が OBS 側でエラーや二重ソース作成を招くなら in-flight フラグで抑止する。
    async enable(port: number): Promise<void> {
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
        const result = await ensureOverlaySource(obs);
        // reuse 時に前回の非表示を確実に戻す（新規作成は sceneItemEnabled:true と冪等）。失敗は無視（現在シーンに無い等）。
        await setOverlaySceneItemEnabled(obs, true).catch(() => {});
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
    async hide(port: number): Promise<void> {
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
        await setOverlaySceneItemEnabled(obs, false);
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
  };
}
