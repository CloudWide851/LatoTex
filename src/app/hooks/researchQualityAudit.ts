import type { CitationTrustReport, ResearchQualityStatus } from "./researchQualityGate";
import type { SubmissionCheckReport } from "./researchSubmissionCheck";

export type ResearchWorkflowProfileId = "generic" | "arxiv" | "conference" | "journal" | "ieee-like";

export type ResearchAuditItem = {
  id: string;
  status: ResearchQualityStatus;
  title: string;
  detail: string;
  evidence: string[];
};

export type ResearchClaimAudit = {
  items: ResearchAuditItem[];
  blockerCount: number;
  warningCount: number;
};

export type ResearchProfileChecklist = {
  profileId: ResearchWorkflowProfileId;
  items: ResearchAuditItem[];
  blockerCount: number;
  warningCount: number;
};

export type ResearchReviewerRisk = {
  items: ResearchAuditItem[];
  blockerCount: number;
  warningCount: number;
};

export type ResearchRebuttalEvidence = {
  items: ResearchAuditItem[];
  warningCount: number;
};

export type ResearchAuditSummary = {
  profileId: ResearchWorkflowProfileId;
  localEvidenceCount: number;
  claimBlockers: number;
  profileBlockers: number;
  reviewerRisks: number;
  rebuttalEvidenceCount: number;
};

type AuditMarkdownParams = Record<string, string | number>;
export type ResearchAuditMarkdownTranslator = (key: string, params?: AuditMarkdownParams) => string;

const CLAIM_HINTS = [
  "show",
  "shows",
  "prove",
  "proves",
  "demonstrate",
  "demonstrates",
  "significant",
  "outperform",
  "outperforms",
  "improve",
  "improves",
  "reduce",
  "reduces",
  "state-of-the-art",
  "novel",
  "首次",
  "证明",
  "显著",
  "优于",
  "提升",
  "降低",
  "创新",
];

function normalizeProfileId(value: string | null | undefined): ResearchWorkflowProfileId {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["arxiv", "conference", "journal", "ieee-like"].includes(normalized)) {
    return normalized as ResearchWorkflowProfileId;
  }
  if (normalized === "ieee" || normalized === "ieee_like") {
    return "ieee-like";
  }
  return "generic";
}

function cleanTexText(source: string): string {
  return source
    .replace(/%.*$/gm, "")
    .replace(/\\(?:cite[a-zA-Z*]*|ref|eqref|label|url|href)(?:\[[^\]]*])*\{[^}]*}/g, " ")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*])?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(source: string): string[] {
  const cleaned = cleanTexText(source);
  return cleaned
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 36)
    .slice(0, 80);
}

function sentenceHasCitation(source: string, sentence: string): boolean {
  const index = cleanTexText(source).indexOf(sentence);
  if (index < 0) {
    return /\\cite[a-zA-Z*]*\s*(?:\[[^\]]*])*\s*\{[^}]+}/.test(source);
  }
  const windowStart = Math.max(0, index - 180);
  const windowEnd = Math.min(source.length, index + sentence.length + 220);
  return /\\cite[a-zA-Z*]*\s*(?:\[[^\]]*])*\s*\{[^}]+}/.test(source.slice(windowStart, windowEnd));
}

function itemStatus(blocker: boolean, warning: boolean): ResearchQualityStatus {
  if (blocker) {
    return "fail";
  }
  return warning ? "warn" : "pass";
}

function counts(items: ResearchAuditItem[]) {
  return {
    blockerCount: items.filter((item) => item.status === "fail").length,
    warningCount: items.filter((item) => item.status === "warn").length,
  };
}

export function buildClaimAudit(texSource: string): ResearchClaimAudit {
  const sentences = splitSentences(texSource);
  const risky = sentences
    .map((sentence, index) => {
      const lower = sentence.toLowerCase();
      const hinted = CLAIM_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
      const cited = sentenceHasCitation(texSource, sentence);
      if (!hinted) {
        return null;
      }
      return {
        id: `claim-${index}`,
        status: itemStatus(!cited, false),
        title: sentence.slice(0, 96),
        detail: cited ? "claim.hasCitation" : "claim.missingCitation",
        evidence: cited ? ["nearby-citation"] : ["no-nearby-citation"],
      } satisfies ResearchAuditItem;
    })
    .filter((item): item is ResearchAuditItem => Boolean(item))
    .slice(0, 20);

  if (risky.length === 0) {
    risky.push({
      id: "claim-clean",
      status: "pass",
      title: "claim.noHighRiskClaims",
      detail: "claim.noHighRiskClaimsDetail",
      evidence: ["local-tex"],
    });
  }
  return { items: risky, ...counts(risky) };
}

function hasPattern(source: string, pattern: RegExp): boolean {
  return pattern.test(source);
}

export function buildProfileChecklist(input: {
  profileId?: string | null;
  texSource: string;
  fileList: string[];
  citationTrust: CitationTrustReport;
  submission: SubmissionCheckReport;
}): ResearchProfileChecklist {
  const profileId = normalizeProfileId(input.profileId);
  const lowerFiles = input.fileList.map((path) => path.toLowerCase());
  const hasBbl = lowerFiles.some((path) => path.endsWith(".bbl"));
  const items: ResearchAuditItem[] = [
    {
      id: "profile-document",
      status: itemStatus(input.submission.errorCount > 0, input.submission.warningCount > 0),
      title: "profile.documentStructure",
      detail: "profile.documentStructureDetail",
      evidence: ["submission-check"],
    },
    {
      id: "profile-citations",
      status: itemStatus(input.citationTrust.missingKeys.length > 0, input.citationTrust.weakKeys.length > 0),
      title: "profile.citationEvidence",
      detail: "profile.citationEvidenceDetail",
      evidence: ["bib", "tex"],
    },
  ];

  if (profileId === "arxiv") {
    items.push({
      id: "profile-arxiv-bbl",
      status: hasBbl ? "pass" : "warn",
      title: "profile.arxivBbl",
      detail: "profile.arxivBblDetail",
      evidence: hasBbl ? ["bbl-found"] : ["bbl-missing"],
    });
  }
  if (profileId === "conference" || profileId === "journal" || profileId === "ieee-like") {
    items.push({
      id: "profile-abstract",
      status: hasPattern(input.texSource, /\\begin\{abstract\}[\s\S]+?\\end\{abstract\}/) ? "pass" : "warn",
      title: "profile.abstract",
      detail: "profile.abstractDetail",
      evidence: ["tex"],
    });
  }
  if (profileId === "ieee-like") {
    items.push({
      id: "profile-ieee-class",
      status: hasPattern(input.texSource, /\\documentclass(?:\[[^\]]*])?\{IEEEtran\}/i) ? "pass" : "warn",
      title: "profile.ieeeClass",
      detail: "profile.ieeeClassDetail",
      evidence: ["documentclass"],
    });
  }
  return { profileId, items, ...counts(items) };
}

export function buildReviewerRisk(input: {
  texSource: string;
  claimAudit: ResearchClaimAudit;
  citationTrust: CitationTrustReport;
  compileDiagnostics: string[];
  profileChecklist: ResearchProfileChecklist;
}): ResearchReviewerRisk {
  const todoCount = (input.texSource.match(/\b(?:TODO|FIXME|TBD)\b/gi) ?? []).length;
  const items: ResearchAuditItem[] = [
    {
      id: "risk-claims",
      status: itemStatus(input.claimAudit.blockerCount > 0, input.claimAudit.warningCount > 0),
      title: "risk.claims",
      detail: "risk.claimsDetail",
      evidence: [`claims:${input.claimAudit.blockerCount}`],
    },
    {
      id: "risk-citations",
      status: itemStatus(input.citationTrust.missingKeys.length > 0, input.citationTrust.weakKeys.length > 0),
      title: "risk.citations",
      detail: "risk.citationsDetail",
      evidence: [`missing:${input.citationTrust.missingKeys.length}`, `weak:${input.citationTrust.weakKeys.length}`],
    },
    {
      id: "risk-compile",
      status: itemStatus(input.compileDiagnostics.length > 0, false),
      title: "risk.compile",
      detail: "risk.compileDetail",
      evidence: [`diagnostics:${input.compileDiagnostics.length}`],
    },
    {
      id: "risk-todos",
      status: todoCount > 0 ? "warn" : "pass",
      title: "risk.todos",
      detail: "risk.todosDetail",
      evidence: [`todo:${todoCount}`],
    },
    {
      id: "risk-profile",
      status: itemStatus(input.profileChecklist.blockerCount > 0, input.profileChecklist.warningCount > 0),
      title: "risk.profile",
      detail: "risk.profileDetail",
      evidence: [input.profileChecklist.profileId],
    },
  ];
  return { items, ...counts(items) };
}

export function buildRebuttalEvidence(input: {
  citationTrust: CitationTrustReport;
  claimAudit: ResearchClaimAudit;
}): ResearchRebuttalEvidence {
  const items: ResearchAuditItem[] = [
    {
      id: "rebuttal-citations",
      status: input.citationTrust.items.length > 0 ? "pass" : "warn",
      title: "rebuttal.citations",
      detail: "rebuttal.citationsDetail",
      evidence: [`citations:${input.citationTrust.items.length}`],
    },
    {
      id: "rebuttal-claims",
      status: input.claimAudit.items.some((item) => item.status !== "pass") ? "warn" : "pass",
      title: "rebuttal.claims",
      detail: "rebuttal.claimsDetail",
      evidence: [`claims:${input.claimAudit.items.length}`],
    },
  ];
  return {
    items,
    warningCount: items.filter((item) => item.status === "warn").length,
  };
}

export function buildAuditSummary(input: {
  profileChecklist: ResearchProfileChecklist;
  claimAudit: ResearchClaimAudit;
  citationTrust: CitationTrustReport;
  reviewerRisk: ResearchReviewerRisk;
  rebuttalEvidence: ResearchRebuttalEvidence;
}): ResearchAuditSummary {
  return {
    profileId: input.profileChecklist.profileId,
    localEvidenceCount: input.citationTrust.items.reduce((sum, item) => sum + item.evidence.length, 0),
    claimBlockers: input.claimAudit.blockerCount,
    profileBlockers: input.profileChecklist.blockerCount,
    reviewerRisks: input.reviewerRisk.blockerCount + input.reviewerRisk.warningCount,
    rebuttalEvidenceCount: input.rebuttalEvidence.items.length,
  };
}

export function buildResearchAuditMarkdown(input: {
  report: {
    auditSummary: ResearchAuditSummary;
    claimAudit: ResearchClaimAudit;
    profileChecklist: ResearchProfileChecklist;
    reviewerRisk: ResearchReviewerRisk;
    rebuttalEvidence: ResearchRebuttalEvidence;
  };
  selectedFile: string | null;
}, t: ResearchAuditMarkdownTranslator): string {
  const statusLabel = (status: ResearchQualityStatus) => t(`research.quality.status.${status}`);
  const auditLabel = (value: string) => (
    /^(claim|profile|risk|rebuttal)\./.test(value)
      ? t(`research.quality.audit.${value}`)
      : value
  );
  const itemLine = (item: ResearchAuditItem) => (
    `- [${statusLabel(item.status)}] ${auditLabel(item.title)} (${item.evidence.join(", ")})`
  );
  const lines = [
    `# ${t("research.audit.reportTitle")}`,
    "",
    `- ${t("research.audit.reportSource")}: ${input.selectedFile ?? "-"}`,
    `- ${t("research.audit.reportProfile")}: ${input.report.auditSummary.profileId}`,
    `- ${t("research.audit.reportLocalEvidence")}: ${input.report.auditSummary.localEvidenceCount}`,
    `- ${t("research.audit.reportClaimBlockers")}: ${input.report.auditSummary.claimBlockers}`,
    `- ${t("research.audit.reportReviewerRisks")}: ${input.report.auditSummary.reviewerRisks}`,
    "",
    `## ${t("research.quality.detail.title.claims")}`,
    ...input.report.claimAudit.items.map(itemLine),
    "",
    `## ${t("research.quality.detail.title.profile")}`,
    ...input.report.profileChecklist.items.map(itemLine),
    "",
    `## ${t("research.quality.detail.reviewerRisk")}`,
    ...input.report.reviewerRisk.items.map(itemLine),
    "",
    `## ${t("research.quality.detail.title.rebuttal")}`,
    ...input.report.rebuttalEvidence.items.map(itemLine),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
