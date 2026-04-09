// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  forwardRef,
  useImperativeHandle,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "../../shared/api/workspace";
import { LibraryDocumentViewer } from "./LibraryDocumentViewer";

const mocks = vi.hoisted(() => ({
  useLibraryDocumentData: vi.fn(),
  useLibraryTranslationPanel: vi.fn(),
  useLibraryPdfShortcuts: vi.fn(),
  useLibraryPaperBrief: vi.fn(),
  useLibraryPdfObjectUrls: vi.fn(),
}));

vi.mock("../../shared/api/workspace", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../../shared/api/app", () => ({
  openExternalLink: vi.fn(),
}));

vi.mock("./library/useLibraryDocumentData", () => ({
  useLibraryDocumentData: mocks.useLibraryDocumentData,
}));

vi.mock("./library/useLibraryTranslationPanel", () => ({
  useLibraryTranslationPanel: mocks.useLibraryTranslationPanel,
}));

vi.mock("./library/useLibraryPdfShortcuts", () => ({
  useLibraryPdfShortcuts: mocks.useLibraryPdfShortcuts,
}));

vi.mock("./library/useLibraryPaperBrief", () => ({
  useLibraryPaperBrief: mocks.useLibraryPaperBrief,
}));

vi.mock("./library/useLibraryPdfObjectUrls", () => ({
  useLibraryPdfObjectUrls: mocks.useLibraryPdfObjectUrls,
}));

vi.mock("./library/LibraryTranslationStatusToast", () => ({
  LibraryTranslationStatusToast: () => null,
}));

vi.mock("./library/LibraryViewerContentPanel", () => ({
  LibraryViewerContentPanel: forwardRef(function MockLibraryViewerContentPanel(props: any, ref) {
    useImperativeHandle(ref, () => ({
      scrollToPage: () => undefined,
    }), []);
    return (
      <div
        data-testid="library-viewer-content-panel"
        data-pdf-url={props.pdfUrl}
        data-loading={String(Boolean(props.loading))}
        data-bib-preview={props.bibPreview}
        data-view-mode={props.viewMode}
      />
    );
  }),
}));

describe("LibraryDocumentViewer", () => {
  const readFileMock = vi.mocked(readFile);
  const writeFileMock = vi.mocked(writeFile);

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    readFileMock.mockResolvedValue({
      relativePath: ".latotex/annotations/demo.json",
      content: "{\"version\":4,\"strokes\":[],\"textBoxes\":[]}",
    });
    writeFileMock.mockResolvedValue({
      ok: true,
      message: "saved",
    });

    const defaultDocumentState = {
      loading: false,
      loadError: null,
      pdfPreviewRequested: false,
      pdfPreviewLoading: false,
      pdfPreviewError: null,
      citation: {
        sourcePath: "library/demo.bib",
        bibPath: "library/demo.bib",
        authors: ["Test Author"],
        urls: ["https://example.com/paper"],
        title: "Demo Paper",
      },
      paperPreview: null,
      paperPreviewLoading: false,
      paperPreviewError: null,
      bibPreview: "@article{demo,title={Demo Paper}}",
      resolvedLink: "https://example.com/paper",
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
      translatedPdfRelativePath: null,
      pdfCacheState: "ready",
      previewRevision: 11,
      pdfDownloadedBytes: null,
      pdfTotalBytes: null,
      ensurePdfPreviewLoaded: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    };
    mocks.useLibraryDocumentData.mockImplementation(() => defaultDocumentState);
    const defaultTranslationPanelState = {
      translationBusy: false,
      translationNotice: null,
      translationDetail: null,
      translationProgress: null,
      setTranslationNotice: vi.fn(),
      resetTranslationState: vi.fn(),
      runTranslation: vi.fn(),
    };
    mocks.useLibraryTranslationPanel.mockImplementation(() => defaultTranslationPanelState);
    mocks.useLibraryPaperBrief.mockReturnValue({
      paperPreview: null,
      loading: false,
      error: null,
    });
    mocks.useLibraryPdfObjectUrls.mockImplementation((params: {
      enabled?: boolean;
      translatedPdfRelativePath?: string | null;
    }) => ({
      pdfUrl: params.enabled ? "blob:library-document-pdf" : null,
      translatedPdfUrl: params.translatedPdfRelativePath ? "blob:library-document-translated-pdf" : null,
      loading: false,
      error: null,
    }));
    mocks.useLibraryPdfShortcuts.mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("passes backend-loaded blob urls into the pdf viewer pipeline", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mocks.useLibraryDocumentData.mockImplementation(() => ({
      loading: false,
      loadError: null,
      pdfPreviewRequested: true,
      pdfPreviewLoading: false,
      pdfPreviewError: null,
      citation: {
        sourcePath: "library/demo.bib",
        bibPath: "library/demo.bib",
        authors: ["Test Author"],
        urls: ["https://example.com/paper"],
        title: "Demo Paper",
      },
      paperPreview: null,
      paperPreviewLoading: false,
      paperPreviewError: null,
      bibPreview: "@article{demo,title={Demo Paper}}",
      resolvedLink: "https://example.com/paper",
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
      translatedPdfRelativePath: null,
      pdfCacheState: "ready",
      previewRevision: 11,
      pdfDownloadedBytes: null,
      pdfTotalBytes: null,
      ensurePdfPreviewLoaded: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    }));

    await act(async () => {
      root.render(
        <LibraryDocumentViewer
          projectId="project-1"
          selectedPath="library/demo.bib"
          active
          onAnalyzePaper={() => undefined}
          analysisRunning={false}
          persistedViewMode="pdf"
          translationModelId={null}
          paperBriefEngine="auto"
          t={(key) => String(key)}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const viewer = container.querySelector("[data-testid='library-viewer-content-panel']");
    expect(viewer?.getAttribute("data-pdf-url")).toBe("blob:library-document-pdf");
    expect(viewer?.getAttribute("data-loading")).toBe("false");
    expect(viewer?.getAttribute("data-bib-preview")).toBe("@article{demo,title={Demo Paper}}");
    expect(viewer?.getAttribute("data-view-mode")).toBe("bib");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("resets to bib view when a different library entry is selected", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LibraryDocumentViewer
          projectId="project-1"
          selectedPath="library/demo.bib"
          active
          onAnalyzePaper={() => undefined}
          analysisRunning={false}
          persistedViewMode="pdf"
          translationModelId={null}
          paperBriefEngine="auto"
          t={(key) => String(key)}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='library-viewer-content-panel']")?.getAttribute("data-view-mode"),
    ).toBe("bib");

    await act(async () => {
      root.render(
        <LibraryDocumentViewer
          projectId="project-1"
          selectedPath="library/second.bib"
          active
          onAnalyzePaper={() => undefined}
          analysisRunning={false}
          persistedViewMode="pdf"
          translationModelId={null}
          paperBriefEngine="auto"
          t={(key) => String(key)}
        />,
      );
    });

    expect(
      container.querySelector("[data-testid='library-viewer-content-panel']")?.getAttribute("data-view-mode"),
    ).toBe("bib");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("waits for the translated pdf before switching into compare mode", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const refreshMock = vi.fn().mockResolvedValue(undefined);
    const resetMock = vi.fn();
    const ensurePdfPreviewLoadedMock = vi.fn().mockResolvedValue(undefined);
    let translatedPdfRelativePath: string | null = null;
    const runTranslationMock = vi.fn((onDone?: () => void) => {
      translatedPdfRelativePath = ".latotex/papers/demo.translated.pdf";
      onDone?.();
    });

    mocks.useLibraryDocumentData.mockImplementation(() => ({
        loading: false,
        loadError: null,
        pdfPreviewRequested: true,
        pdfPreviewLoading: false,
        pdfPreviewError: null,
        citation: {
          sourcePath: "library/demo.bib",
          bibPath: "library/demo.bib",
          authors: ["Test Author"],
          urls: ["https://example.com/paper"],
          title: "Demo Paper",
        },
        paperPreview: null,
        paperPreviewLoading: false,
        paperPreviewError: null,
        bibPreview: "@article{demo,title={Demo Paper}}",
        resolvedLink: "https://example.com/paper",
        sourcePdfRelativePath: ".latotex/papers/demo.pdf",
        translatedPdfRelativePath,
        pdfCacheState: "ready",
        previewRevision: translatedPdfRelativePath ? 12 : 11,
        pdfDownloadedBytes: null,
        pdfTotalBytes: null,
        ensurePdfPreviewLoaded: ensurePdfPreviewLoadedMock,
        refresh: refreshMock,
        reset: resetMock,
      }));

    const translationPanelState = {
      translationBusy: false,
      translationNotice: { type: "info", message: "ready" },
      translationDetail: null,
      translationProgress: null,
      setTranslationNotice: vi.fn(),
      resetTranslationState: vi.fn(),
      runTranslation: runTranslationMock,
    };
    mocks.useLibraryTranslationPanel.mockImplementation(() => translationPanelState);

    await act(async () => {
      root.render(
        <LibraryDocumentViewer
          projectId="project-1"
          selectedPath="library/demo.bib"
          active
          onAnalyzePaper={() => undefined}
          analysisRunning={false}
          persistedViewMode="bib"
          translationModelId={null}
          paperBriefEngine="auto"
          t={(key) => String(key)}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const compareButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("title") === "library.viewer.translatePaper",
    );
    await act(async () => {
      compareButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ensurePdfPreviewLoadedMock).toHaveBeenCalledTimes(2);
    expect(ensurePdfPreviewLoadedMock).toHaveBeenNthCalledWith(1);
    expect(ensurePdfPreviewLoadedMock).toHaveBeenNthCalledWith(2, { bustCache: true });
    expect(runTranslationMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <LibraryDocumentViewer
          projectId="project-1"
          selectedPath="library/demo.bib"
          active
          onAnalyzePaper={() => undefined}
          analysisRunning={false}
          persistedViewMode="bib"
          translationModelId={null}
          paperBriefEngine="auto"
          t={(key) => String(key)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='library-viewer-content-panel']")?.getAttribute("data-view-mode"),
    ).toBe("compare");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
