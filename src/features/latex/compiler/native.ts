import { compileNativeLatex } from "../../../shared/api/latex";

export type NativeLatexCompileResult = {
  status: "success" | "error";
  pdfBytes?: Uint8Array;
  diagnostics: string[];
  durationMs: number;
  engine: string;
  pdfRelativePath?: string | null;
  logRelativePath?: string | null;
};

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
  });

  return {
    status: result.status === "success" ? "success" : "error",
    pdfBytes: Array.isArray(result.pdfBytes) ? Uint8Array.from(result.pdfBytes) : undefined,
    diagnostics: sanitizeDiagnostics(result.diagnostics ?? []),
    durationMs: Number(result.durationMs ?? 0),
    engine: String(result.engine || "native"),
    pdfRelativePath: result.pdfRelativePath ?? null,
    logRelativePath: result.logRelativePath ?? null,
  };
}

export function disposeNativeLatexRuntime() {
  // Native toolchain runs per invocation; nothing to dispose in the renderer.
}
