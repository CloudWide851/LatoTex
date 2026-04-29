import { RefreshCcw, Send, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  terminalRead,
  terminalResize,
  terminalStart,
  terminalStop,
  terminalWrite,
} from "../../../shared/api/workspace";
import type { TerminalOutputChunk, TerminalStartResponse } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

const TERMINAL_POLL_MS = 420;

function joinChunks(chunks: TerminalOutputChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("");
}

function estimateTerminalSize(element: HTMLElement | null): { cols: number; rows: number } {
  if (!element) {
    return { cols: 100, rows: 28 };
  }
  const rect = element.getBoundingClientRect();
  return {
    cols: Math.max(40, Math.min(220, Math.floor(rect.width / 8))),
    rows: Math.max(10, Math.min(80, Math.floor(rect.height / 18))),
  };
}

export function WorkspaceTerminalPanel(props: {
  activeProjectId: string | null;
  selectedFile: string | null;
  active: boolean;
  t: TranslationFn;
}) {
  const { activeProjectId, selectedFile, active, t } = props;
  const [session, setSession] = useState<TerminalStartResponse | null>(null);
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const cursorRef = useRef(0);
  const sessionRef = useRef<TerminalStartResponse | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const stopSession = useCallback(async () => {
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (current?.sessionId) {
      await terminalStop(current.sessionId).catch(() => undefined);
    }
  }, []);

  const startSession = useCallback(async () => {
    if (!activeProjectId || !active) {
      return;
    }
    await stopSession();
    setBusy(true);
    setError(null);
    setOutput("");
    cursorRef.current = 0;
    try {
      const size = estimateTerminalSize(viewportRef.current);
      const next = await terminalStart(activeProjectId, selectedFile, size);
      sessionRef.current = next;
      setSession(next);
      setStatus(next.status);
    } catch (err) {
      setError(String(err));
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }, [active, activeProjectId, selectedFile, stopSession]);

  useEffect(() => {
    if (!active) {
      void stopSession();
      return;
    }
    void startSession();
    return () => {
      void stopSession();
    };
  }, [active, activeProjectId, selectedFile, startSession, stopSession]);

  useEffect(() => {
    if (!active || !session?.sessionId) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await terminalRead(session.sessionId, cursorRef.current);
        if (cancelled) {
          return;
        }
        cursorRef.current = response.cursor;
        setStatus(response.status);
        if (response.chunks.length > 0) {
          setOutput((prev) => prev + joinChunks(response.chunks));
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setStatus("failed");
        }
      } finally {
        if (!cancelled && sessionRef.current?.sessionId === session.sessionId) {
          pollTimerRef.current = window.setTimeout(poll, TERMINAL_POLL_MS);
        }
      }
    };
    pollTimerRef.current = window.setTimeout(poll, 80);
    return () => {
      cancelled = true;
      if (pollTimerRef.current != null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [active, session?.sessionId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    viewport?.scrollTo({ top: viewport.scrollHeight });
  }, [output]);

  useEffect(() => {
    if (!session?.sessionId || typeof ResizeObserver === "undefined") {
      return;
    }
    const target = viewportRef.current;
    if (!target) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const size = estimateTerminalSize(target);
      void terminalResize(session.sessionId, size.cols, size.rows).catch(() => undefined);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [session?.sessionId]);

  useEffect(() => {
    if (status !== "exited" || !session?.sessionId) {
      return;
    }
    const sessionId = session.sessionId;
    sessionRef.current = null;
    setSession(null);
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    void terminalStop(sessionId).catch(() => undefined);
  }, [session?.sessionId, status]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const release = () => {
      void stopSession();
    };
    window.addEventListener("latotex.runtime.release-heavy-resources", release);
    return () => window.removeEventListener("latotex.runtime.release-heavy-resources", release);
  }, [stopSession]);

  const sendInput = async () => {
    const current = sessionRef.current;
    const command = input;
    if (!current?.sessionId || !command.trim()) {
      return;
    }
    setInput("");
    try {
      await terminalWrite(current.sessionId, `${command}\n`);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)] text-[color:var(--editor-tab-text)]">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--editor-shell-divider)] px-2 py-1.5">
        <div className="min-w-0">
          <div className="text-xs font-semibold">{t("terminal.title")}</div>
          <div className="truncate text-[10px] text-[color:var(--editor-tab-muted)]">
            {session?.venvPath || session?.cwd || t("terminal.starting")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded border border-[color:var(--editor-widget-border)] px-1.5 py-0.5 text-[10px] text-[color:var(--editor-tab-muted)]">
            {busy ? t("terminal.starting") : status}
          </span>
          <button
            className="panel-topbar-btn editor-toolbar-btn"
            onClick={() => void startSession()}
            disabled={busy}
            title={t("terminal.restart")}
            aria-label={t("terminal.restart")}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
          <button
            className="panel-topbar-btn editor-toolbar-btn"
            onClick={() => void stopSession()}
            disabled={!session}
            title={t("terminal.stop")}
            aria-label={t("terminal.stop")}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="library-scrollbar min-h-0 flex-1 overflow-auto bg-slate-950 px-3 py-2 font-mono text-[12px] leading-5 text-slate-100"
      >
        {error ? <div className="mb-2 text-rose-300">{error}</div> : null}
        <pre className="m-0 whitespace-pre-wrap break-words">{output || t("terminal.empty")}</pre>
      </div>
      <div className="flex items-center gap-2 border-t border-[color:var(--editor-shell-divider)] px-2 py-2">
        <span className="font-mono text-xs text-[color:var(--editor-tab-muted)]">$</span>
        <input
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void sendInput();
            }
          }}
          disabled={!session || status === "exited"}
          className="min-w-0 flex-1 rounded border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-2 py-1 font-mono text-xs outline-none focus:border-primary-400"
          placeholder={t("terminal.inputPlaceholder")}
        />
        <button
          className="panel-topbar-btn editor-toolbar-btn"
          onClick={() => void sendInput()}
          disabled={!session || !input.trim() || status === "exited"}
          title={t("terminal.send")}
          aria-label={t("terminal.send")}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
