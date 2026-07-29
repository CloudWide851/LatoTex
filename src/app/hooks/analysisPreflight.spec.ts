import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAnalysisPreflightAnswers, buildAnalysisPreflight } from "./analysisPreflight";
import { loadDataSnapshots } from "./analysisDataSources";

vi.mock("./analysisDataSources", () => ({
  loadDataSnapshots: vi.fn(),
}));

const mockedLoadDataSnapshots = vi.mocked(loadDataSnapshots);
const t = (key: string) => key;

describe("analysis preflight plan", () => {
  beforeEach(() => {
    mockedLoadDataSnapshots.mockReset();
  });

  it("asks only for missing comparison design fields and returns a structured plan", async () => {
    mockedLoadDataSnapshots.mockResolvedValue([
      {
        path: "data.csv",
        kind: "csv",
        summary: "rows=20, columns=4",
        excerpt: "group | site | outcome | baseline\nA | north | 1 | 0",
        numericSeries: [
          { label: "outcome", value: 2 },
          { label: "baseline", value: 1 },
        ],
      },
    ]);

    const result = await buildAnalysisPreflight({
      projectId: "project-1",
      prompt: "Compare conditions",
      candidateFiles: ["data.csv"],
      csvCandidateFiles: ["data.csv"],
      t,
    });

    expect(result.questions.map((question) => question.id)).toEqual([
      "targetColumns",
      "groupColumn",
      "paired",
    ]);
    const resolved = applyAnalysisPreflightAnswers({
      prompt: result.prompt,
      plan: result.plan,
      questions: result.questions,
      answers: {
        targetColumns: ["data.csv:outcome"],
        groupColumn: ["data.csv:group"],
        paired: ["independent"],
      },
    });
    expect(resolved.plan).toMatchObject({
      inputFiles: ["data.csv"],
      targetColumns: ["data.csv:outcome"],
      groupColumn: "data.csv:group",
      paired: false,
      missingValueStrategy: "complete_case",
      alpha: 0.05,
    });
  });

  it("keeps relationship target selection multi-valued", async () => {
    mockedLoadDataSnapshots.mockResolvedValue([
      {
        path: "signals.tsv",
        kind: "csv",
        summary: "rows=30, columns=3",
        excerpt: "x | y | z",
        numericSeries: [
          { label: "x", value: 1 },
          { label: "y", value: 2 },
          { label: "z", value: 3 },
        ],
      },
    ]);

    const result = await buildAnalysisPreflight({
      projectId: "project-1",
      prompt: "Check correlation",
      candidateFiles: ["signals.tsv"],
      csvCandidateFiles: ["signals.tsv"],
      t,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({
      id: "targetColumns",
      multiple: true,
      defaultValues: ["signals.tsv:x", "signals.tsv:y"],
    });
  });

  it("returns a descriptive-only plan when there are no candidate files", async () => {
    const result = await buildAnalysisPreflight({
      projectId: "project-1",
      prompt: "Summarize the data",
      candidateFiles: [],
      csvCandidateFiles: [],
      t,
    });

    expect(mockedLoadDataSnapshots).not.toHaveBeenCalled();
    expect(result.questions).toEqual([]);
    expect(result.plan).toMatchObject({
      inputFiles: [],
      targetColumns: [],
      missingValueStrategy: "complete_case",
      alpha: 0.05,
    });
  });

  it("forwards an automatically resolved plan when no questions are required", () => {
    const workspaceHookSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/hooks/useAnalysisWorkspace.ts"),
      "utf8",
    );

    expect(workspaceHookSource).toMatch(
      /executionOptions\s*=\s*\{\s*\.\.\.options,\s*analysisPlan:\s*result\.plan,\s*\}/s,
    );
    expect(workspaceHookSource).toContain("options: executionOptions");
  });
});
