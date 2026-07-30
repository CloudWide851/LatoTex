import { ArrowRight, Network, ShieldCheck, UsersRound } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "../../../components/ui/button";
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
          <div className="mb-1 flex items-center gap-2">
            <UsersRound className="h-4 w-4 text-[var(--app-accent)]" />
            <h2 id="agent-workflow-settings-title" className="text-sm font-semibold text-slate-900">
              {t("settings.agentTeamsMovedTitle")}
            </h2>
          </div>
          <p className="max-w-2xl text-xs leading-5 text-slate-500">
            {t("settings.agentTeamsMovedHint")}
          </p>
        </div>
        <Button size="sm" onClick={onOpenAgentControl}>
          {t("settings.openAgentControl")}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="app-material-inset flex gap-2 rounded-md border p-3">
          <Network className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <div>
            <h3 className="text-xs font-semibold text-slate-800">{t("settings.agentTeamsMovedProfiles")}</h3>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{t("settings.agentTeamsMovedProfilesHint")}</p>
          </div>
        </div>
        <div className="app-material-inset flex gap-2 rounded-md border p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <h3 className="text-xs font-semibold text-slate-800">{t("settings.agentTeamsMovedSafety")}</h3>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{t("settings.agentTeamsMovedSafetyHint")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
