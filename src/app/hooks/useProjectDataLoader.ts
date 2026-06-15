import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { gitBranches, gitCheckInstalled, gitLog, gitStatus } from "../../shared/api/git";
import { getLibraryTree } from "../../shared/api/library";
import { openProject, projectIntegrityStatus, projectPrepareSearchIndex } from "../../shared/api/projects";
import { runtimeLogWrite } from "../../shared/api/runtime";
import type { AppSettings, ResourceNode, WorkspacePage } from "../../shared/types/app";
import { saveProjectSearchReadyMetric } from "./useProjectSearchReadyMetric";

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

const SEARCH_WARMUP_BIB_LIMIT = 8;
const SEARCH_WARMUP_TEX_SIBLING_LIMIT = 4;

function normalizeProjectPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function parentDir(value: string): string {
  const index = value.lastIndexOf("/");
  return index >= 0 ? value.slice(0, index) : "";
}

function pushUnique(paths: string[], value: string) {
  const normalized = normalizeProjectPath(value);
  if (normalized && !paths.includes(normalized)) {
    paths.push(normalized);
  }
}

function bySearchWarmupAffinity(mainDir: string) {
  return (left: string, right: string) => {
    const leftDir = parentDir(left);
    const rightDir = parentDir(right);
    const leftScore = leftDir === mainDir ? 0 : leftDir === "" ? 1 : 2;
    const rightScore = rightDir === mainDir ? 0 : rightDir === "" ? 1 : 2;
    return leftScore - rightScore
      || left.length - right.length
      || left.localeCompare(right);
  };
}

export function collectSearchWarmupFocusPaths(tree: ResourceNode[], mainFile: string): string[] {
  const filePaths = collectResourceFilePaths(tree).map(normalizeProjectPath).filter(Boolean);
  const fallbackMain = filePaths.find((path) => /\.tex$/i.test(path)) ?? "";
  const normalizedMain = normalizeProjectPath(mainFile) || fallbackMain;
  const mainDir = parentDir(normalizedMain);
  const focusPaths: string[] = [];
  pushUnique(focusPaths, normalizedMain);

  filePaths
    .filter((path) => /\.bib$/i.test(path))
    .sort(bySearchWarmupAffinity(mainDir))
    .slice(0, SEARCH_WARMUP_BIB_LIMIT)
    .forEach((path) => pushUnique(focusPaths, path));

  filePaths
    .filter((path) => /\.tex$/i.test(path) && path !== normalizedMain)
    .sort(bySearchWarmupAffinity(mainDir))
    .slice(0, SEARCH_WARMUP_TEX_SIBLING_LIMIT)
    .forEach((path) => pushUnique(focusPaths, path));

  return focusPaths;
}

function prepareSearchIndexAfterProjectOpen(projectId: string, mainFile: string, tree: ResourceNode[]) {
  const focusPaths = collectSearchWarmupFocusPaths(tree, mainFile);
  if (focusPaths.length === 0) {
    void projectPrepareSearchIndex(projectId).catch(() => undefined);
    return;
  }
  const startedAt = typeof performance === "undefined" ? Date.now() : performance.now();
  void projectPrepareSearchIndex(projectId, {
    mode: "focused",
    focusPaths,
  })
    .then(() => {
      const endedAt = typeof performance === "undefined" ? Date.now() : performance.now();
      const elapsedMs = Math.max(0, Math.round(endedAt - startedAt));
      saveProjectSearchReadyMetric({
        elapsedMs,
        projectId,
        focusPaths,
        recordedAt: new Date().toISOString(),
      });
      void runtimeLogWrite(
        "INFO",
        `frontend performance time_to_project_search_ready_ms=${elapsedMs}, project=${projectId}, focus=${focusPaths.join(",")}`,
      ).catch(() => undefined);
    })
    .catch(() => undefined)
    .finally(() => {
      void projectPrepareSearchIndex(projectId).catch(() => undefined);
    });
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
    prepareSearchIndexAfterProjectOpen(projectId, snapshot.mainFile, snapshot.tree);
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
