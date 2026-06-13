import { AlertTriangle, CheckCircle2, FileWarning, MessageSquareReply, Wrench, XCircle } from "lucide-react";
import type {
  CitationTrustItem,
  ResearchQualityLaneId,
  ResearchQualityReport,
  ResearchQualityStatus,
} from "../../hooks/researchQualityGate";
import type { SubmissionIssue } from "../../hooks/researchSubmissionCheck";
import { SubmissionPackPanel } from "./SubmissionPackPanel";

type TranslationFn = (key: any) => string;

function formatMessage(template: string, params: Record<string, string | number | undefined> = {}) {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );
}

function statusClass(status: ResearchQualityStatus): string {
  if (status === "fail") {
    return "text-red-600 dark:text-red-300";
  }
  if (status === "warn") {
    return "text-amber-700 dark:text-amber-300";
  }
  return "text-emerald-700 dark:text-emerald-300";
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

function issueLabel(t: TranslationFn, issue: SubmissionIssue): string {
  return formatMessage(t(`research.submission.issue.${issue.id}`), {
    count: issue.count ?? "",
    detail: issue.detail ?? "",
  });
}

function evidenceLabel(t: TranslationFn, evidence: string): string {
  const key = evidence === "author-year" ? "authorYear" : evidence;
  return t(`research.quality.evidence.${key}`);
}

function CitationRow(props: { item: CitationTrustItem; t: TranslationFn }) {
  const { item, t } = props;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(80px,0.7fr)_minmax(120px,1fr)_minmax(140px,1.1fr)] gap-2 border-t border-[color:var(--editor-widget-border)] py-1.5 text-[11px] max-[760px]:grid-cols-1">
      <div className={["flex min-w-0 items-center gap-1.5 font-semibold", statusClass(item.status)].join(" ")}>
        <StatusIcon status={item.status} />
        <span className="truncate">{item.key}</span>
      </div>
      <div className="min-w-0 truncate text-[color:var(--editor-tab-muted)]">
        {item.sourcePath ?? t("research.quality.detail.missingSource")}
      </div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {(item.evidence.length > 0 ? item.evidence : ["missing"]).map((evidence) => (
          <span
            key={`${item.key}-${evidence}`}
            className="rounded border border-[color:var(--editor-widget-border)] px-1.5 py-0.5 text-[10px] text-[color:var(--editor-tab-muted)]"
          >
            {evidence === "missing" ? t("research.quality.detail.missing") : evidenceLabel(t, evidence)}
          </span>
        ))}
      </div>
    </div>
  );
}

function CitationDetails(props: { report: ResearchQualityReport; t: TranslationFn }) {
  const { report, t } = props;
  const { citationTrust } = report;
  const flags = [
    { key: "missing", count: citationTrust.missingKeys.length },
    { key: "weak", count: citationTrust.weakKeys.length },
    { key: "duplicate", count: citationTrust.duplicateKeys.length },
    { key: "unreadable", count: citationTrust.unreadableBibPaths.length },
  ].filter((item) => item.count > 0);
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {flags.length > 0 ? flags.map((item) => (
          <span
            key={item.key}
            className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
          >
            {formatMessage(t(`research.quality.detail.${item.key}`), { count: item.count })}
          </span>
        )) : (
          <span className="text-[11px] text-[color:var(--editor-tab-muted)]">
            {t("research.quality.detail.noCitationIssues")}
          </span>
        )}
      </div>
      <div className="max-h-48 overflow-auto pr-1">
        {citationTrust.items.length > 0 ? citationTrust.items.map((item) => (
          <CitationRow key={item.key} item={item} t={t} />
        )) : (
          <div className="text-[11px] text-[color:var(--editor-tab-muted)]">
            {t("research.quality.detail.noCitations")}
          </div>
        )}
      </div>
    </div>
  );
}

function CompileDetails(props: {
  compileDiagnostics: string[];
  onCompileRepair: () => void;
  t: TranslationFn;
}) {
  const { compileDiagnostics, onCompileRepair, t } = props;
  return (
    <div className="space-y-2">
      {compileDiagnostics.length > 0 ? (
        <div className="max-h-36 overflow-auto rounded border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] p-2 font-mono text-[10px] leading-4 text-[color:var(--editor-tab-text)]">
          {compileDiagnostics.slice(0, 8).map((item, index) => (
            <div key={`${index}-${item}`} className="truncate">{item}</div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-[color:var(--editor-tab-muted)]">
          {t("research.quality.detail.noCompileDiagnostics")}
        </div>
      )}
      <button
        type="button"
        className="panel-topbar-btn editor-toolbar-btn--primary justify-center gap-1.5 px-3 text-xs"
        onClick={onCompileRepair}
      >
        <Wrench className="h-3.5 w-3.5" />
        {t("research.quality.detail.compileAction")}
      </button>
    </div>
  );
}

function SubmissionDetails(props: {
  compileDiagnostics: string[];
  projectId: string | null;
  report: ResearchQualityReport;
  selectedFile: string | null;
  t: TranslationFn;
}) {
  const { compileDiagnostics, projectId, report, selectedFile, t } = props;
  return (
    <>
      <div className="max-h-48 overflow-auto pr-1">
        {report.submission.issues.map((issue) => (
          <div
            key={`${issue.id}-${issue.detail ?? ""}`}
            className="flex min-w-0 items-start gap-2 border-t border-[color:var(--editor-widget-border)] py-1.5 text-[11px]"
          >
            <FileWarning className={[
              "mt-0.5 h-3.5 w-3.5 shrink-0",
              issue.severity === "error"
                ? "text-red-500"
                : issue.severity === "warning"
                  ? "text-amber-500"
                  : "text-emerald-500",
            ].join(" ")} />
            <span className="min-w-0">{issueLabel(t, issue)}</span>
          </div>
        ))}
      </div>
      <SubmissionPackPanel
        projectId={projectId}
        selectedFile={selectedFile}
        report={report}
        compileDiagnostics={compileDiagnostics}
        t={t}
      />
    </>
  );
}

function RebuttalDetails(props: { onOpenRebuttal: () => void; t: TranslationFn }) {
  const { onOpenRebuttal, t } = props;
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 max-[760px]:items-start max-[760px]:flex-col">
      <div className="text-[11px] text-[color:var(--editor-tab-muted)]">
        {t("research.quality.detail.rebuttalHint")}
      </div>
      <button
        type="button"
        className="panel-topbar-btn editor-toolbar-btn--primary justify-center gap-1.5 px-3 text-xs"
        onClick={onOpenRebuttal}
      >
        <MessageSquareReply className="h-3.5 w-3.5" />
        {t("research.quality.detail.rebuttalAction")}
      </button>
    </div>
  );
}

export function ResearchQualityDetails(props: {
  activeLane: ResearchQualityLaneId;
  report: ResearchQualityReport;
  compileDiagnostics: string[];
  projectId: string | null;
  selectedFile: string | null;
  onCompileRepair: () => void;
  onOpenRebuttal: () => void;
  t: TranslationFn;
}) {
  const { activeLane, report, compileDiagnostics, projectId, selectedFile, onCompileRepair, onOpenRebuttal, t } = props;
  return (
    <div className="mt-2 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] p-2">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[11px] font-semibold text-[color:var(--editor-tab-text)]">
          {t(`research.quality.detail.title.${activeLane}`)}
        </div>
        <div className="shrink-0 text-[10px] text-[color:var(--editor-tab-muted)]">
          {formatMessage(t("research.quality.detail.score"), { score: report.readiness.score })}
        </div>
      </div>
      {activeLane === "citations" ? <CitationDetails report={report} t={t} /> : null}
      {activeLane === "compile" ? (
        <CompileDetails compileDiagnostics={compileDiagnostics} onCompileRepair={onCompileRepair} t={t} />
      ) : null}
      {activeLane === "submission" ? (
        <SubmissionDetails
          compileDiagnostics={compileDiagnostics}
          projectId={projectId}
          report={report}
          selectedFile={selectedFile}
          t={t}
        />
      ) : null}
      {activeLane === "rebuttal" ? <RebuttalDetails onOpenRebuttal={onOpenRebuttal} t={t} /> : null}
    </div>
  );
}
