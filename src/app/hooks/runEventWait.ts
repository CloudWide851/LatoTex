import { getEvents } from "../../shared/api/agent";

type RunWaitOptions = {
  runId: string;
  totalTimeoutMs: number;
  inactivityTimeoutMs: number;
  eventLimit?: number;
  waitMs?: number;
  idleDelayMs?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForRunOutputWithPolicy(options: RunWaitOptions): Promise<string> {
  const {
    runId,
    totalTimeoutMs,
    inactivityTimeoutMs,
    eventLimit = 200,
    waitMs = 2_000,
    idleDelayMs = 120,
  } = options;
  let cursor = 0;
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let streamedOutput = "";
  const enforceInactivityTimeout = inactivityTimeoutMs > 0;

  while (true) {
    const now = Date.now();
    if (now - startedAt >= totalTimeoutMs) {
      throw new Error("agent.run.timeout.total");
    }
    if (enforceInactivityTimeout && now - lastProgressAt >= inactivityTimeoutMs) {
      throw new Error("agent.run.timeout.inactive");
    }

    const batch = await getEvents(cursor, eventLimit, runId, waitMs, ["agent.run.heartbeat"]);
    cursor = batch.nextCursor;
    if (batch.events.length > 0) {
      lastProgressAt = Date.now();
    }

    for (const event of batch.events) {
      const payload = event.payload ?? {};
      if (event.kind === "responses.output_text.delta") {
        const chunk = typeof payload.content === "string" ? payload.content : "";
        if (chunk) {
          streamedOutput += chunk;
        }
      } else if (event.kind === "agent.run.completed") {
        const output = typeof payload.output === "string" ? payload.output : streamedOutput;
        return output;
      } else if (event.kind === "agent.run.failed") {
        const message =
          typeof payload.content === "string" && payload.content.trim().length > 0
            ? payload.content
            : "agent.run.failed";
        throw new Error(streamedOutput.trim().length > 0 ? `agent.run.failed_after_delta:${message}` : message);
      } else if (event.kind === "agent.run.cancelled") {
        throw new Error("agent.run.cancelled");
      }
    }

    if (batch.events.length === 0) {
      await delay(idleDelayMs);
    }
  }
}

