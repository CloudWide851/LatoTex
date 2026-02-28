import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  runAgentCancel,
  setTrayLabels,
} from "../shared/api/desktop";
import type { ResourceNode } from "../shared/types/app";
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
import { parseAgentPrompt } from "./hooks/agentCommands";
import {
  appendDailyMemoryPrompt,
  createNewFileSession,
  ensureCurrentFileSession,
  ensureProjectMemoryDocument,
  loadSessionMessages,
  resumeFileSession,
  saveSessionMessages,
} from "./hooks/agentMemoryStore";
import type { AgentRunRollback, AgentSessionSummary } from "./hooks/agentTypes";

type IntegrityIssue = {
  projectId: string;
  missingRequired: string[];
};

export function AppContainer() {
  const { locale, setLocale, t } = useI18n();
  const isTauriRuntime = isTauri();
  const [integrityIssue, setIntegrityIssue] = useState<IntegrityIssue | null>(null);
  const s = useAppContainerState(t);
  const [agentSessions, setAgentSessions] = useState<AgentSessionSummary[]>([]);
  const [agentCurrentSessionId, setAgentCurrentSessionId] = useState<string | null>(null);
  const [agentSessionPickerOpen, setAgentSessionPickerOpen] = useState(false);
  const [agentSessionPickerIndex, setAgentSessionPickerIndex] = useState(0);
  const [agentRollback, setAgentRollback] = useState<AgentRunRollback | null>(null);
  const [agentRollbackVisible, setAgentRollbackVisible] = useState(false);
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (s.pdfUrl) {
        URL.revokeObjectURL(s.pdfUrl);
      }
    };
  }, [s.pdfUrl]);

  useEffect(() => {
    return () => {
      if (s.selectedFilePdfUrl) {
        URL.revokeObjectURL(s.selectedFilePdfUrl);
      }
    };
  }, [s.selectedFilePdfUrl]);

  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }
    setTrayLabels(t("tray.showMain"), t("tray.exit"), t("tray.tooltip")).catch(() => undefined);
  }, [isTauriRuntime, locale, t]);

  useEffect(() => {
    let disposed = false;
    const projectId = s.activeProjectId;
    const filePath = s.selectedFile;
    if (!projectId || !filePath) {
      setAgentSessions([]);
      setAgentCurrentSessionId(null);
      setAgentSessionPickerOpen(false);
      setAgentRollbackVisible(false);
      return () => {
        disposed = true;
      };
    }
    void (async () => {
      try {
        const prepared = await ensureCurrentFileSession(projectId, filePath);
        if (disposed) {
          return;
        }
        setAgentSessions(prepared.sessions);
        setAgentCurrentSessionId(prepared.currentSessionId);
        const messages = await loadSessionMessages(projectId, filePath, prepared.currentSessionId);
        if (disposed) {
          return;
        }
        s.setAgentMessages(messages);
        setAgentSessionPickerIndex(0);
        setAgentRollbackVisible(false);
      } catch (error) {
        if (disposed) {
          return;
        }
        s.setToast({ type: "error", message: String(error) });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [s.activeProjectId, s.selectedFile, s.setAgentMessages, s.setToast]);

  useEffect(() => {
    const projectId = s.activeProjectId;
    const filePath = s.selectedFile;
    const sessionId = agentCurrentSessionId;
    if (!projectId || !filePath || !sessionId) {
      return;
    }
    if (sessionSaveTimerRef.current) {
      clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = null;
    }
    sessionSaveTimerRef.current = setTimeout(() => {
      void saveSessionMessages(projectId, filePath, sessionId, s.agentMessages)
        .then((nextSessions) => {
          if (nextSessions) {
            setAgentSessions(nextSessions);
          }
        })
        .catch(() => undefined);
    }, 320);
    return () => {
      if (sessionSaveTimerRef.current) {
        clearTimeout(sessionSaveTimerRef.current);
        sessionSaveTimerRef.current = null;
      }
    };
  }, [agentCurrentSessionId, s.activeProjectId, s.agentMessages, s.selectedFile]);

  const handleResumeSession = useCallback(async (index: number) => {
    const projectId = s.activeProjectId;
    const filePath = s.selectedFile;
    if (!projectId || !filePath || agentSessions.length === 0) {
      return;
    }
    const target = agentSessions[Math.max(0, Math.min(index, agentSessions.length - 1))];
    try {
      const resumed = await resumeFileSession(projectId, filePath, target.id);
      setAgentSessions(resumed.sessions);
      setAgentCurrentSessionId(resumed.currentSessionId);
      const messages = await loadSessionMessages(projectId, filePath, resumed.currentSessionId);
      s.setAgentMessages(messages);
      setAgentSessionPickerOpen(false);
      s.setAgentPrompt("");
    } catch {
      s.setToast({ type: "error", message: t("agent.command.resume.notFound") });
    }
  }, [agentSessions, s.activeProjectId, s.selectedFile, s.setAgentMessages, s.setAgentPrompt, s.setToast, t]);

  useEffect(() => {
    s.setPdfUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    s.setCompiledPdfBytes(null);
  }, [s.activeProjectId, s.setCompiledPdfBytes, s.setPdfUrl]);

  const analysisWorkspace = useAnalysisWorkspace({
    projectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    editorContent: s.editorContent,
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
    setLastCompileFailed: s.setLastCompileFailed,
    setPdfUrl: s.setPdfUrl,
    setCompiledPdfBytes: s.setCompiledPdfBytes,
    setAgentMessages: s.setAgentMessages,
    agentProposalsByPath: s.agentProposalsByPath,
    setAgentProposalsByPath: s.setAgentProposalsByPath,
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
  const agentProposalDecorationIdsRef = useRef<string[]>([]);

  const clearAgentProposalDecorations = useCallback(() => {
    const editor = s.editorRef.current;
    if (!editor) {
      agentProposalDecorationIdsRef.current = [];
      return;
    }
    if (agentProposalDecorationIdsRef.current.length === 0) {
      return;
    }
    agentProposalDecorationIdsRef.current = editor.deltaDecorations(
      agentProposalDecorationIdsRef.current,
      [],
    );
  }, [s.editorRef]);

  const getCachedTextContent = useCallback(
    (relativePath: string) => {
      if (isPdfPath(relativePath)) {
        return null;
      }
      const cached = s.workingContentByPathRef.current[relativePath];
      return typeof cached === "string" ? cached : null;
    },
    [s.workingContentByPathRef],
  );

  const handleTextFileLoaded = useCallback(
    (relativePath: string, content: string) => {
      s.savedContentByPathRef.current[relativePath] = content;
      if (!s.dirtyByPathRef.current[relativePath]) {
        s.workingContentByPathRef.current[relativePath] = content;
      }
    },
    [s.dirtyByPathRef, s.savedContentByPathRef, s.workingContentByPathRef],
  );

  useAppEffects({
    t,
    isTauriRuntime,
    activeProjectId: s.activeProjectId,
    selectedFile: s.selectedFile,
    pendingRevealLine: s.pendingRevealLine,
    page: s.page,
    cursor: s.cursor,
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
    setToast: s.setToast,
    setProjectSearchQuery: s.setProjectSearchQuery,
    setProjectSearchResults: s.setProjectSearchResults,
    setProjectSearchSearched: s.setProjectSearchSearched,
    setEvents: s.setEvents,
    setCursor: s.setCursor,
    setBusytexCacheInfo: s.setBusytexCacheInfo,
    resizeFrameRef: s.resizeFrameRef,
    setIsMaximized: s.setIsMaximized,
    editorRef: s.editorRef,
    setPendingRevealLine: s.setPendingRevealLine,
    setGitDownloadState: s.setGitDownloadState,
    setGitDownloadTaskId: s.setGitDownloadTaskId,
    setSuppressAutoGitInstall: s.setSuppressAutoGitInstall,
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

  useEffect(() => {
    const editor = s.editorRef.current;
    if (!editor || !s.selectedFile || !activeAgentProposal?.previewApplied) {
      clearAgentProposalDecorations();
      return;
    }
    if (activeAgentProposal.targetPath !== s.selectedFile) {
      clearAgentProposalDecorations();
      return;
    }
    const model = editor.getModel?.();
    if (!model) {
      clearAgentProposalDecorations();
      return;
    }
    const modelLineCount = Math.max(1, Number(model.getLineCount?.() ?? 1));
    const blocks = activeAgentProposal.diffBlocks ?? [];
    if (blocks.length === 0) {
      clearAgentProposalDecorations();
      return;
    }
    const decorations = blocks.map((block) => {
      const start = Math.max(1, Math.min(modelLineCount, block.lineStart));
      const end = Math.max(start, Math.min(modelLineCount, block.lineEnd));
      const className =
        block.kind === "add"
          ? "agent-proposal-line-add"
          : block.kind === "delete"
            ? "agent-proposal-line-delete"
            : "agent-proposal-line-modify";
      const linesDecorationsClassName =
        block.kind === "add"
          ? "agent-proposal-gutter-add"
          : block.kind === "delete"
            ? "agent-proposal-gutter-delete"
            : "agent-proposal-gutter-modify";
      return {
        range: {
          startLineNumber: start,
          startColumn: 1,
          endLineNumber: end,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className,
          linesDecorationsClassName,
        },
      };
    });
    agentProposalDecorationIdsRef.current = editor.deltaDecorations(
      agentProposalDecorationIdsRef.current,
      decorations,
    );
    return () => {
      clearAgentProposalDecorations();
    };
  }, [activeAgentProposal, clearAgentProposalDecorations, s.editorRef, s.selectedFile]);

  const workspaceActions = useAppContainerWorkspaceActions({
    selectedFile: s.selectedFile,
    editorContent: s.editorContent,
    markPathSaved: unsaved.markPathSaved,
    handleSaveFile: handlers.handleSaveFile,
    handleWindowControl: handlers.handleWindowControl,
    requestUnsavedGuard: unsaved.requestUnsavedGuard,
    editorTabsRef: s.editorTabsRef,
    closeGuardUnlockedRef: s.closeGuardUnlockedRef,
    handleInitProjectFromFolder: handlers.handleInitProjectFromFolder,
    resetEditorSession: unsaved.resetEditorSession,
    handleEditorUndo: handlers.handleEditorUndo,
    handleEditorRedo: handlers.handleEditorRedo,
    handleCompile: handlers.handleCompile,
    handleExportCompiledPdf: handlers.handleExportCompiledPdf,
    isTauriRuntime,
    collectDirtyPaths: unsaved.collectDirtyPaths,
    setEditorTabs: s.setEditorTabs,
    previewTabIdRef: s.previewTabIdRef,
    setPreviewTabId: s.setPreviewTabId,
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

  const handleAgentRollback = useCallback(() => {
    if (!agentRollback) {
      return;
    }
    s.setAgentMessages(agentRollback.messages);
    s.setAgentPrompt(agentRollback.prompt);
    if (agentRollback.sessionId) {
      setAgentCurrentSessionId(agentRollback.sessionId);
    }
    s.setAgentRunId(null);
    s.setAgentPhase("done");
    s.setAgentStatusKey("agent.statusDone");
    setAgentRollbackVisible(false);
    s.setToast({ type: "info", message: t("agent.rollback.restored") });
  }, [agentRollback, s.setAgentMessages, s.setAgentPhase, s.setAgentPrompt, s.setAgentRunId, s.setAgentStatusKey, s.setToast, t]);

  const handleAgentRun = useCallback(async () => {
    const projectId = s.activeProjectId;
    if (!projectId) {
      return;
    }
    if (s.agentPhase === "running" && s.agentRunId) {
      try {
        await runAgentCancel(s.agentRunId);
        setAgentRollbackVisible(true);
      } catch (error) {
        s.setToast({ type: "error", message: String(error) });
      }
      return;
    }
    const rawPrompt = s.agentPrompt.trim();
    if (!rawPrompt) {
      return;
    }
    const parsed = parseAgentPrompt(rawPrompt);
    if (parsed.kind === "command" && parsed.command === "new") {
      if (!s.selectedFile) {
        s.setToast({ type: "error", message: t("agent.command.requiresFile") });
        return;
      }
      const next = await createNewFileSession(projectId, s.selectedFile);
      setAgentSessions(next.sessions);
      setAgentCurrentSessionId(next.currentSessionId);
      s.setAgentMessages([]);
      s.setAgentPrompt("");
      setAgentSessionPickerOpen(false);
      setAgentRollbackVisible(false);
      s.setToast({ type: "info", message: t("agent.command.new.done") });
      return;
    }
    if (parsed.kind === "command" && parsed.command === "memory") {
      const memoryPath = await ensureProjectMemoryDocument(projectId);
      s.setPage("latex");
      s.setSelectedFile(memoryPath);
      s.setAgentPrompt("");
      s.setToast({ type: "info", message: t("agent.command.memory.opened") });
      return;
    }
    if (parsed.kind === "command" && parsed.command === "resume") {
      if (agentSessions.length === 0) {
        s.setToast({ type: "info", message: t("agent.command.resume.empty") });
        s.setAgentPrompt("");
        return;
      }
      const requested = parsed.args.trim();
      if (requested) {
        const directIndex = agentSessions.findIndex((item) => item.id === requested);
        if (directIndex >= 0) {
          await handleResumeSession(directIndex);
          return;
        }
      }
      setAgentSessionPickerOpen(true);
      setAgentSessionPickerIndex(0);
      s.setAgentPrompt("");
      s.setToast({ type: "info", message: t("agent.command.resume.opened") });
      return;
    }
    await appendDailyMemoryPrompt(projectId, s.selectedFile ?? "main.tex", rawPrompt).catch(() => undefined);
    setAgentRollback({
      sessionId: agentCurrentSessionId,
      prompt: s.agentPrompt,
      messages: s.agentMessages,
    });
    setAgentRollbackVisible(false);
    await handlers.handleRunAgent();
  }, [
    agentCurrentSessionId,
    agentSessions.length,
    handlers,
    s.activeProjectId,
    s.agentMessages,
    s.agentPhase,
    s.agentPrompt,
    s.agentRunId,
    s.selectedFile,
    s.setAgentMessages,
    s.setAgentPrompt,
    s.setPage,
    s.setSelectedFile,
    s.setToast,
    t,
    handleResumeSession,
  ]);

  const handleAgentSessionConfirm = useCallback(() => {
    void handleResumeSession(agentSessionPickerIndex);
  }, [agentSessionPickerIndex, handleResumeSession]);

  const explorerGitDecorations = useMemo(() => {
    const map: Record<string, { code: string; ignored: boolean; staged: boolean; unstaged: boolean; untracked: boolean }> = {};
    for (const change of s.gitStatusState?.changes ?? []) {
      const index = (change.indexStatus ?? " ").trim();
      const worktree = (change.worktreeStatus ?? " ").trim();
      const ignored = Boolean(change.ignored);
      const untracked = index === "?" || worktree === "?";
      const staged = !ignored && index.length > 0 && index !== "?";
      const unstaged = !ignored && worktree.length > 0 && worktree !== "?";
      const code = ignored
        ? "!!"
        : untracked
          ? "U"
          : index || worktree || "M";
      map[change.path] = { code, ignored, staged, unstaged, untracked };
    }
    return map;
  }, [s.gitStatusState?.changes]);

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
    compileDiagnostics: s.compileDiagnostics,
    lastCompileFailed: s.lastCompileFailed,
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
      editorContent={s.editorContent}
      editorTabs={s.editorTabs}
      activeTabId={s.activeTabId}
      dirtyByPath={s.dirtyByPath}
      pdfUrl={s.pdfUrl}
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
      agentSessions={agentSessions}
      agentSessionPickerOpen={agentSessionPickerOpen}
      agentSessionPickerIndex={agentSessionPickerIndex}
      agentRollbackVisible={agentRollbackVisible}
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
      handleRunAgent={handleAgentRun}
      setAgentSessionPickerOpen={setAgentSessionPickerOpen}
      setAgentSessionPickerIndex={setAgentSessionPickerIndex}
      handleAgentSessionConfirm={handleAgentSessionConfirm}
      handleAgentRollback={handleAgentRollback}
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
