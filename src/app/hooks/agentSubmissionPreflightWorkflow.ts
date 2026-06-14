import { executeWorkflowStart } from "../../shared/api/agent";
import { runtimeLogWrite } from "../../shared/api/runtime";
import type { AgentTeamMode } from "../../shared/types/app";
import { isLatexPath } from "./agentPatchEdits";
import { runAgentThroughEvents } from "./agentRunEvents";

export async function executeSubmissionPreflightCommand(params: {
  activeProjectId: string;
  selectedFile: string | null;
  prompt: string;
  contextPaths: string[];
  taskModelOverride?: string | null;
  teamMode: AgentTeamMode;
  t: (key: any) => string;
  normalizeOutput: (raw: string) => string;
  pushAgentMessage: (text: string, format?: "plain" | "markdown") => void;
  setAgentRunId: (value: string | null) => void;
}) {
  const {
    activeProjectId,
    selectedFile,
    prompt,
    contextPaths,
    taskModelOverride,
    teamMode,
    t,
    normalizeOutput,
    pushAgentMessage,
    setAgentRunId,
  } = params;
  if (!selectedFile || !isLatexPath(selectedFile)) {
    throw new Error(t("agent.command.requiresFile"));
  }
  const preflightPrompt = [
    "Run a submission preflight review for the active manuscript.",
    "Stay read-only. Do not propose direct file edits unless the user asks in a later step.",
    prompt.trim(),
  ].filter(Boolean).join("\n\n");
  const refs = Array.from(new Set([
    `file:${selectedFile}`,
    ...contextPaths.map((path) => `file:${path}`),
  ]));
  const response = await runAgentThroughEvents({
    startRun: () => executeWorkflowStart({
      projectId: activeProjectId,
      workflowId: "latex.submission_preflight",
      callsite: "latex.overlay",
      prompt: preflightPrompt,
      contextRefs: refs,
      modelOverride: taskModelOverride ?? undefined,
      teamMode,
      harnessProfileId: "latex.submission",
    }),
    setAgentRunId,
  });
  await runtimeLogWrite("INFO", `${t("log.agentRunDone")}, runId=${response.runId}`);
  pushAgentMessage(normalizeOutput(response.output), "markdown");
}
