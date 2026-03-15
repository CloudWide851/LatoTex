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
let resolvedBasePath: string | null = null;
let preparedCacheBasePath: string | null = null;
let preparingCachePromise: Promise<string | null> | null = null;

function resetBusyTexRuntime(resetCacheBase = false) {
  runner = null;
  resolvedBasePath = null;
  if (resetCacheBase) {
    preparedCacheBasePath = null;
  }
}

async function resolveCacheBasePath(): Promise<string | null> {
  if (preparedCacheBasePath) {
    return preparedCacheBasePath;
  }
  if (!isTauri()) {
    return null;
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
      const normalizedActualDir = info.actualDir.replace(/\\/g, "/");
      preparedCacheBasePath = normalizeAssetBasePath(convertFileSrc(normalizedActualDir));
      return preparedCacheBasePath;
    } catch {
      return null;
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
  const cachePath = await resolveCacheBasePath();
  return Array.from(
    new Set([
      cachePath ? `${cachePath}` : "",
      `${normalizedBase}core/busytex`,
      "/core/busytex",
      "./core/busytex",
      "core/busytex",
    ].filter((value) => value.length > 0)),
  );
}



async function checkAssetReachable(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (head.ok) {
      return true;
    }
    if (head.status !== 405 && head.status !== 501) {
      return false;
    }
  } catch {
    // fallback to GET check
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Range: "bytes=0-32" },
    });
    if (!response.ok) {
      return false;
    }
    await response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function hasValidWorkerAsset(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const source = (await response.text()).trimStart();
    return !source.startsWith("<");
  } catch {
    return false;
  }
}

async function hasRequiredBusyTexAssets(basePath: string): Promise<boolean> {
  const workerUrl = `${basePath}/busytex_worker.js`;
  if (!(await hasValidWorkerAsset(workerUrl))) {
    return false;
  }

  const assetChecks = await Promise.all([
    checkAssetReachable(`${basePath}/busytex.js`),
    checkAssetReachable(`${basePath}/busytex.wasm`),
    checkAssetReachable(`${basePath}/texlive-basic.js`),
  ]);
  return assetChecks.every(Boolean);
}

async function resolveBusyTexBasePath(): Promise<string> {
  if (resolvedBasePath) {
    return resolvedBasePath;
  }
  const candidates = (await buildBasePathCandidates()).map(normalizeAssetBasePath);
  for (const candidate of candidates) {
    if (await hasRequiredBusyTexAssets(candidate)) {
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
    const message = error instanceof Error ? error.message : String(error);

    if (allowRetry && isRecoverableAssetError(message)) {
      resetBusyTexRuntime(true);
      await resolveCacheBasePath().catch(() => null);
      return compileInternal(mainSource, files, mainFilePath, false, startAt);
    }

    const hint = isRecoverableAssetError(message) ? [BUSYTEX_ASSET_HINT] : [];
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
