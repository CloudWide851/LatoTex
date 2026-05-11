import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  applyYTextDelta,
  detectShareConflict,
  fromBase64,
  matchPath,
  postJson,
  scheduleShareFileWriteBack,
  toBase64,
  type ShareConflict,
  type ShareConflictResolution,
  type YDocLike,
  type YTextLike,
} from "./shareSessionUtils";

type TranslationFn = (key: any) => string;

export function useShareCollaborationSync(params: {
  activeProjectId: string | null;
  activeTarget: string | null;
  collabEnabled: boolean;
  editorContent: string;
  localUrl: string;
  sessionId: string;
  sessionPwd: string;
  setEditorContent: (value: string) => void;
  markPathSaved: (path: string, content: string) => void;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
  t: TranslationFn;
}) {
  const {
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
  } = params;
  const [syncing, setSyncing] = useState(false);
  const [shareConflict, setShareConflict] = useState<ShareConflict | null>(null);
  const yDocRef = useRef<YDocLike | null>(null);
  const yTextRef = useRef<YTextLike | null>(null);
  const pullCursorRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const writeBackTimerRef = useRef<number | null>(null);
  const syncFlightRef = useRef(false);
  const localClientIdRef = useRef(`desktop-${Math.random().toString(36).slice(2, 10)}`);
  const participantIdRef = useRef(`desktop-owner-${Math.random().toString(36).slice(2, 8)}`);
  const participantTokenRef = useRef("");
  const editorContentRef = useRef(editorContent);
  const lastWriteBackRef = useRef<{ path: string; content: string } | null>(null);
  const lastSyncedRef = useRef<{ path: string; content: string } | null>(null);
  const shareConflictRef = useRef<ShareConflict | null>(null);
  const remoteSeqRef = useRef<number | null>(null);

  const clearTimer = (timerRef: MutableRefObject<number | null>) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const updateConflict = useCallback((next: ShareConflict | null) => {
    shareConflictRef.current = next;
    setShareConflict(next);
  }, []);
  useEffect(() => {
    editorContentRef.current = editorContent;
  }, [editorContent]);
  useEffect(() => {
    updateConflict(null);
    lastSyncedRef.current = null;
  }, [activeTarget, updateConflict]);

  const scheduleLocalWriteBack = useCallback((path: string | null, content: string) => {
    scheduleShareFileWriteBack({
      projectId: activeProjectId,
      path,
      content,
      timerRef: writeBackTimerRef,
      lastWriteRef: lastWriteBackRef,
      clearTimer,
      markPathSaved,
      onError: (error) => {
        void postJson(`${localUrl}/api/presence/ping`, {
          sid: sessionId,
          pwd: sessionPwd,
          participantId: participantIdRef.current,
          participantToken: participantTokenRef.current,
          action: `writeback failed: ${String(error).slice(0, 120)}`,
        }).catch(() => undefined);
      },
    });
  }, [activeProjectId, localUrl, markPathSaved, sessionId, sessionPwd]);

  const resolveShareConflict = useCallback((resolution: ShareConflictResolution) => {
    const conflict = shareConflictRef.current;
    const doc = yDocRef.current;
    const yText = yTextRef.current;
    if (!conflict || !doc || !yText) {
      updateConflict(null);
      return;
    }
    const next = resolution === "remote" ? conflict.remoteContent : conflict.localContent;
    updateConflict(null);
    lastSyncedRef.current = { path: conflict.path, content: next };
    if (resolution === "remote") {
      setEditorContent(next);
      scheduleLocalWriteBack(conflict.path, next);
      return;
    }
    doc.transact(() => {
      applyYTextDelta(yText, yText.toString(), next);
    }, "editor");
    scheduleLocalWriteBack(conflict.path, next);
  }, [scheduleLocalWriteBack, setEditorContent, updateConflict]);

  useEffect(() => {
    if (!collabEnabled || !localUrl || !sessionId || !sessionPwd) {
      setSyncing(false);
      yDocRef.current = null;
      yTextRef.current = null;
      participantTokenRef.current = "";
      clearTimer(syncTimerRef);
      clearTimer(writeBackTimerRef);
      updateConflict(null);
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
        if (!applyingRemoteRef.current) {
          if (!shareConflictRef.current) {
            scheduleLocalWriteBack(activeTarget, next);
          }
          return;
        }
        const base = lastSyncedRef.current && matchPath(lastSyncedRef.current.path, activeTarget)
          ? lastSyncedRef.current.content
          : null;
        const conflict = detectShareConflict({
          path: activeTarget,
          localContent: editorContentRef.current,
          remoteContent: next,
          baseContent: base,
          remoteSeq: remoteSeqRef.current,
        });
        if (conflict) {
          updateConflict(conflict);
          return;
        }
        if (activeTarget) {
          lastSyncedRef.current = { path: activeTarget, content: next };
        }
        scheduleLocalWriteBack(activeTarget, next);
        if (next === editorContentRef.current) {
          return;
        }
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => setEditorContent(next));
        } else {
          setEditorContent(next);
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
        applyingRemoteRef.current = true;
        try {
          doc.transact(() => {
            applyYTextDelta(yText as unknown as YTextLike, yText.toString(), payload.content ?? "");
          }, "remote");
        } finally {
          applyingRemoteRef.current = false;
        }
      };
      const pullUpdates = async () => {
        if (syncFlightRef.current || shareConflictRef.current) {
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
            remoteSeqRef.current = Number(event.seq || 0);
            try {
              yjs.applyUpdate(doc, fromBase64(event.update), "remote");
            } finally {
              applyingRemoteRef.current = false;
              remoteSeqRef.current = null;
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
      void initialize().catch((error) => setToast({ type: "error", message: String(error) }));
      syncTimerRef.current = Number(window.setTimeout(syncLoop, 760));
      dispose = () => {
        setSyncing(false);
        doc.off("update", onDocUpdate);
        yText.unobserve(onText);
        clearTimer(syncTimerRef);
        clearTimer(writeBackTimerRef);
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
        clearTimer(writeBackTimerRef);
        yDocRef.current = null;
        yTextRef.current = null;
        participantTokenRef.current = "";
      }
    };
  }, [activeTarget, collabEnabled, localUrl, scheduleLocalWriteBack, sessionId, sessionPwd, setEditorContent, setToast, t, updateConflict]);

  useEffect(() => {
    if (!collabEnabled || shareConflictRef.current) {
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

  return { shareSyncing: syncing, shareConflict, resolveShareConflict };
}
