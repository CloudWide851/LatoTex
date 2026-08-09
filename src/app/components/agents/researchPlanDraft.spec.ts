import { describe, expect, it } from "vitest";
import type { ResearchCapabilityDescriptor } from "../../../shared/types/researchAgent";
import { buildStarterResearchPlan, parseEditableResearchPlanSteps } from "./researchPlanDraft";

const REGISTRY: ResearchCapabilityDescriptor[] = [
  {
    id: "project.overview",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    outputType: "json",
    riskLevel: "read",
    riskReasonKey: "research.capability.risk.read",
    executionTarget: "backend",
    autoAfterPlanApproval: true,
    resourceMode: null,
    idempotency: "safe_replay",
    timeoutMs: 15_000,
    maxRetries: 1,
    undoCapability: null,
    egressCategory: "none",
    requiresNetwork: false,
  },
  {
    id: "literature.search",
    inputSchema: { type: "object", properties: {}, required: ["queries"], additionalProperties: false },
    outputType: "json",
    riskLevel: "read",
    riskReasonKey: "research.capability.risk.read",
    executionTarget: "backend",
    autoAfterPlanApproval: true,
    resourceMode: null,
    idempotency: "request_deduplicated",
    timeoutMs: 120_000,
    maxRetries: 2,
    undoCapability: null,
    egressCategory: "academic_metadata",
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
