import { Suspense, useEffect, useMemo, useState } from "react";
import { PageRail } from "./PageRail";
import { resolveCodeLanguage } from "../../shared/utils/codeLanguage";
import {
  applyCjkAutoFixToSource,
  buildCompileAssistCjkDiagnostics,
  detectCompileAssistCjkIssue,
} from "./editor/compileAssistCjk";
import { buildCompileAssistHint, prioritizeCompileDiagnostics } from "./editor/compileAssistHint";
import { WorkspaceEditorPreviewPanel } from "./editor/WorkspaceEditorPreviewPanel";
import { configureLatexCompletionRuntime } from "./editor/latexCompletion";
import { NoProjectPanel } from "./workspace/NoProjectPanel";
import { WorkspaceLatexEditorSurface } from "./workspace/WorkspaceLatexEditorSurface";
import { WorkspacePageLayout } from "./workspace/WorkspacePageLayout";
import {
  LazyDrawWorkspace,
  LazyDocxWorkspaceSurface,
  LazyPluginMarketplaceSurface,
  LazySubmissionCiWorkspaceSurface,
  useDrawWorkspacePreload,
  WorkspacePanelFallback,
} from "./workspace/workspaceShellLazy";
import type { AppWorkspaceShellProps } from "./workspace/workspaceShellTypes";
import { emitWorkspaceLayoutRefresh } from "../hooks/workspaceLayoutRefresh";
import {
  isCompiledPdfPreview,
  resolveWorkspacePreviewFlags,
  resolveWorkspacePreviewMode,
  type WorkspacePreviewMode,
} from "./workspace/workspacePreviewMode";
import { useLatexWorkspaceChatTab } from "./workspace/useLatexWorkspaceChatTab";
import { usePluginFileInterface, usePluginFileManifests } from "./plugins/usePluginFileInterfaces";
import {
  LatexWorkspaceModeShell,
  LatexWorkspaceModeSwitcher,
  type LatexWorkspaceMode,
} from "./workspace/LatexWorkspaceModeShell";
import { isDocxPath } from "../../shared/utils/fileKind";
import { textBackedPluginPreviewMode } from "../../shared/plugins/pluginFileInterfaces";

export function AppWorkspaceShell(props: AppWorkspaceShellProps) {
  const {
    page,
    pageRailItems,
    activeProjectId,
    busy,
    shellLayout,
    latexLayout,
    analysisLayout,
    libraryLayout,
    libraryBibLayout,
    tree,
    libraryTree,
    selectedFile,
    selectedLibraryPath,
    fileList,
    editorContent,
    editorTabs,
    dirtyByPath,
    compiledPdfUrl,
    compiledPdfRelativePath,
    preferCompiledPreview,
    selectedFilePdfUrl,
    selectedImagePreviewUrl,
    previewOverridePath,
    compileErrorLine,
    compileDiagnostics,
    compileInstallProgress,
    agentCollapsed,
    explorerGitDecorations,
    shellMin,
    settings,
    settingsPanel,
    gitPanel,
    analysisPanel,
    agentPanel,
    onPageChange,
    onSelectFile,
    onSelectLibraryPath,
    onTabSelect,
    onEditorChange,
    onChatReviewRequest,
    onAgentToggle,
    onAgentRun,
    onOpenFolder,
    onCreateSample,
    onPdfViewed,
    onWriteSelectedFileContent,
    onCompile,
    onExportPdf,
    onOpenLogs,
    onLibraryRescan,
    onLibraryImportPdf,
    onLibraryImportLink,
    onLibrarySyncZotero,
    onLibraryAnalyzePaper,
    analysisRunning,
    libraryViewMode,
    onLibraryViewModeChange,
    onWorkspaceRevealInSystem,
    onWorkspaceOpenTerminal,
    onWorkspaceRescan,
    onSavePanelLayout,
    previewDefaultZoom,
    completionModelId,
    translationModelId,
    paperBriefEngine,
    workspaceExplorerDefaultExpanded,
    libraryExplorerDefaultExpanded,
    workspaceExplorerScrollbarVisible,
    libraryExplorerScrollbarVisible,
    editorResizeRefreshDelayMs,
    workspaceExplorerExpandedPaths,
    libraryExplorerExpandedPaths,
    onWorkspaceExplorerExpandedPathsChange,
    onLibraryExplorerExpandedPathsChange,
    onFsAction,
    onRunFsAction,
    t,
  } = props;

  const [previewZoom, setPreviewZoom] = useState(1);
  const previewFocusRequest = null;
  const [compileAssistDismissedFor, setCompileAssistDismissedFor] = useState("");
  const [compileAssistOverride, setCompileAssistOverride] = useState<
    | { kind: "cjk"; diagnostics: string[]; hint: string }
    | null
  >(null);
  const [compileAssistAutoFixBusy, setCompileAssistAutoFixBusy] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [latexMode, setLatexMode] = useState<LatexWorkspaceMode>("tex");
  const selectedIsDocx = isDocxPath(selectedFile);

  const clampPreviewZoom = (value: number) => Math.max(0.5, Math.min(3, Number(value.toFixed(2))));

  useEffect(() => {
    setPreviewZoom(clampPreviewZoom(previewDefaultZoom || 1));
  }, [previewDefaultZoom]);

  useEffect(() => {
    configureLatexCompletionRuntime(() => ({
      projectId: activeProjectId,
      selectedFile,
      completionModelId,
      fileList,
      selectedFileContent: editorContent,
    }));
  }, [activeProjectId, completionModelId, editorContent, fileList, selectedFile]);

  useEffect(() => {
    setLatexMode((prev) => {
      if (selectedIsDocx) {
        return "docx";
      }
      return prev === "docx" ? "tex" : prev;
    });
  }, [selectedIsDocx]);

  useEffect(() => {
    if (!compileErrorLine) {
      setCompileAssistDismissedFor("");
    }
  }, [compileErrorLine]);

  const {
    chatTabOpen,
    chatTabTitle,
    showChatWorkspace,
    setChatTabActive,
    setChatTabTitle,
    handleCreateChatTab,
    handleOpenChatTab,
    handleCloseChatTab,
    handleChatReviewRequest,
  } = useLatexWorkspaceChatTab({
    activeProjectId,
    page,
    agentCollapsed,
    onPageChange,
    onAgentToggle,
    onChatReviewRequest,
    t,
  });

  useEffect(() => {
    emitWorkspaceLayoutRefresh(page, "page-change");
  }, [page]);
  useDrawWorkspacePreload(Boolean(activeProjectId));

  const previewSelectedPath = previewOverridePath || selectedFile;
  const pluginFileManifests = usePluginFileManifests(Boolean(activeProjectId));
  const scientificPluginIds = useMemo(
    () => pluginFileManifests
      .map((manifest) => manifest.id)
      .filter((id) => id.startsWith("latotex.science.")),
    [pluginFileManifests],
  );
  const pluginFileInterface = usePluginFileInterface(previewSelectedPath, pluginFileManifests);
  const pluginPreviewMode = textBackedPluginPreviewMode(pluginFileInterface.previewMode);
  const previewFlags = useMemo(() => {
    const flags = resolveWorkspacePreviewFlags(previewSelectedPath);
    if (pluginPreviewMode === "markdown") {
      return { ...flags, selectedIsMarkdown: true, selectedIsPlainText: true };
    }
    if (pluginPreviewMode === "html") {
      return { ...flags, selectedIsHtml: true, selectedIsPlainText: true };
    }
    if (pluginPreviewMode === "csv") {
      return { ...flags, selectedIsCsv: true, selectedIsTabular: true, selectedIsPlainText: true };
    }
    return flags;
  }, [pluginPreviewMode, previewSelectedPath]);
  const {
    selectedIsPdf,
    selectedIsExcel,
    selectedIsImage,
    selectedIsMarkdown,
    selectedIsHtml,
    selectedIsSvg,
    selectedIsCsv,
    selectedIsTabular,
    selectedIsTex,
  } = previewFlags;
  const selectedIsDraw = Boolean(selectedFile && /\.drawio$/i.test(selectedFile));
  const selectedCodeLanguage = useMemo(
    () => {
      const baseLanguage = editorTabs.find((tab) => tab.path === previewSelectedPath)?.language
        ?? resolveCodeLanguage(previewSelectedPath);
      const pluginEditorLanguage = pluginFileInterface.editorLanguage?.trim();
      if (!pluginEditorLanguage) {
        return baseLanguage;
      }
      return {
        ...baseLanguage,
        monaco: pluginEditorLanguage,
      };
    },
    [editorTabs, pluginFileInterface.editorLanguage, previewSelectedPath],
  );
  const previewMode: WorkspacePreviewMode = resolveWorkspacePreviewMode({
    flags: previewFlags,
    selectedImagePreviewUrl,
    selectedFilePdfUrl,
    compiledPdfUrl,
    previewSelectedPath,
    preferCompiledPreview,
  });
  const previewPdfUrl = previewMode === "pdf" ? (selectedIsPdf ? selectedFilePdfUrl : compiledPdfUrl) : null;
  const previewPdfFallbackRelativePath = previewMode === "pdf"
    ? (selectedIsPdf ? previewSelectedPath : compiledPdfRelativePath)
    : null;
  const canZoomPreview = previewMode === "pdf" && Boolean(previewPdfUrl);
  const compileAssistKey = compileDiagnostics.join("\n").slice(0, 2400);

  const sourceCjkIssue = useMemo(
    () => (selectedIsTex ? detectCompileAssistCjkIssue({ source: editorContent }) : null),
    [editorContent, selectedIsTex],
  );
  const compileAssistCjkIssue = useMemo(
    () => (
      selectedIsTex
        ? detectCompileAssistCjkIssue({ source: editorContent, diagnostics: compileDiagnostics })
        : null
    ),
    [compileDiagnostics, editorContent, selectedIsTex],
  );

  useEffect(() => {
    if (!sourceCjkIssue) {
      setCompileAssistOverride((prev) => (prev?.kind === "cjk" ? null : prev));
    }
  }, [sourceCjkIssue]);

  const showCompileAssist = Boolean(
    compileAssistOverride
    || (compileErrorLine && compileDiagnostics.length > 0 && compileAssistDismissedFor !== compileAssistKey),
  );
  const compileAssistDiagnostics = useMemo(
    () => compileAssistOverride?.diagnostics ?? prioritizeCompileDiagnostics(compileDiagnostics),
    [compileAssistOverride, compileDiagnostics],
  );
  const compileAssistHint = useMemo(
    () => compileAssistOverride?.hint ?? buildCompileAssistHint(compileDiagnostics, t, { source: editorContent }),
    [compileAssistOverride, compileDiagnostics, editorContent, t],
  );
  const handleSelectEditorTab = (tabId: string) => {
    setChatTabActive(false);
    onTabSelect(tabId);
  };

  const handleSelectWorkspaceFile = (path: string | null) => {
    setChatTabActive(false);
    onSelectFile(path);
  };

  const openCjkCompileAssist = (
    issue: { kind: "source-missing-cjk" } | { kind: "diagnostic-missing-cjk"; line: string },
  ) => {
    const diagnostics = buildCompileAssistCjkDiagnostics(t, issue);
    setCompileAssistOverride({
      kind: "cjk",
      diagnostics,
      hint: buildCompileAssistHint(diagnostics, t, { source: editorContent }),
    });
  };

  const handleCompileAssistDismiss = () => {
    setCompileAssistOverride(null);
    setCompileAssistDismissedFor(compileAssistKey);
  };

  const handleCompileAssistAutoFix = async () => {
    if (compileAssistCjkIssue && selectedFile) {
      const patched = applyCjkAutoFixToSource(editorContent);
      if (!patched.changed) {
        handleCompileAssistDismiss();
        return;
      }
      setCompileAssistAutoFixBusy(true);
      const ok = await onWriteSelectedFileContent(patched.patchedSource);
      setCompileAssistAutoFixBusy(false);
      if (ok) {
        setCompileAssistOverride(null);
        setCompileAssistDismissedFor("");
      }
      return;
    }
    setCompileAssistDismissedFor(compileAssistKey);
    setChatTabActive(false);
    if (agentCollapsed) {
      onAgentToggle();
    }
    const extra = compileAssistDiagnostics.slice(0, 6).join("\n").trim();
    const prompt = extra ? `/review ${extra}` : "/review";
    onAgentRun(prompt, { forceNewSession: true });
  };

  const handleCompileClick = async () => {
    setCompileAssistDismissedFor("");
    if (sourceCjkIssue) {
      openCjkCompileAssist(sourceCjkIssue);
      return;
    }
    setCompileAssistOverride(null);
    await onCompile();
  };

  const openTexMode = () => {
    setLatexMode("tex");
    emitWorkspaceLayoutRefresh("latex", "panel-layout");
  };

  const renderPdfPreviewPanel = () => (
    <WorkspaceEditorPreviewPanel
      activeProjectId={activeProjectId}
      selectedFile={previewSelectedPath}
      selectedIsCsv={selectedIsCsv}
      selectedIsMarkdown={selectedIsMarkdown}
      selectedIsHtml={selectedIsHtml}
      selectedIsImage={selectedIsImage}
      selectedIsSvg={selectedIsSvg}
      selectedIsTabular={selectedIsTabular}
      editorContent={editorContent}
      compiledPdfUrl={compiledPdfUrl}
      previewMode={previewMode}
      previewPdfUrl={previewPdfUrl ?? null}
      previewPdfFallbackRelativePath={previewPdfFallbackRelativePath}
      imagePreviewUrl={selectedImagePreviewUrl}
      canZoomPreview={canZoomPreview}
      previewZoom={previewZoom}
      compileErrorLine={compileErrorLine}
      compileInstallProgress={compileInstallProgress}
      onEditorChange={onEditorChange}
      onOpenLogs={onOpenLogs}
      onExportPdf={onExportPdf}
      onZoomIn={() => setPreviewZoom((prev) => clampPreviewZoom(prev + 0.1))}
      onZoomOut={() => setPreviewZoom((prev) => clampPreviewZoom(prev - 0.1))}
      onZoomReset={() => setPreviewZoom(clampPreviewZoom(previewDefaultZoom || 1))}
      onPreviewZoomChange={(nextZoom) => setPreviewZoom(clampPreviewZoom(nextZoom))}
      previewFocusRequest={previewFocusRequest}
      onPdfViewed={isCompiledPdfPreview({ previewMode, selectedIsPdf, compiledPdfRelativePath })
        ? onPdfViewed
        : undefined}
      t={t}
    />
  );

  const renderMainPanel = () => {
    if (page === "analysis") {
      return <section className="h-full min-h-0">{analysisPanel}</section>;
    }
    if (page === "agents") {
      return <section className="h-full min-h-0">{agentPanel}</section>;
    }
    if (page === "draw") {
      return (
        <Suspense fallback={<WorkspacePanelFallback label={t("common.loading")} />}>
          <LazyDrawWorkspace
            projectId={activeProjectId}
            selectedPath={selectedFile}
            onSelectPath={onSelectFile}
            onRunFsAction={onRunFsAction}
            t={t}
          />
        </Suspense>
      );
    }
    if (page === "library") {
      return <NoProjectPanel busy={busy} onOpenFolder={onOpenFolder} onCreateSample={onCreateSample} t={t} />;
    }
    if (page === "git") {
      return activeProjectId ? gitPanel : <NoProjectPanel busy={busy} onOpenFolder={onOpenFolder} onCreateSample={onCreateSample} t={t} />;
    }
    if (page === "settings") {
      return settingsPanel;
    }
    if (page === "plugins") {
      return <LazyPluginMarketplaceSurface settings={settings} t={t} />;
    }
    if (!activeProjectId) {
      return <NoProjectPanel busy={busy} onOpenFolder={onOpenFolder} onCreateSample={onCreateSample} t={t} />;
    }
    const renderModeSwitcher = () => (
      <LatexWorkspaceModeSwitcher mode={latexMode} onModeChange={setLatexMode} t={t} />
    );
    const renderTexWorkspace = () => (
      <WorkspaceLatexEditorSurface
        shell={props}
        selectedIsDraw={selectedIsDraw}
        selectedIsExcel={selectedIsExcel}
        selectedCodeLanguage={selectedCodeLanguage}
        scientificPluginIds={scientificPluginIds}
        showChatWorkspace={showChatWorkspace}
        chatTabOpen={chatTabOpen}
        chatTabTitle={chatTabTitle}
        showCompileAssist={showCompileAssist}
        compileAssistDiagnostics={compileAssistDiagnostics}
        compileAssistHint={compileAssistHint}
        compileAssistAutoFixBusy={compileAssistAutoFixBusy}
        terminalVisible={terminalVisible}
        modeSwitcher={renderModeSwitcher()}
        onTerminalToggle={() => setTerminalVisible((prev) => !prev)}
        onCreateChatTab={handleCreateChatTab}
        onOpenChatTab={handleOpenChatTab}
        onChatTabTitleChange={setChatTabTitle}
        onCompileClick={() => {
          void handleCompileClick();
        }}
        onCompileAssistDismiss={handleCompileAssistDismiss}
        onCompileAssistAutoFix={() => {
          void handleCompileAssistAutoFix();
        }}
        onSelectEditorTab={handleSelectEditorTab}
        onCloseChatTab={handleCloseChatTab}
        onActivateChatTab={() => setChatTabActive(true)}
        onChatReviewRequest={handleChatReviewRequest}
      />
    );
    return (
      <LatexWorkspaceModeShell
        mode={latexMode}
        onModeChange={setLatexMode}
        texWorkspace={renderTexWorkspace()}
        docxWorkspace={<LazyDocxWorkspaceSurface shell={props} selectedIsDocx={selectedIsDocx} />}
        submissionWorkspace={(
          <LazySubmissionCiWorkspaceSurface
            shell={props}
            selectedIsDraw={selectedIsDraw}
            selectedIsExcel={selectedIsExcel}
            compileAssistDiagnostics={compileAssistDiagnostics}
            onOpenTexMode={openTexMode}
          />
        )}
        t={t}
      />
    );
  };

  return (
    <main className="app-material-canvas flex-1 min-h-0 overflow-hidden p-1">
      <div className="flex h-full gap-0">
        <div className="w-14 shrink-0">
          <PageRail items={pageRailItems} activePage={page} onChange={onPageChange} />
        </div>
        <div className="app-material-shell min-w-0 flex-1 overflow-hidden rounded-lg border p-1">
          <WorkspacePageLayout
            page={page}
            activeProjectId={activeProjectId}
            busy={busy}
            latexLayout={latexLayout}
            analysisLayout={analysisLayout}
            libraryLayout={libraryLayout}
            libraryBibLayout={libraryBibLayout}
            tree={tree}
            libraryTree={libraryTree}
            selectedFile={selectedFile}
            selectedLibraryPath={selectedLibraryPath}
            dirtyByPath={dirtyByPath}
            explorerGitDecorations={explorerGitDecorations}
            onSelectLibraryPath={onSelectLibraryPath}
            onFsAction={onFsAction}
            onWorkspaceRevealInSystem={onWorkspaceRevealInSystem}
            onWorkspaceOpenTerminal={onWorkspaceOpenTerminal}
            onWorkspaceRescan={onWorkspaceRescan}
            onLibraryRescan={onLibraryRescan}
            onLibraryImportPdf={onLibraryImportPdf}
            onLibraryImportLink={onLibraryImportLink}
            onLibrarySyncZotero={onLibrarySyncZotero}
            onLibraryAnalyzePaper={onLibraryAnalyzePaper}
            analysisRunning={analysisRunning}
            libraryViewMode={libraryViewMode}
            onLibraryViewModeChange={onLibraryViewModeChange}
            translationModelId={translationModelId}
            paperBriefEngine={paperBriefEngine}
            workspaceExplorerDefaultExpanded={workspaceExplorerDefaultExpanded}
            libraryExplorerDefaultExpanded={libraryExplorerDefaultExpanded}
            workspaceExplorerScrollbarVisible={workspaceExplorerScrollbarVisible}
            libraryExplorerScrollbarVisible={libraryExplorerScrollbarVisible}
            editorResizeRefreshDelayMs={editorResizeRefreshDelayMs}
            workspaceExplorerExpandedPaths={workspaceExplorerExpandedPaths}
            libraryExplorerExpandedPaths={libraryExplorerExpandedPaths}
            onWorkspaceExplorerExpandedPathsChange={onWorkspaceExplorerExpandedPathsChange}
            onLibraryExplorerExpandedPathsChange={onLibraryExplorerExpandedPathsChange}
            onSavePanelLayout={onSavePanelLayout}
            renderMainPanel={renderMainPanel}
            renderPdfPreviewPanel={renderPdfPreviewPanel}
            onSelectWorkspaceFile={handleSelectWorkspaceFile}
            t={t}
          />
        </div>
      </div>
    </main>
  );
}
