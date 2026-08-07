import { describe, expect, it } from "vitest";
import { extractPromptRefValues, resolvePromptInputFiles } from "./analysisPromptRefs";

describe("analysis prompt refs", () => {
  it("extracts quoted and unquoted refs", () => {
    const prompt = 'analyze @data.csv and @"docs/spec file.pdf"';
    expect(extractPromptRefValues(prompt)).toEqual(["data.csv", "docs/spec file.pdf"]);
  });

  it("separates resolved candidates from unresolved refs", () => {
    const prompt = 'analyze @data.csv @docs/spec.pdf';
    const resolved = resolvePromptInputFiles(prompt, ["data.csv"]);
    expect(resolved.resolved).toEqual(["data.csv"]);
    expect(resolved.unresolved).toEqual(["docs/spec.pdf"]);
  });
});
