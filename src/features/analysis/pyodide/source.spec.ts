import { afterEach, describe, expect, it, vi } from "vitest";

describe("resolvePyodideSourceCandidates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../../shared/api/local-resources");
    vi.resetModules();
  });

  it("uses backend-provided local pyodide URLs in tauri mode", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      analysisPyodidePrepare: vi.fn(async () => ({
        policy: "install-first",
        requestedDir: "F:\\LatoTex\\analysis-pyodide-cache",
        actualDir: "F:\\LatoTex\\analysis-pyodide-cache",
        installDirWritable: true,
        usingFallback: false,
        baseUrl: "http://asset.localhost/F:/LatoTex/analysis-pyodide-cache",
        moduleUrl: "http://asset.localhost/F:/LatoTex/analysis-pyodide-cache/pyodide.mjs",
        indexUrl: "http://asset.localhost/F:/LatoTex/analysis-pyodide-cache/",
      })),
    }));

    const { resolvePyodideSourceCandidates } = await import("./source");
    const candidates = await resolvePyodideSourceCandidates();

    expect(candidates).toEqual([
      {
        name: "local-cache",
        source: {
          moduleUrl: "http://asset.localhost/F:/LatoTex/analysis-pyodide-cache/pyodide.mjs",
          indexURL: "http://asset.localhost/F:/LatoTex/analysis-pyodide-cache/",
        },
      },
    ]);
  });

  it("returns no candidates when desktop local cache prepare fails", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      analysisPyodidePrepare: vi.fn(async () => {
        throw new Error("prepare failed");
      }),
    }));

    const { resolvePyodideSourceCandidates } = await import("./source");
    const candidates = await resolvePyodideSourceCandidates();

    expect(candidates).toEqual([]);
  });

  it("returns CDN candidate in non-tauri runtime", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => false,
    }));

    const { resolvePyodideSourceCandidates } = await import("./source");
    const candidates = await resolvePyodideSourceCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("cdn-fallback");
    expect(candidates[0]?.source.moduleUrl).toContain("cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.mjs");
  });
});
