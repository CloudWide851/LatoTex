import { useAppEffects } from "./useAppEffects";
import { useEditorDirtySyncEffect } from "./useEditorDirtySyncEffect";
import { useRuntimeMemoryGuard } from "./useRuntimeMemoryGuard";
import type { useAppContainerState } from "./useAppContainerState";
import type { useWorkbenchRuntimeState } from "./useWorkbenchRuntimeState";

type AppContainerState = ReturnType<typeof useAppContainerState>;
type WorkbenchRuntimeState = ReturnType<typeof useWorkbenchRuntimeState>;
type TranslationFn = (...args: any[]) => string;

export function useWorkbenchRuntimeEffects(params: {
  s: AppContainerState;
  runtime: WorkbenchRuntimeState;
  t: TranslationFn;
  isTauriRuntime: boolean;
  loadProjectData: (projectId: string, options?: { includeGitRefresh?: boolean }) => Promise<void>;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  handleGitRunInstaller: () => Promise<void>;
}) {
  const { s, runtime, t, isTauriRuntime, loadProjectData, refreshGitWorkspace, handleGitRunInstaller } = params;

  useAppEffects({
    t,
    isTauriRuntime,
    activeProjectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    pendingRevealLine: s.pendingRevealLine,
    page: s.page,
    cursor: s.cursor,
    agentRunId: s.agentRunId,
    analysisRunning: runtime.analysisWorkspace.running,
    toast: s.toast,
    gitDownloadTaskId: s.gitDownloadTaskId,
    gitInstallerLaunched: s.gitInstallerLaunched,
    settingsTheme: s.settings?.uiPrefs?.theme,
    loadProjectData,
    lastLoadedProjectIdRef: s.lastLoadedProjectIdRef,
    refreshGitWorkspace,
    handleGitRunInstaller,
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
    getCachedTextContent: runtime.getCachedTextContent,
    onTextFileLoaded: runtime.handleTextFileLoaded,
    suspended: runtime.idleSleep.sleeping,
    onOutOfMemory: runtime.handleOutOfMemorySleep,
  });

  useRuntimeMemoryGuard({
    isTauriRuntime,
    setEvents: s.setEvents,
    suspended: runtime.idleSleep.sleeping,
    onCriticalMemory: () => runtime.handleOutOfMemorySleep("memory_guard", "runtime memory critical"),
  });

  useEditorDirtySyncEffect({
    selectedFile: s.selectedFile,
    selectedTextFileReadyPath: s.selectedTextFileReadyPath,
    editorContent: s.editorContent,
    savedContentByPathRef: s.savedContentByPathRef,
    workingContentByPathRef: s.workingContentByPathRef,
    setDirtyByPath: s.setDirtyByPath,
  });
}
