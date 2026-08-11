import { CircleDot, RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { InfoHint } from "../../../components/ui/info-hint";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { ResearchAgentRun, ResearchTask } from "../../../shared/types/researchAgent";

type TranslationFn = (key: MessageKey) => string;

function runForTask(runs: ResearchAgentRun[], taskId: string) {
  return runs.find((run) => run.taskId === taskId && !run.finishedAt)
    ?? runs.find((run) => run.taskId === taskId)
    ?? null;
}

export function ResearchTaskSidebar(props: {
  tasks: ResearchTask[];
  runs: ResearchAgentRun[];
  selectedTaskId: string;
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onSelectTask: (task: ResearchTask) => void;
  t: TranslationFn;
}) {
  const { tasks, runs, selectedTaskId, busy, refreshing, onRefresh, onSelectTask, t } = props;
  return (
    <>
      <header className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <h2 className="text-xs font-semibold text-[color:var(--app-fg)]">{t("research.workbench.tasks")}</h2>
            <InfoHint content={t("research.workbench.discussionHint")} label={t("research.workbench.tasks")} />
          </div>
          <Button size="icon" variant="ghost" disabled={busy} onClick={onRefresh} aria-label={t("research.workbench.refresh")}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />
          </Button>
        </div>
      </header>
      <div className="library-scrollbar min-h-0 flex-1 overflow-auto p-1.5">
        {tasks.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] leading-5 text-[color:var(--app-muted)]">
            {t("research.workbench.taskEmptyComposer")}
          </p>
        ) : tasks.map((task) => {
          const run = runForTask(runs, task.id);
          return (
            <button
              key={task.id}
              type="button"
              className={`mb-1 w-full rounded-md border px-2.5 py-2 text-left transition-colors ${selectedTaskId === task.id ? "border-[color:var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_9%,transparent)]" : "border-transparent hover:border-[color:var(--editor-widget-border)]"}`}
              onClick={() => onSelectTask(task)}
            >
              <span className="line-clamp-2 text-xs font-medium leading-4 text-[color:var(--app-fg)]">{task.goal}</span>
              <span className="mt-1 flex items-center gap-1 text-[10px] text-[color:var(--app-muted)]">
                <CircleDot className="h-2.5 w-2.5" aria-hidden="true" />
                {t(`research.workbench.taskStatus.${task.status}`)}
                {run ? <span>· {run.completedSteps}/{run.totalSteps}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
