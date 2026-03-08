import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { shareSessionCreate, shareSessionStatus, shareSessionStop } from "../../shared/api/desktop";
import type { ShareSessionInfo } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function fromBase64(raw: string): Uint8Array {
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function postJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response.json();
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function matchPath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.replace(/\\/g, "/") === right.replace(/\\/g, "/");
}

function applyYTextDelta(target: Y.Text, current: string, next: string) {
  if (current === next) {
    return;
  }
  let start = 0;
  const maxStart = Math.min(current.length, next.length);
  while (start < maxStart && current[start] === next[start]) {
    start += 1;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current[endCurrent - 1] === next[endNext - 1]
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }
  const removeLen = endCurrent - start;
  const insert = next.slice(start, endNext);
  if (removeLen > 0) {
    target.delete(start, removeLen);
  }
  if (insert.length > 0) {
    target.insert(start, insert);
  }
}

export function useShareSession(params: {
  activeProjectId: string | null;
  selectedFile: string | null;
  editorContent: string;
  compiledPdfUrl: string | null;
  setEditorContent: (value: string) => void;
  onCompile: () => Promise<void>;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
  t: TranslationFn;
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
  } = params;

  const [shareSession, setShareSession] = useState<ShareSessionInfo | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const pullCursorRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const statusTimerRef = useRef<number | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const compileTimerRef = useRef<number | null>(null);
  const statusFlightRef = useRef(false);
  const syncFlightRef = useRef(false);
  const compileFlightRef = useRef(false);
  const uploadingPdfRef = useRef(false);
  const lastUploadedPdfUrlRef = useRef<string | null>(null);
  const localClientIdRef = useRef(`desktop-${Math.random().toString(36).slice(2, 10)}`);
  const participantIdRef = useRef(`desktop-owner-${Math.random().toString(36).slice(2, 8)}`);
  const editorContentRef = useRef(editorContent);

  useEffect(() => {
    editorContentRef.current = editorContent;
  }, [editorContent]);

  const active = Boolean(
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
      setShareSession((status.active || status.status) ? status : null);
      return status;
    } catch (error) {
      setToast({ type: "error", message: String(error) });
      return null;
    } finally {
      statusFlightRef.current = false;
    }
  }, [setToast, shareSession]);

  const waitForTunnelReady = useCallback(
    async (expectedSessionId: string) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 48_000) {
        const next = await refreshShareStatus();
        if (!next) {
          await wait(680);
          continue;
        }
        if (next.sessionId !== expectedSessionId) {
          await wait(680);
          continue;
        }
        if (next.status === "ready" && next.tunnelUrl) {
          return next;
        }
        if (next.status === "failed") {
          throw new Error(next.tunnelError || "share tunnel failed");
        }
        await wait(680);
      }
      throw new Error(t("share.startTimeout"));
    },
    [refreshShareStatus, t],
  );

  const startShare = useCallback(async () => {
    if (!activeProjectId || !selectedFile || !selectedFile.toLowerCase().endsWith(".tex")) {
      setToast({ type: "error", message: t("share.startNeedTex") });
      return;
    }
    setShareBusy(true);
    try {
      const created = await shareSessionCreate(activeProjectId, selectedFile);
      setShareSession(created);
      const ready = await waitForTunnelReady(created.sessionId || "");
      setShareSession(ready);
      setToast({ type: "info", message: t("share.started") });
    } catch (error) {
      await shareSessionStop().catch(() => undefined);
      setShareSession(null);
      setToast({ type: "error", message: String(error) });
    } finally {
      setShareBusy(false);
    }
  }, [activeProjectId, selectedFile, setToast, t, waitForTunnelReady]);

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
    if (shareSession) {
      statusTimerRef.current = Number(window.setTimeout(run, 1100));
    }
    return () => clearTimer(statusTimerRef);
  }, [refreshShareStatus, shareBusy, shareSession]);

  useEffect(() => {
    if (!collabEnabled || !localUrl || !sessionId || !sessionPwd) {
      setSyncing(false);
      yDocRef.current = null;
      yTextRef.current = null;
      clearTimer(syncTimerRef);
      return;
    }

    const doc = new Y.Doc();
    const yText = doc.getText("tex");
    yDocRef.current = doc;
    yTextRef.current = yText;
    pullCursorRef.current = 0;
    applyingRemoteRef.current = false;
    setSyncing(true);

    const pushUpdate = async (update: Uint8Array) => {
      await postJson(`${localUrl}/api/sync/push`, {
        sid: sessionId,
        pwd: sessionPwd,
        clientId: localClientIdRef.current,
        participantId: participantIdRef.current,
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
        applyYTextDelta(yText, yText.toString(), initial);
      }, "remote");
    };

    const pullUpdates = async () => {
      if (syncFlightRef.current) {
        return;
      }
      syncFlightRef.current = true;
      try {
        const response = await fetch(
          `${localUrl}/api/sync/pull?sid=${encodeURIComponent(sessionId)}&pwd=${encodeURIComponent(sessionPwd)}&cursor=${pullCursorRef.current}`,
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
            Y.applyUpdate(doc, fromBase64(event.update), "remote");
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
      if (!collabEnabled) {
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

    return () => {
      setSyncing(false);
      doc.off("update", onDocUpdate);
      yText.unobserve(onText);
      clearTimer(syncTimerRef);
      yDocRef.current = null;
      yTextRef.current = null;
      doc.destroy();
    };
  }, [collabEnabled, localUrl, sessionId, sessionPwd, setEditorContent, setToast]);

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
      startShare,
      stopShare,
      refreshShareStatus,
    }),
    [refreshShareStatus, shareBusy, shareSession, startShare, stopShare, syncing],
  );
}
