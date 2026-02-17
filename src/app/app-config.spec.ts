import { describe, expect, it } from "vitest";
import { FIXED_AGENT_ROLES, normalizeAgentBindings } from "./app-config";

describe("normalizeAgentBindings", () => {
  it("fills fixed roles and keeps configured values", () => {
    const normalized = normalizeAgentBindings([
      { role: "task", modelId: "task-model" },
      { role: "git_summary", modelId: "git-model" },
    ]);

    expect(normalized).toHaveLength(FIXED_AGENT_ROLES.length);
    expect(normalized.find((item) => item.role === "task")?.modelId).toBe("task-model");
    expect(normalized.find((item) => item.role === "git_summary")?.modelId).toBe("git-model");
    expect(normalized.find((item) => item.role === "review")?.modelId).toBe("");
  });
});
