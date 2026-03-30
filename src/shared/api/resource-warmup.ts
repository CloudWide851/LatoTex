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

export function createWarmupActivityKey(status: ResourceWarmupTaskStatus): string {
  return [
    Number.isFinite(status.percent) ? Math.round(status.percent * 100) : "nan",
    status.stage ?? "",
    status.message ?? "",
    status.currentItem ?? "",
  ].join("|");
}

export async function waitForResourceWarmup(input: {
  projectId: string;
  scopes: ResourceWarmupScope[];
  libraryRelativePath?: string | null;
  timeoutMs?: number;
  inactivityTimeoutMs?: number;
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
  const inactivityTimeoutMs = Math.max(
    pollMs * 2,
    Number(
      input.inactivityTimeoutMs
      ?? Math.min(timeoutMs, Math.max(15_000, Math.round(timeoutMs * 0.4))),
    ),
  );
  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  let lastActivityKey = "";

  for (;;) {
    const status = await resourceWarmupStatus(started.taskId);
    input.onProgress?.(status);
    const now = Date.now();
    const activityKey = createWarmupActivityKey(status);
    if (activityKey !== lastActivityKey) {
      lastActivityKey = activityKey;
      lastActivityAt = now;
    }
    if (status.status === "completed") {
      return status;
    }
    if (status.status === "failed") {
      throw new Error(String(status.error || status.diagnostics?.[0] || "resource warmup failed"));
    }
    if (now - startedAt >= timeoutMs || now - lastActivityAt >= inactivityTimeoutMs) {
      throw new Error("resource_warmup.timeout");
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollMs));
  }
}

