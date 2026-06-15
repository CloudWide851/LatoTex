import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, ClipboardCheck, FileCheck2, Gauge, MessageSquareReply, Quote, Wrench } from "lucide-react";
import { libraryCitationResolve } from "../../../shared/api/library";
import { writeFile } from "../../../shared/api/workspace";
import {
  buildResearchAuditMarkdown,
} from "../../hooks/researchQualityAudit";
import { type ResearchQualityLaneId, useResearchQualityGate } from "../../hooks/researchQualityGate";
import { resolveResearchNextAction } from "../../hooks/researchNextAction";
import {
  normalizeResearchWorkflowProfileId,
  researchProfileLabelKey,
  RESEARCH_WORKFLOW_PROFILE_IDS,
  type ResearchWorkflowProfileId,
} from "../../hooks/researchProfiles";
import { useEditableTexMetric } from "../../hooks/useEditableTexMetric";
import { useProjectSearchReadyMetric } from "../../hooks/useProjectSearchReadyMetric";
import { ResearchQualityDetails } from "./ResearchQualityDetails";
import { ResearchQualityGate } from "./ResearchQualityGate";

type TranslationFn = (key: any) => string;

function formatMessage(template: string, params: Record<string, string | number | undefined>) {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );
}

export function ResearchCommandCenter(props: {
  projectId: string | null;
  selectedFile: string | null;
  selectedLibraryPath: string | null;
  editorContent: string;
  fileList: string[];
  compileDiagnostics: string[];
  busy: boolean;
  canCompileSelectedFile: boolean;
  onCompileRepair: () => void;
  onReferenceCheck: () => void;
  onAnalyzePaper: () => void;
  onOpenLibrary: () => void;
  onInsertCitation: (citationKey: string) => boolean;
  onRebuttalReply: (reviewComments: string) => void;
  onSubmissionPreflight: (prompt: string) => void;
  t: TranslationFn;
}) {
  const {
    projectId,
    selectedFile,
    selectedLibraryPath,
    editorContent,
    fileList,
    compileDiagnostics,
    busy,
    canCompileSelectedFile,
    onCompileRepair,
    onReferenceCheck,
    onAnalyzePaper,
    onOpenLibrary,
    onInsertCitation,
    onRebuttalReply,
    onSubmissionPreflight,
    t,
  } = props;
  const [citationQuery, setCitationQuery] = useState("");
  const [citationBusy, setCitationBusy] = useState(false);
  const [citationStatus, setCitationStatus] = useState<string | null>(null);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);
  const [activeQualityLane, setActiveQualityLane] = useState<ResearchQualityLaneId | null>(null);
  const [rebuttalOpen, setRebuttalOpen] = useState(false);
  const [rebuttalComments, setRebuttalComments] = useState("");
  const [rebuttalStatus, setRebuttalStatus] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<ResearchWorkflowProfileId>("generic");
  const editableTexMetric = useEditableTexMetric();
  const searchReadyMetric = useProjectSearchReadyMetric();
  const profileStorageKey = useMemo(() => (
    projectId && selectedFile
      ? `latotex.research.profile.${projectId}.${selectedFile}`
      : null
  ), [projectId, selectedFile]);

  useEffect(() => {
    if (!profileStorageKey || typeof window === "undefined") {
      setProfileId("generic");
      return;
    }
    setProfileId(normalizeResearchWorkflowProfileId(window.localStorage.getItem(profileStorageKey)));
  }, [profileStorageKey]);

  useEffect(() => {
    if (!profileStorageKey || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(profileStorageKey, profileId);
  }, [profileId, profileStorageKey]);

  const qualityGate = useResearchQualityGate({
    projectId,
    selectedFile,
    texSource: editorContent,
    fileList,
    compileDiagnostics,
    profileId,
  });
  const submissionReport = qualityGate.report.submission;
  const canUseCitation = Boolean(projectId && selectedFile && canCompileSelectedFile);
  const paperActionLabel = selectedLibraryPath
    ? t("research.action.paperAnalyze")
    : t("research.action.openPapers");
  const editableMetricLabel = editableTexMetric
    ? formatMessage(t("research.performance.editableTex"), { ms: editableTexMetric.elapsedMs })
    : t("research.performance.editableTexEmpty");
  const searchReadyMetricLabel = searchReadyMetric
    ? formatMessage(t("research.performance.searchReady"), { ms: searchReadyMetric.elapsedMs })
    : t("research.performance.searchReadyEmpty");
  const nextAction = useMemo(() => resolveResearchNextAction({
    selectedFile,
    canCompileSelectedFile,
    report: qualityGate.report,
  }), [canCompileSelectedFile, qualityGate.report, selectedFile]);
  const paperStatusLabel = selectedFile && /\.tex$/i.test(selectedFile)
    ? formatMessage(t("research.next.status.paper"), {
      file: selectedFile,
      score: qualityGate.report.readiness.score,
      blockers: qualityGate.report.readiness.blockers,
    })
    : t("research.next.status.noPaper");
  const selectQualityLane = (lane: ResearchQualityLaneId) => {
    setActiveQualityLane((current) => current === lane ? null : lane);
    if (lane === "rebuttal") {
      setRebuttalOpen(true);
    }
  };

  const runNextAction = () => {
    if (nextAction.kind === "repair-compile") {
      onCompileRepair();
      return;
    }
    if (nextAction.laneId) {
      selectQualityLane(nextAction.laneId);
    }
  };

  const exportAuditReport = async () => {
    if (!projectId || !selectedFile) {
      setAuditStatus(t("research.audit.exportFailed"));
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `.latotex/reports/research-audit-${timestamp}.md`;
    try {
      await writeFile(projectId, path, buildResearchAuditMarkdown({
        report: qualityGate.report,
        selectedFile,
      }, (key, params) => formatMessage(t(key), params ?? {})));
      setAuditStatus(formatMessage(t("research.audit.exported"), { path }));
    } catch {
      setAuditStatus(t("research.audit.exportFailed"));
    }
  };

  const runSubmissionPreflight = () => {
    if (!projectId || !selectedFile || !canCompileSelectedFile) {
      setAuditStatus(t("research.rebuttal.noEditor"));
      return;
    }
    const prompt = [
      `profile=${profileId}`,
      `file=${selectedFile}`,
      `score=${qualityGate.report.readiness.score}`,
      `blockers=${qualityGate.report.readiness.blockers}`,
      `warnings=${qualityGate.report.readiness.warnings}`,
      `claimBlockers=${qualityGate.report.auditSummary.claimBlockers}`,
      `reviewerRisks=${qualityGate.report.auditSummary.reviewerRisks}`,
      "Use the local quality gate summary, explain submission blockers, and propose the smallest manuscript-safe next actions.",
    ].join("; ");
    onSubmissionPreflight(prompt);
    setAuditStatus(null);
  };

  const resolveCitation = async () => {
    const query = citationQuery.trim();
    if (!projectId || !query || !canUseCitation) {
      return;
    }
    setCitationBusy(true);
    setCitationStatus(null);
    try {
      const resolved = await libraryCitationResolve({
        projectId,
        query,
        includeRemote: false,
      });
      const key = resolved.summary?.citationKey?.trim();
      if (!key) {
        setCitationStatus(t("research.citation.noKey"));
        return;
      }
      const inserted = onInsertCitation(key);
      setCitationStatus(inserted
        ? formatMessage(t("research.citation.inserted"), { key })
        : t("research.citation.noEditor"));
    } catch {
      setCitationStatus(t("research.citation.notFound"));
    } finally {
      setCitationBusy(false);
    }
  };

  const runRebuttalReply = () => {
    const comments = rebuttalComments.trim();
    if (!projectId || !selectedFile || !canCompileSelectedFile) {
      setRebuttalStatus(t("research.rebuttal.noEditor"));
      return;
    }
    if (!comments) {
      setRebuttalStatus(t("research.rebuttal.empty"));
      return;
    }
    onRebuttalReply(comments);
    setRebuttalComments("");
    setRebuttalStatus(null);
    setRebuttalOpen(false);
  };

  return (
    <section className="border-b border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-3 py-2">
      <div className="grid min-w-0 grid-cols-[minmax(170px,0.85fr)_minmax(280px,1.6fr)] gap-3 max-[980px]:grid-cols-1">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--editor-tab-muted)]">
            {t("research.commandCenter.label")}
          </div>
          <div className="truncate text-sm font-semibold text-[color:var(--editor-tab-text)]">
            {t("research.commandCenter.title")}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-[color:var(--editor-tab-muted)]">
            <label className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">{t("research.profile.label")}</span>
              <select
                className="max-w-[148px] rounded border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] px-1.5 py-0.5 text-[10px] text-[color:var(--editor-tab-text)] outline-none"
                value={profileId}
                onChange={(event) => setProfileId(normalizeResearchWorkflowProfileId(event.currentTarget.value))}
              >
                {RESEARCH_WORKFLOW_PROFILE_IDS.map((profile) => (
                  <option key={profile} value={profile}>
                    {t(researchProfileLabelKey(profile))}
                  </option>
                ))}
              </select>
            </label>
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <Gauge className="h-3 w-3 shrink-0" />
              <span className="truncate">{editableMetricLabel}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <Gauge className="h-3 w-3 shrink-0" />
              <span className="truncate">{searchReadyMetricLabel}</span>
            </span>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-[repeat(5,minmax(0,1fr))] gap-1.5 max-[900px]:grid-cols-3 max-[760px]:grid-cols-2">
          <button
            type="button"
            className="panel-topbar-btn justify-start gap-1.5 px-2 text-left text-[11px] disabled:opacity-50"
            disabled={busy || !canCompileSelectedFile}
            onClick={onCompileRepair}
          >
            <Wrench className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("research.action.compileRepair")}</span>
          </button>
          <button
            type="button"
            className="panel-topbar-btn justify-start gap-1.5 px-2 text-left text-[11px] disabled:opacity-50"
            disabled={busy || !canCompileSelectedFile}
            onClick={onReferenceCheck}
          >
            <BookOpenCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("research.action.referenceCheck")}</span>
          </button>
          <button
            type="button"
            className="panel-topbar-btn justify-start gap-1.5 px-2 text-left text-[11px] disabled:opacity-50"
            disabled={busy || !projectId}
            onClick={selectedLibraryPath ? onAnalyzePaper : onOpenLibrary}
          >
            <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{paperActionLabel}</span>
          </button>
          <button
            type="button"
            className="panel-topbar-btn justify-start gap-1.5 px-2 text-left text-[11px]"
            onClick={() => selectQualityLane("submission")}
          >
            <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {formatMessage(t("research.action.submissionCheck"), {
                errors: submissionReport.errorCount,
                warnings: submissionReport.warningCount,
              })}
            </span>
          </button>
          <button
            type="button"
            className="panel-topbar-btn justify-start gap-1.5 px-2 text-left text-[11px] disabled:opacity-50"
            disabled={busy || !canCompileSelectedFile}
            onClick={() => {
              setRebuttalOpen((value) => !value);
              setActiveQualityLane("rebuttal");
            }}
          >
            <MessageSquareReply className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {rebuttalOpen ? t("research.rebuttal.close") : t("research.rebuttal.open")}
            </span>
          </button>
        </div>
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] px-2 py-1.5 max-[760px]:grid-cols-1">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-[color:var(--editor-tab-text)]">
            {paperStatusLabel}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[color:var(--editor-tab-muted)]">
            <span className="font-semibold text-[color:var(--editor-tab-text)]">{t(nextAction.titleKey)}</span>
            <span className="min-w-0 truncate">{t(nextAction.detailKey)}</span>
          </div>
        </div>
        <button
          type="button"
          className="panel-topbar-btn editor-toolbar-btn--primary justify-center gap-1.5 px-3 text-xs disabled:opacity-50"
          disabled={busy || nextAction.kind === "open-tex"}
          onClick={runNextAction}
        >
          <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t(nextAction.actionKey)}</span>
        </button>
      </div>
      <ResearchQualityGate
        report={qualityGate.report}
        loading={qualityGate.loading}
        activeLane={activeQualityLane}
        rebuttalOpen={rebuttalOpen}
        onLaneSelect={selectQualityLane}
        t={t}
      />
      {activeQualityLane ? (
        <ResearchQualityDetails
          activeLane={activeQualityLane}
          report={qualityGate.report}
          compileDiagnostics={compileDiagnostics}
          projectId={projectId}
          selectedFile={selectedFile}
          onCompileRepair={onCompileRepair}
          onExportAudit={() => {
            void exportAuditReport();
          }}
          onOpenRebuttal={() => {
            setRebuttalOpen(true);
            setActiveQualityLane("rebuttal");
          }}
          onSubmissionPreflight={runSubmissionPreflight}
          t={t}
        />
      ) : null}
      {auditStatus ? (
        <div className="mt-1 truncate text-[11px] text-[color:var(--editor-tab-muted)]">{auditStatus}</div>
      ) : null}
      <div className="mt-2 grid min-w-0 grid-cols-[minmax(220px,1fr)_auto] gap-2 max-[760px]:grid-cols-1">
        <label className="flex min-w-0 items-center gap-2 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] px-2 py-1.5">
          <Quote className="h-3.5 w-3.5 shrink-0 text-[color:var(--app-accent)]" />
          <input
            className="min-w-0 flex-1 bg-transparent text-xs text-[color:var(--editor-tab-text)] outline-none placeholder:text-[color:var(--editor-tab-muted)]"
            value={citationQuery}
            disabled={!canUseCitation || citationBusy}
            placeholder={t("research.citation.placeholder")}
            onChange={(event) => setCitationQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void resolveCitation();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="panel-topbar-btn editor-toolbar-btn--primary justify-center px-3 text-xs disabled:opacity-50"
          disabled={!canUseCitation || citationBusy || !citationQuery.trim()}
          onClick={() => {
            void resolveCitation();
          }}
        >
          {citationBusy ? t("research.citation.resolving") : t("research.citation.insert")}
        </button>
      </div>
      {citationStatus ? (
        <div className="mt-1 truncate text-[11px] text-[color:var(--editor-tab-muted)]">{citationStatus}</div>
      ) : null}
      {rebuttalOpen ? (
        <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 max-[760px]:grid-cols-1">
          <textarea
            className="min-h-[74px] min-w-0 resize-y rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] px-2 py-1.5 text-xs text-[color:var(--editor-tab-text)] outline-none placeholder:text-[color:var(--editor-tab-muted)]"
            value={rebuttalComments}
            disabled={!canCompileSelectedFile || busy}
            placeholder={t("research.rebuttal.placeholder")}
            onChange={(event) => {
              setRebuttalComments(event.target.value);
              setRebuttalStatus(null);
            }}
          />
          <button
            type="button"
            className="panel-topbar-btn editor-toolbar-btn--primary self-start justify-center px-3 text-xs disabled:opacity-50"
            disabled={!canCompileSelectedFile || busy}
            onClick={runRebuttalReply}
          >
            {t("research.rebuttal.run")}
          </button>
        </div>
      ) : null}
      {rebuttalStatus ? (
        <div className="mt-1 truncate text-[11px] text-[color:var(--editor-tab-muted)]">{rebuttalStatus}</div>
      ) : null}
    </section>
  );
}
