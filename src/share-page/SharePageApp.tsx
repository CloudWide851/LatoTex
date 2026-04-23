import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { fetchShareSnapshot, joinShareSession, listShareComments, pingSharePresence, postShareComment, pullShareUpdates, pushShareUpdate } from "./shareApi";
import { createShareI18n } from "./shareMessages";
import { SharePageLayout } from "./SharePageLayout";
import { deriveSelectionQuote, fromBase64, normalizeComment, toBase64 } from "./shareUtils";
import { useShareEditorReview } from "./useShareEditorReview";
import { useSharePdfPreview } from "./useSharePdfPreview";
import type { ShareDevice, ShareI18n, ShareLocale, ShareParticipant, ShareQuote, ShareComment, ShareView } from "./shareTypes";

type SharePageAppProps = {
  device: ShareDevice;
  locale: ShareLocale;
};

export function SharePageApp(props: SharePageAppProps) {
  const { device, locale } = props;
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const sid = params.get("sid") || "";
  const i18n = useMemo<ShareI18n>(() => createShareI18n(locale), [locale]);
  const defaultPwd = params.get("pwd") || "";
  const usernameStorageKey = sid ? `latotex-share-username:${sid}` : "latotex-share-username:default";
  const [username, setUsername] = useState(() => localStorage.getItem(usernameStorageKey) || "");
  const [password, setPassword] = useState(defaultPwd);
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
  const participantIdRef = useRef("");
  const participantTokenRef = useRef("");
  const pullCursorRef = useRef(0);
  const connectedRef = useRef(false);
  const syncingRemoteRef = useRef(false);
  const pullInFlightRef = useRef(false);
  const editorReview = useShareEditorReview({ textareaRef, comments });

  const setStatusLine = useCallback((message: string, isError = false) => {
    setStatus(message);
    setStatusError(isError);
  }, []);

  const pdf = useSharePdfPreview({
    sid,
    pwd: password.trim(),
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
        pwd: password.trim(),
        clientId: `web-${Math.random().toString(36).slice(2, 10)}`,
        participantId: participantIdRef.current,
        participantToken: participantTokenRef.current,
        username: username.trim(),
        action: i18n.actionEditing,
        update: toBase64(update),
      }).catch((error) => setStatusLine(i18n.statusSyncFailed(String(error)), true));
    };
    yText.observe(handleObserve);
    docRef.current.on("update", handleUpdate);
    return () => {
      yText.unobserve(handleObserve);
      docRef.current.off("update", handleUpdate);
    };
  }, [i18n.actionEditing, i18n.statusSyncFailed, password, setStatusLine, sid, username]);

  const loadComments = useCallback(async () => {
    if (!connectedRef.current || !participantIdRef.current) {
      return;
    }
    const payload = await listShareComments({
      sid,
      pwd: password.trim(),
      participantId: participantIdRef.current,
      participantToken: participantTokenRef.current,
    });
    setComments(Array.isArray(payload.comments) ? payload.comments.map((item) => normalizeComment(item, "Guest")) : []);
  }, [password, sid]);

  const pingPresence = useCallback(async (action: string) => {
    if (!connectedRef.current || !participantIdRef.current) {
      return;
    }
    const payload = await pingSharePresence({
      sid,
      pwd: password.trim(),
      participantId: participantIdRef.current,
      participantToken: participantTokenRef.current,
      action,
    });
    setParticipants(Array.isArray(payload.participants) ? payload.participants : []);
  }, [password, sid]);

  const pullUpdates = useCallback(async () => {
    if (!connectedRef.current || pullInFlightRef.current) {
      return;
    }
    pullInFlightRef.current = true;
    try {
      const payload = await pullShareUpdates({
        sid,
        pwd: password.trim(),
        participantId: participantIdRef.current,
        participantToken: participantTokenRef.current,
        cursor: pullCursorRef.current,
      });
      for (const item of payload.events || []) {
        pullCursorRef.current = Math.max(pullCursorRef.current, Number(item.seq || 0));
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
  }, [password, sid]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

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
          setStatusLine(i18n.statusSyncFailed(String(error)), true);
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
  }, [connected, i18n.actionReading, i18n.statusSyncFailed, loadComments, pdf, pingPresence, pullUpdates, setStatusLine, view]);

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
      const clientId = `web-${Math.random().toString(36).slice(2, 10)}`;
      const joined = await joinShareSession({
        sid,
        pwd: trimmedPassword,
        clientId,
        username: trimmedUsername,
      });
      participantIdRef.current = String(joined.participantId || "");
      participantTokenRef.current = String(joined.participantToken || "");
      setParticipants(Array.isArray(joined.participants) ? joined.participants : []);
      const snapshot = await fetchShareSnapshot(sid, trimmedPassword);
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
      setConnected(true);
      pullCursorRef.current = 0;
      await pingPresence(i18n.actionReading);
      await pdf.reload().catch(() => undefined);
      await loadComments().catch(() => undefined);
      setStatusLine(pdf.ready ? i18n.statusConnected : i18n.statusPdfPreparing);
    } catch (error) {
      setConnected(false);
      setStatusLine(i18n.statusConnectFailed(String(error)), true);
    }
  }, [i18n, loadComments, password, pdf, pingPresence, setStatusLine, sid, username, usernameStorageKey]);

  const handleEditorChange = useCallback((value: string) => {
    setEditorText(value);
    const yText = yTextRef.current;
    const current = yText.toString();
    if (value === current) {
      return;
    }
    docRef.current.transact(() => {
      let start = 0;
      const maxStart = Math.min(current.length, value.length);
      while (start < maxStart && current[start] === value[start]) {
        start += 1;
      }
      let endCurrent = current.length;
      let endNext = value.length;
      while (endCurrent > start && endNext > start && current[endCurrent - 1] === value[endNext - 1]) {
        endCurrent -= 1;
        endNext -= 1;
      }
      const removeLength = endCurrent - start;
      const insertText = value.slice(start, endNext);
      if (removeLength > 0) {
        yText.delete(start, removeLength);
      }
      if (insertText.length > 0) {
        yText.insert(start, insertText);
      }
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
  }, [pdf, updateEditorSelection]);

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
        pwd: password.trim(),
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
      setStatusLine(i18n.statusPostCommentFailed(String(error)), true);
    }
  }, [commentText, connected, i18n, password, quoteDraft, setStatusLine, sid, username]);

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
