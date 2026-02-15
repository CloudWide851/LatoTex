import {
  Bot,
  FileCode2,
  GitBranch,
  Globe,
  Languages,
  Library,
  Palette,
  SearchCode,
  Settings2,
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
export type SettingsSection = "general" | "appearance" | "models" | "agents" | "diagnostics";
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

export const PAGE_ITEMS: Array<{
  id: WorkspacePage;
  key: "nav.latex" | "nav.analysis" | "nav.library" | "nav.git" | "nav.settings";
  icon: typeof FileCode2;
}> = [
  { id: "latex", key: "nav.latex", icon: FileCode2 },
  { id: "analysis", key: "nav.analysis", icon: SearchCode },
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
    | "settings.section.diagnostics";
  icon: typeof Languages;
}> = [
  { id: "general", key: "settings.section.general", icon: Languages },
  { id: "appearance", key: "settings.section.appearance", icon: Palette },
  { id: "models", key: "settings.section.models", icon: Globe },
  { id: "agents", key: "settings.section.agents", icon: Bot },
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
  {
    id: "openai-gpt-4-1",
    protocolId: "openai-compatible",
    displayName: "GPT-4.1",
    requestName: "gpt-4.1",
  },
  {
    id: "openai-gpt-4-1-mini",
    protocolId: "openai-compatible",
    displayName: "GPT-4.1 Mini",
    requestName: "gpt-4.1-mini",
  },
  {
    id: "anthropic-claude-3-7-sonnet-latest",
    protocolId: "anthropic",
    displayName: "Claude 3.7 Sonnet",
    requestName: "claude-3-7-sonnet-latest",
  },
  {
    id: "gemini-2-0-flash",
    protocolId: "gemini",
    displayName: "Gemini 2.0 Flash",
    requestName: "gemini-2.0-flash",
  },
];

export const DEFAULT_BINDINGS: AgentModelBinding[] = [
  { role: "plan", modelId: "openai-gpt-4-1" },
  { role: "task", modelId: "anthropic-claude-3-7-sonnet-latest" },
  { role: "explore", modelId: "openai-gpt-4-1-mini" },
  { role: "web_search", modelId: "openai-gpt-4-1-mini" },
  { role: "review", modelId: "gemini-2-0-flash" },
  { role: "ephemeral", modelId: "openai-gpt-4-1-mini" },
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
