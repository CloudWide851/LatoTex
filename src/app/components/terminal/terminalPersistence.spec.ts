import { describe, expect, it, vi } from "vitest";
import { loadTerminalState, saveTerminalState } from "./terminalPersistence";
import type { TerminalTab } from "./terminalTypes";

function tab(id: string, history: string[]): TerminalTab {
  return {
    id,
    title: id,
    relativePath: null,
    sessionId: "live",
    cwd: "C:/demo",
    venvPath: null,
    envSource: null,
    status: "running",
    cursor: 99,
    buffer: "output",
    history,
    error: null,
  };
}

describe("terminalPersistence", () => {
  it("restores terminal tabs without live sessions and keeps per-tab history", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    saveTerminalState("project-1", [tab("a", ["pnpm build"]), tab("b", ["cargo test"])], "b");

    const restored = loadTerminalState("project-1");

    expect(restored?.activeTabId).toBe("b");
    expect(restored?.tabs[0].sessionId).toBeNull();
    expect(restored?.tabs[0].history).toEqual(["pnpm build"]);
    expect(restored?.tabs[1].history).toEqual(["cargo test"]);
  });
});
