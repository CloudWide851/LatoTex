import MonacoEditor from "@monaco-editor/react";
import { AlertTriangle, FolderOpen, ListChecks, Play, Redo2, Save, Undo2 } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type {
  FsAction,
  FsScope,
  ResourceNode,
  WorkspacePage,
} from "../../shared/types/app";
import type { LogTab } from "../app-config";
import { AgentChatOverlay, type AgentMessage, type AgentPhase } from "./AgentChatOverlay";
import { ExplorerTree } from "./ExplorerTree";
import { PageRail } from "./PageRail";

type TranslationFn = (key: any) => string;

type AgentStatusKey =
  | "agent.statusIdle"
  | "agent.statusRunning"
  | "agent.statusDone"
  | "agent.statusError";

export function AppWorkspaceShell(props: {
  page: WorkspacePage;
  pageRailItems: Array<{ id: WorkspacePage; icon: any; label: string }>;
  activeProjectId: string | null;
  busy: boolean;
  shellLayout: number[];
  latexLayout: number[];
  analysisLayout: number[];
  libraryLayout: number[];
  tree: ResourceNode[];
  libraryTree: ResourceNode[];
  selectedFile: string | null;
  selectedLibraryPath: string | null;
  editorContent: string;
  pdfUrl: string | null;
  compileErrorLine: string | null;
  compileDiagnostics: string[];
  agentCollapsed: boolean;
  agentPhase: AgentPhase;
  agentStatusKey: AgentStatusKey;
  agentPrompt: string;
  agentMessages: AgentMessage[];
  shellMin: readonly [number, number];
  settingsPanel: React.ReactNode;
  gitPanel: React.ReactNode;
  onPageChange: (page: WorkspacePage) => void;
  onSelectFile: (path: string | null) => void;
  onSelectLibraryPath: (path: string | null) => void;
  onEditorChange: (value: string) => void;
  onEditorMount: (editor: any) => void;
  onAgentPromptChange: (value: string) => void;
  onAgentToggle: () => void;
  onAgentRun: () => void;
  onOpenFolder: () => void;
  onSaveFile: () => void;
  onCompile: () => void;
  onEditorUndo: () => void;
  onEditorRedo: () => void;
  onOpenLogs: (tab: LogTab) => void;
  onLibraryRescan: () => void;
  onSavePanelLayout: (panel: "shell" | "latex" | "analysis" | "library", layout: number[]) => void;
  onFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<void>;
  t: TranslationFn;
}) {
  const {
    page,
    pageRailItems,
    activeProjectId,
    busy,
    shellLayout,
    latexLayout,
    analysisLayout,
    libraryLayout,
    tree,
    libraryTree,
    selectedFile,
    selectedLibraryPath,
    editorContent,
    pdfUrl,
    compileErrorLine,
    compileDiagnostics,
    agentCollapsed,
    agentPhase,
    agentStatusKey,
    agentPrompt,
    agentMessages,
    shellMin,
    settingsPanel,
    gitPanel,
    onPageChange,
    onSelectFile,
    onSelectLibraryPath,
    onEditorChange,
    onEditorMount,
    onAgentPromptChange,
    onAgentToggle,
    onAgentRun,
    onOpenFolder,
    onSaveFile,
    onCompile,
    onEditorUndo,
    onEditorRedo,
    onOpenLogs,
    onLibraryRescan,
    onSavePanelLayout,
    onFsAction,
    t,
  } = props;

  const renderNoProjectPanel = () => (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-4 motion-slide-up">
      <p className="mb-3 text-sm text-slate-600">{t("workspace.noProject")}</p>
      <button
        className="rounded border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100"
        onClick={onOpenFolder}
        disabled={busy}
        title={t("topbar.openFolder")}
        aria-label={t("topbar.openFolder")}
      >
        <FolderOpen className="h-5 w-5" />
      </button>
    </div>
  );

  const renderWorkspaceExplorerPanel = () => (
    <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-soft motion-slide-up">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("explorer.title")}
      </h2>
      <div className="h-[calc(100%-24px)] overflow-auto pr-1">
        {activeProjectId ? (
          <ExplorerTree
            tree={tree}
            selectedPath={selectedFile}
            busy={busy}
            onSelect={onSelectFile}
            onAction={(action, path, targetPath, content) =>
              onFsAction("workspace", action, path, targetPath, content)
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
    <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-soft motion-slide-up">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t("preview.title")}</h2>
        <div className="flex items-center gap-1">
          <button
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            title={t("preview.diagnostics")}
            onClick={() => onOpenLogs("status")}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            title={t("preview.events")}
            onClick={() => onOpenLogs("events")}
          >
            <ListChecks className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {compileErrorLine && (
        <button
          className="mb-2 w-full truncate rounded border border-rose-300 bg-rose-50 px-2 py-1 text-left text-xs text-rose-700"
          onClick={() => onOpenLogs("status")}
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
      return activeProjectId ? gitPanel : renderNoProjectPanel();
    }
    if (page === "settings") {
      return settingsPanel;
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
            <button
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onEditorUndo}
              disabled={busy}
              title={t("workspace.undo")}
              aria-label={t("workspace.undo")}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onEditorRedo}
              disabled={busy}
              title={t("workspace.redo")}
              aria-label={t("workspace.redo")}
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onSaveFile}
              disabled={busy}
              title={t("workspace.save")}
              aria-label={t("workspace.save")}
            >
              <Save className="h-4 w-4" />
            </button>
            <button
              className="rounded border border-primary-600 bg-primary-600 p-1.5 text-white transition hover:bg-primary-700 disabled:opacity-50"
              onClick={onCompile}
              disabled={busy}
              title={t("workspace.compile")}
              aria-label={t("workspace.compile")}
            >
              <Play className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0">
          <MonacoEditor
            language="latex"
            value={editorContent}
            onChange={(value) => onEditorChange(value ?? "")}
            onMount={onEditorMount}
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
            onPromptChange={onAgentPromptChange}
            onRun={onAgentRun}
            onToggle={onAgentToggle}
            runLabel={t("workspace.runTaskAgent")}
            placeholder={t("workspace.agentPlaceholder")}
          />
        </div>
      </div>
    );
  };

  return (
    <main className="flex-1 min-h-0 overflow-hidden p-2">
      <PanelGroup
        direction="horizontal"
        className="h-full gap-2"
        onLayout={(layout) => onSavePanelLayout("shell", layout)}
      >
        <Panel
          defaultSize={shellLayout[0]}
          minSize={shellMin[0]}
          maxSize={shellMin[1]}
          className="min-w-[52px]"
        >
          <PageRail items={pageRailItems} activePage={page} onChange={onPageChange} />
        </Panel>
        <PanelResizeHandle className="resizable-handle" />
        <Panel defaultSize={shellLayout[1]} minSize={20}>
          {page === "latex" && activeProjectId ? (
            <PanelGroup
              direction="horizontal"
              className="h-full gap-2"
              onLayout={(layout) => onSavePanelLayout("latex", layout)}
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
              className="h-full gap-2"
              onLayout={(layout) => onSavePanelLayout("analysis", layout)}
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
              className="h-full gap-2"
              onLayout={(layout) => onSavePanelLayout("library", layout)}
            >
              <Panel defaultSize={libraryLayout[0]} minSize={20}>
                <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-soft">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("library.title")}
                  </h2>
                  <div className="h-[calc(100%-24px)] overflow-auto pr-1">
                    <ExplorerTree
                      tree={libraryTree}
                      selectedPath={selectedLibraryPath}
                      allowRescan
                      busy={busy}
                      onSelect={onSelectLibraryPath}
                      onRescan={onLibraryRescan}
                      onAction={(action, path, targetPath, content) =>
                        onFsAction("library", action, path, targetPath, content)
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
  );
}
