import { describe, expect, it } from "vitest";
import {
  buildAnalysisResearchPlan,
  buildEvidenceBibtex,
  buildResearchEvidenceContext,
  initialResearchStages,
} from "./analysisResearchPlan";

describe("analysis research planning", () => {
  it("skips network for a local descriptive data task with an explicit reason", () => {
    const plan = buildAnalysisResearchPlan({
      prompt: "Summarize missing values and distributions in @data.csv",
      sourceType: "data",
      inputFiles: ["data.csv"],
    });
    expect(plan.networkRequirement).toBe("not_needed");
    expect(plan.networkReasonCode).toBe("local_data_sufficient");
    expect(initialResearchStages(plan).find((stage) => stage.id === "evidence")?.status).toBe("skipped");
  });

  it("splits identifiers, methods, years, and biomedical PICO deterministically", () => {
    const plan = buildAnalysisResearchPlan({
      prompt: "Search literature for patient outcome regression evidence 2020 to 2025 DOI 10.1000/Test",
      sourceType: "paper",
      inputFiles: [],
    });
    expect(plan.networkRequirement).toBe("required");
    expect(plan.queries[0]).toBe("10.1000/Test");
    expect(plan.queries.some((query) => query.startsWith("PICO "))).toBe(true);
    expect(plan.queries.some((query) => query.endsWith("2020-2025"))).toBe(true);
  });

  it("keeps academic and general-web evidence visibly separated", () => {
    const evidence = {
      stableId: "doi:10.1/test",
      title: "Supported paper",
      authors: ["A Researcher"],
      year: 2025,
      landingUrl: "https://example.test/paper",
      source: "crossref",
      evidenceLevel: "metadata" as const,
      provenance: ["crossref"],
      originalSourceUrl: "https://example.test/paper",
      rrfScore: 0.1,
      url: "https://example.test/paper",
      snippet: "",
    };
    const context = buildResearchEvidenceContext({
      items: [{
        query: "query",
        ok: true,
        message: "academic.search.complete",
        results: [evidence],
        academicResults: [evidence],
        webResults: [{ ...evidence, stableId: "web:1", source: "wikipedia" }],
        providerErrors: [],
        providerHealth: [],
        networkUsed: true,
      }],
    });
    expect(context).toContain("[academic; metadata_support");
    expect(context).toContain("[general_web; provider=wikipedia; contextual_only]");
    expect(buildEvidenceBibtex([evidence])).toContain("Evidence level: metadata");
  });
});
