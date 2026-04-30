const EDITOR_THEME_LIGHT = "latotex-editor-light";
const EDITOR_THEME_DARK = "latotex-editor-dark";
const registeredThemeHosts = new WeakSet<object>();

type MonacoLike = {
  editor?: {
    defineTheme?: (name: string, theme: Record<string, unknown>) => void;
  };
};

export function getEditorSurfaceThemeName(): string {
  if (typeof document === "undefined") {
    return EDITOR_THEME_LIGHT;
  }
  return document.documentElement.dataset.theme === "dark"
    ? EDITOR_THEME_DARK
    : EDITOR_THEME_LIGHT;
}

export function registerEditorSurfaceThemes(monaco: MonacoLike) {
  const defineTheme = monaco.editor?.defineTheme;
  if (!defineTheme || !monaco || typeof monaco !== "object") {
    return;
  }
  if (registeredThemeHosts.has(monaco)) {
    return;
  }
  registeredThemeHosts.add(monaco);

  defineTheme(EDITOR_THEME_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword", foreground: "1d4ed8" },
      { token: "keyword.control", foreground: "9333ea", fontStyle: "bold" },
      { token: "keyword.declaration", foreground: "be123c" },
      { token: "string", foreground: "047857" },
      { token: "string.delimiter", foreground: "0f766e" },
      { token: "type.identifier", foreground: "7c3aed" },
      { token: "attribute.name", foreground: "b45309" },
      { token: "attribute.value", foreground: "0e7490" },
      { token: "number", foreground: "c2410c" },
      { token: "operator", foreground: "334155" },
      { token: "delimiter", foreground: "475569" },
    ],
    colors: {
      "editor.background": "#fffdf8",
      "editor.foreground": "#0f172a",
      "editorLineNumber.foreground": "#94a3b8",
      "editorLineNumber.activeForeground": "#334155",
      "editorCursor.foreground": "#2563eb",
      "editor.selectionBackground": "#bfdbfe66",
      "editor.inactiveSelectionBackground": "#dbeafe55",
      "editor.lineHighlightBackground": "#eff6ff70",
      "editor.lineHighlightBorder": "#dbeafe",
      "editorIndentGuide.background1": "#e2e8f0",
      "editorIndentGuide.activeBackground1": "#93c5fd",
      "editorBracketHighlight.foreground1": "#2563eb",
      "editorBracketHighlight.foreground2": "#0f766e",
      "editorBracketHighlight.foreground3": "#7c3aed",
      "editorWhitespace.foreground": "#cbd5e1",
      "editorGutter.background": "#fffdf8",
      "editorWidget.background": "#fffaf0",
      "editorWidget.border": "#d6d3d1",
      "editorHoverWidget.background": "#fffaf0",
      "editorHoverWidget.border": "#d6d3d1",
      "editorSuggestWidget.background": "#fffaf0",
      "editorSuggestWidget.border": "#d6d3d1",
      "editorSuggestWidget.foreground": "#0f172a",
      "editorSuggestWidget.selectedBackground": "#eff6ff",
      "editorSuggestWidget.highlightForeground": "#1d4ed8",
      "editorSuggestWidget.focusHighlightForeground": "#1d4ed8",
      "editorGhostText.foreground": "#64748bcc",
      "editorGhostText.background": "#ffffff00",
      "editorGhostText.border": "#93c5fd55",
      "scrollbar.shadow": "#ffffff00",
      "scrollbarSlider.background": "#cbd5e155",
      "scrollbarSlider.hoverBackground": "#94a3b866",
      "scrollbarSlider.activeBackground": "#64748b77",
    },
  });

  defineTheme(EDITOR_THEME_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "7c8aa5", fontStyle: "italic" },
      { token: "keyword", foreground: "8ab4ff" },
      { token: "keyword.control", foreground: "c4b5fd", fontStyle: "bold" },
      { token: "keyword.declaration", foreground: "fda4af" },
      { token: "string", foreground: "7dd3a7" },
      { token: "string.delimiter", foreground: "5eead4" },
      { token: "type.identifier", foreground: "c4b5fd" },
      { token: "attribute.name", foreground: "fbbf24" },
      { token: "attribute.value", foreground: "67e8f9" },
      { token: "number", foreground: "fdba74" },
      { token: "operator", foreground: "cbd5e1" },
      { token: "delimiter", foreground: "94a3b8" },
    ],
    colors: {
      "editor.background": "#0f1720",
      "editor.foreground": "#e2e8f0",
      "editorLineNumber.foreground": "#52607a",
      "editorLineNumber.activeForeground": "#dbe4f0",
      "editorCursor.foreground": "#60a5fa",
      "editor.selectionBackground": "#1d4ed866",
      "editor.inactiveSelectionBackground": "#1e3a8a55",
      "editor.lineHighlightBackground": "#17255466",
      "editor.lineHighlightBorder": "#1e40af88",
      "editorIndentGuide.background1": "#243041",
      "editorIndentGuide.activeBackground1": "#3b82f6",
      "editorBracketHighlight.foreground1": "#60a5fa",
      "editorBracketHighlight.foreground2": "#5eead4",
      "editorBracketHighlight.foreground3": "#c4b5fd",
      "editorWhitespace.foreground": "#334155",
      "editorGutter.background": "#0f1720",
      "editorWidget.background": "#111b29",
      "editorWidget.border": "#334155",
      "editorHoverWidget.background": "#111b29",
      "editorHoverWidget.border": "#334155",
      "editorSuggestWidget.background": "#111b29",
      "editorSuggestWidget.border": "#334155",
      "editorSuggestWidget.foreground": "#e2e8f0",
      "editorSuggestWidget.selectedBackground": "#1e3a5f",
      "editorSuggestWidget.highlightForeground": "#93c5fd",
      "editorSuggestWidget.focusHighlightForeground": "#93c5fd",
      "editorGhostText.foreground": "#94a3b4aa",
      "editorGhostText.background": "#00000000",
      "editorGhostText.border": "#33415566",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#33415588",
      "scrollbarSlider.hoverBackground": "#475569aa",
      "scrollbarSlider.activeBackground": "#64748bcc",
    },
  });
}
