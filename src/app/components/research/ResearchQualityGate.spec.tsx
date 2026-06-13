// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchQualityGate } from "./ResearchQualityGate";
import type { ResearchQualityReport } from "../../hooks/researchQualityGate";

describe("ResearchQualityGate", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("surfaces the local audit trail summary", async () => {
    const report: ResearchQualityReport = {
      citationTrust: {
        items: [{
          key: "smith2024",
          status: "pass",
          evidence: ["author-year"],
          sourcePath: "refs.bib",
        }],
        missingKeys: [],
        weakKeys: [],
        duplicateKeys: [],
        unreadableBibPaths: [],
      },
      submission: {
        issues: [],
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
      },
      readiness: {
        score: 100,
        blockers: 0,
        warnings: 0,
        passedLanes: 4,
        totalLanes: 4,
      },
      lanes: [
        { id: "citations", status: "pass", message: { key: "citation ok" } },
        { id: "compile", status: "pass", message: { key: "compile ok" } },
        { id: "submission", status: "pass", message: { key: "submission ok" } },
        { id: "rebuttal", status: "pass", message: { key: "rebuttal ok" } },
      ],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ResearchQualityGate
          report={report}
          loading={false}
          activeLane={null}
          rebuttalOpen={false}
          onLaneSelect={vi.fn()}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.textContent).toContain("research.quality.localAudit.title");
    expect(container.textContent).toContain("research.quality.localAudit.summary");
    expect(container.textContent).toContain("research.quality.localAudit.trace");

    await act(async () => {
      root.unmount();
    });
  });
});
