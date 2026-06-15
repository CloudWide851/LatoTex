import { useEffect, useMemo, useState } from "react";
import { readFile } from "../../shared/api/workspace";
import {
  buildSubmissionCheckReport,
  type SubmissionCheckReport,
} from "./researchSubmissionCheck";
import {
  buildAuditSummary,
  buildClaimAudit,
  buildProfileChecklist,
  buildRebuttalEvidence,
  buildReviewerRisk,
  type ResearchAuditSummary,
  type ResearchClaimAudit,
  type ResearchProfileChecklist,
  type ResearchRebuttalEvidence,
  type ResearchReviewerRisk,
} from "./researchQualityAudit";
import type { ResearchWorkflowProfileId } from "./researchProfiles";

export type ResearchQualityStatus = "pass" | "warn" | "fail";
export type ResearchQualityLaneId = "claims" | "citations" | "compile" | "submission" | "profile" | "rebuttal";

export type ResearchQualityMessage = {
  key: string;
  params?: Record<string, string | number>;
};

export type ResearchQualityLane = {
  id: ResearchQualityLaneId;
  status: ResearchQualityStatus;
  message: ResearchQualityMessage;
};

export type CitationTrustItem = {
  key: string;
  status: ResearchQualityStatus;
  evidence: string[];
  sourcePath?: string;
};

export type CitationTrustReport = {
  items: CitationTrustItem[];
  missingKeys: string[];
  weakKeys: string[];
  duplicateKeys: string[];
  unreadableBibPaths: string[];
};

export type ResearchQualityReadiness = {
  score: number;
  blockers: number;
  warnings: number;
  passedLanes: number;
  totalLanes: number;
};

export type ResearchQualityReport = {
  citationTrust: CitationTrustReport;
  submission: SubmissionCheckReport;
  claimAudit: ResearchClaimAudit;
  profileChecklist: ResearchProfileChecklist;
  reviewerRisk: ResearchReviewerRisk;
  rebuttalEvidence: ResearchRebuttalEvidence;
  auditSummary: ResearchAuditSummary;
  lanes: ResearchQualityLane[];
  readiness: ResearchQualityReadiness;
};

type BibEntry = {
  citationKey: string;
  title: string;
  author: string;
  year: string;
  doi: string;
  arxiv: string;
  url: string;
  sourcePath: string;
};

const REPORT_CACHE_LIMIT = 24;
const reportCache = new Map<string, ResearchQualityReport>();

function stableRecordEntries(record: Record<string, string> | undefined): [string, string][] {
  return Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function stableArray(values: string[] | undefined): string[] {
  return [...(values ?? [])].sort();
}

function buildReportCacheKey(input: {
  texSource: string;
  fileList: string[];
  compileDiagnostics: string[];
  bibSources?: Record<string, string>;
  unreadableBibPaths?: string[];
  selectedFile?: string | null;
  profileId?: ResearchWorkflowProfileId;
}): string {
  return JSON.stringify({
    selectedFile: input.selectedFile ?? "",
    profileId: input.profileId ?? "generic",
    texSource: input.texSource,
    fileList: stableArray(input.fileList),
    compileDiagnostics: input.compileDiagnostics,
    bibSources: stableRecordEntries(input.bibSources),
    unreadableBibPaths: stableArray(input.unreadableBibPaths),
  });
}

function cacheReport(key: string, report: ResearchQualityReport): ResearchQualityReport {
  if (reportCache.has(key)) {
    reportCache.delete(key);
  }
  reportCache.set(key, report);
  while (reportCache.size > REPORT_CACHE_LIMIT) {
    const oldest = reportCache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    reportCache.delete(oldest);
  }
  return report;
}

export function clearResearchQualityReportCacheForTests() {
  reportCache.clear();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").trim().split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function dirname(path: string | null): string {
  const normalized = normalizePath(path ?? "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function resolveRelativePath(baseDir: string, value: string): string {
  const clean = value.replace(/\\/g, "/").replace(/^['"]|['"]$/g, "").trim();
  const withExt = /\.bib$/i.test(clean) ? clean : `${clean}.bib`;
  if (!baseDir || withExt.startsWith(".latotex/")) {
    return normalizePath(withExt);
  }
  return normalizePath(`${baseDir}/${withExt}`);
}

function findKnownPath(candidate: string, fileList: string[]): string {
  const normalized = normalizePath(candidate);
  const lower = normalized.toLowerCase();
  return fileList.find((path) => normalizePath(path).toLowerCase() === lower) ?? normalized;
}

export function extractDeclaredBibPaths(
  texSource: string,
  selectedFile: string | null,
  fileList: string[],
): string[] {
  const baseDir = dirname(selectedFile);
  const candidates: string[] = [];
  for (const match of texSource.matchAll(/\\bibliography\s*\{([^}]+)\}/g)) {
    for (const item of String(match[1] ?? "").split(",")) {
      candidates.push(resolveRelativePath(baseDir, item));
    }
  }
  for (const match of texSource.matchAll(/\\addbibresource(?:\[[^\]]*])?\s*\{([^}]+)\}/g)) {
    candidates.push(resolveRelativePath(baseDir, String(match[1] ?? "")));
  }
  const declared = unique(candidates.map((item) => findKnownPath(item, fileList)));
  if (declared.length > 0) {
    return declared.slice(0, 20);
  }
  return fileList
    .map(normalizePath)
    .filter((path) => /\.bib$/i.test(path))
    .slice(0, 20);
}

export function extractCitationOccurrences(source: string): string[] {
  const values: string[] = [];
  for (const match of source.matchAll(/\\cite[a-zA-Z*]*\s*(?:\[[^\]]*])*\s*\{([^}]+)\}/g)) {
    values.push(
      ...String(match[1] ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }
  return values;
}

function readBibField(body: string, name: string): string {
  const match = body.match(new RegExp(`${name}\\s*=\\s*(?:\\{([^}]*)\\}|"([^"]*)"|'([^']*)'|([^,\\n]+))`, "i"));
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim();
}

function parseBibEntries(bibSources: Record<string, string>): BibEntry[] {
  const entries: BibEntry[] = [];
  for (const [sourcePath, source] of Object.entries(bibSources)) {
    for (const match of source.matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n\s*@\w+\s*\{|$)/g)) {
      const body = String(match[3] ?? "");
      entries.push({
        citationKey: String(match[2] ?? "").trim(),
        title: readBibField(body, "title"),
        author: readBibField(body, "author"),
        year: readBibField(body, "year"),
        doi: readBibField(body, "doi"),
        arxiv: readBibField(body, "arxiv") || readBibField(body, "eprint"),
        url: readBibField(body, "url"),
        sourcePath,
      });
    }
  }
  return entries.filter((entry) => entry.citationKey.length > 0);
}

function evidenceForEntry(entry: BibEntry): string[] {
  const evidence = ["library"];
  if (entry.doi) {
    evidence.push("doi");
  }
  if (entry.arxiv) {
    evidence.push("arxiv");
  }
  if (entry.title) {
    evidence.push("title");
  }
  if (entry.url) {
    evidence.push("url");
  }
  if (entry.author && entry.year) {
    evidence.push("author-year");
  }
  return evidence;
}

export function buildCitationTrustReport(input: {
  texSource: string;
  bibSources: Record<string, string>;
  unreadableBibPaths?: string[];
}): CitationTrustReport {
  const occurrences = extractCitationOccurrences(input.texSource);
  const citationKeys = unique(occurrences);
  const duplicateKeys = unique(occurrences.filter((key, index) => occurrences.indexOf(key) !== index));
  const entryByKey = new Map(parseBibEntries(input.bibSources).map((entry) => [entry.citationKey, entry]));
  const items = citationKeys.map((key) => {
    const entry = entryByKey.get(key);
    if (!entry) {
      return { key, status: "fail" as const, evidence: [] };
    }
    const evidence = evidenceForEntry(entry);
    const strong = evidence.some((item) => item !== "library");
    return {
      key,
      status: strong ? "pass" as const : "warn" as const,
      evidence,
      sourcePath: entry.sourcePath,
    };
  });
  return {
    items,
    missingKeys: items.filter((item) => item.status === "fail").map((item) => item.key),
    weakKeys: items.filter((item) => item.status === "warn").map((item) => item.key),
    duplicateKeys,
    unreadableBibPaths: input.unreadableBibPaths ?? [],
  };
}

function compactDetail(values: string[]): string {
  return values.slice(0, 3).join(", ");
}

function buildCitationLane(report: CitationTrustReport): ResearchQualityLane {
  const count = report.items.length;
  if (report.unreadableBibPaths.length > 0) {
    return {
      id: "citations",
      status: "fail",
      message: {
        key: "research.quality.citations.unreadable",
        params: { detail: compactDetail(report.unreadableBibPaths) },
      },
    };
  }
  if (count === 0) {
    return { id: "citations", status: "warn", message: { key: "research.quality.citations.none" } };
  }
  if (report.missingKeys.length > 0) {
    return {
      id: "citations",
      status: "fail",
      message: {
        key: "research.quality.citations.fail",
        params: { count: report.missingKeys.length, detail: compactDetail(report.missingKeys) },
      },
    };
  }
  if (report.weakKeys.length > 0 || report.duplicateKeys.length > 0) {
    const detail = compactDetail([...report.weakKeys, ...report.duplicateKeys]);
    return {
      id: "citations",
      status: "warn",
      message: { key: "research.quality.citations.warn", params: { count: report.weakKeys.length + report.duplicateKeys.length, detail } },
    };
  }
  return {
    id: "citations",
    status: "pass",
    message: { key: "research.quality.citations.pass", params: { count } },
  };
}

function buildReadiness(input: {
  citationTrust: CitationTrustReport;
  submission: SubmissionCheckReport;
  claimAudit: ResearchClaimAudit;
  profileChecklist: ResearchProfileChecklist;
  lanes: ResearchQualityLane[];
  compileDiagnostics: string[];
}): ResearchQualityReadiness {
  const noCitations = input.citationTrust.items.length === 0 ? 1 : 0;
  const rebuttalWarnings = input.lanes.some((lane) => lane.id === "rebuttal" && lane.status === "warn") ? 1 : 0;
  const submissionBlockers = input.submission.issues
    .filter((issue) => issue.severity === "error" && issue.id !== "compileDiagnostics")
    .length;
  const blockers =
    input.citationTrust.missingKeys.length +
    input.citationTrust.unreadableBibPaths.length +
    input.claimAudit.blockerCount +
    input.profileChecklist.blockerCount +
    input.compileDiagnostics.length +
    submissionBlockers;
  const warnings =
    input.citationTrust.weakKeys.length +
    input.citationTrust.duplicateKeys.length +
    input.claimAudit.warningCount +
    input.profileChecklist.warningCount +
    input.submission.warningCount +
    noCitations +
    rebuttalWarnings;
  return {
    score: Math.max(0, Math.min(100, 100 - blockers * 18 - warnings * 7)),
    blockers,
    warnings,
    passedLanes: input.lanes.filter((lane) => lane.status === "pass").length,
    totalLanes: input.lanes.length,
  };
}

export function buildResearchQualityReport(input: {
  texSource: string;
  fileList: string[];
  compileDiagnostics: string[];
  bibSources?: Record<string, string>;
  unreadableBibPaths?: string[];
  selectedFile?: string | null;
  profileId?: ResearchWorkflowProfileId;
}): ResearchQualityReport {
  const cacheKey = buildReportCacheKey(input);
  const cached = reportCache.get(cacheKey);
  if (cached) {
    reportCache.delete(cacheKey);
    reportCache.set(cacheKey, cached);
    return cached;
  }
  const citationTrust = buildCitationTrustReport({
    texSource: input.texSource,
    bibSources: input.bibSources ?? {},
    unreadableBibPaths: input.unreadableBibPaths,
  });
  const submission = buildSubmissionCheckReport({
    texSource: input.texSource,
    fileList: input.fileList,
    compileDiagnostics: input.compileDiagnostics,
    bibSources: input.bibSources,
  });
  const claimAudit = buildClaimAudit(input.texSource);
  const profileChecklist = buildProfileChecklist({
    profileId: input.profileId,
    texSource: input.texSource,
    fileList: input.fileList,
    citationTrust,
    submission,
  });
  const reviewerRisk = buildReviewerRisk({
    texSource: input.texSource,
    claimAudit,
    citationTrust,
    compileDiagnostics: input.compileDiagnostics,
    profileChecklist,
  });
  const rebuttalEvidence = buildRebuttalEvidence({ citationTrust, claimAudit });
  const auditSummary = buildAuditSummary({
    profileChecklist,
    claimAudit,
    citationTrust,
    reviewerRisk,
    rebuttalEvidence,
  });
  const compileCount = input.compileDiagnostics.length;
  const canRebut = Boolean(input.selectedFile && /\.tex$/i.test(input.selectedFile));
  const lanes: ResearchQualityLane[] = [
    {
      id: "claims",
      status: claimAudit.blockerCount > 0 ? "fail" : claimAudit.warningCount > 0 ? "warn" : "pass",
      message: claimAudit.blockerCount > 0
        ? { key: "research.quality.claims.fail", params: { count: claimAudit.blockerCount } }
        : claimAudit.warningCount > 0
          ? { key: "research.quality.claims.warn", params: { count: claimAudit.warningCount } }
          : { key: "research.quality.claims.pass" },
    },
    buildCitationLane(citationTrust),
    {
      id: "compile",
      status: compileCount > 0 ? "fail" : "pass",
      message: compileCount > 0
        ? { key: "research.quality.compile.fail", params: { count: compileCount } }
        : { key: "research.quality.compile.pass" },
    },
    {
      id: "submission",
      status: submission.errorCount > 0 ? "fail" : submission.warningCount > 0 ? "warn" : "pass",
      message: submission.errorCount > 0
        ? { key: "research.quality.submission.fail", params: { count: submission.errorCount } }
        : submission.warningCount > 0
          ? { key: "research.quality.submission.warn", params: { count: submission.warningCount } }
          : { key: "research.quality.submission.pass" },
    },
    {
      id: "profile",
      status: profileChecklist.blockerCount > 0 ? "fail" : profileChecklist.warningCount > 0 ? "warn" : "pass",
      message: profileChecklist.blockerCount > 0
        ? { key: "research.quality.profile.fail", params: { count: profileChecklist.blockerCount } }
        : profileChecklist.warningCount > 0
          ? { key: "research.quality.profile.warn", params: { count: profileChecklist.warningCount, profile: profileChecklist.profileId } }
          : { key: "research.quality.profile.pass", params: { profile: profileChecklist.profileId } },
    },
    {
      id: "rebuttal",
      status: canRebut ? "pass" : "warn",
      message: { key: canRebut ? "research.quality.rebuttal.pass" : "research.quality.rebuttal.warn" },
    },
  ];
  const report = {
    citationTrust,
    submission,
    claimAudit,
    profileChecklist,
    reviewerRisk,
    rebuttalEvidence,
    auditSummary,
    lanes,
    readiness: buildReadiness({
      citationTrust,
      submission,
      claimAudit,
      profileChecklist,
      lanes,
      compileDiagnostics: input.compileDiagnostics,
    }),
  };
  return cacheReport(cacheKey, report);
}

function parseBibPathsKey(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function useResearchQualityGate(input: {
  projectId: string | null;
  selectedFile: string | null;
  texSource: string;
  fileList: string[];
  compileDiagnostics: string[];
  profileId?: ResearchWorkflowProfileId;
}) {
  const bibPaths = useMemo(
    () => extractDeclaredBibPaths(input.texSource, input.selectedFile, input.fileList),
    [input.fileList, input.selectedFile, input.texSource],
  );
  const bibPathsKey = useMemo(() => JSON.stringify(bibPaths), [bibPaths]);
  const [bibState, setBibState] = useState<{ sources: Record<string, string>; errors: string[]; loading: boolean }>({
    sources: {},
    errors: [],
    loading: false,
  });

  useEffect(() => {
    const paths = parseBibPathsKey(bibPathsKey);
    if (!input.projectId || paths.length === 0) {
      setBibState({ sources: {}, errors: [], loading: false });
      return;
    }
    let cancelled = false;
    setBibState((prev) => ({ ...prev, loading: true }));
    void Promise.all(
      paths.map(async (path) => {
        try {
          const response = await readFile(input.projectId as string, path);
          return { path, content: response.content ?? "", error: false };
        } catch {
          return { path, content: "", error: true };
        }
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const sources: Record<string, string> = {};
      const errors: string[] = [];
      for (const result of results) {
        if (result.error) {
          errors.push(result.path);
        } else {
          sources[result.path] = result.content;
        }
      }
      setBibState({ sources, errors, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [bibPathsKey, input.projectId]);

  const report = useMemo(
    () => buildResearchQualityReport({
      texSource: input.texSource,
      fileList: input.fileList,
      compileDiagnostics: input.compileDiagnostics,
      bibSources: bibState.sources,
      unreadableBibPaths: bibState.errors,
      selectedFile: input.selectedFile,
      profileId: input.profileId,
    }),
    [bibState.errors, bibState.sources, input.compileDiagnostics, input.fileList, input.profileId, input.selectedFile, input.texSource],
  );

  return { report, loading: bibState.loading };
}
