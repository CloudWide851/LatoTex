import { Suspense, lazy } from "react";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AppOverlays } from "./AppOverlays";
import { AppTopbar } from "./AppTopbar";
import { UnsavedChangesDialog } from "./editor/UnsavedChangesDialog";

const AppWorkspaceShell = lazy(async () => {
  const module = await import("./AppWorkspaceShell");
  return { default: module.AppWorkspaceShell };
});

export function AppContainerView(props: any) {
  const {
    windowActionBusy,
    status,
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
    compileErrorLine,
    compileDiagnostics,
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
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
    setLogsTab,
    setOverlay,
    handleLibraryRescan,
    handleLibraryImportPdf,
    handleLibraryImportLink,
    handleLibraryAnalyzePaper,
    analysisRunning,
    handleWorkspaceRevealInSystem,
    handleWorkspaceOpenTerminal,
    savePanelLayout,
    requestFsAction,
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
  } = props;
  const completionModelId =
    settings?.agentBindings?.find((item: { role: string; modelId: string }) => item.role === "completion")
      ?.modelId ?? null;

  return (
    <div
      className={`relative isolate flex h-screen w-screen flex-col overflow-hidden bg-slate-100 ${windowActionBusy ? "suppress-motion" : ""}`}
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
              pageRailItems={pageRailItems}
              activeProjectId={activeProjectId}
              busy={busy}
              shellLayout={shellLayout}
              latexLayout={latexLayout}
              analysisLayout={analysisLayout}
              libraryLayout={libraryLayout}
              previewDefaultZoom={settings?.uiPrefs?.previewDefaultZoom ?? 1}
              completionModelId={completionModelId}
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
              compileErrorLine={compileErrorLine}
              compileDiagnostics={compileDiagnostics}
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
              onLibraryAnalyzePaper={handleLibraryAnalyzePaper}
              analysisRunning={analysisRunning}
              onWorkspaceRevealInSystem={handleWorkspaceRevealInSystem}
              onWorkspaceOpenTerminal={handleWorkspaceOpenTerminal}
              onSavePanelLayout={(panel, layout) => savePanelLayout(panel, layout)}
              onFsAction={(scope, action, path, targetPath, content) =>
                requestFsAction(scope, action, path, targetPath, content)
              }
              t={t}
            />
          </Suspense>
        </AppErrorBoundary>
      </div>

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
