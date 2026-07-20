// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShareControl } from "./WorkspaceShareControl";

describe("WorkspaceShareControl", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens the share panel while a share action is busy", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkspaceShareControl
          selectedFile="main.tex"
          shareSession={null}
          sharePassword={null}
          shareBusy
          shareSyncing={false}
          shareConflict={null}
          shareMode="remote"
          shareSessionName=""
          onShareModeChange={() => undefined}
          onShareSessionNameChange={() => undefined}
          onShareStart={() => undefined}
          onShareStop={() => undefined}
          onShareRefresh={() => undefined}
          onSharePasswordReveal={async () => "password"}
          onShareConflictResolve={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    const trigger = container.querySelector("button[aria-label='share.openPanel']") as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger?.disabled).toBe(false);

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("share.panelTitle");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("maps tunnel failures without exposing the backend error", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkspaceShareControl
          selectedFile="main.tex"
          shareSession={{
            active: true,
            sessionId: "session-1",
            status: "failed",
            tunnelError: "cloudflared: bearer token secret leaked",
          }}
          sharePassword={null}
          shareBusy={false}
          shareSyncing={false}
          shareConflict={null}
          shareMode="remote"
          shareSessionName=""
          onShareModeChange={() => undefined}
          onShareSessionNameChange={() => undefined}
          onShareStart={() => undefined}
          onShareStop={() => undefined}
          onShareRefresh={() => undefined}
          onSharePasswordReveal={async () => "password"}
          onShareConflictResolve={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    const trigger = container.querySelector("button[aria-label='share.openPanel']") as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("share.status.failed");
    expect(container.textContent).not.toContain("bearer token secret leaked");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
