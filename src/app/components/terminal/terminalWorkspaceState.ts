import { terminalCancelStart, terminalStop } from "../../../shared/api/workspace";
import type { TerminalFailure, TerminalOutputChunk } from "../../../shared/types/app";
import type { TerminalLaunchKind } from "../../../shared/types/app";
import {
  DEFAULT_TERMINAL_RAIL_WIDTH,
  clampTerminalRailWidth,
  loadTerminalState,
  saveTerminalState,
} from "./terminalPersistence";
import type { ProjectTerminalState, TerminalTab, TranslationFn } from "./terminalTypes";

const terminalStates = new Map<string, ProjectTerminalState>();

function stopTerminalTabs(tabs: TerminalTab[]) {
  const sessions = tabs.map((tab) => tab.sessionId).filter(Boolean) as string[];
  const requests = tabs.map((tab) => tab.startRequestId).filter(Boolean) as string[];
  sessions.forEach((sessionId) => void terminalStop(sessionId).catch(() => undefined));
  requests.forEach((requestId) => void terminalCancelStart(requestId).catch(() => undefined));
}

export function stopProjectTerminalState(projectId: string | null) {
  if (!projectId) {
    return;
  }
  const existing = terminalStates.get(projectId);
  if (!existing) {
    return;
  }
  stopTerminalTabs(existing.tabs);
  terminalStates.delete(projectId);
}

export function stopAllProjectTerminalStates() {
  terminalStates.forEach((state) => stopTerminalTabs(state.tabs));
  terminalStates.clear();
}

export function joinTerminalChunks(chunks: TerminalOutputChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("");
}

function localizedTabTitle(t: TranslationFn, count: number): string {
  return t("terminal.newTitle").replace("{count}", String(count));
}

export function createTerminalTab(
  t: TranslationFn,
  count: number,
  relativePath: string | null = null,
  launchKind: TerminalLaunchKind = "shell",
  title?: string,
): TerminalTab {
  return {
    id: `term-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: title ?? localizedTabTitle(t, count),
    sequence: count,
    launchKind,
    relativePath,
    sessionId: null,
    startRequestId: null,
    autoStart: true,
    cwd: "",
    venvPath: null,
    envSource: null,
    status: "idle",
    cursor: 0,
    buffer: "",
    history: [],
    failure: null,
  };
}

export function snapshotTerminalState(
  projectId: string | null,
  t: TranslationFn,
): ProjectTerminalState {
  if (!projectId) {
    return { tabs: [], activeTabId: null, railWidth: DEFAULT_TERMINAL_RAIL_WIDTH };
  }
  const existing = terminalStates.get(projectId);
  if (existing && existing.tabs.length > 0) {
    return {
      tabs: existing.tabs.map((tab) => ({ ...tab })),
      activeTabId: existing.activeTabId ?? existing.tabs[0]?.id ?? null,
      railWidth: clampTerminalRailWidth(existing.railWidth),
    };
  }
  const persisted = loadTerminalState(projectId);
  if (persisted?.tabs.length) {
    const localized = persisted.tabs.map((tab) => ({ ...tab }));
    terminalStates.set(projectId, {
      tabs: localized,
      activeTabId: persisted.activeTabId ?? localized[0]?.id ?? null,
      railWidth: persisted.railWidth,
    });
    return {
      tabs: localized.map((tab) => ({ ...tab })),
      activeTabId: persisted.activeTabId ?? localized[0]?.id ?? null,
      railWidth: persisted.railWidth,
    };
  }
  const first = createTerminalTab(t, 1);
  const next = {
    tabs: [first],
    activeTabId: first.id,
    railWidth: DEFAULT_TERMINAL_RAIL_WIDTH,
  };
  terminalStates.set(projectId, next);
  return {
    tabs: next.tabs.map((tab) => ({ ...tab })),
    activeTabId: next.activeTabId,
    railWidth: next.railWidth,
  };
}

export function persistTerminalState(
  projectId: string | null,
  tabs: TerminalTab[],
  activeTabId: string | null,
  railWidth: number,
) {
  if (!projectId) {
    return;
  }
  terminalStates.set(projectId, {
    tabs: tabs.map((tab) => ({ ...tab })),
    activeTabId,
    railWidth: clampTerminalRailWidth(railWidth),
  });
  saveTerminalState(projectId, tabs, activeTabId, railWidth);
}

export function createTerminalRequestId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `terminal-start-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeTerminalFailure(
  error: unknown,
  fallbackCode: string,
  fallbackStage: string,
): TerminalFailure {
  const candidate = typeof error === "string"
    ? error
    : error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  try {
    const parsed = JSON.parse(candidate) as Partial<TerminalFailure>;
    if (
      typeof parsed.code === "string"
      && typeof parsed.stage === "string"
      && typeof parsed.retryable === "boolean"
    ) {
      return {
        code: parsed.code,
        stage: parsed.stage,
        retryable: parsed.retryable,
      };
    }
  } catch {
    // Only stable fallback metadata is exposed to the UI.
  }
  return { code: fallbackCode, stage: fallbackStage, retryable: true };
}
