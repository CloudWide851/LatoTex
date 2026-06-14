import { useEffect, useState } from "react";

export type ProjectSearchReadyMetric = {
  elapsedMs: number;
  projectId: string;
  focusPaths: string[];
  recordedAt: string;
};

const STORAGE_KEY = "latotex.performance.projectSearchReady";
const EVENT_NAME = "latotex.performance.projectSearchReady";

function parseMetric(raw: string | null): ProjectSearchReadyMetric | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectSearchReadyMetric>;
    if (typeof parsed.elapsedMs === "number" && parsed.elapsedMs >= 0) {
      return {
        elapsedMs: parsed.elapsedMs,
        projectId: String(parsed.projectId ?? ""),
        focusPaths: Array.isArray(parsed.focusPaths) ? parsed.focusPaths.map(String) : [],
        recordedAt: String(parsed.recordedAt ?? ""),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function saveProjectSearchReadyMetric(metric: ProjectSearchReadyMetric) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(metric));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: metric }));
}

export function useProjectSearchReadyMetric(): ProjectSearchReadyMetric | null {
  const [metric, setMetric] = useState<ProjectSearchReadyMetric | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return parseMetric(window.localStorage.getItem(STORAGE_KEY));
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ProjectSearchReadyMetric>).detail;
      if (detail) {
        setMetric(detail);
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  return metric;
}
