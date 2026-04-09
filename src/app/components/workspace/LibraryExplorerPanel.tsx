import { RefreshCcw } from "lucide-react";
import type { FsAction, FsScope, ResourceNode } from "../../../shared/types/app";
import { ExplorerTree } from "../ExplorerTree";
import { LibraryUploadMenu } from "../LibraryUploadMenu";

type TranslationFn = (key: any) => string;

export function filterPaperNodes(nodes: ResourceNode[]): ResourceNode[] {
  const walk = (node: ResourceNode): ResourceNode | null => {
    if (node.kind === "file") {
      return /\.(pdf|bib)$/i.test(String(node.relativePath ?? "")) ? node : null;
    }
    const rawChildren = node.children
      .map((child) => walk(child))
      .filter((child): child is ResourceNode => Boolean(child));
    const bibStems = new Set(
      rawChildren
        .filter((child) => child.kind === "file" && /\.bib$/i.test(child.relativePath))
        .map((child) => child.name.replace(/\.bib$/i, "").toLowerCase()),
    );
    const children = rawChildren.filter((child) => {
      if (child.kind !== "file") {
        return true;
      }
      if (!/\.pdf$/i.test(child.relativePath)) {
        return true;
      }
      const stem = child.name.replace(/\.pdf$/i, "").toLowerCase();
      return !bibStems.has(stem);
    });
    return {
      ...node,
      children,
    };
  };

  return nodes
    .map((node) => walk(node))
    .filter((node): node is ResourceNode => Boolean(node));
}

export function LibraryExplorerPanel(props: {
  libraryTree: ResourceNode[];
  selectedLibraryPath: string | null;
  busy: boolean;
  onSelectLibraryPath: (path: string | null) => void;
  onFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<void>;
  onLibraryRescan: () => void;
  onLibraryImportPdf: () => void;
  onLibraryImportLink: (link: string) => void;
  onLibrarySyncZotero: (input: { ownerId: string; apiKey: string; scope?: "users" | "groups" }) => void;
  t: TranslationFn;
}) {
  const {
    libraryTree,
    selectedLibraryPath,
    busy,
    onSelectLibraryPath,
    onFsAction,
    onLibraryRescan,
    onLibraryImportPdf,
    onLibraryImportLink,
    onLibrarySyncZotero,
    t,
  } = props;

  const filteredLibraryTree = filterPaperNodes(libraryTree);

  return (
    <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-soft">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("library.title")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            onClick={onLibraryRescan}
            disabled={busy}
            title={t("explorer.action.rescan")}
            aria-label={t("explorer.action.rescan")}
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
          <LibraryUploadMenu
            busy={busy}
            onImportPdf={onLibraryImportPdf}
            onImportLink={onLibraryImportLink}
            onSyncZotero={onLibrarySyncZotero}
            t={t}
          />
        </div>
      </div>
      <div className="h-[calc(100%-32px)] overflow-auto pr-1">
        <ExplorerTree
          mode="library"
          tree={filteredLibraryTree}
          selectedPath={selectedLibraryPath}
          busy={busy}
          onSelect={onSelectLibraryPath}
          onAction={(action, path, targetPath, content) =>
            onFsAction("library", action, path, targetPath, content)
          }
          t={t}
        />
      </div>
    </aside>
  );
}
