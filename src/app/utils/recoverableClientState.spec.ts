/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { clearRecoverableClientState } from "./recoverableClientState";

describe("clearRecoverableClientState", () => {
  it("clears volatile workspace state while preserving durable settings", () => {
    localStorage.setItem("latotex.workspace.page", "latex");
    localStorage.setItem("latotex.latex.workspace.session.project-1", "{}");
    localStorage.setItem("latotex.locale", "zh-CN");
    localStorage.setItem("latotex.chat.sessions.project-1", "[]");

    clearRecoverableClientState();

    expect(localStorage.getItem("latotex.workspace.page")).toBeNull();
    expect(localStorage.getItem("latotex.latex.workspace.session.project-1")).toBeNull();
    expect(localStorage.getItem("latotex.locale")).toBe("zh-CN");
    expect(localStorage.getItem("latotex.chat.sessions.project-1")).toBe("[]");
  });
});
