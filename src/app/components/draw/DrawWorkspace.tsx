import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import { readFile, workspaceExportAsset, writeFile } from "../../../shared/api/workspace";
import type { FsAction, FsScope } from "../../../shared/types/app";
import { buildDrawExportAction, buildDrawLoadPayload, buildRenamedDrawPath, decodeDrawExportPayload, DRAWIO_CONFIG_MESSAGE, inferExportExtension, interpretDrawHandshakeMessage, isDrawPath, loadPersistedTabs, mergeDrawExportRequest, normalizePath, parseDrawMessage, type PendingDrawExportRequest, savePersistedTabs, shouldClearPendingDrawExport, tabTitleFromPath, toDrawExportDialogDefaults } from "./drawWorkspaceUtils";
import { isMissingFileReadError } from "./drawFileError";
import { DrawWorkspaceHeader } from "./DrawWorkspaceHeader";
import { formatDrawStartFailure, useDrawFrameLifecycle } from "./drawFrameLifecycle";
import { DrawWorkspaceFrameSurface, DrawWorkspaceNoProject } from "./DrawWorkspaceFrameSurface";
import { EMPTY_DIAGRAM, type WorkspaceFsEventDetail } from "./drawWorkspaceConstants";

type TranslationFn = (key: any) => string;
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
  const { locale } = useI18n();
  const xmlByPathRef = useRef<Record<string, string>>({});
  const renameCommittingPathRef = useRef<string | null>(null);
  const activePathRef = useRef<string | null>(null);
  const pendingExportRequestRef = useRef<PendingDrawExportRequest | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [tabPaths, setTabPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const {
    frameRef,
    initTimerRef,
    loadTimerRef,
    handshakeStageRef,
    frameSrc,
    setFrameSrc,
    framePhase,
    setFramePhase,
    frameFailureDetail,
    setFrameFailureDetail,
    setFrameDocumentLoaded,
    logDrawRuntime,
    retryFrameLoad,
  } = useDrawFrameLifecycle({ locale, t, setStatus });

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
    postToFrame(buildDrawLoadPayload(xml));
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
      if (message.event === "export_request") {
        const currentActivePath = activePathRef.current;
        if (!projectId || !currentActivePath) {
          return;
        }
        const request: PendingDrawExportRequest = {
          filename: typeof message.filename === "string" ? message.filename : undefined,
          format: typeof message.format === "string" ? message.format : undefined,
          scale: typeof message.scale === "number" ? message.scale : undefined,
          border: typeof message.border === "number" ? message.border : undefined,
          dpi: typeof message.dpi === "number" ? message.dpi : undefined,
          grid: typeof message.grid === "boolean" ? message.grid : undefined,
          background:
            message.background === null
              ? null
              : typeof message.background === "string"
                ? message.background
                : undefined,
          pageId: typeof message.pageId === "string" ? message.pageId : undefined,
          currentPage: typeof message.currentPage === "boolean" ? message.currentPage : undefined,
          allPages: typeof message.allPages === "boolean" ? message.allPages : undefined,
          embedImages: typeof message.embedImages === "boolean" ? message.embedImages : undefined,
          shadow: typeof message.shadow === "boolean" ? message.shadow : undefined,
        };
        pendingExportRequestRef.current = request;
        logDrawRuntime(
          "INFO",
          `export_requested: format=${String(request.format ?? "png")}, filename=${String(request.filename ?? "")}`,
        );
        setBusy(true);
        setStatus(t("draw.waiting"));
        postToFrame(buildDrawExportAction(request));
        return;
      }
      if (message.event === "export") {
        const currentActivePath = activePathRef.current;
        if (!projectId || !currentActivePath) {
          return;
        }
        void (async () => {
          setBusy(true);
          setStatus(t("draw.waiting"));
          try {
            const mergedExportMessage = mergeDrawExportRequest(
              message,
              pendingExportRequestRef.current,
            );
            logDrawRuntime(
              "INFO",
              `export_payload_received: format=${String(mergedExportMessage.format ?? "")}, filename=${String(mergedExportMessage.filename ?? "")}`,
            );
            const decoded = decodeDrawExportPayload(mergedExportMessage);
            const extension = inferExportExtension(mergedExportMessage, decoded.mime);
            const defaults = toDrawExportDialogDefaults(
              currentActivePath,
              extension,
              typeof mergedExportMessage.filename === "string"
                ? mergedExportMessage.filename
                : undefined,
            );
            const exportResult = await workspaceExportAsset(
              projectId,
              defaults.defaultRelativeDir,
              defaults.defaultFileName,
              decoded.bytes,
            );
            pendingExportRequestRef.current = null;
            if (!exportResult) {
              logDrawRuntime("INFO", "export_cancelled");
              setStatus(t("draw.ready"));
              return;
            }
            window.dispatchEvent(new CustomEvent("latotex.workspace.fs", {
              detail: { scope: "workspace", action: "create_file", path: exportResult.savedPath },
            }));
            window.dispatchEvent(new CustomEvent("latotex.workspace.rescan"));
            logDrawRuntime("INFO", `export_saved: ${exportResult.savedPath}`);
            setStatus(`${t("draw.saved")} ${exportResult.savedPath}`);
          } catch (error) {
            pendingExportRequestRef.current = null;
            logDrawRuntime("ERROR", `export_failed: ${String(error)}`);
            setStatus(String(error));
          } finally {
            setBusy(false);
          }
        })();
        return;
      }
      if (shouldClearPendingDrawExport(pendingExportRequestRef.current, message)) {
        pendingExportRequestRef.current = null;
        setBusy(false);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activePath, loadActiveToFrame, logDrawRuntime, postToFrame, postToFrameRaw, projectId, t]);

  if (!projectId) {
    return <DrawWorkspaceNoProject t={t} />;
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
      <DrawWorkspaceHeader
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
        onClosePath={(path) => {
          removeTabPath(path);
        }}
        onCreateNewTab={() => {
          void createNewTab();
        }}
        t={t}
      />

      <div className="relative min-h-0">
        <DrawWorkspaceFrameSurface
          activePath={activePath}
          frameFailureDetail={frameFailureDetail}
          frameRef={frameRef}
          frameSrc={frameSrc}
          framePhase={framePhase}
          handshakeStageRef={handshakeStageRef}
          loadTimerRef={loadTimerRef}
          status={status}
          retryFrameLoad={retryFrameLoad}
          setFrameDocumentLoaded={setFrameDocumentLoaded}
          setFrameFailureDetail={setFrameFailureDetail}
          setFramePhase={setFramePhase}
          setFrameSrc={setFrameSrc}
          setStatus={setStatus}
          logDrawRuntime={logDrawRuntime}
          t={t}
        />
      </div>
    </section>
  );
}
