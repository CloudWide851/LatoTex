import { describe, expect, it } from "vitest";
import { buildTerminalSuggestions, nextTerminalInputLine } from "./terminalSuggestions";

describe("terminalSuggestions", () => {
  it("updates the tracked input line for printable text, enter, and backspace", () => {
    expect(nextTerminalInputLine("", "p")).toBe("p");
    expect(nextTerminalInputLine("pn", "\u007f")).toBe("p");
    expect(nextTerminalInputLine("pnpm build", "\r")).toBe("");
  });

  it("builds command, history, and path suggestions from the current prefix", () => {
    const suggestions = buildTerminalSuggestions("pn", {
      tab: {
        id: "term-1",
        title: "Terminal 1",
        relativePath: "src/main.tex",
        sessionId: null,
        cwd: "",
        venvPath: null,
        envSource: null,
        status: "idle",
        cursor: 0,
        buffer: "",
        error: null,
      },
      selectedFile: "paper/main.tex",
      history: ["pnpm lint"],
    });

    expect(suggestions.map((item) => item.value)).toContain("pnpm lint");
    expect(suggestions.some((item) => item.value === "pnpm build")).toBe(true);
  });
});
