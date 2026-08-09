// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_REFERENCE_DROP_EVENT,
  dispatchWorkspaceReferenceDrop,
  isWorkspaceReferenceDropDetail,
} from "./workspaceReferenceDrop";

describe("workspace reference drop event", () => {
  it("dispatches one typed workspace payload", () => {
    const listener = vi.fn();
    window.addEventListener(WORKSPACE_REFERENCE_DROP_EVENT, listener);
    const detail = { projectId: "project-1", scope: "workspace" as const, paths: ["paper/main.tex"] };
    expect(dispatchWorkspaceReferenceDrop(detail)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual(detail);
    window.removeEventListener(WORKSPACE_REFERENCE_DROP_EVENT, listener);
  });

  it("rejects empty or cross-scope payloads", () => {
    expect(isWorkspaceReferenceDropDetail({ projectId: "", scope: "workspace", paths: ["a.tex"] })).toBe(false);
    expect(isWorkspaceReferenceDropDetail({ projectId: "p", scope: "library", paths: ["a.tex"] })).toBe(false);
    expect(isWorkspaceReferenceDropDetail({ projectId: "p", scope: "workspace", paths: [] })).toBe(false);
  });
});
