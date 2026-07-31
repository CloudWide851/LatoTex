import { runtimeLogWrite } from "../../../shared/api/runtime";

export type KnowledgeRuntimeMetric =
  | "preview_interactive"
  | "graph_stable"
  | "index_throughput"
  | "main_thread_long_tasks"
  | "dropped_frame_rate";

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function recordKnowledgeRuntimeMetric(
  metric: KnowledgeRuntimeMetric,
  value: number,
  count = 0,
) {
  const boundedValue = Math.max(0, Math.round(value * 100) / 100);
  const boundedCount = Math.max(0, Math.trunc(count));
  void runtimeLogWrite(
    "INFO",
    `frontend performance knowledge_${metric}=${boundedValue}, count=${boundedCount}`,
  ).catch(() => undefined);
}

export function observeKnowledgeLongTasks() {
  if (typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }
  let totalMs = 0;
  let count = 0;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 50) {
          totalMs += entry.duration;
          count += 1;
        }
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    observer?.disconnect();
    return () => undefined;
  }
  return () => {
    observer?.disconnect();
    if (count > 0) {
      recordKnowledgeRuntimeMetric("main_thread_long_tasks", totalMs, count);
    }
  };
}

export function monitorKnowledgeFrames(durationMs = 1_200) {
  if (
    typeof requestAnimationFrame === "undefined"
    || typeof cancelAnimationFrame === "undefined"
  ) {
    return () => undefined;
  }
  const startedAt = now();
  let previousAt = startedAt;
  let expectedFrames = 0;
  let observedFrames = 0;
  let frameId = 0;
  let disposed = false;
  const step = (timestamp: number) => {
    if (disposed) return;
    const elapsed = Math.max(0, timestamp - previousAt);
    expectedFrames += Math.max(1, Math.round(elapsed / (1_000 / 60)));
    observedFrames += 1;
    previousAt = timestamp;
    if (timestamp - startedAt >= durationMs) {
      const dropped = Math.max(0, expectedFrames - observedFrames);
      const rate = expectedFrames > 0 ? dropped / expectedFrames : 0;
      recordKnowledgeRuntimeMetric("dropped_frame_rate", rate, expectedFrames);
      return;
    }
    frameId = requestAnimationFrame(step);
  };
  frameId = requestAnimationFrame(step);
  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
  };
}
