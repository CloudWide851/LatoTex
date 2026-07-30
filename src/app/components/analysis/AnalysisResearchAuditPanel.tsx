import { BookOpenCheck, Download, Globe2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { AcademicEvidence, AcademicProviderHealth } from "../../../shared/types/app";
import type { AnalysisTaskRun } from "../../hooks/analysisTypes";

type TranslationFn = (key: any) => string;

function statusTone(status: string): string {
  if (status === "failed") {
    return "border-rose-300 bg-rose-50 text-rose-700";
  }
  if (status === "running") {
    return "border-blue-300 bg-blue-50 text-blue-700";
  }
  if (status === "skipped" || status === "pending") {
    return "border-slate-300 bg-slate-50 text-slate-600";
  }
  return "border-emerald-300 bg-emerald-50 text-emerald-700";
}

function healthStatus(item: AcademicProviderHealth): "completed" | "skipped" | "failed" {
  if (item.status === "failed" || item.status === "circuit_open") {
    return "failed";
  }
  if (item.status === "disabled") {
    return "skipped";
  }
  return "completed";
}

function EvidenceList(props: {
  title: string;
  icon: "academic" | "web";
  items: AcademicEvidence[];
  t: TranslationFn;
}) {
  const { title, icon, items, t } = props;
  if (items.length === 0) {
    return null;
  }
  const Icon = icon === "academic" ? BookOpenCheck : Globe2;
  return (
    <section className="min-w-0">
      <h5 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--editor-tab-muted)]">
        <Icon className="h-3 w-3" />
        {title}
        <span className="ml-auto tabular-nums">{items.length}</span>
      </h5>
      <div className="space-y-1">
        {items.slice(0, 5).map((item) => (
          <div
            key={`${icon}:${item.stableId}`}
            className="app-material-inset min-w-0 rounded-md border px-2 py-1.5"
          >
            <p className="truncate text-[11px] font-medium text-[color:var(--editor-tab-active-text)]">
              {item.title}
            </p>
            <div className="mt-1 flex min-w-0 items-center gap-1 text-[9px] text-[color:var(--editor-tab-muted)]">
              <span className="shrink-0 rounded border border-[color:var(--editor-widget-border)] px-1 py-0.5">
                {t(`analysis.research.level.${item.evidenceLevel}`)}
              </span>
              <span className="truncate">{item.provenance.join(" · ")}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProviderHealth(props: { items: AcademicProviderHealth[]; t: TranslationFn }) {
  const deduped = Array.from(
    new Map(props.items.map((item) => [`${item.category}:${item.provider}`, item])).values(),
  );
  if (deduped.length === 0) {
    return null;
  }
  return (
    <section>
      <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--editor-tab-muted)]">
        {props.t("analysis.research.providerHealth")}
      </h5>
      <div className="flex flex-wrap gap-1">
        {deduped.map((item) => {
          const status = healthStatus(item);
          return (
            <span
              key={`${item.category}:${item.provider}`}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px]",
                statusTone(status),
              )}
              title={props.t(`analysis.research.status.${status}`)}
            >
              <span className="truncate">{item.provider}</span>
              <span className="tabular-nums">{item.resultCount}</span>
            </span>
          );
        })}
      </div>
    </section>
  );
}

export function AnalysisResearchAuditPanel(props: {
  run: AnalysisTaskRun | null;
  onExportArtifact: (relativePath: string) => void;
  t: TranslationFn;
}) {
  const { run, onExportArtifact, t } = props;
  if (!run?.researchPlan || !run.researchStages) {
    return null;
  }
  const bibtexPath = run.assetRelativePaths.find((path) => path.toLowerCase().endsWith(".bib"));
  const academic = run.academicEvidence ?? [];
  const web = run.webEvidence ?? [];
  const noEvidence = academic.length === 0 && web.length === 0;
  return (
    <section className="app-material-content max-h-[46%] min-h-0 overflow-auto rounded-lg border p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="truncate text-xs font-semibold uppercase tracking-wide text-[color:var(--editor-tab-muted)]">
          {t("analysis.research.title")}
        </h4>
        {bibtexPath ? (
          <button
            type="button"
            className="panel-topbar-btn inline-flex h-7 shrink-0 items-center gap-1 rounded border px-2 text-[10px]"
            onClick={() => onExportArtifact(bibtexPath)}
            title={t("analysis.research.exportBibtex")}
          >
            <Download className="h-3 w-3" />
            {t("analysis.research.exportBibtex")}
          </button>
        ) : null}
      </div>
      <ol className="grid grid-cols-5 gap-1 max-[1100px]:grid-cols-1">
        {run.researchStages.map((stage) => (
          <li
            key={stage.id}
            className={cn("min-w-0 rounded-md border px-1.5 py-1", statusTone(stage.status))}
          >
            <div className="truncate text-[9px] font-semibold uppercase tracking-wide">
              {t(`analysis.research.stage.${stage.id}`)}
            </div>
            <div className="truncate text-[9px] opacity-80">
              {t(`analysis.research.status.${stage.status}`)}
            </div>
          </li>
        ))}
      </ol>
      {run.researchStages.some(
        (stage) => stage.id === "evidence"
          && stage.status === "skipped"
          && stage.detailCode === "local_data_sufficient",
      ) ? (
        <p className="app-status-info mt-2 rounded-md border px-2 py-1 text-[10px]">
          {t("analysis.research.networkSkipped")}
        </p>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] font-semibold text-[color:var(--editor-tab-active-text)]">
          {t("analysis.research.evidenceBasket")} · {academic.length + web.length}
        </summary>
        <div className="mt-2 space-y-2">
          {noEvidence ? (
            <p className="text-[10px] text-[color:var(--editor-tab-muted)]">
              {t("analysis.research.noEvidence")}
            </p>
          ) : null}
          <EvidenceList
            title={t("analysis.research.academicEvidence")}
            icon="academic"
            items={academic}
            t={t}
          />
          <EvidenceList
            title={t("analysis.research.webEvidence")}
            icon="web"
            items={web}
            t={t}
          />
          <ProviderHealth items={run.providerHealth ?? []} t={t} />
        </div>
      </details>
    </section>
  );
}
