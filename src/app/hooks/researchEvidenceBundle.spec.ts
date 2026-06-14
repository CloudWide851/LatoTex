import { describe, expect, it } from "vitest";
import type { SubmissionPackBuildResponse } from "../../shared/types/app";
import { buildResearchQualityReport } from "./researchQualityGate";
import { buildSubmissionEvidenceBundle, SUBMISSION_EVIDENCE_SCHEMA } from "./researchEvidenceBundle";

const labels: Record<string, string> = {
  "research.audit.reportSource": "Source",
  "research.audit.reportProfile": "Profile",
  "research.evidence.reportTitle": "Submission evidence bundle",
  "research.evidence.reportStatus": "Status",
  "research.evidence.reportManifest": "Manifest",
  "research.evidence.reportZip": "Source zip",
  "research.evidence.reportFiles": "Included source files",
  "research.evidence.reportScore": "Readiness score",
  "research.evidence.reportBytes": "{bytes} bytes",
  "research.evidence.status.ready": "ready",
  "research.evidence.status.blocked": "blocked",
  "research.quality.detail.title.claims": "Claim evidence",
  "research.quality.detail.title.citations": "Citation evidence",
  "research.quality.detail.title.profile": "Profile checklist",
  "research.quality.detail.reviewerRisk": "Reviewer risk",
  "research.quality.status.pass": "pass",
  "research.quality.status.warn": "warn",
  "research.quality.status.fail": "fail",
  "research.quality.audit.claim.noHighRiskClaims": "No high-risk claims",
  "research.quality.audit.profile.documentStructure": "Document structure",
  "research.quality.audit.profile.citationEvidence": "Citation evidence",
  "research.quality.audit.profile.abstract": "Abstract section",
  "research.quality.audit.risk.claims": "Claim support risk",
  "research.quality.audit.risk.citations": "Citation integrity risk",
  "research.quality.audit.risk.compile": "Compile risk",
  "research.quality.audit.risk.todos": "Draft marker risk",
  "research.quality.audit.risk.profile": "Profile fit risk",
};

function t(key: string, params?: Record<string, string | number>) {
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    labels[key] ?? key,
  );
}

describe("buildSubmissionEvidenceBundle", () => {
  it("creates localized JSON and Markdown evidence beside the submission manifest", () => {
    const report = buildResearchQualityReport({
      selectedFile: "paper/main.tex",
      profileId: "journal",
      texSource: String.raw`\begin{document}\begin{abstract}Short.\end{abstract}\cite{smith2024}\bibliography{refs}\end{document}`,
      fileList: ["paper/main.tex", "paper/refs.bib"],
      compileDiagnostics: [],
      bibSources: {
        "paper/refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\nauthor={Smith},\nyear={2024},\ndoi={10.0000/demo}\n}",
      },
    });
    const pack: SubmissionPackBuildResponse = {
      status: "ready",
      profileId: "journal",
      manifestPath: ".latotex/submissions/2026-06-14-journal/submission-manifest.json",
      zipPath: ".latotex/submissions/2026-06-14-journal/source.zip",
      blockers: [],
      warnings: [],
      includedFiles: [
        { path: "paper/main.tex", sizeBytes: 120 },
        { path: "paper/refs.bib", sizeBytes: 240 },
      ],
      skippedFiles: [],
    };

    const bundle = buildSubmissionEvidenceBundle({
      selectedFile: "paper/main.tex",
      report,
      pack,
      t,
    });

    expect(bundle.jsonPath).toBe(".latotex/submissions/2026-06-14-journal/submission-evidence.json");
    expect(bundle.markdownPath).toBe(".latotex/submissions/2026-06-14-journal/submission-evidence.md");
    expect(JSON.parse(bundle.jsonText)).toMatchObject({
      schema: SUBMISSION_EVIDENCE_SCHEMA,
      source: "paper/main.tex",
      status: "ready",
      submissionPack: {
        manifestPath: pack.manifestPath,
        zipPath: pack.zipPath,
      },
    });
    expect(bundle.markdownText).toContain("# Submission evidence bundle");
    expect(bundle.markdownText).toContain("- Status: ready");
    expect(bundle.markdownText).toContain("- paper/main.tex (120 bytes)");
    expect(bundle.markdownText).toContain("## Included source files");
  });
});
