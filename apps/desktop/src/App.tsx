import { useEffect, useState } from "react";
import type { Screen } from "./types";
import { Window } from "./components/Window";
import { Sidebar } from "./components/Sidebar";
import { MainScreen } from "./screens/main/MainScreen";
import { AddToolScreen } from "./screens/add-tool/AddToolScreen";
import { AddPresetScreen } from "./screens/add-preset/AddPresetScreen";
import { useTools } from "./features/tools/useTools";
import { deleteTool } from "./features/tools/toolApi";
import { usePresets } from "./features/presets/usePresets";
import { deletePreset } from "./features/presets/presetApi";

function App() {
  const [screen, setScreen] = useState<Screen>("main");

  const { tools, reload: reloadTools } = useTools();
  const { presets, reload: reloadPresets } = usePresets();

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
    if (!window.confirm(`「${label}」を削除しますか？`)) return;
    await deleteTool(id);
    await reloadTools();
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
    if (!window.confirm(`「${label}」を削除しますか？`)) return;
    await deletePreset(id);
    // 選択中を消した場合は、残りの先頭（無ければ null）へ切り替える
    if (activePresetId === id) {
      const remaining = presets.filter((p) => p.id !== id);
      setActivePresetId(remaining[0]?.id ?? null);
    }
    await reloadPresets();
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

  const sidebar = (
    <Sidebar
      presets={presets}
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
        <MainScreen presetName={activePreset?.name ?? null} tools={tools} />
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
          onSaved={reloadPresets}
        />
      )}
    </Window>
  );
}

export default App;
