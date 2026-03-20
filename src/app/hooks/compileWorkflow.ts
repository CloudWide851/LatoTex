import { compileWithBusyTeX } from "../../features/latex/compiler/busytex";
import {
  busytexInstallMissingPackage,
  readFile,
  recordCompile,
  runtimeLogWrite,
} from "../../shared/api/desktop";
import { runtimeSystemFontProbe } from "../../shared/api/runtimeFontProbe";
import { applyFontFallbackToCompileMap, collectConfiguredFontsFromCompileMap } from "./compileFontFallbackFiles";

const COMPILE_SKIP_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "svg",
  "zip",
  "7z",
  "rar",
  "mp4",
  "mp3",
  "wav",
  "ogg",
  "mov",
  "avi",
  "wasm",
  "dll",
  "exe",
  "bin",
]);

const MISSING_STYLE_RE = /File [`']([^`']+\.(sty|cls|cfg|def|fd|tex|lua))[`'] not found/i;
const PACKAGE_ERROR_RE = /Package\s+([A-Za-z0-9._-]+)\s+Error:/i;
const FONTSPEC_MISSING_FONT_RE =
  /Package\s+fontspec\s+Error:\s*(?:The\s+)?font\s+["'`]?([^"'`]+?)["'`]?\s+(?:cannot be found|not found)/i;
const FONTSPEC_ERROR_RE = /Package\s+fontspec\s+Error:/i;
const COMBINED_DIAGNOSTIC_SPLIT_RE = /(\.xdv)(No output PDF file written(?:\.[A-Za-z0-9_-]+)?\.?)/gi;

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
  setcjkmainfont: "Latin Modern Roman",
  setsansfont: "Latin Modern Sans",
  setcjksansfont: "Latin Modern Sans",
  setmonofont: "Latin Modern Mono",
  setcjkmonofont: "Latin Modern Mono",
  newfontfamily: "Latin Modern Roman",
};

export type CompileInstallProgress = {
  active: boolean;
  percent: number;
  stage: "installing" | "retrying";
  currentPackage: string | null;
  completed: number;
  total: number;
  message: string;
};

function shouldIncludeCompileFile(path: string): boolean {
  const normalized = path.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const dot = normalized.lastIndexOf(".");
  if (dot < 0 || dot === normalized.length - 1) {
    return true;
  }
  const extension = normalized.slice(dot + 1);
  return !COMPILE_SKIP_EXTENSIONS.has(extension);
}

function splitDiagnosticLines(value: string): string[] {
  const text = String(value || "").replace(COMBINED_DIAGNOSTIC_SPLIT_RE, "$1\n$2");
  return text
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter((line) => line.length > 0);
}

function normalizeFontName(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

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
      if (!key || seen.has(key)) {
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

export function extractConfiguredSystemFontsFromSource(source: string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  const collect = (family: string) => {
    const value = String(family || "").trim();
    const key = normalizeFontName(value);
    if (!key || seen.has(key)) {
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

  const newFontFamilyRe = /\\newfontfamily\s*\\[A-Za-z@]+(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi;
  for (const match of source.matchAll(newFontFamilyRe)) {
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
    if (!key || missingByKey.has(key)) {
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
    /(\\newfontfamily\s*\\[A-Za-z@]+)(\s*\[[^\]]*])?\s*\{([^}]+)\}/gi,
    () => "newfontfamily",
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

function getBusyTexCachePolicy(): "install-first" | "appdata-only" {
  if (typeof window === "undefined") {
    return "install-first";
  }
  const raw = window.localStorage.getItem("latotex.busytex.cachePolicy");
  return raw === "appdata-only" ? "appdata-only" : "install-first";
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
  const overlayFileMap: Record<string, string> = {};
  const installNotes: string[] = [];
  const attemptedPackages = new Set<string>();
  const installProgressState = {
    total: 0,
    completed: 0,
    currentPackage: null as string | null,
  };

  let compileSource = mainContent;
  let fontFallbackAttempted = false;
  let result = await compileWithBusyTeX(compileSource, baseCompileMap, mainPath);

  const emitInstallProgress = (line: string) => {
    installNotes.push(line);
    setCompileDiagnostics(mergeDiagnostics(result.diagnostics, installNotes));
  };

  const emitProgressState = (stage: "installing" | "retrying", message: string) => {
    if (!setCompileInstallProgress) {
      return;
    }
    const hasWork = installProgressState.total > 0;
    const percent = hasWork
      ? Math.min(99, Math.max(0, Math.floor((installProgressState.completed / installProgressState.total) * 100)))
      : 0;
    setCompileInstallProgress({
      active: true,
      percent,
      stage,
      currentPackage: installProgressState.currentPackage,
      completed: installProgressState.completed,
      total: installProgressState.total,
      message,
    });
  };

  try {
    for (let round = 0; round < 4 && result.status !== "success"; round += 1) {
      if (!fontFallbackAttempted) {
        const mergedCompileMap = { ...baseCompileMap, ...overlayFileMap };
        const extractedFonts = extractMissingSystemFontsFromDiagnostics(result.diagnostics);
        const hasFontspecError = hasFontspecErrorDiagnostics(result.diagnostics);
        const configuredFonts = hasFontspecError
          ? collectConfiguredSystemFontsFromFileMap(mergedCompileMap)
          : [];
        const probeCandidates = Array.from(new Set([...extractedFonts, ...configuredFonts]));
        let fallbackFonts = extractedFonts.length > 0 ? extractedFonts : configuredFonts;

        if (hasFontspecError && probeCandidates.length > 0) {
          try {
            const probe = await runtimeSystemFontProbe(probeCandidates);
            if (probe.missingFonts.length > 0) {
              fallbackFonts = probe.missingFonts;
            } else if (extractedFonts.length === 0) {
              fallbackFonts = [];
            }
          } catch {
            // Keep fallback heuristic path when probe is unavailable.
          }
        }

        if (fallbackFonts.length > 0 || hasFontspecError) {
          fontFallbackAttempted = true;
          const fallback = applySystemFontFallbackToFileMap(mergedCompileMap, mainPath, fallbackFonts);
          if (fallback.changed && fallback.replacements.length > 0) {
            const replacementSummary = fallback.replacements
              .map((item) => `${item.missing} -> ${item.fallback}`)
              .join(", ");
            emitInstallProgress(
              formatMessage(t, "workspace.compileAssist.busytexFontFallbackApplied", {
                details: replacementSummary,
              }),
            );
            compileSource = fallback.mainSource;
            Object.assign(overlayFileMap, fallback.overlays);
            emitProgressState(
              "retrying",
              formatMessage(t, "workspace.compileAssist.busytexRetryingCompile", {}),
            );
            result = await compileWithBusyTeX(compileSource, { ...baseCompileMap, ...overlayFileMap }, mainPath);
            continue;
          }
          emitInstallProgress(
            formatMessage(t, "workspace.compileAssist.busytexFontFallbackUnavailable", {
              fonts: fallbackFonts.length > 0 ? fallbackFonts.join(", ") : "fontspec",
            }),
          );
        }
      }

      const missingStyles = extractMissingStyleCandidatesFromDiagnostics(result.diagnostics).filter(
        (style) => !attemptedPackages.has(style.toLowerCase()),
      );
      if (missingStyles.length === 0) {
        break;
      }

      installProgressState.total += missingStyles.length;
      let installedAny = false;
      for (const missingStyle of missingStyles) {
        attemptedPackages.add(missingStyle.toLowerCase());
        installProgressState.currentPackage = missingStyle;
        emitInstallProgress(
          formatMessage(t, "workspace.compileAssist.busytexDownloadStart", {
            package: missingStyle,
          }),
        );
        emitProgressState(
          "installing",
          formatMessage(t, "workspace.compileAssist.busytexProgressInstalling", {
            package: missingStyle,
          }),
        );

        try {
          const install = await busytexInstallMissingPackage({
            styleFile: missingStyle,
            policy: getBusyTexCachePolicy(),
          });
          if (!Array.isArray(install.overlayFiles) || install.overlayFiles.length === 0) {
            emitInstallProgress(
              formatMessage(t, "workspace.compileAssist.busytexDownloadNoFiles", {
                package: missingStyle,
              }),
            );
            continue;
          }
          for (const file of install.overlayFiles) {
            const relativePath = String(file.path || "").trim();
            if (!relativePath) {
              continue;
            }
            overlayFileMap[relativePath] = String(file.content || "");
          }
          installedAny = true;
          emitInstallProgress(
            formatMessage(t, "workspace.compileAssist.busytexDownloadSuccess", {
              package: missingStyle,
              source: install.sourceUrl || "cache",
            }),
          );
        } catch (error) {
          emitInstallProgress(
            formatMessage(t, "workspace.compileAssist.busytexDownloadFailed", {
              package: missingStyle,
              reason: String(error),
            }),
          );
        } finally {
          installProgressState.completed += 1;
          emitProgressState(
            "installing",
            formatMessage(t, "workspace.compileAssist.busytexProgressPackages", {
              completed: String(installProgressState.completed),
              total: String(installProgressState.total),
            }),
          );
        }
      }

      if (!installedAny) {
        break;
      }

      emitProgressState(
        "retrying",
        formatMessage(t, "workspace.compileAssist.busytexRetryingCompile", {}),
      );
      result = await compileWithBusyTeX(compileSource, { ...baseCompileMap, ...overlayFileMap }, mainPath);
    }

    if (installNotes.length > 0) {
      result = {
        ...result,
        diagnostics: mergeDiagnostics(result.diagnostics, installNotes),
      };
    }

    setLastCompileFailed(result.status !== "success");
    setCompileDiagnostics(result.diagnostics);
    await runtimeLogWrite(
      result.status === "success" ? "INFO" : "ERROR",
      `${t("log.compileDone")}, file=${mainPath}, status=${result.status}, durationMs=${result.durationMs}`,
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

