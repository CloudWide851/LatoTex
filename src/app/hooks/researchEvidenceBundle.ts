import type { SubmissionPackBuildResponse } from "../../shared/types/app";
import type { ResearchQualityReport, ResearchQualityStatus } from "./researchQualityGate";
import type { ResearchAuditMarkdownTranslator } from "./researchQualityAudit";

export const SUBMISSION_EVIDENCE_SCHEMA = "latotex.submission-evidence.v1";

export type SubmissionEvidenceBundle = {
  jsonPath: string;
  markdownPath: string;
  jsonText: string;
  markdownText: string;
};

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : ".";
}

function auditLabel(value: string, t: ResearchAuditMarkdownTranslator): string {
  return /^(claim|profile|risk|rebuttal)\./.test(value)
    ? t(`research.quality.audit.${value}`)
    : value;
}

function statusLabel(status: ResearchQualityStatus, t: ResearchAuditMarkdownTranslator): string {
  return t(`research.quality.status.${status}`);
}

function packStatusLabel(status: string, t: ResearchAuditMarkdownTranslator): string {
  return status === "ready" || status === "blocked"
    ? t(`research.evidence.status.${status}`)
    : status;
}

export function buildSubmissionEvidenceBundle(input: {
  selectedFile: string | null;
  report: ResearchQualityReport;
  pack: SubmissionPackBuildResponse;
  t: ResearchAuditMarkdownTranslator;
}): SubmissionEvidenceBundle {
  const { selectedFile, report, pack, t } = input;
  const outputDir = dirname(pack.manifestPath);
  const jsonPath = `${outputDir}/submission-evidence.json`;
  const markdownPath = `${outputDir}/submission-evidence.md`;
  const generatedAt = new Date().toISOString();
  const payload = {
    schema: SUBMISSION_EVIDENCE_SCHEMA,
    generatedAt,
    source: selectedFile ?? "",
    profileId: pack.profileId,
    status: pack.status,
    readiness: report.readiness,
    auditSummary: report.auditSummary,
    submissionPack: {
      manifestPath: pack.manifestPath,
      zipPath: pack.zipPath ?? null,
      includedFiles: pack.includedFiles,
      skippedFiles: pack.skippedFiles,
      blockers: pack.blockers,
      warnings: pack.warnings,
    },
    claimAudit: report.claimAudit,
    citationEvidence: report.citationTrust.items,
    profileChecklist: report.profileChecklist,
    reviewerRisk: report.reviewerRisk,
    rebuttalEvidence: report.rebuttalEvidence,
  };
  const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
  const itemLine = (item: { status: ResearchQualityStatus; title: string; evidence: string[] }) => (
    `- [${statusLabel(item.status, t)}] ${auditLabel(item.title, t)} (${item.evidence.join(", ")})`
  );
  const markdownText = `${[
    `# ${t("research.evidence.reportTitle")}`,
    "",
    `- ${t("research.audit.reportSource")}: ${selectedFile ?? "-"}`,
    `- ${t("research.audit.reportProfile")}: ${pack.profileId}`,
    `- ${t("research.evidence.reportStatus")}: ${packStatusLabel(pack.status, t)}`,
    `- ${t("research.evidence.reportScore")}: ${report.readiness.score}`,
    `- ${t("research.evidence.reportManifest")}: ${pack.manifestPath}`,
    `- ${t("research.evidence.reportZip")}: ${pack.zipPath ?? "-"}`,
    "",
    `## ${t("research.quality.detail.title.claims")}`,
    ...report.claimAudit.items.map(itemLine),
    "",
    `## ${t("research.quality.detail.title.citations")}`,
    ...report.citationTrust.items.map((item) => `- [${statusLabel(item.status, t)}] ${item.key} (${item.evidence.join(", ") || "-"})`),
    "",
    `## ${t("research.quality.detail.title.profile")}`,
    ...report.profileChecklist.items.map(itemLine),
    "",
    `## ${t("research.quality.detail.reviewerRisk")}`,
    ...report.reviewerRisk.items.map(itemLine),
    "",
    `## ${t("research.evidence.reportFiles")}`,
    ...pack.includedFiles.map((file) => `- ${file.path} (${t("research.evidence.reportBytes", { bytes: file.sizeBytes })})`),
    "",
  ].join("\n")}\n`;
  return { jsonPath, markdownPath, jsonText, markdownText };
}
