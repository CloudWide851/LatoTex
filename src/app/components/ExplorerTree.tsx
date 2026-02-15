import { FileCode2, Files } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ResourceNode } from "../../shared/types/app";

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
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-600 transition",
          "hover:bg-slate-100 hover:text-slate-900",
          selectedPath === node.relativePath && "bg-primary-100 text-primary-900",
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
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
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

export function ExplorerTree(props: {
  tree: ResourceNode[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}) {
  const { tree, selectedFile, onSelect } = props;
  return tree.map((node) => (
    <TreeNode
      key={node.relativePath}
      node={node}
      selectedPath={selectedFile}
      onSelect={onSelect}
    />
  ));
}
