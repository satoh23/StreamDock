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
      activePresetId={screen === "main" ? activePresetId : undefined}
      onSelectPreset={(id) => {
        setActivePresetId(id);
        setScreen("main");
      }}
      showToolList={screen !== "main"}
      activeNav={screen === "main" ? undefined : screen}
      onNavigate={setScreen}
    />
  );

  return (
    <Window sidebar={sidebar}>
      {screen === "main" && <MainScreen presetName={activePreset.name} />}
      {screen === "add-tool" && <AddToolScreen onNavigate={setScreen} />}
      {screen === "add-preset" && <AddPresetScreen onNavigate={setScreen} />}
    </Window>
  );
}

export default App;
