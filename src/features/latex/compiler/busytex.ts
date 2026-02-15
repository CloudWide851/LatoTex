import { BusyTexRunner, XeLatex } from "texlyre-busytex";

type BusyTexCompileResponse = {
  success?: boolean;
  pdf?: Uint8Array | ArrayBuffer | number[];
  log?: string;
  logs?: unknown;
  exitCode?: number;
};

export type BusyTeXCompileResult = {
  status: "success" | "error";
  pdfBytes?: Uint8Array;
  diagnostics: string[];
  durationMs: number;
};

const BUSYTEX_ASSET_HINT =
  "BusyTeX assets missing. Run `pnpm run busytex:assets` to download /public/core/busytex files.";

let runner: BusyTexRunner | null = null;
let resolvedBasePath: string | null = null;

function buildBasePathCandidates(): string[] {
  const baseUrl =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return Array.from(
    new Set([
      `${normalizedBase}core/busytex`,
      "/core/busytex",
      "./core/busytex",
      "core/busytex",
    ]),
  );
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^(\.)\/+/, "./");
}

async function hasValidWorkerAsset(basePath: string): Promise<boolean> {
  try {
    const workerUrl = `${basePath}/busytex_worker.js`;
    const response = await fetch(workerUrl, { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const source = (await response.text()).trimStart();
    return !source.startsWith("<");
  } catch {
    return false;
  }
}

async function resolveBusyTexBasePath(): Promise<string> {
  if (resolvedBasePath) {
    return resolvedBasePath;
  }
  const candidates = buildBasePathCandidates().map(normalizePath);
  for (const candidate of candidates) {
    // Validate worker asset first to avoid "Unexpected token '<'" from HTML fallback pages.
    if (await hasValidWorkerAsset(candidate)) {
      resolvedBasePath = candidate;
      return candidate;
    }
  }
  throw new Error(
    `BusyTeX worker asset not found. Tried: ${candidates.join(", ")}. ${BUSYTEX_ASSET_HINT}`,
  );
}

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
  return null;
}

function flattenLogs(raw: unknown): string[] {
  if (!raw) {
    return [];
  }
  if (typeof raw === "string") {
    return raw.trim() ? [raw] : [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .filter((line) => line.trim().length > 0);
  }
  return [JSON.stringify(raw)];
}

async function getRunner(): Promise<BusyTexRunner> {
  if (!runner) {
    const basePath = await resolveBusyTexBasePath();
    runner = new BusyTexRunner({
      busytexBasePath: basePath,
    });
  }
  if (!runner.isInitialized()) {
    await runner.initialize(true);
  }
  return runner;
}

export async function compileWithBusyTeX(
  mainSource: string,
  files: Record<string, string>,
  mainFilePath = "main.tex"
): Promise<BusyTeXCompileResult> {
  const start = performance.now();
  try {
    const currentRunner = await getRunner();
    const compiler = new XeLatex(currentRunner);
    const additionalFiles = Object.entries(files)
      .filter(([path]) => path !== mainFilePath)
      .map(([path, content]) => ({ path, content }));

    const rawResult = (await compiler.compile({
      input: mainSource,
      additionalFiles
    })) as BusyTexCompileResponse;

    const diagnostics = [
      ...flattenLogs(rawResult.logs),
      ...(rawResult.log ? [rawResult.log] : [])
    ];

    const pdfBytes = normalizeToUint8Array(rawResult.pdf);
    if (!rawResult.success || !pdfBytes) {
      const finalDiagnostics =
        diagnostics.length > 0
          ? diagnostics
          : [`BusyTeX compilation failed with exit code ${rawResult.exitCode ?? -1}.`];
      return {
        status: "error",
        diagnostics: finalDiagnostics,
        durationMs: Math.round(performance.now() - start)
      };
    }

    return {
      status: "success",
      pdfBytes,
      diagnostics,
      durationMs: Math.round(performance.now() - start)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint =
      message.includes("busytex") ||
      message.includes("busytex_worker.js") ||
      message.includes("Failed to fetch")
        ? [BUSYTEX_ASSET_HINT]
        : [];
    return {
      status: "error",
      diagnostics: [message, ...hint],
      durationMs: Math.round(performance.now() - start)
    };
  }
}
