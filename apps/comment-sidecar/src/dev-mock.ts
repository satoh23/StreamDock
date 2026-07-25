// 035b（モック・一時・dev 動作確認補助）: sidecar の env ゲート・モックモード。COMMENT_SIDECAR_MOCK=1 のときだけ有効。
//
// 同時配信ができない環境で 035b の表示検証（mixed 混在表示・両接続インジケータ並列・片方 stop で他方継続）を目視する
// ための補助。ON のとき sidecar は**実ネットに出ず**（runTwitchPipeline / runYouTubePipeline / authClient.login* を一切
// 呼ばない）、ユーザーの「接続 → 取得開始 → 停止」操作に応じて**既存 WS ブロードキャスト経路**へ合成フレーム
// （link.state / session.state / comments.append）を流す。viewer・overlay の両窓に同一コメントが届くので、3 点を
// end-to-end で目視できる。
//
// 制約（厳守）:
//   - 既定 OFF（このゲートなしでは一切動かない）。有効化は COMMENT_SIDECAR_MOCK=1 の明示 env のみ。
//   - 新規外部宛先ゼロ（合成フレームは既存 loopback WS に流すだけ）。ON 時は逆にネットに出ない。
//   - fail-closed（host-guard / env ピン留め DI / gRPC ガード）は一切触らない。モックは「ガード手前の早期分岐」で
//     合成フレームを出すだけ（実取得パイプライン・ログインを呼ばない）。
//   - **このモジュールは top-level 副作用ゼロ（純関数のみ export）**なので、OFF 時に import されても実行経路へ影響しない。
//   - 撤去容易: このファイルを削除し、index.ts の 1 ゲート（import ＋ 構築 ＋ handler 先頭 1 行 ＋ shutdown 1 行）を外すだけ。
//   - 本番同梱について（レビュー指摘 S-1・修正不要と判断）: 本番 SEA にも env ゲート付きで同梱される（env ゲートのまま維持＝
//     マージ前撤去しない、が本人決定）。有効化に明示 env 必須・ON でも機能低下（合成表示＋ネット非送出）に留まり権限昇格/
//     情報漏洩はない＝低リスク。再修正トリガー: 公開リリース前に外したくなったら上記「撤去容易」の手順で除去する（1 ファイル＋1 ゲート）。
import { COMMENT_DELIVERY_MESSAGE_TYPES } from "@comment-dock/shared";
import type { Provider } from "./auth/index.js";
import type { CanonicalComment } from "./wire.js";

/** env ゲート。COMMENT_SIDECAR_MOCK=1 のときだけ true（それ以外は現行の実取得経路）。 */
export function isMockEnabled(): boolean {
  return process.env.COMMENT_SIDECAR_MOCK === "1";
}

/**
 * index.ts のローカル定数と同じ link.state フレーム種別（モックを自己完結させるため再定義）。
 * レビュー指摘 S-2/Q-4（修正不要と判断）: "link.state" は index.ts / frontend commentStream.ts にも同リテラルで存在する
 * （共有の COMMENT_DELIVERY_MESSAGE_TYPES は account.state で別値なので流用できない）。既存慣習の踏襲でセキュリティ影響なし。
 * 共有定数化は本タスク範囲外で見送り。再修正トリガー: このワイヤ文字列を変える場合は上記 3 箇所を揃える（共有定数化を別タスクで検討）。
 */
const LINK_STATE_FRAME = "link.state";
/** 合成コメントの emit 間隔（ミリ秒）。 */
const EMIT_INTERVAL_MS = 1800;
/** connecting → connected の擬似遅延（ミリ秒）。 */
const CONNECT_DELAY_MS = 600;

/** index.ts の ControlFrame と構造的に互換な入力型（union はこの型へ代入可能）。 */
interface MockControlFrame {
  type: "start-login" | "start-session" | "stop-session";
  service: Provider;
  channel?: string;
}

interface MockDeps {
  /** 既存の WS 出力ポート（broadcastMessage のみ利用）。 */
  output: { broadcastMessage(message: unknown): void };
  /** index.ts の sendSessionState をそのまま渡す（session.state を viewer/overlay へ反映）。 */
  sendSessionState: (platform: Provider, state: string, reason?: string) => void;
  /** 診断ログ（stderr）。 */
  logInfo: (message: string, extra?: unknown) => void;
}

export interface MockCommentSource {
  /** 制御フレーム（start-login / start-session / stop-session）を合成応答へ振り分ける。 */
  handleControl(frame: MockControlFrame): void;
  /** shutdown 時に全 provider のタイマーを止める。 */
  stopAll(): void;
}

/** provider ごとの合成コメント素材（realistic な名前・本文・一部 superchat/bits）。 */
const MOCK_AUTHORS: Record<Provider, string[]> = {
  twitch: ["kappa_lord", "night_owl", "pogChampion", "saltyRunner", "vodwatcher"],
  youtube: ["ずんだ好き", "ぶいちゅーばー推し", "GamerTaro", "配信勢", "紅茶とネコ"],
};
const MOCK_TEXTS: Record<Provider, string[]> = {
  twitch: [
    "Let's go!!",
    "GGWP",
    "that clutch was insane",
    "Kappa",
    "first time here, love the stream",
    "PogChamp nice",
  ],
  youtube: [
    "こんばんは〜",
    "初見です！",
    "ナイスプレイ👏",
    "今日も配信ありがとう",
    "スパチャ投げます",
    "草",
  ],
};

/** 合成コメント 1 件を組み立てる（wire の CanonicalComment と同形＝viewer 消費型と一致）。 */
function makeComment(source: Provider, seq: number): CanonicalComment {
  const authors = MOCK_AUTHORS[source];
  const texts = MOCK_TEXTS[source];
  const name = authors[seq % authors.length];
  const text = texts[seq % texts.length];
  const comment: CanonicalComment = {
    id: `mock-${source}-${Date.now()}-${seq}`,
    source,
    author: { id: `mock-${source}-${name}`, name },
    text,
    publishedAt: new Date().toISOString(),
    eventType: "chat",
  };

  // 043a: 種別分離の目視用に投げ銭系イベントを周期で混ぜる（provider 実態に沿う・3/7/9/11/13/17 は %5≠0 で superchat と衝突しない）。
  //   membership・jewels … YouTube のみ／gift・subscription・donation・power-up … Twitch のみ。
  //   superchat/bits（額つき）… seq % 5 === 0。付随数値（monthCount/giftCount/tier）・金額は受贈者名/団体名を含まない（§9）。
  //   ※jewels の取得（ingestion）は 043d（gRPC proto 拡張要）で、ここでは表示/実機確認用に合成のみ発行する。
  if (seq % 20 === 7 && source === "youtube") {
    comment.eventType = "membership";
    // 043b: 種別要約は表示側が monthCount 等から組み立てるため、本文は視聴者の自由コメントのみ（無しは空）。
    comment.text = "";
    comment.monthCount = 6;
  } else if (seq % 20 === 9 && source === "youtube") {
    // 043a(拡張): YouTube Jewels（合成のみ・取得は 043d）。jewels は仮想通貨のため bits と同様に数値＋通貨で表す。
    comment.eventType = "jewels";
    comment.text = "投げ銭ジュエル 🎁";
    comment.monetaryAmount = "50 jewels";
    comment.monetary = { amount: 50, currency: "JEWELS" };
  } else if (seq % 20 === 13 && source === "twitch") {
    comment.eventType = "gift";
    comment.text = ""; // 表示側が「〇〇さんがサブギフトを5件贈りました（Tier1）」を組み立てる。
    comment.giftCount = 5;
    comment.tier = 1;
  } else if (seq % 20 === 17 && source === "twitch") {
    comment.eventType = "subscription";
    comment.text = "いつも応援してます！"; // 視聴者が添えた自由コメント（要約の下に表示される）。
    comment.monthCount = 3;
    comment.tier = 2;
  } else if (seq % 20 === 3 && source === "twitch") {
    // 043a(拡張): チャリティ・ドネーション（実金銭・団体名は持たない）。
    comment.eventType = "donation";
    comment.text = "チャリティに寄付しました";
    comment.monetaryAmount = "1000 JPY";
    comment.monetary = { amount: 1000, currency: "JPY" };
  } else if (seq % 20 === 11 && source === "twitch") {
    // 043a(拡張): Bits Power-up（bits 消費＝既存の superchat+BITS 表現に集約）。
    comment.eventType = "superchat";
    comment.text = "Power-up 🎉";
    comment.monetaryAmount = "300 bits";
    comment.monetary = { amount: 300, currency: "BITS" };
  } else if (seq % 5 === 0) {
    comment.eventType = "superchat";
    comment.monetaryAmount = source === "twitch" ? "100 bits" : "500 JPY";
    // 038a: 数値内訳も付与（Rust CommentViewDto.monetary と同形）。twitch=bits / youtube=JPY。
    comment.monetary =
      source === "twitch"
        ? { amount: 100, currency: "BITS" }
        : { amount: 500, currency: "JPY" };
  }
  return comment;
}

/**
 * モックのコメントソースを生成する（index.ts が COMMENT_SIDECAR_MOCK=1 のときだけ呼ぶ）。実ネットに出ず、
 * provider 別のタイマーで合成フレームを既存 WS へ流す。片方 stop は該当 provider のタイマーのみ止め、他方は継続する
 * （035a の provider 別並行と同じ体験を合成で再現）。
 */
export function createMockCommentSource(deps: MockDeps): MockCommentSource {
  const { output, sendSessionState, logInfo } = deps;
  // provider ごとの connect 遅延タイマー / emit インターバルを保持する。
  const timers = new Map<
    Provider,
    { connect?: NodeJS.Timeout; emit?: NodeJS.Timeout }
  >();
  // レビュー指摘 Q-3（修正不要と判断）: seq は provider 共通の単調カウンタ（id 一意化＋名前/本文の周回＋superchat 混入
  // `seq % 5` に使う）。両 provider 合算で 5 件ごとに額つきになるが、額表示/バッジの目視には十分で意図どおり（実害なし）。
  // 再修正トリガー: provider ごとに superchat 比率を厳密に制御したくなったら provider 別 seq に分ける。
  let seq = 0;

  const clearProvider = (provider: Provider): void => {
    const t = timers.get(provider);
    if (t?.connect) clearTimeout(t.connect);
    if (t?.emit) clearInterval(t.emit);
    timers.delete(provider);
  };

  const emitComment = (source: Provider): void => {
    seq += 1;
    output.broadcastMessage({
      type: COMMENT_DELIVERY_MESSAGE_TYPES.COMMENTS_APPEND,
      payload: { comment: makeComment(source, seq) },
    });
  };

  const startSession = (provider: Provider): void => {
    // 再開始は自 provider のみ差し替える（他 provider は温存＝並行を維持）。
    clearProvider(provider);
    sendSessionState(provider, "connecting");
    const entry: { connect?: NodeJS.Timeout; emit?: NodeJS.Timeout } = {};
    entry.connect = setTimeout(() => {
      sendSessionState(provider, "connected");
      // 接続直後に 1 件出して即視認できるようにし、以後は一定間隔で流す。
      emitComment(provider);
      entry.emit = setInterval(() => emitComment(provider), EMIT_INTERVAL_MS);
    }, CONNECT_DELAY_MS);
    timers.set(provider, entry);
  };

  return {
    handleControl(frame: MockControlFrame): void {
      if (frame.type === "start-login") {
        // 実ログインはせず「接続済み（linked）」を擬似する（keychain / ネットには触れない）。
        // レビュー指摘 Q-1（修正不要＝dev 補助として許容）: index.ts の setConnectionHandler はモード非依存で残るため、
        // viewer 再接続時に getLinkStatus（メモリ参照・非通信）が linked:false を送り、この合成 linked:true を上書きしうる
        // （初回フロー〔接続→取得開始〕は問題なし・egress なし＝再接続後に再度「接続」を押すまで接続済み表示が戻らないだけ）。
        // 再修正トリガー: モックで再接続後も linked を保ちたくなったら setConnectionHandler / onLinkState をモック時ゲートする。
        output.broadcastMessage({
          type: LINK_STATE_FRAME,
          payload: { platform: frame.service, linked: true },
        });
        sendSessionState(frame.service, "idle");
        logInfo(`[comment-sidecar][mock] ${frame.service} login (synthetic)`);
      } else if (frame.type === "start-session") {
        startSession(frame.service);
        logInfo(`[comment-sidecar][mock] ${frame.service} session start (synthetic)`);
      } else if (frame.type === "stop-session") {
        // 該当 provider のみ停止（他 provider は継続）。停止側インジケータは idle へ戻す。
        clearProvider(frame.service);
        sendSessionState(frame.service, "idle");
        logInfo(`[comment-sidecar][mock] ${frame.service} session stop (synthetic)`);
      }
    },
    stopAll(): void {
      for (const provider of [...timers.keys()]) clearProvider(provider);
    },
  };
}
