// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawWorkspace } from "./DrawWorkspace";
import { readFile, writeFile } from "../../../shared/api/workspace";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({ locale: "en-US" }),
}));

vi.mock("../../../shared/api/runtime", () => ({
  runtimeLogWrite: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../shared/api/workspace", () => ({
  readFile: vi.fn(),
  workspaceExportAsset: vi.fn(),
  writeFile: vi.fn(() => Promise.resolve()),
}));

describe("DrawWorkspace", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.mocked(writeFile).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function renderWorkspace(selectedPath = "drawings/demo.drawio") {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelectPath = vi.fn();

    act(() => {
      root.render(
        <DrawWorkspace
          projectId="project-1"
          selectedPath={selectedPath}
          onSelectPath={onSelectPath}
          onRunFsAction={() => Promise.resolve(true)}
          t={(key) => String(key)}
        />,
      );
    });

    return { container, root, onSelectPath };
  }

  it("removes a stale draw tab when the selected file is missing", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT: file not found"));
    const { container, root, onSelectPath } = renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("draw.noTabs");
    expect(container.textContent).toContain("draw.fileMissingRemoved");
    expect(onSelectPath).toHaveBeenLastCalledWith(null);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("persists DrawIO save messages to the active draw file", async () => {
    vi.mocked(readFile).mockResolvedValue({ path: "drawings/demo.drawio", content: "<mxfile />" } as never);
    const { container, root } = renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    const iframe = container.querySelector("iframe") as HTMLIFrameElement | null;
    expect(iframe?.contentWindow).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ event: "init" }),
        source: iframe!.contentWindow,
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ event: "save", xml: "<mxfile>saved</mxfile>" }),
        source: iframe!.contentWindow,
      }));
      await Promise.resolve();
    });

    expect(writeFile).toHaveBeenCalledWith("project-1", "drawings/demo.drawio", "<mxfile>saved</mxfile>");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
