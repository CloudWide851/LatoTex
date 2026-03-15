import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { readFile, writeFile, writeFileBinary } from "../../../shared/api/desktop";

type TranslationFn = (key: any) => string;

type DrawMessage = {
  event?: string;
  xml?: string;
  data?: string;
  format?: string;
  mime?: string;
  error?: string;
  [key: string]: unknown;
};

const DRAWIO_HOST_URL = "/drawio/index.html";
const DRAWIO_EMBED_FALLBACK_URL = "https://embed.diagrams.net/?embed=1&ui=min&spin=1&proto=json&configure=1&saveAndExit=0";
const DRAW_TAB_KEY_PREFIX = "latotex.draw.tabs";

const EMPTY_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="default" name="Page-1">
    <mxGraphModel dx="1240" dy="720" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1920" pageHeight="1080" background="#ffffff" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

type PersistedDrawTabs = {
  paths: string[];
  activePath: string | null;
};

function normalizePath(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/");
}

function isDrawPath(value: string | null | undefined): boolean {
  return /\.drawio$/i.test(normalizePath(value));
}

function tabTitleFromPath(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function drawTabsStorageKey(projectId: string): string {
  return `${DRAW_TAB_KEY_PREFIX}.${projectId}`;
}

function loadPersistedTabs(projectId: string): PersistedDrawTabs {
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

function savePersistedTabs(projectId: string, state: PersistedDrawTabs) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(drawTabsStorageKey(projectId), JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

function parseDrawMessage(payload: unknown): DrawMessage | null {
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

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
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

function inferExportExtension(message: DrawMessage, dataMime?: string): string {
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

function toTextIfPossible(ext: string, bytes: Uint8Array): string | null {
  if (!["svg", "xml", "drawio", "txt", "html", "json", "md", "csv", "tsv"].includes(ext)) {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function toDrawExportTarget(activePath: string, extension: string): string {
  const title = tabTitleFromPath(activePath);
  const stem = title.replace(/\.drawio$/i, "") || "diagram";
  const safeStem = stem.replace(/[\\/:*?"<>|]/g, "-");
  return `drawings/${safeStem}.${extension}`;
}

export function DrawWorkspace(props: {
  projectId: string | null;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, onSelectPath, t } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const initTimerRef = useRef<number | null>(null);
  const xmlByPathRef = useRef<Record<string, string>>({});

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [frameSrc, setFrameSrc] = useState(DRAWIO_HOST_URL);
  const [tabPaths, setTabPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const postToFrame = useCallback((payload: Record<string, unknown>) => {
    const frame = frameRef.current?.contentWindow;
    if (!frame) {
      return;
    }
    frame.postMessage(JSON.stringify(payload), "*");
  }, []);

  const loadActiveToFrame = useCallback((xmlOverride?: string) => {
    if (!ready || !activePath) {
      return;
    }
    const xml = xmlOverride ?? xmlByPathRef.current[activePath] ?? EMPTY_DIAGRAM;
    postToFrame({ action: "load", autosave: 1, xml });
  }, [activePath, postToFrame, ready]);

  const ensureTabPath = useCallback((path: string, makeActive = true) => {
    const normalized = normalizePath(path);
    if (!isDrawPath(normalized)) {
      return;
    }
    setTabPaths((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    if (makeActive) {
      setActivePath(normalized);
      onSelectPath(normalized);
    }
  }, [onSelectPath]);

  const removeTabPath = useCallback((path: string) => {
    setTabPaths((prev) => {
      const next = prev.filter((item) => item !== path);
      if (activePath === path) {
        const nextActive = next[0] ?? null;
        setActivePath(nextActive);
        onSelectPath(nextActive);
      }
      return next;
    });
  }, [activePath, onSelectPath]);

  const openPathContent = useCallback(async (path: string) => {
    if (!projectId || !path) {
      return;
    }
    if (xmlByPathRef.current[path]) {
      loadActiveToFrame(xmlByPathRef.current[path]);
      return;
    }
    try {
      const file = await readFile(projectId, path);
      xmlByPathRef.current[path] = (file.content || "").trim().length > 0 ? file.content : EMPTY_DIAGRAM;
      loadActiveToFrame(xmlByPathRef.current[path]);
    } catch {
      xmlByPathRef.current[path] = EMPTY_DIAGRAM;
      loadActiveToFrame(EMPTY_DIAGRAM);
      setStatus(t("draw.startFailed"));
    }
  }, [loadActiveToFrame, projectId, t]);

  const createNewTab = useCallback(async () => {
    if (!projectId) {
      return;
    }
    const stamp = Date.now().toString(36);
    let index = 0;
    let path = `drawings/diagram-${stamp}.drawio`;
    while (tabPaths.includes(path)) {
      index += 1;
      path = `drawings/diagram-${stamp}-${index}.drawio`;
    }
    setBusy(true);
    try {
      await writeFile(projectId, path, EMPTY_DIAGRAM);
      xmlByPathRef.current[path] = EMPTY_DIAGRAM;
      ensureTabPath(path, true);
      setStatus(t("draw.saved"));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }, [ensureTabPath, projectId, t, tabPaths]);

  useEffect(() => {
    if (!projectId) {
      setTabPaths([]);
      setActivePath(null);
      setReady(false);
      setStatus("");
      xmlByPathRef.current = {};
      return;
    }
    const persisted = loadPersistedTabs(projectId);
    const seed = [...persisted.paths];
    const normalizedSelected = normalizePath(selectedPath);
    if (isDrawPath(normalizedSelected) && !seed.includes(normalizedSelected)) {
      seed.push(normalizedSelected);
    }
    const paths = Array.from(new Set(seed));
    const resolvedActive = isDrawPath(normalizedSelected)
      ? normalizedSelected
      : (persisted.activePath && paths.includes(persisted.activePath) ? persisted.activePath : paths[0] ?? null);
    setTabPaths(paths);
    setActivePath(resolvedActive);
  }, [projectId, selectedPath]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    savePersistedTabs(projectId, { paths: tabPaths, activePath });
  }, [activePath, projectId, tabPaths]);

  useEffect(() => {
    const normalizedSelected = normalizePath(selectedPath);
    if (!isDrawPath(normalizedSelected)) {
      return;
    }
    ensureTabPath(normalizedSelected, true);
  }, [ensureTabPath, selectedPath]);

  useEffect(() => {
    if (!activePath || !projectId) {
      return;
    }
    void openPathContent(activePath);
  }, [activePath, openPathContent, projectId]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = parseDrawMessage(event.data);
      if (!message) {
        return;
      }
      if (message.event === "configure") {
        postToFrame({
          action: "configure",
          config: {
            css: "body{overflow:hidden;}"
          },
        });
        return;
      }
      if (message.event === "init") {
        setReady(true);
        if (initTimerRef.current !== null) {
          window.clearTimeout(initTimerRef.current);
          initTimerRef.current = null;
        }
        if (activePath) {
          loadActiveToFrame();
        }
        setStatus(t("draw.ready"));
        return;
      }
      if (message.event === "save" && typeof message.xml === "string") {
        if (!projectId || !activePath) {
          return;
        }
        const nextXml = message.xml;
        xmlByPathRef.current[activePath] = nextXml;
        const targetPath = activePath;
        void (async () => {
          setBusy(true);
          try {
            await writeFile(projectId, targetPath, nextXml);
            setStatus(t("draw.saved"));
          } catch (error) {
            setStatus(String(error));
          } finally {
            setBusy(false);
          }
        })();
        return;
      }
      if (message.event === "export" && typeof message.data === "string") {
        if (!projectId || !activePath) {
          return;
        }
        const exportData = message.data;
        void (async () => {
          setBusy(true);
          try {
            let extension = "bin";
            if (exportData.startsWith("data:")) {
              const parsed = decodeDataUrl(exportData);
              extension = inferExportExtension(message, parsed.mime);
              const text = toTextIfPossible(extension, parsed.bytes);
              const targetPath = toDrawExportTarget(activePath, extension || "bin");
              if (text !== null) {
                await writeFile(projectId, targetPath, text);
              } else {
                await writeFileBinary(projectId, targetPath, parsed.bytes);
              }
            } else {
              extension = inferExportExtension(message);
              const targetPath = toDrawExportTarget(activePath, extension || "bin");
              await writeFile(projectId, targetPath, exportData);
            }
            setStatus(t("draw.saved"));
          } catch (error) {
            setStatus(String(error));
          } finally {
            setBusy(false);
          }
        })();
        return;
      }
      if (message.event === "error") {
        const err = typeof message.error === "string" ? message.error : t("draw.startFailed");
        setStatus(err);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activePath, loadActiveToFrame, postToFrame, projectId, t]);

  useEffect(() => {
    initTimerRef.current = window.setTimeout(() => {
      if (!ready) {
        if (frameSrc === DRAWIO_HOST_URL) {
          setFrameSrc(DRAWIO_EMBED_FALLBACK_URL);
          setStatus(t("draw.waiting"));
          return;
        }
        setStatus(t("draw.startFailed"));
      }
    }, 12_000);
    return () => {
      if (initTimerRef.current !== null) {
        window.clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
    };
  }, [frameSrc, ready, t]);

  if (!projectId) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500">
        {t("workspace.noProject")}
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
      <header className="panel-topbar flex min-w-0 items-center gap-1 border-b border-slate-200 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 hide-scrollbar">
          {tabPaths.map((path) => {
            const active = path === activePath;
            return (
              <div
                key={path}
                className={`group inline-flex h-7 min-w-0 max-w-[260px] items-center gap-1 rounded border px-2 text-xs ${
                  active
                    ? "border-primary-400 bg-primary-50 text-primary-800"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                <button
                  className="truncate"
                  onClick={() => {
                    setActivePath(path);
                    onSelectPath(path);
                  }}
                  title={path}
                >
                  {tabTitleFromPath(path)}
                </button>
                <button
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => removeTabPath(path)}
                  title={t("common.close")}
                  aria-label={t("common.close")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <button
            className="panel-topbar-btn inline-flex shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            onClick={() => {
              void createNewTab();
            }}
            disabled={busy}
            title={t("draw.newTab")}
            aria-label={t("draw.newTab")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="panel-topbar-text max-w-[40%] truncate text-[11px] text-slate-500">{status || t("draw.waiting")}</div>
      </header>

      <div className="min-h-0">
        {activePath ? (
          <iframe
            ref={frameRef}
            src={frameSrc}
            title="drawio"
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("draw.noTabs")}</div>
        )}
      </div>
    </section>
  );
}
