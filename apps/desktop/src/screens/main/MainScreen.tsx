import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolState } from "../../types";
import type { ToolRecord } from "../../features/tools/types";
import type {
  LaunchMode,
  PresetItemWithTool,
  RuntimeProcessStatus,
} from "../../features/presets/types";
import { toIconLetter } from "../../features/tools/display";
import { launchTool, stopProcess } from "../../features/tools/toolApi";
import {
  launchPreset,
  stopPresetProcesses,
} from "../../features/presets/presetLaunchApi";
import { listRuntimeProcesses } from "../../features/presets/runtimeApi";
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
  /** 起動状態（007/008 で実プロセス起動） */
  state: ToolState;
  /**
   * 009 停止操作用の識別子。起動成功時に Rust 側 registry に登録された値を保持し、
   * 単体停止（stop_process）でこの値を渡す。未起動 / 停止済みは undefined。
   */
  launchId?: string;
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

/**
 * Rust registry の状態（010 RuntimeProcessStatus）を UI の ToolState に写像する。
 * Rust が try_wait で判定できるのは running / stopped / error の3状態のみ。
 * running は「稼働確認済み」なので、spawn 直後の暫定表示 "launched" から "running" へ昇格させる。
 */
function mapStatus(status: RuntimeProcessStatus): ToolState {
  switch (status) {
    case "running":
      return "running";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
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
  // 一括停止（009）の進行中フラグ。一括起動と同様に進行中は一括ボタンを Spinner + disabled にする。
  const [stopping, setStopping] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // 単体起動・一括起動の成功/一部失敗/失敗フィードバック（トースト機構が無いためインライン表示）
  const [launchFeedback, setLaunchFeedback] = useState<{
    kind: "success" | "warning" | "error";
    text: string;
  } | null>(null);

  // 最新 runtime と mount 状態を非同期処理から参照するための ref
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const mountedRef = useRef(true);
  // 一括起動中にプリセットが切り替わったら、resolve 後の反映を捨てるための現在値参照。
  const presetIdRef = useRef(presetId);
  presetIdRef.current = presetId;

  useEffect(() => {
    // StrictMode（dev）では effect が mount→unmount→remount と二重実行される。
    // cleanup で false にした mounted 判定を再マウント時に true へ戻さないと、
    // 以降 mountedRef.current が false のまま固定され、非同期処理後の状態更新
    // （起動成功で launched へ遷移する等）が早期 return で握りつぶされる。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setToolState = (id: string, state: ToolState) => {
    setRuntime((prev) => prev.map((t) => (t.id === id ? { ...t, state } : t)));
  };

  // --- 010 Runtime Status: registry の実状態を UI へ反映する ---
  // Rust 側 registry（stream-dock がこのセッションで起動したプロセス）だけを状態確認する。
  // 突き合わせは launchId を主キーにする（単体起動 007 は preset に紐づかないため全件取得を使う）。
  // 一括起動（008）由来は presetItemId を持つので、構成再描画で launchId を失った行も復元できる。
  //
  // force=false（polling）: 起動中プロセス（launchId 保持行）が無ければ IPC しない。
  // force=true（明示再取得: マウント/プリセット切替/起動・停止直後）: 常に取得して復元・昇格する。
  const reconcile = useCallback(async (force = false) => {
    if (!force && !runtimeRef.current.some((t) => t.launchId)) return;
    const targetPresetId = presetIdRef.current;
    let procs;
    try {
      procs = await listRuntimeProcesses();
    } catch {
      // 状態取得の失敗は致命的でないため握りつぶす（次の再取得で回復する）。
      return;
    }
    // 取得中にアンマウント/プリセット切替が起きたら、古い結果は反映しない。
    if (!mountedRef.current || presetIdRef.current !== targetPresetId) return;

    const byLaunchId = new Map(procs.map((p) => [p.launchId, p]));
    const byPresetItemId = new Map<string, (typeof procs)[number]>();
    for (const p of procs) {
      if (p.presetItemId) byPresetItemId.set(p.presetItemId, p);
    }

    setRuntime((prev) =>
      prev.map((row) => {
        // 操作送信中（starting / stopping）の行は楽観的表示を優先し、上書きしない。
        if (row.state === "starting" || row.state === "stopping") return row;
        if (row.launchId) {
          const p = byLaunchId.get(row.launchId);
          // registry から消えている＝終了して除去済み → 停止済みへ。
          if (!p) return { ...row, state: "stopped", launchId: undefined };
          // running は launchId を保持したまま「起動済み」へ昇格。
          // stopped / error は launchId を破棄（以降は再起動できる）。
          return p.status === "running"
            ? { ...row, state: "running" }
            : { ...row, state: mapStatus(p.status), launchId: undefined };
        }
        // launchId を失った行（構成再描画・プリセット切替後）でも、一括起動由来なら
        // presetItemId で running プロセスに再関連付けして「起動済み」を復元する。
        const bulk = byPresetItemId.get(row.id);
        if (bulk && bulk.status === "running") {
          return { ...row, state: "running", launchId: bulk.launchId };
        }
        return row;
      }),
    );
  }, []);

  // メイン画面表示中の軽い polling（約4秒間隔）。registry のプロセスだけを対象にし、外部通信はしない。
  // reconcile は launchId 保持行が無ければ IPC しないため、起動プロセスが無い間は no-op。
  useEffect(() => {
    const timer = setInterval(() => {
      void reconcile();
    }, 4000);
    return () => clearInterval(timer);
  }, [reconcile]);

  // 構成（items）が変化したら（追加・削除・並び替え・モード変更後・プリセット切替・初期表示）
  // 一覧を作り直し、registry の実状態を明示再取得して起動中の行を復元・昇格する。
  useEffect(() => {
    setRuntime(toRuntime(items));
    setLaunchFeedback(null);
    // reconcile は setRuntime(prev => ...) で更新するため、上のリセット反映後の行に対して適用される。
    void reconcile(true);
  }, [items, reconcile]);

  // spawn 成功は "launched"（起動中）、reconcile 後は "running"（稼働確認済み）。どちらも起動中扱いとし、
  // 「起動済み」カウントと一括停止トグルの対象にする。
  const isActive = (s: ToolState) => s === "launched" || s === "running";
  const launchedCount = runtime.filter((t) => isActive(t.state)).length;
  // 009/010: 起動中（launched/running）の行が1つでもあれば一括ボタンを「一括停止」に切り替える。
  const anyLaunched = runtime.some((t) => isActive(t.state));

  // --- 単体起動（007: 実プロセス起動）---
  // frontend からは toolId のみを渡し、Tool 取得・パス検証・起動は Rust 側で行う。
  const handleStart = async (id: string, toolId: string, name: string) => {
    setLaunchFeedback(null);
    // 起動中は行のボタンが Spinner に置き換わり、自動的に無効化される。
    setToolState(id, "starting");
    try {
      const res = await launchTool(toolId);
      if (!mountedRef.current) return;
      // 起動要求は成功したが、アプリの初期ローディング完了は検知できないため
      // 完了断定の "running"（起動済み）にはせず、"launched"（起動中の継続表示）に留める。
      // 009: 停止操作用に launchId を行に保持する。
      setRuntime((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, state: "launched", launchId: res.launchId }
            : t,
        ),
      );
      setLaunchFeedback({ kind: "success", text: `${name} を起動しました` });
      // 010: 起動直後に registry を再取得し、稼働確認できれば "running" へ昇格させる。
      void reconcile(true);
    } catch (e) {
      if (!mountedRef.current) return;
      setToolState(id, "error");
      setLaunchFeedback({ kind: "error", text: toErrorMessage(e) });
    }
  };

  // --- 一括起動（008: 選択中プリセットの enabled ツールを実プロセス起動）---
  // frontend からは presetId のみを渡し、Preset/PresetItem/Tool 取得・パス検証・起動は Rust 側で行う。
  // best-effort 起動のため、1件の失敗では全体を止めず、成功・失敗を集約して表示する。
  const launchAll = async () => {
    if (!presetId) return;
    setLaunchFeedback(null);
    setLaunching(true);
    // enabled な行だけを起動対象として "starting" に（disabled 行は "waiting" のまま）。
    const enabledIds = runtimeRef.current
      .filter((t) => t.enabled)
      .map((t) => t.id);
    setRuntime((prev) =>
      prev.map((t) =>
        t.enabled ? { ...t, state: "starting" as ToolState } : t,
      ),
    );
    try {
      const res = await launchPreset(presetId);
      // 起動中にプリセットが切り替わっていたら、旧プリセットの結果は反映しない
      // （新プリセット画面に古いフィードバックが残るのを防ぐ）。
      if (!mountedRef.current || presetIdRef.current !== presetId) return;
      // 起動結果を presetItemId（= runtime id）で各行に反映する。
      const byItemId = new Map(res.results.map((r) => [r.presetItemId, r]));
      setRuntime((prev) =>
        prev.map((t) => {
          const r = byItemId.get(t.id);
          if (!r) return t;
          // 単体起動と同様、spawn 成功は "launched"（起動中）に留める（完了断定はしない）。
          // 009: 成功した行には停止操作用の launchId を保持する（失敗行には付かない）。
          return {
            ...t,
            state: (r.success ? "launched" : "error") as ToolState,
            launchId: r.success ? r.launchId : undefined,
          };
        }),
      );
      const failedNames = res.results
        .filter((r) => !r.success)
        .map((r) => r.toolName);
      if (res.failureCount === 0) {
        setLaunchFeedback({
          kind: "success",
          text: `${res.successCount}件のツールを起動しました`,
        });
      } else if (res.successCount === 0) {
        setLaunchFeedback({
          kind: "error",
          text: `起動に失敗しました: ${failedNames.join("、")}`,
        });
      } else {
        setLaunchFeedback({
          kind: "warning",
          text: `${res.totalCount}件中${res.successCount}件を起動しました。失敗: ${failedNames.join("、")}`,
        });
      }
      // 010: 一括起動直後に registry を再取得し、稼働確認できた行を "running" へ昇格させる。
      void reconcile(true);
    } catch (e) {
      if (!mountedRef.current || presetIdRef.current !== presetId) return;
      // 起動を開始できなかった場合（presetId 空・Preset 無し・enabled item 無し）。
      // starting にした行を元の待機状態へ戻す。
      setRuntime((prev) =>
        prev.map((t) =>
          enabledIds.includes(t.id)
            ? { ...t, state: "waiting" as ToolState }
            : t,
        ),
      );
      setLaunchFeedback({ kind: "error", text: toErrorMessage(e) });
    } finally {
      if (mountedRef.current) setLaunching(false);
    }
  };

  // --- 単体停止（009: registry 登録済みプロセスを launchId で停止）---
  // frontend からは launchId のみを渡す。停止対象は Rust 側 registry のプロセスに限定される。
  const handleStop = async (
    id: string,
    launchId: string | undefined,
    name: string,
  ) => {
    setLaunchFeedback(null);
    if (!launchId) {
      // 構成変更等で UI が launchId を失った行。表示だけ待機中へ戻す（実プロセスは Preset 単位停止で止められる）。
      setToolState(id, "waiting");
      return;
    }
    setToolState(id, "stopping");
    try {
      const res = await stopProcess(launchId);
      if (!mountedRef.current) return;
      if (res.status === "failed") {
        // 停止失敗。行は起動中へ戻し、再試行できるようにする。
        setToolState(id, "launched");
        setLaunchFeedback({
          kind: "error",
          text: res.errorMessage ?? `${name} の停止に失敗しました`,
        });
        return;
      }
      // stopped / already-exited / not-found → 停止済み表示にし、launchId を破棄する。
      setRuntime((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, state: "stopped", launchId: undefined } : t,
        ),
      );
      setLaunchFeedback({
        kind: "success",
        text:
          res.status === "already-exited"
            ? `${name} は既に終了していました`
            : res.status === "not-found"
              ? `${name} は既に停止しています`
              : `${name} を停止しました`,
      });
      // 010: 他の行の状態変化（自然終了など）も拾えるよう再取得する。
      void reconcile(true);
    } catch (e) {
      if (!mountedRef.current) return;
      setToolState(id, "launched");
      setLaunchFeedback({ kind: "error", text: toErrorMessage(e) });
    }
  };

  // --- 一括停止（009: 選択中 Preset に紐づく registry 登録済みプロセスをまとめて停止）---
  // frontend からは presetId のみを渡す。Rust 側で presetId に紐づく managed process だけを停止する。
  const stopAll = async () => {
    if (!presetId) return;
    setLaunchFeedback(null);
    setStopping(true);
    // 起動中（launched/running）の行を停止中表示に。
    setRuntime((prev) =>
      prev.map((t) =>
        isActive(t.state) ? { ...t, state: "stopping" as ToolState } : t,
      ),
    );
    try {
      const res = await stopPresetProcesses(presetId);
      if (!mountedRef.current || presetIdRef.current !== presetId) return;
      // 停止に失敗した launchId の行は起動中へ戻し、それ以外の停止中行は停止済みへ。
      const failedIds = new Set(
        res.results.filter((r) => r.status === "failed").map((r) => r.launchId),
      );
      setRuntime((prev) =>
        prev.map((t) => {
          if (t.state !== "stopping") return t;
          if (t.launchId && failedIds.has(t.launchId)) {
            return { ...t, state: "launched" as ToolState };
          }
          return { ...t, state: "stopped" as ToolState, launchId: undefined };
        }),
      );
      const settled = res.successCount + res.alreadyExitedCount;
      if (res.totalCount === 0) {
        setLaunchFeedback({
          kind: "success",
          text: "停止対象のプロセスがありません",
        });
      } else if (res.failureCount === 0) {
        setLaunchFeedback({
          kind: "success",
          text: `${settled}件のツールを停止しました`,
        });
      } else {
        setLaunchFeedback({
          kind: "warning",
          text: `${res.totalCount}件中${settled}件を停止しました。停止に失敗: ${res.failureCount}件`,
        });
      }
      // 010: 停止後の registry 実状態を再取得する（失敗行の残存・自然終了などを反映）。
      void reconcile(true);
    } catch (e) {
      if (!mountedRef.current || presetIdRef.current !== presetId) return;
      // 停止を開始できなかった（presetId 空・Preset 無し等）。停止中にした行を起動中へ戻す。
      setRuntime((prev) =>
        prev.map((t) =>
          t.state === "stopping" ? { ...t, state: "launched" as ToolState } : t,
        ),
      );
      setLaunchFeedback({ kind: "error", text: toErrorMessage(e) });
    } finally {
      if (mountedRef.current) setStopping(false);
    }
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
  // enabled な PresetItem が1件も無ければ一括起動できない（Rust 側でも同条件で開始を拒否する）。
  const hasEnabled = runtime.some((t) => t.enabled);

  return (
    <div className={editMode ? styles.editMode : ""}>
      <div className={styles.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>{presetName}</h2>
          <div className={styles.progressText}>
            {launchedCount} / {runtime.length} 起動済み
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
              stopAll={anyLaunched}
              disabled={
                launching || stopping || (!anyLaunched && (isEmpty || !hasEnabled))
              }
              onClick={anyLaunched ? stopAll : launchAll}
            >
              {launching || stopping ? (
                <Spinner />
              ) : anyLaunched ? (
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
              : launchFeedback.kind === "warning"
                ? styles.launchWarning
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
                onStop={() => void handleStop(item.id, item.launchId, item.name)}
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
