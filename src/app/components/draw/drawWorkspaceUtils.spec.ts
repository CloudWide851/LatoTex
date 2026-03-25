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
        candidateHostUrls: ["http://asset.localhost/F:/LatoTex/drawio-cache/index.html"],
      })),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    const candidates = await resolveDrawioHostFrameCandidates();

    expect(candidates).toEqual(["http://asset.localhost/F:/LatoTex/drawio-cache/index.html"]);
  });

  it("appends appdata drawio fallback candidates when install-first only returns one host", async () => {
    const drawioCachePrepareMock = vi.fn(async (policy: "install-first" | "appdata-only") => {
      if (policy === "appdata-only") {
        return {
          policy,
          requestedDir: "C:\\Users\\test\\AppData\\Roaming\\LatoTex\\drawio-cache",
          actualDir: "C:\\Users\\test\\AppData\\Roaming\\LatoTex\\drawio-cache",
          installDirWritable: true,
          usingFallback: false,
          baseUrl: "http://asset.localhost/C:/Users/test/AppData/Roaming/LatoTex/drawio-cache",
          hostUrl: "http://asset.localhost/C:/Users/test/AppData/Roaming/LatoTex/drawio-cache/index.html",
          candidateHostUrls: ["http://asset.localhost/C:/Users/test/AppData/Roaming/LatoTex/drawio-cache/index.html"],
        };
      }
      return {
        policy,
        requestedDir: "F:\\LatoTex\\drawio-cache",
        actualDir: "F:\\LatoTex\\drawio-cache",
        installDirWritable: true,
        usingFallback: false,
        baseUrl: "http://asset.localhost/F:/LatoTex/drawio-cache",
        hostUrl: "http://asset.localhost/F:/LatoTex/drawio-cache/index.html",
        candidateHostUrls: ["http://asset.localhost/F:/LatoTex/drawio-cache/index.html"],
      };
    });

    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      drawioCachePrepare: drawioCachePrepareMock,
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    const candidates = await resolveDrawioHostFrameCandidates();

    expect(candidates).toEqual([
      "http://asset.localhost/F:/LatoTex/drawio-cache/index.html",
      "http://asset.localhost/C:/Users/test/AppData/Roaming/LatoTex/drawio-cache/index.html",
    ]);
    expect(drawioCachePrepareMock.mock.calls.map((call) => call[0])).toEqual([
      "install-first",
      "appdata-only",
    ]);
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
