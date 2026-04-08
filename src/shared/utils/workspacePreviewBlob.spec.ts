import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileBinary } from "../api/workspace";
import {
  buildWorkspacePreviewBlobUrl,
  revokeObjectUrl,
} from "./workspacePreviewBlob";

vi.mock("../api/workspace", () => ({
  readFileBinary: vi.fn(),
}));

describe("workspacePreviewBlob", () => {
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
    vi.restoreAllMocks();
  });

  it("builds a blob url from backend binary PDF bytes", async () => {
    readFileBinaryMock.mockResolvedValue({
      relativePath: ".latotex/papers/demo.pdf",
      bytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
    });
    createObjectUrlSpy.mockReturnValue("blob:workspace-preview");

    const result = await buildWorkspacePreviewBlobUrl(
      "project-1",
      ".latotex/papers/demo.pdf",
    );

    expect(result).toBe("blob:workspace-preview");
    expect(readFileBinaryMock).toHaveBeenCalledWith(
      "project-1",
      ".latotex/papers/demo.pdf",
    );
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const pdfBlob = createObjectUrlSpy.mock.calls[0]?.[0];
    expect(pdfBlob).toBeInstanceOf(Blob);
    if (!(pdfBlob instanceof Blob)) {
      throw new Error("expected Blob payload");
    }
    expect(pdfBlob.type).toBe("application/pdf");
    expect(Array.from(new Uint8Array(await pdfBlob.arrayBuffer()))).toEqual([
      0x25,
      0x50,
      0x44,
      0x46,
      0x2d,
    ]);
  });

  it("returns null without touching the backend when inputs are incomplete", async () => {
    expect(await buildWorkspacePreviewBlobUrl(null, ".latotex/papers/demo.pdf")).toBeNull();
    expect(await buildWorkspacePreviewBlobUrl("project-1", null)).toBeNull();
    expect(readFileBinaryMock).not.toHaveBeenCalled();
    expect(createObjectUrlSpy).not.toHaveBeenCalled();
  });

  it("revokes only blob urls", () => {
    revokeObjectUrl("blob:workspace-preview");
    revokeObjectUrl("http://latotex-resource.localhost/workspace-file/demo/out.pdf");

    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:workspace-preview");
  });
});
