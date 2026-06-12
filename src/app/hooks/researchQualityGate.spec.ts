import { describe, expect, it } from "vitest";
import {
  buildCitationTrustReport,
  buildResearchQualityReport,
  extractDeclaredBibPaths,
} from "./researchQualityGate";

describe("researchQualityGate", () => {
  it("resolves declared bib paths relative to the selected TeX file", () => {
    expect(extractDeclaredBibPaths(
      String.raw`\bibliography{refs,../shared/library}`,
      "chapters/main.tex",
      ["chapters/refs.bib", "shared/library.bib"],
    )).toEqual(["chapters/refs.bib", "shared/library.bib"]);
  });

  it("passes citations with local metadata evidence", () => {
    const report = buildCitationTrustReport({
      texSource: String.raw`\cite{smith2024}`,
      bibSources: {
        "refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\ndoi={10.0000/demo}\n}",
      },
    });

    expect(report.items[0]).toMatchObject({
      key: "smith2024",
      status: "pass",
      sourcePath: "refs.bib",
    });
    expect(report.missingKeys).toEqual([]);
  });

  it("fails missing citations and warns on weak metadata", () => {
    const report = buildCitationTrustReport({
      texSource: String.raw`\cite{weak2024,missing2025,weak2024}`,
      bibSources: { "refs.bib": "@misc{weak2024,\nnote={local placeholder}\n}" },
    });

    expect(report.missingKeys).toEqual(["missing2025"]);
    expect(report.weakKeys).toEqual(["weak2024"]);
    expect(report.duplicateKeys).toEqual(["weak2024"]);
  });

  it("builds all quality gate lanes", () => {
    const report = buildResearchQualityReport({
      selectedFile: "main.tex",
      texSource: String.raw`\begin{document}\cite{missing2025}\end{document}`,
      fileList: ["main.tex"],
      compileDiagnostics: ["error"],
      bibSources: {},
    });

    expect(report.lanes.map((lane) => [lane.id, lane.status])).toEqual([
      ["citations", "fail"],
      ["compile", "fail"],
      ["submission", "fail"],
      ["rebuttal", "pass"],
    ]);
  });
});
