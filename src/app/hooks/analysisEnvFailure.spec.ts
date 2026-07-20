import { describe, expect, it } from "vitest";
import { nativeRuntimeFailureMessageKey, normalizeNativeRuntimeFailure } from "./analysisEnvFailure";

describe("analysis environment failure mapping", () => {
  it("keeps stable backend fields without promoting diagnostics to UI copy", () => {
    const failure = normalizeNativeRuntimeFailure({
      code: "python.env.uv_missing",
      stage: "resolving",
      retryable: true,
      diagnostics: ["Bearer [REDACTED]"],
    });
    expect(failure.code).toBe("python.env.uv_missing");
    expect(nativeRuntimeFailureMessageKey(failure)).toBe("analysis.envPromptError.uvMissing");
    expect(failure.diagnostics).toEqual(["Bearer [REDACTED]"]);
  });

  it("maps raw and unknown failures to the stable generic contract", () => {
    const failure = normalizeNativeRuntimeFailure(new Error("token=secret"));
    expect(failure.code).toBe("python.env.prepare_failed");
    expect(failure.diagnostics).toEqual([]);
    expect(nativeRuntimeFailureMessageKey(failure)).toBe("analysis.envPromptError.generic");
  });
});
