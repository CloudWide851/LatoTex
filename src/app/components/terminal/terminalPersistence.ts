import type { ProjectTerminalState, TerminalTab } from "./terminalTypes";

const PREFIX = "latotex.terminal.state.v1";
const MAX_BUFFER = 80_000;
const MAX_HISTORY = 80;

function storageKey(projectId: string): string {
  return `${PREFIX}:${projectId}`;
}

function sanitizeTab(tab: TerminalTab): TerminalTab {
  return {
    ...tab,
    sessionId: null,
    status: tab.status === "failed" ? "failed" : "idle",
    cursor: 0,
    buffer: (tab.buffer ?? "").slice(-MAX_BUFFER),
    history: (tab.history ?? []).filter(Boolean).slice(0, MAX_HISTORY),
  };
}

export function loadTerminalState(projectId: string): ProjectTerminalState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(projectId)) ?? "null") as ProjectTerminalState | null;
    if (!parsed?.tabs?.length) {
      return null;
    }
    const tabs = parsed.tabs.map(sanitizeTab);
    return { tabs, activeTabId: tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId : tabs[0]?.id ?? null };
  } catch {
    return null;
  }
}

export function saveTerminalState(projectId: string | null, tabs: TerminalTab[], activeTabId: string | null) {
  if (!projectId || typeof window === "undefined") {
    return;
  }
  const state: ProjectTerminalState = { tabs: tabs.map(sanitizeTab), activeTabId };
  window.localStorage.setItem(storageKey(projectId), JSON.stringify(state));
}
