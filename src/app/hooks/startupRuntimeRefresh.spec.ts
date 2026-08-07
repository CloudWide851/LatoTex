import { describe, expect, it } from "vitest";
import { shouldRefreshAgentRuntimesAtStartup } from "./startupRuntimeRefresh";

describe("shouldRefreshAgentRuntimesAtStartup", () => {
  it("starts only after the Tauri workspace is released and only once", () => {
    expect(shouldRefreshAgentRuntimesAtStartup({
      startupReady: false,
      isTauriRuntime: true,
      refreshStarted: false,
    })).toBe(false);
    expect(shouldRefreshAgentRuntimesAtStartup({
      startupReady: true,
      isTauriRuntime: false,
      refreshStarted: false,
    })).toBe(false);
    expect(shouldRefreshAgentRuntimesAtStartup({
      startupReady: true,
      isTauriRuntime: true,
      refreshStarted: false,
    })).toBe(true);
    expect(shouldRefreshAgentRuntimesAtStartup({
      startupReady: true,
      isTauriRuntime: true,
      refreshStarted: true,
    })).toBe(false);
  });
});
