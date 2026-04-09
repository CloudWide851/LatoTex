import { Suspense } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { LibraryExplorerPanel } from "./LibraryExplorerPanel";
import { WorkspaceExplorerPanel } from "./WorkspaceExplorerPanel";
import { WorkspacePanelFallback, LazyLibraryDocumentViewer } from "./workspaceShellLazy";
import type { AppWorkspaceShellProps } from "./workspaceShellTypes";

type WorkspacePageLayoutProps = Pick<
  AppWorkspaceShellProps,
  | "page"
  | "activeProjectId"
  | "busy"
  | "latexLayout"
  | "analysisLayout"
  | "libraryLayout"
  | "tree"
  | "libraryTree"
  | "selectedFile"
  | "selectedLibraryPath"
  | "dirtyByPath"
  | "explorerGitDecorations"
  | "onSelectLibraryPath"
  | "onFsAction"
  | "onWorkspaceRevealInSystem"
  | "onWorkspaceOpenTerminal"
  | "onWorkspaceRescan"
  | "onLibraryRescan"
  | "onLibraryImportPdf"
  | "onLibraryImportLink"
  | "onLibrarySyncZotero"
  | "onLibraryAnalyzePaper"
  | "analysisRunning"
  | "libraryViewMode"
  | "onLibraryViewModeChange"
  | "translationModelId"
  | "paperBriefEngine"
  | "onSavePanelLayout"
  | "t"
> & {
  renderMainPanel: () => React.ReactNode;
  renderPdfPreviewPanel: () => React.ReactNode;
  onSelectWorkspaceFile: (path: string | null) => void;
};

export function WorkspacePageLayout({
  page,
  activeProjectId,
  busy,
  latexLayout,
  analysisLayout,
  libraryLayout,
  tree,
  libraryTree,
  selectedFile,
  selectedLibraryPath,
  dirtyByPath,
  explorerGitDecorations,
  onSelectLibraryPath,
  onFsAction,
  onWorkspaceRevealInSystem,
  onWorkspaceOpenTerminal,
  onWorkspaceRescan,
  onLibraryRescan,
  onLibraryImportPdf,
  onLibraryImportLink,
  onLibrarySyncZotero,
  onLibraryAnalyzePaper,
  analysisRunning,
  libraryViewMode,
  onLibraryViewModeChange,
  translationModelId,
  paperBriefEngine,
  onSavePanelLayout,
  t,
  renderMainPanel,
  renderPdfPreviewPanel,
  onSelectWorkspaceFile,
}: WorkspacePageLayoutProps) {
  const renderLatexPanel = () => {
    if (page !== "latex" || !activeProjectId) {
      return null;
    }
    return (
      <PanelGroup
        key={`panelgroup-latex-${activeProjectId}`}
        direction="horizontal"
        className="h-full gap-px"
        onLayout={(layout) => onSavePanelLayout("latex", layout)}
      >
        <Panel className="min-w-0" id={`latex-explorer-${activeProjectId}`} order={1} defaultSize={latexLayout[0]} minSize={16}>
          <WorkspaceExplorerPanel
            activeProjectId={activeProjectId}
            tree={tree}
            selectedFile={selectedFile}
            dirtyByPath={dirtyByPath}
            explorerGitDecorations={explorerGitDecorations}
            busy={busy}
            onSelectFile={onSelectWorkspaceFile}
            onFsAction={onFsAction}
            onWorkspaceRevealInSystem={onWorkspaceRevealInSystem}
            onWorkspaceOpenTerminal={onWorkspaceOpenTerminal}
            onWorkspaceRescan={onWorkspaceRescan}
            t={t}
          />
        </Panel>
        <PanelResizeHandle className="resizable-handle" />
        <Panel className="min-w-0" id={`latex-editor-${activeProjectId}`} order={2} defaultSize={latexLayout[1]} minSize={30}>
          <section className="h-full min-h-0 min-w-0 motion-page-in">
            {renderMainPanel()}
          </section>
        </Panel>
        <PanelResizeHandle className="resizable-handle" />
        <Panel className="min-w-0" id={`latex-preview-${activeProjectId}`} order={3} defaultSize={latexLayout[2]} minSize={20}>
          {renderPdfPreviewPanel()}
        </Panel>
      </PanelGroup>
    );
  };

  const renderAnalysisPanel = () => {
    if (page !== "analysis") {
      return null;
    }
    return (
      <PanelGroup
        key={`panelgroup-analysis-${activeProjectId ?? "none"}`}
        direction="horizontal"
        className="h-full gap-px"
        onLayout={(layout) => onSavePanelLayout("analysis", layout)}
      >
        <Panel className="min-w-0" id={`analysis-explorer-${activeProjectId ?? "none"}`} order={1} defaultSize={analysisLayout[0]} minSize={18}>
          <WorkspaceExplorerPanel
            activeProjectId={activeProjectId}
            tree={tree}
            selectedFile={selectedFile}
            dirtyByPath={dirtyByPath}
            explorerGitDecorations={explorerGitDecorations}
            busy={busy}
            onSelectFile={onSelectWorkspaceFile}
            onFsAction={onFsAction}
            onWorkspaceRevealInSystem={onWorkspaceRevealInSystem}
            onWorkspaceOpenTerminal={onWorkspaceOpenTerminal}
            onWorkspaceRescan={onWorkspaceRescan}
            t={t}
          />
        </Panel>
        <PanelResizeHandle className="resizable-handle" />
        <Panel className="min-w-0" id={`analysis-main-${activeProjectId ?? "none"}`} order={2} defaultSize={analysisLayout[1]} minSize={30}>
          <section className="h-full min-h-0 min-w-0 motion-page-in">
            {renderMainPanel()}
          </section>
        </Panel>
      </PanelGroup>
    );
  };

  const renderCurrentPage = () => {
    if (!activeProjectId) {
      return (
        <section className="h-full min-h-0 min-w-0 motion-page-in">
          {renderMainPanel()}
        </section>
      );
    }
    return (
      renderLatexPanel()
      ?? renderAnalysisPanel()
      ?? (
        <section className="h-full min-h-0 min-w-0 motion-page-in">
          {renderMainPanel()}
        </section>
      )
    );
  };

  const libraryPanel = activeProjectId ? (
    <PanelGroup
      key={`panelgroup-library-${activeProjectId}`}
      direction="horizontal"
      className="h-full gap-px"
      onLayout={(layout) => onSavePanelLayout("library", layout)}
    >
      <Panel className="min-w-0" id={`library-explorer-${activeProjectId}`} order={1} defaultSize={libraryLayout[0]} minSize={20}>
        <LibraryExplorerPanel
          libraryTree={libraryTree}
          selectedLibraryPath={selectedLibraryPath}
          busy={busy}
          onSelectLibraryPath={onSelectLibraryPath}
          onFsAction={onFsAction}
          onLibraryRescan={onLibraryRescan}
          onLibraryImportPdf={onLibraryImportPdf}
          onLibraryImportLink={onLibraryImportLink}
          onLibrarySyncZotero={onLibrarySyncZotero}
          t={t}
        />
      </Panel>
      <PanelResizeHandle className="resizable-handle" />
      <Panel className="min-w-0" id={`library-viewer-${activeProjectId}`} order={2} defaultSize={libraryLayout[1]} minSize={28}>
        <section className="h-full min-h-0 min-w-0 motion-page-in">
          <Suspense fallback={<WorkspacePanelFallback label={t("common.loading")} />}>
            <LazyLibraryDocumentViewer
              projectId={activeProjectId}
              selectedPath={selectedLibraryPath}
              active={page === "library"}
              onAnalyzePaper={onLibraryAnalyzePaper}
              analysisRunning={analysisRunning}
              persistedViewMode={libraryViewMode}
              onPersistViewMode={onLibraryViewModeChange}
              translationModelId={translationModelId}
              paperBriefEngine={paperBriefEngine}
              t={t}
            />
          </Suspense>
        </section>
      </Panel>
    </PanelGroup>
  ) : null;

  if (!libraryPanel) {
    return renderCurrentPage();
  }

  return (
    <div className="relative h-full min-h-0 min-w-0">
      <section
        className={page === "library"
          ? "absolute inset-0 z-10 min-h-0 min-w-0"
          : "pointer-events-none invisible absolute inset-0 -z-10 min-h-0 min-w-0"}
        aria-hidden={page !== "library"}
      >
        {libraryPanel}
      </section>
      <section
        className={page === "library"
          ? "pointer-events-none invisible absolute inset-0 -z-10 min-h-0 min-w-0"
          : "absolute inset-0 z-10 min-h-0 min-w-0"}
        aria-hidden={page === "library"}
      >
        {renderCurrentPage()}
      </section>
    </div>
  );
}
