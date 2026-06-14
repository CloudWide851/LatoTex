import { describe, expect, it } from "vitest";
import {
  buildClaimAudit,
  buildProfileChecklist,
  buildResearchAuditMarkdown,
} from "./researchQualityAudit";
import type { CitationTrustReport } from "./researchQualityGate";
import type { SubmissionCheckReport } from "./researchSubmissionCheck";

describe("researchQualityAudit", () => {
  const t = (key: string) => ({
    "research.audit.reportTitle": "LatoTex research audit",
    "research.audit.reportSource": "Source",
    "research.audit.reportProfile": "Profile",
    "research.audit.reportLocalEvidence": "Local evidence",
    "research.audit.reportClaimBlockers": "Claim blockers",
    "research.audit.reportReviewerRisks": "Reviewer risks",
    "research.quality.status.pass": "pass",
    "research.quality.status.warn": "warn",
    "research.quality.status.fail": "fail",
    "research.quality.detail.title.claims": "Claim evidence",
    "research.quality.detail.title.profile": "Profile checklist",
    "research.quality.detail.reviewerRisk": "Reviewer risk",
    "research.quality.detail.title.rebuttal": "Reviewer response",
    "research.quality.audit.claim.noHighRiskClaims": "No high-risk claims",
  }[key] ?? key);

  const cleanCitationTrust: CitationTrustReport = {
    items: [{ key: "smith2024", status: "pass", evidence: ["doi"], sourcePath: "refs.bib" }],
    missingKeys: [],
    weakKeys: [],
    duplicateKeys: [],
    unreadableBibPaths: [],
  };
  const cleanSubmission: SubmissionCheckReport = {
    issues: [],
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  };

  it("flags claim-like sentences without nearby citations", () => {
    const audit = buildClaimAudit("We demonstrate a significant improvement over prior systems.");

    expect(audit.blockerCount).toBe(1);
    expect(audit.items[0]).toMatchObject({
      status: "fail",
      detail: "claim.missingCitation",
    });
  });

  it("checks profile-specific submission expectations", () => {
    const checklist = buildProfileChecklist({
      profileId: "arxiv",
      texSource: String.raw`\begin{document}\cite{smith2024}\bibliography{refs}\end{document}`,
      fileList: ["main.tex", "refs.bib"],
      citationTrust: cleanCitationTrust,
      submission: cleanSubmission,
    });

    expect(checklist.profileId).toBe("arxiv");
    expect(checklist.items.some((item) => item.id === "profile-arxiv-bbl" && item.status === "warn")).toBe(true);
  });

  it("exports a local markdown audit summary", () => {
    const claimAudit = buildClaimAudit("No risky claims here.");
    const profileChecklist = buildProfileChecklist({
      profileId: "generic",
      texSource: String.raw`\begin{document}\cite{smith2024}\bibliography{refs}\end{document}`,
      fileList: ["main.tex", "refs.bib"],
      citationTrust: cleanCitationTrust,
      submission: cleanSubmission,
    });
    const markdown = buildResearchAuditMarkdown({
      selectedFile: "main.tex",
      report: {
        auditSummary: {
          profileId: "generic",
          localEvidenceCount: 1,
          claimBlockers: claimAudit.blockerCount,
          profileBlockers: profileChecklist.blockerCount,
          reviewerRisks: 0,
          rebuttalEvidenceCount: 0,
        },
        claimAudit,
        profileChecklist,
        reviewerRisk: { items: [], blockerCount: 0, warningCount: 0 },
        rebuttalEvidence: { items: [], warningCount: 0 },
      },
    }, t);

    expect(markdown).toContain("# LatoTex research audit");
    expect(markdown).toContain("- Source: main.tex");
    expect(markdown).toContain("## Profile checklist");
  });
});
