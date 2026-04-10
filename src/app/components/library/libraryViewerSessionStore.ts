type ViewMode = "bib" | "pdf" | "compare";

export type LibraryViewerSession = {
  viewMode: ViewMode;
  currentPage: number;
  pdfZoom: number;
  compareSourceZoom: number;
  compareTranslatedZoom: number;
  pdfScrollRatio: number;
  compareSourceScrollRatio: number;
  compareTranslatedScrollRatio: number;
  bibScrollRatio: number;
  metaScrollRatio: number;
  updatedAt: string;
};

type PersistedLibraryViewerSessionPayload = {
  sessions: Record<string, LibraryViewerSession>;
};

const LIBRARY_VIEWER_SESSION_PREFIX = "latotex.library.viewer.sessions";
const MAX_LIBRARY_VIEWER_SESSIONS = 40;

function nowIso(): string {
  return new Date().toISOString();
}

function storageKey(projectId: string): string {
  return `${LIBRARY_VIEWER_SESSION_PREFIX}.${projectId}`;
}

function clampZoom(value: unknown, fallback: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.max(0.7, Math.min(2.4, Number(next.toFixed(2))));
}

function clampRatio(value: unknown): number {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return 0;
  }
  return Math.max(0, Math.min(1, next));
}

function normalizePath(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/");
}

export function defaultLibraryViewerSession(
  fallbackViewMode: ViewMode = "bib",
): LibraryViewerSession {
  return {
    viewMode: fallbackViewMode,
    currentPage: 1,
    pdfZoom: 1,
    compareSourceZoom: 1,
    compareTranslatedZoom: 1,
    pdfScrollRatio: 0,
    compareSourceScrollRatio: 0,
    compareTranslatedScrollRatio: 0,
    bibScrollRatio: 0,
    metaScrollRatio: 0,
    updatedAt: nowIso(),
  };
}

function sanitizeSession(
  raw: unknown,
  fallbackViewMode: ViewMode = "bib",
): LibraryViewerSession | null {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!source) {
    return null;
  }
  const rawViewMode = String(source.viewMode ?? "").trim();
  const viewMode: ViewMode = rawViewMode === "pdf" || rawViewMode === "compare" || rawViewMode === "bib"
    ? rawViewMode
    : fallbackViewMode;
  const currentPage = Math.max(1, Math.floor(Number(source.currentPage ?? 1) || 1));
  return {
    viewMode,
    currentPage,
    pdfZoom: clampZoom(source.pdfZoom, 1),
    compareSourceZoom: clampZoom(source.compareSourceZoom, 1),
    compareTranslatedZoom: clampZoom(source.compareTranslatedZoom, 1),
    pdfScrollRatio: clampRatio(source.pdfScrollRatio),
    compareSourceScrollRatio: clampRatio(source.compareSourceScrollRatio),
    compareTranslatedScrollRatio: clampRatio(source.compareTranslatedScrollRatio),
    bibScrollRatio: clampRatio(source.bibScrollRatio),
    metaScrollRatio: clampRatio(source.metaScrollRatio),
    updatedAt: typeof source.updatedAt === "string" && source.updatedAt.trim()
      ? source.updatedAt
      : nowIso(),
  };
}

function loadPayload(projectId: string): PersistedLibraryViewerSessionPayload {
  if (typeof window === "undefined") {
    return { sessions: {} };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) {
      return { sessions: {} };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedLibraryViewerSessionPayload>;
    const sessions: Record<string, LibraryViewerSession> = {};
    const entries = parsed.sessions && typeof parsed.sessions === "object"
      ? Object.entries(parsed.sessions)
      : [];
    for (const [path, value] of entries) {
      const normalizedPath = normalizePath(path);
      if (!normalizedPath) {
        continue;
      }
      const session = sanitizeSession(value);
      if (!session) {
        continue;
      }
      sessions[normalizedPath] = session;
    }
    return { sessions };
  } catch {
    return { sessions: {} };
  }
}

function savePayload(projectId: string, payload: PersistedLibraryViewerSessionPayload) {
  if (typeof window === "undefined") {
    return;
  }
  const entries = Object.entries(payload.sessions)
    .sort((left, right) => {
      const leftAt = Date.parse(left[1].updatedAt) || 0;
      const rightAt = Date.parse(right[1].updatedAt) || 0;
      return rightAt - leftAt;
    })
    .slice(0, MAX_LIBRARY_VIEWER_SESSIONS);
  try {
    window.localStorage.setItem(
      storageKey(projectId),
      JSON.stringify({
        sessions: Object.fromEntries(entries),
      } satisfies PersistedLibraryViewerSessionPayload),
    );
  } catch {
    // Ignore storage quota errors; in-memory state remains available for this run.
  }
}

export function loadLibraryViewerSession(
  projectId: string | null | undefined,
  selectedPath: string | null | undefined,
  fallbackViewMode: ViewMode = "bib",
): LibraryViewerSession {
  const normalizedProjectId = String(projectId ?? "").trim();
  const normalizedPath = normalizePath(selectedPath);
  if (!normalizedProjectId || !normalizedPath) {
    return defaultLibraryViewerSession(fallbackViewMode);
  }
  const payload = loadPayload(normalizedProjectId);
  return sanitizeSession(payload.sessions[normalizedPath], fallbackViewMode)
    ?? defaultLibraryViewerSession(fallbackViewMode);
}

export function persistLibraryViewerSession(
  projectId: string | null | undefined,
  selectedPath: string | null | undefined,
  session: LibraryViewerSession,
) {
  const normalizedProjectId = String(projectId ?? "").trim();
  const normalizedPath = normalizePath(selectedPath);
  if (!normalizedProjectId || !normalizedPath) {
    return;
  }
  const payload = loadPayload(normalizedProjectId);
  payload.sessions[normalizedPath] = {
    ...session,
    updatedAt: nowIso(),
  };
  savePayload(normalizedProjectId, payload);
}
