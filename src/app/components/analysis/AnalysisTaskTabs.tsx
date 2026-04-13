import { Edit3, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../../lib/utils";
import type { AnalysisTask } from "../../hooks/analysisTypes";
import { AnalysisTaskHistoryMenu } from "./AnalysisTaskHistoryMenu";

type TranslationFn = (key: any) => string;

export function AnalysisTaskTabs(props: {
  tasks: AnalysisTask[];
  activeTaskId: string | null;
  running: boolean;
  onSelectTask: (taskId: string) => void;
  onCreateTask: () => void;
  onRenameTask: (taskId: string, name: string) => void;
  onSelectRun: (taskId: string, runId: string) => void;
  onDeleteTask: (taskId: string) => void;
  t: TranslationFn;
}) {
  const { tasks, activeTaskId, running, onSelectTask, onCreateTask, onRenameTask, onSelectRun, onDeleteTask, t } = props;
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isComposing, setIsComposing] = useState(false);

  const beginRename = (task: AnalysisTask) => {
    setEditingTaskId(task.id);
    setEditingName(task.name);
  };

  const commitRename = (taskId: string) => {
    const normalized = editingName.trim();
    if (normalized.length > 0) {
      onRenameTask(taskId, normalized);
    }
    setEditingTaskId(null);
  };

  return (
    <div className="panel-topbar flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/70 px-2 py-1.5">
      {tasks.map((task) => {
        const active = task.id === activeTaskId;
        const editing = task.id === editingTaskId;
        return (
          <div
            key={task.id}
            className={cn(
              "group inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs shadow-[0_0_0_0_transparent]",
              active
                ? "border-primary-400 bg-primary-50 text-primary-700 shadow-sm"
                : "border-slate-300 bg-white text-slate-700",
            )}
          >
            {editing ? (
              <input
                className="w-36 rounded border border-slate-300 px-1.5 py-0.5 text-xs outline-none focus:border-primary-500"
                value={editingName}
                autoFocus
                onChange={(event) => setEditingName(event.target.value)}
                onBlur={() => commitRename(task.id)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isComposing) {
                    event.preventDefault();
                    commitRename(task.id);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingTaskId(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="truncate text-left"
                onClick={() => onSelectTask(task.id)}
                onDoubleClick={() => beginRename(task)}
                title={task.name}
              >
                {task.name}
              </button>
            )}
            <button
              type="button"
              className="rounded p-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginRename(task);
              }}
              title={t("analysis.renameTask")}
            >
              <Edit3 className="h-3 w-3" />
            </button>
            <AnalysisTaskHistoryMenu
              task={task}
              disabled={running}
              onSelectRun={(runId) => onSelectRun(task.id, runId)}
              t={t}
            />
            <button
              type="button"
              className="rounded p-0.5 text-slate-500 transition hover:bg-rose-100 hover:text-rose-700"
              onClick={() => onDeleteTask(task.id)}
              title={t("analysis.deleteTask")}
              disabled={running}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="panel-topbar-btn inline-flex shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        onClick={onCreateTask}
        title={t("analysis.newTask")}
        disabled={running}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
