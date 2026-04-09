import { describe, expect, it } from "vitest";
import { resolveVisiblePdfPage, type PdfPageMetrics } from "./libraryPdfScrollState";

describe("libraryPdfScrollState", () => {
  it("uses real page metrics instead of estimated uniform heights", () => {
    const metrics: PdfPageMetrics[] = [
      { page: 1, top: 0, height: 600 },
      { page: 2, top: 620, height: 900 },
      { page: 3, top: 1540, height: 500 },
    ];

    expect(resolveVisiblePdfPage(metrics, 0, 800)).toBe(1);
    expect(resolveVisiblePdfPage(metrics, 580, 800)).toBe(2);
    expect(resolveVisiblePdfPage(metrics, 1500, 800)).toBe(3);
  });

  it("falls back to the nearest real page when the viewport focus is in a gap", () => {
    const metrics: PdfPageMetrics[] = [
      { page: 1, top: 0, height: 500 },
      { page: 2, top: 650, height: 500 },
      { page: 3, top: 1300, height: 500 },
    ];

    expect(resolveVisiblePdfPage(metrics, 580, 200)).toBe(2);
    expect(resolveVisiblePdfPage(metrics, 1230, 200)).toBe(3);
  });
});
