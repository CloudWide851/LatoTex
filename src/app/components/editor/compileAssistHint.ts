type TranslationFn = (key: any) => string;

const COMBINED_DIAGNOSTIC_SPLIT_RE = /(\.xdv)(No output PDF file written(?:\.[A-Za-z0-9_-]+)?\.?)/gi;
const NOISE_PATTERNS: RegExp[] = [
  /^package progress\b/i,
  /^installing package\b/i,
  /^宏包安装进度\b/i,
  /^正在安装宏包\b/i,
];
const PRIORITY_PATTERNS: RegExp[] = [
  /fontspec\s+error/i,
  /latex\s+error/i,
  /fatal:/i,
  /no output pdf file written/i,
  /could not open specified dvi/i,
  /file [`']([^`']+\.sty)[`'] not found/i,
  /^l\.\d+/i,
];

function splitDiagnosticLines(value: string): string[] {
  const source = String(value || "");
  if (!source.trim()) {
    return [];
  }
  const expanded = source.replace(COMBINED_DIAGNOSTIC_SPLIT_RE, "$1\n$2");
  return expanded
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function prioritizeDiagnostics(diagnostics: string[]): string[] {
  const seen = new Set<string>();
  const meaningful: string[] = [];
  for (const chunk of diagnostics) {
    for (const line of splitDiagnosticLines(chunk)) {
      const key = line.toLowerCase();
      if (seen.has(key) || isNoiseLine(line)) {
        continue;
      }
      seen.add(key);
      meaningful.push(line);
    }
  }
  const priority = meaningful.filter((line) => PRIORITY_PATTERNS.some((pattern) => pattern.test(line)));
  const context = meaningful.filter((line) => !priority.includes(line));
  return [...priority, ...context].slice(0, 6);
}

function detectMissingPackage(diagnostics: string[]): string | null {
  for (const line of diagnostics) {
    const match = line.match(/File [`']([^`']+\.sty)[`'] not found/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function hasFontspecXdvFatalIssue(diagnostics: string[]): boolean {
  const joined = diagnostics.join("\n").toLowerCase();
  return (
    joined.includes("fontspec error")
    && joined.includes("could not open specified dvi")
    && joined.includes("no output pdf file written")
  );
}

export function buildCompileAssistHint(diagnostics: string[], t: TranslationFn): string {
  const lines: string[] = [];
  const normalized = prioritizeDiagnostics(diagnostics);

  lines.push(t("workspace.compileAssist.hintTitle"));
  if (normalized.length > 0) {
    lines.push(...normalized.map((line, index) => `${index + 1}. ${line}`));
  }

  const missingPackage = detectMissingPackage(normalized);
  if (missingPackage && missingPackage.toLowerCase() === "ctex.sty") {
    lines.push("");
    lines.push(t("workspace.compileAssist.hintMissingCtex"));
  } else if (missingPackage) {
    lines.push("");
    lines.push(t("workspace.compileAssist.hintMissingPackage").replace("{package}", missingPackage));
  }

  if (hasFontspecXdvFatalIssue(normalized)) {
    lines.push("");
    lines.push(t("workspace.compileAssist.hintFontspecXdv"));
  }

  lines.push("");
  lines.push(t("workspace.compileAssist.hintGeneric"));
  return lines.join("\n").trim();
}
