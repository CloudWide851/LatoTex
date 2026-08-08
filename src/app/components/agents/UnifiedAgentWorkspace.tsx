import { Bot, Workflow } from "lucide-react";
import { useState } from "react";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { ModelCatalogItem } from "../../../shared/types/app";
import { AgentControlCenter } from "./AgentControlCenter";
import { ResearchAgentWorkbench } from "./ResearchAgentWorkbench";

type TranslationFn = (key: MessageKey) => string;
type AgentWorkspaceTab = "workbench" | "studio";

export function UnifiedAgentWorkspace(props: {
  projectId: string | null;
  models: ModelCatalogItem[];
  t: TranslationFn;
}) {
  const { projectId, models, t } = props;
  const [tab, setTab] = useState<AgentWorkspaceTab>("workbench");
  return (
    <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <header className="app-material-panel flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-[color:var(--app-fg)]">{t("research.workbench.title")}</h1>
          <p className="mt-0.5 truncate text-[11px] text-[color:var(--app-muted)]">{t("research.workbench.subtitle")}</p>
        </div>
        <div className="app-material-inset inline-flex rounded-md border p-0.5" role="tablist" aria-label={t("research.workbench.sections")}>
          {([
            ["workbench", Bot],
            ["studio", Workflow],
          ] as const).map(([id, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition ${tab === id ? "bg-[color:var(--app-accent)] text-white" : "text-[color:var(--app-muted)] hover:text-[color:var(--app-fg)]"}`}
              onClick={() => setTab(id)}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`research.workbench.tab.${id}`)}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "workbench" ? (
          <ResearchAgentWorkbench projectId={projectId} t={t} />
        ) : (
          <AgentControlCenter projectId={projectId} models={models} t={t} />
        )}
      </div>
    </section>
  );
}
