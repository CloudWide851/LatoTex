import { type Dispatch, type SetStateAction, useEffect } from "react";
import { setTrayLabels } from "../../shared/api/app";

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
  setPdfUrl: Dispatch<SetStateAction<string | null>>;
  setPreferCompiledPreview: Dispatch<SetStateAction<boolean>>;
}) {
  const { activeProjectId, setPdfUrl, setPreferCompiledPreview } = params;
  useEffect(() => {
    setPdfUrl((prev) => {
      if (prev?.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setPreferCompiledPreview(false);
  }, [activeProjectId, setPdfUrl, setPreferCompiledPreview]);
}
