import { useEffect } from "react";
import type { AppSettings } from "../../shared/types/app";
import { resolveAppAppearance } from "../appearance/appAppearance";
import { useBackgroundImageObjectUrl } from "./useBackgroundImageObjectUrl";

export function useAppAppearance(settings: AppSettings | null) {
  const initial = resolveAppAppearance(settings?.uiPrefs);
  const backgroundUrl = useBackgroundImageObjectUrl(initial.backgroundPath);
  const appearance = resolveAppAppearance(settings?.uiPrefs, backgroundUrl);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    root.style.setProperty("--app-font-scale", String(appearance.fontScale));
    return () => {
      root.style.removeProperty("--app-font-scale");
    };
  }, [appearance.fontScale]);

  return {
    ...appearance,
    backgroundUrl,
  };
}
