// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { submitWorkspaceEditorShareComment } from "./useWorkspaceEditorShareComments";

describe("submitWorkspaceEditorShareComment", () => {
  it("preserves the draft and exposes accessible feedback when posting fails", async () => {
    const textarea = document.createElement("textarea");
    const submitButton = document.createElement("button");
    const errorNode = document.createElement("div");
    textarea.value = "  keep this draft  ";
    document.body.append(textarea, submitButton, errorNode);
    const focus = vi.spyOn(textarea, "focus");
    let busyDuringSubmit = false;

    const submitted = await submitWorkspaceEditorShareComment({
      textarea,
      submitButton,
      errorNode,
      errorMessage: "Comment could not be sent.",
      submit: async () => {
        busyDuringSubmit = submitButton.disabled && submitButton.getAttribute("aria-busy") === "true";
        throw new Error("private transport detail");
      },
    });

    expect(submitted).toBe(false);
    expect(busyDuringSubmit).toBe(true);
    expect(textarea.value).toBe("  keep this draft  ");
    expect(errorNode.textContent).toBe("Comment could not be sent.");
    expect(submitButton.disabled).toBe(false);
    expect(submitButton.hasAttribute("aria-busy")).toBe(false);
    expect(focus).toHaveBeenCalled();
  });
});
