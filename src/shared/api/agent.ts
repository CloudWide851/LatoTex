import type { Ack, AgentExecuteStartAccepted, EventBatch } from "../types/app";
import { invokeCommand } from "./core";

export function executeWorkflowStart(input: {
  projectId: string;
  workflowId: string;
  callsite: string;
  prompt: string;
  contextRefs: string[];
  modelOverride?: string;
  bypassCache?: boolean;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("agent_execute_start", {
    input: {
      projectId: input.projectId,
      workflowId: input.workflowId,
      callsite: input.callsite,
      prompt: input.prompt,
      contextRefs: input.contextRefs,
      modelOverride: input.modelOverride,
      bypassCache: input.bypassCache ?? false,
    },
  });
}

export function executeWorkflowCancel(runId: string): Promise<Ack> {
  return invokeCommand<Ack>("agent_execute_cancel", { input: { runId } });
}

export function getEvents(
  cursor?: number,
  limit = 200,
  runId?: string,
  waitMs?: number,
  excludeKinds?: string[],
): Promise<EventBatch> {
  return invokeCommand<EventBatch>("events_subscribe", {
    query: { cursor, limit, runId, waitMs, excludeKinds },
  });
}
