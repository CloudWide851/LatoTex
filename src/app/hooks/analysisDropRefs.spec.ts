import { describe, expect, it } from "vitest";
import { resolveDroppedPromptRefs } from "./analysisDropRefs";

describe("analysis drop refs", () => {
  it("resolves candidate path by exact match", () => {
    const output = resolveDroppedPromptRefs(["data/input.csv"], ["data/input.csv"]);
    expect(output).toEqual(["data/input.csv"]);
  });

  it("keeps unmatched paths for prompt references", () => {
    const output = resolveDroppedPromptRefs(["docs/spec.pdf"], ["data/input.csv"]);
    expect(output).toEqual(["docs/spec.pdf"]);
  });

  it("can disable unmatched fallback", () => {
    const output = resolveDroppedPromptRefs(["docs/spec.pdf"], ["data/input.csv"], { allowUnmatched: false });
    expect(output).toEqual([]);
  });
});