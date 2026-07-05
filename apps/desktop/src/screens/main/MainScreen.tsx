import { useEffect, useRef, useState } from "react";
import type { Tool, ToolState } from "../../types";
import { initialTools } from "../../data/mockData";
import { Button, Spinner } from "../../components/primitives";
import { ToolRow } from "./ToolRow";
import styles from "./MainScreen.module.css";

export function MainScreen({ presetName }: { presetName: string }) {
  const [tools, setTools] = useState<Tool[]>(initialTools);
  const [editMode, setEditMode] = useState(false);
  const [launching, setLaunching] = useState(false);

  // 最新 tools と mount 状態を非同期処理から参照するための ref
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const mountedRef = useRef(true);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    // timersRef.current は push のみで再代入しないため、同じ配列参照を cleanup で使える
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
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, state } : t)));
  };

  const runningCount = tools.filter((t) => t.state === "running").length;
  const anyStarting = tools.some((t) => t.state === "starting");
  const allRunning = tools.length > 0 && runningCount === tools.length;

  const handleStart = (id: string) => {
    setToolState(id, "starting");
    const timer = window.setTimeout(() => {
      if (mountedRef.current) setToolState(id, "running");
    }, 650);
    timersRef.current.push(timer);
  };

  const launchAll = async () => {
    setLaunching(true);
    const ids = toolsRef.current.map((t) => t.id);
    for (const id of ids) {
      const current = toolsRef.current.find((t) => t.id === id);
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
    setTools((prev) => prev.map((t) => ({ ...t, state: "waiting" })));
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    setTools((prev) => {
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const remove = (id: string) => {
    setTools((prev) => prev.filter((t) => t.id !== id));
  };

  const toggleEdit = () => setEditMode((v) => !v);

  return (
    <div className={editMode ? styles.editMode : ""}>
      <div className={styles.top}>
        <div className={styles.title}>
          <h2>{presetName}</h2>
          <div className={styles.progressText}>
            {runningCount} / {tools.length} 起動済み
          </div>
        </div>
        <div className={styles.actions}>
          <button
            className={`${styles.editToggle} ${editMode ? styles.editing : ""}`}
            onClick={toggleEdit}
          >
            {editMode ? "編集をやめる" : "編集"}
          </button>
          {editMode ? (
            <Button variant="primary">保存</Button>
          ) : (
            <Button
              variant="primary"
              stopAll={allRunning}
              disabled={launching || anyStarting}
              onClick={allRunning ? stopAll : launchAll}
            >
              {launching || anyStarting ? (
                <Spinner />
              ) : allRunning ? (
                "一括停止"
              ) : (
                "一括起動"
              )}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolbarHead}>
          <h3>起動順</h3>
          {editMode && (
            <div className={styles.editHint}>
              編集モード中です。↑ ↓ で起動順を変更できます。
            </div>
          )}
        </div>
        {editMode && <button className={styles.addToolBtn}>＋ ツールを追加</button>}
      </div>

      <div className={styles.toolList}>
        {tools.map((tool, index) => (
          <ToolRow
            key={tool.id}
            tool={tool}
            index={index}
            total={tools.length}
            order={index + 1}
            editMode={editMode}
            onStart={() => handleStart(tool.id)}
            onStop={() => setToolState(tool.id, "waiting")}
            onMoveUp={() => move(index, -1)}
            onMoveDown={() => move(index, 1)}
            onDelete={() => remove(tool.id)}
          />
        ))}
      </div>

      <div className={styles.footerActions}>
        <p>
          一括起動中は、番号順に起動します。途中で起動失敗した場合は、そのツールをエラーにして後続の起動を止めます。
        </p>
        {editMode && (
          <div className={styles.footerButtons}>
            <Button>起動間隔を設定</Button>
            <Button>PC起動時の動作</Button>
          </div>
        )}
      </div>
    </div>
  );
}
