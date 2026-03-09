import * as Y from "https://esm.sh/yjs@13.6.29";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const params = new URLSearchParams(window.location.search);
const sid = params.get("sid") || "";
const pwdFromUrl = params.get("pwd") || "";
const locale = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";

const MESSAGES = {
  "zh-CN": {
    title: "LatoTex 协同编辑",
    statusIdle: "空闲",
    usernamePlaceholder: "用户名",
    passwordPlaceholder: "会话口令",
    join: "加入协同",
    reloadPdf: "刷新 PDF",
    addComment: "添加评论",
    requestCompile: "请求编译",
    shareHint: "可选中 PDF 文本作为引用后添加评论，用户名会展示给所有协作者。",
    texPlaceholder: "TeX 内容",
    collaborators: "协作者",
    comments: "评论",
    replyPlaceholder: "回复最新评论...",
    missingSession: "缺少会话 ID",
    sessionFormat: (value) => `会话=${value}`,
    noCollaborators: "当前无在线协作者。",
    noComments: "暂无评论。",
    noPdfText: "暂无 PDF 文本内容。",
    guest: "访客",
    reading: "阅读",
    editingText: "编辑文本",
    addingComment: "添加评论",
    replyingComment: "回复评论",
    compileRequested: "已请求编译",
    compileFailed: (error) => `编译请求失败: ${error}`,
    syncFailed: (error) => `同步失败: ${error}`,
    connectFailed: (error) => `连接失败: ${error}`,
    connecting: "连接中...",
    connected: "已连接",
    sessionRequired: "会话/口令/用户名不能为空",
    selectionLabel: (start, end) => `选择: ${start}-${end}`,
    promptComment: "评论内容",
    viewTex: "TeX",
    viewPdf: "PDF",
    viewComments: "评论",
    quoteLabel: "引用",
    pageLabel: "页码",
    pdfPageLabel: (page, total) => `PDF 页码 ${page}/${total}`,
    promptNeedQuoteOrSelection: "请先选中 PDF 文本或 TeX 文本再评论。",
  },
  "en-US": {
    title: "LatoTex Collaborative Editing",
    statusIdle: "idle",
    usernamePlaceholder: "Username",
    passwordPlaceholder: "Session password",
    join: "Join",
    reloadPdf: "Reload PDF",
    addComment: "Add Comment",
    requestCompile: "Request Compile",
    shareHint: "Select PDF text as a quote, then add comment. Username is visible to collaborators.",
    texPlaceholder: "TeX content",
    collaborators: "Collaborators",
    comments: "Comments",
    replyPlaceholder: "Reply to latest comment...",
    missingSession: "missing session id",
    sessionFormat: (value) => `session=${value}`,
    noCollaborators: "No active collaborators.",
    noComments: "No comments yet.",
    noPdfText: "No PDF text available.",
    guest: "Guest",
    reading: "reading",
    editingText: "editing text",
    addingComment: "adding comment",
    replyingComment: "replying comment",
    compileRequested: "compile requested",
    compileFailed: (error) => `compile failed: ${error}`,
    syncFailed: (error) => `sync failed: ${error}`,
    connectFailed: (error) => `connect failed: ${error}`,
    connecting: "connecting...",
    connected: "connected",
    sessionRequired: "session/password/username required",
    selectionLabel: (start, end) => `selection: ${start}-${end}`,
    promptComment: "Comment text",
    viewTex: "TeX",
    viewPdf: "PDF",
    viewComments: "Comments",
    quoteLabel: "Quote",
    pageLabel: "Page",
    pdfPageLabel: (page, total) => `PDF page ${page}/${total}`,
    promptNeedQuoteOrSelection: "Select PDF text or TeX text before commenting.",
  },
};
const i18n = MESSAGES[locale] || MESSAGES["en-US"];

const metaEl = document.getElementById("meta");
const statusEl = document.getElementById("status");
const pwdEl = document.getElementById("pwd");
const usernameEl = document.getElementById("username");
const editorEl = document.getElementById("editor");
const commentsEl = document.getElementById("comments");
const participantsEl = document.getElementById("participants");
const cursorInfoEl = document.getElementById("cursor-info");
const pdfEl = document.getElementById("pdf");
const connectBtn = document.getElementById("connect");
const addCommentBtn = document.getElementById("add-comment");
const compileBtn = document.getElementById("compile");
const reloadPdfBtn = document.getElementById("reload-pdf");
const replyInput = document.getElementById("comment-input");
const participantsTitleEl = document.getElementById("participants-title");
const commentsTitleEl = document.getElementById("comments-title");
const shareHintEl = document.getElementById("share-hint");
const titleTextEl = document.getElementById("title-text");
const paneEditorEl = document.getElementById("pane-editor");
const paneCommentsEl = document.getElementById("pane-comments");
const viewTexBtn = document.getElementById("view-tex");
const viewPdfBtn = document.getElementById("view-pdf");
const viewCommentsBtn = document.getElementById("view-comments");
const pdfPrevBtn = document.getElementById("pdf-prev");
const pdfNextBtn = document.getElementById("pdf-next");
const pdfPageLabelEl = document.getElementById("pdf-page-label");
const pdfTextEl = document.getElementById("pdf-text");

const clientId = `web-${Math.random().toString(36).slice(2, 10)}`;
const usernameStorageKey = sid ? `latotex-share-username:${sid}` : "latotex-share-username:default";
let connected = false;
let syncingRemote = false;
let participantId = "";
let cursor = 0;
let pullTimer = null;
let presenceTimer = null;
let pullInFlight = false;
let presenceInFlight = false;
let lastAction = i18n.reading;
let currentView = "tex";
let pdfDoc = null;
let pdfPage = 1;
const pdfTextByPage = new Map();

const doc = new Y.Doc();
const yText = doc.getText("tex");
const yComments = doc.getArray("comments");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function toBase64(uint8) {
  let binary = "";
  for (const byte of uint8) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(raw) {
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 45%)`;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

function renderParticipants(items) {
  if (!Array.isArray(items) || items.length === 0) {
    participantsEl.innerHTML = `<div class="muted">${i18n.noCollaborators}</div>`;
    return;
  }
  participantsEl.innerHTML = "";
  for (const item of items) {
    const node = document.createElement("div");
    node.className = "item";
    const name = String(item.username || i18n.guest);
    const action = String(item.lastAction || i18n.reading);
    node.innerHTML = `
      <div class="user-row">
        <span class="avatar" style="background:${avatarColor(name)}">${name.slice(0, 1).toUpperCase()}</span>
        <strong>${name}</strong>
      </div>
      <div class="muted" style="margin-top:4px">${action}</div>
    `;
    participantsEl.appendChild(node);
  }
}

function renderComments() {
  const items = yComments.toArray();
  if (items.length === 0) {
    commentsEl.innerHTML = `<div class="muted">${i18n.noComments}</div>`;
    return;
  }
  commentsEl.innerHTML = "";
  for (const item of items) {
    const node = document.createElement("div");
    node.className = "item";
    const quote = String(item.quote || "").trim();
    const page = Number(item.page || 0);
    const pageLabel = Number.isFinite(page) && page > 0 ? `${i18n.pageLabel}: ${page}` : "";
    node.innerHTML = `
      <div><strong>${item.username || i18n.guest}</strong> ${pageLabel ? `<span class="muted">${pageLabel}</span>` : ""}</div>
      ${quote ? `<div class="muted" style="margin-top:4px">${i18n.quoteLabel}: ${quote}</div>` : ""}
      <div style="margin-top:4px">${item.text || ""}</div>
      <div class="muted" style="margin-top:4px">${item.createdAt || ""}</div>
    `;
    commentsEl.appendChild(node);
  }
}

function updatePdfPageLabel() {
  const total = pdfDoc?.numPages || 0;
  const page = Math.max(1, Math.min(total || 1, pdfPage || 1));
  pdfPageLabelEl.textContent = i18n.pdfPageLabel(page, total || 1);
}

async function extractPdfPageText(pageNumber) {
  if (!pdfDoc || !Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > pdfDoc.numPages) {
    return "";
  }
  if (pdfTextByPage.has(pageNumber)) {
    return pdfTextByPage.get(pageNumber);
  }
  const page = await pdfDoc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const text = textContent.items
    .map((item) => ("str" in item ? String(item.str || "") : ""))
    .join(" ")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  pdfTextByPage.set(pageNumber, text);
  return text;
}

async function renderPdfTextPane() {
  if (!pdfDoc) {
    pdfTextEl.textContent = i18n.noPdfText;
    updatePdfPageLabel();
    return;
  }
  const page = Math.max(1, Math.min(pdfDoc.numPages, pdfPage));
  pdfPage = page;
  updatePdfPageLabel();
  const text = await extractPdfPageText(page);
  pdfTextEl.textContent = text || i18n.noPdfText;
}

async function reloadPdfContent() {
  if (!connected) return;
  const pwd = encodeURIComponent(pwdEl.value.trim());
  const sidValue = encodeURIComponent(sid);
  pdfEl.src = `/api/pdf?sid=${sidValue}&pwd=${pwd}&t=${Date.now()}`;
  try {
    const response = await fetch(`/api/pdf?sid=${sidValue}&pwd=${pwd}&t=${Date.now()}`);
    if (!response.ok) {
      pdfDoc = null;
      pdfTextByPage.clear();
      pdfTextEl.textContent = i18n.noPdfText;
      updatePdfPageLabel();
      return;
    }
    const buffer = await response.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    pdfDoc = await loadingTask.promise;
    if (!Number.isFinite(pdfPage) || pdfPage < 1) {
      pdfPage = 1;
    }
    if (pdfPage > pdfDoc.numPages) {
      pdfPage = pdfDoc.numPages;
    }
    pdfTextByPage.clear();
    await renderPdfTextPane();
  } catch {
    pdfDoc = null;
    pdfTextByPage.clear();
    pdfTextEl.textContent = i18n.noPdfText;
    updatePdfPageLabel();
  }
}

function setMobileView(nextView) {
  currentView = nextView;
  const compact = window.matchMedia("(max-width: 980px)").matches;
  viewTexBtn.classList.toggle("active", nextView === "tex");
  viewPdfBtn.classList.toggle("active", nextView === "pdf");
  viewCommentsBtn.classList.toggle("active", nextView === "comments");
  if (!compact) {
    paneEditorEl.classList.add("active");
    paneCommentsEl.classList.add("active");
    editorEl.style.display = "";
    cursorInfoEl.style.display = "";
    pdfEl.style.display = "";
    pdfPrevBtn.style.display = "";
    pdfNextBtn.style.display = "";
    pdfPageLabelEl.style.display = "";
    pdfTextEl.style.display = "";
    return;
  }
  paneEditorEl.classList.toggle("active", nextView !== "comments");
  paneCommentsEl.classList.toggle("active", nextView === "comments");
  const showPdf = nextView === "pdf";
  editorEl.style.display = showPdf ? "none" : "";
  cursorInfoEl.style.display = showPdf ? "none" : "";
  pdfEl.style.display = showPdf ? "" : "none";
  pdfPrevBtn.style.display = showPdf ? "" : "none";
  pdfNextBtn.style.display = showPdf ? "" : "none";
  pdfPageLabelEl.style.display = showPdf ? "" : "none";
  pdfTextEl.style.display = showPdf ? "" : "none";
}

function readPdfQuoteSelection() {
  const selection = window.getSelection?.();
  const quote = selection?.toString?.().trim() || "";
  if (!quote) {
    return null;
  }
  const anchorNode = selection?.anchorNode;
  if (!anchorNode || !pdfTextEl.contains(anchorNode)) {
    return null;
  }
  return {
    quote,
    page: pdfPage,
  };
}

function readEditorSelection() {
  const start = editorEl.selectionStart || 0;
  const end = editorEl.selectionEnd || 0;
  const selected = editorEl.value.slice(start, end).trim();
  if (!selected) {
    return null;
  }
  return {
    quote: selected,
    start,
    end,
  };
}

async function pingPresence(action) {
  if (!connected || !participantId) return;
  try {
    const payload = await postJson("/api/presence/ping", {
      sid,
      pwd: pwdEl.value.trim(),
      participantId,
      action,
    });
    renderParticipants(payload.participants || []);
  } catch {
    // ignore intermittent failures
  }
}

async function pushUpdate(update) {
  if (!connected) return;
  await postJson("/api/sync/push", {
    sid,
    pwd: pwdEl.value.trim(),
    clientId,
    update: toBase64(update),
    participantId,
    username: usernameEl.value.trim(),
    action: lastAction,
  });
}

async function pullUpdates() {
  if (!connected) return;
  const response = await fetch(
    `/api/sync/pull?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(pwdEl.value.trim())}&cursor=${cursor}`
  );
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  for (const item of payload.events || []) {
    cursor = Math.max(cursor, Number(item.seq || 0));
    if (item.from === clientId) continue;
    syncingRemote = true;
    try {
      Y.applyUpdate(doc, fromBase64(item.update), "remote");
    } finally {
      syncingRemote = false;
    }
  }
  cursor = Math.max(cursor, Number(payload.nextCursor || cursor));
}

function applyI18n() {
  document.title = i18n.title;
  if (titleTextEl) titleTextEl.textContent = i18n.title;
  if (participantsTitleEl) participantsTitleEl.textContent = i18n.collaborators;
  if (commentsTitleEl) commentsTitleEl.textContent = i18n.comments;
  if (shareHintEl) shareHintEl.textContent = i18n.shareHint;
  if (usernameEl) usernameEl.placeholder = i18n.usernamePlaceholder;
  if (pwdEl) pwdEl.placeholder = i18n.passwordPlaceholder;
  if (editorEl) editorEl.placeholder = i18n.texPlaceholder;
  if (replyInput) replyInput.placeholder = i18n.replyPlaceholder;
  if (connectBtn) connectBtn.textContent = i18n.join;
  if (reloadPdfBtn) reloadPdfBtn.textContent = i18n.reloadPdf;
  if (addCommentBtn) addCommentBtn.textContent = i18n.addComment;
  if (compileBtn) compileBtn.textContent = i18n.requestCompile;
  if (viewTexBtn) viewTexBtn.textContent = i18n.viewTex;
  if (viewPdfBtn) viewPdfBtn.textContent = i18n.viewPdf;
  if (viewCommentsBtn) viewCommentsBtn.textContent = i18n.viewComments;
  if (pdfTextEl && !pdfTextEl.textContent) {
    pdfTextEl.textContent = i18n.noPdfText;
  }
}

applyI18n();
if (pwdEl && pwdFromUrl) {
  pwdEl.value = pwdFromUrl;
}
if (usernameEl) {
  usernameEl.value = localStorage.getItem(usernameStorageKey) || "";
}
metaEl.textContent = sid ? i18n.sessionFormat(sid) : i18n.missingSession;
setStatus(i18n.statusIdle);
setMobileView("tex");
updatePdfPageLabel();

yText.observe(() => {
  const value = yText.toString();
  if (editorEl.value !== value) {
    const at = editorEl.selectionStart || 0;
    editorEl.value = value;
    editorEl.setSelectionRange(Math.min(at, value.length), Math.min(at, value.length));
  }
});
yComments.observeDeep(renderComments);
doc.on("update", (update, origin) => {
  if (origin === "remote" || syncingRemote) return;
  pushUpdate(update).catch((error) => setStatus(String(error), true));
});

editorEl.addEventListener("input", () => {
  lastAction = i18n.editingText;
  const next = editorEl.value;
  const current = yText.toString();
  if (next === current) return;
  const applyDelta = (currentValue, nextValue) => {
    let start = 0;
    const maxStart = Math.min(currentValue.length, nextValue.length);
    while (start < maxStart && currentValue[start] === nextValue[start]) start += 1;
    let endCurrent = currentValue.length;
    let endNext = nextValue.length;
    while (
      endCurrent > start &&
      endNext > start &&
      currentValue[endCurrent - 1] === nextValue[endNext - 1]
    ) {
      endCurrent -= 1;
      endNext -= 1;
    }
    const removeLen = endCurrent - start;
    const insert = nextValue.slice(start, endNext);
    if (removeLen > 0) yText.delete(start, removeLen);
    if (insert.length > 0) yText.insert(start, insert);
  };
  doc.transact(() => {
    applyDelta(current, next);
  }, "editor");
});

editorEl.addEventListener("select", () => {
  const start = editorEl.selectionStart || 0;
  const end = editorEl.selectionEnd || 0;
  cursorInfoEl.textContent = i18n.selectionLabel(start, end);
});

viewTexBtn.addEventListener("click", () => setMobileView("tex"));
viewPdfBtn.addEventListener("click", () => setMobileView("pdf"));
viewCommentsBtn.addEventListener("click", () => setMobileView("comments"));
window.addEventListener("resize", () => setMobileView(currentView));

addCommentBtn.addEventListener("click", () => {
  if (!connected) return;
  const pdfQuote = readPdfQuoteSelection();
  const editorSelection = readEditorSelection();
  const quotePayload = pdfQuote || editorSelection;
  if (!quotePayload) {
    setStatus(i18n.promptNeedQuoteOrSelection, true);
    return;
  }
  const text = prompt(i18n.promptComment);
  if (!text) return;
  yComments.push([{
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    username: usernameEl.value.trim(),
    start: Number.isFinite(quotePayload.start) ? quotePayload.start : 0,
    end: Number.isFinite(quotePayload.end) ? quotePayload.end : 0,
    page: Number.isFinite(quotePayload.page) ? quotePayload.page : undefined,
    quote: quotePayload.quote,
    text,
    createdAt: new Date().toISOString(),
  }]);
  lastAction = i18n.addingComment;
  setStatus(i18n.connected);
});

compileBtn.addEventListener("click", async () => {
  if (!connected) return;
  try {
    await postJson("/api/compile/request", { sid, pwd: pwdEl.value.trim() });
    setStatus(i18n.compileRequested);
    lastAction = i18n.compileRequested;
    await pingPresence(lastAction);
  } catch (error) {
    setStatus(i18n.compileFailed(error), true);
  }
});

reloadPdfBtn.addEventListener("click", () => {
  void reloadPdfContent();
});

pdfPrevBtn.addEventListener("click", () => {
  if (!pdfDoc) return;
  pdfPage = Math.max(1, pdfPage - 1);
  void renderPdfTextPane();
});
pdfNextBtn.addEventListener("click", () => {
  if (!pdfDoc) return;
  pdfPage = Math.min(pdfDoc.numPages, pdfPage + 1);
  void renderPdfTextPane();
});

replyInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const text = replyInput.value.trim();
  if (!text) return;
  const items = yComments.toArray();
  if (items.length === 0) return;
  const last = items[items.length - 1];
  const next = { ...last, text: `${last.text}\n[Reply ${usernameEl.value.trim()}] ${text}` };
  yComments.delete(items.length - 1, 1);
  yComments.insert(items.length - 1, [next]);
  replyInput.value = "";
  lastAction = i18n.replyingComment;
});

connectBtn.addEventListener("click", async () => {
  const pwd = pwdEl.value.trim();
  const username = usernameEl.value.trim();
  if (!sid || !pwd || !username) {
    setStatus(i18n.sessionRequired, true);
    return;
  }
  localStorage.setItem(usernameStorageKey, username);
  try {
    setStatus(i18n.connecting);
    const joined = await postJson("/api/join", { sid, pwd, clientId, username });
    participantId = String(joined.participantId || "");
    renderParticipants(joined.participants || []);
    const snapshotResp = await fetch(`/api/snapshot?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(pwd)}`);
    if (!snapshotResp.ok) throw new Error(await snapshotResp.text());
    const snapshot = await snapshotResp.json();
    doc.transact(() => {
      const current = yText.toString();
      yText.delete(0, current.length);
      yText.insert(0, snapshot.content || "");
    }, "remote");
    connected = true;
    cursor = 0;
    if (pullTimer) clearTimeout(pullTimer);
    if (presenceTimer) clearTimeout(presenceTimer);

    const pullLoop = async () => {
      if (!connected) return;
      if (!pullInFlight) {
        pullInFlight = true;
        try {
          await pullUpdates();
        } catch (error) {
          setStatus(i18n.syncFailed(error), true);
        } finally {
          pullInFlight = false;
        }
      }
      const hidden = document.hidden;
      pullTimer = setTimeout(pullLoop, hidden ? 1800 : 900);
    };

    const presenceLoop = async () => {
      if (!connected) return;
      if (!presenceInFlight) {
        presenceInFlight = true;
        try {
          await pingPresence(lastAction);
        } finally {
          presenceInFlight = false;
        }
      }
      const hidden = document.hidden;
      presenceTimer = setTimeout(presenceLoop, hidden ? 3500 : 1800);
    };

    pullTimer = setTimeout(pullLoop, 900);
    presenceTimer = setTimeout(presenceLoop, 1400);
    await pingPresence(i18n.reading);
    setStatus(i18n.connected);
    await reloadPdfContent();
    renderComments();
  } catch (error) {
    connected = false;
    setStatus(i18n.connectFailed(error), true);
  }
});

