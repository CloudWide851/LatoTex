import { useCallback, useRef, useState } from "react";
import { openProject } from "../../shared/api/projects";
import { readFileBinary, workspaceExportPdf } from "../../shared/api/workspace";
import { isPdfPath, isTexPath } from "../../shared/utils/fileKind";
import { buildWorkspacePreviewUrl } from "../../shared/utils/workspaceResource";
import { runCompilePass as runCompilePassWorkflow } from "./compileWorkflow";
import type { CompileInstallProgress } from "./compileWorkflow";
import { runAppAction, writeRuntimeLog } from "./appActionRuntime";
import type { CompileActionResult } from "./compileActionTypes";

type TranslationFn = (key: any) => string;

export function useCompileActions(params: {
  activeProjectId: string | null;
  selectedFile: string | null;
  fileList: string[];
  editorContent: string;
  resolveSelectedFileContent: () => Promise<string | null>;
  pdfUrl: string | null;
  compiledPdfRelativePath: string | null;
  setBusy: (value: boolean) => void;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  setTree: (value: any[]) => void;
  setSelectedFile: (value: string | null) => void;
  setCompileDiagnostics: (value: string[]) => void;
  setLastCompileFailed: (value: boolean) => void;
  setPdfUrl: (value: string | null) => void;
  setCompiledPdfRelativePath: (value: string | null) => void;
  setPreferCompiledPreview: (value: boolean) => void;
  setCompileInstallProgress: (value: CompileInstallProgress | null) => void;
  editorRef: React.MutableRefObject<any>;
  t: TranslationFn;
}) {
  const {
    activeProjectId,
    selectedFile,
    fileList,
    editorContent,
    resolveSelectedFileContent,
    pdfUrl,
    compiledPdfRelativePath,
    setBusy,
    setToast,
    setTree,
    setSelectedFile,
    setCompileDiagnostics,
    setLastCompileFailed,
    setPdfUrl,
    setCompiledPdfRelativePath,
    setPreferCompiledPreview,
    setCompileInstallProgress,
    editorRef,
    t,
  } = params;
  const [compileBusy, setCompileBusy] = useState(false);
  const compileBusyRef = useRef(false);
  const compileFlightTokenRef = useRef<symbol | null>(null);
  const compileFlightSettledRef = useRef<Promise<void> | null>(null);
  const resolveCompileFlightRef = useRef<(() => void) | null>(null);

  const tryBeginCompileFlight = useCallback((): symbol | null => {
    if (compileBusyRef.current) {
      return null;
    }
    const token = Symbol("compile-flight");
    let resolveFlight!: () => void;
    compileBusyRef.current = true;
    compileFlightTokenRef.current = token;
    compileFlightSettledRef.current = new Promise<void>((resolve) => {
      resolveFlight = resolve;
    });
    resolveCompileFlightRef.current = resolveFlight;
    setCompileBusy(true);
    return token;
  }, []);

  const finishCompileFlight = useCallback((token: symbol) => {
    if (compileFlightTokenRef.current !== token) {
      return;
    }
    const resolveFlight = resolveCompileFlightRef.current;
    compileBusyRef.current = false;
    compileFlightTokenRef.current = null;
    compileFlightSettledRef.current = null;
    resolveCompileFlightRef.current = null;
    setCompileBusy(false);
    resolveFlight?.();
  }, []);

  const waitAndBeginCompileFlight = useCallback(async (): Promise<symbol> => {
    for (;;) {
      const token = tryBeginCompileFlight();
      if (token) {
        return token;
      }
      const activeFlight = compileFlightSettledRef.current;
      if (activeFlight) {
        await activeFlight;
      } else {
        await Promise.resolve();
      }
    }
  }, [tryBeginCompileFlight]);

  const runCompilePass = useCallback(async (
    projectId: string,
    mainPath: string,
    mainContent: string,
    options: { updatePreview: boolean; emitToast: boolean; compileMode?: "sync" | "task" },
  ) => {
    return runCompilePassWorkflow({
      projectId,
      mainPath,
      mainContent,
      fileList,
      updatePreview: options.updatePreview,
      emitToast: options.emitToast,
      compileMode: options.compileMode,
      t,
      setLastCompileFailed,
      setCompileDiagnostics,
      setPdfUrl,
      setCompiledPdfRelativePath,
      setPreferCompiledPreview,
      setCompileInstallProgress,
      setToast,
    });
  }, [
    fileList,
    setCompileDiagnostics,
    setCompileInstallProgress,
    setCompiledPdfRelativePath,
    setLastCompileFailed,
    setPdfUrl,
    setPreferCompiledPreview,
    setToast,
    t,
  ]);

  const runCompilePassForAgent = useCallback(async (input: {
    projectId: string;
    mainPath: string;
    mainContent: string;
    options: { updatePreview: boolean; emitToast: boolean };
  }) => {
    const compileToken = await waitAndBeginCompileFlight();
    try {
      return await runCompilePass(input.projectId, input.mainPath, input.mainContent, {
        ...input.options,
        compileMode: "sync",
      });
    } finally {
      setCompileInstallProgress(null);
      finishCompileFlight(compileToken);
    }
  }, [finishCompileFlight, runCompilePass, setCompileInstallProgress, waitAndBeginCompileFlight]);

  const handleCompile = useCallback(async (): Promise<CompileActionResult | null> => {
    if (!activeProjectId || !selectedFile) {
      return null;
    }
    if (!isTexPath(selectedFile)) {
      await writeRuntimeLog("WARN", `latex.compile.skipped_invalid_target: ${selectedFile}`);
      setToast({ type: "error", message: t("toast.compileTexOnly") });
      setCompileInstallProgress(null);
      setLastCompileFailed(true);
      setCompileDiagnostics([t("toast.compileTexOnly")]);
      return null;
    }
    const compileToken = tryBeginCompileFlight();
    if (!compileToken) {
      return null;
    }
    setCompileDiagnostics([]);
    try {
      return await runAppAction<CompileActionResult | null>({
        action: async () => {
          const selectedContent = await resolveSelectedFileContent();
          const compileResult = await runCompilePass(
            activeProjectId,
            selectedFile,
            selectedContent ?? editorContent,
            {
              updatePreview: true,
              emitToast: true,
              compileMode: "task",
            },
          );
          return {
            status: compileResult.status,
            diagnostics: compileResult.diagnostics,
            pdfRelativePath: compileResult.pdfRelativePath ?? null,
            pdfUrl: compileResult.pdfRelativePath
              ? buildWorkspacePreviewUrl(activeProjectId, compileResult.pdfRelativePath)
              : null,
          };
        },
        fallbackValue: null,
        setToast,
        errorLogLabel: "latex.compile",
        onError: (error) => {
          setLastCompileFailed(true);
          setCompileDiagnostics([String(error)]);
        },
      });
    } finally {
      setCompileInstallProgress(null);
      finishCompileFlight(compileToken);
    }
  }, [
    activeProjectId,
    editorContent,
    finishCompileFlight,
    isTexPath,
    resolveSelectedFileContent,
    runCompilePass,
    selectedFile,
    setCompileDiagnostics,
    setCompileInstallProgress,
    setLastCompileFailed,
    setToast,
    t,
    tryBeginCompileFlight,
  ]);

  const handleExportCompiledPdf = useCallback(async () => {
    if (compileBusyRef.current) {
      return;
    }
    if (!activeProjectId || !compiledPdfRelativePath || !pdfUrl) {
      setToast({ type: "error", message: t("toast.pdfNotReady") });
      return;
    }
    const fallbackName = isPdfPath(selectedFile)
      ? selectedFile!.split("/").pop() ?? "compiled.pdf"
      : `${(selectedFile ?? "compiled").replace(/\.[^/.]+$/, "")}.pdf`;
    const saved = await runAppAction({
      action: async () => {
        const file = await readFileBinary(activeProjectId, compiledPdfRelativePath);
        return workspaceExportPdf(
          activeProjectId,
          fallbackName,
          new Uint8Array(file.bytes),
        );
      },
      fallbackValue: null,
      setBusy,
      setToast,
      errorLogLabel: "latex.export_pdf",
    });
    if (!saved) {
      return;
    }
    await writeRuntimeLog("INFO", `compiled pdf exported: ${saved.savedPath}`);
    const snapshot = await openProject(activeProjectId);
    setTree(snapshot.tree);
    setSelectedFile(saved.savedPath);
    setToast({ type: "info", message: t("toast.pdfSaved") });
  }, [
    activeProjectId,
    compiledPdfRelativePath,
    pdfUrl,
    selectedFile,
    setBusy,
    setSelectedFile,
    setToast,
    setTree,
    t,
  ]);

  const handleEditorUndo = useCallback(() => {
    editorRef.current?.trigger("latotex", "undo", null);
  }, [editorRef]);

  const handleEditorRedo = useCallback(() => {
    editorRef.current?.trigger("latotex", "redo", null);
  }, [editorRef]);

  return {
    compileBusy,
    runCompilePassForAgent,
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
  };
}
