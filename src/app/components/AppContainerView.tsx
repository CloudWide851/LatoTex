import { Suspense, lazy, type CSSProperties } from "react";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AppOverlays } from "./AppOverlays";
import { AppTopbar } from "./AppTopbar";
import { SleepWakeScreen } from "./SleepWakeScreen";
import { StartupOverlay } from "./StartupOverlay";
import { UnsavedChangesDialog } from "./editor/UnsavedChangesDialog";
import { useBackgroundImageObjectUrl } from "../hooks/useBackgroundImageObjectUrl";

const AppWorkspaceShell = lazy(async () => {
  const module = await import("./AppWorkspaceShell");
  return { default: module.AppWorkspaceShell };
});

export function AppContainerView(props: any) {
  const {
    status,
    startupState,
    componentStartupState,
    handleStartupRetry,
    handleStartupChooseAnalysisEnvLocation,
    handleStartupPrepareAnalysisEnv,
    sleeping,
    onWakeFromSleep,
    suspended,
    logoMark,
    projects,
    activeProjectId,
    busy,
    isTauriRuntime,
    isMaximized,
    projectSearchQuery,
    projectSearchBusy,
    projectSearchSearched,
    projectSearchResults,
    handleProjectChange,
    setProjectSearchQuery,
    handleProjectSearch,
    handleProjectSearchSelect,
    setProjectSearchResults,
    setProjectSearchSearched,
    handleInitProjectFromFolderWithGuard,
    handleWindowControlWithGuard,
    shareSession,
    shareBusy,
    shareSyncing,
    shareComments,
    shareMode,
    shareSessionName,
    handleShareModeChange,
    handleShareSessionNameChange,
    handleShareStart,
    handleShareStop,
    handleShareRefresh,
    t,
    recoverWorkspaceLayout,
    page,
    pageRailItems,
    shellLayout,
    latexLayout,
    analysisLayout,
    libraryLayout,
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
    explorerGitDecorations,
    SHELL_MIN,
    settingsPanel,
    gitPanel,
    analysisPanel,
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
    handleResolveAgentPendingAction,
    handleSaveActiveFile,
    handleWriteSelectedFileContent,
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
    setLogsTab,
    setOverlay,
    handleLibraryRescan,
    handleLibraryImportPdf,
    handleLibraryImportLink,
    handleLibrarySyncZotero,
    handleLibraryAnalyzePaper,
    analysisRunning,
    libraryViewMode,
    handleLibraryViewModeChange,
    handleWorkspaceRevealInSystem,
    handleWorkspaceOpenTerminal,
    handleWorkspaceRescan,
    savePanelLayout,
    requestFsAction,
    runFsAction,
    overlay,
    logsTab,
    events,
    modelModalOpen,
    modelModalMode,
    modelModalInitial,
    deleteIntent,
    deleteDontAskAgain,
    integrityIssue,
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
  const completionModelId =
    settings?.uiPrefs?.featureModelBindings?.completionModelId
    || null;
  const translationModelId =
    settings?.uiPrefs?.featureModelBindings?.translationModelId
    || null;
  const rawBackgroundPaths: string[] = Array.isArray(settings?.uiPrefs?.backgroundImagePaths)
    ? (settings.uiPrefs.backgroundImagePaths as string[])
    : [];
  const normalizedBackgroundPaths: string[] = Array.from(
    new Set(
      rawBackgroundPaths
        .map((item: string) => String(item ?? "").trim())
        .filter((item: string) => item.length > 0),
    ),
  );
  const selectedBackgroundPath = String(settings?.uiPrefs?.backgroundImagePath ?? "").trim();
  const backgroundPath = selectedBackgroundPath || normalizedBackgroundPaths[0] || "";
  const backgroundUrl = useBackgroundImageObjectUrl(backgroundPath);
  const rawBlur = Number(settings?.uiPrefs?.backgroundBlurPx ?? 18);
  const backgroundBlurPx = Number.isFinite(rawBlur) ? Math.max(4, Math.min(32, rawBlur)) : 18;
  const appBackgroundStyle = backgroundUrl
    ? ({
        backgroundImage: `url("${backgroundUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        ["--wallpaper-blur" as string]: `${backgroundBlurPx}px`,
      } as CSSProperties)
    : undefined;

  if (sleeping) {
    return <SleepWakeScreen logoMark={logoMark} t={t} onWake={onWakeFromSleep} />;
  }

  return (
    <div
      className={`relative isolate flex h-screen w-screen flex-col overflow-hidden bg-slate-100 ${backgroundUrl ? "wallpaper-enabled" : ""}`}
      style={appBackgroundStyle}
    >
      <div className="relative z-10 flex h-full w-full flex-col">
        <AppTopbar
          status={status}
          componentStartupState={componentStartupState}
          logoMark={logoMark}
          projects={projects}
          activeProjectId={activeProjectId}
          busy={busy}
          isTauriRuntime={isTauriRuntime}
          isMaximized={isMaximized}
          projectSearchQuery={projectSearchQuery}
          projectSearchBusy={projectSearchBusy}
          projectSearchSearched={projectSearchSearched}
          projectSearchResults={projectSearchResults}
          onProjectChange={handleProjectChange}
          onProjectSearchQueryChange={setProjectSearchQuery}
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
          onRecover={recoverWorkspaceLayout}
        >
          <Suspense
            fallback={
              <section className="flex h-full min-h-0 items-center justify-center text-sm text-slate-500">
                {t("common.loading")}
              </section>
            }
          >
            <AppWorkspaceShell
              page={page}
              componentStartupState={componentStartupState}
              pageRailItems={pageRailItems}
              activeProjectId={activeProjectId}
              busy={busy}
              shellLayout={shellLayout}
              latexLayout={latexLayout}
              analysisLayout={analysisLayout}
              libraryLayout={libraryLayout}
              previewDefaultZoom={settings?.uiPrefs?.previewDefaultZoom ?? 1}
              completionModelId={completionModelId}
              translationModelId={translationModelId}
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
              preferCompiledPreview={preferCompiledPreview}
              selectedFilePdfUrl={selectedFilePdfUrl}
              selectedImagePreviewUrl={selectedImagePreviewUrl}
              previewOverridePath={previewOverridePath}
              compileErrorLine={compileErrorLine}
              compileDiagnostics={compileDiagnostics}
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
              shellMin={SHELL_MIN}
              settingsPanel={settingsPanel}
              gitPanel={gitPanel}
              analysisPanel={analysisPanel}
              onPageChange={setPage}
              shareSession={shareSession}
              shareBusy={shareBusy}
              shareSyncing={shareSyncing}
              shareComments={shareComments}
              channelPrefs={settings?.uiPrefs?.channels ?? null}
              shareMode={shareMode}
              shareSessionName={shareSessionName}
              onShareModeChange={handleShareModeChange}
              onShareSessionNameChange={handleShareSessionNameChange}
              onShareStart={handleShareStart}
              onShareStop={handleShareStop}
              onShareRefresh={handleShareRefresh}
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
        </AppErrorBoundary>
      </div>
      <StartupOverlay
        startupState={startupState}
        onRetry={handleStartupRetry}
        onChooseAnalysisEnvLocation={() => {
          void handleStartupChooseAnalysisEnvLocation();
        }}
        onPrepareAnalysisEnv={() => {
          void handleStartupPrepareAnalysisEnv();
        }}
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
        themeTransition={themeTransition}
        toast={toast}
        analysisEnvPrompt={analysisEnvPrompt}
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
