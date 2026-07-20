// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startOnboarding } from "../../onboarding/onboardingState";
import { WorkspaceOnboardingChecklist } from "./WorkspaceOnboardingChecklist";

const messages: Record<string, string> = {
  "workspace.onboarding.title": "Your first PDF",
  "workspace.onboarding.description": "Complete real workspace steps.",
  "workspace.onboarding.step.open": "Open main.tex",
  "workspace.onboarding.step.compile": "Compile successfully",
  "workspace.onboarding.step.view": "View the generated PDF",
  "workspace.onboarding.dismiss": "Dismiss quick start",
};

describe("WorkspaceOnboardingChecklist", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows project-scoped progress and remains dismissible", async () => {
    const onDismiss = vi.fn();
    const onboarding = {
      ...startOnboarding("sample"),
      completedSteps: ["open" as const],
    };
    await act(async () => {
      root.render(
        <WorkspaceOnboardingChecklist
          activeProjectId="sample"
          onboarding={onboarding}
          onDismiss={onDismiss}
          t={(key) => messages[String(key)] ?? String(key)}
        />,
      );
    });

    expect(container.querySelector("aside")?.getAttribute("aria-labelledby")).toBe("workspace-onboarding-title");
    expect(container.textContent).toContain("Open main.tex");
    expect(container.querySelector(".line-through")?.textContent).toBe("Open main.tex");
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not render for another project or a completed guide", async () => {
    await act(async () => {
      root.render(
        <WorkspaceOnboardingChecklist
          activeProjectId="other"
          onboarding={startOnboarding("sample")}
          onDismiss={vi.fn()}
          t={(key) => messages[String(key)] ?? String(key)}
        />,
      );
    });
    expect(container.innerHTML).toBe("");

    await act(async () => {
      root.render(
        <WorkspaceOnboardingChecklist
          activeProjectId="sample"
          onboarding={{
            ...startOnboarding("sample"),
            status: "completed",
            completedSteps: ["open", "compile", "view"],
          }}
          onDismiss={vi.fn()}
          t={(key) => messages[String(key)] ?? String(key)}
        />,
      );
    });
    expect(container.innerHTML).toBe("");
  });
});
