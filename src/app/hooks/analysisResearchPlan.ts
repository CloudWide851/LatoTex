import type {
  AcademicEvidence,
  AnalysisResearchPlan,
  AnalysisResearchStage,
  ReferenceCheckResponse,
} from "../../shared/types/app";

const NETWORK_HINTS =
  /\b(literature|citation|cite|paper|papers|prior work|state of the art|benchmark|web search|online evidence|systematic review)\b|文献|引用|论文|先前研究|网络搜索|系统综述/i;
const COMPARISON_HINTS =
  /\b(compare|comparison|related work|external evidence|replicate|reproduce)\b|比较|相关工作|外部证据|复现/i;
const BIOMEDICAL_HINTS =
  /\b(patient|population|intervention|clinical|disease|therapy|diagnosis|outcome)\b|患者|人群|干预|临床|疾病|治疗|诊断|结局/i;
const METHOD_HINTS =
  /\b(regression|anova|mann[- ]whitney|t[- ]test|bootstrap|bayesian|meta[- ]analysis|random forest|neural network)\b/gi;

function compact(value: string, limit = 180): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function pushUnique(target: string[], value: string) {
  const normalized = compact(value);
  if (normalized && !target.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    target.push(normalized);
  }
}

function identifierQueries(prompt: string): string[] {
  const values: string[] = [];
  for (const match of prompt.matchAll(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi)) {
    pushUnique(values, match[0]);
  }
  for (const match of prompt.matchAll(/\b(?:arXiv:\s*)?\d{4}\.\d{4,5}(?:v\d+)?\b/gi)) {
    pushUnique(values, match[0].replace(/^arXiv:\s*/i, ""));
  }
  return values;
}

function yearRange(prompt: string): string {
  const years = Array.from(prompt.matchAll(/\b(?:19|20)\d{2}\b/g))
    .map((match) => Number(match[0]))
    .filter(Number.isFinite);
  if (years.length === 0) {
    return "";
  }
  const minimum = Math.min(...years);
  const maximum = Math.max(...years);
  return minimum === maximum ? String(minimum) : `${minimum}-${maximum}`;
}

export function buildAnalysisResearchPlan(input: {
  prompt: string;
  sourceType: "data" | "paper";
  inputFiles: string[];
}): AnalysisResearchPlan {
  const intent = compact(input.prompt, 1_200);
  const explicitNetwork = NETWORK_HINTS.test(intent);
  const comparison = COMPARISON_HINTS.test(intent);
  const networkRequirement = explicitNetwork
    ? "required"
    : input.sourceType === "paper" && comparison
      ? "optional"
      : "not_needed";
  const queries = identifierQueries(intent);
  pushUnique(queries, intent);
  const methods = Array.from(intent.matchAll(METHOD_HINTS)).map((match) => match[0]);
  for (const method of methods.slice(0, 2)) {
    pushUnique(queries, `${intent} ${method}`);
  }
  const range = yearRange(intent);
  if (range) {
    pushUnique(queries, `${intent} ${range}`);
  }
  if (BIOMEDICAL_HINTS.test(intent)) {
    pushUnique(queries, `PICO ${intent}`);
  }

  return {
    intent,
    queries: queries.slice(0, 8),
    inclusionCriteria: [
      "identifier-or-topic-match",
      "traceable-provider-provenance",
      ...(range ? [`publication-year:${range}`] : []),
    ],
    exclusionCriteria: ["missing-title", "untraceable-model-claim"],
    dataChecks: input.inputFiles.length > 0
      ? ["schema", "missingness", "duplicates", "distribution", "outliers"]
      : ["source-availability", "evidence-level"],
    expectedValidations: [
      "effect-size-or-descriptive-limit",
      "confidence-interval-when-applicable",
      "claim-evidence-separation",
      "review-quality-gate",
    ],
    networkRequirement,
    networkReasonCode: networkRequirement === "required"
      ? "explicit_research_evidence"
      : networkRequirement === "optional"
        ? "paper_comparison"
        : "local_data_sufficient",
  };
}

export function initialResearchStages(plan: AnalysisResearchPlan): AnalysisResearchStage[] {
  return [
    { id: "plan", status: "completed", detailCode: "validated" },
    {
      id: "evidence",
      status: plan.networkRequirement === "not_needed" ? "skipped" : "pending",
      detailCode: plan.networkReasonCode,
    },
    { id: "analysis", status: "pending" },
    { id: "review", status: "pending" },
    { id: "conclusion", status: "pending" },
  ];
}

export function updateResearchStage(
  stages: AnalysisResearchStage[],
  id: AnalysisResearchStage["id"],
  status: AnalysisResearchStage["status"],
  detailCode?: string,
): AnalysisResearchStage[] {
  return stages.map((stage) => stage.id === id ? { ...stage, status, detailCode } : stage);
}

function evidenceLabel(item: AcademicEvidence): string {
  if (item.evidenceLevel === "fulltext") {
    return "confirmed_fulltext";
  }
  if (item.evidenceLevel === "abstract") {
    return "abstract_support";
  }
  return "metadata_support";
}

export function buildResearchEvidenceContext(response: ReferenceCheckResponse): string {
  const lines = [
    "[research_evidence.v2]",
    "Claim labels: confirmed_fulltext, abstract_support, metadata_support, inference, uncertainty.",
    "General-web evidence is contextual only and must not dilute academic ranking.",
  ];
  for (const item of response.items) {
    for (const evidence of item.academicResults.slice(0, 6)) {
      lines.push(
        `- [academic; ${evidenceLabel(evidence)}; providers=${evidence.provenance.join(",")}] `
        + `${compact(evidence.title, 140)} (${compact(evidence.landingUrl, 180)})`,
      );
    }
    for (const evidence of item.webResults.slice(0, 3)) {
      lines.push(
        `- [general_web; provider=${evidence.source}; contextual_only] `
        + `${compact(evidence.title, 140)} (${compact(evidence.landingUrl, 180)})`,
      );
    }
  }
  return lines.join("\n");
}

function bibValue(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function buildEvidenceBibtex(evidence: AcademicEvidence[]): string {
  return evidence
    .filter((item) => item.title.trim())
    .map((item, index) => {
      const authorParts = item.authors[0]?.split(/\s+/) ?? [];
      const firstAuthor = authorParts[authorParts.length - 1] ?? "source";
      const key = `${firstAuthor}${item.year ?? "nd"}${index + 1}`
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 48) || `source${index + 1}`;
      const fields = [
        `  title = {${bibValue(item.title)}}`,
        ...(item.authors.length > 0 ? [`  author = {${bibValue(item.authors.join(" and "))}}`] : []),
        ...(item.year ? [`  year = {${item.year}}`] : []),
        ...(item.venue ? [`  journal = {${bibValue(item.venue)}}`] : []),
        ...(item.doi ? [`  doi = {${bibValue(item.doi)}}`] : []),
        `  url = {${bibValue(item.landingUrl)}}`,
        `  note = {Evidence level: ${item.evidenceLevel}; providers: ${item.provenance.join(", ")}}`,
      ];
      return `@article{${key},\n${fields.join(",\n")}\n}`;
    })
    .join("\n\n");
}

export function textToDataUrl(value: string, mime = "text/plain;charset=utf-8"): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function collectResearchEvidence(response: ReferenceCheckResponse): {
  academic: AcademicEvidence[];
  web: AcademicEvidence[];
} {
  const academic = response.items.flatMap((item) => item.academicResults);
  const web = response.items.flatMap((item) => item.webResults);
  return {
    academic: Array.from(new Map(academic.map((item) => [item.stableId, item])).values()).slice(0, 32),
    web: Array.from(new Map(web.map((item) => [item.landingUrl, item])).values()).slice(0, 16),
  };
}
