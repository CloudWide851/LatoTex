import type { CompileRecord, NativeLatexCompileResponse, NativeLatexCompileTaskStatus } from "../types/app";
import { invokeCommand } from "./core";

export function recordCompile(input: {
  projectId: string;
  mainFile: string;
  status: string;
  diagnostics: string[];
  durationMs: number;
}): Promise<CompileRecord> {
  return invokeCommand<CompileRecord>("latex_compile_record", { input });
}

export function compileNativeLatex(input: {
  projectId: string;
  mainPath: string;
  entryContent: string;
  fileMap: Record<string, string>;
  preferEngine?: string;
  reason?: string;
  includePdfBytes?: boolean;
}): Promise<NativeLatexCompileResponse> {
  return invokeCommand<NativeLatexCompileResponse>("latex_compile_native", {
    input: {
      projectId: input.projectId,
      mainPath: input.mainPath,
      entryContent: input.entryContent,
      fileMap: input.fileMap,
      preferEngine: input.preferEngine,
      reason: input.reason,
      includePdfBytes: input.includePdfBytes,
    },
  });
}

export function compileNativeLatexStart(input: {
  projectId: string;
  mainPath: string;
  entryContent: string;
  fileMap: Record<string, string>;
  preferEngine?: string;
  reason?: string;
  includePdfBytes?: boolean;
}): Promise<{ taskId: string }> {
  return invokeCommand<{ taskId: string }>("latex_compile_start", {
    input: {
      projectId: input.projectId,
      mainPath: input.mainPath,
      entryContent: input.entryContent,
      fileMap: input.fileMap,
      preferEngine: input.preferEngine,
      reason: input.reason,
      includePdfBytes: input.includePdfBytes,
    },
  });
}

export function compileNativeLatexStatus(taskId: string): Promise<NativeLatexCompileTaskStatus> {
  return invokeCommand<NativeLatexCompileTaskStatus>("latex_compile_status", {
    input: { taskId },
  });
}
