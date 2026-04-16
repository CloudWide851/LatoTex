// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  libraryCitationSummary,
  libraryCitationSummaryRemote,
  libraryResolvePdfPreview,
} from "../../../shared/api/library";
import type { LibraryPdfPreview } from "../../../shared/types/app";
import { readFile } from "../../../shared/api/workspace";
import { useLibraryDocumentData } from "./useLibraryDocumentData";

vi.mock("../../../shared/api/library", () => ({
  libraryCitationSummary: vi.fn(),
  libraryCitationSummaryRemote: vi.fn(),
  libraryResolvePdfPreview: vi.fn(),
}));

vi.mock("../../../shared/api/workspace", () => ({
  readFile: vi.fn(),
}));

type ProbeProps = {
  projectId: string | null;
  selectedPath: string | null;
  active: boolean;
};

function HookProbe(props: ProbeProps) {
  const state = useLibraryDocumentData(props);
  return (
    <>
      <button
        type="button"
        data-testid="ensure-pdf"
        onClick={() => {
          void state.ensurePdfPreviewLoaded();
        }}
      >
        ensure
      </button>
      <button
        type="button"
        data-testid="retry-pdf"
        onClick={() => {
          void state.retryPdfPreview();
        }}
      >
        retry
      </button>
      <pre data-testid="hook-state">{JSON.stringify(state)}</pre>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork(rounds = 3) {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
    }
  });
}

async function renderProbe(props: ProbeProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<HookProbe {...props} />);
  });
  return {
    container,
    root,
    rerender: async (nextProps: ProbeProps) => {
      await act(async () => {
        root.render(<HookProbe {...nextProps} />);
      });
    },
  };
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

describe("useLibraryDocumentData", () => {
  const libraryCitationSummaryMock = vi.mocked(libraryCitationSummary);
  const libraryCitationSummaryRemoteMock = vi.mocked(libraryCitationSummaryRemote);
  const libraryResolvePdfPreviewMock = vi.mocked(libraryResolvePdfPreview);
  const readFileMock = vi.mocked(readFile);

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    libraryCitationSummaryRemoteMock.mockResolvedValue({
      sourcePath: "demo.bib",
      bibPath: "demo.bib",
      authors: ["Remote Author"],
      urls: ["https://example.com/demo"],
      title: "Remote Demo",
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("commits local citation and bib data before the background PDF preview finishes", async () => {
    const previewDeferred = deferred<LibraryPdfPreview>();

    libraryCitationSummaryMock.mockResolvedValue({
      sourcePath: "demo.bib",
      bibPath: "demo.bib",
      authors: ["Local Author"],
      urls: ["https://example.com/demo"],
      title: "Local Demo",
    });
    readFileMock.mockResolvedValue({
      relativePath: ".latotex/papers/demo.bib",
      content: "@article{demo,title={Local Demo}}",
    });
    libraryResolvePdfPreviewMock.mockImplementation(() => previewDeferred.promise);

    const view = await renderProbe({
      projectId: "project-1",
      selectedPath: "demo.bib",
      active: true,
    });

    await flushAsyncWork();

    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      loadError: null,
      pdfPreviewLoading: false,
      pdfPreviewRequested: false,
      bibPreview: "@article{demo,title={Local Demo}}",
    });
    expect(readFileMock).toHaveBeenCalledWith("project-1", ".latotex/papers/demo.bib");
    expect(libraryResolvePdfPreviewMock).toHaveBeenCalledWith(
      "project-1",
      "demo.bib",
      { bustCache: false },
    );

    await act(async () => {
      view.container
        .querySelector("[data-testid='ensure-pdf']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushAsyncWork();

    expect(readProbeState(view.container)).toMatchObject({
      pdfPreviewLoading: true,
      pdfPreviewRequested: true,
    });
    expect(libraryResolvePdfPreviewMock).toHaveBeenCalledTimes(1);

    previewDeferred.resolve({
      relativePath: ".latotex/papers/demo.pdf",
      translatedRelativePath: null,
      sourceUrl: "https://example.com/demo.pdf",
      cached: true,
      cacheState: "ready",
      cacheError: null,
      downloadedBytes: 120,
      totalBytes: 120,
    });

    await flushAsyncWork();

    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      pdfPreviewLoading: false,
      pdfPreviewRequested: true,
      pdfCacheState: "ready",
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
      resolvedLink: "https://example.com/demo",
    });

    await unmountProbe(view.root, view.container);
  });

  it("reads the mapped bib preview even when the selected library entry is a PDF", async () => {
    libraryCitationSummaryMock.mockResolvedValue({
      sourcePath: "demo.pdf",
      bibPath: "demo.bib",
      authors: ["Pdf Author"],
      urls: ["https://example.com/pdf"],
      title: "PDF-backed Demo",
    });
    readFileMock.mockResolvedValue({
      relativePath: ".latotex/papers/demo.bib",
      content: "@article{demo,title={PDF-backed Demo}}",
    });
    libraryResolvePdfPreviewMock.mockResolvedValue({
      relativePath: ".latotex/papers/demo.pdf",
      translatedRelativePath: null,
      sourceUrl: "https://example.com/pdf",
      cached: true,
      cacheState: "ready",
      cacheError: null,
      downloadedBytes: 88,
      totalBytes: 88,
    });

    const view = await renderProbe({
      projectId: "project-1",
      selectedPath: "demo.pdf",
      active: true,
    });

    await flushAsyncWork();

    expect(readFileMock).toHaveBeenCalledWith("project-1", ".latotex/papers/demo.bib");
    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      bibPreview: "@article{demo,title={PDF-backed Demo}}",
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
      pdfCacheState: "ready",
    });
    expect(libraryResolvePdfPreviewMock).toHaveBeenCalledWith(
      "project-1",
      "demo.pdf",
      { bustCache: false },
    );

    await unmountProbe(view.root, view.container);
  });

  it("ignores stale results after the selected document changes", async () => {
    const firstCitation = deferred<{
      sourcePath: string;
      bibPath: string;
      authors: string[];
      urls: string[];
      title: string;
    }>();

    libraryCitationSummaryMock.mockImplementation(async (_projectId, relativePath) => {
      if (relativePath === "old.bib") {
        return await firstCitation.promise;
      }
      return {
        sourcePath: "new.bib",
        bibPath: "new.bib",
        authors: ["New Author"],
        urls: ["https://example.com/new"],
        title: "New Demo",
      };
    });
    readFileMock.mockImplementation(async (_projectId, relativePath) => ({
      relativePath,
      content: relativePath.endsWith("new.bib")
        ? "@article{new,title={New Demo}}"
        : "@article{old,title={Old Demo}}",
    }));
    libraryResolvePdfPreviewMock.mockImplementation(async (_projectId, relativePath) => ({
      relativePath: relativePath === "new.bib" ? ".latotex/papers/new.pdf" : ".latotex/papers/old.pdf",
      translatedRelativePath: null,
      sourceUrl: `https://example.com/${relativePath}`,
      cached: true,
      cacheState: "ready",
      cacheError: null,
      downloadedBytes: 64,
      totalBytes: 64,
    }));

    const view = await renderProbe({
      projectId: "project-1",
      selectedPath: "old.bib",
      active: true,
    });

    await view.rerender({
      projectId: "project-1",
      selectedPath: "new.bib",
      active: true,
    });

    await flushAsyncWork();

    firstCitation.resolve({
      sourcePath: "old.bib",
      bibPath: "old.bib",
      authors: ["Old Author"],
      urls: ["https://example.com/old"],
      title: "Old Demo",
    });

    await flushAsyncWork();

    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      bibPreview: "@article{new,title={New Demo}}",
      sourcePdfRelativePath: ".latotex/papers/new.pdf",
      resolvedLink: "https://example.com/new",
    });
    expect(libraryResolvePdfPreviewMock).toHaveBeenCalledWith(
      "project-1",
      "new.bib",
      { bustCache: false },
    );

    await unmountProbe(view.root, view.container);
  });

  it("keeps paper preview state empty so PDF text extraction can stay on the frontend", async () => {
    libraryCitationSummaryMock.mockResolvedValue({
      sourcePath: "empty-preview.bib",
      bibPath: "empty-preview.bib",
      authors: ["Author"],
      urls: ["https://example.com/demo"],
      title: "Demo Paper",
    });
    readFileMock.mockResolvedValue({
      relativePath: ".latotex/papers/empty-preview.bib",
      content: "@article{demo,title={Demo Paper}}",
    });
    libraryResolvePdfPreviewMock.mockResolvedValue({
      relativePath: ".latotex/papers/empty-preview.pdf",
      translatedRelativePath: null,
      sourceUrl: "https://example.com/demo.pdf",
      cached: true,
      cacheState: "ready",
      cacheError: null,
      downloadedBytes: 10,
      totalBytes: 10,
    });

    const view = await renderProbe({
      projectId: "project-1",
      selectedPath: "empty-preview.bib",
      active: true,
    });

    await flushAsyncWork(5);

    expect(readProbeState(view.container)).toMatchObject({
      paperPreviewLoading: false,
      paperPreviewError: null,
      paperPreview: null,
      sourcePdfRelativePath: ".latotex/papers/empty-preview.pdf",
    });
    expect(libraryResolvePdfPreviewMock).toHaveBeenCalledWith(
      "project-1",
      "empty-preview.bib",
      { bustCache: false },
    );

    await unmountProbe(view.root, view.container);
  });

  it("retries a failed pdf preview with bust-cache enabled", async () => {
    libraryCitationSummaryMock.mockResolvedValue({
      sourcePath: "retry-demo.bib",
      bibPath: "retry-demo.bib",
      authors: ["Retry Author"],
      urls: ["https://example.com/retry"],
      title: "Retry Demo",
    });
    readFileMock.mockResolvedValue({
      relativePath: ".latotex/papers/retry-demo.bib",
      content: "@article{retry,title={Retry Demo}}",
    });
    libraryResolvePdfPreviewMock
      .mockResolvedValueOnce({
        relativePath: null,
        translatedRelativePath: null,
        sourceUrl: "https://example.com/retry.pdf",
        cached: false,
        cacheState: "error",
        cacheError: "HTTP 403",
        downloadedBytes: 0,
        totalBytes: null,
      })
      .mockResolvedValueOnce({
        relativePath: ".latotex/papers/.cache/remote-pdf/retry.pdf",
        translatedRelativePath: null,
        sourceUrl: "https://example.com/retry.pdf",
        cached: true,
        cacheState: "ready",
        cacheError: null,
        downloadedBytes: 64,
        totalBytes: 64,
      });

    const view = await renderProbe({
      projectId: "project-1",
      selectedPath: "retry-demo.bib",
      active: true,
    });

    await flushAsyncWork(5);

    expect(readProbeState(view.container)).toMatchObject({
      pdfCacheState: "error",
      pdfPreviewError: "HTTP 403",
    });

    await act(async () => {
      view.container
        .querySelector("[data-testid='retry-pdf']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushAsyncWork(5);

    expect(libraryResolvePdfPreviewMock).toHaveBeenLastCalledWith(
      "project-1",
      "retry-demo.bib",
      { bustCache: true },
    );
    expect(readProbeState(view.container)).toMatchObject({
      pdfCacheState: "ready",
      sourcePdfRelativePath: ".latotex/papers/.cache/remote-pdf/retry.pdf",
      pdfPreviewError: null,
    });

    await unmountProbe(view.root, view.container);
  });
});
