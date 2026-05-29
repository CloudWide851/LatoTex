import { resolveCandidateFromOutput } from "./agentPatchEdits";
import { runAgentThroughEvents } from "./agentRunEvents";

export async function compileProposalPreviewWithAutoFix(params: {
  activeProjectId: string;
  targetPath: string;
  candidateContent: string;
  withMemoryContext?: (prompt: string) => string;
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
    withMemoryContext,
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

  const repairPrompt = [
    "You are a LaTeX fixer.",
    "Apply minimal changes so the document compiles.",
    "Return IDE-style SEARCH/REPLACE edit blocks inside ```edit fences.",
    "Each edit block must include path, SEARCH, and REPLACE.",
    "Only edit the provided target file.",
    "",
    `Compile diagnostics:\n${initialCompile.diagnostics.join("\n")}`,
    "",
    "Current LaTeX content:",
    candidateContent,
  ].join("\n");

  const repairResult = await runAgentThroughEvents({
    activeProjectId,
    workflowId: "latex.review_fix",
    callsite: "latex.overlay",
    prompt: (withMemoryContext ?? ((value: string) => value))(repairPrompt),
    contextRefs: [`file:${targetPath}`],
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

