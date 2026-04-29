import { parse as parseYaml } from "yaml";

export type AgentAction = {
  type: string;
  tool?: string;
  status?: string;
  path?: string;
  query?: string;
  summary?: string;
  search?: string;
  replace?: string;
  results?: Array<{ path?: string; title?: string; url?: string; label?: string }>;
  queries?: string[];
  evidenceCount?: number;
  serverId?: string;
};

function normalizeAction(value: unknown): AgentAction | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";
  if (!type) {
    return null;
  }
  return {
    type,
    tool: typeof record.tool === "string" ? record.tool : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
    query: typeof record.query === "string" ? record.query : undefined,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    search: typeof record.search === "string" ? record.search : undefined,
    replace: typeof record.replace === "string" ? record.replace : undefined,
    results: Array.isArray(record.results)
      ? record.results
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .slice(0, 8)
        .map((item) => ({
          path: typeof item.path === "string" ? item.path : undefined,
          title: typeof item.title === "string" ? item.title : undefined,
          url: typeof item.url === "string" ? item.url : undefined,
          label: typeof item.label === "string" ? item.label : undefined,
        }))
      : undefined,
    queries: Array.isArray(record.queries)
      ? record.queries.filter((item): item is string => typeof item === "string").slice(0, 8)
      : undefined,
    evidenceCount: typeof record.evidenceCount === "number" ? record.evidenceCount : undefined,
    serverId: typeof record.serverId === "string" ? record.serverId : undefined,
  };
}

export function normalizeAgentActions(value: unknown): AgentAction[] {
  const source = Array.isArray(value) ? value : [];
  return source
    .map(normalizeAction)
    .filter((item): item is AgentAction => item !== null);
}

export function parseYamlAgentActions(raw: string): AgentAction[] {
  const actions: AgentAction[] = [];
  const fenceRegex = /```(?:ya?ml|agent-actions?)\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = fenceRegex.exec(raw);
  while (match) {
    try {
      const parsed = parseYaml(match[1] ?? "");
      const candidate = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown> | null)?.actions;
      actions.push(...normalizeAgentActions(candidate));
    } catch {
      // Ignore malformed action YAML; prose output remains visible.
    }
    match = fenceRegex.exec(raw);
  }
  return actions;
}
