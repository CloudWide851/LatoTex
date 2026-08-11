import type {
  AgentWorkspaceLayoutPrefs,
  AgentWorkspacePanelSizes,
} from "../../shared/types/app";

export const DEFAULT_AGENT_WORKSPACE_PANEL_SIZES: AgentWorkspacePanelSizes = [18, 54, 28];

const TASKS_MIN = 14;
const TASKS_MAX = 28;
const INSPECTOR_MIN = 24;
const INSPECTOR_MAX = 42;
const CONVERSATION_MIN = 38;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundSize(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeAgentWorkspacePanelSizes(raw: unknown): AgentWorkspacePanelSizes {
  const values = Array.isArray(raw) && raw.length === 3
    ? raw
    : DEFAULT_AGENT_WORKSPACE_PANEL_SIZES;
  let tasks = clamp(
    finiteNumber(values[0], DEFAULT_AGENT_WORKSPACE_PANEL_SIZES[0]),
    TASKS_MIN,
    TASKS_MAX,
  );
  let inspector = clamp(
    finiteNumber(values[2], DEFAULT_AGENT_WORKSPACE_PANEL_SIZES[2]),
    INSPECTOR_MIN,
    INSPECTOR_MAX,
  );
  let conversation = 100 - tasks - inspector;
  if (conversation < CONVERSATION_MIN) {
    let deficit = CONVERSATION_MIN - conversation;
    const inspectorReduction = Math.min(deficit, inspector - INSPECTOR_MIN);
    inspector -= inspectorReduction;
    deficit -= inspectorReduction;
    tasks -= Math.min(deficit, tasks - TASKS_MIN);
    conversation = 100 - tasks - inspector;
  }
  return [roundSize(tasks), roundSize(conversation), roundSize(inspector)];
}

export function normalizeAgentWorkspaceLayoutPrefs(raw: unknown): Required<AgentWorkspaceLayoutPrefs> {
  const value = raw && typeof raw === "object" ? raw as AgentWorkspaceLayoutPrefs : {};
  return {
    tasksOpen: typeof value.tasksOpen === "boolean" ? value.tasksOpen : true,
    inspectorOpen: typeof value.inspectorOpen === "boolean" ? value.inspectorOpen : false,
    inspectorTab: value.inspectorTab === "evidence" ? "evidence" : "plan",
    panelSizes: normalizeAgentWorkspacePanelSizes(value.panelSizes),
  };
}

export function normalizeAgentWorkspaceLayoutMap(
  raw: Record<string, AgentWorkspaceLayoutPrefs> | undefined,
): Record<string, Required<AgentWorkspaceLayoutPrefs>> {
  return Object.fromEntries(
    Object.entries(raw ?? {})
      .map(([projectId, prefs]) => [projectId.trim(), normalizeAgentWorkspaceLayoutPrefs(prefs)] as const)
      .filter(([projectId]) => projectId.length > 0),
  );
}

export function mergeAgentWorkspaceVisibleLayout(
  current: AgentWorkspaceLayoutPrefs,
  visibleLayout: number[],
): AgentWorkspacePanelSizes {
  const normalized = normalizeAgentWorkspaceLayoutPrefs(current);
  const next = [...normalized.panelSizes] as AgentWorkspacePanelSizes;
  if (normalized.tasksOpen && normalized.inspectorOpen && visibleLayout.length === 3) {
    next[0] = visibleLayout[0];
    next[2] = visibleLayout[2];
  } else if (normalized.tasksOpen && visibleLayout.length === 2) {
    next[0] = visibleLayout[0];
  } else if (normalized.inspectorOpen && visibleLayout.length === 2) {
    next[2] = visibleLayout[1];
  }
  return normalizeAgentWorkspacePanelSizes(next);
}
