import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shareSessionCreate, shareSessionStatus, shareSessionStop } from "../../shared/api/share";
import type { ShareCommentItem, ShareSessionInfo } from "../../shared/types/app";
import type { CompileActionResult } from "./compileActionTypes";
import { useShareCollaborationSync } from "./useShareCollaborationSync";
import {
  isShareReady,
  matchPath,
  postJson,
  toBase64,
  toShareCommentItems,
  waitForShareSessionReady,
  type ShareMode,
} from "./shareSessionUtils";

type TranslationFn = (key: any) => string;

export function useShareSession(params: {
  activeProjectId: string | null;
  selectedFile: string | null;
  editorContent: string;
  compiledPdfUrl: string | null;
  setEditorContent: (value: string) => void;
  markPathSaved: (path: string, content: string) => void;
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
    markPathSaved,
    onCompile,
    setToast,
    t,
    suspended = false,
  } = params;
  const [shareSession, setShareSession] = useState<ShareSessionInfo | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareComments, setShareComments] = useState<ShareCommentItem[]>([]);
  const [shareMode, setShareMode] = useState<ShareMode>("remote");
  const [shareSessionName, setShareSessionName] = useState("");
  const statusTimerRef = useRef<number | null>(null);
  const commentsTimerRef = useRef<number | null>(null);
  const compileTimerRef = useRef<number | null>(null);
  const statusFlightRef = useRef(false);
  const compileFlightRef = useRef(false);
  const uploadingPdfRef = useRef(false);
  const lastUploadedPdfUrlRef = useRef<string | null>(null);
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
  const collaboration = useShareCollaborationSync({
    activeProjectId,
    activeTarget,
    collabEnabled,
    editorContent,
    localUrl,
    sessionId,
    sessionPwd,
    setEditorContent,
    markPathSaved,
    setToast,
    t,
  });
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
      const ready = await waitForShareSessionReady({
        expectedSessionId: created.sessionId || "",
        mode: nextMode,
        refreshShareStatus,
        startTimeoutMessage: t("share.startTimeout"),
      });
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
  }, [activeProjectId, onCompile, refreshShareStatus, selectedFile, setToast, shareMode, shareSessionName, t, uploadCompiledPdfFromUrl]);
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
      shareSyncing: collaboration.shareSyncing,
      shareConflict: collaboration.shareConflict,
      shareMode,
      shareComments,
      shareSessionName,
      setShareMode,
      setShareSessionName,
      startShare,
      stopShare,
      refreshShareStatus,
      resolveShareConflict: collaboration.resolveShareConflict,
    }),
    [
      collaboration.resolveShareConflict,
      collaboration.shareConflict,
      collaboration.shareSyncing,
      refreshShareStatus,
      shareBusy,
      shareComments,
      shareMode,
      shareSession,
      shareSessionName,
      startShare,
      stopShare,
    ],
  );
}

