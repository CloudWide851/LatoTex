import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_ORDER,
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
  });

  it("moves pages within the normalized order", () => {
    expect(moveSidebarPageOrderItem(DEFAULT_PAGE_ORDER, "plugins", -1)).toEqual([
      "library",
      "latex",
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
      "library",
      "latex",
      "submission",
      "settings",
      "git",
      "agents",
      "draw",
      "plugins",
    ]);
  });
});
