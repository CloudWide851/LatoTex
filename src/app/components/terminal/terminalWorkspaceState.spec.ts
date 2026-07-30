import { describe, expect, it } from "vitest";
import {
  createTerminalTab,
  normalizeTerminalFailure,
} from "./terminalWorkspaceState";

describe("terminal workspace state", () => {
  it("creates ordinary terminals with localized sequence names and project-root cwd intent", () => {
    const tab = createTerminalTab(
      (key) => key === "terminal.newTitle" ? "新终端 {count}" : String(key),
      3,
    );

    expect(tab.title).toBe("新终端 3");
    expect(tab.sequence).toBe(3);
    expect(tab.relativePath).toBeNull();
    expect(tab.cwd).toBe("");
    expect(tab.autoStart).toBe(true);
  });

  it("never exposes an unstructured backend error to the UI", () => {
    const failure = normalizeTerminalFailure(
      "PowerShell crashed with C:\\Users\\secret\\token.txt",
      "terminal.failure.shell_start_failed",
      "shell",
    );

    expect(failure).toEqual({
      code: "terminal.failure.shell_start_failed",
      stage: "shell",
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toContain("secret");
  });

  it("accepts the backend structured failure envelope", () => {
    const failure = normalizeTerminalFailure(
      JSON.stringify({
        code: "terminal.failure.start_timeout",
        stage: "shell",
        retryable: true,
      }),
      "terminal.failure.shell_start_failed",
      "shell",
    );

    expect(failure.code).toBe("terminal.failure.start_timeout");
  });
});
