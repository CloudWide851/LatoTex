// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawWorkspaceTabs } from "./DrawWorkspaceTabs";

describe("DrawWorkspaceTabs", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("closes tabs without invoking file deletion flows", async () => {
    const onClosePath = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DrawWorkspaceTabs
          tabPaths={["drawings/demo.drawio"]}
          activePath="drawings/demo.drawio"
          renamingPath={null}
          renameInput=""
          busy={false}
          status=""
          onRenameInputChange={() => undefined}
          onSelectPath={() => undefined}
          onStartRename={() => undefined}
          onCancelRename={() => undefined}
          onCommitRename={() => undefined}
          onClosePath={onClosePath}
          onCreateNewTab={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    const closeButton = container.querySelector("button[aria-label='common.close']");
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClosePath).toHaveBeenCalledWith("drawings/demo.drawio");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
