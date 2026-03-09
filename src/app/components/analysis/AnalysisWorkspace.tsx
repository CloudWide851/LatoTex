import { Download, FolderOpen, Plus } from "lucide-react";
import type { AnalysisTask, AnalysisTaskRun } from "../../hooks/analysisTypes";
import { AnalysisPromptOverlay } from "./AnalysisPromptOverlay";
import { AnalysisRunTimeline, type AnalysisTimelineCard } from "./AnalysisRunTimeline";
import { AnalysisTaskTabs } from "./AnalysisTaskTabs";

type TranslationFn = (key: any) => string;

function renderArtifacts(
  paths: string[],
  t: TranslationFn,
  onExportArtifact: (relativePath: string) => void,
  onRevealArtifact: (relativePath: string) => void,
) {
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
}

export function AnalysisWorkspace(props: {
  busy: boolean;
  prompt: string;
  canRun: boolean;
  running: boolean;
  errorMessage: string | null;
  tasks: AnalysisTask[];
  activeTaskId: string | null;
  activeRun: AnalysisTaskRun | null;
  activeRunHtml: string;
  timelineCards: AnalysisTimelineCard[];
  candidateFiles: string[];
  onPromptChange: (value: string) => void;
  onRun: () => void;
  onSelectTask: (taskId: string) => void;
  onCreateTask: () => void;
  onRenameTask: (taskId: string, name: string) => void;
  onDeleteTask: (taskId: string) => void;
  onSetActiveRun: (taskId: string, runId: string) => void;
  onExportArtifact: (relativePath: string) => void;
  onRevealArtifact: (relativePath: string) => void;
  t: TranslationFn;
}) {
  const {
    busy,
    prompt,
    canRun,
    running,
    errorMessage,
    tasks,
    activeTaskId,
    activeRun,
    activeRunHtml,
    timelineCards,
    candidateFiles,
    onPromptChange,
    onRun,
    onSelectTask,
    onCreateTask,
    onRenameTask,
    onDeleteTask,
    onSetActiveRun,
    onExportArtifact,
    onRevealArtifact,
    t,
  } = props;

  return (
    <div className="relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-slate-200 bg-white shadow-soft motion-slide-up">
      <AnalysisTaskTabs
        tasks={tasks}
        activeTaskId={activeTaskId}
        running={running}
        onSelectTask={onSelectTask}
        onCreateTask={onCreateTask}
        onRenameTask={onRenameTask}
        onDeleteTask={onDeleteTask}
        t={t}
      />

      <div className="relative min-h-0 px-3 pb-32 pt-2">
        {errorMessage ? (
          <div className="mb-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        {tasks.length === 0 ? (
          <button
            className="flex h-full w-full min-h-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-500 transition hover:border-primary-300 hover:bg-primary-50/40 hover:text-primary-700"
            onClick={onCreateTask}
            disabled={running}
          >
            <span className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white">
              <Plus className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium">{t("analysis.emptyTaskTitle")}</span>
            <span className="mt-1 text-xs">{t("analysis.emptyTaskHint")}</span>
          </button>
        ) : !activeRun ? (
          <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
            {running ? t("analysis.centerRunning") : t("analysis.blankHint")}
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-2">
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <h3 className="text-sm font-semibold text-slate-800">{activeRun.title}</h3>
                <p className="mt-1 text-xs text-slate-600">{activeRun.summary}</p>
                <div className="mt-2 flex items-center gap-1">
                  {activeRun.reportRelativePath && (
                    <>
                      <button
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                        onClick={() => onRevealArtifact(activeRun.reportRelativePath!)}
                      >
                        <FolderOpen className="mr-1 inline h-3 w-3" />
                        {t("analysis.openLocation")}
                      </button>
                      <button
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                        onClick={() => onExportArtifact(activeRun.reportRelativePath!)}
                      >
                        <Download className="mr-1 inline h-3 w-3" />
                        {t("analysis.saveAs")}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <iframe
                key={activeRun.id}
                title={t("analysis.reportTitle")}
                srcDoc={activeRunHtml}
                className="h-full min-h-0 w-full rounded-lg border border-slate-200 bg-white"
              />
            </div>

            <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-hidden">
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analysis.artifacts")}</h4>
              </section>
              <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                {renderArtifacts(activeRun.assetRelativePaths, t, onExportArtifact, onRevealArtifact)}
              </section>
              <AnalysisRunTimeline cards={timelineCards} t={t} />
              <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analysis.history")}</h4>
                <div className="space-y-1">
                  {(tasks.find((item) => item.id === activeTaskId)?.runs ?? []).map((item) => (
                    <div key={item.id} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                      <button className="w-full truncate text-left font-medium" onClick={() => onSetActiveRun(activeTaskId!, item.id)}>
                        {item.title}
                      </button>
                      <div className="mt-1 flex items-center gap-1">
                        {item.reportRelativePath ? (
                          <>
                            <button
                              className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
                              onClick={() => onRevealArtifact(item.reportRelativePath!)}
                            >
                              {t("analysis.openLocation")}
                            </button>
                            <button
                              className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
                              onClick={() => onExportArtifact(item.reportRelativePath!)}
                            >
                              {t("analysis.saveAs")}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>

      {tasks.length > 0 ? (
        <AnalysisPromptOverlay
          prompt={prompt}
          canRun={canRun}
          running={running}
          busy={busy}
          candidateFiles={candidateFiles}
          onPromptChange={onPromptChange}
          onRun={onRun}
          t={t}
        />
      ) : null}
    </div>
  );
}
