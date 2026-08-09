import { useCallback, useEffect, useRef, useState } from "react";
import type { Screen, ToolState } from "../../types";
import type { ToolKind, ToolRecord } from "../../features/tools/types";
import type {
  LaunchMode,
  PresetItemWithTool,
  RuntimeProcess,
  RuntimeProcessStatus,
} from "../../features/presets/types";
import { iconDataUri, toIconLetter } from "../../features/tools/display";
import { focusProcess, launchTool, stopProcess } from "../../features/tools/toolApi";
import {
  launchPreset,
  stopPresetProcesses,
} from "../../features/presets/presetLaunchApi";
import { listRuntimeProcesses } from "../../features/presets/runtimeApi";
import {
  closeCommentViewerWindow,
  isCommentViewerOpen,
  isEffectOverlayOpen,
} from "../../features/comment-viewer/windowApi";
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
  /** 018: 自動抽出した実アイコン（base64 PNG, `data:` 無し）。無ければ iconLetter を使う。 */
  iconPng?: string | null;
  name: string;
  description: string;
  launchMode: LaunchMode;
  enabled: boolean;
  /** 023: ツール種別。`"url"` は既定ブラウザで開くだけで停止/状態監視の対象外。 */
  kind: ToolKind;
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
    iconPng: it.tool.iconPng,
    name: it.tool.name,
    description: it.tool.description,
    launchMode: it.launchMode,
    enabled: it.enabled,
    kind: it.tool.kind,
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
  hasAnyTools,
  onNavigate,
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
  /** 登録済みツールが1件以上あるか（空状態の分岐用・バグ6/7）。 */
  hasAnyTools: boolean;
  /** 空状態からツール登録／プリセット追加画面へ遷移する（バグ6/7）。 */
  onNavigate: (next: Screen) => void;
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
    // 033e: PID プロセス（launchId 保持行）に加え、internal（コメビュ窓）行も追従対象にする。
    // どちらも無ければポーリングでは IPC しない（従来どおり no-op）。internal 行があれば、窓を直接
    // 閉じた場合の「未起動（停止済み）」への追従のためポーリングでも窓状態を確認する。
    const hasPid = runtimeRef.current.some((t) => t.launchId);
    const hasInternal = runtimeRef.current.some((t) => t.kind === "internal");
    if (!force && !hasPid && !hasInternal) return;
    const targetPresetId = presetIdRef.current;

    // PID プロセスの状態。復元・昇格が要る force 時と、launchId 保持行がある時だけ取得する
    // （internal のみの preset では PID 用 IPC を打たない）。
    let procs: RuntimeProcess[] = [];
    if (force || hasPid) {
      try {
        procs = await listRuntimeProcesses();
      } catch {
        // 状態取得の失敗は致命的でないため握りつぶす（次の再取得で回復する）。
        // ここで return するのは意図的: procs=[] のまま先へ進むと、下の突合で launchId 保持行が
        //   全て「registry から消えた＝stopped」に誤降格するため、PID 行を守る目的で中断する。
        // 副作用として、独立なはずの internal 窓状態（viewerOpen）取得も今サイクルはスキップされるが、
        //   internal のみの preset は poll 経路（force=false・hasPid=false）で listRuntimeProcesses を
        //   そもそも打たず 4 秒以内に追従するため self-heal する（許容範囲）。
        // 再修正トリガー: PID 用 IPC が継続的に失敗する状況でも窓状態追従を保証したくなったら、
        //   procsOk フラグを導入し「PID 突合はスキップ・internal 反映は続行」に分離する。
        return;
      }
    }
    // internal（コメビュ窓）の開閉状態。窓を直接閉じた場合の追従にも使う（PID registry には載せない）。
    let viewerOpen = false;
    if (hasInternal) {
      try {
        viewerOpen = await isCommentViewerOpen();
      } catch {
        // 窓状態の取得失敗は致命的でないため握りつぶす（次の再取得で回復する）。
      }
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
        // 033e: internal（コメビュ）は PID registry ではなく窓の開閉から state を導出する。
        // 開＝「起動済み」（running）/ 閉＝「停止済み」（stopped）。launchId は使わない。
        if (row.kind === "internal") {
          return { ...row, state: viewerOpen ? "running" : "stopped" };
        }
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
  // 023: url 種別は「開く」のみで PID 管理下に入らないため、カウント・一括停止の対象から除外する。
  // 033e: internal（コメビュ）は窓の開閉から state を導出でき reconcile が降格できるようになったため、
  //   「起動済み」カウント（isCountedRow）には含める＝他ツールと表示を揃える。ただし一括停止は
  //   stop_preset_processes（PID registry 経由）で窓を閉じられないため、一括トグル（isBulkStoppableRow）の
  //   対象からは外す。含めると「停止対象が無いのに一括停止トグルが点灯し続ける」ため。コメビュは個別の
  //   停止ボタンで閉じる（008/014 の一括停止の動作は変えない）。
  const isCountedRow = (t: RuntimeItem) => t.kind !== "url" && isActive(t.state);
  const isBulkStoppableRow = (t: RuntimeItem) =>
    t.kind !== "url" && t.kind !== "internal" && isActive(t.state);
  const launchedCount = runtime.filter(isCountedRow).length;
  // 009/010: 一括停止で止められる（launched/running）行が1つでもあれば一括ボタンを「一括停止」に切り替える。
  const anyLaunched = runtime.some(isBulkStoppableRow);

  // --- 単体起動（007: 実プロセス起動）---
  // frontend からは toolId のみを渡し、Tool 取得・パス検証・起動は Rust 側で行う。
  const handleStart = async (id: string, toolId: string, name: string) => {
    setLaunchFeedback(null);
    // 起動中は行のボタンが Spinner に置き換わり、自動的に無効化される。
    setToolState(id, "starting");
    try {
      // presetItemId（= 行キー id）を渡して registry に記録する。画面遷移で UI 状態を失っても
      // reconcile が presetItemId で「起動済み」を復元できる（バグ2）。
      const res = await launchTool(toolId, id);
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

  // --- 「開く」: 起動中アプリを前面に出す（バグ1・アクティブ化）---
  // frontend からは launchId のみを渡す（stop と同じ設計）。前面化は Rust 側が registry の実 PID を
  // 使って shell 非経由で行い、新規インスタンスは起動しない。
  // 成功時は UI を変更しない（すでに「起動済み」）。失敗時のみインラインでエラー表示する。
  const handleOpen = async (launchId: string | undefined, name: string) => {
    setLaunchFeedback(null);
    if (!launchId) {
      // 構成再描画直後などで一時的に launchId を失った行。registry を再取得して復元を促す
      // （handleStop の launchId 欠落ガードと同型）。
      void reconcile(true);
      setLaunchFeedback({
        kind: "warning",
        text: `${name} の起動状態を確認中です。少し待って再試行してください`,
      });
      return;
    }
    try {
      await focusProcess(launchId);
    } catch (e) {
      if (!mountedRef.current) return;
      setLaunchFeedback({
        kind: "error",
        text: `${name} を開けませんでした: ${toErrorMessage(e)}`,
      });
    }
  };

  // --- 023: url 種別ツールを既定ブラウザで開く ---
  // frontend は toolId のみ渡す。Rust 側が DB 保存 URL を http/https 検証してから opener に渡す。
  // PID 管理下に入れないため行 state は変えず（停止/状態表示なし）、成否のみフィードバックする。
  const handleOpenUrl = async (toolId: string, name: string) => {
    setLaunchFeedback(null);
    try {
      await launchTool(toolId);
      if (!mountedRef.current) return;
      setLaunchFeedback({ kind: "success", text: `${name} を開きました` });
    } catch (e) {
      if (!mountedRef.current) return;
      setLaunchFeedback({ kind: "error", text: toErrorMessage(e) });
    }
  };

  // --- 033e: internal（内蔵コメビュ）の起動/停止 ---
  // コメビュは PID プロセスではなく Tauri ウィンドウのため、PID registry ではなく窓の開閉で管理する。
  // 起動（窓を開く）は既存 launchTool を再利用する（Rust が open_comment_viewer_window を呼ぶ＝新規
  // spawn 面を作らない）。launchId は返らない（窓は PID の停止/監視対象外）。
  const handleStartInternal = async (
    id: string,
    toolId: string,
    name: string,
  ) => {
    setLaunchFeedback(null);
    setToolState(id, "starting");
    try {
      await launchTool(toolId);
      if (!mountedRef.current) return;
      // 窓が開いた＝「起動済み」（open_comment_viewer_window 成功で確定）。以降は 4 秒ポーラーが
      // 窓状態から state を同期し、窓を直接閉じた場合は「停止済み」へ追従する。
      setToolState(id, "running");
      setLaunchFeedback({ kind: "success", text: `${name} を開きました` });
    } catch (e) {
      if (!mountedRef.current) return;
      setToolState(id, "error");
      setLaunchFeedback({ kind: "error", text: toErrorMessage(e) });
    }
  };

  // 停止は close_comment_viewer_window で窓を閉じる。
  // ⚠⚠ **061b で「窓を閉じれば sidecar も連動停止」は偽になった**（061b レビュー S-1）。
  //   停止条件が「コメビュ窓 or エフェクト窓のどちらも無いとき」へ広がったので、
  //   **エフェクト窓が開いている間はこのボタンで sidecar が落ちない**＝Twitch/YouTube の取得
  //   （外部通信）も続く（sidecar の取得セッションは `stop-session` かプロセス終了でしか止まらず、
  //   窓を閉じても `stop-session` は送られない）。それでもツール行の state は `stopped` に落とす——
  //   `is_comment_viewer_open` が見ているのは**窓の存在**であり、ツール行の意味は「窓が開いているか」だから。
  // ⚠⚠ **ただしフィードバック文言は分岐させる**（061b レビュー②S-5・当初は「別画面の案内で足りる」として
  //   見送っていたが、**修正必須と再判定された**）。理由: 取得を止める操作をした当の画面が
  //   「停止しました」と**積極的に偽を述べる**状態になっており、061a の Q-1（「配信中には表示されません」）と
  //   同じ失敗モードだった。しかも唯一の明示は別画面（`ObsEffectsScreen`）の、さらに
  //   `viewerOpen === false` のときだけ出る注記で、エフェクト窓は永続設定でアプリ起動時に自動復元される
  //   ＝ユーザーが数日その画面を見ていなくても成立する。docs/security.md §1「取得の停止条件」が
  //   「取得が続いていることと止め方を明示する導線を必ず保つこと」を要求している。
  // ⚠ 窓の状態軸は増やさない（ツール行は「窓が開いているか」のまま）。増やすのは**文言だけ**で、
  //   判定は既存の `is_effect_overlay_open`（061a・新 command ゼロ）を読むだけ。
  // ⚠ 判定に失敗したら**通常の文言へフォールバック**する（停止操作自体は成功しているので、
  //   ここで失敗を見せると「停止できなかった」と誤解させる）。
  // 窓 close 直後は窓存在判定に一瞬ラグがあり得るため、停止直後に reconcile(true) は呼ばず、楽観更新
  // （stopped）＋4 秒ポーラー（窓状態）で確定する（「停止済み↔起動済み」フリッカを避ける）。
  // 前提: 本緩和は「窓 close 完了が次 poll（4 秒）までに終わる」ことに依存する。close が 1 poll 周期を
  //   超えて残ると、直後の isCommentViewerOpen() が is_some()=true を返して一時的に stopped→running→
  //   stopped と戻り得る（Tauri の close は実測 ≪4 秒で通常は発生しないが E2E で要確認）。
  // 再修正トリガー: E2E で上記フリッカが観測されたら、poll 任せにせず停止直後に一定時間だけ
  //   internal 行の running 昇格を抑止する（stopping 据え置き等の短い抑制窓）ガードを入れる。
  const handleStopInternal = async (id: string, name: string) => {
    setLaunchFeedback(null);
    setToolState(id, "stopping");
    try {
      await closeCommentViewerWindow();
      if (!mountedRef.current) return;
      setToolState(id, "stopped");
      // ⚠ エフェクト窓が残っていると sidecar は落ちず、コメント取得（外部通信）が続く（上の注記）。
      const effectOpen = await isEffectOverlayOpen().catch(() => false);
      if (!mountedRef.current) return;
      setLaunchFeedback({
        kind: "success",
        text: effectOpen
          ? `${name} を閉じました。エフェクトのウィンドウが表示中のため、コメントの取得は続いています（止めるには、エフェクトの表示を OFF にするか、コメントビューアを開いて取得を停止してください）`
          : `${name} を停止しました`,
      });
    } catch (e) {
      if (!mountedRef.current) return;
      // 失敗時は起動中へ戻し、再試行できるようにする（handleStop と同型）。
      setToolState(id, "launched");
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
    // 起動中（launched/running）の行を停止中表示に。033e: internal（コメビュ）は一括停止で窓を
    // 閉じられない（stop_preset_processes は PID registry 経由）ため、一括の「停止中」表示にはしない
    // ＝閉じないのに「停止済み」になる誤りを避ける（一括停止の対象は Rust 側で不変・個別停止で閉じる）。
    setRuntime((prev) =>
      prev.map((t) =>
        isBulkStoppableRow(t) ? { ...t, state: "stopping" as ToolState } : t,
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

  // プリセットが1件も無い（未選択）場合は空状態を表示する。
  // ツールが1件も無いときは、まずツール登録を促す（プリセットはツールが無いと作れないため）。
  if (presetName === null) {
    return hasAnyTools ? (
      <div className={styles.emptyState}>
        <h2>まだプリセットがありません</h2>
        <p>
          プリセットを登録して、配信で使うツール構成を保存しましょう。
        </p>
        <button
          className={styles.emptyAction}
          onClick={() => onNavigate("add-preset")}
        >
          ＋ プリセットを登録
        </button>
      </div>
    ) : (
      <div className={styles.emptyState}>
        <h2>まだツールがありません</h2>
        <p>
          まずは配信で使うツールを登録しましょう。ツールを1つ以上登録すると、プリセットを作成できます。
        </p>
        <button
          className={styles.emptyAction}
          onClick={() => onNavigate("add-tool")}
        >
          ＋ ツールを登録
        </button>
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
              launch={!anyLaunched}
              disabled={
                launching || stopping || (!anyLaunched && (isEmpty || !hasEnabled))
              }
              onClick={anyLaunched ? stopAll : launchAll}
              data-tutorial-id="main-launch-all"
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

      {/* インフォメーション（起動/エラー等）は「起動順」の上に表示する（バグ3）。 */}
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
              ツールを登録」でツールを登録してください。
            </div>
          ) : (
            availableTools.map((tool) => (
              <button
                key={tool.id}
                className={styles.pickerRow}
                onClick={() => addTool(tool.id)}
              >
                <IconTile
                  glyph={toIconLetter(tool)}
                  imageSrc={iconDataUri(tool.iconPng)}
                  size="sm"
                />
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
                  iconPng: item.iconPng,
                  name: item.name,
                  description: item.description,
                  state: item.state,
                  kind: item.kind,
                }}
                index={index}
                total={runtime.length}
                orderLabel={parallel ? "並行" : String(orderedIndexFor(runtime, index))}
                parallel={parallel}
                editMode={editMode}
                onStart={() =>
                  item.kind === "internal"
                    ? // 033e: internal は窓を開く（launchTool→open_comment_viewer_window）。
                      void handleStartInternal(item.id, item.toolId, item.name)
                    : void handleStart(item.id, item.toolId, item.name)
                }
                onStop={() =>
                  item.kind === "internal"
                    ? // 033e: internal は窓を閉じる（close_comment_viewer_window・PID kill しない）。
                      void handleStopInternal(item.id, item.name)
                    : void handleStop(item.id, item.launchId, item.name)
                }
                onOpen={() =>
                  item.kind === "url" || item.kind === "internal"
                    ? // 023/033e: url は既定ブラウザ、internal は launchTool 経由で Rust が別ウィンドウを
                      //   開く/前面化する（開いていれば open_comment_viewer_window が front-focus する）。
                      void handleOpenUrl(item.toolId, item.name)
                    : void handleOpen(item.launchId, item.name)
                }
                onMoveUp={() => move(index, -1)}
                onMoveDown={() => move(index, 1)}
                onToggleMode={() => toggleMode(item)}
                onDelete={() => remove(item.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
