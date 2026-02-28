import { useMemo } from "react";
import type { GitStatusEntry } from "../../shared/types/app";

export function useExplorerGitDecorations(changes: GitStatusEntry[] | undefined) {
  return useMemo(() => {
    const map: Record<
      string,
      { code: string; ignored: boolean; staged: boolean; unstaged: boolean; untracked: boolean }
    > = {};
    for (const change of changes ?? []) {
      const index = (change.indexStatus ?? " ").trim();
      const worktree = (change.worktreeStatus ?? " ").trim();
      const ignored = Boolean(change.ignored);
      const untracked = index === "?" || worktree === "?";
      const staged = !ignored && index.length > 0 && index !== "?";
      const unstaged = !ignored && worktree.length > 0 && worktree !== "?";
      const code = ignored ? "!!" : untracked ? "U" : index || worktree || "M";
      map[change.path] = { code, ignored, staged, unstaged, untracked };
    }
    return map;
  }, [changes]);
}
