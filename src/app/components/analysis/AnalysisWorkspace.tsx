import { ChevronDown, ChevronUp, Download, FolderOpen, Plus } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import type { AnalysisTask, AnalysisTaskRun } from "../../hooks/analysisTypes";
import { AnalysisLiveRail } from "./AnalysisLiveRail";
import { AnalysisPromptOverlay } from "./AnalysisPromptOverlay";
import { AnalysisRunTimeline, type AnalysisTimelineCard } from "./AnalysisRunTimeline";
import { AnalysisTaskTabs } from "./AnalysisTaskTabs";

type TranslationFn = (key: any) => string;

function canAcceptDrop(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes("application/x-latotex-path") || types.includes("text/plain");
}

function parseDroppedPaths(event: DragEvent): string[] {
  const dataTransfer = event.dataTransfer;
  const customRaw = dataTransfer.getData("application/x-latotex-path");
  const customPaths = customRaw
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const plainRaw = dataTransfer.getData("text/plain");
  const plainPaths = plainRaw
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set([...customPaths, ...plainPaths]));
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
  liveTimelineCards: AnalysisTimelineCard[];
  liveStageLabel: string;
  liveOutput: string;
  canContinue: boolean;
  candidateFiles: string[];
  onPromptChange: (value: string) => void;
  onDropPaths: (paths: string[]) => void;
  onRun: () => void;
  onRunTeams: () => void;
  onContinue: () => void;
  onSelectTask: (taskId: string) => void;
  onCreateTask: () => void;
  onRenameTask: (taskId: string, name: string) => void;
  onSelectRun: (taskId: string, runId: string) => void;
  onDeleteTask: (taskId: string) => void;
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
    liveTimelineCards,
    liveStageLabel,
    liveOutput,
    canContinue,
    candidateFiles,
    onPromptChange,
    onDropPaths,
    onRun,
    onRunTeams,
    onContinue,
    onSelectTask,
    onCreateTask,
    onRenameTask,
    onSelectRun,
    onDeleteTask,
    onExportArtifact,
    onRevealArtifact,
    t,
  } = props;
  const [dragActive, setDragActive] = useState(false);
  const [collapsedRunHeaders, setCollapsedRunHeaders] = useState<Record<string, boolean>>({});
  const hasLiveStream = running || Boolean(liveStageLabel.trim() || liveTimelineCards.length > 0);
  const displayTimelineCards = hasLiveStream ? liveTimelineCards : timelineCards;
  const persistedDraftOutput = activeRun?.draftOutputText?.trim() ?? "";
  const currentDraftOutput = liveOutput.trim() || persistedDraftOutput;
  const activeTaskName = useMemo(
    () => tasks.find((item) => item.id === activeTaskId)?.name?.trim() || t("analysis.defaultTaskName"),
    [activeTaskId, tasks, t],
  );
  const headerCollapsed = activeRun?.status === "completed"
    ? (collapsedRunHeaders[activeRun.id] ?? true)
    : false;

  const toggleHeaderCollapsed = () => {
    if (!activeRun || activeRun.status !== "completed") {
      return;
    }
    setCollapsedRunHeaders((prev) => ({
      ...prev,
      [activeRun.id]: !(prev[activeRun.id] ?? true),
    }));
  };

  return (
    <div className="relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-slate-200 bg-white shadow-soft motion-shell-stage motion-panel-glow">
      <AnalysisTaskTabs
        tasks={tasks}
        activeTaskId={activeTaskId}
        running={running}
        onSelectTask={onSelectTask}
        onCreateTask={onCreateTask}
        onRenameTask={onRenameTask}
        onSelectRun={onSelectRun}
        onDeleteTask={onDeleteTask}
        t={t}
      />

      <div
        className={`grid min-h-0 px-3 pt-2 pb-3 ${tasks.length > 0 ? "grid-rows-[minmax(0,1fr)_auto]" : "grid-rows-[minmax(0,1fr)]"} ${dragActive ? "rounded-b-lg border border-primary-300 bg-primary-50/30" : ""}`}
        onDragOver={(event) => {
          if (!canAcceptDrop(event)) {
            return;
          }
          event.preventDefault();
          if (!dragActive) {
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          if (!canAcceptDrop(event)) {
            return;
          }
          event.preventDefault();
          setDragActive(false);
          onDropPaths(parseDroppedPaths(event));
        }}
      >
        <div className="relative min-h-0">
          {errorMessage ? (
            <div className="mb-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          {tasks.length === 0 ? (
            <button
              className="flex h-full w-full min-h-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-500 transition motion-hover-rise hover:border-primary-300 hover:bg-primary-50/40 hover:text-primary-700"
              onClick={onCreateTask}
              disabled={running}
            >
              <span className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white">
                <Plus className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium">{t("analysis.emptyTaskTitle")}</span>
              <span className="mt-1 text-xs">{t("analysis.emptyTaskHint")}</span>
            </button>
          ) : hasLiveStream ? (
            <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] grid-rows-[auto_minmax(0,1fr)] gap-2">
              <div className="col-span-2 min-w-0">
                <AnalysisLiveRail
                  stageLabel={liveStageLabel}
                  cards={liveTimelineCards}
                  running={running}
                  t={t}
                />
              </div>
              <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-4 motion-card-pop">
                <div className="text-slate-600">
                  <div className="mb-2 inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-primary-700">
                    {activeTaskName}
                  </div>
                  <p className="text-sm font-medium text-slate-700">{t("analysis.centerRunning")}</p>
                </div>
                <div className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
                  {currentDraftOutput ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                      {currentDraftOutput}
                    </pre>
                  ) : (
                    <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-slate-500">
                      {t("analysis.liveOutputEmpty")}
                    </div>
                  )}
                </div>
              </section>
              <aside className="min-h-0 overflow-hidden">
                <AnalysisRunTimeline cards={displayTimelineCards} t={t} compact />
              </aside>
            </div>
          ) : !activeRun ? (
            <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-4 motion-page-in">
              <span className="text-sm text-slate-500">
                {running ? t("analysis.centerRunning") : t("analysis.blankHint")}
              </span>
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-2">
              <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 motion-card-pop">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-slate-800">{activeRun.title}</h3>
                        {activeRun.status === "completed" ? (
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                            onClick={toggleHeaderCollapsed}
                            title={headerCollapsed ? t("analysis.expandHeader") : t("analysis.collapseHeader")}
                            aria-label={headerCollapsed ? t("analysis.expandHeader") : t("analysis.collapseHeader")}
                          >
                            {headerCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                      </div>
                      {!headerCollapsed ? (
                        <p className="mt-1 text-xs text-slate-700">{activeRun.summary}</p>
                      ) : null}
                      {activeRun.failureMessage ? (
                        <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                          {activeRun.failureMessage}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {activeRun.reportRelativePath ? (
                        <>
                          <button
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                            onClick={() => onRevealArtifact(activeRun.reportRelativePath!)}
                          >
                            <FolderOpen className="mr-1 inline h-3 w-3" />
                            {t("analysis.openLocation")}
                          </button>
                          <button
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                            onClick={() => onExportArtifact(activeRun.reportRelativePath!)}
                          >
                            <Download className="mr-1 inline h-3 w-3" />
                            {t("analysis.saveAs")}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {activeRun.status === "completed" ? (
                  <iframe
                    key={activeRun.id}
                    title={t("analysis.reportTitle")}
                    srcDoc={activeRunHtml}
                    className="h-full min-h-0 w-full rounded-lg border border-slate-200 bg-white"
                  />
                ) : (
                  <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
                    {persistedDraftOutput ? (
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                        {persistedDraftOutput}
                      </pre>
                    ) : (
                      <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-slate-500">
                        {t("analysis.liveOutputEmpty")}
                      </div>
                    )}
                  </section>
                )}
              </div>

              <aside className="min-h-0 overflow-hidden">
                <AnalysisRunTimeline cards={displayTimelineCards} t={t} />
              </aside>
            </div>
          )}
        </div>

        {tasks.length > 0 ? (
          <div className="pt-2">
            <AnalysisPromptOverlay
              embedded
              prompt={prompt}
              canRun={canRun}
              running={running}
              busy={busy}
              canContinue={canContinue}
              candidateFiles={candidateFiles}
              onPromptChange={onPromptChange}
              onDropPaths={onDropPaths}
              onRun={onRun}
              onRunTeams={onRunTeams}
              onContinue={onContinue}
              t={t}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
