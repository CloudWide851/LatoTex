import { compileWithBusyTeX } from "../../features/latex/compiler/busytex";
import { readFile, recordCompile, runtimeLogWrite } from "../../shared/api/desktop";

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

  const fileMap = await buildCompileFileMap(projectId, mainPath, mainContent, fileList);
  const result = await compileWithBusyTeX(mainContent, fileMap, mainPath);
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
