import { RefreshCcw } from "lucide-react";
import { useState } from "react";
import { archiveKnowledgeItem } from "../../../shared/api/knowledge";
import type { FsAction, FsScope, ResourceNode } from "../../../shared/types/app";
import type { AgentResourceLock } from "../../../shared/types/researchAgent";
import { researchWriteLockPaths } from "../../../shared/utils/researchResourceLock";
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
  agentResourceLocks: AgentResourceLock[];
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
  scrollbarVisible: boolean;
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
    agentResourceLocks,
    busy,
    onSelectFile,
    onFsAction,
    onWorkspaceRevealInSystem,
    onWorkspaceOpenTerminal,
    onWorkspaceRescan,
    defaultExpanded,
    scrollbarVisible,
    expandedPaths,
    onExpandedPathsChange,
    t,
  } = props;
  const [knowledgeBusyPath, setKnowledgeBusyPath] = useState<string | null>(null);
  const [knowledgeStatus, setKnowledgeStatus] = useState<string | null>(null);

  const archiveToKnowledge = async (relativePath: string) => {
    if (!activeProjectId || knowledgeBusyPath) {
      return;
    }
    setKnowledgeBusyPath(relativePath);
    setKnowledgeStatus(null);
    try {
      const result = await archiveKnowledgeItem(activeProjectId, relativePath);
      setKnowledgeStatus(
        result.semanticReminder
          ? t("knowledge.semanticUnavailable")
          : t("knowledge.archived"),
      );
      await onWorkspaceRescan();
    } catch (error) {
      const code = String(error);
      setKnowledgeStatus(
        code.includes("knowledge.archive.ocr_required")
          ? t("knowledge.error.ocrRequired")
          : code.includes("knowledge.archive.format_unsupported")
            ? t("knowledge.error.unsupported")
            : t("knowledge.error.failed"),
      );
    } finally {
      setKnowledgeBusyPath(null);
    }
  };

  return (
    <aside className="app-material-panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg border p-1.5 motion-slide-up">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("explorer.title")}</h2>
        <button
          type="button"
          className="panel-topbar-btn inline-flex h-6 w-6 items-center justify-center rounded border transition disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void onWorkspaceRescan()}
          disabled={busy || !activeProjectId}
          title={t("explorer.action.rescan")}
          aria-label={t("explorer.action.rescan")}
        >
          <RefreshCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      {knowledgeStatus ? (
        <p className="mb-1 truncate px-1 text-[10px] text-slate-500" role="status">
          {knowledgeStatus}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeProjectId ? (
          <ExplorerTree
            projectId={activeProjectId}
            tree={tree}
            selectedPath={selectedFile}
            dirtyByPath={dirtyByPath}
            gitDecorations={explorerGitDecorations}
            lockedPaths={researchWriteLockPaths(agentResourceLocks)}
            allowRescan
            busy={busy || Boolean(knowledgeBusyPath)}
            onSelect={onSelectFile}
            onAction={(action, path, targetPath, content) =>
              onFsAction("workspace", action, path, targetPath, content)
            }
            onRevealInSystem={onWorkspaceRevealInSystem}
            onOpenTerminal={onWorkspaceOpenTerminal}
            onArchiveKnowledge={archiveToKnowledge}
            onRescan={onWorkspaceRescan}
            defaultExpanded={defaultExpanded}
            scrollbarVisible={scrollbarVisible}
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
