import { describe, expect, it } from "vitest";
import type { ResearchCapabilityDescriptor } from "../../../shared/types/researchAgent";
import { buildStarterResearchPlan, parseEditableResearchPlanSteps } from "./researchPlanDraft";

const REGISTRY: ResearchCapabilityDescriptor[] = [
  {
    id: "project.overview",
    riskLevel: "read",
    executionTarget: "backend",
    autoAfterPlanApproval: true,
    resourceMode: null,
    requiresNetwork: false,
  },
  {
    id: "literature.search",
    riskLevel: "read",
    executionTarget: "backend",
    autoAfterPlanApproval: true,
    resourceMode: null,
    requiresNetwork: true,
  },
];

describe("researchPlanDraft", () => {
  it("creates a bounded, dependency-ordered starter plan from the approved registry", () => {
    let index = 0;
    const steps = buildStarterResearchPlan("Verify the treatment effect", REGISTRY, () => `step-${++index}`);
    expect(steps.map((step) => step.capability)).toEqual(["project.overview", "literature.search"]);
    expect(steps[1].dependencies).toEqual(["step-1"]);
    expect(JSON.parse(steps[1].inputText)).toEqual({
      queries: ["Verify the treatment effect"],
      deep: true,
    });
  });

  it("rejects malformed edited input instead of silently changing the command", () => {
    const [step] = buildStarterResearchPlan("Goal", REGISTRY, () => "step-1");
    expect(() => parseEditableResearchPlanSteps([{ ...step, inputText: "{" }])).toThrow();
  });
});
