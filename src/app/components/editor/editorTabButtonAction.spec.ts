import { describe, expect, it, vi } from "vitest";
import { runTabButtonAction, swallowTabButtonEvent } from "./editorTabButtonAction";

describe("editorTabButtonAction", () => {
  it("swallows pointer/click propagation for tab action buttons", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    swallowTabButtonEvent({ preventDefault, stopPropagation });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("runs the action exactly once after swallowing the event", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const action = vi.fn();

    runTabButtonAction({ preventDefault, stopPropagation }, action);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });
});
