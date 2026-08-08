import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  FileLock2,
  Pause,
  Play,
  ShieldAlert,
  Square,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { ResearchAgentRuntimeProjection } from "../../hooks/useResearchAgentRuntime";
import { cn } from "../../../lib/utils";

type TranslationFn = (key: MessageKey) => string;

function formatElapsed(startedAt: string, now: number): string {
  const started = Date.parse(startedAt);
  const seconds = Number.isFinite(started)
    ? Math.max(0, Math.floor((now - started) / 1_000))
    : 0;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function ResearchAgentGlobalStatus(props: {
  runtime: ResearchAgentRuntimeProjection;
  onOpenAgent: () => void;
  onJumpToResource: (path: string) => void;
  t: TranslationFn;
}) {
  const { runtime, onOpenAgent, onJumpToResource, t } = props;
  const { primaryRun, primaryTaskGoal, approvals, locks } = runtime;
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [actionFailed, setActionFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const jumpRef = useRef(onJumpToResource);
  jumpRef.current = onJumpToResource;

  useEffect(() => {
    if (!primaryRun) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [primaryRun]);

  const currentLock = useMemo(() => {
    if (!primaryRun) return null;
    return locks.find((lock) => lock.runId === primaryRun.runId && lock.mode === "write")
      ?? locks.find((lock) => lock.runId === primaryRun.runId)
      ?? null;
  }, [locks, primaryRun]);
  const currentResource = currentLock?.resourcePath ?? null;
  const followKey = `${primaryRun?.currentStepId ?? ""}:${currentResource ?? ""}`;

  useEffect(() => {
    if (following && currentResource) {
      jumpRef.current(currentResource);
    }
  }, [currentResource, followKey, following]);

  useEffect(() => {
    if (!primaryRun) {
      setExpanded(false);
      setFollowing(false);
      setBusyAction("");
      setActionFailed(false);
    }
  }, [primaryRun]);

  if (!primaryRun || typeof document === "undefined") {
    return null;
  }

  const paused = primaryRun.status.includes("pause");
  const progress = primaryRun.totalSteps > 0
    ? Math.max(0, Math.min(100, (primaryRun.completedSteps / primaryRun.totalSteps) * 100))
    : 0;
  const approval = approvals.find((item) => item.runId === primaryRun.runId) ?? null;
  const runAction = async (label: string, action: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(label);
    setActionFailed(false);
    try {
      await action();
    } catch {
      setActionFailed(true);
    } finally {
      setBusyAction("");
    }
  };

  return createPortal(
    <>
      <div
        aria-hidden="true"
        data-research-agent-frame="active"
        className="pointer-events-none fixed inset-1 z-[400] rounded-[calc(var(--app-panel-radius,12px)+2px)] border-2 border-[color:var(--app-accent)] opacity-70 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--app-accent)_22%,transparent)] motion-reduce:transition-none"
      />
      <section
        aria-label={t("research.agent.frameLabel")}
        className="app-material-floating fixed right-3 top-14 z-[410] w-[min(23rem,calc(100vw-1.5rem))] rounded-lg border border-[color:var(--app-accent)] p-3 shadow-lg motion-card-pop motion-reduce:transition-none"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[color:var(--app-accent)] text-[color:var(--app-accent)]">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-[color:var(--app-text)]">
                {t("research.agent.statusTitle")}
              </h2>
              <span className={cn(
                "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                paused
                  ? "app-status-warning"
                  : "border-[color:var(--app-accent)] text-[color:var(--app-accent)]",
              )} aria-live="polite">
                {t(paused ? "research.agent.statusPaused" : "research.agent.statusWorking")}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[color:var(--app-muted)]">
              {primaryTaskGoal || t("research.agent.taskFallback")}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t(expanded ? "research.agent.collapse" : "research.agent.expand")}
            title={t(expanded ? "research.agent.collapse" : "research.agent.expand")}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[color:var(--editor-paper-edge)]">
          <div
            className="h-full rounded-full bg-[color:var(--app-accent)] transition-[width] motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-[color:var(--app-muted)]">
          <span>{t("research.agent.progress")} {primaryRun.completedSteps}/{primaryRun.totalSteps}</span>
          <span>{t("research.agent.elapsed")} {formatElapsed(primaryRun.startedAt, now)}</span>
          <span>{t("research.agent.evidence")} {primaryRun.evidenceCount}</span>
        </div>

        {expanded ? (
          <div className="mt-3 grid gap-2 border-t border-[color:var(--app-border)] pt-3 text-xs">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--app-muted)]">
                {t("research.agent.currentStep")}
              </p>
              <p className="mt-1 break-words text-[color:var(--app-text)]">
                {primaryRun.currentStepId || t("research.agent.operationFallback")}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--app-muted)]">
                {t("research.agent.lastOperation")}
              </p>
              <p className="mt-1 break-words text-[color:var(--app-text)]">
                {primaryRun.lastOperation || t("research.agent.operationFallback")}
              </p>
            </div>
            {currentResource ? (
              <button
                type="button"
                className="app-material-inset flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[color:var(--app-text)]"
                onClick={() => jumpRef.current(currentResource)}
              >
                <FileLock2 className="h-3.5 w-3.5 shrink-0 text-[color:var(--app-accent)]" />
                <span className="min-w-0 flex-1 truncate">{currentResource}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[color:var(--app-muted)]" />
              </button>
            ) : null}
            {approval ? (
              <div className="app-status-warning rounded-md border p-2.5">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="h-4 w-4" />
                  {t("research.agent.approvalRequired")}
                </div>
                <p className="mt-1 break-words text-[11px]">{approval.commandSummary}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={Boolean(busyAction)}
                    onClick={() => void runAction("approve", () => runtime.resolveApproval(approval.approvalId, "approved"))}
                  >
                    {t("research.agent.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(busyAction)}
                    onClick={() => void runAction("reject", () => runtime.resolveApproval(approval.approvalId, "rejected"))}
                  >
                    {t("research.agent.reject")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {actionFailed ? (
          <p role="alert" className="mt-2 text-xs text-[color:var(--app-status-danger)]">
            {t("research.agent.actionFailed")}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(busyAction)}
            onClick={() => void runAction(paused ? "resume" : "pause", () => (
              paused ? runtime.resumeRun(primaryRun.runId) : runtime.pauseRun(primaryRun.runId)
            ))}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {t(paused ? "research.agent.resume" : "research.agent.pause")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={Boolean(busyAction)}
            onClick={() => void runAction("stop", () => runtime.cancelRun(primaryRun.runId))}
          >
            <Square className="h-3 w-3" />
            {t("research.agent.stop")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpenAgent}>
            <ExternalLink className="h-3.5 w-3.5" />
            {t("research.agent.open")}
          </Button>
          {currentResource ? (
            <Button
              size="sm"
              variant={following ? "default" : "ghost"}
              aria-pressed={following}
              onClick={() => setFollowing((value) => !value)}
            >
              <Eye className="h-3.5 w-3.5" />
              {t(following ? "research.agent.followOn" : "research.agent.follow")}
            </Button>
          ) : null}
        </div>
      </section>
    </>,
    document.body,
  );
}
