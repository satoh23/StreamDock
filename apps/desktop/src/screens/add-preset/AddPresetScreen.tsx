import { useEffect, useMemo, useState } from "react";
import type { LaunchItem, Screen } from "../../types";
import type {
  PresetItemRecord,
  PresetRecord,
} from "../../features/presets/types";
import type { ToolRecord } from "../../features/tools/types";
import { iconDataUri, toIconLetter } from "../../features/tools/display";
import { createPreset, updatePreset } from "../../features/presets/presetApi";
import {
  addToolToPreset,
  listPresetItems,
  removeToolFromPreset,
  reorderPresetItems,
  updatePresetItem,
} from "../../features/presets/presetItemApi";
import { toErrorMessage } from "../../features/tools/useTools";
import { Button, IconTile } from "../../components/primitives";
import { PreviewCard, type PreviewRowData } from "../../components/PreviewCard";
import layout from "../formLayout.module.css";
import styles from "./AddPresetScreen.module.css";

/** ToolRecord を Step2 の起動アイテム（LaunchItem, id=toolId）に変換する。 */
function toLaunchItem(tool: ToolRecord, mode: LaunchItem["mode"]): LaunchItem {
  return {
    id: tool.id,
    iconLetter: toIconLetter(tool),
    iconPng: tool.iconPng,
    name: tool.name,
    description: tool.description,
    mode,
  };
}

/** 選択ツールと launchItems を突合し、既存の mode / 並び順を保持したまま再構築する。 */
function syncLaunchItems(
  prev: LaunchItem[],
  selected: ToolRecord[],
): LaunchItem[] {
  const selectedIds = new Set(selected.map((t) => t.id));
  const kept = prev.filter((item) => selectedIds.has(item.id));
  const keptIds = new Set(kept.map((item) => item.id));
  const added = selected
    .filter((t) => !keptIds.has(t.id))
    .map((t) => toLaunchItem(t, "ordered"));
  return [...kept, ...added];
}

/** parallel を番号に数えず、ordered だけで連番を振る。 */
function orderedIndexFor(items: LaunchItem[], index: number): number {
  let count = 0;
  for (let i = 0; i <= index; i++) {
    if (items[i].mode === "ordered") count++;
  }
  return count;
}

export function AddPresetScreen({
  onNavigate,
  editingPreset,
  editingItems = [],
  tools,
  onSaved,
}: {
  onNavigate: (screen: Screen) => void;
  /** 編集対象。null なら新規作成。 */
  editingPreset?: PresetRecord | null;
  /** 編集対象プリセットの既存ツール構成（新規時は空）。 */
  editingItems?: PresetItemRecord[];
  /** 登録済みツール（Step1 の選択候補）。 */
  tools: ToolRecord[];
  /** 保存成功後に一覧・構成を再読み込みするコールバック。 */
  onSaved?: () => Promise<void> | void;
}) {
  const isEdit = !!editingPreset;

  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [launchItems, setLaunchItems] = useState<LaunchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [saving, setSaving] = useState(false);
  // 019: PC 起動時にこのプリセットのツールを自動一括起動するか（per-preset フラグ）。
  const [autoLaunchOnBoot, setAutoLaunchOnBoot] = useState(false);

  const toolById = useMemo(
    () => new Map(tools.map((t) => [t.id, t])),
    [tools],
  );

  // 編集 / 新規いずれもフォーム初期値を editingPreset・editingItems に同期する。
  // editingItems は App 側で useMemo し identity が安定しているため dep に含めてよい。
  useEffect(() => {
    setName(editingPreset?.name ?? "");
    setDescription(editingPreset?.description ?? "");
    setAutoLaunchOnBoot(editingPreset?.autoLaunchOnBoot ?? false);
    const seeded = editingItems
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((item) => {
        const tool = toolById.get(item.toolId);
        return tool ? toLaunchItem(tool, item.launchMode) : null;
      })
      .filter((x): x is LaunchItem => x !== null);
    setSelectedIds(seeded.map((d) => d.id));
    setLaunchItems(seeded);
    setCurrentStep(1);
    setError(null);
    setNameError(false);
  }, [editingPreset, editingItems, toolById]);

  const selectedTools = useMemo(
    () => tools.filter((t) => selectedIds.includes(t.id)),
    [tools, selectedIds],
  );

  const toggleTool = (id: string) => {
    const nextIds = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    setSelectedIds(nextIds);
    const nextSelected = tools.filter((t) => nextIds.includes(t.id));
    setLaunchItems((prev) => syncLaunchItems(prev, nextSelected));
  };

  const goNext = () => {
    if (!name.trim()) {
      setError("プリセット名は必須です");
      setNameError(true);
      return;
    }
    if (selectedTools.length === 0) {
      setError("ツールを1つ以上選択してください");
      return;
    }
    setError(null);
    setNameError(false);
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

  /** 新規作成: プリセットを作り、選択順どおりにツールを追加する。 */
  const saveCreate = async () => {
    const preset = await createPreset({
      name: name.trim(),
      description,
      autoLaunchOnBoot,
    });
    for (const item of launchItems) {
      await addToolToPreset({
        presetId: preset.id,
        toolId: item.id,
        launchMode: item.mode,
      });
    }
  };

  /** 編集: プリセット情報を更新し、既存構成との差分を反映する。 */
  const saveEdit = async (presetId: string) => {
    await updatePreset(presetId, {
      name: name.trim(),
      description,
      autoLaunchOnBoot,
    });

    const existingByToolId = new Map(
      editingItems.map((i) => [i.toolId, i]),
    );
    const desiredToolIds = new Set(launchItems.map((d) => d.id));

    // 外したツールを削除
    for (const existing of editingItems) {
      if (!desiredToolIds.has(existing.toolId)) {
        await removeToolFromPreset(existing.id);
      }
    }
    // 追加・モード変更
    for (const draft of launchItems) {
      const existing = existingByToolId.get(draft.id);
      if (!existing) {
        await addToolToPreset({
          presetId,
          toolId: draft.id,
          launchMode: draft.mode,
        });
      } else if (existing.launchMode !== draft.mode) {
        await updatePresetItem(existing.id, {
          launchMode: draft.mode,
          enabled: existing.enabled,
        });
      }
    }
    // 最新の id を取得して、ドラフトの並び順どおりに並べ替える
    const fresh = await listPresetItems(presetId);
    const idByToolId = new Map(fresh.map((i) => [i.toolId, i.id]));
    const orderedIds = launchItems
      .map((d) => idByToolId.get(d.id))
      .filter((id): id is string => id !== undefined);
    if (orderedIds.length === fresh.length && orderedIds.length > 0) {
      await reorderPresetItems(presetId, orderedIds);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("プリセット名は必須です");
      setNameError(true);
      return;
    }
    if (launchItems.length === 0) {
      setError("ツールを1つ以上選択してください");
      return;
    }
    setError(null);
    setNameError(false);
    setSaving(true);
    try {
      if (isEdit && editingPreset) {
        await saveEdit(editingPreset.id);
      } else {
        await saveCreate();
      }
      await onSaved?.();
      onNavigate("main");
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // --- プレビュー行 ---
  const previewName = name.trim() || "新しいプリセット";
  const previewRows: PreviewRowData[] =
    currentStep === 1
      ? selectedTools.map((tool, i) => ({
          key: tool.id,
          orderLabel: String(i + 1),
          iconLetter: toIconLetter(tool),
          iconSrc: iconDataUri(tool.iconPng),
          name: tool.name,
          description: tool.description,
        }))
      : launchItems.map((item, i) => ({
          key: item.id,
          orderLabel:
            item.mode === "parallel"
              ? "並行"
              : String(orderedIndexFor(launchItems, i)),
          parallel: item.mode === "parallel",
          iconLetter: item.iconLetter,
          iconSrc: iconDataUri(item.iconPng),
          name: item.name,
          description: item.mode === "parallel" ? "並行起動" : item.description,
        }));

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>
            {isEdit
              ? currentStep === 1
                ? "プリセットを編集"
                : "起動設定"
              : currentStep === 1
                ? "プリセットを追加"
                : "起動設定"}
          </h2>
        </div>
        <div className={styles.stepper}>
          <div
            className={`${styles.step} ${currentStep === 1 ? styles.active : ""}`}
          >
            <span className={styles.stepNumber}>1</span> 使うツール
          </div>
          <div className={styles.stepLine} />
          <div
            className={`${styles.step} ${currentStep === 2 ? styles.active : ""}`}
          >
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
                      className={nameError ? layout.inputError : ""}
                      value={name}
                      placeholder="プリセット名を入力"
                      onChange={(e) => {
                        setName(e.target.value);
                        if (nameError) setNameError(false);
                      }}
                    />
                    <div className={layout.fieldHelp}>
                      例：通常配信、雑談用、ゲーム用、海外コメント対応など
                    </div>
                  </div>
                  <div className={layout.field}>
                    <label>説明</label>
                    <input
                      value={description}
                      placeholder="このプリセットの説明（任意）"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <div className={layout.fieldHelp}>
                      サイドバーや一覧の補足として使えます。未入力でも保存できます。
                    </div>
                  </div>
                  <div className={layout.field}>
                    <label className={styles.bootToggle}>
                      <input
                        type="checkbox"
                        checked={autoLaunchOnBoot}
                        onChange={(e) => setAutoLaunchOnBoot(e.target.checked)}
                      />
                      <span>PC起動時にプリセット自動起動</span>
                    </label>
                    <div className={layout.fieldHelp}>
                      オンにすると、PC 起動時に stream-dock
                      が自動起動し、このプリセットのツールを一括起動します。
                    </div>
                  </div>
                </div>

                <div className={styles.toolSelectHeader}>
                  <h3>使うツール</h3>
                  <span className={styles.selectedCount}>
                    {selectedTools.length}個選択中
                  </span>
                </div>
                {tools.length === 0 ? (
                  <div className={styles.emptyPreview}>
                    登録済みのツールがありません。先にサイドバーの「＋
                    ツールを追加」でツールを登録してください。
                  </div>
                ) : (
                  <div className={styles.toolSelectList}>
                    {tools.map((tool) => {
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
                          <IconTile
                            glyph={toIconLetter(tool)}
                            imageSrc={iconDataUri(tool.iconPng)}
                            size="sm"
                          />
                          <div>
                            <h4>{tool.name}</h4>
                            <p>{tool.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {error && <div className={layout.error}>{error}</div>}

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
                      ツールが選択されていません。前の画面でツールを選択してください。
                    </div>
                  ) : (
                    launchItems.map((item, index) => {
                      const parallel = item.mode === "parallel";
                      return (
                        <div key={item.id} className={styles.launchRow}>
                          <div
                            className={`${styles.launchOrder} ${parallel ? styles.parallel : ""}`}
                          >
                            {parallel
                              ? "並行"
                              : orderedIndexFor(launchItems, index)}
                          </div>
                          <IconTile
                            glyph={item.iconLetter}
                            imageSrc={iconDataUri(item.iconPng)}
                            size="sm"
                          />
                          <div>
                            <h4>{item.name}</h4>
                            <p>
                              {parallel ? "順番なしで並行起動" : item.description}
                            </p>
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
                                index === launchItems.length - 1
                                  ? styles.disabled
                                  : ""
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

                {error && <div className={layout.error}>{error}</div>}

                <div className={layout.bottomActions}>
                  <Button onClick={() => setCurrentStep(1)}>戻る</Button>
                  <Button
                    variant="primary"
                    disabled={saving}
                    onClick={handleSave}
                  >
                    {isEdit ? "保存する" : "保存して作成"}
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
