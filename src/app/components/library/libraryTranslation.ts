import { translateLibraryDocument } from "../../../shared/api/desktop";
import type { LibraryCitationSummary } from "../../../shared/types/app";

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

export async function translateLibraryPaper(input: {
  projectId: string;
  selectedPath: string;
  translationModelId?: string | null;
  citation: LibraryCitationSummary | null;
  bibPreview: string;
  t: TranslationFn;
}): Promise<{ relativePath: string; detail: string; targetLanguage: string }> {
  const { projectId, selectedPath, translationModelId, citation, bibPreview, t } = input;
  const targetLanguage = resolveTranslationTargetLanguage(t);
  const metadataHint = bibPreview.trim().length > 0
    ? bibPreview
    : [
      `Title: ${citation?.title ?? "-"}`,
      `Authors: ${(citation?.authors ?? []).join(", ")}`,
      `DOI: ${citation?.doi ?? "-"}`,
      `arXiv: ${citation?.arxivId ?? "-"}`,
      `URLs: ${(citation?.urls ?? []).join(", ")}`,
    ].join("\n");
  const result = await translateLibraryDocument({
    projectId,
    relativePath: selectedPath,
    targetLanguage,
    modelOverride: translationModelId ?? undefined,
  });
  if (!result.relativePath?.trim()) {
    throw new Error(t("library.viewer.translateFailed"));
  }
  if (!result.sourceKind && metadataHint.trim().length === 0) {
    throw new Error(t("library.viewer.translateFailed"));
  }

  const detailParts = [
    result.engine ? `engine=${result.engine}` : "",
    result.detectedLanguage ? `source=${result.detectedLanguage}` : "",
    result.extractionEngine ? `extract=${result.extractionEngine}` : "",
    typeof result.glossaryCount === "number" ? `glossary=${result.glossaryCount}` : "",
    result.refinedBySearch ? "search-refined=true" : "",
  ].filter((item) => item.length > 0);

  return {
    relativePath: result.relativePath,
    detail: detailParts.join(" | "),
    targetLanguage,
  };
}
