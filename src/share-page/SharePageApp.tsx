import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  fetchShareSnapshot,
  joinShareSession,
  listShareComments,
  pingSharePresence,
  postShareComment,
  pullShareUpdates,
  pushShareUpdate,
  type ShareParticipantAuth,
} from "./shareApi";
import { createShareI18n } from "./shareMessages";
import { SharePageLayout } from "./SharePageLayout";
import { applyYTextDelta, deriveSelectionQuote, fromBase64, normalizeComment, toBase64 } from "./shareUtils";
import { useShareEditorReview } from "./useShareEditorReview";
import { useSharePdfPreview } from "./useSharePdfPreview";
import type { ShareDevice, ShareI18n, ShareLocale, ShareParticipant, ShareQuote, ShareComment, ShareView } from "./shareTypes";
import { resolveShareUiErrorCode } from "../shared/utils/shareUiError";

type SharePageAppProps = {
  device: ShareDevice;
  locale: ShareLocale;
};

function readStoredAuth(storageKey: string): ShareParticipantAuth | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) || "null") as Partial<ShareParticipantAuth> | null;
    const participantId = typeof parsed?.participantId === "string" ? parsed.participantId.trim() : "";
    const participantToken = typeof parsed?.participantToken === "string" ? parsed.participantToken.trim() : "";
    if (!participantId || !participantToken) {
      return null;
    }
    return { participantId, participantToken };
  } catch {
    return null;
  }
}

function persistStoredAuth(storageKey: string, auth: ShareParticipantAuth | null) {
  try {
    if (auth) {
      sessionStorage.setItem(storageKey, JSON.stringify(auth));
    } else {
      sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Session storage may be unavailable in hardened/private browsing contexts.
  }
}

export function SharePageApp(props: SharePageAppProps) {
  const { device, locale } = props;
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const sid = params.get("sid") || "";
  const i18n = useMemo<ShareI18n>(() => createShareI18n(locale), [locale]);
  const usernameStorageKey = sid ? `latotex-share-username:${sid}` : "latotex-share-username:default";
  const authStorageKey = sid ? `latotex-share-auth:${sid}` : "latotex-share-auth:default";
  const [username, setUsername] = useState(() => localStorage.getItem(usernameStorageKey) || "");
  const [password, setPassword] = useState("");
  const [auth, setAuth] = useState<ShareParticipantAuth | null>(() => readStoredAuth(authStorageKey));
  const [status, setStatus] = useState(i18n.statusIdle);
  const [statusError, setStatusError] = useState(false);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<ShareParticipant[]>([]);
  const [comments, setComments] = useState<ShareComment[]>([]);
  const [view, setView] = useState<ShareView>("tex");
  const [editorText, setEditorText] = useState("");
  const [quoteDraft, setQuoteDraft] = useState<ShareQuote | null>(null);
  const [selectionQuote, setSelectionQuote] = useState<ShareQuote | null>(null);
  const [commentText, setCommentText] = useState("");
  const [copiedPassword, setCopiedPassword] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pdfPagesRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef(new Y.Doc());
  const yTextRef = useRef(docRef.current.getText("tex"));
  const clientIdRef = useRef(`web-${Math.random().toString(36).slice(2, 10)}`);
  const participantIdRef = useRef(auth?.participantId ?? "");
  const participantTokenRef = useRef(auth?.participantToken ?? "");
  const pullCursorRef = useRef(0);
  const connectedRef = useRef(false);
  const restoreAttemptedRef = useRef(false);
  const syncingRemoteRef = useRef(false);
  const pullInFlightRef = useRef(false);
  const editorReview = useShareEditorReview({ textareaRef, comments });

  const setStatusLine = useCallback((message: string, isError = false) => {
    setStatus(message);
    setStatusError(isError);
  }, []);
  const shareErrorReason = useCallback(
    (error: unknown) => i18n.shareErrorMessage(resolveShareUiErrorCode(error)),
    [i18n],
  );

  const pdf = useSharePdfPreview({
    sid,
    auth,
    connected,
    i18n,
    containerRef: pdfPagesRef,
    active: view === "pdf",
    onStatus: setStatusLine,
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.shareLayout = device;
    document.body.dataset.shareLayout = device;
    document.title = i18n.title;
  }, [device, i18n.title, locale]);

  useEffect(() => {
    const nextUrl = new URL(window.location.href);
    const hadSecretQuery = nextUrl.searchParams.has("pwd")
      || nextUrl.searchParams.has("participantToken")
      || nextUrl.searchParams.has("participant_token");
    if (!hadSecretQuery) {
      return;
    }
    nextUrl.searchParams.delete("pwd");
    nextUrl.searchParams.delete("participantToken");
    nextUrl.searchParams.delete("participant_token");
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }, []);

  useEffect(() => {
    const yText = yTextRef.current;
    const handleObserve = () => {
      const next = yText.toString();
      setEditorText((current) => (current === next ? current : next));
    };
    const handleUpdate = (update: Uint8Array, origin: string) => {
      if (origin === "remote" || syncingRemoteRef.current || !connectedRef.current) {
        return;
      }
      void pushShareUpdate({
        sid,
        clientId: clientIdRef.current,
        participantId: participantIdRef.current,
        participantToken: participantTokenRef.current,
        username: username.trim(),
        action: i18n.actionEditing,
        update: toBase64(update),
      }).catch((error) => setStatusLine(i18n.statusSyncFailed(shareErrorReason(error)), true));
    };
    yText.observe(handleObserve);
    docRef.current.on("update", handleUpdate);
    return () => {
      yText.unobserve(handleObserve);
      docRef.current.off("update", handleUpdate);
    };
  }, [i18n.actionEditing, i18n.statusSyncFailed, setStatusLine, shareErrorReason, sid, username]);

  const loadComments = useCallback(async () => {
    if (!connectedRef.current || !participantIdRef.current) {
      return;
    }
    const payload = await listShareComments({
      sid,
      participantId: participantIdRef.current,
      participantToken: participantTokenRef.current,
    });
    setComments(Array.isArray(payload.comments) ? payload.comments.map((item) => normalizeComment(item, "Guest")) : []);
  }, [sid]);

  const pingPresence = useCallback(async (action: string) => {
    if (!connectedRef.current || !participantIdRef.current) {
      return;
    }
    const payload = await pingSharePresence({
      sid,
      participantId: participantIdRef.current,
      participantToken: participantTokenRef.current,
      action,
    });
    setParticipants(Array.isArray(payload.participants) ? payload.participants : []);
  }, [sid]);

  const pullUpdates = useCallback(async () => {
    if (!connectedRef.current || pullInFlightRef.current) {
      return;
    }
    pullInFlightRef.current = true;
    try {
      const payload = await pullShareUpdates({
        sid,
        participantId: participantIdRef.current,
        participantToken: participantTokenRef.current,
        cursor: pullCursorRef.current,
      });
      for (const item of payload.events || []) {
        pullCursorRef.current = Math.max(pullCursorRef.current, Number(item.seq || 0));
        if (item.from === clientIdRef.current) {
          continue;
        }
        syncingRemoteRef.current = true;
        try {
          Y.applyUpdate(docRef.current, fromBase64(item.update), "remote");
        } finally {
          syncingRemoteRef.current = false;
        }
      }
      pullCursorRef.current = Math.max(pullCursorRef.current, Number(payload.nextCursor || pullCursorRef.current));
    } finally {
      pullInFlightRef.current = false;
    }
  }, [sid]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  const hydrateAuthenticatedSession = useCallback(async (nextAuth: ShareParticipantAuth) => {
    participantIdRef.current = nextAuth.participantId;
    participantTokenRef.current = nextAuth.participantToken;
    const snapshot = await fetchShareSnapshot(sid, nextAuth);
    syncingRemoteRef.current = true;
    try {
      docRef.current.transact(() => {
        const yText = yTextRef.current;
        yText.delete(0, yText.length);
        yText.insert(0, snapshot.content || "");
      }, "remote");
    } finally {
      syncingRemoteRef.current = false;
    }
    pullCursorRef.current = 0;
    connectedRef.current = true;
    setConnected(true);
  }, [sid]);

  useEffect(() => {
    if (!auth || !sid || connected || restoreAttemptedRef.current) {
      return;
    }
    restoreAttemptedRef.current = true;
    setStatusLine(i18n.statusConnecting);
    void hydrateAuthenticatedSession(auth)
      .then(async () => {
        await pingPresence(i18n.actionReading).catch(() => undefined);
        await loadComments().catch(() => undefined);
        setStatusLine(i18n.statusConnected);
      })
      .catch(() => {
        connectedRef.current = false;
        participantIdRef.current = "";
        participantTokenRef.current = "";
        persistStoredAuth(authStorageKey, null);
        setAuth(null);
        setConnected(false);
        setStatusLine(i18n.statusIdle);
      });
  }, [auth, authStorageKey, connected, hydrateAuthenticatedSession, i18n.actionReading, i18n.statusConnected, i18n.statusConnecting, i18n.statusIdle, loadComments, pingPresence, setStatusLine, sid]);

  useEffect(() => {
    if (!connected) {
      return;
    }
    let cancelled = false;
    let pullTimer = 0;
    let presenceTimer = 0;
    let pdfTimer = 0;
    const schedulePull = () => {
      pullTimer = window.setTimeout(async () => {
        if (cancelled) {
          return;
        }
        try {
          await pullUpdates();
          await loadComments();
        } catch (error) {
          setStatusLine(i18n.statusSyncFailed(shareErrorReason(error)), true);
        }
        schedulePull();
      }, document.hidden ? 1700 : 840);
    };
    const schedulePresence = () => {
      presenceTimer = window.setTimeout(async () => {
        if (cancelled) {
          return;
        }
        try {
          await pingPresence(i18n.actionReading);
        } catch {
          // ignore presence ping failures
        }
        schedulePresence();
      }, document.hidden ? 3400 : 1700);
    };
    const schedulePdf = () => {
      pdfTimer = window.setTimeout(async () => {
        if (cancelled) {
          return;
        }
        if (view === "pdf") {
          await pdf.reload().catch(() => undefined);
        }
        schedulePdf();
      }, document.hidden ? 5000 : 2600);
    };
    schedulePull();
    schedulePresence();
    schedulePdf();
    return () => {
      cancelled = true;
      window.clearTimeout(pullTimer);
      window.clearTimeout(presenceTimer);
      window.clearTimeout(pdfTimer);
    };
  }, [connected, i18n.actionReading, i18n.statusSyncFailed, loadComments, pdf.reload, pingPresence, pullUpdates, setStatusLine, shareErrorReason, view]);

  const handleConnect = useCallback(async () => {
    const trimmedPassword = password.trim();
    const trimmedUsername = username.trim();
    if (!sid || !trimmedPassword || !trimmedUsername) {
      setStatusLine(i18n.statusNeedFields, true);
      return;
    }
    localStorage.setItem(usernameStorageKey, trimmedUsername);
    setStatusLine(i18n.statusConnecting);
    try {
      const joined = await joinShareSession({
        sid,
        pwd: trimmedPassword,
        clientId: clientIdRef.current,
        username: trimmedUsername,
      });
      const nextAuth = {
        participantId: String(joined.participantId || "").trim(),
        participantToken: String(joined.participantToken || "").trim(),
      };
      if (!nextAuth.participantId || !nextAuth.participantToken) {
        throw new Error("share.auth_failed");
      }
      participantIdRef.current = nextAuth.participantId;
      participantTokenRef.current = nextAuth.participantToken;
      persistStoredAuth(authStorageKey, nextAuth);
      setAuth(nextAuth);
      setParticipants(Array.isArray(joined.participants) ? joined.participants : []);
      await hydrateAuthenticatedSession(nextAuth);
      setPassword("");
      await pingPresence(i18n.actionReading);
      await loadComments().catch(() => undefined);
      setStatusLine(i18n.statusPdfPreparing);
    } catch (error) {
      connectedRef.current = false;
      participantIdRef.current = "";
      participantTokenRef.current = "";
      persistStoredAuth(authStorageKey, null);
      setAuth(null);
      setConnected(false);
      setStatusLine(i18n.statusConnectFailed(shareErrorReason(error)), true);
    }
  }, [authStorageKey, hydrateAuthenticatedSession, i18n, loadComments, password, pingPresence, setStatusLine, shareErrorReason, sid, username, usernameStorageKey]);

  const handleEditorChange = useCallback((value: string) => {
    setEditorText(value);
    const yText = yTextRef.current;
    const current = yText.toString();
    if (value === current) {
      return;
    }
    docRef.current.transact(() => {
      applyYTextDelta(yText, current, value);
    }, "editor");
  }, []);

  const updateEditorSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    setSelectionQuote(deriveSelectionQuote(textarea.value, start, end));
  }, []);

  const jumpToComment = useCallback(async (comment: ShareComment) => {
    if (comment.source === "pdf" && comment.page) {
      setView("pdf");
      await pdf.reload();
      pdf.scrollToPage(comment.page, "auto");
      return;
    }
    setView("tex");
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const start = Number.isFinite(comment.start) ? comment.start ?? 0 : 0;
    const end = Number.isFinite(comment.end) && (comment.end ?? 0) >= start ? comment.end ?? start : start;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      textarea.scrollTop = Math.max(0, textarea.scrollHeight * (start / Math.max(textarea.value.length, 1)) - 120);
      updateEditorSelection();
    });
  }, [pdf.reload, pdf.scrollToPage, updateEditorSelection]);

  const handlePostComment = useCallback(async () => {
    if (!connected) {
      return;
    }
    const text = commentText.trim();
    if (!text && !quoteDraft) {
      setStatusLine(i18n.promptNeedCommentOrQuote, true);
      return;
    }
    try {
      const response = await postShareComment({
        sid,
        participantId: participantIdRef.current,
        participantToken: participantTokenRef.current,
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        username: username.trim() || "Guest",
        text,
        quote: quoteDraft?.text || "",
        source: quoteDraft?.source || "tex",
        page: quoteDraft?.page,
        start: quoteDraft?.start,
        end: quoteDraft?.end,
        createdAt: new Date().toISOString(),
      });
      setComments(Array.isArray(response.comments) ? response.comments.map((item) => normalizeComment(item, "Guest")) : []);
      setCommentText("");
      setQuoteDraft(null);
      setStatusLine(i18n.statusCommentPosted);
    } catch (error) {
      setStatusLine(i18n.statusPostCommentFailed(shareErrorReason(error)), true);
    }
  }, [commentText, connected, i18n, quoteDraft, setStatusLine, shareErrorReason, sid, username]);

  return (
    <SharePageLayout
      device={device}
      sid={sid}
      i18n={i18n}
      username={username}
      password={password}
      status={status}
      statusError={statusError}
      connected={connected}
      participants={participants}
      comments={comments}
      view={view}
      editorText={editorText}
      quoteDraft={quoteDraft}
      selectionQuote={selectionQuote}
      commentText={commentText}
      copiedPassword={copiedPassword}
      textareaRef={textareaRef}
      pdfPagesRef={pdfPagesRef}
      editorReview={editorReview}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onViewChange={setView}
      onConnect={() => {
        void handleConnect();
      }}
      onCopyPassword={() => {
        const value = password.trim();
        if (!value) {
          return;
        }
        void navigator.clipboard.writeText(value).then(() => {
          setCopiedPassword(true);
          window.setTimeout(() => setCopiedPassword(false), 1200);
        }).catch(() => undefined);
      }}
      onReloadPdf={() => {
        void pdf.reload();
      }}
      onEditorChange={handleEditorChange}
      onEditorSelectionChange={updateEditorSelection}
      onQuoteSelection={() => {
        if (!selectionQuote) {
          setStatusLine(i18n.statusQuoteNeeded, true);
          return;
        }
        setQuoteDraft(selectionQuote);
      }}
      onClearQuote={() => setQuoteDraft(null)}
      onCommentTextChange={setCommentText}
      onPostComment={() => {
        void handlePostComment();
      }}
      onJumpToComment={(comment) => {
        void jumpToComment(comment);
      }}
      pdf={pdf}
    />
  );
}
