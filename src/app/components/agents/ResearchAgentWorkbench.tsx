import { Bot, PanelLeft, PanelRight, Sparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import {
  approveResearchPlan,
  executeResearchPlan,
  getResearchCapabilityRegistry,
  getResearchWorkspace,
  listResearchRuns,
  RESEARCH_RUN_CHANGED_EVENT,
  saveResearchPlan,
} from "../../../shared/api/researchAgent";
import type {
  ResearchAgentRun,
  ResearchCapabilityDescriptor,
  ResearchPlanVersion,
  ResearchTask,
  ResearchWorkspaceSnapshot,
} from "../../../shared/types/researchAgent";
import {
  requestOpenChatSession,
  setActiveChatSessionInStore,
} from "../../hooks/chatSessionStore";
import {
  emitOnboardingMilestone,
  ONBOARDING_PLAN_REVIEW_EVENT,
} from "../../onboarding/onboardingState";
import { ResearchEvidenceLedger } from "./ResearchEvidenceLedger";
import { ResearchPlanEditor } from "./ResearchPlanEditor";
import { ResearchTaskSidebar } from "./ResearchTaskSidebar";
import {
  editableStepsFromPlan,
  parseEditableResearchPlanSteps,
  type EditableResearchPlanStep,
} from "./researchPlanDraft";

type TranslationFn = (key: MessageKey) => string;
type ContextTab = "plan" | "evidence";

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
  conversation: ReactNode;
  t: TranslationFn;
}) {
  const { projectId, conversation, t } = props;
  const [snapshot, setSnapshot] = useState<ResearchWorkspaceSnapshot | null>(null);
  const [registry, setRegistry] = useState<ResearchCapabilityDescriptor[]>([]);
  const [runs, setRuns] = useState<ResearchAgentRun[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedPlanVersion, setSelectedPlanVersion] = useState<number | null>(null);
  const [steps, setSteps] = useState<EditableResearchPlanStep[]>([]);
  const [busyAction, setBusyAction] = useState("");
  const [errorKey, setErrorKey] = useState<MessageKey | "">("");
  const [noticeKey, setNoticeKey] = useState<MessageKey | "">("");
  const [dirty, setDirty] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);
  const [contextTab, setContextTab] = useState<ContextTab>("plan");
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
    return nextSnapshot;
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

  useEffect(() => {
    if (!projectId || typeof window === "undefined") return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === projectId) {
        void refresh(selectedTaskId).catch(() => undefined);
      }
    };
    window.addEventListener("latotex.chat.store.changed", onChanged);
    window.addEventListener(RESEARCH_RUN_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener("latotex.chat.store.changed", onChanged);
      window.removeEventListener(RESEARCH_RUN_CHANGED_EVENT, onChanged);
    };
  }, [projectId, refresh, selectedTaskId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTasksOpen(false);
        setContextOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  useEffect(() => {
    if (projectId && contextOpen && contextTab === "plan" && selectedPlan) {
      emitOnboardingMilestone(ONBOARDING_PLAN_REVIEW_EVENT, projectId);
    }
  }, [contextOpen, contextTab, projectId, selectedPlan]);

  const runAction = async (action: string, work: () => Promise<unknown>) => {
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

  const selectTask = (task: ResearchTask) => {
    setSelectedTaskId(task.id);
    if (projectId && task.chatSessionId) {
      setActiveChatSessionInStore(projectId, task.chatSessionId);
      requestOpenChatSession({ projectId, sessionId: task.chatSessionId });
    }
  };

  const savePlan = () => {
    if (!projectId || !selectedTask) return;
    void runAction("save", async () => {
      const saved = await saveResearchPlan({
        projectId,
        taskId: selectedTask.id,
        sourceMessage: selectedTask.goal,
        authorizedProjectIds: [projectId],
        title: selectedPlan?.title,
        summary: selectedPlan?.summary,
        assumptions: selectedPlan?.assumptions,
        expectedArtifacts: selectedPlan?.expectedArtifacts,
        acceptanceCriteria: selectedPlan?.acceptanceCriteria,
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
  const gridClass = tasksOpen && contextOpen
    ? "xl:grid-cols-[15rem_minmax(28rem,1fr)_minmax(28rem,0.9fr)]"
    : tasksOpen
      ? "xl:grid-cols-[15rem_minmax(0,1fr)]"
      : contextOpen
        ? "xl:grid-cols-[minmax(28rem,1fr)_minmax(28rem,0.9fr)]"
        : "xl:grid-cols-1";

  return (
    <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden" aria-label={t("research.workbench.title")}>
      <header className="app-material-panel flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <Button size="sm" variant={tasksOpen ? "secondary" : "ghost"} aria-expanded={tasksOpen} aria-controls="research-task-drawer" onClick={() => setTasksOpen((value) => !value)}>
          <PanelLeft className="h-3.5 w-3.5" />
          {t(tasksOpen ? "research.workbench.tasksClose" : "research.workbench.tasksOpen")}
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xs font-semibold text-[color:var(--app-text)]">{t("research.workbench.conversationTitle")}</h2>
          <p className="truncate text-[10px] text-[color:var(--app-muted)]">{t("research.workbench.conversationHint")}</p>
        </div>
        {activeRun ? (
          <span className="app-status-info rounded border px-2 py-1 text-[10px]" role="status">
            {t("research.workbench.runProgress")} {activeRun.completedSteps}/{activeRun.totalSteps}
          </span>
        ) : null}
        <Button size="sm" variant={contextOpen ? "secondary" : "ghost"} aria-expanded={contextOpen} aria-controls="research-context-drawer" onClick={() => setContextOpen((value) => !value)}>
          <PanelRight className="h-3.5 w-3.5" />
          {t(contextOpen ? "research.workbench.contextClose" : "research.workbench.contextOpen")}
        </Button>
      </header>

      {errorKey ? <div className="app-status-danger rounded-md border px-3 py-2 text-xs" role="alert">{t(errorKey)}</div> : null}
      {noticeKey ? <div className="app-status-success rounded-md border px-3 py-2 text-xs" role="status">{t(noticeKey)}</div> : null}

      <div className={`relative grid min-h-0 flex-1 gap-2 overflow-hidden ${gridClass}`}>
        <aside id="research-task-drawer" className={`${tasksOpen ? "flex" : "hidden"} app-material-panel absolute inset-y-0 left-0 z-20 w-[min(19rem,88vw)] min-h-0 flex-col overflow-hidden rounded-lg border shadow-lg xl:static xl:w-auto xl:shadow-none`}>
          <ResearchTaskSidebar
            tasks={tasks}
            runs={runs}
            selectedTaskId={selectedTaskId}
            busy={busy}
            refreshing={busyAction === "refresh"}
            onRefresh={() => void runAction("refresh", () => refresh(selectedTaskId))}
            onSelectTask={selectTask}
            t={t}
          />
        </aside>

        <main className="min-h-0 min-w-0 overflow-hidden">{conversation}</main>

        <aside id="research-context-drawer" className={`${contextOpen ? "flex" : "hidden"} app-material-panel absolute inset-y-0 right-0 z-30 w-[min(44rem,94vw)] min-h-0 flex-col overflow-hidden rounded-lg border shadow-lg xl:static xl:w-auto xl:shadow-none`}>
          <div className="app-material-inset m-2 inline-flex self-start rounded-md border p-0.5" role="tablist" aria-label={t("research.workbench.contextOpen")}>
            {(["plan", "evidence"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={contextTab === tab}
                className={`rounded px-3 py-1.5 text-[11px] font-medium ${contextTab === tab ? "bg-[color:var(--app-accent)] text-white" : "text-[color:var(--app-muted)]"}`}
                onClick={() => setContextTab(tab)}
              >
                {t(tab === "plan" ? "research.workbench.contextPlan" : "research.workbench.contextEvidence")}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
            {selectedTask ? (
              contextTab === "plan" ? (
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
                <ResearchEvidenceLedger projectId={projectId} taskId={selectedTask.id} refreshToken={evidenceRefreshToken} t={t} />
              )
            ) : (
              <div className="grid h-full place-items-center px-6 text-center">
                <div className="max-w-sm">
                  <Sparkles className="mx-auto h-5 w-5 text-[color:var(--app-accent)]" aria-hidden="true" />
                  <p className="mt-2 text-xs leading-5 text-[color:var(--app-muted)]">{t("research.workbench.taskEmptyComposer")}</p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
