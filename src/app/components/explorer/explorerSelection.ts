import type { ResourceNode } from "../../../shared/types/app";

export function shouldAutoExpandNode(node: ResourceNode): boolean {
  return node.kind === "directory" && node.directoryRole !== "pythonVenv";
}

export function collectVisibleFilePaths(
  nodes: ResourceNode[],
  expanded: Record<string, boolean>,
): string[] {
  const visiblePaths: string[] = [];
  const walk = (items: ResourceNode[]) => {
    for (const item of items) {
      if (item.kind === "file") {
        visiblePaths.push(item.relativePath);
        continue;
      }
      if (expanded[item.relativePath] === false) {
        continue;
      }
      walk(item.children);
    }
  };
  walk(nodes);
  return visiblePaths;
}

export function resolveExplorerSelection(params: {
  current: string[];
  anchorPath: string | null;
  targetPath: string;
  visibleFilePaths: string[];
  range: boolean;
  toggle: boolean;
}): { nextSelectedPaths: string[]; nextAnchorPath: string } {
  const { current, anchorPath, targetPath, visibleFilePaths, range, toggle } = params;
  const currentSet = new Set(current);
  if (range && anchorPath) {
    const startIndex = visibleFilePaths.indexOf(anchorPath);
    const endIndex = visibleFilePaths.indexOf(targetPath);
    if (startIndex >= 0 && endIndex >= 0) {
      const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
      return {
        nextSelectedPaths: visibleFilePaths.slice(from, to + 1),
        nextAnchorPath: anchorPath,
      };
    }
  }
  if (toggle) {
    if (currentSet.has(targetPath)) {
      currentSet.delete(targetPath);
    } else {
      currentSet.add(targetPath);
    }
    const nextSelectedPaths = Array.from(currentSet);
    return {
      nextSelectedPaths: nextSelectedPaths.length > 0 ? nextSelectedPaths : [targetPath],
      nextAnchorPath: targetPath,
    };
  }
  return {
    nextSelectedPaths: [targetPath],
    nextAnchorPath: targetPath,
  };
}
