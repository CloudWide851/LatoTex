// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { ownerAuthMock } = vi.hoisted(() => ({
  ownerAuthMock: vi.fn(),
}));

vi.mock("../../shared/api/share", () => ({
  shareSessionOwnerAuth: ownerAuthMock,
}));

import {
  authenticatedDesktopShareFetch,
  clearDesktopShareAuth,
  primeDesktopShareAuth,
} from "./shareHttpAuth";

const session = {
  active: true,
  localUrl: "http://127.0.0.1:43123",
  sessionId: "session-1",
};

describe("desktop share owner auth", () => {
  beforeEach(() => {
    clearDesktopShareAuth();
    ownerAuthMock.mockReset();
    vi.restoreAllMocks();
  });

  it("uses the one-time create credential without joining with the password", async () => {
    primeDesktopShareAuth(session, {
      participantId: "owner-session-1",
      participantToken: "token-create",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await authenticatedDesktopShareFetch(session, "/api/snapshot");

    expect(ownerAuthMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeInstanceOf(Headers);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("Authorization"))
      .toBe("Bearer token-create");
  });

  it("rehydrates and rotates owner auth after reload or a rejected token", async () => {
    ownerAuthMock
      .mockResolvedValueOnce({ participantId: "owner-session-1", participantToken: "token-1" })
      .mockResolvedValueOnce({ participantId: "owner-session-1", participantToken: "token-2" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const response = await authenticatedDesktopShareFetch(session, "/api/snapshot", undefined, "Desktop");

    expect(response.status).toBe(200);
    expect(ownerAuthMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("Authorization")).toBe("Bearer token-1");
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Headers).get("Authorization")).toBe("Bearer token-2");
  });
});
