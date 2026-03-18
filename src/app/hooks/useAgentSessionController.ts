import { useCallback, useEffect, useRef, useState } from "react";
import { runAgentCancel } from "../../shared/api/desktop";
import type { AgentStatusKey } from "../app-config";
import { parseAgentPrompt } from "./agentCommands";
import {
  appendDailyMemoryPrompt,
  createNewFileSession,
  ensureCurrentFileSession,
  ensureProjectMemoryDocument,
  loadSessionMessages,
  resumeFileSession,
  saveSessionMessages,
} from "./agentMemoryStore";
import type { AgentChatMessage, AgentRunRollback, AgentSessionSummary } from "./agentTypes";

export function useAgentSessionController(params: {
  activeProjectId: string | null;
  selectedFile: string | null;
  agentPrompt: string;
  agentPhase: "idle" | "running" | "done" | "error";
  agentRunId: string | null;
  agentMessages: AgentChatMessage[];
  setAgentMessages: React.Dispatch<React.SetStateAction<AgentChatMessage[]>>;
  setAgentPrompt: React.Dispatch<React.SetStateAction<string>>;
  setAgentRunId: React.Dispatch<React.SetStateAction<string | null>>;
  setAgentPhase: React.Dispatch<React.SetStateAction<"idle" | "running" | "done" | "error">>;
  setAgentStatusKey: React.Dispatch<React.SetStateAction<AgentStatusKey>>;
  setPage: React.Dispatch<React.SetStateAction<any>>;
  setSelectedFile: React.Dispatch<React.SetStateAction<string | null>>;
  setToast: React.Dispatch<React.SetStateAction<{ type: "info" | "error"; message: string } | null>>;
  runTaskAgent: (promptOverride?: string, options?: { forceNewSession?: boolean }) => Promise<void>;
  t: (key: any) => string;
}) {
  const {
    activeProjectId,
    selectedFile,
    agentPrompt,
    agentPhase,
    agentRunId,
    agentMessages,
    setAgentMessages,
    setAgentPrompt,
    setAgentRunId,
    setAgentPhase,
    setAgentStatusKey,
    setPage,
    setSelectedFile,
    setToast,
    runTaskAgent,
    t,
  } = params;

  const [agentSessions, setAgentSessions] = useState<AgentSessionSummary[]>([]);
  const [agentCurrentSessionId, setAgentCurrentSessionId] = useState<string | null>(null);
  const [agentSessionPickerOpen, setAgentSessionPickerOpen] = useState(false);
  const [agentSessionPickerIndex, setAgentSessionPickerIndex] = useState(0);
  const [agentRollback, setAgentRollback] = useState<AgentRunRollback | null>(null);
  const [agentRollbackVisible, setAgentRollbackVisible] = useState(false);
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runLaunchLockRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const projectId = activeProjectId;
    const filePath = selectedFile;
    if (!projectId || !filePath) {
      setAgentSessions([]);
      setAgentCurrentSessionId(null);
      setAgentSessionPickerOpen(false);
      setAgentRollbackVisible(false);
      return () => {
        disposed = true;
      };
    }
    void (async () => {
      try {
        const prepared = await ensureCurrentFileSession(projectId, filePath);
        if (disposed) {
          return;
        }
        setAgentSessions(prepared.sessions);
        setAgentCurrentSessionId(prepared.currentSessionId);
        const messages = await loadSessionMessages(projectId, filePath, prepared.currentSessionId);
        if (disposed) {
          return;
        }
        setAgentMessages(messages);
        setAgentSessionPickerIndex(0);
        setAgentRollbackVisible(false);
      } catch (error) {
        if (disposed) {
          return;
        }
        setToast({ type: "error", message: String(error) });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [activeProjectId, selectedFile, setAgentMessages, setToast]);

  useEffect(() => {
    const projectId = activeProjectId;
    const filePath = selectedFile;
    const sessionId = agentCurrentSessionId;
    if (!projectId || !filePath || !sessionId) {
      return;
    }
    if (sessionSaveTimerRef.current) {
      clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = null;
    }
    sessionSaveTimerRef.current = setTimeout(() => {
      void saveSessionMessages(projectId, filePath, sessionId, agentMessages)
        .then((nextSessions) => {
          if (nextSessions) {
            setAgentSessions(nextSessions);
          }
        })
        .catch(() => undefined);
    }, 320);
    return () => {
      if (sessionSaveTimerRef.current) {
        clearTimeout(sessionSaveTimerRef.current);
        sessionSaveTimerRef.current = null;
      }
    };
  }, [activeProjectId, selectedFile, agentCurrentSessionId, agentMessages]);

  const handleResumeSession = useCallback(
    async (index: number) => {
      const projectId = activeProjectId;
      const filePath = selectedFile;
      if (!projectId || !filePath || agentSessions.length === 0) {
        return;
      }
      const target = agentSessions[Math.max(0, Math.min(index, agentSessions.length - 1))];
      try {
        const resumed = await resumeFileSession(projectId, filePath, target.id);
        setAgentSessions(resumed.sessions);
        setAgentCurrentSessionId(resumed.currentSessionId);
        const messages = await loadSessionMessages(projectId, filePath, resumed.currentSessionId);
        setAgentMessages(messages);
        setAgentSessionPickerOpen(false);
        setAgentPrompt("");
      } catch {
        setToast({ type: "error", message: t("agent.command.resume.notFound") });
      }
    },
    [activeProjectId, selectedFile, agentSessions, setAgentMessages, setAgentPrompt, setToast, t],
  );

  const handleAgentRollback = useCallback(() => {
    if (!agentRollback) {
      return;
    }
    setAgentMessages(agentRollback.messages);
    setAgentPrompt(agentRollback.prompt);
    if (agentRollback.sessionId) {
      setAgentCurrentSessionId(agentRollback.sessionId);
    }
    setAgentRunId(null);
    setAgentPhase("done");
    setAgentStatusKey("agent.statusDone");
    setAgentRollbackVisible(false);
    setToast({ type: "info", message: t("agent.rollback.restored") });
  }, [
    agentRollback,
    setAgentMessages,
    setAgentPhase,
    setAgentPrompt,
    setAgentRunId,
    setAgentStatusKey,
    setToast,
    t,
  ]);

  const handleAgentRun = useCallback(async (promptOverride?: string, options?: { forceNewSession?: boolean }) => {
    const projectId = activeProjectId;
    if (!projectId) {
      return;
    }
    if (agentPhase === "running" && agentRunId) {
      try {
        await runAgentCancel(agentRunId);
        setAgentRollbackVisible(true);
      } catch (error) {
        setToast({ type: "error", message: String(error) });
      }
      return;
    }
    if (runLaunchLockRef.current) {
      return;
    }
    runLaunchLockRef.current = true;
    try {
      const rawPrompt = (promptOverride ?? agentPrompt).trim();
      if (!rawPrompt) {
        return;
      }
      if (options?.forceNewSession) {
        if (!selectedFile) {
          setToast({ type: "error", message: t("agent.command.requiresFile") });
          return;
        }
        const next = await createNewFileSession(projectId, selectedFile);
        setAgentSessions(next.sessions);
        setAgentCurrentSessionId(next.currentSessionId);
        setAgentMessages([]);
        setAgentSessionPickerOpen(false);
        setAgentRollbackVisible(false);
      }
      const parsed = parseAgentPrompt(rawPrompt);
      if (parsed.kind === "command" && parsed.command === "new") {
        if (!selectedFile) {
          setToast({ type: "error", message: t("agent.command.requiresFile") });
          return;
        }
        const next = await createNewFileSession(projectId, selectedFile);
        setAgentSessions(next.sessions);
        setAgentCurrentSessionId(next.currentSessionId);
        setAgentMessages([]);
        setAgentPrompt("");
        setAgentSessionPickerOpen(false);
        setAgentRollbackVisible(false);
        setToast({ type: "info", message: t("agent.command.new.done") });
        return;
      }
      if (parsed.kind === "command" && parsed.command === "memory") {
        const memoryPath = await ensureProjectMemoryDocument(projectId);
        setPage("latex");
        setSelectedFile(memoryPath);
        setAgentPrompt("");
        setToast({ type: "info", message: t("agent.command.memory.opened") });
        return;
      }
      if (parsed.kind === "command" && parsed.command === "resume") {
        if (agentSessions.length === 0) {
          setToast({ type: "info", message: t("agent.command.resume.empty") });
          setAgentPrompt("");
          return;
        }
        const requested = parsed.args.trim();
        if (requested) {
          const directIndex = agentSessions.findIndex((item) => item.id === requested);
          if (directIndex >= 0) {
            await handleResumeSession(directIndex);
            return;
          }
        }
        setAgentSessionPickerOpen(true);
        setAgentSessionPickerIndex(0);
        setAgentPrompt("");
        setToast({ type: "info", message: t("agent.command.resume.opened") });
        return;
      }
      await appendDailyMemoryPrompt(projectId, selectedFile ?? "main.tex", rawPrompt).catch(
        () => undefined,
      );
      setAgentRollback({
        sessionId: agentCurrentSessionId,
        prompt: agentPrompt,
        messages: agentMessages,
      });
      setAgentRollbackVisible(false);
      await runTaskAgent(rawPrompt, options);
    } finally {
      runLaunchLockRef.current = false;
    }
  }, [
    activeProjectId,
    agentCurrentSessionId,
    agentMessages,
    agentPhase,
    agentPrompt,
    agentRunId,
    agentSessions,
    handleResumeSession,
    runTaskAgent,
    selectedFile,
    setAgentMessages,
    setAgentPrompt,
    setPage,
    setSelectedFile,
    setToast,
    t,
  ]);

  const handleAgentSessionConfirm = useCallback(() => {
    void handleResumeSession(agentSessionPickerIndex);
  }, [agentSessionPickerIndex, handleResumeSession]);

  return {
    agentSessions,
    agentSessionPickerOpen,
    agentSessionPickerIndex,
    agentRollbackVisible,
    setAgentSessionPickerOpen,
    setAgentSessionPickerIndex,
    handleAgentRun,
    handleAgentRollback,
    handleAgentSessionConfirm,
  };
}

