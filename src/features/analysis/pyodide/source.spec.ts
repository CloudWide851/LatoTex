import { afterEach, describe, expect, it, vi } from "vitest";

describe("resolvePyodideSourceCandidates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../../shared/api/local-resources");
    vi.resetModules();
  });

  it("normalizes encoded windows local-cache paths and stays local-only in tauri", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
      convertFileSrc: () => "http://asset.localhost/F%3A%2FLatoTex%2Fanalysis-pyodide-cache",
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      analysisPyodidePrepare: vi.fn(async () => ({
        policy: "install-first",
        requestedDir: "F:\\LatoTex\\analysis-pyodide-cache",
        actualDir: "F:\\LatoTex\\analysis-pyodide-cache",
        installDirWritable: true,
        usingFallback: false,
      })),
    }));

    const { resolvePyodideSourceCandidates } = await import("./source");
    const candidates = await resolvePyodideSourceCandidates();

    expect(candidates[0]?.name).toBe("local-cache");
    expect(candidates[0]?.source.moduleUrl).toBe(
      "http://asset.localhost/F:/LatoTex/analysis-pyodide-cache/pyodide.mjs",
    );
    expect(candidates[0]?.source.indexURL).toBe("http://asset.localhost/F:/LatoTex/analysis-pyodide-cache/");
    expect(candidates.some((item) => item.name === "cdn-fallback")).toBe(false);
  });

  it("returns no candidates when desktop local cache prepare fails", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
      convertFileSrc: (input: string) => input,
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
      convertFileSrc: (input: string) => input,
    }));

    const { resolvePyodideSourceCandidates } = await import("./source");
    const candidates = await resolvePyodideSourceCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("cdn-fallback");
    expect(candidates[0]?.source.moduleUrl).toContain("cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.mjs");
  });
});
