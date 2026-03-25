import { runtimeLogWrite } from "../../shared/api/runtime";
import { testModelDraft, testProtocol } from "../../shared/api/settings";
import type { Dispatch, SetStateAction } from "react";
import type { ModelTestResult } from "../../shared/types/app";
import { applyTheme, resolveTheme, THEME_TRANSITION_MS, type ThemeMode } from "../app-config";

export function handleThemeModeChangeAction(params: {
  currentTheme: ThemeMode;
  nextTheme: ThemeMode;
  locale: string;
  event?: { clientX: number; clientY: number };
  setSettings: Dispatch<SetStateAction<any>>;
  setThemeTransition: Dispatch<SetStateAction<any>>;
}) {
  const { currentTheme, nextTheme, locale, event, setSettings, setThemeTransition } = params;
  if (resolveTheme(currentTheme) === resolveTheme(nextTheme)) {
    return;
  }
  const originX = event?.clientX ?? window.innerWidth / 2;
  const originY = event?.clientY ?? window.innerHeight / 2;
  const radius = Math.hypot(
    Math.max(originX, window.innerWidth - originX),
    Math.max(originY, window.innerHeight - originY),
  );
  const target = resolveTheme(nextTheme);

  setSettings((prev: any) =>
    prev
      ? {
          ...prev,
          uiPrefs: {
            ...(prev.uiPrefs ?? {}),
            language: prev.uiPrefs?.language ?? locale,
            theme: nextTheme,
            panelLayout: prev.uiPrefs?.panelLayout,
          },
        }
      : prev,
  );

  if (typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setThemeTransition({
      x: originX,
      y: originY,
      radius,
      target,
      active: false,
    });
    requestAnimationFrame(() => {
      setThemeTransition((prev: any) => (prev ? { ...prev, active: true } : prev));
    });
    window.setTimeout(() => applyTheme(nextTheme), 140);
    window.setTimeout(() => setThemeTransition(null), THEME_TRANSITION_MS);
    return;
  }

  applyTheme(nextTheme);
}

export async function handleProtocolPingAction(params: {
  protocolId: string;
  baseUrl: string;
  apiKey?: string;
  requestName?: string;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  t: (key: any) => string;
}): Promise<ModelTestResult> {
  const { protocolId, baseUrl, apiKey, requestName, setToast, t } = params;
  const normalizedRequestName = requestName?.trim();
  const normalizedApiKey = apiKey?.trim();
  const result: ModelTestResult = normalizedRequestName
    ? await testModelDraft({
        protocolId,
        baseUrl,
        requestName: normalizedRequestName,
        apiKey: normalizedApiKey ?? "",
      })
    : await testProtocol({
        protocolId,
        baseUrl,
        apiKey: normalizedApiKey,
      }).then((res) => ({
        modelId: normalizedRequestName ?? protocolId,
        ok: res.ok,
        message: res.message,
      }));
  setToast({
    type: result.ok ? "info" : "error",
    message: result.message || (result.ok ? t("toast.protocolOk") : t("toast.protocolFail")),
  });
  await runtimeLogWrite(
    result.ok ? "INFO" : "WARN",
    `${normalizedRequestName ? "model draft test" : "protocol test"}: ${protocolId}, ok=${result.ok}, message=${result.message}`,
  );
  return result;
}

