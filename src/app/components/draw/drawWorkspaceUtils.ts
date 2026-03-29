import { isTauri } from "@tauri-apps/api/core";
import { drawioCachePrepare } from "../../../shared/api/local-resources";
import { prioritizeReachableLocalResourceCandidates } from "../../../shared/utils/localResourceProbe";
import type { DrawioCacheInfo } from "../../../shared/types/app";

export type DrawMessage = {
  event?: string;
  xml?: string;
  data?: string;
  format?: string;
  mime?: string;
  filename?: string;
  base64?: boolean;
  source?: string;
  error?: string;
  [key: string]: unknown;
};

type PersistedDrawTabs = {
  paths: string[];
  activePath: string | null;
};

const DRAW_TAB_KEY_PREFIX = "latotex.draw.tabs";
const DRAWIO_CACHE_POLICY_KEY = "latotex.drawio.cachePolicy";
export const DRAWIO_HOST_URL = "/drawio/index.html";

function appendQueryParams(url: string, values: Record<string, string>): string {
  const [withoutHash, hash = ""] = String(url || "").split("#", 2);
  const [basePath, query = ""] = withoutHash.split("?", 2);
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
  const nextQuery = params.toString();
  return `${basePath}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

export function toDrawioEmbedUrl(entryUrl: string): string {
  return appendQueryParams(entryUrl, {
    embed: "1",
    proto: "json",
    spin: "0",
    configure: "1",
    ui: "min",
  });
}

function drawTabsStorageKey(projectId: string): string {
  return `${DRAW_TAB_KEY_PREFIX}.${projectId}`;
}

export function buildDrawioEntryCandidates(info: Pick<DrawioCacheInfo, "entryUrl">): string[] {
  const directCandidates = [String(info.entryUrl || "").trim()].filter(Boolean);
  const rawCandidates = [...directCandidates, DRAWIO_HOST_URL].filter(Boolean);
  return Array.from(new Set(rawCandidates.map((candidate) => toDrawioEmbedUrl(candidate))));
}

export async function resolveDrawioHostFrameCandidates(): Promise<string[]> {
  if (!isTauri()) {
    return prioritizeReachableLocalResourceCandidates([toDrawioEmbedUrl(DRAWIO_HOST_URL)]);
  }

  try {
    const preferredPolicy = typeof window !== "undefined"
      ? (window.localStorage.getItem(DRAWIO_CACHE_POLICY_KEY) as "install-first" | "appdata-only" | null)
      : null;
    const policy = preferredPolicy ?? "install-first";
    const info = await drawioCachePrepare(policy);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DRAWIO_CACHE_POLICY_KEY, info.policy);
    }
    return prioritizeReachableLocalResourceCandidates(buildDrawioEntryCandidates(info));
  } catch {
    return prioritizeReachableLocalResourceCandidates([toDrawioEmbedUrl(DRAWIO_HOST_URL)]);
  }
}

export async function resolveDrawioHostFrameSrc(): Promise<string | null> {
  const candidates = await resolveDrawioHostFrameCandidates();
  return candidates[0] ?? null;
}

export function normalizePath(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/");
}

export function isDrawPath(value: string | null | undefined): boolean {
  return /\.drawio$/i.test(normalizePath(value));
}

export function tabTitleFromPath(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function loadPersistedTabs(projectId: string): PersistedDrawTabs {
  if (typeof window === "undefined") {
    return { paths: [], activePath: null };
  }
  try {
    const raw = window.localStorage.getItem(drawTabsStorageKey(projectId));
    if (!raw) {
      return { paths: [], activePath: null };
    }
    const parsed = JSON.parse(raw) as PersistedDrawTabs;
    const paths = Array.isArray(parsed?.paths)
      ? parsed.paths.map((item) => normalizePath(item)).filter((item) => isDrawPath(item))
      : [];
    const activePath = isDrawPath(parsed?.activePath) ? normalizePath(parsed.activePath) : null;
    return {
      paths: Array.from(new Set(paths)),
      activePath,
    };
  } catch {
    return { paths: [], activePath: null };
  }
}

export function savePersistedTabs(projectId: string, state: PersistedDrawTabs) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(drawTabsStorageKey(projectId), JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

export function parseDrawMessage(payload: unknown): DrawMessage | null {
  if (!payload) {
    return null;
  }
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as DrawMessage;
    } catch {
      return null;
    }
  }
  if (typeof payload === "object") {
    return payload as DrawMessage;
  }
  return null;
}

export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const [prefix, payload] = dataUrl.split(",", 2);
  const mime = /^data:([^;]+);base64$/i.exec(prefix || "")?.[1] || "application/octet-stream";
  const raw = atob(payload || "");
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return { mime, bytes };
}

function mimeSubtype(mime: string): string {
  const normalized = String(mime || "").toLowerCase();
  if (!normalized.includes("/")) {
    return "bin";
  }
  const sub = normalized.split("/")[1] || "bin";
  return sub.replace(/[^a-z0-9.+-]/g, "") || "bin";
}

export function inferExportExtension(message: DrawMessage, dataMime?: string): string {
  const format = String(message.format ?? "").trim().toLowerCase();
  if (format) {
    return format.replace(/[^a-z0-9.+-]/g, "") || "bin";
  }
  const mime = String(message.mime ?? dataMime ?? "").trim().toLowerCase();
  if (mime) {
    if (mime === "image/svg+xml") {
      return "svg";
    }
    return mimeSubtype(mime);
  }
  return "bin";
}

export function toTextIfPossible(ext: string, bytes: Uint8Array): string | null {
  if (!["svg", "xml", "drawio", "txt", "html", "json", "md", "csv", "tsv"].includes(ext)) {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function sanitizeExportFileName(filename: string): string {
  const base = String(filename || "")
    .trim()
    .split(/[\\/]/)
    .pop() || "";
  return base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/^\.+$/, "")
    .trim();
}

export function toDrawExportTarget(activePath: string, extension: string, filenameHint?: string): string {
  const normalizedActivePath = normalizePath(activePath);
  const title = tabTitleFromPath(normalizedActivePath);
  const stem = title.replace(/\.drawio$/i, "") || "diagram";
  const safeStem = stem.replace(/[\\/:*?"<>|]/g, "-");
  const slashIndex = normalizedActivePath.lastIndexOf("/");
  const parentDir = slashIndex >= 0 ? normalizedActivePath.slice(0, slashIndex) : "";

  const hintedBase = sanitizeExportFileName(filenameHint ?? "");
  const normalizedExtension = String(extension || "bin").replace(/[^a-z0-9.+-]/gi, "") || "bin";
  const fileName = hintedBase
    ? (/\.[a-z0-9.+-]+$/i.test(hintedBase) ? hintedBase : `${hintedBase}.${normalizedExtension}`)
    : `${safeStem}.${normalizedExtension}`;

  return parentDir ? `${parentDir}/${fileName}` : fileName;
}

export function buildRenamedDrawPath(currentPath: string, nextInput: string): string {
  const normalizedPath = normalizePath(currentPath);
  const slashIndex = normalizedPath.lastIndexOf("/");
  const parentDir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : "";
  const trimmed = String(nextInput || "").trim();
  const fileName = /\.drawio$/i.test(trimmed) ? trimmed : `${trimmed}.drawio`;
  return normalizePath(parentDir ? `${parentDir}/${fileName}` : fileName);
}

export const EXPORT_RETRY_DELAYS_MS = [120, 260, 420] as const;

export function isPermissionDeniedWriteError(error: unknown): boolean {
  const lower = String(error || "").toLowerCase();
  return lower.includes("access is denied") || lower.includes("permission denied") || lower.includes("os error 5");
}

export function withExportRetrySuffix(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dir = slash >= 0 ? normalized.slice(0, slash) : "";
  const dot = fileName.lastIndexOf(".");
  const hasExt = dot > 0;
  const stem = hasExt ? fileName.slice(0, dot) : fileName;
  const ext = hasExt ? fileName.slice(dot) : "";
  const nextName = `${stem}-export-${Date.now().toString(36)}${ext}`;
  return dir ? `${dir}/${nextName}` : nextName;
}

export async function persistDrawExportToWorkspace(params: {
  activePath: string;
  message: DrawMessage;
  writeText: (path: string, content: string) => Promise<unknown>;
  writeBinary: (path: string, bytes: Uint8Array) => Promise<unknown>;
  onAfterSave?: (path: string) => void;
}): Promise<string> {
  const { activePath, message, writeText, writeBinary, onAfterSave } = params;
  const rawData = String(message.data ?? "");
  if (!rawData) {
    throw new Error("draw.export.missing_data");
  }

  const decoded = rawData.startsWith("data:")
    ? decodeDataUrl(rawData)
    : { mime: String(message.mime ?? "application/octet-stream"), bytes: Uint8Array.from(atob(rawData), (char) => char.charCodeAt(0)) };
  const extension = inferExportExtension(message, decoded.mime);
  const targetPath = toDrawExportTarget(activePath, extension, typeof message.filename === "string" ? message.filename : undefined);
  const textContent = toTextIfPossible(extension, decoded.bytes);

  let lastError: unknown;
  for (const attemptPath of [targetPath, ...EXPORT_RETRY_DELAYS_MS.map(() => withExportRetrySuffix(targetPath))]) {
    try {
      if (typeof textContent === "string") {
        await writeText(attemptPath, textContent);
      } else {
        await writeBinary(attemptPath, decoded.bytes);
      }
      onAfterSave?.(attemptPath);
      return attemptPath;
    } catch (error) {
      lastError = error;
      if (!isPermissionDeniedWriteError(error)) {
        throw error;
      }
    }
  }
  throw lastError ?? new Error("write failed");
}



