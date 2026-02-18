import { describe, expect, it } from "vitest";
import type { EditorTab } from "../../shared/types/app";
import { getTabIdsByAction } from "./useEditorTabs";

function tab(id: string, path: string): EditorTab {
  return {
    id,
    path,
    title: path,
    pinned: true,
    preview: false,
    lastAccessed: 0,
  };
}

describe("getTabIdsByAction", () => {
  const tabs = [tab("a", "a.tex"), tab("b", "b.tex"), tab("c", "c.tex"), tab("d", "d.tex")];

  it("closes left and right ranges correctly", () => {
    expect(getTabIdsByAction(tabs, "c", "closeLeft", {})).toEqual(["a", "b"]);
    expect(getTabIdsByAction(tabs, "b", "closeRight", {})).toEqual(["c", "d"]);
  });

  it("supports close others and close all", () => {
    expect(getTabIdsByAction(tabs, "b", "closeOthers", {})).toEqual(["a", "c", "d"]);
    expect(getTabIdsByAction(tabs, "b", "closeAll", {})).toEqual(["a", "b", "c", "d"]);
  });

  it("closes only saved tabs for closeSaved", () => {
    const dirtyByPath = {
      "a.tex": true,
      "c.tex": true,
    };
    expect(getTabIdsByAction(tabs, "b", "closeSaved", dirtyByPath)).toEqual(["b", "d"]);
  });
});
