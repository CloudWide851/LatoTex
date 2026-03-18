import { describe, expect, it } from "vitest";
import { extractMissingStyleCandidatesFromDiagnostics } from "./compileWorkflow";

describe("compile workflow missing package detection", () => {
  it("detects missing styles from file-not-found and package-error diagnostics", () => {
    const diagnostics = [
      "! LaTeX Error: File `ctex.sty' not found.",
      "! Package fontspec Error: The font \"Times New Roman\" cannot be found.",
      "xdvipdfmx:fatal: Could not open specified DVI (or XDV) file: main.xdv",
    ];

    const candidates = extractMissingStyleCandidatesFromDiagnostics(diagnostics);

    expect(candidates).toContain("ctex.sty");
    expect(candidates).toContain("fontspec.sty");
  });

  it("deduplicates candidates", () => {
    const diagnostics = [
      "! Package fontspec Error: one",
      "! Package fontspec Error: two",
      "! LaTeX Error: File `fontspec.sty' not found.",
    ];

    const candidates = extractMissingStyleCandidatesFromDiagnostics(diagnostics);
    expect(candidates.filter((item) => item.toLowerCase() === "fontspec.sty")).toHaveLength(1);
  });
});