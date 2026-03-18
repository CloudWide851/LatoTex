import {
  translateLibraryDocumentStart,
  translateLibraryDocumentStatus,
} from "../../../shared/api/desktop";
import type {
  LibraryTranslateResult,
  LibraryTranslateStatus,
} from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

export function resolveTranslationTargetLanguage(t: TranslationFn): string {
  if (typeof window === "undefined") {
    return t("library.translation.target.enUS");
  }
  const locale = (window.localStorage.getItem("latotex.locale") || "en-US").trim();
  return locale === "zh-CN"
    ? t("library.translation.target.zhCN")
    : t("library.translation.target.enUS");
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
    typeof result?.glossaryCount === "number" ? `glossary=${result.glossaryCount}` : "",
    result?.refinedBySearch ? "search-refined=true" : "",
  ].filter((item) => item.length > 0);

  return {
    translatedPdfRelativePath,
    sourcePdfRelativePath,
    detail: detailParts.join(" | "),
  };
}
