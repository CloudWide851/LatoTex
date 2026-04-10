import type { LibraryTranslateStatus } from "../../../shared/types/app";

export type LibraryTranslationSessionStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type LibraryTranslationSession = {
  taskId: string | null;
  status: LibraryTranslationSessionStatus;
  stage: string;
  message: string;
  currentPage: number;
  totalPages: number;
  detail: string;
  errorMessage: string | null;
  sourcePdfRelativePath: string | null;
  translatedPdfRelativePath: string | null;
  updatedAt: string;
};

type PersistedLibraryTranslationSessionPayload = {
  sessions: Record<string, LibraryTranslationSession>;
};

const LIBRARY_TRANSLATION_SESSION_PREFIX = "latotex.library.translation.sessions";
const MAX_LIBRARY_TRANSLATION_SESSIONS = 40;

function nowIso(): string {
  return new Date().toISOString();
}

function storageKey(projectId: string): string {
  return `${LIBRARY_TRANSLATION_SESSION_PREFIX}.${projectId}`;
}

function normalizePath(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/");
}

function normalizeStatus(value: unknown): LibraryTranslationSessionStatus {
  const normalized = String(value ?? "").trim();
  switch (normalized) {
    case "running":
    case "completed":
    case "failed":
    case "interrupted":
      return normalized;
    default:
      return "idle";
  }
}

function sanitizeSession(raw: unknown): LibraryTranslationSession | null {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!source) {
    return null;
  }
  return {
    taskId: typeof source.taskId === "string" && source.taskId.trim() ? source.taskId : null,
    status: normalizeStatus(source.status),
    stage: String(source.stage ?? "").trim(),
    message: String(source.message ?? "").trim(),
    currentPage: Math.max(0, Math.floor(Number(source.currentPage ?? 0) || 0)),
    totalPages: Math.max(0, Math.floor(Number(source.totalPages ?? 0) || 0)),
    detail: String(source.detail ?? "").trim(),
    errorMessage: typeof source.errorMessage === "string" && source.errorMessage.trim()
      ? source.errorMessage
      : null,
    sourcePdfRelativePath: typeof source.sourcePdfRelativePath === "string" && source.sourcePdfRelativePath.trim()
      ? source.sourcePdfRelativePath
      : null,
    translatedPdfRelativePath: typeof source.translatedPdfRelativePath === "string" && source.translatedPdfRelativePath.trim()
      ? source.translatedPdfRelativePath
      : null,
    updatedAt: typeof source.updatedAt === "string" && source.updatedAt.trim()
      ? source.updatedAt
      : nowIso(),
  };
}

export function defaultLibraryTranslationSession(): LibraryTranslationSession {
  return {
    taskId: null,
    status: "idle",
    stage: "",
    message: "",
    currentPage: 0,
    totalPages: 0,
    detail: "",
    errorMessage: null,
    sourcePdfRelativePath: null,
    translatedPdfRelativePath: null,
    updatedAt: nowIso(),
  };
}

function loadPayload(projectId: string): PersistedLibraryTranslationSessionPayload {
  if (typeof window === "undefined") {
    return { sessions: {} };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) {
      return { sessions: {} };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedLibraryTranslationSessionPayload>;
    const sessions: Record<string, LibraryTranslationSession> = {};
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

function savePayload(projectId: string, payload: PersistedLibraryTranslationSessionPayload) {
  if (typeof window === "undefined") {
    return;
  }
  const entries = Object.entries(payload.sessions)
    .sort((left, right) => {
      const leftAt = Date.parse(left[1].updatedAt) || 0;
      const rightAt = Date.parse(right[1].updatedAt) || 0;
      return rightAt - leftAt;
    })
    .slice(0, MAX_LIBRARY_TRANSLATION_SESSIONS);
  try {
    window.localStorage.setItem(
      storageKey(projectId),
      JSON.stringify({
        sessions: Object.fromEntries(entries),
      } satisfies PersistedLibraryTranslationSessionPayload),
    );
  } catch {
    // Ignore storage quota errors; the live session map remains authoritative.
  }
}

export function loadLibraryTranslationSession(
  projectId: string | null | undefined,
  selectedPath: string | null | undefined,
): LibraryTranslationSession {
  const normalizedProjectId = String(projectId ?? "").trim();
  const normalizedPath = normalizePath(selectedPath);
  if (!normalizedProjectId || !normalizedPath) {
    return defaultLibraryTranslationSession();
  }
  const payload = loadPayload(normalizedProjectId);
  return sanitizeSession(payload.sessions[normalizedPath]) ?? defaultLibraryTranslationSession();
}

export function persistLibraryTranslationSession(
  projectId: string,
  selectedPath: string,
  session: LibraryTranslationSession,
) {
  const payload = loadPayload(projectId);
  payload.sessions[normalizePath(selectedPath)] = {
    ...session,
    updatedAt: nowIso(),
  };
  savePayload(projectId, payload);
}

export function clearLibraryTranslationSession(
  projectId: string,
  selectedPath: string,
) {
  const payload = loadPayload(projectId);
  delete payload.sessions[normalizePath(selectedPath)];
  savePayload(projectId, payload);
}

export function isTranslationTaskMissingError(error: unknown): boolean {
  return String(error ?? "").toLowerCase().includes("task_not_found");
}

export function translationSessionFromStatus(
  previous: LibraryTranslationSession,
  status: LibraryTranslateStatus,
): LibraryTranslationSession {
  return {
    ...previous,
    taskId: String(status.taskId || previous.taskId || "").trim() || previous.taskId,
    status: status.status === "completed"
      ? "completed"
      : status.status === "failed"
        ? "failed"
        : "running",
    stage: String(status.stage || "").trim(),
    message: String(status.message || "").trim(),
    currentPage: Math.max(0, Number(status.currentPage || 0)),
    totalPages: Math.max(0, Number(status.totalPages || 0)),
    updatedAt: nowIso(),
  };
}
