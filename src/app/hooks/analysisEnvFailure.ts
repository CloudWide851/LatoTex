import type { NativeRuntimeFailure } from "../../shared/types/app";

const KNOWN_CODES = new Set([
  "python.env.uv_missing",
  "python.env.runtime_resource_missing",
  "python.env.path_invalid",
  "python.env.coordinator_lock_failed",
  "python.env.python_install_failed",
  "python.env.python_install_spawn_failed",
  "python.env.install_failed",
  "python.env.install_spawn_failed",
  "python.env.runtime_verification_failed",
  "python.env.runtime_missing",
  "python.env.not_prepared",
  "python.env.spawn_failed",
  "python.env.prepare_failed",
]);

export function normalizeNativeRuntimeFailure(
  value: unknown,
  fallbackStage = "failed",
): NativeRuntimeFailure {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const code = typeof record.code === "string" && KNOWN_CODES.has(record.code)
      ? record.code
      : "python.env.prepare_failed";
    return {
      code,
      stage: typeof record.stage === "string" && record.stage.trim()
        ? record.stage
        : fallbackStage,
      retryable: record.retryable !== false,
      diagnostics: Array.isArray(record.diagnostics)
        ? record.diagnostics.filter((item): item is string => typeof item === "string").slice(0, 8)
        : [],
    };
  }
  const candidate = String(value ?? "").split(":", 1)[0]?.trim() ?? "";
  return {
    code: KNOWN_CODES.has(candidate) ? candidate : "python.env.prepare_failed",
    stage: fallbackStage,
    retryable: candidate !== "python.env.runtime_resource_missing"
      && candidate !== "python.env.path_invalid"
      && candidate !== "python.env.coordinator_lock_failed",
    diagnostics: [],
  };
}

export function nativeRuntimeFailureMessageKey(failure: NativeRuntimeFailure): string {
  if (failure.code === "python.env.uv_missing") {
    return "analysis.envPromptError.uvMissing";
  }
  if (failure.code === "python.env.runtime_resource_missing") {
    return "analysis.envPromptError.runtimeResourceMissing";
  }
  if (failure.code === "python.env.path_invalid") {
    return "analysis.envPromptError.pathInvalid";
  }
  if (failure.code === "python.env.coordinator_lock_failed") {
    return "analysis.envPromptError.coordinator";
  }
  if (failure.code.includes("python_install")) {
    return "analysis.envPromptError.pythonInstall";
  }
  if (failure.code.includes("verification") || failure.code === "python.env.runtime_missing") {
    return "analysis.envPromptError.verification";
  }
  if (failure.code.includes("install")) {
    return "analysis.envPromptError.packageInstall";
  }
  return "analysis.envPromptError.generic";
}
