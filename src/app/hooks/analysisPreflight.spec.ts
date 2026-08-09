import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analysisPreflightCanSubmit,
  applyAnalysisPreflightAnswers,
  buildAnalysisPreflight,
} from "./analysisPreflight";
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
      "analysisApproval",
    ]);
    const resolved = applyAnalysisPreflightAnswers({
      prompt: result.prompt,
      plan: result.plan,
      questions: result.questions,
      answers: {
        targetColumns: ["data.csv:outcome"],
        groupColumn: ["data.csv:group"],
        paired: ["independent"],
        analysisApproval: ["confirmed"],
      },
    });
    expect(resolved.plan).toMatchObject({
      inputFiles: ["data.csv"],
      targetColumns: ["data.csv:outcome"],
      groupColumn: "data.csv:group",
      paired: false,
      missingValueStrategy: "complete_case",
      alpha: 0.05,
      spec: {
        methodFamily: "group_comparison",
        outcome: "data.csv:outcome",
        groupColumn: "data.csv:group",
        approvalConfirmed: true,
      },
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

    expect(result.questions.map((question) => question.id)).toEqual([
      "targetColumns",
      "analysisApproval",
    ]);
    expect(result.questions[0]).toMatchObject({
      id: "targetColumns",
      multiple: true,
      defaultValues: ["signals.tsv:x", "signals.tsv:y"],
    });
    expect(result.plan.spec).toMatchObject({
      methodFamily: "relationship",
      outcome: "signals.tsv:x",
      predictors: ["signals.tsv:y"],
      approvalConfirmed: false,
    });
  });

  it("keeps a regression spec unapproved until the confirmation card is submitted", async () => {
    mockedLoadDataSnapshots.mockResolvedValue([{
      path: "model.csv",
      kind: "csv",
      summary: "rows=40, columns=3",
      excerpt: "outcome | exposure | age",
      numericSeries: [
        { label: "outcome", value: 1 },
        { label: "exposure", value: 2 },
        { label: "age", value: 3 },
      ],
    }]);

    const result = await buildAnalysisPreflight({
      projectId: "project-1",
      prompt: "Fit a linear regression for outcome",
      candidateFiles: ["model.csv"],
      csvCandidateFiles: ["model.csv"],
      t,
    });

    expect(result.questions.map((question) => question.id)).toEqual([
      "predictorColumns",
      "analysisApproval",
    ]);
    expect(result.plan.spec).toMatchObject({
      methodFamily: "linear_regression",
      outcome: "model.csv:outcome",
      predictors: ["model.csv:exposure"],
      approvalConfirmed: false,
    });
  });

  it("builds an approved-on-submit power spec without requiring a data file", async () => {
    const result = await buildAnalysisPreflight({
      projectId: "project-1",
      prompt: "Run a power analysis for the required sample size",
      candidateFiles: [],
      csvCandidateFiles: [],
      t,
    });

    expect(mockedLoadDataSnapshots).not.toHaveBeenCalled();
    expect(result.questions.map((question) => question.id)).toEqual(["analysisApproval"]);
    expect(result.plan.spec).toMatchObject({
      methodFamily: "power_analysis",
      power: { effectSize: 0.5, targetPower: 0.8, groupRatio: 1 },
      approvalConfirmed: false,
    });
    expect(analysisPreflightCanSubmit(result.questions, { analysisApproval: [] })).toBe(false);
    expect(analysisPreflightCanSubmit(result.questions, {
      analysisApproval: ["confirmed"],
    })).toBe(true);
    expect(applyAnalysisPreflightAnswers({
      ...result,
      answers: { analysisApproval: ["confirmed"] },
    }).plan.spec?.approvalConfirmed).toBe(true);
  });

  it("keeps survival event selection separate from predictors and pairing", async () => {
    mockedLoadDataSnapshots.mockResolvedValue([{
      path: "survival.csv",
      kind: "csv",
      summary: "rows=40, columns=3",
      excerpt: "duration | event | exposure",
      numericSeries: [
        { label: "duration", value: 10 },
        { label: "event", value: 1 },
        { label: "exposure", value: 2 },
      ],
    }]);

    const result = await buildAnalysisPreflight({
      projectId: "project-1",
      prompt: "Run survival analysis for duration",
      candidateFiles: ["survival.csv"],
      csvCandidateFiles: ["survival.csv"],
      t,
    });

    expect(result.questions.map((question) => question.id)).toEqual([
      "eventColumn",
      "predictorColumns",
      "analysisApproval",
    ]);
    expect(result.questions.some((question) => question.id === "paired")).toBe(false);
    expect(result.plan.spec).toMatchObject({
      methodFamily: "survival",
      outcome: "survival.csv:duration",
      eventColumn: "survival.csv:event",
      predictors: ["survival.csv:exposure"],
      approvalConfirmed: false,
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
