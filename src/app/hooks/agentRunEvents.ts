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
  const accepted = await runAgentStart({
    projectId: params.activeProjectId,
    role: params.role,
    prompt: params.prompt,
    contextRefs: params.contextRefs,
    bypassCache: params.bypassCache ?? false,
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
}
