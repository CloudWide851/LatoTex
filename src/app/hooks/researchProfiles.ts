export const RESEARCH_WORKFLOW_PROFILE_IDS = [
  "generic",
  "arxiv",
  "conference",
  "journal",
  "ieee-like",
  "acm",
  "springer",
  "elsevier",
] as const;

export type ResearchWorkflowProfileId = typeof RESEARCH_WORKFLOW_PROFILE_IDS[number];

export function normalizeResearchWorkflowProfileId(value: string | null | undefined): ResearchWorkflowProfileId {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "ieee" || normalized === "ieee_like") {
    return "ieee-like";
  }
  return RESEARCH_WORKFLOW_PROFILE_IDS.includes(normalized as ResearchWorkflowProfileId)
    ? normalized as ResearchWorkflowProfileId
    : "generic";
}

export function researchProfileLabelKey(profileId: ResearchWorkflowProfileId): string {
  if (profileId === "ieee-like") {
    return "research.profile.ieeeLike";
  }
  return `research.profile.${profileId}`;
}

export function submissionPackProfileLabelKey(profileId: ResearchWorkflowProfileId): string {
  if (profileId === "ieee-like") {
    return "research.submissionPack.profile.ieeeLike";
  }
  return `research.submissionPack.profile.${profileId}`;
}
