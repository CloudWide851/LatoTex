import { describe, expect, it } from "vitest";
import {
  buildSubmissionCheckReport,
  extractBibKeys,
  extractCitationKeys,
} from "./researchSubmissionCheck";

describe("researchSubmissionCheck", () => {
  it("extracts citations and bib keys", () => {
    expect(extractCitationKeys("\\cite{smith2024, doe2023}")).toEqual(["smith2024", "doe2023"]);
    expect(extractBibKeys({ "refs.bib": "@article{smith2024,\ntitle={A}}" })).toEqual(["smith2024"]);
  });

  it("flags compile and submission risks", () => {
    const report = buildSubmissionCheckReport({
      texSource: "\\begin{document}\\ref{missing}\\cite{smith2024}\\includegraphics{figures/a}\\end{document}",
      fileList: ["main.tex", "refs.bib"],
      compileDiagnostics: ["error"],
      bibSources: { "refs.bib": "@article{other2024,\ntitle={B}}" },
    });

    expect(report.issues.map((issue) => issue.id)).toEqual(expect.arrayContaining([
      "compileDiagnostics",
      "undefinedReferences",
      "missingFigures",
      "missingBibliography",
    ]));
  });

  it("reports ready when no blocking issue exists", () => {
    const report = buildSubmissionCheckReport({
      texSource: "\\begin{document}\\label{sec:intro}\\ref{sec:intro}\\cite{smith2024}\\end{document}",
      fileList: ["main.tex", "refs.bib"],
      compileDiagnostics: [],
      bibSources: { "refs.bib": "@article{smith2024,\ntitle={A}}" },
    });

    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.issues.some((issue) => issue.id === "ready")).toBe(true);
  });
});
