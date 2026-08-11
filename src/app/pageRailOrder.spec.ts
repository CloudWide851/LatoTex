import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_ORDER,
  LEGACY_DEFAULT_PAGE_ORDER_0_1_4,
  moveSidebarPageOrderItem,
  normalizeSidebarPageOrder,
} from "./pageRailOrder";

describe("pageRailOrder", () => {
  it("filters invalid values, removes duplicates, and appends missing pages", () => {
    expect(normalizeSidebarPageOrder(["git", "unknown", "git", "latex", "overview"])).toEqual([
      "latex",
      "library",
      "analysis",
      "submission",
      "git",
      "agents",
      "draw",
      "plugins",
      "settings",
    ]);
  });

  it("falls back to the default page order", () => {
    expect(normalizeSidebarPageOrder(null)).toEqual(DEFAULT_PAGE_ORDER);
    expect(DEFAULT_PAGE_ORDER.slice(0, 2)).toEqual(["latex", "library"]);
  });

  it("migrates only the exact 0.1.4 default order", () => {
    expect(normalizeSidebarPageOrder(LEGACY_DEFAULT_PAGE_ORDER_0_1_4)).toEqual(DEFAULT_PAGE_ORDER);

    const customized = [
      "library",
      "latex",
      "analysis",
      "submission",
      "agents",
      "draw",
      "plugins",
      "git",
      "settings",
    ];
    expect(normalizeSidebarPageOrder(customized)).toEqual(customized);
  });

  it("moves pages within the normalized order", () => {
    expect(moveSidebarPageOrderItem(DEFAULT_PAGE_ORDER, "plugins", -1)).toEqual([
      "latex",
      "library",
      "analysis",
      "submission",
      "agents",
      "draw",
      "plugins",
      "git",
      "settings",
    ]);
  });

  it("keeps research destinations ahead of tools while preserving order inside each group", () => {
    expect(normalizeSidebarPageOrder(["settings", "analysis", "git", "overview"])).toEqual([
      "analysis",
      "latex",
      "library",
      "submission",
      "settings",
      "git",
      "agents",
      "draw",
      "plugins",
    ]);
  });
});
