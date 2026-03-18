import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { readFile, writeFile, writeFileBinary } from "../../../shared/api/desktop";
import type { FsAction, FsScope } from "../../../shared/types/app";
import {
  DRAWIO_HOST_URL,
  buildRenamedDrawPath,
  decodeDataUrl,
  inferExportExtension,
  isDrawPath,
  loadPersistedTabs,
  normalizePath,
  parseDrawMessage,
  resolveDrawioHostFrameSrc,
  savePersistedTabs,
  tabTitleFromPath,
  toDrawExportTarget,
  toTextIfPossible,
  EXPORT_RETRY_DELAYS_MS,
  isPermissionDeniedWriteError,
  withExportRetrySuffix,
} from "./drawWorkspaceUtils";
import { isMissingFileReadError } from "./drawFileError";


type TranslationFn = (key: any) => string;

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





export function DrawWorkspace(props: {
  projectId: string | null;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onRunFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<boolean>;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, onSelectPath, onRunFsAction, t } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const initTimerRef = useRef<number | null>(null);
  const xmlByPathRef = useRef<Record<string, string>>({});
  const renameCommittingPathRef = useRef<string | null>(null);
  const activePathRef = useRef<string | null>(null);
  const frameSrcRef = useRef<string | null>(DRAWIO_HOST_URL);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [frameSrc, setFrameSrc] = useState<string | null>(DRAWIO_HOST_URL);
  const [tabPaths, setTabPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    resolveDrawioHostFrameSrc()
      .then((nextSrc) => {
        if (cancelled) {
          return;
        }
        const resolved = nextSrc ?? null;
        const previous = frameSrcRef.current;

        if (!resolved) {
          if (!previous) {
            setReady(false);
            setFrameSrc(null);
            frameSrcRef.current = null;
            setStatus(t("draw.startFailed"));
          }
          return;
        }

        if (resolved !== previous) {
          setReady(false);
          setFrameSrc(resolved);
          frameSrcRef.current = resolved;
        }
      })
      .catch(() => {
        if (!cancelled && !frameSrcRef.current) {
          setReady(false);
          setFrameSrc(null);
          frameSrcRef.current = null;
          setStatus(t("draw.startFailed"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    frameSrcRef.current = frameSrc;
  }, [frameSrc]);

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
      activePathRef.current = normalized;
      setActivePath(normalized);
      onSelectPath(normalized);
    }
  }, [onSelectPath]);

  const replaceTabPath = useCallback((fromPath: string, toPath: string) => {
    setTabPaths((prev) => prev.map((item) => (item === fromPath ? toPath : item)));
    setActivePath((prev) => {
      if (prev !== fromPath) {
        return prev;
      }
      activePathRef.current = toPath;
      onSelectPath(toPath);
      return toPath;
    });
    if (activePathRef.current === fromPath) {
      activePathRef.current = toPath;
    }
    if (normalizePath(selectedPath) === fromPath) {
      onSelectPath(toPath);
    }

    const cached = xmlByPathRef.current[fromPath];
    if (typeof cached === "string") {
      xmlByPathRef.current[toPath] = cached;
    }
    delete xmlByPathRef.current[fromPath];
  }, [onSelectPath, selectedPath]);

  const removeTabPath = useCallback((path: string) => {
    delete xmlByPathRef.current[path];
    setRenamingPath((prev) => (prev === path ? null : prev));
    setTabPaths((prev) => {
      const removedIndex = prev.indexOf(path);
      if (removedIndex < 0) {
        return prev;
      }
      const next = prev.filter((item) => item !== path);
      if (activePathRef.current === path) {
        const nextActive = next[removedIndex] ?? next[removedIndex - 1] ?? null;
        activePathRef.current = nextActive;
        setActivePath(nextActive);
        onSelectPath(nextActive);
      }
      return next;
    });
  }, [onSelectPath]);

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
    } catch (error) {
      if (isMissingFileReadError(error)) {
        removeTabPath(path);
        setStatus(t("draw.fileMissingRemoved"));
        return;
      }
      xmlByPathRef.current[path] = EMPTY_DIAGRAM;
      loadActiveToFrame(EMPTY_DIAGRAM);
      setStatus(t("draw.startFailed"));
    }
  }, [loadActiveToFrame, projectId, removeTabPath, t]);

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

  const startRename = useCallback((path: string) => {
    const title = tabTitleFromPath(path).replace(/\.drawio$/i, "");
    setRenamingPath(path);
    setRenameInput(title);
  }, []);

  const commitRename = useCallback(async (path: string) => {
    if (!projectId) {
      return;
    }
    if (renameCommittingPathRef.current === path) {
      return;
    }
    const trimmed = renameInput.trim();
    if (!trimmed) {
      setRenamingPath(null);
      return;
    }
    const nextPath = buildRenamedDrawPath(path, trimmed);
    if (!isDrawPath(nextPath)) {
      setRenamingPath(null);
      return;
    }
    if (nextPath === path) {
      setRenamingPath(null);
      return;
    }
    if (tabPaths.includes(nextPath)) {
      setStatus(t("draw.renameExists"));
      return;
    }

    renameCommittingPathRef.current = path;
    setBusy(true);
    try {
      const ok = await onRunFsAction("workspace", "rename", path, nextPath);
      if (!ok) {
        return;
      }
      if (activePathRef.current === path) {
        activePathRef.current = nextPath;
      }
      replaceTabPath(path, nextPath);
      setRenamingPath(null);
      setStatus(t("toast.fsUpdated"));
    } finally {
      renameCommittingPathRef.current = null;
      setBusy(false);
    }
  }, [onRunFsAction, projectId, renameInput, replaceTabPath, t, tabPaths]);

  const deleteTabAndFile = useCallback(async (path: string) => {
    if (!projectId || busy) {
      return;
    }
    setBusy(true);
    try {
      const ok = await onRunFsAction("workspace", "delete", path);
      if (!ok) {
        return;
      }
      removeTabPath(path);
      setStatus(t("toast.fsUpdated"));
    } finally {
      setBusy(false);
    }
  }, [busy, onRunFsAction, projectId, removeTabPath, t]);

  useEffect(() => {
    if (!projectId) {
      setTabPaths([]);
      setActivePath(null);
      activePathRef.current = null;
      setReady(false);
      setStatus("");
      setRenamingPath(null);
      setRenameInput("");
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
    activePathRef.current = resolvedActive;
  }, [projectId]);

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
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) {
        return;
      }
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
      if ((message.event === "save" || message.event === "autosave") && typeof message.xml === "string") {
        const currentActivePath = activePathRef.current;
        if (!projectId || !currentActivePath) {
          return;
        }
        if (renameCommittingPathRef.current && currentActivePath === renameCommittingPathRef.current) {
          return;
        }
        const nextXml = message.xml;
        xmlByPathRef.current[currentActivePath] = nextXml;
        const targetPath = currentActivePath;
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
        const currentActivePath = activePathRef.current;
        if (!projectId || !currentActivePath) {
          return;
        }
        const exportData = message.data;
        void (async () => {
          setBusy(true);
          try {
            let extension = "bin";
            let targetPath = "";
            let textPayload: string | null = null;
            let binaryPayload: Uint8Array | null = null;

            if (exportData.startsWith("data:")) {
              const parsed = decodeDataUrl(exportData);
              extension = inferExportExtension(message, parsed.mime);
              targetPath = toDrawExportTarget(currentActivePath, extension || "bin", message.filename);
              textPayload = toTextIfPossible(extension, parsed.bytes);
              if (textPayload === null) {
                binaryPayload = parsed.bytes;
              }
            } else {
              extension = inferExportExtension(message);
              targetPath = toDrawExportTarget(currentActivePath, extension || "bin", message.filename);
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
              if (textPayload !== null) {
                await writeFile(projectId, path, textPayload);
                return;
              }
              if (binaryPayload) {
                await writeFileBinary(projectId, path, binaryPayload);
                return;
              }
              await writeFile(projectId, path, exportData);
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

            setStatus(savedPath === targetPath ? t("draw.saved") : `${t("draw.saved")} ${savedPath}`);
          } catch (error) {
            setStatus(String(error));
          } finally {
            setBusy(false);
          }
        })();
        return;
      }
      if (message.event === "error") {
        const err = typeof message.error === "string" ? message.error.trim() : "";
        if (err) {
          setStatus(err);
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadActiveToFrame, postToFrame, projectId, t]);

  useEffect(() => {
    if (!frameSrc) {
      return;
    }
    initTimerRef.current = window.setTimeout(() => {
      if (!ready) {
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
            const editing = path === renamingPath;
            return (
              <div
                key={path}
                className={`group inline-flex h-7 min-w-0 max-w-[260px] items-center gap-1 rounded border px-2 text-xs ${
                  active
                    ? "border-primary-400 bg-primary-50 text-primary-800"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                {editing ? (
                  <input
                    className="h-5 min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 text-xs text-slate-700"
                    value={renameInput}
                    autoFocus
                    onChange={(event) => setRenameInput(event.target.value)}
                    onBlur={() => {
                      void commitRename(path);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRename(path);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenamingPath(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    className="truncate"
                    onClick={() => {
                      activePathRef.current = path;
                      setActivePath(path);
                      onSelectPath(path);
                    }}
                    onDoubleClick={() => startRename(path)}
                    title={path}
                  >
                    {tabTitleFromPath(path)}
                  </button>
                )}
                <button
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => {
                    if (editing) {
                      setRenamingPath(null);
                      return;
                    }
                    void deleteTabAndFile(path);
                  }}
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
          frameSrc ? (
            <iframe
              ref={frameRef}
              src={frameSrc}
              title="drawio"
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("draw.startFailed")}</div>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("draw.noTabs")}</div>
        )}
      </div>
    </section>
  );
}



