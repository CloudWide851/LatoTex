import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocalCitationSuggestions } from "../../hooks/researchCitationLookup";
import { buildCitationCompletionItems } from "./latexCompletionCitations";

vi.mock("../../hooks/researchCitationLookup", () => ({
  loadLocalCitationSuggestions: vi.fn(),
}));

describe("latexCompletionCitations", () => {
  beforeEach(() => {
    vi.mocked(loadLocalCitationSuggestions).mockReset();
  });

  it("uses the full citation key fragment as the replace range", async () => {
    vi.mocked(loadLocalCitationSuggestions).mockResolvedValue([{
      key: "Smith-2024",
      title: "Fast Lookup",
      author: "Smith",
      year: "2024",
      sourcePath: "refs.bib",
    }]);
    const monaco = {
      Range: class {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number,
        ) {}
      },
      languages: { CompletionItemKind: { Reference: 17 } },
    };
    const linePrefix = "\\cite{Smith-";

    const items = await buildCitationCompletionItems({
      monaco,
      position: { lineNumber: 3, column: linePrefix.length + 1 },
      linePrefix,
      text: "\\bibliography{refs}",
      context: { projectId: "project-1", selectedFile: "main.tex", fileList: ["refs.bib"] },
      fallbackKeys: [],
    });

    expect(loadLocalCitationSuggestions).toHaveBeenCalledWith(expect.objectContaining({ prefix: "Smith-" }));
    expect(items[0]).toMatchObject({
      label: "Smith-2024",
      insertText: "Smith-2024",
      range: {
        startLineNumber: 3,
        startColumn: "\\cite{".length + 1,
        endLineNumber: 3,
        endColumn: linePrefix.length + 1,
      },
    });
  });
});
