import { Suspense, lazy } from "react";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AppOverlays } from "./AppOverlays";
import { AppTopbar } from "./AppTopbar";
import { WorkspaceBootstrapFallback } from "./workspace/WorkspaceBootstrapFallback";
import { SleepWakeScreen } from "./SleepWakeScreen";
import { UnsavedChangesDialog } from "./editor/UnsavedChangesDialog";
import { useAppAppearance } from "../hooks/useAppAppearance";
import { runtimeClearVolatileCacheAndRestart } from "../../shared/api/runtime";
import { cspStyle } from "../../shared/ui/cspStyle";
import { clearRecoverableClientState } from "../utils/recoverableClientState";
import type { AppContainerViewProps } from "./appContainerViewTypes";
import { ResearchAgentGlobalStatusHost } from "./agent/ResearchAgentGlobalStatusHost";
export { createAppContainerViewBridge } from "./appContainerViewBridge";

const AppWorkspaceShell = lazy(async () => ({ default: (await import("./AppWorkspaceShell")).AppWorkspaceShell }));

export function AppContainerView(props: AppContainerViewProps) {
  const {
    status,
    sleeping,
    onWakeFromSleep,
    startupReady,
    suspended,
    logoMark,
    projects,
    activeProjectId,
    busy,
    isTauriRuntime,
    windowActionBusy,
    isMaximized,
    projectSearchQuery,
    projectSearchBusy,
    projectSearchSearched,
    projectSearchResults,
    handleProjectChange,
    handleProjectDelete,
    setProjectSearchQuery,
    handleProjectSearch,
    handleProjectSearchSelect,
    setProjectSearchResults,
    setProjectSearchSearched,
    handleInitProjectFromFolderWithGuard,
    handleCreateSampleProject,
    handleOnboardingDismiss,
    handlePdfViewed,
    handleWindowControlWithGuard,
    shareSession,
    sharePassword,
    shareBusy,
    shareSyncing,
    shareConflict = null,
    shareComments = [],
    shareEditAnnotations = [],
    shareMode = "local",
    shareSessionName = "",
    handleShareModeChange = () => undefined,
    handleShareSessionNameChange = () => undefined,
    handleShareStart,
    handleShareStop,
    handleShareRefresh,
    handleSharePasswordReveal,
    handleShareConflictResolve = () => undefined,
    t,
    recoverWorkspaceLayout,
    researchAgentRuntime,
    page,
    pageRailItems,
    shellLayout,
    latexLayout,
    latexTerminalLayout = latexLayout,
    analysisLayout,
    libraryLayout,
    libraryBibLayout = libraryLayout,
    settings,
    tree,
    libraryTree,
    selectedFile,
    selectedLibraryPath,
    fileList,
    editorContent,
    editorTabs,
    activeTabId,
    dirtyByPath,
    pdfUrl,
    preferCompiledPreview,
    selectedFilePdfUrl,
    compiledPdfRelativePath = null,
    selectedImagePreviewUrl = null,
    previewOverridePath = null,
    compileErrorLine,
    compileDiagnostics,
    compileBusy,
    compileInstallProgress = null,
    agentCollapsed,
    agentPhase,
    agentStatusKey,
    agentPrompt,
    agentMessages,
    agentProposal,
    agentPendingAction = null,
    agentRunId,
    agentSessions,
    agentSessionPickerOpen,
    agentSessionPickerIndex,
    agentRollbackVisible,
    explorerGitDecorations,
    agentResourceLocks,
    SHELL_MIN,
    settingsPanel,
    gitPanel,
    analysisPanel,
    agentPanel,
    setPage,
    handleSelectWorkspacePath,
    setSelectedLibraryPath,
    setEditorContent,
    handleTabSelect,
    handleTabClose,
    handleTabCloseAction,
    handleTabPin,
    editorRef,
    setAgentPrompt,
    setAgentCollapsed,
    handleRunAgent,
    setAgentSessionPickerOpen,
    setAgentSessionPickerIndex,
    handleAgentSessionConfirm,
    handleAgentRollback,
    handleAcceptAgentProposal,
    handleRejectAgentProposal,
    handleResolveAgentPendingAction = () => undefined,
    handleSaveActiveFile,
    handleWriteSelectedFileContent = async () => false,
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
    setLogsTab,
    setOverlay,
    handleLibraryRescan,
    handleLibraryImportPdf,
    handleLibraryImportLink,
    handleLibrarySyncZotero = () => undefined,
    handleLibraryAnalyzePaper,
    analysisRunning,
    libraryViewMode = null,
    handleLibraryViewModeChange = () => undefined,
    handleWorkspaceRevealInSystem,
    handleWorkspaceOpenTerminal,
    handleWorkspaceRescan = () => undefined,
    savePanelLayout,
    requestFsAction,
    runFsAction = async () => false,
    overlay,
    logsTab,
    events,
    modelModalOpen,
    modelModalMode,
    modelModalInitial,
    deleteIntent,
    deleteDontAskAgain,
    integrityIssue,
    projectDeleteConfirmIntent,
    projectDeleteConfirmBusy,
    themeTransition,
    toast,
    analysisEnvPrompt,
    setModelModalOpen,
    setModelModalInitial,
    setModelModalMode,
    handleModelModalSubmit,
    handleGetModelApiKey,
    setDeleteIntent,
    confirmDelete,
    setDeleteDontAskAgain,
    handleIntegrityCancel,
    handleIntegrityRepair,
    handleProjectDeleteConfirmCancel,
    handleProjectDeleteConfirm,
    unsavedDialogOpen,
    unsavedDialogIntent,
    unsavedDialogItems,
    unsavedDialogBusy,
    handleUnsavedDialogSaveAndContinue,
    handleUnsavedDialogDiscardAndContinue,
    handleUnsavedDialogCancel,
    closeBehaviorDialogOpen,
    closeBehaviorRememberChoice,
    closeBehaviorDialogBusy,
    setCloseBehaviorRememberChoice,
    handleCloseBehaviorDialogCancel,
    handleCloseBehaviorDialogResolve,
  } = props;
  const handleCircuitBreak = () => {
    clearRecoverableClientState();
    void runtimeClearVolatileCacheAndRestart().catch(() => undefined);
  };
  const safeAnalysisEnvPrompt = analysisEnvPrompt ?? {
    envPromptOpen: false,
    envPromptStatus: null,
    envPromptTaskStatus: null,
    envPromptBusy: false,
    handleEnvPromptLater: () => undefined,
    handleEnvPromptPickLocation: async () => undefined,
    handleEnvPromptCreate: async () => undefined,
  };
  const completionModelId =
    settings?.uiPrefs?.featureModelBindings?.completionModelId
    || null;
  const chatAgentModelId =
    settings?.uiPrefs?.featureModelBindings?.chatAgentModelId
    || settings?.uiPrefs?.featureModelBindings?.translationModelId
    || null;
  const translationModelId =
    settings?.uiPrefs?.featureModelBindings?.translationModelId
    || null;
  const paperBriefEngine = settings?.uiPrefs?.paperBriefEngine ?? "auto";
  const workspaceExplorerDefaultExpanded = settings?.uiPrefs?.workspaceExplorerDefaultExpanded ?? true;
  const libraryExplorerDefaultExpanded = settings?.uiPrefs?.libraryExplorerDefaultExpanded ?? true;
  const workspaceExplorerScrollbarVisible = settings?.uiPrefs?.workspaceExplorerScrollbarVisible ?? true;
  const libraryExplorerScrollbarVisible = settings?.uiPrefs?.libraryExplorerScrollbarVisible ?? true;
  const editorResizeRefreshDelayMs = Math.max(
    500,
    Math.min(5000, Number(settings?.uiPrefs?.editorResizeRefreshDelayMs ?? 2000)),
  );
  const workspaceExplorerExpandedPaths =
    activeProjectId
      ? settings?.uiPrefs?.workspaceExplorerExpandedPathsByProject?.[activeProjectId]
      : undefined;
  const libraryExplorerExpandedPaths =
    activeProjectId
      ? settings?.uiPrefs?.libraryExplorerExpandedPathsByProject?.[activeProjectId]
      : undefined;
  const updateExplorerExpandedPaths = (
    key: "workspaceExplorerExpandedPathsByProject" | "libraryExplorerExpandedPathsByProject",
    paths: string[],
  ) => {
    if (!activeProjectId) {
      return;
    }
    props.setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        uiPrefs: {
          ...(prev.uiPrefs ?? {}),
          [key]: {
            ...(prev.uiPrefs?.[key] ?? {}),
            [activeProjectId]: paths,
          },
        },
      };
    });
  };
  const {
    backgroundUrl,
    fontScale,
    style: appBackgroundStyle,
    motionClass,
    borderClass,
  } = useAppAppearance(settings);

  if (sleeping) {
    return <SleepWakeScreen logoMark={logoMark} t={t} onWake={onWakeFromSleep} />;
  }

  return (
    <div
      className={`app-material-canvas relative isolate flex h-screen w-screen flex-col overflow-hidden ${motionClass} ${borderClass} ${backgroundUrl ? "wallpaper-enabled" : ""}`}
      {...cspStyle(appBackgroundStyle)}
    >
      <div className="relative z-10 flex h-full w-full flex-col">
        <AppTopbar
          status={status}
          logoMark={logoMark}
          projects={projects}
          activeProjectId={activeProjectId}
          busy={busy}
          isTauriRuntime={isTauriRuntime}
          windowActionBusy={windowActionBusy}
          isMaximized={isMaximized}
          projectSearchQuery={projectSearchQuery}
          projectSearchBusy={projectSearchBusy}
          projectSearchSearched={projectSearchSearched}
          projectSearchResults={projectSearchResults}
          onProjectChange={handleProjectChange}
          onProjectDelete={handleProjectDelete}
          onProjectSearchQueryChange={(nextQuery) => {
            setProjectSearchQuery(nextQuery);
            setProjectSearchSearched(false);
            setProjectSearchResults([]);
          }}
          onProjectSearch={handleProjectSearch}
          onProjectSearchSelect={handleProjectSearchSelect}
          onProjectSearchClear={() => {
            setProjectSearchQuery("");
            setProjectSearchResults([]);
            setProjectSearchSearched(false);
          }}
          onOpenFolder={handleInitProjectFromFolderWithGuard}
          onWindowControl={handleWindowControlWithGuard}
          t={t}
        />

        <AppErrorBoundary
          fallbackTitle={t("workspace.crashedTitle")}
          fallbackHint={t("workspace.crashedHint")}
          retryLabel={t("workspace.crashedRetry")}
          circuitBreakerLabel={t("workspace.circuitBreakerRestart")}
          circuitBreakerHint={t("workspace.circuitBreakerHint")}
          onRecover={recoverWorkspaceLayout}
          onCircuitBreak={handleCircuitBreak}
        >
          {!startupReady ? (
            <WorkspaceBootstrapFallback t={t} />
          ) : (
            <Suspense fallback={<WorkspaceBootstrapFallback t={t} />}>
              <AppWorkspaceShell
                page={page}
                pageRailItems={pageRailItems}
                activeProjectId={activeProjectId}
                busy={busy}
                shellLayout={shellLayout}
                latexLayout={latexLayout}
                latexTerminalLayout={latexTerminalLayout}
                analysisLayout={analysisLayout}
                libraryLayout={libraryLayout}
                libraryBibLayout={libraryBibLayout}
                previewDefaultZoom={settings?.uiPrefs?.previewDefaultZoom ?? 1}
                fontScale={fontScale}
                completionModelId={completionModelId}
                chatAgentModelId={chatAgentModelId}
                translationModelId={translationModelId}
                paperBriefEngine={paperBriefEngine}
                workspaceExplorerDefaultExpanded={workspaceExplorerDefaultExpanded}
                libraryExplorerDefaultExpanded={libraryExplorerDefaultExpanded}
                workspaceExplorerScrollbarVisible={workspaceExplorerScrollbarVisible}
                libraryExplorerScrollbarVisible={libraryExplorerScrollbarVisible}
                editorResizeRefreshDelayMs={editorResizeRefreshDelayMs}
                workspaceExplorerExpandedPaths={workspaceExplorerExpandedPaths}
                libraryExplorerExpandedPaths={libraryExplorerExpandedPaths}
                onWorkspaceExplorerExpandedPathsChange={(paths) =>
                  updateExplorerExpandedPaths("workspaceExplorerExpandedPathsByProject", paths)
                }
                onLibraryExplorerExpandedPathsChange={(paths) =>
                  updateExplorerExpandedPaths("libraryExplorerExpandedPathsByProject", paths)
                }
                tree={tree}
                libraryTree={libraryTree}
                selectedFile={selectedFile}
                selectedLibraryPath={selectedLibraryPath}
                fileList={fileList}
                editorContent={editorContent}
                editorTabs={editorTabs}
                activeTabId={activeTabId}
                dirtyByPath={dirtyByPath}
                compiledPdfUrl={pdfUrl}
                compiledPdfRelativePath={compiledPdfRelativePath}
                preferCompiledPreview={preferCompiledPreview}
                selectedFilePdfUrl={selectedFilePdfUrl}
                selectedImagePreviewUrl={selectedImagePreviewUrl}
                previewOverridePath={previewOverridePath}
                compileErrorLine={compileErrorLine}
                compileDiagnostics={compileDiagnostics}
                compileBusy={compileBusy}
                compileInstallProgress={compileInstallProgress}
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
                explorerGitDecorations={explorerGitDecorations}
                agentResourceLocks={agentResourceLocks}
                shellMin={SHELL_MIN}
                settings={settings}
                settingsPanel={settingsPanel}
                gitPanel={gitPanel}
                analysisPanel={analysisPanel}
                agentPanel={agentPanel}
                onPageChange={setPage}
                shareSession={shareSession}
                sharePassword={sharePassword}
                shareBusy={shareBusy}
                shareSyncing={shareSyncing}
                shareConflict={shareConflict}
                shareComments={shareComments}
                shareEditAnnotations={shareEditAnnotations}
                channelPrefs={settings?.uiPrefs?.channels ?? null}
                shareMode={shareMode}
                shareSessionName={shareSessionName}
                onShareModeChange={handleShareModeChange}
                onShareSessionNameChange={handleShareSessionNameChange}
                onShareStart={handleShareStart}
                onShareStop={handleShareStop}
                onShareRefresh={handleShareRefresh}
                onSharePasswordReveal={handleSharePasswordReveal}
                onShareConflictResolve={handleShareConflictResolve}
                onSelectFile={handleSelectWorkspacePath}
                onSelectLibraryPath={setSelectedLibraryPath}
                onEditorChange={setEditorContent}
                onTabSelect={handleTabSelect}
                onTabClose={handleTabClose}
                onTabCloseAction={handleTabCloseAction}
                onTabPin={handleTabPin}
                onEditorMount={(editor, _monaco) => {
                  editorRef.current = editor;
                }}
                onChatReviewRequest={(prompt) => {
                  setAgentCollapsed(false);
                  void handleRunAgent(prompt, { forceNewSession: true });
                }}
                onAgentPromptChange={setAgentPrompt}
                onAgentToggle={() => setAgentCollapsed((prev: boolean) => !prev)}
                onAgentRun={handleRunAgent}
                onAgentSessionPickerOpenChange={setAgentSessionPickerOpen}
                onAgentSessionPickerIndexChange={setAgentSessionPickerIndex}
                onAgentSessionConfirm={handleAgentSessionConfirm}
                onAgentRollback={handleAgentRollback}
                onAgentAcceptProposal={(withAnalysis) => {
                  void handleAcceptAgentProposal(withAnalysis);
                }}
                onAgentRejectProposal={handleRejectAgentProposal}
                onAgentPendingActionResolve={handleResolveAgentPendingAction}
                onOpenFolder={handleInitProjectFromFolderWithGuard}
                onCreateSample={handleCreateSampleProject}
                onOnboardingDismiss={handleOnboardingDismiss}
                onPdfViewed={handlePdfViewed}
                onSaveFile={handleSaveActiveFile}
                onWriteSelectedFileContent={handleWriteSelectedFileContent}
                onCompile={handleCompile}
                onExportPdf={handleExportCompiledPdf}
                onEditorUndo={handleEditorUndo}
                onEditorRedo={handleEditorRedo}
                onOpenLogs={(tab) => {
                  setLogsTab(tab);
                  setOverlay("logs");
                }}
                onLibraryRescan={handleLibraryRescan}
                onLibraryImportPdf={handleLibraryImportPdf}
                onLibraryImportLink={handleLibraryImportLink}
                onLibrarySyncZotero={handleLibrarySyncZotero}
                onLibraryAnalyzePaper={handleLibraryAnalyzePaper}
                analysisRunning={analysisRunning}
                libraryViewMode={libraryViewMode}
                onLibraryViewModeChange={handleLibraryViewModeChange}
                onWorkspaceRevealInSystem={handleWorkspaceRevealInSystem}
                onWorkspaceOpenTerminal={handleWorkspaceOpenTerminal}
                onWorkspaceRescan={handleWorkspaceRescan}
                onSavePanelLayout={(panel, layout) => savePanelLayout(panel, layout)}
                onFsAction={(scope, action, path, targetPath, content) =>
                  requestFsAction(scope, action, path, targetPath, content)
                }
                onRunFsAction={(scope, action, path, targetPath, content) =>
                  runFsAction(scope, action, path, targetPath, content)
                }
                t={t}
                suspended={suspended}
              />
            </Suspense>
          )}
        </AppErrorBoundary>
      </div>

      <ResearchAgentGlobalStatusHost
        runtime={researchAgentRuntime}
        onPageChange={setPage}
        onSelectLibraryPath={setSelectedLibraryPath}
        onSelectWorkspacePath={handleSelectWorkspacePath}
        t={t}
      />

      <AppOverlays
        overlay={overlay}
        logsTab={logsTab}
        events={events}
        compileDiagnostics={compileDiagnostics}
        modelModalOpen={modelModalOpen}
        modelModalMode={modelModalMode}
        modelModalInitial={modelModalInitial}
        settings={settings}
        deleteIntent={deleteIntent}
        deleteDontAskAgain={deleteDontAskAgain}
        integrityIssue={integrityIssue}
        projectDeleteConfirmIntent={projectDeleteConfirmIntent}
        projectDeleteConfirmBusy={projectDeleteConfirmBusy}
        themeTransition={themeTransition}
        toast={toast}
        analysisEnvPrompt={safeAnalysisEnvPrompt}
        onOverlayClose={() => setOverlay(null)}
        onLogsTabChange={setLogsTab}
        onModelModalClose={() => {
          setModelModalOpen(false);
          setModelModalInitial(null);
          setModelModalMode("create");
        }}
        onModelSubmit={handleModelModalSubmit}
        onGetModelApiKey={handleGetModelApiKey}
        onDeleteCancel={() => setDeleteIntent(null)}
        onDeleteConfirm={confirmDelete}
        onDeleteDontAskChange={setDeleteDontAskAgain}
        onIntegrityCancel={handleIntegrityCancel}
        onIntegrityRepair={handleIntegrityRepair}
        onProjectDeleteConfirmCancel={handleProjectDeleteConfirmCancel}
        onProjectDeleteConfirm={handleProjectDeleteConfirm}
        closeBehaviorDialogOpen={closeBehaviorDialogOpen}
        closeBehaviorRemember={closeBehaviorRememberChoice}
        closeBehaviorDialogBusy={closeBehaviorDialogBusy}
        onCloseBehaviorRememberChange={setCloseBehaviorRememberChoice}
        onCloseBehaviorCancel={handleCloseBehaviorDialogCancel}
        onCloseBehaviorConfirm={handleCloseBehaviorDialogResolve}
        t={t}
      />

      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        intent={unsavedDialogIntent}
        items={unsavedDialogItems}
        busy={unsavedDialogBusy}
        onSaveAndContinue={() => {
          void handleUnsavedDialogSaveAndContinue();
        }}
        onDiscardAndContinue={() => {
          void handleUnsavedDialogDiscardAndContinue();
        }}
        onCancel={handleUnsavedDialogCancel}
        t={t}
      />
    </div>
  );
}

