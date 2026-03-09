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
  const maxAttempts = 2;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryAttempt = attempt > 0;
    const runBypassCache = retryAttempt || bypassCache;
    try {
      const accepted = await runAgentStart({
        projectId,
        role,
        prompt: promptText,
        contextRefs,
        bypassCache: runBypassCache,
      });
      return {
        runId: accepted.runId,
        output: await waitForRunOutput(accepted.runId),
      };
    } catch (error) {
      lastError = error;
      const message = String(error ?? "");
      const retryable =
        message.includes("provider.empty_body")
        || message.includes("provider.parse_eof")
        || message.includes("provider.parse_invalid_json")
        || message.includes("provider.transport_error")
        || message.includes("provider.server_error")
        || message.includes("provider.rate_limited");
      if (!retryable || attempt >= maxAttempts - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 420));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "analysis.run.failed"));
}
