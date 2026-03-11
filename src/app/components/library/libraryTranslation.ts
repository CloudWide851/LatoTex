import { runAgent, writeFile } from "../../../shared/api/desktop";
import type { LibraryCitationSummary } from "../../../shared/types/app";
import { toLibraryWorkspacePath } from "../../../shared/utils/libraryPath";

type TranslationFn = (key: any) => string;

export async function translateLibraryPaper(input: {
  projectId: string;
  selectedPath: string;
  translationModelId?: string | null;
  citation: LibraryCitationSummary | null;
  bibPreview: string;
  t: TranslationFn;
}): Promise<string> {
  const { projectId, selectedPath, translationModelId, citation, bibPreview, t } = input;
  const targetLanguage = t("settings.language.zh-CN").includes("中") ? "中文" : "English";
  const sourceText = bibPreview.trim().length > 0
    ? bibPreview
    : [
      `Title: ${citation?.title ?? "-"}`,
      `Authors: ${(citation?.authors ?? []).join(", ")}`,
      `DOI: ${citation?.doi ?? "-"}`,
      `arXiv: ${citation?.arxivId ?? "-"}`,
      `URLs: ${(citation?.urls ?? []).join(", ")}`,
    ].join("\n");
  const prompt = [
    `Translate the paper metadata/content to ${targetLanguage}.`,
    "Preserve structure and technical terms. If source contains BibTeX style fields, keep key/value shape unchanged.",
    "Return markdown only.",
    "",
    sourceText,
  ].join("\n");
  const result = await runAgent({
    projectId,
    role: "task",
    prompt,
    contextRefs: [`file:${selectedPath}`],
    modelOverride: translationModelId ?? undefined,
  });
  const translated = result.output?.trim();
  if (!translated) {
    throw new Error(t("library.viewer.translateFailed"));
  }
  const basePath = selectedPath.replace(/\.[^/.]+$/, "");
  const targetRelative = `${basePath}.translated.md`;
  await writeFile(projectId, toLibraryWorkspacePath(targetRelative), translated);
  return targetRelative;
}
