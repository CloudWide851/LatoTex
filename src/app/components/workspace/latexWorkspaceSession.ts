import type { EditorTab } from "../../../shared/types/app";

export type LatexWorkspaceSession = {
  version: 1;
  tabPaths: string[];
  activePath: string | null;
  chatTabOpen: boolean;
  chatTabActive: boolean;
  updatedAt: string;
};

export type LatexWorkspaceRestore = {
  tabPaths: string[];
  activePath: string | null;
  chatTabOpen: boolean;
  chatTabActive: boolean;
};

const SESSION_VERSION = 1;
const MAX_RESTORED_TABS = 48;

function storageKey(projectId: string) {
  return `latotex.latex.workspace.session.${projectId}`;
}

function normalizePath(path: unknown): string | null {
  if (typeof path !== "string") {
    return null;
  }
  const normalized = path.trim().replace(/\\/g, "/");
  return normalized.length > 0 ? normalized : null;
}

function uniquePaths(paths: unknown[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of paths) {
    const path = normalizePath(raw);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    output.push(path);
    if (output.length >= MAX_RESTORED_TABS) {
      break;
    }
  }
  return output;
}

function readSession(projectId: string): Partial<LatexWorkspaceSession> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(projectId: string, session: LatexWorkspaceSession) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(session));
  } catch {
    // The live workspace state is still authoritative when localStorage is unavailable.
  }
}

export function loadLatexWorkspaceSession(projectId: string): LatexWorkspaceSession | null {
  const raw = readSession(projectId);
  if (!raw) {
    return null;
  }
  const tabPaths = uniquePaths(Array.isArray(raw.tabPaths) ? raw.tabPaths : []);
  const activePath = normalizePath(raw.activePath);
  return {
    version: SESSION_VERSION,
    tabPaths,
    activePath,
    chatTabOpen: Boolean(raw.chatTabOpen),
    chatTabActive: Boolean(raw.chatTabActive),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}

export function resolveLatexWorkspaceRestore(
  projectId: string,
  fileSet: Set<string>,
  fallbackPath: string | null,
): LatexWorkspaceRestore {
  const stored = loadLatexWorkspaceSession(projectId);
  const fallback = normalizePath(fallbackPath);
  const validStoredPaths = (stored?.tabPaths ?? []).filter((path) => fileSet.has(path));
  const activePath = stored?.activePath && fileSet.has(stored.activePath)
    ? stored.activePath
    : (fallback && fileSet.has(fallback) ? fallback : validStoredPaths[0] ?? null);
  const tabPaths = uniquePaths([
    ...validStoredPaths,
    activePath,
  ]).filter((path) => fileSet.has(path));

  return {
    tabPaths,
    activePath,
    chatTabOpen: Boolean(stored?.chatTabOpen),
    chatTabActive: Boolean(stored?.chatTabOpen && stored.chatTabActive),
  };
}

export function persistLatexWorkspaceFileSession(params: {
  projectId: string;
  tabs: Pick<EditorTab, "path">[];
  activePath: string | null;
}) {
  const existing = loadLatexWorkspaceSession(params.projectId);
  writeSession(params.projectId, {
    version: SESSION_VERSION,
    tabPaths: uniquePaths(params.tabs.map((tab) => tab.path)),
    activePath: normalizePath(params.activePath),
    chatTabOpen: existing?.chatTabOpen ?? false,
    chatTabActive: existing?.chatTabActive ?? false,
    updatedAt: new Date().toISOString(),
  });
}

export function persistLatexWorkspaceChatSession(params: {
  projectId: string;
  chatTabOpen: boolean;
  chatTabActive: boolean;
}) {
  const existing = loadLatexWorkspaceSession(params.projectId);
  writeSession(params.projectId, {
    version: SESSION_VERSION,
    tabPaths: existing?.tabPaths ?? [],
    activePath: existing?.activePath ?? null,
    chatTabOpen: params.chatTabOpen,
    chatTabActive: params.chatTabOpen && params.chatTabActive,
    updatedAt: new Date().toISOString(),
  });
}

export function clearLatexWorkspaceSession(projectId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey(projectId));
  } catch {
    // Ignore storage failures.
  }
}
