import * as Y from "/assets/vendor/yjs.mjs";
import { createI18n, detectDevice, detectLocale } from "/assets/share_page_i18n.js";
import { createSharePdfController } from "/assets/share_page_pdf.js";
import { renderComments, renderParticipants } from "/assets/share_page_render.js";
import { fromBase64, postJson, toBase64, trimQuote } from "/assets/share_page_utils.js";

export async function bootstrapSharePage() {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get("sid") || "";
  const pwdFromUrl = params.get("pwd") || "";
  const locale = detectLocale(params.get("lang") || params.get("locale"));
  const i18n = createI18n(locale);

  const el = {
    brand: document.getElementById("share-brand"),
    title: document.getElementById("title-text"),
    meta: document.getElementById("meta"),
    status: document.getElementById("status"),
    badge: document.getElementById("connected-badge"),
    accessTitle: document.getElementById("access-title"),
    modesKicker: document.getElementById("modes-kicker"),
    modesTitle: document.getElementById("modes-title"),
    manuscriptKicker: document.getElementById("manuscript-kicker"),
    previewKicker: document.getElementById("preview-kicker"),
    identityLabel: document.getElementById("identity-label"),
    passwordLabel: document.getElementById("password-label"),
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
    pdfCanvasWrap: document.getElementById("pdf-canvas-wrap"),
    pdfCanvas: document.getElementById("pdf-canvas"),
    pdfEmpty: document.getElementById("pdf-empty"),
    pdfPrev: document.getElementById("pdf-prev"),
    pdfNext: document.getElementById("pdf-next"),
    pdfPage: document.getElementById("pdf-page-label"),
    pdfText: document.getElementById("pdf-text"),
    participantsTitle: document.getElementById("participants-title"),
    participants: document.getElementById("participants"),
    commentsTitle: document.getElementById("comments-title"),
    comments: document.getElementById("comments"),
    workspaceKicker: document.getElementById("workspace-kicker"),
    editorPanelLabel: document.getElementById("editor-panel-label"),
    pdfPanelLabel: document.getElementById("pdf-panel-label"),
    presenceKicker: document.getElementById("presence-kicker"),
    discussionKicker: document.getElementById("discussion-kicker"),
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
    action: i18n.actionReading,
    view: "tex",
    pdfDoc: null,
    pdfPage: 1,
    pdfTextByPage: new Map(),
    draftQuote: null,
    selectionQuote: null,
    pdfReady: false,
    highlightQuote: "",
    highlightStart: undefined,
    highlightEnd: undefined,
    comments: [],
    device: "desktop",
  };
  const usernameStorageKey = sid ? `latotex-share-username:${sid}` : "latotex-share-username:default";

  function refreshEnvironment() {
    const device = detectDevice();
    state.device = device;
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.documentElement.dataset.device = device;
    document.body.dataset.locale = locale;
    document.body.dataset.device = device;
    return device;
  }

  function setStatus(text, isError = false) {
    el.status.textContent = text;
    el.status.classList.toggle("is-error", isError);
  }

  function setConnectedBadge(connected) {
    el.badge.textContent = connected ? i18n.connectedBadge : i18n.statusIdle;
    el.badge.classList.toggle("connected", connected);
  }

  const pdf = createSharePdfController({
    sid,
    getPassword: () => el.pwd.value.trim(),
    i18n,
    state,
    el,
    setStatus,
  });

  function setView(nextView) {
    state.view = nextView;
    const compact = refreshEnvironment() === "mobile";
    document.body.dataset.view = nextView;
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
    const sourceText = quote.source === "pdf"
      ? i18n.quoteFromPdf(quote.page || 1)
      : i18n.quoteFromTex;
    el.quotePreview.hidden = false;
    el.quoteSource.textContent = sourceText;
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
    if (!el.pdfText.contains(selection.anchorNode) || !el.pdfText.contains(selection.focusNode)) return null;
    const range = selection.getRangeAt(0);
    const rawText = selection.toString();
    const text = trimQuote(rawText);
    if (!text) return null;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(el.pdfText);
    prefix.setEnd(range.startContainer, range.startOffset);
    const rawStart = prefix.toString().length;
    const trimmedOffset = rawText.indexOf(text);
    const start = Math.max(0, rawStart + Math.max(0, trimmedOffset));
    const end = start + text.length;
    return {
      source: "pdf",
      text,
      page: state.pdfPage,
      start,
      end,
      rect: range.getBoundingClientRect(),
    };
  }

  function updateQuoteFromSelection() {
    const pdfSelection = readPdfSelection();
    if (pdfSelection) {
      showQuickQuote(pdfSelection.rect, {
        source: "pdf",
        text: pdfSelection.text,
        page: pdfSelection.page,
        start: pdfSelection.start,
        end: pdfSelection.end,
      });
      return;
    }
    const texSelection = readEditorSelection();
    if (texSelection) {
      showQuickQuote(el.editor.getBoundingClientRect(), texSelection);
      return;
    }
    hideQuickQuote();
  }

  async function jumpToComment(comment) {
    if (comment.source === "pdf" && comment.page) {
      state.highlightQuote = comment.quote || "";
      state.highlightStart = Number.isFinite(comment.start) ? comment.start : undefined;
      state.highlightEnd = Number.isFinite(comment.end) ? comment.end : undefined;
      state.pdfPage = comment.page;
      setView("pdf");
      await pdf.renderPdfPage();
      return;
    }
    state.highlightQuote = "";
    state.highlightStart = undefined;
    state.highlightEnd = undefined;
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
      `/api/comments/list?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(el.pwd.value.trim())}&participantId=${encodeURIComponent(state.participantId)}${token}&t=${Date.now()}`,
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
        `/api/sync/pull?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(el.pwd.value.trim())}&participantId=${encodeURIComponent(state.participantId)}${token}&cursor=${state.cursor}`,
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
        await pdf.reloadPdfContent().catch(() => undefined);
      }
      schedulePdfStatusLoop();
    }, hidden ? 5000 : 2600);
  }

  function setupI18n() {
    refreshEnvironment();
    document.title = i18n.title;
    el.brand.textContent = i18n.brand;
    el.title.textContent = i18n.title;
    el.meta.textContent = sid ? i18n.sessionLabel(sid) : i18n.missingSession;
    el.accessTitle.textContent = i18n.accessTitle;
    el.modesKicker.textContent = i18n.modesKicker;
    el.modesTitle.textContent = i18n.modesTitle;
    el.manuscriptKicker.textContent = i18n.manuscriptKicker;
    el.previewKicker.textContent = i18n.previewKicker;
    el.identityLabel.textContent = i18n.identityLabel;
    el.passwordLabel.textContent = i18n.passwordLabel;
    el.username.placeholder = i18n.usernamePlaceholder;
    el.pwd.placeholder = i18n.passwordPlaceholder;
    el.connect.textContent = i18n.join;
    el.reloadPdf.textContent = i18n.reloadPdf;
    el.copyPwd.textContent = i18n.copyPassword;
    el.viewTex.textContent = i18n.tabTex;
    el.viewPdf.textContent = i18n.tabPdf;
    el.viewComments.textContent = i18n.tabComments;
    el.workspaceKicker.textContent = i18n.workspaceKicker;
    el.editorPanelLabel.textContent = i18n.editorPanelLabel;
    el.pdfPanelLabel.textContent = i18n.pdfPanelLabel;
    el.presenceKicker.textContent = i18n.presenceKicker;
    el.discussionKicker.textContent = i18n.discussionKicker;
    el.participantsTitle.textContent = i18n.collaborators;
    el.commentsTitle.textContent = i18n.comments;
    el.hint.textContent = i18n.shareHint;
    el.requestCompile.textContent = i18n.compile;
    el.quickQuote.textContent = i18n.addQuote;
    el.commentEditor.placeholder = i18n.commentPlaceholder;
    el.postComment.textContent = i18n.postComment;
    el.clearQuote.textContent = i18n.clearQuote;
    el.pdfEmpty.textContent = i18n.noPdfPreview;
  }

  setupI18n();
  setStatus(i18n.statusIdle);
  setConnectedBadge(false);
  setView("tex");
  el.pwd.value = pwdFromUrl;
  el.username.value = localStorage.getItem(usernameStorageKey) || "";
  pdf.updatePdfPageLabel();

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
  window.addEventListener("resize", () => {
    refreshEnvironment();
    setView(state.view);
  });
  window.addEventListener("scroll", () => {
    if (!el.quickQuote.hidden) updateQuoteFromSelection();
  }, true);
  window.addEventListener("beforeunload", () => {
    pdf.dispose();
  }, { once: true });

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
    void pdf.reloadPdfContent();
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
    void pdf.reloadPdfContent();
  });
  el.viewComments.addEventListener("click", () => setView("comments"));

  el.pdfPrev.addEventListener("click", () => {
    if (!state.pdfDoc) return;
    state.pdfPage = Math.max(1, state.pdfPage - 1);
    void pdf.renderPdfPage();
  });
  el.pdfNext.addEventListener("click", () => {
    if (!state.pdfDoc) return;
    state.pdfPage = Math.min(state.pdfDoc.numPages, state.pdfPage + 1);
    void pdf.renderPdfPage();
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
      await pdf.reloadPdfContent().catch(() => undefined);
      await loadComments().catch(() => undefined);
      setStatus(i18n.statusConnected);
    } catch (error) {
      state.connected = false;
      setConnectedBadge(false);
      setStatus(i18n.statusConnectFailed(String(error)), true);
    }
  });
}
