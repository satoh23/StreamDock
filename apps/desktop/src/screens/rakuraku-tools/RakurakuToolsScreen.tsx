import { useState } from "react";
import type { HostOs } from "../../features/platform/useHostOs";
import {
  COMMON_DISCLAIMER,
  INTEGRATION_REGISTRY,
  isOsSupported,
  osAvailabilityLabel,
  supportedOsName,
  type Integration,
  type OsAvailability,
} from "../../features/rakuraku/integrationRegistry";
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

export function RakurakuToolsScreen({ hostOs }: { hostOs: HostOs }) {
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
        onBack={() => setView({ stage: "detail", id: current.id })}
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

/** (2) 詳細: アイコン＋タイトル、対応 OS バッジ、動画プレビュー枠、統合カード、CTA。 */
function DetailView({
  integration,
  onBack,
  onProceed,
}: {
  integration: Integration;
  onBack: () => void;
  onProceed: () => void;
}) {
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

        {/* 導入後のイメージ動画（後で差し込む器。動画ファイルの読込は行わない）。 */}
        <div className={styles.videoPlaceholder}>
          <span className={styles.videoPlayIcon} aria-hidden="true">
            <PlayIcon />
          </span>
          <span className={styles.videoCaption}>動画プレビュー（準備中）</span>
          <span className={styles.videoSub}>
            設定後にどうなるかを、あとで動画でご確認いただけます。
          </span>
        </div>

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
          <Button type="button" variant="primary" onClick={onProceed}>
            確認画面に進む
          </Button>
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
            この段階では設定は実行されません。実行画面の枠組みを確認できます（Windows で 032b
            実装後に有効化）。
          </p>
          <Button type="button" variant="primary" onClick={onAgree}>
            同意する
          </Button>
        </div>
      </div>
    </>
  );
}

/** (4) 実行: ステップ進捗の器（全ステップ待機）＋「準備中」表示。何も実行しない。 */
function ExecutionView({
  integration,
  onBack,
}: {
  integration: Integration;
  onBack: () => void;
}) {
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
            🚧
          </span>
          <div>
            <p className={styles.preparingTitle}>準備中</p>
            <p className={styles.preparingDesc}>
              自動設定は Windows で 032b 実装後に有効化されます。ここでは実行の流れ（枠組み）だけを
              表示しており、設定の変更や通信は行いません。
            </p>
          </div>
        </div>

        <ol className={styles.steps}>
          {integration.steps.map((step, i) => (
            <li key={step.kind} className={styles.step}>
              <span className={styles.stepIndex} aria-hidden="true">
                {i + 1}
              </span>
              <div className={styles.stepBody}>
                <div className={styles.stepHead}>
                  <span className={styles.stepLabel}>{step.label}</span>
                  <span className={styles.stepState}>待機</span>
                </div>
                <span className={styles.stepDesc}>{step.description}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
