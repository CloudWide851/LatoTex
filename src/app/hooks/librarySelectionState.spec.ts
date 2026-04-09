import { describe, expect, it } from "vitest";
import { rewriteLibrarySelectionAfterFsAction } from "./librarySelectionState";

describe("rewriteLibrarySelectionAfterFsAction", () => {
  it("rewrites the selected bib path after a file rename", () => {
    expect(rewriteLibrarySelectionAfterFsAction({
      selectedPath: "papers/demo.bib",
      action: "rename",
      path: "papers/demo.bib",
      targetPath: "papers/demo-renamed.bib",
    })).toBe("papers/demo-renamed.bib");
  });

  it("rewrites descendants when a containing folder moves", () => {
    expect(rewriteLibrarySelectionAfterFsAction({
      selectedPath: "group-a/sub/demo.bib",
      action: "move",
      path: "group-a",
      targetPath: "group-b",
    })).toBe("group-b/sub/demo.bib");
  });

  it("clears the selection when the selected entry is deleted", () => {
    expect(rewriteLibrarySelectionAfterFsAction({
      selectedPath: "papers/demo.bib",
      action: "delete",
      path: "papers/demo.bib",
    })).toBeNull();
  });

  it("clears the selection when a containing folder is deleted", () => {
    expect(rewriteLibrarySelectionAfterFsAction({
      selectedPath: "papers/sub/demo.bib",
      action: "delete",
      path: "papers",
    })).toBeNull();
  });

  it("keeps unrelated selections unchanged", () => {
    expect(rewriteLibrarySelectionAfterFsAction({
      selectedPath: "papers/demo.bib",
      action: "copy",
      path: "papers/demo.bib",
      targetPath: "archive/demo.bib",
    })).toBe("papers/demo.bib");
  });
});
