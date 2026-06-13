import { useEffect, useMemo, useState } from "react";
import { readFile } from "../../shared/api/workspace";
import {
  buildSubmissionCheckReport,
  type SubmissionCheckReport,
} from "./researchSubmissionCheck";

export type ResearchQualityStatus = "pass" | "warn" | "fail";
export type ResearchQualityLaneId = "citations" | "compile" | "submission" | "rebuttal";

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
    input.compileDiagnostics.length +
    submissionBlockers;
  const warnings =
    input.citationTrust.weakKeys.length +
    input.citationTrust.duplicateKeys.length +
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
}): ResearchQualityReport {
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
  const compileCount = input.compileDiagnostics.length;
  const canRebut = Boolean(input.selectedFile && /\.tex$/i.test(input.selectedFile));
  const lanes: ResearchQualityLane[] = [
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
      id: "rebuttal",
      status: canRebut ? "pass" : "warn",
      message: { key: canRebut ? "research.quality.rebuttal.pass" : "research.quality.rebuttal.warn" },
    },
  ];
  return {
    citationTrust,
    submission,
    lanes,
    readiness: buildReadiness({
      citationTrust,
      submission,
      lanes,
      compileDiagnostics: input.compileDiagnostics,
    }),
  };
}

export function useResearchQualityGate(input: {
  projectId: string | null;
  selectedFile: string | null;
  texSource: string;
  fileList: string[];
  compileDiagnostics: string[];
}) {
  const bibPaths = useMemo(
    () => extractDeclaredBibPaths(input.texSource, input.selectedFile, input.fileList),
    [input.fileList, input.selectedFile, input.texSource],
  );
  const [bibState, setBibState] = useState<{ sources: Record<string, string>; errors: string[]; loading: boolean }>({
    sources: {},
    errors: [],
    loading: false,
  });

  useEffect(() => {
    if (!input.projectId || bibPaths.length === 0) {
      setBibState({ sources: {}, errors: [], loading: false });
      return;
    }
    let cancelled = false;
    setBibState((prev) => ({ ...prev, loading: true }));
    void Promise.all(
      bibPaths.map(async (path) => {
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
  }, [bibPaths, input.projectId]);

  const report = useMemo(
    () => buildResearchQualityReport({
      texSource: input.texSource,
      fileList: input.fileList,
      compileDiagnostics: input.compileDiagnostics,
      bibSources: bibState.sources,
      unreadableBibPaths: bibState.errors,
      selectedFile: input.selectedFile,
    }),
    [bibState.errors, bibState.sources, input.compileDiagnostics, input.fileList, input.selectedFile, input.texSource],
  );

  return { report, loading: bibState.loading };
}
