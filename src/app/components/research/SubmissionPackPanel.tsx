import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileArchive, Loader2, XCircle } from "lucide-react";
import { submissionPackBuild, writeFile } from "../../../shared/api/workspace";
import type { SubmissionPackBuildResponse, SubmissionPackIssuePayload } from "../../../shared/types/app";
import { buildSubmissionEvidenceBundle } from "../../hooks/researchEvidenceBundle";
import type { ResearchQualityReport } from "../../hooks/researchQualityGate";

type TranslationFn = (key: any) => string;

type JournalProfile = {
  id: "generic" | "arxiv" | "ieee-like";
  labelKey: string;
};

const PROFILES: JournalProfile[] = [
  { id: "generic", labelKey: "research.submissionPack.profile.generic" },
  { id: "arxiv", labelKey: "research.submissionPack.profile.arxiv" },
  { id: "ieee-like", labelKey: "research.submissionPack.profile.ieeeLike" },
];

const SUBMISSION_ISSUE_IDS = new Set([
  "compileDiagnostics",
  "missingDocumentEnvironment",
  "missingBibliography",
  "undefinedReferences",
  "duplicateLabels",
  "missingFigures",
  "noCitations",
  "ready",
]);

function formatMessage(template: string, params: Record<string, string | number | undefined> = {}) {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );
}

function gateIssuesFromReport(report: ResearchQualityReport): SubmissionPackIssuePayload[] {
  const issues: SubmissionPackIssuePayload[] = [];
  for (const issue of report.submission.issues) {
    if (issue.id === "ready" || issue.id === "compileDiagnostics") {
      continue;
    }
    issues.push({
      id: issue.id,
      severity: issue.severity,
      count: issue.count,
      detail: issue.detail,
    });
  }
  if (report.citationTrust.missingKeys.length > 0) {
    issues.push({
      id: "submissionPack.missingCitationEvidence",
      severity: "error",
      count: report.citationTrust.missingKeys.length,
      detail: report.citationTrust.missingKeys.slice(0, 3).join(", "),
    });
  }
  if (report.citationTrust.unreadableBibPaths.length > 0) {
    issues.push({
      id: "submissionPack.unreadableBib",
      severity: "error",
      count: report.citationTrust.unreadableBibPaths.length,
      detail: report.citationTrust.unreadableBibPaths.slice(0, 3).join(", "),
    });
  }
  if (report.citationTrust.weakKeys.length > 0) {
    issues.push({
      id: "submissionPack.weakCitationMetadata",
      severity: "warning",
      count: report.citationTrust.weakKeys.length,
      detail: report.citationTrust.weakKeys.slice(0, 3).join(", "),
    });
  }
  if (report.citationTrust.duplicateKeys.length > 0) {
    issues.push({
      id: "submissionPack.duplicateCitationUse",
      severity: "warning",
      count: report.citationTrust.duplicateKeys.length,
      detail: report.citationTrust.duplicateKeys.slice(0, 3).join(", "),
    });
  }
  return issues;
}

function issueLabel(t: TranslationFn, issue: SubmissionPackIssuePayload): string {
  const packIssueId = issue.id.startsWith("submissionPack.")
    ? issue.id.slice("submissionPack.".length)
    : issue.id;
  const key = SUBMISSION_ISSUE_IDS.has(issue.id)
    ? `research.submission.issue.${issue.id}`
    : `research.submissionPack.issue.${packIssueId}`;
  return formatMessage(t(key), {
    count: issue.count ?? "",
    detail: issue.detail ?? "",
  });
}

function IssueRows(props: {
  title: string;
  issues: SubmissionPackIssuePayload[];
  empty: string;
  t: TranslationFn;
}) {
  const { title, issues, empty, t } = props;
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--editor-tab-muted)]">
        {title}
      </div>
      {issues.length > 0 ? (
        <div className="max-h-28 overflow-auto rounded border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)]">
          {issues.slice(0, 8).map((issue, index) => (
            <div
              key={`${issue.id}-${issue.detail ?? ""}-${index}`}
              className="flex min-w-0 items-start gap-1.5 border-t border-[color:var(--editor-widget-border)] px-2 py-1.5 first:border-t-0"
            >
              {issue.severity === "error" ? (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span className="min-w-0 text-[11px] text-[color:var(--editor-tab-text)]">
                {issueLabel(t, issue)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-[color:var(--editor-tab-muted)]">{empty}</div>
      )}
    </div>
  );
}

function ResultSummary(props: {
  evidencePaths: { jsonPath: string; markdownPath: string } | null;
  result: SubmissionPackBuildResponse;
  t: TranslationFn;
}) {
  const { evidencePaths, result, t } = props;
  const ready = result.status === "ready";
  return (
    <div className="mt-2 space-y-2 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div
          className={[
            "flex min-w-0 items-center gap-1.5 text-[11px] font-semibold",
            ready ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300",
          ].join(" ")}
        >
          {ready ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">
            {ready ? t("research.submissionPack.result.ready") : t("research.submissionPack.result.blocked")}
          </span>
        </div>
        <span className="shrink-0 text-[10px] text-[color:var(--editor-tab-muted)]">
          {formatMessage(t("research.submissionPack.result.counts"), {
            files: result.includedFiles.length,
            blockers: result.blockers.length,
          })}
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 text-[10px] text-[color:var(--editor-tab-muted)] max-[760px]:grid-cols-1">
        <div className="min-w-0 truncate">
          {formatMessage(t("research.submissionPack.result.manifest"), { path: result.manifestPath })}
        </div>
        <div className="min-w-0 truncate">
          {result.zipPath
            ? formatMessage(t("research.submissionPack.result.zip"), { path: result.zipPath })
            : t("research.submissionPack.result.noZip")}
        </div>
        {evidencePaths ? (
          <>
            <div className="min-w-0 truncate">
              {formatMessage(t("research.evidence.result.markdown"), { path: evidencePaths.markdownPath })}
            </div>
            <div className="min-w-0 truncate">
              {formatMessage(t("research.evidence.result.json"), { path: evidencePaths.jsonPath })}
            </div>
          </>
        ) : null}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 max-[760px]:grid-cols-1">
        <IssueRows
          title={t("research.submissionPack.blockers")}
          issues={result.blockers}
          empty={t("research.submissionPack.noBlockers")}
          t={t}
        />
        <IssueRows
          title={t("research.submissionPack.warnings")}
          issues={result.warnings}
          empty={t("research.submissionPack.noWarnings")}
          t={t}
        />
      </div>
    </div>
  );
}

export function SubmissionPackPanel(props: {
  projectId: string | null;
  selectedFile: string | null;
  report: ResearchQualityReport;
  compileDiagnostics: string[];
  t: TranslationFn;
}) {
  const { projectId, selectedFile, report, compileDiagnostics, t } = props;
  const [profileId, setProfileId] = useState<JournalProfile["id"]>("generic");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmissionPackBuildResponse | null>(null);
  const [evidencePaths, setEvidencePaths] = useState<{ jsonPath: string; markdownPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gateIssues = useMemo(() => gateIssuesFromReport(report), [report]);
  const canBuild = Boolean(projectId && selectedFile && /\.tex$/i.test(selectedFile));

  const buildPack = async () => {
    if (!projectId || !selectedFile) {
      setError(t("research.submissionPack.needTex"));
      return;
    }
    setBusy(true);
    setError(null);
    setEvidencePaths(null);
    try {
      const response = await submissionPackBuild({
        projectId,
        mainPath: selectedFile,
        profileId,
        gateIssues,
        compileDiagnostics,
      });
      const evidence = buildSubmissionEvidenceBundle({
        selectedFile,
        report,
        pack: response,
        t: (key, params) => formatMessage(t(key), params ?? {}),
      });
      await Promise.all([
        writeFile(projectId, evidence.jsonPath, evidence.jsonText),
        writeFile(projectId, evidence.markdownPath, evidence.markdownText),
      ]);
      setResult(response);
      setEvidencePaths({
        jsonPath: evidence.jsonPath,
        markdownPath: evidence.markdownPath,
      });
    } catch {
      setError(t("research.submissionPack.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-surface-bg)] p-2">
      <div className="mb-2 flex min-w-0 items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] text-[color:var(--app-accent)]">
          <FileArchive className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-[color:var(--editor-tab-text)]">
            {t("research.submissionPack.kitTitle")}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 text-[color:var(--editor-tab-muted)]">
            {t("research.submissionPack.kitSubtitle")}
          </div>
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(140px,1fr)_auto] items-end gap-2 max-[760px]:grid-cols-1">
        <label className="min-w-0">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--editor-tab-muted)]">
            {t("research.submissionPack.profile")}
          </span>
          <select
            className="h-8 w-full rounded border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-2 text-xs text-[color:var(--editor-tab-text)] outline-none focus:border-[color:var(--app-accent)]"
            value={profileId}
            onChange={(event) => {
              setProfileId(event.target.value as JournalProfile["id"]);
              setResult(null);
              setEvidencePaths(null);
              setError(null);
            }}
          >
            {PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {t(profile.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="panel-topbar-btn editor-toolbar-btn--primary justify-center gap-1.5 px-3 text-xs disabled:opacity-50"
          disabled={!canBuild || busy}
          onClick={() => {
            void buildPack();
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
          {busy ? t("research.submissionPack.building") : t("research.submissionPack.build")}
        </button>
      </div>
      <div className="mt-1 text-[10px] text-[color:var(--editor-tab-muted)]">
        {canBuild ? t("research.submissionPack.localOnly") : t("research.submissionPack.needTex")}
      </div>
      {error ? (
        <div className="mt-2 text-[11px] text-red-600 dark:text-red-300">{error}</div>
      ) : null}
      {result ? <ResultSummary evidencePaths={evidencePaths} result={result} t={t} /> : null}
    </div>
  );
}
