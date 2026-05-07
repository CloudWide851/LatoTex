import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import type { AppSettings, ModelCatalogItem } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

const FEATURE_MODEL_BINDING_KEYS = [
  "latexAgentModelId",
  "analysisAgentModelId",
  "gitSummaryModelId",
  "chatAgentModelId",
  "translationModelId",
  "completionModelId",
] as const;

const ROUTES = [
  { key: "latexAgentModelId", labelKey: "settings.featureModel.latexAgent" },
  { key: "analysisAgentModelId", labelKey: "settings.featureModel.analysisAgent" },
  { key: "gitSummaryModelId", labelKey: "settings.featureModel.gitSummary" },
  { key: "chatAgentModelId", labelKey: "settings.featureModel.chatAgent" },
  { key: "translationModelId", labelKey: "settings.featureModel.translation" },
  { key: "completionModelId", labelKey: "settings.featureModel.completion" },
] as const;

export function AgentRoutingSettingsSection(props: {
  settings: AppSettings;
  activeModelCatalog: ModelCatalogItem[];
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  t: TranslationFn;
}) {
  const { settings, activeModelCatalog, setSettings, t } = props;
  const [bulkModelId, setBulkModelId] = useState("");

  useEffect(() => {
    if (bulkModelId && !activeModelCatalog.some((model) => model.id === bulkModelId)) {
      setBulkModelId("");
    }
  }, [activeModelCatalog, bulkModelId]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{t("settings.agentHint")}</p>
      <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
        <span className="text-xs font-semibold text-slate-700">
          {t("settings.agentBulkApplyLabel")}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <Select
              value={bulkModelId}
              portalClassName="settings-scrollbar-hidden"
              onChange={(event) => setBulkModelId(event.target.value)}
            >
              <option value="">{t("settings.noModelAssigned")}</option>
              {activeModelCatalog.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName} ({model.requestName || "-"})
                </option>
              ))}
            </Select>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!bulkModelId}
            onClick={() =>
              setSettings((prev) =>
                prev
                  ? {
                      ...prev,
                      uiPrefs: {
                        ...(prev.uiPrefs ?? {}),
                        featureModelBindings: FEATURE_MODEL_BINDING_KEYS.reduce(
                          (bindings, key) => ({
                            ...bindings,
                            [key]: bulkModelId,
                          }),
                          { ...(prev.uiPrefs?.featureModelBindings ?? {}) },
                        ),
                      },
                    }
                  : prev,
              )
            }
          >
            {t("settings.agentBulkApplyAction")}
          </Button>
        </div>
      </div>
      {ROUTES.map((item) => {
        const featureBindings = settings.uiPrefs?.featureModelBindings ?? {};
        const currentValue = (featureBindings as Record<string, string | undefined>)[item.key] ?? "";
        return (
          <div
            className="grid grid-cols-[180px_minmax(220px,1fr)] items-center gap-2 rounded-lg border border-slate-200 p-2 max-[980px]:grid-cols-1"
            key={item.key}
          >
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
              {t(item.labelKey)}
            </span>
            <Select
              value={currentValue}
              portalClassName="settings-scrollbar-hidden"
              onChange={(event) =>
                setSettings((prev) =>
                  prev
                    ? {
                        ...prev,
                        uiPrefs: {
                          ...(prev.uiPrefs ?? {}),
                          featureModelBindings: {
                            ...(prev.uiPrefs?.featureModelBindings ?? {}),
                            [item.key]: event.target.value,
                          },
                        },
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
        );
      })}
    </div>
  );
}
