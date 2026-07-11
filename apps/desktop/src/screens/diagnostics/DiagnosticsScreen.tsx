import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { AppLogEntry, DiagnosticSummary, LogLevel } from "../../features/logs/types";
import {
  clearAppLogs,
  getDiagnosticSummary,
} from "../../features/logs/logsApi";
import { useLogs } from "../../features/logs/useLogs";
import { toErrorMessage } from "../../features/tools/useTools";
import { Button } from "../../components/primitives";
import layout from "../formLayout.module.css";
import styles from "./DiagnosticsScreen.module.css";

const LEVEL_LABELS: Record<LogLevel, string> = {
  info: "情報",
  warn: "警告",
  error: "エラー",
};

/** RFC3339 の時刻をロケール表記にする（パースできなければ原文をそのまま表示）。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** 共有用の診断サマリーをプレーンテキストに整形する（full path / 環境変数は含まれない）。 */
function buildSummaryText(summary: DiagnosticSummary): string {
  const lines: string[] = [];
  lines.push("stream-dock 診断サマリー");
  lines.push(`生成日時: ${formatTime(summary.generatedAt)}`);
  lines.push(`アプリバージョン: ${summary.appVersion}`);
  lines.push("");

  const logLine = (e: AppLogEntry) => {
    const parts = [`- [${formatTime(e.occurredAt)}]`, `${e.category}/${e.operation}`, e.message];
    if (e.errorCode) parts.push(`(${e.errorCode})`);
    return parts.join(" ");
  };

  lines.push(`【直近のエラー】(${summary.recentErrors.length}件)`);
  if (summary.recentErrors.length === 0) lines.push("- なし");
  else summary.recentErrors.forEach((e) => lines.push(logLine(e)));
  lines.push("");

  lines.push(`【直近の警告】(${summary.recentWarnings.length}件)`);
  if (summary.recentWarnings.length === 0) lines.push("- なし");
  else summary.recentWarnings.forEach((e) => lines.push(logLine(e)));
  lines.push("");

  lines.push(`【起動中のプロセス】(${summary.runtimeProcesses.length}件)`);
  if (summary.runtimeProcesses.length === 0) lines.push("- なし");
  else
    summary.runtimeProcesses.forEach((p) =>
      lines.push(`- ${p.toolName}: ${p.status} (pid ${p.processId})`),
    );

  return lines.join("\n");
}

function LevelBadge({ level }: { level: LogLevel }) {
  return (
    <span className={`${styles.level} ${styles[level]}`}>{LEVEL_LABELS[level]}</span>
  );
}

function LogRow({ entry }: { entry: AppLogEntry }) {
  return (
    <div className={styles.logRow}>
      <div className={styles.logHead}>
        <LevelBadge level={entry.level} />
        <span className={styles.logCategory}>{entry.category}</span>
        <span className={styles.logOp}>{entry.operation}</span>
        {entry.errorCode && <span className={styles.code}>{entry.errorCode}</span>}
        <span className={styles.logTime}>{formatTime(entry.occurredAt)}</span>
      </div>
      <div className={styles.logMsg}>{entry.message}</div>
      {(entry.toolName || entry.presetName) && (
        <div className={styles.logRefs}>
          {entry.toolName && <span>ツール: {entry.toolName}</span>}
          {entry.presetName && <span>プリセット: {entry.presetName}</span>}
        </div>
      )}
    </div>
  );
}

export function DiagnosticsScreen() {
  const { logs, error: logsError, reload: reloadLogs } = useLogs();
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // 「コピーしました」表示を戻すタイマー。アンマウント時に確実に片付ける。
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getDiagnosticSummary());
      setSummaryError(null);
    } catch (e) {
      setSummaryError(toErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const reloadAll = useCallback(async () => {
    await Promise.all([reloadLogs(), loadSummary()]);
  }, [reloadLogs, loadSummary]);

  const recentErrors = summary?.recentErrors ?? [];
  const summaryText = useMemo(
    () => (summary ? buildSummaryText(summary) : ""),
    [summary],
  );
  const error = logsError ?? summaryError;

  const handleClear = async () => {
    const ok = await ask("記録されたログをすべて削除しますか？", {
      title: "ログの削除",
      kind: "warning",
    });
    if (!ok) return;
    try {
      await clearAppLogs();
      await reloadAll();
    } catch (e) {
      setSummaryError(toErrorMessage(e));
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      // 連打時に多重タイマーが走らないよう、前回分をクリアしてから張り替える。
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボード API が使えない環境では textarea を選択してユーザーが手動コピーできるようにする。
      textareaRef.current?.select();
    }
  };

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>診断 / ログ</h2>
          <p>問題が起きたときの直近ログと、開発者に共有できる診断サマリーを確認できます。</p>
        </div>
        <div className={layout.actions}>
          <Button onClick={() => void reloadAll()}>再読込</Button>
        </div>
      </div>

      {error && <div className={layout.error}>{error}</div>}

      <div className={styles.stack}>
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>直近のエラー</h3>
            <p>最近発生したエラーを表示します。</p>
          </div>
          <div className={layout.panelBody}>
            {recentErrors.length === 0 ? (
              <div className={styles.empty}>直近のエラーはありません。</div>
            ) : (
              <div className={styles.logList}>
                {recentErrors.map((e) => (
                  <LogRow key={e.id} entry={e} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>ログ</h3>
            <p>直近の操作ログ（最新順）。stack trace やフルパスは表示しません。</p>
          </div>
          <div className={layout.panelBody}>
            {logs.length === 0 ? (
              <div className={styles.empty}>ログはまだありません。</div>
            ) : (
              <div className={styles.logList}>
                {logs.map((e) => (
                  <LogRow key={e.id} entry={e} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>診断サマリー</h3>
            <p>下のテキストをコピーして開発者に共有できます。危険な情報は含まれません。</p>
          </div>
          <div className={layout.panelBody}>
            <textarea
              ref={textareaRef}
              className={styles.summaryArea}
              value={summaryText}
              readOnly
              rows={12}
            />
            <div className={styles.summaryActions}>
              <Button variant="primary" onClick={() => void handleCopy()}>
                {copied ? "コピーしました" : "サマリーをコピー"}
              </Button>
              <Button onClick={() => void handleClear()}>ログを削除</Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
