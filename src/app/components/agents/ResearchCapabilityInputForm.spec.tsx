// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchCapabilityDescriptor } from "../../../shared/types/researchAgent";
import { ResearchCapabilityInputForm } from "./ResearchCapabilityInputForm";

const DESCRIPTOR: ResearchCapabilityDescriptor = {
  id: "literature.search",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer" },
      includePreprints: { type: "boolean" },
      sources: { type: "array", items: { type: "string" } },
      route: { type: "string", enum: ["general", "pubmed"] },
    },
    required: ["query"],
    additionalProperties: false,
  },
  outputType: "evidence[]",
  riskLevel: "read",
  riskReasonKey: "research.capability.risk.read",
  executionTarget: "backend",
  autoAfterPlanApproval: true,
  resourceMode: "read",
  idempotency: "safe_replay",
  timeoutMs: 30_000,
  maxRetries: 2,
  undoCapability: null,
  egressCategory: "academic_metadata",
  requiresNetwork: true,
};

describe("ResearchCapabilityInputForm", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("renders schema fields by default and keeps raw JSON behind an advanced disclosure", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <ResearchCapabilityInputForm
          descriptor={DESCRIPTOR}
          inputText={JSON.stringify({
            query: "causal inference",
            limit: 20,
            includePreprints: true,
            sources: ["crossref", "openalex"],
            route: "general",
          })}
          disabled={false}
          onChange={onChange}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.textContent).toContain("query *");
    expect(container.querySelectorAll("input")).toHaveLength(3);
    expect(container.querySelector("select")?.value).toBe("general");
    expect(container.querySelector('[aria-label="research.workbench.stepInput"]')).toBeNull();

    const advanced = container.querySelector('button[aria-expanded="false"]') as HTMLButtonElement;
    await act(async () => advanced.click());

    expect(advanced.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[aria-label="research.workbench.stepInput"]')).not.toBeNull();
  });
});
