import type { SwarmEvent } from "../../../shared/types/app";

export type ActivityLine = {
  id: string;
  text: string;
  tone: "neutral" | "success" | "error";
};

function normalizeLine(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function lineFromEvent(event: SwarmEvent): ActivityLine | null {
  if (event.kind === "agent.run.heartbeat") {
    return null;
  }
  const payload = event.payload ?? {};
  const status = typeof payload.status === "string" ? payload.status : "";
  const stage = typeof payload.stage === "string" ? payload.stage : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  const tool = typeof payload.toolName === "string" ? payload.toolName : "";
  const content = typeof payload.content === "string" ? payload.content : "";

  const pathMatch = content.match(/path:\s*([^\n\r]+)/i);
  if (pathMatch?.[1]) {
    return {
      id: event.id,
      text: normalizeLine(pathMatch[1]),
      tone: "neutral",
    };
  }

  if (event.kind === "mcp.tool.call.started" || event.kind === "mcp.tool.call.completed") {
    const tone: ActivityLine["tone"] = event.kind.endsWith(".completed") ? "success" : "neutral";
    return {
      id: event.id,
      text: normalizeLine([tool || title || stage || event.kind, status].filter(Boolean).join(" · ")),
      tone,
    };
  }

  if (event.kind === "a2a.task.started" || event.kind === "a2a.task.completed") {
    return {
      id: event.id,
      text: normalizeLine([title || stage || event.kind, status].filter(Boolean).join(" · ")),
      tone: event.kind.endsWith(".completed") ? "success" : "neutral",
    };
  }

  if (event.kind === "agent.run.failed") {
    return {
      id: event.id,
      text: normalizeLine(content || title || event.kind),
      tone: "error",
    };
  }

  if (event.kind === "agent.run.cancelled" || event.kind === "agent.run.completed") {
    return {
      id: event.id,
      text: normalizeLine(title || event.kind),
      tone: event.kind.endsWith(".completed") ? "success" : "neutral",
    };
  }

  if (event.kind === "responses.output_text.delta") {
    const short = normalizeLine(content).slice(0, 180);
    if (!short) {
      return null;
    }
    return { id: event.id, text: short, tone: "neutral" };
  }

  if (!title && !status) {
    return null;
  }
  return {
    id: event.id,
    text: normalizeLine([title || stage || event.kind, status].filter(Boolean).join(" · ")),
    tone: "neutral",
  };
}

export function deltaTextFromEvent(event: SwarmEvent): string {
  if (event.kind !== "responses.output_text.delta") {
    return "";
  }
  const payload = event.payload ?? {};
  if (typeof payload.content === "string") {
    return payload.content;
  }
  if (typeof payload.delta === "string") {
    return payload.delta;
  }
  if (typeof payload.text === "string") {
    return payload.text;
  }
  return "";
}

export function toActivityLines(events: SwarmEvent[], runId: string | null): ActivityLine[] {
  if (!runId) {
    return [];
  }
  const lines = events
    .filter((event) => event.runId === runId)
    .sort((a, b) => a.seq - b.seq)
    .map((event) => lineFromEvent(event))
    .filter((line): line is ActivityLine => Boolean(line));
  const deduped: ActivityLine[] = [];
  for (const item of lines) {
    const prev = deduped[deduped.length - 1];
    if (prev?.text === item.text && prev.tone === item.tone) {
      continue;
    }
    deduped.push(item);
  }
  return deduped.slice(-120);
}

export function toneClass(tone: ActivityLine["tone"]): string {
  if (tone === "error") {
    return "text-rose-700";
  }
  if (tone === "success") {
    return "text-emerald-700";
  }
  return "text-slate-700";
}
