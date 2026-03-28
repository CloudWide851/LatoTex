import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppContainerView } from "./components/AppContainerView";
import { useI18n } from "../i18n";
import logoMark from "../assets/branding/logo.svg";
import { SHELL_MIN, type ThemeMode, upsertProject } from "./app-config";
import { useAppEffects } from "./hooks/useAppEffects";
import { buildEditorTab } from "./hooks/useEditorTabs";
import { useNativeWindowCloseBridge } from "./hooks/windowCloseRequest";
import { useAppHandlers } from "./hooks/useAppHandlers";
import { useAppContainerWorkspaceActions } from "./hooks/useAppContainerWorkspaceActions";
import { useAnalysisWorkspace } from "./hooks/useAnalysisWorkspace";
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
import { useEditorDirtySyncEffect } from "./hooks/useEditorDirtySyncEffect";
import { useProjectDataLoader, type ProjectIntegrityIssue } from "./hooks/useProjectDataLoader";
import { useRuntimeMemoryGuard } from "./hooks/useRuntimeMemoryGuard";
import { useIdleSleep } from "./hooks/useIdleSleep";
import { useRuntimePressureRelief } from "./hooks/useRuntimePressureRelief";
import { useAnalysisEnvPrompt } from "./hooks/useAnalysisEnvPrompt";
import { readFile } from "../shared/api/workspace";
import { isExcelPath, isImagePath, isPdfPath } from "../shared/utils/fileKind";
export function AppContainer() {
  const { locale, setLocale, t } = useI18n();
  const isTauriRuntime = isTauri();
  const [integrityIssue, setIntegrityIssue] = useState<ProjectIntegrityIssue | null>(null);
  const [closeBehaviorDialogOpen, setCloseBehaviorDialogOpen] = useState(false);
  const [closeBehaviorRememberChoice, setCloseBehaviorRememberChoice] = useState(false);
  const [closeDecisionBusy, setCloseDecisionBusy] = useState(false);
  const s = useAppContainerState(t);
  const { allowNextWindowCloseRef, requestNativeWindowClose } = useNativeWindowCloseBridge(isTauriRuntime);
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
  const { refreshGitWorkspace, loadProjectData } = useProjectDataLoader({
    page: s.page,
    activeProjectIdRef: s.activeProjectIdRef,
    integrityCheckedRef: s.integrityCheckedRef,
    lastLoadedProjectIdRef: s.lastLoadedProjectIdRef,
    loadedLibraryProjectIdRef: s.loadedLibraryProjectIdRef,
    settingsRef: s.settingsRef,
    setIntegrityIssue,
    setGitAvailability: s.setGitAvailability,
    setGitStatusState: s.setGitStatusState,
    setGitBranchesState: s.setGitBranchesState,
    setGitCommits: s.setGitCommits,
    setTree: s.setTree,
    setSelectedFile: s.setSelectedFile,
    setLibraryTree: s.setLibraryTree,
    setSelectedLibraryPath: s.setSelectedLibraryPath,
    setSuppressAutoGitInstall: s.setSuppressAutoGitInstall,
  });
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
      if (s.pdfUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(s.pdfUrl);
      }
      if (s.selectedFilePdfUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(s.selectedFilePdfUrl);
      }
      if (s.selectedImagePreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(s.selectedImagePreviewUrl);
      }
    },
    [s.pdfUrl, s.selectedFilePdfUrl, s.selectedImagePreviewUrl],
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
  const runtimeBusy = s.busy || Boolean(s.agentRunId) || Boolean(s.gitDownloadTaskId);
  const idleSleep = useIdleSleep({
    blocked: runtimeBusy,
    timeoutMs: 60 * 60 * 1000,
  });
  const analysisWorkspace = useAnalysisWorkspace({
    projectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    editorContent: s.editorContent,
    fileList: s.fileList,
    locale,
    analysisModelOverride: s.settings?.uiPrefs?.featureModelBindings?.analysisAgentModelId ?? null,
    suspended: idleSleep.sleeping,
    events: s.events,
    t,
    setToast: s.setToast,
  });
  const analysisEnvPrompt = useAnalysisEnvPrompt({
    activeProjectId: s.activeProjectId,
    settings: s.settings,
    persistSettings,
    t,
    setToast: s.setToast,
  });
  const resolveSelectedFileContent = useCallback(async (): Promise<string | null> => {
    const selectedPath = s.selectedFile;
    if (!s.activeProjectId || !selectedPath) {
      return null;
    }
    if (isPdfPath(selectedPath) || isExcelPath(selectedPath) || isImagePath(selectedPath)) {
      return null;
    }
    if (s.selectedTextFileReadyPath === selectedPath) {
      return s.editorContent;
    }
    const workingContent = s.workingContentByPathRef.current[selectedPath];
    if (typeof workingContent === "string") {
      return workingContent;
    }
    const savedContent = s.savedContentByPathRef.current[selectedPath];
    if (typeof savedContent === "string") {
      return savedContent;
    }
    const loaded = await readFile(s.activeProjectId, selectedPath);
    return loaded.content ?? "";
  }, [s.activeProjectId, s.editorContent, s.selectedFile, s.selectedTextFileReadyPath, s.savedContentByPathRef, s.workingContentByPathRef]);
  const handlers = useAppHandlers({
    isTauriRuntime,
    t,
    locale,
    activeProjectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    fileList: s.fileList,
    editorContent: s.editorContent,
    resolveSelectedFileContent,
    pdfUrl: s.pdfUrl,
    compiledPdfRelativePath: s.compiledPdfRelativePath,
    agentPrompt: s.agentPrompt,
    settings: s.settings,
    projectSearchQuery: s.projectSearchQuery,
    gitDownloadTaskId: s.gitDownloadTaskId,
    gitInstallerLaunched: s.gitInstallerLaunched,
    deleteIntent: s.deleteIntent,
    deleteDontAskAgain: s.deleteDontAskAgain,
    requestCloseBehaviorDecision: () => {
      setCloseBehaviorRememberChoice(false);
      setCloseDecisionBusy(false);
      setCloseBehaviorDialogOpen(true);
    },
    requestNativeWindowClose,
    setCloseDecisionBusy,
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
    setProjectSearchResults: s.setProjectSearchResults,
    setProjectSearchSearched: s.setProjectSearchSearched,
    setProjectSearchBusy: s.setProjectSearchBusy,
    setPage: s.setPage,
    setPendingRevealLine: s.setPendingRevealLine,
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
  const activeAgentProposal = useMemo(() => (s.selectedFile ? s.agentProposalsByPath[s.selectedFile] ?? null : null), [s.agentProposalsByPath, s.selectedFile]);
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
  const runtimePressureRelief = useRuntimePressureRelief({
    sleeping: idleSleep.sleeping,
    pdfUrl: s.pdfUrl,
    selectedFilePdfUrl: s.selectedFilePdfUrl,
    selectedImagePreviewUrl: s.selectedImagePreviewUrl,
    setPdfUrl: s.setPdfUrl,
    setSelectedFilePdfUrl: s.setSelectedFilePdfUrl,
    setSelectedImagePreviewUrl: s.setSelectedImagePreviewUrl,
    setEvents: s.setEvents,
  });
  const oomSleepAtRef = useRef(0);
  const handleOutOfMemorySleep = useCallback((_source: "error" | "unhandledrejection" | "memory_guard", _message: string) => {
    const now = Date.now();
    if (now - oomSleepAtRef.current < 5_000) {
      return;
    }
    oomSleepAtRef.current = now;
    runtimePressureRelief.release("oom");
    idleSleep.forceSleep();
  }, [idleSleep.forceSleep, runtimePressureRelief]);
  useAppEffects({
    t,
    isTauriRuntime,
    activeProjectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    pendingRevealLine: s.pendingRevealLine,
    page: s.page,
    cursor: s.cursor,
    agentRunId: s.agentRunId,
    analysisRunning: analysisWorkspace.running,
    toast: s.toast,
    gitDownloadTaskId: s.gitDownloadTaskId,
    gitInstallerLaunched: s.gitInstallerLaunched,
    settingsTheme: s.settings?.uiPrefs?.theme as ThemeMode | undefined,
    loadProjectData,
    refreshGitWorkspace,
    handleGitRunInstaller: handlers.handleGitRunInstaller,
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
    resizeFrameRef: s.resizeFrameRef,
    setIsMaximized: s.setIsMaximized,
    editorRef: s.editorRef,
    setPendingRevealLine: s.setPendingRevealLine,
    setGitDownloadState: s.setGitDownloadState,
    setGitDownloadTaskId: s.setGitDownloadTaskId,
    getCachedTextContent,
    onTextFileLoaded: handleTextFileLoaded,
    suspended: idleSleep.sleeping,
    onOutOfMemory: handleOutOfMemorySleep,
  });
  useRuntimeMemoryGuard({
    isTauriRuntime,
    setEvents: s.setEvents,
    suspended: idleSleep.sleeping,
    onCriticalMemory: () => handleOutOfMemorySleep("memory_guard", "runtime memory critical"),
  });
  useEditorDirtySyncEffect({
    selectedFile: s.selectedFile,
    selectedTextFileReadyPath: s.selectedTextFileReadyPath,
    editorContent: s.editorContent,
    savedContentByPathRef: s.savedContentByPathRef,
    workingContentByPathRef: s.workingContentByPathRef,
    setDirtyByPath: s.setDirtyByPath,
  });

  const handleLibraryViewModeChange = useCallback((mode: "bib" | "pdf" | "compare") => {
    const projectId = s.activeProjectId;
    if (!projectId) {
      return;
    }
    s.setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      const currentMap = prev.uiPrefs?.libraryViewModeByProject ?? {};
      if (currentMap[projectId] === mode) {
        return prev;
      }
      return {
        ...prev,
        uiPrefs: {
          ...(prev.uiPrefs ?? {}),
          language: prev.uiPrefs?.language,
          libraryViewModeByProject: {
            ...currentMap,
            [projectId]: mode,
          },
        },
      };
    });
  }, [s.activeProjectId, s.setSettings]);

  const workspaceActions = useAppContainerWorkspaceActions({
    selectedFile: s.selectedFile,
    editorContent: s.editorContent,
    markPathSaved: unsaved.markPathSaved,
    handleSaveFile: handlers.handleSaveFile,
    handleWindowControl: handlers.handleWindowControl,
    requestUnsavedGuard: unsaved.requestUnsavedGuard,
    editorTabsRef: s.editorTabsRef,
    allowNextWindowCloseRef,
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
    closeTabsNow: unsaved.closeTabsNow,
    dirtyByPathRef: s.dirtyByPathRef,
    fileSet: s.fileSet,
    activeTabIdRef: s.activeTabIdRef,
    setActiveTabId: s.setActiveTabId,
    buildEditorTab,
    setSelectedFile: s.setSelectedFile,
    setPreviewOverridePath: s.setPreviewOverridePath,
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
    suspended: idleSleep.sleeping,
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
    onCompile: handlers.handleCompile,
    setToast: (value) => {
      if (value) {
        s.setToast(value);
      }
    },
    t,
    suspended: idleSleep.sleeping,
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
    runtimeInfo: s.runtimeInfo,
    runtimeLogs: s.runtimeLogs,
    runtimeLogLoading: s.runtimeLogLoading,
    modelTestBusy: s.modelTestBusy,
    modelTestActiveId: s.modelTestActiveId,
    modelTestById: s.modelTestById,
    handleLocaleChange: handlers.handleLocaleChange,
    handleThemeModeChange: handlers.handleThemeModeChange,
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
    handleGitInstallerCancel: handlers.handleGitInstallerCancel,
    handleGitRunInstaller: handlers.handleGitRunInstaller,
    openWorkspaceFile: workspaceActions.openWorkspaceFile,
    compileDiagnostics: s.compileDiagnostics,
    lastCompileFailed: s.lastCompileFailed,
  });
  const handleLibraryAnalyzePaper = useLibraryAnalysisNavigator({
    setPage: s.setPage,
    runPaperAnalysisFromLibrary: analysisWorkspace.runPaperAnalysisFromLibrary,
    analysisRunning: analysisWorkspace.running,
  });
  const handleCloseBehaviorDialogCancel = useCallback(() => {
    setCloseBehaviorDialogOpen(false);
    setCloseDecisionBusy(false);
    setCloseBehaviorRememberChoice(false);
  }, []);
  const handleCloseBehaviorDialogResolve = useCallback((behavior: "tray" | "exit") => {
    if (closeDecisionBusy) {
      return;
    }
    setCloseBehaviorDialogOpen(false);
    void handlers.handleWindowCloseDecision(behavior, closeBehaviorRememberChoice);
  }, [closeBehaviorRememberChoice, closeDecisionBusy, handlers]);
  return (
    <AppContainerView
      status={s.status}
      sleeping={idleSleep.sleeping}
      onWakeFromSleep={idleSleep.wake}
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
      shareComments={shareSession.shareComments}
      shareMode={shareSession.shareMode}
      shareSessionName={shareSession.shareSessionName}
      handleShareModeChange={(mode: "local" | "remote") => shareSession.setShareMode(mode)}
      handleShareSessionNameChange={(value: string) => shareSession.setShareSessionName(value)}
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
      selectedImagePreviewUrl={s.selectedImagePreviewUrl}
      previewOverridePath={s.previewOverridePath}
      compileErrorLine={panels.compileErrorLine}
      compileDiagnostics={s.compileDiagnostics}
      compileInstallProgress={s.compileInstallProgress}
      agentCollapsed={s.agentCollapsed}
      agentPhase={s.agentPhase}
      agentStatusKey={s.agentStatusKey}
      agentPrompt={s.agentPrompt}
      agentMessages={s.agentMessages}
      agentProposal={activeAgentProposal}
      agentPendingAction={s.agentPendingAction}
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
      handleResolveAgentPendingAction={handlers.handleResolveAgentPendingAction}
      handleSaveActiveFile={workspaceActions.handleSaveActiveFile}
      handleWriteSelectedFileContent={handlers.handleWriteSelectedFileContent}
      handleCompile={handlers.handleCompile}
      handleExportCompiledPdf={handlers.handleExportCompiledPdf}
      handleEditorUndo={handlers.handleEditorUndo}
      handleEditorRedo={handlers.handleEditorRedo}
      setLogsTab={s.setLogsTab}
      setOverlay={s.setOverlay}
      handleLibraryRescan={handlers.handleLibraryRescan}
      handleLibraryImportPdf={handlers.handleLibraryImportPdf}
      handleLibraryImportLink={handlers.handleLibraryImportLink}
      handleLibrarySyncZotero={handlers.handleLibrarySyncZotero}
      handleLibraryAnalyzePaper={handleLibraryAnalyzePaper}
      analysisRunning={analysisWorkspace.running}
      libraryViewMode={s.activeProjectId ? (s.settings?.uiPrefs?.libraryViewModeByProject?.[s.activeProjectId] ?? null) : null}
      handleLibraryViewModeChange={handleLibraryViewModeChange}
      handleWorkspaceRevealInSystem={handlers.handleWorkspaceRevealInSystem}
      handleWorkspaceOpenTerminal={handlers.handleWorkspaceOpenTerminal}
      handleWorkspaceRescan={handlers.handleWorkspaceRescan}
      savePanelLayout={savePanelLayout}
      requestFsAction={handlers.requestFsAction}
      runFsAction={handlers.runFsAction}
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
      analysisEnvPrompt={analysisEnvPrompt}
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
      closeBehaviorDialogOpen={closeBehaviorDialogOpen}
      closeBehaviorRememberChoice={closeBehaviorRememberChoice}
      closeBehaviorDialogBusy={closeDecisionBusy}
      setCloseBehaviorRememberChoice={setCloseBehaviorRememberChoice}
      handleCloseBehaviorDialogCancel={handleCloseBehaviorDialogCancel}
      handleCloseBehaviorDialogResolve={handleCloseBehaviorDialogResolve}
      suspended={idleSleep.sleeping}
    />
  );
}
