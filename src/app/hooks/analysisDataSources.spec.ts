import { describe, expect, it } from "vitest";
import {
  isAnalysisContextFile,
  isAnalysisCredentialFile,
  isAnalysisReferenceFile,
  isCandidateDataFile,
  isDeniedAnalysisReferenceFile,
  listAnalysisReferenceFiles,
  listCandidateDataFiles,
} from "./analysisDataSources";

describe("analysis reference file policy", () => {
  it("accepts only the intended structured data extensions", () => {
    expect(isCandidateDataFile("data/input.csv")).toBe(true);
    expect(isCandidateDataFile("data\\input.JSONL")).toBe(true);
    expect(isCandidateDataFile("paper/main.tex")).toBe(false);
  });

  it.each([
    "credentials.json",
    "nested/SECRET.json",
    "nested/secrets.csv",
    ".env",
    ".env.json",
    "keys/id_rsa",
    "keys/id_ed25519",
    "keys/client.pem",
    "keys/client.p12",
  ])("rejects credential-shaped references before classification: %s", (path) => {
    expect(isAnalysisCredentialFile(path)).toBe(true);
    expect(isDeniedAnalysisReferenceFile(path)).toBe(true);
    expect(isCandidateDataFile(path)).toBe(false);
    expect(isAnalysisContextFile(path)).toBe(false);
    expect(isAnalysisReferenceFile(path)).toBe(false);
  });

  it.each([".private.csv", ".notes.txt", "nested/.private.jsonl"]) (
    "rejects unknown dotfiles even when their extension is otherwise allowed: %s",
    (path) => {
      expect(isDeniedAnalysisReferenceFile(path)).toBe(true);
      expect(isCandidateDataFile(path)).toBe(false);
      expect(isAnalysisContextFile(path)).toBe(false);
      expect(isAnalysisReferenceFile(path)).toBe(false);
    },
  );

  it.each([".editorconfig", "config/.gitignore", "config\\.gitattributes"]) (
    "keeps the exact allowed dotfiles as context only: %s",
    (path) => {
      expect(isDeniedAnalysisReferenceFile(path)).toBe(false);
      expect(isCandidateDataFile(path)).toBe(false);
      expect(isAnalysisContextFile(path)).toBe(true);
      expect(isAnalysisReferenceFile(path)).toBe(true);
    },
  );

  it("filters denied names from structured and combined reference lists", () => {
    const paths = ["data.csv", "credentials.json", ".private.csv", "main.tex", ".gitignore"];
    expect(listCandidateDataFiles(paths)).toEqual(["data.csv"]);
    expect(listAnalysisReferenceFiles(paths)).toEqual([".gitignore", "data.csv", "main.tex"]);
  });
});
