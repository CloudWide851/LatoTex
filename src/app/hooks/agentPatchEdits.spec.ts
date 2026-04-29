import { describe, expect, it } from "vitest";
import { computeDiffStats, parseSearchReplaceEdits, pickReviewTargetPath, pickTargetPath } from "./agentPatchEdits";

describe("computeDiffStats", () => {
  it("keeps +/- counts accurate for single-line insertion", () => {
    const original = ["\\section{Intro}", "Alpha", "Beta", "Gamma"].join("\n");
    const candidate = ["\\section{Intro}", "Alpha", "Beta", "Inserted line", "Gamma"].join("\n");

    const result = computeDiffStats(original, candidate);
    expect(result.insertions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.changedLines).toContain(4);
    expect(result.diffBlocks.some((block) => block.kind === "add")).toBe(true);
  });

  it("reports mixed modify blocks without inflating whole-file deltas", () => {
    const original = ["A", "B", "C", "D", "E"].join("\n");
    const candidate = ["A", "B*", "C", "D", "E"].join("\n");

    const result = computeDiffStats(original, candidate);
    expect(result.insertions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.changedLines.length).toBeLessThan(5);
    expect(result.diffBlocks.some((block) => block.kind === "modify")).toBe(true);
  });
});

describe("pickReviewTargetPath", () => {
  it("prefers an explicit latex path from the prompt", () => {
    expect(pickReviewTargetPath("/review fix chapters/intro.tex", "notes.md")).toBe("chapters/intro.tex");
  });

  it("falls back to the selected latex file", () => {
    expect(pickReviewTargetPath("/review", "paper/main.tex")).toBe("paper/main.tex");
  });

  it("falls back to main.tex when no latex target is available", () => {
    expect(pickReviewTargetPath("/review assets/logo.png", "notes.md")).toBe("main.tex");
  });
});

describe("pickTargetPath", () => {
  it("keeps citation insertion targeted at the selected tex file when a bib file is mentioned", () => {
    expect(pickTargetPath("insert citation from refs/library.bib", "paper/main.tex")).toEqual({
      targetPath: "paper/main.tex",
      explicitPath: false,
    });
  });

  it("still allows explicit bib edits when no tex file is selected", () => {
    expect(pickTargetPath("dedupe refs/library.bib", null)).toEqual({
      targetPath: "refs/library.bib",
      explicitPath: true,
    });
  });
});

describe("parseSearchReplaceEdits", () => {
  it("parses YAML replace actions while keeping path scope", () => {
    const edits = parseSearchReplaceEdits([
      "```yaml",
      "actions:",
      "  - type: replace",
      "    path: paper/main.tex",
      "    search: old text",
      "    replace: new text",
      "```",
    ].join("\n"));

    expect(edits).toEqual([
      { path: "paper/main.tex", search: "old text", replace: "new text" },
    ]);
  });
});
