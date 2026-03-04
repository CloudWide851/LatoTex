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
  ) => Promise<void>;
  onWorkspaceRevealInSystem: (relativePath?: string) => void | Promise<void>;
  onWorkspaceOpenTerminal: (relativePath?: string) => void | Promise<void>;
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
    t,
  } = props;

  return (
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
}
