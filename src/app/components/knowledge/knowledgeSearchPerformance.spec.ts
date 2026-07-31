import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeLogWrite } from "../../../shared/api/runtime";
import { beginKnowledgeSearchTelemetry } from "./knowledgeSearchPerformance";

vi.mock("../../../shared/api/runtime", () => ({
  runtimeLogWrite: vi.fn().mockResolvedValue({ ok: true, message: "logged" }),
}));

describe("knowledge search performance telemetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses browser marks while logging only phase, duration, and result count", () => {
    const mark = vi.fn();
    const measure = vi.fn();
    const clearMarks = vi.fn();
    const clearMeasures = vi.fn();
    vi.stubGlobal("performance", {
      now: vi.fn().mockReturnValueOnce(10).mockReturnValue(52),
      mark,
      measure,
      getEntriesByName: vi.fn().mockReturnValue([{ duration: 42 }]),
      clearMarks,
      clearMeasures,
    });

    const telemetry = beginKnowledgeSearchTelemetry("knowledge-run-1");
    expect(telemetry.record("lexical_complete", 7)).toBe(42);
    expect(telemetry.record("lexical_complete", 99)).toBe(0);
    telemetry.dispose();

    expect(mark).toHaveBeenCalledWith("latotex.knowledge.search.knowledge-run-1.start");
    expect(measure).toHaveBeenCalledOnce();
    expect(runtimeLogWrite).toHaveBeenCalledWith(
      "INFO",
      "frontend performance knowledge_search_lexical_complete_ms=42, results=7",
    );
    expect(String(vi.mocked(runtimeLogWrite).mock.calls)).not.toContain("query");
  });
});
