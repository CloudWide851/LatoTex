// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompileInstallProgress } from "./compileWorkflow";
import type { CompileActionResult } from "./compileActionTypes";
import { useCompileActions } from "./useCompileActions";

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  readFileBinary: vi.fn(),
  runCompilePassWorkflow: vi.fn(),
  runtimeLogWrite: vi.fn(),
  workspaceExportPdf: vi.fn(),
}));

vi.mock("../../shared/api/projects", () => ({ openProject: mocks.openProject }));
vi.mock("../../shared/api/runtime", () => ({ runtimeLogWrite: mocks.runtimeLogWrite }));
vi.mock("../../shared/api/workspace", () => ({
  readFileBinary: mocks.readFileBinary,
  workspaceExportPdf: mocks.workspaceExportPdf,
}));
vi.mock("./compileWorkflow", () => ({
  runCompilePass: mocks.runCompilePassWorkflow,
}));

type CompileController = ReturnType<typeof useCompileActions>;
let currentController: CompileController | null = null;

function CompileActionsProbe(props: {
  setBusy: (value: boolean) => void;
  setCompileDiagnostics: (value: string[]) => void;
  setCompileInstallProgress: (value: CompileInstallProgress | null) => void;
  setLastCompileFailed: (value: boolean) => void;
}) {
  const controller = useCompileActions({
    activeProjectId: "project-1",
    selectedFile: "main.tex",
    fileList: ["main.tex"],
    editorContent: "source",
    resolveSelectedFileContent: vi.fn().mockResolvedValue("fresh source"),
    pdfUrl: "blob:compiled",
    compiledPdfRelativePath: ".latotex/build/main.pdf",
    setBusy: props.setBusy,
    setToast: vi.fn(),
    setTree: vi.fn(),
    setSelectedFile: vi.fn(),
    setCompileDiagnostics: props.setCompileDiagnostics,
    setLastCompileFailed: props.setLastCompileFailed,
    setPdfUrl: vi.fn(),
    setCompiledPdfRelativePath: vi.fn(),
    setPreferCompiledPreview: vi.fn(),
    setCompileInstallProgress: props.setCompileInstallProgress,
    editorRef: { current: null },
    t: (key) => String(key),
  });
  currentController = controller;
  return <output data-testid="compile-busy">{String(controller.compileBusy)}</output>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("useCompileActions", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    currentController = null;
    vi.clearAllMocks();
    mocks.runtimeLogWrite.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps manual compilation local and rejects a second in-flight request", async () => {
    const compile = deferred<{
      status: string;
      diagnostics: string[];
      pdfRelativePath: string | null;
    }>();
    mocks.runCompilePassWorkflow.mockReturnValueOnce(compile.promise);
    const setBusy = vi.fn();
    const setCompileDiagnostics = vi.fn();
    const setCompileInstallProgress = vi.fn();
    const setLastCompileFailed = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <CompileActionsProbe
          setBusy={setBusy}
          setCompileDiagnostics={setCompileDiagnostics}
          setCompileInstallProgress={setCompileInstallProgress}
          setLastCompileFailed={setLastCompileFailed}
        />,
      );
    });

    let firstCompile!: Promise<CompileActionResult | null>;
    let secondCompile!: Promise<CompileActionResult | null>;
    await act(async () => {
      firstCompile = currentController!.handleCompile();
      secondCompile = currentController!.handleCompile();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid='compile-busy']")?.textContent).toBe("true");
    expect(mocks.runCompilePassWorkflow).toHaveBeenCalledTimes(1);
    await expect(secondCompile).resolves.toBeNull();
    expect(setBusy).not.toHaveBeenCalled();

    await currentController!.handleExportCompiledPdf();
    expect(mocks.readFileBinary).not.toHaveBeenCalled();
    expect(mocks.workspaceExportPdf).not.toHaveBeenCalled();

    await act(async () => {
      compile.resolve({
        status: "success",
        diagnostics: [],
        pdfRelativePath: ".latotex/build/main.pdf",
      });
      await firstCompile;
    });
    expect(container.querySelector("[data-testid='compile-busy']")?.textContent).toBe("false");
    expect(setCompileInstallProgress).toHaveBeenLastCalledWith(null);
    expect(setBusy).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("releases compile state and progress when the task rejects or times out", async () => {
    mocks.runCompilePassWorkflow.mockRejectedValueOnce(new Error("compile.task.timeout"));
    const setCompileDiagnostics = vi.fn();
    const setCompileInstallProgress = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <CompileActionsProbe
          setBusy={vi.fn()}
          setCompileDiagnostics={setCompileDiagnostics}
          setCompileInstallProgress={setCompileInstallProgress}
          setLastCompileFailed={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await currentController!.handleCompile();
    });

    expect(container.querySelector("[data-testid='compile-busy']")?.textContent).toBe("false");
    expect(setCompileInstallProgress).toHaveBeenLastCalledWith(null);
    expect(setCompileDiagnostics).toHaveBeenCalledWith(["Error: compile.task.timeout"]);

    await act(async () => root.unmount());
    container.remove();
  });

  it("waits to start Agent compilation until the manual flight settles", async () => {
    const manualCompile = deferred<{
      status: string;
      diagnostics: string[];
      pdfRelativePath: string | null;
    }>();
    mocks.runCompilePassWorkflow
      .mockReturnValueOnce(manualCompile.promise)
      .mockResolvedValueOnce({ status: "success", diagnostics: [], pdfRelativePath: null });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <CompileActionsProbe
          setBusy={vi.fn()}
          setCompileDiagnostics={vi.fn()}
          setCompileInstallProgress={vi.fn()}
          setLastCompileFailed={vi.fn()}
        />,
      );
    });

    let manualPromise!: Promise<CompileActionResult | null>;
    let agentPromise!: ReturnType<CompileController["runCompilePassForAgent"]>;
    await act(async () => {
      manualPromise = currentController!.handleCompile();
      agentPromise = currentController!.runCompilePassForAgent({
        projectId: "project-1",
        mainPath: "main.tex",
        mainContent: "agent source",
        options: { updatePreview: true, emitToast: false },
      });
      await Promise.resolve();
    });

    expect(mocks.runCompilePassWorkflow).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='compile-busy']")?.textContent).toBe("true");

    await act(async () => {
      manualCompile.resolve({
        status: "success",
        diagnostics: [],
        pdfRelativePath: ".latotex/build/main.pdf",
      });
      await manualPromise;
      await agentPromise;
    });

    expect(mocks.runCompilePassWorkflow).toHaveBeenCalledTimes(2);
    await expect(agentPromise).resolves.toMatchObject({ status: "success" });
    expect(container.querySelector("[data-testid='compile-busy']")?.textContent).toBe("false");

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not start manual compilation while an Agent flight owns the mutex", async () => {
    const agentCompile = deferred<{
      status: string;
      diagnostics: string[];
      pdfRelativePath: string | null;
    }>();
    mocks.runCompilePassWorkflow.mockReturnValueOnce(agentCompile.promise);
    const setCompileDiagnostics = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <CompileActionsProbe
          setBusy={vi.fn()}
          setCompileDiagnostics={setCompileDiagnostics}
          setCompileInstallProgress={vi.fn()}
          setLastCompileFailed={vi.fn()}
        />,
      );
    });

    let agentPromise!: ReturnType<CompileController["runCompilePassForAgent"]>;
    let manualPromise!: Promise<CompileActionResult | null>;
    await act(async () => {
      agentPromise = currentController!.runCompilePassForAgent({
        projectId: "project-1",
        mainPath: "main.tex",
        mainContent: "agent source",
        options: { updatePreview: true, emitToast: false },
      });
      manualPromise = currentController!.handleCompile();
      await Promise.resolve();
    });

    expect(mocks.runCompilePassWorkflow).toHaveBeenCalledTimes(1);
    await expect(manualPromise).resolves.toBeNull();
    expect(setCompileDiagnostics).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='compile-busy']")?.textContent).toBe("true");

    await act(async () => {
      agentCompile.resolve({ status: "success", diagnostics: [], pdfRelativePath: null });
      await agentPromise;
    });
    expect(container.querySelector("[data-testid='compile-busy']")?.textContent).toBe("false");

    await act(async () => root.unmount());
    container.remove();
  });
});
