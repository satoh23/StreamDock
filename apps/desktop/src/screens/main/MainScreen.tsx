import { useEffect, useRef, useState } from "react";
import type { ToolState } from "../../types";
import type { ToolRecord } from "../../features/tools/types";
import type {
  LaunchMode,
  PresetItemWithTool,
} from "../../features/presets/types";
import { toIconLetter } from "../../features/tools/display";
import { launchTool } from "../../features/tools/toolApi";
import { toErrorMessage } from "../../features/tools/useTools";
import { Button, IconTile, Spinner } from "../../components/primitives";
import { ToolRow } from "./ToolRow";
import layout from "../formLayout.module.css";
import styles from "./MainScreen.module.css";

/** メイン画面の1行分のランタイム表現（表示用 PresetItem ＋ 擬似起動状態）。 */
type RuntimeItem = {
  /** preset_items.id（並び替え・削除・更新のキー） */
  id: string;
  toolId: string;
  iconLetter: string;
  name: string;
  description: string;
  launchMode: LaunchMode;
  enabled: boolean;
  /** 擬似的な起動状態（実プロセス起動は 007 以降） */
  state: ToolState;
};

/** 表示用 PresetItemWithTool を、起動状態付きのランタイム行に変換する。 */
function toRuntime(items: PresetItemWithTool[]): RuntimeItem[] {
  return items.map((it) => ({
    id: it.id,
    toolId: it.toolId,
    iconLetter: toIconLetter(it.tool),
    name: it.tool.name,
    description: it.tool.description,
    launchMode: it.launchMode,
    enabled: it.enabled,
    state: "waiting" as ToolState,
  }));
}

/** parallel を番号に数えず、ordered だけで連番を振る。 */
function orderedIndexFor(list: RuntimeItem[], index: number): number {
  let count = 0;
  for (let i = 0; i <= index; i++) {
    if (list[i].launchMode === "ordered") count++;
  }
  return count;
}

export function MainScreen({
  presetName,
  presetId,
  items,
  availableTools,
  onAddTool,
  onRemoveItem,
  onReorder,
  onSetLaunchMode,
}: {
  /** 選択中プリセット名。プリセットが1件も無い（未選択）の場合は null。 */
  presetName: string | null;
  /** 選択中プリセットID。null なら未選択。 */
  presetId: string | null;
  /** 選択中プリセットのツール構成（order_index 昇順・Tool 情報合成済み）。 */
  items: PresetItemWithTool[];
  /** まだこのプリセットに入っていない登録済みツール（＋ツール追加の候補）。 */
  availableTools: ToolRecord[];
  onAddTool: (presetId: string, toolId: string) => Promise<void> | void;
  onRemoveItem: (id: string) => Promise<void> | void;
  onReorder: (presetId: string, orderedIds: string[]) => Promise<void> | void;
  onSetLaunchMode: (
    id: string,
    launchMode: LaunchMode,
    enabled: boolean,
  ) => Promise<void> | void;
}) {
  const [runtime, setRuntime] = useState<RuntimeItem[]>(() => toRuntime(items));
  const [editMode, setEditMode] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // 単体起動の成功/失敗フィードバック（トースト機構が無いためインライン表示）
  const [launchFeedback, setLaunchFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // 構成（items）が変化したら（追加・削除・並び替え・モード変更後）一覧を作り直す
  useEffect(() => {
    setRuntime(toRuntime(items));
    setLaunchFeedback(null);
  }, [items]);

  // 最新 runtime と mount 状態を非同期処理から参照するための ref
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const mountedRef = useRef(true);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    // StrictMode（dev）では effect が mount→unmount→remount と二重実行される。
    // cleanup で false にした mounted 判定を再マウント時に true へ戻さないと、
    // 以降 mountedRef.current が false のまま固定され、非同期処理後の状態更新
    // （起動成功で running へ遷移する等）が早期 return で握りつぶされる。
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = window.setTimeout(resolve, ms);
      timersRef.current.push(id);
    });

  const setToolState = (id: string, state: ToolState) => {
    setRuntime((prev) => prev.map((t) => (t.id === id ? { ...t, state } : t)));
  };

  const runningCount = runtime.filter((t) => t.state === "running").length;
  const allRunning = runtime.length > 0 && runningCount === runtime.length;

  // --- 単体起動（007: 実プロセス起動）---
  // frontend からは toolId のみを渡し、Tool 取得・パス検証・起動は Rust 側で行う。
  const handleStart = async (id: string, toolId: string, name: string) => {
    setLaunchFeedback(null);
    // 起動中は行のボタンが Spinner に置き換わり、自動的に無効化される。
    setToolState(id, "starting");
    try {
      await launchTool(toolId);
      if (!mountedRef.current) return;
      // 起動要求は成功したが、アプリの初期ローディング完了は検知できないため
      // 完了断定の "running"（起動済み）にはせず、"launched"（起動中の継続表示）に留める。
      setToolState(id, "launched");
      setLaunchFeedback({ kind: "success", text: `${name} を起動しました` });
    } catch (e) {
      if (!mountedRef.current) return;
      setToolState(id, "error");
      setLaunchFeedback({ kind: "error", text: toErrorMessage(e) });
    }
  };

  const launchAll = async () => {
    setLaunching(true);
    const ids = runtimeRef.current.map((t) => t.id);
    for (const id of ids) {
      const current = runtimeRef.current.find((t) => t.id === id);
      if (current?.state === "running") continue;
      if (!mountedRef.current) return;
      setToolState(id, "starting");
      await sleep(650);
      if (!mountedRef.current) return;
      setToolState(id, "running");
    }
    if (mountedRef.current) setLaunching(false);
  };

  const stopAll = () => {
    setRuntime((prev) => prev.map((t) => ({ ...t, state: "waiting" })));
  };

  // --- 編集モードの操作（操作ごとに即時保存）---
  const move = (index: number, dir: -1 | 1) => {
    if (!presetId) return;
    const target = index + dir;
    if (target < 0 || target >= runtime.length) return;
    const orderedIds = runtime.map((t) => t.id);
    [orderedIds[index], orderedIds[target]] = [
      orderedIds[target],
      orderedIds[index],
    ];
    void onReorder(presetId, orderedIds);
  };

  const remove = (id: string) => {
    void onRemoveItem(id);
  };

  const toggleMode = (item: RuntimeItem) => {
    const next: LaunchMode =
      item.launchMode === "ordered" ? "parallel" : "ordered";
    void onSetLaunchMode(item.id, next, item.enabled);
  };

  const addTool = (toolId: string) => {
    if (!presetId) return;
    void onAddTool(presetId, toolId);
  };

  const toggleEdit = () => {
    setEditMode((v) => {
      if (v) setShowPicker(false);
      return !v;
    });
  };

  // プリセットが1件も無い（未選択）場合は空状態を表示する
  if (presetName === null) {
    return (
      <div className={styles.emptyState}>
        <h2>まだプリセットがありません</h2>
        <p>
          プリセットを追加して、配信で使うツール構成を保存しましょう。左のサイドバーの「＋
          プリセットを追加」から作成できます。
        </p>
      </div>
    );
  }

  const isEmpty = runtime.length === 0;

  return (
    <div className={editMode ? styles.editMode : ""}>
      <div className={styles.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>{presetName}</h2>
          <div className={styles.progressText}>
            {runningCount} / {runtime.length} 起動済み
          </div>
        </div>
        <div className={styles.actions}>
          <button
            className={`${styles.editToggle} ${editMode ? styles.editing : ""}`}
            onClick={toggleEdit}
          >
            {editMode ? "編集を終える" : "編集"}
          </button>
          {!editMode && (
            <Button
              variant="primary"
              stopAll={allRunning}
              disabled={launching || isEmpty}
              onClick={allRunning ? stopAll : launchAll}
            >
              {launching ? <Spinner /> : allRunning ? "一括停止" : "一括起動"}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolbarHead}>
          <h3>起動順</h3>
          {editMode && (
            <div className={styles.editHint}>
              編集モード中です。↑ ↓ で起動順を、「並行」ボタンで起動モードを変更できます。
            </div>
          )}
        </div>
        {editMode && (
          <button
            className={styles.addToolBtn}
            onClick={() => setShowPicker((v) => !v)}
          >
            ＋ ツールを追加
          </button>
        )}
      </div>

      {editMode && showPicker && (
        <div className={styles.picker}>
          {availableTools.length === 0 ? (
            <div className={styles.pickerEmpty}>
              追加できるツールがありません。先にサイドバーの「＋
              ツールを追加」でツールを登録してください。
            </div>
          ) : (
            availableTools.map((tool) => (
              <button
                key={tool.id}
                className={styles.pickerRow}
                onClick={() => addTool(tool.id)}
              >
                <IconTile glyph={toIconLetter(tool)} size="sm" />
                <div className={styles.pickerInfo}>
                  <h4>{tool.name}</h4>
                  <p>{tool.description}</p>
                </div>
                <span className={styles.pickerAdd}>追加</span>
              </button>
            ))
          )}
        </div>
      )}

      {launchFeedback && (
        <div
          className={
            launchFeedback.kind === "success"
              ? styles.launchSuccess
              : styles.launchError
          }
        >
          {launchFeedback.text}
        </div>
      )}

      {isEmpty ? (
        <div className={styles.itemsEmpty}>
          <h3>このプリセットにはまだツールがありません</h3>
          <p>
            ツールを追加して、配信準備をまとめましょう。「編集」→「＋
            ツールを追加」から登録済みツールを選べます。
          </p>
        </div>
      ) : (
        <div className={styles.toolList}>
          {runtime.map((item, index) => {
            const parallel = item.launchMode === "parallel";
            return (
              <ToolRow
                key={item.id}
                tool={{
                  id: item.id,
                  iconLetter: item.iconLetter,
                  name: item.name,
                  description: item.description,
                  state: item.state,
                }}
                index={index}
                total={runtime.length}
                orderLabel={parallel ? "並行" : String(orderedIndexFor(runtime, index))}
                parallel={parallel}
                editMode={editMode}
                onStart={() => void handleStart(item.id, item.toolId, item.name)}
                onStop={() => setToolState(item.id, "waiting")}
                onMoveUp={() => move(index, -1)}
                onMoveDown={() => move(index, 1)}
                onToggleMode={() => toggleMode(item)}
                onDelete={() => remove(item.id)}
              />
            );
          })}
        </div>
      )}

      {editMode && (
        <div className={styles.footerActions}>
          <div className={styles.footerButtons}>
            <Button>起動間隔を設定</Button>
            <Button>PC起動時の動作</Button>
          </div>
        </div>
      )}
    </div>
  );
}
