import { getEvents, runAgentStart } from "../../shared/api/desktop";

const AGENT_WAIT_TIMEOUT_MS = 240_000;
const AGENT_WAIT_INTERVAL_MS = 280;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAgentRunOutput(runId: string): Promise<string> {
  let cursor = 0;
  const startedAt = Date.now();
  let fallbackOutput = "";

  while (Date.now() - startedAt < AGENT_WAIT_TIMEOUT_MS) {
    const batch = await getEvents(cursor, 200, runId);
    cursor = batch.nextCursor;
    for (const event of batch.events) {
      const payload = event.payload ?? {};
      const kind = event.kind;
      if (kind === "responses.output_text.delta") {
        const chunk = typeof payload.content === "string" ? payload.content : "";
        fallbackOutput += chunk;
      }
      if (kind === "agent.run.completed") {
        const output = typeof payload.output === "string" ? payload.output : fallbackOutput;
        return output;
      }
      if (kind === "agent.run.failed") {
        const message =
          typeof payload.content === "string" && payload.content.trim().length > 0
            ? payload.content
            : "agent.run.failed";
        throw new Error(message);
      }
      if (kind === "agent.run.cancelled") {
        throw new Error("agent.run.cancelled");
      }
    }
    await delay(AGENT_WAIT_INTERVAL_MS);
  }

  throw new Error("agent.run.timeout");
}

export async function runAgentThroughEvents(params: {
  activeProjectId: string;
  role: string;
  prompt: string;
  contextRefs: string[];
  setAgentRunId: (value: string | null) => void;
}): Promise<{ runId: string; output: string }> {
  const accepted = await runAgentStart({
    projectId: params.activeProjectId,
    role: params.role,
    prompt: params.prompt,
    contextRefs: params.contextRefs,
    bypassCache: true,
  });
  params.setAgentRunId(accepted.runId);
  const output = await waitForAgentRunOutput(accepted.runId);
  return { runId: accepted.runId, output };
}
