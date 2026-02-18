import { Bot, Globe, Languages, MoonStar, Palette, Plus, Settings2, Sun, SunMoon } from "lucide-react";
import { useMemo, useState } from "react";
import { detectSystemLocale, type Locale } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
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
  onOpenLogViewer: () => void;
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
    onOpenLogViewer,
    onClearCurrentLog,
    onTestModel,
    onTestAllModels,
    setSettings,
    t,
  } = props;

  const [logLevelFilter, setLogLevelFilter] = useState("ALL");
  const [logKeyword, setLogKeyword] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [selectedLogKey, setSelectedLogKey] = useState<string | null>(null);

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

  const filteredRuntimeLogs = useMemo(() => {
    const from = logFrom.trim() ? logFrom.replace("T", " ") : "";
    const to = logTo.trim() ? logTo.replace("T", " ") : "";
    const keyword = logKeyword.trim().toLowerCase();
    return runtimeLogs.filter((entry) => {
      const level = entry.level.toUpperCase();
      if (logLevelFilter !== "ALL" && level !== logLevelFilter) {
        return false;
      }
      if (keyword) {
        const haystack = `${entry.message} ${entry.raw}`.toLowerCase();
        if (!haystack.includes(keyword)) {
          return false;
        }
      }
      if (from && entry.timestamp && entry.timestamp < from) {
        return false;
      }
      if (to && entry.timestamp && entry.timestamp > to) {
        return false;
      }
      return true;
    });
  }, [logFrom, logKeyword, logLevelFilter, logTo, runtimeLogs]);

  const selectedLogEntry = useMemo(() => {
    if (!selectedLogKey) {
      return null;
    }
    return filteredRuntimeLogs.find(
      (entry, index) => `${entry.timestamp}-${entry.level}-${index}` === selectedLogKey,
    ) ?? null;
  }, [filteredRuntimeLogs, selectedLogKey]);

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
              <label className="flex items-center justify-between text-sm text-slate-700">
                <span>{t("settings.closeToTrayNotice")}</span>
                <input
                  type="checkbox"
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
              <Button size="sm" onClick={() => onOpenModelModal("create", null)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("settings.addModel")}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={onTestAllModels}
                disabled={modelTestBusy || localSettings.modelCatalog.length === 0}
              >
                {modelTestBusy ? t("settings.testingAllModels") : t("settings.testAllModels")}
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
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onTestModel(model.id)}
                          disabled={modelTestBusy}
                        >
                          {modelTestActiveId === model.id && modelTestBusy
                            ? t("common.loading")
                            : t("settings.testProtocol")}
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
              <div className="pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={onOpenLogViewer}>
                    {t("settings.openCurrentLog")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (window.confirm(t("settings.logClearCurrentConfirm"))) {
                        void onClearCurrentLog();
                        setSelectedLogKey(null);
                      }
                    }}
                  >
                    {t("settings.logClearCurrent")}
                  </Button>
                </div>
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{t("settings.logDoubleClickHint")}</p>
              <div className="grid gap-2">
                <div className="grid grid-cols-[minmax(140px,220px)_minmax(260px,1fr)] gap-2 max-[980px]:grid-cols-1">
                  <Select
                    value={logLevelFilter}
                    uiSize="sm"
                    onChange={(event) => setLogLevelFilter(event.target.value)}
                  >
                    <option value="ALL">{t("settings.logFilterAllLevels")}</option>
                    <option value="INFO">INFO</option>
                    <option value="WARN">WARN</option>
                    <option value="ERROR">ERROR</option>
                    <option value="CRASH">CRASH</option>
                  </Select>
                  <input
                    className="h-8 rounded-xl border border-slate-300 bg-white px-3 text-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    value={logKeyword}
                    onChange={(event) => setLogKeyword(event.target.value)}
                    placeholder={t("settings.logFilterKeyword")}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 max-[980px]:grid-cols-1">
                  <input
                    className="h-8 rounded-xl border border-slate-300 bg-white px-3 text-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    type="datetime-local"
                    value={logFrom}
                    onChange={(event) => setLogFrom(event.target.value)}
                    title={t("settings.logFilterFrom")}
                  />
                  <input
                    className="h-8 rounded-xl border border-slate-300 bg-white px-3 text-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    type="datetime-local"
                    value={logTo}
                    onChange={(event) => setLogTo(event.target.value)}
                    title={t("settings.logFilterTo")}
                  />
                </div>
              </div>
            </div>
            <div className="grid min-h-[280px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 max-[1100px]:grid-cols-1">
              {runtimeLogLoading ? (
                <div className="text-xs text-slate-500">{t("common.loading")}</div>
              ) : filteredRuntimeLogs.length === 0 ? (
                <div className="text-xs text-slate-500">{t("settings.logViewerEmpty")}</div>
              ) : (
                <>
                  <div className="max-h-[50vh] space-y-2 overflow-auto pr-1">
                  {filteredRuntimeLogs.map((entry, index) => {
                    const upper = entry.level.toUpperCase();
                    const lowerMessage = entry.message.toLowerCase();
                    const toneClass =
                      upper.includes("ERROR") || upper.includes("CRASH")
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : upper.includes("WARN")
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : lowerMessage.includes("success") ||
                              lowerMessage.includes("completed") ||
                              lowerMessage.includes("ok=true")
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : "border-slate-300 bg-white text-slate-700";
                    const entryKey = `${entry.timestamp}-${entry.level}-${index}`;
                    return (
                      <div
                        key={entryKey}
                        className={`rounded border px-3 py-2 ${toneClass} ${selectedLogKey === entryKey ? "ring-2 ring-primary-300" : ""}`}
                        onDoubleClick={() => setSelectedLogKey(entryKey)}
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                          <span className="font-semibold">
                            {t("settings.logLevel")}: {entry.level}
                          </span>
                          <span>
                            {t("settings.logTime")}: {entry.timestamp || "-"}
                          </span>
                        </div>
                        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5">
                          {entry.message || entry.raw}
                        </pre>
                      </div>
                    );
                  })}
                </div>
                  <div className="min-h-0 rounded-md border border-slate-300 bg-white p-3">
                    <h4 className="mb-2 text-xs font-semibold text-slate-700">{t("settings.logDetailTitle")}</h4>
                    {selectedLogEntry ? (
                      <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-700">
                        {selectedLogEntry.raw || selectedLogEntry.message}
                      </pre>
                    ) : (
                      <div className="text-xs text-slate-500">{t("settings.logDoubleClickHint")}</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
