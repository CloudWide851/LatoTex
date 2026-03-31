import { afterEach, describe, expect, it, vi } from "vitest";

describe("drawWorkspaceUtils", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tauri-apps/api/core");
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
    vi.doMock("../../../shared/utils/localResourceProbe", () => ({
      prioritizeReachableLocalResourceCandidates: vi.fn(async (candidates: string[]) => candidates),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    await expect(resolveDrawioHostFrameCandidates()).resolves.toEqual([
      "/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
    ]);
  });

  it("keeps startup-prepared backend local-resource host first in tauri mode", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/utils/localResourceProbe", () => ({
      prioritizeReachableLocalResourceCandidates: vi.fn(async (candidates: string[]) => candidates),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    const candidates = await resolveDrawioHostFrameCandidates({
      entryUrl: "http://latotex-resource.localhost/tool/drawio/index.html",
    });

    expect(candidates).toEqual([
      "http://latotex-resource.localhost/tool/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
      "/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
    ]);
  });

  it("does not re-probe startup-prepared draw hosts before trying the provided entry", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    const prioritize = vi.fn(async (candidates: string[]) => [candidates[1], candidates[0]]);
    vi.doMock("../../../shared/utils/localResourceProbe", () => ({
      prioritizeReachableLocalResourceCandidates: prioritize,
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    const candidates = await resolveDrawioHostFrameCandidates({
      entryUrl: "http://latotex-resource.localhost/tool/drawio/index.html",
    });

    expect(prioritize).not.toHaveBeenCalled();
    expect(candidates[0]).toBe("http://latotex-resource.localhost/tool/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min");
  });

  it("keeps direct local-resource fallback ahead of same-origin host in tauri mode", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/utils/localResourceProbe", () => ({
      prioritizeReachableLocalResourceCandidates: vi.fn(async (candidates: string[]) => candidates),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    await expect(resolveDrawioHostFrameCandidates()).resolves.toEqual([
      "http://latotex-resource.localhost/tool/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
      "/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
    ]);
  });

  it("promotes reachable fallback host before broken primary candidates", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/utils/localResourceProbe", () => ({
      prioritizeReachableLocalResourceCandidates: vi.fn(async (candidates: string[]) => [
        candidates[1],
        candidates[0],
      ]),
    }));

    const { resolveDrawioHostFrameCandidates } = await import("./drawWorkspaceUtils");
    await expect(resolveDrawioHostFrameCandidates()).resolves.toEqual([
      "/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
      "http://latotex-resource.localhost/tool/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
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
