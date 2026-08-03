import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  terminalActivateResearchEnv,
  terminalCancelStart,
  terminalRead,
  terminalResize,
  terminalStart,
  terminalWrite,
} from "../../../shared/api/workspace";
import { TerminalSessionRail } from "./TerminalSessionRail";
import { TerminalSuggestionOverlay } from "./TerminalSuggestionOverlay";
import { TerminalToolbar } from "./TerminalToolbar";
import { buildTerminalSuggestions, nextTerminalInputLine } from "./terminalSuggestions";
import { getTerminalSurfaceTheme } from "./terminalSurfaceTheme";
import { reorderTerminalTabs } from "./terminalTabOrder";
import type { TerminalTab, TranslationFn } from "./terminalTypes";
import {
  createTerminalRequestId,
  joinTerminalChunks,
  normalizeTerminalFailure,
  persistTerminalState,
  snapshotTerminalState,
} from "./terminalWorkspaceState";
import { useTerminalReleaseHandlers } from "./useTerminalReleaseHandlers";
import { useTerminalTabActions } from "./useTerminalTabActions";

const TERMINAL_POLL_MS = 180;

export function WorkspaceTerminalPanel(props: {
  activeProjectId: string | null;
  selectedFile: string | null;
  active: boolean;
  fontScale?: number;
  t: TranslationFn;
}) {
  const { activeProjectId, selectedFile, active, fontScale = 1, t } = props;
  const initialState = useMemo(
    () => snapshotTerminalState(activeProjectId, t),
    [activeProjectId, t],
  );
  const [tabs, setTabs] = useState<TerminalTab[]>(initialState.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialState.activeTabId);
  const [railWidth, setRailWidth] = useState(initialState.railWidth);
  const [busyTabId, setBusyTabId] = useState<string | null>(null);
  const [inputLine, setInputLine] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const startingRef = useRef(new Set<string>());
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const inputLineRef = useRef(inputLine);

  useEffect(() => {
    tabsRef.current = tabs;
    persistTerminalState(activeProjectId, tabs, activeTabId, railWidth);
  }, [activeProjectId, activeTabId, railWidth, tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    inputLineRef.current = inputLine;
  }, [inputLine]);

  useEffect(() => {
    const next = snapshotTerminalState(activeProjectId, t);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
    setRailWidth(next.railWidth);
  }, [activeProjectId, t]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const activeHistory = activeTab?.history ?? [];
  const suggestions = useMemo(
    () => buildTerminalSuggestions(inputLine, { tab: activeTab, selectedFile, history: activeHistory }),
    [activeHistory, activeTab, inputLine, selectedFile],
  );
  const suggestionsRef = useRef(suggestions);
  const suggestionIndexRef = useRef(suggestionIndex);

  useEffect(() => {
    suggestionsRef.current = suggestions;
    setSuggestionIndex((prev) => Math.min(prev, Math.max(0, suggestions.length - 1)));
  }, [suggestions]);

  useEffect(() => {
    suggestionIndexRef.current = suggestionIndex;
  }, [suggestionIndex]);

  const updateTabs = useCallback((updater: (prev: TerminalTab[]) => TerminalTab[]) => {
    setTabs((prev) => {
      const next = updater(prev);
      tabsRef.current = next;
      return next;
    });
  }, []);
  const clearTerminal = useCallback(() => {
    xtermRef.current?.clear();
  }, []);
  useTerminalReleaseHandlers(activeProjectId, updateTabs, clearTerminal);

  const writeToActiveSession = useCallback((data: string) => {
    const live = tabsRef.current.find((item) => item.id === activeTabIdRef.current);
    if (live?.sessionId && live.status !== "exited") {
      void terminalWrite(live.sessionId, data).catch((error) => {
        updateTabs((prev) =>
          prev.map((item) =>
            item.id === live.id
              ? {
                  ...item,
                  failure: normalizeTerminalFailure(
                    error,
                    "terminal.failure.write_failed",
                    "write",
                  ),
                }
              : item,
          ),
        );
      });
    }
  }, [updateTabs]);

  const acceptSuggestion = useCallback((index: number) => {
    const suggestion = suggestionsRef.current[index];
    if (!suggestion) {
      return false;
    }
    const current = inputLineRef.current;
    const trimmed = current.trimStart();
    const prefix = current.slice(0, current.length - trimmed.length);
    const nextLine = `${prefix}${suggestion.value}`;
    const suffix = nextLine.slice(current.length);
    if (suffix) {
      writeToActiveSession(suffix);
    }
    setInputLine(nextLine);
    return true;
  }, [writeToActiveSession]);

  const fitAndResize = useCallback(() => {
    const term = xtermRef.current;
    const fit = fitAddonRef.current;
    const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current);
    if (!term || !fit) {
      return;
    }
    try {
      fit.fit();
      if (tab?.sessionId) {
        void terminalResize(tab.sessionId, term.cols, term.rows).catch(() => undefined);
      }
    } catch {
      // xterm can throw while hidden during panel transitions.
    }
  }, []);

  const startTab = useCallback(async (tabId: string) => {
    if (!activeProjectId || startingRef.current.has(tabId)) {
      return;
    }
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab || tab.sessionId) {
      return;
    }
    startingRef.current.add(tabId);
    setBusyTabId(tabId);
    const startRequestId = createTerminalRequestId();
    updateTabs((prev) =>
      prev.map((item) =>
        item.id === tabId
          ? {
              ...item,
              startRequestId,
              autoStart: false,
              status: "starting",
              failure: null,
            }
          : item,
      ),
    );
    try {
      const term = xtermRef.current;
      const response = await terminalStart(activeProjectId, startRequestId, tab.relativePath, {
        cols: term?.cols ?? 100,
        rows: term?.rows ?? 24,
      });
      updateTabs((prev) =>
        prev.map((item) =>
          item.id === tabId
            ? {
                ...item,
                sessionId: response.sessionId,
                cwd: response.cwd,
                venvPath: response.venvPath ?? null,
                envSource: response.envSource ?? null,
                status: response.status,
                cursor: 0,
                failure: null,
              }
            : item,
        ),
      );
    } catch (error) {
      updateTabs((prev) =>
        prev.map((item) =>
          item.id === tabId
            ? {
                ...item,
                status: "failed",
                failure: normalizeTerminalFailure(
                  error,
                  "terminal.failure.shell_start_failed",
                  "shell",
                ),
              }
            : item,
        ),
      );
    } finally {
      startingRef.current.delete(tabId);
      updateTabs((prev) =>
        prev.map((item) =>
          item.id === tabId && item.startRequestId === startRequestId
            ? { ...item, startRequestId: null }
            : item,
        ),
      );
      setBusyTabId((prev) => (prev === tabId ? null : prev));
    }
  }, [activeProjectId, updateTabs]);

  const {
    closeOtherTabs,
    closeTab,
    newTab,
    renameTab,
    restartTab,
    stopTab,
  } = useTerminalTabActions({
    tabsRef,
    activeTabIdRef,
    updateTabs,
    setActiveTabId,
    clearTerminal,
    startTab,
    t,
  });

  const cancelStartTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab?.startRequestId) {
      return;
    }
    await terminalCancelStart(tab.startRequestId).catch(() => undefined);
    updateTabs((prev) =>
      prev.map((item) =>
        item.id === tabId
          ? {
              ...item,
              autoStart: false,
              status: "failed",
              failure: {
                code: "terminal.failure.start_cancelled",
                stage: "shell",
                retryable: true,
              },
            }
          : item,
      ),
    );
  }, [updateTabs]);

  const activateResearchEnvironment = useCallback(async (tabId: string) => {
    if (!activeProjectId) {
      return;
    }
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab?.sessionId || tab.status !== "running") {
      return;
    }
    setBusyTabId(tabId);
    updateTabs((prev) =>
      prev.map((item) =>
        item.id === tabId ? { ...item, status: "activating", failure: null } : item,
      ),
    );
    try {
      const response = await terminalActivateResearchEnv(
        activeProjectId,
        tab.sessionId,
        true,
      );
      updateTabs((prev) =>
        prev.map((item) =>
          item.id === tabId
            ? {
                ...item,
                venvPath: response.venvPath,
                envSource: response.envSource,
                status: response.status,
                failure: null,
              }
            : item,
        ),
      );
    } catch (error) {
      updateTabs((prev) =>
        prev.map((item) =>
          item.id === tabId
            ? {
                ...item,
                status: "running",
                failure: normalizeTerminalFailure(
                  error,
                  "terminal.failure.env_prepare_failed",
                  "environment",
                ),
              }
            : item,
        ),
      );
    } finally {
      setBusyTabId((prev) => (prev === tabId ? null : prev));
    }
  }, [activeProjectId, updateTabs]);

  const reorderTabs = useCallback((sourceId: string, targetId: string) => {
    setTabs((prev) => reorderTerminalTabs(prev, sourceId, targetId));
  }, []);

  useEffect(() => {
    if (!active || !activeTabId) {
      return;
    }
    const tab = tabs.find((item) => item.id === activeTabId);
    if (
      tab
      && tab.autoStart
      && !tab.sessionId
      && tab.status !== "starting"
      && tab.status !== "failed"
    ) {
      void startTab(tab.id);
    }
  }, [active, activeTabId, startTab, tabs]);

  useEffect(() => {
    const target = viewportRef.current;
    if (!target || !activeTab) {
      return;
    }
    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "Consolas, 'Cascadia Mono', 'SFMono-Regular', monospace",
      fontSize: Math.round(12 * Math.max(0.85, Math.min(1.25, Number(fontScale) || 1))),
      lineHeight: 1.25,
      scrollback: 4000,
      theme: getTerminalSurfaceTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(target);
    if (activeTab.buffer) {
      term.write(activeTab.buffer);
    }
    const disposable = term.onData((data) => {
      const visibleSuggestions = suggestionsRef.current;
      if (visibleSuggestions.length > 0) {
        if (data === "\x1b[B" || data === "\x1b[A") {
          setSuggestionIndex((prev) => {
            const delta = data === "\x1b[B" ? 1 : -1;
            return Math.max(0, Math.min(visibleSuggestions.length - 1, prev + delta));
          });
          return;
        }
        if (data === "\t" || data === "\r") {
          if (acceptSuggestion(suggestionIndexRef.current)) {
            return;
          }
        }
        if (data === "\x1b") {
          setInputLine("");
          return;
        }
      }
      if (data === "\r") {
        const command = inputLineRef.current.trim();
        if (command) {
          updateTabs((prev) =>
            prev.map((item) =>
              item.id === activeTabIdRef.current
                ? { ...item, history: [command, ...(item.history ?? []).filter((historyItem) => historyItem !== command)].slice(0, 80) }
                : item,
            ),
          );
        }
      }
      writeToActiveSession(data);
      setInputLine((current) => nextTerminalInputLine(current, data));
      if (data !== "\x1b[B" && data !== "\x1b[A") {
        setSuggestionIndex(0);
      }
    });
    xtermRef.current = term;
    fitAddonRef.current = fit;
    window.requestAnimationFrame(fitAndResize);
    return () => {
      disposable.dispose();
      term.dispose();
      if (xtermRef.current === term) {
        xtermRef.current = null;
      }
      if (fitAddonRef.current === fit) {
        fitAddonRef.current = null;
      }
    };
  }, [acceptSuggestion, activeTab?.id, fitAndResize, fontScale, updateTabs, writeToActiveSession]);

  useEffect(() => {
    const target = viewportRef.current;
    if (!target || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => fitAndResize());
    observer.observe(target);
    return () => observer.disconnect();
  }, [fitAndResize, activeTab?.id]);

  useEffect(() => {
    if (!active || !activeTab?.sessionId) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      const live = tabsRef.current.find((item) => item.id === activeTab.id);
      if (!live?.sessionId || cancelled) {
        return;
      }
      try {
        const response = await terminalRead(live.sessionId, live.cursor);
        if (cancelled) {
          return;
        }
        const text = joinTerminalChunks(response.chunks);
        if (text) {
          xtermRef.current?.write(text);
        }
        updateTabs((prev) =>
          prev.map((item) =>
            item.id === live.id
              ? {
                  ...item,
                  cursor: response.cursor,
                  status: response.status,
                  failure: response.failure ?? item.failure,
                  buffer: text ? `${item.buffer}${text}`.slice(-160_000) : item.buffer,
                }
              : item,
          ),
        );
      } catch (error) {
        updateTabs((prev) =>
          prev.map((item) =>
            item.id === live.id
              ? {
                  ...item,
                  status: "failed",
                  failure: normalizeTerminalFailure(
                    error,
                    "terminal.failure.read_failed",
                    "read",
                  ),
                }
              : item,
          ),
        );
        cancelled = true;
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(poll, TERMINAL_POLL_MS);
        }
      }
    };
    timer = window.setTimeout(poll, 60);
    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [active, activeTab?.id, activeTab?.sessionId, updateTabs]);

  return (
    <section className="app-material-content app-terminal-surface flex h-full min-h-0 overflow-hidden rounded-lg border text-[color:var(--editor-tab-text)]">
      <TerminalSessionRail
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={(tabId) => {
          void closeTab(tabId);
        }}
        onCloseOthers={(tabId) => {
          void closeOtherTabs(tabId);
        }}
        onNew={newTab}
        onRename={renameTab}
        onRestart={(tabId) => {
          void restartTab(tabId);
        }}
        onReorder={reorderTabs}
        width={railWidth}
        onWidthChange={setRailWidth}
        t={t}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TerminalToolbar
          activeTab={activeTab}
          busy={busyTabId === activeTab?.id}
          onActivate={(tabId) => {
            void activateResearchEnvironment(tabId);
          }}
          onRestart={(tabId) => {
            void restartTab(tabId);
          }}
          onCancelStart={(tabId) => {
            void cancelStartTab(tabId);
          }}
          onStop={(tabId) => {
            void stopTab(tabId);
          }}
          t={t}
        />
        <div className="app-terminal-viewport relative min-h-0 flex-1 overflow-hidden p-1">
          <div ref={viewportRef} className="h-full min-h-0" />
          <TerminalSuggestionOverlay
            suggestions={suggestions}
            selectedIndex={suggestionIndex}
            onSelect={acceptSuggestion}
          />
        </div>
      </div>
    </section>
  );
}
