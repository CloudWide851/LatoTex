import type { ResourceWarmupScope, ResourceWarmupTaskStatus } from "../types/app";
import { invokeCommand } from "./core";

export function resourceWarmupStart(input: {
  projectId: string;
  scopes: ResourceWarmupScope[];
  libraryRelativePath?: string | null;
}): Promise<{ taskId: string }> {
  return invokeCommand<{ taskId: string }>("resource_warmup_start", {
    input: {
      projectId: input.projectId,
      scopes: input.scopes,
      libraryRelativePath: input.libraryRelativePath ?? null,
    },
  });
}

export function resourceWarmupStatus(taskId: string): Promise<ResourceWarmupTaskStatus> {
  return invokeCommand<ResourceWarmupTaskStatus>("resource_warmup_status", {
    input: { taskId },
  });
}

export async function waitForResourceWarmup(input: {
  projectId: string;
  scopes: ResourceWarmupScope[];
  libraryRelativePath?: string | null;
  timeoutMs?: number;
  pollMs?: number;
  onProgress?: (status: ResourceWarmupTaskStatus) => void;
}): Promise<ResourceWarmupTaskStatus> {
  const started = await resourceWarmupStart({
    projectId: input.projectId,
    scopes: input.scopes,
    libraryRelativePath: input.libraryRelativePath ?? null,
  });
  const timeoutMs = Math.max(3_000, Number(input.timeoutMs ?? 45_000));
  const pollMs = Math.max(120, Number(input.pollMs ?? 320));
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const status = await resourceWarmupStatus(started.taskId);
    input.onProgress?.(status);
    if (status.status === "completed") {
      return status;
    }
    if (status.status === "failed") {
      throw new Error(String(status.error || status.diagnostics?.[0] || "resource warmup failed"));
    }
    if (Date.now() >= deadline) {
      throw new Error("resource_warmup.timeout");
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }
}
