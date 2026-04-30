import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { gitBranches, gitCheckInstalled, gitLog, gitStatus } from "../../shared/api/git";
import { getLibraryTree } from "../../shared/api/library";
import { openProject, projectIntegrityStatus, projectPrepareSearchIndex } from "../../shared/api/projects";
import type { AppSettings, ResourceNode, WorkspacePage } from "../../shared/types/app";

export type ProjectIntegrityIssue = { projectId: string; missingRequired: string[] };
export type LoadProjectDataOptions = {
  includeGitRefresh?: boolean;
  deferLibraryLoad?: boolean;
};

function collectResourceFilePaths(nodes: ResourceNode[]): string[] {
  const output: string[] = [];
  const walk = (items: ResourceNode[]) => {
    for (const node of items) {
      if (node.kind === "file") {
        output.push(node.relativePath);
        continue;
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return output;
}

function firstPaperPath(paths: string[]): string | null {
  return paths.find((path) => /\.bib$/i.test(path))
    ?? paths.find((path) => /\.pdf$/i.test(path))
    ?? null;
}

function resolvePersistedLibrarySelection(
  settings: AppSettings | null,
  projectId: string,
  papers: ResourceNode[],
): string | null {
  const filePaths = collectResourceFilePaths(papers);
  const selectedPath = String(
    settings?.uiPrefs?.librarySelectedPathByProject?.[projectId] ?? "",
  ).trim().replace(/^\.latotex\/papers\/?/i, "");
  if (!selectedPath) {
    return firstPaperPath(filePaths);
  }
  return filePaths.includes(selectedPath) ? selectedPath : firstPaperPath(filePaths);
}

export function useProjectDataLoader(params: {
  page: WorkspacePage;
  activeProjectIdRef: MutableRefObject<string | null>;
  integrityCheckedRef: MutableRefObject<Set<string>>;
  lastLoadedProjectIdRef: MutableRefObject<string | null>;
  loadedLibraryProjectIdRef: MutableRefObject<string | null>;
  settingsRef: MutableRefObject<AppSettings | null>;
  setIntegrityIssue: Dispatch<SetStateAction<ProjectIntegrityIssue | null>>;
  setGitAvailability: Dispatch<SetStateAction<any>>;
  setSuppressAutoGitInstall: (value: boolean) => void;
  setGitStatusState: Dispatch<SetStateAction<any>>;
  setGitBranchesState: Dispatch<SetStateAction<any[]>>;
  setGitCommits: Dispatch<SetStateAction<any[]>>;
  setTree: (value: any[]) => void;
  setSelectedFile: (value: string | null) => void;
  setLibraryTree: (value: any[]) => void;
  setSelectedLibraryPath: (value: string | null) => void;
}) {
  const {
    page,
    activeProjectIdRef,
    integrityCheckedRef,
    lastLoadedProjectIdRef,
    loadedLibraryProjectIdRef,
    settingsRef,
    setIntegrityIssue,
    setGitAvailability,
    setSuppressAutoGitInstall,
    setGitStatusState,
    setGitBranchesState,
    setGitCommits,
    setTree,
    setSelectedFile,
    setLibraryTree,
    setSelectedLibraryPath,
  } = params;

  const refreshGitWorkspace = useCallback(async (projectIdOverride?: string) => {
    const projectId = projectIdOverride ?? activeProjectIdRef.current;
    if (!projectId) {
      return;
    }
    const availability = await gitCheckInstalled().catch(() => ({
      installed: false,
      version: undefined,
    }));
    setGitAvailability(availability);
    if (availability.installed) {
      setSuppressAutoGitInstall(false);
    }
    if (!availability.installed) {
      setGitStatusState({
        isRepo: false,
        branch: "-",
        ahead: 0,
        behind: 0,
        changes: [],
      });
      setGitBranchesState([]);
      setGitCommits([]);
      return;
    }
    const [state, branches] = await Promise.all([
      gitStatus(projectId),
      gitBranches(projectId).catch(() => []),
    ]);
    setGitStatusState(state);
    setGitBranchesState(branches);
    const shouldLoadHistory = page === "git";
    if (!shouldLoadHistory) {
      return;
    }
    const commits = await gitLog(projectId, 100).catch(() => []);
    setGitCommits(commits);
  }, [
    activeProjectIdRef,
    page,
    setGitAvailability,
    setSuppressAutoGitInstall,
    setGitStatusState,
    setGitBranchesState,
    setGitCommits,
  ]);

  const loadProjectData = useCallback(async (projectId: string, options?: LoadProjectDataOptions) => {
    if (!integrityCheckedRef.current.has(projectId)) {
      const integrity = await projectIntegrityStatus(projectId);
      if (integrity.missingRequired.length > 0) {
        setIntegrityIssue({
          projectId,
          missingRequired: integrity.missingRequired,
        });
        return;
      }
      integrityCheckedRef.current.add(projectId);
    }
    const snapshot = await openProject(projectId);
    setTree(snapshot.tree);
    setSelectedFile(snapshot.mainFile);
    void projectPrepareSearchIndex(projectId).catch(() => undefined);
    loadedLibraryProjectIdRef.current = null;
    lastLoadedProjectIdRef.current = projectId;
    setLibraryTree([]);
    setSelectedLibraryPath(null);
    const applyLibraryState = (papers: ResourceNode[]) => {
      if (activeProjectIdRef.current !== projectId) {
        return;
      }
      setLibraryTree(papers);
      setSelectedLibraryPath(resolvePersistedLibrarySelection(settingsRef.current, projectId, papers));
      loadedLibraryProjectIdRef.current = projectId;
    };

    if (options?.deferLibraryLoad) {
      void getLibraryTree(projectId)
        .then((papers) => {
          applyLibraryState(papers);
        })
        .catch(() => undefined);
    } else {
      const papers = await getLibraryTree(projectId);
      applyLibraryState(papers);
    }

    if (options?.includeGitRefresh === false) {
      return;
    }
    await refreshGitWorkspace(projectId);
  }, [
    activeProjectIdRef,
    integrityCheckedRef,
    lastLoadedProjectIdRef,
    loadedLibraryProjectIdRef,
    refreshGitWorkspace,
    setIntegrityIssue,
    setLibraryTree,
    setSelectedFile,
    setSelectedLibraryPath,
    setTree,
    settingsRef,
  ]);

  return {
    refreshGitWorkspace,
    loadProjectData,
  };
}
