import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { libraryResolvePdfPreview } from "../../../shared/api/desktop";
import {
  ensureTranslationResult,
  queryLibraryTranslationTask,
  startLibraryTranslationTask,
} from "./libraryTranslation";

type TranslationFn = (key: any) => string;

export type LibraryTranslationProgress = {
  taskId: string;
  status: string;
  currentPage: number;
  totalPages: number;
  message: string;
};

const POLL_INTERVAL_MS = 900;
const MAX_POLL_ROUNDS = 800;

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
  const [translationProgress, setTranslationProgress] = useState<LibraryTranslationProgress | null>(null);
  const [sourcePdfRelativePath, setSourcePdfRelativePath] = useState<string | null>(null);
  const [translatedPdfRelativePath, setTranslatedPdfRelativePath] = useState<string | null>(null);
  const runTokenRef = useRef(0);

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

  useEffect(() => () => {
    runTokenRef.current += 1;
  }, []);

  const resetTranslationState = useCallback(() => {
    runTokenRef.current += 1;
    setSourcePdfRelativePath(null);
    setTranslatedPdfRelativePath(null);
    setTranslationDetail("");
    setTranslationProgress(null);
    setTranslationBusy(false);
  }, []);

  const loadTranslatedFromCache = useCallback(async () => {
    if (!projectId || !selectedPath) {
      setSourcePdfRelativePath(null);
      setTranslatedPdfRelativePath(null);
      setTranslationDetail("");
      setTranslationProgress(null);
      return;
    }
    try {
      const preview = await libraryResolvePdfPreview(projectId, selectedPath);
      setSourcePdfRelativePath(preview.relativePath ?? null);
      setTranslatedPdfRelativePath(preview.translatedRelativePath ?? null);
      if (!preview.translatedRelativePath) {
        setTranslationDetail("");
      }
      setTranslationProgress(null);
    } catch {
      setSourcePdfRelativePath(null);
      setTranslatedPdfRelativePath(null);
      setTranslationDetail("");
      setTranslationProgress(null);
    }
  }, [projectId, selectedPath]);

  const runTranslation = useCallback((onDone?: () => void) => {
    if (!projectId || !selectedPath || translationBusy) {
      return;
    }

    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;
    setTranslationBusy(true);

    void (async () => {
      try {
        const started = await startLibraryTranslationTask({
          projectId,
          selectedPath,
          translationModelId,
          t,
        });

        if (!started.taskId) {
          throw new Error(t("library.viewer.translateFailed"));
        }

        setTranslationProgress({
          taskId: started.taskId,
          status: "running",
          currentPage: 0,
          totalPages: 0,
          message: "queued",
        });

        for (let round = 0; round < MAX_POLL_ROUNDS; round += 1) {
          if (runTokenRef.current !== runToken) {
            return;
          }

          const status = await queryLibraryTranslationTask(started.taskId);
          if (runTokenRef.current !== runToken) {
            return;
          }

          setTranslationProgress({
            taskId: started.taskId,
            status: String(status.status || "running"),
            currentPage: Number(status.currentPage || 0),
            totalPages: Number(status.totalPages || 0),
            message: String(status.message || "running"),
          });

          if (status.status === "completed") {
            const parsed = ensureTranslationResult(status.result, t);
            setSourcePdfRelativePath(parsed.sourcePdfRelativePath);
            setTranslatedPdfRelativePath(parsed.translatedPdfRelativePath);
            setTranslationDetail(parsed.detail);
            setTranslationNotice({ type: "info", message: t("library.viewer.translateSaved") });
            onDone?.();
            return;
          }

          if (status.status === "failed") {
            throw new Error(String(status.error || t("library.viewer.translateFailed")));
          }

          await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
        }

        throw new Error(t("library.viewer.translateTimeout"));
      } catch (error) {
        if (runTokenRef.current !== runToken) {
          return;
        }
        const message = String(error);
        setTranslationNotice({ type: "error", message });
      } finally {
        if (runTokenRef.current === runToken) {
          setTranslationBusy(false);
        }
      }
    })();
  }, [projectId, selectedPath, t, translationBusy, translationModelId]);

  return {
    translationBusy,
    translationNotice,
    translationDetail,
    translationProgress,
    sourcePdfRelativePath,
    translatedPdfRelativePath,
    hasTranslated,
    setTranslationNotice,
    resetTranslationState,
    loadTranslatedFromCache,
    runTranslation,
  };
}

