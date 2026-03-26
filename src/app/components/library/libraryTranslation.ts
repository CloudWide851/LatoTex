import {
  translateLibraryDocumentStart,
  translateLibraryDocumentStatus,
} from "../../../shared/api/library";
import type {
  LibraryTranslateResult,
  LibraryTranslateStatus,
} from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

const STAGE_KEY_MAP: Record<string, string> = {
  queued: "library.viewer.translationStage.queued",
  starting: "library.viewer.translationStage.starting",
  preparing: "library.viewer.translationStage.preparing",
  extracting: "library.viewer.translationStage.extracting",
  ocr: "library.viewer.translationStage.ocr",
  translating: "library.viewer.translationStage.translating",
  translated: "library.viewer.translationStage.translated",
  rendering: "library.viewer.translationStage.rendering",
  completed: "library.viewer.translationStage.completed",
  failed: "library.viewer.translateFailed",
  model: "library.viewer.translationStage.model",
};

export function resolveTranslationTargetLanguage(t: TranslationFn): string {
  if (typeof window === "undefined") {
    return t("library.translation.target.enUS");
  }
  const locale = (window.localStorage.getItem("latotex.locale") || "en-US").trim();
  return locale === "zh-CN"
    ? t("library.translation.target.zhCN")
    : t("library.translation.target.enUS");
}

export function resolveTranslationStageLabel(
  stage: string | null | undefined,
  message: string | null | undefined,
  t: TranslationFn,
): string {
  const normalizedStage = String(stage || "").trim().toLowerCase();
  const normalizedMessage = String(message || "").trim();
  if (normalizedStage && STAGE_KEY_MAP[normalizedStage]) {
    if (normalizedStage === "model") {
      return `${t(STAGE_KEY_MAP.model)} ${normalizedMessage.replace(/^model:/i, "").trim()}`.trim();
    }
    return t(STAGE_KEY_MAP[normalizedStage]);
  }
  if (/^model:/i.test(normalizedMessage)) {
    return `${t(STAGE_KEY_MAP.model)} ${normalizedMessage.replace(/^model:/i, "").trim()}`.trim();
  }
  return normalizedMessage || t("library.viewer.translating");
}

export async function startLibraryTranslationTask(input: {
  projectId: string;
  selectedPath: string;
  translationModelId?: string | null;
  t: TranslationFn;
}): Promise<{ taskId: string; targetLanguage: string }> {
  const { projectId, selectedPath, translationModelId, t } = input;
  const targetLanguage = resolveTranslationTargetLanguage(t);
  const started = await translateLibraryDocumentStart({
    projectId,
    relativePath: selectedPath,
    targetLanguage,
    modelOverride: translationModelId ?? undefined,
  });
  return {
    taskId: String(started.taskId || "").trim(),
    targetLanguage,
  };
}

export async function queryLibraryTranslationTask(taskId: string): Promise<LibraryTranslateStatus> {
  return translateLibraryDocumentStatus(taskId);
}

export function ensureTranslationResult(result: LibraryTranslateResult | null | undefined, t: TranslationFn) {
  const translatedPdfRelativePath = String(
    result?.translatedPdfRelativePath || result?.relativePath || "",
  ).trim();
  const sourcePdfRelativePath = String(result?.sourcePdfRelativePath || "").trim();
  if (!translatedPdfRelativePath || !sourcePdfRelativePath) {
    throw new Error(t("library.viewer.translateFailed"));
  }

  const detailParts = [
    result?.engine ? `engine=${result.engine}` : "",
    result?.detectedLanguage ? `source=${result.detectedLanguage}` : "",
    result?.extractionEngine ? `extract=${result.extractionEngine}` : "",
    result?.extractionMode ? `mode=${result.extractionMode}` : "",
    result?.layoutMode ? `layout=${result.layoutMode}` : "",
    typeof result?.pageCount === "number" ? `pages=${result.pageCount}` : "",
    typeof result?.ocrPageCount === "number" ? `ocr=${result.ocrPageCount}` : "",
    typeof result?.glossaryCount === "number" ? `glossary=${result.glossaryCount}` : "",
    result?.refinedBySearch ? "search-refined=true" : "",
  ].filter((item) => item.length > 0);

  return {
    translatedPdfRelativePath,
    sourcePdfRelativePath,
    detail: detailParts.join(" | "),
  };
}
export function formatTranslationTaskFailure(
  status: LibraryTranslateStatus,
  t: TranslationFn,
): string {
  const code = String(status.errorCode || "").trim();
  const message = String(status.error || status.message || "").trim();
  const prefix = code
    ? `${t("library.viewer.translateFailed")} (${code})`
    : t("library.viewer.translateFailed");
  return message ? `${prefix}: ${message}` : prefix;
}

export function formatTranslationDiagnostics(status: LibraryTranslateStatus): string {
  return (status.diagnostics ?? [])
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .join(" | ");
}

