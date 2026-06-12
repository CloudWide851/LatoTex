import { startLatexRebuttalReply } from "../../shared/api/agent";
import { runtimeLogWrite } from "../../shared/api/runtime";
import type { AgentTeamMode } from "../../shared/types/app";
import type { AgentFileProposal } from "./agentTypes";
import { buildAnalysisPrompt } from "./agentTaskPrompt";
import { compileProposalPreviewWithAutoFix } from "./agentProposalPreviewCompile";
import {
  computeDiffStats,
  isLatexPath,
  resolveCandidateFromOutput,
} from "./agentPatchEdits";
import { runAgentThroughEvents } from "./agentRunEvents";
import type { AgentCommitIntent } from "./agentCommands";

export async function executeRebuttalCommand(params: {
  activeProjectId: string;
  selectedFile: string | null;
  editorContent: string;
  reviewComments: string;
  prompt: string;
  contextPaths: string[];
  commitIntent: AgentCommitIntent;
  taskModelOverride?: string | null;
  teamMode: AgentTeamMode;
  t: (key: any) => string;
  normalizeOutput: (raw: string) => string;
  pushAgentMessage: (text: string, format?: "plain" | "markdown") => void;
  setAgentRunId: (value: string | null) => void;
  setAgentProposal: (value: AgentFileProposal | null) => void;
  setEditorContent: (value: string) => void;
  runCompilePass: (params: {
    projectId: string;
    mainPath: string;
    mainContent: string;
    options: { updatePreview: boolean; emitToast: boolean };
  }) => Promise<{ status: string; diagnostics: string[] }>;
}) {
  const {
    activeProjectId,
    selectedFile,
    editorContent,
    reviewComments,
    prompt,
    contextPaths,
    commitIntent,
    taskModelOverride,
    teamMode,
    t,
    normalizeOutput,
    pushAgentMessage,
    setAgentRunId,
    setAgentProposal,
    setEditorContent,
    runCompilePass,
  } = params;
  if (!selectedFile || !isLatexPath(selectedFile)) {
    throw new Error(t("agent.command.requiresFile"));
  }
  const comments = reviewComments.trim();
  if (!comments) {
    throw new Error(t("agent.command.rebuttal.requiresComments"));
  }
  const response = await runAgentThroughEvents({
    startRun: () => startLatexRebuttalReply({
      projectId: activeProjectId,
      selectedFile,
      editorContent,
      reviewComments: comments,
      contextPaths,
      modelOverride: taskModelOverride ?? undefined,
      teamMode,
    }),
    setAgentRunId,
  });
  await runtimeLogWrite("INFO", `${t("log.agentRunDone")}, runId=${response.runId}`);
  const normalizedOutput = normalizeOutput(response.output);
  pushAgentMessage(normalizedOutput, "markdown");
  const resolved = resolveCandidateFromOutput({
    output: normalizedOutput,
    targetPath: selectedFile,
    baseContent: editorContent,
  });
  if (!resolved.candidate) {
    if (resolved.failedReason !== "none") {
      pushAgentMessage(t("agent.patch.noApplicableEdits"));
    }
    return;
  }
  if (resolved.candidate.trim() === editorContent.trim()) {
    return;
  }
  let previewCandidate = resolved.candidate;
  try {
    previewCandidate = await compileProposalPreviewWithAutoFix({
      activeProjectId,
      targetPath: selectedFile,
      candidateContent: resolved.candidate,
      setAgentRunId,
      runCompilePass,
      normalizeOutput,
    });
  } catch (compileError) {
    await runtimeLogWrite("WARN", `agent_rebuttal_preview_compile_failed: ${String(compileError)}`).catch(() => undefined);
  }
  const { insertions, deletions, changedLines, diffBlocks } = computeDiffStats(
    editorContent,
    previewCandidate,
  );
  setEditorContent(previewCandidate);
  setAgentProposal({
    id: `proposal-${Date.now()}-rebuttal`,
    targetPath: selectedFile,
    originalContent: editorContent,
    candidateContent: previewCandidate,
    commitIntent,
    summary: t("agent.proposalReady"),
    analysisPrompt: buildAnalysisPrompt(prompt, previewCandidate, selectedFile),
    insertions,
    deletions,
    changedLines,
    diffBlocks,
    previewApplied: true,
  });
  pushAgentMessage(t("agent.proposalPreviewed"));
}
