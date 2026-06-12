import { useMemo, useState } from "react";
import { BookOpenCheck, ClipboardCheck, FileCheck2, Quote, Wrench } from "lucide-react";
import { libraryCitationResolve } from "../../../shared/api/library";
import { buildSubmissionCheckReport, type SubmissionIssue } from "../../hooks/researchSubmissionCheck";

type TranslationFn = (key: any) => string;

function formatMessage(template: string, params: Record<string, string | number | undefined>) {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );
}

function issueLabel(t: TranslationFn, issue: SubmissionIssue): string {
  const base = t(`research.submission.issue.${issue.id}`);
  return formatMessage(base, {
    count: issue.count ?? "",
    detail: issue.detail ?? "",
  });
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
    t,
  } = props;
  const [citationQuery, setCitationQuery] = useState("");
  const [citationBusy, setCitationBusy] = useState(false);
  const [citationStatus, setCitationStatus] = useState<string | null>(null);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const report = useMemo(
    () => buildSubmissionCheckReport({ texSource: editorContent, fileList, compileDiagnostics }),
    [compileDiagnostics, editorContent, fileList],
  );
  const topIssues = report.issues.slice(0, 3);
  const canUseCitation = Boolean(projectId && selectedFile && canCompileSelectedFile);
  const paperActionLabel = selectedLibraryPath
    ? t("research.action.paperAnalyze")
    : t("research.action.openPapers");

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
        </div>
        <div className="grid min-w-0 grid-cols-[repeat(4,minmax(0,1fr))] gap-1.5 max-[760px]:grid-cols-2">
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
            onClick={() => setSubmissionOpen((value) => !value)}
          >
            <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {formatMessage(t("research.action.submissionCheck"), {
                errors: report.errorCount,
                warnings: report.warningCount,
              })}
            </span>
          </button>
        </div>
      </div>
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
      {submissionOpen ? (
        <div className="mt-2 grid gap-1 text-[11px] text-[color:var(--editor-tab-muted)]">
          {topIssues.map((issue) => (
            <div key={`${issue.id}-${issue.detail ?? ""}`} className="flex min-w-0 items-center gap-2">
              <span className={[
                "h-1.5 w-1.5 shrink-0 rounded-full",
                issue.severity === "error"
                  ? "bg-red-500"
                  : issue.severity === "warning"
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              ].join(" ")} />
              <span className="truncate">{issueLabel(t, issue)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
