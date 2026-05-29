import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { drawioCachePrepare } from "../../../shared/api/desktop";
import { normalizeAssetBasePath } from "../../../shared/utils/assetPath";

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
export const DRAWIO_CONFIG_MESSAGE = JSON.stringify({
  action: "configure",
  config: { compressXml: false, autosave: 1 },
});

export type PendingDrawExportRequest = {
  filename?: string;
  format?: string;
  scale?: number;
  border?: number;
  dpi?: number;
  grid?: boolean;
  background?: string | null;
  pageId?: string;
  currentPage?: boolean;
  allPages?: boolean;
  embedImages?: boolean;
  shadow?: boolean;
};

function drawTabsStorageKey(projectId: string): string {
  return `${DRAW_TAB_KEY_PREFIX}.${projectId}`;
}

function normalizeTrailingSlash(input: string): string {
  return String(input || "").trim().replace(/\/+$/, "");
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => normalizeTrailingSlash(item)).filter((item) => item.length > 0)));
}

async function checkFrameSource(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (head.ok) {
      return true;
    }
    if (head.status !== 405 && head.status !== 501) {
      return false;
    }
  } catch {
    // fallback to GET check below
  }

  try {
    const get = await fetch(url, { method: "GET", cache: "no-store" });
    if (!get.ok) {
      return false;
    }
    await get.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function resolveDrawioHostFrameSrc(): Promise<string | null> {
  if (!isTauri()) {
    return DRAWIO_HOST_URL;
  }

  try {
    const policy = typeof window !== "undefined"
      ? (window.localStorage.getItem(DRAWIO_CACHE_POLICY_KEY) as "install-first" | "appdata-only" | null)
      : null;
    const info = await drawioCachePrepare(policy ?? "install-first");
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DRAWIO_CACHE_POLICY_KEY, info.policy);
    }
    const candidates = toDrawioHostCandidates(info.actualDir);
    for (const candidate of candidates) {
      if (await checkFrameSource(candidate)) {
        return candidate;
      }
    }
  } catch {
    return null;
  }

  return null;
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

export function toDrawioHostCandidates(actualDir: string): string[] {
  const originalDir = String(actualDir || "").trim();
  const slashDir = originalDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const originalConverted = convertFileSrc(originalDir);
  const slashConverted = convertFileSrc(slashDir);
  const bases = uniqueValues([
    normalizeAssetBasePath(originalConverted),
    normalizeAssetBasePath(slashConverted),
    originalConverted,
    slashConverted,
  ]);
  return bases.map((base) => `${base}/index.html`);
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

export function buildDrawLoadPayload(xml: string): Record<string, unknown> {
  return { action: "load", xml, autosave: 1 };
}

export function interpretDrawHandshakeMessage(message: DrawMessage):
  | { kind: "hostLoaded" }
  | { kind: "configure" }
  | { kind: "init" }
  | { kind: "error"; detail: string }
  | { kind: "none" } {
  if (message.event === "host_loaded" || message.source === "drawio_host") {
    return { kind: "hostLoaded" };
  }
  if (message.event === "configure") {
    return { kind: "configure" };
  }
  if (message.event === "init") {
    return { kind: "init" };
  }
  if (message.event === "error" || message.error) {
    return { kind: "error", detail: String(message.error || "draw.runtimeAsset.required") };
  }
  return { kind: "none" };
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

export function decodeDrawExportPayload(message: DrawMessage): { mime: string; bytes: Uint8Array } {
  const data = String(message.data || "");
  if (data.startsWith("data:")) {
    return decodeDataUrl(data);
  }
  const mime = String(message.mime || "application/octet-stream");
  if (message.base64 || (message.base64 !== false && !mime.startsWith("text/"))) {
    const raw = atob(data);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
      bytes[index] = raw.charCodeAt(index);
    }
    return { mime, bytes };
  }
  return {
    mime,
    bytes: new TextEncoder().encode(data),
  };
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

export function isDrawImageExportFormat(format: string | null | undefined): boolean {
  return ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(
    String(format || "").trim().toLowerCase(),
  );
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
  const title = tabTitleFromPath(activePath);
  const stem = title.replace(/\.drawio$/i, "") || "diagram";
  const safeStem = stem.replace(/[\\/:*?"<>|]/g, "-");

  const hintedBase = sanitizeExportFileName(filenameHint ?? "");
  const normalizedExtension = String(extension || "bin").replace(/[^a-z0-9.+-]/gi, "") || "bin";
  const usableHint = hintedBase && !hintedBase.startsWith(".") ? hintedBase : "";
  const fileName = usableHint
    ? (/\.[a-z0-9.+-]+$/i.test(hintedBase) ? hintedBase : `${hintedBase}.${normalizedExtension}`)
    : `${safeStem}.${normalizedExtension}`;

  return `drawings/${fileName}`;
}

export function toDrawExportDialogDefaults(activePath: string, extension: string, filenameHint?: string): {
  defaultRelativeDir: string;
  defaultFileName: string;
} {
  const target = toDrawExportTarget(activePath, extension, filenameHint);
  const activeDir = normalizePath(activePath).split("/").slice(0, -1).join("/");
  const targetWithActiveDir = activeDir.startsWith("drawings/")
    ? `${activeDir}/${target.split("/").pop() || "diagram.bin"}`
    : target;
  const slash = targetWithActiveDir.lastIndexOf("/");
  return {
    defaultRelativeDir: slash >= 0 ? targetWithActiveDir.slice(0, slash) : "drawings",
    defaultFileName: slash >= 0 ? targetWithActiveDir.slice(slash + 1) : targetWithActiveDir,
  };
}

export function buildDrawExportAction(request: PendingDrawExportRequest | null | undefined): Record<string, unknown> {
  return {
    action: "export",
    format: String(request?.format || "png").toLowerCase(),
    spinKey: "exporting",
    scale: request?.scale,
    border: request?.border,
    dpi: request?.dpi,
    grid: request?.grid,
    background: request?.background === null ? "none" : request?.background,
    pageId: request?.pageId,
    currentPage: request?.currentPage,
    allPages: request?.allPages,
    embedImages: request?.embedImages,
    shadow: request?.shadow,
  };
}

export function mergeDrawExportRequest(
  message: DrawMessage,
  request: PendingDrawExportRequest | null | undefined,
): DrawMessage {
  if (!request) {
    return message;
  }
  return {
    ...message,
    format: message.format ?? request.format,
    filename: message.filename ?? request.filename,
  };
}

export function shouldClearPendingDrawExport(
  request: PendingDrawExportRequest | null | undefined,
  message: DrawMessage,
): boolean {
  return Boolean(request && (message.event === "error" || message.error));
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
  saveAsset?: (path: string, bytes: Uint8Array) => Promise<unknown>;
  writeText?: (path: string, content: string) => Promise<unknown>;
  writeBinary?: (path: string, bytes: Uint8Array) => Promise<unknown>;
  onAfterSave?: (savedPath: string) => Promise<void> | void;
}): Promise<string> {
  const { activePath, message, saveAsset, writeText, writeBinary, onAfterSave } = params;
  const exportData = String(message.data || "");
  if (!exportData) {
    throw new Error("draw.export.empty_payload");
  }

  let extension = "bin";
  let targetPath = "";
  let textPayload: string | null = null;
  let binaryPayload: Uint8Array | null = null;

  if (exportData.startsWith("data:")) {
    const parsed = decodeDataUrl(exportData);
    extension = inferExportExtension(message, parsed.mime);
    targetPath = toDrawExportTarget(activePath, extension || "bin", message.filename);
    textPayload = toTextIfPossible(extension, parsed.bytes);
    if (textPayload === null) {
      binaryPayload = parsed.bytes;
    }
  } else {
    extension = inferExportExtension(message);
    targetPath = toDrawExportTarget(activePath, extension || "bin", message.filename);
    if (message.base64) {
      const raw = atob(exportData);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) {
        bytes[index] = raw.charCodeAt(index);
      }
      binaryPayload = bytes;
    } else {
      textPayload = exportData;
    }
  }

  const writePayload = async (path: string) => {
    if (saveAsset) {
      const payload = binaryPayload ?? new TextEncoder().encode(textPayload ?? exportData);
      await saveAsset(path, payload);
      return;
    }
    if (textPayload !== null) {
      if (!writeText) {
        throw new Error("draw.export.write_text_missing");
      }
      await writeText(path, textPayload);
      return;
    }
    if (binaryPayload) {
      if (!writeBinary) {
        throw new Error("draw.export.write_binary_missing");
      }
      await writeBinary(path, binaryPayload);
      return;
    }
    if (!writeText) {
      throw new Error("draw.export.write_text_missing");
    }
    await writeText(path, exportData);
  };

  const writeWithRetry = async (path: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= EXPORT_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await writePayload(path);
        return;
      } catch (error) {
        lastError = error;
        if (!isPermissionDeniedWriteError(error) || attempt >= EXPORT_RETRY_DELAYS_MS.length) {
          throw error;
        }
        await new Promise((resolve) => window.setTimeout(resolve, EXPORT_RETRY_DELAYS_MS[attempt]));
      }
    }
    throw lastError ?? new Error("write failed");
  };

  let savedPath = targetPath;
  try {
    await writeWithRetry(savedPath);
  } catch (error) {
    if (!isPermissionDeniedWriteError(error)) {
      throw error;
    }
    savedPath = withExportRetrySuffix(targetPath);
    await writeWithRetry(savedPath);
  }

  await onAfterSave?.(savedPath);
  return savedPath;
}

