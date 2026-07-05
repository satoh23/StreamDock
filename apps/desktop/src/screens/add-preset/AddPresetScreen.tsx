import { useMemo, useState } from "react";
import type { LaunchItem, Screen, ToolCatalogItem } from "../../types";
import { defaultSelectedToolIds, toolCatalog } from "../../data/mockData";
import { Button, IconTile } from "../../components/primitives";
import { PreviewCard, type PreviewRowData } from "../../components/PreviewCard";
import layout from "../formLayout.module.css";
import styles from "./AddPresetScreen.module.css";

/** 選択ツールと launchItems を突合し、既存の mode / 並び順を保持したまま再構築する */
function syncLaunchItems(
  prev: LaunchItem[],
  selected: ToolCatalogItem[],
): LaunchItem[] {
  const selectedIds = new Set(selected.map((t) => t.id));
  const kept = prev.filter((item) => selectedIds.has(item.id));
  const keptIds = new Set(kept.map((item) => item.id));
  const added: LaunchItem[] = selected
    .filter((t) => !keptIds.has(t.id))
    .map((t) => ({
      id: t.id,
      iconLetter: t.iconLetter,
      name: t.name,
      description: t.description,
      mode: "ordered",
    }));
  return [...kept, ...added];
}

/** parallel を番号に数えず、ordered だけで連番を振る */
function orderedIndexFor(items: LaunchItem[], index: number): number {
  let count = 0;
  for (let i = 0; i <= index; i++) {
    if (items[i].mode === "ordered") count++;
  }
  return count;
}

export function AddPresetScreen({
  onNavigate,
}: {
  onNavigate: (screen: Screen) => void;
}) {
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [presetName, setPresetName] = useState("通常配信プリセット");
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultSelectedToolIds);
  const [launchItems, setLaunchItems] = useState<LaunchItem[]>(() =>
    syncLaunchItems(
      [],
      toolCatalog.filter((t) => defaultSelectedToolIds.includes(t.id)),
    ),
  );

  const selectedTools = useMemo(
    () => toolCatalog.filter((t) => selectedIds.includes(t.id)),
    [selectedIds],
  );

  const toggleTool = (id: string) => {
    const nextIds = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    setSelectedIds(nextIds);
    const nextSelected = toolCatalog.filter((t) => nextIds.includes(t.id));
    setLaunchItems((prev) => syncLaunchItems(prev, nextSelected));
  };

  const goNext = () => {
    setLaunchItems((prev) => syncLaunchItems(prev, selectedTools));
    setCurrentStep(2);
  };

  const toggleMode = (index: number) => {
    setLaunchItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, mode: item.mode === "ordered" ? "parallel" : "ordered" }
          : item,
      ),
    );
  };

  const moveLaunch = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    setLaunchItems((prev) => {
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // --- プレビュー行 ---
  const previewName = presetName || "新しいプリセット";
  const previewRows: PreviewRowData[] =
    currentStep === 1
      ? selectedTools.map((tool, i) => ({
          key: tool.id,
          orderLabel: String(i + 1),
          iconLetter: tool.iconLetter,
          name: tool.name,
          description: tool.description,
        }))
      : launchItems.map((item, i) => ({
          key: item.id,
          orderLabel: item.mode === "parallel" ? "並行" : String(orderedIndexFor(launchItems, i)),
          parallel: item.mode === "parallel",
          iconLetter: item.iconLetter,
          name: item.name,
          description: item.mode === "parallel" ? "並行起動" : item.description,
        }));

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>{currentStep === 1 ? "プリセットを追加" : "起動設定"}</h2>
        </div>
        <div className={styles.stepper}>
          <div className={`${styles.step} ${currentStep === 1 ? styles.active : ""}`}>
            <span className={styles.stepNumber}>1</span> 使うツール
          </div>
          <div className={styles.stepLine} />
          <div className={`${styles.step} ${currentStep === 2 ? styles.active : ""}`}>
            <span className={styles.stepNumber}>2</span> 起動設定
          </div>
        </div>
      </div>

      <div className={layout.content}>
        <section className={layout.panel}>
          {currentStep === 1 ? (
            <>
              <div className={layout.panelHead}>
                <h3>使うツールを選択</h3>
                <p>
                  このプリセットで使うツールを選びます。起動順や並行起動は次の画面で設定します。
                </p>
              </div>
              <div className={layout.panelBody}>
                <div className={layout.form}>
                  <div className={layout.field}>
                    <label>プリセット名</label>
                    <input
                      value={presetName}
                      placeholder="プリセット名を入力"
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                    <div className={layout.fieldHelp}>
                      例：通常配信、雑談用、ゲーム用、海外コメント対応など
                    </div>
                  </div>
                </div>

                <div className={styles.toolSelectHeader}>
                  <h3>使うツール</h3>
                  <span className={styles.selectedCount}>{selectedTools.length}個選択中</span>
                </div>
                <div className={styles.toolSelectList}>
                  {toolCatalog.map((tool) => {
                    const checked = selectedIds.includes(tool.id);
                    return (
                      <label
                        key={tool.id}
                        className={`${styles.toolOption} ${checked ? styles.selected : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTool(tool.id)}
                        />
                        <IconTile glyph={tool.iconLetter} size="sm" />
                        <div>
                          <h4>{tool.name}</h4>
                          <p>{tool.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className={layout.bottomActions}>
                  <Button onClick={() => onNavigate("main")}>キャンセル</Button>
                  <Button variant="primary" onClick={goNext}>
                    次へ
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={layout.panelHead}>
                <h3>起動設定</h3>
                <p>
                  番号付きのツールは順番に起動し、並行起動のツールはまとめて起動します。
                </p>
              </div>
              <div className={layout.panelBody}>
                <div className={styles.launchList}>
                  {launchItems.length === 0 ? (
                    <div className={styles.emptyPreview}>
                      ツールが選択されていません。戻ってツールを選択してください。
                    </div>
                  ) : (
                    launchItems.map((item, index) => {
                      const parallel = item.mode === "parallel";
                      return (
                        <div key={item.id} className={styles.launchRow}>
                          <div
                            className={`${styles.launchOrder} ${parallel ? styles.parallel : ""}`}
                          >
                            {parallel ? "並行" : orderedIndexFor(launchItems, index)}
                          </div>
                          <IconTile glyph={item.iconLetter} size="sm" />
                          <div>
                            <h4>{item.name}</h4>
                            <p>{parallel ? "順番なしで並行起動" : item.description}</p>
                          </div>
                          <button
                            className={styles.modeToggle}
                            onClick={() => toggleMode(index)}
                          >
                            {parallel ? "番号を付ける" : "並行にする"}
                          </button>
                          <div className={styles.moveActions}>
                            <button
                              className={`${styles.moveBtn} ${index === 0 ? styles.disabled : ""}`}
                              onClick={() => moveLaunch(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              className={`${styles.moveBtn} ${
                                index === launchItems.length - 1 ? styles.disabled : ""
                              }`}
                              onClick={() => moveLaunch(index, 1)}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className={layout.bottomActions}>
                  <Button onClick={() => setCurrentStep(1)}>戻る</Button>
                  <Button variant="primary" onClick={() => onNavigate("main")}>
                    保存して作成
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>

        <PreviewCard
          title={currentStep === 1 ? "選択中のツール" : "プリセット作成後"}
          name={previewName}
          count={`${selectedTools.length}ツール`}
          rows={previewRows}
          help={
            currentStep === 1
              ? "次の画面で起動順や並行起動を設定できます。"
              : "起動順や並行起動はあとからプリセット編集画面で変更できます。"
          }
          emptyMessage="ツールを選択すると、ここに内容が表示されます。"
        />
      </div>
    </>
  );
}
