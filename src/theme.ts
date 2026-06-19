// Theme = follow OS by default, with a manual override persisted in
// localStorage. The actual color resolution is pure CSS (light-dark() in
// tokens.css); this module only flips the data-theme attribute.
// ponytail: localStorage, not backend config — no Rust change needed. Move to
// the persisted Config if theme ever needs to survive a localStorage clear.
import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "qanary-theme";

export function loadTheme(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  localStorage.setItem(KEY, mode);
}

/** Cycle system → light → dark → system. */
export function nextTheme(mode: ThemeMode): ThemeMode {
  return mode === "system" ? "light" : mode === "light" ? "dark" : "system";
}

export function useTheme(): [ThemeMode, () => void] {
  const [mode, setMode] = useState<ThemeMode>(loadTheme);
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);
  return [mode, () => setMode((m) => nextTheme(m))];
}
