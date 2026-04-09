import { describe, expect, it, vi } from "vitest";
import {
  decodeDrawExportPayload,
  persistDrawExportToWorkspace,
  toDrawExportTarget,
} from "./drawWorkspaceUtils";

describe("drawWorkspaceUtils", () => {
  it("routes exported assets into the drawings folder", () => {
    expect(toDrawExportTarget("notes/demo.drawio", "png")).toBe("drawings/demo.png");
    expect(toDrawExportTarget("drawings/demo.drawio", "svg")).toBe("drawings/demo.svg");
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
});
