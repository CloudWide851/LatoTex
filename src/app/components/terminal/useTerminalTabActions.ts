import { useCallback } from "react";
import { terminalCancelStart, terminalStop } from "../../../shared/api/workspace";
import type { TerminalTab, TranslationFn } from "./terminalTypes";
import { createTerminalTab } from "./terminalWorkspaceState";

type UpdateTabs = (updater: (tabs: TerminalTab[]) => TerminalTab[]) => void;

async function terminateTab(tab: TerminalTab | undefined) {
  if (tab?.startRequestId) {
    await terminalCancelStart(tab.startRequestId).catch(() => undefined);
  }
  if (tab?.sessionId) {
    await terminalStop(tab.sessionId).catch(() => undefined);
  }
}

export function useTerminalTabActions(props: {
  tabsRef: { current: TerminalTab[] };
  activeTabIdRef: { current: string | null };
  updateTabs: UpdateTabs;
  setActiveTabId: (updater: string | null | ((current: string | null) => string | null)) => void;
  clearTerminal: () => void;
  startTab: (tabId: string) => Promise<void>;
  t: TranslationFn;
}) {
  const {
    tabsRef,
    activeTabIdRef,
    updateTabs,
    setActiveTabId,
    clearTerminal,
    startTab,
    t,
  } = props;

  const stopTab = useCallback(async (tabId: string) => {
    await terminateTab(tabsRef.current.find((item) => item.id === tabId));
    updateTabs((prev) => prev.map((item) => item.id === tabId ? {
      ...item,
      sessionId: null,
      startRequestId: null,
      autoStart: false,
      venvPath: null,
      envSource: null,
      status: "idle",
      cursor: 0,
      failure: null,
    } : item));
    if (tabId === activeTabIdRef.current) {
      clearTerminal();
    }
  }, [activeTabIdRef, clearTerminal, tabsRef, updateTabs]);

  const closeTab = useCallback(async (tabId: string) => {
    await terminateTab(tabsRef.current.find((item) => item.id === tabId));
    updateTabs((prev) => {
      const next = prev.filter((item) => item.id !== tabId);
      if (next.length > 0) {
        setActiveTabId((activeId) => activeId === tabId ? next[0].id : activeId);
        return next;
      }
      const replacement = createTerminalTab(t, 1);
      setActiveTabId(replacement.id);
      return [replacement];
    });
  }, [setActiveTabId, t, tabsRef, updateTabs]);

  const closeOtherTabs = useCallback(async (tabId: string) => {
    const others = tabsRef.current.filter((item) => item.id !== tabId);
    for (const tab of others) {
      await terminateTab(tab);
    }
    updateTabs((prev) => prev.filter((item) => item.id === tabId));
    setActiveTabId(tabId);
  }, [setActiveTabId, tabsRef, updateTabs]);

  const renameTab = useCallback((tabId: string, title: string) => {
    const normalized = title.trim();
    if (!normalized) {
      return;
    }
    updateTabs((prev) => prev.map((item) => item.id === tabId ? { ...item, title: normalized } : item));
  }, [updateTabs]);

  const restartTab = useCallback(async (tabId: string) => {
    await stopTab(tabId);
    window.setTimeout(() => {
      void startTab(tabId);
    }, 0);
  }, [startTab, stopTab]);

  const newTab = useCallback(() => {
    updateTabs((prev) => {
      const sequence = prev.reduce((highest, tab) => Math.max(highest, tab.sequence), 0) + 1;
      const next = [...prev, createTerminalTab(t, sequence)];
      setActiveTabId(next[next.length - 1].id);
      return next;
    });
  }, [setActiveTabId, t, updateTabs]);

  return { closeOtherTabs, closeTab, newTab, renameTab, restartTab, stopTab };
}
