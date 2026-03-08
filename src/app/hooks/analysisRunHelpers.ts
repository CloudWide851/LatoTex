import { runAgentStart } from "../../shared/api/desktop";
import type { MutableRefObject } from "react";
import { waitForRunOutput } from "./analysisWorkspaceHelpers";

export async function ensureAnalysisTasksLoaded(
  loadedRef: MutableRefObject<boolean>,
  timeoutMs = 3500,
): Promise<void> {
  if (loadedRef.current) {
    return;
  }
  const startedAt = Date.now();
  while (!loadedRef.current && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

export async function runRolePromptWithAgent(params: {
  projectId: string;
  role: string;
  promptText: string;
  contextRefs: string[];
  bypassCache?: boolean;
}): Promise<{ runId: string; output: string }> {
  const { projectId, role, promptText, contextRefs, bypassCache = false } = params;
  const accepted = await runAgentStart({
    projectId,
    role,
    prompt: promptText,
    contextRefs,
    bypassCache,
  });
  return {
    runId: accepted.runId,
    output: await waitForRunOutput(accepted.runId),
  };
}
