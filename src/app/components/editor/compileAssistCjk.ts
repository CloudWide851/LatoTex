
type TranslationFn = (key: any) => string;

export type CompileAssistCjkIssue =
  | { kind: "source-missing-cjk" }
  | { kind: "diagnostic-missing-cjk"; line: string };

const HAN_CHAR_RE = /\p{Script=Han}/u;
const COMMENT_LINE_RE = /(^|[^\\])%.*$/gm;
const CJK_PACKAGE_RE =
  /\\documentclass(?:\s*\[[^\]]*])?\s*\{(?:ctexart|ctexbook|ctexrep|ctexbeamer)\}|\\usepackage(?:\s*\[[^\]]*])?\s*\{(?:[^}]*,)?(?:ctex|xeCJK|CJKutf8)(?:,[^}]*)?\}|\\(?:setCJK(?:main|sans|mono)font|setCJKfamilyfont|newCJKfontfamily)\b/i;
const MISSING_CJK_DIAGNOSTIC_RE =
  /missing character: there is no .*?\(u\+[0-9a-f]{4,6}\).*?(?:lmroman|latin modern)|you may need to load the 'fontspec' package and use/i;

export const CJK_AUTO_FIX_BLOCK = [
  "% LatoTex auto-fix: Chinese support for Tectonic/XeLaTeX",
  "\\usepackage{xeCJK}",
  "\\setCJKmainfont{FandolSong-Regular}[Extension=.otf,BoldFont=FandolSong-Bold,ItalicFont=FandolKai-Regular]",
  "\\setCJKsansfont{FandolHei-Regular}[Extension=.otf,BoldFont=FandolHei-Bold]",
  "\\setCJKmonofont{FandolFang-Regular}[Extension=.otf]",
].join("\n");

function stripLatexComments(source: string): string {
  return String(source || "").replace(COMMENT_LINE_RE, "$1");
}

export function sourceContainsChineseText(source: string): boolean {
  return HAN_CHAR_RE.test(stripLatexComments(source));
}

export function sourceHasExplicitCjkSupport(source: string): boolean {
  return CJK_PACKAGE_RE.test(stripLatexComments(source));
}

export function detectMissingCjkDiagnostics(diagnostics: string[]): string | null {
  for (const raw of diagnostics) {
    const line = String(raw || "").trim();
    if (line && MISSING_CJK_DIAGNOSTIC_RE.test(line)) {
      return line;
    }
  }
  return null;
}

export function detectCompileAssistCjkIssue(params: {
  source?: string | null;
  diagnostics?: string[] | null;
}): CompileAssistCjkIssue | null {
  const source = String(params.source || "");
  if (!sourceContainsChineseText(source) || sourceHasExplicitCjkSupport(source)) {
    return null;
  }
  const diagnosticLine = detectMissingCjkDiagnostics(params.diagnostics ?? []);
  if (diagnosticLine) {
    return {
      kind: "diagnostic-missing-cjk",
      line: diagnosticLine,
    };
  }
  return { kind: "source-missing-cjk" };
}

export function buildCompileAssistCjkDiagnostics(
  t: TranslationFn,
  issue: CompileAssistCjkIssue,
): string[] {
  if (issue.kind === "diagnostic-missing-cjk") {
    return [issue.line, t("workspace.compileAssist.cjkMissingGlyphDiagnostic")];
  }
  return [t("workspace.compileAssist.cjkDetectedDiagnostic")];
}

function normalizeLineEnding(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

export function applyCjkAutoFixToSource(source: string): {
  changed: boolean;
  patchedSource: string;
} {
  if (!sourceContainsChineseText(source) || sourceHasExplicitCjkSupport(source)) {
    return { changed: false, patchedSource: source };
  }
  if (source.includes(CJK_AUTO_FIX_BLOCK)) {
    return { changed: false, patchedSource: source };
  }

  const newline = normalizeLineEnding(source);
  const block = CJK_AUTO_FIX_BLOCK.replace(/\n/g, newline);
  const docClassMatch = source.match(/\\documentclass(?:\s*\[[^\]]*])?\s*\{[^}]+\}/m);
  const beginDocumentMatch = source.match(/\\begin\{document\}/m);

  if (!docClassMatch || typeof docClassMatch.index !== "number") {
    return { changed: false, patchedSource: source };
  }

  const docClassEnd = docClassMatch.index + docClassMatch[0].length;
  const beginDocumentIndex = typeof beginDocumentMatch?.index === "number" ? beginDocumentMatch.index : source.length;
  const searchRegion = source.slice(docClassEnd, beginDocumentIndex);
  const usePackageMatch = searchRegion.match(/\\usepackage(?:\s*\[[^\]]*])?\s*\{[^}]+\}/m);
  const insertIndex = typeof usePackageMatch?.index === "number"
    ? docClassEnd + usePackageMatch.index
    : docClassEnd;

  const before = source.slice(0, insertIndex).replace(/[ \t]*$/, "");
  const after = source.slice(insertIndex).replace(/^\s*/, "");
  const needsLeadingGap = before.endsWith(newline) ? newline : `${newline}${newline}`;
  const needsTrailingGap = after.startsWith(newline) ? newline : `${newline}${newline}`;

  return {
    changed: true,
    patchedSource: `${before}${needsLeadingGap}${block}${needsTrailingGap}${after}`,
  };
}

