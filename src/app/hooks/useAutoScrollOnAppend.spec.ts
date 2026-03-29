import { describe, expect, it } from "vitest";

import {
  getAgentActivityAutoScrollAppendKey,
  getChatAutoScrollAppendKey,
} from "./useAutoScrollOnAppend";

describe("useAutoScrollOnAppend helpers", () => {
  it("only scrolls chat when a visible message item is appended", () => {
    expect(getChatAutoScrollAppendKey("session-1", [])).toBeNull();
    expect(
      getChatAutoScrollAppendKey("session-1", [{ id: "assistant-1", role: "assistant", text: "" }]),
    ).toBeNull();
    expect(
      getChatAutoScrollAppendKey("session-1", [{ id: "assistant-1", role: "assistant", text: "first chunk" }]),
    ).toBe("session-1:assistant-1");
    expect(
      getChatAutoScrollAppendKey("session-1", [{ id: "user-1", role: "user", text: "hello" }]),
    ).toBe("session-1:user-1");
  });

  it("only scrolls agent activity once a run has visible output", () => {
    expect(getAgentActivityAutoScrollAppendKey(null, true)).toBeNull();
    expect(getAgentActivityAutoScrollAppendKey("run-1", false)).toBeNull();
    expect(getAgentActivityAutoScrollAppendKey("run-1", true)).toBe("run-1");
  });
});
