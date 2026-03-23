import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { gitBranches, gitCheckInstalled, gitLog, gitStatus } from "../../shared/api/git";
import { getLibraryTree } from "../../shared/api/library";
import { openProject, projectIntegrityStatus } from "../../shared/api/projects";
import type { WorkspacePage } from "../../shared/types/app";

export type ProjectIntegrityIssue = { projectId: string; missingRequired: string[] };

export function useProjectDataLoader(params: {
  page: WorkspacePage;
  activeProjectIdRef: MutableRefObject<string | null>;
  integrityCheckedRef: MutableRefObject<Set<string>>;
  lastLoadedProjectIdRef: MutableRefObject<string | null>;
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
    setSelectedLibraryPath(null);
    lastLoadedProjectIdRef.current = projectId;
    await refreshGitWorkspace(projectId);
  }, [
    integrityCheckedRef,
    lastLoadedProjectIdRef,
    refreshGitWorkspace,
    setIntegrityIssue,
    setLibraryTree,
    setSelectedFile,
    setSelectedLibraryPath,
    setTree,
  ]);

  return {
    refreshGitWorkspace,
    loadProjectData,
  };
}
