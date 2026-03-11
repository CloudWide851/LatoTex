import { runAgentStart } from "../../shared/api/desktop";
import { waitForRunOutputWithPolicy } from "./runEventWait";

export async function runAgentThroughEvents(params: {
  activeProjectId: string;
  role: string;
  prompt: string;
  contextRefs: string[];
  setAgentRunId: (value: string | null) => void;
  bypassCache?: boolean;
}): Promise<{ runId: string; output: string }> {
  const isRetryableProviderError = (message: string) =>
    message.includes("provider.empty_body")
    || message.includes("provider.parse_eof")
    || message.includes("provider.parse_invalid_json")
    || message.includes("provider.empty_output")
    || message.includes("provider.transport_error")
    || message.includes("provider.server_error")
    || message.includes("provider.rate_limited")
    || message.includes("provider.endpoint_mismatch");
  const maxAttempts = 2;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryAttempt = attempt > 0;
    try {
      const accepted = await runAgentStart({
        projectId: params.activeProjectId,
        role: params.role,
        prompt: params.prompt,
        contextRefs: params.contextRefs,
        bypassCache: retryAttempt || (params.bypassCache ?? false),
      });
      params.setAgentRunId(accepted.runId);
      const output = await waitForRunOutputWithPolicy({
        runId: accepted.runId,
        totalTimeoutMs: 15 * 60 * 1000,
        inactivityTimeoutMs: 0,
        eventLimit: 240,
        waitMs: 2_400,
        idleDelayMs: 100,
      });
      return { runId: accepted.runId, output };
    } catch (error) {
      lastError = error;
      const message = String(error ?? "");
      if (!isRetryableProviderError(message) || attempt >= maxAttempts - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 420));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "agent.run.failed"));
}
