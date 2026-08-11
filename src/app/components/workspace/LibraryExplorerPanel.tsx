import type { FsAction, FsScope, ResourceNode } from "../../../shared/types/app";
import { ExplorerTree } from "../ExplorerTree";

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
  ) => Promise<boolean | void>;
  defaultExpanded: boolean;
  scrollbarVisible: boolean;
  expandedPaths?: string[];
  onExpandedPathsChange: (paths: string[]) => void;
  t: TranslationFn;
}) {
  const {
    libraryTree,
    selectedLibraryPath,
    busy,
    onSelectLibraryPath,
    onFsAction,
    defaultExpanded,
    scrollbarVisible,
    expandedPaths,
    onExpandedPathsChange,
    t,
  } = props;

  const filteredLibraryTree = filterPaperNodes(libraryTree);

  return (
    <aside className="app-material-panel h-full min-h-0 overflow-hidden rounded-lg border p-1.5">
      <div className="h-full min-h-0 overflow-hidden">
        <ExplorerTree
          mode="library"
          tree={filteredLibraryTree}
          selectedPath={selectedLibraryPath}
          busy={busy}
          onSelect={onSelectLibraryPath}
          onAction={(action, path, targetPath, content) =>
            onFsAction("library", action, path, targetPath, content)
          }
          defaultExpanded={defaultExpanded}
          scrollbarVisible={scrollbarVisible}
          expandedPaths={expandedPaths}
          onExpandedPathsChange={onExpandedPathsChange}
          t={t}
        />
      </div>
    </aside>
  );
}
