import { useCallback, useEffect, useRef, useState } from "react";
import { waitForResourceWarmup } from "../../../shared/api/resource-warmup";
import { prioritizeReachableLocalResourceCandidates } from "../../../shared/utils/localResourceProbe";
import { readFile, writeFile, writeFileBinary } from "../../../shared/api/workspace";
import type { FsAction, FsScope } from "../../../shared/types/app";
import type { ComponentStartupState } from "../../hooks/startupState";
import {
  buildDrawioEntryCandidates,
  buildRenamedDrawPath,
  isDrawPath,
  loadPersistedTabs,
  normalizePath,
  parseDrawMessage,
  persistDrawExportToWorkspace,
  resolveDrawioHostFrameCandidates,
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

export function DrawWorkspace(props: {
  componentStartupState: ComponentStartupState;
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
  const { componentStartupState, projectId, selectedPath, onSelectPath, onRequestFsAction, onRunFsAction, t } = props;
  const startupBlocked = componentStartupState !== "ready";
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const initTimerRef = useRef<number | null>(null);
  const xmlByPathRef = useRef<Record<string, string>>({});
  const renameCommittingPathRef = useRef<string | null>(null);
  const activePathRef = useRef<string | null>(null);
  const frameSrcRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [frameCandidates, setFrameCandidates] = useState<string[]>([]);
  const [frameCandidateIndex, setFrameCandidateIndex] = useState(0);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [tabPaths, setTabPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadFrameCandidates = async () => {
      setStatus(t("draw.warming"));
      let warmupCandidates: string[] | null = null;
      try {
        if (projectId) {
          const warmup = await waitForResourceWarmup({
            projectId,
            scopes: ["drawio"],
            timeoutMs: 32_000,
          });
          const drawioInfo = warmup.result?.drawio ?? null;
          if (drawioInfo) {
            warmupCandidates = await prioritizeReachableLocalResourceCandidates(buildDrawioEntryCandidates(drawioInfo));
          }
        }
      } catch {
        warmupCandidates = null;
      }

      const nextCandidates = warmupCandidates ?? await resolveDrawioHostFrameCandidates();
      if (cancelled) {
        return;
      }
      const resolved = Array.isArray(nextCandidates)
        ? nextCandidates.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      if (resolved.length === 0) {
        setFrameCandidates([]);
        setFrameCandidateIndex(0);
        setReady(false);
        setFrameSrc(null);
        frameSrcRef.current = null;
        setStatus(formatDrawStartFailure(t, "no reachable drawio host found"));
        return;
      }

      setFrameCandidates(resolved);
      setFrameCandidateIndex(0);
      setReady(false);
      setFrameSrc(resolved[0]);
      frameSrcRef.current = resolved[0];
      setStatus(t("draw.waiting"));
    };

    void loadFrameCandidates().catch((error) => {
      if (cancelled) {
        return;
      }
      setFrameCandidates([]);
      setFrameCandidateIndex(0);
      setReady(false);
      setFrameSrc(null);
      frameSrcRef.current = null;
      setStatus(formatDrawStartFailure(t, String(error)));
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
      setReady(false);
      setFrameCandidates([]);
      setFrameCandidateIndex(0);
      setFrameSrc(null);
      frameSrcRef.current = null;
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
  }, [activePath, loadActiveToFrame, postToFrame, projectId, t]);

  useEffect(() => {
    if (!frameSrc) {
      return;
    }
    initTimerRef.current = window.setTimeout(() => {
      if (ready) {
        return;
      }
      const nextIndex = frameCandidateIndex + 1;
      if (nextIndex < frameCandidates.length) {
        const nextSrc = frameCandidates[nextIndex];
        setFrameCandidateIndex(nextIndex);
        setReady(false);
        setFrameSrc(nextSrc);
        frameSrcRef.current = nextSrc;
        setStatus(t("draw.waiting"));
        return;
      }
      setStatus(formatDrawStartFailure(t, `tried ${frameCandidates.length} host(s), all failed`));
    }, 12_000);
    return () => {
      if (initTimerRef.current !== null) {
        window.clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
    };
  }, [frameCandidateIndex, frameCandidates, frameSrc, ready, t]);

  if (!projectId) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500" data-startup-state={componentStartupState} aria-busy={startupBlocked}>
        {t("workspace.noProject")}
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft" data-startup-state={componentStartupState} aria-busy={startupBlocked}>
      <DrawWorkspaceTabs
        tabPaths={tabPaths}
        activePath={activePath}
        renamingPath={renamingPath}
        renameInput={renameInput}
        busy={busy || startupBlocked}
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
