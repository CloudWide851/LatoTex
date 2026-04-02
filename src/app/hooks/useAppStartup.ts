import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { resolveLocale } from "../../i18n";
import { getHealthCheck, windowSyncIcon } from "../../shared/api/app";
import { listProjects } from "../../shared/api/projects";
import { runtimeLogInfo, runtimeLogWrite } from "../../shared/api/runtime";
import { getSettings } from "../../shared/api/settings";
import type { AppSettings, ProjectSummary } from "../../shared/types/app";
import {
  applyTheme,
  DEFAULT_PANEL_LAYOUT,
  normalizeAgentBindings,
  type ThemeMode,
} from "../app-config";

type TranslationFn = (...args: any[]) => string;
type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;
type SetLocale = (value: "en-US" | "zh-CN") => void;

type LoadProjectData = (
  projectId: string,
  options?: { includeGitRefresh?: boolean },
) => Promise<void>;

function normalizeSettings(appSettings: AppSettings): AppSettings {
  const backgroundList = Array.from(
    new Set(
      (appSettings.uiPrefs?.backgroundImagePaths ?? [])
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0),
    ),
  );
  const legacyBackground = String(appSettings.uiPrefs?.backgroundImagePath ?? "").trim();
  if (legacyBackground && !backgroundList.includes(legacyBackground)) {
    backgroundList.unshift(legacyBackground);
  }
  const activeBackgroundPath = legacyBackground || backgroundList[0] || "";
  const rawBackgroundBlur = Number(appSettings.uiPrefs?.backgroundBlurPx ?? 18);
  const normalizedBackgroundBlur = Number.isFinite(rawBackgroundBlur)
    ? Math.max(4, Math.min(32, rawBackgroundBlur))
    : 18;
  return {
    ...appSettings,
    agentBindings: normalizeAgentBindings(appSettings.agentBindings ?? []),
    uiPrefs: {
      ...(appSettings.uiPrefs ?? {}),
      closeToTrayNoticeEnabled: appSettings.uiPrefs?.closeToTrayNoticeEnabled ?? true,
      closeBehavior: appSettings.uiPrefs?.closeBehavior ?? "ask",
      closeBehaviorRemember: appSettings.uiPrefs?.closeBehaviorRemember ?? false,
      theme: (appSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
      previewDefaultZoom: appSettings.uiPrefs?.previewDefaultZoom ?? 1,
      backgroundImagePath: activeBackgroundPath,
      backgroundImagePaths: backgroundList,
      backgroundBlurPx: normalizedBackgroundBlur,
      panelLayout: {
        ...DEFAULT_PANEL_LAYOUT,
        ...(appSettings.uiPrefs?.panelLayout ?? {}),
      },
    },
  };
}

function resolveInitialProjectId(
  projectList: ProjectSummary[],
  settings: AppSettings,
): string | null {
  const newWindowMode =
    typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("newWindow") === "1";
  if (newWindowMode) {
    return null;
  }
  const requested = String(settings.activeProjectId ?? "").trim();
  if (requested && projectList.some((item) => item.id === requested)) {
    return requested;
  }
  return projectList[0]?.id ?? null;
}

export function useAppStartup(params: {
  isTauriRuntime: boolean;
  loadProjectData: LoadProjectData;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  settingsRef: MutableRefObject<AppSettings | null>;
  setStatus: (value: "ready" | "offline") => void;
  setProjects: (value: ProjectSummary[]) => void;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  setRuntimeInfo: (value: any) => void;
  setLocale: SetLocale;
  setActiveProjectId: (value: string | null) => void;
  setToast: ToastSetter;
  t: TranslationFn;
}) {
  const {
    isTauriRuntime,
    loadProjectData,
    refreshGitWorkspace,
    settingsRef,
    setStatus,
    setProjects,
    setSettings,
    setRuntimeInfo,
    setLocale,
    setActiveProjectId,
    setToast,
    t,
  } = params;
  const mountedRef = useRef(true);
  const startedRef = useRef(false);
  const [startupReady, setStartupReady] = useState(false);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const bootstrap = async () => {
      try {
        try {
          await getHealthCheck();
          if (mountedRef.current) {
            setStatus("ready");
          }
        } catch {
          if (mountedRef.current) {
            setStatus("offline");
          }
        }

        if (isTauriRuntime) {
          await windowSyncIcon().catch(() => undefined);
        }

        const [projectList, appSettings, info] = await Promise.all([
          listProjects(),
          getSettings(),
          runtimeLogInfo(),
        ]);
        if (!mountedRef.current) {
          return;
        }

        setProjects(projectList);
        const normalizedSettings = normalizeSettings(appSettings);
        settingsRef.current = normalizedSettings;
        setSettings(normalizedSettings);
        setRuntimeInfo(info);

        const initialLocale = resolveLocale(
          normalizedSettings.uiPrefs?.language
            ?? (typeof window !== "undefined" ? window.localStorage.getItem("latotex.locale") : null),
        );
        setLocale(initialLocale);
        if (typeof window !== "undefined") {
          window.localStorage.setItem("latotex.locale", initialLocale);
        }

        applyTheme((normalizedSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system");
        const targetProjectId = resolveInitialProjectId(projectList, normalizedSettings);
        setActiveProjectId(targetProjectId);

        await runtimeLogWrite(
          "INFO",
          `frontend bootstrap completed, project=${targetProjectId ?? "-"}, installMode=${info.installMode}, version=${info.version}`,
        ).catch(() => undefined);

        if (!targetProjectId) {
          return;
        }

        try {
          await loadProjectData(targetProjectId, { includeGitRefresh: false });
          if (!mountedRef.current) {
            return;
          }
          await refreshGitWorkspace(targetProjectId);
        } catch (error) {
          if (!mountedRef.current) {
            return;
          }
          const message = String(error || t("common.loading"));
          setToast({ type: "error", message });
          await runtimeLogWrite(
            "ERROR",
            `frontend bootstrap project load failed, project=${targetProjectId}, reason=${message}`,
          ).catch(() => undefined);
        }
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }
        const message = String(error || "startup.failed");
        setToast({ type: "error", message });
        await runtimeLogWrite("ERROR", `frontend bootstrap failed: ${message}`).catch(() => undefined);
      } finally {
        if (mountedRef.current) {
          setStartupReady(true);
        }
      }
    };

    void bootstrap();
  }, [
    isTauriRuntime,
    loadProjectData,
    refreshGitWorkspace,
    setActiveProjectId,
    setLocale,
    setProjects,
    setRuntimeInfo,
    setSettings,
    setStatus,
    setToast,
    settingsRef,
    t,
  ]);

  return {
    startupReady,
  };
}
