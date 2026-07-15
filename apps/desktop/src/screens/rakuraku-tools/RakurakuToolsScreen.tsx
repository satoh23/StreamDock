import { Fragment, useState } from "react";
import type { HostOs } from "../../features/platform/useHostOs";
import {
  COMMON_DISCLAIMER,
  INTEGRATION_REGISTRY,
  isOsSupported,
  osAvailabilityLabel,
  supportedOsName,
  type Integration,
  type IntegrationStepKind,
  type OsAvailability,
} from "../../features/rakuraku/integrationRegistry";
import {
  launchComponent,
  openOfficialPage,
  scanIntegration,
} from "../../features/rakuraku/rakurakuApi";
import type { ScanResult } from "../../features/rakuraku/types";
import { Button } from "../../components/primitives";
import layout from "../formLayout.module.css";
import styles from "./RakurakuToolsScreen.module.css";

/**
 * 032a らくらくツール設定 画面枠組み（器）。
 *
 * 一覧 → 詳細 → 同意 → 実行 の 4 段を、Screen union を増やさず **この画面内のローカル state**
 * （判別可能ユニオン）で管理する。実際の連携実行（検出・設定書換・疎通テスト）は 032b で有効化する。
 * この画面は **invoke・副作用を一切持たない**（同意/免責は表示のみ、実行画面は「準備中」の器）。
 */
type View =
  | { stage: "list" }
  | { stage: "detail"; id: string }
  | { stage: "consent"; id: string }
  | { stage: "execution"; id: string };

export function RakurakuToolsScreen({
  hostOs,
  onRequestAddTool,
}: {
  hostOs: HostOs;
  /** 未登録部品を「ツール管理へ追加」で登録する導線（App が AddToolScreen へ遷移・名称プリフィル）。 */
  onRequestAddTool?: (prefill: { name: string }) => void;
}) {
  const [view, setView] = useState<View>({ stage: "list" });

  // 一覧以外は id から連携を引く。見つからなければ一覧へフォールバック。
  const current =
    view.stage === "list"
      ? null
      : (INTEGRATION_REGISTRY.find((i) => i.id === view.id) ?? null);

  if (view.stage !== "list" && current === null) {
    return <ListView hostOs={hostOs} onOpen={(id) => setView({ stage: "detail", id })} />;
  }

  if (view.stage === "detail" && current) {
    return (
      <DetailView
        integration={current}
        hostOs={hostOs}
        onBack={() => setView({ stage: "list" })}
        onProceed={() => setView({ stage: "consent", id: current.id })}
      />
    );
  }

  if (view.stage === "consent" && current) {
    return (
      <ConsentView
        integration={current}
        onBack={() => setView({ stage: "detail", id: current.id })}
        onAgree={() => setView({ stage: "execution", id: current.id })}
      />
    );
  }

  if (view.stage === "execution" && current) {
    return (
      <ExecutionView
        integration={current}
        hostOs={hostOs}
        onBack={() => setView({ stage: "detail", id: current.id })}
        onRequestAddTool={onRequestAddTool}
      />
    );
  }

  return <ListView hostOs={hostOs} onOpen={(id) => setView({ stage: "detail", id })} />;
}

/* --- インライン SVG（外部リソースを読み込まず自己完結。currentColor でテーマ追従） --- */

/** Windows ロゴ風の 4 タイル。 */
function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" />
    </svg>
  );
}

/** Apple ロゴ。 */
function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.37 1.43c0 1.06-.4 2.06-1.1 2.79-.75.83-1.96 1.46-2.95 1.38-.12-1.03.42-2.13 1.06-2.82.72-.78 1.98-1.36 2.99-1.35zM20.5 17.2c-.53 1.22-.79 1.77-1.47 2.85-.96 1.5-2.31 3.38-3.98 3.4-1.48.02-1.86-.97-3.87-.96-2.01.01-2.43.94-3.91.98-1.61.03-2.83-1.62-3.8-3.12C-.5 15.36-.87 9.5 2.4 6.9c1.18-.94 2.55-1.2 3.5-1.2 1.79 0 2.9.98 4.38.98 1.43 0 2.3-.98 4.37-.98.85 0 3.23.13 4.79 2.6-3.87 2.13-3.24 7.65.06 8.9z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** 連携アイコン（絵文字タイル。将来ローカル画像へ差し替え可）。 */
function IntegrationIcon({ icon, large = false }: { icon: string; large?: boolean }) {
  return (
    <span
      className={`${styles.iconTile} ${large ? styles.iconTileLg : ""}`}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}

/** OS 対応バッジ（対応 OS のアイコン＋ラベル）。 */
function OsBadge({
  availability,
  label,
}: {
  availability: OsAvailability;
  label: string;
}) {
  return (
    <span className={`${styles.osBadge} ${styles[availability]}`}>
      <span className={styles.osBadgeIcon}>
        {availability === "windows" && <WindowsIcon />}
        {availability === "macos" && <AppleIcon />}
        {availability === "both" && (
          <>
            <WindowsIcon />
            <AppleIcon />
          </>
        )}
      </span>
      {label}
    </span>
  );
}

/** 画面ヘッダー（タイトル＋任意サブテキスト＋右上「戻る」）。 */
function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel = "戻る",
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className={layout.top}>
      <div className={`${layout.title} ${layout.pageTitle}`}>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {onBack && (
        <div className={layout.actions}>
          <Button type="button" onClick={onBack}>
            ← {backLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** (1) 一覧: アイコン＋タイトル＋説明＋対応 OS の連携カード。右下に「詳細を見る」。 */
function ListView({
  hostOs,
  onOpen,
}: {
  hostOs: HostOs;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <PageHeader
        title="らくらくツール設定"
        subtitle="やりたいことを選ぶと、必要な設定をまとめて確認できます。"
      />
      <div className={styles.list}>
        {INTEGRATION_REGISTRY.map((integration) => {
          const supported = isOsSupported(integration.osAvailability, hostOs);
          return (
            <div key={integration.id} className={styles.card}>
              <IntegrationIcon icon={integration.icon} large />
              <div className={styles.cardBody}>
                <span className={styles.cardTitle}>{integration.title}</span>
                <span className={styles.cardSummary}>{integration.summary}</span>
                <div className={styles.osRow}>
                  <span className={styles.osRowLabel}>対応OS</span>
                  <OsBadge
                    availability={integration.osAvailability}
                    label={supportedOsName(integration.osAvailability)}
                  />
                </div>
                {!supported && (
                  <span className={styles.cardNote}>
                    この機能は{supportedOsName(integration.osAvailability)}
                    でご利用いただけます。
                  </span>
                )}
              </div>
              <div className={styles.cardAction}>
                <Button type="button" onClick={() => onOpen(integration.id)}>
                  詳細を見る →
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** YouTube 動画 ID の形式（11 桁の英数・ハイフン・アンダースコア）。不正値を src に載せないための多層防御。 */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** (2) 詳細: アイコン＋タイトル、対応 OS バッジ、動画プレビュー枠、統合カード、CTA。 */
function DetailView({
  integration,
  hostOs,
  onBack,
  onProceed,
}: {
  integration: Integration;
  hostOs: HostOs;
  onBack: () => void;
  onProceed: () => void;
}) {
  const supported = isOsSupported(integration.osAvailability, hostOs);
  // 有効な YouTube 動画 ID があれば iframe 埋め込み、無ければ「準備中」プレースホルダ。
  const videoId =
    integration.demoVideoId && YOUTUBE_ID_RE.test(integration.demoVideoId)
      ? integration.demoVideoId
      : null;
  return (
    <>
      <div className={layout.top}>
        <div className={styles.detailTitleWrap}>
          <IntegrationIcon icon={integration.icon} large />
          <div className={`${layout.title} ${layout.pageTitle}`}>
            <h2>{integration.title}</h2>
          </div>
        </div>
        <div className={layout.actions}>
          <Button type="button" onClick={onBack}>
            ← 一覧へ戻る
          </Button>
        </div>
      </div>

      <div className={styles.stack}>
        <div className={styles.osBadgeRow}>
          <OsBadge
            availability={integration.osAvailability}
            label={osAvailabilityLabel(integration.osAvailability)}
          />
        </div>

        {/* 導入後のイメージ動画。ID があれば YouTube(youtube-nocookie) をインライン埋め込み、無ければ準備中の器。 */}
        {videoId ? (
          <div className={styles.videoFrame}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0`}
              title={`${integration.title} の紹介動画`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className={styles.videoPlaceholder}>
            <span className={styles.videoPlayIcon} aria-hidden="true">
              <PlayIcon />
            </span>
            <span className={styles.videoCaption}>動画プレビュー（準備中）</span>
            <span className={styles.videoSub}>
              設定後にどうなるかを、あとで動画でご確認いただけます。
            </span>
          </div>
        )}

        {/* 各セクションを 1 枚のカードに統合。横線は使わず余白で区切る。 */}
        <section className={layout.panel}>
          <div className={`${layout.panelBody} ${styles.infoStack}`}>
            <div className={styles.infoBlock}>
              <h3 className={styles.infoSubTitle}>できること</h3>
              <ul className={styles.bullets}>
                {integration.benefits.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>

            <div className={styles.infoBlock}>
              <h3 className={styles.infoSubTitle}>必要なもの</h3>
              <ul className={styles.components}>
                {integration.requiredComponents.map((c) => (
                  <li key={c.name} className={styles.component}>
                    <div className={styles.componentHead}>
                      <span className={styles.componentName}>{c.name}</span>
                      <span className={styles.setupTag}>
                        {c.setup === "guided" ? "公式へ案内" : "自動"}
                      </span>
                    </div>
                    {c.note && (
                      <span className={styles.componentNote}>{c.note}</span>
                    )}
                    {c.officialUrl && (
                      <span className={styles.componentUrl}>公式: {c.officialUrl}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {integration.prerequisites && integration.prerequisites.length > 0 && (
              <div className={styles.infoBlock}>
                <h3 className={styles.infoSubTitle}>前提</h3>
                <ul className={styles.bullets}>
                  {integration.prerequisites.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        <div className={styles.ctaArea}>
          <Button
            type="button"
            variant="primary"
            onClick={onProceed}
            disabled={!supported}
          >
            確認画面に進む
          </Button>
          {!supported && (
            <span className={styles.ctaDisabledNote}>
              (このOSでは利用できません)
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/** (3) 同意: consent テンプレ（新規DL・設定上書き・免責・ずんだもんクレジット義務）。 */
function ConsentView({
  integration,
  onBack,
  onAgree,
}: {
  integration: Integration;
  onBack: () => void;
  onAgree: () => void;
}) {
  const { consent } = integration;
  return (
    <>
      <PageHeader
        title="設定内容の確認と同意"
        subtitle="ワンクリック設定を始める前に、以下の内容をご確認ください。"
        onBack={onBack}
        backLabel="詳細へ戻る"
      />

      <div className={styles.stack}>
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>この設定で行うこと</h3>
          </div>
          <div className={layout.panelBody}>
            <ul className={styles.consentList}>
              <li>
                <span className={styles.consentLabel}>新規ダウンロード</span>
                <span className={styles.consentValue}>
                  {consent.allowsDownload
                    ? "あり"
                    : "しません（不足アプリは公式ページへ案内するのみ）"}
                </span>
              </li>
              <li>
                <span className={styles.consentLabel}>設定の上書き</span>
                <span className={styles.consentValue}>
                  {consent.allowsConfigOverwrite
                    ? "あり（棒読みちゃんの設定のみ・バックアップを取ってから変更）"
                    : "しません"}
                </span>
              </li>
              <li>
                <span className={styles.consentLabel}>アプリの自動起動</span>
                <span className={styles.consentValue}>
                  {consent.allowsAutoLaunch
                    ? "あり（未起動の VOICEVOX・棒読みちゃんを起動します。ダウンロード・インストールはしません）"
                    : "しません"}
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>免責事項</h3>
          </div>
          <div className={layout.panelBody}>
            <p className={styles.consentText}>{COMMON_DISCLAIMER}</p>
          </div>
        </section>

        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3 className={styles.creditHeading}>クレジット表記のお願い（必須）</h3>
          </div>
          <div className={layout.panelBody}>
            <p className={styles.creditText}>{consent.creditNotice}</p>
          </div>
        </section>

        <div className={styles.ctaArea}>
          <p className={styles.ctaReason}>
            同意すると実行画面に進みます。ワンクリック設定（検出・自動起動・設定書換・疎通確認）は
            Windows でご利用いただけます。
          </p>
          <Button type="button" variant="primary" onClick={onAgree}>
            同意する
          </Button>
        </div>
      </div>
    </>
  );
}

/* --- (4) 実行: scan → configure → verify を順に invoke するライブフロー（032b 配線） --- */

/**
 * 各ステップの実行状態。
 * `error`=実行して失敗 / `blocked`=前の手順が失敗したため実行しなかった（＝成功扱いにしない）。
 */
type StepRunState =
  | "waiting"
  | "running"
  | "done"
  | "skipped"
  | "error"
  | "blocked"
  | "info";

const STEP_STATE_LABEL: Record<StepRunState, string> = {
  waiting: "待機",
  running: "実行中…",
  done: "完了",
  skipped: "スキップ",
  error: "失敗",
  blocked: "未実行",
  info: "確認",
};

const STEP_STATE_CLASS: Record<StepRunState, string> = {
  waiting: "",
  running: styles.stepStateRunning,
  done: styles.stepStateDone,
  skipped: styles.stepStateSkipped,
  error: styles.stepStateError,
  blocked: styles.stepStateBlocked,
  info: styles.stepStateInfo,
};

/**
 * 自動起動後、両アプリの起動を確認するための scan 再ポーリング（VOICEVOX エンジンは起動に数秒かかる）。
 * 待ち時間の上限は概ね 15 回 ×（1s ＋ scan の connect timeout）。両方起動すれば即抜けるため通常は短く、
 * 起動しない最悪ケースでも await 中は「実行中」表示のままで UI は固まらない（実行ボタンは disabled）。
 * 体感の長さが問題化したら attempts/interval か scan 側の connect timeout を見直す。
 */
const LAUNCH_POLL_ATTEMPTS = 15;
const LAUNCH_POLL_INTERVAL_MS = 1000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rust の AppError（`{ code, message, ... }`）から安全な表示メッセージを取り出す。 */
function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim().length > 0) return m;
  }
  return "処理に失敗しました。しばらくしてからお試しください。";
}

/** 導入状況の表示ラベル（installed: true=導入済み / false=未導入 / null=不明）。 */
function installedLabel(installed: boolean | null | undefined): {
  text: string;
  className: string;
} {
  if (installed === true) return { text: "導入済み", className: styles.compYes };
  if (installed === false) return { text: "未導入", className: styles.compNo };
  return { text: "未確認", className: styles.compUnknown };
}

/**
 * ワンクリック設定の実行画面（器）。
 *
 * 「設定を実行する」で scan → 導入準備 → 起動 を順に Rust の限定コマンドへ invoke する
 * （進捗は逐次戻り値で管理し Tauri event は使わない）。導入準備（prepare）と音声登録（register）は
 * ガイド（実行しない）で、scan 結果の公式ページ導線・付属ツール案内として表示する。
 * 032c-a: 方針転換で棒読み設定書換（configure）・ループバック疎通（verify）の実行経路は撤去した。
 * 現時点で登録済み連携は無く（INTEGRATION_REGISTRY は空）この画面は到達しないが、器として温存する。
 * 実処理は Windows 専用のため、非対応 OS では実行せず「Windows でご利用いただけます」を表示する（多重防御）。
 */
function ExecutionView({
  integration,
  hostOs,
  onBack,
  onRequestAddTool,
}: {
  integration: Integration;
  hostOs: HostOs;
  onBack: () => void;
  onRequestAddTool?: (prefill: { name: string }) => void;
}) {
  const supported = isOsSupported(integration.osAvailability, hostOs);
  const canRun = integration.executable && supported;

  const buildInitialStates = (): Record<IntegrationStepKind, StepRunState> => {
    const states = {} as Record<IntegrationStepKind, StepRunState>;
    for (const step of integration.steps) states[step.kind] = "waiting";
    return states;
  };

  const [states, setStates] = useState<Record<IntegrationStepKind, StepRunState>>(
    buildInitialStates,
  );
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const setStep = (kind: IntegrationStepKind, state: StepRunState) =>
    setStates((prev) => ({ ...prev, [kind]: state }));

  /** `kind` より後（後続）の未実行ステップを「未実行（blocked）」にし、失敗の波及を明示する。 */
  const blockAfter = (kind: IntegrationStepKind) =>
    setStates((prev) => {
      const idx = integration.steps.findIndex((s) => s.kind === kind);
      const next = { ...prev };
      integration.steps.forEach((s, i) => {
        if (i > idx && next[s.kind] === "waiting") next[s.kind] = "blocked";
      });
      return next;
    });

  async function runAll() {
    setRunning(true);
    setHasRun(true);
    setErrorMsg(null);
    setScan(null);
    setStates(buildInitialStates());
    try {
      // 1. 検出（読み取り専用）。未対応 OS はここで中断し、以降を「未実行」にする。
      setStep("scan", "running");
      const s = await scanIntegration(integration.id);
      setScan(s);
      if (!s.supported) {
        setStep("scan", "error");
        blockAfter("scan");
        setErrorMsg(s.message ?? "この連携は Windows でご利用いただけます。");
        return;
      }
      setStep("scan", "done");

      // 2. 導入準備（ガイド）。ツール管理へ登録できる部品（voicevox / 棒読みちゃん）が未登録/パス無効なら
      //    「ツール管理へ追加」導線を出して中断する（登録・導入は自動化しない＝登録後に再実行）。
      //    installed===false は未登録またはパス無効。null（不明）は best-effort で先へ進める。
      //    SAPI For VOICEVOX はツール管理登録の対象外（付属 setup.exe での音声登録が正）で、未導入でも通常
      //    installed===false になる。gate に含めると「ツール管理へ登録」しても抜けられない行き止まりになるため
      //    ここでは中断せず、register ステップ／公式ページ導線でガイドする。
      const missing = s.components.filter(
        (c) =>
          c.installed === false &&
          (c.key === "voicevox" || c.key === "bouyomichan"),
      );
      if (missing.length > 0) {
        setStep("prepare", "error");
        blockAfter("prepare");
        setErrorMsg(
          "ツール管理に未登録の部品があります。ツール管理へ登録したうえで、もう一度実行してください。",
        );
        return;
      }
      setStep("prepare", "done");

      // 3. 音声登録（ガイド・実行しない）: 付属ツールでの SAPI 登録を案内する。
      setStep("register", "info");

      // 4. 起動。VOICEVOX・棒読みちゃんの両方が起動している必要があるため、未起動なら自動起動して
      //    起動を待つ（既導入アプリの起動のみ＝DL/インストールはしない）。両方の起動を確認できなければ中断する。
      setStep("launch", "running");
      const running = await ensureRunning(s);
      if (!running.engineRunning || !running.bouyomiRunning) {
        setStep("launch", "error");
        blockAfter("launch");
        setErrorMsg(
          "VOICEVOX・棒読みちゃんの起動を確認できませんでした。手動で起動してから、もう一度実行してください。",
        );
        return;
      }
      setStep("launch", "done");
    } catch (e) {
      setErrorMsg(errorMessage(e));
      // 実行中だったステップを失敗にし、まだ待機中の後続を「未実行」にする。
      setStates((prev) => {
        const next = { ...prev };
        for (const kind of Object.keys(next) as IntegrationStepKind[]) {
          if (next[kind] === "running") next[kind] = "error";
          else if (next[kind] === "waiting") next[kind] = "blocked";
        }
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  async function openPage(component: string) {
    // 公式ページを開くのは best-effort（失敗しても実行フローは止めない）。
    try {
      await openOfficialPage(integration.id, component);
    } catch {
      /* 誘導のみ・失敗は無視 */
    }
  }

  /**
   * 未起動の VOICEVOX / 棒読みちゃんを自動起動し、両方が起動するまで scan を再ポーリングする。
   * 既導入アプリの起動のみ（DL/インストールはしない）。起動要求の失敗は握りつぶし、起動状態は
   * 再検出（scan）を唯一の真実として判断する。timeout までに両方起動しなければ最後の scan を返す。
   */
  async function ensureRunning(initial: ScanResult): Promise<ScanResult> {
    let latest = initial;
    if (latest.engineRunning && latest.bouyomiRunning) return latest;

    // 未起動の部品だけ起動要求する（既に起動中のものは二重起動しない）。
    if (!latest.engineRunning) {
      await launchComponent(integration.id, "voicevox").catch(() => undefined);
    }
    if (!latest.bouyomiRunning) {
      await launchComponent(integration.id, "bouyomichan").catch(() => undefined);
    }

    // 起動待ち（VOICEVOX エンジンは起動に数秒かかる）。両方起動したら即抜ける。
    for (
      let i = 0;
      i < LAUNCH_POLL_ATTEMPTS &&
      (!latest.engineRunning || !latest.bouyomiRunning);
      i++
    ) {
      await delay(LAUNCH_POLL_INTERVAL_MS);
      latest = await scanIntegration(integration.id);
      setScan(latest);
    }
    return latest;
  }

  // 非対応 OS（棒読みちゃんは Windows 専用）では実行しない。
  if (!canRun) {
    return (
      <>
        <PageHeader
          title="ワンクリック設定"
          subtitle={integration.title}
          onBack={onBack}
          backLabel="詳細へ戻る"
        />
        <div className={styles.stack}>
          <div className={styles.preparingBanner}>
            <span className={styles.preparingIcon} aria-hidden="true">
              🪟
            </span>
            <div>
              <p className={styles.preparingTitle}>
                この機能は{supportedOsName(integration.osAvailability)}でご利用いただけます
              </p>
              <p className={styles.preparingDesc}>
                {integration.title}
                は{supportedOsName(integration.osAvailability)}
                専用です。現在の OS では実行できません。
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="ワンクリック設定"
        subtitle={integration.title}
        onBack={onBack}
        backLabel="詳細へ戻る"
      />

      <div className={styles.stack}>
        <div className={styles.runArea}>
          <Button
            type="button"
            variant="primary"
            onClick={runAll}
            disabled={running}
          >
            {running ? "実行中…" : hasRun ? "もう一度実行する" : "設定を実行する"}
          </Button>
        </div>

        {errorMsg && <p className={styles.errorBanner}>{errorMsg}</p>}

        <ol className={styles.steps}>
          {integration.steps.map((step, i) => {
            const state = states[step.kind];
            return (
              <li key={step.kind} className={styles.step}>
                <span className={styles.stepIndex} aria-hidden="true">
                  {i + 1}
                </span>
                <div className={styles.stepBody}>
                  <div className={styles.stepHead}>
                    <span className={styles.stepLabel}>{step.label}</span>
                    <span className={`${styles.stepState} ${STEP_STATE_CLASS[state]}`}>
                      {STEP_STATE_LABEL[state]}
                    </span>
                  </div>
                  <span className={styles.stepDesc}>{step.description}</span>

                  {/* 検出結果: 部品ごとの導入状況＋VOICEVOX 稼働。 */}
                  {step.kind === "scan" && scan && (
                    <div className={styles.stepResult}>
                      <ul className={styles.stepComponents}>
                        {scan.components.map((c) => {
                          const label = installedLabel(c.installed);
                          return (
                            <li key={c.key} className={styles.stepComponent}>
                              <span className={styles.compName}>{c.name}</span>
                              <span className={label.className}>{label.text}</span>
                            </li>
                          );
                        })}
                        <li className={styles.stepComponent}>
                          <span className={styles.compName}>VOICEVOX の起動</span>
                          <span
                            className={
                              scan.engineRunning ? styles.compYes : styles.compNo
                            }
                          >
                            {scan.engineRunning ? "起動中" : "未起動"}
                          </span>
                        </li>
                        <li className={styles.stepComponent}>
                          <span className={styles.compName}>
                            棒読みちゃんの起動
                          </span>
                          <span
                            className={
                              scan.bouyomiRunning ? styles.compYes : styles.compNo
                            }
                          >
                            {scan.bouyomiRunning ? "起動中" : "未起動"}
                          </span>
                        </li>
                      </ul>
                    </div>
                  )}

                  {/* 導入準備（ガイド）: 未登録/未導入の部品に「ツール管理へ追加」＋公式ページ導線を
                      出す（自動DL・自動登録はしない）。VOICEVOX/棒読みちゃんは登録対象、SAPI は誘導のみ。 */}
                  {step.kind === "prepare" && scan && (
                    <div className={styles.stepResult}>
                      {scan.components.filter(
                        (c) => c.hasOfficialPage && c.installed !== true,
                      ).length === 0 ? (
                        <span className={styles.resultNote}>
                          追加で導入が必要な部品はありません。
                        </span>
                      ) : (
                        <div className={styles.guideActions}>
                          {scan.components
                            .filter((c) => c.hasOfficialPage && c.installed !== true)
                            .map((c) => {
                              // VOICEVOX / 棒読みちゃんは「ツール」として登録できる（SAPI は起動対象でも
                              // 登録ツールでもないため誘導のみ）。
                              const canAddTool =
                                !!onRequestAddTool &&
                                (c.key === "voicevox" || c.key === "bouyomichan");
                              return (
                                <Fragment key={c.key}>
                                  {canAddTool && (
                                    <Button
                                      type="button"
                                      onClick={() => onRequestAddTool?.({ name: c.name })}
                                    >
                                      {c.name} をツール管理へ追加
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    onClick={() => openPage(c.key)}
                                  >
                                    {c.name} の公式ページを開く
                                  </Button>
                                </Fragment>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
