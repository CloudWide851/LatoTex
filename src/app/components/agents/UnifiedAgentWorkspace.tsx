import { Bot, PanelLeft, PanelRight, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { InfoHint } from "../../../components/ui/info-hint";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { AgentWorkspaceLayoutPrefs, ModelCatalogItem } from "../../../shared/types/app";
import { normalizeAgentWorkspaceLayoutPrefs } from "../../settings/agentWorkspaceSettings";
import { AgentControlCenter } from "./AgentControlCenter";
import {
  ResearchAgentWorkbench,
  type AgentCompactDrawer,
  type ResearchWorkbenchRunProgress,
} from "./ResearchAgentWorkbench";
import { ChatWorkspace, type ChatWorkspaceProps } from "../chat/ChatWorkspace";

type TranslationFn = (key: MessageKey) => string;
type AgentWorkspaceTab = "workbench" | "studio";

function useAgentDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(() => (
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia("(min-width: 1280px)").matches
  ));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return desktop;
}

export function UnifiedAgentWorkspace(props: {
  projectId: string | null;
  models: ModelCatalogItem[];
  layoutPrefs?: AgentWorkspaceLayoutPrefs;
  onLayoutPrefsChange: (prefs: AgentWorkspaceLayoutPrefs) => void;
  chat: Omit<ChatWorkspaceProps, "projectId" | "t">;
  t: TranslationFn;
}) {
  const { projectId, models, layoutPrefs: rawLayoutPrefs, onLayoutPrefsChange, chat, t } = props;
  const [tab, setTab] = useState<AgentWorkspaceTab>("workbench");
  const [compactDrawer, setCompactDrawer] = useState<AgentCompactDrawer>(null);
  const [runProgress, setRunProgress] = useState<ResearchWorkbenchRunProgress | null>(null);
  const desktopLayout = useAgentDesktopLayout();
  const layoutPrefs = useMemo(
    () => normalizeAgentWorkspaceLayoutPrefs(rawLayoutPrefs),
    [rawLayoutPrefs],
  );

  useEffect(() => {
    setCompactDrawer(null);
  }, [desktopLayout, projectId, tab]);

  const updateLayoutPrefs = (patch: Partial<AgentWorkspaceLayoutPrefs>) => {
    onLayoutPrefsChange({ ...layoutPrefs, ...patch });
  };
  const toggleTasks = () => {
    if (desktopLayout) {
      updateLayoutPrefs({ tasksOpen: !layoutPrefs.tasksOpen });
      return;
    }
    setCompactDrawer((current) => current === "tasks" ? null : "tasks");
  };
  const toggleInspector = () => {
    if (desktopLayout) {
      updateLayoutPrefs({ inspectorOpen: !layoutPrefs.inspectorOpen });
      return;
    }
    setCompactDrawer((current) => current === "inspector" ? null : "inspector");
  };
  const tasksExpanded = desktopLayout ? layoutPrefs.tasksOpen : compactDrawer === "tasks";
  const inspectorExpanded = desktopLayout ? layoutPrefs.inspectorOpen : compactDrawer === "inspector";

  return (
    <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <header className="app-material-panel flex min-h-11 flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1 px-1">
          <h1 className="truncate text-sm font-semibold text-[color:var(--app-fg)]">{t("research.workbench.title")}</h1>
          <InfoHint content={t("research.workbench.subtitle")} label={t("research.workbench.title")} />
        </div>

        {tab === "workbench" ? (
          <Button
            size="sm"
            variant={tasksExpanded ? "secondary" : "ghost"}
            aria-expanded={tasksExpanded}
            aria-controls="research-task-drawer"
            onClick={toggleTasks}
          >
            <PanelLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t(tasksExpanded ? "research.workbench.tasksClose" : "research.workbench.tasksOpen")}</span>
          </Button>
        ) : null}

        <div className="app-material-inset inline-flex rounded-md border p-0.5" role="tablist" aria-label={t("research.workbench.sections")}>
          {([[
            "workbench",
            Bot,
          ], [
            "studio",
            Workflow,
          ]] as const).map(([id, Icon]) => (
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

        <div className="min-w-0 flex-1" />
        {tab === "workbench" && runProgress ? (
          <span className="app-status-info rounded border px-2 py-1 text-[10px] tabular-nums" role="status">
            {t("research.workbench.runProgress")} {runProgress.completedSteps}/{runProgress.totalSteps}
          </span>
        ) : null}
        {tab === "workbench" ? (
          <Button
            size="sm"
            variant={inspectorExpanded ? "secondary" : "ghost"}
            aria-expanded={inspectorExpanded}
            aria-controls="research-context-drawer"
            onClick={toggleInspector}
          >
            <PanelRight className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t(inspectorExpanded ? "research.workbench.contextClose" : "research.workbench.contextOpen")}</span>
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "workbench" ? (
          <ResearchAgentWorkbench
            projectId={projectId}
            conversation={<ChatWorkspace {...chat} projectId={projectId} t={t} />}
            layoutPrefs={layoutPrefs}
            desktopLayout={desktopLayout}
            compactDrawer={compactDrawer}
            onCompactDrawerChange={setCompactDrawer}
            onLayoutPrefsChange={onLayoutPrefsChange}
            onRunProgressChange={setRunProgress}
            t={t}
          />
        ) : (
          <AgentControlCenter projectId={projectId} models={models} t={t} />
        )}
      </div>
    </section>
  );
}
