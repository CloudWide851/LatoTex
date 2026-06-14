import { describe, expect, it } from "vitest";
import { buildResearchQualityReport } from "./researchQualityGate";
import { resolveResearchNextAction } from "./researchNextAction";

function reportFor(input: {
  compileDiagnostics?: string[];
  texSource?: string;
}) {
  return buildResearchQualityReport({
    selectedFile: "main.tex",
    texSource: input.texSource ?? String.raw`\begin{document}\cite{smith2024}\bibliography{refs}\end{document}`,
    fileList: ["main.tex", "refs.bib"],
    compileDiagnostics: input.compileDiagnostics ?? [],
    bibSources: {
      "refs.bib": "@article{smith2024,\ntitle={Local First Research Writing},\nauthor={Smith},\nyear={2024},\ndoi={10.0000/demo}\n}",
    },
  });
}

describe("resolveResearchNextAction", () => {
  it("asks for a TeX manuscript when none is selected", () => {
    const action = resolveResearchNextAction({
      selectedFile: null,
      canCompileSelectedFile: false,
      report: reportFor({}),
    });

    expect(action.kind).toBe("open-tex");
    expect(action.actionKey).toBe("research.next.noTex.action");
  });

  it("prioritizes compile repair over other lanes", () => {
    const action = resolveResearchNextAction({
      selectedFile: "main.tex",
      canCompileSelectedFile: true,
      report: reportFor({ compileDiagnostics: ["error"] }),
    });

    expect(action).toMatchObject({
      kind: "repair-compile",
      laneId: "compile",
    });
  });

  it("opens the first non-rebuttal failing lane", () => {
    const action = resolveResearchNextAction({
      selectedFile: "main.tex",
      canCompileSelectedFile: true,
      report: reportFor({
        texSource: String.raw`\begin{document}\cite{missing2025}\bibliography{refs}\end{document}`,
      }),
    });

    expect(action).toMatchObject({
      kind: "inspect-lane",
      laneId: "citations",
    });
  });

  it("routes clean manuscripts to evidence bundle creation", () => {
    const action = resolveResearchNextAction({
      selectedFile: "main.tex",
      canCompileSelectedFile: true,
      report: reportFor({}),
    });

    expect(action).toMatchObject({
      kind: "build-evidence",
      laneId: "submission",
    });
  });
});
