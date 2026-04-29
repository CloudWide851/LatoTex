import { describe, expect, it } from "vitest";
import { isBenignResizeObserverMessage } from "./useAppEffects";

describe("isBenignResizeObserverMessage", () => {
  it("matches browser ResizeObserver loop noise", () => {
    expect(isBenignResizeObserverMessage("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isBenignResizeObserverMessage("ResizeObserver loop limit exceeded")).toBe(true);
  });

  it("does not match real frontend errors", () => {
    expect(isBenignResizeObserverMessage("ResizeObserver failed to attach")).toBe(false);
    expect(isBenignResizeObserverMessage("TypeError: Cannot read properties of null")).toBe(false);
  });
});
