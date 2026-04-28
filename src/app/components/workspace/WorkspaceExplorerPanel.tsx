import { RefreshCcw } from "lucide-react";
import type { FsAction, FsScope, ResourceNode } from "../../../shared/types/app";
import { ExplorerTree } from "../ExplorerTree";

type TranslationFn = (key: any) => string;

export function WorkspaceExplorerPanel(props: {
  activeProjectId: string | null;
  tree: ResourceNode[];
  selectedFile: string | null;
  dirtyByPath: Record<string, boolean>;
  explorerGitDecorations: Record<
    string,
    { code: string; ignored: boolean; staged: boolean; unstaged: boolean; untracked: boolean }
  >;
  busy: boolean;
  onSelectFile: (path: string | null) => void;
  onFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<boolean | void>;
  onWorkspaceRevealInSystem: (relativePath?: string) => void | Promise<void>;
  onWorkspaceOpenTerminal: (relativePath?: string) => void | Promise<void>;
  onWorkspaceRescan: () => void | Promise<void>;
  defaultExpanded: boolean;
  expandedPaths?: string[];
  onExpandedPathsChange: (paths: string[]) => void;
  t: TranslationFn;
}) {
  const {
    activeProjectId,
    tree,
    selectedFile,
    dirtyByPath,
    explorerGitDecorations,
    busy,
    onSelectFile,
    onFsAction,
    onWorkspaceRevealInSystem,
    onWorkspaceOpenTerminal,
    onWorkspaceRescan,
    defaultExpanded,
    expandedPaths,
    onExpandedPathsChange,
    t,
  } = props;

  return (
    <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-soft motion-slide-up">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("explorer.title")}</h2>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void onWorkspaceRescan()}
          disabled={busy || !activeProjectId}
          title={t("explorer.action.rescan")}
          aria-label={t("explorer.action.rescan")}
        >
          <RefreshCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="hide-scrollbar h-[calc(100%-24px)] overflow-auto pr-1">
        {activeProjectId ? (
          <ExplorerTree
            tree={tree}
            selectedPath={selectedFile}
            dirtyByPath={dirtyByPath}
            gitDecorations={explorerGitDecorations}
            allowRescan
            busy={busy}
            onSelect={onSelectFile}
            onAction={(action, path, targetPath, content) =>
              onFsAction("workspace", action, path, targetPath, content)
            }
            onRevealInSystem={onWorkspaceRevealInSystem}
            onOpenTerminal={onWorkspaceOpenTerminal}
            onRescan={onWorkspaceRescan}
            defaultExpanded={defaultExpanded}
            expandedPaths={expandedPaths}
            onExpandedPathsChange={onExpandedPathsChange}
            t={t}
          />
        ) : (
          <div className="text-xs text-slate-500">{t("workspace.noProject")}</div>
        )}
      </div>
    </aside>
  );
}
