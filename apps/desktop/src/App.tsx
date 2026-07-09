import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Screen } from "./types";
import { Window } from "./components/Window";
import { Sidebar } from "./components/Sidebar";
import { MainScreen } from "./screens/main/MainScreen";
import { AddToolScreen } from "./screens/add-tool/AddToolScreen";
import { AddPresetScreen } from "./screens/add-preset/AddPresetScreen";
import { DiagnosticsScreen } from "./screens/diagnostics/DiagnosticsScreen";
import { useTools } from "./features/tools/useTools";
import { deleteTool } from "./features/tools/toolApi";
import { usePresets } from "./features/presets/usePresets";
import { deletePreset } from "./features/presets/presetApi";
import { usePresetItems } from "./features/presets/usePresetItems";
import {
  addToolToPreset,
  removeToolFromPreset,
  reorderPresetItems,
  updatePresetItem,
} from "./features/presets/presetItemApi";
import { withTools } from "./features/presets/types";
import type { LaunchMode, PresetItemMeta } from "./features/presets/types";

function App() {
  const [screen, setScreen] = useState<Screen>("main");

  const { tools, reload: reloadTools } = useTools();
  const { presets, reload: reloadPresets } = usePresets();
  const { items: presetItems, reload: reloadPresetItems } = usePresetItems();

  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);

  // プリセット一覧が変わったら、選択中IDが有効か検証し、無効なら先頭（無ければ null）へ寄せる
  useEffect(() => {
    setActivePresetId((current) => {
      if (current && presets.some((p) => p.id === current)) return current;
      return presets[0]?.id ?? null;
    });
  }, [presets]);

  const activePreset = presets.find((p) => p.id === activePresetId) ?? null;
  const editingPreset = presets.find((p) => p.id === editingPresetId) ?? null;
  const editingTool = tools.find((t) => t.id === editingToolId) ?? null;

  // 選択中プリセットのツール構成（Tool 情報を合成した表示用一覧）
  const activeItems = useMemo(
    () =>
      withTools(
        presetItems.filter((i) => i.presetId === activePresetId),
        tools,
      ),
    [presetItems, activePresetId, tools],
  );

  // 選択中プリセットにまだ入っていない登録済みツール（＋ツール追加の候補）
  const availableTools = useMemo(() => {
    const usedToolIds = new Set(
      presetItems
        .filter((i) => i.presetId === activePresetId)
        .map((i) => i.toolId),
    );
    return tools.filter((t) => !usedToolIds.has(t.id));
  }, [presetItems, activePresetId, tools]);

  // サイドバー用：プリセットごとのツール数・並行有無
  const presetMeta = useMemo(() => {
    const map = new Map<string, PresetItemMeta>();
    for (const item of presetItems) {
      const meta = map.get(item.presetId) ?? { count: 0, hasParallel: false };
      meta.count += 1;
      if (item.launchMode === "parallel") meta.hasParallel = true;
      map.set(item.presetId, meta);
    }
    return map;
  }, [presetItems]);

  // --- ツール ---
  const openAddTool = () => {
    setEditingToolId(null);
    setScreen("add-tool");
  };

  const openEditTool = (id: string) => {
    setEditingToolId(id);
    setScreen("add-tool");
  };

  const handleDeleteTool = async (id: string) => {
    const target = tools.find((t) => t.id === id);
    const label = target ? target.name : "このツール";
    const ok = await ask(`「${label}」を削除しますか？`, {
      title: "ツールの削除",
      kind: "warning",
    });
    if (!ok) return;
    await deleteTool(id);
    await reloadTools();
    // ツール削除でプリセット構成（preset_items）もカスケード除去されるため再読込
    await reloadPresetItems();
  };

  // --- プリセット ---
  const openAddPreset = () => {
    setEditingPresetId(null);
    setScreen("add-preset");
  };

  const openEditPreset = (id: string) => {
    setEditingPresetId(id);
    setScreen("add-preset");
  };

  const handleDeletePreset = async (id: string) => {
    const target = presets.find((p) => p.id === id);
    const label = target ? target.name : "このプリセット";
    const ok = await ask(`「${label}」を削除しますか？`, {
      title: "プリセットの削除",
      kind: "warning",
    });
    if (!ok) return;
    await deletePreset(id);
    // 選択中を消した場合は、残りの先頭（無ければ null）へ切り替える
    if (activePresetId === id) {
      const remaining = presets.filter((p) => p.id !== id);
      setActivePresetId(remaining[0]?.id ?? null);
    }
    await reloadPresets();
    await reloadPresetItems();
  };

  // --- プリセット内ツール構成（メイン画面の編集モードから即時保存）---
  const handleAddToolToPreset = async (presetId: string, toolId: string) => {
    await addToolToPreset({ presetId, toolId });
    await reloadPresetItems();
  };

  const handleRemovePresetItem = async (id: string) => {
    const target = presetItems.find((i) => i.id === id);
    const presetId = target?.presetId ?? null;
    const remainingCount = presetId
      ? presetItems.filter((i) => i.presetId === presetId).length
      : 0;

    // 最後の1件を外す場合は、プリセット自体を削除する（確認あり）
    if (presetId && remainingCount <= 1) {
      const ok = await ask(
        "プリセットからツールがすべて削除されるとプリセットも削除されます。よろしいですか？",
        { title: "プリセットの削除", kind: "warning" },
      );
      if (!ok) return;
      await deletePreset(presetId);
      // 選択中を消した場合は残りの先頭（無ければ null）へ切替（handleDeletePreset と同型）
      if (activePresetId === presetId) {
        const remaining = presets.filter((p) => p.id !== presetId);
        setActivePresetId(remaining[0]?.id ?? null);
      }
      await reloadPresets();
      await reloadPresetItems();
      return;
    }

    await removeToolFromPreset(id);
    await reloadPresetItems();
  };

  const handleReorderPresetItems = async (
    presetId: string,
    orderedIds: string[],
  ) => {
    await reorderPresetItems(presetId, orderedIds);
    await reloadPresetItems();
  };

  const handleSetLaunchMode = async (
    id: string,
    launchMode: LaunchMode,
    enabled: boolean,
  ) => {
    await updatePresetItem(id, { launchMode, enabled });
    await reloadPresetItems();
  };

  const reloadPresetData = async () => {
    await reloadPresets();
    await reloadPresetItems();
  };

  const handleNavigate = (next: Screen) => {
    if (next === "add-tool") {
      openAddTool();
      return;
    }
    if (next === "add-preset") {
      openAddPreset();
      return;
    }
    setScreen(next);
  };

  // 編集対象プリセットの既存ツール構成（AddPresetScreen の初期値）。
  // フィルタ結果の identity を安定させ、編集画面側の初期化 effect の無限再実行を防ぐ。
  const editingItems = useMemo(
    () => presetItems.filter((i) => i.presetId === editingPresetId),
    [presetItems, editingPresetId],
  );

  const sidebar = (
    <Sidebar
      presets={presets}
      presetMeta={presetMeta}
      activePresetId={activePresetId}
      onSelectPreset={setActivePresetId}
      onEditPreset={openEditPreset}
      onDeletePreset={handleDeletePreset}
      onNavigate={handleNavigate}
      showToolList
      tools={tools}
      onEditTool={openEditTool}
      onDeleteTool={handleDeleteTool}
    />
  );

  return (
    <Window sidebar={screen === "main" ? sidebar : undefined}>
      {screen === "main" && (
        <MainScreen
          presetName={activePreset?.name ?? null}
          presetId={activePresetId}
          items={activeItems}
          availableTools={availableTools}
          hasAnyTools={tools.length > 0}
          onNavigate={handleNavigate}
          onAddTool={handleAddToolToPreset}
          onRemoveItem={handleRemovePresetItem}
          onReorder={handleReorderPresetItems}
          onSetLaunchMode={handleSetLaunchMode}
        />
      )}
      {screen === "add-tool" && (
        <AddToolScreen
          onNavigate={setScreen}
          editingTool={editingTool}
          onSaved={reloadTools}
        />
      )}
      {screen === "add-preset" && (
        <AddPresetScreen
          onNavigate={setScreen}
          editingPreset={editingPreset}
          editingItems={editingItems}
          tools={tools}
          onSaved={reloadPresetData}
        />
      )}
      {screen === "diagnostics" && <DiagnosticsScreen onNavigate={setScreen} />}
    </Window>
  );
}

export default App;
