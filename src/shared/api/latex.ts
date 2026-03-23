import type { CompileRecord } from "../types/app";
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
