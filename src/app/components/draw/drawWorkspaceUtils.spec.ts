import { afterEach, describe, expect, it, vi } from "vitest";

describe("drawWorkspaceUtils", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../../shared/api/desktop");
    vi.resetModules();
  });

  it("keeps fallback drawio host for non-tauri runtime", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => false,
      convertFileSrc: (value: string) => value,
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    await expect(resolveDrawioHostFrameCandidates()).resolves.toEqual(["/drawio/index.html"]);
  });

  it("promotes the first reachable drawio candidate when fallback host probe fails", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
      convertFileSrc: () => "http://asset.localhost/F%3A%2FLatoTex%2Fdrawio-cache",
    }));
    vi.doMock("../../../shared/api/desktop", () => ({
      drawioCachePrepare: vi.fn(async () => ({
        policy: "install-first",
        requestedDir: "F:\\LatoTex\\drawio-cache",
        actualDir: "F:\\LatoTex\\drawio-cache",
        installDirWritable: true,
        usingFallback: false,
      })),
    }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/drawio/index.html") {
        throw new Error("connection refused");
      }
      return { ok: false, type: "opaque" };
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    const candidates = await resolveDrawioHostFrameCandidates();

    expect(candidates[0]).toBe("http://asset.localhost/F:/LatoTex/drawio-cache/index.html");
    expect(candidates).toContain("/drawio/index.html");
  });
});
