import {
  compileNativeLatex,
  compileNativeLatexStart,
  compileNativeLatexStatus,
} from "../../../shared/api/latex";
import type { NativeLatexCompileTaskStatus } from "../../../shared/types/app";

export type NativeLatexCompileResult = {
  status: "success" | "error";
  diagnostics: string[];
  durationMs: number;
  engine: string;
  pdfRelativePath?: string | null;
  logRelativePath?: string | null;
};

const COMPILE_STATUS_POLL_MS = 260;
const COMPILE_STATUS_POLL_LIMIT = 2400;

function sanitizeDiagnostics(lines: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of lines) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output.slice(0, 24);
}

function displayEngineLabel(engine: unknown): string {
  const raw = String(engine || "native").trim();
  if (!raw) {
    return "native";
  }
  if (raw === "tectonic") {
    return "Tectonic (XeTeX backend)";
  }
  return raw;
}

function toCompileResult(result: any): NativeLatexCompileResult {
  return {
    status: result.status === "success" ? "success" : "error",
    diagnostics: sanitizeDiagnostics(result.diagnostics ?? []),
    durationMs: Number(result.durationMs ?? 0),
    engine: displayEngineLabel(result.engine),
    pdfRelativePath: result.pdfRelativePath ?? null,
    logRelativePath: result.logRelativePath ?? null,
  };
}

export async function compileWithNativeLatex(input: {
  projectId: string;
  mainPath: string;
  mainSource: string;
  fileMap: Record<string, string>;
  reason?: string;
}): Promise<NativeLatexCompileResult> {
  const result = await compileNativeLatex({
    projectId: input.projectId,
    mainPath: input.mainPath,
    entryContent: input.mainSource,
    fileMap: input.fileMap,
    preferEngine: "tectonic",
    reason: input.reason,
    includePdfBytes: false,
  });
  return toCompileResult(result);
}

export async function compileWithNativeLatexTask(input: {
  projectId: string;
  mainPath: string;
  mainSource: string;
  fileMap: Record<string, string>;
  reason?: string;
  onProgress?: (status: NativeLatexCompileTaskStatus) => void;
}): Promise<NativeLatexCompileResult> {
  const started = await compileNativeLatexStart({
    projectId: input.projectId,
    mainPath: input.mainPath,
    entryContent: input.mainSource,
    fileMap: input.fileMap,
    preferEngine: "tectonic",
    reason: input.reason,
    includePdfBytes: false,
  });

  for (let round = 0; round < COMPILE_STATUS_POLL_LIMIT; round += 1) {
    const status = await compileNativeLatexStatus(started.taskId);
    if (status.status === "running" && String(status.stage || "").trim().toLowerCase() !== "queued") {
      input.onProgress?.(status);
    }
    if (status.status === "completed") {
      return toCompileResult(status.result ?? {});
    }
    if (status.status === "failed") {
      const errorLine = String(status.error || status.diagnostics?.[0] || "compile task failed");
      throw new Error(errorLine);
    }
    await new Promise((resolve) => window.setTimeout(resolve, COMPILE_STATUS_POLL_MS));
  }

  throw new Error("compile.task.timeout");
}

export function disposeNativeLatexRuntime() {
  // Native toolchain runs per invocation; nothing to dispose in the renderer.
}
