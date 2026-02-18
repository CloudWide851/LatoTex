import { useCallback, useEffect } from "react";
import { setModelApiKey, updateSettings } from "../../shared/api/desktop";
import type { AppSettings, PanelLayoutPrefs } from "../../shared/types/app";
import { DEFAULT_PANEL_LAYOUT, type ThemeMode } from "../app-config";

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

  const persistSettings = useCallback(
    async (nextSettings: AppSettings) => {
      const updated = await updateSettings({
        activeProjectId: nextSettings.activeProjectId ?? activeProjectId,
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
        })),
        agentBindings: nextSettings.agentBindings,
        uiPrefs: {
          language: nextSettings.uiPrefs?.language ?? locale,
          skipDeleteConfirm: nextSettings.uiPrefs?.skipDeleteConfirm ?? false,
          closeToTrayNoticeEnabled: nextSettings.uiPrefs?.closeToTrayNoticeEnabled ?? true,
          theme: (nextSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
          busytexCachePolicy: nextSettings.uiPrefs?.busytexCachePolicy ?? "install-first",
          busytexCacheDir: nextSettings.uiPrefs?.busytexCacheDir,
          previewDefaultZoom: nextSettings.uiPrefs?.previewDefaultZoom ?? 1,
          panelLayout: nextSettings.uiPrefs?.panelLayout,
        },
      });

      const validModelIds = new Set(nextSettings.modelCatalog.map((item) => item.id));
      const keyEntries = Object.entries(draftModelApiKeys).filter(([modelId]) =>
        validModelIds.has(modelId),
      );
      if (keyEntries.length > 0) {
        await Promise.all(keyEntries.map(([modelId, apiKey]) => setModelApiKey(modelId, apiKey)));
      }
      setSettings(updated);
      setDraftModelApiKeys({});
      return updated;
    },
    [activeProjectId, draftModelApiKeys, locale, setDraftModelApiKeys, setSettings],
  );

  const savePanelLayout = useCallback(
    (panelKey: keyof PanelLayoutPrefs, layout: number[]) => {
      const expectedLengthMap: Record<keyof PanelLayoutPrefs, number> = {
        shell: 2,
        latex: 3,
        analysis: 2,
        library: 2,
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
    const hashPayload = JSON.stringify({
      settings,
      activeProjectId,
      draftApiKeys: Object.keys(draftModelApiKeys)
        .sort()
        .reduce<Record<string, string>>((acc, key) => {
          acc[key] = draftModelApiKeys[key];
          return acc;
        }, {}),
    });
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
    autoSaveTimerRef.current = setTimeout(() => {
      persistSettings(settings)
        .then((updated) => {
          lastAutoSavedHashRef.current = JSON.stringify({
            settings: updated,
            activeProjectId: updated.activeProjectId ?? activeProjectId,
            draftApiKeys: {},
          });
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
    persistSettings,
    setToast,
    settings,
  ]);

  return {
    persistSettings,
    savePanelLayout,
  };
}
