import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shareSessionCreate, shareSessionStatus, shareSessionStop } from "../../shared/api/share";
import type { ShareCommentItem, ShareSessionInfo } from "../../shared/types/app";
import type { CompileActionResult } from "./compileActionTypes";
import {
  applyYTextDelta,
  fromBase64,
  isShareReady,
  matchPath,
  postJson,
  toBase64,
  toShareCommentItems,
  wait,
  type ShareMode,
} from "./shareSessionUtils";

type TranslationFn = (key: any) => string;
type YTextLike = {
  toString: () => string;
  delete: (index: number, length: number) => void;
  insert: (index: number, text: string) => void;
  observe: (cb: () => void) => void;
  unobserve: (cb: () => void) => void;
};
type YDocLike = {
  getText: (name: string) => YTextLike;
  on: (event: "update", cb: (update: Uint8Array, origin: unknown) => void) => void;
  off: (event: "update", cb: (update: Uint8Array, origin: unknown) => void) => void;
  transact: (fn: () => void, origin?: unknown) => void;
  destroy: () => void;
};

export function useShareSession(params: {
  activeProjectId: string | null;
  selectedFile: string | null;
  editorContent: string;
  compiledPdfUrl: string | null;
  setEditorContent: (value: string) => void;
  onCompile: () => Promise<CompileActionResult | null>;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
  t: TranslationFn;
  suspended?: boolean;
}) {
  const {
    activeProjectId,
    selectedFile,
    editorContent,
    compiledPdfUrl,
    setEditorContent,
    onCompile,
    setToast,
    t,
    suspended = false,
  } = params;
  const [shareSession, setShareSession] = useState<ShareSessionInfo | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [shareComments, setShareComments] = useState<ShareCommentItem[]>([]);
  const [shareMode, setShareMode] = useState<ShareMode>("remote");
  const [shareSessionName, setShareSessionName] = useState("");
  const yDocRef = useRef<YDocLike | null>(null);
  const yTextRef = useRef<YTextLike | null>(null);
  const pullCursorRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const statusTimerRef = useRef<number | null>(null);
  const commentsTimerRef = useRef<number | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const compileTimerRef = useRef<number | null>(null);
  const statusFlightRef = useRef(false);
  const syncFlightRef = useRef(false);
  const compileFlightRef = useRef(false);
  const uploadingPdfRef = useRef(false);
  const lastUploadedPdfUrlRef = useRef<string | null>(null);
  const localClientIdRef = useRef(`desktop-${Math.random().toString(36).slice(2, 10)}`);
  const participantIdRef = useRef(`desktop-owner-${Math.random().toString(36).slice(2, 8)}`);
  const participantTokenRef = useRef("");
  const editorContentRef = useRef(editorContent);
  useEffect(() => {
    editorContentRef.current = editorContent;
  }, [editorContent]);
  const active = Boolean(!suspended && 
    shareSession?.active &&
      shareSession?.status === "ready" &&
      shareSession?.localUrl &&
      shareSession?.password,
  );
  const activeTarget = shareSession?.targetPath ?? null;
  const localUrl = shareSession?.localUrl ?? "";
  const sessionId = shareSession?.sessionId ?? "";
  const sessionPwd = shareSession?.password ?? "";
  const collabEnabled = Boolean(active && matchPath(selectedFile, activeTarget));
  const clearTimer = (timerRef: React.MutableRefObject<number | null>) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const refreshShareStatus = useCallback(async () => {
    if (statusFlightRef.current) {
      return shareSession;
    }
    statusFlightRef.current = true;
    try {
      const status = await shareSessionStatus();
      if (status.mode === "local" || status.mode === "remote") {
        setShareMode(status.mode);
      }
      setShareSession((status.active || status.status) ? status : null);
      return status;
    } catch (error) {
      setToast({ type: "error", message: String(error) });
      return null;
    } finally {
      statusFlightRef.current = false;
    }
  }, [setToast, shareSession]);
  const uploadPdfBytes = useCallback(async (session: ShareSessionInfo, pdfBytes: Uint8Array) => {
    if (!session.localUrl || !session.sessionId || !session.password) {
      throw new Error("share session missing upload endpoint");
    }
    await postJson(`${session.localUrl}/api/pdf/upload`, {
      sid: session.sessionId,
      pwd: session.password,
      pdfBase64: toBase64(pdfBytes),
    });
  }, []);

  const uploadCompiledPdfFromUrl = useCallback(async (session: ShareSessionInfo, pdfUrl: string) => {
    const response = await fetch(pdfUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`share pdf fetch failed: ${response.status}`);
    }
    await uploadPdfBytes(session, new Uint8Array(await response.arrayBuffer()));
  }, [uploadPdfBytes]);

  const waitForShareReady = useCallback(
    async (expectedSessionId: string, mode: ShareMode) => {
      const timeoutMs = mode === "local" ? 18_000 : 120_000;
      const startedAt = Date.now();
      let waitMs = 620;
      let lastSeen: ShareSessionInfo | null = null;
      while (Date.now() - startedAt < timeoutMs) {
        const next = await refreshShareStatus();
        if (!next) {
          await wait(waitMs);
          waitMs = Math.min(1_800, waitMs + 120);
          continue;
        }
        lastSeen = next;
        if (next.sessionId !== expectedSessionId) {
          await wait(waitMs);
          waitMs = Math.min(1_800, waitMs + 120);
          continue;
        }
        if (isShareReady(next, mode)) {
          return next;
        }
        if (next.status === "failed") {
          throw new Error(next.tunnelError || "share tunnel failed");
        }
        await wait(waitMs);
        waitMs = Math.min(1_800, waitMs + 120);
      }
      if (lastSeen && lastSeen.sessionId === expectedSessionId) {
        return lastSeen;
      }
      throw new Error(t("share.startTimeout"));
    },
    [refreshShareStatus, t],
  );
  const startShare = useCallback(async (mode: ShareMode = shareMode) => {
    if (!activeProjectId || !selectedFile || !selectedFile.toLowerCase().endsWith(".tex")) {
      setToast({ type: "error", message: t("share.startNeedTex") });
      return;
    }
    setShareBusy(true);
    let createdSession = false;
    try {
      const nextMode: ShareMode = mode === "local" ? "local" : "remote";
      setShareMode(nextMode);
      const nextSessionName = shareSessionName.trim();

      const created = await shareSessionCreate(
        activeProjectId,
        selectedFile,
        nextMode,
        nextSessionName || undefined,
      );
      createdSession = true;
      setShareSession(created);
      if (created.sessionName?.trim()) {
        setShareSessionName(created.sessionName.trim());
      }
      if (nextMode === "remote") {
        void onCompile().then((compileResult: CompileActionResult | null) => {
          if (compileResult?.status === "success" && compileResult.pdfUrl) {
            return uploadCompiledPdfFromUrl(created, compileResult.pdfUrl);
          }
          return undefined;
        }).catch(() => undefined);
      } else {
        void onCompile().catch(() => undefined);
      }
      const ready = await waitForShareReady(created.sessionId || "", nextMode);
      setShareSession(ready);
      if (ready.sessionName?.trim()) {
        setShareSessionName(ready.sessionName.trim());
      }
      if (isShareReady(ready, nextMode)) {
        setToast({ type: "info", message: t("share.started") });
      } else {
        setToast({ type: "info", message: t("share.status.startingRemote") });
      }
    } catch (error) {
      if (createdSession) {
        await shareSessionStop().catch(() => undefined);
        setShareSession(null);
      } else {
        const latest = await refreshShareStatus().catch(() => null);
        if (latest) {
          setShareSession(latest);
        }
      }
      setToast({ type: "error", message: String(error) });
    } finally {
      setShareBusy(false);
    }
  }, [activeProjectId, onCompile, refreshShareStatus, selectedFile, setToast, shareMode, shareSessionName, t, uploadCompiledPdfFromUrl, waitForShareReady]);
  const stopShare = useCallback(async () => {
    setShareBusy(true);
    try {
      await shareSessionStop();
      setShareSession(null);
      setToast({ type: "info", message: t("share.stopped") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setShareBusy(false);
    }
  }, [setToast, t]);
  useEffect(() => {
    void refreshShareStatus();
  }, [refreshShareStatus]);
  useEffect(() => {
    const next = shareSession?.sessionName?.trim();
    if (next) {
      setShareSessionName(next);
    }
  }, [shareSession?.sessionName]);
  useEffect(() => {
    clearTimer(statusTimerRef);
    const run = async () => {
      if (!shareSession) {
        return;
      }
      await refreshShareStatus();
      const fast =
        shareSession.status === "starting" || shareSession.status === "failed" || shareBusy;
      const hidden = typeof document !== "undefined" && document.hidden;
      statusTimerRef.current = Number(window.setTimeout(run, fast ? 1200 : hidden ? 4600 : 2800));
    };
    if (suspended) {
      return;
    }
    if (shareSession) {
      statusTimerRef.current = Number(window.setTimeout(run, 1100));
    }
    return () => clearTimer(statusTimerRef);
  }, [refreshShareStatus, shareBusy, shareSession, suspended]);
  useEffect(() => {
    clearTimer(commentsTimerRef);
    if (!active || !localUrl || !sessionId || !sessionPwd) {
      setShareComments([]);
      return;
    }
    let disposed = false;
    const pullComments = async () => {
      const response = await fetch(
        `${localUrl}/api/comments/list?sid=${encodeURIComponent(sessionId)}&pwd=${encodeURIComponent(sessionPwd)}&t=${Date.now()}`,
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = await response.json() as { comments?: any[]; sessionName?: string };
      if (disposed) {
        return;
      }
      setShareComments(toShareCommentItems(payload.comments ?? []));
      if (typeof payload.sessionName === "string" && payload.sessionName.trim()) {
        setShareSessionName(payload.sessionName.trim());
      }
    };
    const loop = async () => {
      try {
        await pullComments();
      } catch {
        // noop
      }
      if (disposed) {
        return;
      }
      const hidden = typeof document !== "undefined" && document.hidden;
      commentsTimerRef.current = Number(window.setTimeout(loop, hidden ? 6000 : 2400));
    };
    void loop();
    return () => {
      disposed = true;
      clearTimer(commentsTimerRef);
    };
  }, [active, localUrl, sessionId, sessionPwd]);
  useEffect(() => {
    if (!collabEnabled || !localUrl || !sessionId || !sessionPwd) {
      setSyncing(false);
      yDocRef.current = null;
      yTextRef.current = null;
      participantTokenRef.current = "";
      clearTimer(syncTimerRef);
      return;
    }
    let disposed = false;
    let dispose: (() => void) | null = null;
    const start = async () => {
      const yjs = await import("yjs");
      if (disposed) {
        return;
      }
      const doc = new yjs.Doc();
      const yText = doc.getText("tex");
      yDocRef.current = doc as unknown as YDocLike;
      yTextRef.current = yText as unknown as YTextLike;
      pullCursorRef.current = 0;
      applyingRemoteRef.current = false;
      setSyncing(true);
      const joined = await postJson(`${localUrl}/api/join`, {
        sid: sessionId,
        pwd: sessionPwd,
        clientId: localClientIdRef.current,
        username: t("share.desktopUser"),
      }) as { participantId?: string; participantToken?: string };
      if (joined?.participantId) {
        participantIdRef.current = String(joined.participantId);
      }
      participantTokenRef.current = String(joined?.participantToken ?? "");
      const pushUpdate = async (update: Uint8Array) => {
        await postJson(`${localUrl}/api/sync/push`, {
          sid: sessionId,
          pwd: sessionPwd,
          clientId: localClientIdRef.current,
          participantId: participantIdRef.current,
          participantToken: participantTokenRef.current,
          username: t("share.desktopUser"),
          action: t("share.action.editing"),
          update: toBase64(update),
        });
      };
      const onDocUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === "remote" || applyingRemoteRef.current) {
          return;
        }
        void pushUpdate(update).catch(() => undefined);
      };
      doc.on("update", onDocUpdate);
      const onText = () => {
        const next = yText.toString();
        if (next === editorContentRef.current) {
          return;
        }
        applyingRemoteRef.current = true;
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            setEditorContent(next);
            applyingRemoteRef.current = false;
          });
        } else {
          setEditorContent(next);
          applyingRemoteRef.current = false;
        }
      };
      yText.observe(onText);
      const initialize = async () => {
        const response = await fetch(
          `${localUrl}/api/snapshot?sid=${encodeURIComponent(sessionId)}&pwd=${encodeURIComponent(sessionPwd)}`,
        );
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = await response.json() as { content?: string };
        const initial = payload.content ?? "";
        doc.transact(() => {
          applyYTextDelta(yText as unknown as YTextLike, yText.toString(), initial);
        }, "remote");
      };
      const pullUpdates = async () => {
        if (syncFlightRef.current) {
          return;
        }
        syncFlightRef.current = true;
        try {
          const tokenParam = participantTokenRef.current
            ? `&participantToken=${encodeURIComponent(participantTokenRef.current)}`
            : "";
          const response = await fetch(
            `${localUrl}/api/sync/pull?sid=${encodeURIComponent(sessionId)}&pwd=${encodeURIComponent(sessionPwd)}&participantId=${encodeURIComponent(participantIdRef.current)}${tokenParam}&cursor=${pullCursorRef.current}`,
          );
          if (!response.ok) {
            throw new Error(await response.text());
          }
          const payload = await response.json() as { nextCursor?: number; events?: Array<{ seq: number; from: string; update: string }> };
          const updates = Array.isArray(payload.events) ? payload.events : [];
          for (const event of updates) {
            pullCursorRef.current = Math.max(pullCursorRef.current, Number(event.seq || 0));
            if (event.from === localClientIdRef.current) {
              continue;
            }
            applyingRemoteRef.current = true;
            try {
              yjs.applyUpdate(doc, fromBase64(event.update), "remote");
            } finally {
              applyingRemoteRef.current = false;
            }
          }
          pullCursorRef.current = Math.max(pullCursorRef.current, Number(payload.nextCursor || pullCursorRef.current));
        } finally {
          syncFlightRef.current = false;
        }
      };
      const syncLoop = async () => {
        if (!collabEnabled || disposed) {
          return;
        }
        await pullUpdates().catch(() => undefined);
        const hidden = typeof document !== "undefined" && document.hidden;
        syncTimerRef.current = Number(window.setTimeout(syncLoop, hidden ? 1800 : 820));
      };
      void initialize().catch((error) => {
        setToast({ type: "error", message: String(error) });
      });
      syncTimerRef.current = Number(window.setTimeout(syncLoop, 760));
      dispose = () => {
        setSyncing(false);
        doc.off("update", onDocUpdate);
        yText.unobserve(onText);
        clearTimer(syncTimerRef);
        yDocRef.current = null;
        yTextRef.current = null;
        participantTokenRef.current = "";
        doc.destroy();
      };
    };
    void start().catch((error) => {
      if (!disposed) {
        setToast({ type: "error", message: String(error) });
      }
    });
    return () => {
      disposed = true;
      if (dispose) {
        dispose();
      } else {
        setSyncing(false);
        clearTimer(syncTimerRef);
        yDocRef.current = null;
        yTextRef.current = null;
        participantTokenRef.current = "";
      }
    };
  }, [collabEnabled, localUrl, sessionId, sessionPwd, setEditorContent, setToast, t]);
  useEffect(() => {
    if (!collabEnabled || applyingRemoteRef.current) {
      return;
    }
    const yText = yTextRef.current;
    const doc = yDocRef.current;
    if (!yText || !doc) {
      return;
    }
    const current = yText.toString();
    if (current === editorContent) {
      return;
    }
    doc.transact(() => {
      applyYTextDelta(yText, current, editorContent);
    }, "editor");
  }, [collabEnabled, editorContent]);
  useEffect(() => {
    clearTimer(compileTimerRef);
    if (!active || !localUrl || !sessionId || !sessionPwd) {
      return;
    }
    const compileLoop = async () => {
      if (compileFlightRef.current) {
        compileTimerRef.current = Number(window.setTimeout(compileLoop, 2000));
        return;
      }
      compileFlightRef.current = true;
      try {
        const payload = await postJson(`${localUrl}/api/compile/take`, {
          sid: sessionId,
          pwd: sessionPwd,
        });
        if (payload?.requested) {
          await onCompile();
        }
      } catch {
        // noop
      } finally {
        compileFlightRef.current = false;
      }
      const hidden = typeof document !== "undefined" && document.hidden;
      compileTimerRef.current = Number(window.setTimeout(compileLoop, hidden ? 3600 : 2200));
    };
    compileTimerRef.current = Number(window.setTimeout(compileLoop, 2200));
    return () => clearTimer(compileTimerRef);
  }, [active, localUrl, onCompile, sessionId, sessionPwd]);
  useEffect(() => {
    if (!active || !localUrl || !sessionId || !sessionPwd || !compiledPdfUrl) {
      return;
    }
    if (uploadingPdfRef.current || lastUploadedPdfUrlRef.current === compiledPdfUrl) {
      return;
    }
    uploadingPdfRef.current = true;
    lastUploadedPdfUrlRef.current = compiledPdfUrl;
    void fetch(compiledPdfUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        const raw = new Uint8Array(buffer);
        return postJson(`${localUrl}/api/pdf/upload`, {
          sid: sessionId,
          pwd: sessionPwd,
          pdfBase64: toBase64(raw),
        });
      })
      .catch(() => undefined)
      .finally(() => {
        uploadingPdfRef.current = false;
      });
  }, [active, compiledPdfUrl, localUrl, sessionId, sessionPwd]);
  return useMemo(
    () => ({
      shareSession,
      shareBusy,
      shareSyncing: syncing,
      shareMode,
      shareComments,
      shareSessionName,
      setShareMode,
      setShareSessionName,
      startShare,
      stopShare,
      refreshShareStatus,
    }),
    [
      refreshShareStatus,
      shareBusy,
      shareComments,
      shareMode,
      shareSession,
      shareSessionName,
      startShare,
      stopShare,
      syncing,
    ],
  );
}

