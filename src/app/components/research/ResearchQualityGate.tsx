import { AlertTriangle, CheckCircle2, Loader2, MessageSquareReply, ShieldCheck, XCircle } from "lucide-react";
import type {
  ResearchQualityLane,
  ResearchQualityReport,
  ResearchQualityStatus,
} from "../../hooks/researchQualityGate";

type TranslationFn = (key: any) => string;

function formatMessage(template: string, params: Record<string, string | number | undefined> = {}) {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );
}

function laneTitleKey(id: ResearchQualityLane["id"]): string {
  return `research.quality.lane.${id}`;
}

function statusLabelKey(status: ResearchQualityStatus): string {
  return `research.quality.status.${status}`;
}

function statusClass(status: ResearchQualityStatus): string {
  if (status === "fail") {
    return "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-300";
  }
  if (status === "warn") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function StatusIcon(props: { status: ResearchQualityStatus }) {
  if (props.status === "fail") {
    return <XCircle className="h-3.5 w-3.5 shrink-0" />;
  }
  if (props.status === "warn") {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0" />;
  }
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />;
}

export function ResearchQualityGate(props: {
  report: ResearchQualityReport;
  loading: boolean;
  activeLane: ResearchQualityLane["id"] | null;
  rebuttalOpen: boolean;
  onLaneSelect: (lane: ResearchQualityLane["id"]) => void;
  t: TranslationFn;
}) {
  const { report, loading, activeLane, rebuttalOpen, onLaneSelect, t } = props;
  return (
    <div className="mt-2 border-t border-[color:var(--editor-widget-border)] pt-2">
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-[color:var(--editor-tab-text)]">
            {t("research.quality.title")}
          </div>
          <div className="truncate text-[10px] text-[color:var(--editor-tab-muted)]">
            {formatMessage(t("research.quality.summary"), {
              blockers: report.readiness.blockers,
              warnings: report.readiness.warnings,
              passed: report.readiness.passedLanes,
              total: report.readiness.totalLanes,
            })}
          </div>
        </div>
        {loading ? (
          <div className="flex shrink-0 items-center gap-1 text-[10px] text-[color:var(--editor-tab-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{t("research.quality.loading")}</span>
          </div>
        ) : (
          <div className="shrink-0 rounded border border-[color:var(--editor-widget-border)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--editor-tab-text)]">
            {formatMessage(t("research.quality.score"), { score: report.readiness.score })}
          </div>
        )}
      </div>
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] px-2 py-1.5 text-[10px] text-[color:var(--editor-tab-muted)]">
        <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-[color:var(--editor-tab-text)]">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[color:var(--app-accent)]" />
          <span className="truncate">{t("research.quality.localAudit.title")}</span>
        </span>
        <span className="min-w-0">
          {formatMessage(t("research.quality.localAudit.summary"), {
            citations: report.citationTrust.items.length,
            blockers: report.readiness.blockers,
            warnings: report.readiness.warnings,
          })}
        </span>
        <span className="rounded border border-[color:var(--editor-widget-border)] px-1.5 py-0.5">
          {t("research.quality.localAudit.trace")}
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-[repeat(4,minmax(0,1fr))] gap-1.5 max-[960px]:grid-cols-2">
        {report.lanes.map((lane) => (
          <button
            key={lane.id}
            type="button"
            className={[
              "min-w-0 rounded-md border px-2 py-1.5 text-left transition-colors",
              activeLane === lane.id ? "ring-1 ring-[color:var(--app-accent)]" : "",
              "hover:border-[color:var(--app-accent)]",
              statusClass(lane.status),
            ].join(" ")}
            onClick={() => onLaneSelect(lane.id)}
            aria-pressed={lane.id === "rebuttal" ? rebuttalOpen : undefined}
          >
            <div className="flex min-w-0 items-center justify-between gap-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                {lane.id === "rebuttal" ? (
                  <MessageSquareReply className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <StatusIcon status={lane.status} />
                )}
                <span className="truncate text-[11px] font-semibold">{t(laneTitleKey(lane.id))}</span>
              </div>
              <span className="shrink-0 text-[9px] uppercase">{t(statusLabelKey(lane.status))}</span>
            </div>
            <div className="mt-1 line-clamp-2 min-h-[28px] text-[10px] leading-3 opacity-85">
              {formatMessage(t(lane.message.key), lane.message.params)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
