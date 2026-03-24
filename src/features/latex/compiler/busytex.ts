import { isTauri } from "@tauri-apps/api/core";
import { BusyTexRunner, XeLatex } from "texlyre-busytex";
import { busytexCachePrepare } from "../../../shared/api/local-resources";
import {
  appendLocalResourceBaseVariants,
  orderLocalResourceCandidatesByOrigin,
} from "../../../shared/utils/localResourceProbe";
import { normalizeAssetBasePath } from "../../../shared/utils/assetPath";

type BusyTexCompileResponse = {
  success?: boolean;
  pdf?: Uint8Array | ArrayBuffer | number[];
  log?: string;
  logs?: unknown;
  exitCode?: number;
};

type BusyTexInitMode = "worker" | "direct";

type BusyTexInitCandidate = {
  basePath: string;
  initMode: BusyTexInitMode;
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
let runnerBasePath = "";
let preparedCacheCandidate: BusyTexInitCandidate | null = null;
let preparingCachePromise: Promise<BusyTexInitCandidate | null> | null = null;

function normalizeTrailingSlash(input: string): string {
  return String(input || "").trim().replace(/\/+$/, "");
}

function resetBusyTexRuntime(resetCacheBase = false) {
  runner = null;
  runnerBasePath = "";
  if (resetCacheBase) {
    preparedCacheCandidate = null;
  }
}

export function disposeBusyTeXRuntime(options?: { resetCacheBase?: boolean }) {
  try {
    runner?.terminate();
  } catch {
    // ignore terminate failures during pressure relief
  }
  resetBusyTexRuntime(Boolean(options?.resetCacheBase));
}

function normalizeInitMode(value: string | null | undefined): BusyTexInitMode {
  return value === "worker" ? "worker" : "direct";
}

async function resolveCacheCandidate(): Promise<BusyTexInitCandidate | null> {
  if (preparedCacheCandidate) {
    return preparedCacheCandidate;
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

      const basePath = normalizeTrailingSlash(normalizeAssetBasePath(info.baseUrl ?? ""));
      preparedCacheCandidate = basePath
        ? {
            basePath,
            initMode: normalizeInitMode(info.preferredInitMode),
          }
        : null;
      return preparedCacheCandidate;
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

async function buildBasePathCandidates(): Promise<BusyTexInitCandidate[]> {
  if (isTauri()) {
    const cacheCandidate = await resolveCacheCandidate();
    return cacheCandidate ? [cacheCandidate] : [];
  }

  const withVariants: string[] = [];
  const baseUrl =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  appendLocalResourceBaseVariants(withVariants, `${normalizedBase}core/busytex`);
  appendLocalResourceBaseVariants(withVariants, "/core/busytex");
  appendLocalResourceBaseVariants(withVariants, "./core/busytex");
  appendLocalResourceBaseVariants(withVariants, "core/busytex");

  return orderLocalResourceCandidatesByOrigin(withVariants).map((basePath) => ({
    basePath,
    initMode: "worker",
  }));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildMissingAssetsError(candidates: BusyTexInitCandidate[], reasons: string[]): Error {
  const labels = candidates.map((candidate) => candidate.basePath);
  const details = reasons.length > 0 ? ` Reasons: ${reasons.join(" | ")}.` : "";
  return new Error(
    `BusyTeX worker asset not found. Tried: ${labels.join(", ")}. ${BUSYTEX_ASSET_HINT}${details}`,
  );
}

function shouldFallbackToDirectMode(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("worker")
    || message.includes("asset.localhost")
    || message.includes("origin")
    || message.includes("unexpected token <")
    || message.includes("syntaxerror")
    || message.includes("scriptloaderdocument")
    || message.includes("failed to construct 'worker'")
    || message.includes('failed to construct "worker"')
    || message.includes("cannot be accessed from origin")
  );
}

async function initializeCandidateRunner(
  candidateRunner: BusyTexRunner,
  initMode: BusyTexInitMode,
): Promise<void> {
  if (initMode === "direct") {
    await candidateRunner.initialize(false);
    return;
  }
  try {
    await candidateRunner.initialize(true);
    return;
  } catch (error) {
    if (!(isTauri() && shouldFallbackToDirectMode(error))) {
      throw error;
    }
  }
  await candidateRunner.initialize(false);
}

async function initializeRunnerFromCandidates(candidates: BusyTexInitCandidate[]): Promise<BusyTexRunner> {
  const reasons: string[] = [];

  for (const candidate of candidates) {
    const candidateRunner = new BusyTexRunner({
      busytexBasePath: candidate.basePath,
    });
    try {
      if (!candidateRunner.isInitialized()) {
        await initializeCandidateRunner(candidateRunner, candidate.initMode);
      }
      runnerBasePath = candidate.basePath;
      return candidateRunner;
    } catch (error) {
      reasons.push(`${candidate.basePath}: ${toErrorMessage(error)}`);
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

function splitLogLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function flattenLogEntry(entry: unknown): string[] {
  if (entry == null) {
    return [];
  }
  if (typeof entry === "string") {
    return splitLogLines(entry);
  }
  if (Array.isArray(entry)) {
    return entry.flatMap((item) => flattenLogEntry(item));
  }
  if (typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const preferredKeys = ["message", "error", "stderr", "stdout", "log", "logs"];
    const ignoredKeys = new Set(["cmd", "texmflog", "missfontlog", "aux", "exit_code", "exitCode"]);
    const extracted: string[] = [];

    for (const key of preferredKeys) {
      if (!(key in record)) {
        continue;
      }
      extracted.push(...flattenLogEntry(record[key]));
    }

    if (extracted.length > 0) {
      return extracted;
    }

    for (const [key, value] of Object.entries(record)) {
      if (ignoredKeys.has(key)) {
        continue;
      }
      extracted.push(...flattenLogEntry(value));
    }

    if (extracted.length > 0) {
      return extracted;
    }

    try {
      return splitLogLines(JSON.stringify(record));
    } catch {
      return [];
    }
  }
  return splitLogLines(String(entry));
}

function flattenLogs(raw: unknown): string[] {
  return flattenLogEntry(raw);
}

const DIAGNOSTIC_NOISE_PATTERNS: RegExp[] = [
  /^\$\s*(xelatex|xdvipdfmx)\b/i,
  /^exitcode:/i,
  /^texmflog:/i,
  /^missfontlog:/i,
  /^log:/i,
  /^stdout:/i,
  /^stderr:/i,
  /^==+$/,
  /^this is xetex, version/i,
  /^entering extended mode$/i,
  /^\*\*main\.tex$/i,
  /keepruntimealive\(\)/i,
  /tex live \d+_texlyre_busytexwasm/i,
  /^package\s+[^\r\n]+\s+info:/i,
];

const DIAGNOSTIC_ERROR_PATTERNS: RegExp[] = [
  /latex error/i,
  /fatal:/i,
  /emergency stop/i,
  /no output pdf file written/i,
  /cannot \\read from terminal/i,
  /file [`\'][^`\']+\.(sty|cls|cfg|def|fd|tex|lua)[`\'] not found/i,
  /failed/i,
  /error:/i,
];

function isLikelyCompileErrorLine(line: string): boolean {
  return DIAGNOSTIC_ERROR_PATTERNS.some((pattern) => pattern.test(line));
}

function isNoiseLine(line: string): boolean {
  return DIAGNOSTIC_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function sanitizeDiagnostics(lines: string[]): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const chunk of lines) {
    const source = String(chunk || "");
    if (!source.trim()) {
      continue;
    }
    for (const rawLine of splitLogLines(source)) {
      if (isNoiseLine(rawLine)) {
        continue;
      }
      const compact = rawLine.length > 420 ? `${rawLine.slice(0, 417)}...` : rawLine;
      if (seen.has(compact)) {
        continue;
      }
      seen.add(compact);
      cleaned.push(compact);
    }
  }

  const errorFirst = cleaned.filter((line) => isLikelyCompileErrorLine(line));
  const context = cleaned.filter((line) => /^!\s+/.test(line) || /^l\.\d+/.test(line));

  if (errorFirst.length > 0) {
    return [...errorFirst, ...context].slice(0, 10);
  }

  return cleaned.slice(0, 8);
}

function isRecoverableAssetError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("busytex")
    || normalized.includes("busytex_worker.js")
    || normalized.includes("failed to fetch")
    || normalized.includes("busytex_pipeline.js")
    || normalized.includes("texlive-basic")
    || normalized.includes("worker error")
    || normalized.includes("failed to construct 'worker'")
    || normalized.includes("cannot be accessed from origin")
    || normalized.includes("unexpected token <")
    || normalized.includes("syntaxerror")
    || normalized.includes("not found")
    || normalized.includes("scriptloaderdocument")
  );
}

async function getRunner(): Promise<BusyTexRunner> {
  if (runner) {
    try {
      if (!runner.isInitialized()) {
        await initializeCandidateRunner(runner, isTauri() ? "direct" : "worker");
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

function resolveRunnerBasePath(currentRunner: BusyTexRunner): string {
  const knownPath = normalizeTrailingSlash(runnerBasePath);
  if (knownPath) {
    return knownPath;
  }

  const runnerLike = currentRunner as unknown as {
    getConfig?: () => { busytexBasePath?: string };
    config?: { busytexBasePath?: string };
  };

  const fromGetter =
    typeof runnerLike.getConfig === "function"
      ? normalizeTrailingSlash(runnerLike.getConfig()?.busytexBasePath ?? "")
      : "";
  if (fromGetter) {
    runnerBasePath = fromGetter;
    return fromGetter;
  }

  const fromConfig = normalizeTrailingSlash(runnerLike.config?.busytexBasePath ?? "");
  if (fromConfig) {
    runnerBasePath = fromConfig;
    return fromConfig;
  }

  return "";
}

function buildDataPackagesJsForRunner(currentRunner: BusyTexRunner): string[] {
  const basePath = resolveRunnerBasePath(currentRunner);
  if (!basePath) {
    return [];
  }
  return [`${basePath}/texlive-basic.js`, `${basePath}/texlive-extra.js`];
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
      dataPackagesJs: buildDataPackagesJsForRunner(currentRunner),
    })) as BusyTexCompileResponse;

    const diagnostics = sanitizeDiagnostics([
      ...flattenLogs(rawResult.logs),
      ...(rawResult.log ? [rawResult.log] : []),
    ]);

    const pdfBytes = normalizeToUint8Array(rawResult.pdf);
    if (!rawResult.success || !pdfBytes) {
      const finalDiagnostics =
        diagnostics.length > 0
          ? diagnostics
          : sanitizeDiagnostics([`BusyTeX compilation failed with exit code ${rawResult.exitCode ?? -1}.`]);
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
      await resolveCacheCandidate().catch(() => null);
      return compileInternal(mainSource, files, mainFilePath, false, startAt);
    }

    const needsHint = isRecoverableAssetError(message) && !message.includes(BUSYTEX_ASSET_HINT);
    const hint = needsHint ? [BUSYTEX_ASSET_HINT] : [];
    const diagnostics = sanitizeDiagnostics([message, ...hint]);
    return {
      status: "error",
      diagnostics: diagnostics.length > 0 ? diagnostics : [message, ...hint],
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













