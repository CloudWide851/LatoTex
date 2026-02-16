const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

function normalizePath(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function extensionOf(path: string): string {
  const normalized = normalizePath(path);
  const dot = normalized.lastIndexOf(".");
  if (dot < 0 || dot === normalized.length - 1) {
    return "";
  }
  return normalized.slice(dot + 1);
}

export function isPdfPath(path: string | null | undefined): boolean {
  return extensionOf(path ?? "") === "pdf";
}

export function isMarkdownPath(path: string | null | undefined): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path ?? ""));
}

