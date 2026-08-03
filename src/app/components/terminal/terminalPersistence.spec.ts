import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TERMINAL_RAIL_WIDTH,
  loadTerminalState,
  saveTerminalState,
} from "./terminalPersistence";
import type { TerminalTab } from "./terminalTypes";

function tab(id: string, history: string[]): TerminalTab {
  return {
    id,
    title: id,
    sequence: id === "a" ? 1 : 2,
    launchKind: "shell",
    relativePath: null,
    sessionId: "live",
    startRequestId: "request-live",
    autoStart: false,
    cwd: "C:/demo",
    venvPath: null,
    envSource: null,
    status: "running",
    cursor: 99,
    buffer: "output",
    history,
    failure: null,
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
    saveTerminalState(
      "project-1",
      [tab("a", ["pnpm build"]), tab("b", ["cargo test"])],
      "b",
      196,
    );

    const restored = loadTerminalState("project-1");

    expect(restored?.activeTabId).toBe("b");
    expect(restored?.tabs[0].sessionId).toBeNull();
    expect(restored?.tabs[0].startRequestId).toBeNull();
    expect(restored?.tabs[0].autoStart).toBe(true);
    expect(restored?.tabs[0].history).toEqual(["pnpm build"]);
    expect(restored?.tabs[1].history).toEqual(["cargo test"]);
    expect(restored?.tabs[0].title).toBe("a");
    expect(restored?.tabs[0].launchKind).toBe("shell");
    expect(restored?.railWidth).toBe(196);
  });

  it("persists trusted CLI launch type and a custom title", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const codexTab = { ...tab("codex", []), title: "Codex CLI", launchKind: "codex-cli" as const };

    saveTerminalState("project-runtime", [codexTab], codexTab.id, 188);

    const restored = loadTerminalState("project-runtime");
    expect(restored?.tabs[0].title).toBe("Codex CLI");
    expect(restored?.tabs[0].launchKind).toBe("codex-cli");
  });

  it("migrates v1 tabs and applies a safe default rail width", () => {
    const values = new Map<string, string>();
    values.set("latotex.terminal.state.v1:project-legacy", JSON.stringify({
      tabs: [{ ...tab("legacy", []), sequence: undefined, launchKind: undefined }],
      activeTabId: "legacy",
    }));
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    const restored = loadTerminalState("project-legacy");

    expect(restored?.tabs[0].sequence).toBe(1);
    expect(restored?.tabs[0].launchKind).toBe("shell");
    expect(restored?.railWidth).toBe(DEFAULT_TERMINAL_RAIL_WIDTH);
  });
});
