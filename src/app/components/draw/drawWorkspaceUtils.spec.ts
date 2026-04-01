import { afterEach, describe, expect, it } from "vitest";

describe("drawWorkspaceUtils", () => {
  afterEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("builds embed frame URLs for drawio host pages", async () => {
    const { toDrawioEmbedUrl } = await import("./drawWorkspaceUtils");
    expect(toDrawioEmbedUrl("http://latotex-resource.localhost/tool/drawio/index.html")).toBe(
      "http://latotex-resource.localhost/tool/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
    );
    expect(toDrawioEmbedUrl("http://latotex-resource.localhost/tool/drawio/index.html?foo=1")).toBe(
      "http://latotex-resource.localhost/tool/drawio/index.html?foo=1&embed=1&proto=json&spin=0&configure=1&ui=min",
    );
  });

  it("resolves a single canonical host frame src from startup info", async () => {
    const { resolveDrawioHostFrameSrc } = await import("./drawWorkspaceUtils");
    expect(resolveDrawioHostFrameSrc({ entryUrl: "http://latotex-resource.localhost/tool/drawio/index.html" })).toBe(
      "http://latotex-resource.localhost/tool/drawio/index.html?embed=1&proto=json&spin=0&configure=1&ui=min",
    );
  });

  it("falls back to the backend local resource route when startup info is missing", async () => {
    const { DRAWIO_LOCAL_RESOURCE_URL, resolveDrawioHostFrameSrc } = await import("./drawWorkspaceUtils");
    expect(resolveDrawioHostFrameSrc()).toBe(
      `${DRAWIO_LOCAL_RESOURCE_URL}?embed=1&proto=json&spin=0&configure=1&ui=min`,
    );
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
