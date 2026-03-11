import * as Y from "https://esm.sh/yjs@13.6.29";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import { createI18n, detectLocale } from "/assets/share_page_i18n.js";
import { renderComments, renderParticipants, withHighlight } from "/assets/share_page_render.js";
import {
  fromBase64,
  postJson,
  toBase64,
  trimQuote,
} from "/assets/share_page_utils.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

export async function bootstrapSharePage() {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get("sid") || "";
  const pwdFromUrl = params.get("pwd") || "";
  const i18n = createI18n(detectLocale());

  const el = {
    title: document.getElementById("title-text"),
    meta: document.getElementById("meta"),
    status: document.getElementById("status"),
    badge: document.getElementById("connected-badge"),
    username: document.getElementById("username"),
    pwd: document.getElementById("pwd"),
    copyPwd: document.getElementById("copy-password"),
    connect: document.getElementById("connect"),
    reloadPdf: document.getElementById("reload-pdf"),
    viewTex: document.getElementById("view-tex"),
    viewPdf: document.getElementById("view-pdf"),
    viewComments: document.getElementById("view-comments"),
    paneMain: document.getElementById("pane-main"),
    paneSide: document.getElementById("pane-side"),
    editorWrap: document.getElementById("editor-wrap"),
    editor: document.getElementById("editor"),
    cursor: document.getElementById("cursor-info"),
    pdfWrap: document.getElementById("pdf-wrap"),
    pdf: document.getElementById("pdf"),
    pdfPrev: document.getElementById("pdf-prev"),
    pdfNext: document.getElementById("pdf-next"),
    pdfPage: document.getElementById("pdf-page-label"),
    pdfText: document.getElementById("pdf-text"),
    participantsTitle: document.getElementById("participants-title"),
    participants: document.getElementById("participants"),
    commentsTitle: document.getElementById("comments-title"),
    comments: document.getElementById("comments"),
    hint: document.getElementById("share-hint"),
    requestCompile: document.getElementById("request-compile"),
    quotePreview: document.getElementById("quote-preview"),
    quoteSource: document.getElementById("quote-source"),
    quoteContent: document.getElementById("quote-content"),
    clearQuote: document.getElementById("clear-quote"),
    commentEditor: document.getElementById("comment-editor"),
    postComment: document.getElementById("post-comment"),
    quickQuote: document.getElementById("quick-quote"),
  };

  const doc = new Y.Doc();
  const yText = doc.getText("tex");

  const state = {
    clientId: `web-${Math.random().toString(36).slice(2, 10)}`,
    connected: false,
    syncingRemote: false,
    participantId: "",
    participantToken: "",
    cursor: 0,
    pullTimer: 0,
    presenceTimer: 0,
    pdfStatusTimer: 0,
    pullInFlight: false,
    presenceInFlight: false,
    action: i18n.actionReading,
    view: "tex",
    pdfDoc: null,
    pdfPage: 1,
    pdfTextByPage: new Map(),
    draftQuote: null,
    selectionQuote: null,
    pdfReady: false,
    highlightQuote: "",
    comments: [],
  };

  const usernameStorageKey = sid ? `latotex-share-username:${sid}` : "latotex-share-username:default";

  function setStatus(text, isError = false) {
    el.status.textContent = text;
    el.status.classList.toggle("is-error", isError);
  }

  function setConnectedBadge(connected) {
    el.badge.textContent = connected ? i18n.connectedBadge : i18n.statusIdle;
    el.badge.classList.toggle("connected", connected);
  }

  function setView(nextView) {
    state.view = nextView;
    const compact = window.matchMedia("(max-width: 980px)").matches;
    el.viewTex.classList.toggle("active", nextView === "tex");
    el.viewPdf.classList.toggle("active", nextView === "pdf");
    el.viewComments.classList.toggle("active", nextView === "comments");
    if (!compact) {
      el.paneMain.classList.add("active");
      el.paneSide.classList.add("active");
    } else {
      el.paneMain.classList.toggle("active", nextView !== "comments");
      el.paneSide.classList.toggle("active", nextView === "comments");
    }
    const showPdf = nextView === "pdf";
    el.editorWrap.style.display = showPdf ? "none" : "";
    el.pdfWrap.style.display = showPdf ? "" : "none";
  }

  function setDraftQuote(quote) {
    state.draftQuote = quote;
    if (!quote) {
      el.quotePreview.hidden = true;
      el.quoteSource.textContent = "";
      el.quoteContent.textContent = "";
      return;
    }
    el.quotePreview.hidden = false;
    el.quoteSource.textContent = quote.source === "pdf"
      ? i18n.quoteFromPdf(quote.page || 1)
      : i18n.quoteFromTex;
    el.quoteContent.textContent = quote.text;
  }

  function hideQuickQuote() {
    el.quickQuote.hidden = true;
    state.selectionQuote = null;
  }

  function showQuickQuote(rect, quote) {
    state.selectionQuote = quote;
    el.quickQuote.hidden = false;
    const top = Math.max(8, Math.round(rect.top + window.scrollY - 36));
    const left = Math.max(8, Math.round(rect.left + window.scrollX));
    el.quickQuote.style.top = `${top}px`;
    el.quickQuote.style.left = `${left}px`;
  }

  function readEditorSelection() {
    const start = el.editor.selectionStart || 0;
    const end = el.editor.selectionEnd || 0;
    if (end <= start) return null;
    const selected = trimQuote(el.editor.value.slice(start, end));
    if (!selected) return null;
    return { source: "tex", text: selected, start, end };
  }

  function readPdfSelection() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const text = trimQuote(selection.toString());
    if (!text) return null;
    if (!el.pdfText.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0);
    return {
      source: "pdf",
      text,
      page: state.pdfPage,
      rect: range.getBoundingClientRect(),
    };
  }

  function updateQuoteFromSelection() {
    const pdfSelection = readPdfSelection();
    if (pdfSelection) {
      showQuickQuote(pdfSelection.rect, { source: "pdf", text: pdfSelection.text, page: pdfSelection.page });
      return;
    }
    const texSelection = readEditorSelection();
    if (texSelection) {
      const rect = el.editor.getBoundingClientRect();
      showQuickQuote(rect, texSelection);
      return;
    }
    hideQuickQuote();
  }

  function updatePdfPageLabel() {
    const total = state.pdfDoc?.numPages || 1;
    const page = Math.max(1, Math.min(total, state.pdfPage || 1));
    state.pdfPage = page;
    el.pdfPage.textContent = i18n.pdfPageLabel(page, total);
  }

  async function extractPdfPageText(pageNumber) {
    if (!state.pdfDoc || pageNumber < 1 || pageNumber > state.pdfDoc.numPages) return "";
    if (state.pdfTextByPage.has(pageNumber)) return state.pdfTextByPage.get(pageNumber);
    const page = await state.pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? String(item.str || "") : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    state.pdfTextByPage.set(pageNumber, text);
    return text;
  }

  async function renderPdfTextPane() {
    if (!state.pdfDoc) {
      el.pdfText.textContent = i18n.noPdfText;
      updatePdfPageLabel();
      return;
    }
    updatePdfPageLabel();
    const text = await extractPdfPageText(state.pdfPage);
    el.pdfText.innerHTML = withHighlight(text || i18n.noPdfText, state.highlightQuote);
  }

  async function fetchPdfStatus() {
    if (!state.connected) return { ready: false };
    const response = await fetch(`/api/pdf/status?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(el.pwd.value.trim())}&t=${Date.now()}`);
    if (!response.ok) return { ready: false };
    const payload = await response.json();
    return {
      ready: payload?.state === "ready",
      state: payload?.state,
      updatedAt: payload?.updatedAt,
    };
  }

  async function reloadPdfContent() {
    if (!state.connected) return;
    const status = await fetchPdfStatus().catch(() => ({ ready: false }));
    if (!status.ready) {
      state.pdfReady = false;
      state.pdfDoc = null;
      state.pdfTextByPage.clear();
      el.pdf.src = "about:blank";
      el.pdfText.textContent = i18n.noPdfText;
      setStatus(i18n.statusPdfPreparing);
      return;
    }
    const pdfUrl = `/api/pdf?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(el.pwd.value.trim())}&t=${Date.now()}`;
    el.pdf.src = pdfUrl;
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      state.pdfReady = false;
      setStatus(i18n.statusPdfPreparing);
      return;
    }
    const buffer = await response.arrayBuffer();
    state.pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    state.pdfReady = true;
    state.pdfTextByPage.clear();
    if (state.pdfPage > state.pdfDoc.numPages) state.pdfPage = state.pdfDoc.numPages;
    await renderPdfTextPane();
    setStatus(i18n.statusPdfReady);
  }

  function jumpToComment(comment) {
    if (comment.source === "pdf" && comment.page) {
      state.highlightQuote = comment.quote || "";
      state.pdfPage = comment.page;
      setView("pdf");
      void renderPdfTextPane();
      return;
    }
    if (comment.source === "tex") {
      setView("tex");
      const start = Number.isFinite(comment.start) ? comment.start : 0;
      const end = Number.isFinite(comment.end) && comment.end >= start ? comment.end : start;
      el.editor.focus();
      el.editor.setSelectionRange(start, end);
      el.editor.scrollTop = Math.max(0, el.editor.scrollHeight * (start / Math.max(el.editor.value.length, 1)) - 120);
    }
  }

  async function pingPresence(action) {
    if (!state.connected || !state.participantId) return;
    const payload = await postJson("/api/presence/ping", {
      sid,
      pwd: el.pwd.value.trim(),
      participantId: state.participantId,
      participantToken: state.participantToken,
      action,
    });
    renderParticipants(el.participants, payload.participants || [], i18n);
  }

  async function loadComments() {
    if (!state.connected) return;
    const token = state.participantToken
      ? `&participantToken=${encodeURIComponent(state.participantToken)}`
      : "";
    const response = await fetch(
      `/api/comments/list?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(el.pwd.value.trim())}&participantId=${encodeURIComponent(state.participantId)}${token}&t=${Date.now()}`
    );
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.comments = Array.isArray(payload.comments) ? payload.comments : [];
    renderComments(el.comments, state.comments, i18n, jumpToComment);
  }

  async function pullUpdates() {
    if (!state.connected || state.pullInFlight) return;
    state.pullInFlight = true;
    try {
      const token = state.participantToken
        ? `&participantToken=${encodeURIComponent(state.participantToken)}`
        : "";
      const response = await fetch(
        `/api/sync/pull?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(el.pwd.value.trim())}&participantId=${encodeURIComponent(state.participantId)}${token}&cursor=${state.cursor}`
      );
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      for (const item of payload.events || []) {
        state.cursor = Math.max(state.cursor, Number(item.seq || 0));
        if (item.from === state.clientId) continue;
        state.syncingRemote = true;
        try {
          Y.applyUpdate(doc, fromBase64(item.update), "remote");
        } finally {
          state.syncingRemote = false;
        }
      }
      state.cursor = Math.max(state.cursor, Number(payload.nextCursor || state.cursor));
    } finally {
      state.pullInFlight = false;
    }
  }

  function schedulePullLoop() {
    window.clearTimeout(state.pullTimer);
    const hidden = document.hidden;
    state.pullTimer = window.setTimeout(async () => {
      try {
        await pullUpdates();
        await loadComments();
      } catch (error) {
        setStatus(i18n.statusSyncFailed(String(error)), true);
      }
      schedulePullLoop();
    }, hidden ? 1700 : 840);
  }

  function schedulePresenceLoop() {
    window.clearTimeout(state.presenceTimer);
    const hidden = document.hidden;
    state.presenceTimer = window.setTimeout(async () => {
      try {
        await pingPresence(state.action);
      } catch {
        // ignore ping errors
      }
      schedulePresenceLoop();
    }, hidden ? 3400 : 1700);
  }

  function schedulePdfStatusLoop() {
    window.clearTimeout(state.pdfStatusTimer);
    const hidden = document.hidden;
    state.pdfStatusTimer = window.setTimeout(async () => {
      if (!state.connected) return;
      if (state.view === "pdf") {
        await reloadPdfContent().catch(() => undefined);
      }
      schedulePdfStatusLoop();
    }, hidden ? 5000 : 2600);
  }

  function setupI18n() {
    document.title = i18n.title;
    el.title.textContent = i18n.title;
    el.meta.textContent = sid ? i18n.sessionLabel(sid) : i18n.missingSession;
    el.username.placeholder = i18n.usernamePlaceholder;
    el.pwd.placeholder = i18n.passwordPlaceholder;
    el.connect.textContent = i18n.join;
    el.reloadPdf.textContent = i18n.reloadPdf;
    el.copyPwd.textContent = i18n.copyPassword;
    el.viewTex.textContent = i18n.tabTex;
    el.viewPdf.textContent = i18n.tabPdf;
    el.viewComments.textContent = i18n.tabComments;
    el.participantsTitle.textContent = i18n.collaborators;
    el.commentsTitle.textContent = i18n.comments;
    el.hint.textContent = i18n.shareHint;
    el.requestCompile.textContent = i18n.compile;
    el.quickQuote.textContent = i18n.addQuote;
    el.commentEditor.placeholder = i18n.commentPlaceholder;
    el.postComment.textContent = i18n.postComment;
    el.clearQuote.textContent = i18n.clearQuote;
  }

  setupI18n();
  setStatus(i18n.statusIdle);
  setConnectedBadge(false);
  setView("tex");
  el.pwd.value = pwdFromUrl;
  el.username.value = localStorage.getItem(usernameStorageKey) || "";
  updatePdfPageLabel();

  yText.observe(() => {
    const value = yText.toString();
    if (el.editor.value !== value) {
      const at = el.editor.selectionStart || 0;
      el.editor.value = value;
      el.editor.setSelectionRange(Math.min(at, value.length), Math.min(at, value.length));
    }
  });
  doc.on("update", (update, origin) => {
    if (origin === "remote" || state.syncingRemote || !state.connected) return;
    void postJson("/api/sync/push", {
      sid,
      pwd: el.pwd.value.trim(),
      clientId: state.clientId,
      participantId: state.participantId,
      participantToken: state.participantToken,
      username: el.username.value.trim(),
      action: state.action,
      update: toBase64(update),
    }).catch((error) => setStatus(i18n.statusSyncFailed(String(error)), true));
  });

  el.editor.addEventListener("input", () => {
    state.action = i18n.actionEditing;
    const next = el.editor.value;
    const current = yText.toString();
    if (next === current) return;
    doc.transact(() => {
      let start = 0;
      const maxStart = Math.min(current.length, next.length);
      while (start < maxStart && current[start] === next[start]) start += 1;
      let endCurrent = current.length;
      let endNext = next.length;
      while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
        endCurrent -= 1;
        endNext -= 1;
      }
      const removeLen = endCurrent - start;
      const insert = next.slice(start, endNext);
      if (removeLen > 0) yText.delete(start, removeLen);
      if (insert.length > 0) yText.insert(start, insert);
    }, "editor");
  });

  el.editor.addEventListener("select", () => {
    const start = el.editor.selectionStart || 0;
    const end = el.editor.selectionEnd || 0;
    el.cursor.textContent = `${start}-${end}`;
    updateQuoteFromSelection();
  });

  window.addEventListener("mouseup", () => window.setTimeout(updateQuoteFromSelection, 30));
  window.addEventListener("keyup", () => window.setTimeout(updateQuoteFromSelection, 30));
  window.addEventListener("resize", () => setView(state.view));
  window.addEventListener("scroll", () => {
    if (!el.quickQuote.hidden) updateQuoteFromSelection();
  }, true);

  el.quickQuote.addEventListener("click", () => {
    if (!state.selectionQuote) return;
    setDraftQuote(state.selectionQuote);
    hideQuickQuote();
  });

  el.clearQuote.addEventListener("click", () => setDraftQuote(null));

  el.postComment.addEventListener("click", async () => {
    if (!state.connected) return;
    const text = el.commentEditor.value.trim();
    const quote = state.draftQuote;
    if (!text && !quote) {
      setStatus(i18n.promptNeedCommentOrQuote, true);
      return;
    }
    const payload = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      username: el.username.value.trim() || "Guest",
      text,
      quote: quote?.text || "",
      source: quote?.source || "tex",
      page: quote?.page,
      start: quote?.start,
      end: quote?.end,
      createdAt: new Date().toISOString(),
    };
    try {
      const response = await postJson("/api/comments/post", {
        sid,
        pwd: el.pwd.value.trim(),
        participantId: state.participantId,
        participantToken: state.participantToken,
        ...payload,
      });
      state.comments = Array.isArray(response?.comments) ? response.comments : state.comments;
      renderComments(el.comments, state.comments, i18n, jumpToComment);
      state.action = i18n.actionCommenting;
      el.commentEditor.value = "";
      setDraftQuote(null);
      setStatus(i18n.statusCommentPosted);
    } catch (error) {
      setStatus(i18n.statusSyncFailed(String(error)), true);
    }
  });

  el.requestCompile.addEventListener("click", async () => {
    if (!state.connected) return;
    try {
      await postJson("/api/compile/request", { sid, pwd: el.pwd.value.trim() });
      state.action = i18n.actionCompile;
      setStatus(i18n.statusCompileRequested);
      await pingPresence(state.action);
    } catch (error) {
      setStatus(i18n.statusCompileFailed(String(error)), true);
    }
  });

  el.reloadPdf.addEventListener("click", () => {
    void reloadPdfContent();
  });
  el.copyPwd.addEventListener("click", () => {
    const value = el.pwd.value.trim();
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => {
      el.copyPwd.textContent = i18n.copyPasswordDone;
      window.setTimeout(() => {
        el.copyPwd.textContent = i18n.copyPassword;
      }, 1200);
    }).catch(() => undefined);
  });

  el.viewTex.addEventListener("click", () => setView("tex"));
  el.viewPdf.addEventListener("click", () => {
    setView("pdf");
    void reloadPdfContent();
  });
  el.viewComments.addEventListener("click", () => setView("comments"));

  el.pdfPrev.addEventListener("click", () => {
    if (!state.pdfDoc) return;
    state.pdfPage = Math.max(1, state.pdfPage - 1);
    void renderPdfTextPane();
  });
  el.pdfNext.addEventListener("click", () => {
    if (!state.pdfDoc) return;
    state.pdfPage = Math.min(state.pdfDoc.numPages, state.pdfPage + 1);
    void renderPdfTextPane();
  });

  el.connect.addEventListener("click", async () => {
    const pwd = el.pwd.value.trim();
    const username = el.username.value.trim();
    if (!sid || !pwd || !username) {
      setStatus(i18n.statusNeedFields, true);
      return;
    }
    localStorage.setItem(usernameStorageKey, username);
    setStatus(i18n.statusConnecting);
    try {
      const joined = await postJson("/api/join", {
        sid,
        pwd,
        clientId: state.clientId,
        username,
      });
      state.participantId = String(joined.participantId || "");
      state.participantToken = String(joined.participantToken || "");
      renderParticipants(el.participants, joined.participants || [], i18n);

      const snapshotResp = await fetch(`/api/snapshot?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(pwd)}`);
      if (!snapshotResp.ok) throw new Error(await snapshotResp.text());
      const snapshot = await snapshotResp.json();
      doc.transact(() => {
        const current = yText.toString();
        yText.delete(0, current.length);
        yText.insert(0, snapshot.content || "");
      }, "remote");

      state.connected = true;
      setConnectedBadge(true);
      state.cursor = 0;
      schedulePullLoop();
      schedulePresenceLoop();
      schedulePdfStatusLoop();
      await pingPresence(i18n.actionReading);
      await reloadPdfContent().catch(() => undefined);
      await loadComments().catch(() => undefined);
      setStatus(i18n.statusConnected);
    } catch (error) {
      state.connected = false;
      setConnectedBadge(false);
      setStatus(i18n.statusConnectFailed(String(error)), true);
    }
  });
}
