// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmEvent } from "../../../shared/types/app";
import { ChatWorkspace } from "./ChatWorkspace";

vi.mock("../../../shared/api/agent", () => ({
  executeWorkflowCancel: vi.fn(),
  getEvents: vi.fn(),
  startChatWorkflow: vi.fn(),
}));

vi.mock("../../../shared/api/runtime", () => ({
  runtimeLogWrite: vi.fn(),
}));

vi.mock("../../../shared/api/share", () => ({
  channelsTelegramPoll: vi.fn(),
  channelsTelegramSend: vi.fn(),
}));

import { getEvents } from "../../../shared/api/agent";

function makeEvent(overrides: Partial<SwarmEvent>): SwarmEvent {
  return {
    seq: 1,
    id: "evt-1",
    runId: "run-1",
    projectId: "project-1",
    role: "latex.overlay",
    kind: "a2a.task.completed",
    payload: {
      cardKey: "edit-card",
      stage: "edit",
      source: "agent",
      status: "success",
      title: "Applied edit",
      content: "path: main.tex",
      artifactRefs: ["file:main.tex"],
    },
    createdAt: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("ChatWorkspace", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    if (!HTMLElement.prototype.scrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        value: vi.fn(),
      });
    }
    window.localStorage.clear();
    vi.mocked(getEvents).mockResolvedValue({
      events: [makeEvent({})],
      nextCursor: 1,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("hydrates persisted agent operation cards from saved chat run ids", async () => {
    window.localStorage.setItem(
      "latotex.chat.sessions.project-1",
      JSON.stringify({
        activeSessionId: "chat-1",
        sessions: [
          {
            id: "chat-1",
            title: "Saved chat",
            createdAt: "2026-05-19T00:00:00.000Z",
            updatedAt: "2026-05-19T00:00:00.000Z",
            messages: [
              {
                id: "a-1",
                role: "assistant",
                text: "Done",
                createdAt: "2026-05-19T00:00:00.000Z",
                runId: "run-1",
              },
            ],
          },
        ],
      }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ChatWorkspace projectId="project-1" t={(key) => String(key)} />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getEvents).toHaveBeenCalledWith(0, 1000, "run-1", 0, ["agent.run.heartbeat"]);
    expect(container.textContent).toContain("Applied edit");
    expect(container.textContent).toContain("main.tex");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
