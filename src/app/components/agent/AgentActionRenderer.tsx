import { Search, FilePenLine, Play, Server } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { AgentAction } from "./agentActionParser";

function iconFor(type: string) {
  if (type === "replace" || type === "edit") {
    return FilePenLine;
  }
  if (type === "run") {
    return Play;
  }
  if (type === "call") {
    return Server;
  }
  return Search;
}

export function AgentActionRenderer(props: { actions: AgentAction[] }) {
  const { actions } = props;
  if (actions.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 grid gap-1.5">
      {actions.slice(0, 6).map((action, index) => {
        const Icon = iconFor(action.type);
        return (
          <div
            key={`${action.type}:${action.tool ?? ""}:${action.path ?? ""}:${index}`}
            className="rounded border border-slate-200 bg-white/80 px-2 py-1.5"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <Icon className="h-3.5 w-3.5" />
              <span>{action.tool ?? action.type}</span>
              {action.status ? <span className="ml-auto">{action.status}</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-600">
              {action.path ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{action.path}</span> : null}
              {action.query ? <span className="rounded bg-slate-100 px-1.5 py-0.5">{action.query}</span> : null}
              {action.serverId ? <span className="rounded bg-slate-100 px-1.5 py-0.5">{action.serverId}</span> : null}
              {typeof action.evidenceCount === "number" ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5">#{action.evidenceCount}</span>
              ) : null}
            </div>
            {action.queries?.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {action.queries.slice(0, 4).map((query) => (
                  <span key={query} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                    {query}
                  </span>
                ))}
              </div>
            ) : null}
            {action.results?.length ? (
              <div className="mt-1 grid gap-1">
                {action.results.slice(0, 4).map((result, resultIndex) => (
                  <div
                    key={`${result.path ?? result.url ?? result.title ?? resultIndex}`}
                    className={cn("truncate rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600")}
                    title={result.path ?? result.url ?? result.title ?? result.label}
                  >
                    {result.path ?? result.title ?? result.url ?? result.label}
                  </div>
                ))}
              </div>
            ) : null}
            {action.summary ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-4 text-slate-600">
                {action.summary}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
