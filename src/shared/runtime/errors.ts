export type AppRuntimeErrorLike = {
  message?: string | null;
  code?: string | null;
  diagnosticCode?: string | null;
  details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function resolveRuntimeErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (isRecord(error)) {
    const direct = [error.message, error.error, error.reason]
      .find((value) => typeof value === "string" && value.trim().length > 0);
    if (typeof direct === "string") {
      return direct;
    }
    const diagnosticCode = [error.code, error.diagnosticCode]
      .find((value) => typeof value === "string" && value.trim().length > 0);
    if (typeof diagnosticCode === "string") {
      return diagnosticCode;
    }
  }
  return fallback;
}

export function resolveRuntimeErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  const code = [error.code, error.diagnosticCode]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof code === "string" ? code : null;
}

export function formatRuntimeErrorForLog(error: unknown, fallback = "Unknown error"): string {
  const message = resolveRuntimeErrorMessage(error, fallback);
  const code = resolveRuntimeErrorCode(error);
  return code ? `${code}: ${message}` : message;
}
