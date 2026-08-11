import type { AppSettings, KnowledgeSearchScope } from "../../../shared/types/app";
import {
  KNOWLEDGE_GRAPH_NODE_OPTIONS,
  normalizeKnowledgePrefs,
} from "../../settings/knowledgeSettings";
import { SettingsBooleanRow } from "./SettingsBooleanRow";
import { SettingsSelectRow } from "./SettingsSelectRow";
import { InfoHint } from "../../../components/ui/info-hint";

type TranslationFn = (key: any) => string;

export function KnowledgeSettingsSection(props: {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, setSettings, t } = props;
  const prefs = normalizeKnowledgePrefs(settings.uiPrefs);
  const updatePrefs = (patch: Partial<NonNullable<AppSettings["uiPrefs"]>>) => {
    setSettings((current) => {
      const base = current ?? settings;
      return {
        ...base,
        uiPrefs: {
          ...(base.uiPrefs ?? {}),
          ...patch,
        },
      };
    });
  };

  return (
    <div className="grid gap-3">
      <header className="app-material-inset flex items-center gap-1 rounded-lg border p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("knowledge.settings.title")}
        </h3>
        <InfoHint content={t("knowledge.settings.description")} label={t("knowledge.settings.title")} />
      </header>

      <SettingsSelectRow
        title={t("knowledge.settings.defaultScope")}
        value={prefs.defaultScope}
        description={t("knowledge.settings.defaultScopeHint")}
        options={[
          {
            value: "current",
            label: t("knowledge.settings.scope.current"),
          },
          {
            value: "all",
            label: t("knowledge.settings.scope.all"),
          },
        ]}
        onChange={(value) => updatePrefs({
          knowledgeDefaultScope: value as KnowledgeSearchScope,
        })}
      />

      <div className="app-material-inset flex items-center gap-1 rounded-lg border p-1">
        <SettingsBooleanRow
          className="min-w-0 flex-1"
          label={t("knowledge.settings.backgroundIndex")}
          checked={prefs.backgroundIndexEnabled}
          onCheckedChange={(value) => updatePrefs({
            knowledgeBackgroundIndexEnabled: value,
          })}
        />
        <InfoHint content={t("knowledge.settings.backgroundIndexHint")} label={t("knowledge.settings.backgroundIndex")} />
      </div>

      <div className="app-material-inset flex items-center gap-1 rounded-lg border p-1">
        <SettingsBooleanRow
          className="min-w-0 flex-1"
          label={t("knowledge.settings.modelReminder")}
          checked={prefs.semanticModelReminderEnabled}
          onCheckedChange={(value) => updatePrefs({
            knowledgeSemanticModelReminderEnabled: value,
          })}
        />
        <InfoHint content={t("knowledge.settings.modelReminderHint")} label={t("knowledge.settings.modelReminder")} />
      </div>

      <SettingsSelectRow
        title={t("knowledge.settings.graphMaxNodes")}
        value={String(prefs.graph.maxVisibleNodes)}
        description={t("knowledge.settings.graphMaxNodesHint")}
        options={KNOWLEDGE_GRAPH_NODE_OPTIONS.map((value) => ({
          value: String(value),
          label: value.toLocaleString(),
        }))}
        onChange={(value) => updatePrefs({
          knowledgeGraphPrefs: {
            ...prefs.graph,
            maxVisibleNodes: Number(value),
          },
        })}
      />

      <div className="app-material-inset flex items-center gap-1 rounded-lg border p-1">
        <SettingsBooleanRow
          className="min-w-0 flex-1"
          label={t("knowledge.settings.graphLabels")}
          checked={prefs.graph.showLabels}
          onCheckedChange={(value) => updatePrefs({
            knowledgeGraphPrefs: {
              ...prefs.graph,
              showLabels: value,
            },
          })}
        />
        <InfoHint content={t("knowledge.settings.graphLabelsHint")} label={t("knowledge.settings.graphLabels")} />
      </div>
    </div>
  );
}
