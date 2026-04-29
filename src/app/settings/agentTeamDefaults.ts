import type { AgentTeamConfig, AgentTeamPrefs, AgentTeamRolePrefs } from "../../shared/types/app";

export const DEFAULT_AGENT_TEAM_ID = "research-ide";

export const DEFAULT_AGENT_TEAM_ROLES: AgentTeamRolePrefs[] = [
  {
    id: "planner",
    name: "Planner",
    phase: "plan",
    description: "Break the request into concrete tasks and constraints.",
    identityPrompt: "You are the planning lead. Produce concise task structure, assumptions, and risks before execution.",
    canWrite: false,
    toolAccess: ["workspace"],
    color: "#2563eb",
    enabled: true,
  },
  {
    id: "researcher",
    name: "Researcher",
    phase: "research",
    description: "Gather workspace, web, Python, MCP, and skill context.",
    identityPrompt: "You are the research agent. Prefer evidence, cite the files or tool outputs you used, and keep output compact.",
    canWrite: false,
    toolAccess: ["workspace", "web", "python", "mcp"],
    mcpServerIds: ["stitch"],
    skillIds: ["stitch"],
    color: "#0f766e",
    enabled: true,
  },
  {
    id: "editor",
    name: "Editor",
    phase: "edit",
    description: "Prepare the final answer or file edit proposal.",
    identityPrompt: "You are the editor agent. Turn prior findings into a precise answer or minimal file edit proposal.",
    canWrite: true,
    toolAccess: ["workspace"],
    color: "#16a34a",
    enabled: true,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    phase: "review",
    description: "Check regressions, edge cases, and missing validation.",
    identityPrompt: "You are the reviewer agent. Challenge weak assumptions, verify scope, and summarize remaining risk.",
    canWrite: false,
    toolAccess: ["workspace"],
    color: "#a855f7",
    enabled: true,
  },
];

export const DEFAULT_AGENT_TEAM: AgentTeamConfig = {
  id: DEFAULT_AGENT_TEAM_ID,
  name: "Research IDE Team",
  enabled: true,
  callsites: ["latex.overlay", "analysis.workspace", "chat.workspace"],
  parallelism: 2,
  requirePlanApproval: false,
  roles: DEFAULT_AGENT_TEAM_ROLES,
};

export const DEFAULT_AGENT_TEAM_PREFS: AgentTeamPrefs = {
  enabled: true,
  defaultTeamId: DEFAULT_AGENT_TEAM_ID,
  teams: [DEFAULT_AGENT_TEAM],
};

export function normalizeAgentTeamPrefs(input?: AgentTeamPrefs | null): AgentTeamPrefs {
  const sourceTeams = Array.isArray(input?.teams) && input?.teams?.length
    ? input.teams
    : DEFAULT_AGENT_TEAM_PREFS.teams ?? [];
  const teams = sourceTeams
    .map((team) => ({
      ...DEFAULT_AGENT_TEAM,
      ...team,
      id: String(team.id ?? "").trim() || DEFAULT_AGENT_TEAM_ID,
      name: String(team.name ?? "").trim() || DEFAULT_AGENT_TEAM.name,
      callsites: Array.from(new Set((team.callsites ?? DEFAULT_AGENT_TEAM.callsites ?? [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean))),
      parallelism: Math.max(1, Math.min(4, Number(team.parallelism ?? DEFAULT_AGENT_TEAM.parallelism ?? 2))),
      roles: (Array.isArray(team.roles) && team.roles.length ? team.roles : DEFAULT_AGENT_TEAM_ROLES)
        .map((role, index) => {
          const fallback = DEFAULT_AGENT_TEAM_ROLES[index] ?? DEFAULT_AGENT_TEAM_ROLES[0];
          return {
            ...fallback,
            ...role,
            id: String(role.id ?? "").trim() || fallback.id,
            name: String(role.name ?? "").trim() || fallback.name,
            toolAccess: Array.from(new Set((role.toolAccess ?? fallback.toolAccess ?? [])
              .map((item) => String(item ?? "").trim())
              .filter(Boolean))),
            mcpServerIds: Array.from(new Set((role.mcpServerIds ?? fallback.mcpServerIds ?? [])
              .map((item) => String(item ?? "").trim())
              .filter(Boolean))),
            skillIds: Array.from(new Set((role.skillIds ?? fallback.skillIds ?? [])
              .map((item) => String(item ?? "").trim())
              .filter(Boolean))),
            enabled: role.enabled ?? true,
          };
        }),
      enabled: team.enabled ?? true,
    }))
    .filter((team) => team.id.length > 0);
  const defaultTeamId = String(input?.defaultTeamId ?? teams[0]?.id ?? DEFAULT_AGENT_TEAM_ID).trim();
  return {
    enabled: input?.enabled ?? true,
    defaultTeamId,
    teams: teams.length > 0 ? teams : [DEFAULT_AGENT_TEAM],
  };
}
