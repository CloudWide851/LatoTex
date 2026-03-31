import { describe, expect, it } from "vitest";

import { shouldRunStartupForRetryToken } from "./startupRunGate";

describe("startupRunGate", () => {
  it("runs on first startup attempt", () => {
    expect(shouldRunStartupForRetryToken(null, 0)).toBe(true);
  });

  it("does not rerun startup for callback identity churn with the same retry token", () => {
    expect(shouldRunStartupForRetryToken(0, 0)).toBe(false);
  });

  it("allows startup to run again only after an explicit retry", () => {
    expect(shouldRunStartupForRetryToken(0, 1)).toBe(true);
  });
});