import { describe, expect, it, vi } from "vitest";
import { registerEditorSurfaceThemes } from "./editorSurfaceTheme";

describe("editor surface themes", () => {
  it("keeps the editor and gutter transparent while widgets stay readable", () => {
    const themes = new Map<string, any>();
    const defineTheme = vi.fn((name: string, theme: any) => themes.set(name, theme));

    registerEditorSurfaceThemes({ editor: { defineTheme } });

    expect(defineTheme).toHaveBeenCalledTimes(2);
    for (const name of ["latotex-editor-light", "latotex-editor-dark"]) {
      const colors = themes.get(name)?.colors;
      expect(colors?.["editor.background"]).toBe("#00000000");
      expect(colors?.["editorGutter.background"]).toBe("#00000000");
      expect(colors?.["editorWidget.background"]).not.toBe("#00000000");
      expect(colors?.["editorSuggestWidget.background"]).not.toBe("#00000000");
    }
  });
});
