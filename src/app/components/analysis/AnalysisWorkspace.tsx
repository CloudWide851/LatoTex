import { Download, FolderOpen } from "lucide-react";
import type { AnalysisReportItem } from "../../../shared/types/app";
import type { AnalysisResultView } from "../../hooks/useAnalysisWorkspace";
import { AnalysisPromptOverlay } from "./AnalysisPromptOverlay";

type TranslationFn = (key: any) => string;

export function AnalysisWorkspace(props: {
  busy: boolean;
  prompt: string;
  canRun: boolean;
  running: boolean;
  result: AnalysisResultView | null;
  reports: AnalysisReportItem[];
  onPromptChange: (value: string) => void;
  onRun: () => void;
  onRefresh: () => void;
  onExportArtifact: (relativePath: string) => void;
  onRevealArtifact: (relativePath: string) => void;
  t: TranslationFn;
}) {
  const {
    busy,
    prompt,
    canRun,
    running,
    result,
    reports,
    onPromptChange,
    onRun,
    onRefresh,
    onExportArtifact,
    onRevealArtifact,
    t,
  } = props;

  const renderArtifacts = (paths: string[]) => {
    if (paths.length === 0) {
      return (
        <div className="rounded border border-dashed border-slate-300 px-2 py-2 text-[11px] text-slate-500">
          {t("analysis.noArtifacts")}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {paths.map((path) => (
          <div key={path} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1">
            <span className="truncate text-[11px] text-slate-700">{path}</span>
            <div className="flex items-center gap-1">
              <button
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
                onClick={() => onRevealArtifact(path)}
              >
                {t("analysis.openLocation")}
              </button>
              <button
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
                onClick={() => onExportArtifact(path)}
              >
                {t("analysis.saveAs")}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="relative h-full min-h-0 rounded-lg border border-slate-200 bg-white p-3 shadow-soft motion-slide-up">
      {!result ? (
        <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 pb-28 text-sm text-slate-500">
          {t("analysis.blankHint")}
        </div>
      ) : (
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-2 pb-32">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <h3 className="text-sm font-semibold text-slate-800">{result.title}</h3>
              <p className="mt-1 text-xs text-slate-600">{result.summary}</p>
              <div className="mt-2 flex items-center gap-1">
                {result.reportRelativePath && (
                  <>
                    <button
                      className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      onClick={() => onRevealArtifact(result.reportRelativePath!)}
                    >
                      <FolderOpen className="mr-1 inline h-3 w-3" />
                      {t("analysis.openLocation")}
                    </button>
                    <button
                      className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      onClick={() => onExportArtifact(result.reportRelativePath!)}
                    >
                      <Download className="mr-1 inline h-3 w-3" />
                      {t("analysis.saveAs")}
                    </button>
                  </>
                )}
              </div>
            </div>
            <iframe
              title={t("analysis.reportTitle")}
              srcDoc={result.reportHtml}
              className="h-full min-h-0 w-full rounded-lg border border-slate-200 bg-white"
            />
          </div>

          <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-hidden">
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analysis.artifacts")}</h4>
            </section>
            <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              {renderArtifacts(result.assetRelativePaths)}
            </section>
            <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analysis.history")}</h4>
              <div className="space-y-1">
                {reports.map((item) => (
                  <div key={item.runId} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                    <div className="truncate font-medium">{item.runId}</div>
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
                        onClick={() => onRevealArtifact(item.reportRelativePath)}
                      >
                        {t("analysis.openLocation")}
                      </button>
                      <button
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
                        onClick={() => onExportArtifact(item.reportRelativePath)}
                      >
                        {t("analysis.saveAs")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
      <AnalysisPromptOverlay
        prompt={prompt}
        canRun={canRun}
        running={running}
        busy={busy}
        onPromptChange={onPromptChange}
        onRun={onRun}
        onRefresh={onRefresh}
        t={t}
      />
    </div>
  );
}
