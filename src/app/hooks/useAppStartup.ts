import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { resolveLocale } from "../../i18n";
import type { Locale } from "../../i18n";
import { getHealthCheck, windowSyncIcon } from "../../shared/api/app";
import { resumeLibraryPdfDownloads } from "../../shared/api/library";
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
type SetLocale = (value: Locale) => void;

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
  const activeBackgroundPath = legacyBackground && backgroundList.includes(legacyBackground)
    ? legacyBackground
    : "";
  const rawBackgroundBlur = Number(appSettings.uiPrefs?.backgroundBlurPx ?? 18);
  const normalizedBackgroundBlur = Number.isFinite(rawBackgroundBlur)
    ? Math.max(4, Math.min(32, rawBackgroundBlur))
    : 18;
  const backgroundCropByPath = Object.fromEntries(
    Object.entries(appSettings.uiPrefs?.backgroundCropByPath ?? {})
      .map(([path, rect]) => {
        const key = String(path ?? "").trim();
        const x = Math.max(0, Math.min(1, Number(rect?.x ?? 0)));
        const y = Math.max(0, Math.min(1, Number(rect?.y ?? 0)));
        const width = Math.max(0.05, Math.min(1 - x, Number(rect?.width ?? 1)));
        const height = Math.max(0.05, Math.min(1 - y, Number(rect?.height ?? 1)));
        return [key, { x, y, width, height }];
      })
      .filter(([path]) => String(path).length > 0 && backgroundList.includes(String(path))),
  );
  const editorBackgroundColor = String(appSettings.uiPrefs?.editorBackgroundColor ?? "").trim();
  const pluginCatalogSources = (appSettings.uiPrefs?.pluginCatalogSources ?? [])
    .map((source, index) => ({
      id: String(source.id || `catalog-${index + 1}`).trim(),
      name: String(source.name || source.id || `Catalog ${index + 1}`).trim(),
      url: String(source.url ?? "").trim(),
      enabled: source.enabled ?? true,
    }))
    .filter((source) => source.id.length > 0 && source.url.length > 0);
  return {
    ...appSettings,
    agentBindings: normalizeAgentBindings(appSettings.agentBindings ?? []),
    uiPrefs: {
      ...(appSettings.uiPrefs ?? {}),
      closeToTrayNoticeEnabled: appSettings.uiPrefs?.closeToTrayNoticeEnabled ?? true,
      closeBehavior: appSettings.uiPrefs?.closeBehavior ?? "ask",
      closeBehaviorRemember: appSettings.uiPrefs?.closeBehaviorRemember ?? false,
      theme: (appSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
      themePreset: appSettings.uiPrefs?.themePreset ?? "default",
      previewDefaultZoom: appSettings.uiPrefs?.previewDefaultZoom ?? 1,
      paperBriefEngine: appSettings.uiPrefs?.paperBriefEngine ?? "auto",
      workspaceExplorerDefaultExpanded: appSettings.uiPrefs?.workspaceExplorerDefaultExpanded ?? true,
      libraryExplorerDefaultExpanded: appSettings.uiPrefs?.libraryExplorerDefaultExpanded ?? true,
      workspaceExplorerExpandedPathsByProject: appSettings.uiPrefs?.workspaceExplorerExpandedPathsByProject ?? {},
      libraryExplorerExpandedPathsByProject: appSettings.uiPrefs?.libraryExplorerExpandedPathsByProject ?? {},
      agentToolPrefs: {
        webSearchEnabled: appSettings.uiPrefs?.agentToolPrefs?.webSearchEnabled ?? true,
        workspaceReadEnabled: appSettings.uiPrefs?.agentToolPrefs?.workspaceReadEnabled ?? true,
        pythonEnabled: appSettings.uiPrefs?.agentToolPrefs?.pythonEnabled ?? true,
        mcpEnabled: appSettings.uiPrefs?.agentToolPrefs?.mcpEnabled ?? true,
        writeRequiresConfirmation: appSettings.uiPrefs?.agentToolPrefs?.writeRequiresConfirmation ?? true,
      },
      agentPermissionPrefs: {
        webSearch: appSettings.uiPrefs?.agentPermissionPrefs?.webSearch ?? "allow",
        workspaceRead: appSettings.uiPrefs?.agentPermissionPrefs?.workspaceRead ?? "allow",
        python: appSettings.uiPrefs?.agentPermissionPrefs?.python ?? "ask",
        mcp: appSettings.uiPrefs?.agentPermissionPrefs?.mcp ?? "ask",
        skills: appSettings.uiPrefs?.agentPermissionPrefs?.skills ?? "allow",
        pluginCommands: appSettings.uiPrefs?.agentPermissionPrefs?.pluginCommands ?? "ask",
        nonLatexWrites: appSettings.uiPrefs?.agentPermissionPrefs?.nonLatexWrites ?? "ask",
        mcpServerModes: appSettings.uiPrefs?.agentPermissionPrefs?.mcpServerModes ?? {},
        pluginModes: appSettings.uiPrefs?.agentPermissionPrefs?.pluginModes ?? {},
      },
      pluginCatalogSources,
      docxAutoSaveEnabled: appSettings.uiPrefs?.docxAutoSaveEnabled ?? false,
      mcpServers: appSettings.uiPrefs?.mcpServers ?? [],
      enabledSkills: appSettings.uiPrefs?.enabledSkills ?? [],
      hiddenSkills: appSettings.uiPrefs?.hiddenSkills ?? [],
      backgroundImagePath: activeBackgroundPath,
      backgroundImagePaths: backgroundList,
      backgroundBlurPx: normalizedBackgroundBlur,
      backgroundCropByPath,
      editorBackgroundColor: /^#[0-9a-f]{6}$/i.test(editorBackgroundColor) ? editorBackgroundColor : "",
      accentColor: appSettings.uiPrefs?.accentColor ?? "emerald",
      accentCustomColor: appSettings.uiPrefs?.accentCustomColor ?? "",
      scrollbarWidthPx: appSettings.uiPrefs?.scrollbarWidthPx ?? 14,
      scrollbarThumbColor: appSettings.uiPrefs?.scrollbarThumbColor ?? "",
      scrollbarTrackColor: appSettings.uiPrefs?.scrollbarTrackColor ?? "",
      glassOpacity: appSettings.uiPrefs?.glassOpacity ?? 0.78,
      glassBlurPx: appSettings.uiPrefs?.glassBlurPx ?? 18,
      motionLevel: appSettings.uiPrefs?.motionLevel ?? "full",
      fontScale: appSettings.uiPrefs?.fontScale ?? 1,
      pdfPageGapPx: appSettings.uiPrefs?.pdfPageGapPx ?? 12,
      logFontSizePx: appSettings.uiPrefs?.logFontSizePx ?? 12,
      panelRadiusPx: appSettings.uiPrefs?.panelRadiusPx ?? 8,
      panelBorderContrast: appSettings.uiPrefs?.panelBorderContrast ?? "normal",
      memoryGuardPrefs: {
        enabled: appSettings.uiPrefs?.memoryGuardPrefs?.enabled ?? true,
        highWatermarkMb: appSettings.uiPrefs?.memoryGuardPrefs?.highWatermarkMb ?? 560,
        criticalWatermarkMb: appSettings.uiPrefs?.memoryGuardPrefs?.criticalWatermarkMb ?? 760,
        sampleIntervalSec: appSettings.uiPrefs?.memoryGuardPrefs?.sampleIntervalSec ?? 25,
        criticalAction: appSettings.uiPrefs?.memoryGuardPrefs?.criticalAction ?? "sleep",
      },
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
      let targetProjectId: string | null = null;
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
        const [projectList, appSettings] = await Promise.all([
          listProjects(),
          getSettings(),
        ]);
        if (!mountedRef.current) {
          return;
        }

        setProjects(projectList);
        const normalizedSettings = normalizeSettings(appSettings);
        settingsRef.current = normalizedSettings;
        setSettings(normalizedSettings);

        const initialLocale = resolveLocale(
          normalizedSettings.uiPrefs?.language
            ?? (typeof window !== "undefined" ? window.localStorage.getItem("latotex.locale") : null),
        );
        setLocale(initialLocale);
        if (typeof window !== "undefined") {
          window.localStorage.setItem("latotex.locale", initialLocale);
        }

        applyTheme((normalizedSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system");
        targetProjectId = resolveInitialProjectId(projectList, normalizedSettings);
        setActiveProjectId(targetProjectId);
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

      if (isTauriRuntime) {
        void windowSyncIcon().catch(() => undefined);
      }

      void runtimeLogInfo()
        .then((info) => {
          if (!mountedRef.current) {
            return;
          }
          setRuntimeInfo(info);
          return runtimeLogWrite(
            "INFO",
            `frontend bootstrap completed, project=${targetProjectId ?? "-"}, installMode=${info.installMode}, version=${info.version}`,
          ).catch(() => undefined);
        })
        .catch((error) => runtimeLogWrite(
          "ERROR",
          `frontend bootstrap runtime info failed: ${String(error)}`,
        ))
        .catch(() => undefined);

      if (targetProjectId) {
        void resumeLibraryPdfDownloads(targetProjectId)
          .then((result) => runtimeLogWrite(
            "INFO",
            `frontend startup resumed library pdf downloads, project=${targetProjectId}, queued=${result.queued}, skipped=${result.skipped}, failed=${result.failed}`,
          ))
          .catch((error) => runtimeLogWrite(
            "ERROR",
            `frontend startup resume library pdf downloads failed, project=${targetProjectId}, reason=${String(error)}`,
          ))
          .catch(() => undefined);
      }
    };

    void bootstrap();
  }, [
    isTauriRuntime,
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
