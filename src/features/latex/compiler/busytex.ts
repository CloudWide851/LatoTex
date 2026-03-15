import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { BusyTexRunner, XeLatex } from "texlyre-busytex";
import { busytexCachePrepare } from "../../../shared/api/desktop";
import { normalizeAssetBasePath } from "../../../shared/utils/assetPath";

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
  "BusyTeX assets missing. Run `pnpm run busytex:assets` to prepare src-tauri/resources/core/busytex.";

let runner: BusyTexRunner | null = null;
let preparedCacheBasePaths: string[] | null = null;
let preparingCachePromise: Promise<string[]> | null = null;

function normalizeTrailingSlash(input: string): string {
  return String(input || "").trim().replace(/\/+$/, "");
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => normalizeTrailingSlash(item)).filter((item) => item.length > 0)));
}

function appendCandidateVariants(target: string[], candidate: string) {
  if (!candidate) {
    return;
  }
  const base = normalizeTrailingSlash(candidate);
  if (!base) {
    return;
  }
  target.push(base);
  target.push(normalizeTrailingSlash(normalizeAssetBasePath(base)));
}

function resetBusyTexRuntime(resetCacheBase = false) {
  runner = null;
  if (resetCacheBase) {
    preparedCacheBasePaths = null;
  }
}

async function resolveCacheBasePaths(): Promise<string[]> {
  if (preparedCacheBasePaths) {
    return preparedCacheBasePaths;
  }
  if (!isTauri()) {
    return [];
  }
  if (preparingCachePromise) {
    return preparingCachePromise;
  }

  preparingCachePromise = (async () => {
    try {
      const policy =
        typeof window !== "undefined"
          ? (window.localStorage.getItem("latotex.busytex.cachePolicy") as
              | "install-first"
              | "appdata-only"
              | null)
          : null;
      const info = await busytexCachePrepare(policy ?? "install-first");
      if (typeof window !== "undefined") {
        window.localStorage.setItem("latotex.busytex.cacheDir", info.actualDir);
        window.localStorage.setItem("latotex.busytex.cachePolicy", info.policy);
      }

      const originalDir = String(info.actualDir || "").trim();
      const slashDir = originalDir.replace(/\\/g, "/");
      const originalConverted = convertFileSrc(originalDir);
      const slashConverted = convertFileSrc(slashDir);

      preparedCacheBasePaths = uniqueValues([
        normalizeAssetBasePath(originalConverted),
        normalizeAssetBasePath(slashConverted),
        originalConverted,
        slashConverted,
      ]);
      return preparedCacheBasePaths;
    } catch {
      return [];
    }
  })();

  try {
    return await preparingCachePromise;
  } finally {
    preparingCachePromise = null;
  }
}

async function buildBasePathCandidates(): Promise<string[]> {
  const baseUrl =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const cachePaths = await resolveCacheBasePaths();
  const withVariants: string[] = [];

  for (const path of cachePaths) {
    appendCandidateVariants(withVariants, path);
  }

  appendCandidateVariants(withVariants, `${normalizedBase}core/busytex`);
  appendCandidateVariants(withVariants, "/core/busytex");
  appendCandidateVariants(withVariants, "./core/busytex");
  appendCandidateVariants(withVariants, "core/busytex");

  return uniqueValues(withVariants);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildMissingAssetsError(candidates: string[], reasons: string[]): Error {
  const lastReason = reasons.length > 0 ? ` Last error: ${reasons[reasons.length - 1]}.` : "";
  return new Error(
    `BusyTeX worker asset not found. Tried: ${candidates.join(", ")}. ${BUSYTEX_ASSET_HINT}${lastReason}`,
  );
}

async function initializeRunnerFromCandidates(candidates: string[]): Promise<BusyTexRunner> {
  const reasons: string[] = [];

  for (const candidate of candidates) {
    const candidateRunner = new BusyTexRunner({
      busytexBasePath: candidate,
    });
    try {
      if (!candidateRunner.isInitialized()) {
        await candidateRunner.initialize(true);
      }
      return candidateRunner;
    } catch (error) {
      reasons.push(toErrorMessage(error));
    }
  }

  throw buildMissingAssetsError(candidates, reasons);
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

function isRecoverableAssetError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("busytex")
    || normalized.includes("busytex_worker.js")
    || normalized.includes("failed to fetch")
    || normalized.includes("texlive-basic")
    || normalized.includes("not found")
  );
}

async function getRunner(): Promise<BusyTexRunner> {
  if (runner) {
    try {
      if (!runner.isInitialized()) {
        await runner.initialize(true);
      }
      return runner;
    } catch {
      resetBusyTexRuntime(false);
    }
  }

  const candidates = await buildBasePathCandidates();
  runner = await initializeRunnerFromCandidates(candidates);
  return runner;
}

async function compileInternal(
  mainSource: string,
  files: Record<string, string>,
  mainFilePath: string,
  allowRetry: boolean,
  startAt: number,
): Promise<BusyTeXCompileResult> {
  try {
    const currentRunner = await getRunner();
    const compiler = new XeLatex(currentRunner);
    const additionalFiles = Object.entries(files)
      .filter(([path]) => path !== mainFilePath)
      .map(([path, content]) => ({ path, content }));

    const rawResult = (await compiler.compile({
      input: mainSource,
      additionalFiles,
    })) as BusyTexCompileResponse;

    const diagnostics = [
      ...flattenLogs(rawResult.logs),
      ...(rawResult.log ? [rawResult.log] : []),
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
        durationMs: Math.round(performance.now() - startAt),
      };
    }

    return {
      status: "success",
      pdfBytes,
      diagnostics,
      durationMs: Math.round(performance.now() - startAt),
    };
  } catch (error) {
    const message = toErrorMessage(error);

    if (allowRetry && isRecoverableAssetError(message)) {
      resetBusyTexRuntime(true);
      await resolveCacheBasePaths().catch(() => []);
      return compileInternal(mainSource, files, mainFilePath, false, startAt);
    }

    const needsHint = isRecoverableAssetError(message) && !message.includes(BUSYTEX_ASSET_HINT);
    const hint = needsHint ? [BUSYTEX_ASSET_HINT] : [];
    return {
      status: "error",
      diagnostics: [message, ...hint],
      durationMs: Math.round(performance.now() - startAt),
    };
  }
}

export async function compileWithBusyTeX(
  mainSource: string,
  files: Record<string, string>,
  mainFilePath = "main.tex",
): Promise<BusyTeXCompileResult> {
  const startedAt = performance.now();
  return compileInternal(mainSource, files, mainFilePath, true, startedAt);
}

