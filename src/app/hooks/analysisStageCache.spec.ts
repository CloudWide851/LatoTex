import { describe, expect, it } from "vitest";
import type { PaperAnalysisContext } from "./analysisDataSources";
import {
  buildAnalysisPromptSignature,
  buildPaperChunkSummariesCacheKey,
  buildPaperCondensedSourceCacheKey,
  buildPaperContextSignature,
  buildPythonProfileCacheKey,
  buildSnapshotSignature,
  readCachedAnalysisStageValue,
  writeCachedAnalysisStageValue,
} from "./analysisStageCache";

const PAPER_CONTEXT: PaperAnalysisContext = {
  sourcePath: "papers/demo.bib",
  title: "Demo Paper",
  metadataBlock: "authors: Demo",
  chunks: [
    { chunkIndex: 0, pageStart: 1, pageEnd: 2, text: "chunk one" },
    { chunkIndex: 1, pageStart: 3, pageEnd: 4, text: "chunk two" },
  ],
  detectedLanguage: "en",
  extractionEngine: "pdfjs",
  extractionMode: "local",
  pageCount: 4,
  ocrPageCount: 0,
  pdfRelativePath: ".latotex/papers/demo.pdf",
};

describe("analysisStageCache", () => {
  it("changes paper context signatures when the extracted paper content changes", () => {
    const base = buildPaperContextSignature(PAPER_CONTEXT);
    const changed = buildPaperContextSignature({
      ...PAPER_CONTEXT,
      chunks: [...PAPER_CONTEXT.chunks, { chunkIndex: 2, pageStart: 5, pageEnd: 5, text: "new chunk" }],
    });

    expect(changed).not.toBe(base);
  });

  it("builds prompt-sensitive cache keys for condensed paper synthesis and python profiles", () => {
    const paperSignature = buildPaperContextSignature(PAPER_CONTEXT);
    const promptA = buildAnalysisPromptSignature("summarize this paper", "English");
    const promptB = buildAnalysisPromptSignature("summarize this paper with risks", "English");

    expect(buildPaperChunkSummariesCacheKey("papers/demo.bib", "English", paperSignature)).toBe(
      buildPaperChunkSummariesCacheKey("papers/demo.bib", "English", paperSignature),
    );
    expect(buildPaperCondensedSourceCacheKey("papers/demo.bib", "English", paperSignature, promptA)).not.toBe(
      buildPaperCondensedSourceCacheKey("papers/demo.bib", "English", paperSignature, promptB),
    );
    expect(buildPythonProfileCacheKey("English", promptA, "snap-a")).not.toBe(
      buildPythonProfileCacheKey("English", promptB, "snap-a"),
    );
  });

  it("reads back cached stage values by key", () => {
    const store = writeCachedAnalysisStageValue(
      { version: 1, entries: {} },
      "paper-chunks:key",
      { chunkSummaries: ["cached"], chunkFailures: 0 },
    );

    expect(readCachedAnalysisStageValue<{ chunkSummaries: string[]; chunkFailures: number }>(
      store,
      "paper-chunks:key",
    )).toEqual({
      chunkSummaries: ["cached"],
      chunkFailures: 0,
    });
  });

  it("changes snapshot signatures when input snapshot content changes", () => {
    const base = buildSnapshotSignature([
      {
        path: "data/demo.csv",
        kind: "csv",
        summary: "rows=3, columns=2",
        excerpt: "a,b\n1,2",
        rows: 3,
        columns: 2,
        numericSeries: [{ label: "a", value: 1.5 }],
      },
    ]);
    const changed = buildSnapshotSignature([
      {
        path: "data/demo.csv",
        kind: "csv",
        summary: "rows=4, columns=2",
        excerpt: "a,b\n1,2\n3,4",
        rows: 4,
        columns: 2,
        numericSeries: [{ label: "a", value: 2.5 }],
      },
    ]);

    expect(changed).not.toBe(base);
  });
});
