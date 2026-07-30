import { describe, expect, it, vi } from "vitest";
import type {
  AcademicEvidence,
  AnalysisResearchPlan,
  ReferenceCheckResponse,
} from "../../shared/types/app";
import { initialResearchStages } from "./analysisResearchPlan";
import { runAnalysisResearchEvidence } from "./analysisResearchWorkflow";

function plan(networkRequirement: AnalysisResearchPlan["networkRequirement"]): AnalysisResearchPlan {
  return {
    intent: "Review evidence",
    queries: ["evidence query"],
    inclusionCriteria: ["topic-match"],
    exclusionCriteria: ["missing-title"],
    dataChecks: ["evidence-level"],
    expectedValidations: ["review-quality-gate"],
    networkRequirement,
    networkReasonCode: networkRequirement === "not_needed"
      ? "local_data_sufficient"
      : "explicit_research_evidence",
  };
}

function evidence(stableId: string, source: string): AcademicEvidence {
  return {
    stableId,
    title: `${source} evidence`,
    authors: ["A. Researcher"],
    landingUrl: `https://example.test/${stableId}`,
    source,
    evidenceLevel: "metadata",
    provenance: [source],
    originalSourceUrl: `https://example.test/${stableId}`,
    rrfScore: 0.1,
    url: `https://example.test/${stableId}`,
    snippet: "",
  };
}

describe("runAnalysisResearchEvidence", () => {
  it("does not invoke search when the validated plan skips networking", async () => {
    const researchPlan = plan("not_needed");
    const search = vi.fn();
    const outcome = await runAnalysisResearchEvidence({
      projectId: "project-local",
      plan: researchPlan,
      stages: initialResearchStages(researchPlan),
      onProgress: () => undefined,
      search,
    });

    expect(search).not.toHaveBeenCalled();
    expect(outcome.stages.find((stage) => stage.id === "evidence")).toMatchObject({
      status: "skipped",
      detailCode: "local_data_sufficient",
    });
  });

  it("keeps categorized evidence and marks provider-level partial failure", async () => {
    const researchPlan = plan("required");
    const academic = evidence("doi:10.1000/test", "crossref");
    const web = evidence("web:wikipedia:1", "wikipedia");
    const response: ReferenceCheckResponse = {
      items: [{
        query: "evidence query",
        ok: true,
        message: "academic.search.complete",
        results: [academic, web],
        academicResults: [academic],
        webResults: [web],
        providerErrors: [{
          provider: "semantic_scholar",
          code: "academic.semantic_scholar.timeout",
          retryable: true,
        }],
        providerHealth: [{
          provider: "semantic_scholar",
          category: "academic",
          status: "failed",
          resultCount: 0,
          code: "academic.semantic_scholar.timeout",
          retryable: true,
        }],
        networkUsed: true,
      }],
    };
    const outcome = await runAnalysisResearchEvidence({
      projectId: "project-research",
      plan: researchPlan,
      stages: initialResearchStages(researchPlan),
      onProgress: () => undefined,
      search: async () => response,
    });

    expect(outcome.academicEvidence).toEqual([academic]);
    expect(outcome.webEvidence).toEqual([web]);
    expect(outcome.providerHealth).toHaveLength(1);
    expect(outcome.stages.find((stage) => stage.id === "evidence")).toMatchObject({
      status: "completed",
      detailCode: "partial_sources",
    });
  });
});
