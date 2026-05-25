// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePdfPaperPreview } from "./usePdfPaperPreview";
import type { WorkspacePreviewBinarySource } from "../../../shared/utils/workspacePreviewBlob";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  ensureReactPdfWorker: vi.fn(),
}));

vi.mock("react-pdf", () => ({
  pdfjs: {
    GlobalWorkerOptions: {},
    getDocument: mocks.getDocument,
  },
}));

vi.mock("../pdf/reactPdfSetup", () => ({
  ensureReactPdfWorker: mocks.ensureReactPdfWorker,
}));

function HookProbe(props: {
  pdfUrl: string | null;
  pdfSource?: WorkspacePreviewBinarySource | null;
  fallbackTitle?: string | null;
}) {
  const state = usePdfPaperPreview(props);
  return <pre data-testid="hook-state">{JSON.stringify(state)}</pre>;
}

async function renderProbe(props: {
  pdfUrl: string | null;
  pdfSource?: WorkspacePreviewBinarySource | null;
  fallbackTitle?: string | null;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<HookProbe {...props} />);
  });
  return {
    container,
    root,
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

describe("usePdfPaperPreview", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("extracts the abstract-like excerpt from the frontend PDF chain", async () => {
    const destroyMock = vi.fn().mockResolvedValue(undefined);
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn(async (pageNumber: number) => ({
          getTextContent: vi.fn(async () => ({
            items: pageNumber === 1
              ? [{ str: "Demo Paper" }, { str: "Abstract This paper proposes a fast local preview pipeline." }]
              : [{ str: "Introduction More detail here." }],
          })),
        })),
      }),
      destroy: destroyMock,
    });

    const view = await renderProbe({
      pdfUrl: "blob:demo-paper",
      fallbackTitle: "Demo Paper",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.ensureReactPdfWorker).toHaveBeenCalled();
    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      error: null,
      paperPreview: {
        title: "Demo Paper",
        extractionEngine: "pdfjs",
        pageCount: 2,
        excerpt: "This paper proposes a fast local preview pipeline.",
      },
    });
    expect(destroyMock).toHaveBeenCalled();

    await unmountProbe(view.root, view.container);
  });

  it("ends loading with an error when PDF extraction fails", async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error("pdf failed")),
      destroy: vi.fn().mockResolvedValue(undefined),
    });

    const view = await renderProbe({
      pdfUrl: "blob:broken-paper",
      fallbackTitle: "Broken Paper",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      paperPreview: null,
      error: "Error: pdf failed",
    });

    await unmountProbe(view.root, view.container);
  });

  it("clones source bytes before passing them to pdfjs", async () => {
    const sourceBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const destroyMock = vi.fn().mockResolvedValue(undefined);
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getTextContent: vi.fn(async () => ({
            items: [{ str: "Abstract Cloned preview text is readable." }],
          })),
        })),
      }),
      destroy: destroyMock,
    });

    const view = await renderProbe({
      pdfUrl: "blob:demo-paper",
      pdfSource: {
        relativePath: ".latotex/papers/demo.pdf",
        objectUrl: "blob:demo-paper",
        bytes: sourceBytes,
      },
      fallbackTitle: "Demo Paper",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = mocks.getDocument.mock.calls[0]?.[0] as { data?: Uint8Array };
    expect(input.data).toBeInstanceOf(Uint8Array);
    expect(input.data).not.toBe(sourceBytes);
    expect(Array.from(input.data ?? [])).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(readProbeState(view.container)).toMatchObject({
      loading: false,
      error: null,
    });

    await unmountProbe(view.root, view.container);
  });
});
