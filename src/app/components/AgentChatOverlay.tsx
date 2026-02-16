import { ChevronDown, ChevronUp, MessageSquareMore, Send, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/utils";

export type AgentPhase = "idle" | "starting" | "running" | "done" | "error";

export type AgentMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
};

export function AgentChatOverlay(props: {
  collapsed: boolean;
  phase: AgentPhase;
  statusLine: string;
  title: string;
  collapseLabel: string;
  prompt: string;
  busy: boolean;
  messages: AgentMessage[];
  onPromptChange: (value: string) => void;
  onRun: () => void;
  onToggle: () => void;
  runLabel: string;
  placeholder: string;
  activityShowLabel: string;
  activityHideLabel: string;
}) {
  const {
    collapsed,
    phase,
    statusLine,
    title,
    collapseLabel,
    prompt,
    busy,
    messages,
    onPromptChange,
    onRun,
    onToggle,
    runLabel,
    placeholder,
    activityShowLabel,
    activityHideLabel,
  } = props;
  const [activityExpanded, setActivityExpanded] = useState(false);
  const canShowActivity = phase !== "idle" || messages.length > 0;
  const recentMessages = useMemo(() => messages.slice(-8), [messages]);

  if (collapsed) {
    return (
      <button
        className={cn(
          "absolute bottom-3 left-1/2 z-20 flex max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs shadow-soft transition",
          phase === "error"
            ? "border-rose-300 bg-rose-50 text-rose-700"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        )}
        onClick={onToggle}
        title={statusLine}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{statusLine}</span>
      </button>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
      <div
        className="pointer-events-auto grid w-[min(78%,920px)] max-w-[calc(100%-6px)] min-w-[320px] max-h-[calc(100%-12px)] grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-300 bg-white/95 shadow-soft motion-slide-up"
        style={{
          height: activityExpanded ? "clamp(220px, 46%, 420px)" : "clamp(136px, 29%, 236px)",
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-700">
            <MessageSquareMore className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{title}</span>
            <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {statusLine}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {canShowActivity && (
              <button
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                onClick={() => setActivityExpanded((prev) => !prev)}
                title={activityExpanded ? activityHideLabel : activityShowLabel}
                aria-label={activityExpanded ? activityHideLabel : activityShowLabel}
              >
                {activityExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <button
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              onClick={onToggle}
              title={collapseLabel}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {activityExpanded && (
            <div className="min-h-0 flex-1 space-y-1 overflow-auto border-b border-slate-200 px-3 py-2">
              {recentMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs leading-5",
                    message.role === "user"
                      ? "bg-primary-50 text-primary-900"
                      : "bg-slate-100 text-slate-700",
                  )}
                >
                  {message.text}
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto p-3">
            <div className="relative">
              <textarea
                className={cn(
                  "w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 pr-10 text-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
                  activityExpanded
                    ? "h-[clamp(84px,16vh,132px)]"
                    : "h-[clamp(78px,15vh,112px)]",
                )}
                value={prompt}
                placeholder={placeholder}
                onChange={(event) => onPromptChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (!busy && prompt.trim()) {
                      onRun();
                    }
                  }
                }}
              />
              <button
                className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary-600 bg-primary-600 text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={onRun}
                disabled={busy || !prompt.trim()}
                title={runLabel}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
