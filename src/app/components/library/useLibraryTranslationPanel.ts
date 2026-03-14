import { useCallback, useEffect, useMemo, useState } from "react";
import { libraryResolvePdfPreview } from "../../../shared/api/desktop";
import { translateLibraryPaper } from "./libraryTranslation";

type TranslationFn = (key: any) => string;

export function useLibraryTranslationPanel(params: {
  projectId: string | null;
  selectedPath: string | null;
  translationModelId?: string | null;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, translationModelId, t } = params;
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationNotice, setTranslationNotice] = useState<{ type: "info" | "error"; message: string } | null>(null);
  const [translationDetail, setTranslationDetail] = useState("");
  const [sourcePdfRelativePath, setSourcePdfRelativePath] = useState<string | null>(null);
  const [translatedPdfRelativePath, setTranslatedPdfRelativePath] = useState<string | null>(null);

  const hasTranslated = useMemo(
    () => Boolean(translatedPdfRelativePath && translatedPdfRelativePath.trim().length > 0),
    [translatedPdfRelativePath],
  );

  useEffect(() => {
    if (!translationNotice) {
      return;
    }
    const timer = window.setTimeout(() => setTranslationNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [translationNotice]);

  const resetTranslationState = useCallback(() => {
    setSourcePdfRelativePath(null);
    setTranslatedPdfRelativePath(null);
    setTranslationDetail("");
    setTranslationBusy(false);
  }, []);

  const loadTranslatedFromCache = useCallback(async () => {
    if (!projectId || !selectedPath) {
      setSourcePdfRelativePath(null);
      setTranslatedPdfRelativePath(null);
      setTranslationDetail("");
      return;
    }
    try {
      const preview = await libraryResolvePdfPreview(projectId, selectedPath);
      setSourcePdfRelativePath(preview.relativePath ?? null);
      setTranslatedPdfRelativePath(preview.translatedRelativePath ?? null);
      if (!preview.translatedRelativePath) {
        setTranslationDetail("");
      }
    } catch {
      setSourcePdfRelativePath(null);
      setTranslatedPdfRelativePath(null);
      setTranslationDetail("");
    }
  }, [projectId, selectedPath]);

  const runTranslation = useCallback((onDone?: () => void) => {
    if (!projectId || !selectedPath || translationBusy) {
      return;
    }
    setTranslationBusy(true);

    void (async () => {
      try {
        const result = await translateLibraryPaper({
          projectId,
          selectedPath,
          translationModelId,
          t,
        });

        setSourcePdfRelativePath(result.sourcePdfRelativePath);
        setTranslatedPdfRelativePath(result.translatedPdfRelativePath);
        setTranslationDetail(result.detail);
        setTranslationNotice({ type: "info", message: t("library.viewer.translateSaved") });
        onDone?.();
      } catch (error) {
        const message = String(error);
        setTranslationNotice({ type: "error", message });
      } finally {
        setTranslationBusy(false);
      }
    })();
  }, [projectId, selectedPath, t, translationBusy, translationModelId]);

  return {
    translationBusy,
    translationNotice,
    translationDetail,
    sourcePdfRelativePath,
    translatedPdfRelativePath,
    hasTranslated,
    setTranslationNotice,
    resetTranslationState,
    loadTranslatedFromCache,
    runTranslation,
  };
}
