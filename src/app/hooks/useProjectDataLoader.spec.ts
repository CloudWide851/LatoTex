import { describe, expect, it } from "vitest";
import type { ResourceNode } from "../../shared/types/app";
import { collectSearchWarmupFocusPaths } from "./useProjectDataLoader";

function file(relativePath: string): ResourceNode {
  return {
    name: relativePath.split("/").pop() ?? relativePath,
    relativePath,
    kind: "file",
    children: [],
  };
}

function directory(relativePath: string, children: ResourceNode[]): ResourceNode {
  return {
    name: relativePath.split("/").pop() ?? relativePath,
    relativePath,
    kind: "directory",
    children,
  };
}

describe("collectSearchWarmupFocusPaths", () => {
  it("prioritizes the active TeX file, nearby Bib files, and a bounded TeX context", () => {
    const focusPaths = collectSearchWarmupFocusPaths([
      file("refs.bib"),
      directory("paper", [
        file("paper/main.tex"),
        file("paper/refs.bib"),
        file("paper/supplement.tex"),
        file("paper/appendix.tex"),
      ]),
      directory("external", [
        file("external/large.bib"),
        file("external/notes.tex"),
      ]),
    ], "paper\\main.tex");

    expect(focusPaths).toEqual([
      "paper/main.tex",
      "paper/refs.bib",
      "refs.bib",
      "external/large.bib",
      "paper/appendix.tex",
      "paper/supplement.tex",
      "external/notes.tex",
    ]);
  });

  it("falls back to the first TeX file when project metadata has no main file", () => {
    const focusPaths = collectSearchWarmupFocusPaths([
      directory("src", [
        file("src/article.tex"),
        file("src/refs.bib"),
      ]),
    ], "");

    expect(focusPaths).toEqual(["src/article.tex", "src/refs.bib"]);
  });
});
