// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderConfig: vi.fn(),
  monacoModule: { KeyCode: { Tab: 2 }, editor: {}, languages: {} },
}));

vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="monaco-editor" />,
  loader: {
    config: mocks.loaderConfig,
  },
}));

vi.mock("monaco-editor/esm/vs/editor/editor.api.js", () => mocks.monacoModule);

vi.mock("./editorCodeLanguages", () => ({
  registerEditorCodeLanguages: vi.fn(),
}));

vi.mock("./editorSurfaceTheme", () => ({
  registerEditorSurfaceThemes: vi.fn(),
}));

vi.mock("./latexCompletion", () => ({
  ensureLatexCompletionProvider: vi.fn(),
}));

describe("WorkspaceMonacoEditor", () => {
  it("binds the Monaco React loader to the bundled monaco-editor module", async () => {
    await import("./WorkspaceMonacoEditor");

    expect(mocks.loaderConfig).toHaveBeenCalledWith({
      monaco: expect.objectContaining({
        KeyCode: mocks.monacoModule.KeyCode,
      }),
    });
  });
});
