import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { Locale } from "../../i18n";
import { setTrayLabels } from "../../shared/api/app";
import { buildWorkspacePreviewUrl } from "../../shared/utils/workspaceResource";

type TranslationFn = (key: any) => string;

export function useTrayLabelSync(params: {
  isTauriRuntime: boolean;
  locale: Locale;
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
    setPdfUrl(buildWorkspacePreviewUrl(activeProjectId, compiledPdfRelativePath, Date.now()));
  }, [activeProjectId, compiledPdfRelativePath, page, setPdfUrl]);
}
