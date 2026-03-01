import { Bot, Globe, Languages, MoonStar, Palette, Plus, Settings2, Sun, SunMoon } from "lucide-react";
import { detectSystemLocale, type Locale } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Select } from "../../components/ui/select";
import type {
  AppSettings,
  BusyTexCacheInfo,
  ModelCatalogItem,
  ModelTestResult,
  RuntimeLogEntry,
  RuntimeLogInfo,
} from "../../shared/types/app";
import {
  DEFAULT_PANEL_LAYOUT,
  DEFAULT_PROTOCOLS,
  type SettingsSection,
  type ThemeMode,
} from "../app-config";
import { DiagnosticsSettingsSection } from "./settings/DiagnosticsSettingsSection";

type TranslationFn = (key: any) => string;

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  key:
    | "settings.section.general"
    | "settings.section.appearance"
    | "settings.section.models"
    | "settings.section.agents"
    | "settings.section.diagnostics";
  icon: typeof Languages;
}> = [
  { id: "general", key: "settings.section.general", icon: Languages },
  { id: "appearance", key: "settings.section.appearance", icon: Palette },
  { id: "models", key: "settings.section.models", icon: Globe },
  { id: "agents", key: "settings.section.agents", icon: Bot },
  { id: "diagnostics", key: "settings.section.diagnostics", icon: Settings2 },
];
const PREVIEW_ZOOM_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

export function SettingsPanel(props: {
  settings: AppSettings | null;
  activeProjectId: string | null;
  locale: Locale;
  busy: boolean;
  settingsSection: SettingsSection;
  busytexCacheInfo: BusyTexCacheInfo | null;
  runtimeInfo: RuntimeLogInfo | null;
  runtimeLogs: RuntimeLogEntry[];
  runtimeLogLoading: boolean;
  sessionLogName: string;
  activeModelCatalog: ModelCatalogItem[];
  modelTestBusy: boolean;
  modelTestActiveId: string | null;
  modelTestById: Record<string, ModelTestResult>;
  onSettingsSectionChange: (value: SettingsSection) => void;
  onLocaleChange: (locale: Locale) => void;
  onThemeModeChange: (theme: ThemeMode, event?: { clientX: number; clientY: number }) => void;
  onBusyTexCachePolicyChange: (policy: "install-first" | "appdata-only") => void;
  onOpenModelModal: (mode?: "create" | "edit", model?: ModelCatalogItem | null) => void;
  onReloadLogs: (options?: { silent?: boolean }) => Promise<void>;
  onClearCurrentLog: () => Promise<void>;
  onTestModel: (modelId: string) => void;
  onTestAllModels: () => void;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const {
    settings,
    activeProjectId,
    locale,
    busy,
    settingsSection,
    busytexCacheInfo,
    runtimeInfo,
    runtimeLogs,
    runtimeLogLoading,
    sessionLogName,
    activeModelCatalog,
    modelTestBusy,
    modelTestActiveId,
    modelTestById,
    onSettingsSectionChange,
    onLocaleChange,
    onThemeModeChange,
    onBusyTexCachePolicyChange,
    onOpenModelModal,
    onReloadLogs,
    onClearCurrentLog,
    onTestModel,
    onTestAllModels,
    setSettings,
    t,
  } = props;

  const localSettings = settings ?? {
    activeProjectId,
    modelProtocols: DEFAULT_PROTOCOLS,
    modelCatalog: [],
    agentBindings: [],
    uiPrefs: {
      language: locale,
      closeToTrayNoticeEnabled: true,
      theme: "system",
      busytexCachePolicy: "install-first",
      previewDefaultZoom: 1,
      panelLayout: DEFAULT_PANEL_LAYOUT,
    },
  };


  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft motion-slide-up max-[980px]:grid-cols-1">
      <aside className="border-r border-slate-200 bg-slate-50 p-2 max-[980px]:border-r-0 max-[980px]:border-b">
        <div className="space-y-1">
          {SETTINGS_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition",
                  settingsSection === item.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-200",
                )}
                onClick={() => onSettingsSectionChange(item.id)}
              >
                <Icon className="h-4 w-4" />
                <span>{t(item.key)}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section
        className={cn(
          "min-h-0 p-3",
          settingsSection === "diagnostics" ? "overflow-hidden" : "overflow-auto",
        )}
      >
        <div className="mb-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t(
                SETTINGS_SECTIONS.find((item) => item.id === settingsSection)?.key ??
                  "settings.section.general",
              )}
            </h2>
            <p className="text-xs text-slate-500">{t("settings.saveHint")}</p>
          </div>
        </div>

        {settingsSection === "general" && (
          <div className="grid gap-3">
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                {t("settings.languageTitle")}
              </h3>
              <div className="grid max-w-xs gap-2">
                <Select
                  value={locale}
                  onChange={(event) => onLocaleChange(event.target.value as Locale)}
                >
                  <option value="zh-CN">{t("settings.language.zh-CN")}</option>
                  <option value="en-US">{t("settings.language.en-US")}</option>
                </Select>
                <p className="text-xs text-slate-500">
                  {t("settings.languageAuto")}: {" "}
                  {detectSystemLocale() === "zh-CN"
                    ? t("settings.language.zh-CN")
                    : t("settings.language.en-US")}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <label className="flex items-center justify-between text-sm text-slate-700">
                <span>{t("settings.deleteConfirm")}</span>
                <Checkbox
                  checked={!(localSettings.uiPrefs?.skipDeleteConfirm ?? false)}
                  onChange={(event) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            uiPrefs: {
                              ...(prev.uiPrefs ?? {}),
                              language: prev.uiPrefs?.language ?? locale,
                              skipDeleteConfirm: !event.target.checked,
                              panelLayout: prev.uiPrefs?.panelLayout,
                            },
                          }
                        : prev,
                    )
                  }
                />
              </label>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <label className="flex items-center justify-between text-sm text-slate-700">
                <span>{t("settings.closeToTrayNotice")}</span>
                <Checkbox
                  checked={localSettings.uiPrefs?.closeToTrayNoticeEnabled ?? true}
                  onChange={(event) => setSettings((prev) => (prev
                    ? { ...prev, uiPrefs: { ...(prev.uiPrefs ?? {}), closeToTrayNoticeEnabled: event.target.checked } }
                    : prev))}
                />
              </label>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                {t("settings.busytexCacheTitle")}
              </h3>
              <div className="grid max-w-md gap-2">
                <Select
                  value={localSettings.uiPrefs?.busytexCachePolicy ?? "install-first"}
                  onChange={(event) =>
                    onBusyTexCachePolicyChange(
                      event.target.value as "install-first" | "appdata-only",
                    )
                  }
                >
                  <option value="install-first">{t("settings.busytex.installFirst")}</option>
                  <option value="appdata-only">{t("settings.busytex.appDataOnly")}</option>
                </Select>
                <div className="text-xs text-slate-500">
                  {t("settings.busytex.currentDir")}: {" "}
                  {busytexCacheInfo?.actualDir ?? localSettings.uiPrefs?.busytexCacheDir ?? "-"}
                </div>
                {busytexCacheInfo?.usingFallback && (
                  <div className="text-xs text-amber-600">{t("settings.busytex.fallbackUsed")}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {settingsSection === "appearance" && (
          <div className="grid gap-3">
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                {t("settings.themeTitle")}
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { id: "light" as const, key: "settings.theme.light" as const, icon: Sun },
                  { id: "dark" as const, key: "settings.theme.dark" as const, icon: MoonStar },
                  { id: "system" as const, key: "settings.theme.system" as const, icon: SunMoon },
                ].map((item) => {
                  const Icon = item.icon;
                  const selected = (localSettings.uiPrefs?.theme ?? "system") === item.id;
                  return (
                    <button
                      key={item.id}
                      className={cn(
                        "flex h-11 items-center justify-center gap-2 rounded-md border text-sm transition",
                        selected
                          ? "border-primary-600 bg-primary-600 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
                      )}
                      onClick={(event) =>
                        onThemeModeChange(item.id, {
                          clientX: event.clientX,
                          clientY: event.clientY,
                        })
                      }
                    >
                      <Icon className="h-4 w-4" />
                      <span>{t(item.key)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                {t("settings.previewZoomTitle")}
              </h3>
              <div className="grid max-w-xs gap-2">
                <Select
                  value={String(localSettings.uiPrefs?.previewDefaultZoom ?? 1)}
                  onChange={(event) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            uiPrefs: {
                              ...(prev.uiPrefs ?? {}),
                              previewDefaultZoom: Number(event.target.value),
                            },
                          }
                        : prev,
                    )
                  }
                >
                  {PREVIEW_ZOOM_OPTIONS.map((value) => (
                    <option key={value} value={String(value)}>
                      {`${Math.round(value * 100)}%`}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-slate-500">{t("settings.previewZoomHint")}</p>
              </div>
            </div>
          </div>
        )}

        {settingsSection === "models" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                {t("settings.modelCatalogTitle")}
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onTestAllModels}
                  disabled={modelTestBusy || localSettings.modelCatalog.length === 0}
                >
                  {modelTestBusy ? t("settings.testingAllModels") : t("settings.testAllModels")}
                </Button>
                <Button size="sm" onClick={() => onOpenModelModal("create", null)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("settings.addModel")}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="max-h-[42vh] space-y-2 overflow-auto pr-1">
                {localSettings.modelCatalog.map((model) => {
                  const protocol = localSettings.modelProtocols.find(
                    (item) => item.id === model.protocolId,
                  );
                  return (
                    <div
                      key={model.id}
                      className="grid grid-cols-[minmax(140px,1fr)_minmax(180px,1fr)_minmax(140px,1fr)_auto] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs max-[980px]:grid-cols-1"
                    >
                      <span>{model.displayName}</span>
                      <span className="font-mono text-slate-600">{model.requestName}</span>
                      <span className="text-slate-500">{protocol?.displayName ?? model.protocolId}</span>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onTestModel(model.id)}
                          disabled={modelTestBusy}
                        >
                          {modelTestActiveId === model.id && modelTestBusy
                            ? t("common.loading")
                            : t("settings.testModel")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenModelModal("edit", model)}
                        >
                          {t("settings.editModel")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setSettings((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    modelCatalog: prev.modelCatalog.filter((item) => item.id !== model.id),
                                    agentBindings: prev.agentBindings.filter((item) => item.modelId !== model.id),
                                  }
                                : prev,
                            )
                          }
                        >
                          {t("settings.removeModel")}
                        </Button>
                      </div>
                      {modelTestById[model.id] && (
                        <div
                          className={cn(
                            "col-span-full rounded border px-2 py-1 text-[11px]",
                            modelTestById[model.id].ok
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-rose-300 bg-rose-50 text-rose-700",
                          )}
                        >
                          {modelTestById[model.id].message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {settingsSection === "agents" && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">{t("settings.agentHint")}</p>
            {localSettings.agentBindings.map((binding, index) => (
              <div
                className="grid grid-cols-[110px_minmax(220px,1fr)] items-center gap-2 rounded-lg border border-slate-200 p-2 max-[980px]:grid-cols-1"
                key={`${binding.role}-${index}`}
              >
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {binding.role}
                </span>
                <Select
                  value={binding.modelId}
                  onChange={(event) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            agentBindings: prev.agentBindings.map((item, idx) =>
                              idx === index
                                ? { ...item, modelId: event.target.value }
                                : item,
                            ),
                          }
                        : prev,
                    )
                  }
                >
                  <option value="">{t("settings.noModelAssigned")}</option>
                  {activeModelCatalog.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName} ({model.requestName || "-"})
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        )}

        {settingsSection === "diagnostics" && (
          <DiagnosticsSettingsSection
            runtimeInfo={runtimeInfo}
            runtimeLogs={runtimeLogs}
            runtimeLogLoading={runtimeLogLoading}
            sessionLogName={sessionLogName}
            locale={locale}
            onReloadLogs={onReloadLogs}
            onClearCurrentLog={onClearCurrentLog}
            t={t}
          />
        )}
      </section>
    </div>
  );
}
