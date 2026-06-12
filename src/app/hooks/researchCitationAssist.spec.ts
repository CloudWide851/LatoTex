import { describe, expect, it } from "vitest";
import {
  buildCitationCommand,
  insertCitationAtEditorSelection,
  isSafeCitationKey,
  sanitizeCitationKey,
} from "./researchCitationAssist";

describe("researchCitationAssist", () => {
  it("normalizes and validates citation keys", () => {
    expect(sanitizeCitationKey(" {Smith2024} ")).toBe("Smith2024");
    expect(isSafeCitationKey("smith-2024.alpha")).toBe(true);
    expect(isSafeCitationKey("bad key")).toBe(false);
  });

  it("builds a LaTeX citation command", () => {
    expect(buildCitationCommand("@Smith2024")).toBe("\\cite{Smith2024}");
  });

  it("inserts citation text at the editor selection", () => {
    const edits: unknown[] = [];
    const ok = insertCitationAtEditorSelection({
      getSelection: () => ({
        startLineNumber: 2,
        startColumn: 4,
        endLineNumber: 2,
        endColumn: 4,
      }),
      executeEdits: (_source, nextEdits) => edits.push(...nextEdits),
      focus: () => undefined,
    }, "Smith2024");

    expect(ok).toBe(true);
    expect(edits).toEqual([{
      range: {
        startLineNumber: 2,
        startColumn: 4,
        endLineNumber: 2,
        endColumn: 4,
      },
      text: "\\cite{Smith2024}",
      forceMoveMarkers: true,
    }]);
  });
});
