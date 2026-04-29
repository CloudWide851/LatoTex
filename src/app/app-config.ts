import {
  Bot,
  BrainCircuit,
  FileCode2,
  GitBranch,
  Globe,
  Languages,
  Library,
  Network,
  Palette,
  PenTool,
  UsersRound,
  SearchCode,
  Settings2,
  Wrench,
} from "lucide-react";
import type {
  AgentModelBinding,
  ModelCatalogItem,
  ModelProtocol,
  PanelLayoutPrefs,
  ProjectSummary,
  ResourceNode,
  WorkspacePage,
} from "../shared/types/app";

export type Toast = { type: "info" | "error"; message: string } | null;
export type SettingsSection =
  | "general"
  | "appearance"
  | "models"
  | "agents"
  | "agent-teams"
  | "agent-tools"
  | "mcp"
  | "skills"
  | "channels"
  | "diagnostics";
export type OverlayType = "logs" | null;
export type LogTab = "status" | "events";
export type DeleteIntent = { scope: "workspace" | "library"; path: string } | null;
export type ThemeMode = "light" | "dark" | "system";
export type ThemeTransition = {
  x: number;
  y: number;
  radius: number;
  target: "light" | "dark";
  active: boolean;
};
export type AgentStatusKey =
  | "agent.statusIdle"
  | "agent.statusRunning"
  | "agent.statusDone"
  | "agent.statusError";

export const FIXED_AGENT_ROLES = [
  "plan",
  "task",
  "completion",
  "explore",
  "web_search",
  "review",
  "ephemeral",
  "git_summary",
] as const;

export const PAGE_ITEMS: Array<{
  id: WorkspacePage;
  key: "nav.latex" | "nav.analysis" | "nav.draw" | "nav.library" | "nav.git" | "nav.settings";
  icon: typeof FileCode2;
}> = [
  { id: "latex", key: "nav.latex", icon: FileCode2 },
  { id: "analysis", key: "nav.analysis", icon: SearchCode },
  { id: "draw", key: "nav.draw", icon: PenTool },
  { id: "library", key: "nav.library", icon: Library },
  { id: "git", key: "nav.git", icon: GitBranch },
  { id: "settings", key: "nav.settings", icon: Settings2 },
];

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  key:
    | "settings.section.general"
    | "settings.section.appearance"
    | "settings.section.models"
    | "settings.section.agents"
    | "settings.section.agentTeams"
    | "settings.section.agentTools"
    | "settings.section.mcp"
    | "settings.section.skills"
    | "settings.section.channels"
    | "settings.section.diagnostics";
  icon: typeof Languages;
}> = [
  { id: "general", key: "settings.section.general", icon: Languages },
  { id: "appearance", key: "settings.section.appearance", icon: Palette },
  { id: "models", key: "settings.section.models", icon: Globe },
  { id: "agents", key: "settings.section.agents", icon: Bot },
  { id: "agent-teams", key: "settings.section.agentTeams", icon: UsersRound },
  { id: "agent-tools", key: "settings.section.agentTools", icon: Wrench },
  { id: "mcp", key: "settings.section.mcp", icon: Network },
  { id: "skills", key: "settings.section.skills", icon: BrainCircuit },
  { id: "channels", key: "settings.section.channels", icon: Globe },
  { id: "diagnostics", key: "settings.section.diagnostics", icon: Settings2 },
];

export const DEFAULT_PROTOCOLS: ModelProtocol[] = [
  {
    id: "openai-compatible",
    displayName: "OpenAI-Compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeySet: false,
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeySet: false,
  },
  {
    id: "gemini",
    displayName: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKeySet: false,
  },
];

export const DEFAULT_CATALOG: ModelCatalogItem[] = [
  // Intentionally empty: models are user-defined in settings.
];

export const DEFAULT_BINDINGS: AgentModelBinding[] = [
  ...FIXED_AGENT_ROLES.map((role) => ({ role, modelId: "" })),
];

export const DEFAULT_PANEL_LAYOUT: PanelLayoutPrefs = {
  shell: [7, 93],
  latex: [22, 48, 30],
  analysis: [26, 74],
  library: [30, 70],
  git: [100],
  settings: [100],
};

export const SHELL_MIN = [6, 80] as const;
export const THEME_TRANSITION_MS = 420;

function detectSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? detectSystemTheme() : mode;
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }
  const actual = resolveTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = actual;
  root.classList.toggle("dark", actual === "dark");
}

export function clampLayout(layout: number[] | undefined, fallback: number[]): number[] {
  if (!layout || layout.length !== fallback.length) {
    return fallback;
  }
  const cleaned = layout.map((value) =>
    Number.isFinite(value) ? Math.max(5, Math.min(95, value)) : 0,
  );
  const sum = cleaned.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    return fallback;
  }
  return cleaned.map((value) => (value / sum) * 100);
}

export function flattenFiles(nodes: ResourceNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "file") {
      acc.push(node.relativePath);
    } else {
      flattenFiles(node.children, acc);
    }
  }
  return acc;
}

export function upsertProject(projects: ProjectSummary[], snapshot: ProjectSummary): ProjectSummary[] {
  const next = projects.filter((item) => item.id !== snapshot.id);
  next.unshift(snapshot);
  return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function normalizeAgentBindings(bindings: AgentModelBinding[]): AgentModelBinding[] {
  const map = new Map<string, string>();
  for (const item of bindings) {
    map.set(item.role, item.modelId ?? "");
  }
  return FIXED_AGENT_ROLES.map((role) => ({
    role,
    modelId: map.get(role) ?? "",
  }));
}
