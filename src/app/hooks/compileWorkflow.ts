import { recordCompile } from "../../shared/api/desktop";
import { readFile } from "../../shared/api/workspace";
import {
  compileWithNativeLatex,
  compileWithNativeLatexTask,
} from "../../features/latex/compiler/native";
import type { CompileInstallProgress } from "./compileWorkflowShared";

export type { CompileInstallProgress } from "./compileWorkflowShared";

const COMPILE_TEXT_EXTENSIONS = new Set([
  "bbx",
  "bib",
  "bst",
  "cbx",
  "cfg",
  "cls",
  "clo",
  "def",
  "fd",
  "ist",
  "ltx",
  "sty",
  "tex",
]);

const MISSING_STYLE_RE = /File [`']([^`']+\.(sty|cls|cfg|def|fd|tex|lua))[`'] not found/gi;
const PACKAGE_ERROR_RE = /Package\s+([A-Za-z0-9._-]+)\s+Error:/gi;
const FONTSPEC_ERROR_RE = /Package\s+fontspec\s+Error/i;
const FONT_QUOTED_RE = /font\s+["“]([^"”]+)["”]\s+cannot be found/gi;
const FONT_PLAIN_RE = /font\s+([A-Za-z][A-Za-z0-9 _.-]{2,})\s+not found/gi;

const FONT_REPLACEMENTS = [
  { pattern: /\\setmainfont\s*\{[^}]+\}/g, replacement: "\\setmainfont{Latin Modern Roman}" },
  { pattern: /\\setsansfont\s*\{[^}]+\}/g, replacement: "\\setsansfont{Latin Modern Sans}" },
  { pattern: /\\setCJKmainfont\s*\{[^}]+\}/g, replacement: "\\setCJKmainfont{FandolSong-Regular}" },
  { pattern: /\\setCJKfamilyfont(\s*\{[^}]+\})\s*\{[^}]+\}/g, replacement: "\\setCJKfamilyfont$1{FandolSong-Regular}" },
  { pattern: /\\newfontfamily(\\[A-Za-z@]+)\s*\{[^}]+\}/g, replacement: "\\newfontfamily$1{Latin Modern Sans}" },
  { pattern: /\\newCJKfontfamily(\\[A-Za-z@]+)\s*\{[^}]+\}/g, replacement: "\\newCJKfontfamily$1{FandolSong-Regular}" },
];

export function shouldIncludeCompileFile(path: string): boolean {
  const normalized = path.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const dot = normalized.lastIndexOf(".");
  if (dot < 0 || dot === normalized.length - 1) {
    return false;
  }
  return COMPILE_TEXT_EXTENSIONS.has(normalized.slice(dot + 1));
}

function collectRegexMatches(source: string, regex: RegExp): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(regex)) {
    const value = String(match[1] || "").trim();
    if (value.length > 1) {
      out.push(value);
    }
  }
  return out;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function extractMissingStyleCandidatesFromDiagnostics(diagnostics: string[]): string[] {
  const candidates: string[] = [];
  for (const line of diagnostics) {
    const text = String(line || "");
    for (const match of text.matchAll(MISSING_STYLE_RE)) {
      candidates.push(match[1].trim());
    }
    for (const match of text.matchAll(PACKAGE_ERROR_RE)) {
      const packageName = match[1].trim();
      if (packageName.toLowerCase() !== "fontspec") {
        candidates.push(`${packageName}.sty`);
      }
    }
  }
  return unique(candidates);
}

export function extractMissingSystemFontsFromDiagnostics(diagnostics: string[]): string[] {
  const fonts: string[] = [];
  for (const line of diagnostics) {
    const text = String(line || "");
    fonts.push(...collectRegexMatches(text, FONT_QUOTED_RE));
    fonts.push(...collectRegexMatches(text, FONT_PLAIN_RE));
  }
  return unique(fonts.filter((font) => font.length > 1));
}

export function hasFontspecErrorDiagnostics(diagnostics: string[]): boolean {
  return diagnostics.some((line) => FONTSPEC_ERROR_RE.test(String(line || "")));
}

export function extractConfiguredSystemFontsFromSource(source: string): string[] {
  return unique([
    ...collectRegexMatches(source, /\\(?:setmainfont|setsansfont|setmonofont|setCJKmainfont)\s*\{([^}]+)\}/g),
    ...collectRegexMatches(source, /\\setCJKfamilyfont\s*\{[^}]+\}\s*\{([^}]+)\}/g),
    ...collectRegexMatches(source, /\\(?:newfontfamily|newCJKfontfamily)\\[A-Za-z@]+\s*\{([^}]+)\}/g),
  ]);
}

export function collectConfiguredSystemFontsFromFileMap(fileMap: Record<string, string>): string[] {
  const fonts: string[] = [];
  for (const [path, source] of Object.entries(fileMap)) {
    if (/\.(tex|sty|cls)$/i.test(path)) {
      fonts.push(...extractConfiguredSystemFontsFromSource(source));
    }
  }
  return unique(fonts);
}

export function resolveFontFallbackCandidates(input: {
  extractedFonts: string[];
  configuredFonts: string[];
  probeMissingFonts: string[];
}): string[] {
  return unique([...input.extractedFonts, ...input.configuredFonts, ...input.probeMissingFonts]);
}

export function applySystemFontFallbackToSource(source: string, fonts: string[]) {
  let patchedSource = source;
  const replacements: string[] = [];
  if (fonts.length === 0) {
    return { patchedSource, replacements };
  }
  for (const item of FONT_REPLACEMENTS) {
    patchedSource = patchedSource.replace(item.pattern, (match, firstGroup) => {
      const replacement = item.replacement.replace("$1", String(firstGroup ?? ""));
      if (match !== replacement) {
        replacements.push(match);
      }
      return replacement;
    });
  }
  return { patchedSource, replacements };
}

export function applySystemFontFallbackToFileMap(
  fileMap: Record<string, string>,
  mainPath: string,
  fonts: string[],
) {
  const overlays: Record<string, string> = {};
  let mainSource = fileMap[mainPath] ?? "";
  const replacements: string[] = [];
  for (const [path, source] of Object.entries(fileMap)) {
    if (!/\.(tex|sty|cls)$/i.test(path)) {
      continue;
    }
    const patched = applySystemFontFallbackToSource(source, fonts);
    if (patched.replacements.length === 0) {
      continue;
    }
    replacements.push(...patched.replacements);
    if (path === mainPath) {
      mainSource = patched.patchedSource;
    } else {
      overlays[path] = patched.patchedSource;
    }
  }
  return { changed: replacements.length > 0, mainSource, overlays, replacements };
}

export function shouldDisplayCompileProgress(progress: CompileInstallProgress | null): boolean {
  if (!progress?.active) {
    return false;
  }
  return String(progress.stage || "").trim().toLowerCase() !== "queued";
}

async function buildCompileFileMap(
  projectId: string,
  mainPath: string,
  mainContent: string,
  fileList: string[],
) {
  const fileMap: Record<string, string> = {};
  for (const filePath of fileList) {
    if (filePath === mainPath) {
      fileMap[filePath] = mainContent;
      continue;
    }
    if (!shouldIncludeCompileFile(filePath)) {
      continue;
    }
    try {
      const data = await readFile(projectId, filePath);
      fileMap[filePath] = data.content;
    } catch {
      // Let the native compiler report missing or unreadable support files.
    }
  }
  return fileMap;
}

export async function runCompilePass(params: {
  projectId: string;
  mainPath: string;
  mainContent: string;
  fileList: string[];
  updatePreview: boolean;
  emitToast: boolean;
  compileMode?: "sync" | "task";
  t: (key: any) => string;
  setLastCompileFailed: (value: boolean) => void;
  setCompileDiagnostics: (value: string[]) => void;
  setPdfUrl: (value: string | null) => void;
  setCompiledPdfRelativePath: (value: string | null) => void;
  setPreferCompiledPreview: (value: boolean) => void;
  setCompileInstallProgress: (value: CompileInstallProgress | null) => void;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
}) {
  const fileMap = await buildCompileFileMap(
    params.projectId,
    params.mainPath,
    params.mainContent,
    params.fileList,
  );
  const compileInput = {
    projectId: params.projectId,
    mainPath: params.mainPath,
    mainSource: params.mainContent,
    fileMap,
    reason: params.compileMode === "task" ? "manual" : "agent",
  };
  const result = params.compileMode === "task"
    ? await compileWithNativeLatexTask({
        ...compileInput,
        onProgress: (status) => {
          const progress: CompileInstallProgress = {
            active: status.status === "running",
            percent: Number(status.percent ?? 0),
            stage: String(status.stage ?? "running"),
            currentPackage: status.currentItem ?? params.mainPath,
            completed: Math.round(Number(status.percent ?? 0)),
            total: 100,
            message: status.message ?? status.latestLogLine ?? "",
          };
          params.setCompileInstallProgress(
            shouldDisplayCompileProgress(progress) ? progress : null,
          );
        },
      })
    : await compileWithNativeLatex(compileInput);

  params.setCompileInstallProgress(null);
  params.setLastCompileFailed(result.status !== "success");
  params.setCompileDiagnostics(result.diagnostics);
  await recordCompile({
    projectId: params.projectId,
    mainFile: params.mainPath,
    status: result.status,
    diagnostics: result.diagnostics,
    durationMs: result.durationMs,
  });
  if (result.status === "success" && result.pdfRelativePath && params.updatePreview) {
    params.setPdfUrl(null);
    params.setCompiledPdfRelativePath(result.pdfRelativePath);
    params.setPreferCompiledPreview(true);
  }
  if (params.emitToast) {
    params.setToast({
      type: result.status === "success" ? "info" : "error",
      message: result.status === "success" ? params.t("toast.compileSuccess") : params.t("toast.compileFailed"),
    });
  }
  return result;
}
