// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisPreflightState } from "../../hooks/analysisTypes";
import { AnalysisPreflightPanel } from "./AnalysisPreflightPanel";

const preflight: AnalysisPreflightState = {
  prompt: "Compare two groups",
  plan: {
    intent: "Compare two groups",
    inputFiles: ["data.csv"],
    targetColumns: ["outcome"],
    missingValueStrategy: "complete_case",
    alpha: 0.05,
  },
  questions: [{
    id: "method",
    title: "Method approval",
    description: "Confirm the inferential method before execution.",
    options: [{
      id: "welch",
      label: "Welch t-test",
      detail: "Allows unequal group variance.",
    }],
  }],
  answers: {},
};

describe("AnalysisPreflightPanel", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("keeps question and option explanations in InfoHint while preserving selection", async () => {
    const onAnswerChange = vi.fn();
    await act(async () => {
      root.render(
        <AnalysisPreflightPanel
          preflight={preflight}
          onAnswerChange={onAnswerChange}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.querySelectorAll("fieldset p")).toHaveLength(0);
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();

    const optionHint = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Welch t-test"]',
    );
    await act(async () => optionHint?.click());
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toBe(
      "Allows unequal group variance.",
    );

    const option = container.querySelector<HTMLInputElement>('input[type="radio"]');
    await act(async () => option?.click());
    expect(onAnswerChange).toHaveBeenCalledWith("method", ["welch"]);
  });
});
