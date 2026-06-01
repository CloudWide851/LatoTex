import { describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import {
  buildDrawExportAction,
  decodeDrawExportPayload,
  DRAWIO_LOCAL_RESOURCE_HOST_URL,
  isDrawImageExportFormat,
  mergeDrawExportRequest,
  persistDrawExportToWorkspace,
  resolveDrawioHostFrameSrc,
  shouldClearPendingDrawExport,
  toDrawExportDialogDefaults,
  toDrawExportTarget,
} from "./drawWorkspaceUtils";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => true),
}));

describe("drawWorkspaceUtils", () => {
  it("uses the canonical local-resource DrawIO host in desktop runtime", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    await expect(resolveDrawioHostFrameSrc()).resolves.toBe(DRAWIO_LOCAL_RESOURCE_HOST_URL);
  });

  it("uses the dev-host DrawIO URL outside desktop runtime", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(resolveDrawioHostFrameSrc()).resolves.toBe("/drawio/index.html");
  });

  it("routes exported assets into the drawings folder", () => {
    expect(toDrawExportTarget("notes/demo.drawio", "png")).toBe("drawings/demo.png");
    expect(toDrawExportTarget("drawings/demo.drawio", "svg")).toBe("drawings/demo.svg");
  });

  it("derives save-dialog defaults from the project drawings folder", () => {
    expect(toDrawExportDialogDefaults("notes/demo.drawio", "png")).toEqual({
      defaultRelativeDir: "drawings",
      defaultFileName: "demo.png",
    });
    expect(toDrawExportDialogDefaults("drawings/sub/demo.drawio", "svg", "custom-name")).toEqual({
      defaultRelativeDir: "drawings/sub",
      defaultFileName: "custom-name.svg",
    });
  });

  it("falls back to the active draw file name when draw.io proposes a hidden export name", () => {
    expect(toDrawExportTarget("drawings/demo.drawio", "png", ".drawio.png")).toBe("drawings/demo.png");
    expect(toDrawExportDialogDefaults("notes/demo.drawio", "png", ".drawio.png")).toEqual({
      defaultRelativeDir: "drawings",
      defaultFileName: "demo.png",
    });
  });

  it("supports plain-text export payloads when draw.io does not send base64", async () => {
    const saveAsset = vi.fn().mockImplementation(async (path: string) => path);
    const onAfterSave = vi.fn();

    const savedPath = await persistDrawExportToWorkspace({
      activePath: "notes/demo.drawio",
      message: {
        event: "export",
        format: "svg",
        mime: "image/svg+xml",
        base64: false,
        filename: "diagram-export",
        data: "<svg><text>demo</text></svg>",
      },
      saveAsset,
      onAfterSave,
    });

    expect(savedPath).toBe("drawings/diagram-export.svg");
    expect(saveAsset).toHaveBeenCalledWith(
      "drawings/diagram-export.svg",
      new TextEncoder().encode("<svg><text>demo</text></svg>"),
    );
    expect(onAfterSave).toHaveBeenCalledWith("drawings/diagram-export.svg");
  });

  it("can still decode base64 image export payloads", () => {
    const decoded = decodeDrawExportPayload({
      event: "export",
      mime: "image/png",
      data: btoa("png-bytes"),
    });

    expect(decoded.mime).toBe("image/png");
    expect(Array.from(decoded.bytes)).toEqual(Array.from(new TextEncoder().encode("png-bytes")));
  });

  it("builds an embed export action from the requested draw.io image options", () => {
    expect(isDrawImageExportFormat("png")).toBe(true);
    expect(isDrawImageExportFormat("svg")).toBe(false);
    expect(buildDrawExportAction({
      format: "PNG",
      filename: "diagram-export",
      scale: 2,
      border: 12,
      dpi: 144,
      grid: true,
      background: null,
      pageId: "page-2",
      currentPage: false,
      allPages: true,
      embedImages: true,
      shadow: false,
    })).toEqual({
      action: "export",
      format: "png",
      currentPage: false,
      spinKey: "exporting",
      scale: 2,
      border: 12,
      dpi: 144,
      grid: true,
      background: "none",
      pageId: "page-2",
      allPages: true,
      embedImages: true,
      shadow: false,
    });
  });

  it("merges a pending export request into the final draw.io export payload", () => {
    expect(mergeDrawExportRequest(
      {
        event: "export",
        data: "payload",
      },
      {
        filename: "diagram-export",
        format: "png",
      },
    )).toMatchObject({
      event: "export",
      data: "payload",
      filename: "diagram-export",
      format: "png",
    });

    expect(mergeDrawExportRequest(
      {
        event: "export",
        data: "payload",
        filename: "real-name.png",
        format: "jpg",
      },
      {
        filename: "fallback-name",
        format: "png",
      },
    )).toMatchObject({
      filename: "real-name.png",
      format: "jpg",
    });
  });

  it("does not clear a pending image export on intermediate status messages", () => {
    expect(shouldClearPendingDrawExport(
      { format: "png", filename: "diagram-export" },
      { event: "status", message: "exporting" },
    )).toBe(false);

    expect(shouldClearPendingDrawExport(
      { format: "png", filename: "diagram-export" },
      { event: "error", error: "failed" },
    )).toBe(true);
  });
});
