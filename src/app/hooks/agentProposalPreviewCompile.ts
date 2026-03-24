import { startLatexReviewFix } from "../../shared/api/agent";
import { resolveCandidateFromOutput } from "./agentPatchEdits";
import { runAgentThroughEvents } from "./agentRunEvents";

export async function compileProposalPreviewWithAutoFix(params: {
  activeProjectId: string;
  targetPath: string;
  candidateContent: string;
  setAgentRunId: (value: string | null) => void;
  runCompilePass: (params: {
    projectId: string;
    mainPath: string;
    mainContent: string;
    options: { updatePreview: boolean; emitToast: boolean };
  }) => Promise<{ status: string; diagnostics: string[] }>;
  normalizeOutput: (raw: string) => string;
}): Promise<string> {
  const {
    activeProjectId,
    targetPath,
    candidateContent,
    setAgentRunId,
    runCompilePass,
    normalizeOutput,
  } = params;

  const initialCompile = await runCompilePass({
    projectId: activeProjectId,
    mainPath: targetPath,
    mainContent: candidateContent,
    options: { updatePreview: true, emitToast: false },
  });
  if (initialCompile.status === "success") {
    return candidateContent;
  }

  const repairResult = await runAgentThroughEvents({
    startRun: (bypassCache) => startLatexReviewFix({
      projectId: activeProjectId,
      selectedFile: targetPath,
      workingContent: candidateContent,
      diagnostics: initialCompile.diagnostics,
    }),
    setAgentRunId,
    bypassCache: true,
  });
  const normalized = normalizeOutput(repairResult.output);
  const resolved = resolveCandidateFromOutput({
    output: normalized,
    targetPath,
    baseContent: candidateContent,
  });
  if (!resolved.candidate || resolved.candidate.trim() === candidateContent.trim()) {
    return candidateContent;
  }

  const fixedCandidate = resolved.candidate;
  await runCompilePass({
    projectId: activeProjectId,
    mainPath: targetPath,
    mainContent: fixedCandidate,
    options: { updatePreview: true, emitToast: false },
  });
  return fixedCandidate;
}
