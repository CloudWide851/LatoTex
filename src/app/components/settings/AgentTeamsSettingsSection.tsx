import { ArrowRight, UsersRound } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "../../../components/ui/button";
import { InfoHint } from "../../../components/ui/info-hint";
import type { AppSettings, ModelCatalogItem } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

export function AgentTeamsSettingsSection(props: {
  settings: AppSettings;
  activeModelCatalog: ModelCatalogItem[];
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  onOpenAgentControl: () => void;
  t: TranslationFn;
}) {
  const { onOpenAgentControl, t } = props;
  return (
    <section className="app-material-panel grid gap-3 rounded-lg border p-4" aria-labelledby="agent-workflow-settings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <UsersRound className="h-4 w-4 text-[var(--app-accent)]" />
            <h2 id="agent-workflow-settings-title" className="text-sm font-semibold text-slate-900">
              {t("settings.agentTeamsMovedTitle")}
            </h2>
            <InfoHint content={t("settings.agentTeamsMovedHint")} label={t("settings.agentTeamsMovedTitle")} />
          </div>
        </div>
        <Button size="sm" onClick={onOpenAgentControl}>
          {t("settings.openAgentControl")}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </section>
  );
}
