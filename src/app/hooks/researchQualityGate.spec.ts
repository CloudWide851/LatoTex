import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCitationTrustReport,
  buildResearchQualityReport,
  clearResearchQualityReportCacheForTests,
  extractDeclaredBibPaths,
} from "./researchQualityGate";

describe("researchQualityGate", () => {
  beforeEach(() => {
    clearResearchQualityReportCacheForTests();
  });

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
      ["claims", "pass"],
      ["citations", "fail"],
      ["compile", "fail"],
      ["submission", "fail"],
      ["profile", "fail"],
      ["rebuttal", "pass"],
    ]);
    expect(report.readiness).toMatchObject({
      blockers: 5,
      warnings: 0,
      passedLanes: 2,
      totalLanes: 6,
    });
    expect(report.readiness.score).toBeLessThan(50);
  });

  it("reuses cached reports for equivalent manuscript inputs", () => {
    const first = buildResearchQualityReport({
      selectedFile: "main.tex",
      texSource: String.raw`\begin{document}\cite{smith2024}\bibliography{refs}\end{document}`,
      fileList: ["refs.bib", "main.tex"],
      compileDiagnostics: [],
      bibSources: {
        "refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\ndoi={10.0000/demo}\n}",
      },
    });
    const second = buildResearchQualityReport({
      selectedFile: "main.tex",
      texSource: String.raw`\begin{document}\cite{smith2024}\bibliography{refs}\end{document}`,
      fileList: ["main.tex", "refs.bib"],
      compileDiagnostics: [],
      bibSources: {
        "refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\ndoi={10.0000/demo}\n}",
      },
    });

    expect(second).toBe(first);
  });

  it("builds a fresh report when manuscript content changes", () => {
    const first = buildResearchQualityReport({
      selectedFile: "main.tex",
      texSource: String.raw`\begin{document}\cite{smith2024}\bibliography{refs}\end{document}`,
      fileList: ["main.tex", "refs.bib"],
      compileDiagnostics: [],
      bibSources: {
        "refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\ndoi={10.0000/demo}\n}",
      },
    });
    const second = buildResearchQualityReport({
      selectedFile: "main.tex",
      texSource: String.raw`\begin{document}\cite{smith2024,missing2025}\bibliography{refs}\end{document}`,
      fileList: ["main.tex", "refs.bib"],
      compileDiagnostics: [],
      bibSources: {
        "refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\ndoi={10.0000/demo}\n}",
      },
    });

    expect(second).not.toBe(first);
    expect(second.citationTrust.missingKeys).toEqual(["missing2025"]);
  });

  it("scores a clean manuscript gate as ready", () => {
    const report = buildResearchQualityReport({
      selectedFile: "main.tex",
      texSource: String.raw`\begin{document}\cite{smith2024}\bibliography{refs}\end{document}`,
      fileList: ["main.tex", "refs.bib"],
      compileDiagnostics: [],
      bibSources: {
        "refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\nauthor={Smith},\nyear={2024},\ndoi={10.0000/demo}\n}",
      },
    });

    expect(report.lanes.every((lane) => lane.status === "pass")).toBe(true);
    expect(report.readiness).toEqual({
      score: 100,
      blockers: 0,
      warnings: 0,
      passedLanes: 6,
      totalLanes: 6,
    });
  });

  it("adds profile-specific checklist warnings", () => {
    const report = buildResearchQualityReport({
      selectedFile: "main.tex",
      profileId: "ieee-like",
      texSource: String.raw`\documentclass{article}\begin{document}\begin{abstract}Short.\end{abstract}\cite{smith2024}\bibliography{refs}\end{document}`,
      fileList: ["main.tex", "refs.bib"],
      compileDiagnostics: [],
      bibSources: {
        "refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\nauthor={Smith},\nyear={2024},\ndoi={10.0000/demo}\n}",
      },
    });

    expect(report.profileChecklist.profileId).toBe("ieee-like");
    expect(report.lanes.find((lane) => lane.id === "profile")).toMatchObject({
      status: "warn",
    });
    expect(report.profileChecklist.items.some((item) => item.id === "profile-ieee-class" && item.status === "warn")).toBe(true);
  });
});
