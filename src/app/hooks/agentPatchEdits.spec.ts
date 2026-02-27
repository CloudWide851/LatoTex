import { describe, expect, it } from "vitest";
import { computeDiffStats } from "./agentPatchEdits";

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

