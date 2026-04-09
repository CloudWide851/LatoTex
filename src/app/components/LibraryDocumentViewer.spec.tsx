// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, readFileBinary, writeFile } from "../../shared/api/workspace";
import { LibraryDocumentViewer } from "./LibraryDocumentViewer";

const mocks = vi.hoisted(() => ({
  useLibraryDocumentData: vi.fn(),
  useLibraryTranslationPanel: vi.fn(),
  useLibraryPdfShortcuts: vi.fn(),
}));

vi.mock("../../shared/api/workspace", () => ({
  readFile: vi.fn(),
  readFileBinary: vi.fn(),
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
  const readFileBinaryMock = vi.mocked(readFileBinary);
  const writeFileMock = vi.mocked(writeFile);
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    if (typeof URL.createObjectURL !== "function") {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    }
    createObjectUrlSpy = vi.spyOn(URL, "createObjectURL");
    readFileMock.mockResolvedValue({
      relativePath: ".latotex/annotations/demo.json",
      content: "{\"version\":4,\"strokes\":[],\"textBoxes\":[]}",
    });
    writeFileMock.mockResolvedValue({
      ok: true,
      message: "saved",
    });
    readFileBinaryMock.mockResolvedValue({
      relativePath: ".latotex/papers/demo.pdf",
      bytes: [0x25, 0x50, 0x44, 0x46],
    });
    createObjectUrlSpy.mockReturnValue("blob:library-document-pdf");

    mocks.useLibraryDocumentData.mockReturnValue({
      loading: false,
      loadError: null,
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
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    });
    mocks.useLibraryTranslationPanel.mockReturnValue({
      translationBusy: false,
      translationNotice: null,
      translationDetail: null,
      translationProgress: null,
      setTranslationNotice: vi.fn(),
      resetTranslationState: vi.fn(),
      runTranslation: vi.fn(),
    });
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
          t={(key) => String(key)}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const viewer = container.querySelector("[data-testid='library-viewer-content-panel']");
    expect(readFileBinaryMock).toHaveBeenCalledWith(
      "project-1",
      ".latotex/papers/demo.pdf",
    );
    expect(viewer?.getAttribute("data-pdf-url")).toBe("blob:library-document-pdf");
    expect(viewer?.getAttribute("data-loading")).toBe("false");
    expect(viewer?.getAttribute("data-bib-preview")).toBe("@article{demo,title={Demo Paper}}");

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
});
