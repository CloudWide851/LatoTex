const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);
const EXCEL_EXTENSIONS = new Set(["xlsx", "xlsm", "xls"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

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

export function isSvgPath(path: string | null | undefined): boolean {
  return extensionOf(path ?? "") === "svg";
}

export function isMarkdownPath(path: string | null | undefined): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isCsvPath(path: string | null | undefined): boolean {
  return CSV_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isExcelPath(path: string | null | undefined): boolean {
  return EXCEL_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isImagePath(path: string | null | undefined): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isTabularPath(path: string | null | undefined): boolean {
  return isCsvPath(path) || isExcelPath(path);
}
