import { useEffect, useRef, useState } from "react";
import type { AnalysisTask } from "../../hooks/analysisTypes";

type TranslationFn = (key: any) => string;

function HistoryIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M7.75 2.25a5.5 5.5 0 1 1-4.94 3.07H1.75a.75.75 0 0 1 0-1.5h2.5c.41 0 .75.34.75.75v2.5a.75.75 0 0 1-1.5 0V6.33A4 4 0 1 0 7.75 3.75a.75.75 0 0 1 0-1.5Zm.75 2.5a.75.75 0 0 0-1.5 0v2.83c0 .2.08.39.22.53l1.75 1.75a.75.75 0 0 0 1.06-1.06L8.5 7.27V4.75Z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatRunTime(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "-";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleString();
}

export function AnalysisTaskHistoryMenu(props: {
  task: AnalysisTask;
  disabled?: boolean;
  onSelectRun: (runId: string) => void;
  t: TranslationFn;
}) {
  const { task, disabled = false, onSelectRun, t } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeRunId = typeof task.activeRunId === "string" && task.activeRunId.trim()
    ? task.activeRunId
    : task.runs[0]?.id ?? "";

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  if (task.runs.length === 0) {
    return (
      <button
        type="button"
        className="rounded p-0.5 text-slate-300"
        title={t("analysis.history")}
        disabled
      >
        <HistoryIcon />
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="rounded p-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        title={t("analysis.history")}
        aria-label={t("analysis.history")}
        disabled={disabled}
      >
        <span data-tooltip={t("analysis.history")}>
          <HistoryIcon />
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t("analysis.history")}
          </div>
          <div className="max-h-72 overflow-auto p-1">
            {task.runs.map((run) => {
              const active = run.id === activeRunId;
              return (
                <button
                  key={run.id}
                  type="button"
                  className={`mb-1 grid w-full gap-0.5 rounded-md border px-2 py-1.5 text-left text-[11px] transition last:mb-0 ${
                    active
                      ? "border-primary-300 bg-primary-50 text-primary-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    onSelectRun(run.id);
                    setOpen(false);
                  }}
                  title={`${run.title}\n${formatRunTime(run.createdAt)}`}
                >
                  <span className="truncate font-semibold">{run.title}</span>
                  <span className="truncate text-slate-500">{formatRunTime(run.createdAt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
