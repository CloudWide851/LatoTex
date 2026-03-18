import { compileWithBusyTeX } from "../../features/latex/compiler/busytex";
import {
  busytexInstallMissingPackage,
  readFile,
  recordCompile,
  runtimeLogWrite,
} from "../../shared/api/desktop";

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

export function extractMissingStyleCandidatesFromDiagnostics(diagnostics: string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const line of diagnostics) {
    const text = String(line || "").trim();
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
      if (packageName) {
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
    const line = String(value || "").trim();
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    merged.push(line);
  }
  return merged.slice(0, 16);
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
  } = params;

  const baseFileMap = await buildCompileFileMap(projectId, mainPath, mainContent, fileList);
  const overlayFileMap: Record<string, string> = {};
  const installNotes: string[] = [];
  const attemptedPackages = new Set<string>();
  let result = await compileWithBusyTeX(mainContent, baseFileMap, mainPath);

  for (let round = 0; round < 4 && result.status !== "success"; round += 1) {
    const missingStyles = extractMissingStyleCandidatesFromDiagnostics(result.diagnostics).filter(
      (style) => !attemptedPackages.has(style.toLowerCase()),
    );
    if (missingStyles.length === 0) {
      break;
    }

    let installedAny = false;
    for (const missingStyle of missingStyles) {
      attemptedPackages.add(missingStyle.toLowerCase());
      try {
        const install = await busytexInstallMissingPackage({
          styleFile: missingStyle,
          policy: getBusyTexCachePolicy(),
        });
        if (!Array.isArray(install.overlayFiles) || install.overlayFiles.length === 0) {
          installNotes.push(`BusyTeX auto install did not provide files for ${missingStyle}.`);
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
        installNotes.push(`BusyTeX auto installed ${missingStyle} from ${install.sourceUrl || "cache"}.`);
      } catch (error) {
        installNotes.push(`BusyTeX auto install failed for ${missingStyle}: ${String(error)}`);
      }
    }

    if (!installedAny) {
      break;
    }

    const mergedFileMap = { ...baseFileMap, ...overlayFileMap };
    result = await compileWithBusyTeX(mainContent, mergedFileMap, mainPath);
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
}


