import {
  isCsvPath,
  isDocxPath,
  isExcelPath,
  isHtmlPath,
  isImagePath,
  isMarkdownPath,
  isPdfPath,
  isPlainTextPath,
  isSvgPath,
  isTabularPath,
} from "../../../shared/utils/fileKind";

export type WorkspacePreviewMode = "pdf" | "image" | "markdown" | "html" | "svg" | "empty";

export type WorkspacePreviewFlags = {
  selectedIsPdf: boolean;
  selectedIsExcel: boolean;
  selectedIsImage: boolean;
  selectedIsMarkdown: boolean;
  selectedIsHtml: boolean;
  selectedIsSvg: boolean;
  selectedIsCsv: boolean;
  selectedIsTabular: boolean;
  selectedIsPlainText: boolean;
  selectedIsTex: boolean;
  selectedIsDocx: boolean;
};

export function resolveWorkspacePreviewFlags(path: string | null): WorkspacePreviewFlags {
  return {
    selectedIsPdf: isPdfPath(path),
    selectedIsExcel: isExcelPath(path),
    selectedIsImage: isImagePath(path),
    selectedIsMarkdown: isMarkdownPath(path),
    selectedIsHtml: isHtmlPath(path),
    selectedIsSvg: isSvgPath(path),
    selectedIsCsv: isCsvPath(path),
    selectedIsTabular: isTabularPath(path),
    selectedIsPlainText: isPlainTextPath(path),
    selectedIsTex: Boolean(path && /\.tex$/i.test(path)),
    selectedIsDocx: isDocxPath(path),
  };
}

export function resolveWorkspacePreviewMode(input: {
  flags: WorkspacePreviewFlags;
  selectedImagePreviewUrl: string | null;
  selectedFilePdfUrl: string | null;
  compiledPdfUrl: string | null;
  previewSelectedPath: string | null;
  preferCompiledPreview: boolean;
}): WorkspacePreviewMode {
  const {
    flags,
    selectedImagePreviewUrl,
    selectedFilePdfUrl,
    compiledPdfUrl,
    previewSelectedPath,
    preferCompiledPreview,
  } = input;
  if (flags.selectedIsImage) {
    return selectedImagePreviewUrl ? "image" : "empty";
  }
  if (flags.selectedIsPdf) {
    return selectedFilePdfUrl ? "pdf" : "empty";
  }
  if (flags.selectedIsTabular) {
    return "empty";
  }
  if (flags.selectedIsSvg) {
    return "svg";
  }
  if (flags.selectedIsMarkdown) {
    return "markdown";
  }
  if (flags.selectedIsHtml) {
    return "html";
  }
  if (compiledPdfUrl && (!previewSelectedPath || flags.selectedIsTex || preferCompiledPreview)) {
    return "pdf";
  }
  return "empty";
}

export function isWorkspaceUnsupportedPreviewPath(path: string | null): boolean {
  if (!path) {
    return false;
  }
  const flags = resolveWorkspacePreviewFlags(path);
  return !flags.selectedIsPdf
    && !flags.selectedIsImage
    && !flags.selectedIsMarkdown
    && !flags.selectedIsHtml
    && !flags.selectedIsSvg
    && !flags.selectedIsTabular
    && !flags.selectedIsTex
    && !flags.selectedIsPlainText
    && !flags.selectedIsDocx;
}
