import { escapeHtml, normalizeComment } from "/assets/share_page_utils.js";

function offsetToLine(text, offset) {
  const end = Math.max(0, Math.min(text.length, Number(offset) || 0));
  let line = 1;
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function readMetrics(textarea) {
  const style = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight || "") || 24;
  const paddingTop = Number.parseFloat(style.paddingTop || "") || 0;
  const paddingLeft = Number.parseFloat(style.paddingLeft || "") || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom || "") || 0;
  const fontSize = Number.parseFloat(style.fontSize || "") || 14;
  return { lineHeight, paddingTop, paddingLeft, paddingBottom, charWidth: Math.max(fontSize * 0.62, 7) };
}

function focusComment(textarea, comment, onJump) {
  if (typeof onJump === "function") {
    onJump(comment);
    return;
  }
  if (!Number.isFinite(comment.start) || !Number.isFinite(comment.end)) {
    return;
  }
  const start = Math.max(0, comment.start);
  const end = Math.max(start, comment.end);
  textarea.focus();
  textarea.setSelectionRange(start, end);
}

export function createShareEditorReviewSurface({ textarea, highlightLayer, editLayer, threadLayer, onJump, i18n }) {
  let comments = [];
  let editAnnotations = [];
  const resizeHandler = () => {
    refresh();
    refreshEdits();
  };
  const scrollHandler = () => {
    refresh();
    refreshEdits();
  };

  function offsetToPoint(text, offset, metrics) {
    const end = Math.max(0, Math.min(text.length, Number(offset) || 0));
    let line = 1;
    let column = 1;
    for (let index = 0; index < end; index += 1) {
      if (text.charCodeAt(index) === 10) {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
    return {
      line,
      column,
      top: metrics.paddingTop + (line - 1) * metrics.lineHeight - textarea.scrollTop,
      left: metrics.paddingLeft + (column - 1) * metrics.charWidth - textarea.scrollLeft,
    };
  }

  function refresh(nextComments = comments) {
    comments = Array.isArray(nextComments) ? nextComments.map((item) => normalizeComment(item, "Guest")) : comments;
    if (!textarea || !highlightLayer || !threadLayer) {
      return;
    }
    if (document.documentElement.dataset.device === "mobile") {
      highlightLayer.innerHTML = "";
      threadLayer.innerHTML = "";
      return;
    }

    const content = textarea.value || "";
    const metrics = readMetrics(textarea);
    const viewportHeight = textarea.clientHeight;
    let lastCardBottom = -Infinity;

    highlightLayer.innerHTML = "";
    threadLayer.innerHTML = "";

    const texComments = comments
      .filter((item) =>
        item.source === "tex"
          && Number.isFinite(item.start)
          && Number.isFinite(item.end)
          && item.end > item.start,
      )
      .sort((left, right) => left.start - right.start)
      .slice(-12);

    for (const comment of texComments) {
      const startLine = offsetToLine(content, comment.start);
      const endLine = offsetToLine(content, Math.max(comment.start, comment.end - 1));
      const highlightTop = metrics.paddingTop + (startLine - 1) * metrics.lineHeight - textarea.scrollTop;
      const highlightHeight = Math.max(metrics.lineHeight, (endLine - startLine + 1) * metrics.lineHeight);
      if (highlightTop + highlightHeight < -24 || highlightTop > viewportHeight + 96) {
        continue;
      }

      const highlight = document.createElement("div");
      highlight.className = "editor-inline-highlight";
      highlight.style.top = `${Math.round(highlightTop)}px`;
      highlight.style.height = `${Math.round(highlightHeight)}px`;
      highlightLayer.appendChild(highlight);

      const card = document.createElement("button");
      card.type = "button";
      card.className = "editor-inline-thread";
      const cardTop = Math.max(highlightTop, lastCardBottom + 12);
      card.style.top = `${Math.round(cardTop)}px`;
      card.innerHTML = `
        <div class="editor-inline-thread__header">
          <span class="editor-inline-thread__author">${escapeHtml(comment.username)}</span>
          <span class="editor-inline-thread__badge">${escapeHtml(i18n.inlineBadge || "Inline")}</span>
        </div>
        ${comment.quote ? `<div class="editor-inline-thread__quote">${escapeHtml(comment.quote)}</div>` : ""}
        <div class="editor-inline-thread__text">${escapeHtml(comment.text || comment.quote || "")}</div>
      `;
      card.addEventListener("click", () => focusComment(textarea, comment, onJump));
      threadLayer.appendChild(card);
      const cardHeight = Math.max(78, card.getBoundingClientRect().height || 78);
      lastCardBottom = cardTop + cardHeight;
    }
  }

  function refreshEdits(nextAnnotations = editAnnotations) {
    editAnnotations = Array.isArray(nextAnnotations) ? nextAnnotations : editAnnotations;
    if (!textarea || !editLayer) {
      return;
    }
    editLayer.innerHTML = "";
    if (document.documentElement.dataset.device === "mobile") {
      return;
    }
    const content = textarea.value || "";
    const metrics = readMetrics(textarea);
    const viewportHeight = textarea.clientHeight;
    const cutoff = Date.now() - 10_000;
    const visible = editAnnotations
      .filter((item) => Date.parse(item.createdAt || "") >= cutoff)
      .slice(-12);
    editAnnotations = visible;

    for (const item of visible) {
      const startPoint = offsetToPoint(content, item.start, metrics);
      const endPoint = offsetToPoint(content, Math.max(item.end, item.start), metrics);
      if (startPoint.top + metrics.lineHeight < -24 || startPoint.top > viewportHeight + 36) {
        continue;
      }
      const color = String(item.color || "#2563eb");
      if (item.end > item.start) {
        const mark = document.createElement("div");
        mark.className = "editor-edit-highlight";
        mark.style.top = `${Math.round(startPoint.top)}px`;
        mark.style.left = `${Math.max(8, Math.round(startPoint.left))}px`;
        mark.style.width = `${Math.max(12, Math.round((item.end - item.start) * metrics.charWidth))}px`;
        mark.style.height = `${Math.round(metrics.lineHeight)}px`;
        mark.style.setProperty("--edit-color", color);
        editLayer.appendChild(mark);
      }
      const badge = document.createElement("span");
      badge.className = "editor-edit-badge";
      badge.textContent = String(item.username || "Guest").slice(0, 16);
      badge.title = `${i18n.editedBy || "Edited by"} ${item.username || "Guest"}`;
      badge.style.top = `${Math.round(endPoint.top + 2)}px`;
      badge.style.left = `${Math.max(8, Math.round(endPoint.left + 5))}px`;
      badge.style.setProperty("--edit-color", color);
      editLayer.appendChild(badge);
    }
  }

  textarea?.addEventListener("scroll", scrollHandler, { passive: true });
  window.addEventListener("resize", resizeHandler);

  return {
    refresh,
    refreshEdits,
    dispose() {
      textarea?.removeEventListener("scroll", scrollHandler);
      window.removeEventListener("resize", resizeHandler);
      if (highlightLayer) {
        highlightLayer.innerHTML = "";
      }
      if (editLayer) {
        editLayer.innerHTML = "";
      }
      if (threadLayer) {
        threadLayer.innerHTML = "";
      }
    },
  };
}
