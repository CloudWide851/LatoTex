export type BusyTeXCompileResult = {
  status: "success" | "error";
  pdfBytes?: Uint8Array;
  diagnostics: string[];
  durationMs: number;
};

function normalizeToUint8Array(input: unknown): Uint8Array | null {
  if (!input) {
    return null;
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (Array.isArray(input)) {
    return Uint8Array.from(input);
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (typeof input === "object" && "buffer" in (input as Record<string, unknown>)) {
    const buffer = (input as { buffer?: unknown }).buffer;
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
  }
  return null;
}

type BusyTeXCompiler = (payload: {
  mainSource: string;
  files: Record<string, string>;
  format: "pdf";
}) => Promise<unknown>;

function resolveCompiler(module: Record<string, unknown>): BusyTeXCompiler | null {
  const direct = module.compile as BusyTeXCompiler | undefined;
  const latex = module.compileLatex as BusyTeXCompiler | undefined;
  if (typeof direct === "function") {
    return direct;
  }
  if (typeof latex === "function") {
    return latex;
  }
  const defaultExport = module.default as Record<string, unknown> | undefined;
  if (!defaultExport) {
    return null;
  }
  if (typeof defaultExport === "function") {
    return defaultExport as unknown as BusyTeXCompiler;
  }
  if (typeof defaultExport.compile === "function") {
    return defaultExport.compile as BusyTeXCompiler;
  }
  if (typeof defaultExport.compileLatex === "function") {
    return defaultExport.compileLatex as BusyTeXCompiler;
  }
  return null;
}

async function loadBusyTeXModule(): Promise<Record<string, unknown>> {
  // Deliberately dynamic to tolerate unstable package export shapes in alpha releases.
  const dynamicImporter = new Function(
    "moduleName",
    "return import(moduleName);"
  ) as (moduleName: string) => Promise<Record<string, unknown>>;
  return dynamicImporter("texlyre-busytex");
}

export async function compileWithBusyTeX(
  mainSource: string,
  files: Record<string, string>
): Promise<BusyTeXCompileResult> {
  const start = performance.now();
  try {
    const module = await loadBusyTeXModule();
    const compiler = resolveCompiler(module);
    if (!compiler) {
      return {
        status: "error",
        diagnostics: ["Unable to resolve compile API from texlyre-busytex module."],
        durationMs: Math.round(performance.now() - start)
      };
    }

    const rawResult = await compiler({ mainSource, files, format: "pdf" });
    const result = rawResult as Record<string, unknown>;
    const pdfBytes =
      normalizeToUint8Array(result?.pdf) ??
      normalizeToUint8Array(result?.output) ??
      normalizeToUint8Array(result?.pdfBytes);

    if (!pdfBytes) {
      return {
        status: "error",
        diagnostics: [
          "Compilation finished but no PDF bytes were returned by texlyre-busytex."
        ],
        durationMs: Math.round(performance.now() - start)
      };
    }

    return {
      status: "success",
      pdfBytes,
      diagnostics: [],
      durationMs: Math.round(performance.now() - start)
    };
  } catch (error) {
    return {
      status: "error",
      diagnostics: [
        error instanceof Error ? error.message : "Unknown BusyTeX compilation error."
      ],
      durationMs: Math.round(performance.now() - start)
    };
  }
}
