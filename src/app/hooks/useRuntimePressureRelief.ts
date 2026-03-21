import { useCallback, useEffect, useRef } from "react";
import { disposePyodideRunner } from "../../features/analysis/pyodide/runner";
import { disposeBusyTeXRuntime } from "../../features/latex/compiler/busytex";
import { runtimeLogWrite } from "../../shared/api/desktop";
import type { SwarmEvent } from "../../shared/types/app";
import { trimEventsForMemoryPressure } from "./eventMemoryBudget";

export function useRuntimePressureRelief(params: {
  sleeping: boolean;
  pdfUrl: string | null;
  selectedFilePdfUrl: string | null;
  selectedImagePreviewUrl: string | null;
  setPdfUrl: (value: string | null) => void;
  setSelectedFilePdfUrl: (value: string | null) => void;
  setSelectedImagePreviewUrl: (value: string | null) => void;
  setCompiledPdfBytes: (value: Uint8Array | null) => void;
  setEvents: React.Dispatch<React.SetStateAction<SwarmEvent[]>>;
}) {
  const {
    sleeping,
    pdfUrl,
    selectedFilePdfUrl,
    selectedImagePreviewUrl,
    setPdfUrl,
    setSelectedFilePdfUrl,
    setSelectedImagePreviewUrl,
    setCompiledPdfBytes,
    setEvents,
  } = params;
  const lastReleaseAtRef = useRef(0);

  const release = useCallback((reason: "sleep" | "oom") => {
    const now = Date.now();
    if (now - lastReleaseAtRef.current < 1_200) {
      return;
    }
    lastReleaseAtRef.current = now;

    disposeBusyTeXRuntime({ resetCacheBase: false });
    disposePyodideRunner();

    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
    }
    if (selectedFilePdfUrl) {
      URL.revokeObjectURL(selectedFilePdfUrl);
    }
    if (selectedImagePreviewUrl) {
      URL.revokeObjectURL(selectedImagePreviewUrl);
    }

    setPdfUrl(null);
    setSelectedFilePdfUrl(null);
    setSelectedImagePreviewUrl(null);
    setCompiledPdfBytes(null);
    setEvents((prev) =>
      trimEventsForMemoryPressure(prev, {
        maxEvents: 48,
        minEvents: 24,
        maxBytes: 80_000,
      }),
    );

    void runtimeLogWrite("WARN", `runtime pressure relief applied: reason=${reason}`).catch(() => undefined);
  }, [pdfUrl, selectedFilePdfUrl, selectedImagePreviewUrl, setCompiledPdfBytes, setEvents, setPdfUrl, setSelectedFilePdfUrl, setSelectedImagePreviewUrl]);

  useEffect(() => {
    if (!sleeping) {
      return;
    }
    release("sleep");
  }, [release, sleeping]);

  return { release };
}
