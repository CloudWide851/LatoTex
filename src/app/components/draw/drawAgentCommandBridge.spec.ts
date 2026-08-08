import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerDrawAgentExportOwner,
  requestDrawAgentExport,
} from "./drawAgentCommandBridge";

let unregister: (() => void) | null = null;

afterEach(() => {
  unregister?.();
  unregister = null;
  vi.restoreAllMocks();
});

describe("draw Agent command bridge", () => {
  it("keeps an export queued until the matching Draw owner is ready", async () => {
    const resultPromise = requestDrawAgentExport({
      sourcePath: "drawings/flow.drawio",
      format: "svg",
    });
    const execute = vi.fn().mockResolvedValue({ savedPath: "drawings/flow.svg" });

    unregister = registerDrawAgentExportOwner("drawings/other.drawio", execute);
    expect(execute).not.toHaveBeenCalled();
    unregister();
    unregister = registerDrawAgentExportOwner("drawings/flow.drawio", execute);

    await expect(resultPromise).resolves.toEqual({ savedPath: "drawings/flow.svg" });
    expect(execute).toHaveBeenCalledWith({ sourcePath: "drawings/flow.drawio", format: "svg" });
  });
});
