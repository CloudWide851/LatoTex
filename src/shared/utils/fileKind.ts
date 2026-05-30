import { extensionOfPath } from "./codeLanguage";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);
const EXCEL_EXTENSIONS = new Set(["xlsx", "xlsm", "xls"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "gitignore",
  "dockerignore",
  "editorconfig",
  "env",
  "npmrc",
  "yarnrc",
]);
const TEXT_DOTFILE_NAMES = new Set([
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".npmrc",
  ".yarnrc",
]);

function extensionOf(path: string): string {
  return extensionOfPath(path ?? "");
}

function basenameOf(path: string | null | undefined): string {
  return String(path ?? "").replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
}

export function isExtensionlessTextPath(path: string | null | undefined): boolean {
  const basename = basenameOf(path);
  if (!basename || basename === "." || basename === "..") {
    return false;
  }
  return !basename.includes(".");
}

export function isDotfileTextPath(path: string | null | undefined): boolean {
  const basename = basenameOf(path);
  return TEXT_DOTFILE_NAMES.has(basename) || basename.startsWith(".env.");
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
  return TEXT_EXTENSIONS.has(extensionOf(path ?? ""))
    || isDotfileTextPath(path)
    || isExtensionlessTextPath(path);
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
