export type ShareUiErrorCode =
  | "invalid_access"
  | "session_missing"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "unavailable";

const SHARE_UI_ERROR_CODES = new Set<ShareUiErrorCode>([
  "invalid_access",
  "session_missing",
  "conflict",
  "payload_too_large",
  "rate_limited",
  "unavailable",
]);

export class ShareUiError extends Error {
  readonly code: ShareUiErrorCode;

  constructor(code: ShareUiErrorCode) {
    super(code);
    this.name = "ShareUiError";
    this.code = code;
  }
}

export function shareUiErrorCodeFromStatus(status: number): ShareUiErrorCode {
  if (status === 401 || status === 403) return "invalid_access";
  if (status === 404) return "session_missing";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 429) return "rate_limited";
  return "unavailable";
}

export function shareUiErrorFromStatus(status: number): ShareUiError {
  return new ShareUiError(shareUiErrorCodeFromStatus(status));
}

export function resolveShareUiErrorCode(error: unknown): ShareUiErrorCode {
  if (error instanceof ShareUiError) {
    return error.code;
  }
  if (typeof error === "string" && SHARE_UI_ERROR_CODES.has(error as ShareUiErrorCode)) {
    return error as ShareUiErrorCode;
  }
  return "unavailable";
}
