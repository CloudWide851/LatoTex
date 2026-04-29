import { Suspense, useEffect, useMemo, useState } from "react";
import { PageRail } from "./PageRail";
import { resolveCodeLanguage } from "../../shared/utils/codeLanguage";
import {
  applyCjkAutoFixToSource,
  buildCompileAssistCjkDiagnostics,
  detectCompileAssistCjkIssue,
} from "./editor/compileAssistCjk";
import { buildCompileAssistHint, prioritizeCompileDiagnostics } from "./editor/compileAssistHint";
import { LatexWorkspaceEditorPanel } from "./editor/LatexWorkspaceEditorPanel";
import { WorkspaceEditorPreviewPanel } from "./editor/WorkspaceEditorPreviewPanel";
import { configureLatexCompletionRuntime } from "./editor/latexCompletion";
import { NoProjectPanel } from "./workspace/NoProjectPanel";
import { WorkspacePageLayout } from "./workspace/WorkspacePageLayout";
import {
  LazyDrawWorkspace,
  WorkspacePanelFallback,
} from "./workspace/workspaceShellLazy";
import { buildNewChatTabState } from "./workspace/workspaceChatTab";
import type { AppWorkspaceShellProps } from "./workspace/workspaceShellTypes";
import { createChatSessionInStore, loadChatStore, type ChatSessionOpenDetail } from "../hooks/chatSessionStore";
import { emitWorkspaceLayoutRefresh } from "../hooks/workspaceLayoutRefresh";
import {
  resolveWorkspacePreviewFlags,
  resolveWorkspacePreviewMode,
  type WorkspacePreviewMode,
} from "./workspace/workspacePreviewMode";

export function AppWorkspaceShell(props: AppWorkspaceShellProps) {
  const {
    page,
    pageRailItems,
    activeProjectId,
    busy,
    suspended = false,
    shellLayout,
    latexLayout,
    analysisLayout,
    libraryLayout,
    tree,
    libraryTree,
    selectedFile,
    selectedLibraryPath,
    fileList,
    editorContent,
    editorTabs,
    activeTabId,
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
    agentPhase,
    agentStatusKey,
    agentPrompt,
    agentMessages,
    agentProposal,
    agentPendingAction,
    agentRunId,
    agentSessions,
    agentSessionPickerOpen,
    agentSessionPickerIndex,
    agentRollbackVisible,
    events,
    explorerGitDecorations,
    shellMin,
    settingsPanel,
    gitPanel,
    analysisPanel,
    shareSession,
    shareBusy,
    shareSyncing,
    shareComments,
    channelPrefs,
    shareMode,
    shareSessionName,
    onShareModeChange,
    onShareSessionNameChange,
    onPageChange,
    onShareStart,
    onShareStop,
    onShareRefresh,
    onSelectFile,
    onSelectLibraryPath,
    onTabSelect,
    onTabClose,
    onTabCloseAction,
    onTabPin,
    onEditorChange,
    onEditorMount,
    onChatReviewRequest,
    onAgentPromptChange,
    onAgentToggle,
    onAgentRun,
    onAgentSessionPickerOpenChange,
    onAgentSessionPickerIndexChange,
    onAgentSessionConfirm,
    onAgentRollback,
    onAgentAcceptProposal,
    onAgentRejectProposal,
    onAgentPendingActionResolve,
    onOpenFolder,
    onSaveFile,
    onWriteSelectedFileContent,
    onCompile,
    onExportPdf,
    onEditorUndo,
    onEditorRedo,
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
    chatAgentModelId,
    translationModelId,
    paperBriefEngine,
    workspaceExplorerDefaultExpanded,
    libraryExplorerDefaultExpanded,
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
  const [chatTabOpen, setChatTabOpen] = useState(false);
  const [chatTabActive, setChatTabActive] = useState(false);
  const [chatTabTitle, setChatTabTitle] = useState<string | null>(null);
  const [terminalVisible, setTerminalVisible] = useState(false);

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
    if (!compileErrorLine) {
      setCompileAssistDismissedFor("");
    }
  }, [compileErrorLine]);

  useEffect(() => {
    setChatTabTitle(null);
    if (!activeProjectId) {
      setChatTabOpen(false);
      setChatTabActive(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (page !== "latex") {
      setChatTabActive(false);
    }
  }, [page]);
  useEffect(() => {
    if (!activeProjectId || typeof window === "undefined") {
      return;
    }
    const handleOpenChatSession = (event: Event) => {
      const custom = event as CustomEvent<ChatSessionOpenDetail>;
      if (!custom.detail || custom.detail.projectId !== activeProjectId) {
        return;
      }
      const store = loadChatStore(activeProjectId);
      const title = store.sessions.find((item) => item.id === custom.detail.sessionId)?.title ?? null;
      setChatTabOpen(true);
      setChatTabActive(true);
      setChatTabTitle(title);
      onPageChange("latex");
    };
    window.addEventListener("latotex.chat.session.open", handleOpenChatSession as EventListener);
    return () => {
      window.removeEventListener("latotex.chat.session.open", handleOpenChatSession as EventListener);
    };
  }, [activeProjectId, onPageChange]);

  useEffect(() => {
    emitWorkspaceLayoutRefresh(page, "page-change");
  }, [page]);

  const previewSelectedPath = previewOverridePath || selectedFile;
  const previewFlags = useMemo(() => resolveWorkspacePreviewFlags(previewSelectedPath), [previewSelectedPath]);
  const {
    selectedIsPdf,
    selectedIsExcel,
    selectedIsImage,
    selectedIsMarkdown,
    selectedIsSvg,
    selectedIsCsv,
    selectedIsTabular,
    selectedIsTex,
  } = previewFlags;
  const selectedIsDraw = Boolean(selectedFile && /\.drawio$/i.test(selectedFile));
  const selectedCodeLanguage = useMemo(
    () => editorTabs.find((tab) => tab.path === previewSelectedPath)?.language ?? resolveCodeLanguage(previewSelectedPath),
    [editorTabs, previewSelectedPath],
  );
  const previewMode: WorkspacePreviewMode = resolveWorkspacePreviewMode({
    flags: previewFlags,
    selectedImagePreviewUrl,
    selectedFilePdfUrl,
    compiledPdfUrl,
    previewSelectedPath,
    preferCompiledPreview,
    terminalVisible,
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
  const showChatWorkspace = chatTabOpen && chatTabActive;

  const handleOpenChatTab = () => {
    setChatTabOpen(true);
    setChatTabActive(true);
  };

  const handleCreateChatTab = () => {
    const next = buildNewChatTabState(activeProjectId, t("chat.sessionNew"), createChatSessionInStore);
    if (!next) {
      return;
    }
    setChatTabOpen(next.chatTabOpen);
    setChatTabActive(next.chatTabActive);
    setChatTabTitle(next.chatTabTitle);
  };

  const handleCloseChatTab = () => {
    setChatTabOpen(false);
    setChatTabActive(false);
  };

  const handleSelectEditorTab = (tabId: string) => {
    setChatTabActive(false);
    onTabSelect(tabId);
  };

  const handleSelectWorkspaceFile = (path: string | null) => {
    setChatTabActive(false);
    onSelectFile(path);
  };

  const handleChatReviewRequest = (prompt: string) => {
    setChatTabActive(false);
    if (agentCollapsed) {
      onAgentToggle();
    }
    onChatReviewRequest(prompt);
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

  const renderPdfPreviewPanel = () => (
    <WorkspaceEditorPreviewPanel
      activeProjectId={activeProjectId}
      selectedFile={previewSelectedPath}
      selectedIsCsv={selectedIsCsv}
      selectedIsMarkdown={selectedIsMarkdown}
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
      terminalVisible={terminalVisible}
      t={t}
    />
  );

  const renderMainPanel = () => {
    if (page === "analysis") {
      return <section className="h-full min-h-0">{analysisPanel}</section>;
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
      return <NoProjectPanel busy={busy} onOpenFolder={onOpenFolder} t={t} />;
    }
    if (page === "git") {
      return activeProjectId ? gitPanel : <NoProjectPanel busy={busy} onOpenFolder={onOpenFolder} t={t} />;
    }
    if (page === "settings") {
      return settingsPanel;
    }
    if (!activeProjectId) {
      return <NoProjectPanel busy={busy} onOpenFolder={onOpenFolder} t={t} />;
    }
    return (
      <LatexWorkspaceEditorPanel
        activeProjectId={activeProjectId}
        busy={busy}
        suspended={suspended}
        selectedFile={selectedFile}
        selectedIsDraw={selectedIsDraw}
        selectedIsExcel={selectedIsExcel}
        selectedCodeLanguage={selectedCodeLanguage}
        editorContent={editorContent}
        editorTabs={editorTabs}
        activeTabId={activeTabId}
        dirtyByPath={dirtyByPath}
        shareSession={shareSession}
        shareBusy={shareBusy}
        shareSyncing={shareSyncing}
        shareMode={shareMode}
        shareSessionName={shareSessionName}
        shareComments={shareComments}
        channelPrefs={channelPrefs}
        agentCollapsed={agentCollapsed}
        agentPhase={agentPhase}
        agentStatusKey={agentStatusKey}
        agentPrompt={agentPrompt}
        agentMessages={agentMessages}
        agentProposal={agentProposal}
        agentPendingAction={agentPendingAction}
        agentRunId={agentRunId}
        agentSessions={agentSessions}
        agentSessionPickerOpen={agentSessionPickerOpen}
        agentSessionPickerIndex={agentSessionPickerIndex}
        agentRollbackVisible={agentRollbackVisible}
        events={events}
        showChatWorkspace={showChatWorkspace}
        chatTabOpen={chatTabOpen}
        chatTabTitle={chatTabTitle}
        showCompileAssist={showCompileAssist}
        compileAssistDiagnostics={compileAssistDiagnostics}
        compileAssistHint={compileAssistHint}
        compileAssistAutoFixBusy={compileAssistAutoFixBusy}
        terminalVisible={terminalVisible}
        onTerminalToggle={() => setTerminalVisible((prev) => !prev)}
        onShareModeChange={onShareModeChange}
        onShareSessionNameChange={onShareSessionNameChange}
        onShareStart={onShareStart}
        onShareStop={onShareStop}
        onShareRefresh={onShareRefresh}
        onCreateChatTab={handleCreateChatTab}
        onOpenChatTab={handleOpenChatTab}
        onChatTabTitleChange={setChatTabTitle}
        onEditorUndo={onEditorUndo}
        onEditorRedo={onEditorRedo}
        onSaveFile={onSaveFile}
        onPageChange={onPageChange}
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
        onTabClose={onTabClose}
        onTabCloseAction={onTabCloseAction}
        onTabPin={onTabPin}
        onAgentAcceptProposal={onAgentAcceptProposal}
        onAgentRejectProposal={onAgentRejectProposal}
        onAgentToggle={onAgentToggle}
        onChatReviewRequest={handleChatReviewRequest}
        onEditorChange={onEditorChange}
        onEditorMount={onEditorMount}
        onAgentPromptChange={onAgentPromptChange}
        onAgentRun={onAgentRun}
        onAgentSessionPickerOpenChange={onAgentSessionPickerOpenChange}
        onAgentSessionPickerIndexChange={onAgentSessionPickerIndexChange}
        onAgentSessionConfirm={onAgentSessionConfirm}
        onAgentRollback={onAgentRollback}
        onAgentPendingActionResolve={onAgentPendingActionResolve}
        chatAgentModelId={chatAgentModelId}
        t={t}
      />
    );
  };

  return (
    <main className="flex-1 min-h-0 overflow-hidden p-1">
      <div className="flex h-full gap-0">
        <div className="w-14 shrink-0">
          <PageRail items={pageRailItems} activePage={page} onChange={onPageChange} />
        </div>
        <div className="min-w-0 flex-1">
          <WorkspacePageLayout
            page={page}
            activeProjectId={activeProjectId}
            busy={busy}
            latexLayout={latexLayout}
            analysisLayout={analysisLayout}
            libraryLayout={libraryLayout}
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
