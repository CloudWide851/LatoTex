// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const models = new Map<string, any>();
  const editors: any[] = [];
  let anonymousModelSequence = 0;
  const disposable = () => ({ dispose: vi.fn() });
  const monacoModule = {
    KeyCode: { Tab: 2 },
    Uri: {
      parse: vi.fn((value: string) => ({
        path: value,
        toString: () => value,
      })),
    },
    languages: {},
    editor: {
      EditorOption: { readOnly: 91 },
      getModel: vi.fn((uri: { path: string }) => models.get(uri.path) ?? null),
      createModel: vi.fn((value: string, language: string, uri?: { path: string }) => {
        anonymousModelSequence += 1;
        const key = uri?.path ?? `anonymous-${anonymousModelSequence}`;
        const model = {
          uri: uri ?? { path: key },
          language,
          value,
          getFullModelRange: () => ({}),
          setValue(nextValue: string) {
            this.value = nextValue;
          },
          dispose: vi.fn(() => models.delete(key)),
        };
        models.set(key, model);
        return model;
      }),
      create: vi.fn((_container: HTMLElement, options: { model: any }) => {
        let model = options.model;
        const disposeCallbacks: Array<() => void> = [];
        const editor = {
          addCommand: vi.fn(),
          dispose: vi.fn(() => disposeCallbacks.forEach((callback) => callback())),
          executeEdits: vi.fn((_source: string, edits: Array<{ text: string }>) => {
            model.value = edits[0]?.text ?? model.value;
          }),
          focus: vi.fn(),
          getModel: vi.fn(() => model),
          getOption: vi.fn(() => false),
          getValue: vi.fn(() => model.value),
          hasTextFocus: vi.fn(() => false),
          layout: vi.fn(),
          onDidChangeCursorPosition: vi.fn(disposable),
          onDidChangeModelContent: vi.fn(disposable),
          onDidDispose: vi.fn((callback: () => void) => disposeCallbacks.push(callback)),
          onDidLayoutChange: vi.fn(disposable),
          onDidScrollChange: vi.fn(disposable),
          pushUndoStop: vi.fn(),
          render: vi.fn(),
          restoreViewState: vi.fn(),
          revealLine: vi.fn(),
          saveViewState: vi.fn(() => ({ path: model.uri.path })),
          setModel: vi.fn((nextModel: any) => {
            model = nextModel;
          }),
          setValue: vi.fn((nextValue: string) => {
            model.value = nextValue;
          }),
          trigger: vi.fn(),
          updateOptions: vi.fn(),
        };
        editors.push(editor);
        return editor;
      }),
      getModelMarkers: vi.fn(() => []),
      onDidChangeMarkers: vi.fn(disposable),
      setModelLanguage: vi.fn((model: any, language: string) => {
        model.language = language;
      }),
      setTheme: vi.fn(),
    },
  };
  return { editors, models, monacoModule };
});

vi.mock("monaco-editor/esm/vs/editor/editor.api.js", () => mocks.monacoModule);
vi.mock("./editorCodeLanguages", () => ({
  loadDeferredEditorLanguage: vi.fn(),
  registerEditorCodeLanguages: vi.fn(),
}));
vi.mock("./editorSurfaceTheme", () => ({ registerEditorSurfaceThemes: vi.fn() }));
vi.mock("./latexCompletion", () => ({ ensureLatexCompletionProvider: vi.fn() }));

import { WorkspaceMonacoEditor } from "./WorkspaceMonacoEditor";
import { AppErrorBoundary } from "../AppErrorBoundary";

async function flushMonacoMount() {
  for (let pass = 0; pass < 6; pass += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("WorkspaceMonacoEditor real wrapper lifecycle", () => {
  beforeEach(() => {
    mocks.editors.length = 0;
    mocks.models.clear();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("switches through dotfile models and back without crashing the wrapper", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const editorInstanceRef = { current: null as any };
    const renderEditor = (path: string, language: string, value: string) => (
      <WorkspaceMonacoEditor
        projectId="project one"
        path={path}
        language={language}
        theme="latotex-light"
        value={value}
        options={{}}
        editorInstanceRef={editorInstanceRef}
        onChange={() => undefined}
        onMount={() => undefined}
      />
    );

    await act(async () => root.render(renderEditor("main.tex", "latex", "main")));
    await flushMonacoMount();
    await act(async () => root.render(renderEditor(".gitignore", "ignore", "target")));
    await flushMonacoMount();
    await act(async () => root.render(renderEditor(".editorconfig", "editorconfig", "root=true")));
    await flushMonacoMount();
    await act(async () => root.render(renderEditor("main.tex", "latex", "main updated")));
    await flushMonacoMount();

    expect(mocks.editors).toHaveLength(1);
    expect(mocks.models.has("latotex://workspace/project%20one/main.tex")).toBe(true);
    expect(mocks.models.has("latotex://workspace/project%20one/.gitignore")).toBe(true);
    expect(mocks.models.has("latotex://workspace/project%20one/.editorconfig")).toBe(true);
    expect(editorInstanceRef.current?.getModel().uri.path)
      .toBe("latotex://workspace/project%20one/main.tex");
    expect(editorInstanceRef.current?.getModel().language).toBe("latex");
    expect(editorInstanceRef.current?.getValue()).toBe("main updated");

    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    {
      path: ".gitignore",
      language: "ignore",
      value: "target/\n# generated",
    },
    {
      path: ".editorconfig",
      language: "editorconfig",
      value: "root = true\n[*]\nindent_style = space",
    },
  ])("restores $path as the first editor model inside the error boundary", async ({
    path,
    language,
    value,
  }) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const editorInstanceRef = { current: null as any };

    await act(async () => {
      root.render(
        <AppErrorBoundary
          fallbackTitle="workspace boundary failure"
          fallbackHint="workspace boundary hint"
          retryLabel="retry"
        >
          <WorkspaceMonacoEditor
            projectId="restored-project"
            path={path}
            language={language}
            theme="latotex-light"
            value={value}
            options={{}}
            editorInstanceRef={editorInstanceRef}
            onChange={() => undefined}
            onMount={() => undefined}
          />
        </AppErrorBoundary>,
      );
    });
    await flushMonacoMount();

    expect(container.textContent).not.toContain("workspace boundary failure");
    expect(editorInstanceRef.current).not.toBeNull();
    expect(editorInstanceRef.current.getModel().uri.path)
      .toBe(`latotex://workspace/restored-project/${path}`);
    expect(editorInstanceRef.current.getModel().language).toBe(language);
    expect(editorInstanceRef.current.getValue()).toBe(value);

    await act(async () => root.unmount());
    container.remove();
  });
});
