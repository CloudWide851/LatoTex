import { Bot, CircleDot, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import {
  approveResearchPlan,
  createResearchTask,
  executeResearchPlan,
  getResearchCapabilityRegistry,
  getResearchWorkspace,
  listResearchRuns,
  saveResearchPlan,
} from "../../../shared/api/researchAgent";
import type {
  ResearchAgentRun,
  ResearchCapabilityDescriptor,
  ResearchPlanVersion,
  ResearchTask,
  ResearchWorkspaceSnapshot,
} from "../../../shared/types/researchAgent";
import { ResearchEvidenceLedger } from "./ResearchEvidenceLedger";
import { ResearchPlanEditor } from "./ResearchPlanEditor";
import {
  buildStarterResearchPlan,
  editableStepsFromPlan,
  parseEditableResearchPlanSteps,
  type EditableResearchPlanStep,
} from "./researchPlanDraft";

type TranslationFn = (key: MessageKey) => string;

function latestPlanForTask(plans: ResearchPlanVersion[], taskId: string) {
  return plans
    .filter((plan) => plan.taskId === taskId)
    .sort((left, right) => right.version - left.version)[0] ?? null;
}

function runForTask(runs: ResearchAgentRun[], taskId: string) {
  return runs.find((run) => run.taskId === taskId && !run.finishedAt)
    ?? runs.find((run) => run.taskId === taskId)
    ?? null;
}

export function ResearchAgentWorkbench(props: {
  projectId: string | null;
  t: TranslationFn;
}) {
  const { projectId, t } = props;
  const [snapshot, setSnapshot] = useState<ResearchWorkspaceSnapshot | null>(null);
  const [registry, setRegistry] = useState<ResearchCapabilityDescriptor[]>([]);
  const [runs, setRuns] = useState<ResearchAgentRun[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedPlanVersion, setSelectedPlanVersion] = useState<number | null>(null);
  const [steps, setSteps] = useState<EditableResearchPlanStep[]>([]);
  const [goalDraft, setGoalDraft] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [errorKey, setErrorKey] = useState<MessageKey | "">("");
  const [noticeKey, setNoticeKey] = useState<MessageKey | "">("");
  const [dirty, setDirty] = useState(false);
  const [evidenceRefreshToken, setEvidenceRefreshToken] = useState(0);
  const actionRef = useRef("");

  const refresh = useCallback(async (preferredTaskId?: string) => {
    if (!projectId) {
      setSnapshot(null);
      setRegistry([]);
      setRuns([]);
      setSelectedTaskId("");
      return;
    }
    const [nextSnapshot, nextRegistry, nextRuns] = await Promise.all([
      getResearchWorkspace(projectId),
      getResearchCapabilityRegistry(),
      listResearchRuns(projectId, true),
    ]);
    setSnapshot(nextSnapshot);
    setRegistry(nextRegistry);
    setRuns(nextRuns);
    setSelectedTaskId((current) => {
      const preferred = preferredTaskId ?? current;
      return nextSnapshot.tasks.some((task) => task.id === preferred)
        ? preferred
        : nextSnapshot.tasks[0]?.id ?? "";
    });
  }, [projectId]);

  useEffect(() => {
    setSnapshot(null);
    setSelectedTaskId("");
    setErrorKey("");
    setNoticeKey("");
    setBusyAction("refresh");
    actionRef.current = "refresh";
    void refresh()
      .catch(() => setErrorKey("research.workbench.error"))
      .finally(() => {
        if (actionRef.current === "refresh") {
          actionRef.current = "";
          setBusyAction("");
        }
      });
  }, [refresh]);

  const selectedTask = useMemo(
    () => snapshot?.tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, snapshot?.tasks],
  );
  const taskPlans = useMemo(
    () => (snapshot?.plans ?? [])
      .filter((plan) => plan.taskId === selectedTaskId)
      .sort((left, right) => right.version - left.version),
    [selectedTaskId, snapshot?.plans],
  );
  const selectedPlan = useMemo(() => (
    taskPlans.find((plan) => plan.version === selectedPlanVersion)
      ?? taskPlans[0]
      ?? null
  ), [selectedPlanVersion, taskPlans]);

  useEffect(() => {
    const latest = latestPlanForTask(snapshot?.plans ?? [], selectedTaskId);
    setSelectedPlanVersion(latest?.version ?? null);
  }, [selectedTaskId, snapshot?.plans]);

  useEffect(() => {
    setSteps(selectedPlan ? editableStepsFromPlan(selectedPlan.steps) : []);
    setDirty(false);
  }, [selectedPlan?.id, selectedPlan?.version]);

  const runAction = async (action: string, work: () => Promise<void>) => {
    if (actionRef.current) return;
    actionRef.current = action;
    setBusyAction(action);
    setErrorKey("");
    setNoticeKey("");
    try {
      await work();
    } catch (error) {
      setErrorKey(error instanceof SyntaxError
        ? "research.workbench.inputInvalid"
        : "research.workbench.error");
    } finally {
      actionRef.current = "";
      setBusyAction("");
    }
  };

  const createTaskAndPlan = () => {
    const goal = goalDraft.trim();
    if (!projectId || !goal) return;
    void runAction("create", async () => {
      const task = await createResearchTask(projectId, goal);
      const starterSteps = buildStarterResearchPlan(goal, registry);
      if (starterSteps.length === 0) {
        throw new Error("research.capability.registry_empty");
      }
      await saveResearchPlan({
        projectId,
        taskId: task.id,
        sourceMessage: goal,
        authorizedProjectIds: [projectId],
        steps: parseEditableResearchPlanSteps(starterSteps),
      });
      setGoalDraft("");
      await refresh(task.id);
      setNoticeKey("research.workbench.planCreated");
    });
  };

  const savePlan = () => {
    if (!projectId || !selectedTask) return;
    void runAction("save", async () => {
      const saved = await saveResearchPlan({
        projectId,
        taskId: selectedTask.id,
        sourceMessage: selectedTask.goal,
        authorizedProjectIds: [projectId],
        steps: parseEditableResearchPlanSteps(steps),
      });
      await refresh(selectedTask.id);
      setSelectedPlanVersion(saved.version);
      setNoticeKey("research.workbench.planVersionSaved");
    });
  };

  const approvePlan = () => {
    if (!projectId || !selectedTask || !selectedPlan) return;
    void runAction("approve", async () => {
      const approved = await approveResearchPlan(projectId, selectedTask.id, selectedPlan.version);
      await refresh(selectedTask.id);
      setSelectedPlanVersion(approved.version);
      setNoticeKey("research.workbench.planApproved");
    });
  };

  const executePlan = () => {
    if (!projectId || !selectedTask || !selectedPlan) return;
    void runAction("execute", async () => {
      await executeResearchPlan(projectId, selectedTask.id, selectedPlan.version);
      await refresh(selectedTask.id);
      setEvidenceRefreshToken((current) => current + 1);
      setNoticeKey("research.workbench.executionStarted");
    });
  };

  if (!projectId) {
    return (
      <section className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-md">
          <Bot className="mx-auto h-7 w-7 text-[color:var(--app-accent)]" />
          <h2 className="mt-3 text-sm font-semibold text-[color:var(--app-fg)]">{t("research.workbench.noProjectTitle")}</h2>
          <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">{t("research.workbench.noProjectHint")}</p>
        </div>
      </section>
    );
  }

  const tasks = snapshot?.tasks ?? [];
  const busy = Boolean(busyAction);
  const activeRun = selectedTask ? runForTask(runs, selectedTask.id) : null;

  return (
    <section className="grid h-full min-h-0 gap-2 overflow-hidden xl:grid-cols-[15rem_minmax(32rem,1fr)_20rem]" aria-label={t("research.workbench.title")}>
      <aside className="app-material-panel flex min-h-0 flex-col overflow-hidden rounded-lg border">
        <header className="border-b px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-[color:var(--app-fg)]">{t("research.workbench.tasks")}</h2>
            <Button size="icon" variant="ghost" disabled={busy} onClick={() => void runAction("refresh", () => refresh(selectedTaskId))} aria-label={t("research.workbench.refresh")}>
              <RefreshCw className={`h-3.5 w-3.5 ${busyAction === "refresh" ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-[color:var(--app-muted)]">{t("research.workbench.discussionHint")}</p>
        </header>
        <div className="library-scrollbar min-h-0 flex-1 overflow-auto p-1.5">
          {tasks.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] text-[color:var(--app-muted)]">{t("research.workbench.taskEmpty")}</p>
          ) : tasks.map((task) => {
            const run = runForTask(runs, task.id);
            return (
              <button
                key={task.id}
                type="button"
                className={`mb-1 w-full rounded-md border px-2.5 py-2 text-left transition ${selectedTaskId === task.id ? "border-[color:var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_9%,transparent)]" : "border-transparent hover:border-[color:var(--editor-widget-border)]"}`}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <span className="line-clamp-2 text-xs font-medium leading-4 text-[color:var(--app-fg)]">{task.goal}</span>
                <span className="mt-1 flex items-center gap-1 text-[10px] text-[color:var(--app-muted)]">
                  <CircleDot className="h-2.5 w-2.5" />
                  {t(`research.workbench.taskStatus.${task.status}`)}
                  {run ? <span>· {run.completedSteps}/{run.totalSteps}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t p-3">
          <label className="grid gap-1 text-[11px] text-[color:var(--app-muted)]">
            <span>{t("research.workbench.goalLabel")}</span>
            <textarea
              className="app-material-inset min-h-24 resize-none rounded-md border px-2 py-1.5 text-xs leading-5 text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-accent)]"
              value={goalDraft}
              disabled={busy}
              onChange={(event) => setGoalDraft(event.target.value)}
              placeholder={t("research.workbench.goalPlaceholder")}
            />
          </label>
          <Button className="mt-2 w-full" size="sm" disabled={busy || !goalDraft.trim() || registry.length === 0} onClick={createTaskAndPlan}>
            {tasks.length === 0 ? <Sparkles className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {t("research.workbench.createPlan")}
          </Button>
        </div>
      </aside>

      <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
        {errorKey ? <div className="app-status-danger rounded-md border px-3 py-2 text-xs" role="alert">{t(errorKey)}</div> : null}
        {noticeKey ? <div className="app-status-success rounded-md border px-3 py-2 text-xs" role="status">{t(noticeKey)}</div> : null}
        {selectedTask ? (
          <ResearchPlanEditor
            goal={selectedTask.goal}
            plan={selectedPlan}
            versions={taskPlans}
            registry={registry}
            steps={steps}
            busy={busy}
            dirty={dirty}
            onStepsChange={(next) => {
              setSteps(next);
              setDirty(true);
            }}
            onSelectVersion={setSelectedPlanVersion}
            onSave={savePlan}
            onApprove={approvePlan}
            onExecute={executePlan}
            t={t}
          />
        ) : (
          <div className="app-material-panel grid min-h-0 flex-1 place-items-center rounded-lg border px-6 text-center">
            <div className="max-w-md">
              <Sparkles className="mx-auto h-6 w-6 text-[color:var(--app-accent)]" />
              <h2 className="mt-3 text-sm font-semibold text-[color:var(--app-fg)]">{t("research.workbench.emptyTitle")}</h2>
              <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">{t("research.workbench.emptyHint")}</p>
            </div>
          </div>
        )}
        {activeRun ? (
          <div className="app-status-info rounded-md border px-3 py-2 text-[11px]" role="status">
            {t("research.workbench.runProgress")} {activeRun.completedSteps}/{activeRun.totalSteps}
            {activeRun.lastOperation ? ` · ${activeRun.lastOperation}` : ""}
          </div>
        ) : null}
      </div>

      {selectedTask ? (
        <ResearchEvidenceLedger
          projectId={projectId}
          taskId={selectedTask.id}
          refreshToken={evidenceRefreshToken}
          t={t}
        />
      ) : (
        <aside className="app-material-panel hidden rounded-lg border xl:block" />
      )}
    </section>
  );
}
