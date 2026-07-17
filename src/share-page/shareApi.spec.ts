import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSharePdfBuffer, fetchSharePdfStatus } from "./shareApi";

describe("share API PDF caching", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls PDF status without a timestamp cache buster", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ state: "ready", updatedAt: "stamp", sizeBytes: 12, version: "stamp-12" }),
    } as Response);

    const status = await fetchSharePdfStatus("sid 1", {
      participantId: "p-1",
      participantToken: "token-1",
    });

    expect(status).toMatchObject({ ready: true, version: "stamp-12", sizeBytes: 12 });
    expect(fetchMock).toHaveBeenCalledWith("/api/pdf/status?sid=sid%201", {
      cache: "no-store",
      headers: { Authorization: "Bearer token-1" },
    });
  });

  it("downloads PDF bytes through the stable versioned URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Response);

    await fetchSharePdfBuffer("sid", {
      participantId: "p-1",
      participantToken: "token-1",
    }, "stamp-12");

    expect(fetchMock).toHaveBeenCalledWith("/api/pdf?sid=sid&v=stamp-12", {
      cache: "force-cache",
      headers: { Authorization: "Bearer token-1" },
    });
  });
});
