// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  libraryCitationResolve,
  libraryCitationSummary,
  libraryCitationSummaryRemote,
  libraryResolvePdfPreview,
} from "../../../shared/api/library";
import type { LibraryPdfPreview } from "../../../shared/types/app";
import { readFile } from "../../../shared/api/workspace";
import {
  clearLibraryDocumentDataCache,
  useLibraryDocumentData,
} from "./useLibraryDocumentData";

vi.mock("../../../shared/api/library", () => ({
  libraryCitationResolve: vi.fn(),
  libraryCitationSummary: vi.fn(),
  libraryCitationSummaryRemote: vi.fn(),
  libraryResolvePdfPreview: vi.fn(),
}));

vi.mock("../../../shared/api/workspace", () => ({
  readFile: vi.fn(),
}));

function HookProbe(props: {
  projectId: string | null;
  selectedPath: string | null;
  active: boolean;
}) {
  const state = useLibraryDocumentData(props);
  return (
    <>
      <button
        type="button"
        data-testid="refresh-cache"
        onClick={() => {
          void state.refresh({ preferCache: true });
        }}
      >
        refresh-cache
      </button>
      <button
        type="button"
        data-testid="refresh-live"
        onClick={() => {
          void state.refresh();
        }}
      >
        refresh-live
      </button>
      <pre data-testid="hook-state">{JSON.stringify(state)}</pre>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushAsyncWork(rounds = 3) {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
    }
  });
}

async function renderProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <HookProbe
        projectId="project-1"
        selectedPath="loading-loop.bib"
        active
      />,
    );
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

describe("useLibraryDocumentData loading-loop guards", () => {
  const libraryCitationSummaryMock = vi.mocked(libraryCitationSummary);
  const libraryCitationResolveMock = vi.mocked(libraryCitationResolve);
  const libraryCitationSummaryRemoteMock = vi.mocked(libraryCitationSummaryRemote);
  const libraryResolvePdfPreviewMock = vi.mocked(libraryResolvePdfPreview);
  const readFileMock = vi.mocked(readFile);

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    clearLibraryDocumentDataCache();
    libraryCitationResolveMock.mockRejectedValue(new Error("resolver fallback"));
    libraryCitationSummaryRemoteMock.mockResolvedValue({
      sourcePath: "loading-loop.bib",
      bibPath: "loading-loop.bib",
      authors: ["Remote Author"],
      urls: ["https://example.com/loading-loop"],
      title: "Loading Loop Remote",
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    clearLibraryDocumentDataCache();
    vi.restoreAllMocks();
  });

  it("does not advance the pdf preview revision for a same-document cache refresh", async () => {
    libraryCitationSummaryMock.mockResolvedValue({
      sourcePath: "loading-loop.bib",
      bibPath: "loading-loop.bib",
      authors: ["Cache Author"],
      urls: ["https://example.com/loading-loop"],
      title: "Loading Loop",
    });
    readFileMock.mockResolvedValue({
      relativePath: ".latotex/papers/loading-loop.bib",
      content: "@article{loadingLoop,title={Loading Loop}}",
    });
    libraryResolvePdfPreviewMock.mockResolvedValue({
      relativePath: ".latotex/papers/loading-loop.pdf",
      translatedRelativePath: null,
      sourceUrl: "https://example.com/loading-loop.pdf",
      cached: true,
      cacheState: "ready",
      cacheError: null,
      downloadedBytes: 42,
      totalBytes: 42,
    });

    const view = await renderProbe();
    await flushAsyncWork(5);

    const readyState = readProbeState(view.container);
    expect(readyState).toMatchObject({
      pdfCacheState: "ready",
      sourcePdfRelativePath: ".latotex/papers/loading-loop.pdf",
    });

    await act(async () => {
      view.container
        .querySelector("[data-testid='refresh-cache']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAsyncWork();

    expect(readProbeState(view.container).previewRevision).toBe(readyState.previewRevision);
    expect(libraryCitationSummaryMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(libraryResolvePdfPreviewMock).toHaveBeenCalledTimes(1);

    await unmountProbe(view.root, view.container);
  });

  it("keeps the ready local PDF path visible while same-document bib data refreshes", async () => {
    const secondPreview = deferred<LibraryPdfPreview>();
    libraryCitationSummaryMock
      .mockResolvedValueOnce({
        sourcePath: "loading-loop.bib",
        bibPath: "loading-loop.bib",
        authors: ["First Author"],
        urls: ["https://example.com/loading-loop"],
        title: "Loading Loop",
      })
      .mockResolvedValueOnce({
        sourcePath: "loading-loop.bib",
        bibPath: "loading-loop.bib",
        authors: ["Second Author"],
        urls: ["https://example.com/loading-loop"],
        title: "Loading Loop Updated",
      });
    readFileMock
      .mockResolvedValueOnce({
        relativePath: ".latotex/papers/loading-loop.bib",
        content: "@article{loadingLoop,title={Loading Loop}}",
      })
      .mockResolvedValueOnce({
        relativePath: ".latotex/papers/loading-loop.bib",
        content: "@article{loadingLoop,title={Loading Loop Updated}}",
      });
    libraryResolvePdfPreviewMock
      .mockResolvedValueOnce({
        relativePath: ".latotex/papers/loading-loop.pdf",
        translatedRelativePath: null,
        sourceUrl: "https://example.com/loading-loop.pdf",
        cached: true,
        cacheState: "ready",
        cacheError: null,
        downloadedBytes: 52,
        totalBytes: 52,
      })
      .mockImplementationOnce(() => secondPreview.promise);

    const view = await renderProbe();
    await flushAsyncWork(5);

    await act(async () => {
      view.container
        .querySelector("[data-testid='refresh-live']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAsyncWork();

    expect(readProbeState(view.container)).toMatchObject({
      bibPreview: "@article{loadingLoop,title={Loading Loop Updated}}",
      pdfCacheState: "ready",
      sourcePdfRelativePath: ".latotex/papers/loading-loop.pdf",
    });

    secondPreview.resolve({
      relativePath: ".latotex/papers/loading-loop.pdf",
      translatedRelativePath: null,
      sourceUrl: "https://example.com/loading-loop.pdf",
      cached: true,
      cacheState: "ready",
      cacheError: null,
      downloadedBytes: 52,
      totalBytes: 52,
    });
    await flushAsyncWork();

    await unmountProbe(view.root, view.container);
  });

  it("keeps an in-flight preview valid after a same-document cache refresh", async () => {
    const preview = deferred<LibraryPdfPreview>();
    libraryCitationSummaryMock.mockResolvedValue({
      sourcePath: "loading-loop.bib",
      bibPath: "loading-loop.bib",
      authors: ["Pending Author"],
      urls: ["https://example.com/loading-loop"],
      title: "Loading Loop Pending",
    });
    readFileMock.mockResolvedValue({
      relativePath: ".latotex/papers/loading-loop.bib",
      content: "@article{loadingLoop,title={Loading Loop Pending}}",
    });
    libraryResolvePdfPreviewMock.mockImplementationOnce(() => preview.promise);

    const view = await renderProbe();
    await flushAsyncWork();

    await act(async () => {
      view.container
        .querySelector("[data-testid='refresh-cache']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAsyncWork();

    preview.resolve({
      relativePath: ".latotex/papers/loading-loop.pdf",
      translatedRelativePath: null,
      sourceUrl: "https://example.com/loading-loop.pdf",
      cached: true,
      cacheState: "ready",
      cacheError: null,
      downloadedBytes: 52,
      totalBytes: 52,
    });
    await flushAsyncWork();

    expect(readProbeState(view.container)).toMatchObject({
      pdfCacheState: "ready",
      sourcePdfRelativePath: ".latotex/papers/loading-loop.pdf",
    });
    expect(libraryResolvePdfPreviewMock).toHaveBeenCalledTimes(1);

    await unmountProbe(view.root, view.container);
  });
});
