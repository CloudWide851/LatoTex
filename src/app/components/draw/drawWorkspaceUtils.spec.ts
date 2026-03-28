import { afterEach, describe, expect, it, vi } from "vitest";

describe("drawWorkspaceUtils", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../../shared/api/local-resources");
    vi.doUnmock("../../../shared/utils/localResourceProbe");
    vi.resetModules();
  });

  it("builds embed frame URLs for drawio host pages", async () => {
    const { toDrawioEmbedUrl } = await import("./drawWorkspaceUtils");
    expect(toDrawioEmbedUrl("/drawio/index.html")).toBe(
      "/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
    );
    expect(toDrawioEmbedUrl("/drawio/index.html?foo=1")).toBe(
      "/drawio/index.html?foo=1&embed=1&proto=json&spin=0&configure=1&ui=min",
    );
  });

  it("keeps fallback drawio host for non-tauri runtime", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => false,
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    await expect(resolveDrawioHostFrameCandidates()).resolves.toEqual([
      "/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
    ]);
  });

  it("keeps backend local-resource host first in tauri mode", async () => {
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
        entryUrl: "http://latotex-resource.localhost/tool/drawio/index.html",
      })),
    }));
    vi.doMock("../../../shared/utils/localResourceProbe", () => ({
      buildLocalResourceBaseCandidates: vi.fn(() => ["http://asset.localhost/F:/LatoTex/drawio-cache"]),
      buildLocalResourceEntryCandidates: vi.fn(() => ["http://asset.localhost/F:/LatoTex/drawio-cache/index.html"]),
      uniqueLocalResourceValues: vi.fn((values: string[]) => Array.from(new Set(values.filter(Boolean)))),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    const candidates = await resolveDrawioHostFrameCandidates();

    expect(candidates[0]).toBe("http://latotex-resource.localhost/tool/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min");
    expect(candidates[1]).toBe("http://asset.localhost/F:/LatoTex/drawio-cache/index.html?embed=1&proto=json&spin=0&configure=1&ui=min");
    expect(candidates).toContain("/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min");
  });

  it("falls back to same-origin host when tauri cache prepare fails", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      drawioCachePrepare: vi.fn(async () => {
        throw new Error("prepare failed");
      }),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    await expect(resolveDrawioHostFrameCandidates()).resolves.toEqual([
      "/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
    ]);
  });

  it("exports beside the active draw file for nested drawings", async () => {
    const { toDrawExportTarget } = await import("./drawWorkspaceUtils");
    expect(toDrawExportTarget("drawings/arch/system.drawio", "png")).toBe("drawings/arch/system.png");
  });

  it("exports beside the active draw file in the drawings root", async () => {
    const { toDrawExportTarget } = await import("./drawWorkspaceUtils");
    expect(toDrawExportTarget("drawings/system.drawio", "svg")).toBe("drawings/system.svg");
  });

  it("exports beside the active draw file in the workspace root", async () => {
    const { toDrawExportTarget } = await import("./drawWorkspaceUtils");
    expect(toDrawExportTarget("system.drawio", "pdf")).toBe("system.pdf");
  });

  it("keeps only a safe file name from export hints", async () => {
    const { toDrawExportTarget } = await import("./drawWorkspaceUtils");
    expect(toDrawExportTarget("drawings/system.drawio", "png", "../exported/final diagram")).toBe(
      "drawings/final diagram.png",
    );
  });
});
