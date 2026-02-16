import { Bot, Globe, Languages, MoonStar, Palette, Plus, Settings2, Sun, SunMoon } from "lucide-react";
import { detectSystemLocale, type Locale } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import type {
  AppSettings,
  BusyTexCacheInfo,
  ModelCatalogItem,
  RuntimeLogInfo,
} from "../../shared/types/app";
import {
  DEFAULT_PANEL_LAYOUT,
  DEFAULT_PROTOCOLS,
  type SettingsSection,
  type ThemeMode,
} from "../app-config";

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

export function SettingsPanel(props: {
  settings: AppSettings | null;
  activeProjectId: string | null;
  locale: Locale;
  busy: boolean;
  settingsSection: SettingsSection;
  busytexCacheInfo: BusyTexCacheInfo | null;
  runtimeInfo: RuntimeLogInfo | null;
  sessionLogName: string;
  activeModelCatalog: ModelCatalogItem[];
  onSettingsSectionChange: (value: SettingsSection) => void;
  onSaveSettings: () => void;
  onLocaleChange: (locale: Locale) => void;
  onThemeModeChange: (theme: ThemeMode, event?: { clientX: number; clientY: number }) => void;
  onBusyTexCachePolicyChange: (policy: "install-first" | "appdata-only") => void;
  onOpenModelModal: () => void;
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
    sessionLogName,
    activeModelCatalog,
    onSettingsSectionChange,
    onSaveSettings,
    onLocaleChange,
    onThemeModeChange,
    onBusyTexCachePolicyChange,
    onOpenModelModal,
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
      theme: "system",
      busytexCachePolicy: "install-first",
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

      <section className="min-h-0 overflow-auto p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t(
                SETTINGS_SECTIONS.find((item) => item.id === settingsSection)?.key ??
                  "settings.section.general",
              )}
            </h2>
            <p className="text-xs text-slate-500">{t("settings.saveHint")}</p>
          </div>
          <Button onClick={onSaveSettings} disabled={busy}>
            {t("settings.saveSettings")}
          </Button>
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
                <input
                  type="checkbox"
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
          </div>
        )}

        {settingsSection === "models" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                {t("settings.modelCatalogTitle")}
              </h3>
              <Button size="sm" onClick={onOpenModelModal}>
                <Plus className="mr-2 h-4 w-4" />
                {t("settings.addModel")}
              </Button>
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
                  {localSettings.modelProtocols.map((protocol) => (
                    <optgroup key={protocol.id} label={protocol.displayName}>
                      {activeModelCatalog
                        .filter((item) => item.protocolId === protocol.id)
                        .map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName} ({model.requestName || "-"})
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        )}

        {settingsSection === "diagnostics" && (
          <div className="grid gap-4">
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{t("settings.currentLog")}</span>
                <span className="font-mono text-slate-700">{sessionLogName}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{t("settings.installMode")}</span>
                <span className="text-slate-700">{runtimeInfo?.installMode ?? "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{t("settings.version")}</span>
                <span className="text-slate-700">{runtimeInfo?.version ?? "-"}</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
