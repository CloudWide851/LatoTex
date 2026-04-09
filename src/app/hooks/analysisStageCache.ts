import { readFile, writeFile } from "../../shared/api/workspace";
import type { AnalysisRunPythonResponse } from "../../shared/types/app-extended";
import type { PaperAnalysisContext, AnalysisSourceSnapshot } from "./analysisDataSources";

const ANALYSIS_STAGE_CACHE_PATH = ".latotex/analysis/stage-cache.json";

type AnalysisStageCacheEntry<T = unknown> = {
  updatedAt: string;
  value: T;
};

export type AnalysisStageCacheStore = {
  version: 1;
  entries: Record<string, AnalysisStageCacheEntry>;
};

export type AnalysisCachedChunkSummaries = {
  chunkSummaries: string[];
  chunkFailures: number;
};

function emptyStore(): AnalysisStageCacheStore {
  return {
    version: 1,
    entries: {},
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function readCachedAnalysisStageValue<T>(
  store: AnalysisStageCacheStore,
  key: string,
): T | null {
  const entry = store.entries[key];
  return entry ? (entry.value as T) : null;
}

export function writeCachedAnalysisStageValue<T>(
  store: AnalysisStageCacheStore,
  key: string,
  value: T,
): AnalysisStageCacheStore {
  return {
    ...store,
    entries: {
      ...store.entries,
      [key]: {
        updatedAt: new Date().toISOString(),
        value,
      },
    },
  };
}

export async function loadAnalysisStageCache(projectId: string): Promise<AnalysisStageCacheStore> {
  try {
    const file = await readFile(projectId, ANALYSIS_STAGE_CACHE_PATH);
    const parsed = JSON.parse(file.content) as Partial<AnalysisStageCacheStore>;
    if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === "object") {
      return {
        version: 1,
        entries: parsed.entries,
      };
    }
  } catch {
    // Treat missing or invalid cache as empty.
  }
  return emptyStore();
}

export async function saveAnalysisStageCache(
  projectId: string,
  store: AnalysisStageCacheStore,
): Promise<void> {
  await writeFile(projectId, ANALYSIS_STAGE_CACHE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

export function buildAnalysisPromptSignature(
  prompt: string,
  outputLanguageLabel: string,
): string {
  return hashString(`${outputLanguageLabel}\n${prompt.trim()}`);
}

export function buildPaperContextSignature(paperContext: PaperAnalysisContext): string {
  return hashString(stableStringify({
    sourcePath: paperContext.sourcePath,
    title: paperContext.title,
    metadataBlock: paperContext.metadataBlock,
    detectedLanguage: paperContext.detectedLanguage ?? null,
    extractionEngine: paperContext.extractionEngine ?? null,
    extractionMode: paperContext.extractionMode ?? null,
    pageCount: paperContext.pageCount,
    ocrPageCount: paperContext.ocrPageCount,
    chunks: paperContext.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      text: chunk.text,
    })),
  }));
}

export function buildSnapshotSignature(snapshots: AnalysisSourceSnapshot[]): string {
  return hashString(stableStringify(
    snapshots.map((snapshot) => ({
      path: snapshot.path,
      kind: snapshot.kind,
      summary: snapshot.summary,
      excerpt: snapshot.excerpt,
      rows: snapshot.rows ?? null,
      columns: snapshot.columns ?? null,
      numericSeries: snapshot.numericSeries ?? [],
    })),
  ));
}

export function buildPaperChunkSummariesCacheKey(
  sourcePath: string,
  outputLanguageLabel: string,
  paperContextSignature: string,
): string {
  return `paper-chunks:${sourcePath}:${outputLanguageLabel}:${paperContextSignature}`;
}

export function buildPaperCondensedSourceCacheKey(
  sourcePath: string,
  outputLanguageLabel: string,
  paperContextSignature: string,
  promptSignature: string,
): string {
  return `paper-condensed:${sourcePath}:${outputLanguageLabel}:${paperContextSignature}:${promptSignature}`;
}

export function buildPythonProfileCacheKey(
  outputLanguageLabel: string,
  promptSignature: string,
  snapshotSignature: string,
): string {
  return `python-profile:${outputLanguageLabel}:${promptSignature}:${snapshotSignature}`;
}

export function trimCachedPythonProfile(
  response: AnalysisRunPythonResponse,
): AnalysisRunPythonResponse {
  return {
    ...response,
    stdout: String(response.stdout ?? "").slice(0, 8000),
    stderr: String(response.stderr ?? "").slice(0, 8000),
  };
}
