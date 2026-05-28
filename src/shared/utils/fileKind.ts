import { extensionOfPath } from "./codeLanguage";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);
const EXCEL_EXTENSIONS = new Set(["xlsx", "xlsm", "xls"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);

function extensionOf(path: string): string {
  return extensionOfPath(path ?? "");
}

export function isPdfPath(path: string | null | undefined): boolean {
  return extensionOf(path ?? "") === "pdf";
}

export function isTexPath(path: string | null | undefined): boolean {
  return extensionOf(path ?? "") === "tex";
}

export function isSvgPath(path: string | null | undefined): boolean {
  return extensionOf(path ?? "") === "svg";
}

export function isPlainTextPath(path: string | null | undefined): boolean {
  return extensionOf(path ?? "") === "txt";
}

export function isMarkdownPath(path: string | null | undefined): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isHtmlPath(path: string | null | undefined): boolean {
  return HTML_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isCsvPath(path: string | null | undefined): boolean {
  return CSV_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isExcelPath(path: string | null | undefined): boolean {
  return EXCEL_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isDocxPath(path: string | null | undefined): boolean {
  return extensionOf(path ?? "") === "docx";
}

export function isImagePath(path: string | null | undefined): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path ?? ""));
}

export function isTabularPath(path: string | null | undefined): boolean {
  return isCsvPath(path) || isExcelPath(path);
}

export function isCodePath(path: string | null | undefined): boolean {
  const ext = extensionOf(path ?? "");
  return Boolean(ext)
    && !isPdfPath(path)
    && !isImagePath(path)
    && !isDocxPath(path)
    && !isMarkdownPath(path)
    && !isHtmlPath(path)
    && !isSvgPath(path)
    && !isTabularPath(path);
}
