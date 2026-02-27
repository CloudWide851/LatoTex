import { useCallback } from "react";
import { applyAgentProposal } from "./agentProposalActions";
import { runAgentWorkflow } from "./agentWorkflow";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";
import type { AgentProposalMap } from "./useAppContainerState";

export function useAgentWorkflowHandlers(params: {
  activeProjectId: string | null;
  agentPrompt: string;
  editorContent: string;
  selectedFile: string | null;
  t: (key: any) => string;
  setAgentMessages: React.Dispatch<React.SetStateAction<AgentChatMessage[]>>;
  agentProposalsByPath: AgentProposalMap;
  setAgentProposalsByPath: React.Dispatch<React.SetStateAction<AgentProposalMap>>;
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
    agentProposalsByPath,
    setAgentProposalsByPath,
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

  const currentProposal: AgentFileProposal | null = selectedFile
    ? agentProposalsByPath[selectedFile] ?? null
    : null;

  const setScopedAgentProposal = useCallback(
    (value: AgentFileProposal | null) => {
      if (value) {
        setAgentProposalsByPath((prev) => ({
          ...prev,
          [value.targetPath]: value,
        }));
        return;
      }
      const pathToClear = currentProposal?.targetPath ?? selectedFile;
      if (!pathToClear) {
        return;
      }
      setAgentProposalsByPath((prev) => {
        if (!prev[pathToClear]) {
          return prev;
        }
        const next = { ...prev };
        delete next[pathToClear];
        return next;
      });
    },
    [currentProposal?.targetPath, selectedFile, setAgentProposalsByPath],
  );

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
      setAgentProposal: setScopedAgentProposal,
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
    setScopedAgentProposal,
    setAgentRunId,
    setAgentStatusKey,
    setSelectedFile,
    setToast,
    t,
  ]);

  const handleRejectAgentProposal = useCallback(() => {
    if (currentProposal) {
      if (selectedFile !== currentProposal.targetPath) {
        setSelectedFile(currentProposal.targetPath);
      }
      setEditorContent(currentProposal.originalContent);
    }
    setScopedAgentProposal(null);
    setAgentRunId(null);
  }, [
    currentProposal,
    selectedFile,
    setScopedAgentProposal,
    setAgentRunId,
    setEditorContent,
    setSelectedFile,
  ]);

  const handleAcceptAgentProposal = useCallback(async (withAnalysis: boolean) => {
    if (!activeProjectId || !currentProposal) {
      return;
    }
    await applyAgentProposal({
      activeProjectId,
      selectedFile,
      proposal: currentProposal,
      withAnalysis,
      setBusy,
      setEditorContent,
      setSelectedFile,
      setTree,
      setAgentMessages,
      setAgentProposal: setScopedAgentProposal,
      setAgentRunId,
      setPage,
      setToast,
      runAnalysisFromAgent,
      t,
    });
  }, [
    activeProjectId,
    currentProposal,
    runAnalysisFromAgent,
    selectedFile,
    setAgentMessages,
    setScopedAgentProposal,
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
