import { describe, expect, it } from "vitest";
import {
  computeSharePdfPageTop,
  resolveSharePdfPageFromScroll,
  resolveVisibleSharePdfRange,
} from "./sharePdfVirtualizer";

describe("share PDF virtualizer", () => {
  it("keeps the initial render window bounded around the viewport", () => {
    expect(resolveVisibleSharePdfRange({
      scrollTop: 0,
      clientHeight: 900,
      pageCount: 40,
      pageSlotHeight: 1200,
    })).toEqual({ start: 1, end: 3 });
  });

  it("adds a small buffer around the visible scrolled pages", () => {
    expect(resolveVisibleSharePdfRange({
      scrollTop: 4800,
      clientHeight: 900,
      pageCount: 40,
      pageSlotHeight: 1200,
    })).toEqual({ start: 3, end: 7 });
  });

  it("resolves page labels from the scroll midpoint", () => {
    expect(resolveSharePdfPageFromScroll({
      scrollTop: 2400,
      clientHeight: 900,
      pageCount: 10,
      pageSlotHeight: 1200,
    })).toBe(3);
  });

  it("computes stable page top offsets", () => {
    expect(computeSharePdfPageTop(4, 1200)).toBe(3600);
  });
});
