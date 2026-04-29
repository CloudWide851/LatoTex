import { Plus } from "lucide-react";
import { useCallback } from "react";
import { detectSystemLocale, type Locale } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import type {
  AppSettings,
  ModelCatalogItem,
  ModelTestResult,
  RuntimeLogEntry,
  RuntimeLogInfo,
  RuntimeLogSession,
} from "../../shared/types/app";
import {
  DEFAULT_PANEL_LAYOUT,
  DEFAULT_PROTOCOLS,
  SETTINGS_SECTIONS,
  type SettingsSection,
  type ThemeMode,
} from "../app-config";
import { DiagnosticsSettingsSection } from "./settings/DiagnosticsSettingsSection";
import { CloseBehaviorCard } from "./settings/CloseBehaviorCard";
import { ChannelsSettingsSection } from "./settings/ChannelsSettingsSection";
import { AgentToolsSettingsSection, McpSettingsSection, SkillsSettingsSection } from "./settings/AgentToolsSettingsSection";
import { AgentTeamsSettingsSection } from "./settings/AgentTeamsSettingsSection";
import { AgentRoutingSettingsSection } from "./settings/AgentRoutingSettingsSection";
import { AppearanceSettingsSection } from "./settings/AppearanceSettingsSection";
import { ExplorerDefaultsSection } from "./settings/ExplorerDefaultsSection";
import { MemoryGuardSettingsSection } from "./settings/MemoryGuardSettingsSection";
import { SettingsBooleanRow } from "./settings/SettingsBooleanRow";
import { SettingsSelectRow } from "./settings/SettingsSelectRow";
import { DEFAULT_AGENT_TEAM_PREFS } from "../settings/agentTeamDefaults";

type TranslationFn = (key: any) => string;

export function SettingsPanel(props: {
  settings: AppSettings | null;
  activeProjectId: string | null;
  locale: Locale;
  busy: boolean;
  settingsSection: SettingsSection;
  runtimeInfo: RuntimeLogInfo | null;
  runtimeLogs: RuntimeLogEntry[];
  runtimeLogLoading: boolean;
  sessionLogName: string;
  runtimeLogSessions: RuntimeLogSession[];
  selectedLogFileName: string;
  activeModelCatalog: ModelCatalogItem[];
  modelTestBusy: boolean;
  modelTestActiveId: string | null;
  modelTestById: Record<string, ModelTestResult>;
  onSettingsSectionChange: (value: SettingsSection) => void;
  onLocaleChange: (locale: Locale) => void;
  onThemeModeChange: (theme: ThemeMode, event?: { clientX: number; clientY: number }) => void;
  onOpenModelModal: (mode?: "create" | "edit", model?: ModelCatalogItem | null) => void;
  onReloadLogs: (options?: {
    silent?: boolean;
    logFileName?: string;
    refreshSessions?: boolean;
  }) => Promise<void>;
  onSelectLogFile: (fileName: string) => Promise<void>;
  onClearCurrentLog: () => Promise<void>;
  onTestModel: (modelId: string) => void;
  onTestAllModels: () => void;
  onReleaseMemory?: () => void;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const {
    settings,
    activeProjectId,
    locale,
    busy,
    settingsSection,
    runtimeInfo,
    runtimeLogs,
    runtimeLogLoading,
    sessionLogName,
    runtimeLogSessions,
    selectedLogFileName,
    activeModelCatalog,
    modelTestBusy,
    modelTestActiveId,
    modelTestById,
    onSettingsSectionChange,
    onLocaleChange,
    onThemeModeChange,
    onOpenModelModal,
    onReloadLogs,
    onSelectLogFile,
    onClearCurrentLog,
    onTestModel,
    onTestAllModels,
    onReleaseMemory,
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
      previewDefaultZoom: 1,
      panelLayout: DEFAULT_PANEL_LAYOUT,
      backgroundImagePaths: [],
      backgroundBlurPx: 18,
      accentColor: "emerald",
      accentCustomColor: "",
      scrollbarColorMode: "accent",
      scrollbarWidthPx: 14,
      glassOpacity: 0.78,
      glassBlurPx: 18,
      motionLevel: "full",
      pdfPageGapPx: 12,
      logFontSizePx: 12,
      panelRadiusPx: 8,
      panelBorderContrast: "normal",
      memoryGuardPrefs: {
        enabled: true,
        highWatermarkMb: 560,
        criticalWatermarkMb: 760,
        sampleIntervalSec: 25,
        criticalAction: "sleep",
      },
      agentTeamPrefs: DEFAULT_AGENT_TEAM_PREFS,
    },
  };

  const deleteConfirmEnabled = !(localSettings.uiPrefs?.skipDeleteConfirm ?? false);
  const closeToTrayNoticeEnabled = localSettings.uiPrefs?.closeToTrayNoticeEnabled ?? true;
  const paperBriefEngine = localSettings.uiPrefs?.paperBriefEngine ?? "auto";

  const updateGeneralUiPrefs = useCallback((patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((prev) => {
      const base = prev ?? localSettings;
      return {
        ...base,
        uiPrefs: {
          ...(base.uiPrefs ?? {}),
          language: base.uiPrefs?.language ?? locale,
          panelLayout: base.uiPrefs?.panelLayout ?? DEFAULT_PANEL_LAYOUT,
          ...patch,
        },
      };
    });
  }, [locale, localSettings, setSettings]);

  return (
    <div className="relative z-[450] grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft motion-slide-up max-[980px]:grid-cols-1">
      <aside className="bg-slate-50 p-2 max-[980px]:border-b">
        <div className="space-y-1">
          {SETTINGS_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
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
          settingsSection === "diagnostics"
            ? "grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
            : "library-scrollbar overflow-auto",
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
            <SettingsSelectRow
              title={t("settings.languageTitle")}
              value={locale}
              description={`${t("settings.languageAuto")}: ${
                detectSystemLocale() === "zh-CN"
                  ? t("settings.language.zh-CN")
                  : t("settings.language.en-US")
              }`}
              options={[
                { value: "zh-CN", label: t("settings.language.zh-CN") },
                { value: "en-US", label: t("settings.language.en-US") },
              ]}
              onChange={(value) => onLocaleChange(value as Locale)}
            />
            <SettingsSelectRow
              title={t("settings.paperBriefEngineTitle")}
              value={paperBriefEngine}
              description={t("settings.paperBriefEngineHint")}
              options={[
                { value: "auto", label: t("settings.paperBriefEngine.auto") },
                { value: "pdfjs", label: t("settings.paperBriefEngine.pdfjs") },
                { value: "python", label: t("settings.paperBriefEngine.python") },
              ]}
              onChange={(value) =>
                updateGeneralUiPrefs({
                  paperBriefEngine: value as "auto" | "pdfjs" | "python",
                })
              }
            />
            <SettingsBooleanRow
              label={t("settings.deleteConfirm")}
              checked={deleteConfirmEnabled}
              onCheckedChange={(nextValue) =>
                updateGeneralUiPrefs({ skipDeleteConfirm: !nextValue })
              }
            />
            <SettingsBooleanRow
              label={t("settings.closeToTrayNotice")}
              checked={closeToTrayNoticeEnabled}
              onCheckedChange={(nextValue) =>
                updateGeneralUiPrefs({ closeToTrayNoticeEnabled: nextValue })
              }
            />
            <MemoryGuardSettingsSection
              settings={localSettings}
              setSettings={setSettings}
              onReleaseMemory={onReleaseMemory}
              t={t}
            />
            <ExplorerDefaultsSection settings={localSettings} setSettings={setSettings} t={t} />
            <CloseBehaviorCard settings={localSettings} setSettings={setSettings} t={t} />
          </div>
        )}

        {settingsSection === "appearance" && (
          <AppearanceSettingsSection
            settings={localSettings}
            setSettings={setSettings}
            onThemeModeChange={onThemeModeChange}
            t={t}
          />
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
              <div className="library-scrollbar max-h-[42vh] space-y-2 overflow-auto pr-1">
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
          <AgentRoutingSettingsSection
            settings={localSettings}
            activeModelCatalog={activeModelCatalog}
            setSettings={setSettings}
            t={t}
          />
        )}

        {settingsSection === "agent-teams" && (
          <AgentTeamsSettingsSection
            settings={localSettings}
            activeModelCatalog={activeModelCatalog}
            setSettings={setSettings}
            t={t}
          />
        )}

        {settingsSection === "agent-tools" && (
          <AgentToolsSettingsSection settings={localSettings} setSettings={setSettings} t={t} />
        )}

        {settingsSection === "mcp" && (
          <McpSettingsSection settings={localSettings} setSettings={setSettings} t={t} />
        )}

        {settingsSection === "skills" && (
          <SkillsSettingsSection settings={localSettings} setSettings={setSettings} t={t} />
        )}

        {settingsSection === "channels" && (
          <ChannelsSettingsSection settings={localSettings} setSettings={setSettings} t={t} />
        )}

        {settingsSection === "diagnostics" && (
          <DiagnosticsSettingsSection
            runtimeInfo={runtimeInfo}
            runtimeLogs={runtimeLogs}
            runtimeLogLoading={runtimeLogLoading}
            sessionLogName={sessionLogName}
            runtimeLogSessions={runtimeLogSessions}
            selectedLogFileName={selectedLogFileName}
            locale={locale}
            onReloadLogs={onReloadLogs}
            onSelectLogFile={onSelectLogFile}
            onClearCurrentLog={onClearCurrentLog}
            t={t}
          />
        )}
      </section>
    </div>
  );
}








