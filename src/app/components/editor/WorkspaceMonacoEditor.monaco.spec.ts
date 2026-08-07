// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";

describe("WorkspaceMonacoEditor real Monaco models", () => {
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: false,
        media: "",
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }),
    });
  });

  it("creates, switches, and tokenizes encoded dotfile models", async () => {
    const monaco = await import("monaco-editor/esm/vs/editor/editor.api.js");
    const { registerEditorCodeLanguages } = await import("./editorCodeLanguages");
    const { toMonacoModelPath } = await import("./WorkspaceMonacoEditor");
    registerEditorCodeLanguages(monaco);
    const paths = [
      toMonacoModelPath("project one", "main.tex"),
      toMonacoModelPath("project one", ".gitignore"),
      toMonacoModelPath("project one", ".editorconfig"),
    ];
    expect(paths.every(Boolean)).toBe(true);

    const mainModel = monaco.editor.createModel(
      "\\documentclass{article}",
      "latex",
      monaco.Uri.parse(paths[0]!),
    );
    const ignoreModel = monaco.editor.createModel(
      "target/\n# generated",
      "ignore",
      monaco.Uri.parse(paths[1]!),
    );
    const editorConfigModel = monaco.editor.createModel(
      "root = true\n[*]\nindent_style = space",
      "editorconfig",
      monaco.Uri.parse(paths[2]!),
    );

    monaco.editor.setModelLanguage(mainModel, "ignore");
    monaco.editor.setModelLanguage(mainModel, "latex");
    expect(mainModel.getLanguageId()).toBe("latex");
    expect(ignoreModel.uri.scheme).toBe("latotex");
    expect(ignoreModel.uri.authority).toBe("workspace");
    expect(ignoreModel.uri.path).toBe("/project one/.gitignore");
    expect(editorConfigModel.getLanguageId()).toBe("editorconfig");
    expect(monaco.editor.tokenize(ignoreModel.getValue(), "ignore").length).toBe(2);
    expect(monaco.editor.tokenize(editorConfigModel.getValue(), "editorconfig").length).toBe(3);
    monaco.editor.getModels().forEach((model) => model.dispose());
  }, 180_000);
});
