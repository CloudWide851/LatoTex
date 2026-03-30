import { describe, expect, it } from "vitest";
import { editorTabSizingConstants, resolveExtraTabWidth, resolveFileTabLayout } from "./editorTabSizing";

describe("editorTabSizing", () => {
  it("keeps short file names content-fit instead of forcing the old wide minimum", () => {
    const layout = resolveFileTabLayout({ title: "main.tex", preview: false, pinned: true }, false);

    expect(layout.width).toBeLessThan(96);
    expect(layout.width).toBeGreaterThanOrEqual(editorTabSizingConstants.FILE_TAB_MIN_WIDTH);
    expect(layout.showPreviewBadge).toBe(false);
  });

  it("keeps medium file names compact so the close icon sits near the title", () => {
    const layout = resolveFileTabLayout({ title: "product_catalog.csv", preview: false, pinned: true }, false);

    expect(layout.width).toBeLessThan(150);
    expect(layout.showPreviewBadge).toBe(false);
  });

  it("clamps long file names and only shows preview badge when there is already enough room", () => {
    const layout = resolveFileTabLayout(
      { title: "very-long-sectioned-appendix-document-main-file.tex", preview: true, pinned: false },
      false,
    );

    expect(layout.width).toBe(editorTabSizingConstants.FILE_TAB_MAX_WIDTH);
    expect(layout.showPreviewBadge).toBe(true);
  });

  it("keeps extra tabs independently sized within their own compact bounds", () => {
    const width = resolveExtraTabWidth("New Chat", { hasClose: true });

    expect(width).toBeGreaterThanOrEqual(editorTabSizingConstants.EXTRA_TAB_MIN_WIDTH);
    expect(width).toBeLessThanOrEqual(editorTabSizingConstants.EXTRA_TAB_MAX_WIDTH);
  });
});
