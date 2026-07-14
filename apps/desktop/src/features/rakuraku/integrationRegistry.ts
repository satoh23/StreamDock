import type { HostOs } from "../platform/useHostOs";

/**
 * 032a らくらくツール設定 の連携（integration）静的レジストリ。
 *
 * 親設計 032（docs/tasks/032-rakuraku-auto-setup-design.md）の決定 4（per-integration
 * アーキテクチャ）に基づき、連携を「やりたいことベース」の表示専用データとして定義する。
 *
 * 重要（032a の境界）: このファイルは **表示専用データのみ**で、検出・設定書換・疎通テスト等の
 * 実行ロジックは一切持たない。実際の連携実行（Rust コマンド・ループバック通信・設定書換）は
 * 032b で有効化する。`steps` も「表示用の定義」であり、ここから何かを実行することはない。
 */

/** OS 対応可否（一覧/詳細の OS 対応バッジの元）。 */
export type OsAvailability = "windows" | "macos" | "both";

/** 必要部品の導入方式。032a は表示のみ（guided=公式誘導 / auto=自動）。 */
export type ComponentSetup = "guided" | "auto";

/** 連携ステップの種別（scan→prepare→configure→register→verify）。032a では実行しない。 */
export type IntegrationStepKind =
  | "scan"
  | "prepare"
  | "configure"
  | "register"
  | "verify";

/** 連携に必要な外部部品（アプリ / プラグイン等）。 */
export interface RequiredComponent {
  /** 名称（例 "VOICEVOX" / "SAPI For VOICEVOX" / "棒読みちゃん"）。 */
  name: string;
  /**
   * 公式配布ページ URL。032a では **プレーンテキスト表示のみ**（開かない）。
   * 実際に開く導線（open_url）は 032b で有効化する。配布元 URL の最終確認も 032b で行うため、
   * 現時点で確定していない部品は省略し `note` で補足する。
   */
  officialUrl?: string;
  /** 導入方式（guided=公式へ誘導 / auto=自動）。032a は区別を表示するのみ。 */
  setup: ComponentSetup;
  /** 補足（例 "棒読みちゃん連携用は 32bit 版"）。 */
  note?: string;
}

/**
 * 全連携共通の免責文（同意画面で表示。連携ごとに持たず、ここを唯一のソースとして使い回す）。
 * 内容は連携非依存で、032 のセキュリティ方針（自己責任／変更前バックアップ・可逆な範囲／自動DL・実行しない／
 * 不可逆・昇格変更は誘導のみ）に沿う。032a では表示のみで何も実行しない。
 */
export const COMMON_DISCLAIMER =
  "らくらくツール設定は、配信ツールの設定を補助する機能です。外部アプリの設定を変更する場合は、変更前にバックアップを取り、元に戻せる範囲でのみ行います。インストーラの自動ダウンロード・実行や、システム全体に影響する不可逆・管理者権限を伴う変更は自動化せず、公式ページや付属ツールへの誘導にとどめます。各ツールの導入・利用はご自身の責任でお願いします。";

/** 同意/クレジットテンプレ（同意画面で表示。032a では表示のみで何も実行しない）。免責文は共通の COMMON_DISCLAIMER を使う。 */
export interface IntegrationConsent {
  /** 新規ダウンロードの可否（032 決定 1: 自動DLせず公式誘導のみ → false）。 */
  allowsDownload: boolean;
  /** 外部アプリ設定の上書き可否（032 決定 1: 棒読み設定のみ・バックアップ前提で可）。 */
  allowsConfigOverwrite: boolean;
  /** ずんだもんのクレジット表記義務（"VOICEVOX:ずんだもん" 必須）。連携固有。 */
  creditNotice: string;
}

/** 連携ステップの表示用定義（ラベルと説明のみ。実行しない）。 */
export interface IntegrationStep {
  kind: IntegrationStepKind;
  /** 表示名（例 "検出"）。 */
  label: string;
  /** 表示説明（何をするかの説明であって、ここでは実行しない）。 */
  description: string;
}

/** 1 連携の定義。 */
export interface Integration {
  /** 内部識別子（例 "bouyomi-voicevox"）。変更しない。 */
  id: string;
  /**
   * 一覧/詳細の左に出すアイコン（絵文字グリフ）。外部画像は読み込まず自己完結にするため
   * 暫定は絵文字。将来ローカルにバンドルした画像資産へ差し替え可（外部読込はしない）。
   */
  icon: string;
  /** やりたいこと（例「配信コメントをずんだもんの声で読ませる」）。 */
  title: string;
  /** 設定すると何ができるか（詳細画面の要約）。 */
  summary: string;
  /** メリットの箇条書き。 */
  benefits: readonly string[];
  /**
   * 詳細画面に埋め込む紹介動画の YouTube 動画 ID（11 桁）。
   * 設定時は youtube-nocookie の iframe でインライン再生する（未設定・不正時は「準備中」プレースホルダ）。
   * ※ アプリに動画を同梱すると容量が増えるため YouTube 埋め込みにしている（外部埋め込み・security-review 済み）。
   */
  demoVideoId?: string;
  /** OS 対応可否。 */
  osAvailability: OsAvailability;
  /** 必要な外部部品。 */
  requiredComponents: readonly RequiredComponent[];
  /** 前提（任意）。 */
  prerequisites?: readonly string[];
  /** 同意/免責テンプレ。 */
  consent: IntegrationConsent;
  /** ステップの表示用定義（scan→prepare→configure→register→verify）。実行しない。 */
  steps: readonly IntegrationStep[];
  /**
   * ワンクリック設定が実行可能か。032b で実行ロジックが入るまで false。
   * false の間は「ワンクリック設定」ボタンを無効化する（032a の器）。
   */
  executable: boolean;
}

export const INTEGRATION_REGISTRY: readonly Integration[] = [
  {
    id: "bouyomi-voicevox",
    icon: "🎙️",
    title: "配信コメントをずんだもんの声で読ませる",
    summary:
      "棒読みちゃんとVOICEVOXで連携し、棒読みちゃんが読み上げる声をずんだもんにします。",
    benefits: [
      "配信に届いたコメントが、ずんだもんの声で読み上げられます。",
      "配信画面に集中していても、コメントを声で把握できます。",
      "ずんだもんの声で、配信に親しみやすい雰囲気を出せます。",
    ],
    // demoVideoId: "XXXXXXXXXXX", // TODO: YouTube 動画 ID（11 桁）を設定するとインライン再生。未設定時は「準備中」表示。
    osAvailability: "windows",
    requiredComponents: [
      {
        name: "VOICEVOX",
        officialUrl: "https://voicevox.hiroshiba.jp/",
        setup: "guided",
        note: "ずんだもんの音声エンジン。ローカルで音声を生成します。",
      },
      {
        name: "SAPI For VOICEVOX",
        setup: "guided",
        note: "第三者製プラグイン。ずんだもんを Windows の音声（SAPI5）として登録します。棒読みちゃん連携用は 32bit 版。配布元・入手手順は 032b で確定します。",
      },
      {
        name: "棒読みちゃん",
        officialUrl: "https://chi.usamimi.info/Program/Application/BouyomiChan/",
        setup: "guided",
        note: "Windows 専用の読み上げソフト。「声質」でずんだもんを選びます。",
      },
    ],
    prerequisites: [
      "Windows 環境（棒読みちゃんは Windows 専用のため、この連携は Windows 限定です）。",
      "VOICEVOX・SAPI For VOICEVOX・棒読みちゃんを導入できること（未導入の場合は公式ページへ誘導します）。",
      "SAPI 音声登録は付属の登録ツールで行います（システムへの登録・昇格を伴うため自動化しません）。",
    ],
    consent: {
      allowsDownload: false,
      allowsConfigOverwrite: true,
      creditNotice:
        "ずんだもんの音声を使う配信・動画では「VOICEVOX:ずんだもん」のクレジット表記が必須です（VOICEVOX 利用規約 https://voicevox.hiroshiba.jp/term/ に準拠）。",
    },
    steps: [
      {
        kind: "scan",
        label: "検出",
        description:
          "VOICEVOX・棒読みちゃんの導入状況、ずんだもんの音声登録、VOICEVOX の起動を確認します（読み取りのみ）。",
      },
      {
        kind: "prepare",
        label: "導入準備",
        description:
          "不足している部品があれば公式ページを開いて導入を案内します（自動ダウンロード・実行はしません）。",
      },
      {
        kind: "configure",
        label: "設定書換",
        description:
          "棒読みちゃんの設定をバックアップしてから、ずんだもんの声で読み上げる設定に書き換えます。",
      },
      {
        kind: "register",
        label: "音声登録",
        description:
          "ずんだもんを Windows の音声として登録します。付属の登録ツールで行うよう案内します（自動化しません）。",
      },
      {
        kind: "verify",
        label: "疎通テスト",
        description:
          "テスト文を棒読みちゃんに送り、ずんだもんの声で読み上げられるか確認します。",
      },
    ],
    // 032b で Rust 実行ロジック（scan/configure/verify）を配線したため true。
    // 実処理は Windows 専用で、非対応 OS では実行画面が「Windows でご利用いただけます」を表示する。
    executable: true,
  },
];

/** OS 対応バッジの表示ラベル。 */
export function osAvailabilityLabel(availability: OsAvailability): string {
  switch (availability) {
    case "windows":
      return "Windows専用";
    case "macos":
      return "Mac専用";
    case "both":
      return "両OS対応";
  }
}

/** 対応 OS の呼び名（「この機能は◯◯でご利用いただけます」の◯◯）。 */
export function supportedOsName(availability: OsAvailability): string {
  switch (availability) {
    case "windows":
      return "Windows";
    case "macos":
      return "Mac";
    case "both":
      return "Windows と Mac";
  }
}

/**
 * 現在の OS がこの連携に対応しているか。
 * hostOs が null（判定前・判定失敗）のときは「不明」＝安全側で非対応扱い（無効化）にする。
 */
export function isOsSupported(
  availability: OsAvailability,
  hostOs: HostOs,
): boolean {
  if (hostOs === null || hostOs === undefined) return false;
  if (availability === "both") return true;
  return availability === hostOs;
}
