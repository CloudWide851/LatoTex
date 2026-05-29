import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppContainerView } from "./components/AppContainerView";
import { useI18n } from "../i18n";
import logoMark from "../assets/branding/logo.svg";
import {
  getLibraryTree,
  gitBranches,
  gitCheckInstalled,
  gitLog,
  gitStatus,
  openProject,
  projectIntegrityStatus,
} from "../shared/api/desktop";
import { SHELL_MIN, type ThemeMode, upsertProject } from "./app-config";
import { useAppEffects } from "./hooks/useAppEffects";
import { buildEditorTab } from "./hooks/useEditorTabs";
import { useAppHandlers } from "./hooks/useAppHandlers";
import { useAppContainerWorkspaceActions } from "./hooks/useAppContainerWorkspaceActions";
import { useAnalysisWorkspace } from "./hooks/useAnalysisWorkspace";
import { isPdfPath } from "../shared/utils/fileKind";
import { useAppContainerState } from "./hooks/useAppContainerState";
import { useUnsavedChangesGuard } from "./hooks/useUnsavedChangesGuard";
import { useSettingsPersistence } from "./hooks/useSettingsPersistence";
import { useAppPanelNodes } from "./hooks/useAppPanelNodes";
import { useAgentSessionController } from "./hooks/useAgentSessionController";
import { useAgentProposalDecorations } from "./hooks/useAgentProposalDecorations";
import { useExplorerGitDecorations } from "./hooks/useExplorerGitDecorations";
import { useTextContentCacheBridge } from "./hooks/useTextContentCacheBridge";
import { useLibraryAnalysisNavigator } from "./hooks/useLibraryAnalysisNavigator";
import { useCompiledPreviewResetOnProjectChange, useTrayLabelSync } from "./hooks/useAppContainerRuntimeEffects";
import { useShareSession } from "./hooks/useShareSession";

type IntegrityIssue = {
  projectId: string;
  missingRequired: string[];
};

export function AppContainer() {
  const { locale, setLocale, t } = useI18n();
  const isTauriRuntime = isTauri();
  const [integrityIssue, setIntegrityIssue] = useState<IntegrityIssue | null>(null);
  const s = useAppContainerState(t);

  const unsaved = useUnsavedChangesGuard({
    selectedFile: s.selectedFile,
    setSelectedFile: s.setSelectedFile,
    setEditorTabs: s.setEditorTabs,
    setActiveTabId: s.setActiveTabId,
    setPreviewTabId: s.setPreviewTabId,
    setDirtyByPath: s.setDirtyByPath,
    setEditorContent: s.setEditorContent,
    setToast: s.setToast,
    editorTabsRef: s.editorTabsRef,
    activeTabIdRef: s.activeTabIdRef,
    previewTabIdRef: s.previewTabIdRef,
    dirtyByPathRef: s.dirtyByPathRef,
    savedContentByPathRef: s.savedContentByPathRef,
    workingContentByPathRef: s.workingContentByPathRef,
    activeProjectIdRef: s.activeProjectIdRef,
  });

  const refreshGitWorkspace = useCallback(
    async (projectIdOverride?: string) => {
      const projectId = projectIdOverride ?? s.activeProjectIdRef.current;
      if (!projectId) {
        return;
      }
      const availability = await gitCheckInstalled().catch(() => ({
        installed: false,
        version: undefined,
      }));
      s.setGitAvailability(availability);
      if (availability.installed) {
        s.setSuppressAutoGitInstall(false);
      }
      if (!availability.installed) {
        s.setGitStatusState({
          isRepo: false,
          branch: "-",
          ahead: 0,
          behind: 0,
          changes: [],
        });
        s.setGitBranchesState([]);
        s.setGitCommits([]);
        return;
      }
      const [state, branches, commits] = await Promise.all([
        gitStatus(projectId),
        gitBranches(projectId).catch(() => []),
        gitLog(projectId, 50).catch(() => []),
      ]);
      s.setGitStatusState(state);
      s.setGitBranchesState(branches);
      s.setGitCommits(commits);
    },
    [
      s.activeProjectIdRef,
      s.setGitAvailability,
      s.setSuppressAutoGitInstall,
      s.setGitStatusState,
      s.setGitBranchesState,
      s.setGitCommits,
    ],
  );

  const loadProjectData = useCallback(
    async (projectId: string) => {
      if (!s.integrityCheckedRef.current.has(projectId)) {
        const integrity = await projectIntegrityStatus(projectId);
        if (integrity.missingRequired.length > 0) {
          setIntegrityIssue({
            projectId,
            missingRequired: integrity.missingRequired,
          });
          return;
        }
        s.integrityCheckedRef.current.add(projectId);
      }
      const snapshot = await openProject(projectId);
      s.setTree(snapshot.tree);
      s.setSelectedFile(snapshot.mainFile);
      const [papers] = await Promise.all([getLibraryTree(projectId)]);
      s.setLibraryTree(papers);
      s.setSelectedLibraryPath(null);
      s.lastLoadedProjectIdRef.current = projectId;
      await refreshGitWorkspace(projectId);
    },
    [
      refreshGitWorkspace,
      s.integrityCheckedRef,
      s.lastLoadedProjectIdRef,
      s.setLibraryTree,
      s.setSelectedFile,
      s.setSelectedLibraryPath,
      s.setTree,
    ],
  );

  const { persistSettings, savePanelLayout, cancelPendingAutoSave } = useSettingsPersistence({
    activeProjectId: s.activeProjectId,
    locale,
    settings: s.settings,
    draftModelApiKeys: s.draftModelApiKeys,
    setSettings: s.setSettings,
    setDraftModelApiKeys: s.setDraftModelApiKeys,
    setToast: s.setToast,
    panelLayoutSaveTimerRef: s.panelLayoutSaveTimerRef,
    pendingPanelLayoutRef: s.pendingPanelLayoutRef,
    autoSaveTimerRef: s.autoSaveTimerRef,
    autoSaveReadyRef: s.autoSaveReadyRef,
    lastAutoSavedHashRef: s.lastAutoSavedHashRef,
  });

  useEffect(
    () => () => {
      if (s.pdfUrl) {
        URL.revokeObjectURL(s.pdfUrl);
      }
      if (s.selectedFilePdfUrl) {
        URL.revokeObjectURL(s.selectedFilePdfUrl);
      }
    },
    [s.pdfUrl, s.selectedFilePdfUrl],
  );

  useTrayLabelSync({ isTauriRuntime, locale, t });
  useCompiledPreviewResetOnProjectChange({
    activeProjectId: s.activeProjectId,
    page: s.page,
    compiledPdfRelativePath: s.compiledPdfRelativePath,
    setPdfUrl: s.setPdfUrl,
    setCompiledPdfRelativePath: s.setCompiledPdfRelativePath,
    setPreferCompiledPreview: s.setPreferCompiledPreview,
  });

  const analysisWorkspace = useAnalysisWorkspace({
    projectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    editorContent: s.editorContent,
    fileList: s.fileList,
    locale,
    events: s.events,
    t,
    setToast: s.setToast,
  });

  const handlers = useAppHandlers({
    isTauriRuntime,
    t,
    locale,
    activeProjectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    fileList: s.fileList,
    editorContent: s.editorContent,
    pdfUrl: s.pdfUrl,
    compiledPdfBytes: s.compiledPdfBytes,
    compiledPdfRelativePath: s.compiledPdfRelativePath,
    agentPrompt: s.agentPrompt,
    windowActionBusy: s.windowActionBusy,
    settings: s.settings,
    projectSearchQuery: s.projectSearchQuery,
    gitDownloadTaskId: s.gitDownloadTaskId,
    gitInstallerLaunched: s.gitInstallerLaunched,
    deleteIntent: s.deleteIntent,
    deleteDontAskAgain: s.deleteDontAskAgain,
    setBusy: s.setBusy,
    setTree: s.setTree,
    setLibraryTree: s.setLibraryTree,
    setSelectedFile: s.setSelectedFile,
    setSelectedLibraryPath: s.setSelectedLibraryPath,
    setEditorContent: s.setEditorContent,
    setProjects: s.setProjects,
    setActiveProjectId: s.setActiveProjectId,
    setSettings: s.setSettings,
    setToast: s.setToast,
    setCompileDiagnostics: s.setCompileDiagnostics,
    setCompileInstallProgress: s.setCompileInstallProgress,
    setLastCompileFailed: s.setLastCompileFailed,
    setPdfUrl: s.setPdfUrl,
    setCompiledPdfBytes: s.setCompiledPdfBytes,
    setCompiledPdfRelativePath: s.setCompiledPdfRelativePath,
    setPreferCompiledPreview: s.setPreferCompiledPreview,
    setAgentMessages: s.setAgentMessages,
    agentProposalsByPath: s.agentProposalsByPath,
    setAgentProposalsByPath: s.setAgentProposalsByPath,
    setAgentPendingAction: s.setAgentPendingAction,
    setAgentRunId: s.setAgentRunId,
    setAgentPrompt: s.setAgentPrompt,
    setAgentCollapsed: s.setAgentCollapsed,
    setAgentPhase: s.setAgentPhase,
    setAgentStatusKey: s.setAgentStatusKey,
    setWindowActionBusy: s.setWindowActionBusy,
    setIsMaximized: s.setIsMaximized,
    setProjectSearchResults: s.setProjectSearchResults,
    setProjectSearchSearched: s.setProjectSearchSearched,
    setProjectSearchBusy: s.setProjectSearchBusy,
    setPage: s.setPage,
    setPendingRevealLine: s.setPendingRevealLine,
    setBusytexCacheInfo: s.setBusytexCacheInfo,
    setDeleteIntent: s.setDeleteIntent,
    setDeleteDontAskAgain: s.setDeleteDontAskAgain,
    setThemeTransition: s.setThemeTransition,
    setGitDownloadTaskId: s.setGitDownloadTaskId,
    setGitDownloadState: s.setGitDownloadState,
    setGitInstallerLaunched: s.setGitInstallerLaunched,
    setSuppressAutoGitInstall: s.setSuppressAutoGitInstall,
    markPathSaved: unsaved.markPathSaved,
    editorRef: s.editorRef,
    loadProjectData,
    persistSettings,
    refreshGitWorkspace,
    setLocale,
    upsertProject,
    runAnalysisFromAgent: analysisWorkspace.runAnalysisWithPrompt,
  });

  const activeAgentProposal = useMemo(
    () => (s.selectedFile ? s.agentProposalsByPath[s.selectedFile] ?? null : null),
    [s.agentProposalsByPath, s.selectedFile],
  );

  useAgentProposalDecorations({
    editorRef: s.editorRef,
    selectedFile: s.selectedFile,
    activeProposal: activeAgentProposal,
  });

  const { getCachedTextContent, handleTextFileLoaded } = useTextContentCacheBridge({
    workingContentByPathRef: s.workingContentByPathRef,
    savedContentByPathRef: s.savedContentByPathRef,
    dirtyByPathRef: s.dirtyByPathRef,
  });

  useAppEffects({
    t,
    isTauriRuntime,
    activeProjectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    fileSet: s.fileSet,
    pendingRevealLine: s.pendingRevealLine,
    page: s.page,
    cursor: s.cursor,
    agentRunId: s.agentRunId,
    analysisRunning: analysisWorkspace.running,
    toast: s.toast,
    gitDownloadTaskId: s.gitDownloadTaskId,
    gitInstallerLaunched: s.gitInstallerLaunched,
    suppressAutoGitInstall: s.suppressAutoGitInstall,
    gitAvailabilityInstalled: s.gitAvailability?.installed,
    settingsTheme: s.settings?.uiPrefs?.theme as ThemeMode | undefined,
    busytexCachePolicy: s.settings?.uiPrefs?.busytexCachePolicy as
      | "install-first"
      | "appdata-only"
      | undefined,
    loadProjectData,
    refreshGitWorkspace,
    handleGitRunInstaller: handlers.handleGitRunInstaller,
    handleGitInstallerDownloadStart: handlers.handleGitInstallerDownloadStart,
    setStatus: s.setStatus,
    setProjects: s.setProjects,
    setSettings: s.setSettings,
    setRuntimeInfo: s.setRuntimeInfo,
    setLocale,
    setActiveProjectId: s.setActiveProjectId,
    setTree: s.setTree,
    setLibraryTree: s.setLibraryTree,
    setSelectedFile: s.setSelectedFile,
    setSelectedLibraryPath: s.setSelectedLibraryPath,
    setEditorContent: s.setEditorContent,
    setSelectedFilePdfUrl: s.setSelectedFilePdfUrl,
    setSelectedImagePreviewUrl: s.setSelectedImagePreviewUrl,
    setPreviewOverridePath: s.setPreviewOverridePath,
    setSelectedTextFileReadyPath: s.setSelectedTextFileReadyPath,
    previewOverridePath: s.previewOverridePath,
    setToast: s.setToast,
    setProjectSearchQuery: s.setProjectSearchQuery,
    setProjectSearchResults: s.setProjectSearchResults,
    setProjectSearchSearched: s.setProjectSearchSearched,
    setEvents: s.setEvents,
    setCursor: s.setCursor,
    setAgentRunId: s.setAgentRunId,
    setAgentPhase: s.setAgentPhase,
    setAgentStatusKey: s.setAgentStatusKey,
    setBusytexCacheInfo: s.setBusytexCacheInfo,
    resizeFrameRef: s.resizeFrameRef,
    setIsMaximized: s.setIsMaximized,
    editorRef: s.editorRef,
    setPendingRevealLine: s.setPendingRevealLine,
    setGitDownloadState: s.setGitDownloadState,
    setGitDownloadTaskId: s.setGitDownloadTaskId,
    setSuppressAutoGitInstall: s.setSuppressAutoGitInstall,
    lastLoadedProjectIdRef: s.lastLoadedProjectIdRef,
    getCachedTextContent,
    onTextFileLoaded: handleTextFileLoaded,
  });

  useEffect(() => {
    if (!s.selectedFile || isPdfPath(s.selectedFile)) {
      return;
    }
    s.workingContentByPathRef.current[s.selectedFile] = s.editorContent;
    const saved = s.savedContentByPathRef.current[s.selectedFile];
    if (typeof saved === "string") {
      const dirty = s.editorContent !== saved;
      s.setDirtyByPath((prev) => {
        const wasDirty = Boolean(prev[s.selectedFile!]);
        if (dirty === wasDirty) {
          return prev;
        }
        const next = { ...prev };
        if (dirty) {
          next[s.selectedFile!] = true;
        } else {
          delete next[s.selectedFile!];
        }
        return next;
      });
    }
  }, [
    s.editorContent,
    s.savedContentByPathRef,
    s.selectedFile,
    s.setDirtyByPath,
    s.workingContentByPathRef,
  ]);

  const workspaceActions = useAppContainerWorkspaceActions({
    selectedFile: s.selectedFile,
    editorContent: s.editorContent,
    markPathSaved: unsaved.markPathSaved,
    handleSaveFile: handlers.handleSaveFile,
    handleWindowControl: handlers.handleWindowControl,
    requestUnsavedGuard: unsaved.requestUnsavedGuard,
    editorTabsRef: s.editorTabsRef,
    allowNextWindowCloseRef: s.closeGuardUnlockedRef,
    handleInitProjectFromFolder: handlers.handleInitProjectFromFolder,
    resetEditorSession: unsaved.resetEditorSession,
    handleEditorUndo: handlers.handleEditorUndo,
    handleEditorRedo: handlers.handleEditorRedo,
    handleCompile: handlers.handleCompile,
    handleExportCompiledPdf: handlers.handleExportCompiledPdf,
    isTauriRuntime,
    collectDirtyPaths: unsaved.collectDirtyPaths,
    setEditorTabs: s.setEditorTabs,
    setPreferCompiledPreview: s.setPreferCompiledPreview,
    previewTabIdRef: s.previewTabIdRef,
    setPreviewTabId: s.setPreviewTabId,
    setPreviewOverridePath: s.setPreviewOverridePath,
    closeTabsNow: unsaved.closeTabsNow,
    dirtyByPathRef: s.dirtyByPathRef,
    fileSet: s.fileSet,
    activeTabIdRef: s.activeTabIdRef,
    setActiveTabId: s.setActiveTabId,
    buildEditorTab,
    setSelectedFile: s.setSelectedFile,
    activeProjectIdRef: s.activeProjectIdRef,
    integrityCheckedRef: s.integrityCheckedRef,
    integrityIssue,
    setIntegrityIssue,
    setToast: s.setToast,
    setActiveProjectId: s.setActiveProjectId,
    loadProjectData,
    setBusy: s.setBusy,
    t,
    lastLoadedProjectIdRef: s.lastLoadedProjectIdRef,
    activeProjectId: s.activeProjectId,
    settings: s.settings,
    setModelTestById: s.setModelTestById,
    setModelTestActiveId: s.setModelTestActiveId,
    setModelTestBusy: s.setModelTestBusy,
    persistSettings,
    cancelPendingAutoSave,
    setSettings: s.setSettings,
    setDraftModelApiKeys: s.setDraftModelApiKeys,
    setModelModalMode: s.setModelModalMode,
    setModelModalInitial: s.setModelModalInitial,
    setModelModalOpen: s.setModelModalOpen,
  });

  const agentSession = useAgentSessionController({
    activeProjectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    agentPrompt: s.agentPrompt,
    agentPhase: s.agentPhase,
    agentRunId: s.agentRunId,
    agentMessages: s.agentMessages,
    setAgentMessages: s.setAgentMessages,
    setAgentPrompt: s.setAgentPrompt,
    setAgentRunId: s.setAgentRunId,
    setAgentPhase: s.setAgentPhase,
    setAgentStatusKey: s.setAgentStatusKey,
    setPage: s.setPage,
    setSelectedFile: s.setSelectedFile,
    setToast: s.setToast,
    runTaskAgent: handlers.handleRunAgent,
    t,
  });

  const explorerGitDecorations = useExplorerGitDecorations(s.gitStatusState?.changes);
  const shareSession = useShareSession({
    activeProjectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    editorContent: s.editorContent,
    compiledPdfUrl: s.pdfUrl,
    setEditorContent: s.setEditorContent,
    onCompile: async () => {
      await handlers.handleCompile();
    },
    setToast: (value) => {
      if (value) {
        s.setToast(value);
      }
    },
    t,
  });

  const panels = useAppPanelNodes({
    settings: s.settings,
    locale,
    page: s.page,
    t,
    busy: s.busy,
    activeProjectId: s.activeProjectId,
    settingsSection: s.settingsSection,
    setSettingsSection: s.setSettingsSection,
    busytexCacheInfo: s.busytexCacheInfo,
    runtimeInfo: s.runtimeInfo,
    runtimeLogs: s.runtimeLogs,
    runtimeLogLoading: s.runtimeLogLoading,
    modelTestBusy: s.modelTestBusy,
    modelTestActiveId: s.modelTestActiveId,
    modelTestById: s.modelTestById,
    handleLocaleChange: handlers.handleLocaleChange,
    handleThemeModeChange: handlers.handleThemeModeChange,
    handleBusyTexCachePolicyChange: handlers.handleBusyTexCachePolicyChange,
    openModelModal: workspaceActions.openModelModal,
    setRuntimeLogLoading: s.setRuntimeLogLoading,
    setRuntimeLogs: s.setRuntimeLogs,
    setToast: s.setToast,
    handleTestModel: workspaceActions.handleTestModel,
    handleTestAllModels: workspaceActions.handleTestAllModels,
    setSettings: s.setSettings,
    analysisWorkspace,
    gitStatusState: s.gitStatusState,
    gitBranchesState: s.gitBranchesState,
    gitCommits: s.gitCommits,
    gitAvailability: s.gitAvailability,
    gitDownloadState: s.gitDownloadState,
    gitInitProgress: s.gitInitProgress,
    refreshGitWorkspace,
    handleGitAction: handlers.handleGitAction,
    handleGenerateGitSummary: workspaceActions.handleGenerateGitSummary,
    setBusy: s.setBusy,
    setGitInitProgress: s.setGitInitProgress,
    handleGitInstallerDownloadStart: handlers.handleGitInstallerDownloadStart,
    handleGitInstallerCancel: handlers.handleGitInstallerCancel,
    handleGitRunInstaller: handlers.handleGitRunInstaller,
    openWorkspaceFile: workspaceActions.openWorkspaceFile,
    resetEditorSession: unsaved.resetEditorSession,
    compileDiagnostics: s.compileDiagnostics,
    lastCompileFailed: s.lastCompileFailed,
  });
  const handleLibraryAnalyzePaper = useLibraryAnalysisNavigator({
    setPage: s.setPage,
    runPaperAnalysisFromLibrary: analysisWorkspace.runPaperAnalysisFromLibrary,
    analysisRunning: analysisWorkspace.running,
  });

  return (
    <AppContainerView
      windowActionBusy={s.windowActionBusy}
      status={s.status}
      logoMark={logoMark}
      projects={s.projects}
      activeProjectId={s.activeProjectId}
      busy={s.busy}
      isTauriRuntime={isTauriRuntime}
      isMaximized={s.isMaximized}
      projectSearchQuery={s.projectSearchQuery}
      projectSearchBusy={s.projectSearchBusy}
      projectSearchSearched={s.projectSearchSearched}
      projectSearchResults={s.projectSearchResults}
      handleProjectChange={workspaceActions.handleProjectChange}
      setProjectSearchQuery={s.setProjectSearchQuery}
      handleProjectSearch={handlers.handleProjectSearch}
      handleProjectSearchSelect={handlers.handleProjectSearchSelect}
      setProjectSearchResults={s.setProjectSearchResults}
      setProjectSearchSearched={s.setProjectSearchSearched}
      handleInitProjectFromFolderWithGuard={workspaceActions.handleInitProjectFromFolderWithGuard}
      handleWindowControlWithGuard={workspaceActions.handleWindowControlWithGuard}
      shareSession={shareSession.shareSession}
      shareBusy={shareSession.shareBusy}
      shareSyncing={shareSession.shareSyncing}
      handleShareStart={shareSession.startShare}
      handleShareStop={shareSession.stopShare}
      handleShareRefresh={shareSession.refreshShareStatus}
      t={t}
      recoverWorkspaceLayout={panels.recoverWorkspaceLayout}
      page={s.page}
      pageRailItems={s.pageRailItems}
      shellLayout={panels.shellLayout}
      latexLayout={panels.latexLayout}
      analysisLayout={panels.analysisLayout}
      libraryLayout={panels.libraryLayout}
      settings={s.settings}
      tree={s.tree}
      libraryTree={s.libraryTree}
      selectedFile={s.selectedFile}
      selectedLibraryPath={s.selectedLibraryPath}
      fileList={s.fileList}
      editorContent={s.editorContent}
      editorTabs={s.editorTabs}
      activeTabId={s.activeTabId}
      dirtyByPath={s.dirtyByPath}
      pdfUrl={s.pdfUrl}
      preferCompiledPreview={s.preferCompiledPreview}
      selectedFilePdfUrl={s.selectedFilePdfUrl}
      compileErrorLine={panels.compileErrorLine}
      compileDiagnostics={s.compileDiagnostics}
      agentCollapsed={s.agentCollapsed}
      agentPhase={s.agentPhase}
      agentStatusKey={s.agentStatusKey}
      agentPrompt={s.agentPrompt}
      agentMessages={s.agentMessages}
      agentProposal={activeAgentProposal}
      agentRunId={s.agentRunId}
      agentSessions={agentSession.agentSessions}
      agentSessionPickerOpen={agentSession.agentSessionPickerOpen}
      agentSessionPickerIndex={agentSession.agentSessionPickerIndex}
      agentRollbackVisible={agentSession.agentRollbackVisible}
      explorerGitDecorations={explorerGitDecorations}
      SHELL_MIN={SHELL_MIN}
      settingsPanel={panels.settingsPanel}
      gitPanel={panels.gitPanel}
      analysisPanel={panels.analysisPanel}
      setPage={s.setPage}
      handleSelectWorkspacePath={workspaceActions.handleSelectWorkspacePath}
      setSelectedLibraryPath={s.setSelectedLibraryPath}
      setEditorContent={s.setEditorContent}
      handleTabSelect={workspaceActions.handleTabSelect}
      handleTabClose={workspaceActions.handleTabClose}
      handleTabCloseAction={workspaceActions.handleTabCloseAction}
      handleTabPin={workspaceActions.handleTabPin}
      editorRef={s.editorRef}
      setAgentPrompt={s.setAgentPrompt}
      setAgentCollapsed={s.setAgentCollapsed}
      handleRunAgent={agentSession.handleAgentRun}
      setAgentSessionPickerOpen={agentSession.setAgentSessionPickerOpen}
      setAgentSessionPickerIndex={agentSession.setAgentSessionPickerIndex}
      handleAgentSessionConfirm={agentSession.handleAgentSessionConfirm}
      handleAgentRollback={agentSession.handleAgentRollback}
      handleAcceptAgentProposal={handlers.handleAcceptAgentProposal}
      handleRejectAgentProposal={handlers.handleRejectAgentProposal}
      handleSaveActiveFile={workspaceActions.handleSaveActiveFile}
      handleCompile={handlers.handleCompile}
      handleExportCompiledPdf={handlers.handleExportCompiledPdf}
      handleEditorUndo={handlers.handleEditorUndo}
      handleEditorRedo={handlers.handleEditorRedo}
      setLogsTab={s.setLogsTab}
      setOverlay={s.setOverlay}
      handleLibraryRescan={handlers.handleLibraryRescan}
      handleLibraryImportPdf={handlers.handleLibraryImportPdf}
      handleLibraryImportLink={handlers.handleLibraryImportLink}
      handleLibraryAnalyzePaper={handleLibraryAnalyzePaper}
      analysisRunning={analysisWorkspace.running}
      handleWorkspaceRevealInSystem={handlers.handleWorkspaceRevealInSystem}
      handleWorkspaceOpenTerminal={handlers.handleWorkspaceOpenTerminal}
      savePanelLayout={savePanelLayout}
      requestFsAction={handlers.requestFsAction}
      overlay={s.overlay}
      logsTab={s.logsTab}
      events={s.events}
      modelModalOpen={s.modelModalOpen}
      modelModalMode={s.modelModalMode}
      modelModalInitial={s.modelModalInitial}
      deleteIntent={s.deleteIntent}
      deleteDontAskAgain={s.deleteDontAskAgain}
      integrityIssue={integrityIssue}
      themeTransition={s.themeTransition}
      toast={s.toast}
      setModelModalOpen={s.setModelModalOpen}
      setModelModalInitial={s.setModelModalInitial}
      setModelModalMode={s.setModelModalMode}
      handleModelModalSubmit={workspaceActions.handleModelModalSubmit}
      handleProtocolPing={handlers.handleProtocolPing}
      handleGetModelApiKey={workspaceActions.handleGetModelApiKey}
      setDeleteIntent={s.setDeleteIntent}
      confirmDelete={handlers.confirmDelete}
      setDeleteDontAskAgain={s.setDeleteDontAskAgain}
      handleIntegrityCancel={workspaceActions.handleIntegrityCancel}
      handleIntegrityRepair={workspaceActions.handleIntegrityRepair}
      unsavedDialogOpen={unsaved.unsavedDialogOpen}
      unsavedDialogIntent={unsaved.unsavedDialogIntent}
      unsavedDialogItems={unsaved.unsavedDialogItems}
      unsavedDialogBusy={unsaved.unsavedDialogBusy}
      handleUnsavedDialogSaveAndContinue={unsaved.handleUnsavedDialogSaveAndContinue}
      handleUnsavedDialogDiscardAndContinue={unsaved.handleUnsavedDialogDiscardAndContinue}
      handleUnsavedDialogCancel={unsaved.handleUnsavedDialogCancel}
    />
  );
}
