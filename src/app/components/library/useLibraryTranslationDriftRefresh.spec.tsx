// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryTranslationDriftRefresh } from "./useLibraryTranslationDriftRefresh";

type ProbeProps = {
  translatedSessionPath: string | null;
  translatedSessionSourcePath: string | null;
  translatedPdfRelativePath: string | null;
  sourcePdfRelativePath: string | null;
  refreshDocumentData: () => Promise<{ sourcePdfRelativePath?: string | null } | null>;
  ensurePdfPreviewLoaded: () => Promise<unknown>;
  resetTranslationState: () => void;
};

function HookProbe(props: ProbeProps) {
  useLibraryTranslationDriftRefresh({
    projectId: "project-1",
    selectedPath: "library/demo.bib",
    pdfPreviewRequested: true,
    viewMode: "pdf",
    ...props,
  });
  return null;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useLibraryTranslationDriftRefresh", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("refreshes a stale translated artifact path once per document drift", async () => {
    const refreshDocumentData = vi.fn().mockResolvedValue({
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
    });
    const ensurePdfPreviewLoaded = vi.fn().mockResolvedValue(undefined);
    const resetTranslationState = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props: ProbeProps = {
      translatedSessionPath: ".latotex/papers/demo.translated.pdf",
      translatedSessionSourcePath: ".latotex/papers/demo.pdf",
      translatedPdfRelativePath: null,
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
      refreshDocumentData,
      ensurePdfPreviewLoaded,
      resetTranslationState,
    };

    await act(async () => {
      root.render(<HookProbe {...props} />);
    });
    await flushAsyncWork();
    await act(async () => {
      root.render(<HookProbe {...props} />);
    });
    await flushAsyncWork();

    expect(refreshDocumentData).toHaveBeenCalledTimes(1);
    expect(ensurePdfPreviewLoaded).toHaveBeenCalledTimes(1);
    expect(resetTranslationState).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("resets a stale translated source after one document-scoped refresh", async () => {
    const refreshDocumentData = vi.fn().mockResolvedValue({
      sourcePdfRelativePath: ".latotex/papers/current.pdf",
    });
    const ensurePdfPreviewLoaded = vi.fn().mockResolvedValue(undefined);
    const resetTranslationState = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props: ProbeProps = {
      translatedSessionPath: ".latotex/papers/old.translated.pdf",
      translatedSessionSourcePath: ".latotex/papers/old.pdf",
      translatedPdfRelativePath: ".latotex/papers/old.translated.pdf",
      sourcePdfRelativePath: ".latotex/papers/current.pdf",
      refreshDocumentData,
      ensurePdfPreviewLoaded,
      resetTranslationState,
    };

    await act(async () => {
      root.render(<HookProbe {...props} />);
    });
    await flushAsyncWork();
    await act(async () => {
      root.render(<HookProbe {...props} />);
    });
    await flushAsyncWork();

    expect(refreshDocumentData).toHaveBeenCalledTimes(1);
    expect(ensurePdfPreviewLoaded).not.toHaveBeenCalled();
    expect(resetTranslationState).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
