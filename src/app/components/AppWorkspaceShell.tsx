import { Suspense, useEffect, useMemo, useState } from "react";
import { PageRail } from "./PageRail";
import {
  isCsvPath,
  isCodePath,
  isExcelPath,
  isImagePath,
  isMarkdownPath,
  isPdfPath,
  isPlainTextPath,
  isSvgPath,
  isTabularPath,
} from "../../shared/utils/fileKind";
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
import { createChatSessionInStore } from "../hooks/chatSessionStore";

export function AppWorkspaceShell(props: AppWorkspaceShellProps) {
  const {
    page,
    componentStartupState,
    pageRailItems,
    activeProjectId,
    busy,
    suspended = false,
    shellLayout,
    latexLayout,
    analysisLayout,
    libraryLayout,
    drawioWarmupInfo,
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
    translationModelId,
    onFsAction,
    onRunFsAction,
    t,
  } = props;

  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewFocusRequest, setPreviewFocusRequest] = useState<{ page: number; token: number } | null>(null);
  const [compileAssistDismissedFor, setCompileAssistDismissedFor] = useState("");
  const [compileAssistOverride, setCompileAssistOverride] = useState<
    | { kind: "cjk"; diagnostics: string[]; hint: string }
    | null
  >(null);
  const [compileAssistAutoFixBusy, setCompileAssistAutoFixBusy] = useState(false);
  const [chatTabOpen, setChatTabOpen] = useState(false);
  const [chatTabActive, setChatTabActive] = useState(false);
  const [chatTabTitle, setChatTabTitle] = useState<string | null>(null);

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

  const previewSelectedPath = previewOverridePath || selectedFile;
  const selectedIsPdf = isPdfPath(previewSelectedPath);
  const selectedIsExcel = isExcelPath(previewSelectedPath);
  const selectedIsImage = isImagePath(previewSelectedPath);
  const selectedIsMarkdown = isMarkdownPath(previewSelectedPath);
  const selectedIsSvg = isSvgPath(previewSelectedPath);
  const selectedIsCsv = isCsvPath(previewSelectedPath);
  const selectedIsTabular = isTabularPath(previewSelectedPath);
  const selectedIsPlainText = isPlainTextPath(previewSelectedPath);
  const selectedIsDraw = Boolean(selectedFile && /\.drawio$/i.test(selectedFile));
  const selectedIsTex = Boolean(previewSelectedPath && /\.tex$/i.test(previewSelectedPath));
  const selectedIsCode = !selectedIsDraw
    && !selectedIsTex
    && !selectedIsPlainText
    && isCodePath(previewSelectedPath);
  const previewMode: "pdf" | "image" | "markdown" | "svg" | "code" | "empty" = selectedIsImage
    ? (selectedImagePreviewUrl ? "image" : "empty")
    : selectedIsPdf
      ? (selectedFilePdfUrl ? "pdf" : "empty")
      : selectedIsTabular
        ? "empty"
        : selectedIsSvg
          ? "svg"
          : selectedIsMarkdown
            ? "markdown"
            : selectedIsCode
              ? "code"
              : compiledPdfUrl && (!previewSelectedPath || selectedIsTex || preferCompiledPreview)
                ? "pdf"
                : "empty";
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
      selectedIsCode={selectedIsCode}
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
      shareComments={shareComments}
      onJumpToShareComment={(page) =>
        setPreviewFocusRequest({
          page,
          token: Date.now(),
        })}
      previewFocusRequest={previewFocusRequest}
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
            componentStartupState={componentStartupState}
            projectId={activeProjectId}
            startupDrawioInfo={drawioWarmupInfo}
            selectedPath={selectedFile}
            onSelectPath={onSelectFile}
            onRequestFsAction={onFsAction}
            onRunFsAction={onRunFsAction}
            t={t}
          />
        </Suspense>
      );
    }
    if (page === "library") {
      return <NoProjectPanel busy={busy} componentStartupState={componentStartupState} onOpenFolder={onOpenFolder} t={t} />;
    }
    if (page === "git") {
      return activeProjectId ? gitPanel : <NoProjectPanel busy={busy} componentStartupState={componentStartupState} onOpenFolder={onOpenFolder} t={t} />;
    }
    if (page === "settings") {
      return settingsPanel;
    }
    if (!activeProjectId) {
      return <NoProjectPanel busy={busy} componentStartupState={componentStartupState} onOpenFolder={onOpenFolder} t={t} />;
    }
    return (
      <LatexWorkspaceEditorPanel
        activeProjectId={activeProjectId}
        busy={busy}
        suspended={suspended}
        selectedFile={selectedFile}
        selectedIsDraw={selectedIsDraw}
        selectedIsExcel={selectedIsExcel}
        editorContent={editorContent}
        editorTabs={editorTabs}
        activeTabId={activeTabId}
        dirtyByPath={dirtyByPath}
        shareSession={shareSession}
        shareBusy={shareBusy}
        shareSyncing={shareSyncing}
        shareMode={shareMode}
        shareSessionName={shareSessionName}
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
        t={t}
      />
    );
  };

  return (
    <main className="flex-1 min-h-0 overflow-hidden p-1" data-startup-state={componentStartupState} aria-busy={componentStartupState !== "ready"}>
      <div className="flex h-full gap-0">
        <div className="w-14 shrink-0">
          <PageRail items={pageRailItems} activePage={page} onChange={onPageChange} />
        </div>
        <div className="min-w-0 flex-1">
          <WorkspacePageLayout
            page={page}
            activeProjectId={activeProjectId}
            busy={busy}
            componentStartupState={componentStartupState}
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
