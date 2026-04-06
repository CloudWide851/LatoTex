import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeLogWrite } from "../../../shared/api/runtime";
import { readFile, writeFile, writeFileBinary } from "../../../shared/api/workspace";
import type { FsAction, FsScope } from "../../../shared/types/app";
import {
  buildRenamedDrawPath,
  DRAWIO_CONFIG_MESSAGE,
  interpretDrawHandshakeMessage,
  isDrawPath,
  loadPersistedTabs,
  normalizePath,
  parseDrawMessage,
  persistDrawExportToWorkspace,
  resolveDrawioHostFrameSrc,
  savePersistedTabs,
  tabTitleFromPath,
} from "./drawWorkspaceUtils";
import { isMissingFileReadError } from "./drawFileError";
import { DrawWorkspaceTabs } from "./DrawWorkspaceTabs";

type TranslationFn = (key: any) => string;

type WorkspaceFsEventDetail = {
  scope: FsScope;
  action: FsAction;
  path: string;
  targetPath?: string;
};

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

function formatDrawStartFailure(t: TranslationFn, detail?: string | null): string {
  const normalized = String(detail || "").trim();
  if (!normalized) {
    return t("draw.startFailed");
  }
  return t("draw.startFailedDetail").replace("{detail}", normalized);
}

function withReloadToken(url: string, reloadToken: number): string {
  const normalized = String(url || "").trim();
  if (!normalized) {
    return "";
  }
  return `${normalized}${normalized.includes("?") ? "&" : "?"}latotexReload=${reloadToken}`;
}

export function DrawWorkspace(props: {
  projectId: string | null;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onRequestFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<void>;
  onRunFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<boolean>;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, onSelectPath, onRequestFsAction, onRunFsAction, t } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const initTimerRef = useRef<number | null>(null);
  const handshakeStageRef = useRef("boot");
  const xmlByPathRef = useRef<Record<string, string>>({});
  const renameCommittingPathRef = useRef<string | null>(null);
  const activePathRef = useRef<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [framePhase, setFramePhase] = useState<"loading" | "ready" | "error">("loading");
  const [frameFailureDetail, setFrameFailureDetail] = useState<string | null>(null);
  const [frameReloadToken, setFrameReloadToken] = useState(0);
  const [frameDocumentLoaded, setFrameDocumentLoaded] = useState(false);
  const [tabPaths, setTabPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const logDrawRuntime = useCallback((level: "INFO" | "WARN" | "ERROR", message: string) => {
    void runtimeLogWrite(level, `draw.workspace: ${message}`).catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      const resolved = resolveDrawioHostFrameSrc();
      if (!resolved) {
        const failure = formatDrawStartFailure(t, "drawio entry url is missing");
        handshakeStageRef.current = "missing_entry_url";
        setFramePhase("error");
        setFrameSrc(null);
        setFrameFailureDetail(failure);
        setStatus(failure);
        logDrawRuntime("ERROR", "entry_url_missing");
        return;
      }
      handshakeStageRef.current = "frame_src_resolved";
      setFramePhase("loading");
      setFrameFailureDetail(null);
      setFrameDocumentLoaded(false);
      setFrameSrc(withReloadToken(resolved, frameReloadToken));
      setStatus(t("draw.waiting"));
      logDrawRuntime("INFO", `frame_load_start: src=${resolved}, reload_token=${frameReloadToken}`);
    } catch (error) {
      const failure = formatDrawStartFailure(t, String(error));
      handshakeStageRef.current = "frame_src_failed";
      setFramePhase("error");
      setFrameSrc(null);
      setFrameFailureDetail(failure);
      setStatus(failure);
      logDrawRuntime("ERROR", `frame_src_failed: ${String(error)}`);
    }
  }, [frameReloadToken, logDrawRuntime, t]);

  const retryFrameLoad = useCallback(() => {
    logDrawRuntime("WARN", `frame_retry_requested: stage=${handshakeStageRef.current}`);
    setFramePhase("loading");
    setFrameSrc(null);
    setFrameFailureDetail(null);
    setFrameDocumentLoaded(false);
    setStatus(t("draw.waiting"));
    setFrameReloadToken((prev) => prev + 1);
  }, [logDrawRuntime, t]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  const postToFrameRaw = useCallback((payload: string) => {
    const frame = frameRef.current?.contentWindow;
    if (!frame) {
      return;
    }
    frame.postMessage(payload, "*");
  }, []);

  const postToFrame = useCallback((payload: Record<string, unknown>) => {
    postToFrameRaw(JSON.stringify(payload));
  }, [postToFrameRaw]);

  const loadActiveToFrame = useCallback((xmlOverride?: string) => {
    if (framePhase !== "ready" || !activePath) {
      return;
    }
    const xml = xmlOverride ?? xmlByPathRef.current[activePath] ?? EMPTY_DIAGRAM;
    postToFrame({ action: "load", autosave: 1, xml });
  }, [activePath, framePhase, postToFrame]);

  const selectTabPath = useCallback((path: string | null) => {
    activePathRef.current = path;
    setActivePath(path);
    onSelectPath(path);
  }, [onSelectPath]);

  const ensureTabPath = useCallback((path: string, makeActive = true) => {
    const normalized = normalizePath(path);
    if (!isDrawPath(normalized)) {
      return;
    }
    setTabPaths((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    if (makeActive) {
      selectTabPath(normalized);
    }
  }, [selectTabPath]);

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
        selectTabPath(nextActive);
      }
      return next;
    });
  }, [selectTabPath]);

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
      setStatus(formatDrawStartFailure(t, String(error)));
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

  const requestDeleteTabAndFile = useCallback(async (path: string) => {
    if (!projectId || busy) {
      return;
    }
    await onRequestFsAction("workspace", "delete", path);
  }, [busy, onRequestFsAction, projectId]);

  useEffect(() => {
    if (!projectId) {
      setTabPaths([]);
      setActivePath(null);
      activePathRef.current = null;
      setFramePhase("loading");
      setFrameSrc(null);
      setFrameFailureDetail(null);
      setFrameDocumentLoaded(false);
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
    const handleWorkspaceFs = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceFsEventDetail>).detail;
      if (!detail || detail.scope !== "workspace") {
        return;
      }
      const normalizedPath = normalizePath(detail.path);
      if (detail.action === "delete") {
        removeTabPath(normalizedPath);
        setStatus(t("toast.fsUpdated"));
        return;
      }
      if (detail.action === "rename" && detail.targetPath) {
        replaceTabPath(normalizedPath, normalizePath(detail.targetPath));
        setStatus(t("toast.fsUpdated"));
      }
    };

    window.addEventListener("latotex.workspace.fs", handleWorkspaceFs as EventListener);
    return () => {
      window.removeEventListener("latotex.workspace.fs", handleWorkspaceFs as EventListener);
    };
  }, [removeTabPath, replaceTabPath, t]);

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
      const handshakeAction = interpretDrawHandshakeMessage(message);
      if (handshakeAction.kind === "hostLoaded") {
        handshakeStageRef.current = "host_loaded";
        logDrawRuntime("INFO", "handshake_host_loaded");
        setStatus(t("draw.hostReady"));
        return;
      }
      if (handshakeAction.kind === "configure") {
        handshakeStageRef.current = "configure";
        logDrawRuntime("INFO", "handshake_configure");
        setStatus(t("draw.hostReady"));
        postToFrameRaw(DRAWIO_CONFIG_MESSAGE);
        return;
      }
      if (handshakeAction.kind === "init") {
        handshakeStageRef.current = "init";
        logDrawRuntime("INFO", "handshake_init");
        setFramePhase("ready");
        setFrameFailureDetail(null);
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
      if (handshakeAction.kind === "error") {
        const failure = formatDrawStartFailure(t, handshakeAction.detail);
        handshakeStageRef.current = "error";
        setFramePhase("error");
        setFrameSrc(null);
        setFrameFailureDetail(failure);
        setStatus(failure);
        logDrawRuntime("ERROR", `handshake_error: ${handshakeAction.detail}`);
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
      if (message.event === "export") {
        const currentActivePath = activePathRef.current;
        if (!projectId || !currentActivePath) {
          return;
        }
        void (async () => {
          setBusy(true);
          try {
            const savedPath = await persistDrawExportToWorkspace({
              activePath: currentActivePath,
              message,
              writeText: (path, content) => writeFile(projectId, path, content),
              writeBinary: (path, bytes) => writeFileBinary(projectId, path, bytes),
              onAfterSave: () => {
                window.dispatchEvent(new CustomEvent("latotex.workspace.rescan"));
              },
            });
            setStatus(`${t("draw.saved")} ${savedPath}`);
          } catch (error) {
            setStatus(String(error));
          } finally {
            setBusy(false);
          }
        })();
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activePath, loadActiveToFrame, logDrawRuntime, postToFrameRaw, projectId, t]);

  useEffect(() => {
    if (!frameSrc || !frameDocumentLoaded || framePhase !== "loading") {
      return;
    }
    handshakeStageRef.current = "iframe_loaded";
    logDrawRuntime("INFO", "iframe_document_loaded");
    initTimerRef.current = window.setTimeout(() => {
      const failure = formatDrawStartFailure(
        t,
        `drawio local resource channel did not initialize in time (last stage: ${handshakeStageRef.current})`,
      );
      logDrawRuntime("ERROR", `handshake_timeout: last_stage=${handshakeStageRef.current}`);
      setFramePhase("error");
      setFrameSrc(null);
      setFrameFailureDetail(failure);
      setStatus(failure);
    }, 20_000);
    return () => {
      if (initTimerRef.current !== null) {
        window.clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
    };
  }, [frameDocumentLoaded, framePhase, frameSrc, logDrawRuntime, t]);

  if (!projectId) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500">
        {t("workspace.noProject")}
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
      <DrawWorkspaceTabs
        tabPaths={tabPaths}
        activePath={activePath}
        renamingPath={renamingPath}
        renameInput={renameInput}
        busy={busy}
        status={status}
        onRenameInputChange={setRenameInput}
        onSelectPath={selectTabPath}
        onStartRename={startRename}
        onCancelRename={() => setRenamingPath(null)}
        onCommitRename={(path) => {
          void commitRename(path);
        }}
        onDeletePath={(path) => {
          void requestDeleteTabAndFile(path);
        }}
        onCreateNewTab={() => {
          void createNewTab();
        }}
        t={t}
      />

      <div className="relative min-h-0">
        {activePath ? (
          frameFailureDetail ? (
            <div className="flex h-full items-center justify-center p-4">
              <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-left shadow-sm">
                <div className="text-sm font-semibold text-amber-950">{t("draw.startFailed")}</div>
                <div className="mt-2 break-all text-xs leading-5 text-amber-900">{frameFailureDetail}</div>
                <button
                  type="button"
                  className="mt-4 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                  onClick={() => {
                    void retryFrameLoad();
                  }}
                >
                  {t("draw.retry")}
                </button>
              </div>
            </div>
          ) : frameSrc ? (
            <>
              <iframe
                ref={frameRef}
                key={frameSrc}
                src={frameSrc}
                title="drawio"
                className={`h-full w-full border-0 transition-opacity duration-200 ${framePhase === "ready" ? "opacity-100" : "opacity-0"}`}
                onLoad={() => {
                  handshakeStageRef.current = "iframe_load_event";
                  logDrawRuntime("INFO", "iframe_load_event");
                  setFrameDocumentLoaded(true);
                }}
              />
              {framePhase !== "ready" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/92 px-4 text-center text-xs text-slate-500">
                  {status || t("draw.waiting")}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("draw.waiting")}</div>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("draw.noTabs")}</div>
        )}
      </div>
    </section>
  );
}
