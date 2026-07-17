export function getTerminalSurfaceTheme() {
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  return dark
    ? {
        background: "#00000000",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        selectionBackground: "#334155aa",
      }
    : {
        background: "#00000000",
        foreground: "#1e293b",
        cursor: "#059669",
        selectionBackground: "#a7f3d080",
      };
}
