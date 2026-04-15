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
  const paddingBottom = Number.parseFloat(style.paddingBottom || "") || 0;
  return { lineHeight, paddingTop, paddingBottom };
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

export function createShareEditorReviewSurface({ textarea, highlightLayer, threadLayer, onJump, i18n }) {
  let comments = [];
  const resizeHandler = () => refresh();
  const scrollHandler = () => refresh();

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

  textarea?.addEventListener("scroll", scrollHandler, { passive: true });
  window.addEventListener("resize", resizeHandler);

  return {
    refresh,
    dispose() {
      textarea?.removeEventListener("scroll", scrollHandler);
      window.removeEventListener("resize", resizeHandler);
      if (highlightLayer) {
        highlightLayer.innerHTML = "";
      }
      if (threadLayer) {
        threadLayer.innerHTML = "";
      }
    },
  };
}
