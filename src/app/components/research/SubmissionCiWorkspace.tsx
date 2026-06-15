import {
  BookOpenCheck,
  ClipboardCheck,
  FileCheck2,
  FileSearch,
  Gauge,
  Loader2,
  MessageSquareReply,
  Quote,
  Search,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Select } from "../../../components/ui/select";
import { libraryCitationResolve } from "../../../shared/api/library";
import { writeFile } from "../../../shared/api/workspace";
import { buildResearchAuditMarkdown } from "../../hooks/researchQualityAudit";
import { type ResearchQualityLaneId, type ResearchQualityStatus, useResearchQualityGate } from "../../hooks/researchQualityGate";
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

type TranslationFn = (key: any) => string;

function formatMessage(template: string, params: Record<string, string | number | undefined> = {}) {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );
}

function statusTone(status: ResearchQualityStatus): string {
  if (status === "fail") {
    return "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-300";
  }
  if (status === "warn") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function laneIcon(lane: ResearchQualityLaneId) {
  if (lane === "claims") {
    return FileSearch;
  }
  if (lane === "citations") {
    return Quote;
  }
  if (lane === "compile") {
    return Wrench;
  }
  if (lane === "submission") {
    return FileCheck2;
  }
  if (lane === "profile") {
    return ClipboardCheck;
  }
  return MessageSquareReply;
}

function laneTitleKey(id: ResearchQualityLaneId): string {
  return `research.quality.lane.${id}`;
}

export function SubmissionCiWorkspace(props: {
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
  onOpenTexMode: () => void;
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
    onOpenTexMode,
    onRebuttalReply,
    onSubmissionPreflight,
    t,
  } = props;
  const [activeLane, setActiveLane] = useState<ResearchQualityLaneId | null>(null);
  const [profileId, setProfileId] = useState<ResearchWorkflowProfileId>("generic");
  const [citationQuery, setCitationQuery] = useState("");
  const [citationBusy, setCitationBusy] = useState(false);
  const [citationStatus, setCitationStatus] = useState<string | null>(null);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);
  const [rebuttalOpen, setRebuttalOpen] = useState(false);
  const [rebuttalComments, setRebuttalComments] = useState("");
  const [rebuttalStatus, setRebuttalStatus] = useState<string | null>(null);
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
  const report = qualityGate.report;
  const nextAction = useMemo(() => resolveResearchNextAction({
    selectedFile,
    canCompileSelectedFile,
    report,
  }), [canCompileSelectedFile, report, selectedFile]);
  const paperActionLabel = selectedLibraryPath
    ? t("research.action.paperAnalyze")
    : t("research.action.openPapers");
  const canUseCitation = Boolean(projectId && selectedFile && canCompileSelectedFile);
  const scoreLabel = formatMessage(t("research.quality.score"), { score: report.readiness.score });
  const editableMetricLabel = editableTexMetric
    ? formatMessage(t("research.performance.editableTex"), { ms: editableTexMetric.elapsedMs })
    : t("research.performance.editableTexEmpty");
  const searchReadyMetricLabel = searchReadyMetric
    ? formatMessage(t("research.performance.searchReady"), { ms: searchReadyMetric.elapsedMs })
    : t("research.performance.searchReadyEmpty");

  const selectLane = (lane: ResearchQualityLaneId) => {
    setActiveLane((current) => current === lane ? null : lane);
    if (lane === "rebuttal") {
      setRebuttalOpen(true);
    }
  };

  const runNextAction = () => {
    if (nextAction.kind === "open-tex") {
      onOpenTexMode();
      return;
    }
    if (nextAction.kind === "repair-compile") {
      onCompileRepair();
      return;
    }
    if (nextAction.laneId) {
      selectLane(nextAction.laneId);
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
        report,
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
      `score=${report.readiness.score}`,
      `blockers=${report.readiness.blockers}`,
      `warnings=${report.readiness.warnings}`,
      `claimBlockers=${report.auditSummary.claimBlockers}`,
      `reviewerRisks=${report.auditSummary.reviewerRisks}`,
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
      setCitationStatus(key
        ? formatMessage(t("research.citation.quickFound"), { key })
        : t("research.citation.noKey"));
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
    <section className="h-full min-h-0 overflow-auto rounded-lg bg-[color:var(--editor-paper-bg)] p-3 motion-shell-stage">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-3">
        <div className="rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-3 shadow-sm">
          <div className="grid min-w-0 grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)_auto] items-center gap-3 max-[900px]:grid-cols-1">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--editor-tab-muted)]">
                {t("workspace.mode.submission")}
              </div>
              <div className="truncate text-lg font-semibold text-[color:var(--editor-tab-text)]">
                {scoreLabel}
              </div>
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[color:var(--editor-tab-text)]">
                {selectedFile ?? t("research.next.status.noPaper")}
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-[color:var(--editor-tab-muted)]">
                <span className="rounded border border-[color:var(--editor-widget-border)] px-1.5 py-0.5">
                  {report.readiness.blockers}
                </span>
                <span>{t(nextAction.titleKey)}</span>
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
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-[900px]:justify-start">
              <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] px-1.5 py-1 text-[10px] text-[color:var(--editor-tab-muted)]">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[color:var(--app-accent)]" />
                <Select
                  uiSize="sm"
                  tone="dark"
                  wrapperClassName="w-[168px]"
                  className="h-7 rounded-md border-0 bg-transparent px-2 pr-1 text-[10px] shadow-none"
                  title={t("research.profile.label")}
                  aria-label={t("research.profile.label")}
                  value={profileId}
                  onChange={(event) => setProfileId(normalizeResearchWorkflowProfileId(event.currentTarget.value))}
                >
                  {RESEARCH_WORKFLOW_PROFILE_IDS.map((profile) => (
                    <option key={profile} value={profile}>
                      {t(researchProfileLabelKey(profile))}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                className="panel-topbar-btn editor-toolbar-btn--primary h-8 w-8 justify-center p-0 disabled:opacity-50"
                disabled={busy}
                title={t(nextAction.actionKey)}
                aria-label={t(nextAction.actionKey)}
                onClick={runNextAction}
              >
                <FileCheck2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="submission-ci-card submission-ci-card--delay-1 rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-3">
          <div className="grid min-w-0 grid-cols-[minmax(220px,0.76fr)_minmax(0,1fr)] gap-3 max-[980px]:grid-cols-1">
            <div className="grid grid-cols-5 gap-2">
              {[
                { icon: Wrench, label: t("research.action.compileRepair"), disabled: busy || !canCompileSelectedFile, onClick: onCompileRepair },
                { icon: BookOpenCheck, label: t("research.action.referenceCheck"), disabled: busy || !canCompileSelectedFile, onClick: onReferenceCheck },
                { icon: ClipboardCheck, label: paperActionLabel, disabled: busy || !projectId, onClick: selectedLibraryPath ? onAnalyzePaper : onOpenLibrary },
                { icon: FileCheck2, label: t("research.quality.detail.submissionAgentAction"), disabled: busy || !canCompileSelectedFile, onClick: runSubmissionPreflight },
                { icon: MessageSquareReply, label: t("research.rebuttal.open"), disabled: busy || !canCompileSelectedFile, onClick: () => {
                  setRebuttalOpen((value) => !value);
                  setActiveLane("rebuttal");
                } },
              ].map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    className="panel-topbar-btn h-10 justify-center p-0 disabled:opacity-50 motion-hover-rise"
                    disabled={action.disabled}
                    title={action.label}
                    aria-label={action.label}
                    onClick={action.onClick}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
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
                className="panel-topbar-btn editor-toolbar-btn--primary h-8 w-8 justify-center p-0 disabled:opacity-50"
                disabled={!canUseCitation || citationBusy || !citationQuery.trim()}
                title={citationBusy ? t("research.citation.resolving") : t("research.citation.quickLookup")}
                aria-label={citationBusy ? t("research.citation.resolving") : t("research.citation.quickLookup")}
                onClick={() => {
                  void resolveCitation();
                }}
              >
                {citationBusy ? <Loader2 className="h-4 w-4 motion-rotate-soft" /> : <Search className="h-4 w-4" />}
              </button>
              <button
                type="button"
                className="panel-topbar-btn h-8 w-8 justify-center p-0 motion-hover-rise"
                title={t("research.citation.quickOpenTex")}
                aria-label={t("research.citation.quickOpenTex")}
                onClick={onOpenTexMode}
              >
                <Quote className="h-4 w-4" />
              </button>
            </div>
          </div>
          {citationStatus ? (
            <div className="mt-2 truncate text-[11px] text-[color:var(--editor-tab-muted)]">{citationStatus}</div>
          ) : null}
        </div>

        <div className="submission-ci-card submission-ci-card--delay-2 rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-3">
          <div className="grid min-w-0 grid-cols-6 gap-2 max-[900px]:grid-cols-3 max-[620px]:grid-cols-2">
            {report.lanes.map((lane) => {
              const Icon = laneIcon(lane.id);
              const label = t(laneTitleKey(lane.id));
              return (
                <button
                  key={lane.id}
                  type="button"
                  className={[
                    "submission-ci-lane flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md border transition hover:border-[color:var(--app-accent)]",
                    activeLane === lane.id ? "ring-1 ring-[color:var(--app-accent)]" : "",
                    statusTone(lane.status),
                  ].join(" ")}
                  title={formatMessage(t(lane.message.key), lane.message.params)}
                  aria-label={label}
                  aria-pressed={activeLane === lane.id || (lane.id === "rebuttal" && rebuttalOpen)}
                  onClick={() => selectLane(lane.id)}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate text-[10px] font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {activeLane ? (
          <div className="submission-ci-detail">
            <ResearchQualityDetails
              activeLane={activeLane}
              report={report}
              compileDiagnostics={compileDiagnostics}
              projectId={projectId}
              selectedFile={selectedFile}
              onCompileRepair={onCompileRepair}
              onExportAudit={() => {
                void exportAuditReport();
              }}
              onOpenRebuttal={() => {
                setRebuttalOpen(true);
                setActiveLane("rebuttal");
              }}
              onSubmissionPreflight={runSubmissionPreflight}
              t={t}
            />
          </div>
        ) : null}
        {auditStatus ? (
          <div className="truncate text-[11px] text-[color:var(--editor-tab-muted)]">{auditStatus}</div>
        ) : null}
        {rebuttalOpen ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-3 max-[760px]:grid-cols-1">
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
          <div className="truncate text-[11px] text-[color:var(--editor-tab-muted)]">{rebuttalStatus}</div>
        ) : null}
      </div>
    </section>
  );
}
