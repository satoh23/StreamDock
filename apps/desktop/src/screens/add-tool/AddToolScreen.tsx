import { useState } from "react";
import type { Screen, SelectedApp } from "../../types";
import {
  insertModeOptions,
  sampleSelectedApp,
  targetPresetOptions,
  toolCatalog,
} from "../../data/mockData";
import { Button } from "../../components/primitives";
import { PreviewCard, type PreviewRowData } from "../../components/PreviewCard";
import layout from "../formLayout.module.css";
import styles from "./AddToolScreen.module.css";

// プレビューの土台になる既存ツール（プロトタイプ準拠の4件）
const baseRows = toolCatalog.slice(0, 4);

function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function AddToolScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const [selectedApp, setSelectedApp] = useState<SelectedApp | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [targetPreset, setTargetPreset] = useState(targetPresetOptions[0]);
  const [insertMode, setInsertMode] = useState(insertModeOptions[0]);
  const [insertPosition, setInsertPosition] = useState("1番目に追加");

  const selectApp = () => {
    setSelectedApp(sampleSelectedApp);
    setDisplayName(sampleSelectedApp.name);
  };

  const showInsertPosition = insertMode === "選択して追加";
  const isParallel = insertMode === "順番なし（並行起動）";

  const previewRows: PreviewRowData[] = baseRows.map((tool, i) => ({
    key: tool.id,
    orderLabel: String(i + 1),
    iconLetter: tool.iconLetter,
    name: tool.name,
    description: tool.description,
  }));

  if (selectedApp) {
    previewRows.push({
      key: "__new__",
      orderLabel: isParallel ? "並行" : insertMode === "先頭に追加" ? "1" : "5",
      parallel: isParallel,
      iconLetter: selectedApp.iconLetter,
      name: displayName || selectedApp.name,
      description: isParallel ? "順番なしで並行起動" : selectedApp.description,
      highlight: true,
    });
  }

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>ツールを追加</h2>
        </div>
      </div>

      <div className={layout.content}>
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>アプリを選択</h3>
            <p>起動したいアプリの実行ファイルを選びます。ドラッグ&amp;ドロップにも対応予定です。</p>
          </div>
          <div className={layout.panelBody}>
            {selectedApp ? (
              <div className={styles.selectedApp}>
                <div className={styles.appIcon}>{selectedApp.iconLetter}</div>
                <div>
                  <h3>{selectedApp.name}</h3>
                  <div className={styles.path}>{selectedApp.path}</div>
                </div>
              </div>
            ) : (
              <div className={styles.dropzone}>
                <div>
                  <div className={styles.dropIcon}>
                    <DropIcon />
                  </div>
                  <h3>アプリをここにドロップ</h3>
                  <p>またはファイル選択から、起動したいアプリを選びます。</p>
                  <Button onClick={selectApp}>アプリを選択</Button>
                  <div className={styles.fileTypes}>
                    <span className={styles.typeChip}>.exe</span>
                    <span className={styles.typeChip}>.lnk</span>
                    <span className={styles.typeChip}>.bat</span>
                  </div>
                </div>
              </div>
            )}

            <div className={layout.form}>
              <div className={layout.field}>
                <label>表示名</label>
                <input
                  value={displayName}
                  placeholder="表示名を入力"
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <div className={layout.fieldHelp}>自動取得した名前を編集できます。</div>
              </div>

              <div className={layout.field}>
                <label>登録先プリセット</label>
                <select
                  value={targetPreset}
                  onChange={(e) => setTargetPreset(e.target.value)}
                >
                  {targetPresetOptions.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className={layout.field}>
                <label>追加位置</label>
                <select value={insertMode} onChange={(e) => setInsertMode(e.target.value)}>
                  {insertModeOptions.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
                <div className={layout.fieldHelp}>
                  順番が必要なツールは番号順、不要なツールは並行起動にできます。
                </div>
              </div>

              <div
                className={`${layout.field} ${layout.conditionalField} ${
                  showInsertPosition ? layout.visible : ""
                }`}
              >
                <label>挿入位置</label>
                <select
                  value={insertPosition}
                  onChange={(e) => setInsertPosition(e.target.value)}
                >
                  {["1番目に追加", "2番目に追加", "3番目に追加", "4番目に追加", "5番目に追加"].map(
                    (opt) => (
                      <option key={opt}>{opt}</option>
                    ),
                  )}
                </select>
              </div>
            </div>

            <div className={layout.bottomActions}>
              <Button onClick={() => onNavigate("main")}>キャンセル</Button>
              <Button variant="primary" onClick={() => onNavigate("main")}>
                保存して追加
              </Button>
            </div>
          </div>
        </section>

        <PreviewCard
          title="ツール追加後プレビュー"
          rows={previewRows}
          help="起動順や並行起動はあとからプリセット編集画面で変更できます。"
        />
      </div>
    </>
  );
}
