// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspaceComposer } from "./ChatWorkspaceComposer";

describe("ChatWorkspaceComposer", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("sends on Enter, preserves Shift+Enter, and exposes explicit file context", async () => {
    const onSend = vi.fn();
    const onDraftChange = vi.fn();
    const onContextScopeChange = vi.fn();
    await act(async () => {
      root.render(
        <ChatWorkspaceComposer
          draft="Trace this claim"
          running={false}
          lastError=""
          agentPhase="idle"
          agentProposal={null}
          agentPendingAction={null}
          mode="research"
          contextScope="conversation"
          selectedFile="main.tex"
          onDraftChange={onDraftChange}
          onSend={onSend}
          onSendTeams={vi.fn()}
          onStop={vi.fn()}
          onModeChange={vi.fn()}
          onContextScopeChange={onContextScopeChange}
          t={(key) => String(key)}
        />,
      );
    });

    const textarea = container.querySelector("textarea");
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });
    expect(onSend).toHaveBeenCalledTimes(1);

    const attach = container.querySelector('button[aria-label="chat.attachCurrentFile"]');
    await act(async () => attach?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onContextScopeChange).toHaveBeenCalledWith("current-file");
  });
});
