import MonacoEditor from "@monaco-editor/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  Bot,
  FileCode2,
  FolderOpen,
  GitBranch,
  Globe,
  Languages,
  Library,
  ListChecks,
  Maximize2,
  Minimize2,
  Minus,
  Play,
  Plus,
  Save,
  SearchCode,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { AgentChatOverlay, type AgentMessage, type AgentPhase } from "./components/AgentChatOverlay";
import { ExplorerTree } from "./components/ExplorerTree";
import { GitWorkspace } from "./components/GitWorkspace";
import { ModelModal } from "./components/ModelModal";
import { PageRail } from "./components/PageRail";
import { Button } from "../components/ui/button";
import { Select } from "../components/ui/select";
import { compileWithBusyTeX } from "../features/latex/compiler/busytex";
import { detectSystemLocale, resolveLocale, useI18n, type Locale } from "../i18n";
import { cn } from "../lib/utils";
import {
  fsOperation,
  getEvents,
  getHealthCheck,
  getLibraryTree,
  getSettings,
  gitCheckInstalled,
  gitBranches,
  gitCheckout,
  gitCommit,
  gitDownloadCancel,
  gitDownloadInstallerStart,
  gitDownloadStatus,
  gitFetch,
  gitInitRepo,
  gitLog,
  gitPull,
  gitPush,
  gitRunInstaller,
  gitStage,
  gitStatus,
  gitUnstage,
  initProjectFromFolder,
  listProjects,
  openProject,
  readFile,
  recordCompile,
  rescanLibrary,
  runAgent,
  runtimeLogInfo,
  runtimeLogWrite,
  testProtocol,
  updateSettings,
  writeFile,
} from "../shared/api/desktop";
import type {
  AgentModelBinding,
  AppSettings,
  FsAction,
  FsScope,
  GitAvailability,
  GitBranchInfo,
  GitCommitInfo,
  GitDownloadStatus,
  GitStatus,
  PanelLayoutPrefs,
  ModelCatalogItem,
  ModelProtocol,
  ProjectSummary,
  ResourceNode,
  RuntimeLogInfo,
  SwarmEvent,
  WorkspacePage,
} from "../shared/types/app";

type Toast = { type: "info" | "error"; message: string } | null;
type SettingsSection = "general" | "models" | "agents" | "diagnostics";
type OverlayType = "logs" | null;
type LogTab = "status" | "events";
type DeleteIntent = { scope: FsScope; path: string } | null;
type AgentStatusKey =
  | "agent.statusIdle"
  | "agent.statusRunning"
  | "agent.statusDone"
  | "agent.statusError";

const PAGE_ITEMS: Array<{
  id: WorkspacePage;
  key: "nav.latex" | "nav.analysis" | "nav.library" | "nav.git" | "nav.settings";
  icon: typeof FileCode2;
}> = [
  { id: "latex", key: "nav.latex", icon: FileCode2 },
  { id: "analysis", key: "nav.analysis", icon: SearchCode },
  { id: "library", key: "nav.library", icon: Library },
  { id: "git", key: "nav.git", icon: GitBranch },
  { id: "settings", key: "nav.settings", icon: Settings2 },
];

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  key:
    | "settings.section.general"
    | "settings.section.models"
    | "settings.section.agents"
    | "settings.section.diagnostics";
  icon: typeof Languages;
}> = [
  { id: "general", key: "settings.section.general", icon: Languages },
  { id: "models", key: "settings.section.models", icon: Globe },
  { id: "agents", key: "settings.section.agents", icon: Bot },
  { id: "diagnostics", key: "settings.section.diagnostics", icon: Settings2 },
];

const DEFAULT_PROTOCOLS: ModelProtocol[] = [
  {
    id: "openai-compatible",
    displayName: "OpenAI-Compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeySet: false,
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeySet: false,
  },
  {
    id: "gemini",
    displayName: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKeySet: false,
  },
];

const DEFAULT_CATALOG: ModelCatalogItem[] = [
  {
    id: "openai-gpt-4-1",
    protocolId: "openai-compatible",
    displayName: "GPT-4.1",
    requestName: "gpt-4.1",
  },
  {
    id: "openai-gpt-4-1-mini",
    protocolId: "openai-compatible",
    displayName: "GPT-4.1 Mini",
    requestName: "gpt-4.1-mini",
  },
  {
    id: "anthropic-claude-3-7-sonnet-latest",
    protocolId: "anthropic",
    displayName: "Claude 3.7 Sonnet",
    requestName: "claude-3-7-sonnet-latest",
  },
  {
    id: "gemini-2-0-flash",
    protocolId: "gemini",
    displayName: "Gemini 2.0 Flash",
    requestName: "gemini-2.0-flash",
  },
];

const DEFAULT_BINDINGS: AgentModelBinding[] = [
  { role: "plan", modelId: "openai-gpt-4-1" },
  { role: "task", modelId: "anthropic-claude-3-7-sonnet-latest" },
  { role: "explore", modelId: "openai-gpt-4-1-mini" },
  { role: "web_search", modelId: "openai-gpt-4-1-mini" },
  { role: "review", modelId: "gemini-2-0-flash" },
  { role: "ephemeral", modelId: "openai-gpt-4-1-mini" },
];

const DEFAULT_PANEL_LAYOUT: PanelLayoutPrefs = {
  shell: [7, 93],
  latex: [22, 48, 30],
  analysis: [26, 74],
  library: [30, 70],
  git: [100],
  settings: [100],
};

const SHELL_MIN = [6, 80];

function clampLayout(layout: number[] | undefined, fallback: number[]): number[] {
  if (!layout || layout.length !== fallback.length) {
    return fallback;
  }
  const cleaned = layout.map((value) =>
    Number.isFinite(value) ? Math.max(5, Math.min(95, value)) : 0,
  );
  const sum = cleaned.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    return fallback;
  }
  return cleaned.map((value) => (value / sum) * 100);
}

function flattenFiles(nodes: ResourceNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "file") {
      acc.push(node.relativePath);
    } else {
      flattenFiles(node.children, acc);
    }
  }
  return acc;
}

function upsertProject(projects: ProjectSummary[], snapshot: ProjectSummary): ProjectSummary[] {
  const next = projects.filter((item) => item.id !== snapshot.id);
  next.unshift(snapshot);
  return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function App() {
  const { locale, setLocale, t } = useI18n();
  const [status, setStatus] = useState<"ready" | "offline">("ready");
  const [toast, setToast] = useState<Toast>(null);
  const [page, setPage] = useState<WorkspacePage>("latex");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [tree, setTree] = useState<ResourceNode[]>([]);
  const [libraryTree, setLibraryTree] = useState<ResourceNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedLibraryPath, setSelectedLibraryPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
  const [agentStatusKey, setAgentStatusKey] = useState<AgentStatusKey>("agent.statusIdle");
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [compileDiagnostics, setCompileDiagnostics] = useState<string[]>([]);
  const [lastCompileFailed, setLastCompileFailed] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [draftApiKeys, setDraftApiKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeLogInfo | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowActionBusy, setWindowActionBusy] = useState(false);
  const [overlay, setOverlay] = useState<OverlayType>(null);
  const [logsTab, setLogsTab] = useState<LogTab>("events");
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent>(null);
  const [deleteDontAskAgain, setDeleteDontAskAgain] = useState(false);
  const [gitStatusState, setGitStatusState] = useState<GitStatus | null>(null);
  const [gitBranchesState, setGitBranchesState] = useState<GitBranchInfo[]>([]);
  const [gitCommits, setGitCommits] = useState<GitCommitInfo[]>([]);
  const [gitAvailability, setGitAvailability] = useState<GitAvailability | null>(null);
  const [gitDownloadState, setGitDownloadState] = useState<GitDownloadStatus | null>(null);
  const [gitDownloadTaskId, setGitDownloadTaskId] = useState<string | null>(null);
  const [gitInstallerLaunched, setGitInstallerLaunched] = useState(false);
  const [suppressAutoGitInstall, setSuppressAutoGitInstall] = useState(false);
  const resizeFrameRef = useRef<number | null>(null);

  const isTauriRuntime = isTauri();
  const fileList = useMemo(() => flattenFiles(tree), [tree]);
  const pageLabel = useMemo(
    () => t(PAGE_ITEMS.find((item) => item.id === page)?.key ?? "nav.latex"),
    [page, t],
  );
  const pageRailItems = useMemo(
    () =>
      PAGE_ITEMS.map((item) => ({
        id: item.id,
        icon: item.icon,
        label: t(item.key),
      })),
    [t],
  );
  const loadProjectData = async (projectId: string) => {
    const snapshot = await openProject(projectId);
    setTree(snapshot.tree);
    setSelectedFile(snapshot.mainFile);
    const [papers] = await Promise.all([getLibraryTree(projectId)]);
    setLibraryTree(papers);
    setSelectedLibraryPath(null);
    await refreshGitWorkspace(projectId);
  };

  const persistSettings = async (nextSettings: AppSettings) => {
    const updated = await updateSettings({
      activeProjectId,
      modelProtocols: nextSettings.modelProtocols.map((protocol) => ({
        id: protocol.id,
        displayName: protocol.displayName,
        baseUrl: protocol.baseUrl,
        apiKey: draftApiKeys[protocol.id],
      })),
      modelCatalog: nextSettings.modelCatalog.map((model) => ({
        id: model.id,
        protocolId: model.protocolId,
        displayName: model.displayName,
        requestName: model.requestName,
      })),
      agentBindings: nextSettings.agentBindings,
      uiPrefs: {
        language: nextSettings.uiPrefs?.language ?? locale,
        skipDeleteConfirm: nextSettings.uiPrefs?.skipDeleteConfirm ?? false,
        panelLayout: nextSettings.uiPrefs?.panelLayout,
      },
    });
    setSettings(updated);
    setDraftApiKeys({});
    return updated;
  };

  const refreshGitWorkspace = async (projectIdOverride?: string) => {
    const projectId = projectIdOverride ?? activeProjectId;
    if (!projectId) {
      return;
    }
    const availability = await gitCheckInstalled().catch(() => ({
      installed: false,
      version: undefined,
    }));
    setGitAvailability(availability);
    if (availability.installed) {
      setSuppressAutoGitInstall(false);
    }
    if (!availability.installed) {
      setGitStatusState({
        isRepo: false,
        branch: "-",
        ahead: 0,
        behind: 0,
        changes: [],
      });
      setGitBranchesState([]);
      setGitCommits([]);
      return;
    }
    const [state, branches, commits] = await Promise.all([
      gitStatus(projectId),
      gitBranches(projectId).catch(() => []),
      gitLog(projectId, 50).catch(() => []),
    ]);
    setGitStatusState(state);
    setGitBranchesState(branches);
    setGitCommits(commits);
  };

  const savePanelLayout = (panelKey: keyof PanelLayoutPrefs, layout: number[]) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        uiPrefs: {
          ...(prev.uiPrefs ?? {}),
          language: prev.uiPrefs?.language ?? locale,
          panelLayout: {
            ...DEFAULT_PANEL_LAYOUT,
            ...(prev.uiPrefs?.panelLayout ?? {}),
            [panelKey]: layout,
          },
        },
      };
    });
  };

  useEffect(() => {
    const init = async () => {
      try {
        await getHealthCheck();
        setStatus("ready");
      } catch {
        setStatus("offline");
      }

      const [projectList, appSettings, info] = await Promise.all([
        listProjects(),
        getSettings(),
        runtimeLogInfo(),
      ]);
      setProjects(projectList);
      setSettings({
        ...appSettings,
        modelProtocols:
          appSettings.modelProtocols.length > 0
            ? appSettings.modelProtocols
            : DEFAULT_PROTOCOLS,
        modelCatalog:
          appSettings.modelCatalog.length > 0
            ? appSettings.modelCatalog
            : DEFAULT_CATALOG,
        agentBindings:
          appSettings.agentBindings.length > 0
            ? appSettings.agentBindings
            : DEFAULT_BINDINGS,
        uiPrefs: {
          ...(appSettings.uiPrefs ?? {}),
          panelLayout: {
            ...DEFAULT_PANEL_LAYOUT,
            ...(appSettings.uiPrefs?.panelLayout ?? {}),
          },
        },
      });
      setRuntimeInfo(info);

      const initialLocale = resolveLocale(
        appSettings.uiPrefs?.language ??
          (typeof window !== "undefined"
            ? window.localStorage.getItem("latotex.locale")
            : null),
      );
      setLocale(initialLocale);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("latotex.locale", initialLocale);
      }

      await runtimeLogWrite(
        "INFO",
        `frontend initialization completed, installMode=${info.installMode}, version=${info.version}`,
      );

      let targetProjectId = appSettings.activeProjectId;
      if (!targetProjectId && projectList.length > 0) {
        targetProjectId = projectList[0].id;
      }
      setActiveProjectId(targetProjectId ?? null);
      if (targetProjectId) {
        await loadProjectData(targetProjectId);
      }
    };

    init().catch(() => {
      setToast({ type: "error", message: t("toast.initFailed") });
    });
  }, [setLocale]);

  useEffect(() => {
    if (!activeProjectId) {
      setTree([]);
      setLibraryTree([]);
      setSelectedFile(null);
      setSelectedLibraryPath(null);
      setEditorContent("");
      return;
    }
    loadProjectData(activeProjectId)
      .catch((error) => {
        setToast({ type: "error", message: String(error) });
      });
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || !selectedFile) {
      return;
    }
    readFile(activeProjectId, selectedFile)
      .then((result) => setEditorContent(result.content))
      .catch((error) => setToast({ type: "error", message: String(error) }));
  }, [activeProjectId, selectedFile]);

  useEffect(() => {
    const timer = setInterval(() => {
      getEvents(cursor, 120)
        .then((batch) => {
          if (batch.events.length > 0) {
            setEvents((prev) => [...prev.slice(-300), ...batch.events]);
            setCursor(batch.nextCursor);
          }
        })
        .catch(() => undefined);
    }, 2400);
    return () => clearInterval(timer);
  }, [cursor]);

  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }
    let unlisten: (() => void) | null = null;
    const syncWindowState = async () => {
      const appWindow = getCurrentWindow();
      setIsMaximized(await appWindow.isMaximized());
      unlisten = await appWindow.onResized(async () => {
        if (resizeFrameRef.current) {
          cancelAnimationFrame(resizeFrameRef.current);
        }
        resizeFrameRef.current = requestAnimationFrame(async () => {
          setIsMaximized(await appWindow.isMaximized());
        });
      });
    };

    syncWindowState().catch(() => undefined);
    return () => {
      if (resizeFrameRef.current) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      unlisten?.();
    };
  }, [isTauriRuntime]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (page !== "git" || !activeProjectId) {
      return;
    }
    refreshGitWorkspace(activeProjectId).catch(() => undefined);
  }, [page, activeProjectId]);

  useEffect(() => {
    if (!gitDownloadTaskId) {
      return;
    }
    const timer = setInterval(() => {
      gitDownloadStatus(gitDownloadTaskId)
        .then((nextState) => {
          setGitDownloadState(nextState);
          if (nextState.status === "completed" && !gitInstallerLaunched) {
            handleGitRunInstaller().catch(() => undefined);
          }
          if (nextState.status === "failed" || nextState.status === "cancelled") {
            setGitDownloadTaskId(null);
            setSuppressAutoGitInstall(true);
          }
          if (nextState.status === "completed" && gitInstallerLaunched) {
            setGitDownloadTaskId(null);
          }
        })
        .catch(() => undefined);
    }, 500);
    return () => clearInterval(timer);
  }, [gitDownloadTaskId, gitInstallerLaunched]);

  useEffect(() => {
    if (
      page !== "git" ||
      !activeProjectId ||
      gitAvailability?.installed !== false ||
      gitDownloadTaskId ||
      suppressAutoGitInstall
    ) {
      return;
    }
    handleGitInstallerDownloadStart().catch(() => undefined);
  }, [page, activeProjectId, gitAvailability?.installed, gitDownloadTaskId, suppressAutoGitInstall]);

  const handleWindowControl = async (action: "minimize" | "toggle" | "close") => {
    if (!isTauriRuntime) {
      setToast({ type: "error", message: t("toast.windowUnavailable") });
      return;
    }
    if (windowActionBusy) {
      return;
    }
    setWindowActionBusy(true);
    try {
      const appWindow = getCurrentWindow();
      if (action === "minimize") {
        await appWindow.minimize();
        return;
      }
      if (action === "toggle") {
        const maximized = await appWindow.isMaximized();
        if (maximized) {
          await appWindow.unmaximize();
          setIsMaximized(false);
        } else {
          await appWindow.maximize();
          setIsMaximized(true);
        }
        return;
      }
      await appWindow.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message: t("toast.windowActionFailed") });
      await runtimeLogWrite("ERROR", `window action failed: ${message}`);
    } finally {
      setWindowActionBusy(false);
    }
  };

  const handleInitProjectFromFolder = async () => {
    setBusy(true);
    try {
      const snapshot = await initProjectFromFolder();
      if (!snapshot) {
        return;
      }

      setProjects((prev) => upsertProject(prev, snapshot.summary));
      setActiveProjectId(snapshot.summary.id);
      setTree(snapshot.tree);
      setSelectedFile(snapshot.mainFile);
      setSettings((prev) =>
        prev ? { ...prev, activeProjectId: snapshot.summary.id } : prev,
      );
      setToast({ type: "info", message: t("toast.projectCreated") });
      await runtimeLogWrite("INFO", `project initialized from folder: ${snapshot.summary.rootPath}`);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveFile = async () => {
    if (!activeProjectId || !selectedFile) {
      return;
    }
    setBusy(true);
    try {
      await writeFile(activeProjectId, selectedFile, editorContent);
      await runtimeLogWrite("INFO", `${t("log.fileSaved")}: ${selectedFile}`);
      setToast({ type: "info", message: t("toast.fileSaved") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleCompile = async () => {
    if (!activeProjectId || !selectedFile) {
      return;
    }
    setBusy(true);
    setCompileDiagnostics([]);
    try {
      const fileMap: Record<string, string> = {};
      for (const filePath of fileList) {
        if (filePath === selectedFile) {
          fileMap[filePath] = editorContent;
          continue;
        }
        const data = await readFile(activeProjectId, filePath);
        fileMap[filePath] = data.content;
      }

      const result = await compileWithBusyTeX(editorContent, fileMap, selectedFile);
      setLastCompileFailed(result.status !== "success");
      await runtimeLogWrite(
        result.status === "success" ? "INFO" : "ERROR",
        `${t("log.compileDone")}, file=${selectedFile}, status=${result.status}, durationMs=${result.durationMs}`,
      );

      await recordCompile({
        projectId: activeProjectId,
        mainFile: selectedFile,
        status: result.status,
        diagnostics: result.diagnostics,
        durationMs: result.durationMs,
      });

      if (result.status === "success" && result.pdfBytes) {
        if (pdfUrl) {
          URL.revokeObjectURL(pdfUrl);
        }
        const normalizedBytes = Uint8Array.from(result.pdfBytes);
        const url = URL.createObjectURL(
          new Blob([normalizedBytes], { type: "application/pdf" }),
        );
        setPdfUrl(url);
      }
      setCompileDiagnostics(result.diagnostics);
      setToast({
        type: result.status === "success" ? "info" : "error",
        message:
          result.status === "success"
            ? t("toast.compileSuccess")
            : t("toast.compileFailed"),
      });
    } catch (error) {
      setLastCompileFailed(true);
      setToast({ type: "error", message: String(error) });
      setCompileDiagnostics([String(error)]);
    } finally {
      setBusy(false);
    }
  };

  const handleRunAgent = async () => {
    if (!activeProjectId || !agentPrompt.trim()) {
      return;
    }
    const prompt = agentPrompt.trim();
    setAgentMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-user`,
        role: "user",
        text: prompt,
      },
    ]);
    setAgentPrompt("");
    setAgentCollapsed(true);
    setAgentPhase("running");
    setAgentStatusKey("agent.statusRunning");
    setBusy(true);
    try {
      const response = await runAgent({
        projectId: activeProjectId,
        role: "task",
        prompt,
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
      });
      await runtimeLogWrite("INFO", `${t("log.agentRunDone")}, runId=${response.runId}`);
      setAgentMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-agent`,
          role: "agent",
          text: response.output,
        },
      ]);
      setAgentPhase("done");
      setAgentStatusKey("agent.statusDone");
    } catch (error) {
      setAgentPhase("error");
      setAgentStatusKey("agent.statusError");
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) {
      return;
    }
    setBusy(true);
    try {
      await persistSettings(settings);
      await runtimeLogWrite("INFO", t("log.settingsSaved"));
      setToast({ type: "info", message: t("toast.settingsSaved") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleLocaleChange = (nextLocale: Locale) => {
    setLocale(nextLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("latotex.locale", nextLocale);
    }
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            uiPrefs: { ...(prev.uiPrefs ?? {}), language: nextLocale, panelLayout: prev.uiPrefs?.panelLayout },
          }
        : prev,
    );
  };

  const handleProtocolPing = async (protocolId: string) => {
    const result = await testProtocol(protocolId);
    setToast({
      type: result.ok ? "info" : "error",
      message: result.ok ? t("toast.protocolOk") : t("toast.protocolFail"),
    });
    await runtimeLogWrite(
      result.ok ? "INFO" : "WARN",
      `protocol test: ${protocolId}, ok=${result.ok}`,
    );
    return result.ok;
  };

  const runFsAction = async (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => {
    if (!activeProjectId) {
      return;
    }
    setBusy(true);
    try {
      await fsOperation({
        projectId: activeProjectId,
        scope,
        action,
        path,
        targetPath,
        content,
      });
      if (scope === "workspace") {
        const snapshot = await openProject(activeProjectId);
        setTree(snapshot.tree);
      } else {
        const nextTree = await getLibraryTree(activeProjectId);
        setLibraryTree(nextTree);
      }
      setToast({ type: "info", message: t("toast.fsUpdated") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const requestFsAction = async (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }
    if (action !== "delete") {
      await runFsAction(scope, action, normalizedPath, targetPath, content);
      return;
    }
    const skipConfirm = settings?.uiPrefs?.skipDeleteConfirm ?? false;
    if (skipConfirm) {
      await runFsAction(scope, "delete", normalizedPath);
      return;
    }
    setDeleteIntent({ scope, path: normalizedPath });
    setDeleteDontAskAgain(false);
  };

  const confirmDelete = async () => {
    if (!deleteIntent || !settings) {
      return;
    }

    if (deleteDontAskAgain) {
      const nextSettings: AppSettings = {
        ...settings,
        uiPrefs: {
          ...(settings.uiPrefs ?? {}),
          language: settings.uiPrefs?.language ?? locale,
          skipDeleteConfirm: true,
          panelLayout: settings.uiPrefs?.panelLayout,
        },
      };
      await persistSettings(nextSettings);
    }

    await runFsAction(deleteIntent.scope, "delete", deleteIntent.path);
    setDeleteIntent(null);
  };

  const handleGitAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refreshGitWorkspace();
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleGitInstallerDownloadStart = async () => {
    setBusy(true);
    try {
      const started = await gitDownloadInstallerStart();
      setSuppressAutoGitInstall(false);
      setGitInstallerLaunched(false);
      setGitDownloadTaskId(started.taskId);
      setGitDownloadState({
        taskId: started.taskId,
        status: "downloading",
        fileName: started.fileName,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        progressPercent: 0,
        installerPath: "",
      });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleGitInstallerCancel = async () => {
    if (!gitDownloadTaskId) {
      return;
    }
    try {
      await gitDownloadCancel(gitDownloadTaskId);
      setSuppressAutoGitInstall(true);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  };

  const handleGitRunInstaller = async () => {
    if (!gitDownloadTaskId || gitInstallerLaunched) {
      return;
    }
    try {
      await gitRunInstaller(gitDownloadTaskId);
      setGitInstallerLaunched(true);
      setToast({ type: "info", message: t("git.installerStarted") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  };

  const activeModelCatalog = settings?.modelCatalog ?? DEFAULT_CATALOG;
  const sessionLogName = useMemo(() => {
    if (!runtimeInfo?.sessionLogFile) {
      return "-";
    }
    const parts = runtimeInfo.sessionLogFile.split(/[\\/]/);
    return parts[parts.length - 1] || runtimeInfo.sessionLogFile;
  }, [runtimeInfo?.sessionLogFile]);
  const compileErrorLine = useMemo(() => {
    if (!lastCompileFailed || compileDiagnostics.length === 0) {
      return null;
    }
    return compileDiagnostics[0];
  }, [compileDiagnostics, lastCompileFailed]);
  const panelLayout = settings?.uiPrefs?.panelLayout ?? DEFAULT_PANEL_LAYOUT;
  const shellLayout = clampLayout(panelLayout.shell, DEFAULT_PANEL_LAYOUT.shell!);
  const latexLayout = clampLayout(panelLayout.latex, DEFAULT_PANEL_LAYOUT.latex!);
  const analysisLayout = clampLayout(panelLayout.analysis, DEFAULT_PANEL_LAYOUT.analysis!);
  const libraryLayout = clampLayout(panelLayout.library, DEFAULT_PANEL_LAYOUT.library!);

  const handleLibraryRescan = async () => {
    if (!activeProjectId) {
      return;
    }
    setBusy(true);
    try {
      await rescanLibrary(activeProjectId);
      const nextTree = await getLibraryTree(activeProjectId);
      setLibraryTree(nextTree);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const renderSettingsPanel = () => {
    const localSettings = settings ?? {
      activeProjectId,
      modelProtocols: DEFAULT_PROTOCOLS,
      modelCatalog: DEFAULT_CATALOG,
      agentBindings: DEFAULT_BINDINGS,
      uiPrefs: { language: locale, panelLayout: DEFAULT_PANEL_LAYOUT },
    };

    return (
      <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft motion-slide-up max-[980px]:grid-cols-1">
        <aside className="border-r border-slate-200 bg-slate-50 p-2 max-[980px]:border-r-0 max-[980px]:border-b">
          <div className="space-y-1">
            {SETTINGS_SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={cn(
                    "flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition",
                    settingsSection === item.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-200",
                  )}
                  onClick={() => setSettingsSection(item.id)}
                >
                  <Icon className="h-4 w-4" />
                  <span>{t(item.key)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t(
                  SETTINGS_SECTIONS.find((item) => item.id === settingsSection)?.key ??
                    "settings.section.general",
                )}
              </h2>
              <p className="text-xs text-slate-500">{t("settings.saveHint")}</p>
            </div>
            <Button onClick={handleSaveSettings} disabled={busy}>
              {t("settings.saveSettings")}
            </Button>
          </div>

          {settingsSection === "general" && (
            <div className="grid gap-5">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">
                  {t("settings.languageTitle")}
                </h3>
                <div className="grid max-w-xs gap-2">
                  <Select
                    value={locale}
                    onChange={(event) =>
                      handleLocaleChange(event.target.value as Locale)
                    }
                  >
                    <option value="zh-CN">{t("settings.language.zh-CN")}</option>
                    <option value="en-US">{t("settings.language.en-US")}</option>
                  </Select>
                  <p className="text-xs text-slate-500">
                    {t("settings.languageAuto")}:{" "}
                    {detectSystemLocale() === "zh-CN"
                      ? t("settings.language.zh-CN")
                      : t("settings.language.en-US")}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <label className="flex items-center justify-between text-sm text-slate-700">
                  <span>{t("settings.deleteConfirm")}</span>
                  <input
                    type="checkbox"
                    checked={!(localSettings.uiPrefs?.skipDeleteConfirm ?? false)}
                    onChange={(event) =>
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              uiPrefs: {
                                ...(prev.uiPrefs ?? {}),
                                language: prev.uiPrefs?.language ?? locale,
                                skipDeleteConfirm: !event.target.checked,
                                panelLayout: prev.uiPrefs?.panelLayout,
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {settingsSection === "models" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">
                  {t("settings.modelCatalogTitle")}
                </h3>
                <Button size="sm" onClick={() => setModelModalOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("settings.addModel")}
                </Button>
              </div>
              <div className="space-y-2">
                {localSettings.modelCatalog.map((model) => {
                  const protocol = localSettings.modelProtocols.find(
                    (item) => item.id === model.protocolId,
                  );
                  return (
                    <div
                      key={model.id}
                      className="grid grid-cols-[minmax(140px,1fr)_minmax(180px,1fr)_minmax(140px,1fr)_auto] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs max-[980px]:grid-cols-1"
                    >
                      <span>{model.displayName}</span>
                      <span className="font-mono text-slate-600">{model.requestName}</span>
                      <span className="text-slate-500">{protocol?.displayName ?? model.protocolId}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSettings((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  modelCatalog: prev.modelCatalog.filter((item) => item.id !== model.id),
                                }
                              : prev,
                          )
                        }
                      >
                        {t("settings.removeModel")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {settingsSection === "agents" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{t("settings.agentHint")}</p>
              {localSettings.agentBindings.map((binding, index) => (
                <div
                  className="grid grid-cols-[110px_minmax(220px,1fr)] items-center gap-2 rounded-lg border border-slate-200 p-2 max-[980px]:grid-cols-1"
                  key={`${binding.role}-${index}`}
                >
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {binding.role}
                  </span>
                  <Select
                    value={binding.modelId}
                    onChange={(event) =>
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              agentBindings: prev.agentBindings.map((item, idx) =>
                                idx === index
                                  ? { ...item, modelId: event.target.value }
                                  : item,
                              ),
                            }
                          : prev,
                      )
                    }
                  >
                    {localSettings.modelProtocols.map((protocol) => (
                      <optgroup key={protocol.id} label={protocol.displayName}>
                        {activeModelCatalog
                          .filter((item) => item.protocolId === protocol.id)
                          .map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.displayName} ({model.requestName || "-"})
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          )}

          {settingsSection === "diagnostics" && (
            <div className="grid gap-4">
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">{t("settings.currentLog")}</span>
                  <span className="font-mono text-slate-700">{sessionLogName}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">{t("settings.installMode")}</span>
                  <span className="text-slate-700">{runtimeInfo?.installMode ?? "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">{t("settings.version")}</span>
                  <span className="text-slate-700">{runtimeInfo?.version ?? "-"}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderNoProjectPanel = () => (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-4 motion-slide-up">
      <p className="mb-3 text-sm text-slate-600">{t("workspace.noProject")}</p>
      <button
        className="rounded border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100"
        onClick={handleInitProjectFromFolder}
        disabled={busy}
        title={t("topbar.openFolder")}
        aria-label={t("topbar.openFolder")}
      >
        <FolderOpen className="h-5 w-5" />
      </button>
    </div>
  );

  const renderWorkspaceExplorerPanel = () => (
    <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-soft motion-slide-up">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("explorer.title")}
      </h2>
      <div className="h-[calc(100%-24px)] overflow-auto pr-1">
        {activeProjectId ? (
          <ExplorerTree
            tree={tree}
            selectedPath={selectedFile}
            busy={busy}
            onSelect={setSelectedFile}
            onAction={async (action, path, targetPath, content) =>
              requestFsAction("workspace", action, path, targetPath, content)
            }
            t={t}
          />
        ) : (
          <div className="text-xs text-slate-500">{t("workspace.noProject")}</div>
        )}
      </div>
    </aside>
  );

  const renderPdfPreviewPanel = () => (
    <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-soft motion-slide-up">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t("preview.title")}</h2>
        <div className="flex items-center gap-1">
          <button
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            title={t("preview.diagnostics")}
            onClick={() => {
              setLogsTab("status");
              setOverlay("logs");
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            title={t("preview.events")}
            onClick={() => {
              setLogsTab("events");
              setOverlay("logs");
            }}
          >
            <ListChecks className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {compileErrorLine && (
        <button
          className="mb-2 w-full truncate rounded border border-rose-300 bg-rose-50 px-2 py-1 text-left text-xs text-rose-700"
          onClick={() => {
            setLogsTab("status");
            setOverlay("logs");
          }}
          title={compileErrorLine}
        >
          {compileErrorLine}
        </button>
      )}
      <div className="h-[calc(100%-52px)]">
        {pdfUrl ? (
          <iframe
            title={t("preview.title")}
            src={pdfUrl}
            className="h-full w-full rounded-lg border border-slate-200"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {t("preview.empty")}
          </div>
        )}
      </div>
    </aside>
  );

  const renderMainPanel = () => {
    if (page === "analysis") {
      return (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500 motion-slide-up">
          {t("workspace.analysis")}
        </div>
      );
    }
    if (page === "library") {
      return renderNoProjectPanel();
    }
    if (page === "git") {
      return activeProjectId ? (
        <GitWorkspace
          status={gitStatusState}
          branches={gitBranchesState}
          commits={gitCommits}
          availability={gitAvailability}
          downloadStatus={gitDownloadState}
          busy={busy}
          onRefresh={() =>
            refreshGitWorkspace().catch((error) =>
              setToast({ type: "error", message: String(error) }),
            )
          }
          onFetch={() => handleGitAction(async () => gitFetch(activeProjectId))}
          onPull={() => handleGitAction(async () => gitPull(activeProjectId))}
          onPush={() => handleGitAction(async () => gitPush(activeProjectId))}
          onCheckout={(branch, create) =>
            handleGitAction(async () => gitCheckout(activeProjectId, branch, create))
          }
          onStage={(paths) => handleGitAction(async () => gitStage(activeProjectId, paths))}
          onUnstage={(paths) =>
            handleGitAction(async () => gitUnstage(activeProjectId, paths))
          }
          onCommit={(message) => handleGitAction(async () => gitCommit(activeProjectId, message))}
          onInitRepo={() => handleGitAction(async () => gitInitRepo(activeProjectId))}
          onStartGitInstall={handleGitInstallerDownloadStart}
          onCancelDownload={handleGitInstallerCancel}
          onRunInstaller={handleGitRunInstaller}
          t={t}
        />
      ) : (
        renderNoProjectPanel()
      );
    }
    if (page === "settings") {
      return renderSettingsPanel();
    }
    if (!activeProjectId) {
      return renderNoProjectPanel();
    }

    return (
      <div className="grid h-full grid-rows-[48px_minmax(260px,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft motion-slide-up">
        <div className="flex items-center justify-between border-b border-slate-200 px-3">
          <div className="truncate text-sm font-medium text-slate-700">
            {selectedFile ?? t("workspace.noFile")}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleSaveFile} disabled={busy}>
              <Save className="mr-2 h-4 w-4" />
              {t("workspace.save")}
            </Button>
            <Button onClick={handleCompile} disabled={busy}>
              <Play className="mr-2 h-4 w-4" />
              {t("workspace.compile")}
            </Button>
          </div>
        </div>

        <div className="relative min-h-0">
          <MonacoEditor
            language="latex"
            value={editorContent}
            onChange={(value) => setEditorContent(value ?? "")}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              smoothScrolling: true,
            }}
          />
          <AgentChatOverlay
            collapsed={agentCollapsed}
            phase={agentPhase}
            statusLine={t(agentStatusKey)}
            title={t("agent.chatTitle")}
            collapseLabel={t("agent.collapse")}
            prompt={agentPrompt}
            busy={busy}
            messages={agentMessages}
            onPromptChange={setAgentPrompt}
            onRun={handleRunAgent}
            onToggle={() => setAgentCollapsed((prev) => !prev)}
            runLabel={t("workspace.runTaskAgent")}
            placeholder={t("workspace.agentPlaceholder")}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100">
      <header className="flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 text-zinc-100">
        <div className="flex min-w-0 items-center gap-3" data-tauri-drag-region>
          <div className="rounded bg-zinc-800 px-2 py-1 text-xs font-semibold tracking-wide">
            {t("app.brand")}
          </div>
          <span className="text-xs text-zinc-400">{pageLabel}</span>
          {status === "offline" && (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
              {t("app.offline")}
            </span>
          )}
        </div>

        <div className="flex w-[560px] max-w-[56vw] items-center gap-2">
          <Select
            aria-label={t("topbar.selectProject")}
            value={activeProjectId ?? ""}
            className="h-8 border-zinc-700 bg-zinc-900 text-zinc-100 focus:border-primary-400"
            disabled={projects.length === 0}
            onChange={(event) => setActiveProjectId(event.target.value || null)}
          >
            {projects.length === 0 ? (
              <option value="">{t("workspace.noProject")}</option>
            ) : (
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))
            )}
          </Select>
          <button
            className="rounded border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-100 hover:bg-zinc-700"
            onClick={handleInitProjectFromFolder}
            disabled={busy}
            title={t("topbar.openFolder")}
            aria-label={t("topbar.openFolder")}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center">
          <button
            aria-label={t("window.minimize")}
            className="flex h-8 w-10 items-center justify-center rounded text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-40"
            onClick={() => handleWindowControl("minimize")}
            disabled={!isTauriRuntime || windowActionBusy}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            aria-label={t("window.maximize")}
            className="flex h-8 w-10 items-center justify-center rounded text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-40"
            onClick={() => handleWindowControl("toggle")}
            disabled={!isTauriRuntime || windowActionBusy}
          >
            {isMaximized ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
          <button
            aria-label={t("window.close")}
            className="flex h-8 w-10 items-center justify-center rounded text-zinc-300 transition hover:bg-rose-600 hover:text-white disabled:opacity-40"
            onClick={() => handleWindowControl("close")}
            disabled={!isTauriRuntime || windowActionBusy}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden p-3">
        <PanelGroup
          direction="horizontal"
          className="h-full gap-3"
          onLayout={(layout) => savePanelLayout("shell", layout)}
        >
          <Panel
            defaultSize={shellLayout[0]}
            minSize={SHELL_MIN[0]}
            maxSize={SHELL_MIN[1]}
            className="min-w-[52px]"
          >
            <PageRail items={pageRailItems} activePage={page} onChange={setPage} />
          </Panel>
          <PanelResizeHandle className="resizable-handle" />
          <Panel defaultSize={shellLayout[1]} minSize={20}>
            {page === "latex" && activeProjectId ? (
              <PanelGroup
                direction="horizontal"
                className="h-full gap-3"
                onLayout={(layout) => savePanelLayout("latex", layout)}
              >
                <Panel defaultSize={latexLayout[0]} minSize={16}>
                  {renderWorkspaceExplorerPanel()}
                </Panel>
                <PanelResizeHandle className="resizable-handle" />
                <Panel defaultSize={latexLayout[1]} minSize={30}>
                  <section key={page} className="h-full min-h-0 motion-page-in">
                    {renderMainPanel()}
                  </section>
                </Panel>
                <PanelResizeHandle className="resizable-handle" />
                <Panel defaultSize={latexLayout[2]} minSize={20}>
                  {renderPdfPreviewPanel()}
                </Panel>
              </PanelGroup>
            ) : page === "analysis" ? (
              <PanelGroup
                direction="horizontal"
                className="h-full gap-3"
                onLayout={(layout) => savePanelLayout("analysis", layout)}
              >
                <Panel defaultSize={analysisLayout[0]} minSize={18}>
                  {renderWorkspaceExplorerPanel()}
                </Panel>
                <PanelResizeHandle className="resizable-handle" />
                <Panel defaultSize={analysisLayout[1]} minSize={30}>
                  <section key={page} className="h-full min-h-0 motion-page-in">
                    {renderMainPanel()}
                  </section>
                </Panel>
              </PanelGroup>
            ) : page === "library" && activeProjectId ? (
              <PanelGroup
                direction="horizontal"
                className="h-full gap-3"
                onLayout={(layout) => savePanelLayout("library", layout)}
              >
                <Panel defaultSize={libraryLayout[0]} minSize={20}>
                  <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-soft">
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("library.title")}
                    </h2>
                    <div className="h-[calc(100%-24px)] overflow-auto pr-1">
                      <ExplorerTree
                        tree={libraryTree}
                        selectedPath={selectedLibraryPath}
                        allowRescan
                        busy={busy}
                        onSelect={setSelectedLibraryPath}
                        onRescan={handleLibraryRescan}
                        onAction={async (action, path, targetPath, content) =>
                          requestFsAction("library", action, path, targetPath, content)
                        }
                        t={t}
                      />
                    </div>
                  </aside>
                </Panel>
                <PanelResizeHandle className="resizable-handle" />
                <Panel defaultSize={libraryLayout[1]} minSize={28}>
                  <section className="h-full min-h-0 motion-page-in">
                    <div className="h-full min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
                      <h3 className="mb-2 text-sm font-semibold text-slate-700">
                        {t("library.detailTitle")}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {selectedLibraryPath ? selectedLibraryPath : t("library.noSelection")}
                      </p>
                    </div>
                  </section>
                </Panel>
              </PanelGroup>
            ) : (
              <section key={page} className="h-full min-h-0 motion-page-in">
                {renderMainPanel()}
              </section>
            )}
          </Panel>
        </PanelGroup>
      </main>

      {overlay === "logs" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 motion-fade-in">
          <div className="grid h-[72vh] w-full max-w-3xl grid-rows-[48px_auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-soft">
            <div className="flex items-center justify-between border-b border-slate-200 px-4">
              <h3 className="text-sm font-semibold text-slate-800">{t("preview.title")}</h3>
              <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={() => setOverlay(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
              <button
                className={cn(
                  "rounded border px-2 py-1 text-xs",
                  logsTab === "events"
                    ? "border-primary-600 bg-primary-600 text-white"
                    : "border-slate-300 bg-white text-slate-600",
                )}
                onClick={() => setLogsTab("events")}
              >
                {t("preview.events")}
              </button>
              <button
                className={cn(
                  "rounded border px-2 py-1 text-xs",
                  logsTab === "status"
                    ? "border-primary-600 bg-primary-600 text-white"
                    : "border-slate-300 bg-white text-slate-600",
                )}
                onClick={() => setLogsTab("status")}
              >
                {t("preview.diagnostics")}
              </button>
            </div>
            <div className="overflow-auto p-4">
              {logsTab === "events" ? (
                <ul className="space-y-2 text-xs text-slate-700">
                  {(events.length > 0
                    ? events.slice(-160).reverse().map((event) => `${event.createdAt} | ${event.role} | ${event.kind}`)
                    : [t("preview.none")]).map((line, index) => (
                    <li key={`${line}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="space-y-2 text-xs text-slate-700">
                  {(compileDiagnostics.length > 0 ? compileDiagnostics : [t("preview.none")]).map((line, index) => (
                    <li key={`${line}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {modelModalOpen && settings && (
        <ModelModal
          open={modelModalOpen}
          protocols={settings.modelProtocols}
          onClose={() => setModelModalOpen(false)}
          onTest={handleProtocolPing}
          onSubmit={({ protocol, model }) =>
            setSettings((prev) => {
              if (!prev) {
                return prev;
              }
              const nextProtocols = protocol.isNew
                ? [
                    ...prev.modelProtocols,
                    {
                      id: protocol.id,
                      displayName: protocol.displayName,
                      baseUrl: protocol.baseUrl,
                      apiKeySet: Boolean(protocol.apiKey),
                    },
                  ]
                : prev.modelProtocols;
              if (protocol.apiKey?.trim()) {
                setDraftApiKeys((current) => ({ ...current, [protocol.id]: protocol.apiKey ?? "" }));
              }
              return {
                ...prev,
                modelProtocols: nextProtocols,
                modelCatalog: [...prev.modelCatalog, model],
              };
            })
          }
          t={t}
        />
      )}

      {deleteIntent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-4 shadow-soft">
            <h3 className="text-sm font-semibold text-slate-800">{t("explorer.deleteConfirmTitle")}</h3>
            <p className="mt-2 text-xs text-slate-600">{deleteIntent.path}</p>
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={deleteDontAskAgain}
                onChange={(event) => setDeleteDontAskAgain(event.target.checked)}
              />
              {t("explorer.deleteDontAsk")}
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDeleteIntent(null)}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={confirmDelete}>
                {t("common.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={cn(
            "fixed bottom-4 right-4 rounded-md px-4 py-2 text-sm text-white shadow-soft",
            toast.type === "info" ? "bg-emerald-600" : "bg-rose-600",
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
