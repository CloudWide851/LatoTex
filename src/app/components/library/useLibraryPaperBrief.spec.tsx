// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { libraryExtractPaperContext } from "../../../shared/api/library";
import { buildWorkspacePreviewBlobUrl, revokeObjectUrl } from "../../../shared/utils/workspacePreviewBlob";
import { clearLibraryPaperBriefCache, useLibraryPaperBrief } from "./useLibraryPaperBrief";

const mocks = vi.hoisted(() => ({
  buildPdfJsPaperPreview: vi.fn(),
}));

vi.mock("../../../shared/api/library", () => ({
  libraryExtractPaperContext: vi.fn(),
}));

vi.mock("../../../shared/utils/workspacePreviewBlob", () => ({
  buildWorkspacePreviewBlobUrl: vi.fn(),
  revokeObjectUrl: vi.fn(),
}));

vi.mock("./usePdfPaperPreview", async () => {
  const actual = await vi.importActual<typeof import("./usePdfPaperPreview")>("./usePdfPaperPreview");
  return {
    ...actual,
    buildPdfJsPaperPreview: mocks.buildPdfJsPaperPreview,
  };
});

function HookProbe(props: Parameters<typeof useLibraryPaperBrief>[0]) {
  const state = useLibraryPaperBrief(props);
  return <pre data-testid="hook-state">{JSON.stringify(state)}</pre>;
}

async function renderProbe(props: Parameters<typeof useLibraryPaperBrief>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<HookProbe {...props} />);
  });
  return { container, root };
}

async function unmountProbe(root: Root, container: HTMLDivElement) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

function readProbeState(container: HTMLDivElement) {
  return JSON.parse(container.querySelector("[data-testid='hook-state']")?.textContent || "{}");
}

describe("useLibraryPaperBrief", () => {
  const libraryExtractPaperContextMock = vi.mocked(libraryExtractPaperContext);
  const buildWorkspacePreviewBlobUrlMock = vi.mocked(buildWorkspacePreviewBlobUrl);
  const revokeObjectUrlMock = vi.mocked(revokeObjectUrl);

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    clearLibraryPaperBriefCache();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("builds a paper brief from the hidden source pdf path on bib-first load", async () => {
    buildWorkspacePreviewBlobUrlMock.mockResolvedValue("blob:hidden-pdf");
    mocks.buildPdfJsPaperPreview.mockResolvedValue({
      title: "Demo Paper",
      extractionEngine: "pdfjs",
      pageCount: 4,
      excerpt: "Fast local summary.",
    });

    const view = await renderProbe({
      projectId: "project-1",
      selectedPath: "papers/demo.bib",
      pdfUrl: null,
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
      fallbackTitle: "Demo Paper",
      engine: "auto",
      previewKey: ".latotex/papers/demo.pdf",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(buildWorkspacePreviewBlobUrlMock).toHaveBeenCalledWith("project-1", ".latotex/papers/demo.pdf");
    expect(mocks.buildPdfJsPaperPreview).toHaveBeenCalledWith("blob:hidden-pdf", "Demo Paper");
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:hidden-pdf");
    expect(libraryExtractPaperContextMock).not.toHaveBeenCalled();
    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      error: null,
      paperPreview: {
        title: "Demo Paper",
        extractionEngine: "pdfjs",
        excerpt: "Fast local summary.",
      },
    });

    await unmountProbe(view.root, view.container);
  });

  it("falls back to backend extraction when the frontend pdfjs excerpt is unusable", async () => {
    buildWorkspacePreviewBlobUrlMock.mockResolvedValue("blob:hidden-pdf");
    mocks.buildPdfJsPaperPreview.mockResolvedValue({
      title: "Demo Paper",
      extractionEngine: "pdfjs",
      pageCount: 4,
      excerpt: "",
    });
    libraryExtractPaperContextMock.mockResolvedValue({
      sourcePath: "papers/demo.bib",
      title: "Demo Paper",
      metadataBlock: "",
      chunks: [{ chunkIndex: 0, pageStart: 1, pageEnd: 1, text: "Abstract Backend preview excerpt." }],
      pdfRelativePath: ".latotex/papers/demo.pdf",
      detectedLanguage: "en",
      extractionEngine: "python",
      extractionMode: "text",
      pageCount: 4,
      ocrPageCount: 0,
    });

    const view = await renderProbe({
      projectId: "project-1",
      selectedPath: "papers/demo.bib",
      pdfUrl: null,
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
      fallbackTitle: "Demo Paper",
      engine: "auto",
      previewKey: ".latotex/papers/demo.pdf",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(libraryExtractPaperContextMock).toHaveBeenCalledWith("project-1", "papers/demo.bib");
    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      error: null,
      paperPreview: {
        extractionEngine: "python",
        excerpt: "Abstract Backend preview excerpt.",
      },
    });

    await unmountProbe(view.root, view.container);
  });
});
