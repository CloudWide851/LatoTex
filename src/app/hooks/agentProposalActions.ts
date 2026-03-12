import {
  gitCommit,
  gitStage,
  openProject,
  readFile,
  runtimeLogWrite,
  writeFile,
} from "../../shared/api/desktop";
import { generateGitSummary } from "./useGitSummaryGenerator";
import { isLatexPath } from "./agentPatchEdits";
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
  requestAutoCommitDecision?: (targetPath: string) => Promise<boolean>;
  runCompileAfterApply?: (params: {
    projectId: string;
    mainPath: string;
    mainContent: string;
    options: { updatePreview: boolean; emitToast: boolean };
  }) => Promise<{ status: string; diagnostics: string[] }>;
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
    requestAutoCommitDecision,
    runCompileAfterApply,
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
    const compileTargetPath = (snapshot.mainFile ?? "").trim() || proposal.targetPath;
    if (isLatexPath(proposal.targetPath) && runCompileAfterApply && isLatexPath(compileTargetPath)) {
      try {
        const compileMainContent = compileTargetPath === proposal.targetPath
          ? proposal.candidateContent
          : (await readFile(activeProjectId, compileTargetPath)).content ?? "";
        if (compileMainContent.trim().length > 0) {
          await runCompileAfterApply({
            projectId: activeProjectId,
            mainPath: compileTargetPath,
            mainContent: compileMainContent,
            options: { updatePreview: true, emitToast: false },
          });
          await runtimeLogWrite("INFO", `agent_auto_compile: ${compileTargetPath}`).catch(() => undefined);
        }
      } catch (compileError) {
        await runtimeLogWrite("ERROR", `agent_auto_compile_failed: ${String(compileError)}`).catch(() => undefined);
      }
    }
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

    const commitIntent = proposal.commitIntent ?? "ask";
    const canAutoCommit = isLatexPath(proposal.targetPath) && commitIntent !== "skip";
    if (canAutoCommit) {
      let shouldCommit = false;
      if (commitIntent === "force") {
        shouldCommit = true;
      } else if (requestAutoCommitDecision) {
        shouldCommit = await requestAutoCommitDecision(proposal.targetPath);
      } else {
        await runtimeLogWrite("WARN", "agent_auto_commit_decision_missing").catch(() => undefined);
        shouldCommit = false;
      }
      if (shouldCommit) {
        try {
          await gitStage(activeProjectId, [proposal.targetPath]);
          const summary = (await generateGitSummary(activeProjectId, [proposal.targetPath])).trim();
          const fallback = `agent(latex): apply edits to ${proposal.targetPath}`;
          await gitCommit(activeProjectId, summary || fallback);
          await runtimeLogWrite("INFO", `agent_auto_commit: ${proposal.targetPath}`).catch(() => undefined);
          await refreshGitWorkspace(activeProjectId).catch(() => undefined);
          setToast({ type: "info", message: t("agent.autoCommit.success") });
        } catch (commitError) {
          await runtimeLogWrite("ERROR", `agent_auto_commit_failed: ${String(commitError)}`).catch(() => undefined);
          setToast({
            type: "error",
            message: t("agent.autoCommit.failed").replace("{error}", String(commitError)),
          });
        }
      }
    }

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
