import { compileWithNativeLatex } from "../../features/latex/compiler/native";
import { recordCompile } from "../../shared/api/latex";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { readFile } from "../../shared/api/workspace";
import { runtimeSystemFontProbe } from "../../shared/api/runtimeFontProbe";
import { applyFontFallbackToCompileMap, collectConfiguredFontsFromCompileMap } from "./compileFontFallbackFiles";
import {
  type CompileInstallProgress,
  isLikelyFontFamily,
  normalizeFontName,
  shouldIncludeCompileFile,
  splitDiagnosticLines,
} from "./compileWorkflowShared";
export type { CompileInstallProgress } from "./compileWorkflowShared";

const MISSING_STYLE_RE = /File [`']([^`']+\.(sty|cls|cfg|def|fd|tex|lua))[`'] not found/i;
const PACKAGE_ERROR_RE = /Package\s+([A-Za-z0-9._-]+)\s+Error:/i;
const FONTSPEC_MISSING_FONT_RE =
  /Package\s+fontspec\s+Error:\s*(?:The\s+)?font\s+["'`]?([^"'`]+?)["'`]?\s+(?:cannot be found|not found)/i;
const FONTSPEC_ERROR_RE = /Package\s+fontspec\s+Error:/i;

const SYSTEM_FONT_FALLBACKS: Record<string, string> = {
  timesnewroman: "Latin Modern Roman",
  arial: "Latin Modern Sans",
  calibri: "Latin Modern Sans",
  helvetica: "Latin Modern Sans",
  cambria: "Latin Modern Roman",
  georgia: "Latin Modern Roman",
  couriernew: "Latin Modern Mono",
  consolas: "Latin Modern Mono",
  verdana: "Latin Modern Sans",
  tahoma: "Latin Modern Sans",
};

const DEFAULT_FONT_FALLBACK_BY_COMMAND: Record<string, string> = {
  setmainfont: "Latin Modern Roman",
  setsansfont: "Latin Modern Sans",
  setmonofont: "Latin Modern Mono",
  newfontfamily: "Latin Modern Roman",
  setcjkmainfont: "FandolSong-Regular",
  setcjksansfont: "FandolHei-Regular",
  setcjkmonofont: "FandolFang-Regular",
  setcjkfamilyfont: "FandolSong-Regular",
  newcjkfontfamily: "FandolSong-Regular",
};
function pickFallbackFont(missingFont: string, commandName: string): string {
  const normalizedMissing = normalizeFontName(missingFont);
  return SYSTEM_FONT_FALLBACKS[normalizedMissing]
    ?? DEFAULT_FONT_FALLBACK_BY_COMMAND[commandName.toLowerCase()]
    ?? "Latin Modern Roman";
}
export function extractMissingStyleCandidatesFromDiagnostics(diagnostics: string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const line of diagnostics) {
    for (const text of splitDiagnosticLines(line)) {
      if (!text) {
        continue;
      }
      const missingMatch = text.match(MISSING_STYLE_RE);
      if (missingMatch?.[1]) {
        const style = missingMatch[1].trim();
        const key = style.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(style);
        }
      }
      const packageErrorMatch = text.match(PACKAGE_ERROR_RE);
      if (packageErrorMatch?.[1]) {
        const packageName = packageErrorMatch[1].trim().replace(/[^A-Za-z0-9._-]/g, "");
        if (!packageName || packageName.toLowerCase() === "fontspec") {
          continue;
        }
        const style = `${packageName}.sty`;
        const key = style.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(style);
        }
      }
    }
  }
  return candidates;
}
export function extractMissingSystemFontsFromDiagnostics(diagnostics: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of diagnostics) {
    for (const line of splitDiagnosticLines(raw)) {
      const match = line.match(FONTSPEC_MISSING_FONT_RE);
      if (!match?.[1]) {
        continue;
      }
      const family = match[1].trim();
      const key = normalizeFontName(family);
      if (!key || seen.has(key) || !isLikelyFontFamily(family)) {
        continue;
      }
      seen.add(key);
      output.push(family);
    }
  }
  return output;
}
export function hasFontspecErrorDiagnostics(diagnostics: string[]): boolean {
  return diagnostics.some((raw) =>
    splitDiagnosticLines(raw).some((line) => FONTSPEC_ERROR_RE.test(line)),
  );
}
export function resolveFontFallbackCandidates(params: {
  extractedFonts: string[];
  configuredFonts?: string[];
  probeMissingFonts?: string[] | null;
}): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const font of [
    ...params.extractedFonts,
    ...(params.configuredFonts ?? []),
    ...(params.probeMissingFonts ?? []),
  ]) {
    const value = String(font || '').trim();
    const key = normalizeFontName(value);
    if (!key || seen.has(key) || !isLikelyFontFamily(value)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }
  return output;
}
export function extractConfiguredSystemFontsFromSource(source: string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  const collect = (family: string) => {
    const value = String(family || "").trim();
    const key = normalizeFontName(value);
    if (!key || seen.has(key) || !isLikelyFontFamily(value)) {
      return;
    }
    seen.add(key);
    output.push(value);
  };
  const setFontRe = /\\set(?:CJK)?(?:main|sans|mono)font(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi;
  for (const match of source.matchAll(setFontRe)) {
    if (match?.[1]) {
      collect(match[1]);
    }
  }
  const setCjkFamilyRe = /\\setCJKfamilyfont\s*\{[^}]+\}(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi;
  for (const match of source.matchAll(setCjkFamilyRe)) {
    if (match?.[1]) {
      collect(match[1]);
    }
  }
  const newFontFamilyRe = /\\newfontfamily\s*\\[A-Za-z@]+(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi;
  for (const match of source.matchAll(newFontFamilyRe)) {
    if (match?.[1]) {
      collect(match[1]);
    }
  }
  const newCjkFontFamilyRe = /\\newCJKfontfamily\s*\\[A-Za-z@]+(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi;
  for (const match of source.matchAll(newCjkFontFamilyRe)) {
    if (match?.[1]) {
      collect(match[1]);
    }
  }
  return output;
}
export function applySystemFontFallbackToSource(
  source: string,
  missingFonts: string[],
): { patchedSource: string; replacements: Array<{ missing: string; fallback: string }> } {
  if (!missingFonts.length) {
    return { patchedSource: source, replacements: [] };
  }
  const missingByKey = new Map<string, string>();
  for (const font of missingFonts) {
    const key = normalizeFontName(font);
    if (!key || missingByKey.has(key) || !isLikelyFontFamily(font)) {
      continue;
    }
    missingByKey.set(key, font);
  }
  if (missingByKey.size === 0) {
    return { patchedSource: source, replacements: [] };
  }
  const replacements = new Map<string, { missing: string; fallback: string }>();
  const replaceFontCommand = (
    input: string,
    regex: RegExp,
    commandNameResolver: (raw: string) => string,
  ) =>
    input.replace(regex, (full, commandPrefix: string, options: string | undefined, family: string) => {
      const normalizedFamily = normalizeFontName(family);
      if (!normalizedFamily || !missingByKey.has(normalizedFamily)) {
        return full;
      }
      const missing = missingByKey.get(normalizedFamily) || family;
      const commandName = commandNameResolver(commandPrefix);
      const fallback = pickFallbackFont(missing, commandName);
      const replacementKey = `${missing}|${fallback}`;
      if (!replacements.has(replacementKey)) {
        replacements.set(replacementKey, { missing, fallback });
      }
      return `${commandPrefix}${options || ""}{${fallback}}`;
    });
  let patched = source;
  patched = replaceFontCommand(
    patched,
    /(\\set(?:CJK)?(?:main|sans|mono)font)(\s*\[[^\]]*])?\s*\{([^}]+)\}/gi,
    (commandPrefix) => commandPrefix.slice(1),
  );
  patched = replaceFontCommand(
    patched,
    /(\\setCJKfamilyfont\s*\{[^}]+\})(\s*\[[^\]]*])?\s*\{([^}]+)\}/gi,
    () => "setCJKfamilyfont",
  );
  patched = replaceFontCommand(
    patched,
    /(\\newfontfamily\s*\\[A-Za-z@]+)(\s*\[[^\]]*])?\s*\{([^}]+)\}/gi,
    () => "newfontfamily",
  );
  patched = replaceFontCommand(
    patched,
    /(\\newCJKfontfamily\s*\\[A-Za-z@]+)(\s*\[[^\]]*])?\s*\{([^}]+)\}/gi,
    () => "newCJKfontfamily",
  );
  return {
    patchedSource: patched,
    replacements: Array.from(replacements.values()),
  };
}
export function collectConfiguredSystemFontsFromFileMap(fileMap: Record<string, string>): string[] {
  return collectConfiguredFontsFromCompileMap(
    fileMap,
    extractConfiguredSystemFontsFromSource,
    normalizeFontName,
  );
}
export function applySystemFontFallbackToFileMap(
  fileMap: Record<string, string>,
  mainPath: string,
  missingFonts: string[],
): {
  mainSource: string;
  overlays: Record<string, string>;
  replacements: Array<{ missing: string; fallback: string }>;
  changed: boolean;
} {
  return applyFontFallbackToCompileMap(
    fileMap,
    mainPath,
    missingFonts,
    applySystemFontFallbackToSource,
  );
}
function mergeDiagnostics(base: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...base, ...extra]) {
    for (const line of splitDiagnosticLines(value)) {
      if (!line || seen.has(line)) {
        continue;
      }
      seen.add(line);
      merged.push(line);
    }
  }
  return merged.slice(0, 24);
}
function formatMessage(
  t: (key: any) => string,
  key: string,
  replacements: Record<string, string>,
): string {
  let template = String(t(key));
  for (const [token, value] of Object.entries(replacements)) {
    template = template.replace(new RegExp(`\\{${token}\\}`, "g"), value);
  }
  return template;
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
    const data = await readFile(projectId, filePath);
    fileMap[filePath] = data.content;
  }
  return fileMap;
}
export async function runCompilePass(params: {
  projectId: string;
  mainPath: string;
  mainContent: string;
  fileList: string[];
  currentPdfUrl: string | null;
  updatePreview: boolean;
  emitToast: boolean;
  t: (key: any) => string;
  setLastCompileFailed: (value: boolean) => void;
  setCompileDiagnostics: (value: string[]) => void;
  setPdfUrl: (value: string | null) => void;
  setCompiledPdfBytes: (value: Uint8Array | null) => void;
  setPreferCompiledPreview: (value: boolean) => void;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  setCompileInstallProgress?: (value: CompileInstallProgress | null) => void;
}) {
  const {
    projectId,
    mainPath,
    mainContent,
    fileList,
    currentPdfUrl,
    updatePreview,
    emitToast,
    t,
    setLastCompileFailed,
    setCompileDiagnostics,
    setPdfUrl,
    setCompiledPdfBytes,
    setPreferCompiledPreview,
    setToast,
    setCompileInstallProgress,
  } = params;
  const baseFileMap = await buildCompileFileMap(projectId, mainPath, mainContent, fileList);
  const baseCompileMap: Record<string, string> = {
    ...baseFileMap,
    [mainPath]: mainContent,
  };
  const fontOverlayFileMap: Record<string, string> = {};
  const progressNotes: string[] = [];
  let compileSource = mainContent;
  let result = await compileWithNativeLatex({
    projectId,
    mainPath,
    mainSource: compileSource,
    fileMap: baseCompileMap,
    reason: "editor.compile",
  });

  const emitProgress = (message: string, percent = 52) => {
    progressNotes.push(message);
    setCompileDiagnostics(mergeDiagnostics(result.diagnostics, progressNotes));
    setCompileInstallProgress?.({
      active: true,
      percent,
      stage: "retrying",
      currentPackage: null,
      completed: progressNotes.length,
      total: Math.max(progressNotes.length, 1),
      message,
    });
  };

  try {
    const mergedCompileMap = { ...baseCompileMap, ...fontOverlayFileMap };
    const extractedFonts = extractMissingSystemFontsFromDiagnostics(result.diagnostics);
    const hasFontspecError = hasFontspecErrorDiagnostics(result.diagnostics);
    const configuredFonts = hasFontspecError
      ? collectConfiguredSystemFontsFromFileMap(mergedCompileMap)
      : [];
    const probeCandidates = resolveFontFallbackCandidates({
      extractedFonts,
      configuredFonts,
    });
    let probeMissingFonts: string[] = [];
    if (hasFontspecError && probeCandidates.length > 0) {
      try {
        const probe = await runtimeSystemFontProbe(probeCandidates);
        probeMissingFonts = probe.missingFonts;
      } catch {
        // Keep heuristic fallback when font probe is unavailable.
      }
    }
    const fallbackFonts = resolveFontFallbackCandidates({
      extractedFonts,
      configuredFonts,
      probeMissingFonts,
    });
    if ((fallbackFonts.length > 0 || hasFontspecError) && result.status !== "success") {
      const fallback = applySystemFontFallbackToFileMap(mergedCompileMap, mainPath, fallbackFonts);
      if (fallback.changed && fallback.replacements.length > 0) {
        const replacementSummary = fallback.replacements
          .map((item) => `${item.missing} -> ${item.fallback}`)
          .join(", ");
        emitProgress(
          formatMessage(t, "workspace.compileAssist.nativeFontFallbackApplied", {
            details: replacementSummary,
          }),
          58,
        );
        compileSource = fallback.mainSource;
        Object.assign(fontOverlayFileMap, fallback.overlays);
        result = await compileWithNativeLatex({
          projectId,
          mainPath,
          mainSource: compileSource,
          fileMap: { ...baseCompileMap, ...fontOverlayFileMap },
          reason: "font-fallback-retry",
        });
      } else if (fallbackFonts.length > 0 || hasFontspecError) {
        emitProgress(
          formatMessage(t, "workspace.compileAssist.nativeFontFallbackUnavailable", {
            fonts: fallbackFonts.length > 0 ? fallbackFonts.join(", ") : "fontspec",
          }),
          40,
        );
      }
    }

    if (progressNotes.length > 0) {
      result = {
        ...result,
        diagnostics: mergeDiagnostics(result.diagnostics, progressNotes),
      };
    }
    setLastCompileFailed(result.status !== "success");
    setCompileDiagnostics(result.diagnostics);
    await runtimeLogWrite(
      result.status === "success" ? "INFO" : "ERROR",
      `${t("log.compileDone")}, file=${mainPath}, status=${result.status}, engine=${result.engine}, durationMs=${result.durationMs}`,
    );
    await recordCompile({
      projectId,
      mainFile: mainPath,
      status: result.status,
      diagnostics: result.diagnostics,
      durationMs: result.durationMs,
    });
    if (result.status === "success" && result.pdfBytes && updatePreview) {
      if (currentPdfUrl) {
        URL.revokeObjectURL(currentPdfUrl);
      }
      const normalizedBytes = Uint8Array.from(result.pdfBytes);
      const url = URL.createObjectURL(new Blob([normalizedBytes], { type: "application/pdf" }));
      setPdfUrl(url);
      setCompiledPdfBytes(normalizedBytes);
      setPreferCompiledPreview(true);
    }
    if (emitToast) {
      setToast({
        type: result.status === "success" ? "info" : "error",
        message: result.status === "success" ? t("toast.compileSuccess") : t("toast.compileFailed"),
      });
    }
    return result;
  } finally {
    setCompileInstallProgress?.(null);
  }
}

