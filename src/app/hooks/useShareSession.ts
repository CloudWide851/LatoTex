import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shareSessionCreate, shareSessionStatus, shareSessionStop } from "../../shared/api/desktop";
import type { ShareCommentItem, ShareSessionInfo } from "../../shared/types/app";

type TranslationFn = (key: any) => string;
type ShareMode = "local" | "remote";
type YTextLike = {
  toString: () => string;
  delete: (index: number, length: number) => void;
  insert: (index: number, text: string) => void;
  observe: (cb: () => void) => void;
  unobserve: (cb: () => void) => void;
};
type YArrayLike = {
  toArray: () => any[];
  observeDeep: (cb: () => void) => void;
  unobserveDeep: (cb: () => void) => void;
};
type YDocLike = {
  getText: (name: string) => YTextLike;
  getArray: (name: string) => YArrayLike;
  on: (event: "update", cb: (update: Uint8Array, origin: unknown) => void) => void;
  off: (event: "update", cb: (update: Uint8Array, origin: unknown) => void) => void;
  transact: (fn: () => void, origin?: unknown) => void;
  destroy: () => void;
};

function toShareCommentItems(rawItems: any[]): ShareCommentItem[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }
  return rawItems
    .map((item, index) => {
      const pageRaw = Number(item?.page);
      const startRaw = Number(item?.start);
      const endRaw = Number(item?.end);
      return {
        id: String(item?.id ?? `comment-${index + 1}`),
        username: String(item?.username ?? "Guest"),
        text: String(item?.text ?? ""),
        quote: typeof item?.quote === "string" ? item.quote : undefined,
        page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : undefined,
        start: Number.isFinite(startRaw) && startRaw >= 0 ? startRaw : undefined,
        end: Number.isFinite(endRaw) && endRaw >= 0 ? endRaw : undefined,
        createdAt: typeof item?.createdAt === "string" ? item.createdAt : undefined,
      } satisfies ShareCommentItem;
    })
    .filter((item) => item.text.trim().length > 0 || (item.quote?.trim().length ?? 0) > 0)
    .slice(-120)
    .reverse();
}

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

function applyYTextDelta(target: YTextLike, current: string, next: string) {
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
  const [shareComments, setShareComments] = useState<ShareCommentItem[]>([]);
  const [shareMode, setShareMode] = useState<ShareMode>("remote");

  const yDocRef = useRef<YDocLike | null>(null);
  const yTextRef = useRef<YTextLike | null>(null);
  const yCommentsRef = useRef<YArrayLike | null>(null);
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

  const waitForShareReady = useCallback(
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
        if (next.status === "ready" && next.activeJoinUrl) {
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

  const startShare = useCallback(async (mode: ShareMode = shareMode) => {
    if (!activeProjectId || !selectedFile || !selectedFile.toLowerCase().endsWith(".tex")) {
      setToast({ type: "error", message: t("share.startNeedTex") });
      return;
    }
    setShareBusy(true);
    try {
      const nextMode: ShareMode = mode === "local" ? "local" : "remote";
      setShareMode(nextMode);
      const created = await shareSessionCreate(activeProjectId, selectedFile, nextMode);
      setShareSession(created);
      const ready = await waitForShareReady(created.sessionId || "");
      setShareSession(ready);
      setToast({ type: "info", message: t("share.started") });
    } catch (error) {
      const latest = await refreshShareStatus().catch(() => null);
      if (latest) {
        setShareSession(latest);
      }
      setToast({ type: "error", message: String(error) });
    } finally {
      setShareBusy(false);
    }
  }, [activeProjectId, refreshShareStatus, selectedFile, setToast, shareMode, t, waitForShareReady]);

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
      setShareComments([]);
      yDocRef.current = null;
      yTextRef.current = null;
      yCommentsRef.current = null;
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
      const yComments = doc.getArray("comments");
      yDocRef.current = doc as unknown as YDocLike;
      yTextRef.current = yText as unknown as YTextLike;
      yCommentsRef.current = yComments as unknown as YArrayLike;
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
      const onComments = () => {
        setShareComments(toShareCommentItems(yComments.toArray()));
      };
      yComments.observeDeep(onComments);

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
        onComments();
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
        yComments.unobserveDeep(onComments);
        clearTimer(syncTimerRef);
        yDocRef.current = null;
        yTextRef.current = null;
        yCommentsRef.current = null;
        setShareComments([]);
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
        yCommentsRef.current = null;
        setShareComments([]);
      }
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
      shareMode,
      shareComments,
      setShareMode,
      startShare,
      stopShare,
      refreshShareStatus,
    }),
    [refreshShareStatus, shareBusy, shareComments, shareMode, shareSession, startShare, stopShare, syncing],
  );
}
