import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { gitBranches, gitCheckInstalled, gitLog, gitStatus } from "../../shared/api/git";
import { getLibraryTree } from "../../shared/api/library";
import { openProject, projectIntegrityStatus } from "../../shared/api/projects";
import type { AppSettings, ResourceNode, WorkspacePage } from "../../shared/types/app";

export type ProjectIntegrityIssue = { projectId: string; missingRequired: string[] };

function collectResourceFilePaths(nodes: ResourceNode[]): Set<string> {
  const output = new Set<string>();
  const walk = (items: ResourceNode[]) => {
    for (const node of items) {
      if (node.kind === "file") {
        output.add(node.relativePath);
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

function resolvePersistedLibrarySelection(
  settings: AppSettings | null,
  projectId: string,
  papers: ResourceNode[],
): string | null {
  const selectedPath = String(
    settings?.uiPrefs?.librarySelectedPathByProject?.[projectId] ?? "",
  ).trim();
  if (!selectedPath) {
    return null;
  }
  const filePaths = collectResourceFilePaths(papers);
  return filePaths.has(selectedPath) ? selectedPath : null;
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
      setGitCommits([]);
      return;
    }
    const commits = await gitLog(projectId, 30).catch(() => []);
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

  const loadProjectData = useCallback(async (projectId: string) => {
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
    const [papers] = await Promise.all([getLibraryTree(projectId)]);
    setLibraryTree(papers);
    setSelectedLibraryPath(resolvePersistedLibrarySelection(settingsRef.current, projectId, papers));
    loadedLibraryProjectIdRef.current = projectId;
    lastLoadedProjectIdRef.current = projectId;
    await refreshGitWorkspace(projectId);
  }, [
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
