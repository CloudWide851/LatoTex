import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_ORDER,
  moveSidebarPageOrderItem,
  normalizeSidebarPageOrder,
} from "./pageRailOrder";

describe("pageRailOrder", () => {
  it("filters invalid values, removes duplicates, and appends missing pages", () => {
    expect(normalizeSidebarPageOrder(["git", "unknown", "git", "latex"])).toEqual([
      "git",
      "latex",
      "analysis",
      "draw",
      "library",
      "plugins",
      "settings",
    ]);
  });

  it("falls back to the default page order", () => {
    expect(normalizeSidebarPageOrder(null)).toEqual(DEFAULT_PAGE_ORDER);
  });

  it("moves pages within the normalized order", () => {
    expect(moveSidebarPageOrderItem(DEFAULT_PAGE_ORDER, "plugins", -1)).toEqual([
      "latex",
      "analysis",
      "draw",
      "library",
      "plugins",
      "git",
      "settings",
    ]);
  });
});
