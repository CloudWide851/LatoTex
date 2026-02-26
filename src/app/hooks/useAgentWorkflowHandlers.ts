import { useCallback } from "react";
import { applyAgentProposal } from "./agentProposalActions";
import { runAgentWorkflow } from "./agentWorkflow";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";

export function useAgentWorkflowHandlers(params: {
  activeProjectId: string | null;
  agentPrompt: string;
  editorContent: string;
  selectedFile: string | null;
  t: (key: any) => string;
  setAgentMessages: React.Dispatch<React.SetStateAction<AgentChatMessage[]>>;
  agentProposal: AgentFileProposal | null;
  setAgentProposal: React.Dispatch<React.SetStateAction<AgentFileProposal | null>>;
  setAgentRunId: (value: string | null) => void;
  setAgentPrompt: (value: string) => void;
  setAgentCollapsed: (value: boolean) => void;
  setAgentPhase: (value: "idle" | "running" | "done" | "error") => void;
  setAgentStatusKey: (
    value: "agent.statusIdle" | "agent.statusRunning" | "agent.statusDone" | "agent.statusError",
  ) => void;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  setEditorContent: (value: string) => void;
  runCompilePass: (params: {
    projectId: string;
    mainPath: string;
    mainContent: string;
    options: { updatePreview: boolean; emitToast: boolean };
  }) => Promise<{ status: string; diagnostics: string[] }>;
  setBusy: (value: boolean) => void;
  setSelectedFile: (value: string | null) => void;
  setTree: (value: any) => void;
  setPage: (value: any) => void;
  runAnalysisFromAgent?: (prompt: string) => Promise<void>;
}) {
  const {
    activeProjectId,
    agentPrompt,
    editorContent,
    selectedFile,
    t,
    setAgentMessages,
    agentProposal,
    setAgentProposal,
    setAgentRunId,
    setAgentPrompt,
    setAgentCollapsed,
    setAgentPhase,
    setAgentStatusKey,
    setToast,
    setEditorContent,
    runCompilePass,
    setBusy,
    setSelectedFile,
    setTree,
    setPage,
    runAnalysisFromAgent,
  } = params;

  const handleRunAgent = useCallback(async () => {
    if (!activeProjectId || !agentPrompt.trim()) {
      return;
    }
    await runAgentWorkflow({
      activeProjectId,
      agentPrompt,
      editorContent,
      selectedFile,
      t,
      setAgentMessages,
      setAgentProposal,
      setAgentRunId,
      setAgentPrompt,
      setAgentCollapsed,
      setAgentPhase,
      setAgentStatusKey,
      setToast,
      setEditorContent,
      setSelectedFile,
      runCompilePass: ({ projectId, mainPath, mainContent, options }) =>
        runCompilePass({ projectId, mainPath, mainContent, options }),
    });
  }, [
    activeProjectId,
    agentPrompt,
    editorContent,
    runCompilePass,
    selectedFile,
    setAgentCollapsed,
    setEditorContent,
    setAgentMessages,
    setAgentPhase,
    setAgentPrompt,
    setAgentProposal,
    setAgentRunId,
    setAgentStatusKey,
    setSelectedFile,
    setToast,
    t,
  ]);

  const handleRejectAgentProposal = useCallback(() => {
    if (agentProposal) {
      if (selectedFile !== agentProposal.targetPath) {
        setSelectedFile(agentProposal.targetPath);
      }
      setEditorContent(agentProposal.originalContent);
    }
    setAgentProposal(null);
    setAgentRunId(null);
  }, [agentProposal, selectedFile, setAgentProposal, setAgentRunId, setEditorContent, setSelectedFile]);

  const handleAcceptAgentProposal = useCallback(async (withAnalysis: boolean) => {
    if (!activeProjectId || !agentProposal) {
      return;
    }
    await applyAgentProposal({
      activeProjectId,
      selectedFile,
      proposal: agentProposal,
      withAnalysis,
      setBusy,
      setEditorContent,
      setSelectedFile,
      setTree,
      setAgentMessages,
      setAgentProposal,
      setAgentRunId,
      setPage,
      setToast,
      runAnalysisFromAgent,
      t,
    });
  }, [
    activeProjectId,
    agentProposal,
    runAnalysisFromAgent,
    selectedFile,
    setAgentMessages,
    setAgentProposal,
    setAgentRunId,
    setBusy,
    setEditorContent,
    setPage,
    setSelectedFile,
    setToast,
    setTree,
    t,
  ]);

  return {
    handleRunAgent,
    handleAcceptAgentProposal,
    handleRejectAgentProposal,
  };
}
