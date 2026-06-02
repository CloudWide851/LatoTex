// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { libraryExtractPaperContext } from "../../../shared/api/library";
import {
  buildWorkspacePreviewBinarySource,
  revokeObjectUrl,
  type WorkspacePreviewBinarySource,
} from "../../../shared/utils/workspacePreviewBlob";
import { clearLibraryPaperBriefCache, useLibraryPaperBrief } from "./useLibraryPaperBrief";

const mocks = vi.hoisted(() => ({
  buildPdfJsPaperPreview: vi.fn(),
}));

vi.mock("../../../shared/api/library", () => ({
  libraryExtractPaperContext: vi.fn(),
}));

vi.mock("../../../shared/utils/workspacePreviewBlob", () => ({
  buildWorkspacePreviewBinarySource: vi.fn(),
  revokeObjectUrl: vi.fn(),
}));

vi.mock("./usePdfPaperPreview", () => {
  return {
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

function createPdfSource(relativePath = ".latotex/papers/demo.pdf"): WorkspacePreviewBinarySource {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  return {
    relativePath,
    objectUrl: "blob:hidden-pdf",
    bytes,
  };
}

describe("useLibraryPaperBrief", () => {
  const libraryExtractPaperContextMock = vi.mocked(libraryExtractPaperContext);
  const buildWorkspacePreviewBinarySourceMock = vi.mocked(buildWorkspacePreviewBinarySource);
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
    const pdfSource = createPdfSource();
    buildWorkspacePreviewBinarySourceMock.mockResolvedValue(pdfSource);
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

    expect(buildWorkspacePreviewBinarySourceMock).toHaveBeenCalledWith("project-1", ".latotex/papers/demo.pdf");
    expect(mocks.buildPdfJsPaperPreview).toHaveBeenCalledWith(pdfSource, "Demo Paper");
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
    buildWorkspacePreviewBinarySourceMock.mockResolvedValue(createPdfSource());
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
