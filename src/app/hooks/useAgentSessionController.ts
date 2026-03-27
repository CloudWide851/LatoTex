import { useCallback, useEffect, useRef, useState } from "react";
import { executeWorkflowCancel } from "../../shared/api/agent";
import type { AgentStatusKey } from "../app-config";
import { parseAgentPrompt } from "./agentCommands";
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
  suspended?: boolean;
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
    setToast,
    suspended = false,
    runTaskAgent,
    t,
  } = params;

  const [agentSessions, setAgentSessions] = useState<AgentSessionSummary[]>([]);
  const [agentSessionPickerOpen, setAgentSessionPickerOpen] = useState(false);
  const [agentSessionPickerIndex, setAgentSessionPickerIndex] = useState(0);
  const [agentRollback, setAgentRollback] = useState<AgentRunRollback | null>(null);
  const [agentRollbackVisible, setAgentRollbackVisible] = useState(false);
  const runLaunchLockRef = useRef(false);

  useEffect(() => {
    setAgentSessions([]);
    setAgentSessionPickerOpen(false);
    setAgentSessionPickerIndex(0);
    setAgentRollbackVisible(false);
    setAgentMessages([]);
  }, [activeProjectId, selectedFile, setAgentMessages]);

  useEffect(() => {
    if (!suspended || agentPhase !== "running" || !agentRunId) {
      return;
    }
    void executeWorkflowCancel(agentRunId).catch(() => undefined);
  }, [agentPhase, agentRunId, suspended]);

  const handleAgentRollback = useCallback(() => {
    if (!agentRollback) {
      return;
    }
    setAgentMessages(agentRollback.messages);
    setAgentPrompt(agentRollback.prompt);
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
    if (!projectId || suspended) {
      if (!projectId) {
        setToast({ type: "error", message: t("agent.overlay.noProject") });
      } else if (suspended) {
        setToast({ type: "error", message: t("agent.overlay.suspended") });
      }
      return;
    }
    if (agentPhase === "running" && agentRunId) {
      try {
        await executeWorkflowCancel(agentRunId);
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
        setToast({ type: "error", message: t("agent.overlay.emptyPrompt") });
        return;
      }
      const parsed = parseAgentPrompt(rawPrompt);
      if (
        parsed.kind === "command"
        && (parsed.command === "new" || parsed.command === "memory" || parsed.command === "resume")
      ) {
        setAgentPrompt("");
        setAgentSessionPickerOpen(false);
        setAgentSessionPickerIndex(0);
        setToast({ type: "info", message: t("agent.overlay.useChatForMemory") });
        return;
      }
      if (options?.forceNewSession) {
        setAgentMessages([]);
      }
      setAgentRollback({
        sessionId: null,
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
    agentMessages,
    agentPhase,
    agentPrompt,
    agentRunId,
    runTaskAgent,
    setAgentMessages,
    setAgentPrompt,
    setToast,
    suspended,
    t,
  ]);

  const handleAgentSessionConfirm = useCallback(() => {
    setAgentSessionPickerOpen(false);
  }, []);

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
