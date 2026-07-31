import { beforeEach, describe, expect, it, vi } from "vitest";

const { runtimeLogWrite } = vi.hoisted(() => ({
  runtimeLogWrite: vi.fn((_level: string, _message: string) => Promise.resolve()),
}));

vi.mock("../../../shared/api/runtime", () => ({ runtimeLogWrite }));

import { recordKnowledgeRuntimeMetric } from "./knowledgeRuntimePerformance";

describe("knowledge runtime performance telemetry", () => {
  beforeEach(() => {
    runtimeLogWrite.mockClear();
  });

  it("records bounded metrics without queries or document paths", () => {
    recordKnowledgeRuntimeMetric("preview_interactive", 42.126, 7);

    expect(runtimeLogWrite).toHaveBeenCalledWith(
      "INFO",
      "frontend performance knowledge_preview_interactive=42.13, count=7",
    );
    expect(runtimeLogWrite.mock.calls[0]?.[1]).not.toContain("query");
  });
});
