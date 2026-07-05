import { useState } from "react";
import type { Screen } from "./types";
import { presets } from "./data/mockData";
import { Window } from "./components/Window";
import { Sidebar } from "./components/Sidebar";
import { MainScreen } from "./screens/main/MainScreen";
import { AddToolScreen } from "./screens/add-tool/AddToolScreen";
import { AddPresetScreen } from "./screens/add-preset/AddPresetScreen";

function App() {
  const [screen, setScreen] = useState<Screen>("main");
  const [activePresetId, setActivePresetId] = useState(presets[0].id);
  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];

  const sidebar = (
    <Sidebar
      activePresetId={activePresetId}
      onSelectPreset={setActivePresetId}
      onNavigate={setScreen}
    />
  );

  return (
    <Window sidebar={screen === "main" ? sidebar : undefined}>
      {screen === "main" && <MainScreen presetName={activePreset.name} />}
      {screen === "add-tool" && <AddToolScreen onNavigate={setScreen} />}
      {screen === "add-preset" && <AddPresetScreen onNavigate={setScreen} />}
    </Window>
  );
}

export default App;
