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

export type DrawHandshakeAction =
  | { kind: "ignore" }
  | { kind: "hostLoaded" }
  | { kind: "configure"; outboundMessage: string }
  | { kind: "init" }
  | { kind: "error"; detail: string };

type PersistedDrawTabs = {
  paths: string[];
  activePath: string | null;
};

const DRAW_TAB_KEY_PREFIX = "latotex.draw.tabs";
export const DRAWIO_LOCAL_RESOURCE_URL = "http://latotex-resource.localhost/tool/drawio/index.html";
export const DRAWIO_CONFIG_MESSAGE = JSON.stringify({
  action: "configure",
  config: {
    css: "body{overflow:hidden;}",
  },
});

export function buildDrawLoadPayload(xml: string): {
  action: "load";
  autosave: 1;
  exportProtocol: true;
  xml: string;
} {
  return {
    action: "load",
    autosave: 1,
    exportProtocol: true,
    xml,
  };
}

export function toDrawioLanguage(locale?: string | null): string {
  const normalized = String(locale ?? "").trim().toLowerCase();
  if (normalized.startsWith("zh")) {
    return "zh";
  }
  return "en";
}

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

export function toDrawioEmbedUrl(entryUrl: string, locale?: string | null): string {
  return appendQueryParams(entryUrl, {
    embed: "1",
    proto: "json",
    spin: "0",
    configure: "1",
    ui: "min",
    lang: toDrawioLanguage(locale),
  });
}

function drawTabsStorageKey(projectId: string): string {
  return `${DRAW_TAB_KEY_PREFIX}.${projectId}`;
}

export function resolveDrawioHostFrameSrc(
  entryUrl?: string | null,
  locale?: string | null,
): string | null {
  const resolvedEntryUrl = String(entryUrl || DRAWIO_LOCAL_RESOURCE_URL).trim();
  if (!resolvedEntryUrl) {
    return null;
  }
  const absoluteEntryUrl = typeof window === "undefined"
    ? resolvedEntryUrl
    : new URL(resolvedEntryUrl, window.location.href).toString();
  if (!absoluteEntryUrl) {
    return null;
  }
  return toDrawioEmbedUrl(absoluteEntryUrl, locale);
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

export function interpretDrawHandshakeMessage(message: DrawMessage | null): DrawHandshakeAction {
  const event = String(message?.event ?? "").trim();
  if (event === "host_loaded") {
    return { kind: "hostLoaded" };
  }
  if (event === "configure") {
    return {
      kind: "configure",
      outboundMessage: DRAWIO_CONFIG_MESSAGE,
    };
  }
  if (event === "init") {
    return { kind: "init" };
  }
  if (event === "error") {
    const detail = String(message?.error ?? "").trim();
    if (detail) {
      return { kind: "error", detail };
    }
  }
  return { kind: "ignore" };
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

function encodePlainTextExport(rawData: string, mime?: string): { mime: string; bytes: Uint8Array } {
  return {
    mime: String(mime ?? "text/plain").trim() || "text/plain",
    bytes: new TextEncoder().encode(rawData),
  };
}

export function decodeDrawExportPayload(message: DrawMessage): { mime: string; bytes: Uint8Array } {
  const rawData = String(message.data ?? "");
  if (!rawData) {
    throw new Error("draw.export.missing_data");
  }
  if (rawData.startsWith("data:")) {
    return decodeDataUrl(rawData);
  }
  if (message.base64 === false) {
    return encodePlainTextExport(rawData, typeof message.mime === "string" ? message.mime : undefined);
  }
  if (rawData.trimStart().startsWith("<")) {
    return encodePlainTextExport(rawData, typeof message.mime === "string" ? message.mime : "image/svg+xml");
  }
  return {
    mime: String(message.mime ?? "application/octet-stream"),
    bytes: Uint8Array.from(atob(rawData), (char) => char.charCodeAt(0)),
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
  const sourceParentDir = slashIndex >= 0 ? normalizedActivePath.slice(0, slashIndex) : "";
  const parentDir = normalizedActivePath.startsWith("drawings/")
    ? sourceParentDir
    : "drawings";

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
  saveAsset: (path: string, bytes: Uint8Array) => Promise<string>;
  onAfterSave?: (path: string) => void;
}): Promise<string> {
  const { activePath, message, saveAsset, onAfterSave } = params;
  const decoded = decodeDrawExportPayload(message);
  const extension = inferExportExtension(message, decoded.mime);
  const targetPath = toDrawExportTarget(activePath, extension, typeof message.filename === "string" ? message.filename : undefined);

  let lastError: unknown;
  for (const attemptPath of [targetPath, ...EXPORT_RETRY_DELAYS_MS.map(() => withExportRetrySuffix(targetPath))]) {
    try {
      const savedPath = await saveAsset(attemptPath, decoded.bytes);
      onAfterSave?.(savedPath);
      return savedPath;
    } catch (error) {
      lastError = error;
      if (!isPermissionDeniedWriteError(error)) {
        throw error;
      }
    }
  }
  throw lastError ?? new Error("write failed");
}

