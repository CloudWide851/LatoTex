import { runtimeLogWrite } from "../../../shared/api/runtime";

export type KnowledgeSearchPerformanceMetric =
  | "first_result"
  | "lexical_complete"
  | "hybrid_complete";

export type KnowledgeSearchTelemetry = {
  record: (metric: KnowledgeSearchPerformanceMetric, resultCount: number) => number;
  dispose: () => void;
};

function performanceApi(): Performance | null {
  return typeof performance === "undefined" ? null : performance;
}

export function beginKnowledgeSearchTelemetry(runId: string): KnowledgeSearchTelemetry {
  const api = performanceApi();
  const startedAt = api?.now() ?? Date.now();
  const startMark = `latotex.knowledge.search.${runId}.start`;
  const recorded = new Set<KnowledgeSearchPerformanceMetric>();
  try {
    api?.mark(startMark);
  } catch {
    // Browser performance marks are diagnostic-only.
  }

  return {
    record(metric, resultCount) {
      if (recorded.has(metric)) {
        return 0;
      }
      recorded.add(metric);
      const endMark = `latotex.knowledge.search.${runId}.${metric}`;
      const measureName = `latotex.knowledge.search.${runId}.${metric}.measure`;
      let elapsedMs = Math.max(0, (api?.now() ?? Date.now()) - startedAt);
      try {
        api?.mark(endMark);
        api?.measure(measureName, startMark, endMark);
        const entries = api?.getEntriesByName(measureName, "measure") ?? [];
        elapsedMs = entries[entries.length - 1]?.duration ?? elapsedMs;
      } catch {
        // A missing/unsupported mark must never block search results.
      } finally {
        try {
          api?.clearMarks(endMark);
          api?.clearMeasures(measureName);
        } catch {
          // Cleanup is best-effort for older WebView performance APIs.
        }
      }
      const roundedMs = Math.max(0, Math.round(elapsedMs));
      const boundedCount = Math.max(0, Math.trunc(resultCount));
      void runtimeLogWrite(
        "INFO",
        `frontend performance knowledge_search_${metric}_ms=${roundedMs}, results=${boundedCount}`,
      ).catch(() => undefined);
      return roundedMs;
    },
    dispose() {
      try {
        api?.clearMarks(startMark);
      } catch {
        // Cleanup is diagnostic-only.
      }
    },
  };
}
