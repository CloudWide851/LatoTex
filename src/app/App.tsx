import MonacoEditor from "@monaco-editor/react";
import {
  FileCode2,
  Files,
  Globe,
  Library,
  PanelLeft,
  Play,
  Save,
  SearchCode,
  Settings2,
  Sparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { compileWithBusyTeX } from "../features/latex/compiler/busytex";
import { detectSystemLocale, resolveLocale, useI18n, type Locale } from "../i18n";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import {
  createProject,
  getEvents,
  getHealthCheck,
  getSettings,
  listProjects,
  openProject,
  readFile,
  recordCompile,
  runtimeLogInfo,
  runtimeLogWrite,
  runAgent,
  testProvider,
  updateSettings,
  writeFile
} from "../shared/api/desktop";
import { cn } from "../lib/utils";
import type {
  AgentModelBinding,
  AppSettings,
  ProjectSummary,
  ResourceNode,
  RuntimeLogInfo,
  SwarmEvent,
  WorkspacePage
} from "../shared/types/app";

type Toast = { type: "info" | "error"; message: string } | null;

const PAGE_ITEMS: Array<{
  id: WorkspacePage;
  key:
    | "nav.latex"
    | "nav.analysis"
    | "nav.library"
    | "nav.settings";
  icon: typeof FileCode2;
}> = [
  { id: "latex", key: "nav.latex", icon: FileCode2 },
  { id: "analysis", key: "nav.analysis", icon: SearchCode },
  { id: "library", key: "nav.library", icon: Library },
  { id: "settings", key: "nav.settings", icon: Settings2 }
];

const DEFAULT_BINDINGS: AgentModelBinding[] = [
  { role: "plan", provider: "openai", model: "gpt-4.1" },
  { role: "task", provider: "anthropic", model: "claude-3-7-sonnet-latest" },
  { role: "explore", provider: "openai", model: "gpt-4.1-mini" },
  { role: "web_search", provider: "openai", model: "gpt-4.1-mini" },
  { role: "review", provider: "gemini", model: "gemini-2.0-flash" },
  { role: "ephemeral", provider: "openai", model: "gpt-4.1-mini" }
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
          "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-600 transition",
          "hover:bg-slate-100 hover:text-slate-900",
          selectedPath === node.relativePath && "bg-primary-100 text-primary-800"
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
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
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
  const [draftApiKeys, setDraftApiKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeLogInfo | null>(null);

  const fileList = useMemo(() => flattenFiles(tree), [tree]);

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
        runtimeLogInfo()
      ]);
      setProjects(projectList);
      setSettings(appSettings);
      setRuntimeInfo(info);

      const initialLocale = resolveLocale(
        appSettings.uiPrefs?.language ??
          (typeof window !== "undefined"
            ? window.localStorage.getItem("latotex.locale")
            : null)
      );
      setLocale(initialLocale);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("latotex.locale", initialLocale);
      }

      await runtimeLogWrite(
        "INFO",
        `frontend initialization completed, installMode=${info.installMode}, version=${info.version}`
      );

      let targetProjectId = appSettings.activeProjectId;
      if (!targetProjectId && projectList.length > 0) {
        targetProjectId = projectList[0].id;
      }
      if (!targetProjectId) {
        const created = await createProject("Sample Project");
        setProjects((prev) => [created.summary, ...prev]);
        targetProjectId = created.summary.id;
      }
      setActiveProjectId(targetProjectId);
    };

    init().catch(() => {
      setToast({ type: "error", message: t("toast.initFailed") });
    });
  }, [setLocale]);

  useEffect(() => {
    if (!activeProjectId) {
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
            setEvents((prev) => [...prev.slice(-200), ...batch.events]);
            setCursor(batch.nextCursor);
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [cursor]);

  const handleCreateProject = async () => {
    const name = `Project ${new Date().toLocaleString()}`;
    const snapshot = await createProject(name);
    await runtimeLogWrite("INFO", `${t("log.projectCreated")}: ${name}`);
    setProjects((prev) => [snapshot.summary, ...prev]);
    setActiveProjectId(snapshot.summary.id);
    setToast({ type: "info", message: t("toast.projectCreated") });
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

      const result = await compileWithBusyTeX(editorContent, fileMap);
      await runtimeLogWrite(
        result.status === "success" ? "INFO" : "ERROR",
        `${t("log.compileDone")}, file=${selectedFile}, status=${result.status}, durationMs=${result.durationMs}`
      );

      await recordCompile({
        projectId: activeProjectId,
        mainFile: selectedFile,
        status: result.status,
        diagnostics: result.diagnostics,
        durationMs: result.durationMs
      });

      if (result.status === "success" && result.pdfBytes) {
        if (pdfUrl) {
          URL.revokeObjectURL(pdfUrl);
        }
        const normalizedBytes = Uint8Array.from(result.pdfBytes);
        const url = URL.createObjectURL(
          new Blob([normalizedBytes], { type: "application/pdf" })
        );
        setPdfUrl(url);
      }
      setCompileDiagnostics(result.diagnostics);
      setToast({
        type: result.status === "success" ? "info" : "error",
        message:
          result.status === "success"
            ? t("toast.compileSuccess")
            : t("toast.compileFailed")
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
        contextRefs: selectedFile ? [`file:${selectedFile}`] : []
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
        providers: settings.providers.map((provider) => ({
          provider: provider.provider,
          baseUrl: provider.baseUrl,
          apiKey: draftApiKeys[provider.provider]
        })),
        agentBindings: settings.agentBindings,
        uiPrefs: {
          language: locale
        }
      });
      await runtimeLogWrite("INFO", t("log.settingsSaved"));
      setSettings(updated);
      setDraftApiKeys({});
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
            uiPrefs: { ...(prev.uiPrefs ?? {}), language: nextLocale }
          }
        : prev
    );
  };

  const handleProviderPing = async (provider: string) => {
    const result = await testProvider(provider);
    setToast({
      type: result.ok ? "info" : "error",
      message: result.ok ? t("toast.providerOk") : t("toast.providerFail")
    });
    await runtimeLogWrite(
      result.ok ? "INFO" : "WARN",
      `provider test: ${provider}, ok=${result.ok}`
    );
  };

  const renderMainPanel = () => {
    if (page === "analysis") {
      return (
        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-500">
          {t("workspace.analysis")}
        </div>
      );
    }
    if (page === "library") {
      return (
        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-500">
          {t("workspace.library")}
        </div>
      );
    }
    if (page === "settings") {
      return (
        <div className="h-full overflow-auto rounded-2xl border border-slate-200 bg-white/85 p-5 shadow-soft">
          <div className="mb-6">
            <h2 className="mb-2 text-lg font-semibold text-slate-800">
              {t("settings.languageTitle")}
            </h2>
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

          <h2 className="mb-3 text-lg font-semibold text-slate-800">
            {t("settings.providerTitle")}
          </h2>
          <div className="space-y-3">
            {settings?.providers.map((provider) => (
              <div
                className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                key={provider.provider}
              >
                <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {provider.provider}
                </div>
                <label className="grid gap-1 text-xs text-slate-500">
                  {t("settings.baseUrl")}
                  <Input
                    value={provider.baseUrl}
                    onChange={(event) =>
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              providers: prev.providers.map((item) =>
                                item.provider === provider.provider
                                  ? { ...item, baseUrl: event.target.value }
                                  : item
                              )
                            }
                          : prev
                      )
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs text-slate-500">
                  {t("settings.apiKey")}
                  <Input
                    type="password"
                    placeholder={
                      provider.apiKeySet
                        ? t("settings.keyStored")
                        : t("settings.keyNotSet")
                    }
                    value={draftApiKeys[provider.provider] ?? ""}
                    onChange={(event) =>
                      setDraftApiKeys((prev) => ({
                        ...prev,
                        [provider.provider]: event.target.value
                      }))
                    }
                  />
                </label>
                <Button
                  variant="secondary"
                  className="w-fit"
                  onClick={() => handleProviderPing(provider.provider)}
                >
                  <Globe className="mr-2 h-4 w-4" />
                  {t("settings.testProvider")}
                </Button>
              </div>
            ))}
          </div>

          <h2 className="mb-3 mt-6 text-lg font-semibold text-slate-800">
            {t("settings.agentBindingTitle")}
          </h2>
          <div className="space-y-2">
            {(settings?.agentBindings ?? DEFAULT_BINDINGS).map((binding, index) => (
              <div
                className="grid grid-cols-[110px_minmax(120px,1fr)_minmax(180px,2fr)] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2"
                key={`${binding.role}-${index}`}
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {binding.role}
                </span>
                <Input
                  value={binding.provider}
                  onChange={(event) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            agentBindings: prev.agentBindings.map((item, idx) =>
                              idx === index
                                ? { ...item, provider: event.target.value }
                                : item
                            )
                          }
                        : prev
                    )
                  }
                />
                <Input
                  value={binding.model}
                  onChange={(event) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            agentBindings: prev.agentBindings.map((item, idx) =>
                              idx === index
                                ? { ...item, model: event.target.value }
                                : item
                            )
                          }
                        : prev
                    )
                  }
                />
              </div>
            ))}
          </div>
          <Button className="mt-4" onClick={handleSaveSettings}>
            {t("settings.saveSettings")}
          </Button>

          <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            {t("settings.hiddenHint")}
          </div>
        </div>
      );
    }

    return (
      <div className="grid h-full grid-rows-[52px_minmax(260px,1fr)_240px] rounded-2xl border border-slate-200 bg-white/85 shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-200 px-4">
          <div className="truncate text-sm font-medium text-slate-600">
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
              smoothScrolling: true
            }}
          />
        </div>
        <div className="grid grid-rows-[auto_minmax(88px,1fr)_auto_minmax(70px,1fr)] gap-2 border-t border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-700">
            {t("workspace.agentTitle")}
          </h3>
          <textarea
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
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
          <pre className="m-0 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {agentOutput || t("workspace.noAgentOutput")}
          </pre>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-3 mt-3 flex h-16 items-center justify-between rounded-2xl border border-white/40 bg-slate-900/90 px-4 text-slate-100 shadow-soft backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-700">
            <PanelLeft className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide">{t("app.brand")}</h1>
            <p
              className={cn(
                "text-xs",
                status === "ready" ? "text-emerald-300" : "text-amber-300"
              )}
            >
              {status === "ready" ? t("app.ready") : t("app.offline")}
            </p>
          </div>
        </div>
        <div className="flex w-[380px] max-w-[55vw] items-center gap-2">
          <Select
            aria-label={t("topbar.selectProject")}
            value={activeProjectId ?? ""}
            onChange={(event) => setActiveProjectId(event.target.value || null)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Button onClick={handleCreateProject}>{t("topbar.newProject")}</Button>
        </div>
      </header>

      <main
        className={cn(
          "grid flex-1 gap-3 p-3",
          page === "latex"
            ? "grid-cols-[74px_280px_minmax(480px,1fr)_minmax(340px,0.42fr)]"
            : "grid-cols-[74px_280px_minmax(620px,1fr)]",
          "max-[1280px]:grid-cols-[60px_220px_minmax(360px,1fr)]",
          "max-[1280px]:grid-rows-[minmax(420px,1fr)_minmax(280px,320px)]",
          "max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_auto_auto]"
        )}
      >
        <aside className="rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-soft backdrop-blur">
          <div className="flex flex-col gap-2 max-[900px]:flex-row">
            {PAGE_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.id}
                  variant={page === item.id ? "default" : "ghost"}
                  size="icon"
                  className="h-12 w-full flex-col gap-1 text-[11px] max-[900px]:w-20"
                  onClick={() => setPage(item.id)}
                >
                  <Icon className="h-4 w-4" />
                  <span>{t(item.key)}</span>
                </Button>
              );
            })}
          </div>
        </aside>

        <aside className="min-h-0 rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-soft">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("explorer.title")}
          </h2>
          <div className="h-[calc(100%-22px)] overflow-auto pr-1">
            {tree.map((node) => (
              <TreeNode
                key={node.relativePath}
                node={node}
                selectedPath={selectedFile}
                onSelect={setSelectedFile}
              />
            ))}
          </div>
        </aside>

        <section className="min-h-0">{renderMainPanel()}</section>

        {page === "latex" && (
          <aside className="min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-soft max-[1280px]:col-span-2 max-[900px]:col-span-1">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">
              {t("preview.title")}
            </h2>
            <div className="grid h-[calc(100%-28px)] grid-rows-[minmax(220px,1fr)_auto_auto] gap-3">
              {pdfUrl ? (
                <iframe
                  title={t("preview.title")}
                  src={pdfUrl}
                  className="h-full w-full rounded-xl border border-slate-200"
                />
              ) : (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                  {t("preview.empty")}
                </div>
              )}

              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("preview.diagnostics")}
                </h3>
                <ul className="max-h-20 overflow-auto rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                  {compileDiagnostics.length === 0 ? (
                    <li>{t("preview.none")}</li>
                  ) : (
                    compileDiagnostics.map((line) => <li key={line}>{line}</li>)
                  )}
                </ul>
              </div>

              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("preview.events")}
                </h3>
                <div className="max-h-36 overflow-auto rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
                  {events.slice(-16).map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between border-b border-slate-200 py-1 text-xs last:border-none"
                    >
                      <span className="font-medium text-slate-700">{event.role}</span>
                      <span className="text-slate-500">{event.kind}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}
      </main>

      {toast && (
        <div
          className={cn(
            "fixed bottom-4 right-4 rounded-xl px-4 py-2 text-sm text-white shadow-soft",
            toast.type === "info" ? "bg-emerald-600" : "bg-rose-600"
          )}
          onAnimationEnd={() => setToast(null)}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
