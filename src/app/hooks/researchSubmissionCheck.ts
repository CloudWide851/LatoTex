export type SubmissionIssueSeverity = "error" | "warning" | "info";

export type SubmissionIssueId =
  | "compileDiagnostics"
  | "missingDocumentEnvironment"
  | "missingBibliography"
  | "undefinedReferences"
  | "duplicateLabels"
  | "missingFigures"
  | "noCitations"
  | "ready";

export type SubmissionIssue = {
  id: SubmissionIssueId;
  severity: SubmissionIssueSeverity;
  count?: number;
  detail?: string;
};

export type SubmissionCheckReport = {
  issues: SubmissionIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
};

function collectRegexValues(source: string, regex: RegExp): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(regex)) {
    const value = String(match[1] ?? "").trim();
    if (value) {
      out.push(value);
    }
  }
  return out;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function extractCitationKeys(source: string): string[] {
  return unique(collectRegexValues(source, /\\cite[a-zA-Z*]*\s*(?:\[[^\]]*])*\s*\{([^}]+)\}/g)
    .flatMap((value) => value.split(",").map((item) => item.trim())));
}

export function extractBibKeys(bibSources: Record<string, string>): string[] {
  return unique(Object.values(bibSources)
    .flatMap((source) => collectRegexValues(source, /@\w+\s*\{\s*([^,\s]+)\s*,/g)));
}

export function buildSubmissionCheckReport(input: {
  texSource: string;
  fileList: string[];
  compileDiagnostics: string[];
  bibSources?: Record<string, string>;
}): SubmissionCheckReport {
  const source = input.texSource || "";
  const normalizedFiles = new Set(input.fileList.map((path) => path.replace(/\\/g, "/").toLowerCase()));
  const labels = collectRegexValues(source, /\\label\{([^}]+)\}/g);
  const refs = unique(collectRegexValues(source, /\\(?:eq)?ref\{([^}]+)\}/g));
  const citations = extractCitationKeys(source);
  const bibKeys = extractBibKeys(input.bibSources ?? {});
  const issues: SubmissionIssue[] = [];

  if (input.compileDiagnostics.length > 0) {
    issues.push({ id: "compileDiagnostics", severity: "error", count: input.compileDiagnostics.length });
  }
  if (!/\\begin\{document\}/.test(source) || !/\\end\{document\}/.test(source)) {
    issues.push({ id: "missingDocumentEnvironment", severity: "error" });
  }

  const bibliographyDeclared = /\\(?:bibliography|addbibresource)\s*\{[^}]+}/.test(source)
    || input.fileList.some((path) => /\.bib$/i.test(path));
  if (citations.length > 0 && !bibliographyDeclared) {
    issues.push({ id: "missingBibliography", severity: "error", count: citations.length });
  }

  const labelSet = new Set(labels);
  const missingRefs = refs.filter((value) => !labelSet.has(value));
  if (missingRefs.length > 0) {
    issues.push({ id: "undefinedReferences", severity: "warning", count: missingRefs.length, detail: missingRefs.slice(0, 3).join(", ") });
  }

  const duplicateLabels = labels.filter((value, index) => labels.indexOf(value) !== index);
  if (duplicateLabels.length > 0) {
    issues.push({ id: "duplicateLabels", severity: "warning", count: unique(duplicateLabels).length });
  }

  const missingFigures = unique(collectRegexValues(source, /\\includegraphics(?:\[[^\]]*])?\{([^}]+)\}/g))
    .filter((value) => {
      const base = value.replace(/\\/g, "/").toLowerCase();
      if (normalizedFiles.has(base)) {
        return false;
      }
      return ![".pdf", ".png", ".jpg", ".jpeg"].some((ext) => normalizedFiles.has(`${base}${ext}`));
    });
  if (missingFigures.length > 0) {
    issues.push({ id: "missingFigures", severity: "warning", count: missingFigures.length, detail: missingFigures.slice(0, 3).join(", ") });
  }

  if (citations.length === 0) {
    issues.push({ id: "noCitations", severity: "info" });
  } else if (bibKeys.length > 0) {
    const missingCites = citations.filter((key) => !bibKeys.includes(key));
    if (missingCites.length > 0) {
      issues.push({ id: "missingBibliography", severity: "warning", count: missingCites.length, detail: missingCites.slice(0, 3).join(", ") });
    }
  }

  if (!issues.some((issue) => issue.severity !== "info")) {
    issues.push({ id: "ready", severity: "info" });
  }

  return {
    issues,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    infoCount: issues.filter((issue) => issue.severity === "info").length,
  };
}
