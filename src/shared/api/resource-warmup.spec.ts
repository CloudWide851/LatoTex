import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeCommandMock } = vi.hoisted(() => ({
  invokeCommandMock: vi.fn(),
}));

vi.mock("./core", () => ({
  invokeCommand: invokeCommandMock,
}));

import { createWarmupActivityKey, waitForResourceWarmup } from "./resource-warmup";

describe("resource warmup wait", () => {
  beforeEach(() => {
    invokeCommandMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-30T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks activity from status fields", () => {
    expect(
      createWarmupActivityKey({
        taskId: "task-1",
        status: "running",
        percent: 10,
        stage: "copying_engine",
        message: "copying_engine",
        currentItem: "tectonic",
        diagnostics: [],
      }),
    ).not.toBe(
      createWarmupActivityKey({
        taskId: "task-1",
        status: "running",
        percent: 35,
        stage: "extracting_search",
        message: "extracting_search",
        currentItem: "tectonic",
        diagnostics: [],
      }),
    );
  });

  it("times out when warmup stops making progress", async () => {
    invokeCommandMock.mockImplementation(async (command: string) => {
      if (command === "resource_warmup_start") {
        return { taskId: "task-1" };
      }
      return {
        taskId: "task-1",
        status: "running",
        percent: 10,
        stage: "extracting_search",
        message: "extracting_search",
        currentItem: "tectonic",
        diagnostics: [],
      };
    });

    const promise = waitForResourceWarmup({
      projectId: "project-1",
      scopes: ["tectonic"],
      timeoutMs: 20_000,
      inactivityTimeoutMs: 2_500,
      pollMs: 1_000,
    });
    const assertion = expect(promise).rejects.toThrow("resource_warmup.timeout");

    await vi.advanceTimersByTimeAsync(4_000);
    await assertion;
  });

  it("keeps waiting while progress continues and resolves once completed", async () => {
    let statusCall = 0;
    invokeCommandMock.mockImplementation(async (command: string) => {
      if (command === "resource_warmup_start") {
        return { taskId: "task-2" };
      }
      statusCall += 1;
      if (statusCall === 1) {
        return {
          taskId: "task-2",
          status: "running",
          percent: 10,
          stage: "copying_engine",
          message: "copying_engine",
          currentItem: "tectonic",
          diagnostics: [],
        };
      }
      if (statusCall === 2) {
        return {
          taskId: "task-2",
          status: "running",
          percent: 45,
          stage: "seeding_cache",
          message: "seeding_cache",
          currentItem: "tectonic",
          diagnostics: [],
        };
      }
      if (statusCall === 3) {
        return {
          taskId: "task-2",
          status: "running",
          percent: 80,
          stage: "extracting_search",
          message: "extracting_search",
          currentItem: "tectonic",
          diagnostics: [],
        };
      }
      return {
        taskId: "task-2",
        status: "completed",
        percent: 100,
        stage: "ready",
        message: "ready",
        currentItem: "tectonic",
        diagnostics: [],
      };
    });

    const promise = waitForResourceWarmup({
      projectId: "project-1",
      scopes: ["tectonic"],
      timeoutMs: 10_000,
      inactivityTimeoutMs: 1_500,
      pollMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(4_000);
    await expect(promise).resolves.toEqual(expect.objectContaining({ status: "completed" }));
  });
});

