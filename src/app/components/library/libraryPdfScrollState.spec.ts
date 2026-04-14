import { describe, expect, it } from "vitest";
import { resolvePdfScrollAnchor, resolveScrollTopForPdfAnchor } from "./libraryPdfScrollState";

describe("libraryPdfScrollState", () => {
  it("keeps the focused page anchor when syncing between viewers with different page heights", () => {
    const sourceMetrics = [
      { page: 1, top: 0, height: 800 },
      { page: 2, top: 824, height: 1000 },
      { page: 3, top: 1848, height: 920 },
    ];
    const translatedMetrics = [
      { page: 1, top: 0, height: 920 },
      { page: 2, top: 944, height: 760 },
      { page: 3, top: 1728, height: 1100 },
    ];

    const anchor = resolvePdfScrollAnchor(sourceMetrics, 930, 600, 0.44);
    expect(anchor.page).toBe(2);
    expect(anchor.pageFocusRatio).toBeGreaterThan(0);
    expect(anchor.pageFocusRatio).toBeLessThan(1);

    const translatedTop = resolveScrollTopForPdfAnchor(translatedMetrics, anchor, 600, 2400);
    const translatedAnchor = resolvePdfScrollAnchor(translatedMetrics, translatedTop, 600, anchor.absoluteRatio);

    expect(translatedAnchor.page).toBe(2);
    expect(Math.abs(translatedAnchor.pageFocusRatio - anchor.pageFocusRatio)).toBeLessThan(0.08);
  });

  it("falls back to the absolute ratio when the target viewer has not measured the anchor page yet", () => {
    const anchor = {
      page: 4,
      pageFocusRatio: 0.62,
      absoluteRatio: 0.35,
    };

    expect(resolveScrollTopForPdfAnchor([{ page: 1, top: 0, height: 800 }], anchor, 600, 2000)).toBe(700);
  });
});
