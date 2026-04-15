import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShareCommentItem, postShareComment } from "./shareCommentApi";

describe("shareCommentApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
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

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4021/api/comments/post",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect((fetch as any).mock.calls[0][1].body).toContain("\"sid\":\"sid-1\"");
    expect((fetch as any).mock.calls[0][1].body).toContain("\"start\":12");
    expect(item.source).toBe("tex");
  });
});
