import { MessageSquareMore, Send, Sparkles, X } from "lucide-react";
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
  } = props;

  if (collapsed) {
    return (
      <button
        className={cn(
          "absolute bottom-3 right-3 z-20 flex max-w-[360px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs shadow-soft transition",
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
    <div className="absolute bottom-3 right-3 z-20 grid h-[330px] w-[360px] grid-rows-[38px_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-soft motion-slide-up">
      <div className="flex items-center justify-between border-b border-slate-200 px-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <MessageSquareMore className="h-3.5 w-3.5" />
          <span>{title}</span>
        </div>
        <button
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          onClick={onToggle}
          title={collapseLabel}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2 overflow-auto p-3">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500">{statusLine}</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs",
                message.role === "user"
                  ? "ml-8 bg-primary-50 text-primary-900"
                  : "mr-8 bg-slate-100 text-slate-700",
              )}
            >
              {message.text}
            </div>
          ))
        )}
      </div>

      <div className="grid gap-2 border-t border-slate-200 p-3">
        <div className="relative">
          <textarea
            className="h-20 w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 pr-10 text-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
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
        <div className="text-[11px] text-slate-500">{runLabel}</div>
      </div>
    </div>
  );
}
