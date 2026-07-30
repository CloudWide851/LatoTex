import type { TerminalStatus } from "../../../shared/types/app";
import type { ProjectTerminalState, TerminalTab } from "./terminalTypes";

const PREFIX = "latotex.terminal.state.v2";
const LEGACY_PREFIX = "latotex.terminal.state.v1";
const MAX_BUFFER = 80_000;
const MAX_HISTORY = 80;
export const DEFAULT_TERMINAL_RAIL_WIDTH = 144;
export const MIN_TERMINAL_RAIL_WIDTH = 112;
export const MAX_TERMINAL_RAIL_WIDTH = 280;

function storageKey(projectId: string, prefix = PREFIX): string {
  return `${prefix}:${projectId}`;
}

export function clampTerminalRailWidth(value: unknown): number {
  const width = Number(value);
  if (!Number.isFinite(width)) {
    return DEFAULT_TERMINAL_RAIL_WIDTH;
  }
  return Math.round(Math.max(MIN_TERMINAL_RAIL_WIDTH, Math.min(MAX_TERMINAL_RAIL_WIDTH, width)));
}

function persistedStatus(value: unknown): TerminalStatus {
  return value === "failed" ? "failed" : "idle";
}

function sanitizeTab(tab: Partial<TerminalTab>, index: number): TerminalTab {
  const sequence = Number.isFinite(Number(tab.sequence))
    ? Math.max(1, Math.round(Number(tab.sequence)))
    : index + 1;
  return {
    id: String(tab.id ?? `term-restored-${sequence}`),
    title: String(tab.title ?? `Terminal ${sequence}`),
    sequence,
    relativePath: typeof tab.relativePath === "string" ? tab.relativePath : null,
    sessionId: null,
    startRequestId: null,
    autoStart: true,
    cwd: typeof tab.cwd === "string" ? tab.cwd : "",
    venvPath: null,
    envSource: null,
    status: persistedStatus(tab.status),
    cursor: 0,
    buffer: (tab.buffer ?? "").slice(-MAX_BUFFER),
    history: (tab.history ?? []).filter(Boolean).slice(0, MAX_HISTORY),
    failure: null,
  };
}

export function loadTerminalState(projectId: string): ProjectTerminalState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
      ?? window.localStorage.getItem(storageKey(projectId, LEGACY_PREFIX));
    const parsed = JSON.parse(raw ?? "null") as Partial<ProjectTerminalState> | null;
    if (!parsed?.tabs?.length) {
      return null;
    }
    const tabs = parsed.tabs.map(sanitizeTab);
    return {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId ?? null
        : tabs[0]?.id ?? null,
      railWidth: clampTerminalRailWidth(parsed.railWidth),
    };
  } catch {
    return null;
  }
}

export function saveTerminalState(
  projectId: string | null,
  tabs: TerminalTab[],
  activeTabId: string | null,
  railWidth: number,
) {
  if (!projectId || typeof window === "undefined") {
    return;
  }
  const state: ProjectTerminalState = {
    tabs: tabs.map(sanitizeTab),
    activeTabId,
    railWidth: clampTerminalRailWidth(railWidth),
  };
  window.localStorage.setItem(storageKey(projectId), JSON.stringify(state));
}
