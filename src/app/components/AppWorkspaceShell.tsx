import { useEffect, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { AlertTriangle, Download, FolderOpen, ListChecks, Minus, Play, Plus, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type {
  CloseTabsAction,
  EditorTab,
  FsAction,
  FsScope,
  ResourceNode,
  SwarmEvent,
  WorkspacePage,
} from "../../shared/types/app";
import type { LogTab } from "../app-config";
import { AgentChatOverlay, type AgentCommandItem, type AgentPhase } from "./AgentChatOverlay";
import { ExplorerTree } from "./ExplorerTree";
import { FilePreviewPane } from "./FilePreviewPane";
import { LibraryDocumentViewer } from "./LibraryDocumentViewer";
import { LibraryUploadMenu } from "./LibraryUploadMenu";
import { PageRail } from "./PageRail";
import { isMarkdownPath, isPdfPath } from "../../shared/utils/fileKind";
import { EditorTabsBar } from "./editor/EditorTabsBar";
import { AgentProposalMiniBar } from "./editor/AgentProposalMiniBar";
import type { AgentChatMessage, AgentFileProposal, AgentSessionSummary } from "../hooks/agentTypes";

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
  editorTabs: EditorTab[];
  activeTabId: string | null;
  dirtyByPath: Record<string, boolean>;
  compiledPdfUrl: string | null;
  selectedFilePdfUrl: string | null;
  compileErrorLine: string | null;
  compileDiagnostics: string[];
  agentCollapsed: boolean;
  agentPhase: AgentPhase;
  agentStatusKey: AgentStatusKey;
  agentPrompt: string;
  agentMessages: AgentChatMessage[];
  agentProposal: AgentFileProposal | null;
  agentRunId: string | null;
  agentSessions: AgentSessionSummary[];
  agentSessionPickerOpen: boolean;
  agentSessionPickerIndex: number;
  agentRollbackVisible: boolean;
  events: SwarmEvent[];
  explorerGitDecorations: Record<
    string,
    { code: string; ignored: boolean; staged: boolean; unstaged: boolean; untracked: boolean }
  >;
  shellMin: readonly [number, number];
  settingsPanel: React.ReactNode;
  gitPanel: React.ReactNode;
  analysisPanel: React.ReactNode;
  onPageChange: (page: WorkspacePage) => void;
  onSelectFile: (path: string | null) => void;
  onSelectLibraryPath: (path: string | null) => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabCloseAction: (action: CloseTabsAction, tabId: string) => void;
  onTabPin: (tabId: string) => void;
  onEditorChange: (value: string) => void;
  onEditorMount: (editor: any) => void;
  onAgentPromptChange: (value: string) => void;
  onAgentToggle: () => void;
  onAgentRun: () => void;
  onAgentSessionPickerOpenChange: (value: boolean) => void;
  onAgentSessionPickerIndexChange: (value: number) => void;
  onAgentSessionConfirm: () => void;
  onAgentRollback: () => void;
  onAgentAcceptProposal: (withAnalysis: boolean) => void;
  onAgentRejectProposal: () => void;
  onOpenFolder: () => void;
  onSaveFile: () => void;
  onCompile: () => void;
  onExportPdf: () => void;
  onEditorUndo: () => void;
  onEditorRedo: () => void;
  onOpenLogs: (tab: LogTab) => void;
  onLibraryRescan: () => void;
  onLibraryImportPdf: () => void;
  onLibraryImportLink: (link: string) => void;
  onWorkspaceRevealInSystem: (relativePath?: string) => void | Promise<void>;
  onWorkspaceOpenTerminal: (relativePath?: string) => void | Promise<void>;
  onSavePanelLayout: (panel: "shell" | "latex" | "analysis" | "library", layout: number[]) => void;
  previewDefaultZoom: number;
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
    editorTabs,
    activeTabId,
    dirtyByPath,
    compiledPdfUrl,
    selectedFilePdfUrl,
    compileErrorLine,
    compileDiagnostics,
    agentCollapsed,
    agentPhase,
    agentStatusKey,
    agentPrompt,
    agentMessages,
    agentProposal,
    agentRunId,
    agentSessions,
    agentSessionPickerOpen,
    agentSessionPickerIndex,
    agentRollbackVisible,
    events,
    explorerGitDecorations,
    shellMin,
    settingsPanel,
    gitPanel,
    analysisPanel,
    onPageChange,
    onSelectFile,
    onSelectLibraryPath,
    onTabSelect,
    onTabClose,
    onTabCloseAction,
    onTabPin,
    onEditorChange,
    onEditorMount,
    onAgentPromptChange,
    onAgentToggle,
    onAgentRun,
    onAgentSessionPickerOpenChange,
    onAgentSessionPickerIndexChange,
    onAgentSessionConfirm,
    onAgentRollback,
    onAgentAcceptProposal,
    onAgentRejectProposal,
    onOpenFolder,
    onSaveFile,
    onCompile,
    onExportPdf,
    onEditorUndo,
    onEditorRedo,
    onOpenLogs,
    onLibraryRescan,
    onLibraryImportPdf,
    onLibraryImportLink,
    onWorkspaceRevealInSystem,
    onWorkspaceOpenTerminal,
    onSavePanelLayout,
    previewDefaultZoom,
    onFsAction,
    t,
  } = props;

  const [previewZoom, setPreviewZoom] = useState(1);
  const clampPreviewZoom = (value: number) => Math.max(0.5, Math.min(3, Number(value.toFixed(2))));

  useEffect(() => {
    setPreviewZoom(clampPreviewZoom(previewDefaultZoom || 1));
  }, [previewDefaultZoom]);

  const composeTitleWithShortcut = (label: string, shortcut: string) => `${label} (${shortcut})`;
  const selectedIsPdf = isPdfPath(selectedFile);
  const selectedIsMarkdown = isMarkdownPath(selectedFile);
  const previewMode: "pdf" | "markdown" | "empty" = selectedIsPdf
    ? selectedFilePdfUrl
      ? "pdf"
      : "empty"
    : selectedIsMarkdown
      ? "markdown"
      : compiledPdfUrl
        ? "pdf"
        : "empty";
  const previewPdfUrl = selectedIsPdf ? selectedFilePdfUrl : compiledPdfUrl;
  const canZoomPreview = previewMode === "pdf" && Boolean(previewPdfUrl);
  const agentCommandItems: AgentCommandItem[] = [
    { token: "/review", label: t("agent.command.review.label"), description: t("agent.command.review.description") },
    { token: "/check-ref", label: t("agent.command.checkRef.label"), description: t("agent.command.checkRef.description") },
    { token: "/new", label: t("agent.command.new.label"), description: t("agent.command.new.description") },
    { token: "/memory", label: t("agent.command.memory.label"), description: t("agent.command.memory.description") },
    { token: "/resume", label: t("agent.command.resume.label"), description: t("agent.command.resume.description") },
  ];
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
            dirtyByPath={dirtyByPath}
            gitDecorations={explorerGitDecorations}
            busy={busy}
            onSelect={onSelectFile}
            onAction={(action, path, targetPath, content) =>
              onFsAction("workspace", action, path, targetPath, content)
            }
            onRevealInSystem={onWorkspaceRevealInSystem}
            onOpenTerminal={onWorkspaceOpenTerminal}
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
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            title={composeTitleWithShortcut(t("preview.savePdf"), t("shortcut.exportPdf"))}
            aria-label={composeTitleWithShortcut(t("preview.savePdf"), t("shortcut.exportPdf"))}
            onClick={onExportPdf}
            disabled={!compiledPdfUrl}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
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
          <button
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            title={t("preview.zoomOut")}
            aria-label={t("preview.zoomOut")}
            onClick={() => setPreviewZoom((prev) => clampPreviewZoom(prev - 0.1))}
            disabled={!canZoomPreview || previewZoom <= 0.5}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            title={t("preview.zoomIn")}
            aria-label={t("preview.zoomIn")}
            onClick={() => setPreviewZoom((prev) => clampPreviewZoom(prev + 0.1))}
            disabled={!canZoomPreview || previewZoom >= 3}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            title={t("preview.zoomReset")}
            aria-label={t("preview.zoomReset")}
            onClick={() => setPreviewZoom(clampPreviewZoom(previewDefaultZoom || 1))}
            disabled={!canZoomPreview}
          >
            <RotateCcw className="h-3.5 w-3.5" />
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
        <FilePreviewPane
          mode={previewMode}
          pdfUrl={previewPdfUrl ?? null}
          markdownContent={selectedIsMarkdown ? editorContent : ""}
          title={t("preview.title")}
          emptyText={selectedIsMarkdown ? t("preview.markdownEmpty") : t("preview.empty")}
          pdfZoom={previewZoom}
          onPdfZoomChange={(nextZoom) => setPreviewZoom(clampPreviewZoom(nextZoom))}
        />
      </div>
    </aside>
  );

  const renderMainPanel = () => {
    if (page === "analysis") {
      return <section className="h-full min-h-0">{analysisPanel}</section>;
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
      <div className="grid h-full grid-rows-[44px_34px_minmax(260px,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft motion-slide-up">
        <div className="flex items-center justify-end border-b border-slate-200 px-3">
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onEditorUndo}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.undo"), t("shortcut.undo"))}
              aria-label={composeTitleWithShortcut(t("workspace.undo"), t("shortcut.undo"))}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onEditorRedo}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.redo"), t("shortcut.redo"))}
              aria-label={composeTitleWithShortcut(t("workspace.redo"), t("shortcut.redo"))}
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              onClick={onSaveFile}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.save"), t("shortcut.save"))}
              aria-label={composeTitleWithShortcut(t("workspace.save"), t("shortcut.save"))}
            >
              <Save className="h-4 w-4" />
            </button>
            <button
              className="rounded border border-primary-600 bg-primary-600 p-1.5 text-white transition hover:bg-primary-700 disabled:opacity-50"
              onClick={onCompile}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.compile"), t("shortcut.compile"))}
              aria-label={composeTitleWithShortcut(t("workspace.compile"), t("shortcut.compile"))}
            >
              <Play className="h-4 w-4" />
            </button>
          </div>
        </div>

        <EditorTabsBar
          tabs={editorTabs}
          activeTabId={activeTabId}
          dirtyByPath={dirtyByPath}
          busy={busy}
          onSelect={onTabSelect}
          onClose={onTabClose}
          onCloseAction={onTabCloseAction}
          onPin={onTabPin}
          t={t}
        />

        <div className="relative min-h-0">
          {agentProposal ? (
            <AgentProposalMiniBar
              proposal={agentProposal}
              busy={busy}
              onAccept={() => onAgentAcceptProposal(false)}
              onReject={onAgentRejectProposal}
              t={t}
            />
          ) : null}
          <MonacoEditor
            language="latex"
            value={editorContent}
            onChange={(value) => onEditorChange(value ?? "")}
            onMount={onEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              smoothScrolling: true,
              automaticLayout: true,
              wordWrap: "on",
              wordWrapColumn: 0,
              wrappingIndent: "same",
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
            proposal={agentProposal}
            runId={agentRunId}
            sessions={agentSessions}
            sessionPickerOpen={agentSessionPickerOpen}
            sessionPickerIndex={agentSessionPickerIndex}
            rollbackVisible={agentRollbackVisible}
            events={events}
            onPromptChange={onAgentPromptChange}
            onRun={onAgentRun}
            onSessionPickerOpenChange={onAgentSessionPickerOpenChange}
            onSessionPickerIndexChange={onAgentSessionPickerIndexChange}
            onSessionConfirm={onAgentSessionConfirm}
            onRollback={onAgentRollback}
            onToggle={onAgentToggle}
            onAcceptProposal={onAgentAcceptProposal}
            onRejectProposal={onAgentRejectProposal}
            runLabel={agentPhase === "running" ? t("agent.run.cancel") : t("workspace.runTaskAgent")}
            placeholder={t("workspace.agentPlaceholder")}
            activityShowLabel={t("agent.activityShow")}
            activityHideLabel={t("agent.activityHide")}
            applyLabel={t("agent.proposalApply")}
            rejectLabel={t("agent.proposalReject")}
            autoAnalyzeLabel={t("agent.proposalAutoAnalyze")}
            showMoreLabel={t("agent.showMore")}
            showLessLabel={t("agent.showLess")}
            commands={agentCommandItems}
            resumeTitle={t("agent.resume.title")}
            resumeHint={t("agent.resume.hint")}
            resumeEmptyLabel={t("agent.resume.empty")}
            rollbackLabel={t("agent.rollback.restore")}
          />
        </div>
      </div>
    );
  };

  return (
    <main className="flex-1 min-h-0 overflow-hidden p-1">
      <div className="flex h-full gap-0">
        <div className="w-14 shrink-0">
          <PageRail items={pageRailItems} activePage={page} onChange={onPageChange} />
        </div>
        <div className="min-w-0 flex-1">
          {page === "latex" && activeProjectId ? (
            <PanelGroup
              key={`panelgroup-latex-${activeProjectId}`}
              direction="horizontal"
              className="h-full gap-px"
              onLayout={(layout) => onSavePanelLayout("latex", layout)}
            >
              <Panel id={`latex-explorer-${activeProjectId}`} order={1} defaultSize={latexLayout[0]} minSize={16}>
                {renderWorkspaceExplorerPanel()}
              </Panel>
              <PanelResizeHandle className="resizable-handle" />
              <Panel id={`latex-editor-${activeProjectId}`} order={2} defaultSize={latexLayout[1]} minSize={30}>
                <section key={page} className="h-full min-h-0 motion-page-in">
                  {renderMainPanel()}
                </section>
              </Panel>
              <PanelResizeHandle className="resizable-handle" />
              <Panel id={`latex-preview-${activeProjectId}`} order={3} defaultSize={latexLayout[2]} minSize={20}>
                {renderPdfPreviewPanel()}
              </Panel>
            </PanelGroup>
          ) : page === "analysis" ? (
            <PanelGroup
              key={`panelgroup-analysis-${activeProjectId ?? "none"}`}
              direction="horizontal"
              className="h-full gap-px"
              onLayout={(layout) => onSavePanelLayout("analysis", layout)}
            >
              <Panel id={`analysis-explorer-${activeProjectId ?? "none"}`} order={1} defaultSize={analysisLayout[0]} minSize={18}>
                {renderWorkspaceExplorerPanel()}
              </Panel>
              <PanelResizeHandle className="resizable-handle" />
              <Panel id={`analysis-main-${activeProjectId ?? "none"}`} order={2} defaultSize={analysisLayout[1]} minSize={30}>
                <section key={page} className="h-full min-h-0 motion-page-in">
                  {renderMainPanel()}
                </section>
              </Panel>
            </PanelGroup>
          ) : page === "library" && activeProjectId ? (
            <PanelGroup
              key={`panelgroup-library-${activeProjectId}`}
              direction="horizontal"
              className="h-full gap-px"
              onLayout={(layout) => onSavePanelLayout("library", layout)}
            >
              <Panel id={`library-explorer-${activeProjectId}`} order={1} defaultSize={libraryLayout[0]} minSize={20}>
                <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-soft">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("library.title")}
                    </h2>
                    <LibraryUploadMenu
                      busy={busy}
                      onImportPdf={onLibraryImportPdf}
                      onImportLink={onLibraryImportLink}
                      t={t}
                    />
                  </div>
                  <div className="h-[calc(100%-32px)] overflow-auto pr-1">
                    <ExplorerTree
                      mode="library"
                      tree={libraryTree}
                      selectedPath={selectedLibraryPath}
                      allowRescan
                      busy={busy}
                      onSelect={onSelectLibraryPath}
                      onRescan={onLibraryRescan}
                      onImportPdf={onLibraryImportPdf}
                      onImportLink={onLibraryImportLink}
                      onAction={() => Promise.resolve()}
                      t={t}
                    />
                  </div>
                </aside>
              </Panel>
              <PanelResizeHandle className="resizable-handle" />
              <Panel id={`library-viewer-${activeProjectId}`} order={2} defaultSize={libraryLayout[1]} minSize={28}>
                <section className="h-full min-h-0 motion-page-in">
                  <LibraryDocumentViewer
                    projectId={activeProjectId}
                    selectedPath={selectedLibraryPath}
                    t={t}
                  />
                </section>
              </Panel>
            </PanelGroup>
          ) : (
            <section key={page} className="h-full min-h-0 motion-page-in">
              {renderMainPanel()}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
