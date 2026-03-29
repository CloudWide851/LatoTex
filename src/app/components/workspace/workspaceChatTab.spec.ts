import { describe, expect, it, vi } from "vitest";
import { buildNewChatTabState } from "./workspaceChatTab";

describe("workspaceChatTab", () => {
  it("does not create a session when there is no active project", () => {
    const createSession = vi.fn();

    const next = buildNewChatTabState(null, "New Chat", createSession);

    expect(next).toBeNull();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates and opens a new session using the active session title", () => {
    const createSession = vi.fn(() => ({
      sessions: [
        { id: "chat-2", title: "Older Chat" },
        { id: "chat-3", title: "New Chat" },
      ],
      activeSessionId: "chat-3",
    }));

    const next = buildNewChatTabState("project-1", "New Chat", createSession);

    expect(createSession).toHaveBeenCalledWith("project-1", "New Chat");
    expect(next).toEqual({
      chatTabOpen: true,
      chatTabActive: true,
      chatTabTitle: "New Chat",
    });
  });
});
