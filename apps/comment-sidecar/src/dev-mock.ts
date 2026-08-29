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
// 063e 段 2-b: チャンネルポイントだけは**生の EventSub ペイロードを本番の変換チェーンへ流す**
//   （理由は下の `CHANNEL_POINTS_ENVELOPES` の注記）。
// ⚠⚠ どちらも**純関数のみ**のモジュールである（`ws` も tsyringe も引かない）＝
//   このファイルの「top-level 副作用ゼロ」は保たれている。⚠ `eventsub-repair.ts` が
//   client 本体から切り出されているのは、まさにこの 1 行のためである。
import { repairNotificationEvent } from "../vendor/comment-fetcher/src/adapters/twitch/client/eventsub-repair.js";
import { mapTwitchChatEventsToComments } from "../vendor/comment-fetcher/src/adapters/twitch/mapper/comment.mapper.js";
import type { TwitchEventSubNotificationEnvelopeDto } from "../vendor/comment-fetcher/src/adapters/twitch/dto/raw.dto.js";
import type { Comment } from "./comment-fetcher/index.js";

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
/**
 * 063e 段 1-b（モック・一時・env ゲート）: チャンネルポイント購読の成否フレーム（`src/index.ts` と同じ名前）。
 *
 * ⚠⚠⚠ **なぜモックにも要るのか。** この機能は**作者が実機で確認できない**——チャンネルポイントは
 * Twitch 側で有効化されるまで存在せず、有効化はアフィリエイト条件を満たしたあとの
 * オンボーディングを通るためである。⇒ 設定カードの 3 状態（まだ分かりません／受信中／受信できていません）が
 * **実際にどう見えるか**を確かめる手段が、モード ON の合成発行しか無い。
 * ⚠ 段 1 で `.cardBody` の抜け（説明文がカードの端に貼り付く）を**テストでは捕まえられなかった**ように、
 *   見た目の破綻は目視でしか分からない。
 * ⚠ OFF（既定）では 1 バイトも発行しない（このファイル全体が env ゲートの内側にある）。
 */
const CHANNEL_POINTS_STATE_FRAME = "channelpoints.state";
/**
 * 063e 段 2-b（モック・一時・env ゲート）: **チャンネルポイント引き換えの生 EventSub ペイロード。**
 *
 * ## ⚠⚠⚠ なぜチャンネルポイントだけ「生」なのか
 *
 * このファイルの他の合成コメントは `CanonicalComment` を**直接**組んでおり、
 * **`wire.ts` も vendor の mapper も 1 バイトも通らない**（＝確認できるのは「wire から先」だけ）。
 * ⚠ 段 1 はこれをチャンネルポイントでも踏襲したが、**チャンネルポイントは作者が実機で 1 度も受信できない**
 * （Twitch 側で有効化されておらず、有効化はアフィリエイト条件達成後のオンボーディングを通る）。
 * ⇒ **変換が正しいかを目視で確かめられる経路が、ここしか無い。**
 *
 * ⇒ ここでは **Twitch が実際に送ってくる形の envelope** を組み、
 *    `repairNotificationEvent` → `mapTwitchChatEventsToComments` → **本番の `outputPort`**
 *    （converter → `wire.ts` → broadcast）へ流す。
 *    ⚠ **WebSocket と Helix 以外は全部本番のコードである。**
 *
 * ## ⚠ ペイロードの出典（2026-08-26・2 つの独立した一次情報で一致）
 *
 * - `twitch_api` crate の `ChannelPointsCustomRewardRedemptionAddV1Payload`（公式ドキュメントの型写し）
 * - **公式 Twitch CLI** `internal/events/types/channel_points_redemption/redemption_event.go` が emit する形
 *
 * | フィールド | 型 | 備考 |
 * |---|---|---|
 * | `id` | string | 引き換えの一意 ID |
 * | `broadcaster_user_id` / `_login` / `_name` | string | |
 * | `user_id` / `user_login` / `user_name` | string | 引き換えた視聴者 |
 * | `user_input` | string | ⚠ **"Empty string if not provided"** |
 * | `status` | string | `unknown` / `unfulfilled` / `fulfilled` / `canceled` |
 * | `reward` | object | ⚠⚠ **`{ id, title, cost, prompt }`**（＝穴 G は解決済み） |
 * | `redeemed_at` | string | RFC3339 |
 *
 * ⚠⚠ **`status` / `redeemed_at` / `reward` を fixture に必ず載せておくこと。**
 * これらは**載っているのに取り込まないと決めたもの**（§9）なので、抜くと
 * 「取り込んでいないこと」を目視で確かめられなくなる——`test-twitch-mapper.mjs` の fixture が
 * `system_message` / `profile_image_url` を必ず入れているのと**同じ理由**である。
 *
 * ## ⚠⚠⚠ 063e 段 3: **`reward.title` だけは取り込むようになった**（線を 1 つ動かした）
 *
 * 依頼者＝「**どのチャンネルポイント交換に紐づけるかをユーザーが設定できるようにして欲しい**」。
 * ⇒ 段 2-b までの目視の期待値「報酬名が 1 文字も出ない」は**もう正しくない**。
 * ⚠ いまの期待値は次のとおり:
 *   - **`title` は出る**（コメント一覧には出さないが、割り当て画面の「最近届いた」チップに出る）
 *   - ⚠⚠ **`id` / `cost` / `prompt` / `status` / `redeemed_at` は今も 1 文字も出ない**
 *
 * ## ⚠⚠⚠ 3 パターンで「出し分け」が端から端まで目視できる
 *
 * | seq | 報酬名 | 割り当て表の「対象の報酬」に `ガチャを引く` と入れたとき |
 * |---|---|---|
 * | 4 | ⚠ **無し**（`reward` ごと欠落） | **鳴らない** |
 * | 6 | 読み上げ | **鳴らない** |
 * | 8 | **ガチャを引く** | ⚠⚠ **これだけ鳴る** |
 *
 * ⚠ 空欄（＝すべての報酬）に戻すと **3 件とも鳴る**（段 2 までの挙動）。
 */
export const CHANNEL_POINTS_ENVELOPES: readonly {
  /** 何を模しているか（診断ログに出す・§9 で第三者データは含めない）。 */
  readonly label: string;
  readonly event: Record<string, unknown>;
}[] = [
  {
    label: "text-input",
    event: {
      id: "mock-redemption-1",
      broadcaster_user_id: "mock-broadcaster",
      broadcaster_user_login: "mock_broadcaster",
      broadcaster_user_name: "MockBroadcaster",
      user_id: "mock-twitch-redeemer",
      user_login: "night_owl",
      user_name: "night_owl",
      // ⚠ 視聴者が報酬に添えたテキスト（＝本文になる唯一の値）。
      user_input: "がんばれー！",
      status: "unfulfilled",
      // ⚠⚠ **取り込まないことを目視するために載せている**（DTO に宣言していないので届かないはず）。
      reward: {
        id: "mock-reward-1",
        title: "読み上げ",
        cost: 500,
        prompt: "好きな言葉をどうぞ",
      },
      redeemed_at: "2026-08-26T10:00:00.000000000Z",
    },
  },
  {
    label: "no-text-input",
    event: {
      id: "mock-redemption-2",
      broadcaster_user_id: "mock-broadcaster",
      broadcaster_user_login: "mock_broadcaster",
      broadcaster_user_name: "MockBroadcaster",
      user_id: "mock-twitch-redeemer2",
      user_login: "pogChampion",
      user_name: "pogChampion",
      // ⚠⚠ **公式どおり「未入力なら空文字」**。⇒ 一覧には出るが**配信画面には出ない**（062a と同じ規律）。
      user_input: "",
      status: "unfulfilled",
      // ⚠⚠⚠ **063e 段 3: ここが「出し分け」の目視の主役である。**
      //   ガチャ用の報酬は**テキスト入力を求めないのが自然**なので、
      //   `user_input: ""` のこのパターンに割り当ててある。
      //   ⇒ 割り当て表の「対象の報酬」に **`ガチャを引く` と入れると、この 1 件だけが鳴る**。
      reward: {
        id: "mock-reward-2",
        title: "ガチャを引く",
        cost: 100,
        prompt: "",
      },
      redeemed_at: "2026-08-26T10:00:05.000000000Z",
    },
  },
  {
    /**
     * ⚠⚠⚠ **仕様どおりでない形**（`user_input` が `null`／`id` が欠落）。
     *
     * ⚠ 公式仕様はどちらも「必ず来る」と書いているので、**これは仕様外の想定**である。
     * それでも巡回に入れているのは、**作者が実機で確認できない以上「仕様を信じて外したときに
     * 何が起きるか」を目視できる必要がある**ため。
     * ⇒ 期待される見え方＝**普通に 1 行出る**（本文は空・id は envelope の message_id で補填）。
     * ⚠⚠ ここで**行が消えたら、段 1-b の防御（`repairNotificationEvent` ＋ mapper の判別）が壊れている。**
     */
    label: "out-of-spec-no-reward",
    event: {
      broadcaster_user_id: "mock-broadcaster",
      broadcaster_user_login: "mock_broadcaster",
      broadcaster_user_name: "MockBroadcaster",
      user_id: "mock-twitch-redeemer3",
      user_login: "saltyRunner",
      user_name: "saltyRunner",
      user_input: null,
      status: "unfulfilled",
      // ⚠⚠⚠ **063e 段 3: `reward` ごと落としてある**（＝**報酬名が取れない引き換え**）。
      //   ⚠ 公式仕様では `reward` は必ず載るので、これも「仕様外」の一種である。
      //   ⇒ 期待される見え方＝ **対象の報酬を指定していると鳴らない／空欄なら鳴る。**
      //   ⚠⚠ ここが鳴ってしまったら、`effectAssignments.ts` の
      //   「報酬名を持たないイベントに、指定ありの条件が当たってはいけない」が壊れている。
      redeemed_at: "2026-08-26T10:00:10.000000000Z",
    },
  },
];

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
  /**
   * 063e 段 2-b: **本番の出力ポート**（`index.ts` の `outputPort.outputComments`）。
   *
   * ⚠⚠⚠ **チャンネルポイントだけはここを通す。** 他の合成コメントは `CanonicalComment` を直接組んで
   * `output.broadcastMessage` へ流す（＝`wire.ts` も vendor の mapper も通らない）が、
   * チャンネルポイントは**作者が実機で 1 度も受信できない**ので、
   * **変換チェーンを目視で確かめられる経路がここしか無い**。
   * ⚠ **同じ変換をここに書き写さないこと**——書き写すと「コピーだけ直る」事故が起きる。
   *   converter → `wire.ts` → broadcast は**本番のコードをそのまま呼ぶ**のが要点である。
   * ⚠ 未指定なら生ペイロード経路は無効（＝チャンネルポイントが 1 件も出ないだけ・fail-closed）。
   */
  outputComments?: (comments: Comment[]) => Promise<void>;
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

// 043c 動作確認用: 課金額バリエーション表（tauri dev で配色/金額バッジを目視確認するため額を固定せず seq で回す）。
//   スパチャは superchatTier が通貨コードで閾値表を引く（JPY=大単位[100,200,500,1000,2000,5000,10000] /
//   USD=小単位[1,2,5,10,20,50,100]）。※ bits/jewels/donation はティア非対象（種別単色）＝額は金額バッジのみに反映。
const SUPERCHAT_VARIANTS = [
  { amount: 100, currency: "JPY", label: "100 JPY" }, // tier0 青
  { amount: 300, currency: "JPY", label: "300 JPY" }, // tier1 水
  { amount: 800, currency: "JPY", label: "800 JPY" }, // tier2 緑
  { amount: 1500, currency: "JPY", label: "1,500 JPY" }, // tier3 黄
  { amount: 3000, currency: "JPY", label: "3,000 JPY" }, // tier4 橙
  { amount: 7000, currency: "JPY", label: "7,000 JPY" }, // tier5 桃
  { amount: 15000, currency: "JPY", label: "15,000 JPY" }, // tier6 赤
  { amount: 8, currency: "USD", label: "8 USD" }, // USD 小単位表: tier2（未収載通貨経路の確認）
  { amount: 30, currency: "USD", label: "30 USD" }, // tier4
  { amount: 150, currency: "USD", label: "150 USD" }, // tier6（上限超え飽和）
];
const BITS_VARIANTS = [
  { amount: 100, label: "100 bits" },
  { amount: 500, label: "500 bits" },
  { amount: 1500, label: "1,500 bits" },
  { amount: 5000, label: "5,000 bits" },
  { amount: 25000, label: "25,000 bits" },
];
const DONATION_VARIANTS = [
  { amount: 500, currency: "JPY", label: "500 JPY" },
  { amount: 3000, currency: "JPY", label: "3,000 JPY" },
  { amount: 10, currency: "USD", label: "10 USD" },
  { amount: 50, currency: "USD", label: "50 USD" },
];
const JEWELS_VARIANTS = [
  { amount: 30, label: "30 jewels" },
  { amount: 100, label: "100 jewels" },
  { amount: 500, label: "500 jewels" },
];

/**
 * 043e: 直近に発行した Jewels（seq % 20 === 9）の id と投稿者。combo 更新（seq % 20 === 12）で
 * **同じ id・同じ投稿者**を再送するために覚えておく。
 *
 * なぜ id を計算式で作らず覚えるのか: makeComment の id は `Date.now()` を含むため計算では再現できず、
 * 固定 id にすると**セッションをまたいで同じ id が再利用され**（起動のたびに既存行の UPDATE 経路へ落ちて
 * 「初見バッジが出ない」等の紛らわしい挙動になる）。1 件だけ保持するので無制限には増えない。
 * combo 更新のみに使い、実データの意味論には一切影響しない（dev-mock は env ゲート内でのみ動く）。
 * なおこれは**モジュールスコープの可変状態**であって top-level 副作用ではない（宣言だけで何も実行しない）ので、
 * 本ファイル冒頭の「OFF 時に import されても実行経路へ影響しない」不変条件は保たれる。
 *
 * 043e（レビュー指摘 S-6）: 覚えた id も**セッションを跨ぐ**ため、上の「固定 id はセッション跨ぎで再利用される
 * から覚える」という理由だけでは足りない。`clearProvider("youtube")`（stop / 再開始）で null に戻すことで
 * セッション単位に閉じている。
 */
let lastMockJewels: { id: string; author: CanonicalComment["author"] } | null =
  null;

// 043c エッジケース確認用: 長文コメント（本文の折返し・カード/吹き出しの伸長・スクロールが崩れないか目視するため）。
//   文字数は YouTube の赤スパ（最高額帯）本文上限 ≈290 字を目安にした長文。スパチャ用と通常チャット用の 2 種。
const LONG_SUPERCHAT_TEXT =
  "いつも本当に素敵な配信をありがとうございます！毎日お仕事から帰ってきてこの配信を見るのが唯一の楽しみで、今日も一日なんとか頑張ることができました。先週おすすめしてくれたゲームをさっそく買ってプレイしてみたら、想像していた以上に面白くて、気づいたら外が明るくなっていました（笑）。これからもどうか無理だけはせず、体調を第一にして末永く配信を続けてくださいね。ささやかですが精一杯応援しています。次回のコラボ配信も本当に楽しみにしているので、ぜひぜひ実現させてください。配信者さんのおかげで毎日が少しずつ明るくなりました。これからもずっと応援しています、いつも本当に元気をありがとう！"; // 290 字
const LONG_CHAT_TEXT =
  "今日の配信も本当に面白かったです！さっきの場面、緊張感がすごくて画面の前で思わず声を出してしまいました。個人的には中盤の立ち回りが神がかっていて、まさかあのタイミングでその選択をするとは思わず本当に驚きました。次の展開もすごく気になるので、時間が許す限りじっくり最後まで見ていきたいと思います。毎回コメントを丁寧に拾ってくれるところも大好きで、初見の人にも優しいこの空気感がすごく居心地良いです。仕事で疲れて帰ってきても、ここに来ると元気がもらえます。皆さんのコメントを読むのも毎回の楽しみです。長文になってしまってすみません、これからもずっと楽しみにしています、応援しています！"; // 290 字

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

  // 043a: 種別分離の目視用に投げ銭系イベントを周期で混ぜる（provider 実態に沿う・3/7/9/11/12/13/14/17 は %5≠0 で superchat と衝突しない）。
  //   membership・jewels … YouTube のみ／subscription・donation・power-up・channelpoint … Twitch のみ／
  //   gift … **両方**（Twitch=サブギフト seq%20===13／YouTube=メンバーシップギフト seq%20===14・呼び名が配信元で異なる）。
  //   superchat/bits（額つき）… seq % 5 === 0。付随数値（monthCount/giftCount/tier）・金額は受贈者名/団体名を含まない（§9）。
  //   ※jewels/gift(YouTube) の取得（ingestion）は 043d で実装済み。ここは表示/実機確認用の合成発行。
  //   ※043e: jewels の combo 更新（seq%20===12）は **9 で出した jewels と同一 id の再送**で、単独では成立しない
  //     （lastMockJewels が無ければ通常チャットへ落ちる）。
  if (seq % 20 === 7 && source === "youtube") {
    comment.eventType = "membership";
    // 043b: 種別要約は表示側が monthCount 等から組み立てるため、本文は視聴者の自由コメントのみ（無しは空）。
    comment.text = "";
    comment.monthCount = 6;
  } else if (seq % 20 === 9 && source === "youtube") {
    // 043a(拡張): YouTube Jewels（合成のみ・取得は 043d）。jewels は仮想通貨のため bits と同様に数値＋通貨で表す。
    const v = JEWELS_VARIANTS[Math.floor(seq / 20) % JEWELS_VARIANTS.length];
    comment.eventType = "jewels";
    comment.text = "投げ銭ジュエル 🎁";
    comment.monetaryAmount = v.label;
    comment.monetary = { amount: v.amount, currency: "JEWELS" };
    // 043e: この 1 件を「combo の 1 回目」として覚え、seq % 20 === 12 で同じ id を再送する。
    lastMockJewels = { id: comment.id, author: comment.author };
  } else if (seq % 20 === 12 && source === "youtube" && lastMockJewels) {
    // 043e: Jewels の combo 更新（**同一 id の再送**）。公式仕様どおり「別メッセージが N 件届く」のではなく
    //   「同じ 1 件が更新される」形を合成し、3 層（mergeComments の updated → recordComments → Rust の
    //   jewels 限定 UPDATE）の貫通を実機で目視できるようにする。期待される見え方:
    //     ・コメント行は**増えない**（1 行のまま金額バッジが 30 → 90 jewels に変わり「×3」が付く）
    //     ・読み上げは**1 回だけ**（combo 更新は added に載らないため）
    //     ・視聴者詳細の過去コメントも金額が置き換わる（total_comments は増えない）
    //   周期に 12 を選んだ理由: 既存の設計原則「%5 ≠ 0 で superchat 枠と衝突しない」に従いつつ、
    //   9（jewels 本体）の直後に置いて対応関係を読みやすくした（1800ms 間隔で約 5 秒後に更新が届く）。
    //
    // ⚠【レビュー指摘 Q-3・フェーズ2 の判断を誤読しないこと】ここで金額を ×3 にしているのは
    //   **`jewels_amount` が「累計」で届く世界を模した合成値**であって、実データがどちらかの根拠ではない。
    //   フェーズ1 は乗算しないので、この合成では常に「30 → 90 に正しく更新される」ように見えるが、
    //   実データが「単価」で届く世界なら同一 id の再送で金額は**変化しない**（＝×N だけが増える）のが正しい。
    //   フェーズ2 の判別は**実データの観測のみ**で行い、本モックの見え方を根拠にしないこと。
    //   （モックの役割は 3 層貫通〔行が増えない・読み上げ 1 回・記録が更新される〕の目視に限る。）
    const v = JEWELS_VARIANTS[Math.floor(seq / 20) % JEWELS_VARIANTS.length];
    comment.id = lastMockJewels.id; // ← ここが本質（同一 id の再送）
    comment.author = lastMockJewels.author; // combo は同じ視聴者からの連続ギフト
    comment.eventType = "jewels";
    comment.text = "投げ銭ジュエル 🎁";
    comment.monetaryAmount = `${v.amount * 3} jewels`;
    comment.monetary = { amount: v.amount * 3, currency: "JEWELS" };
    // combo_count はギフト回数（公式は「0 if not a combo」＝単発は 0）。合成では 3 連 combo とする。
    comment.comboCount = 3;
  } else if (seq % 20 === 13 && source === "twitch") {
    comment.eventType = "gift";
    comment.text = ""; // 表示側が「〇〇さんがサブギフトを5件贈りました（Tier1）」を組み立てる。
    comment.giftCount = 5;
    comment.tier = 1;
  } else if (seq % 20 === 14 && source === "youtube") {
    // 043d: YouTube のメンバーシップギフト（贈与側 MEMBERSHIP_GIFTING_EVENT → gift）。
    //   Twitch の gift（上の 13）と**同じ eventType だが表示語彙が異なる**ことの目視用に別枠で発行する
    //   （表示側は composeEventMessage が source を見て「メンバーシップギフト」へ切り替える）。
    //   tier は**付けない**: YouTube に階級の概念が無く、実データでも未設定で届くため（＝「（TierN）」が
    //   出ないことの確認も兼ねる）。受贈者名は持たない＝件数のみ（§9・決定1 で受領側は取り込まない）。
    comment.eventType = "gift";
    comment.text = ""; // 表示側が「〇〇さんがメンバーシップギフトを5件贈りました」を組み立てる。
    comment.giftCount = 5;
  } else if (seq % 20 === 16 && source === "twitch") {
    // 062a: Twitch のレイド（合成のみ）。実機で「レイド 42人」のバッジ・**課金扱いされないこと**・
    //   **読み上げられないこと**・**視聴者メモリの subscription_count が増えないこと**を目視するため。
    //   周期に 16 を選んだ理由: 既存の設計原則「%5 ≠ 0 で superchat 枠と衝突しない」に従いつつ、
    //   未使用の値（1/3/7/9/11/12/13/14/17/19 と %5===0 が使用済み）から選んだ。
    //
    // ⚠⚠ **このモックで確認できないもの（穴 F・誤った安心をしないこと）**:
    //   本ファイルは `CanonicalComment` を**直接**組んでおり、**`wire.ts` を通らない**
    //   （060i のコメントが同じことを書いている＝本番だけ桁区切りが無かった罠の原因）。
    //   したがってこの合成では **vendor の mapper（`comment.mapper.ts`）と `wire.ts` の
    //   `EVENT_TYPE_MAP` / `raidViewerCount` の詰め替えを 1 バイトも検証していない。**
    //   それらの担保は `scripts/test-twitch-mapper.mjs` と `scripts/test-comment-relay.mjs` にある。
    //   ここで確認できるのは「wire から先」（frontend の表示・読み上げ・Rust の保存と集計）だけである。
    //
    // ⚠ author は**レイド元の配信者**（実データでは `raid.user_*`）。§9 のとおりアバター URL は持たない。
    // ⚠ 本文は空（実データのレイドは本文を持たず、`system_message` へフォールバックしない）。
    comment.eventType = "raid";
    comment.text = "";
    comment.author = { id: `mock-twitch-raider`, name: "RaiderChannel" };
    comment.raidViewerCount = 42;
  } else if (seq % 20 === 17 && source === "twitch") {
    comment.eventType = "subscription";
    comment.text = "いつも応援してます！"; // 視聴者が添えた自由コメント（要約の下に表示される）。
    comment.monthCount = 3;
    comment.tier = 2;
  } else if (seq % 20 === 3 && source === "twitch") {
    // 043a(拡張): チャリティ・ドネーション（実金銭・団体名は持たない）。
    const v = DONATION_VARIANTS[Math.floor(seq / 20) % DONATION_VARIANTS.length];
    comment.eventType = "donation";
    comment.text = "チャリティに寄付しました";
    comment.monetaryAmount = v.label;
    comment.monetary = { amount: v.amount, currency: v.currency };
  } else if (seq % 20 === 11 && source === "twitch") {
    // 043a(拡張): Bits Power-up（bits 消費＝既存の superchat+BITS 表現に集約）。
    const v = BITS_VARIANTS[Math.floor(seq / 20) % BITS_VARIANTS.length];
    comment.eventType = "superchat";
    comment.text = "Power-up 🎉";
    comment.monetaryAmount = v.label;
    comment.monetary = { amount: v.amount, currency: "BITS" };
  } else if (seq % 20 === 1 && source === "youtube") {
    // 043c エッジケース: 赤スパ（最高額帯＝tier6 赤）＋赤スパ本文上限（290字）の長文。カードのボディ折返し/伸長/スクロールの目視用。
    comment.eventType = "superchat";
    comment.text = LONG_SUPERCHAT_TEXT;
    comment.monetaryAmount = "20,000 JPY";
    comment.monetary = { amount: 20000, currency: "JPY" };
  } else if (seq % 20 === 19) {
    // 043c エッジケース: 通常チャットの長文（赤スパ本文上限 290字を参考）。吹き出しの折返し/伸長/スクロールの目視用。
    comment.eventType = "chat";
    comment.text = LONG_CHAT_TEXT;
  } else if (seq % 5 === 0) {
    // 043c 動作確認: スパチャ額を全ティア（青→赤）へ渡って回す。twitch=bits（種別単色・額のみ変化）/ youtube=スパチャ（金額ティア配色）。
    comment.eventType = "superchat";
    // 038a: 数値内訳も付与（Rust CommentViewDto.monetary と同形）。twitch=bits / youtube=JPY/USD。
    if (source === "twitch") {
      const v = BITS_VARIANTS[Math.floor(seq / 5) % BITS_VARIANTS.length];
      comment.monetaryAmount = v.label;
      comment.monetary = { amount: v.amount, currency: "BITS" };
    } else {
      const v = SUPERCHAT_VARIANTS[Math.floor(seq / 5) % SUPERCHAT_VARIANTS.length];
      comment.monetaryAmount = v.label;
      comment.monetary = { amount: v.amount, currency: v.currency };
    }
  }
  return comment;
}

/**
 * モックのコメントソースを生成する（index.ts が COMMENT_SIDECAR_MOCK=1 のときだけ呼ぶ）。実ネットに出ず、
 * provider 別のタイマーで合成フレームを既存 WS へ流す。片方 stop は該当 provider のタイマーのみ止め、他方は継続する
 * （035a の provider 別並行と同じ体験を合成で再現）。
 */
export function createMockCommentSource(deps: MockDeps): MockCommentSource {
  const { output, sendSessionState, logInfo, outputComments } = deps;
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
    // 043e（レビュー指摘 S-6）: YouTube セッションを止めたら combo 再送用の id を忘れる。
    //   viewer_comments は**永続**なので、覚えたまま stop → start すると seq % 20 === 12 が
    //   「前セッションで保存された行」に対して UPDATE を撃ち、session_id は前のままで金額だけ変わる
    //   （手動確認中に「なぜ前回のコメントの金額が変わった？」と誤読させる）。セッション単位で捨てる。
    if (provider === "youtube") lastMockJewels = null;
  };

  /**
   * 063e 段 2-b: **チャンネルポイントを流す周期**（Twitch のみ）。
   *
   * ⚠ 既存の設計原則「`% 5 !== 0` で superchat 枠と衝突しない」に従い、未使用だった 4 / 6 / 8 を割り当てる。
   * ⚠ 並びは [`CHANNEL_POINTS_ENVELOPES`] の順（入力あり → 入力なし → 仕様外）。
   *
   * ## ⚠⚠⚠ 既知の制約: `seq` は **両 provider の共有カウンタ**である（レビュー Q-M2）
   *
   * ⇒ **YouTube を同時接続すると、Twitch の発行が当たる `seq % 20` がずれ、
   * チャンネルポイントが 1 件も出ない周が生じる。** ⚠ しかも「出ない」のか「壊れている」のかを
   * 見分けられない——段 2-b の存在意義が「実機で受信できないものを目に見せる」ことなので、これは痛い。
   * ⚠ **目視するときは Twitch を単独で接続すること**（`docs/tasks/063e-twitch-channel-points.md` の
   * 実機確認 7. にも明記した）。単体テストの `runTwitch` / `runYouTube` が単独接続なのも同じ理由である。
   * **再修正トリガー＝同時接続でも安定して出したくなったとき。** そのときは `seq` を provider 別に割り、
   * ⚠⚠ **既存の全周期（jewels の combo 対・raid・gift 等）の期待値がまとめてずれる**ので**別タスク**にすること。
   */
  const CHANNEL_POINTS_SEQ = [6, 8, 4] as const;

  /**
   * 063e 段 2-b: 生の EventSub envelope を**本番の変換チェーン**へ流す。
   *
   * ⚠⚠ ここでやるのは `handleMessage`（`eventsub-websocket.client.ts`）と**同じ 2 手**だけ:
   *   ①`repairNotificationEvent`（`metadata.subscription_type` を根拠にした修復）
   *   ②`mapTwitchChatEventsToComments`（種別の判別と詰め替え）
   *   ⚠ その先（converter → `wire.ts` → broadcast）は **`outputComments` が本番のコードで行う**。
   * ⚠ `resolveAvatar` は渡さない＝アバター URL が無いので `resolveAvatarDataUri` は
   *   `if (!authorId || !url) return undefined` で**即 return し、fetch に到達しない**（＝実ネットに出ない）。
   */
  /**
   * 063e 段 2-b: 引き換え `id` を**発行ごとに一意にする**（fixture の id を接尾辞で伸ばす）。
   *
   * ⚠⚠⚠ **同じ id を 2 周目にも出すと、一覧にチャンネルポイントが 1 行しか現れない。**
   * `mergeComments` は id で畳むので、2 周目は「新しい行」ではなく**同一行の更新**として扱われる
   * ——目視の導線が 1 周目で終わってしまい、モックを置いた意味が消える。
   * ⚠ 実物の Twitch は引き換えごとに別の `id` を返すので、**一意にするほうが実物に近い**。
   * ⚠ 接頭辞に fixture の id を残すのは、**「id はイベント本体由来であって envelope 由来ではない」**
   *   ことをテストと目視の両方で読み取れるようにするため（仕様外パターンだけが `mock-envelope-*` になる）。
   */
  const uniquifyRedemptionId = (
    event: Record<string, unknown>,
    at: number,
  ): Record<string, unknown> => {
    if (typeof event.id === "string" && event.id !== "") {
      event.id = `${event.id}-${at}`;
    }
    return event;
  };

  const emitChannelPointRedemption = (index: number): void => {
    if (!outputComments) return;
    const fixture = CHANNEL_POINTS_ENVELOPES[index % CHANNEL_POINTS_ENVELOPES.length];
    // ⚠ **毎回作り直す**（`repairNotificationEvent` は in-place で書き換えるので、
    //   使い回すと 2 周目には修復済みの形＝「仕様外」を模せなくなる）。
    const envelope = {
      metadata: {
        message_type: "notification",
        // ⚠⚠ `id` 欠落の fixture は**ここから補填される**（本番と同じ経路）。
        message_id: `mock-envelope-${seq}`,
        subscription_type: "channel.channel_points_custom_reward_redemption.add",
        subscription_version: "1",
      },
      payload: {
        subscription: {
          id: "mock-subscription",
          type: "channel.channel_points_custom_reward_redemption.add",
          version: "1",
          status: "enabled",
          condition: { broadcaster_user_id: "mock-broadcaster" },
          transport: { method: "websocket", session_id: "mock-session" },
        },
        // ⚠⚠ 構造化クローンで**深いコピー**を作る。`repairNotificationEvent` は in-place で書き換えるので、
        //   fixture を直接渡すと**2 周目には修復済みの形**になり「仕様外」を模せなくなる
        //   （さらに `id` が 1 周目の補填値で固定され、**周回ごとに同じ id を出す**ことになる）。
        event: uniquifyRedemptionId(structuredClone(fixture.event), seq),
      },
    } as unknown as TwitchEventSubNotificationEnvelopeDto;

    repairNotificationEvent(envelope);
    const comments = mapTwitchChatEventsToComments([envelope.payload.event]);
    logInfo(
      `[comment-sidecar][mock] channel points redemption (${fixture.label}) -> ${comments.length} comment(s)`,
    );
    // ⚠⚠ **握りつぶす**（モックの発行でタイマー経路を落とさない）。§9 配慮で理由は載せない。
    void outputComments(comments).catch(() => {});
  };

  const emitComment = (source: Provider): void => {
    seq += 1;
    // 063e 段 2-b: Twitch の該当周期だけ**生ペイロード経路**へ回す（理由は `CHANNEL_POINTS_ENVELOPES`）。
    if (source === "twitch") {
      const index = CHANNEL_POINTS_SEQ.indexOf(
        (seq % 20) as (typeof CHANNEL_POINTS_SEQ)[number],
      );
      if (index >= 0) {
        emitChannelPointRedemption(index);
        return;
      }
    }
    output.broadcastMessage({
      type: COMMENT_DELIVERY_MESSAGE_TYPES.COMMENTS_APPEND,
      payload: { comment: makeComment(source, seq) },
    });
  };

  /**
   * 063e 段 1-b（モック・一時）: 取得開始のたびに「受信中」と「受信できていません」を**交互**に出す。
   *
   * ⚠ 交互にするのは、**3 状態すべてを目視できる導線が他に無い**ため
   * （実物は Twitch 側の有効化状況しだいで、作者の環境では常に「受信できていません」にしかならない）。
   *   取得開始 → 受信中 ／ 停止 → まだ分かりません ／ もう一度開始 → 受信できていません …の順に回る。
   * ⚠ **本物の挙動を模したものではない**（本物は購読作成の成否 1 回きり）。目視用の巡回である。
   */
  let mockChannelPointsOk = true;

  const startSession = (provider: Provider): void => {
    // 再開始は自 provider のみ差し替える（他 provider は温存＝並行を維持）。
    clearProvider(provider);
    sendSessionState(provider, "connecting");
    const entry: { connect?: NodeJS.Timeout; emit?: NodeJS.Timeout } = {};
    entry.connect = setTimeout(() => {
      sendSessionState(provider, "connected");
      // 063e 段 1-b（モック・一時）: チャンネルポイントは Twitch 限定なので **twitch のときだけ**出す
      //   （YouTube 側で出すと、実物には無い状態を見せることになる）。
      if (provider === "twitch") {
        output.broadcastMessage({
          type: CHANNEL_POINTS_STATE_FRAME,
          payload: { state: mockChannelPointsOk ? "receiving" : "unavailable" },
        });
        mockChannelPointsOk = !mockChannelPointsOk;
      }
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
        // 063e 段 1-b（モック・一時）: 止めたら「まだ分かりません」へ戻す（実物の stop-session と同じ向き）。
        if (frame.service === "twitch") {
          output.broadcastMessage({
            type: CHANNEL_POINTS_STATE_FRAME,
            payload: { state: "unknown" },
          });
        }
        logInfo(`[comment-sidecar][mock] ${frame.service} session stop (synthetic)`);
      }
    },
    stopAll(): void {
      for (const provider of [...timers.keys()]) clearProvider(provider);
    },
  };
}
