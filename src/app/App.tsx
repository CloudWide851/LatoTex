import MonacoEditor from "@monaco-editor/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Bot,
  FileCode2,
  Files,
  FolderOpen,
  Globe,
  Languages,
  Library,
  Maximize2,
  Minimize2,
  Minus,
  Play,
  Save,
  SearchCode,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { compileWithBusyTeX } from "../features/latex/compiler/busytex";
import { detectSystemLocale, resolveLocale, useI18n, type Locale } from "../i18n";
import { cn } from "../lib/utils";
import {
  getEvents,
  getHealthCheck,
  getSettings,
  initProjectFromFolder,
  listProjects,
  openProject,
  readFile,
  recordCompile,
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
type OverlayType = "diagnostics" | "events" | null;

const PAGE_ITEMS: Array<{
  id: WorkspacePage;
  key: "nav.latex" | "nav.analysis" | "nav.library" | "nav.settings";
  icon: typeof FileCode2;
}> = [
  { id: "latex", key: "nav.latex", icon: FileCode2 },
  { id: "analysis", key: "nav.analysis", icon: SearchCode },
  { id: "library", key: "nav.library", icon: Library },
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

function TreeNode(props: {
  node: ResourceNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const { node, selectedPath, onSelect } = props;
  if (node.kind === "file") {
    return (
      <button
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-600 transition",
          "hover:bg-slate-100 hover:text-slate-900",
          selectedPath === node.relativePath && "bg-primary-100 text-primary-900",
        )}
        onClick={() => onSelect(node.relativePath)}
        title={node.relativePath}
      >
        <FileCode2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Files className="h-3.5 w-3.5" />
        <span>{node.name}</span>
      </div>
      <div className="ml-3 space-y-1 border-l border-dashed border-slate-200 pl-2">
        {node.children.map((child) => (
          <TreeNode
            key={child.relativePath}
            node={child}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function LogOverlay(props: { title: string; lines: string[]; onClose: () => void }) {
  const { title, lines, onClose } = props;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
      <div className="grid h-[70vh] w-full max-w-3xl grid-rows-[48px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-200 px-4">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button
            className="flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-auto px-4 py-3">
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">-</p>
          ) : (
            <ul className="space-y-2 text-xs text-slate-700">
              {lines.map((line, index) => (
                <li
                  key={`${line}-${index}`}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { locale, setLocale, t } = useI18n();
  const [status, setStatus] = useState<"ready" | "offline">("ready");
  const [toast, setToast] = useState<Toast>(null);
  const [page, setPage] = useState<WorkspacePage>("latex");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [tree, setTree] = useState<ResourceNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentOutput, setAgentOutput] = useState("");
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [compileDiagnostics, setCompileDiagnostics] = useState<string[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [draftApiKeys, setDraftApiKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeLogInfo | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [overlay, setOverlay] = useState<OverlayType>(null);
  const [diagIndex, setDiagIndex] = useState(0);
  const [eventIndex, setEventIndex] = useState(0);

  const isTauriRuntime =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const fileList = useMemo(() => flattenFiles(tree), [tree]);
  const pageLabel = useMemo(
    () => t(PAGE_ITEMS.find((item) => item.id === page)?.key ?? "nav.latex"),
    [page, t],
  );

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
    };

    init().catch(() => {
      setToast({ type: "error", message: t("toast.initFailed") });
    });
  }, [setLocale, t]);

  useEffect(() => {
    if (!activeProjectId) {
      setTree([]);
      setSelectedFile(null);
      setEditorContent("");
      return;
    }
    openProject(activeProjectId)
      .then((snapshot) => {
        setTree(snapshot.tree);
        setSelectedFile(snapshot.mainFile);
      })
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
        setIsMaximized(await appWindow.isMaximized());
      });
    };

    syncWindowState().catch(() => undefined);
    return () => {
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
    if (compileDiagnostics.length <= 1) {
      setDiagIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setDiagIndex((prev) => (prev + 1) % compileDiagnostics.length);
    }, 2000);
    return () => clearInterval(timer);
  }, [compileDiagnostics]);

  useEffect(() => {
    if (events.length <= 1) {
      setEventIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setEventIndex((prev) => (prev + 1) % events.length);
    }, 2000);
    return () => clearInterval(timer);
  }, [events]);

  const handleWindowControl = async (action: "minimize" | "toggle" | "close") => {
    if (!isTauriRuntime) {
      setToast({ type: "error", message: t("toast.windowUnavailable") });
      return;
    }
    try {
      const appWindow = getCurrentWindow();
      if (action === "minimize") {
        await appWindow.minimize();
        return;
      }
      if (action === "toggle") {
        await appWindow.toggleMaximize();
        setIsMaximized(await appWindow.isMaximized());
        return;
      }
      await appWindow.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message: t("toast.windowActionFailed") });
      await runtimeLogWrite("ERROR", `window action failed: ${message}`);
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
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleRunAgent = async () => {
    if (!activeProjectId || !agentPrompt.trim()) {
      return;
    }
    setBusy(true);
    try {
      const response = await runAgent({
        projectId: activeProjectId,
        role: "task",
        prompt: agentPrompt,
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
      });
      await runtimeLogWrite("INFO", `${t("log.agentRunDone")}, runId=${response.runId}`);
      setAgentOutput(response.output);
      setAgentPrompt("");
    } catch (error) {
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
      const updated = await updateSettings({
        activeProjectId,
        modelProtocols: settings.modelProtocols.map((protocol) => ({
          id: protocol.id,
          displayName: protocol.displayName,
          baseUrl: protocol.baseUrl,
          apiKey: draftApiKeys[protocol.id],
        })),
        modelCatalog: settings.modelCatalog.map((model) => ({
          id: model.id,
          protocolId: model.protocolId,
          displayName: model.displayName,
          requestName: model.requestName,
        })),
        agentBindings: settings.agentBindings,
        uiPrefs: { language: locale },
      });
      setSettings(updated);
      setDraftApiKeys({});
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
            uiPrefs: { ...(prev.uiPrefs ?? {}), language: nextLocale },
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
  };

  const handleAddModel = (protocolId: string) => {
    const now = Date.now();
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            modelCatalog: [
              ...prev.modelCatalog,
              {
                id: `custom-${protocolId}-${now}`,
                protocolId,
                displayName: `Custom ${now}`,
                requestName: "",
              },
            ],
          }
        : prev,
    );
  };

  const activeModelCatalog = settings?.modelCatalog ?? DEFAULT_CATALOG;
  const sessionLogName = useMemo(() => {
    if (!runtimeInfo?.sessionLogFile) {
      return "-";
    }
    const parts = runtimeInfo.sessionLogFile.split(/[\\/]/);
    return parts[parts.length - 1] || runtimeInfo.sessionLogFile;
  }, [runtimeInfo?.sessionLogFile]);

  const renderSettingsPanel = () => {
    const localSettings = settings ?? {
      activeProjectId,
      modelProtocols: DEFAULT_PROTOCOLS,
      modelCatalog: DEFAULT_CATALOG,
      agentBindings: DEFAULT_BINDINGS,
      uiPrefs: { language: locale },
    };

    return (
      <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft max-[980px]:grid-cols-1">
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
            </div>
          )}

          {settingsSection === "models" && (
            <div className="space-y-5">
              <h3 className="text-sm font-semibold text-slate-800">
                {t("settings.modelManagementTitle")}
              </h3>
              {localSettings.modelProtocols.map((protocol) => (
                <div
                  key={protocol.id}
                  className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Input
                      value={protocol.displayName}
                      className="max-w-xs"
                      onChange={(event) =>
                        setSettings((prev) =>
                          prev
                            ? {
                                ...prev,
                                modelProtocols: prev.modelProtocols.map((item) =>
                                  item.id === protocol.id
                                    ? { ...item, displayName: event.target.value }
                                    : item,
                                ),
                              }
                            : prev,
                        )
                      }
                    />
                    <span className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-500">
                      {protocol.apiKeySet
                        ? t("settings.protocolConnected")
                        : t("settings.protocolNotConnected")}
                    </span>
                  </div>

                  <label className="grid gap-1 text-xs text-slate-500">
                    {t("settings.baseUrl")}
                    <Input
                      value={protocol.baseUrl}
                      onChange={(event) =>
                        setSettings((prev) =>
                          prev
                            ? {
                                ...prev,
                                modelProtocols: prev.modelProtocols.map((item) =>
                                  item.id === protocol.id
                                    ? { ...item, baseUrl: event.target.value }
                                    : item,
                                ),
                              }
                            : prev,
                        )
                      }
                    />
                  </label>

                  <label className="grid gap-1 text-xs text-slate-500">
                    {t("settings.apiKey")}
                    <Input
                      type="password"
                      placeholder={
                        protocol.apiKeySet
                          ? t("settings.keyStored")
                          : t("settings.keyNotSet")
                      }
                      value={draftApiKeys[protocol.id] ?? ""}
                      onChange={(event) =>
                        setDraftApiKeys((prev) => ({
                          ...prev,
                          [protocol.id]: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("settings.modelCatalogTitle")}
                      </h4>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleAddModel(protocol.id)}
                      >
                        {t("settings.addModel")}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {localSettings.modelCatalog
                        .filter((item) => item.protocolId === protocol.id)
                        .map((model) => (
                          <div
                            key={model.id}
                            className="grid grid-cols-[minmax(140px,1fr)_minmax(180px,1fr)_auto] items-center gap-2 rounded-md border border-slate-200 bg-white p-2 max-[980px]:grid-cols-1"
                          >
                            <Input
                              value={model.displayName}
                              onChange={(event) =>
                                setSettings((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        modelCatalog: prev.modelCatalog.map((item) =>
                                          item.id === model.id
                                            ? { ...item, displayName: event.target.value }
                                            : item,
                                        ),
                                      }
                                    : prev,
                                )
                              }
                            />
                            <Input
                              value={model.requestName}
                              onChange={(event) =>
                                setSettings((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        modelCatalog: prev.modelCatalog.map((item) =>
                                          item.id === model.id
                                            ? { ...item, requestName: event.target.value }
                                            : item,
                                        ),
                                      }
                                    : prev,
                                )
                              }
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setSettings((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        modelCatalog: prev.modelCatalog.filter(
                                          (item) => item.id !== model.id,
                                        ),
                                        agentBindings: prev.agentBindings.map((binding) =>
                                          binding.modelId === model.id
                                            ? {
                                                ...binding,
                                                modelId:
                                                  DEFAULT_BINDINGS.find(
                                                    (it) => it.role === binding.role,
                                                  )?.modelId ?? binding.modelId,
                                              }
                                            : binding,
                                        ),
                                      }
                                    : prev,
                                )
                              }
                            >
                              {t("settings.removeModel")}
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    className="w-fit"
                    onClick={() => handleProtocolPing(protocol.id)}
                  >
                    <Globe className="mr-2 h-4 w-4" />
                    {t("settings.testProtocol")}
                  </Button>
                </div>
              ))}
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
    <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-4">
      <p className="mb-3 text-sm text-slate-600">{t("workspace.noProject")}</p>
      <Button onClick={handleInitProjectFromFolder} disabled={busy}>
        <FolderOpen className="mr-2 h-4 w-4" />
        {t("topbar.openFolder")}
      </Button>
    </div>
  );

  const renderMainPanel = () => {
    if (page === "analysis") {
      return (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
          {t("workspace.analysis")}
        </div>
      );
    }
    if (page === "library") {
      return (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
          {t("workspace.library")}
        </div>
      );
    }
    if (page === "settings") {
      return renderSettingsPanel();
    }
    if (!activeProjectId) {
      return renderNoProjectPanel();
    }

    return (
      <div className="grid h-full grid-rows-[48px_minmax(260px,1fr)_250px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
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

        <div className="min-h-0">
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
        </div>

        <div className="grid grid-rows-[auto_minmax(88px,1fr)_auto_minmax(70px,1fr)] gap-2 border-t border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-700">{t("workspace.agentTitle")}</h3>
          <textarea
            className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
            value={agentPrompt}
            onChange={(event) => setAgentPrompt(event.target.value)}
            placeholder={t("workspace.agentPlaceholder")}
          />
          <Button
            className="w-fit"
            onClick={handleRunAgent}
            disabled={busy}
            variant="secondary"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {t("workspace.runTaskAgent")}
          </Button>
          <pre className="m-0 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {agentOutput || t("workspace.noAgentOutput")}
          </pre>
        </div>
      </div>
    );
  };

  const activeDiagnosticsLine =
    compileDiagnostics.length > 0
      ? compileDiagnostics[diagIndex % compileDiagnostics.length]
      : t("preview.none");
  const activeEventLine =
    events.length > 0
      ? `${events[eventIndex % events.length].role} · ${
          events[eventIndex % events.length].kind
        }`
      : t("preview.none");

  return (
    <div className="flex h-screen flex-col gap-3 overflow-hidden bg-slate-100 p-3">
      <header className="flex h-11 items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-2 text-zinc-100 shadow-soft">
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

        <div className="flex w-[500px] max-w-[56vw] items-center gap-2">
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
          <Button
            className="h-8 border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            variant="secondary"
            onClick={handleInitProjectFromFolder}
            disabled={busy}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("topbar.openFolder")}
          </Button>
        </div>

        <div className="flex items-center">
          <button
            aria-label={t("window.minimize")}
            className="flex h-8 w-10 items-center justify-center rounded text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-40"
            onClick={() => handleWindowControl("minimize")}
            disabled={!isTauriRuntime}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            aria-label={t("window.maximize")}
            className="flex h-8 w-10 items-center justify-center rounded text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-40"
            onClick={() => handleWindowControl("toggle")}
            disabled={!isTauriRuntime}
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
            disabled={!isTauriRuntime}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main
        className={cn(
          "grid flex-1 min-h-0 gap-3 overflow-hidden",
          page === "latex"
            ? "grid-cols-[70px_260px_minmax(460px,1fr)_minmax(320px,0.38fr)]"
            : "grid-cols-[70px_260px_minmax(620px,1fr)]",
          "max-[1380px]:grid-cols-[60px_230px_minmax(360px,1fr)]",
          "max-[1380px]:grid-rows-[minmax(420px,1fr)_minmax(280px,340px)]",
          "max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_auto_auto]",
        )}
      >
        <aside className="rounded-lg border border-slate-200 bg-white p-2 shadow-soft">
          <div className="flex flex-col gap-2 max-[900px]:flex-row">
            {PAGE_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.id}
                  variant={page === item.id ? "default" : "ghost"}
                  size="icon"
                  className="h-12 w-full flex-col gap-1 rounded-md text-[11px] max-[900px]:w-20"
                  onClick={() => setPage(item.id)}
                >
                  <Icon className="h-4 w-4" />
                  <span>{t(item.key)}</span>
                </Button>
              );
            })}
          </div>
        </aside>

        <aside className="min-h-0 rounded-lg border border-slate-200 bg-white p-3 shadow-soft">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("explorer.title")}
          </h2>
          <div className="h-[calc(100%-22px)] overflow-auto pr-1">
            {activeProjectId ? (
              tree.map((node) => (
                <TreeNode
                  key={node.relativePath}
                  node={node}
                  selectedPath={selectedFile}
                  onSelect={setSelectedFile}
                />
              ))
            ) : (
              <div className="text-xs text-slate-500">{t("workspace.noProject")}</div>
            )}
          </div>
        </aside>

        <section className="min-h-0">{renderMainPanel()}</section>

        {page === "latex" && (
          <aside className="min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-soft max-[1380px]:col-span-2 max-[900px]:col-span-1">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">{t("preview.title")}</h2>
            <div className="grid h-[calc(100%-28px)] grid-rows-[minmax(220px,1fr)_auto] gap-3">
              {pdfUrl ? (
                <iframe
                  title={t("preview.title")}
                  src={pdfUrl}
                  className="h-full w-full rounded-lg border border-slate-200"
                />
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                  {t("preview.empty")}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="grid min-h-16 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-slate-200 bg-slate-50 p-2 text-left"
                  onClick={() => setOverlay("diagnostics")}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("preview.diagnostics")}
                  </span>
                  <span className="truncate text-xs text-slate-700">{activeDiagnosticsLine}</span>
                </button>
                <button
                  className="grid min-h-16 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-slate-200 bg-slate-50 p-2 text-left"
                  onClick={() => setOverlay("events")}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("preview.events")}
                  </span>
                  <span className="truncate text-xs text-slate-700">{activeEventLine}</span>
                </button>
              </div>
            </div>
          </aside>
        )}
      </main>

      {overlay === "diagnostics" && (
        <LogOverlay
          title={t("preview.diagnostics")}
          lines={compileDiagnostics.length > 0 ? compileDiagnostics : [t("preview.none")]}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay === "events" && (
        <LogOverlay
          title={t("preview.events")}
          lines={
            events.length > 0
              ? events
                  .slice(-120)
                  .reverse()
                  .map((event) => `${event.createdAt} | ${event.role} | ${event.kind}`)
              : [t("preview.none")]
          }
          onClose={() => setOverlay(null)}
        />
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
