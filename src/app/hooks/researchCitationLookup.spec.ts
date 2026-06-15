import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "../../shared/api/workspace";
import {
  clearLocalCitationLookupCacheForTests,
  loadLocalCitationSuggestions,
  parseBibCitationSuggestions,
} from "./researchCitationLookup";

vi.mock("../../shared/api/workspace", () => ({
  readFile: vi.fn(),
}));

describe("researchCitationLookup", () => {
  beforeEach(() => {
    clearLocalCitationLookupCacheForTests();
    vi.mocked(readFile).mockReset();
  });

  it("parses safe BibTeX citation suggestions", () => {
    expect(parseBibCitationSuggestions({
      "refs.bib": [
        "@article{Smith-2024,",
        "  title={Local First Manuscript CI},",
        "  author={Smith and Chen},",
        "  year={2024}",
        "}",
        "@article{bad key, title={ignored}}",
      ].join("\n"),
    })).toEqual([{
      key: "Smith-2024",
      title: "Local First Manuscript CI",
      author: "Smith and Chen",
      year: "2024",
      sourcePath: "refs.bib",
    }]);
  });

  it("loads declared local Bib files for cite completions", async () => {
    vi.mocked(readFile).mockResolvedValue({
      relativePath: "paper/refs.bib",
      content: "@article{Smith2024,\n title={Fast Citation Lookup},\n author={Smith},\n year={2024}\n}",
    });

    await expect(loadLocalCitationSuggestions({
      projectId: "project-1",
      selectedFile: "paper/main.tex",
      texSource: "\\bibliography{refs}\nText \\cite{Smi",
      fileList: ["paper/main.tex", "paper/refs.bib"],
      prefix: "Smi",
    })).resolves.toMatchObject([{
      key: "Smith2024",
      title: "Fast Citation Lookup",
      sourcePath: "paper/refs.bib",
    }]);
    expect(readFile).toHaveBeenCalledWith("project-1", "paper/refs.bib");
  });
});
