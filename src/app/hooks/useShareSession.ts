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
  const pollTimerRef = useRef<number | null>(null);
  const compilePollRef = useRef<number | null>(null);
  const localClientIdRef = useRef(`desktop-${Math.random().toString(36).slice(2, 10)}`);
  const applyingRemoteRef = useRef(false);
  const uploadingPdfRef = useRef(false);
  const lastUploadedPdfUrlRef = useRef<string | null>(null);

  const active = Boolean(shareSession?.active && shareSession?.localUrl && shareSession?.password);
  const activeTarget = shareSession?.targetPath ?? null;
  const localUrl = shareSession?.localUrl ?? "";
  const sessionId = shareSession?.sessionId ?? "";
  const sessionPwd = shareSession?.password ?? "";
  const collabEnabled = Boolean(
    active && selectedFile && activeTarget && selectedFile.replace(/\\/g, "/") === activeTarget.replace(/\\/g, "/"),
  );

  const refreshShareStatus = useCallback(async () => {
    try {
      const status = await shareSessionStatus();
      setShareSession(status.active ? status : null);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [setToast]);

  const startShare = useCallback(async () => {
    if (!activeProjectId || !selectedFile) {
      setToast({ type: "error", message: t("share.startNeedTex") });
      return;
    }
    if (!selectedFile.toLowerCase().endsWith(".tex")) {
      setToast({ type: "error", message: t("share.startNeedTex") });
      return;
    }
    setShareBusy(true);
    try {
      const created = await shareSessionCreate(activeProjectId, selectedFile);
      setShareSession(created.active ? created : null);
      setToast({ type: "info", message: t("share.started") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setShareBusy(false);
    }
  }, [activeProjectId, selectedFile, setToast, t]);

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
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshShareStatus();
    }, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, refreshShareStatus]);

  useEffect(() => {
    if (!collabEnabled || !localUrl || !sessionId || !sessionPwd) {
      setSyncing(false);
      yDocRef.current = null;
      yTextRef.current = null;
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
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
      if (next === editorContent) {
        return;
      }
      applyingRemoteRef.current = true;
      setEditorContent(next);
      applyingRemoteRef.current = false;
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
        yText.delete(0, yText.length);
        yText.insert(0, initial);
      }, "remote");
    };

    const pullUpdates = async () => {
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
    };

    void initialize().catch((error) => {
      setToast({ type: "error", message: String(error) });
    });
    pollTimerRef.current = Number(window.setInterval(() => {
      void pullUpdates().catch(() => undefined);
    }, 520));

    return () => {
      setSyncing(false);
      doc.off("update", onDocUpdate);
      yText.unobserve(onText);
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      yDocRef.current = null;
      yTextRef.current = null;
      doc.destroy();
    };
  }, [collabEnabled, editorContent, localUrl, sessionId, sessionPwd, setEditorContent, setToast]);

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
      yText.delete(0, current.length);
      yText.insert(0, editorContent);
    }, "editor");
  }, [collabEnabled, editorContent]);

  useEffect(() => {
    if (!active || !localUrl || !sessionId || !sessionPwd || compilePollRef.current) {
      return;
    }
    compilePollRef.current = Number(window.setInterval(() => {
      void postJson(`${localUrl}/api/compile/take`, {
        sid: sessionId,
        pwd: sessionPwd,
      })
        .then(async (payload) => {
          if (payload?.requested) {
            await onCompile();
          }
        })
        .catch(() => undefined);
    }, 1600));
    return () => {
      if (compilePollRef.current) {
        window.clearInterval(compilePollRef.current);
        compilePollRef.current = null;
      }
    };
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
