import { describe, expect, it } from "vitest";
import {
  ShareUiError,
  resolveShareUiErrorCode,
  shareUiErrorCodeFromStatus,
} from "./shareUiError";

describe("shareUiError", () => {
  it.each([
    [401, "invalid_access"],
    [403, "invalid_access"],
    [404, "session_missing"],
    [409, "conflict"],
    [413, "payload_too_large"],
    [429, "rate_limited"],
    [500, "unavailable"],
  ] as const)("maps HTTP %s to %s", (status, code) => {
    expect(shareUiErrorCodeFromStatus(status)).toBe(code);
  });

  it("never promotes an arbitrary exception message to UI copy", () => {
    expect(resolveShareUiErrorCode(new Error("database password leaked"))).toBe("unavailable");
    expect(resolveShareUiErrorCode(new ShareUiError("conflict"))).toBe("conflict");
  });
});
