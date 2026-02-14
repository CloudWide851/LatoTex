import MonacoEditor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import {
  createProject,
  getEvents,
  getHealthCheck,
  getSettings,
  listProjects,
  openProject,
  readFile,
  recordCompile,
  runAgent,
  testProvider,
  updateSettings,
  writeFile
} from "../shared/api/desktop";
import { compileWithBusyTeX } from "../features/latex/compiler/busytex";
import type {
  AgentModelBinding,
  AppSettings,
  ProjectSummary,
  ResourceNode,
  SwarmEvent,
  WorkspacePage
} from "../shared/types/app";

type Toast = { type: "info" | "error"; message: string } | null;

const PAGE_ITEMS: Array<{ id: WorkspacePage; label: string }> = [
  { id: "latex", label: "LaTeX" },
  { id: "analysis", label: "Data" },
  { id: "library", label: "Papers" },
  { id: "settings", label: "Settings" }
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
        className={`tree-file ${selectedPath === node.relativePath ? "active" : ""}`}
        onClick={() => onSelect(node.relativePath)}
        title={node.relativePath}
      >
        {node.name}
      </button>
    );
  }
  return (
    <div className="tree-dir">
      <div className="tree-dir-label">{node.name}</div>
      <div className="tree-children">
        {node.children.map((child) => (
          <TreeNode key={child.relativePath} node={child} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

export function App() {
  const [health, setHealth] = useState("unknown");
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

  const fileList = useMemo(() => flattenFiles(tree), [tree]);

  useEffect(() => {
    const init = async () => {
      try {
        const healthData = await getHealthCheck();
        setHealth(`${healthData.app} ${healthData.version}`);
      } catch {
        setHealth("offline");
      }

      const [projectList, appSettings] = await Promise.all([listProjects(), getSettings()]);
      setProjects(projectList);
      setSettings(appSettings);

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

    init().catch((error) => {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Initialization failed."
      });
    });
  }, []);

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
      getEvents(cursor, 100)
        .then((batch) => {
          if (batch.events.length > 0) {
            setEvents((prev) => [...prev.slice(-200), ...batch.events]);
            setCursor(batch.nextCursor);
          }
        })
        .catch(() => {
          // Keep polling resilient; surfaced errors would be noisy here.
        });
    }, 2500);
    return () => clearInterval(timer);
  }, [cursor]);

  const handleCreateProject = async () => {
    const name = `Project ${new Date().toLocaleString()}`;
    const snapshot = await createProject(name);
    setProjects((prev) => [snapshot.summary, ...prev]);
    setActiveProjectId(snapshot.summary.id);
  };

  const handleSaveFile = async () => {
    if (!activeProjectId || !selectedFile) {
      return;
    }
    setBusy(true);
    try {
      await writeFile(activeProjectId, selectedFile, editorContent);
      setToast({ type: "info", message: "File saved." });
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
        const url = URL.createObjectURL(new Blob([normalizedBytes], { type: "application/pdf" }));
        setPdfUrl(url);
      }
      setCompileDiagnostics(result.diagnostics);
      if (result.status === "success") {
        setToast({ type: "info", message: "Compile succeeded." });
      } else {
        setToast({ type: "error", message: "Compile failed. Check diagnostics." });
      }
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
        agentBindings: settings.agentBindings
      });
      setSettings(updated);
      setDraftApiKeys({});
      setToast({ type: "info", message: "Settings saved." });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleProviderPing = async (provider: string) => {
    const result = await testProvider(provider);
    setToast({ type: result.ok ? "info" : "error", message: `${provider}: ${result.message}` });
  };

  const renderMainPanel = () => {
    if (page === "analysis") {
      return <div className="panel-placeholder">Data analysis panel scaffold is ready.</div>;
    }
    if (page === "library") {
      return <div className="panel-placeholder">Paper library panel scaffold is ready.</div>;
    }
    if (page === "settings") {
      return (
        <div className="settings-panel">
          <h2>Provider Settings</h2>
          {settings?.providers.map((provider) => (
            <div className="settings-card" key={provider.provider}>
              <h3>{provider.provider}</h3>
              <label>
                Base URL
                <input
                  value={provider.baseUrl}
                  onChange={(event) => {
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
                    );
                  }}
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  placeholder={provider.apiKeySet ? "Stored in system keyring" : "Not set"}
                  value={draftApiKeys[provider.provider] ?? ""}
                  onChange={(event) =>
                    setDraftApiKeys((prev) => ({ ...prev, [provider.provider]: event.target.value }))
                  }
                />
              </label>
              <button onClick={() => handleProviderPing(provider.provider)}>Test Provider</button>
            </div>
          ))}
          <h2>Agent Model Binding</h2>
          {(settings?.agentBindings ?? DEFAULT_BINDINGS).map((binding, index) => (
            <div className="binding-row" key={`${binding.role}-${index}`}>
              <span>{binding.role}</span>
              <input
                value={binding.provider}
                onChange={(event) =>
                  setSettings((prev) =>
                    prev
                      ? {
                          ...prev,
                          agentBindings: prev.agentBindings.map((item, idx) =>
                            idx === index ? { ...item, provider: event.target.value } : item
                          )
                        }
                      : prev
                  )
                }
              />
              <input
                value={binding.model}
                onChange={(event) =>
                  setSettings((prev) =>
                    prev
                      ? {
                          ...prev,
                          agentBindings: prev.agentBindings.map((item, idx) =>
                            idx === index ? { ...item, model: event.target.value } : item
                          )
                        }
                      : prev
                  )
                }
              />
            </div>
          ))}
          <button onClick={handleSaveSettings}>Save Settings</button>
        </div>
      );
    }

    return (
      <div className="editor-panel">
        <div className="editor-toolbar">
          <span>{selectedFile ?? "No file selected"}</span>
          <div className="toolbar-actions">
            <button onClick={handleSaveFile} disabled={busy}>
              Save
            </button>
            <button onClick={handleCompile} disabled={busy}>
              Compile
            </button>
          </div>
        </div>
        <MonacoEditor
          language="latex"
          value={editorContent}
          onChange={(value) => setEditorContent(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 14
          }}
        />
        <div className="agent-panel">
          <h3>Agent Task Prompt</h3>
          <textarea
            value={agentPrompt}
            onChange={(event) => setAgentPrompt(event.target.value)}
            placeholder="Describe what the task-agent should do with current LaTeX context..."
          />
          <button onClick={handleRunAgent} disabled={busy}>
            Run Task Agent
          </button>
          <pre>{agentOutput || "No agent output yet."}</pre>
        </div>
      </div>
    );
  };

  return (
    <div className="workbench-root">
      <header className="topbar">
        <div className="topbar-left">
          <h1>LatoTex</h1>
          <span className="health">{health}</span>
        </div>
        <div className="topbar-right">
          <select
            value={activeProjectId ?? ""}
            onChange={(event) => setActiveProjectId(event.target.value || null)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button onClick={handleCreateProject}>New Project</button>
        </div>
      </header>

      <main className="workbench-grid">
        <aside className="page-switcher">
          {PAGE_ITEMS.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </aside>

        <aside className="resource-explorer">
          <div className="explorer-title">Resources</div>
          <div className="explorer-tree">
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

        <section className="main-panel">{renderMainPanel()}</section>

        <aside className="preview-panel">
          <h2>PDF Preview</h2>
          {pdfUrl ? (
            <iframe title="PDF Preview" src={pdfUrl} />
          ) : (
            <p>No PDF yet. Compile from LaTeX panel.</p>
          )}
          <h3>Diagnostics</h3>
          <ul>
            {compileDiagnostics.length === 0 ? <li>None</li> : compileDiagnostics.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <h3>Swarm Events</h3>
          <div className="event-list">
            {events.slice(-16).map((event) => (
              <div key={event.id} className="event-item">
                <b>{event.role}</b>
                <span>{event.kind}</span>
              </div>
            ))}
          </div>
        </aside>
      </main>

      {toast && (
        <div className={`toast ${toast.type}`} onAnimationEnd={() => setToast(null)}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
