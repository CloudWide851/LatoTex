import { openProject, writeFile } from "../../shared/api/desktop";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";

const MAX_AGENT_MESSAGES = 200;

export async function applyAgentProposal(params: {
  activeProjectId: string;
  selectedFile: string | null;
  proposal: AgentFileProposal;
  withAnalysis: boolean;
  setBusy: (value: boolean) => void;
  setEditorContent: (value: string) => void;
  setSelectedFile: (value: string | null) => void;
  markPathSaved: (path: string, content: string) => void;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  setTree: (value: any) => void;
  setAgentMessages: React.Dispatch<React.SetStateAction<AgentChatMessage[]>>;
  setAgentProposal: (value: AgentFileProposal | null) => void;
  setAgentRunId: (value: string | null) => void;
  setPage: (value: any) => void;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  runAnalysisFromAgent?: (prompt: string) => Promise<void>;
  t: (key: any) => string;
}) {
  const {
    activeProjectId,
    selectedFile,
    proposal,
    withAnalysis,
    setBusy,
    setEditorContent,
    setSelectedFile,
    markPathSaved,
    refreshGitWorkspace,
    setTree,
    setAgentMessages,
    setAgentProposal,
    setAgentRunId,
    setPage,
    setToast,
    runAnalysisFromAgent,
    t,
  } = params;

  setBusy(true);
  try {
    await writeFile(activeProjectId, proposal.targetPath, proposal.candidateContent);
    markPathSaved(proposal.targetPath, proposal.candidateContent);
    if (selectedFile === proposal.targetPath) {
      setEditorContent(proposal.candidateContent);
    } else {
      setSelectedFile(proposal.targetPath);
    }
    const snapshot = await openProject(activeProjectId);
    setTree(snapshot.tree);
    setAgentMessages((prev) => {
      const appliedMessage: AgentChatMessage = {
        id: `${Date.now()}-agent-applied`,
        role: "agent",
        text: t("agent.proposalApplied"),
        format: "plain",
      };
      return [...prev, appliedMessage].slice(-MAX_AGENT_MESSAGES);
    });
    setAgentProposal(null);
    setAgentRunId(null);
    await refreshGitWorkspace(activeProjectId).catch(() => undefined);
    if (withAnalysis && runAnalysisFromAgent) {
      setPage("analysis");
      await runAnalysisFromAgent(proposal.analysisPrompt);
    }
  } catch (error) {
    setToast({ type: "error", message: String(error) });
  } finally {
    setBusy(false);
  }
}
