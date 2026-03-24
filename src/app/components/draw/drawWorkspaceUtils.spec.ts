import { afterEach, describe, expect, it, vi } from "vitest";

describe("drawWorkspaceUtils", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../../shared/api/local-resources");
    vi.resetModules();
  });

  it("keeps fallback drawio host for non-tauri runtime", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => false,
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    await expect(resolveDrawioHostFrameCandidates()).resolves.toEqual(["/drawio/index.html"]);
  });

  it("uses backend-provided local drawio host URL in tauri mode", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      drawioCachePrepare: vi.fn(async () => ({
        policy: "install-first",
        requestedDir: "F:\\LatoTex\\drawio-cache",
        actualDir: "F:\\LatoTex\\drawio-cache",
        installDirWritable: true,
        usingFallback: false,
        baseUrl: "http://asset.localhost/F:/LatoTex/drawio-cache",
        hostUrl: "http://asset.localhost/F:/LatoTex/drawio-cache/index.html",
      })),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    const candidates = await resolveDrawioHostFrameCandidates();

    expect(candidates).toEqual(["http://asset.localhost/F:/LatoTex/drawio-cache/index.html"]);
  });

  it("returns no drawio candidates when tauri cache prepare fails", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      drawioCachePrepare: vi.fn(async () => {
        throw new Error("prepare failed");
      }),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    await expect(resolveDrawioHostFrameCandidates()).resolves.toEqual([]);
  });
});
