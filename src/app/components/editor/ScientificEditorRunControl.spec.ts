import { describe, expect, it } from "vitest";
import { scientificActionsForFile } from "./ScientificEditorRunControl";

describe("scientificActionsForFile", () => {
  it("offers only enabled runtimes and keeps MATLAB/Octave explicit", () => {
    const actions = scientificActionsForFile("analysis/model.m", [
      "latotex.science.matlab",
      "latotex.science.octave",
      "latotex.science.r",
    ]);
    expect(actions.map((action) => action.pluginId)).toEqual([
      "latotex.science.matlab",
      "latotex.science.octave",
    ]);
    expect(actions.every((action) => action.runFile && action.runSelection)).toBe(true);
  });

  it("runs R Markdown selections without sending the whole document to Rscript", () => {
    const actions = scientificActionsForFile("report.Rmd", ["latotex.science.r"]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      runFile: false,
      runSelection: true,
      openExternal: false,
    });
  });

  it("exposes proprietary connectors only for matching files", () => {
    expect(scientificActionsForFile("data/results.sav", [
      "latotex.science.spss",
      "latotex.science.stata",
    ])).toEqual([
      expect.objectContaining({
        pluginId: "latotex.science.spss",
        openExternal: true,
      }),
    ]);
  });
});
