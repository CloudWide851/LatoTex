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
  libraryExtractPaperContext: vi.fn(),
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
  return <pre data-testid="hook-state">{JSON.stringify(state)}</pre>;
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

  it("commits local citation and bib data before the PDF preview finishes", async () => {
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
      pdfPreviewLoading: true,
      bibPreview: "@article{demo,title={Local Demo}}",
    });
    expect(readFileMock).toHaveBeenCalledWith("project-1", ".latotex/papers/demo.bib");

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
      pdfCacheState: "ready",
      sourcePdfRelativePath: ".latotex/papers/demo.pdf",
      resolvedLink: "https://example.com/demo.pdf",
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
      resolvedLink: "https://example.com/new.bib",
    });

    await unmountProbe(view.root, view.container);
  });
});
