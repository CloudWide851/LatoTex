import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  analysisContextLoad: vi.fn(),
  analysisEnvPrepare: vi.fn(),
  analysisRunPython: vi.fn(),
}));

vi.mock("../../shared/api/analysis", () => apiMocks);
vi.mock("../../shared/api/runtime", () => ({ runtimeLogWrite: vi.fn(async () => undefined) }));

import {
  prepareAnalysisWorkspaceSources,
  resolveAndPreloadAnalysisWorkspaceReferences,
  resolvePaperAnalysisContextReferences,
  resolveAnalysisWorkspaceReferences,
  shouldRunAnalysisPreflight,
} from "./analysisWorkspaceSources";

const t = (key: string) => key;

describe("analysis workspace source routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies mixed explicit references without adding default data", () => {
    const resolved = resolveAnalysisWorkspaceReferences({
      prompt: "Review @data/input.csv @paper/main.tex @docs/source.pdf",
      referenceFiles: ["fallback.csv", "data/input.csv", "paper/main.tex", "docs/source.pdf"],
      structuredDataFiles: ["fallback.csv", "data/input.csv"],
      planInputFiles: ["fallback.csv"],
      t,
    });
    expect(resolved).toEqual({
      explicit: true,
      structuredFiles: ["data/input.csv"],
      contextFiles: ["paper/main.tex", "docs/source.pdf"],
    });
  });

  it("keeps no-reference CSV-first fallback compatibility", () => {
    const resolved = resolveAnalysisWorkspaceReferences({
      prompt: "Summarize the dataset",
      referenceFiles: ["table.xlsx", "data.csv"],
      structuredDataFiles: ["table.xlsx", "data.csv"],
      t,
    });
    expect(resolved.structuredFiles).toEqual(["data.csv"]);
    expect(resolved.contextFiles).toEqual([]);
    expect(resolved.explicit).toBe(false);
  });

  it("fails closed when any explicit reference is unresolved", () => {
    expect(() => resolveAnalysisWorkspaceReferences({
      prompt: "Review @paper/main.tex @missing.tex",
      referenceFiles: ["paper/main.tex"],
      structuredDataFiles: [],
      t,
    })).toThrow("analysis.error.invalidInputRefs: missing.tex");
  });

  it("fails closed when a caller supplies a denied explicit reference", () => {
    expect(() => resolveAnalysisWorkspaceReferences({
      prompt: "Review @credentials.json",
      referenceFiles: ["credentials.json"],
      structuredDataFiles: ["credentials.json"],
      t,
    })).toThrow("analysis.error.invalidInputRefs: credentials.json");
  });

  it("runs data preflight only for default or fully resolved structured references", () => {
    const references = ["data/input.csv", "paper/main.tex"];
    expect(shouldRunAnalysisPreflight("Summarize the project", references)).toBe(true);
    expect(shouldRunAnalysisPreflight("Review @data/input.csv", references)).toBe(true);
    expect(shouldRunAnalysisPreflight("Review @paper/main.tex", references)).toBe(false);
    expect(shouldRunAnalysisPreflight("Review @missing.csv", references)).toBe(false);
  });

  it("records a materialized paper PDF as context instead of structured input", () => {
    expect(resolvePaperAnalysisContextReferences({
      sourcePath: ".latotex/papers/source.bib",
      pdfRelativePath: ".latotex\\papers\\source.pdf",
    })).toEqual({
      inputFiles: [],
      contextFiles: [".latotex/papers/source.pdf"],
      contextRefs: ["paper:.latotex/papers/source.pdf"],
    });
    expect(resolvePaperAnalysisContextReferences({ sourcePath: "papers/source.bib" })).toEqual({
      inputFiles: [],
      contextFiles: ["papers/source.bib"],
      contextRefs: ["file:papers/source.bib"],
    });
  });

  it("materializes context-only runs without preparing or invoking Python", async () => {
    apiMocks.analysisContextLoad.mockResolvedValue({
      items: [
        {
          path: "paper/main.tex",
          kind: "text",
          content: "\\section{Evidence}",
          originalChars: 18,
          truncated: false,
        },
        {
          path: "docs/source.pdf",
          kind: "pdf",
          content: "[Page 1]\nPDF evidence",
          originalChars: 21,
          truncated: false,
          pageCount: 1,
          ocrPageCount: 0,
          extractionEngine: "fixture",
          extractionMode: "text",
        },
      ],
      issues: [],
    });
    const stages: string[] = [];
    const result = await prepareAnalysisWorkspaceSources({
      projectId: "project-1",
      taskId: "task-1",
      prompt: "Review the references",
      outputLanguageLabel: "English",
      promptSignature: "signature",
      references: {
        explicit: true,
        structuredFiles: [],
        contextFiles: ["paper/main.tex", "docs/source.pdf"],
      },
      stageCache: { version: 1, entries: {} },
      persistStageCacheEntry: vi.fn(async () => undefined),
      onStage: (stage) => stages.push(stage),
      t,
    });
    expect(apiMocks.analysisEnvPrepare).not.toHaveBeenCalled();
    expect(apiMocks.analysisRunPython).not.toHaveBeenCalled();
    expect(stages).toEqual(["loadContext"]);
    expect(result.inputFiles).toEqual([]);
    expect(result.contextFiles).toEqual(["paper/main.tex", "docs/source.pdf"]);
    expect(result.contextRefs).toEqual(["file:paper/main.tex", "paper:docs/source.pdf"]);
    expect(result.sourceBlock).toContain("\\section{Evidence}");
    expect(result.sourceBlock).toContain("PDF evidence");
  });

  it("preloads explicit context once before later source preparation", async () => {
    apiMocks.analysisContextLoad.mockResolvedValue({
      items: [{
        path: "paper/main.tex",
        kind: "text",
        content: "\\section{Evidence}",
        originalChars: 18,
        truncated: false,
      }],
      issues: [],
    });
    const preflight = await resolveAndPreloadAnalysisWorkspaceReferences({
      projectId: "project-1",
      prompt: "Review @paper/main.tex",
      referenceFiles: ["paper/main.tex"],
      structuredDataFiles: [],
      t,
    });
    const result = await prepareAnalysisWorkspaceSources({
      projectId: "project-1",
      taskId: "task-1",
      prompt: "Review @paper/main.tex",
      outputLanguageLabel: "English",
      promptSignature: "signature",
      references: preflight.references,
      materializedContext: preflight.materializedContext,
      stageCache: { version: 1, entries: {} },
      persistStageCacheEntry: vi.fn(async () => undefined),
      onStage: vi.fn(),
      t,
    });
    expect(apiMocks.analysisContextLoad).toHaveBeenCalledTimes(1);
    expect(apiMocks.analysisEnvPrepare).not.toHaveBeenCalled();
    expect(apiMocks.analysisRunPython).not.toHaveBeenCalled();
    expect(result.contextFiles).toEqual(["paper/main.tex"]);
  });

  it("rejects partial materialization instead of synthesizing path-only context", async () => {
    apiMocks.analysisContextLoad.mockResolvedValue({
      items: [],
      issues: [{ path: ".env", code: "analysis.context.credential_denied" }],
    });
    await expect(prepareAnalysisWorkspaceSources({
      projectId: "project-1",
      taskId: "task-1",
      prompt: "Review @.env",
      outputLanguageLabel: "English",
      promptSignature: "signature",
      references: { explicit: true, structuredFiles: [], contextFiles: [".env"] },
      stageCache: { version: 1, entries: {} },
      persistStageCacheEntry: vi.fn(async () => undefined),
      onStage: vi.fn(),
      t,
    })).rejects.toThrow("analysis.error.contextUnsafe (.env)");
  });
});
