import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDesktopShareAuth } from "../../hooks/shareHttpAuth";
import { createShareCommentItem, postShareComment } from "./shareCommentApi";

describe("shareCommentApi", () => {
  beforeEach(() => {
    clearDesktopShareAuth();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ participantId: "desktop-owner", participantToken: "token-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates stable tex comment payloads with trimmed content", () => {
    const item = createShareCommentItem({
      username: "Desktop",
      text: "  tighten the introduction  ",
      source: "tex",
      quote: "  Intro paragraph  ",
      start: 4,
      end: 18,
    });

    expect(item.text).toBe("tighten the introduction");
    expect(item.quote).toBe("Intro paragraph");
    expect(item.start).toBe(4);
    expect(item.end).toBe(18);
  });

  it("posts comments through the active local share session endpoint", async () => {
    const item = await postShareComment({
      active: true,
      localUrl: "http://127.0.0.1:4021",
      sessionId: "sid-1",
      password: "pwd-1",
    }, {
      username: "Desktop",
      text: "Need to clarify the theorem assumptions.",
      source: "tex",
      quote: "Theorem 1",
      start: 12,
      end: 32,
    });

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4021/api/comments/post",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const fetchMock = vi.mocked(fetch);
    const joinBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    const commentRequest = fetchMock.mock.calls[1]?.[1];
    expect(joinBody).toContain("\"pwd\":\"pwd-1\"");
    expect(commentRequest?.body).toContain("\"sid\":\"sid-1\"");
    expect(commentRequest?.body).toContain("\"start\":12");
    expect(commentRequest?.body).not.toContain("pwd-1");
    expect(new Headers(commentRequest?.headers).get("Authorization")).toBe("Bearer token-1");
    expect(item.source).toBe("tex");
  });

  it("returns a stable UI error without reading a failed response body", async () => {
    const text = vi.fn(async () => "internal stack trace");
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ participantId: "desktop-owner", participantToken: "token-1" }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 413, text } as unknown as Response);

    await expect(postShareComment({
      active: true,
      localUrl: "http://127.0.0.1:4021",
      sessionId: "sid-1",
      password: "pwd-1",
    }, {
      username: "Desktop",
      text: "large comment",
      source: "tex",
    })).rejects.toMatchObject({ code: "payload_too_large" });
    expect(text).not.toHaveBeenCalled();
  });
});
