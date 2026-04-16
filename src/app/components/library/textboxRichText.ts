const ALLOWED_TAGS = new Set([
  "BR",
  "DIV",
  "P",
  "SPAN",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "SUB",
  "SUP",
  "CODE",
]);

const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
]);

type RichTextInlineStylePatch = {
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  textDecoration?: "none" | "underline";
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeStyleValue(styleText: string): string {
  const declarations = styleText
    .split(";")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  const safe: string[] = [];
  for (const declaration of declarations) {
    const [rawKey, ...rest] = declaration.split(":");
    const key = (rawKey ?? "").trim().toLowerCase();
    if (!ALLOWED_STYLE_PROPS.has(key)) {
      continue;
    }
    const value = rest.join(":").trim();
    if (!value) {
      continue;
    }
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) {
      continue;
    }
    safe.push(`${key}: ${value}`);
  }
  return safe.join("; ");
}

function sanitizeElementTree(node: HTMLElement) {
  const children = Array.from(node.children);
  for (const child of children) {
    if (!ALLOWED_TAGS.has(child.tagName)) {
      const fragment = document.createDocumentFragment();
      while (child.firstChild) {
        fragment.appendChild(child.firstChild);
      }
      child.replaceWith(fragment);
      continue;
    }
    const attrs = Array.from(child.attributes);
    for (const attr of attrs) {
      if (attr.name.toLowerCase() !== "style") {
        child.removeAttribute(attr.name);
      }
    }
    if (child.hasAttribute("style")) {
      const sanitized = sanitizeStyleValue(child.getAttribute("style") ?? "");
      if (sanitized) {
        child.setAttribute("style", sanitized);
      } else {
        child.removeAttribute("style");
      }
    }
    sanitizeElementTree(child as HTMLElement);
  }
}

export function sanitizeRichTextHtml(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return "";
  }
  if (typeof document === "undefined") {
    return plainTextToRichHtml(raw.replace(/<[^>]+>/g, ""));
  }
  const root = document.createElement("div");
  root.innerHTML = raw;
  sanitizeElementTree(root);
  return root.innerHTML;
}

export function plainTextToRichHtml(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(/\r?\n/g, "<br>");
}

export function richHtmlToPlainText(html: string): string {
  if (!html.trim()) {
    return "";
  }
  if (typeof document === "undefined") {
    return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
  }
  const root = document.createElement("div");
  root.innerHTML = html;
  return (root.textContent ?? "").trim();
}

export function isRichTextEmpty(html: string): boolean {
  return richHtmlToPlainText(html).length === 0;
}

export function normalizeStoredRichHtml(html: string | undefined, fallbackText = ""): string {
  const sanitized = sanitizeRichTextHtml(html ?? "");
  if (sanitized) {
    return sanitized;
  }
  if (!fallbackText.trim()) {
    return "";
  }
  return plainTextToRichHtml(fallbackText);
}

function selectionBelongsToRoot(root: HTMLElement, range: Range): boolean {
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE
    ? container as HTMLElement
    : container.parentElement;
  return Boolean(element && root.contains(element));
}

function applyInlineStyle(element: HTMLElement, patch: RichTextInlineStylePatch) {
  if (patch.fontSize) {
    element.style.fontSize = `${patch.fontSize}px`;
  }
  if (patch.fontFamily) {
    element.style.fontFamily = patch.fontFamily;
  }
  if (patch.textColor) {
    element.style.color = patch.textColor;
  }
  if (patch.fontWeight) {
    element.style.fontWeight = patch.fontWeight;
  }
  if (patch.fontStyle) {
    element.style.fontStyle = patch.fontStyle;
  }
  if (patch.textDecoration) {
    element.style.textDecoration = patch.textDecoration;
  }
}

export function captureRichTextSelection(root: HTMLElement): Range | null {
  if (typeof window === "undefined") {
    return null;
  }
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  return selectionBelongsToRoot(root, range) ? range.cloneRange() : null;
}

export function restoreRichTextSelection(root: HTMLElement, snapshot: Range | null): Range | null {
  if (typeof window === "undefined" || !snapshot) {
    return null;
  }
  const range = snapshot.cloneRange();
  if (!selectionBelongsToRoot(root, range)) {
    return null;
  }
  const selection = window.getSelection?.();
  if (!selection) {
    return null;
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

export function applyStyleToRichTextSelection(
  root: HTMLElement,
  patch: RichTextInlineStylePatch,
): Range | null {
  if (typeof window === "undefined") {
    return null;
  }
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!selectionBelongsToRoot(root, range)) {
    return null;
  }
  const fragment = range.extractContents();
  if (!fragment.textContent?.trim()) {
    range.insertNode(fragment);
    return null;
  }
  const wrapper = document.createElement("span");
  applyInlineStyle(wrapper, patch);
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);
  root.normalize();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return nextRange.cloneRange();
}
