import { type Dispatch, type SetStateAction, useEffect } from "react";
import { setTrayLabels } from "../../shared/api/app";
import { resolveReachableWorkspacePreviewUrl } from "../../shared/utils/workspacePreview";

type TranslationFn = (key: any) => string;

export function useTrayLabelSync(params: {
  isTauriRuntime: boolean;
  locale: "zh-CN" | "en-US";
  t: TranslationFn;
}) {
  const { isTauriRuntime, locale, t } = params;
  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }
    setTrayLabels(t("tray.showMain"), t("tray.exit"), t("tray.tooltip")).catch(() => undefined);
  }, [isTauriRuntime, locale, t]);
}

export function useCompiledPreviewResetOnProjectChange(params: {
  activeProjectId: string | null;
  page: string;
  compiledPdfRelativePath: string | null;
  setPdfUrl: Dispatch<SetStateAction<string | null>>;
  setCompiledPdfRelativePath: Dispatch<SetStateAction<string | null>>;
  setPreferCompiledPreview: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    activeProjectId,
    page,
    compiledPdfRelativePath,
    setPdfUrl,
    setCompiledPdfRelativePath,
    setPreferCompiledPreview,
  } = params;

  useEffect(() => {
    setPdfUrl((prev) => {
      if (prev?.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setCompiledPdfRelativePath(null);
    setPreferCompiledPreview(false);
  }, [activeProjectId, setCompiledPdfRelativePath, setPdfUrl, setPreferCompiledPreview]);

  useEffect(() => {
    if (!activeProjectId || !compiledPdfRelativePath || page !== "latex") {
      return;
    }
    let cancelled = false;
    void resolveReachableWorkspacePreviewUrl({
      projectId: activeProjectId,
      relativePath: compiledPdfRelativePath,
      cacheKey: Date.now(),
    }).then((resolved) => {
      if (!cancelled) {
        setPdfUrl(resolved.url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, compiledPdfRelativePath, page, setPdfUrl]);
}
