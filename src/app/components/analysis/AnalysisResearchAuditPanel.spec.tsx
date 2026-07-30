import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnalysisTaskRun } from "../../hooks/analysisTypes";
import { AnalysisResearchAuditPanel } from "./AnalysisResearchAuditPanel";

const t = (key: string) => key;

function runFixture(): AnalysisTaskRun {
  return {
    id: "run-1",
    prompt: "Search literature",
    title: "Research run",
    summary: "",
    status: "completed",
    assetRelativePaths: [".latotex/analysis/run-1/images/evidence.bib"],
    labels: [],
    values: [],
    insights: [],
    steps: [],
    sourceType: "paper",
    inputFiles: [],
    outputLanguage: "en-US",
    researchPlan: {
      intent: "Search literature",
      queries: ["query"],
      inclusionCriteria: [],
      exclusionCriteria: [],
      dataChecks: [],
      expectedValidations: [],
      networkRequirement: "required",
      networkReasonCode: "explicit_research_evidence",
    },
    researchStages: [
      { id: "plan", status: "completed", detailCode: "validated" },
      { id: "evidence", status: "completed", detailCode: "partial_sources" },
      { id: "analysis", status: "completed" },
      { id: "review", status: "completed" },
      { id: "conclusion", status: "completed" },
    ],
    academicEvidence: [{
      stableId: "doi:10.1/test",
      title: "Academic result",
      authors: ["A Researcher"],
      landingUrl: "https://example.test/paper",
      source: "crossref",
      evidenceLevel: "metadata",
      provenance: ["crossref", "openalex"],
      originalSourceUrl: "https://example.test/paper",
      rrfScore: 0.1,
      url: "https://example.test/paper",
      snippet: "",
    }],
    webEvidence: [],
    providerHealth: [{
      provider: "semantic_scholar",
      category: "academic",
      status: "failed",
      resultCount: 0,
      code: "academic.semantic_scholar.timeout.secret-shaped-detail",
      retryable: true,
    }],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("AnalysisResearchAuditPanel", () => {
  it("renders five stages, evidence level, source health, and BibTeX export without raw codes", () => {
    const html = renderToStaticMarkup(
      <AnalysisResearchAuditPanel run={runFixture()} onExportArtifact={() => undefined} t={t} />,
    );
    expect(html).toContain("analysis.research.stage.plan");
    expect(html).toContain("analysis.research.stage.conclusion");
    expect(html).toContain("analysis.research.level.metadata");
    expect(html).toContain("semantic_scholar");
    expect(html).toContain("analysis.research.exportBibtex");
    expect(html).not.toContain("secret-shaped-detail");
  });
});
