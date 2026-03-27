import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { PenTool, Play, Redo2, Save, Undo2 } from "lucide-react";
import { PageRail } from "./PageRail";
import { isCsvPath, isExcelPath, isImagePath, isMarkdownPath, isPdfPath, isSvgPath, isTabularPath } from "../../shared/utils/fileKind";
import { EditorTabsBar } from "./editor/EditorTabsBar";
import { AgentProposalMiniBar } from "./editor/AgentProposalMiniBar";
import { CompileAssistPopover } from "./editor/CompileAssistPopover";
import { configureLatexCompletionRuntime, ensureLatexCompletionProvider } from "./editor/latexCompletion";
import { buildCompileAssistHint, prioritizeCompileDiagnostics } from "./editor/compileAssistHint";
import { WorkspacePreviewPanel } from "./workspace/WorkspacePreviewPanel";
import { WorkspacePageLayout } from "./workspace/WorkspacePageLayout";
import { NoProjectPanel } from "./workspace/NoProjectPanel";
import { WorkspaceShareControl } from "./workspace/WorkspaceShareControl";
import { ChatTopbarSessionControl } from "./chat/ChatTopbarSessionControl";
import { buildAgentCommandItems, composeTitleWithShortcut } from "./workspace/workspaceShellUtils";
import {
  LazyAgentChatOverlay,
  LazyChatWorkspace,
  LazyDrawWorkspace,
  WorkspacePanelFallback,
} from "./workspace/workspaceShellLazy";
import type { AppWorkspaceShellProps } from "./workspace/workspaceShellTypes";
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
  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const [compileAssistDismissedFor, setCompileAssistDismissedFor] = useState("");
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
  const selectedIsDraw = Boolean(selectedFile && /\.drawio$/i.test(selectedFile));
  const previewMode: "pdf" | "image" | "markdown" | "svg" | "empty" = selectedIsImage
    ? (selectedImagePreviewUrl ? "image" : "empty")
    : selectedIsPdf
      ? (selectedFilePdfUrl ? "pdf" : "empty")
      : selectedIsTabular
        ? "empty"
        : selectedIsSvg
          ? "svg"
          : preferCompiledPreview && compiledPdfUrl
            ? "pdf"
            : selectedIsMarkdown
              ? "markdown"
              : compiledPdfUrl
                ? "pdf"
                : "empty";
  const previewPdfUrl = previewMode === "pdf" ? (selectedIsPdf ? selectedFilePdfUrl : compiledPdfUrl) : null;
  const canZoomPreview = previewMode === "pdf" && Boolean(previewPdfUrl);
  const agentCommandItems = buildAgentCommandItems(t);
  const compileAssistKey = compileDiagnostics.join("\n").slice(0, 2400);
  const showCompileAssist = Boolean(
    compileErrorLine && compileDiagnostics.length > 0 && compileAssistDismissedFor !== compileAssistKey,
  );
  const compileAssistDiagnostics = useMemo(() => prioritizeCompileDiagnostics(compileDiagnostics), [compileDiagnostics]);
  const compileAssistHint = useMemo(() => buildCompileAssistHint(compileDiagnostics, t), [compileDiagnostics, t]);
  const showChatWorkspace = chatTabOpen && chatTabActive;
  const handleOpenChatTab = () => {
    setChatTabOpen(true);
    setChatTabActive(true);
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
  const handleCompileAssistAutoFix = () => {
    setCompileAssistDismissedFor(compileAssistKey);
    setChatTabActive(false);
    if (agentCollapsed) {
      onAgentToggle();
    }
    const extra = compileAssistDiagnostics.slice(0, 6).join("\n").trim();
    const prompt = extra ? `/review ${extra}` : "/review";
    onAgentRun(prompt, { forceNewSession: true });
  };
  const renderPdfPreviewPanel = () => (
    <WorkspacePreviewPanel
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
            projectId={activeProjectId}
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
      <div className="grid h-full min-w-0 grid-rows-[auto_34px_minmax(260px,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft motion-shell-stage motion-panel-glow">
        <div className="min-w-0 overflow-visible border-b border-slate-200 px-3 py-1.5">
          <div className="panel-topbar flex w-full min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
            <WorkspaceShareControl
              selectedFile={selectedFile}
              shareSession={shareSession}
              shareBusy={shareBusy}
              shareSyncing={shareSyncing}
              shareMode={shareMode}
              shareSessionName={shareSessionName}
              onShareModeChange={onShareModeChange}
              onShareSessionNameChange={onShareSessionNameChange}
              onShareStart={onShareStart}
              onShareStop={onShareStop}
              onShareRefresh={onShareRefresh}
              t={t}
            />
            <ChatTopbarSessionControl activeProjectId={activeProjectId} onOpenChatTab={handleOpenChatTab} onSessionStateChanged={setChatTabTitle} t={t} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="panel-topbar-btn motion-hover-rise rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onEditorUndo}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.undo"), t("shortcut.undo"))}
              aria-label={composeTitleWithShortcut(t("workspace.undo"), t("shortcut.undo"))}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              className="panel-topbar-btn motion-hover-rise rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onEditorRedo}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.redo"), t("shortcut.redo"))}
              aria-label={composeTitleWithShortcut(t("workspace.redo"), t("shortcut.redo"))}
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              className="panel-topbar-btn motion-hover-rise rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onSaveFile}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.save"), t("shortcut.save"))}
              aria-label={composeTitleWithShortcut(t("workspace.save"), t("shortcut.save"))}
            >
              <Save className="h-4 w-4" />
            </button>
            <div className="relative">
            {selectedIsDraw ? (
              <button
                className="panel-topbar-btn motion-hover-rise rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                onClick={() => onPageChange("draw")}
                disabled={busy}
                title={t("workspace.openDrawPage")}
                aria-label={t("workspace.openDrawPage")}
              >
                <PenTool className="h-4 w-4" />
              </button>
            ) : null}
            <button
                className="panel-topbar-btn motion-hover-rise rounded border border-primary-600 bg-primary-600 text-white transition hover:bg-primary-700 disabled:opacity-50"
                onClick={() => {
                  setCompileAssistDismissedFor("");
                  onCompile();
                }}
                disabled={busy}
                title={composeTitleWithShortcut(t("workspace.compile"), t("shortcut.compile"))}
                aria-label={composeTitleWithShortcut(t("workspace.compile"), t("shortcut.compile"))}
              >
                <Play className="h-4 w-4" />
              </button>
              <CompileAssistPopover
                visible={showCompileAssist}
                diagnostics={compileAssistDiagnostics}
                hint={compileAssistHint}
                onDismiss={() => setCompileAssistDismissedFor(compileAssistKey)}
                onAutoFix={handleCompileAssistAutoFix}
                autoFixDisabled={busy}
                t={t}
              />
            </div>
          </div>
        </div>
      </div>
        <EditorTabsBar
          tabs={editorTabs}
          activeTabId={showChatWorkspace ? null : activeTabId}
          dirtyByPath={dirtyByPath}
          busy={busy}
          extraTabs={chatTabOpen ? [{
            id: "editor-chat-tab",
            title: chatTabTitle?.trim() ? chatTabTitle : t("nav.chat"),
            active: showChatWorkspace,
            onSelect: () => setChatTabActive(true),
            onClose: handleCloseChatTab,
          }] : []}
          onSelect={handleSelectEditorTab}
          onClose={onTabClose}
          onCloseAction={onTabCloseAction}
          onPin={onTabPin}
          t={t}
        />
        <div ref={editorPanelRef} className="relative h-full min-h-0">
          {agentProposal ? (
            <AgentProposalMiniBar
              proposal={agentProposal}
              busy={busy}
              onAccept={() => onAgentAcceptProposal(false)}
              onReject={onAgentRejectProposal}
              t={t}
            />
          ) : null}
          {showChatWorkspace ? (
            <Suspense fallback={<WorkspacePanelFallback label={t("common.loading")} />}>
              <LazyChatWorkspace
                projectId={activeProjectId}
                channelPrefs={channelPrefs}
                suspended={suspended}
                onRequestAgentReview={(prompt) => {
                  setChatTabActive(false);
                  if (agentCollapsed) {
                    onAgentToggle();
                  }
                  onChatReviewRequest(prompt);
                }}
                t={t}
              />
            </Suspense>
          ) : selectedIsExcel ? (
            <div className="flex h-full items-center justify-center rounded-md bg-slate-50 text-xs text-slate-500">
              {t("editor.excelPreviewOnly")}
            </div>
          ) : (
            <MonacoEditor
              language="latex"
              value={editorContent}
              onChange={(value) => onEditorChange(value ?? "")}
              onMount={(editor, monaco) => {
                ensureLatexCompletionProvider(monaco);
                onEditorMount(editor, monaco);
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                smoothScrolling: true,
                automaticLayout: true,
                quickSuggestions: { other: true, comments: false, strings: true },
                suggestOnTriggerCharacters: true,
                tabCompletion: "on",
                inlineSuggest: { enabled: true, mode: "subword" },
                bracketPairColorization: { enabled: true },
                acceptSuggestionOnCommitCharacter: true,
                wordWrap: "on",
                wordWrapColumn: 0,
                wrappingIndent: "same",
              }}
            />
          )}
          {showChatWorkspace ? null : (
          <Suspense fallback={<WorkspacePanelFallback label={t("common.loading")} />}>
            <LazyAgentChatOverlay
              collapsed={agentCollapsed}
              phase={agentPhase}
              statusLine={t(agentStatusKey)}
              title={t("agent.chatTitle")}
              collapseLabel={t("agent.collapse")}
              prompt={agentPrompt}
              busy={busy}
              messages={agentMessages}
              proposal={agentProposal}
              pendingAction={agentPendingAction}
              runId={agentRunId}
              sessions={agentSessions}
              sessionPickerOpen={agentSessionPickerOpen}
              sessionPickerIndex={agentSessionPickerIndex}
              rollbackVisible={agentRollbackVisible}
              events={events}
              onPromptChange={onAgentPromptChange}
              onRun={onAgentRun}
              onSessionPickerOpenChange={onAgentSessionPickerOpenChange}
              onSessionPickerIndexChange={onAgentSessionPickerIndexChange}
              onSessionConfirm={onAgentSessionConfirm}
              onRollback={onAgentRollback}
              onToggle={onAgentToggle}
              onAcceptProposal={onAgentAcceptProposal}
              onRejectProposal={onAgentRejectProposal}
              onPendingActionResolve={onAgentPendingActionResolve}
              runLabel={agentPhase === "running" ? t("agent.run.cancel") : t("workspace.runTaskAgent")}
              placeholder={t("workspace.agentPlaceholder")}
              activityShowLabel={t("agent.activityShow")}
              activityHideLabel={t("agent.activityHide")}
              applyLabel={t("agent.proposalApply")}
              rejectLabel={t("agent.proposalReject")}
              autoAnalyzeLabel={t("agent.proposalAutoAnalyze")}
              showMoreLabel={t("agent.showMore")}
              showLessLabel={t("agent.showLess")}
              commands={agentCommandItems}
              resumeTitle={t("agent.resume.title")}
              resumeHint={t("agent.resume.hint")}
              resumeEmptyLabel={t("agent.resume.empty")}
              rollbackLabel={t("agent.rollback.restore")}
              pendingActionTitle={t("agent.autoCommit.title")}
              pendingActionDesc={t("agent.autoCommit.desc")}
              pendingActionWaitLabel={t("agent.pendingAction.waiting")}
              pendingActionYesLabel={t("agent.autoCommit.yes")}
              pendingActionNoLabel={t("agent.autoCommit.no")}
            />
          </Suspense>
          )}
        </div>
      </div>
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






