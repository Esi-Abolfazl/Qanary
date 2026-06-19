import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./tokens.css";
import { applyTheme, loadTheme } from "./theme";

// Apply persisted theme before first paint so there's no flash of wrong theme.
applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
