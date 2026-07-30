import { useEffect } from "react";
import type { TerminalTab } from "./terminalTypes";
import {
  stopAllProjectTerminalStates,
  stopProjectTerminalState,
} from "./terminalWorkspaceState";

type UpdateTabs = (updater: (tabs: TerminalTab[]) => TerminalTab[]) => void;

function resetTerminalTabs(tabs: TerminalTab[]): TerminalTab[] {
  return tabs.map((tab) => ({
    ...tab,
    sessionId: null,
    startRequestId: null,
    autoStart: false,
    venvPath: null,
    envSource: null,
    status: "idle",
    cursor: 0,
    buffer: "",
    failure: null,
  }));
}

export function useTerminalReleaseHandlers(
  activeProjectId: string | null,
  updateTabs: UpdateTabs,
  clearTerminal: () => void,
) {
  useEffect(() => {
    const release = () => {
      stopAllProjectTerminalStates();
      updateTabs(resetTerminalTabs);
      clearTerminal();
    };
    window.addEventListener("latotex.runtime.release-heavy-resources", release);
    return () => window.removeEventListener("latotex.runtime.release-heavy-resources", release);
  }, [clearTerminal, updateTabs]);

  useEffect(() => {
    const handleProjectClosed = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string | null }>).detail;
      const projectId = detail?.projectId ?? null;
      stopProjectTerminalState(projectId);
      if (projectId !== activeProjectId) {
        return;
      }
      updateTabs(resetTerminalTabs);
      clearTerminal();
    };
    window.addEventListener("latotex.project.closed", handleProjectClosed);
    return () => window.removeEventListener("latotex.project.closed", handleProjectClosed);
  }, [activeProjectId, clearTerminal, updateTabs]);
}
