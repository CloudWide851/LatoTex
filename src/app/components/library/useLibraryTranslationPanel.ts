import { useCallback, useEffect, useMemo, useState } from "react";
import { readFile } from "../../../shared/api/desktop";
import type { LibraryCitationSummary } from "../../../shared/types/app";
import { toLibraryWorkspacePath } from "../../../shared/utils/libraryPath";
import { filenameFromPath } from "./viewerUtils";
import { translateLibraryPaper } from "./libraryTranslation";

type TranslationFn = (key: any) => string;

type TranslationCacheItem = {
  relativePath: string;
  detail: string;
  translatedAt: string;
  title: string;
};

function translationCacheKey(projectId: string, targetLanguage: string): string {
  return `latotex.library.translation.${projectId}.${targetLanguage}`;
}

function translationCacheEntryKey(selectedPath: string): string {
  return selectedPath.trim().toLowerCase();
}

function loadTranslationCache(projectId: string, targetLanguage: string): Record<string, TranslationCacheItem> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(translationCacheKey(projectId, targetLanguage));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, TranslationCacheItem>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveTranslationCache(projectId: string, targetLanguage: string, cache: Record<string, TranslationCacheItem>) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(translationCacheKey(projectId, targetLanguage), JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

export function useLibraryTranslationPanel(params: {
  projectId: string | null;
  selectedPath: string | null;
  targetLanguage: string;
  translationModelId?: string | null;
  citation: LibraryCitationSummary | null;
  bibPreview: string;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, targetLanguage, translationModelId, citation, bibPreview, t } = params;
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationNotice, setTranslationNotice] = useState<{ type: "info" | "error"; message: string } | null>(null);
  const [translationDetail, setTranslationDetail] = useState("");
  const [translatedRelativePath, setTranslatedRelativePath] = useState<string | null>(null);
  const [translatedContent, setTranslatedContent] = useState("");

  const hasTranslated = useMemo(() => translatedContent.trim().length > 0, [translatedContent]);

  useEffect(() => {
    if (!translationNotice) {
      return;
    }
    const timer = window.setTimeout(() => setTranslationNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [translationNotice]);

  const resetTranslationState = useCallback(() => {
    setTranslatedRelativePath(null);
    setTranslatedContent("");
    setTranslationDetail("");
    setTranslationBusy(false);
  }, []);

  const loadTranslatedFromCache = useCallback(async () => {
    if (!projectId || !selectedPath) {
      setTranslatedRelativePath(null);
      setTranslatedContent("");
      setTranslationDetail("");
      return;
    }
    const cache = loadTranslationCache(projectId, targetLanguage);
    const key = translationCacheEntryKey(selectedPath);
    const entry = cache[key];
    if (!entry?.relativePath) {
      setTranslatedRelativePath(null);
      setTranslatedContent("");
      setTranslationDetail("");
      return;
    }
    try {
      const loaded = await readFile(projectId, toLibraryWorkspacePath(entry.relativePath));
      setTranslatedRelativePath(entry.relativePath);
      setTranslatedContent(loaded.content);
      setTranslationDetail(entry.detail || "");
    } catch {
      setTranslatedRelativePath(null);
      setTranslatedContent("");
      setTranslationDetail("");
    }
  }, [projectId, selectedPath, targetLanguage]);

  const runTranslation = useCallback((onDone?: () => void, forceRetranslate = false) => {
    if (!projectId || !selectedPath || translationBusy) {
      return;
    }
    setTranslationBusy(true);

    window.setTimeout(() => {
      void (async () => {
        try {
          const cache = loadTranslationCache(projectId, targetLanguage);
          const cacheKey = translationCacheEntryKey(selectedPath);
          if (!forceRetranslate && cache[cacheKey]?.relativePath) {
            const cached = cache[cacheKey]!;
            const loaded = await readFile(projectId, toLibraryWorkspacePath(cached.relativePath));
            setTranslatedRelativePath(cached.relativePath);
            setTranslatedContent(loaded.content);
            setTranslationDetail(cached.detail || "");
            setTranslationNotice({
              type: "info",
              message: `${cached.title || filenameFromPath(selectedPath)} ${t("library.viewer.translateSaved")}`,
            });
            onDone?.();
            return;
          }

          const result = await translateLibraryPaper({
            projectId,
            selectedPath,
            translationModelId,
            citation,
            bibPreview,
            t,
          });

          const loaded = await readFile(projectId, toLibraryWorkspacePath(result.relativePath));
          const title = citation?.title?.trim() || filenameFromPath(selectedPath);
          const nextCache = {
            ...cache,
            [cacheKey]: {
              relativePath: result.relativePath,
              detail: result.detail,
              translatedAt: new Date().toISOString(),
              title,
            },
          };
          saveTranslationCache(projectId, targetLanguage, nextCache);

          setTranslatedRelativePath(result.relativePath);
          setTranslatedContent(loaded.content);
          setTranslationDetail(result.detail);
          setTranslationNotice({ type: "info", message: `${title} ${t("library.viewer.translateSaved")}` });
          onDone?.();
        } catch (error) {
          const message = String(error);
          setTranslationNotice({ type: "error", message });
        } finally {
          setTranslationBusy(false);
        }
      })();
    }, 0);
  }, [bibPreview, citation, projectId, selectedPath, t, targetLanguage, translationBusy, translationModelId]);

  return {
    translationBusy,
    translationNotice,
    translationDetail,
    translatedRelativePath,
    translatedContent,
    hasTranslated,
    setTranslationNotice,
    resetTranslationState,
    loadTranslatedFromCache,
    runTranslation,
  };
}
