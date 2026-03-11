import { useCallback, useEffect, useRef } from "react";
import { applyAgentProposal } from "./agentProposalActions";
import { runAgentWorkflow } from "./agentWorkflow";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";
import type { AgentPendingAction, AgentProposalMap } from "./useAppContainerState";

export function useAgentWorkflowHandlers(params: {
  activeProjectId: string | null;
  agentPrompt: string;
  editorContent: string;
  selectedFile: string | null;
  t: (key: any) => string;
  setAgentMessages: React.Dispatch<React.SetStateAction<AgentChatMessage[]>>;
  agentProposalsByPath: AgentProposalMap;
  setAgentProposalsByPath: React.Dispatch<React.SetStateAction<AgentProposalMap>>;
  setAgentPendingAction: (value: AgentPendingAction) => void;
  setAgentRunId: (value: string | null) => void;
  setAgentPrompt: (value: string) => void;
  setAgentCollapsed: (value: boolean) => void;
  setAgentPhase: (value: "idle" | "running" | "done" | "error") => void;
  setAgentStatusKey: (
    value: "agent.statusIdle" | "agent.statusRunning" | "agent.statusDone" | "agent.statusError",
  ) => void;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  setEditorContent: (value: string) => void;
  markPathSaved: (path: string, content: string) => void;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
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
  taskModelOverride?: string | null;
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
    setAgentPendingAction,
    setAgentRunId,
    setAgentPrompt,
    setAgentCollapsed,
    setAgentPhase,
    setAgentStatusKey,
    setToast,
    setEditorContent,
    markPathSaved,
    refreshGitWorkspace,
    runCompilePass,
    setBusy,
    setSelectedFile,
    setTree,
    setPage,
    runAnalysisFromAgent,
    taskModelOverride,
  } = params;

  const currentProposal: AgentFileProposal | null = selectedFile
    ? agentProposalsByPath[selectedFile] ?? null
    : null;
  const pendingResolverRef = useRef<((value: boolean) => void) | null>(null);

  const clearPendingDecision = useCallback((nextValue: boolean) => {
    const resolver = pendingResolverRef.current;
    pendingResolverRef.current = null;
    setAgentPendingAction(null);
    if (resolver) {
      resolver(nextValue);
    }
  }, [setAgentPendingAction]);

  const requestAutoCommitDecision = useCallback((targetPath: string) => {
    if (pendingResolverRef.current) {
      pendingResolverRef.current(false);
      pendingResolverRef.current = null;
    }
    setAgentPendingAction({ kind: "autoCommit", targetPath });
    return new Promise<boolean>((resolve) => {
      pendingResolverRef.current = resolve;
    });
  }, [setAgentPendingAction]);

  useEffect(() => {
    return () => {
      if (pendingResolverRef.current) {
        pendingResolverRef.current(false);
        pendingResolverRef.current = null;
      }
      setAgentPendingAction(null);
    };
  }, [setAgentPendingAction]);

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

  const handleRunAgent = useCallback(async (promptOverride?: string) => {
    clearPendingDecision(false);
    const nextPrompt = (promptOverride ?? agentPrompt).trim();
    if (!activeProjectId || !nextPrompt) {
      return;
    }
    await runAgentWorkflow({
      activeProjectId,
      agentPrompt: nextPrompt,
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
      taskModelOverride,
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
    taskModelOverride,
    clearPendingDecision,
  ]);

  const handleRejectAgentProposal = useCallback(() => {
    clearPendingDecision(false);
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
    clearPendingDecision,
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
      markPathSaved,
      refreshGitWorkspace,
      setTree,
      setAgentMessages,
      setAgentProposal: setScopedAgentProposal,
      setAgentRunId,
      setPage,
      setToast,
      runAnalysisFromAgent,
      requestAutoCommitDecision,
      runCompileAfterApply: runCompilePass,
      t,
    });
  }, [
    activeProjectId,
    currentProposal,
    markPathSaved,
    refreshGitWorkspace,
    runCompilePass,
    runAnalysisFromAgent,
    requestAutoCommitDecision,
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

  const handleResolveAgentPendingAction = useCallback((accept: boolean) => {
    clearPendingDecision(accept);
  }, [clearPendingDecision]);

  return {
    handleRunAgent,
    handleAcceptAgentProposal,
    handleRejectAgentProposal,
    handleResolveAgentPendingAction,
  };
}
