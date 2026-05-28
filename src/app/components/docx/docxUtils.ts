import type { ResourceNode } from "../../../shared/types/app";

export type TranslationFn = (key: any) => string;
export type ResourceSuggestion = { name: string; path: string; image: boolean };

export function execFormat(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function mapDocxStatus(raw: string, t: TranslationFn): string {
  if (raw.includes("invalid Zip archive") || raw.includes("docx.document_missing")) {
    return t("docx.error.invalidArchive");
  }
  return raw;
}

export function sanitizeDocxHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set([
    "P",
    "BR",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "S",
    "SUB",
    "SUP",
    "H1",
    "H2",
    "H3",
    "UL",
    "OL",
    "LI",
    "A",
    "TABLE",
    "TBODY",
    "TR",
    "TD",
    "TH",
    "SPAN",
    "IMG",
    "HR",
  ]);
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (!allowedTags.has(element.tagName)) {
          element.replaceWith(...Array.from(element.childNodes));
          continue;
        }
        for (const attr of Array.from(element.attributes)) {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim();
          const safeHref = name === "href" && /^(https?:|mailto:|#)/i.test(value);
          const safeImageMarker = name === "data-docx-image";
          const safeEmbeddedMarker = element.tagName === "IMG" && name === "data-docx-embedded";
          const safeMediaMarker = element.tagName === "IMG" && name === "data-docx-media" && !value.includes("..");
          const safeImageResource = element.tagName === "IMG" && name === "data-docx-resource" && !value.includes("..");
          const safeImageSrc = element.tagName === "IMG" && name === "src" && /^(latotex-resource:|https?:\/\/latotex-resource\.localhost|blob:|data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,)/i.test(value);
          const safeAlt = element.tagName === "IMG" && name === "alt";
          const safeEditable = name === "contenteditable" && element.hasAttribute("data-docx-image");
          const safePageBreak = name === "data-docx-page-break" && value === "true";
          if (!safeHref && !safeImageMarker && !safeEmbeddedMarker && !safeMediaMarker && !safeImageResource && !safeImageSrc && !safeAlt && !safeEditable && !safePageBreak) {
            element.removeAttribute(attr.name);
          }
        }
      }
      walk(child);
    }
  };
  walk(template.content);
  return template.innerHTML || "<p><br></p>";
}

export function stripHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.textContent ?? "";
}

export function countWords(html: string): number {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
}

export function countMatches(text: string, needle: string): number {
  if (!needle.trim()) {
    return 0;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(text.matchAll(new RegExp(escaped, "gi"))).length;
}

export function flattenResources(nodes: ResourceNode[]): ResourceSuggestion[] {
  const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
  const out: ResourceSuggestion[] = [];
  const visit = (items: ResourceNode[]) => {
    items.forEach((node) => {
      if (node.kind === "file") {
        const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
        out.push({ name: node.name, path: node.relativePath, image: imageExts.has(ext) });
      } else {
        visit(node.children ?? []);
      }
    });
  };
  visit(nodes);
  return out;
}

export function currentResourceQuery(): string | null {
  const selection = window.getSelection();
  const text = selection?.anchorNode?.textContent ?? "";
  const offset = selection?.anchorOffset ?? text.length;
  const before = text.slice(0, offset);
  const match = before.match(/@@\s+([^@\n\r]{0,80})$/);
  return match ? match[1].trim().toLowerCase() : null;
}

export function replaceResourceTriggerWithHtml(html: string): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }
  const anchor = selection.anchorNode;
  if (!anchor || anchor.nodeType !== Node.TEXT_NODE) {
    return false;
  }
  const text = anchor.textContent ?? "";
  const offset = selection.anchorOffset;
  const before = text.slice(0, offset);
  const match = before.match(/@@\s+([^@\n\r]{0,80})$/);
  if (!match) {
    return false;
  }
  const range = document.createRange();
  range.setStart(anchor, offset - match[0].length);
  range.setEnd(anchor, offset);
  range.deleteContents();
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  const lastChild = fragment.lastChild;
  range.insertNode(fragment);
  if (lastChild) {
    range.setStartAfter(lastChild);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}
