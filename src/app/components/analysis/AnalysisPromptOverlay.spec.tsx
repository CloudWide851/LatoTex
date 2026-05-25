// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisPromptOverlay } from "./AnalysisPromptOverlay";

describe("AnalysisPromptOverlay", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("lets a running analysis button request interruption", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRun = vi.fn();

    await act(async () => {
      root.render(
        <AnalysisPromptOverlay
          prompt="analyze"
          canRun={false}
          running
          busy={false}
          candidateFiles={[]}
          onPromptChange={() => undefined}
          onDropPaths={() => undefined}
          onRun={onRun}
          onRunTeams={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    await act(async () => {
      container.querySelector("button[aria-label='analysis.cancelRun']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows a continue action for completed or interrupted analysis runs", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onContinue = vi.fn();

    await act(async () => {
      root.render(
        <AnalysisPromptOverlay
          prompt=""
          canRun={false}
          canContinue
          running={false}
          busy={false}
          candidateFiles={[]}
          onPromptChange={() => undefined}
          onDropPaths={() => undefined}
          onRun={() => undefined}
          onRunTeams={() => undefined}
          onContinue={onContinue}
          t={(key) => String(key)}
        />,
      );
    });

    await act(async () => {
      container.querySelector("button[aria-label='analysis.continueRun']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onContinue).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
