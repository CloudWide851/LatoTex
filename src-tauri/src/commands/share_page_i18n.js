function normalizeLocale(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value.startsWith("zh")) {
    return "zh-CN";
  }
  return "en-US";
}

export function detectLocale(preferred) {
  if (preferred) {
    return normalizeLocale(preferred);
  }
  return normalizeLocale(navigator.language || navigator.languages?.[0] || "");
}

export function detectDevice() {
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "").toLowerCase() : "";
  const touchPoints = typeof navigator !== "undefined" ? Number(navigator.maxTouchPoints || 0) : 0;
  const isMobileUa = /android|iphone|ipad|ipod|mobile/i.test(userAgent);
  const compactViewport = viewportWidth <= 900;
  return isMobileUa || (compactViewport && touchPoints > 0) ? "mobile" : "desktop";
}

const messages = {
  "zh-CN": {
    title: "LatoTex 协同编辑",
    brand: "LatoTex 共享协作",
    identityLabel: "身份名称",
    passwordLabel: "会话口令",
    workspaceKicker: "实时工作区",
    accessTitle: "会话接入",
    modesKicker: "模式",
    modesTitle: "审阅界面",
    manuscriptKicker: "稿件",
    previewKicker: "预览",
    editorPanelLabel: "TeX 编辑区",
    pdfPanelLabel: "PDF 预览",
    presenceKicker: "协作状态",
    discussionKicker: "讨论区",
    sessionLabel: (sid) => `会话 ${sid}`,
    missingSession: "缺少会话 ID",
    statusIdle: "空闲",
    statusConnecting: "连接中...",
    statusConnected: "已连接",
    statusPdfPreparing: "PDF 正在准备中...",
    statusPdfReady: "PDF 已就绪",
    statusPdfLoadFailed: (reason) => `PDF 预览加载失败: ${reason}`,
    statusNeedFields: "会话 / 口令 / 用户名不能为空",
    statusQuoteNeeded: "请先在 PDF 或 TeX 中选中要引用的文本。",
    statusCommentPosted: "评论已发布",
    statusPostCommentFailed: (reason) => `发布评论失败: ${reason}`,
    statusCompileRequested: "已请求编译",
    statusCompileFailed: (reason) => `编译请求失败: ${reason}`,
    statusSyncFailed: (reason) => `同步失败: ${reason}`,
    statusConnectFailed: (reason) => `连接失败: ${reason}`,
    connectedBadge: "已连接",
    join: "加入协同",
    reloadPdf: "刷新 PDF",
    copyPassword: "复制口令",
    copyPasswordDone: "已复制",
    usernamePlaceholder: "用户名",
    passwordPlaceholder: "会话口令",
    tabTex: "TeX",
    tabPdf: "PDF",
    tabComments: "评论",
    compile: "请求编译",
    addQuote: "引用",
    quoteLabel: "引用",
    commentPlaceholder: "输入评论内容...",
    postComment: "发布",
    clearQuote: "清空引用",
    collaborators: "协作者",
    comments: "评论",
    noCollaborators: "暂无在线协作者。",
    noComments: "暂无评论。",
    noPdfText: "暂无 PDF 文本内容。",
    noPdfPreview: "当前没有可预览的 PDF。",
    pdfPageLabel: (page, total) => `PDF 页码 ${page}/${total}`,
    quoteFromPdf: (page) => `来自 PDF 第 ${page} 页`,
    quoteFromTex: "来自 TeX 编辑区",
    clickJump: "点击可跳转",
    shareHint: "选中文本后点击“引用”，再发布评论；点击引用可回跳到原位置。",
    actionReading: "阅读",
    actionEditing: "编辑文本",
    actionCommenting: "发表评论",
    actionCompile: "请求编译",
    promptNeedCommentOrQuote: "评论内容和引用不能同时为空。",
  },
  "en-US": {
    title: "LatoTex Collaborative Editing",
    brand: "LatoTex Shared Workspace",
    identityLabel: "Identity",
    passwordLabel: "Session password",
    workspaceKicker: "Live workspace",
    accessTitle: "Session Access",
    modesKicker: "Modes",
    modesTitle: "Review Surface",
    manuscriptKicker: "Manuscript",
    previewKicker: "Preview",
    editorPanelLabel: "TeX editor",
    pdfPanelLabel: "PDF preview",
    presenceKicker: "Presence",
    discussionKicker: "Discussion",
    sessionLabel: (sid) => `Session ${sid}`,
    missingSession: "Missing session id",
    statusIdle: "Idle",
    statusConnecting: "Connecting...",
    statusConnected: "Connected",
    statusPdfPreparing: "PDF is being prepared...",
    statusPdfReady: "PDF ready",
    statusPdfLoadFailed: (reason) => `Failed to load PDF preview: ${reason}`,
    statusNeedFields: "Session, password, and username are required",
    statusQuoteNeeded: "Select text in PDF or TeX first.",
    statusCommentPosted: "Comment posted",
    statusPostCommentFailed: (reason) => `Failed to post comment: ${reason}`,
    statusCompileRequested: "Compile requested",
    statusCompileFailed: (reason) => `Compile request failed: ${reason}`,
    statusSyncFailed: (reason) => `Sync failed: ${reason}`,
    statusConnectFailed: (reason) => `Connect failed: ${reason}`,
    connectedBadge: "Connected",
    join: "Join session",
    reloadPdf: "Reload PDF",
    copyPassword: "Copy password",
    copyPasswordDone: "Copied",
    usernamePlaceholder: "Username",
    passwordPlaceholder: "Session password",
    tabTex: "TeX",
    tabPdf: "PDF",
    tabComments: "Comments",
    compile: "Request compile",
    addQuote: "Quote",
    quoteLabel: "Quote",
    commentPlaceholder: "Write a comment...",
    postComment: "Post",
    clearQuote: "Clear quote",
    collaborators: "Collaborators",
    comments: "Comments",
    noCollaborators: "No active collaborators.",
    noComments: "No comments yet.",
    noPdfText: "No PDF text available.",
    noPdfPreview: "No PDF preview is available right now.",
    pdfPageLabel: (page, total) => `PDF page ${page}/${total}`,
    quoteFromPdf: (page) => `From PDF page ${page}`,
    quoteFromTex: "From TeX editor",
    clickJump: "Click to jump",
    shareHint: "Select text, click quote, then post. Click a quote to jump back.",
    actionReading: "Reading",
    actionEditing: "Editing text",
    actionCommenting: "Posting comment",
    actionCompile: "Requesting compile",
    promptNeedCommentOrQuote: "Comment text and quote cannot both be empty.",
  },
};

export function createI18n(locale) {
  return messages[normalizeLocale(locale)] || messages["en-US"];
}
