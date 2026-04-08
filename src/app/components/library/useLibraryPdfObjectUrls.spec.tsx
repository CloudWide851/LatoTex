// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileBinary } from "../../../shared/api/workspace";
import { useLibraryPdfObjectUrls } from "./useLibraryPdfObjectUrls";

vi.mock("../../../shared/api/workspace", () => ({
  readFileBinary: vi.fn(),
}));

type HookProbeProps = {
  projectId: string | null;
  previewRevision: number;
  cacheState: "ready" | "pending" | "error" | "missing";
  sourcePdfRelativePath: string | null;
  translatedPdfRelativePath: string | null;
};

function HookProbe(props: HookProbeProps) {
  const state = useLibraryPdfObjectUrls(props);
  return (
    <pre data-testid="hook-state">{JSON.stringify(state)}</pre>
  );
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderProbe(props: HookProbeProps) {
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

describe("useLibraryPdfObjectUrls", () => {
  const readFileBinaryMock = vi.mocked(readFileBinary);
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    if (typeof URL.createObjectURL !== "function") {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    }
    if (typeof URL.revokeObjectURL !== "function") {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    }
    createObjectUrlSpy = vi.spyOn(URL, "createObjectURL");
    revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("loads source and translated pdf object urls from backend bytes and revokes them on unmount", async () => {
    readFileBinaryMock.mockImplementation(async (_projectId, relativePath) => ({
      relativePath,
      bytes: relativePath.includes("translated")
        ? [0x25, 0x50, 0x44, 0x46, 0x2d, 0x54]
        : [0x25, 0x50, 0x44, 0x46, 0x2d, 0x53],
    }));
    createObjectUrlSpy
      .mockReturnValueOnce("blob:source-pdf")
      .mockReturnValueOnce("blob:translated-pdf");

    const view = await renderProbe({
      projectId: "project-1",
      previewRevision: 7,
      cacheState: "ready",
      sourcePdfRelativePath: ".latotex/papers/source.pdf",
      translatedPdfRelativePath: ".latotex/papers/source.translated.pdf",
    });

    await flushAsyncWork();

    const state = JSON.parse(
      view.container.querySelector("[data-testid='hook-state']")?.textContent || "{}",
    );

    expect(readFileBinaryMock).toHaveBeenNthCalledWith(
      1,
      "project-1",
      ".latotex/papers/source.pdf",
    );
    expect(readFileBinaryMock).toHaveBeenNthCalledWith(
      2,
      "project-1",
      ".latotex/papers/source.translated.pdf",
    );
    expect(state).toMatchObject({
      pdfUrl: "blob:source-pdf",
      translatedPdfUrl: "blob:translated-pdf",
      loading: false,
      error: null,
    });

    await unmountProbe(view.root, view.container);

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:source-pdf");
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:translated-pdf");
  });

  it("surfaces an explicit error when the backend bytes cannot be read", async () => {
    readFileBinaryMock.mockRejectedValue(new Error("workspace.file_read.access_denied"));

    const view = await renderProbe({
      projectId: "project-1",
      previewRevision: 8,
      cacheState: "ready",
      sourcePdfRelativePath: ".latotex/papers/denied.pdf",
      translatedPdfRelativePath: null,
    });

    await flushAsyncWork();

    const state = JSON.parse(
      view.container.querySelector("[data-testid='hook-state']")?.textContent || "{}",
    );

    expect(state.pdfUrl).toBeNull();
    expect(state.loading).toBe(false);
    expect(String(state.error)).toContain("workspace.file_read.access_denied");

    await unmountProbe(view.root, view.container);
  });
});
