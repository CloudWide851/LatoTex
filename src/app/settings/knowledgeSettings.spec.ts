import { describe, expect, it } from "vitest";
import {
  DEFAULT_KNOWLEDGE_GRAPH_PREFS,
  normalizeKnowledgePrefs,
} from "./knowledgeSettings";

describe("normalizeKnowledgePrefs", () => {
  it("migrates missing settings to safe project-scoped defaults", () => {
    expect(normalizeKnowledgePrefs(undefined)).toEqual({
      semanticModelReminderEnabled: true,
      defaultScope: "current",
      backgroundIndexEnabled: true,
      graph: DEFAULT_KNOWLEDGE_GRAPH_PREFS,
    });
  });

  it("preserves explicit privacy and background-work choices", () => {
    expect(normalizeKnowledgePrefs({
      knowledgeSemanticModelReminderEnabled: false,
      knowledgeDefaultScope: "all",
      knowledgeBackgroundIndexEnabled: false,
      knowledgeGraphPrefs: {
        maxVisibleNodes: 500,
        showLabels: false,
      },
    })).toEqual({
      semanticModelReminderEnabled: false,
      defaultScope: "all",
      backgroundIndexEnabled: false,
      graph: {
        maxVisibleNodes: 500,
        showLabels: false,
      },
    });
  });

  it("normalizes untrusted graph density to a supported bounded option", () => {
    expect(normalizeKnowledgePrefs({
      knowledgeGraphPrefs: {
        maxVisibleNodes: 9_999,
      },
    }).graph.maxVisibleNodes).toBe(2_000);
    expect(normalizeKnowledgePrefs({
      knowledgeGraphPrefs: {
        maxVisibleNodes: 620,
      },
    }).graph.maxVisibleNodes).toBe(500);
  });
});
