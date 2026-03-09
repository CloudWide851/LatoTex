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
