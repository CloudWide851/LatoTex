// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePdfPaperPreview } from "./usePdfPaperPreview";

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

function HookProbe(props: { pdfUrl: string | null; fallbackTitle?: string | null }) {
  const state = usePdfPaperPreview(props);
  return <pre data-testid="hook-state">{JSON.stringify(state)}</pre>;
}

async function renderProbe(props: { pdfUrl: string | null; fallbackTitle?: string | null }) {
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
});
