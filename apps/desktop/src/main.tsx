import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/theme.css";
import { applyThemePreference, loadThemePreference } from "./features/theme/theme";

// 初回描画前に保存済みテーマを反映して、既定（ダーク）からのちらつき（FOUC）を防ぐ。
applyThemePreference(loadThemePreference());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
