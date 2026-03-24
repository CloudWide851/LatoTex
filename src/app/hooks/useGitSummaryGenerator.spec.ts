import { describe, expect, it } from "vitest";
import { toGitSummaryContextRefs } from "./useGitSummaryGenerator";

describe("useGitSummaryGenerator", () => {
  it("prefixes workflow context refs with file scope", () => {
    expect(toGitSummaryContextRefs(["src/main.tex", "docs/README.md"])).toEqual([
      "file:src/main.tex",
      "file:docs/README.md",
    ]);
  });
});
