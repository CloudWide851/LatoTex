import { avatarColor, escapeHtml, normalizeComment, trimQuote } from "/assets/share_page_utils.js";

export function renderParticipants(container, items, i18n) {
  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<article class="participant empty-state"><div class="name">${i18n.noCollaborators}</div></article>`;
    return;
  }
  container.innerHTML = "";
  for (const item of items) {
    const name = String(item.username || "Guest");
    const node = document.createElement("article");
    node.className = "participant";
    node.innerHTML = `
      <span class="avatar" style="background:${avatarColor(name)}">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>
      <div class="participant-copy">
        <div class="name">${escapeHtml(name)}</div>
        <div class="muted">${escapeHtml(String(item.lastAction || i18n.actionReading))}</div>
      </div>
    `;
    container.appendChild(node);
  }
}

export function withHighlight(text, quote, start, end) {
  const plain = String(text || "");
  if (Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0 && end <= plain.length) {
    const before = escapeHtml(plain.slice(0, start));
    const hit = escapeHtml(plain.slice(start, end));
    const after = escapeHtml(plain.slice(end));
    return `${before}<mark>${hit}</mark>${after}`;
  }
  if (!quote) return escapeHtml(plain);
  const target = trimQuote(quote, 160);
  if (!target) return escapeHtml(plain);
  const index = plain.toLowerCase().indexOf(target.toLowerCase());
  if (index < 0) return escapeHtml(plain);
  const before = escapeHtml(plain.slice(0, index));
  const hit = escapeHtml(plain.slice(index, index + target.length));
  const after = escapeHtml(plain.slice(index + target.length));
  return `${before}<mark>${hit}</mark>${after}`;
}

export function renderComments(container, itemsRaw, i18n, onJump) {
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  if (!items.length) {
    container.innerHTML = `<article class="comment-item empty-state"><p>${i18n.noComments}</p></article>`;
    return;
  }
  container.innerHTML = "";
  for (const raw of items.slice().reverse()) {
    const item = normalizeComment(raw, "Guest");
    const node = document.createElement("article");
    node.className = "comment-item";
    const quoteBlock = item.quote
      ? `<button class="quote-block" data-comment-id="${escapeHtml(item.id)}" title="${escapeHtml(i18n.clickJump)}">${escapeHtml(item.quote)}</button>`
      : "";
    const sourceText = item.quote
      ? item.source === "pdf"
        ? i18n.quoteFromPdf(item.page || 1)
        : i18n.quoteFromTex
      : "";
    const sessionMeta = item.sessionCreatedAt
      ? `${item.sessionName ? `${item.sessionName} · ` : ""}${item.sessionCreatedAt}`
      : "";
    node.innerHTML = `
      <header>
        <strong>${escapeHtml(item.username)}</strong>
        <small>${escapeHtml(item.createdAt || "")}</small>
      </header>
      ${quoteBlock}
      ${sourceText ? `<div class="quote-source">${escapeHtml(sourceText)}</div>` : ""}
      ${sessionMeta ? `<div class="quote-source">${escapeHtml(sessionMeta)}</div>` : ""}
      <p>${escapeHtml(item.text)}</p>
    `;
    node.querySelector(".quote-block")?.addEventListener("click", () => onJump(item));
    container.appendChild(node);
  }
}
