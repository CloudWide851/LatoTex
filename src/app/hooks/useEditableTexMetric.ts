import { useEffect, useState } from "react";

export type EditableTexMetric = {
  elapsedMs: number;
  file: string;
  recordedAt: string;
};

const EVENT_NAME = "latotex.performance.editableTex";

function parseMetric(raw: string | null): EditableTexMetric | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<EditableTexMetric>;
    if (typeof parsed.elapsedMs === "number" && parsed.elapsedMs >= 0) {
      return {
        elapsedMs: parsed.elapsedMs,
        file: String(parsed.file ?? "-"),
        recordedAt: String(parsed.recordedAt ?? ""),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function saveEditableTexMetric(metric: EditableTexMetric) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem("latotex.performance.editableTex", JSON.stringify(metric));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: metric }));
}

export function useEditableTexMetric(): EditableTexMetric | null {
  const [metric, setMetric] = useState<EditableTexMetric | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return parseMetric(window.localStorage.getItem("latotex.performance.editableTex"));
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<EditableTexMetric>).detail;
      if (detail) {
        setMetric(detail);
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  return metric;
}
