// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderConfig: vi.fn(),
  monacoModule: { KeyCode: { Tab: 2 }, editor: {}, languages: {} },
  monacoEditorProps: [] as any[],
}));

vi.mock("@monaco-editor/react", () => ({
  default: (props: any) => {
    mocks.monacoEditorProps.push(props);
    return <div data-testid="monaco-editor" />;
  },
  loader: {
    config: mocks.loaderConfig,
  },
}));

vi.mock("monaco-editor/esm/vs/editor/editor.api.js", () => mocks.monacoModule);

vi.mock("./editorCodeLanguages", () => ({
  loadDeferredEditorLanguage: vi.fn(),
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

  it("normalizes dotfile paths into absolute Monaco model paths", async () => {
    const { WorkspaceMonacoEditor, toMonacoModelPath } = await import("./WorkspaceMonacoEditor");

    expect(toMonacoModelPath(".gitignore")).toBe("/.gitignore");
    expect(toMonacoModelPath("docs\\README")).toBe("/docs/README");

    const element = WorkspaceMonacoEditor({
      path: ".env.local",
      language: "plaintext",
      theme: "vs",
      value: "",
      options: {},
      editorInstanceRef: { current: null },
      onChange: vi.fn(),
      onMount: vi.fn(),
    }) as any;

    expect(element.props.path).toBe("/.env.local");
  });

  it("requests deferred Monaco language loading for the current language", async () => {
    const languageModule = await import("./editorCodeLanguages");
    const { WorkspaceMonacoEditor } = await import("./WorkspaceMonacoEditor");

    const element = WorkspaceMonacoEditor({
      path: "script.py",
      language: "python",
      theme: "vs",
      value: "",
      options: {},
      editorInstanceRef: { current: null },
      onChange: vi.fn(),
      onMount: vi.fn(),
    }) as any;

    element.props.beforeMount(mocks.monacoModule);

    expect(languageModule.loadDeferredEditorLanguage).toHaveBeenCalledWith("python");
  });
});
