import { useState } from "react";
import type { Screen } from "./types";
import { presets } from "./data/mockData";
import { Window } from "./components/Window";
import { Sidebar } from "./components/Sidebar";
import { MainScreen } from "./screens/main/MainScreen";
import { AddToolScreen } from "./screens/add-tool/AddToolScreen";
import { AddPresetScreen } from "./screens/add-preset/AddPresetScreen";
import { useTools } from "./features/tools/useTools";
import { deleteTool } from "./features/tools/toolApi";

function App() {
  const [screen, setScreen] = useState<Screen>("main");
  const [activePresetId, setActivePresetId] = useState(presets[0].id);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];

  const { tools, reload } = useTools();
  const editingTool = tools.find((t) => t.id === editingToolId) ?? null;

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
    await reload();
  };

  const handleNavigate = (next: Screen) => {
    if (next === "add-tool") {
      openAddTool();
      return;
    }
    setScreen(next);
  };

  const sidebar = (
    <Sidebar
      activePresetId={activePresetId}
      onSelectPreset={setActivePresetId}
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
        <MainScreen presetName={activePreset.name} tools={tools} />
      )}
      {screen === "add-tool" && (
        <AddToolScreen
          onNavigate={setScreen}
          editingTool={editingTool}
          onSaved={reload}
        />
      )}
      {screen === "add-preset" && <AddPresetScreen onNavigate={setScreen} />}
    </Window>
  );
}

export default App;
