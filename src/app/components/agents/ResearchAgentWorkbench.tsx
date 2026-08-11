import { Bot, Sparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { InfoHint } from "../../../components/ui/info-hint";
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
import type { AgentWorkspaceLayoutPrefs, AgentWorkspaceInspectorTab } from "../../../shared/types/app";
import {
  requestOpenChatSession,
  setActiveChatSessionInStore,
} from "../../hooks/chatSessionStore";
import { ResearchEvidenceLedger } from "./ResearchEvidenceLedger";
import { ResearchPlanEditor } from "./ResearchPlanEditor";
import { ResearchTaskSidebar } from "./ResearchTaskSidebar";
import {
  editableStepsFromPlan,
  parseEditableResearchPlanSteps,
  type EditableResearchPlanStep,
} from "./researchPlanDraft";
import { mergeAgentWorkspaceVisibleLayout } from "../../settings/agentWorkspaceSettings";

type TranslationFn = (key: MessageKey) => string;
export type AgentCompactDrawer = "tasks" | "inspector" | null;
export type ResearchWorkbenchRunProgress = {
  completedSteps: number;
  totalSteps: number;
};

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
  layoutPrefs: Required<AgentWorkspaceLayoutPrefs>;
  desktopLayout: boolean;
  compactDrawer: AgentCompactDrawer;
  onCompactDrawerChange: (drawer: AgentCompactDrawer) => void;
  onLayoutPrefsChange: (prefs: AgentWorkspaceLayoutPrefs) => void;
  onRunProgressChange: (progress: ResearchWorkbenchRunProgress | null) => void;
  t: TranslationFn;
}) {
  const {
    projectId,
    conversation,
    layoutPrefs,
    desktopLayout,
    compactDrawer,
    onCompactDrawerChange,
    onLayoutPrefsChange,
    onRunProgressChange,
    t,
  } = props;
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
      if (event.key === "Escape" && !desktopLayout && compactDrawer) {
        onCompactDrawerChange(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compactDrawer, desktopLayout, onCompactDrawerChange]);

  const selectedTask = useMemo(
    () => snapshot?.tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, snapshot?.tasks],
  );
  const activeRun = selectedTask ? runForTask(runs, selectedTask.id) : null;

  useEffect(() => {
    onRunProgressChange(activeRun ? {
      completedSteps: activeRun.completedSteps,
      totalSteps: activeRun.totalSteps,
    } : null);
    return () => onRunProgressChange(null);
  }, [activeRun, onRunProgressChange]);
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
    if (!desktopLayout) {
      onCompactDrawerChange(null);
    }
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

  const tasks = snapshot?.tasks ?? [];
  const busy = Boolean(busyAction);
  const renderTaskSidebar = () => (
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
  );
  const selectInspectorTab = (tab: AgentWorkspaceInspectorTab) => {
    onLayoutPrefsChange({ ...layoutPrefs, inspectorTab: tab });
  };
  const renderInspector = () => (
    <>
      <div className="app-material-inset m-2 inline-flex self-start rounded-md border p-0.5" role="tablist" aria-label={t("research.workbench.contextOpen")}>
        {(["plan", "evidence"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={layoutPrefs.inspectorTab === tab}
            className={`rounded px-3 py-1.5 text-[11px] font-medium ${layoutPrefs.inspectorTab === tab ? "bg-[color:var(--app-accent)] text-white" : "text-[color:var(--app-muted)] hover:text-[color:var(--app-fg)]"}`}
            onClick={() => selectInspectorTab(tab)}
          >
            {t(tab === "plan" ? "research.workbench.contextPlan" : "research.workbench.contextEvidence")}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
        {selectedTask ? (
          layoutPrefs.inspectorTab === "plan" ? (
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
            <ResearchEvidenceLedger
              projectId={projectId ?? ""}
              taskId={selectedTask.id}
              refreshToken={evidenceRefreshToken}
              t={t}
            />
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
    </>
  );

  if (!projectId) {
    return (
      <section className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-md">
          <Bot className="mx-auto h-7 w-7 text-[color:var(--app-accent)]" />
          <div className="mt-3 flex items-center justify-center gap-1">
            <h2 className="text-sm font-semibold text-[color:var(--app-fg)]">{t("research.workbench.noProjectTitle")}</h2>
            <InfoHint content={t("research.workbench.noProjectHint")} label={t("research.workbench.noProjectTitle")} />
          </div>
        </div>
      </section>
    );
  }

  const tasksOpen = layoutPrefs.tasksOpen;
  const inspectorOpen = layoutPrefs.inspectorOpen;
  const [tasksSize, , inspectorSize] = layoutPrefs.panelSizes;
  const conversationSize = 100
    - (tasksOpen ? tasksSize : 0)
    - (inspectorOpen ? inspectorSize : 0);
  const handleDesktopLayout = (visibleLayout: number[]) => {
    const panelSizes = mergeAgentWorkspaceVisibleLayout(layoutPrefs, visibleLayout);
    if (panelSizes.some((value, index) => value !== layoutPrefs.panelSizes[index])) {
      onLayoutPrefsChange({ ...layoutPrefs, panelSizes });
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden" aria-label={t("research.workbench.title")}>
      {errorKey ? <div className="app-status-danger rounded-md border px-3 py-2 text-xs" role="alert">{t(errorKey)}</div> : null}
      {noticeKey ? <div className="app-status-success rounded-md border px-3 py-2 text-xs" role="status">{t(noticeKey)}</div> : null}

      {desktopLayout ? (
        <PanelGroup
          key={`${projectId}:${tasksOpen ? "tasks" : "no-tasks"}:${inspectorOpen ? "inspector" : "no-inspector"}`}
          direction="horizontal"
          className="min-h-0 flex-1 gap-px overflow-hidden"
          onLayout={handleDesktopLayout}
        >
          {tasksOpen ? (
            <>
              <Panel id={`agent-tasks-${projectId}`} order={1} defaultSize={tasksSize} minSize={14} maxSize={28} className="min-w-0">
                <aside id="research-task-drawer" className="app-material-panel flex h-full min-h-0 flex-col overflow-hidden rounded-l-lg border">
                  {renderTaskSidebar()}
                </aside>
              </Panel>
              <PanelResizeHandle className="resizable-handle" />
            </>
          ) : null}
          <Panel
            id={`agent-conversation-${projectId}`}
            order={tasksOpen ? 2 : 1}
            defaultSize={conversationSize}
            minSize={38}
            className="min-w-0"
          >
            <main className="h-full min-h-0 min-w-0 overflow-hidden">{conversation}</main>
          </Panel>
          {inspectorOpen ? (
            <>
              <PanelResizeHandle className="resizable-handle" />
              <Panel
                id={`agent-inspector-${projectId}`}
                order={tasksOpen ? 3 : 2}
                defaultSize={inspectorSize}
                minSize={24}
                maxSize={42}
                className="min-w-0"
              >
                <aside id="research-context-drawer" className="app-material-panel flex h-full min-h-0 flex-col overflow-hidden rounded-r-lg border">
                  {renderInspector()}
                </aside>
              </Panel>
            </>
          ) : null}
        </PanelGroup>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <main className="h-full min-h-0 min-w-0 overflow-hidden">{conversation}</main>
          {compactDrawer ? (
            <button
              type="button"
              className="absolute inset-0 z-20 cursor-default bg-slate-950/20"
              aria-label={t(compactDrawer === "tasks" ? "research.workbench.tasksClose" : "research.workbench.contextClose")}
              onClick={() => onCompactDrawerChange(null)}
            />
          ) : null}
          {compactDrawer === "tasks" ? (
            <aside id="research-task-drawer" className="app-material-floating absolute inset-y-0 left-0 z-30 flex w-[min(22rem,92vw)] min-h-0 flex-col overflow-hidden rounded-r-lg border shadow-xl">
              {renderTaskSidebar()}
            </aside>
          ) : null}
          {compactDrawer === "inspector" ? (
            <aside id="research-context-drawer" className="app-material-floating absolute inset-y-0 right-0 z-30 flex w-[min(42rem,96vw)] min-h-0 flex-col overflow-hidden rounded-l-lg border shadow-xl">
              {renderInspector()}
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}
