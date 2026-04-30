import { useCallback, useEffect, useRef } from "react";
import { setModelApiKey, updateSettings } from "../../shared/api/settings";
import type { AppSettings, PanelLayoutPrefs } from "../../shared/types/app";
import { DEFAULT_PANEL_LAYOUT, type ThemeMode } from "../app-config";
import { normalizeAgentTeamPrefs } from "../settings/agentTeamDefaults";

type SettingsPersistenceParams = {
  activeProjectId: string | null;
  locale: "en-US" | "zh-CN";
  settings: AppSettings | null;
  draftModelApiKeys: Record<string, string>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  setDraftModelApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setToast: (toast: { type: "info" | "error"; message: string } | null) => void;
  panelLayoutSaveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingPanelLayoutRef: React.MutableRefObject<Partial<PanelLayoutPrefs>>;
  autoSaveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  autoSaveReadyRef: React.MutableRefObject<boolean>;
  lastAutoSavedHashRef: React.MutableRefObject<string | null>;
};

function buildSettingsHash(
  settings: AppSettings,
  activeProjectId: string | null,
  draftModelApiKeys: Record<string, string>,
): string {
  return JSON.stringify({
    settings,
    activeProjectId,
    draftApiKeys: Object.keys(draftModelApiKeys)
      .sort()
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = draftModelApiKeys[key];
        return acc;
      }, {}),
  });
}

export function useSettingsPersistence(params: SettingsPersistenceParams) {
  const {
    activeProjectId,
    locale,
    settings,
    draftModelApiKeys,
    setSettings,
    setDraftModelApiKeys,
    setToast,
    panelLayoutSaveTimerRef,
    pendingPanelLayoutRef,
    autoSaveTimerRef,
    autoSaveReadyRef,
    lastAutoSavedHashRef,
  } = params;

  const settingsRef = useRef<AppSettings | null>(settings);
  const activeProjectIdRef = useRef<string | null>(activeProjectId);
  const draftModelApiKeysRef = useRef<Record<string, string>>(draftModelApiKeys);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    draftModelApiKeysRef.current = draftModelApiKeys;
  }, [draftModelApiKeys]);

  const cancelPendingAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, [autoSaveTimerRef]);

  const persistSettingsInternal = useCallback(
    async (nextSettings: AppSettings, draftApiKeys: Record<string, string>) => {
      const normalizedBackgroundPaths = Array.from(
        new Set(
          (nextSettings.uiPrefs?.backgroundImagePaths ?? [])
            .map((item) => String(item ?? "").trim())
            .filter((item) => item.length > 0),
        ),
      );
      const preferredBackgroundPath = String(nextSettings.uiPrefs?.backgroundImagePath ?? "").trim();
      const normalizedBackgroundPath = preferredBackgroundPath || normalizedBackgroundPaths[0] || "";
      const rawBackgroundBlur = Number(nextSettings.uiPrefs?.backgroundBlurPx ?? 18);
      const normalizedBackgroundBlur = Number.isFinite(rawBackgroundBlur)
        ? Math.max(4, Math.min(32, rawBackgroundBlur))
        : 18;
      const normalizedAnalysisEnvRootsByProject = Object.fromEntries(
        Object.entries(nextSettings.uiPrefs?.analysisEnvRootsByProject ?? {})
          .map(([projectId, rootPath]) => [String(projectId).trim(), String(rootPath ?? "").trim()])
          .filter(([projectId, rootPath]) => projectId.length > 0 && rootPath.length > 0),
      );
      const normalizedLibrarySelectedPathByProject = Object.fromEntries(
        Object.entries(nextSettings.uiPrefs?.librarySelectedPathByProject ?? {})
          .map(([projectId, selectedPath]) => [String(projectId).trim(), String(selectedPath ?? "").trim()])
          .filter(([projectId, selectedPath]) => projectId.length > 0 && selectedPath.length > 0),
      );
      const normalizedLibraryViewModeByProject = Object.fromEntries(
        Object.entries(nextSettings.uiPrefs?.libraryViewModeByProject ?? {})
          .map(([projectId, viewMode]) => [String(projectId).trim(), String(viewMode ?? "").trim()])
          .filter(([projectId, viewMode]) =>
            projectId.length > 0 && (viewMode === "bib" || viewMode === "pdf" || viewMode === "compare"),
          ),
      );
      const normalizeExpandedMap = (value: Record<string, string[]> | undefined) => Object.fromEntries(
        Object.entries(value ?? {})
          .map(([projectId, paths]) => [
            String(projectId).trim(),
            Array.from(new Set(
              (Array.isArray(paths) ? paths : [])
                .map((path) => String(path ?? "").trim().replace(/\\/g, "/"))
                .filter((path) => path.length > 0),
            )),
          ])
          .filter(([projectId]) => String(projectId).length > 0),
      );
      const normalizedWorkspaceExplorerExpandedPathsByProject = normalizeExpandedMap(
        nextSettings.uiPrefs?.workspaceExplorerExpandedPathsByProject,
      );
      const normalizedLibraryExplorerExpandedPathsByProject = normalizeExpandedMap(
        nextSettings.uiPrefs?.libraryExplorerExpandedPathsByProject,
      );
      const hasCustomScrollbarColors = Boolean(
        String(nextSettings.uiPrefs?.scrollbarThumbColor ?? "").trim()
        || String(nextSettings.uiPrefs?.scrollbarTrackColor ?? "").trim(),
      );
      const scrollbarColorMode = nextSettings.uiPrefs?.scrollbarColorMode
        ?? (hasCustomScrollbarColors ? "custom" : "accent");
      const normalizedAgentTeamPrefs = normalizeAgentTeamPrefs(nextSettings.uiPrefs?.agentTeamPrefs);
      const updated = await updateSettings({
        activeProjectId: nextSettings.activeProjectId ?? activeProjectIdRef.current,
        modelProtocols: nextSettings.modelProtocols.map((protocol) => ({
          id: protocol.id,
          displayName: protocol.displayName,
          baseUrl: protocol.baseUrl,
        })),
        modelCatalog: nextSettings.modelCatalog.map((model) => ({
          id: model.id,
          protocolId: model.protocolId,
          displayName: model.displayName,
          requestName: model.requestName,
          capabilities: model.capabilities,
        })),
        agentBindings: nextSettings.agentBindings,
        uiPrefs: {
          language: nextSettings.uiPrefs?.language ?? locale,
          skipDeleteConfirm: nextSettings.uiPrefs?.skipDeleteConfirm ?? false,
          closeToTrayNoticeEnabled: nextSettings.uiPrefs?.closeToTrayNoticeEnabled ?? true,
          closeBehavior: nextSettings.uiPrefs?.closeBehavior ?? "ask",
          closeBehaviorRemember: nextSettings.uiPrefs?.closeBehaviorRemember ?? false,
          theme: (nextSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
          themePreset: nextSettings.uiPrefs?.themePreset ?? "default",
          previewDefaultZoom: nextSettings.uiPrefs?.previewDefaultZoom ?? 1,
          paperBriefEngine: nextSettings.uiPrefs?.paperBriefEngine ?? "auto",
          panelLayout: nextSettings.uiPrefs?.panelLayout,
          featureModelBindings: nextSettings.uiPrefs?.featureModelBindings,
          channels: nextSettings.uiPrefs?.channels,
          backgroundImagePath: normalizedBackgroundPath,
          backgroundImagePaths: normalizedBackgroundPaths,
          backgroundBlurPx: normalizedBackgroundBlur,
          accentColor: nextSettings.uiPrefs?.accentColor ?? "emerald",
          accentCustomColor: nextSettings.uiPrefs?.accentCustomColor ?? "",
          scrollbarColorMode,
          scrollbarWidthPx: nextSettings.uiPrefs?.scrollbarWidthPx ?? 14,
          scrollbarThumbColor: nextSettings.uiPrefs?.scrollbarThumbColor ?? "",
          scrollbarTrackColor: nextSettings.uiPrefs?.scrollbarTrackColor ?? "",
          glassOpacity: nextSettings.uiPrefs?.glassOpacity ?? 0.78,
          glassBlurPx: nextSettings.uiPrefs?.glassBlurPx ?? 18,
          motionLevel: nextSettings.uiPrefs?.motionLevel ?? "full",
          pdfPageGapPx: nextSettings.uiPrefs?.pdfPageGapPx ?? 12,
          logFontSizePx: nextSettings.uiPrefs?.logFontSizePx ?? 12,
          panelRadiusPx: nextSettings.uiPrefs?.panelRadiusPx ?? 8,
          panelBorderContrast: nextSettings.uiPrefs?.panelBorderContrast ?? "normal",
          memoryGuardPrefs: {
            enabled: nextSettings.uiPrefs?.memoryGuardPrefs?.enabled ?? true,
            highWatermarkMb: nextSettings.uiPrefs?.memoryGuardPrefs?.highWatermarkMb ?? 560,
            criticalWatermarkMb: nextSettings.uiPrefs?.memoryGuardPrefs?.criticalWatermarkMb ?? 760,
            sampleIntervalSec: nextSettings.uiPrefs?.memoryGuardPrefs?.sampleIntervalSec ?? 25,
            criticalAction: nextSettings.uiPrefs?.memoryGuardPrefs?.criticalAction ?? "sleep",
          },
          analysisEnvRootsByProject: normalizedAnalysisEnvRootsByProject,
          librarySelectedPathByProject: normalizedLibrarySelectedPathByProject,
          libraryViewModeByProject: normalizedLibraryViewModeByProject,
          workspaceExplorerDefaultExpanded: nextSettings.uiPrefs?.workspaceExplorerDefaultExpanded ?? true,
          libraryExplorerDefaultExpanded: nextSettings.uiPrefs?.libraryExplorerDefaultExpanded ?? true,
          workspaceExplorerExpandedPathsByProject: normalizedWorkspaceExplorerExpandedPathsByProject,
          libraryExplorerExpandedPathsByProject: normalizedLibraryExplorerExpandedPathsByProject,
          agentToolPrefs: {
            webSearchEnabled: nextSettings.uiPrefs?.agentToolPrefs?.webSearchEnabled ?? true,
            workspaceReadEnabled: nextSettings.uiPrefs?.agentToolPrefs?.workspaceReadEnabled ?? true,
            pythonEnabled: nextSettings.uiPrefs?.agentToolPrefs?.pythonEnabled ?? true,
            mcpEnabled: nextSettings.uiPrefs?.agentToolPrefs?.mcpEnabled ?? true,
            writeRequiresConfirmation: nextSettings.uiPrefs?.agentToolPrefs?.writeRequiresConfirmation ?? true,
          },
          agentTeamPrefs: normalizedAgentTeamPrefs,
          mcpServers: (nextSettings.uiPrefs?.mcpServers ?? [])
            .map((server) => ({
              id: String(server.id ?? "").trim(),
              command: String(server.command ?? "").trim(),
              args: Array.isArray(server.args) ? server.args.map((item) => String(item)) : [],
              env: Object.fromEntries(
                Object.entries(server.env ?? {}).map(([key, value]) => [String(key), String(value)]),
              ),
              enabled: server.enabled ?? true,
            }))
            .filter((server) => server.id.length > 0 && server.command.length > 0),
          enabledSkills: Array.from(new Set(
            (nextSettings.uiPrefs?.enabledSkills ?? [])
              .map((skill) => String(skill ?? "").trim())
              .filter((skill) => skill.length > 0),
          )),
        },
      });

      const validModelIds = new Set(nextSettings.modelCatalog.map((item) => item.id));
      const keyEntries = Object.entries(draftApiKeys).filter(([modelId]) =>
        validModelIds.has(modelId),
      );
      if (keyEntries.length > 0) {
        await Promise.all(keyEntries.map(([modelId, apiKey]) => setModelApiKey(modelId, apiKey)));
      }
      setSettings(updated);
      setDraftModelApiKeys({});
      return updated;
    },
    [locale, setDraftModelApiKeys, setSettings],
  );

  const persistSettings = useCallback(
    async (nextSettings: AppSettings) => {
      cancelPendingAutoSave();
      const updated = await persistSettingsInternal(nextSettings, draftModelApiKeysRef.current);
      lastAutoSavedHashRef.current = buildSettingsHash(
        updated,
        updated.activeProjectId ?? activeProjectIdRef.current,
        {},
      );
      return updated;
    },
    [cancelPendingAutoSave, lastAutoSavedHashRef, persistSettingsInternal],
  );

  const savePanelLayout = useCallback(
    (panelKey: keyof PanelLayoutPrefs, layout: number[]) => {
      const expectedLengthMap: Record<keyof PanelLayoutPrefs, number> = {
        shell: 2,
        latex: 3,
        analysis: 2,
        library: 2,
        libraryBib: 2,
        git: 1,
        settings: 1,
      };
      const expectedLength = expectedLengthMap[panelKey];
      const normalizedLayout = layout
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.max(5, Math.min(95, Number(value))));
      if (normalizedLayout.length !== expectedLength) {
        return;
      }
      pendingPanelLayoutRef.current = {
        ...pendingPanelLayoutRef.current,
        [panelKey]: normalizedLayout,
      };

      if (panelLayoutSaveTimerRef.current) {
        clearTimeout(panelLayoutSaveTimerRef.current);
      }
      panelLayoutSaveTimerRef.current = setTimeout(() => {
        const pending = pendingPanelLayoutRef.current;
        pendingPanelLayoutRef.current = {};
        setSettings((prev) => {
          if (!prev || Object.keys(pending).length === 0) {
            return prev;
          }
          return {
            ...prev,
            uiPrefs: {
              ...(prev.uiPrefs ?? {}),
              language: prev.uiPrefs?.language ?? locale,
              panelLayout: {
                ...DEFAULT_PANEL_LAYOUT,
                ...(prev.uiPrefs?.panelLayout ?? {}),
                ...pending,
              },
            },
          };
        });
      }, 240);
    },
    [locale, panelLayoutSaveTimerRef, pendingPanelLayoutRef, setSettings],
  );

  useEffect(() => {
    return () => {
      if (panelLayoutSaveTimerRef.current) {
        clearTimeout(panelLayoutSaveTimerRef.current);
      }
    };
  }, [panelLayoutSaveTimerRef]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [autoSaveTimerRef]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    const hashPayload = buildSettingsHash(settings, activeProjectId, draftModelApiKeys);
    if (!autoSaveReadyRef.current) {
      autoSaveReadyRef.current = true;
      lastAutoSavedHashRef.current = hashPayload;
      return;
    }
    if (hashPayload === lastAutoSavedHashRef.current) {
      return;
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    const scheduledHash = hashPayload;
    autoSaveTimerRef.current = setTimeout(() => {
      const liveSettings = settingsRef.current;
      if (!liveSettings) {
        return;
      }
      const liveActiveProjectId = activeProjectIdRef.current;
      const liveDraftApiKeys = draftModelApiKeysRef.current;
      const liveHash = buildSettingsHash(liveSettings, liveActiveProjectId, liveDraftApiKeys);
      if (liveHash !== scheduledHash) {
        return;
      }
      persistSettingsInternal(liveSettings, liveDraftApiKeys)
        .then((updated) => {
          lastAutoSavedHashRef.current = buildSettingsHash(
            updated,
            updated.activeProjectId ?? activeProjectIdRef.current,
            {},
          );
        })
        .catch((error) => {
          setToast({ type: "error", message: String(error) });
        });
    }, 640);
  }, [
    activeProjectId,
    autoSaveReadyRef,
    autoSaveTimerRef,
    draftModelApiKeys,
    lastAutoSavedHashRef,
    persistSettingsInternal,
    setToast,
    settings,
  ]);

  return {
    persistSettings,
    savePanelLayout,
    cancelPendingAutoSave,
  };
}

