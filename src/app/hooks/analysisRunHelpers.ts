import { executeWorkflowStart } from "../../shared/api/agent";
import type { MutableRefObject } from "react";
import { waitForRunOutput } from "./analysisWorkspaceHelpers";
import { extractPromptRefValues } from "./analysisPromptRefs";

export function isRetryableAnalysisProviderError(message: string): boolean {
  return (
    message.includes("provider.empty_body")
    || message.includes("provider.parse_eof")
    || message.includes("provider.parse_invalid_json")
    || message.includes("provider.empty_output")
    || message.includes("provider.transport_error")
    || message.includes("provider.server_error")
    || message.includes("provider.rate_limited")
    || message.includes("provider.endpoint_mismatch")
  );
}

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
  workflowId: string;
  promptText: string;
  contextRefs: string[];
  modelOverride?: string;
  bypassCache?: boolean;
}): Promise<{ runId: string; output: string }> {
  const {
    projectId,
    workflowId,
    promptText,
    contextRefs,
    modelOverride,
    bypassCache = false,
  } = params;
  const promptRefContext = extractPromptRefValues(promptText).map((path) => `file:${path}`);
  const mergedContextRefs = Array.from(new Set([...contextRefs, ...promptRefContext]));
  const maxAttempts = 3;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryAttempt = attempt > 0;
    const runBypassCache = retryAttempt || bypassCache;
    try {
      const accepted = await executeWorkflowStart({
        projectId,
        workflowId,
        callsite: "analysis.workspace",
        prompt: promptText,
        contextRefs: mergedContextRefs,
        modelOverride,
        bypassCache: runBypassCache,
      });
      return {
        runId: accepted.runId,
        output: await waitForRunOutput(accepted.runId),
      };
    } catch (error) {
      lastError = error;
      const message = String(error ?? "");
      const retryable = isRetryableAnalysisProviderError(message);
      if (!retryable || attempt >= maxAttempts - 1) {
        break;
      }
      const delayMs = Math.min(1300, 380 + attempt * 280);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "analysis.run.failed"));
}

