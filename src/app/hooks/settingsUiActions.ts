import { busytexCachePrepare, runtimeLogWrite, testModelDraft, testProtocol } from "../../shared/api/desktop";
import type { Dispatch, SetStateAction } from "react";
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

export async function handleBusyTexCachePolicyChangeAction(params: {
  policy: "install-first" | "appdata-only";
  locale: string;
  t: (key: any) => string;
  setBusy: (value: boolean) => void;
  setBusytexCacheInfo: (value: any) => void;
  setSettings: Dispatch<SetStateAction<any>>;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
}) {
  const { policy, locale, t, setBusy, setBusytexCacheInfo, setSettings, setToast } = params;
  setBusy(true);
  try {
    const info = await busytexCachePrepare(policy);
    setBusytexCacheInfo(info);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("latotex.busytex.cachePolicy", info.policy);
      window.localStorage.setItem("latotex.busytex.cacheDir", info.actualDir);
    }
    setSettings((prev: any) =>
      prev
        ? {
            ...prev,
            uiPrefs: {
              ...(prev.uiPrefs ?? {}),
              language: prev.uiPrefs?.language ?? locale,
              busytexCachePolicy: info.policy as "install-first" | "appdata-only",
              busytexCacheDir: info.actualDir,
              panelLayout: prev.uiPrefs?.panelLayout,
              theme: prev.uiPrefs?.theme,
            },
          }
        : prev,
    );
    setToast({ type: "info", message: t("settings.busytexPrepared") });
  } catch (error) {
    setToast({ type: "error", message: String(error) });
  } finally {
    setBusy(false);
  }
}

export async function handleProtocolPingAction(params: {
  protocolId: string;
  baseUrl: string;
  apiKey?: string;
  requestName?: string;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  t: (key: any) => string;
}) {
  const { protocolId, baseUrl, apiKey, requestName, setToast, t } = params;
  const normalizedRequestName = requestName?.trim();
  const normalizedApiKey = apiKey?.trim();
  const result = normalizedRequestName
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
      });
  setToast({
    type: result.ok ? "info" : "error",
    message: result.ok ? t("toast.protocolOk") : t("toast.protocolFail"),
  });
  await runtimeLogWrite(
    result.ok ? "INFO" : "WARN",
    `${normalizedRequestName ? "model draft test" : "protocol test"}: ${protocolId}, ok=${result.ok}, message=${result.message}`,
  );
  return result.ok;
}
