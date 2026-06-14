import { describe, expect, it } from "vitest";
import { parseAgentPrompt, pickCommandSuggestions } from "./agentCommands";

describe("agentCommands", () => {
  it("parses rebuttal slash command", () => {
    expect(parseAgentPrompt("/rebuttal Reviewer 2 asks for ablation.")).toEqual({
      kind: "command",
      command: "rebuttal",
      args: "Reviewer 2 asks for ablation.",
      raw: "/rebuttal Reviewer 2 asks for ablation.",
    });
  });

  it("suggests research slash commands", () => {
    expect(pickCommandSuggestions("/reb")).toEqual(["/rebuttal"]);
    expect(pickCommandSuggestions("/sub")).toEqual(["/submit-check"]);
    expect(pickCommandSuggestions("/check")).toEqual(["/check-ref"]);
  });

  it("parses submission preflight slash command", () => {
    expect(parseAgentPrompt("/submit-check profile=journal")).toEqual({
      kind: "command",
      command: "submit-check",
      args: "profile=journal",
      raw: "/submit-check profile=journal",
    });
  });
});
