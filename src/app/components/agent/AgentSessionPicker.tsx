import { cn } from "../../../lib/utils";
import type { AgentSessionSummary } from "../../hooks/agentTypes";

export function AgentSessionPicker(props: {
  open: boolean;
  sessions: AgentSessionSummary[];
  sessionPickerIndex: number;
  resumeTitle: string;
  resumeHint: string;
  resumeEmptyLabel: string;
  onSessionPickerIndexChange: (value: number) => void;
  onSessionConfirm: () => void;
}) {
  const {
    open,
    sessions,
    sessionPickerIndex,
    resumeTitle,
    resumeHint,
    resumeEmptyLabel,
    onSessionPickerIndexChange,
    onSessionConfirm,
  } = props;

  if (!open) {
    return null;
  }

  return (
    <div
      className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-30 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-soft"
      onWheel={(event) => {
        if (sessions.length === 0) {
          return;
        }
        event.preventDefault();
        const delta = event.deltaY > 0 ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(sessions.length - 1, sessionPickerIndex + delta));
        onSessionPickerIndexChange(nextIndex);
      }}
    >
      <div className="mb-1 px-2 py-1 text-[11px] font-semibold text-slate-700">{resumeTitle}</div>
      <div className="mb-1 px-2 text-[11px] text-slate-500">{resumeHint}</div>
      {sessions.length === 0 ? (
        <div className="px-2 py-2 text-xs text-slate-500">{resumeEmptyLabel}</div>
      ) : (
        sessions.map((session, index) => (
          <button
            key={session.id}
            className={cn(
              "flex w-full items-start justify-between gap-2 rounded px-2 py-1 text-left text-xs transition",
              index === sessionPickerIndex
                ? "bg-primary-50 text-primary-700"
                : "hover:bg-slate-100",
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              onSessionPickerIndexChange(index);
              onSessionConfirm();
            }}
          >
            <span className="truncate">{session.title}</span>
            <span className="shrink-0 text-[10px] text-slate-500">
              {Math.max(session.messageCount ?? 0, 0)}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
