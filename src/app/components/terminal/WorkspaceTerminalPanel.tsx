import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { RefreshCcw, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  terminalRead,
  terminalResize,
  terminalStart,
  terminalStop,
  terminalWrite,
} from "../../../shared/api/workspace";
import type { TerminalOutputChunk } from "../../../shared/types/app";
import { TerminalSessionRail } from "./TerminalSessionRail";
import { TerminalSuggestionOverlay } from "./TerminalSuggestionOverlay";
import { buildTerminalSuggestions, nextTerminalInputLine } from "./terminalSuggestions";
import type { ProjectTerminalState, TerminalTab, TranslationFn } from "./terminalTypes";

const TERMINAL_POLL_MS = 180;

const terminalStates = new Map<string, ProjectTerminalState>();

function stopTerminalTabs(tabs: TerminalTab[]) {
  const sessions = tabs.map((tab) => tab.sessionId).filter(Boolean) as string[];
  sessions.forEach((sessionId) => void terminalStop(sessionId).catch(() => undefined));
}

function stopProjectTerminalState(projectId: string | null) {
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

function stopAllProjectTerminalStates() {
  terminalStates.forEach((state) => stopTerminalTabs(state.tabs));
  terminalStates.clear();
}

function joinChunks(chunks: TerminalOutputChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("");
}

function tabTitle(relativePath: string | null, count: number): string {
  if (!relativePath) {
    return `Terminal ${count}`;
  }
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || `Terminal ${count}`;
}

function createTab(relativePath: string | null, count: number): TerminalTab {
  return {
    id: `term-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: tabTitle(relativePath, count),
    relativePath,
    sessionId: null,
    cwd: "",
    venvPath: null,
    envSource: null,
    status: "idle",
    cursor: 0,
    buffer: "",
    error: null,
  };
}

function snapshotState(projectId: string | null, selectedFile: string | null): ProjectTerminalState {
  if (!projectId) {
    return { tabs: [], activeTabId: null };
  }
  const existing = terminalStates.get(projectId);
  if (existing && existing.tabs.length > 0) {
    return {
      tabs: existing.tabs.map((tab) => ({ ...tab })),
      activeTabId: existing.activeTabId ?? existing.tabs[0]?.id ?? null,
    };
  }
  const first = createTab(selectedFile, 1);
  const next = { tabs: [first], activeTabId: first.id };
  terminalStates.set(projectId, next);
  return {
    tabs: next.tabs.map((tab) => ({ ...tab })),
    activeTabId: next.activeTabId,
  };
}

function persistState(projectId: string | null, tabs: TerminalTab[], activeTabId: string | null) {
  if (!projectId) {
    return;
  }
  terminalStates.set(projectId, {
    tabs: tabs.map((tab) => ({ ...tab })),
    activeTabId,
  });
}

function xtermTheme() {
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  return dark
    ? {
        background: "#0f172a",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        selectionBackground: "#334155",
      }
    : {
        background: "#111827",
        foreground: "#f8fafc",
        cursor: "#34d399",
        selectionBackground: "#475569",
      };
}

export function WorkspaceTerminalPanel(props: {
  activeProjectId: string | null;
  selectedFile: string | null;
  active: boolean;
  t: TranslationFn;
}) {
  const { activeProjectId, selectedFile, active, t } = props;
  const initialState = useMemo(
    () => snapshotState(activeProjectId, selectedFile),
    [activeProjectId, selectedFile],
  );
  const [tabs, setTabs] = useState<TerminalTab[]>(initialState.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialState.activeTabId);
  const [busyTabId, setBusyTabId] = useState<string | null>(null);
  const [inputLine, setInputLine] = useState("");
  const [terminalHistory, setTerminalHistory] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const startingRef = useRef(new Set<string>());
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const inputLineRef = useRef(inputLine);
  const terminalHistoryRef = useRef(terminalHistory);

  useEffect(() => {
    tabsRef.current = tabs;
    persistState(activeProjectId, tabs, activeTabId);
  }, [activeProjectId, activeTabId, tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    inputLineRef.current = inputLine;
  }, [inputLine]);

  useEffect(() => {
    terminalHistoryRef.current = terminalHistory;
  }, [terminalHistory]);

  useEffect(() => {
    const next = snapshotState(activeProjectId, selectedFile);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
  }, [activeProjectId, selectedFile]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const suggestions = useMemo(
    () => buildTerminalSuggestions(inputLine, { tab: activeTab, selectedFile, history: terminalHistory }),
    [activeTab, inputLine, selectedFile, terminalHistory],
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
    setTabs((prev) => updater(prev));
  }, []);

  const writeToActiveSession = useCallback((data: string) => {
    const live = tabsRef.current.find((item) => item.id === activeTabIdRef.current);
    if (live?.sessionId && live.status !== "exited") {
      void terminalWrite(live.sessionId, data).catch((error) => {
        updateTabs((prev) =>
          prev.map((item) =>
            item.id === live.id ? { ...item, error: String(error) } : item,
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
    updateTabs((prev) =>
      prev.map((item) =>
        item.id === tabId ? { ...item, status: "starting", error: null } : item,
      ),
    );
    try {
      const term = xtermRef.current;
      const response = await terminalStart(activeProjectId, tab.relativePath ?? selectedFile, {
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
                buffer: "",
                error: null,
              }
            : item,
        ),
      );
    } catch (error) {
      updateTabs((prev) =>
        prev.map((item) =>
          item.id === tabId ? { ...item, status: "failed", error: String(error) } : item,
        ),
      );
    } finally {
      startingRef.current.delete(tabId);
      setBusyTabId((prev) => (prev === tabId ? null : prev));
    }
  }, [activeProjectId, selectedFile, updateTabs]);

  const stopTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (tab?.sessionId) {
      await terminalStop(tab.sessionId).catch(() => undefined);
    }
    updateTabs((prev) =>
      prev.map((item) =>
        item.id === tabId
          ? { ...item, sessionId: null, status: "idle", cursor: 0, buffer: "", error: null }
          : item,
      ),
    );
    if (tabId === activeTabIdRef.current) {
      xtermRef.current?.clear();
    }
  }, [updateTabs]);

  const closeTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (tab?.sessionId) {
      await terminalStop(tab.sessionId).catch(() => undefined);
    }
    updateTabs((prev) => {
      const next = prev.filter((item) => item.id !== tabId);
      if (next.length > 0) {
        setActiveTabId((activeId) => (activeId === tabId ? next[0].id : activeId));
        return next;
      }
      const replacement = createTab(selectedFile, 1);
      setActiveTabId(replacement.id);
      return [replacement];
    });
  }, [selectedFile, updateTabs]);

  const newTab = useCallback(() => {
    setTabs((prev) => {
      const next = [...prev, createTab(selectedFile, prev.length + 1)];
      setActiveTabId(next[next.length - 1].id);
      return next;
    });
  }, [selectedFile]);

  useEffect(() => {
    if (!active || !activeTabId) {
      return;
    }
    const tab = tabs.find((item) => item.id === activeTabId);
    if (tab && !tab.sessionId && tab.status !== "starting" && tab.status !== "failed") {
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
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 4000,
      theme: xtermTheme(),
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
          setTerminalHistory((prev) => [command, ...prev.filter((item) => item !== command)].slice(0, 40));
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
  }, [acceptSuggestion, activeTab?.id, fitAndResize, updateTabs, writeToActiveSession]);

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
        const text = joinChunks(response.chunks);
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
                  buffer: text ? `${item.buffer}${text}`.slice(-160_000) : item.buffer,
                }
              : item,
          ),
        );
      } catch (error) {
        updateTabs((prev) =>
          prev.map((item) =>
            item.id === live.id ? { ...item, status: "failed", error: String(error) } : item,
          ),
        );
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const release = () => {
      stopAllProjectTerminalStates();
      updateTabs((prev) =>
        prev.map((tab) => ({
          ...tab,
          sessionId: null,
          status: "idle",
          cursor: 0,
          buffer: "",
        })),
      );
      xtermRef.current?.clear();
    };
    window.addEventListener("latotex.runtime.release-heavy-resources", release);
    return () => window.removeEventListener("latotex.runtime.release-heavy-resources", release);
  }, [updateTabs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleProjectClosed = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string | null }>).detail;
      const projectId = detail?.projectId ?? null;
      stopProjectTerminalState(projectId);
      if (projectId !== activeProjectId) {
        return;
      }
      updateTabs((prev) =>
        prev.map((tab) => ({
          ...tab,
          sessionId: null,
          status: "idle",
          cursor: 0,
          buffer: "",
        })),
      );
      xtermRef.current?.clear();
    };
    window.addEventListener("latotex.project.closed", handleProjectClosed);
    return () => window.removeEventListener("latotex.project.closed", handleProjectClosed);
  }, [activeProjectId, updateTabs]);

  const statusLabel = busyTabId === activeTab?.id ? t("terminal.starting") : activeTab?.status ?? "idle";

  return (
    <section className="flex h-full min-h-0 overflow-hidden rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)] text-[color:var(--editor-tab-text)]">
      <TerminalSessionRail
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={(tabId) => {
          void closeTab(tabId);
        }}
        onNew={newTab}
        t={t}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-9 items-center gap-2 border-b border-[color:var(--editor-shell-divider)] px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-[10px] text-[color:var(--editor-tab-muted)]" title={activeTab?.venvPath ?? activeTab?.cwd}>
            {activeTab?.venvPath || activeTab?.cwd || statusLabel}
          </span>
          <span className="shrink-0 rounded border border-[color:var(--editor-widget-border)] px-1.5 py-0.5 text-[10px] text-[color:var(--editor-tab-muted)]">
            {statusLabel}
          </span>
          <div className="flex shrink-0 items-center gap-1">
          <button
            className="panel-topbar-btn editor-toolbar-btn"
            onClick={() => activeTab && void stopTab(activeTab.id).then(() => startTab(activeTab.id))}
            disabled={!activeTab || busyTabId === activeTab.id}
            title={t("terminal.restart")}
            aria-label={t("terminal.restart")}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
          <button
            className="panel-topbar-btn editor-toolbar-btn"
            onClick={() => activeTab && void stopTab(activeTab.id)}
            disabled={!activeTab?.sessionId}
            title={t("terminal.stop")}
            aria-label={t("terminal.stop")}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
        {activeTab?.error ? (
          <div className="border-b border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {activeTab.error}
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-950 p-1">
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
