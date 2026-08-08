// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResearchChatStore: vi.fn(),
  migrateResearchChatStore: vi.fn(),
  replaceResearchChatStore: vi.fn(),
}));

vi.mock("../../shared/api/researchAgent", () => mocks);

import {
  hydrateChatStore,
  loadChatStore,
  saveChatStore,
  type ChatSession,
} from "./chatSessionStore";

function session(): ChatSession {
  return {
    id: "chat-session-1",
    title: "Private research chat",
    createdAt: "2026-08-07T00:00:00Z",
    updatedAt: "2026-08-07T00:01:00Z",
    messages: [
      {
        id: "chat-message-1",
        role: "user",
        text: "Sensitive manuscript claim",
        createdAt: "2026-08-07T00:00:30Z",
        runId: null,
      },
    ],
  };
}

function backendStore(migrationCompleted: boolean, sessions: ChatSession[] = []) {
  return {
    sessions,
    activeSessionId: sessions[0]?.id ?? null,
    migrationCompleted,
    diagnosticCode: null,
  };
}

describe("encrypted research chat migration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.getResearchChatStore.mockReset();
    mocks.migrateResearchChatStore.mockReset();
    mocks.replaceResearchChatStore.mockReset();
  });

  it("removes legacy plaintext only after encrypted readback verification succeeds", async () => {
    const projectId = "migration-success-project";
    const sessions = [session()];
    window.localStorage.setItem(
      `latotex.chat.sessions.${projectId}`,
      JSON.stringify({ sessions, activeSessionId: sessions[0]!.id }),
    );
    mocks.getResearchChatStore.mockResolvedValue(backendStore(false));
    mocks.migrateResearchChatStore.mockResolvedValue({
      migrated: true,
      verified: true,
      store: backendStore(true, sessions),
      diagnosticCode: null,
    });

    const hydrated = await hydrateChatStore(projectId);

    expect(hydrated.sessions).toEqual(sessions);
    expect(mocks.migrateResearchChatStore).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ sessions }),
    );
    expect(window.localStorage.getItem(`latotex.chat.sessions.${projectId}`)).toBeNull();
  });

  it("retains recoverable legacy plaintext when migration verification fails", async () => {
    const projectId = "migration-failure-project";
    const sessions = [session()];
    const storageKey = `latotex.chat.sessions.${projectId}`;
    window.localStorage.setItem(storageKey, JSON.stringify({ sessions, activeSessionId: sessions[0]!.id }));
    mocks.getResearchChatStore.mockResolvedValue(backendStore(false));
    mocks.migrateResearchChatStore.mockRejectedValue(
      new Error("research.migration.verification_failed"),
    );

    await expect(hydrateChatStore(projectId)).rejects.toThrow(
      "research.migration.verification_failed",
    );
    expect(window.localStorage.getItem(storageKey)).not.toBeNull();
    expect(loadChatStore(projectId).sessions).toEqual(sessions);
  });

  it("persists new chat state through the encrypted backend instead of localStorage", () => {
    const projectId = "encrypted-save-project";
    const sessions = [session()];
    mocks.replaceResearchChatStore.mockResolvedValue(backendStore(true, sessions));

    saveChatStore(projectId, sessions, sessions[0]!.id);

    expect(window.localStorage.getItem(`latotex.chat.sessions.${projectId}`)).toBeNull();
    expect(mocks.replaceResearchChatStore).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ sessions }),
    );
  });
});
