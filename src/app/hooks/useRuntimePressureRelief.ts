import { useCallback, useEffect, useRef } from "react";
import { disposeNativeLatexRuntime } from "../../features/latex/compiler/native";
import { runtimeLogWrite } from "../../shared/api/runtime";
import type { SwarmEvent } from "../../shared/types/app";
import { clearLibraryDocumentDataCache } from "../components/library/useLibraryDocumentData";
import { trimEventsForMemoryPressure } from "./eventMemoryBudget";

function revokeIfObjectUrl(value: string | null) {
  if (value && value.startsWith("blob:")) {
    URL.revokeObjectURL(value);
  }
}

export function useRuntimePressureRelief(params: {
  sleeping: boolean;
  pdfUrl: string | null;
  selectedFilePdfUrl: string | null;
  selectedImagePreviewUrl: string | null;
  setPdfUrl: (value: string | null) => void;
  setSelectedFilePdfUrl: (value: string | null) => void;
  setSelectedImagePreviewUrl: (value: string | null) => void;
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
    setEvents,
  } = params;
  const lastReleaseAtRef = useRef(0);

  const release = useCallback((reason: "sleep" | "oom" | "manual" | "memory_guard") => {
    const now = Date.now();
    if (now - lastReleaseAtRef.current < 1_200) {
      return;
    }
    lastReleaseAtRef.current = now;

    disposeNativeLatexRuntime();
    clearLibraryDocumentDataCache();
    revokeIfObjectUrl(pdfUrl);
    revokeIfObjectUrl(selectedFilePdfUrl);
    revokeIfObjectUrl(selectedImagePreviewUrl);

    setPdfUrl(null);
    setSelectedFilePdfUrl(null);
    setSelectedImagePreviewUrl(null);
    setEvents((prev) =>
      trimEventsForMemoryPressure(prev, {
        maxEvents: 48,
        minEvents: 24,
        maxBytes: 80_000,
      }),
    );
    window.dispatchEvent(new CustomEvent("latotex.runtime.release-heavy-resources", {
      detail: { reason },
    }));

    void runtimeLogWrite("WARN", `runtime pressure relief applied: reason=${reason}`).catch(() => undefined);
  }, [pdfUrl, selectedFilePdfUrl, selectedImagePreviewUrl, setEvents, setPdfUrl, setSelectedFilePdfUrl, setSelectedImagePreviewUrl]);

  useEffect(() => {
    if (!sleeping) {
      return;
    }
    release("sleep");
  }, [release, sleeping]);

  return { release };
}
