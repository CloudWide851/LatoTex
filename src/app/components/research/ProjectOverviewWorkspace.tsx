import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  BookOpenText,
  Check,
  Circle,
  FilePenLine,
  FlaskConical,
  PackageCheck,
  RefreshCw,
  Target,
} from "lucide-react";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type {
  AppSettings,
  OnboardingStep,
  ResearchDomain,
  ResourceNode,
  WorkspacePage,
} from "../../../shared/types/app";
import type {
  EvidencePacket,
  ResearchAgentRun,
  ResearchTask,
  ResearchWorkspaceSnapshot,
} from "../../../shared/types/researchAgent";
import {
  getResearchWorkspace,
  listResearchEvidence,
  listResearchRuns,
} from "../../../shared/api/researchAgent";
import { requestSettingsSection } from "../../settings/settingsNavigation";
import { cn } from "../../../lib/utils";
import { ResearchOnboardingPanel } from "./ResearchOnboardingPanel";

type TranslationFn = (key: MessageKey) => string;

type OverviewState = {
  snapshot: ResearchWorkspaceSnapshot;
  currentTask: ResearchTask | null;
  evidence: EvidencePacket[];
  runs: ResearchAgentRun[];
};

const EMPTY_OVERVIEW: OverviewState = {
  snapshot: { tasks: [], plans: [], chatStore: { sessions: [], activeSessionId: null, migrationCompleted: false, diagnosticCode: null } },
  currentTask: null,
  evidence: [],
  runs: [],
};

function countLiterature(nodes: ResourceNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.kind === "directory") {
      return total + countLiterature(node.children);
    }
    return total + (/\.(bib|pdf)$/i.test(node.relativePath) ? 1 : 0);
  }, 0);
}

function resolvePhase(task: ResearchTask | null): "discuss" | "plan" | "execute" | "verify" | "deliver" {
  if (!task || task.status === "discussion" || task.status === "failed" || task.status === "cancelled") {
    return "discuss";
  }
  if (task.status === "plan_pending") {
    return "plan";
  }
  if (task.status === "execution" || task.status === "approval_paused") {
    return "execute";
  }
  return task.status === "validation" ? "verify" : "deliver";
}

const NEXT_MESSAGE_KEY: Record<ReturnType<typeof resolvePhase>, MessageKey> = {
  discuss: "overview.next.goal",
  plan: "overview.next.plan",
  execute: "overview.next.execute",
  verify: "overview.next.verify",
  deliver: "overview.next.deliver",
};

function MetricCard(props: { label: string; value: string; status: string; active?: boolean }) {
  return (
    <article className="app-material-inset min-w-0 rounded-lg border p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--app-muted)]">
        {props.label}
      </p>
      <p className="mt-2 truncate text-lg font-semibold text-[color:var(--app-text)]">{props.value}</p>
      <p className={cn(
        "mt-1 text-xs",
        props.active ? "text-[color:var(--app-accent)]" : "text-[color:var(--app-muted)]",
      )}>
        {props.status}
      </p>
    </article>
  );
}

export function ProjectOverviewWorkspace(props: {
  projectId: string;
  libraryTree: ResourceNode[];
  compileDiagnostics: string[];
  compiledPdfUrl: string | null;
  settings: AppSettings | null;
  chatAgentModelId: string | null;
  onPageChange: (page: WorkspacePage) => void;
  onOnboardingDismiss: () => void;
  onOnboardingRestart: () => void;
  onOnboardingRecordStep: (step: OnboardingStep) => void;
  onProjectGoalSave: (goal: string) => void;
  onResearchDomainChange: (domain: ResearchDomain) => void;
  onResearchPrivacyReview: () => void;
  t: TranslationFn;
}) {
  const {
    projectId,
    libraryTree,
    compileDiagnostics,
    compiledPdfUrl,
    settings,
    chatAgentModelId,
    onPageChange,
    onOnboardingDismiss,
    onOnboardingRestart,
    onOnboardingRecordStep,
    onProjectGoalSave,
    onResearchDomainChange,
    onResearchPrivacyReview,
    t,
  } = props;
  const [overview, setOverview] = useState<OverviewState>(EMPTY_OVERVIEW);
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshSequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    refreshSequenceRef.current += 1;
    const refreshSequence = refreshSequenceRef.current;
    setLoading(true);
    setError(false);
    try {
      const [snapshot, runs] = await Promise.all([
        getResearchWorkspace(projectId),
        listResearchRuns(projectId, true),
      ]);
      const currentTask = [...snapshot.tasks]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
      const evidence = currentTask
        ? await listResearchEvidence(projectId, currentTask.id)
        : [];
      if (refreshSequence !== refreshSequenceRef.current) {
        return;
      }
      setOverview({ snapshot, currentTask, evidence, runs });
    } catch {
      if (refreshSequence === refreshSequenceRef.current) {
        setError(true);
      }
    } finally {
      if (refreshSequence === refreshSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequenceRef.current += 1;
    };
  }, [refresh]);

  const savedGoal = settings?.uiPrefs?.researchGoalByProject?.[projectId]?.trim() ?? "";
  useEffect(() => {
    setGoal(savedGoal);
  }, [projectId, savedGoal]);

  const activeRun = overview.runs.find((run) => !["completed", "failed", "cancelled"].includes(run.status));
  const phase = resolvePhase(overview.currentTask);
  const phases = ["discuss", "plan", "execute", "verify", "deliver"] as const;
  const activePhaseIndex = phases.indexOf(phase);
  const literatureCount = useMemo(() => countLiterature(libraryTree), [libraryTree]);
  const modelConfigured = Boolean(chatAgentModelId || settings?.agentBindings.some((binding) => binding.modelId));
  const privacyReviewed = settings?.uiPrefs?.researchPrivacyReviewedByProject?.[projectId] === true;
  const questionAsked = overview.snapshot.tasks.some((task) => Boolean(task.chatSessionId));
  const planAvailable = overview.snapshot.plans.length > 0;

  const recordGoal = () => {
    const nextGoal = goal.trim();
    if (!nextGoal || nextGoal === savedGoal) {
      return;
    }
    onProjectGoalSave(nextGoal);
  };

  const openSettings = (section: "models" | "agent-permissions") => {
    requestSettingsSection(section);
    onPageChange("settings");
  };

  const nextKey = overview.currentTask
    ? NEXT_MESSAGE_KEY[phase]
    : savedGoal
      ? "overview.next.plan"
      : "overview.next.goal";
  const actions: Array<{ page: WorkspacePage; label: string; icon: typeof BookOpenText }> = [
    { page: "library", label: t("overview.actions.literature"), icon: BookOpenText },
    { page: "latex", label: t("overview.actions.writing"), icon: FilePenLine },
    { page: "analysis", label: t("overview.actions.analysis"), icon: FlaskConical },
    { page: "submission", label: t("overview.actions.submission"), icon: PackageCheck },
  ];

  return (
    <section className="h-full overflow-auto bg-[color:var(--editor-paper-bg)] p-4 sm:p-6">
      <div className="mx-auto grid max-w-6xl gap-5">
        <header className="border-b border-[color:var(--app-border)] pb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--app-accent)]">
            {t("overview.eyebrow")}
          </p>
          <h1 className="mt-2 max-w-3xl text-2xl font-semibold leading-tight text-[color:var(--app-text)] sm:text-3xl">
            {t("overview.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)]">
            {t("overview.description")}
          </p>
        </header>

        {loading ? (
          <div role="status" aria-live="polite" className="app-material-inset flex min-h-28 items-center justify-center rounded-lg border text-sm text-[color:var(--app-muted)]">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            {t("overview.loading")}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="app-status-danger flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>{t("overview.error")}</span>
            <button type="button" className="control-button control-button--secondary px-3 py-1.5" onClick={() => void refresh()}>
              {t("overview.retry")}
            </button>
          </div>
        ) : null}

        {!loading ? (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
              <article className="app-material-shell rounded-lg border p-4 sm:p-5">
                <div className="flex items-center gap-2 text-[color:var(--app-muted)]">
                  <Target className="h-4 w-4" />
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">{t("overview.goal.label")}</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  {!savedGoal ? <p className="text-sm text-[color:var(--app-muted)]">{t("overview.goal.empty")}</p> : null}
                  <textarea
                    value={goal}
                    onChange={(event) => setGoal(event.currentTarget.value)}
                    rows={3}
                    aria-label={t("overview.goal.label")}
                    className="w-full resize-y rounded-md border border-[color:var(--app-border)] bg-[color:var(--editor-widget-bg)] px-3 py-2 text-sm leading-6 text-[color:var(--app-text)] outline-none focus:border-[color:var(--app-accent)]"
                    placeholder={t("overview.goal.placeholder")}
                  />
                  <button
                    type="button"
                    className="control-button control-button--primary w-fit px-3 py-1.5 text-sm"
                    disabled={!goal.trim() || goal.trim() === savedGoal}
                    onClick={recordGoal}
                  >
                    {t("overview.goal.create")}
                  </button>
                </div>
              </article>

              <article className="app-material-shell rounded-lg border p-4 sm:p-5">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--app-muted)]">
                  {t("overview.next.title")}
                </h2>
                <p className="mt-4 text-sm leading-6 text-[color:var(--app-text)]">{t(nextKey)}</p>
                <button
                  type="button"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[color:var(--app-accent)]"
                  onClick={() => onPageChange(overview.currentTask ? (phase === "deliver" ? "submission" : "agents") : "agents")}
                >
                  {t("overview.next.openAgent")}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </article>
            </div>

            <article className="app-material-shell rounded-lg border p-4 sm:p-5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--app-muted)]">
                {t("overview.progress.title")}
              </h2>
              <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {phases.map((item, index) => {
                  const reached = index <= activePhaseIndex;
                  return (
                    <li key={item} className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
                      reached
                        ? "border-[color:var(--app-accent)] text-[color:var(--app-text)]"
                        : "border-[color:var(--app-border)] text-[color:var(--app-muted)]",
                    )}>
                      {reached ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                      {t(`overview.phase.${item}`)}
                    </li>
                  );
                })}
              </ol>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label={t("overview.metric.literature")} value={String(literatureCount)} status={t("overview.status.ready")} />
                <MetricCard label={t("overview.metric.evidence")} value={String(overview.evidence.length)} status={overview.evidence.length ? t("overview.status.ready") : t("overview.status.idle")} />
                <MetricCard label={t("overview.metric.compile")} value={compileDiagnostics.length ? String(compileDiagnostics.length) : "—"} status={compileDiagnostics.length ? t("overview.status.attention") : (compiledPdfUrl ? t("overview.status.ready") : t("overview.status.idle"))} />
                <MetricCard label={t("overview.metric.agent")} value={activeRun ? `${activeRun.completedSteps}/${activeRun.totalSteps}` : "—"} status={activeRun ? t("overview.status.active") : t("overview.status.idle")} active={Boolean(activeRun)} />
              </div>
            </article>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <ResearchOnboardingPanel
                projectId={projectId}
                settings={settings}
                modelConfigured={modelConfigured}
                privacyReviewed={privacyReviewed}
                questionAsked={questionAsked}
                planAvailable={planAvailable}
                onDismiss={onOnboardingDismiss}
                onRestart={onOnboardingRestart}
                onRecordStep={onOnboardingRecordStep}
                onResearchDomainChange={onResearchDomainChange}
                onOpenPrivacy={() => {
                  onResearchPrivacyReview();
                  openSettings("agent-permissions");
                }}
                onOpenModels={() => openSettings("models")}
                onOpenAgent={() => onPageChange("agents")}
                t={t}
              />

              <article className="app-material-shell rounded-lg border p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-[color:var(--app-accent)]" />
                  <h2 className="text-sm font-semibold text-[color:var(--app-text)]">{t("overview.actions.title")}</h2>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.page}
                        type="button"
                        className="app-material-inset flex items-center gap-3 rounded-md border p-3 text-left text-sm text-[color:var(--app-text)] transition hover:border-[color:var(--app-accent)]"
                        onClick={() => onPageChange(action.page)}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-[color:var(--app-accent)]" />
                        <span className="min-w-0 flex-1">{action.label}</span>
                        <ArrowRight className="h-4 w-4 text-[color:var(--app-muted)]" />
                      </button>
                    );
                  })}
                </div>
              </article>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
