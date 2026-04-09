import type { FsAction } from "../../shared/types/app";

function normalizePath(path: string | null | undefined): string {
  return String(path ?? "").trim().replace(/\\/g, "/");
}

function matchesPathOrDescendant(candidate: string, target: string): boolean {
  return candidate === target || candidate.startsWith(`${target}/`);
}

export function rewriteLibrarySelectionAfterFsAction(input: {
  selectedPath: string | null;
  action: FsAction;
  path: string;
  targetPath?: string;
}): string | null {
  const selectedPath = normalizePath(input.selectedPath);
  if (!selectedPath) {
    return null;
  }

  const path = normalizePath(input.path);
  const targetPath = normalizePath(input.targetPath);
  if (!path) {
    return input.selectedPath;
  }

  if (input.action === "delete") {
    return matchesPathOrDescendant(selectedPath, path) ? null : input.selectedPath;
  }

  if ((input.action === "rename" || input.action === "move") && targetPath) {
    if (selectedPath === path) {
      return targetPath;
    }
    if (selectedPath.startsWith(`${path}/`)) {
      return `${targetPath}${selectedPath.slice(path.length)}`;
    }
  }

  return input.selectedPath;
}
