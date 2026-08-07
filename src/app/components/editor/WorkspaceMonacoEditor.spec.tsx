// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    mocks.monacoEditorProps.length = 0;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("binds the Monaco React loader to the bundled monaco-editor module", async () => {
    await import("./WorkspaceMonacoEditor");

    expect(mocks.loaderConfig).toHaveBeenCalledWith({
      monaco: expect.objectContaining({
        KeyCode: mocks.monacoModule.KeyCode,
      }),
    });
  });

  it("builds project-scoped encoded Monaco model URIs", async () => {
    const { toMonacoModelPath } = await import("./WorkspaceMonacoEditor");

    expect(toMonacoModelPath("project-a", ".gitignore"))
      .toBe("latotex://workspace/project-a/.gitignore");
    expect(toMonacoModelPath("project-a", "docs\\draft #1?.tex"))
      .toBe("latotex://workspace/project-a/docs/draft%20%231%3F.tex");
    expect(toMonacoModelPath("project/a", "100%/main.tex"))
      .toBe("latotex://workspace/project%2Fa/100%25/main.tex");
    expect(toMonacoModelPath("project-a", "docs/main.tex"))
      .not.toBe(toMonacoModelPath("project-b", "docs/main.tex"));
    expect(toMonacoModelPath("", ".gitignore")).toBeUndefined();
  });

  it("requests deferred Monaco language loading for the current language", async () => {
    const languageModule = await import("./editorCodeLanguages");
    const { WorkspaceMonacoEditor } = await import("./WorkspaceMonacoEditor");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkspaceMonacoEditor
          projectId="project-a"
          path="script.py"
          language="python"
          theme="vs"
          value=""
          options={{}}
          editorInstanceRef={{ current: null }}
          onChange={vi.fn()}
          onMount={vi.fn()}
        />,
      );
    });
    const editorProps = mocks.monacoEditorProps[mocks.monacoEditorProps.length - 1];
    editorProps.beforeMount(mocks.monacoModule);

    expect(languageModule.loadDeferredEditorLanguage).toHaveBeenCalledWith("python");
    expect(editorProps.path).toBe("latotex://workspace/project-a/script.py");
    await act(async () => root.unmount());
  });

  it("refreshes after window activation and restores only prior editor focus", async () => {
    const { WorkspaceMonacoEditor } = await import("./WorkspaceMonacoEditor");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const editorInstanceRef = { current: null as any };
    let pendingFrame: FrameRequestCallback | null = null;
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return 1;
    });
    const editor = {
      addCommand: vi.fn(),
      focus: vi.fn(),
      hasTextFocus: vi.fn(() => true),
      layout: vi.fn(),
      onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDispose: vi.fn(),
      onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
      render: vi.fn(),
      trigger: vi.fn(),
      updateOptions: vi.fn(),
    };

    await act(async () => {
      root.render(
        <WorkspaceMonacoEditor
          projectId="project-a"
          path="main.tex"
          language="latex"
          theme="vs"
          value=""
          options={{}}
          editorInstanceRef={editorInstanceRef}
          onChange={vi.fn()}
          onMount={vi.fn()}
        />,
      );
    });
    mocks.monacoEditorProps[mocks.monacoEditorProps.length - 1].onMount(editor, mocks.monacoModule);

    window.dispatchEvent(new Event("blur"));
    editor.hasTextFocus.mockReturnValue(false);
    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    (pendingFrame as FrameRequestCallback | null)?.(0);
    expect(editor.layout).toHaveBeenCalledTimes(2);
    expect(editor.render).toHaveBeenCalledWith(true);
    expect(editor.focus).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    (pendingFrame as FrameRequestCallback | null)?.(1);
    expect(editor.focus).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
