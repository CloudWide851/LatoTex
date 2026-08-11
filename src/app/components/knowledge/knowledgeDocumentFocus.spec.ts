import { describe, expect, it } from "vitest";
import type { KnowledgeSearchHit } from "../../../shared/types/app";
import {
  createKnowledgeFocusRequest,
  formatKnowledgeAnchor,
  knowledgeFocusLine,
  knowledgeFocusPage,
} from "./knowledgeDocumentFocus";

function hit(anchor: KnowledgeSearchHit["anchor"]): KnowledgeSearchHit {
  return {
    evidenceId: "evidence-1",
    projectId: "project-1",
    itemId: "item-1",
    title: "Methods",
    relativePath: ".latotex/papers/methods.pdf",
    sourceKind: "pdf",
    anchor,
    snippet: "The registered protocol used a fixed alpha.",
    score: 1,
    matchKinds: ["exact"],
    citation: {
      citationId: "citation-1",
      projectId: "project-1",
      itemId: "item-1",
      title: "Methods",
      relativePath: ".latotex/papers/methods.pdf",
      sourceKind: "pdf",
      anchor,
      snippet: "The registered protocol used a fixed alpha.",
    },
  };
}

describe("knowledge document focus", () => {
  it("preserves evidence identity and exact PDF pages", () => {
    const request = createKnowledgeFocusRequest(hit({ kind: "page", value: "7", page: 7 }), 4);
    expect(request).toMatchObject({ token: 4, evidenceId: "evidence-1" });
    expect(knowledgeFocusPage(request)).toBe(7);
    expect(formatKnowledgeAnchor(request.anchor)).toBe("p.7");
  });

  it("normalizes Monaco line anchors and keeps unsupported anchors honest", () => {
    const request = createKnowledgeFocusRequest(hit({ kind: "lines", value: "12-14", lineStart: 12, lineEnd: 14 }), 8);
    expect(knowledgeFocusLine(request)).toBe(12);
    expect(formatKnowledgeAnchor(request.anchor)).toBe("L12–14");
    expect(knowledgeFocusPage(request)).toBeNull();
    expect(formatKnowledgeAnchor({ kind: "paragraph", value: "paragraph 3" })).toBe("paragraph 3");
  });
});
